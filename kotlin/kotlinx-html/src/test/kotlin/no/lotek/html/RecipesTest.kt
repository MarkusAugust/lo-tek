package no.lotek.html

import com.google.gson.JsonElement
import com.google.gson.JsonParser
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
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

    private val WHITESPACE = Regex("\\s+")
    /**
     * Whether a script only registers web components: imports of
     * `defineLt…` and calls of them, and nothing else. The HTML recipes have
     * the registration in a script of its own ("Once for the whole app"), and
     * the Kotlin recipe has it once in the page template with `defineLt()`, so
     * such a script is left out of the comparison. Any other script is
     * compared whole: a script that registers and also does something is not
     * left out, and must be the same in the Kotlin recipe.
     */
    internal fun isRegistration(script: String): Boolean {
        val code = script.replace(Regex("""(?m)^\s*//.*$"""), "").replace(Regex("""/\*[\s\S]*?\*/"""), "")
        val rest = code
            .replace(Regex("""import\s*\{\s*defineLt\w*(?:\s*,\s*defineLt\w*)*\s*,?\s*\}\s*from\s*["'][^"']*["']\s*;?"""), "")
            .replace(Regex("""\bdefineLt\w*\(\s*\)\s*;?"""), "")
        return "defineLt" in code && rest.isBlank()
    }

    /**
     * A module of the package is the same file whether the page loads it from
     * the CDN, as in the HTML recipe, or from the WebJar, as in the Kotlin one,
     * so an import is compared by the path from `dist/` on.
     */
    private val PACKAGE_MODULE = Regex("""(["'])[^"']*/(dist/[^"']+)\1""")

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

    /**
     * Every rule of [differences], each with one known mistake, so a rule
     * that stops working fails here and not only in a page that happens to
     * break it. The loop that checks the pointers was once deleted in a
     * rewrite without a test failing; it would have failed here.
     */
    @Test
    fun `the comparison reports each kind of difference`() {
        val html = """
            <lt-field>
              <label class="lt-label" for="codename">Codename</label>
              <input class="lt-input" id="codename" aria-describedby="codename-help" required>
              <p class="lt-help-text" id="codename-help">Your crew name.</p>
            </lt-field>
            <a href="#codename">Go to the field</a>
            <a href="/orders">Orders</a>
            <script type="module">import { defineLtField } from "x.js"; defineLtField()</script>
            <script type="module">go("codename")</script>
        """.trimIndent()
        // A correct Kotlin page: other ids, mapped one to one, an attribute
        // a builder function writes, and the script without the registration.
        val right = """
            <html><body>
            <lt-field>
              <label class="lt-label" for="c">Codename</label>
              <input class="lt-input" id="c" aria-describedby="c-help" aria-invalid="true" required="required">
              <p class="lt-help-text" id="c-help">Your crew name.</p>
            </lt-field>
            <a href="#c">Go to the field</a>
            <a href="/orders">Orders</a>
            <script type="module">go("codename")</script>
            </body></html>
        """.trimIndent()
        assertEquals(emptyList<String>(), differences(html, right).first, "a correct page")
        val mistakes = mapOf(
            "the label points at another field" to (""" for="c">""" to """ for="c-help">""") to "for=",
            "a link points elsewhere" to ("""href="#c"""" to """href="#c-help"""") to "href=",
            "another address" to ("""href="/orders"""" to """href="/order"""") to "href is",
            "a description points elsewhere" to ("""aria-describedby="c-help"""" to """aria-describedby="c"""") to "does not point at",
            "a class is missing" to ("""class="lt-input"""" to """class=""""") to "the class lt-input is missing",
            "a class no builder writes" to ("""class="lt-label"""" to """class="lt-label my-own"""") to "the class my-own",
            "an attribute no builder writes" to (""" required="required">""" to """ required="required" data-own="x">""") to "data-own is not",
            "an attribute is missing" to (""" required="required">""" to """>""") to "required=\"\" is missing",
            "another text" to (""">Orders<""" to """>Order<""") to "the text",
            "another tag" to ("""<p class="lt-help-text" id="c-help">Your crew name.</p>""" to """<div class="lt-help-text" id="c-help">Your crew name.</div>""") to "<div> where",
            "an element too many" to ("""<a href="/orders">""" to """<hr><a href="/orders">""") to "children",
            "two elements share an id" to ("""<a href="#c">""" to """<a href="#c" id="c-help">""") to "is on 2 elements",
            "the script is missing" to ("""<script type="module">go("codename")</script>""" to "") to "the scripts differ",
            "the script is not a module" to ("""<script type="module">""" to "<script>") to "the scripts differ",
            "the script does something else" to ("""go("codename")""" to """go("code")""") to "the scripts differ",
            "a script that registers and does more" to ("""<script type="module">go("codename")</script>""" to """<script type="module">go("codename")</script><script type="module">import { defineLtField } from "x.js"; defineLtField(); more()</script>""") to "the scripts differ",
        )
        for ((case, mistake) in mistakes) {
            val (name, edit) = case
            val (from, to) = edit
            assertTrue(from in right, "the case \"$name\" edits nothing")
            val found = differences(html, right.replace(from, to)).first
            assertTrue(found.any { mistake in it }, "$name: expected a difference with \"$mistake\", got $found")
        }
    }

    @Test
    fun `a web component that only wires may be left out, and so may a script through it`() {
        val html = """
            <lt-field><label class="lt-label" for="codename">Codename</label><input class="lt-input" id="codename"></lt-field>
            <script type="module">document.querySelector("input").closest("lt-field")</script>
        """.trimIndent()
        val page = """<html><body><label class="lt-label" for="c">Codename</label><input class="lt-input" id="c"></body></html>"""
        assertEquals(emptyList<String>() to 1, differences(html, page))
        // A script in the Kotlin recipe that names the left-out component is broken.
        val broken = page.replace("</body>", """<script type="module">document.querySelector("input").closest("lt-field")</script></body>""")
        assertTrue(differences(html, broken).first.any { "names lt-field" in it }, "a Kotlin script through a left-out component")
        // A module of the package from the CDN and from the WebJar is one file.
        val cdn = """<script type="module">import { a } from "https://cdn.jsdelivr.net/npm/@lo-tek/interfaces@VERSION/dist/x.js"; a()</script>"""
        val webJar = """<html><body><script type="module">import { a } from "/webjars/lo-tek/0.39.0/dist/x.js"; a()</script></body></html>"""
        assertEquals(emptyList<String>() to 0, differences(cdn, webJar))
        // A script that only mentions the class `lt-fieldset` is not exempt.
        val other = html.replace(""".closest("lt-field")""", """.closest(".lt-fieldset")""")
        assertTrue(differences(other, page).first.any { "the scripts differ" in it })
    }

    @Test
    fun `only a script that does nothing but register is left out`() {
        val registration = listOf(
            """import { defineLtToast } from "x.js"
               defineLtToast()""",
            """// Once for the whole app
               import { defineLtTabs, defineLtField } from "https://cdn/x.js"; defineLtTabs(); defineLtField();""",
        )
        val behaviour = listOf(
            """import { defineLtToast, showToast } from "x.js"; defineLtToast(); showToast("a")""",
            """go()""",
            """// defineLt() is called once, elsewhere
               go()""",
        )
        for (script in registration) assertTrue(isRegistration(script), script)
        for (script in behaviour) assertFalse(isRegistration(script), script)
    }

    @Test
    fun `every tab for kotlinx html on the pages is extracted`() {
        assertTrue(pagesWithKotlin.isNotEmpty(), "found no kotlinx.html tab in the pages")
        assertEquals(pagesWithKotlin, recipes.map { it.page }.sorted())
    }

    @Test
    fun `every Kotlin recipe renders the HTML recipe on its page`() {
        var compared = 0
        var exempted = 0
        val failures = mutableListOf<String>()
        for (recipe in recipes) {
            val expected = javaClass.getResource("/recipes/${recipe.page}.html")?.readText()
                ?: fail("${recipe.page}: the HTML recipe was not extracted")
            val page = createHTML().html {
                head { title(recipe.page) }
                body { recipe.render(this) }
            }
            val (problems, exemptions) = differences(expected, page)
            exempted += exemptions
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
            } catch (e: AssertionError) {
                // Only a finding is collected. Anything else, a core that does
                // not load, stops the test at once with its stack trace.
                failures.add("${recipe.page}.mdx, ${recipe.function}(): ${e.message}")
                continue
            }
            compared += 1
        }
        // The exemption for a script through a left-out component must still be
        // needed, or it is a condition that switches the check off for nothing.
        if (exempted == 0) failures.add("No script was exempt for working through a web component in WIRING_ONLY, so the exemption has no use left: take it out")
        val unknown = PARTS_ON_THEIR_OWN - recipes.map { it.page }.toSet()
        if (unknown.isNotEmpty()) failures.add("$unknown are listed as exceptions, and no page has that recipe")
        if (failures.isNotEmpty()) fail(failures.joinToString("\n\n"))
        // The expected number comes from the pages, not from the list the loop went through.
        assertTrue(compared > 0 && compared == pagesWithKotlin.size, "compared $compared recipes, and ${pagesWithKotlin.size} pages have a kotlinx.html tab")
        println("Compared $compared Kotlin recipes with their HTML recipes.")
    }

    /**
     * What differs between an HTML recipe and the page a Kotlin recipe
     * renders, one line per difference, and how many scripts were exempt for
     * working through a left-out web component. Empty when they agree. The
     * test of every page calls it, and `the comparison reports each kind of
     * difference` gives it one known mistake at a time, so a rule that stops
     * working, or is deleted in a rewrite, fails there.
     */
    internal fun differences(expected: String, page: String): Pair<List<String>, Int> {
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
        // No id twice on the Kotlin page, also one the HTML recipe does not
        // have, such as an id from a builder function written a second time.
        for ((id, count) in rendered.select("[id]").groupingBy { it.id() }.eachCount()) {
            if (count > 1) problems.add("the id \"$id\" is on $count elements")
        }
        val point = { id: String -> ids[id] ?: id }
        for (p in pointers) {
            val wantedIds = p.wanted.split(WHITESPACE).filter { it.isNotEmpty() }.map(point)
            val gotIds = p.got.split(WHITESPACE).filter { it.isNotEmpty() }
            when {
                p.name in idLists -> {
                    val missing = wantedIds - gotIds.toSet()
                    if (missing.isNotEmpty()) problems.add("${p.path}: ${p.name}=\"${p.got}\" does not point at $missing, as the HTML recipe does")
                }
                // A set of ids on `<output>`, one id on `<label>`.
                p.name == "for" -> if (gotIds.toSet() != wantedIds.toSet()) {
                    problems.add("${p.path}: for=\"${p.got}\", where the HTML recipe points at ${wantedIds.joinToString(" ")}")
                }
                p.wanted.startsWith("#") -> if (p.got != "#" + point(p.wanted.drop(1))) {
                    problems.add("${p.path}: href=\"${p.got}\", where the HTML recipe points at #${point(p.wanted.drop(1))}")
                }
                else -> if (p.got != p.wanted) problems.add("${p.path}: href is \"${p.got}\", the HTML recipe has \"${p.wanted}\"")
            }
        }
        // The scripts are compared on their own, the tree leaves them out: the
        // type, the source and the whole text, with only a script that does
        // nothing but register left out, see [isRegistration], and a module of
        // the package compared by its path, see [PACKAGE_MODULE].
        fun scripts(e: Element) =
            e.getElementsByTag("script")
                .filterNot { isRegistration(it.data()) }
                .map {
                    Triple(
                        it.attr("type"),
                        it.attr("src").replace(PACKAGE_MODULE, "$1$2$1"),
                        it.data().replace(PACKAGE_MODULE, "$1$2$1").replace(WHITESPACE, " ").trim(),
                    )
                }
                .filter { it.second.isNotEmpty() || it.third.isNotEmpty() }
        // A script in the HTML recipe that works through a web component the
        // Kotlin recipe leaves out (see [WIRING_ONLY]) cannot be the same: on
        // the field page it validates in the browser and finds the error text
        // with `closest("lt-field")`, where the Kotlin recipe renders the field
        // invalid on the server. It names the tag as a string of its own, and
        // only that exempts it, on the HTML side alone. In the Kotlin recipe a
        // script that names a left-out tag is broken, since the element is not
        // there.
        val namesRemoved = { script: Triple<String, String, String> ->
            removed.any { tag -> Regex("""["']${Regex.escape(tag)}["']""").containsMatchIn(script.third) }
        }
        val htmlScripts = scripts(wanted)
        val kotlinScripts = scripts(rendered)
        val compared = htmlScripts.filterNot(namesRemoved)
        for (script in kotlinScripts.filter(namesRemoved)) {
            problems.add("a script in the Kotlin recipe names ${removed.joinToString(", ")}, which the Kotlin recipe leaves out: ${script.third.take(80)}")
        }
        if (compared != kotlinScripts) {
            problems.add("the scripts differ from the HTML recipe's:\n    $kotlinScripts\n  against\n    $compared")
        }
        return problems to htmlScripts.size - compared.size
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
