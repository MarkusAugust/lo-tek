package no.lotek.intellij

import com.intellij.codeInsight.lookup.LookupElementPresentation
import com.intellij.testFramework.fixtures.BasePlatformTestCase

/**
 * That the values of an attribute are suggested, from the same core the
 * check and the language server ask, and that the plugin leaves the names of
 * elements and attributes to the IDE.
 *
 * `CompletionTest` holds the classes. The values here are the ones
 * `core/editing/cases.json` has for the same markup.
 */
class ValueCompletionTest : BasePlatformTestCase() {
    /** What completion lists at the caret. A list of one is inserted at once, so no case here has one. */
    private fun suggestions(
        fileName: String,
        content: String,
    ): List<String> {
        myFixture.configureByText(fileName, content)
        myFixture.completeBasic()
        return myFixture.lookupElementStrings.orEmpty()
    }

    private fun inKotlin(html: String) =
        """
        // language=HTML
        val view = ""${'"'}
            $html
        ""${'"'}
        """.trimIndent()

    private val divider = listOf("subtle", "strong", "default")
    private val placements = listOf("bottom-start", "bottom-end", "top-start", "top-end")

    fun `test the values of an attribute a class on the tag takes`() {
        val out = suggestions("test.html", """<hr class="lt-divider" data-variant="<caret>">""")
        assertTrue("the values of data-variant on a divider, got $out", out.containsAll(divider))
    }

    fun `test the values of an attribute of an element`() {
        val out = suggestions("test.html", """<lt-popover placement="<caret>"></lt-popover>""")
        assertTrue("the values of placement, got $out", out.containsAll(placements))
    }

    fun `test the values in HTML injected into a Kotlin string`() {
        val ofClass = suggestions("View.kt", inKotlin("""<hr class="lt-divider" data-variant="<caret>">"""))
        assertTrue("the values of data-variant in an injected string, got $ofClass", ofClass.containsAll(divider))
        val ofElement = suggestions("Panel.kt", inKotlin("""<lt-popover placement="<caret>"></lt-popover>"""))
        assertTrue("the values of placement in an injected string, got $ofElement", ofElement.containsAll(placements))
    }

    fun `test no values for an attribute the class does not take`() {
        val out = suggestions("test.html", """<hr class="lt-divider" data-other="<caret>">""")
        assertTrue("nothing of the divider's, got $out", out.none { it in divider })
    }

    fun `test no values without the class that takes the attribute`() {
        val out = suggestions("test.html", """<hr data-variant="<caret>">""")
        assertTrue("nothing of the divider's, got $out", out.none { it in divider })
    }

    /** The manifest in the package with the divider taken over under another name, and one value more. */
    private val takenOver =
        java.io.File(System.getProperty("manifest")).readText().let { text ->
            val at = text.indexOf("\"lt-divider\": {")
            val values = Regex("\"subtle\",\\s*\"strong\"").find(text, at)!!
            check(at >= 0 && values.range.first - at < 2000) { "the divider's values were not found in the manifest" }
            text.replaceRange(values.range, "\"subtle\", \"strong\", \"dotted\"").replace("\"lt-divider\": {", "\"lt-skille\": {")
        }

    fun `test the values the project's manifest has`() {
        myFixture.addFileToProject("build/lotek/manifest.json", takenOver)
        val out = suggestions("test.html", """<hr class="lt-skille" data-variant="<caret>">""")
        assertTrue("the project's values, got $out", out.containsAll(listOf("subtle", "strong", "dotted", "default")))
        val gone = suggestions("other.html", """<hr class="lt-divider" data-variant="<caret>">""")
        assertTrue("lt-divider is not in the project's manifest, got $gone", gone.none { it in divider })
    }

    fun `test the values the project's manifest has, in an injected fragment`() {
        myFixture.addFileToProject("node_modules/@lo-tek/interfaces/manifest/manifest.json", takenOver)
        val out = suggestions("View.kt", inKotlin("""<hr class="lt-skille" data-variant="<caret>">"""))
        assertTrue("the project's values in an injected string, got $out", out.contains("dotted"))
    }

    fun `test the names of the elements are left to the IDE`() {
        // Only the core knows `lt-popover` here: the test project has no
        // web-types, so a suggestion of it is the plugin's.
        for (name in listOf("test.html", "View.kt")) {
            val markup = "<main>\n  <lt-po<caret>"
            val out = suggestions(name, if (name.endsWith(".kt")) inKotlin(markup) else markup)
            assertFalse("no element from the plugin in $name, got $out", out.any { it.startsWith("lt-po") })
        }
    }

    fun `test the names of the attributes are left to the IDE`() {
        for (name in listOf("test.html", "View.kt")) {
            val markup = "<lt-popover <caret>></lt-popover>"
            val out = suggestions(name, if (name.endsWith(".kt")) inKotlin(markup) else markup)
            assertFalse("no attribute from the plugin in $name, got $out", out.contains("server-controlled") || out.contains("placement"))
        }
    }

    fun `test a class has the title of its component beside it`() {
        myFixture.configureByText("test.html", """<hr class="lt-di<caret>">""")
        myFixture.completeBasic()
        val divider = myFixture.lookupElements.orEmpty().firstOrNull { it.lookupString == "lt-divider" }
        assertNotNull("lt-divider should be suggested, got ${myFixture.lookupElementStrings}", divider)
        val shown = LookupElementPresentation.renderElement(divider!!)
        assertTrue(
            "the title Divider beside the class, got type ${shown.typeText} and tail ${shown.tailText}",
            listOfNotNull(shown.typeText, shown.tailText).any { "Divider" in it },
        )
    }
}
