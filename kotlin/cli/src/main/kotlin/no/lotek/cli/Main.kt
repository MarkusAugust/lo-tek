/**
 * `java -jar lotek.jar`: the command line from the terminal. The run itself is
 * in [CommandLine].
 */
package no.lotek.cli

import java.io.File
import java.nio.file.Files
import java.nio.file.Path
import kotlin.system.exitProcess

/**
 * Whether the command line runs from a terminal.
 *
 * Java 21 has a console only when both input and output are a terminal, and
 * that is enough to show the hint to whoever typed the command without files.
 * From Java 22 it always has one, and `isTerminal()` answers instead.
 */
private fun interactive(): Boolean {
    val console = System.console() ?: return false
    return try {
        console.javaClass.getMethod("isTerminal").invoke(console) as Boolean
    } catch (missing: NoSuchMethodException) {
        true
    }
}

/**
 * The arguments as they were written.
 *
 * The JVM reads the arguments with the character set of the locale, and
 * without one (`LANG` empty, as in many containers) `--font=Söhne` becomes
 * `--font=S??hne`. On Linux the raw bytes are in `/proc/self/cmdline`, and are
 * read from there as UTF-8 when the character set is another.
 */
private fun asWritten(args: Array<String>): List<String> {
    val encoding = System.getProperty("sun.jnu.encoding") ?: return args.toList()
    if (Charsets.UTF_8.aliases().plus("UTF-8").any { it.equals(encoding, ignoreCase = true) }) return args.toList()
    val charset = runCatching { java.nio.charset.Charset.forName(encoding) }.getOrNull() ?: return args.toList()
    val raw = try {
        Files.readAllBytes(Path.of("/proc/self/cmdline"))
    } catch (unavailable: Exception) {
        return args.toList()
    }
    return fromCommandLine(raw, args.toList(), charset)
}

/**
 * The arguments from `/proc/self/cmdline`, read as UTF-8, when they are the
 * same as the JVM got, only read with another character set. Otherwise the
 * arguments as the JVM read them.
 *
 * The program's arguments come last, after `java` and the JVM's flags, but
 * not always: with an `@argfile` they are in the file, and not in `cmdline`.
 * Each argument is therefore compared with what the JVM read before it is
 * used.
 */
internal fun fromCommandLine(raw: ByteArray, args: List<String>, charset: java.nio.charset.Charset): List<String> {
    // Every argument ends with a null byte, the last one too.
    val parts = mutableListOf<ByteArray>()
    var start = 0
    for (i in raw.indices) {
        if (raw[i] == 0.toByte()) {
            parts += raw.copyOfRange(start, i)
            start = i + 1
        }
    }
    if (start < raw.size) parts += raw.copyOfRange(start, raw.size)
    if (parts.size < args.size) return args
    val tail = parts.takeLast(args.size)
    val same = tail.zip(args).all { (bytes, arg) -> String(bytes, charset) == arg }
    return if (same) tail.map { String(it, Charsets.UTF_8) } else args
}

fun main(arguments: Array<String>) {
    val code = CommandLine.run(asWritten(arguments), File(""), System.`in`, System.out, System.err, interactive())
    exitProcess(code)
}
