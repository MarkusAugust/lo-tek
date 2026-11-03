package no.lotek.intellij.kotlin

import com.intellij.codeInsight.template.TemplateManager
import com.intellij.codeInsight.template.impl.TemplateManagerImpl
import com.intellij.codeInsight.template.impl.TemplateSettings
import com.intellij.lang.annotation.HighlightSeverity

/**
 * The Kotlin live templates: one per page with a Kotlin tab, and each one
 * compiles where it is inserted, at the top level of a file, with the names
 * from LO-TEK shortened to imports.
 */
class KotlinLiveTemplateTest : KotlinTestCase() {
    private val templates get() = TemplateSettings.getInstance().templates.filter { it.groupName == "LO-TEK Kotlin" }

    fun `test there is a template for every Kotlin tab`() {
        val names = templates.map { it.key }.sorted()
        assertEquals(listOf("ltdialog", "lterrorsummary", "ltfield", "ltpopover", "ltsessiontimeout", "ltsuggestion", "lttabs"), names)
    }

    fun `test every template compiles where it is inserted, with the ids empty`() {
        TemplateManagerImpl.setTemplateTesting(testRootDisposable)
        for (template in templates) {
            kotlin("<caret>")
            TemplateManager.getInstance(project).startTemplate(myFixture.editor, template)
            val text = myFixture.editor.document.text
            val errors = myFixture.doHighlighting().filter { it.severity == HighlightSeverity.ERROR }.map { it.description }
            assertTrue("${template.key} does not compile: $errors\n$text", errors.isEmpty())
            assertFalse("${template.key} has a name from LO-TEK in full: $text", text.contains("no.lotek.Lt."))
            assertFalse("${template.key} fills in an id: $text", Regex("""\b(id|titleId) = "[^"]""").containsMatchIn(text))
        }
    }

    fun `test a template next to kotlinx_html's own InputType still compiles`() {
        TemplateManagerImpl.setTemplateTesting(testRootDisposable)
        // The imports a kotlinx.html file has, as the description asks, and a
        // use of kotlinx.html's own InputType that an import of LO-TEK's
        // InputType would shadow.
        myFixture.configureByText(
            "Page.kt",
            """
            |import kotlinx.html.*
            |import no.lotek.html.*
            |
            |fun FlowContent.search() { input(type = InputType.search) }
            |
            |<caret>
            """.trimMargin(),
        )
        TemplateManager.getInstance(project).startTemplate(myFixture.editor, templates.first { it.key == "ltfield" })
        val errors = myFixture.doHighlighting().filter { it.severity == HighlightSeverity.ERROR }.map { it.description }
        assertTrue("$errors\n${myFixture.editor.document.text}", errors.isEmpty())
    }
}
