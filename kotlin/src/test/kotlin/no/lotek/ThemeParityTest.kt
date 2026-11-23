package no.lotek

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.MethodSource

/**
 * That the theme answers the same on the JVM as in Node and the browser.
 *
 * The expected results in `core/theme/` are the same ones
 * `core/scripts/check-core.ts` requires of the module in Bun: `recipes.json`
 * has every recipe with the theme `buildTheme` must give, or the error it
 * must reject with, and `reports.json` has the result `inspectTheme` must
 * give for every theme written as CSS next to it. What is tested here is
 * what surrounds the module: the translation of the recipe, the JSON and the
 * fields of [Theme] and [ThemeReport].
 *
 * No recipe in the expected results gives a non-empty `violations`, and
 * that is not a gap in them: the promises hold by construction, so the core
 * gives none for a recipe it accepts. The fields of [ThemeViolation] are
 * held to a case all the same, by `breaks` in `brands`: what the brand
 * colour would have broken had it been the fill itself.
 */
class ThemeParityTest {
    @ParameterizedTest(name = "{0}")
    @MethodSource("recipes")
    fun `buildTheme answers the same as TypeScript`(name: String) {
        val case = RECIPES.getValue(name) as Map<*, *>
        val recipe = Json.write(case["recipe"])
        val expectedError = case["error"] as String?
        if (expectedError != null) {
            assertEquals(expectedError, assertFailsWith<IllegalArgumentException> { Lotek.buildTheme(recipe) }.message)
            return
        }
        val expected = case["theme"] as Map<*, *>
        assertEquals(setOf("light", "dark", "violations", "brands", "css"), expected.keys, "the expected results have a field the reader does not compare")
        val theme = Lotek.buildTheme(recipe)
        assertEquals(expected["light"], theme.light, "light")
        assertEquals(expected["dark"], theme.dark, "dark")
        assertAnswer(expected["violations"], theme.violations.map { violation(it) }, "violations")
        assertAnswer(
            expected["brands"],
            theme.brands.map {
                mapOf(
                    "family" to it.family,
                    "given" to it.given,
                    // The sentences are the core's own, and reach Kotlin as it wrote them.
                    "summary" to it.summary,
                    "reasons" to it.reasons,
                    "light" to side(it.light),
                    "dark" to side(it.dark),
                )
            },
            "brands",
        )
        assertEquals(expected["css"], theme.css, "css")
    }

    private fun violation(v: ThemeViolation) =
        mapOf("family" to v.family, "promise" to v.promise, "ratio" to v.ratio, "required" to v.required)

    private fun side(f: ThemeBrandFill) =
        mapOf("fill" to f.fill, "chromaKept" to f.chromaKept, "breaks" to f.breaks.map { violation(it) })

    /**
     * Requires the answer to be the expected one, by the rule of `same` in
     * `check-core.ts`: a number with decimals may differ by [FLOAT], since
     * the ratios and `chromaKept` in the expected results were worked out by
     * another implementation than the core. A whole number, and everything
     * that is not a number, must be exactly the expected.
     */
    private fun assertAnswer(expected: Any?, answer: Any?, path: String) {
        when {
            expected is Double && answer is Double ->
                if (expected % 1.0 == 0.0) assertEquals(expected, answer, path) else assertEquals(expected, answer, FLOAT, path)
            expected is List<*> && answer is List<*> -> {
                assertEquals(expected.size, answer.size, "$path: the number of entries")
                expected.forEachIndexed { i, value -> assertAnswer(value, answer[i], "$path[$i]") }
            }
            expected is Map<*, *> && answer is Map<*, *> -> {
                assertEquals(expected.keys, answer.keys, "$path: the keys")
                for ((key, value) in expected) assertAnswer(value, answer[key], "$path.$key")
            }
            else -> assertEquals(expected, answer, path)
        }
    }

    /**
     * `checkRecipe` says what is wrong with each key, all at once, and never
     * refuses a recipe itself: also a text or a list, which is no recipe, is
     * answered by the core and passed on as it is.
     */
    @ParameterizedTest(name = "{0}")
    @MethodSource("recipeChecks")
    fun `checkRecipe answers the same as TypeScript`(name: String) {
        val case = RECIPE_CHECKS.getValue(name) as Map<*, *>
        assertEquals(setOf("recipe", "wrong"), case.keys, "the expected results have a field the reader does not compare")
        assertEquals(case["wrong"], Lotek.checkRecipe(Json.write(case["recipe"])), name)
    }

