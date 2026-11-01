package no.lotek

import java.io.File
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * That `Manifest` reads everything the manifest has, without losing anything
 * on the way, and that a manifest it does not understand gives an error that
 * says where.
 */
class ManifestReaderTest {
    private val text = File(System.getProperty("manifest")).readText()

    @Suppress("UNCHECKED_CAST")
    private val raw = Json.parse(text) as Map<String, Any?>

    @Suppress("UNCHECKED_CAST")
    private fun Any?.map() = this as Map<String, Any?>

    /*
     * The tests below compare the fields the reader knows. They would not see
     * a new field in the schema, so every raw object must have only these.
     */
    private fun known(obj: Any?, vararg keys: String, at: String) {
        val unknown = obj.map().keys - keys.toSet()
        assertTrue(unknown.isEmpty(), "$at has $unknown, which Manifest does not read.")
    }

    @Test
    fun `the package manifest is the one in the jar`() {
        known(raw, "\$schema", "schemaVersion", "version", "textLanguage", "elements", "classes", "builders", "tokens", at = "the manifest")
        assertEquals(Manifest.parse(text), Lotek.manifest)
        assertEquals(raw["version"], Lotek.manifest.version)
        assertEquals(raw["textLanguage"], Lotek.manifest.textLanguage)
    }

    @Test
    fun `every class keeps its fields and attributes, in order`() {
        val classes = raw["classes"].map()
        assertEquals(classes.keys.toList(), Lotek.manifest.classes.keys.toList())
        var attributes = 0
        var parts = 0
        var partOf = 0
        var named = 0
        var texts = 0
        for ((name, c) in classes) {
            val read = Lotek.manifest.classes.getValue(name)
            val expected = c.map()
            known(c, "component", "title", "description", "link", "content", "partOf", "parts", "name", "texts", "attributes", at = name)
            assertEquals(nameJson(read.named), expected["name"], "$name name")
            assertEquals(
                expected["texts"] ?: emptyList<Any?>(),
                read.texts.map { t ->
                    buildMap {
                        put("variable", t.variable)
                        put("text", t.text)
                        put("attribute", t.attribute)
                        t.value?.let { put("value", it) }
                        if (t.unless.isNotEmpty()) put("unless", t.unless)
                    }
                },
                "$name texts",
            )
            if (read.named != null) named += 1
            texts += read.texts.size
            assertEquals(name, read.name)
            assertEquals(listOf(expected["component"], expected["title"], expected["description"], expected["link"]), listOf(read.component, read.title, read.description, read.link), name)
            assertEquals(expected["content"], read.content?.name?.lowercase(), name)
            assertEquals(expected["partOf"], read.partOf, name)
            if (read.partOf != null) partOf += 1
            val rawParts = expected["parts"]?.map() ?: emptyMap()
            assertEquals(rawParts.keys.toList(), read.parts.keys.toList(), name)
            for ((part, p) in rawParts) {
                val r = read.parts.getValue(part)
                val pm = p.map()
                known(p, "selector", "description", "content", "multiple", "unique", "optional", "stableId", "name", at = "$name $part")
                assertEquals(nameJson(r.named), pm["name"], "$name $part name")
                assertEquals(listOf(pm["selector"], pm["description"], pm["content"], pm["multiple"] == true, pm["unique"] == true, pm["optional"] == true, pm["stableId"] == true), listOf(r.selector, r.description, r.content.name.lowercase(), r.multiple, r.unique, r.optional, r.stableId), "$name $part")
                parts += 1
            }
            val attrs = expected["attributes"].map()
            assertEquals(attrs.keys.toList(), read.attributes.keys.toList(), name)
            for ((attr, a) in attrs) {
                val r = read.attributes.getValue(attr)
                val e = a.map()
                known(a, "values", "default", "flag", "description", at = "$name $attr")
                assertEquals(e["values"] ?: emptyList<String>(), r.values, "$name $attr")
                assertEquals(e["default"], r.default, "$name $attr")
                assertEquals(e["flag"] == true, r.flag, "$name $attr")
                assertEquals(e["description"], r.description, "$name $attr")
                attributes += 1
            }
        }
        assertTrue(attributes > 0, "No class had attributes, so the comparison said nothing.")
        assertTrue(parts > 0 && partOf > 0, "Found $parts parts and $partOf classes with partOf, so the comparison said nothing.")
        assertTrue(named > 0 && texts > 0, "Found $named classes with name and $texts texts, so those branches in the reader are untested.")
    }

