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
import no.lotek.Lotek
import no.lotek.Returns
import no.lotek.assertLotek
import no.lotek.html.recipes.recipes
import org.jsoup.Jsoup
import org.jsoup.nodes.Comment
import org.jsoup.nodes.Element
import org.jsoup.nodes.TextNode

/**
 * The kotlinx.html tab on a component page renders the markup of the page's HTML
 * recipe, with the builder functions doing the wiring.
 *
 * The HTML recipe is the answer. It is the one checked against the morphers
 * and without JavaScript (`update.browser.test.ts`,
 * `check-without-javascript.ts`), so the Kotlin recipe is held to it rather
 * than tested again in a browser. The two are compared as trees, without
 * comments, `<script>` and `<link>`:
 *
 *   - the same scripts, apart from the registration, which the Kotlin
 *     recipe has once in the page template;
 *   - the same elements in the same order, and the same text, except a web
 *     component in [WIRING_ONLY], which the Kotlin recipe may leave out;
 *   - every attribute and class in the HTML recipe, with the same value;
 *   - an attribute or class the HTML recipe lacks only if a builder function
 *     writes it in some answer in the build cases, since the builder
 *     functions write more of the wiring than a hand-written template needs;
 *   - the ids may differ, since `Lt.tabs` makes them from `id` and `keys`,
 *     but an element with an id in the HTML recipe has one in Kotlin, no two
 *     share it, and every `for`, `href="#…"` and attribute in [idLists] must
 *     point at the element the HTML recipe points at. Every other `href` is
 *     compared as written. An element may have an id the HTML recipe lacks,
 *     since the builder functions give ids to the help text and the like.
 *
 * [assertLotek] then checks the Kotlin page as a whole: every pointer
 * resolves, and every field is wired. The two examples that show a part on
 * its own are checked as fragments, see [PARTS_ON_THEIR_OWN].
 */
class RecipesTest {
    /**
     * The web components that do nothing but the wiring, which a builder
     * function writes itself. The HTML recipe has them because it has no
     * builder function, and the Kotlin recipe leaves them out, as the React
     * tab does: `<lt-field>` is not needed when `Lt.field()` has written the
     * field (markup-and-behaviour, "The wiring: either the builder function
     * or the component"). The others carry behaviour, and must be there.
     */
    private val WIRING_ONLY = listOf("lt-field")

    /**
     * The pages whose example shows a part on its own, an error text or a help
     * text without a field, so the page is checked as a fragment, as
     * `check-rendered.ts` reads the previews. Every other recipe, the wired
     * fields on the input and label pages included, is checked as a page.
     */
    private val PARTS_ON_THEIR_OWN = setOf("error-text", "help-text")

    /** The attributes whose value is a list of ids, or one id. */
    private val idLists = setOf(
        "aria-labelledby", "aria-describedby", "aria-controls", "aria-activedescendant",
        "aria-errormessage", "aria-owns", "aria-flowto", "aria-details", "list", "popovertarget", "form",
    )

    /** Every attribute name, and every class, a builder function writes in some answer. */
    private val fromBuilders = mutableSetOf<String>()
    private val classesFromBuilders = mutableSetOf<String>()

