package no.lotek.intellij

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.intellij.openapi.application.runWriteAction
import com.intellij.openapi.vfs.VfsUtil
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.psi.PsiManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase

/**
 * Every case in `cli/manifest-lookup.json`, which the language server builds
 * too (`finds_the_manifest_the_shared_table_says` in `cli/src/lsp.rs`), so
 * the two give the same answer.
 */
class ManifestLookupTest : BasePlatformTestCase() {
    /** What a case put beside the project, which the fixture does not clear away. */
    private val beside = mutableListOf<VirtualFile>()

    override fun tearDown() {
        try {
            clear()
        } finally {
            super.tearDown()
        }
    }

    private fun clear() {
        val project = myFixture.tempDirFixture.getFile("")!!
        runWriteAction {
            for (file in project.children + beside) if (file.isValid) file.delete(this)
        }
        beside.clear()
    }

    /** The file at [path] from the project directory, where `../` is beside it. A folder when [content] is null. */
    private fun place(
        path: String,
        content: String?,
    ): VirtualFile {
        val project = myFixture.tempDirFixture.getFile("")!!
        val outside = path.removePrefix("../")
        val from = if (outside == path) project else project.parent
        return runWriteAction {
            if (from != project) VfsUtil.createDirectoryIfMissing(from, outside.substringBefore('/')).also(beside::add)
            if (content == null) {
                VfsUtil.createDirectoryIfMissing(from, outside)
            } else {
                val folder = VfsUtil.createDirectoryIfMissing(from, outside.substringBeforeLast('/', ""))
                folder.createChildData(this, outside.substringAfterLast('/')).also { VfsUtil.saveText(it, content) }
            }
        }
    }

    /** The manifest in the package with `lt-card` replaced by a class only manifest [number] has. */
    private fun manifest(number: Int): String =
        java.io.File(System.getProperty("manifest")).readText().replace("\"lt-card\": {", "\"lt-claim-$number\": {")

    private fun JsonObject.paths(key: String): List<String> = getAsJsonArray(key)?.map { it.asString }.orEmpty()

    fun `test finds the manifest the shared table says`() {
        val table = JsonParser.parseString(java.io.File(System.getProperty("manifestLookup")).readText()).asJsonObject
        val cases = table.getAsJsonArray("cases").map { it.asJsonObject }
        for (case in cases) {
            val name = case.get("name").asString
            val manifests = case.paths("manifests")
            manifests.forEachIndexed { number, path -> place(path, manifest(number)) }
            case.paths("folders").forEach { place(it, null) }
            val document = place(case.get("document").asString, "<div></div>")

            val text = ProjectManifest.forFile(PsiManager.getInstance(project).findFile(document)!!)
            val applied = manifests.filterIndexed { number, _ -> text?.contains("\"lt-claim-$number\"") == true }
            val expected = listOfNotNull(case.get("expect").takeUnless { it.isJsonNull }?.asString)
            assertEquals(name, expected, applied)
            clear()
        }
        assertTrue("the table has lost cases: ${cases.size}", cases.size >= 10)
    }

    fun `test a page in one module does not get the manifest of the module beside it`() {
        // A module is a content root inside the project directory. The table
        // has one root, as the language server usually gets one workspace, so
        // this is checked here.
        val web = place("apps/web", null)
        com.intellij.testFramework.PsiTestUtil.addContentRoot(module, web)
        try {
            place("apps/web/build/lotek/manifest.json", manifest(0))
            val page = place("apps/admin/page.html", "<div></div>")
            assertNull(ProjectManifest.forFile(PsiManager.getInstance(project).findFile(page)!!))
            val beside = place("../notes/a.html", "<div></div>")
            val text = ProjectManifest.forFile(PsiManager.getInstance(project).findFile(beside)!!)
            assertTrue("a file under no root gets the module's manifest", text?.contains("\"lt-claim-0\"") == true)
        } finally {
            com.intellij.testFramework.PsiTestUtil.removeContentEntry(module, web)
        }
    }
}
