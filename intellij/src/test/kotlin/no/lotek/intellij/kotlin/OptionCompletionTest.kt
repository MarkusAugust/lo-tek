package no.lotek.intellij.kotlin

import com.intellij.codeInsight.lookup.LookupElementPresentation

class OptionCompletionTest : KotlinTestCase() {
    private fun tail(option: String): String? {
        val element = myFixture.lookupElements?.firstOrNull { it.lookupString == option } ?: return null
        return LookupElementPresentation.renderElement(element).tailText
    }

    fun `test an option of a builder function has its description and default`() {
        kotlin("fun FlowContent.x() { button { lt(Lt.button(<caret>)) } }")
        myFixture.completeBasic()
        val tail = tail("variant =")
        assertNotNull("variant = was not offered: ${myFixture.lookupElementStrings}", tail)
        assertTrue("the tail was $tail", tail!!.contains("How weighty the action is. Default: primary"))
    }

    fun `test the other suggestions are all still there`() {
        kotlin("fun FlowContent.x() { val f = Lt.field(<caret>) }")
        val offered = myFixture.completeBasic()?.map { it.lookupString }.orEmpty()
        // Local names and Kotlin's own keywords stay, next to the options.
        for (expected in listOf("id =", "invalid =", "buildString", "if")) assertTrue("$expected is gone: $offered", expected in offered)
    }

    fun `test a call to something else gets nothing`() {
        kotlin(
            """
            fun other(variant: String = "") = variant
            fun FlowContent.x() { other(<caret>) }
            """.trimIndent(),
        )
        myFixture.completeBasic()
        val tail = tail("variant =").orEmpty()
        assertFalse("a description on another function's argument: $tail", tail.contains("How weighty"))
    }
}
