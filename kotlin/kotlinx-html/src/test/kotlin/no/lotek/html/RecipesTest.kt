package no.lotek.html

import java.io.File
import kotlin.test.Test
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
 *     can write it, read from the build cases, since the builder functions
 *     write more of the wiring than a hand-written template needs to;
 *   - the ids may differ, since `Lt.tabs` makes them from `id` and `keys`.
 *     That every id an attribute points to exists, and that every field is
 *     wired, is checked by [assertLotek] on the Kotlin page.
 */
class RecipesTest {
    /** The attributes that point at an id, and whose value therefore follows the ids. */
    private val references = setOf("id", "for", "href", "aria-labelledby", "aria-describedby", "aria-controls")

    private val buildCases = File(System.getProperty("buildCases")).readText()

    /** Every attribute name and class a builder function can write. */
    private val fromBuilders: Set<String> =
        Regex(""""([a-z][a-z-]*)":""").findAll(buildCases).map { it.groupValues[1] }.toSet()
    private val classesFromBuilders: Set<String> =
        Regex("""lt-[a-z0-9_-]+""").findAll(buildCases).map { it.value }.toSet()

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
            compare(Jsoup.parseBodyFragment(expected).body(), Jsoup.parse(page).body(), "body", problems)
            if (problems.isNotEmpty()) {
                fail("${recipe.page}.mdx, ${recipe.function}() does not render the HTML recipe:\n  ${problems.joinToString("\n  ")}")
            }
            assertLotek(page)
            compared += 1
        }
        assertTrue(compared > 0 && compared == recipes.size, "compared $compared of ${recipes.size} recipes")
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

    private fun compare(expected: Element, actual: Element, path: String, problems: MutableList<String>) {
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
            when {
                name !in got -> problems.add("$path: $name=\"$value\" is missing")
                name !in references && got[name] != value -> problems.add("$path: $name is \"${got[name]}\", the HTML recipe has \"$value\"")
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
                x is Element && y is Element -> compare(x, y, at, problems)
                x is String && y is String -> if (x != y) problems.add("$at: the text \"$y\", the HTML recipe has \"$x\"")
                else -> problems.add("$at: ${describe(y)} where the HTML recipe has ${describe(x)}")
            }
        }
    }

    private fun describe(node: Any): String = if (node is Element) "<${node.tagName()}>" else "\"$node\""
}
