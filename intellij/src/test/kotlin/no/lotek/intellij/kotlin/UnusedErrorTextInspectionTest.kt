package no.lotek.intellij.kotlin

class UnusedErrorTextInspectionTest : KotlinTestCase() {
    private fun found(body: String) = kotlin(body).let { problems(UnusedErrorTextInspection()) }

    fun `test error = true without field_error`() {
        val found = found(
            """
            fun FlowContent.form() {
                val field = Lt.field(id = "codename", error = true)
                label { lt(field.label); +"Codename" }
                input { lt(field.control) }
                p { lt(Lt.errorText()); +"Enter a codename." }
            }
            """.trimIndent(),
        )
        assertEquals("error = true", found.single().first)
    }

    fun `test with field_error it is silent`() {
        val found = found(
            """
            fun FlowContent.form() {
                val field = Lt.field(id = "codename", error = true)
                input { lt(field.control) }
                p { lt(Lt.errorText(), field.error); +"Enter a codename." }
            }
            """.trimIndent(),
        )
        assertEquals(emptyList<Pair<String, String>>(), found)
    }

    fun `test the answer passed on whole is silent`() {
        val found = found(
            """
            fun FlowContent.errorText(field: FieldParts) { p { lt(Lt.errorText(), field.error) } }
            fun FlowContent.form() {
                val field = Lt.field(id = "codename", error = true)
                input { lt(field.control) }
                errorText(field)
            }
            """.trimIndent(),
        )
        assertEquals(emptyList<Pair<String, String>>(), found)
    }
}
