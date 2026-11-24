package no.lotek.intellij

import com.intellij.lang.documentation.ide.IdeDocumentationTargetProvider
import com.intellij.platform.backend.documentation.impl.computeDocumentationBlocking
import com.intellij.psi.PsiDocumentManager
import com.intellij.psi.impl.source.tree.injected.InjectedLanguageUtil
import com.intellij.testFramework.fixtures.BasePlatformTestCase

/**
 * That Quick Documentation on a class in a class attribute shows what the
 * core says about it, as HTML.
 *
 * The documentation is looked up the way the action does it: the platform is
 * asked for the targets at the caret, in the injected fragment when there is
 * one, and each target for its documentation. Which extension point the
 * plugin answers through is not this test's business.
 */
class QuickDocumentationTest : BasePlatformTestCase() {
    /** The documentation the platform finds at the caret, one text per target. */
    private fun documentation(
        fileName: String,
        content: String,
    ): List<String> {
        myFixture.configureByText(fileName, content)
        PsiDocumentManager.getInstance(project).commitAllDocuments()
        // In a Kotlin string the HTML is a fragment with an editor of its own.
        val editor = InjectedLanguageUtil.getEditorForInjectedLanguageNoCommit(myFixture.editor, myFixture.file)
        val file = PsiDocumentManager.getInstance(project).getPsiFile(editor.document)!!
        return IdeDocumentationTargetProvider
            .getInstance(project)
            .documentationTargets(editor, file, editor.caretModel.offset)
            .mapNotNull { computeDocumentationBlocking(it.createPointer())?.html }
    }

    /** What only LO-TEK says: the IDE has documentation of its own for HTML. */
    private fun List<String>.ofLotek() = filter { "lo-tek.sobernetics.no" in it }

    private fun inKotlin(html: String) =
        """
        // language=HTML
        val view = ""${'"'}
            $html
        ""${'"'}
        """.trimIndent()

    private fun assertDivider(found: List<String>) {
        val html = found.ofLotek().singleOrNull() ?: error("one text about the class from LO-TEK, got $found")
        assertTrue("the title in bold, got $html", Regex("<(b|strong)>Divider</(b|strong)>").containsMatchIn(html))
        assertTrue("the description, got $html", "A line between parts of the content. A CSS component with one class and no JavaScript." in html)
        assertTrue("the attribute and its values, got $html", Regex("<code>data-variant</code>: subtle, strong \\(default without the attribute\\)").containsMatchIn(html))
        assertTrue("a link to the page, got $html", Regex("<a href=\"https://lo-tek\\.sobernetics\\.no/components/divider/\"[^>]*>Documentation</a>").containsMatchIn(html))
        // As HTML, not as the Markdown the core writes.
        assertFalse("Markdown left in the text: $html", "**" in html || "`" in html || "](" in html)
    }

    fun `test a class in a class attribute`() {
        assertDivider(documentation("test.html", """<hr class="lt-div<caret>ider">"""))
    }

    fun `test a class among others`() {
        assertDivider(documentation("test.html", """<hr class="my-own lt-divider<caret> wide">"""))
    }

    fun `test a class in HTML injected into a Kotlin string`() {
        assertDivider(documentation("View.kt", inKotlin("""<hr class="lt-div<caret>ider">""")))
    }

    fun `test a class in HTML injected into a Kotlin string, asked from the Kotlin file`() {
        // What the action has to begin with is the editor and the file the
        // user is in, not the fragment: the platform is handed those, and
        // has to reach the HTML in the string by itself.
        myFixture.configureByText("View.kt", inKotlin("""<hr class="lt-div<caret>ider">"""))
        PsiDocumentManager.getInstance(project).commitAllDocuments()
        val found =
            IdeDocumentationTargetProvider
                .getInstance(project)
                .documentationTargets(myFixture.editor, myFixture.file, myFixture.editor.caretModel.offset)
                .mapNotNull { computeDocumentationBlocking(it.createPointer())?.html }
        assertDivider(found)
    }