    init {
        // The shape of each answer is read from `returns` in the manifest, as
        // the generator reads it, so `label` in a group is the name of a set
        // and `state` a value, and only the keys of a set are attribute names.
        val shapes = Lotek.manifest.builders.associate { it.name to it.returns }
        fun read(e: JsonElement?, shape: Returns) {
            if (e == null || e.isJsonNull) return
            when (shape) {
                is Returns.Attributes -> for ((name, value) in e.asJsonObject.entrySet()) {
                    fromBuilders += name
                    if (name == "class") classesFromBuilders += value.asString.split(' ').filter { it.isNotEmpty() }
                }
                is Returns.ListOf -> e.asJsonArray.forEach { read(it, shape.of) }
                is Returns.Group -> for ((field, s) in shape.fields) read(e.asJsonObject[field], s)
                is Returns.Text, is Returns.Values -> {}
            }
        }
        val cases = JsonParser.parseString(File(System.getProperty("buildCases")).readText()).asJsonObject["cases"].asJsonArray
        for (case in cases) {
            val c = case.asJsonObject
            read(c["expected"], shapes[c["builder"].asString] ?: fail("The build cases call ${c["builder"]}, which the manifest does not have"))
        }
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

    /**
     * The pages with a kotlinx.html tab, found more loosely than `ExtractRecipes`
     * finds them: any `<TabItem` tag with `kotlin` in it, or a slot called
     * `kotlin`, in any case and whatever the quotes,
     * the spacing or the other attributes. The expected number therefore does
     * not come from the list the test goes through.
     */
    private val pagesWithKotlin: List<String> =
        File(System.getProperty("pages")).listFiles { f -> f.name.endsWith(".mdx") }.orEmpty()
            .filter { Regex("""(?i)<TabItem\b[^>]*kotlin[^>]*>|slot\s*=\s*["']kotlin""").containsMatchIn(it.readText()) }
            .map { it.nameWithoutExtension }
            .sorted()

    @Test
    fun `every tab for kotlinx html on the pages is extracted`() {
        assertTrue(pagesWithKotlin.isNotEmpty(), "found no kotlinx.html tab in the pages")
        assertEquals(pagesWithKotlin, recipes.map { it.page }.sorted())
    }

    @Test
    fun `every Kotlin recipe renders the HTML recipe on its page`() {
        var compared = 0
        val failures = mutableListOf<String>()
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
            val wanted = Jsoup.parseBodyFragment(expected).body()
            val rendered = Jsoup.parse(page).body()
            // A web component that only wires is left out where the builder
            // function does the wiring, so the Kotlin recipe has its children
            // where the HTML recipe has the component.
            val removed = WIRING_ONLY.filter { rendered.getElementsByTag(it).isEmpty() && wanted.getElementsByTag(it).isNotEmpty() }
            for (tag in removed) wanted.getElementsByTag(tag).forEach { it.unwrap() }
            compare(wanted, rendered, "body", problems, ids, pointers)
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
            // The scripts are compared on their own, the tree leaves them out:
            // the type, the source and the text. The registration is taken out
            // of the text, since the Kotlin recipe registers once in the page
            // template with `defineLt()`: the `defineLt…` names in an import,
            // an import of `register.js`, and the call, also on a namespace.
            // Whatever else the script does stays and is compared.
            fun registrationOut(text: String) =
                text
                    .replace(Regex("""import\s*\{([^}]*)\}\s*from\s*(["'][^"']*["'])\s*;?""")) { m ->
                        val names = m.groupValues[1].split(',').map { it.trim() }.filter { it.isNotEmpty() && !it.startsWith("defineLt") }
                        if (names.isEmpty()) "" else "import { ${names.joinToString(", ")} } from ${m.groupValues[2]}"
                    }
                    .replace(Regex("""import\s*["'][^"']*/register\.js["']\s*;?"""), "")
                    .replace(Regex("""\b(?:\w+\.)?defineLt\w*\([^)]*\)\s*;?"""), "")
                    .replace(Regex("\\s+"), " ").trim()
            fun scripts(e: Element) =
                e.getElementsByTag("script")
                    .map { Triple(it.attr("type"), it.attr("src"), registrationOut(it.data())) }
                    .filter { it.second.isNotEmpty() || it.third.isNotEmpty() }
            // A script that works through a web component the Kotlin recipe
            // leaves out (see [WIRING_ONLY]) cannot be the same: on the field
            // page it validates in the browser and finds the error text
            // through `<lt-field>`, where the Kotlin recipe renders the field
            // invalid on the server.
            val wantedScripts = scripts(wanted).filterNot { script -> removed.any { it in script.third } }
            if (wantedScripts != scripts(rendered)) {
                problems.add("the scripts differ from the HTML recipe's:\n    ${scripts(rendered)}\n  against\n    $wantedScripts")
            }
            if (problems.isNotEmpty()) {
                // Every page is compared before the test fails, so one run shows them all.
                failures.add("${recipe.page}.mdx, ${recipe.function}() does not render the HTML recipe:\n  ${problems.joinToString("\n  ")}")
                continue
            }
            // A finding from the check is collected like a difference, so one
            // run shows every page that is wrong.
            try {
                if (recipe.page in PARTS_ON_THEIR_OWN) {
                    // The page shows the part alone, and a whole page with it fails
                    // by design, on that rule and on no other.
                    assertLotek(page, fragment = true)
                    val asPage = runCatching { assertLotek(page) }.exceptionOrNull()
                    assertTrue(
                        asPage is AssertionError && "[text-not-wired]" in asPage.message.orEmpty() && Regex("""\[(?!text-not-wired)[a-z-]+]""").find(asPage.message.orEmpty()) == null,
                        "${recipe.page} as a whole page should fail on text-not-wired alone: ${asPage?.message}",
                    )
                } else {
                    assertLotek(page)
                }
            } catch (e: Throwable) {
                failures.add("${recipe.page}.mdx, ${recipe.function}(): ${e::class.simpleName}: ${e.message}")
                continue
            }
            compared += 1
        }
        val unknown = PARTS_ON_THEIR_OWN - recipes.map { it.page }.toSet()
        if (unknown.isNotEmpty()) failures.add("$unknown are listed as exceptions, and no page has that recipe")
        if (failures.isNotEmpty()) fail(failures.joinToString("\n\n"))
        // The expected number comes from the pages, not from the list the loop went through.
        assertTrue(compared > 0 && compared == pagesWithKotlin.size, "compared $compared recipes, and ${pagesWithKotlin.size} pages have a kotlinx.html tab")
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
        // kotlinx.html writes a flag as `required="required"`, which means the
        // same as `required` in HTML, and `xmlns` on `<svg>`, which the HTML
        // parser ignores: an `<svg>` in HTML is in the SVG namespace either way.
        fun values(e: Element) =
            e.attributes()
                .filterNot { it.key == "xmlns" && e.tagName() == "svg" }
                .associate { it.key to if (it.value.equals(it.key, ignoreCase = true)) "" else it.value }
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
                name == "id" -> {
                    // One to one: two elements with ids in the HTML recipe are two elements in Kotlin.
                    ids.entries.firstOrNull { it.value == other && it.key != value }?.let {
                        problems.add("$path: the id \"$other\" is also the id of the element that has \"${it.key}\" in the HTML recipe")
                    }
                    ids[value] = other
                }
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
