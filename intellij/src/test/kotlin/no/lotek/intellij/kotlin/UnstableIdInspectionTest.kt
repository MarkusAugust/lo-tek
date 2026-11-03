package no.lotek.intellij.kotlin

class UnstableIdInspectionTest : KotlinTestCase() {
    private fun reported(body: String): List<String> {
        kotlin(
            """
            data class Row(val key: String, val name: String)
            $body
            """.trimIndent(),
        )
        return problems(UnstableIdInspection()).map { it.second }
    }

    fun `test the index of forEachIndexed`() {
        val found = reported("fun FlowContent.x(rows: List<Row>) { rows.forEachIndexed { i, row -> Lt.field(id = \"row-${'$'}i\") } }")
        assertTrue("$found", found.single().contains("loop index"))
    }

    fun `test the index of withIndex in a for`() {
        val found = reported("fun FlowContent.x(rows: List<Row>) { for ((i, row) in rows.withIndex()) Lt.field(id = \"row-${'$'}i\") }")
        assertTrue("$found", found.single().contains("loop index"))
    }

    fun `test a loop over indices, with the id given by position`() {
        val found = reported("fun FlowContent.x(rows: List<Row>) { for (i in rows.indices) Lt.field(\"row-${'$'}i\") }")
        assertTrue("$found", found.single().contains("loop index"))
    }

    fun `test a random id`() {
        val found = reported("fun FlowContent.x() { Lt.popover(id = java.util.UUID.randomUUID().toString()) }")
        assertTrue("$found", found.single().contains("random"))
    }

    fun `test the clock`() {
        val found = reported("fun FlowContent.x() { Lt.dialog(titleId = \"t-${'$'}{System.nanoTime()}\") }")
        assertTrue("$found", found.single().contains("clock"))
    }

    fun `test a counter`() {
        val found = reported("var next = 0\nfun FlowContent.x() { Lt.field(id = \"f-${'$'}{next++}\") }")
        assertTrue("$found", found.single().contains("counter"))
    }

    fun `test the same text in every row`() {
        val found = reported("fun FlowContent.x(rows: List<Row>) { rows.forEach { Lt.field(id = \"amount\") } }")
        assertTrue("$found", found.single().contains("same text in every row"))
    }

    fun `test a key from the data is silent, also with an index next to it`() {
        val found = reported(
            """
            fun FlowContent.x(rows: List<Row>) {
                rows.forEachIndexed { i, row -> Lt.field(id = "row-${'$'}{row.key}") }
                for (row in rows) Lt.field(id = "amount-${'$'}{row.key}")
                Lt.field(id = "codename")
                Lt.tabs(id = "claim", keys = rows.map { it.key }, label = "Parts of the claim")
            }
            """.trimIndent(),
        )
        assertEquals(emptyList<String>(), found)
    }
}
