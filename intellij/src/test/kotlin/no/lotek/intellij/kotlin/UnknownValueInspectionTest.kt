package no.lotek.intellij.kotlin

class UnknownValueInspectionTest : KotlinTestCase() {
    fun `test of with !! is reported, and the fix throws with the value`() {
        kotlin(
            """
            fun FlowContent.save(requested: String) {
                button { lt(Lt.button(variant = ButtonVariant.of(requested)!!)) }
            }
            """.trimIndent(),
        )
        assertEquals(1, problems(UnknownValueInspection()).size)
        myFixture.editor.caretModel.moveToOffset(myFixture.file.text.indexOf("!!"))
        myFixture.launchAction(myFixture.findSingleIntention("Throw with the value in the message"))
        val text = myFixture.file.text
        assertTrue(text, text.contains("variant = ButtonVariant.of(requested) ?: error(\"Not a ButtonVariant: \${requested}\")"))
    }

    fun `test the fix puts parentheses where the !! was a receiver`() {
        kotlin("fun x(requested: String) = ButtonVariant.of(requested)!!.value")
        myFixture.enableInspections(UnknownValueInspection())
        myFixture.editor.caretModel.moveToOffset(myFixture.file.text.indexOf("!!"))
        myFixture.launchAction(myFixture.findSingleIntention("Throw with the value in the message"))
        assertTrue(myFixture.file.text, myFixture.file.text.contains("(ButtonVariant.of(requested) ?: error(\"Not a ButtonVariant: \${requested}\")).value"))
    }

    fun `test !! on something else is silent`() {
        kotlin(
            """
            object Lookup { fun of(text: String): String? = text }
            fun x(requested: String?) = Lookup.of(requested!!)!!
            """.trimIndent(),
        )
        assertEquals(emptyList<Pair<String, String>>(), problems(UnknownValueInspection()))
    }
}
