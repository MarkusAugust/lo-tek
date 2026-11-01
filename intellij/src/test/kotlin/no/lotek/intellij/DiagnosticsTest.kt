package no.lotek.intellij

import com.intellij.lang.annotation.HighlightSeverity
import com.intellij.testFramework.fixtures.BasePlatformTestCase

/**
 * That the diagnostics from the core end up in the editor, in the right
 * place, both in an HTML file and in HTML injected into a Kotlin string.
 */
class DiagnosticsTest : BasePlatformTestCase() {
    /** The findings from LO-TEK in the file, as the text they cover and the message. */
    private fun findings(
        fileName: String,
        content: String,
    ): List<Pair<String, String>> {
        myFixture.configureByText(fileName, content)
        val text = myFixture.editor.document.text
        return myFixture.doHighlighting(HighlightSeverity.WARNING)
            .filter { it.toolTip?.contains("LO-TEK:") == true }
            .map { text.substring(it.startOffset, it.endOffset) to it.description }
    }

    fun `test reports an unknown class in an HTML file`() {
        val out = findings("test.html", """<button class="lt-buton">Save</button>""")
        assertEquals("one finding, got $out", 1, out.size)
        assertEquals("lt-buton", out.single().first)
    }

    fun `test reports an icon button without a name in a file without lt-`() {
        // The rule without-name needs no LO-TEK class on a button. The annotator
        // used to skip every file without «lt-» in the text, so `lotek check`
        // and VS Code reported the button while IntelliJ said nothing.
        val out = findings("test.html", """<button><svg aria-hidden="true"></svg></button>""")
        assertEquals("one finding, got $out", 1, out.size)
        assertEquals("button", out.single().first)
    }

    fun `test says nothing about correct markup`() {
        val out = findings("test.html", """<button class="lt-button" data-variant="secondary">Save</button>""")
        assertTrue("no findings, got $out", out.isEmpty())
    }

    fun `test reports in HTML injected into a Kotlin string`() {
        val out =
            findings(
                "View.kt",
                """
                // language=HTML
                val button = ""${'"'}
                    <button class="lt-button" data-variant="sekundær">Save</button>
                ""${'"'}
                """.trimIndent(),
            )
        assertEquals("one finding, got $out", 1, out.size)
        assertTrue("the finding should cover the attribute, got $out", out.single().first.startsWith("data-variant"))
    }

    fun `test suppression with a comment works`() {
        val out =
            findings(
                "test.html",
                """
                <!-- lotek-ignore-next unknown-class -->
                <div class="lt-experiment"></div>
                """.trimIndent(),
            )
        assertTrue("no findings, got $out", out.isEmpty())
    }

    /** The manifest in the package with `lt-card` replaced by `lt-claim`, as after `lotek takeover`. */
    private val takenOver =
        java.io.File(System.getProperty("manifest")).readText().replace("\"lt-card\": {", "\"lt-claim\": {")

    fun `test uses the project's manifest from build-lotek`() {
        myFixture.addFileToProject("build/lotek/manifest.json", takenOver)
        val out = findings("test.html", """<div class="lt-claim">Claim</div><div class="lt-card">Claim</div>""")
        assertEquals("only lt-card should be reported, got $out", listOf("lt-card"), out.map { it.first })
    }

    fun `test searches upwards from the file`() {
        myFixture.addFileToProject("node_modules/@lo-tek/interfaces/manifest/manifest.json", takenOver)
        val file =
            myFixture.addFileToProject(
                "pages/form/page.html",
                """<div class="lt-claim">Claim</div><div class="lt-card">Claim</div>""",
            )
        myFixture.configureFromExistingVirtualFile(file.virtualFile)
        val text = myFixture.editor.document.text
        val out =
            myFixture.doHighlighting(HighlightSeverity.WARNING)
                .filter { it.toolTip?.contains("LO-TEK:") == true }
                .map { text.substring(it.startOffset, it.endOffset) }
        assertEquals("only lt-card should be reported, got $out", listOf("lt-card"), out)
    }

    fun `test uses the project's manifest in an injected fragment`() {
        myFixture.addFileToProject("build/lotek/manifest.json", takenOver)
        val out =
            findings(
                "View.kt",
                """
                // language=HTML
                val card = ""${'"'}
                    <div class="lt-claim">Claim</div><div class="lt-card">Claim</div>
                ""${'"'}
                """.trimIndent(),
            )
        assertEquals("only lt-card should be reported, got $out", listOf("lt-card"), out.map { it.first })
    }

    fun `test a manifest the core cannot read gives the package's`() {
        myFixture.addFileToProject("build/lotek/manifest.json", "{}")
        val out = findings("test.html", """<div class="lt-claim">Claim</div><div class="lt-card">Claim</div>""")
        assertEquals("lt-claim should be reported, got $out", listOf("lt-claim"), out.map { it.first })
    }

