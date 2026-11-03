package no.lotek.build

import groovy.json.JsonOutput
import groovy.json.JsonSlurper
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.fail

/**
 * `cooked()` against JavaScript itself: every case is also evaluated as a
 * template literal by Bun, and the two must give the same text, or both
 * refuse it. A hand-written answer would only test what the author believed
 * about the escapes.
 */
class TemplateLiteralTest {
    /** The text between the backticks, as it stands in an mdx file. */
    private val cases = listOf(
        "plain text",
        "<p class=\"lt-text\">two\nlines</p>",
        "a\\nb\\tc\\rd\\be\\ff\\vg",
        "\\0 and \\` and \\\\ and \\$",
        "\\u00e5 \\u{1F600} \\u{10FFFF} \\x41\\xe5",
        "a line\\\ncontinued",
        "crlf\r\nand lone\rcr",
        "after a backslash\\\r\nand \\\rhere",
        "\\u2028\\u2029 and a backslash before them: \\ \\ ",
        "\\q \\' \\\" unknown escapes keep the character",
        "$ alone, \\\${escaped} and $ {spaced}",
        // Each of these is a SyntaxError in a template literal, so the page could not build.
        "\\01",
        "\\1",
        "\\9",
        "\\x4",
        "\\xg0",
        "\\u00e",
        "\\u{}",
        "\\u{110000}",
        "\\u{41",
        "\\u{ZZ}",
        // Java reads these as digits, JavaScript does not.
        "\\x\u0664\u0661",
        "\\u\uFF10\uFF10\uFF14\uFF11",
        "a trailing backslash \\",
    )

    @Test
    fun `cooked reads a template literal as JavaScript does`() {
        val javascript = evaluatedByBun(cases)
        var compared = 0
        for ((literal, expected) in cases.zip(javascript)) {
            val actual = runCatching { cooked(literal) }
            if (expected == null) {
                if (actual.isSuccess) fail("JavaScript refuses `$literal`, and cooked() gave \"${actual.getOrNull()}\"")
            } else {
                assertEquals(expected, actual.getOrElse { fail("cooked() refused `$literal`, which JavaScript reads as \"$expected\": ${it.message}") }, "`$literal`")
            }
            compared++
        }
        assertEquals(cases.size, compared)
        assert(compared > 0)
    }

    @Test
    fun `an interpolation is refused, and an escaped one is text`() {
        assertNull(cooked("before \${name} after"))
        assertNull(cooked("\${a}"))
        assertEquals("\${a}", cooked("\\\${a}"))
        assertFailsWith<IllegalArgumentException> { cooked("\\0" + "1") }
    }

    /** Each literal evaluated in Bun; `null` where it is a SyntaxError. */
    private fun evaluatedByBun(literals: List<String>): List<String?> {
        val input = File.createTempFile("literals", ".json").apply { deleteOnExit() }
        input.writeText(JsonOutput.toJson(literals))
        val script = """
            const literals = JSON.parse(await Bun.file(process.argv[1]).text())
            const cooked = literals.map((literal) => {
              try { return new Function("return `" + literal + "`")() } catch { return null }
            })
            process.stdout.write(JSON.stringify(cooked))
        """.trimIndent()
        // JavaScript is the reference, so Bun is required, as it is in the CI job.
        val process = try {
            ProcessBuilder("bun", "-e", script, input.path).redirectErrorStream(true).start()
        } catch (e: java.io.IOException) {
            fail("The test reads the literals as JavaScript does, through Bun, and found no bun on PATH: ${e.message}")
        }
        val output = process.inputStream.bufferedReader().readText()
        if (process.waitFor() != 0) fail("bun gave ${process.exitValue()}: $output")
        @Suppress("UNCHECKED_CAST")
        return (JsonSlurper().parseText(output) as List<String?>).also { assertEquals(literals.size, it.size, "bun answered $output") }
    }
}
