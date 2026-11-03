package no.lotek.html

import com.google.gson.JsonElement
import com.google.gson.JsonParser
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail
import kotlinx.html.body
import kotlinx.html.head
import kotlinx.html.html
import kotlinx.html.stream.createHTML
import kotlinx.html.title
import no.lotek.assertLotek
import no.lotek.html.recipes.recipes
import org.jsoup.Jsoup
import org.jsoup.nodes.Comment
import org.jsoup.nodes.Element
import org.jsoup.nodes.TextNode

/**
 * The Kotlin tab on a component page renders the markup of the page's HTML
 * recipe, with the builder functions doing the wiring.
 *
 * The HTML recipe is the answer. It is the one checked against the morphers
 * and without JavaScript (`update.browser.test.ts`,
 * `check-without-javascript.ts`), so the Kotlin recipe is held to it rather
 * than tested again in a browser. The two are compared as trees, without
 * comments, `<script>` and `<link>`:
 *
 *   - the same elements in the same order, and the same text;
 *   - every attribute and class in the HTML recipe, with the same value;
 *   - an attribute or class the HTML recipe lacks only if a builder function
 *     writes it in some answer in the build cases, since the builder
 *     functions write more of the wiring than a hand-written template needs;
 *   - the ids may differ, since `Lt.tabs` makes them from `id` and `keys`,
 *     but the same element must have an id in both, and every `for`,
 *     `href="#…"` and `aria-*` pointer must point at the element the HTML
 *     recipe points at. Every other `href` is compared as written.
 *
 * [assertLotek] then checks the Kotlin page as a whole: every pointer
 * resolves, and every field is wired.
 */
class RecipesTest {
    /** The attributes whose value is a list of ids. */
    private val idLists = setOf("aria-labelledby", "aria-describedby", "aria-controls")

    private val answers: List<JsonElement> =
        JsonParser.parseString(File(System.getProperty("buildCases")).readText())
            .asJsonObject["cases"].asJsonArray
            .mapNotNull { it.asJsonObject["expected"] }

    /** Every attribute name, and every class, a builder function writes in some answer. */
    private val fromBuilders = mutableSetOf<String>()
    private val classesFromBuilders = mutableSetOf<String>()

    init {
        // An answer is a set of attributes, a group of sets with values such as
        // `state` next to them, or a list of sets. Only the keys of a set are
        // attribute names: `label` in a group is the name of a set, and
        // `state` a value.
        fun read(e: JsonElement) {
            when {
                e.isJsonArray -> e.asJsonArray.forEach(::read)
                e.isJsonObject -> {
                    val entries = e.asJsonObject.entrySet()
                    if (entries.any { !it.value.isJsonPrimitive }) {
                        entries.filter { !it.value.isJsonPrimitive }.forEach { read(it.value) }
                    } else {
                        for ((name, value) in entries) {
                            fromBuilders += name
                            if (name == "class") classesFromBuilders += value.asString.split(' ').filter { it.isNotEmpty() }
                        }
                    }
                }
            }
        }
        answers.forEach(::read)
    }

    /** A pointer in the HTML recipe, checked once every id has been paired. */
    private class Pointer(val path: String, val name: String, val wanted: String, val got: String)

    @Test
    fun `the attributes a builder function can write are read from the answers, not the options`() {
        assertTrue("aria-describedby" in fromBuilders && "data-variant" in fromBuilders, "read $fromBuilders")
        for (notAnAttribute in listOf("builder", "options", "expected", "variant", "label", "state", "keys")) {
            assertTrue(notAnAttribute !in fromBuilders, "$notAnAttribute is an option or a set, not an attribute a builder function writes")
        }
    }

    @Test
    fun `every Kotlin tab on the pages is extracted`() {
        val pages = File(System.getProperty("pages")).listFiles { f -> f.name.endsWith(".mdx") }.orEmpty()
        val tab = Regex("""<TabItem\s+label\s*=\s*"Kotlin"\s*>""")
        val inPages = pages.filter { tab.containsMatchIn(it.readText()) }.map { it.nameWithoutExtension }.sorted()
        assertTrue(inPages.isNotEmpty(), "found no Kotlin tab in ${pages.size} pages")
        assertEquals(inPages, recipes.map { it.page }.sorted())
    }

