package no.lotek

/**
 * A value per item, one level for each group, as the title of each tab,
 * or a cell by row and column. Keyed by the item's key, not by position,
 * so an item inserted first moves nothing. A [Value] holds for every item.
 */
sealed interface Keyed<out T> {
    data class Value<out T>(val value: T) : Keyed<T>

    data class PerItem<out T>(val items: Map<String, Keyed<T>>) : Keyed<T>
}

/**
 * One component in the designer's document, as `AnatomyInstance` in
 * `@lo-tek/interfaces/anatomy`.
 */
data class AnatomyInstance(
    /**
     * The component's id in the document. The id holes it leaves empty are
     * made from it, so the same component has the same ids on every render.
     */
    val id: String,
    /** The options of the builder function the panel shows. */
    val options: Map<String, Any?> = emptyMap(),
    /** The keys of the items in each group, in order. A group left out has `min` items. */
    val repeats: Map<String, List<String>> = emptyMap(),
    /** The text of the text holes and the value of the attribute holes. A flag hole is on with `"true"`. */
    val holes: Map<String, Keyed<String>> = emptyMap(),
    /** Markup for the holes that take other elements, written as it is. */
    val content: Map<String, Keyed<String>> = emptyMap(),
    /** The alternative each choice takes. Left out, the first. */
    val choices: Map<String, Keyed<String>> = emptyMap(),
    /** What the designer set on a node, by its name, keyed per item when it repeats. */
    val settings: Map<String, Keyed<Map<String, Any?>>> = emptyMap(),
    /** Whether each optional node is there. Left out, when it is `created`. */
    val parts: Map<String, Boolean> = emptyMap(),
    /** The tag a node with several takes, by the node's name. */
    val tags: Map<String, String> = emptyMap(),
    /**
     * Attributes for every element, from its address: the path of child
     * indexes from the root, with `[key]` after a repeated node and
     * `:alternative` after a choice, as `0/1[claim]/0`. An attribute the
     * anatomy gives the element is kept, and a class is joined to its, so
     * a tool can give every element an id from the component's id and the
     * address, which is what Datastar and idiomorph know an element by.
     */
    val annotate: ((String) -> Map<String, String>)? = null,
)

/**
 * Writes the markup a builder function belongs in, from its [Anatomy], as
 * `renderAnatomy()` in `@lo-tek/interfaces/anatomy` does, so a server in
 * Kotlin writes the same markup as one in TypeScript. The attributes come
 * from calling the builder functions in [Lt], so the markup is the same as
 * a template that calls them.
 */