    @Test
    fun `every element keeps its attributes, parts and events`() {
        val elements = raw["elements"].map()
        assertEquals(elements.keys.toList(), Lotek.manifest.elements.keys.toList())
        var parts = 0
        var events = 0
        var stable = 0
        var removed = 0
        var elementTexts = 0
        var partNames = 0
        for ((tag, el) in elements) {
            val read = Lotek.manifest.elements.getValue(tag)
            val e = el.map()
            known(el, "link", "description", "attributes", "parts", "events", "removed", "name", "texts", at = tag)
            assertEquals(nameJson(read.named), e["name"], "$tag name")
            assertEquals(
                e["texts"] ?: emptyMap<String, Any?>(),
                read.texts.mapValues { (_, t) -> mapOf("text" to t.text, "replacedBy" to t.replacedBy) },
                "$tag texts",
            )
            elementTexts += read.texts.size
            assertEquals(tag, read.tag)
            assertEquals(e["link"], read.link)
            assertEquals(e["description"], read.description)
            assertEquals(e["removed"] ?: emptyMap<String, String>(), read.removed, "$tag removed")
            removed += read.removed.size
            for ((name, a) in e["attributes"].map()) {
                known(a, "type", "values", "description", at = "$tag $name")
                val r = read.attributes.getValue(name)
                assertEquals(a.map()["type"], r.type.name.lowercase(), "$tag $name")
                assertEquals(a.map()["values"] ?: emptyList<String>(), r.values, "$tag $name")
                assertEquals(a.map()["description"], r.description, "$tag $name")
            }
            assertEquals(e["attributes"].map().keys.toList(), read.attributes.keys.toList(), tag)
            val rawParts = e["parts"]?.map() ?: emptyMap()
            assertEquals(rawParts.keys.toList(), read.parts.keys.toList(), tag)
            for ((name, p) in rawParts) {
                val r = read.parts.getValue(name)
                val pm = p.map()
                known(p, "selector", "description", "content", "multiple", "unique", "optional", "stableId", "name", at = "$tag $name")
                assertEquals(nameJson(r.named), pm["name"], "$tag $name name")
                if (r.named != null) partNames += 1
                assertEquals(listOf(pm["selector"], pm["description"], pm["content"], pm["multiple"] == true, pm["unique"] == true, pm["optional"] == true, pm["stableId"] == true), listOf(r.selector, r.description, r.content.name.lowercase(), r.multiple, r.unique, r.optional, r.stableId), "$tag $name")
                if (r.stableId) stable += 1
                parts += 1
            }
            val rawEvents = e["events"]?.map() ?: emptyMap()
            assertEquals(rawEvents.keys.toList(), read.events.keys.toList(), tag)
            for ((name, ev) in rawEvents) {
                known(ev, "detail", at = "$tag $name")
                assertEquals(ev.map()["detail"] ?: emptyMap<String, String>(), read.events.getValue(name).detail, "$tag $name")
                events += 1
            }
        }
        assertTrue(parts > 0 && events > 0, "Found $parts parts and $events events, so the comparison said nothing.")
        assertTrue(stable > 0 && removed > 0, "Found $stable parts with stableId and $removed removed attributes, so those branches in the reader are untested.")
        assertTrue(elementTexts > 0 && partNames > 0, "Found $elementTexts texts and $partNames parts with name, so those branches in the reader are untested.")
    }