    @Test
    fun `every Kotlin recipe renders the HTML recipe on its page`() {
        var compared = 0
        for (recipe in recipes) {
            val expected = javaClass.getResource("/recipes/${recipe.page}.html")?.readText()
                ?: fail("${recipe.page}: the HTML recipe was not extracted")
            val page = createHTML().html {
                head { title(recipe.page) }
                body { recipe.render(this) }
            }
            val problems = mutableListOf<String>()
            val ids = mutableMapOf<String, String>()
            val pointers = mutableListOf<Pointer>()
            compare(Jsoup.parseBodyFragment(expected).body(), Jsoup.parse(page).body(), "body", problems, ids, pointers)
            for (p in pointers) {
                val point = { id: String -> ids[id] ?: id }
                when {
                    p.name in idLists -> {
                        val missing = p.wanted.split(Regex("\\s+")).filter { it.isNotEmpty() }.map(point) - p.got.split(Regex("\\s+")).toSet()
                        if (missing.isNotEmpty()) problems.add("${p.path}: ${p.name}=\"${p.got}\" does not point at $missing, as the HTML recipe does")
                    }
                    p.name == "for" -> if (p.got != point(p.wanted)) problems.add("${p.path}: for=\"${p.got}\", where the HTML recipe points at the element with id ${point(p.wanted)}")
                    p.wanted.startsWith("#") -> if (p.got != "#" + point(p.wanted.drop(1))) problems.add("${p.path}: href=\"${p.got}\", where the HTML recipe points at #${point(p.wanted.drop(1))}")
                    else -> if (p.got != p.wanted) problems.add("${p.path}: href is \"${p.got}\", the HTML recipe has \"${p.wanted}\"")
                }
            }
            if (problems.isNotEmpty()) {
                fail("${recipe.page}.mdx, ${recipe.function}() does not render the HTML recipe:\n  ${problems.joinToString("\n  ")}")
            }
            assertLotek(page)
            compared += 1
        }
        // The expected number comes from the pages, in the test above, not from this list.
        assertTrue(compared > 0, "compared no recipe")
        println("Compared $compared Kotlin recipes with their HTML recipes.")
    }

    /** The children that count: elements and text, without comments, scripts and stylesheet links. */
    private fun children(e: Element): List<Any> =
        e.childNodes().mapNotNull { node ->
            when (node) {
                is Comment -> null
                is Element -> node.takeUnless { it.tagName() == "script" || it.tagName() == "link" }
                is TextNode -> node.text().replace(Regex("\\s+"), " ").trim().takeIf { it.isNotEmpty() }
                else -> null
            }
        }

    private fun compare(
        expected: Element,
        actual: Element,
        path: String,
        problems: MutableList<String>,
        ids: MutableMap<String, String>,
        pointers: MutableList<Pointer>,
    ) {
        if (expected.tagName() != actual.tagName()) {
            problems.add("$path: <${actual.tagName()}> where the HTML recipe has <${expected.tagName()}>")
            return
        }
        // kotlinx.html writes a flag as `required="required"`, which means the same as `required` in HTML.
        fun values(e: Element) = e.attributes().associate { it.key to if (it.value.equals(it.key, ignoreCase = true)) "" else it.value }
        val wanted = values(expected)
        val got = values(actual)
        val wantedClasses = wanted["class"].orEmpty().split(' ').filter { it.isNotEmpty() }.toSet()
        val gotClasses = got["class"].orEmpty().split(' ').filter { it.isNotEmpty() }.toSet()
        for (c in wantedClasses - gotClasses) problems.add("$path: the class $c is missing")
        for (c in gotClasses - wantedClasses - classesFromBuilders) problems.add("$path: the class $c is not in the HTML recipe, and no builder function writes it")
        for ((name, value) in wanted) {
            if (name == "class") continue
            val other = got[name]
            when {
                other == null -> problems.add("$path: $name=\"$value\" is missing")
                name == "id" -> ids[value] = other
                name == "for" || name == "href" || name in idLists -> pointers.add(Pointer(path, name, value, other))
                other != value -> problems.add("$path: $name is \"$other\", the HTML recipe has \"$value\"")
            }
        }
        for (name in got.keys - wanted.keys - "class") {
            if (name !in fromBuilders) problems.add("$path: $name is not in the HTML recipe, and no builder function writes it")
        }
        val a = children(expected)
        val b = children(actual)
        if (a.size != b.size) {
            problems.add("$path: ${b.size} children where the HTML recipe has ${a.size}: ${b.map(::describe)} against ${a.map(::describe)}")
            return
        }
        for ((i, pair) in a.zip(b).withIndex()) {
            val (x, y) = pair
            val at = "$path > ${describe(x)}[$i]"
            when {
                x is Element && y is Element -> compare(x, y, at, problems, ids, pointers)
                x is String && y is String -> if (x != y) problems.add("$at: the text \"$y\", the HTML recipe has \"$x\"")
                else -> problems.add("$at: ${describe(y)} where the HTML recipe has ${describe(x)}")
            }
        }
    }

    private fun describe(node: Any): String = if (node is Element) "<${node.tagName()}>" else "\"$node\""
}
