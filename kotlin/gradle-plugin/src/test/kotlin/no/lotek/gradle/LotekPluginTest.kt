package no.lotek.gradle

import no.lotek.cli.CommandLine
import org.gradle.testkit.runner.GradleRunner
import org.gradle.testkit.runner.TaskOutcome
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * The plugin in a real, small project, run by Gradle itself. What is tested
 * is what a user notices: that `check` fails on a mistake in a template and
 * says where, that the theme and the manifest are written, and that a
 * taken-over component is checked against its fragment.
 */
class LotekPluginTest {
    private val project: File = Files.createTempDirectory("lotek-gradle-").toFile()

    private fun file(path: String, content: String) =
        File(project, path).apply {
            parentFile.mkdirs()
            writeText(content)
        }

    private fun gradle(vararg args: String) =
        GradleRunner.create().withProjectDir(project).withPluginClasspath().withArguments(*args, "--stacktrace")

    private fun setUp(extra: String = "") {
        file("settings.gradle.kts", "rootProject.name = \"app\"\n")
        file(
            "build.gradle.kts",
            """
            plugins {
                base
                id("io.github.markusaugust.lo-tek")
            }

            lotek {
                templates.from(fileTree("templates"))
                $extra
            }
            """.trimIndent(),
        )
    }

    @Test
    fun `check fails on a template with a mistake, and says where`() {
        setUp()
        file("templates/form.html", "<form>\n  <button class=\"lt-buton\">Send</button>\n</form>\n")

        val failed = gradle("check").buildAndFail()
        assertContains(failed.output, "The markup does not match LO-TEK:")
        val finding = failed.output.lines().first { it.startsWith("templates/form.html:2:18: warning: ") }
        assertContains(finding, "lt-buton")
        assertContains(finding, "lt-button?")
        assertEquals(TaskOutcome.FAILED, failed.task(":lotekCheck")?.outcome)

        file("templates/form.html", "<form>\n  <button class=\"lt-button\">Send</button>\n</form>\n")
        val passed = gradle("check").build()
        assertEquals(TaskOutcome.SUCCESS, passed.task(":lotekCheck")?.outcome)
        assertEquals(TaskOutcome.UP_TO_DATE, gradle("check").build().task(":lotekCheck")?.outcome)
    }

    @Test
    fun `without templates there is nothing to check`() {
        setUp()
        assertEquals(TaskOutcome.NO_SOURCE, gradle("lotekCheck").build().task(":lotekCheck")?.outcome)
    }

    @Test
    fun `builds the theme from the recipe`() {
        setUp("themeRecipe = file(\"lotek.theme.json\")")
        file("lotek.theme.json", "{\"accent\": \"#7c3aed\", \"danger\": \"#b3261e\"}\n")

        gradle("lotekTheme").build()
        val theme = File(project, "build/lotek/theme.css").readText()
        assertContains(theme, "--lt-color-accent-fill")

        file("lotek.theme.json", "{\"accent\": \"purple\"}\n")
        assertContains(gradle("lotekTheme").buildAndFail().output, "hexadecimal")
    }

    @Test
    fun `the theme task shows what became of the brand colours`() {
        // At the log level a build has when nobody asks for another one: the
        // brand colour was moved, and the one who gave it must not need
        // `--info` to be told.
        setUp("themeRecipe = file(\"lotek.theme.json\")")
        file("lotek.theme.json", "{\"accent\": \"#7c3aed\"}\n")

        val lines = gradle("lotekTheme").build().output.lines()
        assertContains(lines, "accent: #7c3aed gives the fill #7935e9 in the light theme and #986eff in the dark theme.")
        assertTrue(
            lines.any { it.startsWith("Wrote ") && it.endsWith("theme.css. 83 colours in each theme, every promise holds.") },
            "the build does not show the line about the file:\n${lines.joinToString("\n")}",
        )
    }

    @Test
    fun `the theme is skipped without a recipe`() {
        setUp()
        assertEquals(TaskOutcome.SKIPPED, gradle("lotekTheme").build().task(":lotekTheme")?.outcome)
    }

    @Test
    fun `a taken over component is checked against its fragment, and is in the manifest`() {
        val output = ByteArrayOutputStream()
        val code =
            CommandLine.run(
                listOf("takeover", "button", "--out=src/ui"),
                project,
                ByteArrayInputStream(ByteArray(0)),
                output,
                output,
            )
        assertEquals(0, code, output.toString(Charsets.UTF_8))
        setUp("manifests.from(\"src/ui/button/lotek-manifest.json\")")
        file("templates/page.html", "<button class=\"app-button\" data-variant=\"wrong\">Send</button>\n")

        val finding = gradle("check").buildAndFail().output.lines().first { it.startsWith("templates/page.html:1:") }
        assertContains(finding, "data-variant")
        assertContains(finding, "wrong")

        file("templates/page.html", "<button class=\"app-button\">Send</button>\n")
        gradle("build", "--configuration-cache").build()
        val manifest = File(project, "build/lotek/manifest.json").readText()
        assertContains(manifest, "\"app-button\"")
        assertContains(manifest, "\"lt-button\"")
        assertFalse(manifest.contains("\$schema"))
        assertTrue(gradle("build", "--configuration-cache").build().output.contains("Reusing configuration cache"))

        // Without fragments the package's manifest is the right one, and the
        // file from the previous build must go, or the editor prefers it.
        setUp()
        gradle("build").build()
        assertFalse(File(project, "build/lotek/manifest.json").exists())
    }

    @Test
    fun `without fragments no manifest is written`() {
        setUp()
        file("templates/page.html", "<button class=\"lt-button\">Send</button>\n")
        gradle("build").build()
        assertFalse(File(project, "build/lotek/manifest.json").exists())
    }
}
