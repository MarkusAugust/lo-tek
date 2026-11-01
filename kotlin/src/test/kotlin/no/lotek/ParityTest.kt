package no.lotek

import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.MethodSource

/**
 * That the core answers the same on the JVM as in Node and the browser.
 *
 * It is the same WebAssembly module, so what is tested here is what
 * surrounds it: Chicory, the UTF-16 positions, the JSON and the fields of
 * `Finding`. The expected results in `core/parity/`, one `.json` per
 * `.html`, are the same ones `core/scripts/check-core.ts` requires of the
 * module in Bun, and that check also requires the fixtures together to
 * trigger every rule in `core/src/types.rs`. A fixture with a `.css` next to
 * it is also tested with the stylesheet, like [Lotek.diagnoseRendered]. If
 * one character in one message or one position differs, the test fails.
 *
 * The script that reads the rendered page, [Lotek.READ_RENDERED_PAGE], is
 * not tested here, but by `interfaces/scripts/check-rendered.ts`, which
 * runs it in a real browser next to the TypeScript version.
 */
class ParityTest {
    @ParameterizedTest(name = "{0}")
    @MethodSource("fixtures")
    fun `answers the same as TypeScript`(name: String) {
        val html = File(DIR, "$name.html").readText()
        val expected = Json.parse(File(DIR, "$name.json").readText()) as Map<*, *>

        assertEquals(expected["markup"], toJson(Lotek.diagnoseMarkup(html)), "diagnoseMarkup")
        assertEquals(expected["page"], toJson(Lotek.diagnosePage(html)), "diagnosePage")
        val css = File(DIR, "$name.css")
        assertEquals(css.exists(), expected.containsKey("styled"), "styled in the expected results and a .css next to it go together")
        if (css.exists()) {
            val rendered = mapOf("html" to html, "css" to listOf(css.readText()))
            assertEquals(expected["styled"], toJson(Lotek.diagnoseRendered(rendered)), "diagnoseRendered")
        }
    }

    @org.junit.jupiter.api.Test
    fun `the positions point to the right text in a Kotlin string`() {
        val html = File(DIR, "09-non-ascii-characters.html").readText()
        val finding = Lotek.diagnoseMarkup(html).single()
        assertEquals("data-variant=\"secondäry\"", html.substring(finding.start, finding.end))
    }

    @org.junit.jupiter.api.Test
    fun `assertLotek fails with the findings as the message`() {
        assertLotek("""<button class="lt-button">Save</button>""")
        val error = kotlin.test.assertFailsWith<AssertionError> {
            assertLotek("""<button class="lt-buton">Save</button>""", fragment = true)
        }
        assertEquals(
            "LO-TEK found one finding:\n1:16: warning: ${Lotek.diagnoseMarkup("<button class=\"lt-buton\">").single().message} [unknown-class]",
            error.message,
        )
    }

    /*
     * The findings in the shape the expected results have. Rule, line and
     * column exist only in the core, not in the expected results from
     * TypeScript, and `fix` and `preferred` are left out when they are
     * missing, as in TypeScript.
     */
    private fun toJson(findings: List<Finding>): List<Map<String, Any>> =
        findings.map { f ->
            buildMap {
                put("start", f.start.toDouble())
                put("end", f.end.toDouble())
                put("message", f.message)
                put("severity", f.severity)
                put("link", f.link)
                f.fix?.let { fix ->
                    put(
                        "fix",
                        buildMap {
                            put("title", fix.title)
                            put(
                                "edits",
                                fix.edits.map { e ->
                                    mapOf("start" to e.start.toDouble(), "end" to e.end.toDouble(), "text" to e.text)
                                },
                            )
                            fix.preferred?.let { put("preferred", it) }
                        },
                    )
                }
            }
        }

    companion object {
        private val DIR = File(System.getProperty("parity"))

        @JvmStatic
        fun fixtures(): List<String> {
            val names = DIR.listFiles { f -> f.name.endsWith(".html") }!!.map { it.nameWithoutExtension }.sorted()
            assertTrue(names.isNotEmpty(), "No fixtures in $DIR")
            return names
        }
    }
}
