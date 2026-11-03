package no.lotek.intellij.kotlin

class WrongElementInspectionTest : KotlinTestCase() {
    private fun problems() = problems(WrongElementInspection())

    fun `test the control on the label is reported`() {
        kotlin(
            """
            fun FlowContent.form() {
                val field = Lt.field(id = "codename")
                label { lt(field.label, field.control); +"Codename" }
                input { name = "codename" }
            }
            """.trimIndent(),
        )
        val found = problems()
        assertEquals(1, found.size)
        assertEquals("field.control", found.single().first)
        assertTrue(found.single().second, found.single().second.contains("<input> or <textarea> or <select>"))
    }

    fun `test the label around the field is silent`() {
        kotlin(
            """
            fun FlowContent.form() {
                val field = Lt.field(id = "codename")
                label { lt(field.label); +"Codename"; input { lt(field.control) } }
            }
            """.trimIndent(),
        )
        assertEquals(emptyList<Pair<String, String>>(), problems())
    }

    fun `test a lambda of something else than a tag is silent`() {
        kotlin(
            """
            fun FlowContent.form() {
                val field = Lt.field(id = "codename")
                label { with(this) { lt(field.control) } }
            }
            """.trimIndent(),
        )
        assertEquals(emptyList<Pair<String, String>>(), problems())
    }

    fun `test a part matched by a class is silent, since the set writes the class`() {
        kotlin(
            """
            fun FlowContent.form() {
                val field = Lt.field(id = "codename", help = true)
                div { lt(field.help); +"Your crew name" }
            }
            """.trimIndent(),
        )
        assertEquals(emptyList<Pair<String, String>>(), problems())
    }

    fun `test a web component from lo-tek-kotlinx-html is a tag too`() {
        kotlin(
            """
            fun FlowContent.form() {
                val field = Lt.field(id = "codename")
                ltField { lt(field.label) }
            }
            """.trimIndent(),
        )
        assertTrue(problems().single().second.contains("not on <lt-field>"))
    }

    fun `test an input helper of kotlinx_html is an input`() {
        kotlin(
            """
            fun FlowContent.form() {
                val field = Lt.field(id = "codename")
                label { lt(field.label); +"Codename" }
                textInput(name = "codename") { lt(field.control) }
                postForm { lt(field.control) }
            }
            """.trimIndent(),
        )
        val found = problems()
        assertEquals("$found", 1, found.size)
        assertTrue(found.single().second, found.single().second.contains("not on <form>"))
    }

    fun `test no fix onto the element of another field`() {
        kotlin(
            """
            fun FlowContent.form() {
                val a = Lt.field(id = "a")
                val b = Lt.field(id = "b")
                label { lt(a.label, a.control) }
                input { name = "a" }
                label { lt(b.label) }
                input { lt(b.control) }
            }
            """.trimIndent(),
        )
        myFixture.enableInspections(WrongElementInspection())
        myFixture.editor.caretModel.moveToOffset(myFixture.file.text.indexOf("a.control") + 1)
        assertEmpty(myFixture.filterAvailableIntentions("Move the set to the element it belongs on"))
    }

    fun `test the fix moves the set to the only element it can go on`() {
        kotlin(
            """
            fun FlowContent.form() {
                val field = Lt.field(id = "codename")
                label { lt(field.label, field.control); +"Codename" }
                input { lt(Lt.input()); name = "codename" }
            }
            """.trimIndent(),
        )
        myFixture.enableInspections(WrongElementInspection())
        myFixture.editor.caretModel.moveToOffset(myFixture.file.text.indexOf("field.control") + 1)
        myFixture.launchAction(myFixture.findSingleIntention("Move the set to the element it belongs on"))
        val text = myFixture.file.text
        assertTrue(text, text.contains("label { lt(field.label); +\"Codename\" }"))
        assertTrue(text, text.contains("input { lt(Lt.input(), field.control); name = \"codename\" }"))
    }

    fun `test no fix when two elements could take the set`() {
        kotlin(
            """
            fun FlowContent.form() {
                val field = Lt.field(id = "codename")
                label { lt(field.label, field.control); +"Codename" }
                input { lt(Lt.input()) }
                textArea { lt(Lt.textarea()) }
            }
            """.trimIndent(),
        )
        myFixture.enableInspections(WrongElementInspection())
        myFixture.editor.caretModel.moveToOffset(myFixture.file.text.indexOf("field.control") + 1)
        assertEmpty(myFixture.filterAvailableIntentions("Move the set to the element it belongs on"))
    }
}