    /** A name as the raw JSON writes it, with each field only when it is there. */
    private fun nameJson(n: Name?): Map<String, Any?>? =
        n?.let {
            buildMap {
                it.after?.let { a -> put("after", a) }
                if (it.id) put("id", true)
                if (it.component) put("component", true)
            }
        }

    /** The shape of a result as the raw JSON writes it, with `optional` only when it is there. */
    private fun returnsJson(r: Returns): Map<String, Any?> =
        buildMap {
            when (r) {
                is Returns.Attributes -> put("kind", "attributes")
                is Returns.Text -> put("kind", "text")
                is Returns.Values -> {
                    put("kind", "values")
                    put("values", r.values)
                }
                is Returns.ListOf -> {
                    put("kind", "list")
                    put("of", returnsJson(r.of))
                }
                is Returns.Group -> {
                    put("kind", "group")
                    put("fields", r.fields.mapValues { (_, f) -> returnsJson(f) })
                }
            }
            if (r.optional) put("optional", true)
        }

    private fun typeJson(t: OptionType): Map<String, Any?> =
        when (t) {
            is OptionType.Values -> mapOf("kind" to "values", "values" to t.values)
            OptionType.Flag -> mapOf("kind" to "flag")
            OptionType.Text -> mapOf("kind" to "text")
            OptionType.Number -> mapOf("kind" to "number")
            OptionType.TextList -> mapOf("kind" to "textList")
        }

    @Test
    fun `every builder keeps its options and the shape of its answer, in order`() {
        val builders = raw["builders"] as List<*>
        assertEquals(builders.map { it.map()["name"] }, Lotek.manifest.builders.map { it.name })
        var options = 0
        val kinds = mutableSetOf<String>()
        val shapes = mutableSetOf<String>()
        fun shapesIn(r: Any?) {
            val m = r.map()
            known(r, "kind", "values", "of", "fields", "optional", at = "returns")
            shapes += m["kind"] as String
            m["of"]?.let { shapesIn(it) }
            m["fields"]?.map()?.values?.forEach { shapesIn(it) }
        }
        var withClasses = 0
        for ((i, b) in builders.withIndex()) {
            val expected = b.map()
            val read = Lotek.manifest.builders[i]
            known(b, "name", "options", "returns", "table", "classes", at = read.name)
            assertEquals(expected["classes"] ?: emptyMap<String, String>(), read.classes, "${read.name} classes")
            if (read.classes.isNotEmpty()) withClasses += 1
            val rawOptions = expected["options"] as List<*>
            assertEquals(rawOptions.size, read.options.size, read.name)
            for ((j, o) in rawOptions.withIndex()) {
                val e = o.map()
                val r = read.options[j]
                known(o, "name", "required", "type", "description", at = "${read.name} ${e["name"]}")
                known(e["type"], "kind", "values", at = "${read.name} ${e["name"]} type")
                assertEquals(listOf(e["name"], e["required"], e["type"], e["description"]), listOf(r.name, r.required, typeJson(r.type), r.description), "${read.name} ${e["name"]}")
                kinds += e["type"].map()["kind"] as String
                options += 1
            }
            shapesIn(expected["returns"])
            assertEquals(expected["returns"], returnsJson(read.returns), "${read.name} returns")
            // The maps have the manifest's order, and `Map.equals` above does not see it.
            val group = expected["returns"].map()["fields"]?.map()
            if (group != null) assertEquals(group.keys.toList(), (read.returns as Returns.Group).fields.keys.toList(), "${read.name} the order of the fields")
        }
        assertTrue(options > 0, "No builder function had options, so the comparison said nothing.")
        assertTrue(withClasses > 0, "No builder function had classes for its parts, so that branch of the reader is untested.")
        assertEquals(setOf("values", "flag", "text", "number", "textList"), kinds, "every option type must be in the manifest, otherwise a branch in the reader is untested")
        // No builder function returns plain text today, so that branch is tested below, with a rewritten manifest.
        assertTrue(shapes.containsAll(setOf("attributes", "values", "list", "group")), "the shapes in the manifest were $shapes, so a branch in the reader is untested")
        val asText = Manifest.parse(text.replaceFirst("\"returns\": {\n        \"kind\": \"attributes\"", "\"returns\": {\n        \"kind\": \"text\""))
        assertEquals(Returns.Text(), asText.builders.first().returns)
        // Nor is there an optional field in a group today; `host` in the first group is made optional.
        val withOptional = Manifest.parse(text.replaceFirst("\"host\": {\n            \"kind\": \"attributes\"", "\"host\": {\n            \"kind\": \"attributes\", \"optional\": true"))
        val group = withOptional.builders.first { it.returns is Returns.Group }.returns as Returns.Group
        assertEquals(Returns.Attributes(optional = true), group.fields.getValue("host"))
        // Every option has a description today, so an option without one is tested by removing the first.
        // The description is last in the option, so the comma before it must go too, or the JSON becomes invalid.
        // The same sentence is on the class attribute further up, so the replacement is made from \"builders\" onwards.
        val buildersAt = text.indexOf("\"builders\"")
        val firstDescription = Regex(",\\n\\s*\"description\": \"(?:[^\"\\\\]|\\\\.)*\"").find(text, buildersAt)!!
        val withoutDescription = Manifest.parse(text.substring(0, buildersAt) + text.substring(buildersAt).replaceFirst(firstDescription.value, ""))
        assertEquals(null, withoutDescription.builders.first().options.first().description)
        assertTrue(Lotek.manifest.builders.first().options.first().description != null, "the rewrite must have removed a description that exists")
    }

