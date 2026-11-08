package no.lotek.build

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * How `ExtractRecipes` sorts the blocks next to a recipe. A block it put in
 * the wrong place was compiled and never rendered, so a script in it escaped
 * every rule in `RecipesTest`.
 */
class RecipeBlocksTest {
    @Test
    fun `a block is sorted by every line at its top, whatever stands above it`() {
        val declarations = listOf(
            "fun faultsIn(fixer: String): List<Fault> =\n    listOf()",
            "data class Fault(val field: String, val message: String)\n\n// The rule.\nfun faultsIn() = listOf<Fault>()",
            "/** The rule. */\n@Suppress(\"unused\")\ninternal fun faultsIn() = 1",
            "private val LIMIT = 3",
            // A page in a raw string, flush left: its lines are text.
            "fun page(content: String) = \"\"\"\n<!DOCTYPE html>\n<body>\n\$content\n</body>\n\"\"\"",
        )
        for (block in declarations) assertEquals(BlockKind.DECLARATIONS, blockKind(block), block)
        val templates = listOf(
            "head { link(rel = \"stylesheet\", href = LotekWebJar.CSS) }\nbody { autoRenew() }",
            "// Once for the whole app.\nhead {\n    title(\"x\")\n}\nbody {\n    orderForm()\n}",
        )
        for (block in templates) assertEquals(BlockKind.TEMPLATE, blockKind(block), block)
        val neither = listOf(
            // A template written as a function: wrapped, it became a local function no one called.
            "/** The page. */\nfun HTML.page() { body { autoRenew() } }\nbody { autoRenew() }",
            "val x = 1\nbody { autoRenew() }",
            "autoRenew()",
            "// only a comment",
        )
        for (block in neither) assertEquals(null, blockKind(block), block)
    }

    @Test
    fun `a block of declarations may hold no script and no page`() {
        assertEquals(emptyList(), declarationProblems("fun faultsIn() = listOf<Fault>()"))
        val hidden = listOf(
            "fun HTML.page() { body { script(type = \"module\") { unsafe { +\"go()\" } } } }",
            "fun FlowContent.more() { script { type = \"module\"; src = \"/app.js\" } }",
            "fun FlowContent.more() { anonymousScript(\"text/javascript\") }",
            "fun FlowContent.more() { +\"<script>go()</script>\" }",
        )
        for (block in hidden) assertTrue(declarationProblems(block).any { "script" in it }, block)
        assertTrue(declarationProblems("fun HTML.page() { body { orderForm() } }").any { "page" in it }, "a page as a declaration")
    }

    @Test
    fun `the recipe's block declares the recipe and nothing else`() {
        val recipe = "import kotlinx.html.*\n\nfun FlowContent.orderForm(fixer: String = \"\") {\n    form { }\n}"
        assertEquals(emptyList(), recipeBlockProblems(recipe, "orderForm"))
        assertEquals(emptyList(), recipeBlockProblems("data class Fault(val field: String)\n\n$recipe", "orderForm"), "a type the recipe takes")
        val more = "$recipe\n\nfun HTML.page() {\n    body { orderForm() }\n}"
        assertTrue(recipeBlockProblems(more, "orderForm").single().contains("fun HTML.page()"), "a second function in the recipe's block")
        for (hidden in listOf("val page: HTML.() -> Unit = {\n    body { orderForm() }\n}", "object Pages {\n    fun HTML.page() { }\n}", "class Pages")) {
            assertTrue(recipeBlockProblems("$recipe\n\n$hidden", "orderForm").isNotEmpty(), hidden)
        }
    }

    @Test
    fun `a Kotlin recipe that loads Datastar is compared with the Datastar tab, and only from its address`() {
        val src = "https://cdn.jsdelivr.net/gh/starfederation/datastar@v1.0.4/bundles/datastar.js"
        assertEquals("Datastar", comparedWith(listOf("script(type = \"module\", src = \"$src\") {}"), src))
        assertEquals("Plain HTML", comparedWith(listOf("form { }"), src))
        // Another version, or the minified file, is a mistake, not a recipe without Datastar.
        for (other in listOf(src.replace("1.0.4", "1.0.3"), src.replace("datastar.js", "datastar.min.js"))) {
            val message = runCatching { comparedWith(listOf("script(type = \"module\", src = \"$other\") {}"), src) }.exceptionOrNull()?.message
            assertTrue(message?.contains(src) == true, "$other: $message")
        }
    }
}