    @Test
    fun `checkRecipe finds something exactly when buildTheme refuses`() {
        // Apart from the empty theme, which is about no key. Over the recipes
        // that are objects: `buildTheme` here has its own answer for the rest.
        var held = 0
        for ((file, cases) in listOf("recipes.json" to RECIPES, "recipe-checks.json" to RECIPE_CHECKS)) {
            for ((name, case) in cases) {
                val recipe = (case as Map<*, *>)["recipe"] as? Map<*, *> ?: continue
                val text = Json.write(recipe)
                val refuses =
                    try {
                        Lotek.buildTheme(text)
                        false
                    } catch (refused: IllegalArgumentException) {
                        !refused.message.orEmpty().startsWith("The theme is empty")
                    }
                assertEquals(refuses, Lotek.checkRecipe(text).isNotEmpty(), "$file, $name")
                held += 1
            }
        }
        assertTrue(held > 30, "only $held recipes")
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("themes")
    fun `inspectTheme answers the same as TypeScript`(name: String) {
        val expected = REPORTS.getValue(name) as Map<*, *>
        assertEquals(setOf("problems", "blocks", "declarations", "promises"), expected.keys, "the expected results have a field the reader does not compare")
        val report = Lotek.inspectTheme(File(DIR, "$name.css").readText())
        assertEquals(
            expected["problems"],
            report.problems.map { mapOf("selector" to it.selector, "message" to it.message) },
            "problems",
        )
        assertEquals(
            listOf(expected["blocks"], expected["declarations"], expected["promises"]),
            listOf(report.blocks, report.declarations, report.promises).map { it.toDouble() },
            "the counts",
        )
    }

    @Test
    fun `Norwegian keys are unknown keys`() {
        val error = assertFailsWith<IllegalArgumentException> { Lotek.buildTheme("""{"aksent": "#7c3aed", "form": {"buttonRadius": "0"}}""") }
        assertEquals("Unknown key in the recipe: aksent, form", error.message)
    }

    @Test
    fun `a recipe with an unknown key is refused, with the path to the key`() {
        val error = assertFailsWith<IllegalArgumentException> { Lotek.buildTheme("""{"accent": "#7c3aed", "acent": "#000", "shape": {"radius": "0"}}""") }
        assertEquals("Unknown key in the recipe: acent, shape.radius", error.message)
        // A string or list where an object should have been, as `lotek theme` reports it.
        val text = assertFailsWith<IllegalArgumentException> { Lotek.buildTheme("""{"accent": "#7c3aed", "typography": "Inter"}""") }
        assertEquals("Unknown key in the recipe: typography.0, typography.1, typography.2, typography.3, typography.4", text.message)
        val list = assertFailsWith<IllegalArgumentException> { Lotek.buildTheme("""{"typography": {"weights": [400]}}""") }
        assertEquals("Unknown key in the recipe: typography.weights.0", list.message)
    }

    @Test
    fun `a colour that is false, 0 or null is a colour that is not given`() {
        // Next to a real colour: the theme is the one that colour gives
        // alone, and the families keep LO-TEK's own.
        val alone = Lotek.buildTheme("""{"accent": "#7c3aed"}""")
        val theme = Lotek.buildTheme("""{"accent": "#7c3aed", "danger": false, "success": 0, "warning": null}""")
        assertEquals(alone, theme)
        assertEquals(listOf("accent"), theme.brands.map { it.family })
    }

    @Test
    fun `a recipe that is not an object is refused before the core sees it`() {
        // The answer is about the text that was given, and is this package's
        // own: the core is only ever given an object.
        for (recipe in listOf("[]", "12", "\"#7c3aed\"", "null")) {
            val error = assertFailsWith<IllegalArgumentException> { Lotek.buildTheme(recipe) }
            assertEquals("The recipe is valid JSON, but not an object with the colours in it.", error.message, recipe)
        }
    }

    companion object {
        private val DIR = File(System.getProperty("theme"))

        @Suppress("UNCHECKED_CAST")
        private val RECIPE_CHECKS = Json.parse(File(DIR, "recipe-checks.json").readText()) as Map<String, Any?>
        private const val FLOAT = 1e-6

        @Suppress("UNCHECKED_CAST")
        private val RECIPES = Json.parse(File(DIR, "recipes.json").readText()) as Map<String, Any?>

        @Suppress("UNCHECKED_CAST")
        private val REPORTS = Json.parse(File(DIR, "reports.json").readText()) as Map<String, Any?>

        @JvmStatic
        fun recipes(): List<String> {
            assertTrue(RECIPES.isNotEmpty() && RECIPES.values.any { (it as Map<*, *>).containsKey("error") }, "The expected results must have recipes, and at least one that is rejected")
            return RECIPES.keys.sorted()
        }

        @JvmStatic
        fun recipeChecks(): List<String> {
            assertTrue(RECIPE_CHECKS.size > 10, "The expected results for checkRecipe must have cases")
            return RECIPE_CHECKS.keys.sorted()
        }

        @JvmStatic
        fun themes(): List<String> {
            val names = REPORTS.keys.sorted()
            assertTrue(names.isNotEmpty(), "No themes in $DIR")
            // Both ways: a theme without a report would otherwise never be inspected.
            val css = DIR.listFiles { f -> f.name.endsWith(".css") }!!.map { it.nameWithoutExtension }.sorted()
            assertEquals(css, names, "the themes in $DIR and the reports in reports.json must be the same")
            return names
        }
    }
}
