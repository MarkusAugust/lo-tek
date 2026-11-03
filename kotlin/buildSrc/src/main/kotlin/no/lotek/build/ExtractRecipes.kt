package no.lotek.build

import org.gradle.api.DefaultTask
import org.gradle.api.file.ConfigurableFileCollection
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.tasks.InputFiles
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction

/**
 * Takes the Kotlin recipes out of the component pages, so the tests can
 * compile them and compare what they render with the page's HTML recipe.
 *
 * A page with a `<TabItem label="Kotlin">` has a ```kotlin block there with
 * one `fun FlowContent.<name>()`, whose parameters all have a default, so the
 * test can call it without arguments. It is written as a source file in a package
 * of its own, `no.lotek.html.recipes.<page>`, and the blocks in the page's
 * "Plain HTML" tab as a resource next to it. `Recipes.kt` lists them, so a
 * Kotlin tab on a new page is tested without anything else to write.
 *
 * Run by the tests in `kotlinx-html`, not by the build of the package.
 */
abstract class ExtractRecipes : DefaultTask() {
    @get:InputFiles
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val pages: ConfigurableFileCollection

    @get:OutputDirectory
    abstract val sources: DirectoryProperty

    @get:OutputDirectory
    abstract val resources: DirectoryProperty

    @TaskAction
    fun extract() {
        val sourceDir = sources.get().asFile.apply { deleteRecursively(); mkdirs() }
        val resourceDir = resources.get().asFile.apply { deleteRecursively(); mkdirs() }
        val entries = mutableListOf<String>()
        val imports = mutableListOf<String>()
        for (page in pages.files.sortedBy { it.name }) {
            val text = page.readText()
            val starts = tabStarts(text, "Kotlin")
            if (starts.isEmpty()) continue
            val name = page.nameWithoutExtension
            val where = "${page.name}, the Kotlin tab"
            if (starts.size > 1) error("${page.name} has ${starts.size} Kotlin tabs. The test compares one per page.")
            val kotlin = tabAt(text, starts.single())
            // The HTML recipe is the one in the same `<Tabs>` as the Kotlin tab.
            val groupStart = text.lastIndexOf("<Tabs", starts.single()).coerceAtLeast(0)
            val groupEnd = text.indexOf("</Tabs>", starts.single()).let { if (it < 0) text.length else it }
            val group = text.substring(groupStart, groupEnd)
            val block = blocks(kotlin, "kotlin").singleOrNull { it.contains("fun FlowContent.") }
                ?: error("$where must have exactly one ```kotlin block with a `fun FlowContent.…()`.")
            val function = Regex("""fun FlowContent\.(\w+)\(""").find(block)?.groupValues?.get(1)
                ?: error("$where: the recipe must be a `fun FlowContent.name()`.")
            val plain = tabStarts(group, "Plain HTML").singleOrNull()
                ?: error("${page.name}: the <Tabs> with the Kotlin tab must have one Plain HTML tab to compare it with.")
            val html = blocks(tabAt(group, plain), "html")
            if (html.isEmpty()) error("${page.name}: the Plain HTML tab has no ```html block.")
            val pkg = "no.lotek.html.recipes.${name.replace("-", "")}"
            val dir = sourceDir.resolve(pkg.replace('.', '/')).apply { mkdirs() }
            dir.resolve("Recipe.kt").writeText("package $pkg\n\n$block\n")
            resourceDir.resolve("recipes").apply { mkdirs() }.resolve("$name.html").writeText(html.joinToString("\n"))
            val alias = "${name.replace("-", "")}_$function"
            imports.add("import $pkg.$function as $alias")
            entries.add("    Recipe(\"$name\", \"$function\") { $alias() },")
        }
        if (entries.isEmpty()) error("No component page has a Kotlin tab, so the recipe test would check nothing.")
        val registry = sourceDir.resolve("no/lotek/html/recipes").apply { mkdirs() }
        registry.resolve("Recipes.kt").writeText(
            """
            |// Written by ExtractRecipes from the component pages. Do not edit.
            |package no.lotek.html.recipes
            |
            |import kotlinx.html.FlowContent
            |${imports.joinToString("\n")}
            |
            |/** A Kotlin recipe from a component page: the page, the function, and a call to it. */
            |class Recipe(val page: String, val function: String, val render: FlowContent.() -> Unit)
            |
            |val recipes: List<Recipe> = listOf(
            |${entries.joinToString("\n")}
            |)
            |""".trimMargin(),
        )
    }

    /**
     * Where each `<TabItem label="…">` with this label starts. The pattern
     * allows the spacing MDX allows, and `RecipesTest` counts the Kotlin tabs
     * in the pages with the same pattern, so a tab this task missed fails it.
     */
    private fun tabStarts(text: String, label: String): List<Int> =
        Regex("""<TabItem\s+label\s*=\s*"${Regex.escape(label)}"\s*>""").findAll(text).map { it.range.first }.toList()

    /** The content of the tab that starts at [start], up to its `</TabItem>`. */
    private fun tabAt(text: String, start: Int): String {
        val end = text.indexOf("</TabItem>", start)
        return text.substring(start, if (end < 0) text.length else end)
    }

    /** The code blocks in a language, without the indentation the tab gives them. */
    private fun blocks(text: String, language: String): List<String> =
        Regex("""(?m)^([ \t]*)```$language\n([\s\S]*?)\n[ \t]*```""").findAll(text).map { m ->
            val indent = m.groupValues[1]
            m.groupValues[2].lines().joinToString("\n") { it.removePrefix(indent) }
        }.toList()
}
