/**
 * LO-TEK in Gradle.
 *
 * ```kotlin
 * plugins {
 *     id("io.github.markusaugust.lo-tek")
 * }
 *
 * lotek {
 *     templates.from(fileTree("src/main/jte"))
 *     themeRecipe = file("lotek.theme.json")
 * }
 * ```
 *
 * `lotekCheck` runs as part of `check`, and `lotekManifest` as part of
 * `assemble`. `lotekTheme` runs when asked for, or when another task needs
 * the theme.
 */
package no.lotek.gradle

import no.lotek.cli.CommandLine
import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.api.file.ConfigurableFileCollection
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.provider.Property
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.InputFile
import org.gradle.api.tasks.InputFiles
import org.gradle.api.tasks.Internal
import org.gradle.api.tasks.Optional
import org.gradle.api.tasks.OutputFile
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.SkipWhenEmpty
import org.gradle.api.tasks.TaskAction
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File

/** The settings, under `lotek { }`. */
abstract class LotekExtension {
    /** The templates and pages `lotekCheck` checks. */
    abstract val templates: ConfigurableFileCollection

    /**
     * Check the files as whole pages, with the wiring between labels, fields
     * and ids. Like `lotek check --rendered`. Off by default, since an id in a
     * template can be in another file.
     */
    abstract val rendered: Property<Boolean>

    /** The fragments `lotek takeover` wrote next to the copies. */
    abstract val manifests: ConfigurableFileCollection

    /** The recipe `lotekTheme` builds the theme from, like `lotek theme <file>`. */
    abstract val themeRecipe: RegularFileProperty

    /** Where the theme is written. Default: `build/lotek/theme.css`. */
    abstract val themeOutput: RegularFileProperty
}

class LotekPlugin : Plugin<Project> {
    override fun apply(project: Project) {
        val extension = project.extensions.create("lotek", LotekExtension::class.java)
        extension.rendered.convention(false)
        extension.themeOutput.convention(project.layout.buildDirectory.file("lotek/theme.css"))

        val check = project.tasks.register("lotekCheck", LotekCheck::class.java) { task ->
            task.group = "verification"
            task.description = "Checks the templates against LO-TEK, like lotek check."
            task.templates.from(extension.templates)
            task.rendered.set(extension.rendered)
            task.manifests.from(extension.manifests)
            task.workingDirectory.set(project.layout.projectDirectory)
            task.report.set(project.layout.buildDirectory.file("lotek/check.txt"))
        }
        project.tasks.register("lotekTheme", LotekTheme::class.java) { task ->
            task.group = "build"
            task.description = "Builds the theme from the recipe, like lotek theme."
            task.recipe.set(extension.themeRecipe)
            task.output.set(extension.themeOutput)
            task.workingDirectory.set(project.layout.projectDirectory)
            task.onlyIf("lotek.themeRecipe is set") { task.recipe.isPresent }
        }
        val manifest = project.tasks.register("lotekManifest", LotekManifest::class.java) { task ->
            task.group = "build"
            task.description = "Writes the manifest the project is checked against, with the fragments from lotek takeover."
            task.manifests.from(extension.manifests)
            task.workingDirectory.set(project.layout.projectDirectory)
            task.output.set(project.layout.buildDirectory.file("lotek/manifest.json"))
        }

        project.pluginManager.withPlugin("base") {
            project.tasks.named("check") { it.dependsOn(check) }
            project.tasks.named("assemble") { it.dependsOn(manifest) }
        }
    }
}

/** Runs one command and gives the exit code and everything it wrote. */
private fun run(args: List<String>, workingDirectory: File): Pair<Int, String> {
    val stdout = ByteArrayOutputStream()
    val stderr = ByteArrayOutputStream()
    val code =
        try {
            CommandLine.run(args, workingDirectory, ByteArrayInputStream(ByteArray(0)), stdout, stderr)
        } catch (crash: RuntimeException) {
            // The module aborted. What it wrote before that says why, and
            // was lost with the exception.
            val written = (stdout.toString(Charsets.UTF_8) + stderr.toString(Charsets.UTF_8)).trim()
            throw GradleException("The command line crashed ($crash). It wrote:\n\n$written", crash)
        }
    return code to (stdout.toString(Charsets.UTF_8) + stderr.toString(Charsets.UTF_8)).trim()
}

