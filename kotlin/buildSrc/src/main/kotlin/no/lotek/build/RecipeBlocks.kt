package no.lotek.build

/** What a ```kotlin block next to the recipe is. */
internal enum class BlockKind { DECLARATIONS, TEMPLATE }

private val BLOCK_COMMENT = Regex("""/\*[\s\S]*?\*/""")

/**
 * The lines of a block that stand at its top level: not indented, and not a
 * comment, an annotation or a closing bracket. The block has already lost
 * the indentation of the tab.
 */
private fun topLevel(block: String): List<String> =
    block.replace(BLOCK_COMMENT, "").lines()
        .filter { it.isNotBlank() && !it[0].isWhitespace() }
        .filterNot { it.startsWith("//") || it.startsWith("@") || it.startsWith("}") || it.startsWith(")") }

private val DECLARATION = Regex("""^(?:(?:private|internal|public|suspend|inline|data|enum|sealed|abstract|open|const)\s+)*(?:fun|class|object|interface|val|typealias)\b""")
private val TEMPLATE_STATEMENT = Regex("""^(?:head|body)\s*[({]""")

/**
 * What a block other than the recipe is, read from every line at its top
 * level, not only the first: declarations, such as the validation next to
 * the recipe, compiled at the top level so the test can call them, or the
 * page template, statements beginning with `head` and `body`, which the test
 * renders. `null` for anything else, which would be compiled and never
 * rendered: a template written as a function, or one with a comment above it
 * that hid it from a rule that read the first line.
 */
internal fun blockKind(block: String): BlockKind? {
    val lines = topLevel(block)
    return when {
        lines.isEmpty() -> null
        lines.all { DECLARATION.containsMatchIn(it) } -> BlockKind.DECLARATIONS
        lines.all { TEMPLATE_STATEMENT.containsMatchIn(it) } -> BlockKind.TEMPLATE
        else -> null
    }
}

/** A script in Kotlin, written in any of the forms kotlinx.html has. */
private val SCRIPT = Regex("""\bscript\s*[({]|\banonymousScript\b|\bunsafe\b|<script""")

/** A page, or a part of one, that a declaration would hold out of the test's sight. */
private val PAGE = Regex("""\bfun\s+HTML\.|\b(?:head|body)\s*[({]""")

/**
 * What is wrong with a block of declarations. It is compiled but never
 * rendered, so a script or a page in one would escape every rule on the
 * scripts.
 */
internal fun declarationProblems(block: String): List<String> = listOfNotNull(
    "a ```kotlin block of declarations writes a script. The test does not render it: write the page template as statements, as the other tabs do.".takeIf { SCRIPT.containsMatchIn(block) },
    "a ```kotlin block of declarations has a page in it, which the test compiles but does not render: write the page template as statements, `head { }` and `body { }`.".takeIf { PAGE.containsMatchIn(block) },
)

/** What may stand at the top of the recipe's block next to its function: imports, and the types it takes. */
private val BESIDE_THE_RECIPE = Regex("""^(?:import\s|(?:data|enum)\s+class\s)""")

/**
 * What is wrong with the recipe's own block. The test renders the recipe's
 * function and nothing else in the block, so anything else there that could
 * hold markup, another function, a `val` with a lambda or an `object`, would
 * be compiled and never rendered. The types the recipe takes, a
 * `data class Fault`, may stand next to it.
 */
internal fun recipeBlockProblems(block: String, function: String): List<String> {
    val others = topLevel(block).filterNot { BESIDE_THE_RECIPE.containsMatchIn(it) || it.contains("fun FlowContent.$function(") }
    return others.map { "the recipe's ```kotlin block has more than `$function()` and the types it takes: `$it`. Put the rest in a block of its own." }
}
