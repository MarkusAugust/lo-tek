package no.lotek.build

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import org.gradle.api.DefaultTask
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.tasks.InputFile
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction

/**
 * Takes the Kotlin recipes out of the component pages, so the tests can
 * compile them and compare what they render with the page's HTML recipe.
 *
 * The pages are read from `documentation/generated/recipes.json`, which
 * `extract-recipes.ts` writes from the tree of each page. This task used to
 * read the MDX with patterns of its own, and a tab written in another form
 * than the pattern was missed (03d1287).
 *
 * A page with a `<TabItem label="kotlinx.html">`, or an `<Example>` with a
 * `<Fragment slot="kotlin">`, has a ```kotlin block there with
 * one `fun FlowContent.<name>()`, whose parameters all have a default, so the
 * test can call it without arguments. It is written as a source file in a package
 * of its own, `no.lotek.html.recipes.<page>`, and the blocks in the page's
 * "Plain HTML" tab as a resource next to it, or in its "Datastar" tab when
 * the Kotlin recipe loads Datastar. `Recipes.kt` lists them, so a
 * kotlinx.html tab on a new page is tested without anything else to write.
 *
 * Run by the tests in `kotlinx-html`, not by the build of the package.
 */
abstract class ExtractRecipes : DefaultTask() {
    /** `recipes.json`, with the tabs and examples of every page. */
    @get:InputFile
    @get:PathSensitive(PathSensitivity.NONE)
    abstract val recipes: RegularFileProperty

