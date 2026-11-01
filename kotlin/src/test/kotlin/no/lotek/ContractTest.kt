package no.lotek

import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.MethodSource

/**
 * That every builder function in Kotlin returns what `lt` in TypeScript returns.
 *
 * The build cases in `interfaces/manifest/build-cases.json` are written by
 * `generate-manifest.ts`: every option alone, and the combinations of them,
 * with the result from TypeScript. Both the generated and the handwritten
 * builder functions are tested against all of them.
 */
class ContractTest {
    @ParameterizedTest(name = "{0}")
    @MethodSource("builders")
    fun `returns the same as TypeScript`(builder: String) {
        val cases = CASES.filter { it["builder"] == builder }
        assertTrue(cases.isNotEmpty(), "No build cases for $builder")
        for (case in cases) {
            val options = case["options"] as Map<String, Any?>
            // TypeScript threw on this case, like an empty key. Kotlin must too.
            if (case.containsKey("throws")) {
                val error = assertFailsWith<IllegalArgumentException>("$builder($options) should have thrown: ${case["throws"]}") {
                    Dispatch.call(builder, options)
                }
                // The message is the same after the name, which is `lt.tabs()` in TypeScript and `Lt.tabs` here.
                assertEquals(
                    (case["throws"] as String).substringAfter(": "),
                    error.message?.substringAfter(": "),
                    "$builder($options) threw with a different message",
                )
                continue
            }
            assertEquals(normalize(case["expected"]), normalize(Dispatch.call(builder, options)), "$builder($options)")
        }
    }

    @Test
    fun `every builder function has build cases`() {
        assertEquals(Dispatch.names.sorted(), CASES.map { it["builder"] as String }.distinct().sorted())
    }

    @Test
    fun `the class constants are the ones in the manifest`() {
        // `lt.card.title` and the like: a string on the function in TypeScript, a
        // set with the class here, with the same names on `Lt`.
        val expected = Lotek.manifest.builders.filter { it.classes.isNotEmpty() }.associate { it.name to it.classes }
        assertTrue(expected.isNotEmpty(), "No builder function has class constants, so the comparison said nothing.")
        assertEquals(expected.keys, Dispatch.classes.keys)
        for ((builder, classes) in expected) {
            assertEquals(
                classes.mapValues { (_, className) -> Attributes(mapOf("class" to className)) },
                Dispatch.classes.getValue(builder),
                builder,
            )
        }
    }

    @Test
    fun `the attributes are written as HTML`() {
        val field = Lt.field(id = "email", invalid = true, error = true)
        assertEquals("""id="email-error"""", field.error.toHtml())
        assertEquals("""class="lt-label" for="email"""", field.label.toHtml())
        assertEquals(
            """class="lt-button" data-variant="secondary" title="a &amp; &quot;b&quot;"""",
            (Lt.button(variant = ButtonVariant.SECONDARY) + mapOf("title" to "a & \"b\"")).toHtml(),
        )
        assertEquals("hidden", Attributes(mapOf("hidden" to "")).toHtml())
    }

    @Test
    fun `numbers are written as in JavaScript`() {
        assertEquals("3", jsNumber(3))
        assertEquals("3", jsNumber(3.0))
        assertEquals("0.5", jsNumber(0.5))
        assertEquals("-2", jsNumber(-2))
        assertEquals("0", jsNumber(-0.0))
        assertEquals("0.1", jsNumber(0.1))
        assertEquals("0.30000000000000004", jsNumber(0.1 + 0.2))
        assertEquals("-0.3333333333333333", jsNumber(-1.0 / 3))
        assertEquals("4.35", jsNumber(4.35))
        assertEquals("12.5", jsNumber(12.5))
        assertEquals("100000000000000000000", jsNumber(1e20))
        assertEquals("123456789012345680000", jsNumber(1.2345678901234568e20))
        assertEquals("1e+21", jsNumber(1e21))
        assertEquals("1.5e+21", jsNumber(1.5e21))
        assertEquals("1e+300", jsNumber(1e300))
        assertEquals("0.000001", jsNumber(1e-6))
        assertEquals("0.000001234", jsNumber(1.234e-6))
        assertEquals("1e-7", jsNumber(1e-7))
        assertEquals("1.5e-7", jsNumber(1.5e-7))
        assertEquals("1.23e-18", jsNumber(1.23e-18))
        assertEquals("5e-324", jsNumber(Double.MIN_VALUE))
        assertEquals("-1.7976931348623157e+308", jsNumber(-Double.MAX_VALUE))
        assertEquals("9007199254740994", jsNumber(9007199254740994L))
        assertEquals("Infinity", jsNumber(Double.POSITIVE_INFINITY))
        assertEquals("NaN", jsNumber(Double.NaN))
        // Powers of two: the number below is closer, but does not give the number back.
        assertEquals("5.960464477539063e-8", jsNumber(Math.pow(2.0, -24.0)))
        assertEquals("6.189700196426902e+26", jsNumber(Math.pow(2.0, 89.0)))
        assertEquals("-5.684341886080802e-14", jsNumber(-Math.pow(2.0, -44.0)))
    }

    companion object {
        @Suppress("UNCHECKED_CAST")
        private val CASES: List<Map<String, Any?>> by lazy {
            val file = File(System.getProperty("buildCases"))
            (Json.parse(file.readText()) as Map<String, Any?>)["cases"] as List<Map<String, Any?>>
        }

        @JvmStatic
        fun builders(): List<String> = Dispatch.names

        /**
         * The result from TypeScript has `true` for a flag, Kotlin has the
         * empty text, the way HTML writes it. Otherwise the shape is the same.
         */
        private fun normalize(value: Any?): Any? =
            when (value) {
                true -> ""
                is Map<*, *> -> value.entries.associate { (k, v) -> k to normalize(v) }
                is List<*> -> value.map(::normalize)
                else -> value
            }
    }
}
