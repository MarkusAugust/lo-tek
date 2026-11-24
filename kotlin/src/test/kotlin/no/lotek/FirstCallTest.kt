package no.lotek

import java.io.File
import java.util.concurrent.TimeUnit
import kotlin.test.assertEquals
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource

/**
 * That every operation answers when it is the first thing the JVM does with
 * LO-TEK.
 *
 * The core carries no data: the package gives it the manifest and the colour
 * contract, each the first time an operation needs it. An operation that is
 * not told it needs one works in every other test, where something has run
 * before it and left a core with the data in the pool, and fails for the
 * one who calls only that operation. In the npm package `checkRecipe` did
 * exactly that, with every check green.
 *
 * A test class does not isolate this: the classes share one JVM, and the
 * order is not ours. So each operation runs in a JVM of its own, started
 * here with this JVM's classpath, where [FirstCall] calls that one
 * operation and nothing else of [Lotek] before it.
 */
class FirstCallTest {
    @ParameterizedTest(name = "{0}")
    @ValueSource(strings = ["checkRecipe", "recipeValues", "recipeBrands", "buildTheme", "inspectTheme", "diagnoseMarkup", "diagnosePage", "diagnoseRendered"])
    fun `answers as the first call in a JVM of its own`(operation: String) {
        val java = File(System.getProperty("java.home"), "bin/java").path
        val process =
            ProcessBuilder(java, "-cp", System.getProperty("java.class.path"), "no.lotek.FirstCall", operation)
                .redirectErrorStream(true)
                .start()
        val output = process.inputStream.bufferedReader().readText()
        check(process.waitFor(120, TimeUnit.SECONDS)) { "$operation did not finish" }
        assertEquals(0, process.exitValue(), "$operation as the first call:\n$output")
        assertEquals("answered", output.trim().lines().last(), "$operation as the first call:\n$output")
    }
}

/** One operation, and nothing before it. Run in a JVM of its own by [FirstCallTest]. */
object FirstCall {
    private const val PAGE = """<!doctype html><html lang="en"><head><title>t</title></head><body><button class="lt-buton">Send</button></body></html>"""

    @JvmStatic
    fun main(args: Array<String>) {
        val answered =
            when (args.single()) {
                "checkRecipe" -> Lotek.checkRecipe("""{"accent": "purple"}""").any { it.kind == "refused" }
                "recipeValues" -> Lotek.recipeValues("""{"accent": "#7c3aed"}""").map { it.text } == listOf("#7c3aed")
                "recipeBrands" -> Lotek.recipeBrands("""{"accent": "#7c3aed", "danger": "purple"}""").map { it.family } == listOf("accent")
                "buildTheme" -> Lotek.buildTheme("""{"accent": "#7c3aed"}""").css.contains("lotek-theme")
                "inspectTheme" -> Lotek.inspectTheme(":root { --lt-color-accent-text: #ffffff; }").let { it.blocks == 1 && it.verdict.kind == "broken" }
                "diagnoseMarkup" -> Lotek.diagnoseMarkup("""<button class="lt-buton">Send</button>""").size == 1
                "diagnosePage" -> Lotek.diagnosePage(PAGE).isNotEmpty()
                "diagnoseRendered" -> Lotek.diagnoseRendered(mapOf("html" to PAGE, "css" to emptyList<String>())).isNotEmpty()
                else -> error("no such operation: ${args.single()}")
            }
        check(answered) { "${args.single()} answered something else than expected" }
        println("answered")
    }
}
