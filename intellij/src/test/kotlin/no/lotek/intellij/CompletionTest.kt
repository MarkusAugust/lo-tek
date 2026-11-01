package no.lotek.intellij

import com.intellij.testFramework.fixtures.BasePlatformTestCase

/**
 * That the classes are suggested where they should be, and nothing is
 * suggested where they should not be.
 *
 * The plugin exists because `web-types.json` gives completion in HTML files,
 * but not in HTML injected into a string. The tests cover both: that
 * completion works in an ordinary file, and that it works in a fragment.
 */
class CompletionTest : BasePlatformTestCase() {
    /**
     * The suggestions completion gives at this place.
     *
     * If there is only one match, IntelliJ inserts it at once and closes the
     * list, and then `lookupElementStrings` is null. That is not the same as
     * nothing being suggested, so the one match is read from the document
     * instead. Without this, a successful autocompletion looked like an empty
     * list, and the test failed correct code.
     */
    private fun suggestions(
        fileName: String,
        content: String,
    ): List<String> {
        myFixture.configureByText(fileName, content)
        val elements = myFixture.completeBasic()

        myFixture.lookupElementStrings?.let { return it }
        if (elements != null) return elements.map { it.lookupString }

        /*
         * `completeBasic` returns null when it inserted the one match itself.
         *
         * Then the list is closed, and what was inserted must be read from
         * the document. The text before the caret is compared with what was
         * there before: if it is unchanged, nothing happened, and that is not
         * the same as a suggestion. Without that comparison the helper
         * reported the user's own text as if the plugin had delivered it.
         */
        val before = content.substringBefore("<caret>").takeLastWhile { !it.isWhitespace() && it != '"' && it != '\'' }
        val text = myFixture.editor.document.text
        val end = myFixture.editor.caretModel.offset
        val start = text.lastIndexOfAny(charArrayOf(' ', '"', '\'', '\n', '='), end - 1) + 1
        val after = text.substring(start, end)

        return if (after != before && after.startsWith("lt-")) listOf(after) else emptyList()
    }

    fun `test suggests classes in an ordinary HTML file`() {
        val out = suggestions("test.html", """<button class="lt-<caret>">Save</button>""")
        assertTrue("lt-button should be included, got $out", out.contains("lt-button"))
        assertTrue("lt-table should be included", out.contains("lt-table"))
    }

    fun `test finds the right class from a longer prefix`() {
        val out = suggestions("test.html", """<table class="lt-tab<caret>">""")
        assertTrue("lt-table should be included, got $out", out.contains("lt-table"))
    }

    fun `test finds the second class in a value with several`() {
        val out = suggestions("test.html", """<button class="my-own lt-but<caret>">""")
        assertTrue("lt-button should be included, got $out", out.contains("lt-button"))
    }

    /*
     * That the prefix actually filters, not just that something comes out.
     *
     * Without this, all the tests passed even when completion listed the
     * whole list regardless of what was before the caret. It tells «found
     * the right class» apart from «found all classes, and one of them was
     * right».
     */
    fun `test filters on what is already typed`() {
        val all = suggestions("test.html", """<button class="lt-<caret>">""")
        val narrow = suggestions("test.html", """<button class="lt-tab<caret>">""")

        assertTrue("lt- should give the whole list, got ${all.size}", all.size > 50)
        assertTrue("lt-tab should give fewer, got ${narrow.size}", narrow.size < all.size)
        assertTrue("lt-table should be among them", narrow.contains("lt-table"))
        assertFalse("lt-button should not be included", narrow.contains("lt-button"))
    }

    fun `test suggests nothing outside a class value`() {
        val out = suggestions("test.html", """<button id="lt-<caret>">""")
        assertFalse("should not suggest in id, got $out", out.contains("lt-button"))
    }

    fun `test works on an unquoted value`() {
        // An unquoted value is valid HTML. When only quotes counted,
        // `class=lt-` gave nothing.
        val out = suggestions("test.html", """<div class=lt-tab<caret>""")
        assertTrue("lt-table should be included, got $out", out.contains("lt-table"))
    }