    fun `test a fix with several edits is applied as one`() {
        // The fix that gives the field the id «email» writes id on the field
        // and for on the label.
        myFixture.configureByText(
            "test.html",
            """<lt-field><label class="lt-label">Email</label><inp<caret>ut class="lt-input" name="email"></lt-field>""",
        )
        val fixes = myFixture.availableIntentions.filter { it.familyName == "LO-TEK" }
        assertTrue("the core should suggest a fix, got ${myFixture.availableIntentions.map { it.text }}", fixes.isNotEmpty())
        myFixture.launchAction(fixes.first())
        assertEquals(
            """<lt-field><label for="email" class="lt-label">Email</label><input id="email" class="lt-input" name="email"></lt-field>""",
            myFixture.editor.document.text,
        )
    }

    fun `test a fix in an ordinary string keeps the literal intact`() {
        // The fix inserts quotes. In a "…" string they must be escaped
        // through the host string, otherwise the literal is broken afterwards.
        myFixture.configureByText(
            "View.kt",
            """
            // language=HTML
            val row = "<lt-tabs><u<caret>l class='lt-tabs__list'><li><a href='#a'>A</a></li></ul><section class='lt-tabs__panel' id='a'></section></lt-tabs>"
            """.trimIndent(),
        )
        // The fix is taken from the finding, as in the editor: the intention
        // list the fixture gives sees only the host file.
        val finding = myFixture.doHighlighting().firstOrNull { it.description?.contains("tab list without a name") == true }
        assertNotNull("the core should report the tab list without a name, got ${myFixture.doHighlighting().map { it.description }}", finding)
        var fix: com.intellij.codeInsight.intention.IntentionAction? = null
        finding!!.findRegisteredQuickFix { descriptor, _ ->
            if (descriptor.action.familyName == "LO-TEK") fix = descriptor.action
            null
        }
        assertNotNull("the finding should have a fix", fix)
        // `myFixture.file` is the fragment when the caret is in it; the host
        // file is the one with the literal, and that is where the escaping
        // shows. It is fetched before the fix, since the fragment is created
        // again afterwards.
        val host = com.intellij.lang.injection.InjectedLanguageManager.getInstance(project).getTopLevelFile(myFixture.file)
        myFixture.launchAction(fix!!)
        val text = host.viewProvider.document!!.text
        assertTrue("aria-label should be escaped in the string: $text", text.contains("""<ul aria-label=\"Case sections\" class='lt-tabs__list'>"""))
    }

    fun `test a fix in a string with a template leaves the rest of the string alone`() {
        // `$name` splits the fragment into two parts of the host string. The
        // fix should land in the right part, and nothing else in the string
        // changes.
        myFixture.configureByText(
            "View.kt",
            """
            val name = "x"
            // language=HTML
            val row = "<p>${'$'}name</p><lt-tabs><u<caret>l class='lt-tabs__list'><li><a href='#a'>A</a></li></ul><section class='lt-tabs__panel' id='a'></section></lt-tabs>"
            """.trimIndent(),
        )
        val host = com.intellij.lang.injection.InjectedLanguageManager.getInstance(project).getTopLevelFile(myFixture.file)
        val finding = myFixture.doHighlighting().firstOrNull { it.description?.contains("tab list without a name") == true }
        assertNotNull("the core should report the tab list without a name, got ${myFixture.doHighlighting().mapNotNull { it.description }}", finding)
        var fix: com.intellij.codeInsight.intention.IntentionAction? = null
        finding!!.findRegisteredQuickFix { descriptor, _ ->
            if (descriptor.action.familyName == "LO-TEK") fix = descriptor.action
            null
        }
        assertNotNull("the finding should have a fix", fix)
        myFixture.launchAction(fix!!)
        val text = host.viewProvider.document!!.text
        assertEquals(
            """
            val name = "x"
            // language=HTML
            val row = "<p>${'$'}name</p><lt-tabs><ul aria-label=\"Case sections\" class='lt-tabs__list'><li><a href='#a'>A</a></li></ul><section class='lt-tabs__panel' id='a'></section></lt-tabs>"
            """.trimIndent(),
            text,
        )
    }

    fun `test the fix replaces the text`() {
        myFixture.configureByText("test.html", """<button class="lt-buton<caret>">Save</button>""")
        val fixes = myFixture.availableIntentions.filter { it.familyName == "LO-TEK" }
        assertTrue("the core should suggest a fix, got ${myFixture.availableIntentions.map { it.text }}", fixes.isNotEmpty())
        myFixture.launchAction(fixes.first())
        assertTrue("lt-button should be there now: ${myFixture.editor.document.text}", myFixture.editor.document.text.contains("\"lt-button\""))
    }
}
