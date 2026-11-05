package no.lotek.html

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.html.body
import kotlinx.html.div
import kotlinx.html.html
import kotlinx.html.stream.createHTML
import no.lotek.Attributes
import no.lotek.Lotek
import no.lotek.Lt
import no.lotek.html.rulebook.COMPILED_BLOCKS
import no.lotek.html.rulebook.rulebookFragments
import no.lotek.html.rulebook.rulebookPages

/**
 * The rulebook for coding agents, `agent/kotlin.md`, says what the package
 * has. It is written by `generate-agent.ts` before Gradle runs, so the names
 * in it are read back here and compared with the classes themselves:
 *
 *   - the table of enums has exactly the enums `Lt` takes and gives, each
 *     with its constants in order;
 *   - every `Lt.name` in the text is a builder function or a part on `Lt`;
 *   - every `Name.CONSTANT` of one of LO-TEK's enums exists.
 *
 * `ExtractRulebook` compiles every ```kotlin block, and the blocks that are a
 * piece of a page or a page template are rendered here and checked with
 * the same check the rulebook teaches.
 */
class RulebookTest {
    /** The constants the rulebook names on purpose as what does not compile. */
    private val COMPILE_ERRORS = setOf("ButtonVariant.SECUNDARY")

    private val text = File(System.getProperty("rulebook")).readText()

    private fun enum(name: String): Class<*>? =
        runCatching { Class.forName("no.lotek.$name") }.getOrNull()?.takeIf { it.isEnum }

    private fun constants(type: Class<*>): List<String> =
        type.enumConstants.map { (it as Enum<*>).name }

    /** The enums a builder function takes as an option, or gives in a field of its answer. */
    private fun enumsOfLt(): Set<String> {
        val types = mutableSetOf<Class<*>>()
        for (method in Lt::class.java.methods) {
            types += method.parameterTypes
            val answer = method.returnType
            if (answer.packageName == "no.lotek" && answer != Attributes::class.java) {
                types += answer.declaredFields.map { it.type }
            }
        }
        return types.filter { it.isEnum && it.packageName == "no.lotek" }.map { it.simpleName }.toSet()
    }

    @Test
    fun `the table of enums is the enums of Lt, with their constants`() {
        val header = text.indexOf("| Enum | Constants | Used for |")
        assertTrue(header >= 0, "agent/kotlin.md has no table of enums")
        val rows = text.substring(header).lines().drop(2).takeWhile { it.startsWith("| `") }
        val table = rows.associate { row ->
            val cells = row.split(" | ")
            val name = cells[0].removePrefix("| ").trim('`')
            name to Regex("`([A-Z0-9_]+)`").findAll(cells[1]).map { it.groupValues[1] }.toList()
        }
        assertTrue(table.isNotEmpty(), "The table of enums in agent/kotlin.md has no rows")
        assertEquals(enumsOfLt(), table.keys, "The enums in agent/kotlin.md are not the enums Lt takes and gives")
        for ((name, listed) in table) {
            val type = enum(name) ?: error("agent/kotlin.md lists $name, which is not an enum in no.lotek")
            assertEquals(constants(type), listed, "The constants of $name in agent/kotlin.md")
        }
    }

    /**
     * The type a member the class itself declares gives: a method, a getter
     * or a field with that name. Declared, so `getClass` and `hashCode` from
     * `Object` are not taken for a part.
     */
    private fun member(type: Class<*>, name: String): Class<*>? {
        val getter = "get${name.replaceFirstChar(Char::uppercase)}"
        val public = { modifiers: Int -> java.lang.reflect.Modifier.isPublic(modifiers) }
        return type.declaredMethods.firstOrNull { public(it.modifiers) && (it.name == name || it.name == getter) }?.returnType
            ?: type.declaredFields.firstOrNull { public(it.modifiers) && it.name == name }?.type
    }

    @Test
    fun `every Lt name in the rulebook exists, with the part after it`() {
        val names = Regex("""\bLt\.([a-z]\w*)(?:\.([a-z]\w*))?""").findAll(text)
            .map { it.groupValues[1] to it.groupValues[2] }.toSet()
        val distinct = names.map { it.first }.toSet().size
        assertTrue(distinct > 40, "agent/kotlin.md names only $distinct members of Lt; the builder functions alone are more")
        assertTrue(names.any { it.second.isNotEmpty() }, "agent/kotlin.md names no part, such as Lt.card.title")
        val missing = names.filter { (name, part) ->
            val type = member(Lt::class.java, name)
            // A part is read on the property, a `@JvmField` next to the
            // builder function with the same name, not on the function's answer.
            val parts = Lt::class.java.declaredFields.firstOrNull { it.name == name }?.type
            type == null || (part.isNotEmpty() && (parts == null || member(parts, part) == null))
        }.map { (name, part) -> if (part.isEmpty()) "Lt.$name" else "Lt.$name.$part" }
        assertEquals(emptyList(), missing, "agent/kotlin.md names members Lt does not have")
    }

    @Test
    fun `every constant of an enum in the rulebook exists`() {
        val used = Regex("""\b([A-Z][A-Za-z]+)\.([A-Z][A-Z0-9_]*)\b""").findAll(text)
            .mapNotNull { m -> enum(m.groupValues[1])?.let { it to m.groupValues[2] } }.toList()
        assertTrue(used.isNotEmpty(), "agent/kotlin.md uses no constant of an enum")
        val missing = used.filter { (type, constant) -> constant !in constants(type) }
            .filter { (type, constant) -> "${type.simpleName}.$constant" !in COMPILE_ERRORS }
            .map { (type, constant) -> "${type.simpleName}.$constant" }
        assertEquals(emptyList(), missing, "agent/kotlin.md uses constants that do not exist")
    }

    @Test
    fun `the blocks render markup the check accepts`() {
        val blocks = Regex("""(?m)^```kotlin\n""").findAll(text).count()
        val gradle = Regex("""(?m)^```kotlin\n// build\.gradle""").findAll(text).count()
        assertEquals(blocks - gradle, COMPILED_BLOCKS, "ExtractRulebook compiled a different number of blocks than agent/kotlin.md has")
        assertTrue(rulebookFragments.isNotEmpty() && rulebookPages.isNotEmpty(), "No block of agent/kotlin.md was rendered")
        for ((name, fragment) in rulebookFragments) {
            val html = createHTML(prettyPrint = false).div { fragment() }
            assertEquals(emptyList(), Lotek.diagnoseMarkup(html), "$name in agent/kotlin.md")
        }
        for ((name, page) in rulebookPages) {
            val html = createHTML(prettyPrint = false).html { page() }
            assertEquals(emptyList(), Lotek.diagnosePage(html), "$name in agent/kotlin.md")
        }
    }
}
