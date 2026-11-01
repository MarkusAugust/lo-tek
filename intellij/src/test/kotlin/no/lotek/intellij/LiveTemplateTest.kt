package no.lotek.intellij

import com.intellij.codeInsight.template.TemplateManager
import com.intellij.codeInsight.template.impl.TemplateManagerImpl
import com.intellij.codeInsight.template.impl.TemplateSettings
import com.intellij.testFramework.fixtures.BasePlatformTestCase

/**
 * That the live templates from `interfaces/live-templates.xml` are in the
 * plugin, one per web component, and that the id is a variable mirrored in
 * `for`.
 */
class LiveTemplateTest : BasePlatformTestCase() {
    fun `test has one template per web component`() {
        val templates = TemplateSettings.getInstance().templates.filter { it.groupName == "LO-TEK" }
        val names = templates.map { it.key }.sorted()
        assertTrue("found $names", names.containsAll(listOf("lt-dialog", "lt-field", "lt-popover", "lt-suggestion", "lt-tabs")))
    }

    fun `test the field has the id as a variable, mirrored in for`() {
        val template = TemplateSettings.getInstance().getTemplate("lt-field", "LO-TEK")
        assertNotNull("lt-field is missing", template)
        val text = template!!.string
        assertTrue("the id should be a variable: $text", text.contains("id=\"\$codename\$\""))
        assertTrue("for should mirror it: $text", text.contains("for=\"\$codename\$\""))
        // The form around the field has its own id, and it is a variable too.
        assertTrue("the variables were ${template.variables.map { it.name }}", template.variables.map { it.name }.contains("codename"))
    }

    fun `test the template expands in an HTML file`() {
        TemplateManagerImpl.setTemplateTesting(testRootDisposable)
        myFixture.configureByText("test.html", "<caret>")
        val template = TemplateSettings.getInstance().getTemplate("lt-field", "LO-TEK")!!
        TemplateManager.getInstance(project).startTemplate(myFixture.editor, template)
        val text = myFixture.editor.document.text
        assertTrue("the markup should be there: $text", text.contains("<lt-field>") && text.contains("id=\"codename\""))
        assertFalse("the variable should be replaced: $text", text.contains("\$codename\$"))
    }
}
