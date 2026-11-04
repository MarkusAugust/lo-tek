package no.lotek.intellij.kotlin

/**
 * What the Kotlin plugin already completes in a call to a builder function,
 * without this plugin: the values of an option without the type name, and the
 * options as named arguments. The plan was to build both, and the platform
 * has them, so they are tested here rather than built. Read from the platform
 * when the test runs, so a Kotlin plugin that changes it fails here.
 */
class PlatformCompletionTest : KotlinTestCase() {
    fun `test the values of an option are offered without the type name, and inserted qualified`() {
        kotlin("fun FlowContent.x() { button { lt(Lt.button(variant = SECO<caret>)) } }")
        val offered = myFixture.completeBasic()?.map { it.lookupString }
        // One match is inserted at once, and then there is no list.
        if (offered != null) {
            assertTrue("offered $offered", "SECONDARY" in offered)
            myFixture.lookup.currentItem = myFixture.lookupElements!!.first { it.lookupString == "SECONDARY" }
            myFixture.finishLookup('\n')
        }
        val text = myFixture.editor.document.text
        assertTrue("inserted: $text", "Lt.button(variant = ButtonVariant.SECONDARY)" in text)
    }

    fun `test the options are offered as named arguments`() {
        kotlin("fun FlowContent.x() { val f = Lt.field(<caret>) }")
        val offered = myFixture.completeBasic()?.map { it.lookupString }.orEmpty()
        for (option in listOf("id =", "error =", "invalid =", "describedBy =")) {
            assertTrue("$option is not offered: $offered", option in offered)
        }
    }
}