    fun `test suggests nothing in a bound class attribute`() {
        /*
         * Vue and Alpine take a JavaScript expression in `:class` and
         * `x-bind:class`. A bare `lt-button` there becomes a variable
         * reference, not a class, so the suggestion would give code that
         * does not work.
         */
        for (attribute in listOf(":class", "x-bind:class", "v-bind:class")) {
            val out = suggestions("test.html", """<div $attribute="lt-<caret>">""")
            assertFalse("should suggest nothing in $attribute, got $out", out.contains("lt-button"))
        }
    }

    fun `test is not fooled by a class equals sign in another value`() {
        // The loop stops at the closing quote, and without the requirement
        // that `=` stands right before the name, the `=` from the value's
        // content was left.
        val out = suggestions("test.html", """<div title="class=" lt-<caret>""")
        assertFalse("should not suggest here, got $out", out.contains("lt-button"))
    }

    fun `test suggests nothing in plain text`() {
        val out = suggestions("test.html", """<p>lt-<caret></p>""")
        assertFalse("should not suggest in body text, got $out", out.contains("lt-button"))
    }

    fun `test suggests nothing in text right after a closed tag`() {
        /*
         * The tag is closed, so the caret is in content and not in an
         * attribute.
         *
         * Without the check that the tag is open, the code finds `class=`
         * further back in the same tag, and sees no whitespace between it and
         * the caret. The test above does not catch this: there is no `=` at
         * all there, so it stops for another reason.
         */
        val out = suggestions("test.html", """<div class="a">lt-<caret>""")
        assertFalse("should not suggest after a closed tag, got $out", out.contains("lt-button"))
    }

    fun `test suggests in HTML injected into a Kotlin string`() {
        // This is the whole reason the plugin exists. `language=HTML` is
        // IntelliJ's comment-based injection and gives the same fragment as
        // @Language("HTML").
        val out =
            suggestions(
                "View.kt",
                """
                // language=HTML
                val table = ""${'"'}
                    <table class="lt-<caret>">
                ""${'"'}
                """.trimIndent(),
            )
        assertTrue("lt-table should be included in an injected string, got $out", out.contains("lt-table"))
    }

    /** The manifest in the package with `lt-card` replaced by `lt-claim`, as after `lotek takeover`. */
    private val takenOver =
        java.io.File(System.getProperty("manifest")).readText().replace("\"lt-card\": {", "\"lt-claim\": {")

    fun `test suggests the classes in the project's manifest`() {
        // The same manifest the check runs against (DiagnosticsTest), so
        // completion does not suggest lt-card right before the annotator
        // underlines it. It used to read the package's manifest always.
        myFixture.addFileToProject("build/lotek/manifest.json", takenOver)
        val out = suggestions("test.html", """<div class="lt-<caret>">""")
        assertTrue("lt-claim should be included, got $out", out.contains("lt-claim"))
        assertFalse("lt-card should not be included, got $out", out.contains("lt-card"))
    }

    fun `test suggests from the project's manifest in an injected fragment`() {
        myFixture.addFileToProject("node_modules/@lo-tek/interfaces/manifest/manifest.json", takenOver)
        val out =
            suggestions(
                "View.kt",
                """
                // language=HTML
                val card = ""${'"'}
                    <div class="lt-<caret>">
                ""${'"'}
                """.trimIndent(),
            )
        assertTrue("lt-claim should be included in an injected string, got $out", out.contains("lt-claim"))
        assertFalse("lt-card should not be included, got $out", out.contains("lt-card"))
    }

    fun `test a manifest the core cannot read gives the package's classes`() {
        myFixture.addFileToProject("build/lotek/manifest.json", "{}")
        val out = suggestions("test.html", """<div class="lt-<caret>">""")
        assertTrue("lt-button should be included, got $out", out.contains("lt-button"))
    }

    fun `test the catalogue has the classes from the package`() {
        assertTrue("the catalogue should not be empty", Catalogue.classes.isNotEmpty())
        assertNotNull("lt-button should exist", Catalogue.find("lt-button"))
        assertNull("an invented class should not exist", Catalogue.find("lt-modal"))
    }

    fun `test every class has a component and a link`() {
        val without = Catalogue.classes.filter { it.component.isEmpty() || it.link.isEmpty() }
        assertTrue("all should have a component name and a link, missing: $without", without.isEmpty())
    }
}