object Anatomies {
    /** The elements HTML writes without an end tag. */
    val VOID: Set<String> = setOf("area", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr")

    /**
     * The markup for the builder function [name], from the instance. Throws
     * [IllegalArgumentException] when the builder function has no anatomy,
     * or the instance is not one the anatomy allows: too few items, a hole
     * without a value, a tag or an alternative the node does not have.
     */
    fun render(manifest: Manifest, name: String, instance: AnatomyInstance): String {
        val anatomy =
            manifest.builders.firstOrNull { it.name == name }?.anatomy
                ?: throw IllegalArgumentException("Anatomies.render: Lt.$name has no anatomy in the manifest.")
        return Writer(manifest, name, anatomy, instance).start()
    }

    /**
     * A new component, as a tool creates it on a drop: the fewest items each
     * group may have, keyed `<group>1`, `<group>2` and so on, and every hole
     * filled with the example its declaration gives, for each item it is
     * per; a value per item gets the item's key, so every option sends its
     * own. Optional nodes are there when they are `created`, and every
     * choice takes its first alternative.
     */
    fun created(anatomy: Anatomy, id: String): AnatomyInstance {
        val repeats = anatomy.repeats.mapValues { (group, r) -> (1..r.min).map { "$group$it" } }

        fun perItem(per: List<String>, leaf: (String?) -> String, key: String? = null): Keyed<String> =
            if (per.isEmpty()) {
                Keyed.Value(leaf(key))
            } else {
                Keyed.PerItem((repeats[per[0]] ?: emptyList()).associateWith { perItem(per.drop(1), leaf, it) })
            }
        val holes = LinkedHashMap<String, Keyed<String>>()
        val content = LinkedHashMap<String, Keyed<String>>()
        for ((name, hole) in anatomy.holes) {
            val example = hole.example ?: continue
            val value =
                if (hole.kind == HoleKind.VALUE && hole.per.isNotEmpty()) perItem(hole.per, { it ?: "" }) else perItem(hole.per, { example })
            if (hole.content == HoleContent.FREE) content[name] = value else holes[name] = value
        }
        return AnatomyInstance(id = id, repeats = repeats, holes = holes, content = content)
    }

    /**
     * The instance with an item inserted in a group, at [at] (from the end
     * when negative, as `splice` in TypeScript), its holes
     * filled with the examples, as a tool inserts a tab or a row. The other
     * items keep their keys, so their ids stay as they were.
     */
    fun withItem(anatomy: Anatomy, instance: AnatomyInstance, group: String, key: String, at: Int = 0): AnatomyInstance {
        val keys = (instance.repeats[group] ?: emptyList()).toMutableList().apply { add((if (at < 0) size + at else at).coerceIn(0, size), key) }
        val repeats = instance.repeats + (group to keys.toList())

        // The example at the new key, and at every key of the groups around it.
        fun filled(value: Keyed<String>?, per: List<String>, example: String): Keyed<String> {
            if (per.isEmpty()) return value ?: Keyed.Value(example)
            // One value for every item already holds for the new one too.
            if (value is Keyed.Value) return value
            val level = LinkedHashMap((value as Keyed.PerItem?)?.items ?: emptyMap())
            for (k in repeats[per[0]] ?: emptyList()) {
                if (per[0] != group || k == key || level[k] != null) level[k] = filled(level[k], per.drop(1), example)
            }
            return Keyed.PerItem(level)
        }
        val holes = LinkedHashMap(instance.holes)
        val content = LinkedHashMap(instance.content)
        for ((name, hole) in anatomy.holes) {
            val example = hole.example ?: continue
            if (group !in hole.per) continue
            val target = if (hole.content == HoleContent.FREE) content else holes
            target[name] = filled(target[name], hole.per, example)
        }
        return instance.copy(repeats = repeats, holes = holes, content = content)
    }

    /**
     * The instances a tool can make from [instance] with one change each,
     * the instance itself first: every alternative of every choice, every
     * optional part on and off, and every option a node is there with, on.
     * Each change replaces the field it sets, as `variantsOf()` spread over
     * an instance does in TypeScript.
     */
    fun variants(anatomy: Anatomy, instance: AnatomyInstance): List<AnatomyInstance> {
        val out = mutableListOf(instance)

        fun walk(child: AnatomyChild) {
            when (child) {
                is AnatomyHole -> {}
                is AnatomyChoice -> {
                    for (alternative in child.oneOf.keys) out += instance.copy(choices = mapOf(child.name to Keyed.Value(alternative)))
                    child.oneOf.values.forEach(::walk)
                }
                is AnatomyNode -> {
                    val name = child.name
                    if (name != null && (child.optional || child.wrapper)) {
                        for (on in listOf(true, false)) {
                            val requires = child.requires
                            out += instance.copy(parts = if (on && requires != null) mapOf(name to on, requires to true) else mapOf(name to on))
                        }
                    }
                    child.whenOption?.let { out += instance.copy(options = mapOf(it to true)) }
                    child.children.forEach(::walk)
                }
            }
        }
        walk(anatomy.root)
        return out
    }
}

/** Where a node is written. */
private data class Place(
    val address: String,
    /** The key of the item in each group around the node. */
    val keys: Map<String, String>,
    /** The innermost group around the node. */
    val group: String? = null,
    val answers: Map<String, Map<String, Any?>> = emptyMap(),
    /** The choice the node is an alternative of. */
    val choice: AnatomyChoice? = null,
)

private class Writer(
    private val manifest: Manifest,
    private val builder: String,
    private val anatomy: Anatomy,
    private val instance: AnatomyInstance,
) {
    private val options: Map<String, Any?>

    init {
        for ((group, r) in anatomy.repeats) {
            require(keys(group).size >= r.min) { "Anatomies.render: $builder needs at least ${r.min} items in $group." }
        }
        // An option the tool sets is not bound: the instance's value stands.
        val bound = LinkedHashMap<String, Any?>()
        for ((option, from) in anatomy.options) {
            when (from) {
                // A flag hole is on with "true", and the option takes a Boolean.
                is AnatomyOption.Hole ->
                    bound[option] = attribute(from.hole, emptyMap()).let { if (declared(from.hole).kind == HoleKind.FLAG) it == "true" else it }
                is AnatomyOption.Repeat -> bound[option] = keys(from.repeat)
                is AnatomyOption.Count -> bound[option] = keys(from.count).size
                // A choice each item makes for itself is not one alternative, so the option is off.
                is AnatomyOption.Choice ->
                    bound[option] =
                        when (val chosen = instance.choices[from.choice]) {
                            null -> firstAlternative(from.choice) == from.alternative
                            is Keyed.Value -> chosen.value == from.alternative
                            is Keyed.PerItem -> false
                        }
                is AnatomyOption.Tool -> {}
            }
        }
        options = instance.options + bound
    }

    fun start(): String = write(anatomy.root, Place(address = "0", keys = emptyMap()))

    /** The first alternative of the named choice, the one a tool creates. */
    private fun firstAlternative(name: String): String? {
        fun walk(child: AnatomyChild): String? =
            when (child) {
                is AnatomyHole -> null
                is AnatomyChoice -> if (child.name == name) child.oneOf.keys.first() else child.oneOf.values.firstNotNullOfOrNull(::walk)
                is AnatomyNode -> child.children.firstNotNullOfOrNull(::walk)
            }
        return walk(anatomy.root)
    }

    /** The keys of the items in a group: the instance's, or `min` made up. */
    private fun keys(group: String): List<String> =
        instance.repeats[group] ?: (1..(anatomy.repeats[group]?.min ?: 1)).map { "$group$it" }

    /** A keyed value, read with the keys of the given groups, outermost first. */
    private fun <T> read(value: Keyed<T>?, groups: List<String>, keys: Map<String, String>): T? {
        var found: Keyed<T>? = value
        for (group in groups) {
            val level = found as? Keyed.PerItem ?: break
            val key = keys[group] ?: throw IllegalArgumentException("Anatomies.render: $builder reads a value per $group outside $group.")
            found = level.items[key]
        }
        return when (found) {
            null -> null
            is Keyed.Value -> found.value
            is Keyed.PerItem -> throw IllegalArgumentException("Anatomies.render: $builder has a value per item where it has one value.")
        }
    }

    private fun declared(hole: String): AnatomyHoleDeclaration =
        anatomy.holes[hole] ?: throw IllegalArgumentException("Anatomies.render: $builder uses the hole $hole, which it does not declare.")

    /** The value of an attribute hole; an empty id hole gets one from the instance id. */
    private fun attribute(hole: String, keys: Map<String, String>): String? {
        val declaration = declared(hole)
        val given = read(instance.holes[hole], declaration.per, keys)
        // An empty id is no id; an empty value is a value, as value="".
        if (given != null && !(given.isEmpty() && declaration.kind == HoleKind.ID)) return given
        if (declaration.kind == HoleKind.ID) return (listOf(instance.id, hole) + declaration.per.map { keys[it] }).joinToString("-")
        return null
    }

    private fun write(child: AnatomyChild, place: Place): String {
        if (child is AnatomyHole) {
            val declaration = declared(child.hole)
            if (declaration.content == HoleContent.FREE) return read(instance.content[child.hole], declaration.per, place.keys) ?: ""
            return escapeText(read(instance.holes[child.hole], declaration.per, place.keys) ?: "")
        }
        val repeat =
            when (child) {
                is AnatomyNode -> child.repeat
                is AnatomyChoice -> child.repeat
                else -> null
            }
        if (repeat != null && repeat !in place.keys) {
            return keys(repeat).joinToString("") { key ->
                write(child, place.copy(address = "${place.address}[$key]", keys = place.keys + (repeat to key), group = repeat))
            }
        }
        if (child is AnatomyChoice) {
            val chosen = read(instance.choices[child.name], listOfNotNull(child.repeat), place.keys) ?: child.oneOf.keys.first()
            val node =
                child.oneOf[chosen]
                    ?: throw IllegalArgumentException("Anatomies.render: ${child.name} has no alternative $chosen, only ${child.oneOf.keys.joinToString(", ")}.")
            return element(node, place.copy(address = "${place.address}:$chosen", choice = child))
        }
        return element(child as AnatomyNode, place)
    }

    /** Whether an optional node is there. */
    private fun there(node: AnatomyNode): Boolean {
        if (!node.optional && !node.wrapper) return true
        val given = node.name?.let { instance.parts[it] }
        if (!(given ?: node.created)) return false
        val requires = node.requires ?: return true
        return find(requires, anatomy.root)?.let(::there) ?: false
    }

    /** The node with the name, anywhere in the anatomy. */
    private fun find(name: String, child: AnatomyChild): AnatomyNode? =
        when (child) {
            is AnatomyHole -> null
            is AnatomyChoice -> child.oneOf.values.firstNotNullOfOrNull { find(name, it) }
            is AnatomyNode -> if (child.name == name) child else child.children.firstNotNullOfOrNull { find(name, it) }
        }

    private fun element(node: AnatomyNode, place: Place): String {
        fun children(inside: Place) =
            node.children.withIndex().joinToString("") { (i, c) -> write(c, inside.copy(address = "${place.address}/$i", choice = null)) }
        if (node.whenOption != null && !truthy(options[node.whenOption])) return ""
        if (!there(node)) return if (node.wrapper) children(place) else ""

        // The builder functions this node is the first to call. The designer's
        // settings come first, and the anatomy's fixed options win over them.
        val named = node.name ?: place.choice?.name
        val settings = named?.let { read(instance.settings[it], listOfNotNull(place.group), place.keys) } ?: emptyMap()
        val answers = LinkedHashMap(place.answers)
        for (source in node.from) {
            val name = source.substringBefore('.')
            val fixed = node.options[name]
            if (name in answers && fixed == null) continue
            // The anatomy's own builder function, unless the node calls it anew,
            // takes the instance's options and the bound ones.
            if (name == builder && fixed == null) {
                answers[name] = call(name, options)
                continue
            }
            val given = (fixed ?: emptyMap()).mapValues { (_, v) -> if (v is AnatomyHole) attribute(v.hole, place.keys) else v }
            val own = if (name == builder) options else emptyMap()
            answers[name] = call(name, own + settings + given)
        }

        // `null` is an attribute written bare. A builder function writes a flag
        // as the empty text, so that is bare; an empty value from a hole, the
        // anatomy or `annotate` is written as `=""`.
        val attributes = LinkedHashMap<String, String?>()
        for (source in node.from) {
            for ((attribute, value) in attributesOf(source, answers, place)) {
                val before = attributes[attribute]
                attributes[attribute] = if (value.isEmpty()) null else if (attribute == "class" && before != null) "$before $value" else value
            }
        }
        for ((attribute, value) in node.attributes) {
            if (value is AnatomyAttribute.Fixed) {
                attributes[attribute] = value.value
                continue
            }
            val hole = value as AnatomyHole
            val declaration = declared(hole.hole)
            val given = attribute(hole.hole, place.keys)
            if (declaration.kind == HoleKind.FLAG) {
                if (given == "true") attributes[attribute] = hole.value
                continue
            }
            val values = declaration.values
            require(values == null || given == null || given in values) {
                "Anatomies.render: the hole ${hole.hole} can be ${values!!.joinToString(", ")}, not $given."
            }
            if (given == null) {
                require(declaration.optional) { "Anatomies.render: $builder needs a value for the hole ${hole.hole}." }
                continue
            }
            attributes[attribute] = given
        }
        // The tool's own attributes never replace the anatomy's: an id the
        // anatomy gives is the one aria-labelledby and the links point at. A
        // class is joined to the anatomy's, as classes from sources are.
        for ((given, value) in instance.annotate?.invoke(place.address) ?: emptyMap()) {
            val attribute = given.lowercase()
            val before = attributes[attribute]
            if (attribute == "class" && before != null) {
                attributes["class"] = "$before $value"
            } else if (attribute !in attributes) {
                attributes[attribute] = value
            }
        }

        val written = attributes.entries.joinToString("") { (attribute, value) -> if (value == null) " $attribute" else " $attribute=\"${escapeAttribute(value)}\"" }
        val asked = node.name?.let { instance.tags[it] }
        require(asked == null || asked in node.tags) { "Anatomies.render: ${node.name} can be ${node.tags.joinToString(", ")}, not $asked." }
        val tag = asked ?: node.tags.first()
        if (tag in Anatomies.VOID) return "<$tag$written>"
        return "<$tag$written>${children(place.copy(answers = answers))}</$tag>"
    }

    /**
     * The attributes one source gives: the whole answer of a builder
     * function, a set in it, the item's own when the set is a list, or a
     * class the function carries, read from [Builder.classes].
     */
    @Suppress("UNCHECKED_CAST")
    private fun attributesOf(source: String, answers: Map<String, Map<String, Any?>>, place: Place): Map<String, String> {
        val name = source.substringBefore('.')
        val answer = answers.getValue(name)
        if ('.' !in source) return answer as Map<String, String>
        val field = source.substringAfter('.')
        val returns = manifest.builders.firstOrNull { it.name == name }?.returns
        if (field in answer) {
            val set = answer[field]
            if (set !is List<*>) return set as Map<String, String>? ?: emptyMap()
            // A list from the anatomy's own builder function has one set for each
            // key of the group its keys come from.
            val bound = anatomy.options.values.filterIsInstance<AnatomyOption.Repeat>().map { it.repeat }
            // The node's own group when its keys are bound, otherwise the one
            // bound group the node stands in.
            val group = place.group?.takeIf { it in bound } ?: bound.firstOrNull { it in place.keys }
            val at = if (group != null) keys(group).indexOf(place.keys[group]) else -1
            return set.getOrNull(at) as Map<String, String>? ?: emptyMap()
        }
        val constant = manifest.builders.firstOrNull { it.name == name }?.classes?.get(field)
        if (constant != null) return mapOf("class" to constant)
        // An optional set the answer leaves out gives nothing.
        if (returns is Returns.Group && field in returns.fields) return emptyMap()
        throw IllegalArgumentException("Anatomies.render: $source is neither a set nor a class.")
    }

    /** Calls a builder function in [Lt] by name. */
    @Suppress("UNCHECKED_CAST")
    private fun call(name: String, options: Map<String, Any?>): Map<String, Any?> =
        try {
            Dispatch.call(name, options) as Map<String, Any?>
        } catch (e: IllegalArgumentException) {
            throw e
        } catch (e: RuntimeException) {
            // A value of the wrong type, or one the option does not have.
            throw IllegalArgumentException("Anatomies.render: Lt.$name cannot take ${Json.write(options)}.", e)
        }

    /** As `!value` in JavaScript reads it the other way round. */
    private fun truthy(value: Any?): Boolean =
        when (value) {
            null, false, "" -> false
            is Number -> value.toDouble().let { it != 0.0 && !it.isNaN() }
            else -> true
        }

    /** Text: `&` and `<`. Attributes: `&` and `"`. Content is written as it is. */
    private fun escapeText(text: String) = text.replace("&", "&amp;").replace("<", "&lt;")

    private fun escapeAttribute(text: String) = text.replace("&", "&amp;").replace("\"", "&quot;")
}