    @Test
    fun `the tokens keep every scale, axis and component variable`() {
        val tokens = raw["tokens"].map()
        val read = Lotek.manifest.tokens!!
        known(tokens, "spacing", "breakpoints", "containers", "colors", "components", at = "tokens")
        assertEquals(tokens["spacing"], read.spacing)
        assertEquals(tokens["breakpoints"], read.breakpoints)
        assertEquals(tokens["containers"], read.containers)
        val colors = tokens["colors"].map()
        known(colors, "families", "roles", "layers", "tokens", at = "tokens.colors")
        assertEquals(colors["families"], read.colors.families)
        assertEquals(colors["roles"], read.colors.roles)
        assertEquals(colors["layers"], read.colors.layers)
        assertEquals(colors["tokens"], read.colors.tokens)
        val components = tokens["components"].map()
        assertEquals(components.keys.toList(), read.components.keys.toList())
        var variables = 0
        for ((component, v) in components) {
            assertEquals(v, read.components.getValue(component), component)
            variables += v.map().size
        }
        assertTrue(
            read.spacing.size > 0 && read.breakpoints.size > 0 && read.containers.size > 0 && read.colors.families.size > 0 && read.colors.roles.size > 0 && read.colors.tokens.size > 0 && variables > 0,
            "One of the lists was empty, so the comparison said nothing.",
        )
        assertEquals("768px", read.breakpoints["md"])
        assertEquals("var(--lt-spacing-2) var(--lt-spacing-4)", read.components.getValue("button").getValue("--lt-button-padding"))
        assertTrue("text-subtle" in read.colors.roles && "--lt-color-accent-surface" in read.colors.tokens)
    }