    /** `Example.astro`, whose kotlinx.html tab shows the stylesheet from the WebJar above the recipe. */
    @get:InputFile
    @get:PathSensitive(PathSensitivity.NONE)
    abstract val example: RegularFileProperty

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
        val pages = JsonParser.parseString(recipes.get().asFile.readText()).asJsonObject["pages"].asJsonArray
            .map { it.asJsonObject }
            .filter { it["path"].asString.startsWith("components/") }
            .sortedBy { it["path"].asString }
        for (page in pages) {
            val file = page["path"].asString.removePrefix("components/")
            val name = file.removeSuffix(".mdx")
            val (kotlinBlocks, html, where) = recipeIn(file, page) ?: continue
            val block = kotlinBlocks.singleOrNull { it.contains("fun FlowContent.") }
                ?: error("$where must have exactly one ```kotlin block with a `fun FlowContent.…()`.")
            val function = Regex("""fun FlowContent\.(\w+)\(""").find(block)?.groupValues?.get(1)
                ?: error("$where: the recipe must be a `fun FlowContent.name()`.")
            if (html.isEmpty()) error("$file: the HTML recipe next to the kotlinx.html tab is empty.")
            val pkg = "no.lotek.html.recipes.${name.replace("-", "")}"
            val dir = sourceDir.resolve(pkg.replace('.', '/')).apply { mkdirs() }
            // The other ```kotlin blocks in the tab are either declarations the
            // recipe's server uses, such as the validation, which are compiled
            // at the top level so the test can call them, or the page template,
            // with the stylesheet and `defineLt()`, compiled as a function on
            // `HTML` that the test renders. A name in either that changes stops
            // here.
            val others = kotlinBlocks.filter { it != block }
            for (problem in recipeBlockProblems(block, function)) error("$where: $problem")
            val kinds = others.map { it to (blockKind(it) ?: error("$where: a ```kotlin block that is neither declarations, `fun` or `class` at its top, nor a page template, `head { }` and `body { }` at its top. The test would compile it without rendering it:\n$it")) }
            val declarations = kinds.filter { it.second == BlockKind.DECLARATIONS }.map { it.first }
            val pageTemplates = kinds.filter { it.second == BlockKind.TEMPLATE }.map { it.first }
            for (d in declarations) for (problem in declarationProblems(d)) error("$where: $problem")
            val templates = pageTemplates
                .mapIndexed { i, t -> "\ninternal fun HTML.pageTemplate$i() {\n${t.prependIndent("    ")}\n}\n" }
            dir.resolve("Recipe.kt").writeText("package $pkg\n\n$block\n${declarations.joinToString("\n")}\n${templates.joinToString("")}")
            resourceDir.resolve("recipes").apply { mkdirs() }.resolve("$name.html").writeText(html.joinToString("\n"))
            val alias = "${name.replace("-", "")}_$function"
            imports.add("import $pkg.$function as $alias")
            val templateCalls = pageTemplates.indices.map { i ->
                val templateAlias = "${name.replace("-", "")}_pageTemplate$i"
                imports.add("import $pkg.pageTemplate$i as $templateAlias")
                "{ $templateAlias() }"
            }
            entries.add("    Recipe(\"$name\", \"$function\", listOf(${templateCalls.joinToString(", ")})) { $alias() },")
        }
        if (entries.isEmpty()) error("No component page has a kotlinx.html tab, so the recipe test would check nothing.")
        // The stylesheet `Example.astro` shows above every recipe on a CSS page.
        val astro = example.get().asFile.readText()
        val stylesheet = Regex("""const kotlinStylesheet = `((?:[^`\\]|\\[\s\S])*)`""").find(astro)?.groupValues?.get(1)
            ?.let { cooked(it) ?: error("kotlinStylesheet in Example.astro has a \${…}, which the test cannot resolve.") }
            ?: error("Example.astro has no kotlinStylesheet, which the kotlinx.html tab shows.")
        val registry = sourceDir.resolve("no/lotek/html/recipes").apply { mkdirs() }
        registry.resolve("ExampleStylesheet.kt").writeText(
            "package no.lotek.html.recipes\n\nimport kotlinx.html.*\nimport no.lotek.*\n\n" +
                "/** What Example.astro shows above a recipe on a CSS page, compiled. */\n" +
                "internal fun HTML.exampleStylesheet() {\n${stylesheet.prependIndent("    ")}\n}\n",
        )
        registry.resolve("Recipes.kt").writeText(
            """
            |// Written by ExtractRecipes from the component pages. Do not edit.
            |package no.lotek.html.recipes
            |
            |import kotlinx.html.FlowContent
            |import kotlinx.html.HTML
            |${imports.joinToString("\n")}
            |
            |/** A Kotlin recipe from a component page: the page, the function, the page templates in its tab, and a call to it. */
            |class Recipe(val page: String, val function: String, val templates: List<HTML.() -> Unit>, val render: FlowContent.() -> Unit)
            |
            |val recipes: List<Recipe> = listOf(
            |${entries.joinToString("\n")}
            |)
            |""".trimMargin(),
        )
    }

    /**
     * The ```kotlin blocks of the kotlinx.html recipe on a page and the HTML
     * blocks it is compared with, or `null` when the page has none. There are
     * two forms:
     *
     *   - a tab labelled `kotlinx.html` in the same `<Tabs>` as a "Plain
     *     HTML" tab, on the pages with a web component, or as a "Datastar"
     *     tab when the Kotlin recipe loads Datastar, since it is then that
     *     recipe rendered by the server;
     *   - the `kotlin` slot of an `<Example>`, on the pages of the CSS
     *     components, where `code` is what the Plain HTML tab shows.
     *
     * A page has one of them at most, and a tab with "kotlin" in another
     * label stops the build rather than being skipped.
     */
    private fun recipeIn(page: String, entry: JsonObject): Triple<List<String>, List<String>, String>? {
        val tabs = entry["tabs"].asJsonArray.map { it.asJsonObject }
        val loose = tabs.filter { it["label"].asString.contains("kotlin", ignoreCase = true) && it["label"].asString != "kotlinx.html" }
        if (loose.isNotEmpty()) {
            error("$page: write the kotlinx.html tab as <TabItem label=\"kotlinx.html\">, not \"${loose.first()["label"].asString}\", or the recipe test does not find it.")
        }
        val kotlinTabs = tabs.filter { it["label"].asString == "kotlinx.html" }
        val slots = entry["examples"].asJsonArray.map { it.asJsonObject }.filter { it["kotlin"].asJsonArray.size() > 0 }
        if (kotlinTabs.size + slots.size > 1) error("$page has ${kotlinTabs.size + slots.size} kotlinx.html tabs. The test compares one per page.")
        kotlinTabs.singleOrNull()?.let { tab ->
            val where = "$page, the kotlinx.html tab"
            val kotlin = codeOf(tab, "kotlin")
            // A Kotlin tab whose code loads Datastar, in the recipe or in its page
            // template, is the Datastar recipe rendered by the server, so it is
            // compared with that tab: a Kotlin server saves through Datastar, not
            // with a script of its own. Only the code is read, not the prose. The
            // script is compared too, so a tab that loads it and should not fails.
            val label = if (kotlin.any { DATASTAR.containsMatchIn(it) }) "Datastar" else "Plain HTML"
            // The HTML recipe is the one in the same `<Tabs>` as the kotlinx.html tab.
            val html = tabs.filter { it["group"].asInt == tab["group"].asInt && it["label"].asString == label }.singleOrNull()
                ?: error("$page: the <Tabs> with the kotlinx.html tab must have one $label tab to compare it with.")
            return Triple(kotlin, codeOf(html, "html"), where)
        }
        slots.singleOrNull()?.let { example ->
            val where = "$page, the kotlinx.html slot"
            val kotlin = example["kotlin"].asJsonArray.map { it.asJsonObject }
                .filter { it["lang"]?.takeIf { l -> !l.isJsonNull }?.asString == "kotlin" }
                .map { it["code"].asString }
            return Triple(kotlin, listOf(example["code"].asString.trim()), where)
        }
        return null
    }

    /** The code of the blocks in a language in a tab of `recipes.json`. */
    private fun codeOf(tab: JsonObject, language: String): List<String> =
        tab["blocks"].asJsonArray.map { it.asJsonObject }
            .filter { it["lang"]?.takeIf { l -> !l.isJsonNull }?.asString == language }
            .map { it["code"].asString }

    /** The script that loads Datastar, as the Datastar tabs and the Kotlin recipes write it. */
    private val DATASTAR = Regex("""src\s*=\s*"https://cdn\.jsdelivr\.net/gh/starfederation/datastar@[^"]+/datastar\.js"""")
}
