package no.lotek

import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.MethodSource
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * That [Lotek.complete] and [Lotek.hover] answer the same as TypeScript:
 * what an editor suggests while a template is written, and what it says
 * about a class under the pointer.
 *
 * The expected results are `core/editing/cases.json`, which
 * `core/scripts/check-core.ts` holds the TypeScript core to. The file says
 * how each `expect` is read. A Kotlin string is counted in UTF-16 units, as
 * the positions are, so they go in and come out as they are.
 */
class EditingParityTest {
    private fun Any?.map() = this as Map<*, *>

    private fun Any?.int() = (this as Double).toInt()

    /** A suggestion as the expected results write one: a field with nothing in it is left out. */
    private fun json(s: Suggestion): Map<String, Any?> =
        buildMap {
            put("label", s.label)
            put("kind", s.kind.name.lowercase())
            s.detail?.let { put("detail", it) }
            s.documentation?.let { put("documentation", it) }
            put("start", s.start.toDouble())
            put("end", s.end.toDouble())
        }

    @ParameterizedTest(name = "{0}")
    @MethodSource("cases")
    fun `answers the same as TypeScript`(name: String) {
        val case = CASES.first { it["name"] == name }
        val marked = case["text"] as String
        val offset = marked.indexOf('|')
        val text = marked.replace("|", "")
        assertTrue(offset >= 0 && '|' !in text, "the text has not exactly one cursor")

        if (case["call"] == "hover") {
            val answer = Lotek.hover(text, offset)
            assertEquals(case["expect"], answer?.let { mapOf("text" to it.text, "start" to it.start.toDouble(), "end" to it.end.toDouble()) })
            return
        }
        assertEquals("complete", case["call"])
        val expected = case["expect"].map()
        assertTrue(
            (expected.keys - setOf("count", "kinds", "range", "labels", "first", "last", "has")).isEmpty(),
            "the expected results say something this test does not compare: ${expected.keys}",
        )
        val found = Lotek.complete(text, offset, html = case["html"] as Boolean).map(::json)
        assertEquals(expected["count"].int(), found.size, "how many suggestions")
        expected["kinds"]?.let { assertEquals((it as List<*>).toSet(), found.map { s -> s["kind"] }.toSet(), "the kinds") }
        expected["range"]?.let { range ->
            for (s in found) assertEquals(range, mapOf("start" to s["start"], "end" to s["end"]), "what ${s["label"]} replaces")
        }
        expected["labels"]?.let { assertEquals(it, found.map { s -> s["label"] }, "the labels, in order") }
        expected["first"]?.let { assertEquals(it, found.first()["label"], "the first") }
        expected["last"]?.let { assertEquals(it, found.last()["label"], "the last") }
        for (one in (expected["has"] as List<*>?).orEmpty()) {
            val same = assertNotNull(found.firstOrNull { it["label"] == one.map()["label"] }, "${one.map()["label"]} is not suggested")
            assertEquals(one, same.filterKeys { it in one.map().keys }, "${one.map()["label"]}")
        }
        // Which of the two a suggestion of each kind has, and the other is left out.
        for (s in found) {
            val says = s.keys.filter { it == "detail" || it == "documentation" }.toSet()
            assertEquals(SAYS[s["kind"]], says, "${s["label"]}, a ${s["kind"]}")
        }
    }

    @Test
    fun `the kinds are the four the port has`() {
        assertEquals(listOf("class", "value", "element", "attribute"), SuggestionKind.entries.map { it.name.lowercase() })
    }

    @Test
    fun `another manifest gives its own classes, and the package's own applies after`() {
        // A project with a class of its own, as `lotek takeover` leaves it.
        val own = File(System.getProperty("manifest")).readText().replace("\"lt-divider\": {", "\"lt-skille\": {")
        val text = """<hr class="lt-">"""
        val labels = Lotek.complete(text, 14, html = true, manifest = own).map { it.label }
        assertTrue("lt-skille" in labels && "lt-divider" !in labels, "$labels")
        assertNull(Lotek.hover("""<hr class="lt-divider">""", 14, manifest = own))
        assertNotNull(Lotek.hover("""<hr class="lt-skille">""", 14, manifest = own))

        assertTrue("lt-divider" in Lotek.complete(text, 14, html = true).map { it.label })
        assertNotNull(Lotek.hover("""<hr class="lt-divider">""", 14))
    }

    @Test
    fun `html is false unless the caller says the editor has a service of its own`() {
        assertEquals(Lotek.complete("<lt-po", 6, html = false), Lotek.complete("<lt-po", 6))
        assertEquals(10, Lotek.complete("<lt-po", 6).size)
    }

    @Test
    fun `a manifest the core cannot read is refused`() {
        assertFailsWith<IllegalArgumentException> { Lotek.complete("<p>", 1, manifest = "{\"classes\": 3}") }
        assertFailsWith<IllegalArgumentException> { Lotek.hover("<p>", 1, manifest = "not json") }
    }

    companion object {
        private val CASES: List<Map<*, *>> by lazy {
            val file = File(System.getProperty("parity")).resolveSibling("editing/cases.json")
            @Suppress("UNCHECKED_CAST")
            (Json.parse(file.readText()) as Map<String, Any?>)["cases"] as List<Map<*, *>>
        }

        /** Which of `detail` and `documentation` a suggestion of each kind has. */
        private val SAYS =
            mapOf(
                "class" to setOf("detail", "documentation"),
                "value" to setOf("detail"),
                "element" to setOf("documentation"),
                "attribute" to setOf("detail"),
            )

        @JvmStatic
        fun cases(): List<String> {
            val names = CASES.map { it["name"] as String }
            assertTrue(names.size >= 20, "core/editing/cases.json has ${names.size} cases")
            assertEquals(names.size, names.toSet().size, "two cases have the same name")
            return names
        }
    }
}
