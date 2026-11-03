package no.lotek.build

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
        input.writeText(json(literals))
        val script = """
            const literals = JSON.parse(await Bun.file(process.argv[1]).text())
            const cooked = literals.map((literal) => {
              try { return new Function("return `" + literal + "`")() } catch { return null }
            })
            process.stdout.write(JSON.stringify(cooked))
        """.trimIndent()
        val process = ProcessBuilder("bun", "-e", script, input.path).redirectErrorStream(true).start()
        val output = process.inputStream.bufferedReader().readText()
        if (process.waitFor() != 0) fail("bun gave ${process.exitValue()}: $output")
        return parse(output).also { assertEquals(literals.size, it.size, "bun answered $output") }
    }

    private fun json(strings: List<String>): String = strings.joinToString(",", "[", "]") { s ->
        "\"" + s.map { c -> if (c == '"' || c == '\\' || c < ' ' || c in "  ") "\\u%04x".format(c.code) else c.toString() }.joinToString("") + "\""
    }

    /** Reads the array of strings and nulls `JSON.stringify` writes. */
    private fun parse(text: String): List<String?> {
        val out = mutableListOf<String?>()
        var i = text.indexOf('[') + 1
        while (i < text.length && text[i] != ']') {
            when (text[i]) {
                ',' -> i++
                'n' -> { out += null; i += 4 }
                '"' -> {
                    val value = StringBuilder()
                    i++
                    while (text[i] != '"') {
                        if (text[i] == '\\') {
                            when (val e = text[i + 1]) {
                                'u' -> { value.append(text.substring(i + 2, i + 6).toInt(16).toChar()); i += 6 }
                                'n' -> { value.append('\n'); i += 2 }
                                't' -> { value.append('\t'); i += 2 }
                                'r' -> { value.append('\r'); i += 2 }
                                'b' -> { value.append('\b'); i += 2 }
                                'f' -> { value.append('\u000C'); i += 2 }
                                else -> { value.append(e); i += 2 }
                            }
                        } else value.append(text[i++])
                    }
                    out += value.toString()
                    i++
                }
                else -> error("unexpected ${text[i]} in $text")
            }
        }
        return out
    }
}