    @Test
    fun `known entries read as expected`() {
        val tabs = Lotek.manifest.elements.getValue("lt-tabs")
        assertEquals(listOf("list", "tab", "panel"), tabs.parts.keys.toList())
        assertTrue(tabs.parts.getValue("tab").multiple)
        assertEquals(PartContent.TEXT, tabs.parts.getValue("tab").content)
        val field = Lotek.manifest.elements.getValue("lt-field")
        assertTrue(field.parts.getValue("control").unique && !field.parts.getValue("label").unique)
        assertEquals(AttributeType.FLAG, tabs.attributes.getValue("server-controlled").type)
        assertEquals(mapOf("index" to "number"), tabs.events.getValue("tab-select").detail)

        val variant = Lotek.manifest.classes.getValue("lt-button").attributes.getValue("data-variant")
        assertContains(variant.values, "secondary")
        assertEquals("primary", variant.default)
        assertTrue(Lotek.manifest.classes.values.any { c -> c.attributes.values.any { it.flag && it.values.isEmpty() } })

        val button = Lotek.manifest.builders.single { it.name == "button" }
        val variantOption = button.options.single { it.name == "variant" }
        assertEquals(false, variantOption.required)
        assertTrue(variantOption.type is OptionType.Values && "secondary" in variantOption.type.values)
        assertEquals(Returns.Attributes(), button.returns)
        val dialog = Lotek.manifest.builders.single { it.name == "dialog" }
        assertTrue(dialog.options.single { it.name == "titleId" }.required)
        assertTrue(dialog.returns is Returns.Group && "host" in dialog.returns.fields)

        val table = Lotek.manifest.classes.getValue("lt-table")
        assertEquals(PartContent.PARTS, table.content)
        assertEquals(listOf("caption", "head", "body", "sort"), table.parts.keys.toList())
        assertTrue(table.parts.getValue("caption").optional)
        assertEquals("lt-table", Lotek.manifest.classes.getValue("lt-table__sort").partOf)
        assertEquals(PartContent.TEXT, Lotek.manifest.classes.getValue("lt-button").content)
    }

    @Test
    fun `a manifest from before 0_34 is read without tokens and contents`() {
        // What a manifest from 0.33.0 looks like: the same schemaVersion,
        // without tokens and without content and parts on the classes.
        // IntelliJ reads the project's own manifest, and it can be from an
        // older package.
        @Suppress("UNCHECKED_CAST")
        val old = (Json.parse(text) as Map<String, Any?>).toMutableMap()
        old.remove("tokens")
        old["classes"] = (old["classes"] as Map<String, Any?>).mapValues { (_, c) ->
            (c as Map<String, Any?>) - setOf("content", "parts", "partOf")
        }
        val read = Manifest.parse(Json.write(old))
        assertEquals(null, read.tokens)
        assertEquals(null, read.classes.getValue("lt-button").content)
        assertEquals(Lotek.manifest.classes.keys, read.classes.keys)
    }

    @Test
    fun `a project manifest is read as well`() {
        val takenOver = Manifest.parse(text.replace("\"lt-card\": {", "\"lt-kort\": {"))
        assertTrue("lt-kort" in takenOver.classes && "lt-card" !in takenOver.classes)
    }

    @Test
    fun `a manifest it cannot read says where`() {
        fun error(json: String) = assertFailsWith<IllegalArgumentException> { Manifest.parse(json) }.message!!

        assertContains(error(text.replace("\"schemaVersion\": 1", "\"schemaVersion\": 2")), "schemaVersion 2,")
        assertContains(
            error(text.replaceFirst("\"link\": \"https://lo-tek.sobernetics.no/components/tabs/\"", "\"link\": 3")),
            "elements.lt-tabs.link",
        )
        assertContains(error(text.replaceFirst("\"content\": \"text\"", "\"content\": \"tekst\"")), "\"tekst\"")
        assertContains(error("""{"schemaVersion": 1, "version": "0", "elements": {}, "classes": []}"""), "classes should have been an object")
        // Without tokens the manifest is from before 0.34 and is read; with the wrong shape it throws.
        assertContains(error("""{"schemaVersion": 1, "version": "0", "elements": {}, "classes": {}, "builders": [], "tokens": 3}"""), "tokens should have been an object")
        assertContains(error(text.replaceFirst("\"kind\": \"flag\"", "\"kind\": \"flagg\"")), "\"flagg\"")
    }
}
