package no.lotek

import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.MethodSource

/**
 * That [Anatomies] writes what `renderAnatomy()` in TypeScript writes, and
 * makes the same instances.
 *
 * The cases in `interfaces/manifest/anatomy-cases.json` are written by
 * `generate-manifest.ts`: every anatomy as created, and with each change a
 * design tool makes, with the markup from TypeScript. The markup must be
 * the same, character for character, since a design tool patches the
 * browser with it, and the instances [Anatomies] makes must be the ones
 * TypeScript made.
 */
class AnatomyCasesTest {
    @ParameterizedTest(name = "{0}")
    @MethodSource("builders")
    fun `writes the same as TypeScript`(builder: String) {
        val cases = CASES.filter { it["builder"] == builder }
        assertTrue(cases.isNotEmpty(), "No anatomy cases for $builder")
        val anatomy = anatomyOf(builder)
        for (case in cases) {
            val template = case["annotate"]?.map()
            val instance =
                instance(anatomy, case["instance"].map()).copy(
                    annotate = template?.let { t -> { address -> t.mapValues { (_, v) -> (v as String).replace("{address}", address) } } },
                )
            assertEquals(case["expected"], Anatomies.render(Lotek.manifest, builder, instance), "$builder ${case["change"]} ${Json.write(case["instance"])}")
        }
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("builders")
    fun `makes the same instances as TypeScript`(builder: String) {
        val anatomy = anatomyOf(builder)
        val cases = CASES.filter { it["builder"] == builder }
        // As created, with an item in each group that may have none.
        var base = Anatomies.created(anatomy, "c1")
        for ((group, r) in anatomy.repeats) if (r.min == 0) base = Anatomies.withItem(anatomy, base, group, "${group}1")
        assertEquals(
            cases.filter { it["change"] == "variant" }.map { instance(anatomy, it["instance"].map()) },
            Anatomies.variants(anatomy, base),
            "$builder: created, and its variants",
        )
        for (case in cases.filter { it["change"] == "withItem" }) {
            val inserted = case["withItem"].map()
            assertEquals(
                instance(anatomy, case["instance"].map()),
                Anatomies.withItem(anatomy, base, inserted["group"] as String, inserted["key"] as String, (inserted["at"] as Double).toInt()),
                "$builder: an item inserted ${Json.write(inserted)}",
            )
        }
    }

    @Test
    fun `the example on the Kotlin page works`() {
        // The same lines as under "In a design tool" in kotlin.mdx.
        val anatomy = Lotek.manifest.builders.first { it.name == "tabs" }.anatomy!!
        var tabs = Anatomies.created(anatomy, "c1")
        tabs = Anatomies.withItem(anatomy, tabs, "tab", "claim")
        val html = Anatomies.render(Lotek.manifest, "tabs", tabs)
        assertTrue(html.startsWith("<lt-tabs><ul class=\"lt-tabs__list\" aria-label=\"Sections\"><li><a href=\"#c1-tabs-claim\">"), html)
    }

    /*
     * What the cases do not reach. The expected answers are the ones
     * renderAnatomy() and withItem() gave in TypeScript.
     */
    @Test
    fun `an empty value is a value, not a flag`() {
        val anatomy = anatomyOf("radio")
        val created = Anatomies.created(anatomy, "c1")
        val values = created.holes.getValue("value") as Keyed.PerItem
        val instance = created.copy(holes = created.holes + ("value" to Keyed.PerItem(values.items + ("option1" to Keyed.Value("")))))
        val html = Anatomies.render(Lotek.manifest, "radio", instance)
        assertTrue("""id="c1-control-option1" name="answer" value="">""" in html, html)
    }

    @Test
    fun `an item inserted at a negative place counts from the end`() {
        val tabs = AnatomyInstance(id = "c1", repeats = mapOf("tab" to listOf("a", "b", "c")))
        assertEquals(listOf("a", "b", "x", "c"), Anatomies.withItem(anatomyOf("tabs"), tabs, "tab", "x", -1).repeats["tab"])
    }

    @Test
    fun `a setting the builder function does not take is an IllegalArgumentException`() {
        val case = CASES.first { it["change"] == "setting" }
        val builder = case["builder"] as String
        val anatomy = anatomyOf(builder)
        val instance = instance(anatomy, case["instance"].map())
        val wrong = instance.copy(settings = instance.settings.mapValues { (_, v) -> wrongly(v) })
        val error = assertFailsWith<IllegalArgumentException> { Anatomies.render(Lotek.manifest, builder, wrong) }
        assertTrue(error.message!!.startsWith("Anatomies.render: Lt."), error.message)
    }

    @Test
    fun `a path a tool cannot build is an IllegalArgumentException`() {
        // A hole that lets only some in, and a host with a hole of its own that it does not let in.
        val builders = Lotek.manifest.builders.filter { it.anatomy != null }
        val (outer, hole) =
            builders.firstNotNullOf { b -> b.anatomy!!.holes.entries.firstOrNull { it.value.only != null }?.let { b.name to it.key } }
        val only = Lotek.manifest.builders.first { it.name == outer }.anatomy!!.holes.getValue(hole).only!!
        val host =
            builders.first { b -> b.name !in only.builders && b.anatomy!!.page == null && b.anatomy!!.holes.values.any { it.content == HoleContent.FREE } }
        val inner = host.anatomy!!.holes.entries.first { it.value.content == HoleContent.FREE }.key
        val error =
            assertFailsWith<IllegalArgumentException> {
                Anatomies.canDrop(Lotek.manifest, "button", listOf(DropPlace(outer, hole), DropPlace(host.name, inner)))
            }
        assertTrue(error.message!!.startsWith("Anatomies.canDrop: ${host.name} cannot stand in $outer.$hole"), error.message)
    }

    @Test
    fun `answers every drop as TypeScript does`() {
        @Suppress("UNCHECKED_CAST")
        val drops = (Json.parse(File(System.getProperty("anatomyCases")).readText()) as Map<String, Any?>)["drops"] as List<Map<String, Any?>>
        assertTrue(drops.size > 300, "Only ${drops.size} drops, so the comparison said little.")
        for (drop in drops) {
            val path = (drop["path"] as List<*>).map { it.map().let { p -> DropPlace(p["builder"] as String, p["hole"] as String) } }
            val answer = drop["answer"].map()
            val expected =
                when {
                    answer["ok"] == true -> DropAnswer.Yes
                    answer["by"] == "html" -> DropAnswer.Html(answer["why"] as String)
                    else -> DropAnswer.Lotek(answer["why"] as String)
                }
            assertEquals(expected, Anatomies.canDrop(Lotek.manifest, drop["component"] as String, path), "${drop["component"]} in $path")
        }
    }

    @Test
    fun `the cases have every change a tool makes`() {
        assertEquals(setOf("variant", "withItem", "tag", "setting", "annotate"), CASES.map { it["change"] }.toSet())
    }

    @Test
    fun `every anatomy has cases`() {
        assertEquals(builders().sorted(), CASES.map { it["builder"] as String }.distinct().sorted())
    }

    companion object {
        @Suppress("UNCHECKED_CAST")
        private val CASES: List<Map<String, Any?>> by lazy {
            val file = File(System.getProperty("anatomyCases"))
            (Json.parse(file.readText()) as Map<String, Any?>)["cases"] as List<Map<String, Any?>>
        }

        /** The setting with every value made one no option has. */
        private fun wrongly(v: Keyed<Map<String, Any?>>): Keyed<Map<String, Any?>> =
            when (v) {
                is Keyed.Value -> Keyed.Value(v.value.mapValues { "no such value" })
                is Keyed.PerItem -> Keyed.PerItem(v.items.mapValues { (_, inner) -> wrongly(inner) })
            }

        @JvmStatic
        fun builders(): List<String> = Lotek.manifest.builders.filter { it.anatomy != null }.map { it.name }

        private fun anatomyOf(builder: String) = Lotek.manifest.builders.first { it.name == builder }.anatomy!!

        @Suppress("UNCHECKED_CAST")
        private fun Any?.map() = this as Map<String, Any?>? ?: emptyMap()

        /** A value per item, from the JSON TypeScript writes. A flag is `"true"` or `"false"` in Kotlin. */
        private fun keyed(value: Any?): Keyed<String> =
            when (value) {
                is Map<*, *> -> Keyed.PerItem(value.entries.associate { (k, v) -> k as String to keyed(v) })
                is Boolean -> Keyed.Value(value.toString())
                else -> Keyed.Value(value as String)
            }

        /**
         * The settings of a node, from JSON: one level per item when the
         * node is in a group, since a setting is itself an object there.
         */
        private fun settings(anatomy: Anatomy, name: String, value: Any?): Keyed<Map<String, Any?>> {
            fun level(v: Any?, depth: Int): Keyed<Map<String, Any?>> =
                if (depth == 0) Keyed.Value(v.map()) else Keyed.PerItem(v.map().mapValues { (_, inner) -> level(inner, depth - 1) })
            return level(value, if (groupOf(anatomy.root, name, null) != null) 1 else 0)
        }

        /** The innermost group around the node or choice with the name. */
        private fun groupOf(child: AnatomyChild, name: String, around: String?): String? =
            when (child) {
                is AnatomyHole -> null
                is AnatomyChoice ->
                    if (child.name == name) child.repeat ?: around
                    else child.oneOf.values.firstNotNullOfOrNull { groupOf(it, name, child.repeat ?: around) }
                is AnatomyNode -> {
                    val group = child.repeat ?: around
                    if (child.name == name) group else child.children.firstNotNullOfOrNull { groupOf(it, name, group) }
                }
            }

        @Suppress("UNCHECKED_CAST")
        fun instance(anatomy: Anatomy, json: Map<String, Any?>): AnatomyInstance =
            AnatomyInstance(
                id = json["id"] as String,
                options = json["options"].map(),
                repeats = json["repeats"].map().mapValues { (_, keys) -> keys as List<String> },
                holes = json["holes"].map().mapValues { (_, v) -> keyed(v) },
                content = json["content"].map().mapValues { (_, v) -> keyed(v) },
                choices = json["choices"].map().mapValues { (_, v) -> keyed(v) },
                settings = json["settings"].map().mapValues { (name, v) -> settings(anatomy, name, v) },
                parts = json["parts"].map().mapValues { (_, v) -> v as Boolean },
                tags = json["tags"].map().mapValues { (_, v) -> v as String },
            )
    }
}
