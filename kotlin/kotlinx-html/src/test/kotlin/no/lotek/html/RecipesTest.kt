package no.lotek.html

import com.google.gson.JsonElement
import com.google.gson.JsonParser
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.test.fail
import kotlinx.html.FlowContent
import kotlinx.html.body
import kotlinx.html.head
import kotlinx.html.html
import kotlinx.html.stream.createHTML
import kotlinx.html.title
import no.lotek.Lotek
import no.lotek.LotekWebJar
import no.lotek.Returns
import no.lotek.assertLotek
import no.lotek.html.recipes.errorsummary.faultsIn as errorSummaryFaults
import no.lotek.html.recipes.errorsummary.orderForm as errorSummaryForm
import no.lotek.html.recipes.field.orderForm as fieldForm
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
 *     recipe has once in the page template, and apart from the pages in
 *     [SERVER_DOES_IT], where the Kotlin recipe has no script at all;
 *   - no script in the Kotlin recipe that does the server's job: it takes
 *     over a form's `submit`, or writes markup with `innerHTML`;
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
     * One script in an HTML recipe that does a server's job, which the Kotlin
     * recipe leaves out because a Kotlin server does that job itself. The HTML
     * recipe has no server behind it, and the Kotlin one is the server: a copy
     * of the script there did the server's job again in the browser, and
     * taught the reader that a Kotlin page needs JavaScript.
     *
     * [marker] names the script: it must be found in exactly one HTML script
     * on the page, in the code without its comments, and that script must do
     * a server's job by [SERVERS_JOB]. Every other script on the page is still
     * compared, which is what caught eight recipes without the script their
     * HTML tab has, among them the dialog, which then never opened.
     *
     * [failed] and [passed] are the proof that the server does it: the recipe
     * rendered as the server answers a failed and a valid submission, through
     * the page's own validation where it has one. Both are rendered and
     * checked, see [serverAnswer].
     */
    internal class Exemption(
        val page: String,
        val marker: String,
        val reason: String,
        val failed: FlowContent.() -> Unit,
        val passed: FlowContent.() -> Unit,
        /** What the failed answer must echo, by the field's name. */
        val echo: Map<String, String> = emptyMap(),
        /** How many links the error summary in the failed answer must have, when it has one. */
        val links: Int? = null,
    )

    private val SERVER_DOES_IT = listOf(
        Exemption(
            page = "error-summary",
            marker = "showErrors(errors)",
            reason = "the script validates the field and writes the summary, which the server renders from the faults",
            failed = { errorSummaryForm("nobody", errorSummaryFaults("nobody")) },
            passed = { errorSummaryForm("fixer@relay.example", errorSummaryFaults("fixer@relay.example")) },
            echo = mapOf("fixer" to "nobody"),
            links = 1,
        ),
        Exemption(
            page = "field",
            marker = "codenameInput.focus()",
            reason = "the script shows the error text when the codename is empty, which the server renders with invalid = true",
            failed = { fieldForm(codename = "", invalid = true) },
            passed = { fieldForm(codename = "Kestrel") },
        ),
    )

    /**
     * What a script in a Kotlin recipe must not do, since the server does it:
     * take over the form's submission, or write markup. Matched on the code
     * without its comments. This is a tripwire, not a proof: a script that
     * takes over the submission from a `click` on the button, or builds the
     * markup with `createElement`, is not caught here. On the pages in
     * [SERVER_DOES_IT] the proof is [serverAnswer]; on the others the Kotlin
     * script is a copy of the HTML one, and goes through the same review.
     */
    private val SERVERS_JOB = listOf(
        Regex("""addEventListener\(\s*["'`]submit["'`]""") to "takes over the form's submission, which the server answers",
        Regex("""\.onsubmit\s*=(?!=)""") to "takes over the form's submission, which the server answers",
        Regex("""\brequestSubmit\s*\(""") to "submits the form from a script, which the server answers",
        Regex("""\bnew\s+FormData\s*\(""") to "reads the form to send it itself, which the server answers",
        Regex("""\.(?:innerHTML|outerHTML)\s*\+?=(?!=)""") to "writes markup, which the server renders",
        Regex("""\b(?:insertAdjacentHTML|setHTMLUnsafe)\s*\(""") to "writes markup, which the server renders",
        Regex("""\bdocument\.write(?:ln)?\s*\(""") to "writes markup, which the server renders",
    )

    /** A script's code without its comments, collapsed, as [SERVERS_JOB] and the markers read it. */
    internal fun code(script: String): String =
        script.replace(Regex("""/\*[\s\S]*?\*/"""), "").replace(Regex("""(?m)^\s*//.*$"""), "").replace(WHITESPACE, " ").trim()

    /** What a script does of the server's job, by [SERVERS_JOB]. */
    internal fun serversJob(script: String): List<String> = code(script).let { c -> SERVERS_JOB.filter { it.first.containsMatchIn(c) }.map { it.second } }

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
     * A file of the package is the same file whether the page loads it from
     * the CDN, as in the HTML recipe, or from the WebJar, as in the Kotlin one,
     * so both roots are written as one. Only those two: another address that
     * happens to have `dist/` in it is another file.
     */
    private fun packageRoot(text: String): String =
        text.replace("https://cdn.jsdelivr.net/npm/@lo-tek/interfaces@VERSION/", "lo-tek:/")
            .replace("${LotekWebJar.ROOT}/", "lo-tek:/")

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
        assertEquals(emptyList<String>(), differences(html, right), "a correct page")
        val mistakes = mapOf(
            "the label points at another field" to (""" for="c">""" to """ for="c-help">""") to "for=",
            "the label names its field twice" to (""" for="c">""" to """ for="c c">""") to "for=",
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
            val found = differences(html, right.replace(from, to))
            assertTrue(found.any { mistake in it }, "$name: expected a difference with \"$mistake\", got $found")
        }
    }

    private fun exemption(marker: String) = Exemption("page", marker, "the server does it", failed = {}, passed = {})

    @Test
    fun `an exemption leaves out the one script its marker names, and only when it does a server's job`() {
        val validation = """<script type="module">// Stands in for the server
            document.querySelector("form").addEventListener("submit", (e) => { if (!valid()) e.preventDefault() })</script>"""
        val opener = """<script type="module">document.getElementById("open").addEventListener("click", () => dialog.showModal())</script>"""
        val form = """<form action="/jobs" method="post"><input id="fixer"></form>"""
        val html = "$form\n$validation\n$opener"
        val withOpener = "<html><body>$form$opener</body></html>"
        // The validation is left out, the opener is still compared.
        assertEquals(emptyList<String>(), differences(html, withOpener, listOf(exemption("valid()"))))
        // Without the entry the validation must be there.
        assertTrue(differences(html, withOpener).any { "the scripts differ" in it }, "no entry")
        // The needed script on the same page cannot go missing.
        assertTrue(differences(html, "<html><body>$form</body></html>", listOf(exemption("valid()"))).any { "the scripts differ" in it }, "the opener dropped")
        // An entry for a script that does no server's job: the dialog's opener.
        assertTrue(differences(html, "<html><body>$form</body></html>", listOf(exemption("showModal()"))).any { "does no server's job" in it }, "the dialog case")
        // A marker that names no script, or two.
        assertTrue(differences(html, withOpener, listOf(exemption("gone()"))).any { "names 0 scripts" in it }, "a stale marker")
        assertTrue(differences(html, withOpener, listOf(exemption("addEventListener"))).any { "names 2 scripts" in it }, "a marker on two scripts")
        // A marker found only in a comment names nothing.
        assertTrue(differences(html, withOpener, listOf(exemption("Stands in for the server"))).any { "names 0 scripts" in it }, "a marker in a comment")
        // A Kotlin copy of the exempted script fails, and says why it was left out.
        val copied = "<html><body>$form$validation$opener</body></html>"
        val found = differences(html, copied, listOf(exemption("valid()")))
        assertTrue(found.any { "is left out because the server does it" in it }, "the reason in the message: $found")
    }

    @Test
    fun `a Kotlin script never does the server's job, however it is written`() {
        val takeovers = listOf(
            """form.addEventListener("submit", go)""",
            """form.addEventListener('submit', go)""",
            "form.addEventListener(`submit`, go)",
            """form.onsubmit = go""",
            """form.requestSubmit()""",
            """fetch(form.action, { method: "POST", body: new FormData(form) })""",
            """list.innerHTML = "<li>x</li>"""",
            """list.innerHTML += "<li>x</li>"""",
            """box.outerHTML = "<div></div>"""",
            """list.insertAdjacentHTML("beforeend", "<li>x</li>")""",
            """box.setHTMLUnsafe("<p>x</p>")""",
            """document.write("<p>x</p>")""",
        )
        for (script in takeovers) {
            val page = """<script type="module">$script</script>"""
            val found = differences(page, "<html><body>$page</body></html>")
            assertTrue(found.any { "a script in the Kotlin recipe" in it }, "$script: $found")
        }
        val harmless = listOf(
            """if (list.innerHTML === "") go()""",
            """// form.addEventListener("submit", go) is what the page does without a server
               go()""",
            """/* list.innerHTML = "" */ go()""",
            """toggle.addEventListener("click", (event) => { if (saving) event.preventDefault() })""",
        )
        for (script in harmless) {
            val page = """<script type="module">$script</script>"""
            assertEquals(emptyList<String>(), differences(page, "<html><body>$page</body></html>"), script)
        }
    }

    @Test
    fun `a web component that only wires may be left out, and a Kotlin script through it is broken`() {
        val html = """
            <lt-field><label class="lt-label" for="codename">Codename</label><input class="lt-input" id="codename"></lt-field>
            <script type="module">document.querySelector("form").addEventListener("submit", () => document.querySelector("input").closest("lt-field"))</script>
        """.trimIndent()
        val page = """<html><body><label class="lt-label" for="c">Codename</label><input class="lt-input" id="c"></body></html>"""
        assertEquals(emptyList<String>(), differences(html, page, listOf(exemption("closest("))))
        // A script in the Kotlin recipe that names the left-out component is broken.
        val broken = page.replace("</body>", """<script type="module">document.querySelector("input").closest("lt-field")</script></body>""")
        assertTrue(differences(html, broken, listOf(exemption("closest("))).any { "names lt-field" in it }, "a Kotlin script through a left-out component")
        // Without an entry, a script through the component is compared like any other.
        assertTrue(differences(html, page).any { "the scripts differ" in it }, "no entry")
        // A module of the package from the CDN and from the WebJar is one file.
        val cdn = """<script type="module">import { a } from "https://cdn.jsdelivr.net/npm/@lo-tek/interfaces@VERSION/dist/x.js"; a()</script>"""
        val webJar = """<html><body><script type="module">import { a } from "${LotekWebJar.ROOT}/dist/x.js"; a()</script></body></html>"""
        assertEquals(emptyList<String>(), differences(cdn, webJar))
        // Another library with the same path after `dist/` is another file.
        val otherLibrary = webJar.replace(LotekWebJar.ROOT, "/webjars/other/1.0")
        assertTrue(differences(cdn, otherLibrary).any { "the scripts differ" in it }, "another library with the same dist path")
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
        val failures = mutableListOf<String>()
        for (recipe in recipes) {
            val expected = javaClass.getResource("/recipes/${recipe.page}.html")?.readText()
                ?: fail("${recipe.page}: the HTML recipe was not extracted")
            val page = createHTML().html {
                head { title(recipe.page) }
                body { recipe.render(this) }
            }
            val problems = differences(expected, page, SERVER_DOES_IT.filter { it.page == recipe.page })
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
        val unknown = (PARTS_ON_THEIR_OWN + SERVER_DOES_IT.map { it.page }) - recipes.map { it.page }.toSet()
        if (unknown.isNotEmpty()) failures.add("$unknown are listed as exceptions, and no page has that recipe")
        if (failures.isNotEmpty()) fail(failures.joinToString("\n\n"))
        // The expected number comes from the pages, not from the list the loop went through.
        assertTrue(compared > 0 && compared == pagesWithKotlin.size, "compared $compared recipes, and ${pagesWithKotlin.size} pages have a kotlinx.html tab")
        println("Compared $compared Kotlin recipes with their HTML recipes.")
    }

    /**
     * The pages in [SERVER_DOES_IT] leave a script out because the server
     * does its job, so the server's answers are rendered and checked: the
     * failed one must show the errors as a server would, wired, and the valid
     * one must show none. Without this, "the server does it" was a claim:
     * the recipes were only ever rendered with their defaults, where nothing
     * has failed.
     */
    @Test
    fun `the server renders what the left-out scripts did`() {
        val failures = mutableListOf<String>()
        for (exemption in SERVER_DOES_IT) {
            val failed = createHTML().html { head { title(exemption.page) }; body { exemption.failed(this) } }
            val (problems, rules) = serverAnswer(failed, exemption)
            if (rules == 0) problems.add("no rule applied to the failed answer, so it shows no error the check knows")
            for (p in problems) failures.add("${exemption.page}, the failed answer: $p")
            runCatching { assertLotek(failed) }.exceptionOrNull()?.let { failures.add("${exemption.page}, the failed answer: ${it.message}") }
            val passed = createHTML().html { head { title(exemption.page) }; body { exemption.passed(this) } }
            for (p in stillFailing(passed)) failures.add("${exemption.page}, the valid answer: $p")
            runCatching { assertLotek(passed) }.exceptionOrNull()?.let { failures.add("${exemption.page}, the valid answer: ${it.message}") }
        }
        assertTrue(SERVER_DOES_IT.isNotEmpty(), "SERVER_DOES_IT is empty, so this checks nothing")
        if (failures.isNotEmpty()) fail(failures.joinToString("\n"))
    }

    /**
     * The rules a failed answer is held to, keyed to what it contains, and
     * how many of them applied. An error summary must be visible, named by a
     * heading with text, and have links to fields that exist and are marked
     * invalid; a visible error text must describe a control marked invalid;
     * what the entry says must be echoed, is.
     */
    internal fun serverAnswer(html: String, exemption: Exemption): Pair<MutableList<String>, Int> {
        val problems = mutableListOf<String>()
        var rules = 0
        val doc = Jsoup.parse(html)
        for (box in doc.getElementsByTag("lt-error-summary")) {
            rules += 1
            if (box.hasAttr("hidden")) problems.add("the error summary is hidden")
            val title = box.attr("aria-labelledby").takeIf { it.isNotBlank() }?.let { doc.getElementById(it) }
            if (title == null || title.text().isBlank()) problems.add("the error summary is not named by a heading with text")
            val links = box.select("li a[href^=#]")
            if (links.isEmpty()) problems.add("the error summary has no links to the fields")
            if (exemption.links != null && links.size != exemption.links) problems.add("the error summary has ${links.size} links, and the answer has ${exemption.links} faults")
            for (link in links) {
                val target = doc.getElementById(link.attr("href").drop(1))
                if (target == null) problems.add("the link ${link.attr("href")} points at no element")
                else if (target.attr("aria-invalid") != "true") problems.add("the link ${link.attr("href")} points at a field that is not marked invalid")
            }
        }
        for (error in doc.select(".lt-error-text:not([hidden])")) {
            rules += 1
            val id = error.id()
            val described = doc.select("[aria-invalid=true]").any { id.isNotEmpty() && id in it.attr("aria-describedby").split(WHITESPACE) }
            if (!described) problems.add("the visible error text \"${error.text()}\" describes no control marked invalid")
        }
        for ((name, value) in exemption.echo) {
            rules += 1
            val field = doc.selectFirst("[name=$name]")
            if (field?.attr("value") != value) problems.add("the field $name has the value \"${field?.attr("value")}\", and the user typed \"$value\"")
        }
        return problems to rules
    }

    /** What still shows an error in an answer that should show none. */
    internal fun stillFailing(html: String): List<String> {
        val doc = Jsoup.parse(html)
        return doc.select("lt-error-summary:not([hidden])").map { "the error summary is visible" } +
            doc.select(".lt-error-text:not([hidden])").map { "the error text \"${it.text()}\" is visible" } +
            doc.select("[aria-invalid=true]").map { "<${it.tagName()}> is marked invalid" }
    }

    @Test
    fun `the check of the server's answer fails each kind of mistake`() {
        val right = """
            <html><body>
            <lt-error-summary aria-labelledby="t"><h2 id="t">The form has one error</h2><ul><li><a href="#fixer">Enter the address</a></li></ul></lt-error-summary>
            <input id="fixer" name="fixer" value="nobody" aria-invalid="true" aria-describedby="fixer-error">
            <p class="lt-error-text" id="fixer-error">Enter the address</p>
            </body></html>
        """.trimIndent()
        val entry = Exemption("page", "x", "y", failed = {}, passed = {}, echo = mapOf("fixer" to "nobody"), links = 1)
        assertEquals(emptyList<String>() to 3, serverAnswer(right, entry).let { it.first.toList() to it.second })
        val mistakes = mapOf(
            "the box is hidden" to ("""<lt-error-summary aria-labelledby="t">""" to """<lt-error-summary aria-labelledby="t" hidden>""") to "is hidden",
            "an empty heading" to (""">The form has one error<""" to """><""") to "not named by a heading",
            "a link to nothing" to ("""href="#fixer"""" to """href="#Enter the address"""") to "points at no element",
            "a field not marked invalid" to (""" aria-invalid="true" aria-describedby""" to """ aria-describedby""") to "not marked invalid",
            "a fault dropped" to ("""<li><a href="#fixer">Enter the address</a></li>""" to "") to "has 0 links",
            "the error text not wired" to ("""aria-describedby="fixer-error"""" to """aria-describedby="other"""") to "describes no control",
            "what was typed is lost" to ("""value="nobody"""" to """value=""""") to "the user typed",
        )
        for ((case, mistake) in mistakes) {
            val (name, edit) = case
            val (from, to) = edit
            assertTrue(from in right, "the case \"$name\" edits nothing")
            val found = serverAnswer(right.replace(from, to), entry).first
            assertTrue(found.any { mistake in it }, "$name: expected \"$mistake\", got $found")
        }
        // An answer with no error the check knows applies no rule.
        assertEquals(0, serverAnswer("<html><body><p>Thanks</p></body></html>", Exemption("page", "x", "y", {}, {})).second)
        assertEquals(emptyList<String>(), stillFailing("<html><body><lt-error-summary hidden></lt-error-summary><p class=\"lt-error-text\" hidden>x</p></body></html>"))
        assertEquals(3, stillFailing(right).size)
    }

    /**
     * The page template in each kotlinx.html tab, with the stylesheet and
     * `defineLt()`, is rendered too, and may have no script but the
     * registration: a script moved there would otherwise escape every rule
     * above.
     */
    @Test
    fun `the page templates have no script but the registration`() {
        var rendered = 0
        val failures = mutableListOf<String>()
        for (recipe in recipes) {
            // The template calls the recipe, whose scripts the comparison above
            // has already held to the HTML recipe; only the template's own count.
            val own = Jsoup.parse(createHTML().html { body { recipe.render(this) } }).getElementsByTag("script").map { it.outerHtml() }
            for (template in recipe.templates) {
                val page = createHTML().html { template() }
                for (script in Jsoup.parse(page).getElementsByTag("script").filterNot { it.outerHtml() in own }) {
                    if (script.attr("src").isNotEmpty() || !isRegistration(script.data())) {
                        failures.add("${recipe.page}: the page template has a script that does more than register: ${script.outerHtml().take(120)}")
                    }
                }
                rendered += 1
            }
        }
        // Counted from the pages, not from the list the loop went through:
        // every kotlinx.html tab has its page template.
        val tabs = File(System.getProperty("pages")).listFiles { f -> f.name.endsWith(".mdx") }.orEmpty()
            .count { Regex("""<TabItem\b[^>]*label="kotlinx\.html"""").containsMatchIn(it.readText()) }
        val withTemplate = recipes.count { it.templates.isNotEmpty() }
        if (failures.isNotEmpty()) fail(failures.joinToString("\n"))
        assertTrue(rendered > 0 && withTemplate == tabs, "rendered $rendered page templates, $withTemplate recipes have one, and $tabs pages have a kotlinx.html tab")
        println("Rendered $rendered page templates.")
    }

    /**
     * What differs between an HTML recipe and the page a Kotlin recipe
     * renders, one line per difference. Empty when they agree. [exemptions]
     * are the page's entries in [SERVER_DOES_IT]. The test of every page calls
     * it, and the tests of the comparison give it one known mistake at a
     * time, so a rule that stops working, or is deleted in a rewrite, fails
     * there.
     */
    internal fun differences(expected: String, page: String, exemptions: List<Exemption> = emptyList()): List<String> {
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
                // A set of ids on `<output>`, one id on `<label>`: the order means
                // nothing, a repeated id does.
                p.name == "for" -> if (gotIds.sorted() != wantedIds.sorted()) {
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
        // the package compared by its path, see [packageRoot]. The code without
        // comments is what [SERVERS_JOB] and the markers read.
        fun scripts(e: Element) =
            e.getElementsByTag("script")
                .filterNot { isRegistration(it.data()) }
                .map { ScriptText(it.attr("type"), packageRoot(it.attr("src")), packageRoot(it.data()).replace(WHITESPACE, " ").trim(), code(packageRoot(it.data()))) }
                .filter { it.src.isNotEmpty() || it.text.isNotEmpty() }
        val htmlScripts = scripts(wanted)
        val kotlinScripts = scripts(rendered)
        // An exemption leaves out the one HTML script its marker names, and
        // only when that script does a server's job. A marker that names no
        // script or several, or a script that does no server's job, is an entry
        // that switches the comparison off for nothing.
        val exempted = mutableListOf<ScriptText>()
        for (exemption in exemptions) {
            val named = htmlScripts.filter { exemption.marker in it.code }
            when {
                named.size != 1 -> problems.add("the exemption \"${exemption.marker}\" on ${exemption.page} names ${named.size} scripts in the HTML recipe, not one")
                serversJob(named.single().code).isEmpty() -> problems.add("the script \"${exemption.marker}\" on ${exemption.page} does no server's job, so the Kotlin recipe must have it: take it out of SERVER_DOES_IT")
                else -> exempted += named.single()
            }
        }
        // In the Kotlin recipe a script that names a web component it leaves
        // out (see [WIRING_ONLY]) is broken, since the element is not there.
        for (script in kotlinScripts) {
            if (removed.any { tag -> Regex("""["']${Regex.escape(tag)}["']""").containsMatchIn(script.code) }) {
                problems.add("a script in the Kotlin recipe names ${removed.joinToString(", ")}, which the Kotlin recipe leaves out: ${script.text.take(80)}")
            }
            for (why in serversJob(script.code)) problems.add("a script in the Kotlin recipe $why: ${script.text.take(80)}")
        }
        val compared = htmlScripts - exempted.toSet()
        if (compared != kotlinScripts) {
            val copied = exemptions.filter { e -> kotlinScripts.any { e.marker in it.code } }
            val why = copied.joinToString("") { "\n  The HTML script \"${it.marker}\" is left out because ${it.reason}." }
            problems.add("the scripts differ from the HTML recipe's:\n    ${kotlinScripts.map { it.text }}\n  against\n    ${compared.map { it.text }}$why")
        }
        return problems
    }

    /** A script as the comparison reads it. Equal when the type, the source and the text are. */
    internal data class ScriptText(val type: String, val src: String, val text: String, val code: String) {
        override fun equals(other: Any?) = other is ScriptText && type == other.type && src == other.src && text == other.text
        override fun hashCode() = listOf(type, src, text).hashCode()
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