    fun `test a class in the HTML of a template file`() {
        // A file in a template language has HTML under it, and its own
        // language on top: the file the platform hands over is not an HTML
        // file, and the class in it is as much a class.
        val answered =
            listOf("page.jsp", "page.ftl", "page.vm").associateWith { name ->
                documentation(name, """<main><hr class="lt-div<caret>ider"></main>""").ofLotek()
            }
        val silent = answered.filterValues { it.isEmpty() }.keys
        assertTrue("documentation for the class in every template file, none in $silent", silent.isEmpty())
        answered.values.forEach(::assertDivider)
    }

    fun `test nothing for the same word in running text`() {
        val found = documentation("test.html", """<p>Use lt-div<caret>ider here</p>""")
        assertTrue("nothing from LO-TEK, got $found", found.ofLotek().isEmpty())
    }

    fun `test nothing for the same word in another attribute`() {
        val found = documentation("test.html", """<hr id="lt-div<caret>ider">""")
        assertTrue("nothing from LO-TEK, got $found", found.ofLotek().isEmpty())
    }

    fun `test nothing for a class LO-TEK does not have`() {
        val found = documentation("test.html", """<hr class="lt-div<caret>idr">""")
        assertTrue("nothing from LO-TEK, got $found", found.ofLotek().isEmpty())
    }

    fun `test nothing in a file that is not HTML`() {
        // The same markup, written in a note: the class is text there, and
        // the plugin has nothing to say in a file of another kind.
        val files =
            mapOf(
                "notes.txt" to """Write <hr class="lt-div<caret>ider"> here""",
                "page.md" to """Write `<hr class="lt-div<caret>ider">` here""",
                "data.json" to """{"html": "<hr class=\"lt-div<caret>ider\">"}""",
                "view.xml" to """<note>Write &lt;hr class="lt-div<caret>ider"&gt; here</note>""",
            )
        val answered = files.filter { (name, content) -> documentation(name, content).ofLotek().isNotEmpty() }.keys
        assertTrue("nothing from LO-TEK in a file that is not HTML, got documentation in $answered", answered.isEmpty())
    }

    fun `test nothing in a Kotlin string that is not marked as HTML`() {
        // A raw string, so the markup stands as it would in HTML, and no
        // comment or annotation says it is HTML.
        val found = documentation("View.kt", "val s = \"\"\"<hr class=\"lt-div<caret>ider\">\"\"\"\n")
        assertTrue("nothing from LO-TEK in a plain string, got $found", found.ofLotek().isEmpty())
    }

    /** The manifest in the package with `lt-divider` replaced by `lt-skille`, as after `lotek takeover`. */
    private val takenOver =
        java.io.File(System.getProperty("manifest")).readText().replace("\"lt-divider\": {", "\"lt-skille\": {")

    fun `test a class only the project's manifest has`() {
        myFixture.addFileToProject("build/lotek/manifest.json", takenOver)
        assertDivider(documentation("test.html", """<hr class="lt-ski<caret>lle">"""))
        val gone = documentation("other.html", """<hr class="lt-div<caret>ider">""")
        assertTrue("lt-divider is not in the project's manifest, got $gone", gone.ofLotek().isEmpty())
    }

    fun `test the project's manifest in an injected fragment`() {
        myFixture.addFileToProject("node_modules/@lo-tek/interfaces/manifest/manifest.json", takenOver)
        assertDivider(documentation("View.kt", inKotlin("""<hr class="lt-ski<caret>lle">""")))
        val gone = documentation("Other.kt", inKotlin("""<hr class="lt-div<caret>ider">"""))
        assertTrue("lt-divider is not in the project's manifest, got $gone", gone.ofLotek().isEmpty())
    }

    fun `test a manifest the core cannot read gives the package's documentation`() {
        myFixture.addFileToProject("build/lotek/manifest.json", "{}")
        assertDivider(documentation("test.html", """<hr class="lt-div<caret>ider">"""))
    }
}
