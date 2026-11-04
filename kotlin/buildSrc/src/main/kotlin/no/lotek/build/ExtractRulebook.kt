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
            val top = block.lines().filter { it.isNotBlank() && !it[0].isWhitespace() && !it.startsWith("//") && !it.startsWith("}") }
            top.firstOrNull { !BUILD_FILE.containsMatchIn(it) }?.let {
                error("agent/kotlin.md has a block marked as a Gradle build file with `$it` at its top, which a build file does not have. Only `plugins`, `dependencies`, `repositories`, `tasks` and `lotek` are left out of the compilation.")
            }
        }
        if (compiled.isEmpty()) error("agent/kotlin.md has no ```kotlin block to compile, so the rulebook test would check nothing.")
        val fragments = mutableListOf<String>()
        val pages = mutableListOf<String>()
        for ((i, block) in compiled.withIndex()) {
            val imports = block.lines().filter { it.startsWith("import ") }
            val body = block.lines().filterNot { it.startsWith("import ") }.joinToString("\n").trim()
            val code = when (blockKind(body)) {
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