/** The path as it appears in a message: from the project folder when the file is there. */
internal fun shown(file: File, workingDirectory: File): String {
    // On Windows the file can be on another drive than the project, and then
    // there is no relative path: `relativize` throws.
    val relative =
        try {
            workingDirectory.toPath().relativize(file.toPath()).toString()
        } catch (otherRoot: IllegalArgumentException) {
            return file.absolutePath
        }
    return if (relative.startsWith("..")) file.absolutePath else relative
}

/** `lotekCheck`: the templates against LO-TEK, and against the fragments from `lotek takeover`. */
abstract class LotekCheck : DefaultTask() {
    @get:InputFiles
    @get:SkipWhenEmpty
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val templates: ConfigurableFileCollection

    @get:Input
    abstract val rendered: Property<Boolean>

    @get:InputFiles
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val manifests: ConfigurableFileCollection

    @get:Internal
    abstract val workingDirectory: DirectoryProperty

    /** The answer from the last run, so the task is up to date when nothing has changed. */
    @get:OutputFile
    abstract val report: RegularFileProperty

    @TaskAction
    fun check() {
        val directory = workingDirectory.get().asFile
        val args = buildList {
            add("check")
            if (rendered.get()) add("--rendered")
            manifests.files.sorted().forEach { add("--manifest=${shown(it, directory)}") }
            templates.files.sorted().forEach { add(shown(it, directory)) }
        }
        val (code, output) = run(args, directory)
        report.get().asFile.writeText("$output\n")
        if (code != 0) throw GradleException("The markup does not match LO-TEK:\n\n$output")
        logger.info(output)
    }
}

/** `lotekTheme`: the theme from the recipe. */
abstract class LotekTheme : DefaultTask() {
    @get:InputFile
    @get:Optional
    @get:PathSensitive(PathSensitivity.NONE)
    abstract val recipe: RegularFileProperty

    @get:OutputFile
    abstract val output: RegularFileProperty

    @get:Internal
    abstract val workingDirectory: DirectoryProperty

    @TaskAction
    fun build() {
        val directory = workingDirectory.get().asFile
        val target = output.get().asFile
        target.parentFile.mkdirs()
        val (code, text) =
            run(listOf("theme", shown(recipe.get().asFile, directory), "--out=${target.absolutePath}"), directory)
        if (code != 0) throw GradleException("The theme could not be built:\n\n$text")
        logger.info(text)
    }
}

/**
 * `lotekManifest`: the manifest with the fragments, for the editor and the
 * language server.
 *
 * The file is written only when the project has fragments. The language
 * server and the IntelliJ plugin prefer `build/lotek/manifest.json` over the
 * manifest in the npm package, so a file without fragments would only be a
 * copy of the package's, and it stayed behind when the package was updated.
 * If the last fragment is removed, the file is deleted, otherwise the editor
 * would still accept the classes of a component that no longer exists.
 */
abstract class LotekManifest : DefaultTask() {
    @get:InputFiles
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val manifests: ConfigurableFileCollection

    @get:OutputFile
    abstract val output: RegularFileProperty

    @get:Internal
    abstract val workingDirectory: DirectoryProperty

    @TaskAction
    fun write() {
        val directory = workingDirectory.get().asFile
        if (manifests.isEmpty) {
            val old = output.get().asFile
            if (old.exists() && !old.delete()) throw GradleException("Could not delete ${old.absolutePath}.")
            return
        }
        val args = buildList {
            add("manifest")
            manifests.files.sorted().forEach { add("--manifest=${shown(it, directory)}") }
            add("--out=${output.get().asFile.absolutePath}")
        }
        val (code, text) = run(args, directory)
        if (code != 0) throw GradleException("The manifest could not be written:\n\n$text")
        logger.info(text)
    }
}
