package no.lotek.intellij

import com.intellij.codeInspection.LocalInspectionEP
import com.intellij.codeInspection.ex.LocalInspectionToolWrapper
import com.intellij.lang.annotation.HighlightSeverity
import com.intellij.openapi.application.PathManager
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.vfs.newvfs.impl.VfsRootAccess
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.jetbrains.jsonSchema.ide.JsonSchemaService
import java.io.File

/**
 * That the recipe file, `lotek.theme.json`, is completed and checked against
 * the schema of the recipe by the IDE's own JSON support, with the plugin
 * and nothing else: no `${'$'}schema` in the file and no mapping in the settings.
 *
 * The schema is the one in the npm package, and what the tests ask the IDE
 * is what a user sees: the finding on an unknown key, the keys in
 * completion, and which file the IDE holds the recipe to.
 */
class ThemeSchemaTest : BasePlatformTestCase() {
    private val typo = "{\n  \"acent\": \"#7c3aed\"\n}\n"

    override fun setUp() {
        super.setUp()
        // Read from source: the inspection that reports what a schema does
        // not allow is `JsonSchemaCompliance`, in META-INF/plugin.xml of
        // plugins/json/lib/json.jar in the IDE. A test fixture runs no
        // inspection it is not asked for, also one that is on by default.
        val compliance = LocalInspectionEP.LOCAL_INSPECTION.extensionList.find { it.shortName == "JsonSchemaCompliance" }
        assertNotNull("the IDE under test has no JSON support with a schema inspection", compliance)
        myFixture.enableInspections(LocalInspectionToolWrapper(compliance!!).tool)
        // The schema is read from the plugin's own jar, and the tests refuse
        // to read a file outside the folders they know. The user's home is
        // one of them, so this only matters in a checkout that is not there.
        VfsRootAccess.allowRootAccess(testRootDisposable, PathManager.getPluginsPath())
    }

    /** The findings in the file, as the text they cover and the message. */
    private fun findings(
        path: String,
        content: String,
    ): List<Pair<String, String>> {
        myFixture.configureFromExistingVirtualFile(myFixture.addFileToProject(path, content).virtualFile)
        val text = myFixture.editor.document.text
        return myFixture.doHighlighting(HighlightSeverity.WARNING).map { text.substring(it.startOffset, it.endOffset) to it.description }
    }

    /** The schemas the IDE holds the file to. */
    private fun schemas(file: VirtualFile): Collection<VirtualFile> = JsonSchemaService.Impl.get(project).getSchemaFilesForFile(file)

    fun `test reports an unknown key in the recipe, on the key`() {
        val out = findings("lotek.theme.json", typo)
        assertEquals("one finding, got $out", 1, out.size)
        assertEquals("\"acent\"", out.single().first)
        assertTrue("the finding should name the key, got $out", out.single().second.contains("acent"))
    }

    fun `test says nothing about a recipe that is right`() {
        val out =
            findings(
                "lotek.theme.json",
                """{"accent": "#7c3aed", "typography": {"weights": {"bold": 700}}, "shape": {"buttonRadius": "1rem", "fieldRadius": 0}}""",
            )
        assertTrue("no findings, got $out", out.isEmpty())
    }

    fun `test reports a colour that is not a colour`() {
        // The schema is read as the draft it is written in, patterns
        // included, and not only for its keys.
        val out = findings("lotek.theme.json", """{"accent": "purple"}""")
        assertEquals("one finding, got $out", 1, out.size)
        assertEquals("\"purple\"", out.single().first)
    }

    fun `test a file with another name is not a recipe`() {
        for (name in listOf("theme.json", "my-lotek.theme.json", "lotek.theme.json5")) {
            val out = findings(name, typo)
            assertTrue("$name: no findings, got $out", out.isEmpty())
            assertTrue("$name is held to ${schemas(myFixture.file.virtualFile)}", schemas(myFixture.file.virtualFile).isEmpty())
        }
    }

    fun `test the recipe is a recipe in any folder`() {
        val out = findings("config/themes/lotek.theme.json", typo)
        assertEquals("one finding, got $out", 1, out.size)
    }

    fun `test completion offers the keys of the recipe`() {
        myFixture.configureByText("lotek.theme.json", "{\n  \"<caret>\"\n}\n")
        val offered = myFixture.completeBasic().map { it.lookupString.trim('"') }
        assertTrue("found $offered", offered.containsAll(listOf("accent", "neutral", "typography", "shape")))
        assertFalse("a key the recipe does not have is offered: $offered", offered.contains("acent"))

        myFixture.configureByText("lotek.theme.json", "{\"shape\": {\"<caret>\"}}")
        val nested = myFixture.completeBasic().map { it.lookupString.trim('"') }
        assertTrue("found $nested", nested.containsAll(listOf("buttonRadius", "fieldRadius", "surfaceRadius", "buttonBorderWidth", "buttonFontWeight")))
    }

    fun `test the schema is the one in the npm package`() {
        // A copy kept by hand in the plugin would be a second schema to keep
        // right. The IDE is asked which file it holds the recipe to, so the
        // test follows the schema wherever the build puts it.
        myFixture.configureByText("lotek.theme.json", "{}")
        val held = schemas(myFixture.file.virtualFile)
        assertEquals("the recipe should be held to one schema, got $held", 1, held.size)
        // The package is where the manifest the tests are given is.
        val inThePackage = File(System.getProperty("manifest")).parentFile.parentFile.resolve("src/tokens/theme.schema.json")
        assertTrue("the schema in the plugin is not $inThePackage, byte for byte", held.single().contentsToByteArray().contentEquals(inThePackage.readBytes()))
    }
}
