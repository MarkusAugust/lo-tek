package no.lotek.build

import org.gradle.api.DefaultTask
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.tasks.InputFile
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction

/**
 * Takes the Kotlin out of the rulebook for coding agents, `agent/kotlin.md` in
 * the package, so the tests compile every block an agent would copy.
 *
 * Every ```kotlin block is written as a source file in the package
 * `no.lotek.html.rulebook`, with the imports a recipe has. A block of
 * declarations stands at the top level, and a class with tests in it runs
 * with the others. A page template, `head { }` and `body { }`, becomes a
 * function on `HTML`, and any other block a function on `FlowContent`. The
 * blocks for a Gradle build file, which start with `// build.gradle.kts`,
 * are not Kotlin a project compiles, and are left out. `Rulebook.kt` lists the
 * functions, so `RulebookTest` renders each and checks what comes out.
 */
abstract class ExtractRulebook : DefaultTask() {
    @get:InputFile
    @get:PathSensitive(PathSensitivity.NONE)
    abstract val rulebook: RegularFileProperty

    @get:OutputDirectory
    abstract val sources: DirectoryProperty

    @TaskAction
    fun extract() {
        val dir = sources.get().asFile.apply { deleteRecursively(); mkdirs() }
            .resolve("no/lotek/html/rulebook").apply { mkdirs() }
        val blocks = Regex("""(?m)^```kotlin\n([\s\S]*?)\n```""")
            .findAll(rulebook.get().asFile.readText()).map { it.groupValues[1] }.toList()
        val (gradle, compiled) = blocks.partition { it.startsWith("// build.gradle") }
        // A block left out may hold only what a build file has at its top,
        // or the comment would hide any Kotlin from the compiler.
        for (block in gradle) {
            topLevel(block).firstOrNull { !BUILD_FILE.containsMatchIn(it) }?.let {
                error("agent/kotlin.md has a block marked as a Gradle build file with `$it` at its top, which a build file does not have. Only `plugins`, `dependencies`, `repositories`, `tasks` and `lotek` are left out of the compilation.")
            }
        }
        if (compiled.isEmpty()) error("agent/kotlin.md has no ```kotlin block to compile, so the rulebook test would check nothing.")
        // Each block once: its imports, the rest, and what the rest is.
        val parts = compiled.map { block ->
            val (imports, rest) = block.lines().partition { it.startsWith("import ") }
            val body = rest.joinToString("\n").trim()
            Triple(imports, body, blockKind(body))
        }
        // A function in a block of declarations is only rendered when another
        // block calls it, such as the test that renders the string page. One
        // nobody calls would be compiled, and its markup never checked. A
        // call is read without comments, strings and declarations, so a
        // mention of the name, or a second function with it, is not one.
        val calls = parts.map { (_, body) -> body.replace(NOT_A_CALL, " ") }
        for ((i, part) in parts.withIndex()) {
            if (part.third != BlockKind.DECLARATIONS) continue
            for (name in DECLARED_FUNCTION.findAll(part.second).map { it.groupValues[1] }) {
                val call = Regex("""(?<![\w.])${Regex.escape(name)}\(""")
                if (calls.withIndex().none { (j, other) -> j != i && call.containsMatchIn(other) }) {
                    error("agent/kotlin.md declares $name() in block ${i + 1}, and no other block calls it, so its markup is never rendered and checked. Call it from the test in the rulebook.")
                }
            }
        }
        val fragments = mutableListOf<String>()
        val pages = mutableListOf<String>()
        for ((i, part) in parts.withIndex()) {
            val (imports, body, kind) = part
            val code = when (kind) {
                BlockKind.DECLARATIONS -> body
                BlockKind.TEMPLATE -> {
                    pages.add("rulebookPage$i")
                    "internal fun HTML.rulebookPage$i() {\n${body.prependIndent("    ")}\n}"
                }
                null -> {
                    fragments.add("rulebookFragment$i")
                    "internal fun FlowContent.rulebookFragment$i() {\n${body.prependIndent("    ")}\n}"
                }
            }
            val header = (DEFAULT_IMPORTS + imports).distinct().joinToString("\n")
            dir.resolve("Block$i.kt").writeText("// Block ${i + 1} of agent/kotlin.md, written by ExtractRulebook. Do not edit.\n@file:Suppress(\"UNUSED_VARIABLE\")\n\npackage no.lotek.html.rulebook\n\n$header\n\n$code\n")
        }
        dir.resolve("Rulebook.kt").writeText(
            """
            |// Written by ExtractRulebook from agent/kotlin.md. Do not edit.
            |package no.lotek.html.rulebook
            |
            |import kotlinx.html.FlowContent
            |import kotlinx.html.HTML
            |
            |/** The number of ```kotlin blocks compiled from the rulebook. */
            |const val COMPILED_BLOCKS = ${compiled.size}
            |
            |/** The blocks that are a piece of a page, by name, as functions. */
            |val rulebookFragments: List<Pair<String, FlowContent.() -> Unit>> = listOf(
            |${fragments.joinToString("\n") { "    \"$it\" to { $it() }," }}
            |)
            |
            |/** The blocks that are a page template, by name, as functions. */
            |val rulebookPages: List<Pair<String, HTML.() -> Unit>> = listOf(
            |${pages.joinToString("\n") { "    \"$it\" to { $it() }," }}
            |)
            |""".trimMargin(),
        )
    }

    private companion object {
        /**
         * A function at the top level of a block, with its modifiers, type
         * parameters and receiver: `fun name(`, `internal fun FlowContent.name(`,
         * `fun <T> List<T>.name(`. A test, named in backticks, is not one.
         */
        val DECLARED_FUNCTION = Regex("""(?m)^(?:(?:private|internal|public|inline|suspend)\s+)*fun\s+(?:<[^>]*>\s*)?(?:[\w.<>*?, ]+\.)?([a-z]\w*)\s*\(""")

        /** What is not a call: a comment, a string, and a declaration of a function. */
        val NOT_A_CALL = Regex("""//[^\n]*|/\*[\s\S]*?\*/|\"\"\"[\s\S]*?\"\"\"|"(?:[^"\\\n]|\\.)*"|\bfun\s+(?:<[^>]*>\s*)?(?:[\w.<>*?, ]+\.)?[a-z]\w*\s*\(""")

        /** What a Gradle build file in the rulebook may have at its top. */
        val BUILD_FILE = Regex("""^(?:plugins|dependencies|repositories|tasks|lotek)\s*\{""")

        /** What every recipe on the component pages imports. */
        val DEFAULT_IMPORTS = listOf(
            "import kotlinx.html.*",
            "import no.lotek.*",
            "import no.lotek.InputType",
            "import no.lotek.html.*",
        )
    }
}
