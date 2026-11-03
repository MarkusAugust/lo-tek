package no.lotek.build

/**
 * The text of a JavaScript template literal, as the page renders it: the
 * escapes resolved, `\n`, `\u00e5` and a backslash before a line break
 * included. `null` when it has an interpolation, `${…}` not escaped,
 * which the test cannot resolve.
 */
internal fun cooked(literal: String): String? {
    // A template literal reads CRLF and a lone CR as LF, also after a backslash.
    val text = literal.replace("\r\n", "\n").replace('\r', '\n')
    val out = StringBuilder()
    var i = 0
    fun hex(from: Int, length: Int): Int {
        val digits = text.substring(from, (from + length).coerceAtMost(text.length))
        require(digits.length == length && digits.all { it in '0'..'9' || it.lowercaseChar() in 'a'..'f' }) {
            "A \\x or \\u escape in a template literal needs $length hex digits, and has \"$digits\""
        }
        return digits.toInt(16)
    }
    while (i < text.length) {
        val c = text[i]
        if (c == '$' && text.getOrNull(i + 1) == '{') return null
        if (c != '\\') {
            out.append(c)
            i++
            continue
        }
        val next = text.getOrNull(i + 1) ?: error("A backslash at the end of a template literal escapes the closing backtick, a SyntaxError")
        i += 2
        when (next) {
            'n' -> out.append('\n')
            't' -> out.append('\t')
            'r' -> out.append('\r')
            'b' -> out.append('\b')
            'f' -> out.append('\u000C')
            'v' -> out.append('\u000B')
            // `\0` only when no digit follows; `\01` and `\1` to `\9` are a
            // SyntaxError in a template literal, so the page could not build.
            '0' -> {
                require(text.getOrNull(i) !in '0'..'9') { "\\0 followed by a digit is a SyntaxError in a template literal" }
                out.append('\u0000')
            }
            in '1'..'9' -> error("\\$next is a SyntaxError in a template literal")
            '\n', '\u2028', '\u2029' -> {}
            'x' -> { out.append(hex(i, 2).toChar()); i += 2 }
            'u' -> if (text.getOrNull(i) == '{') {
                val end = text.indexOf('}', i)
                require(end > i + 1) { "A \\u{…} escape in a template literal is not closed" }
                val point = hex(i + 1, end - i - 1)
                require(point <= 0x10FFFF) { "\\u{${text.substring(i + 1, end)}} is past the last code point, a SyntaxError in a template literal" }
                out.appendCodePoint(point); i = end + 1
            } else {
                out.append(hex(i, 4).toChar()); i += 4
            }
            else -> out.append(next)
        }
    }
    return out.toString()
}
