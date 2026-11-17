package no.lotek

/**
 * The vocabulary in `manifest.json`: the elements and classes LO-TEK has, as
 * `manifest.schema.json` describes them. It is the same manifest the core
 * checks against, so a tool that shows completion or documentation from it
 * is never out of step with the diagnostics.
 *
 * The classes have their content and parts, so a tool can assemble the
 * markup from them, and [Manifest.tokens] has the spacing, breakpoints,
 * container widths, colour axes and component variables it can style with.
 * [Lotek.manifest] is the manifest in the package. [parse] reads another,
 * like the one `lotek manifest` and the Gradle task `lotekManifest` write for
 * a project that has taken over components. The builder functions are in
 * [builders] with their options and the shape of the result, so a tool can
 * build a panel from them. The table the generator behind `Lt` uses is left
 * out: it is for the generator.
 *
 * The maps have their keys in the order the manifest has them.
 */
data class Manifest(
    /** The version of `@lo-tek/interfaces` the manifest was written from. */
    val version: String,
    /** Every `<lt-…>` element, by tag. */
    val elements: Map<String, ManifestElement>,
    /** Every `lt-` class, by name. */
    val classes: Map<String, ManifestClass>,
    /**
     * The tokens: the spacing scale, the breakpoints, the container widths,
     * the colour axes and the component variables. `null` in a manifest from
     * before 0.34, which does not have them; `schemaVersion` is the same, so
     * the reader tolerates them missing.
     */
    val tokens: ManifestTokens?,
    /** Every builder function in `lt`, in the manifest's order, with its options and the shape of the result. */
    val builders: List<Builder>,
    /** The language of the texts the components and stylesheets write themselves, like `en`. `null` in a manifest from before it was there. */
    val textLanguage: String? = null,
) {
    companion object {
        /** The schema version this reader understands. */
        const val SCHEMA_VERSION = 1

        /**
         * Reads [json], the text of a `manifest.json`. A manifest with another
         * schema version, or without the shape the schema requires, throws
         * [IllegalArgumentException] with the path to what is wrong.
         */
        fun parse(json: String): Manifest {
            val root = Json.parse(json).obj("the manifest")
            val schema = root["schemaVersion"].num("schemaVersion")
            require(schema == SCHEMA_VERSION.toDouble()) {
                val shown = if (schema % 1.0 == 0.0) schema.toLong().toString() else schema.toString()
                "The manifest has schemaVersion $shown, and this version of LO-TEK reads only $SCHEMA_VERSION."
            }
            return Manifest(
                version = root["version"].str("version"),
                elements = root["elements"].obj("elements").mapValues { (tag, e) -> element(tag, e.obj("elements.$tag"), "elements.$tag") },
                classes = root["classes"].obj("classes").mapValues { (name, c) -> klass(name, c.obj("classes.$name"), "classes.$name") },
                tokens = root["tokens"]?.let { tokens(it.obj("tokens"), "tokens") },
                builders =
                    (root["builders"] as? List<*> ?: wrong("builders", "a list")).mapIndexed { i, b ->
                        builder(b.obj("builders[$i]"), "builders[$i]")
                    },
                textLanguage = root["textLanguage"]?.str("textLanguage"),
            )
        }

        private fun nameOf(value: Any?, at: String): Name? =
            value?.obj(at)?.let { n ->
                Name(
                    after = n["after"]?.str("$at.after"),
                    id = n["id"] == true,
                    component = n["component"] == true,
                )
            }

        private fun builder(b: Map<String, Any?>, at: String) =
            Builder(
                name = b["name"].str("$at.name"),
                options =
                    (b["options"] as? List<*> ?: wrong("$at.options", "a list")).mapIndexed { i, o ->
                        val path = "$at.options[$i]"
                        val option = o.obj(path)
                        BuilderOption(
                            name = option["name"].str("$path.name"),
                            required = option["required"] as? Boolean ?: wrong("$path.required", "true or false"),
                            type = optionType(option["type"].obj("$path.type"), "$path.type"),
                            description = option["description"]?.str("$path.description"),
                            default = option["default"]?.str("$path.default"),
                        )
                    },
                returns = returns(b["returns"].obj("$at.returns"), "$at.returns"),
                classes = b["classes"]?.texts("$at.classes") ?: emptyMap(),
                description = b["description"]?.str("$at.description"),
                example = b["example"]?.str("$at.example"),
                docs = b["docs"]?.str("$at.docs"),
                anatomy = b["anatomy"]?.let { anatomy(it.obj("$at.anatomy"), "$at.anatomy") },
                parts =
                    b["parts"]?.obj("$at.parts")?.mapValues { (field, p) ->
                        val path = "$at.parts.$field"
                        val part = p.obj(path)
                        BuilderPart(element = part["element"].str("$path.element"), part = part["part"].str("$path.part"))
                    } ?: emptyMap(),
            )

        private fun anatomy(a: Map<String, Any?>, at: String): Anatomy {
            val nodes = a["nodes"] as? List<*> ?: wrong("$at.nodes", "a list")
            if (nodes.size != 1) wrong("$at.nodes", "a list with one root")
            return Anatomy(
                holes =
                    a["holes"].obj("$at.holes").mapValues { (name, h) ->
                        val path = "$at.holes.$name"
                        val hole = h.obj(path)
                        AnatomyHoleDeclaration(
                            description = hole["description"].str("$path.description"),
                            content = hole["content"]?.let { enumOf<HoleContent>(it.str("$path.content"), "$path.content") },
                            kind = hole["kind"]?.let { enumOf<HoleKind>(it.str("$path.kind"), "$path.kind") },
                            per = hole["per"]?.strings("$path.per") ?: emptyList(),
                            optional = hole["optional"] == true,
                            example = hole["example"]?.str("$path.example"),
                            values = hole["values"]?.strings("$path.values"),
                        )
                    },
                options =
                    (a["options"]?.obj("$at.options") ?: emptyMap()).mapValues { (name, o) ->
                        val path = "$at.options.$name"
                        val option = o.obj(path)
                        when {
                            "hole" in option -> AnatomyOption.Hole(option["hole"].str("$path.hole"))
                            "repeat" in option -> AnatomyOption.Repeat(option["repeat"].str("$path.repeat"))
                            "count" in option -> AnatomyOption.Count(option["count"].str("$path.count"))
                            "tool" in option -> AnatomyOption.Tool(option["tool"].str("$path.tool"))
                            "choice" in option ->
                                AnatomyOption.Choice(option["choice"].str("$path.choice"), option["alternative"].str("$path.alternative"))
                            else -> wrong(path, "a hole, a repeat, a count, a tool or a choice")
                        }
                    },
                repeats =
                    (a["repeats"]?.obj("$at.repeats") ?: emptyMap()).mapValues { (group, r) ->
                        val path = "$at.repeats.$group"
                        val repeat = r.obj(path)
                        AnatomyRepeat(min = repeat["min"].num("$path.min").toInt(), description = repeat["description"].str("$path.description"))
                    },
                root = child(nodes[0], "$at.nodes[0]"),
            )
        }

        private fun hole(h: Map<String, Any?>, at: String) = AnatomyHole(hole = h["hole"].str("$at.hole"), value = h["value"]?.str("$at.value"))

        private fun child(value: Any?, at: String): AnatomyChild {
            val c = value.obj(at)
            return when {
                "hole" in c -> hole(c, at)
                "oneOf" in c ->
                    AnatomyChoice(
                        name = c["name"].str("$at.name"),
                        description = c["description"].str("$at.description"),
                        oneOf =
                            c["oneOf"].obj("$at.oneOf").mapValues { (name, n) ->
                                child(n, "$at.oneOf.$name") as? AnatomyNode ?: wrong("$at.oneOf.$name", "a node")
                            },
                        repeat = c["repeat"]?.str("$at.repeat"),
                    )
                "tag" in c -> node(c, at)
                else -> wrong(at, "a node, a hole or a choice")
            }
        }

        private fun node(n: Map<String, Any?>, at: String) =
            AnatomyNode(
                tags = (n["tag"] as? String)?.let { listOf(it) } ?: n["tag"].strings("$at.tag"),
                from = n["from"]?.strings("$at.from") ?: emptyList(),
                attributes =
                    (n["attributes"]?.obj("$at.attributes") ?: emptyMap()).mapValues { (name, v) ->
                        val path = "$at.attributes.$name"
                        if (v is String) AnatomyAttribute.Fixed(v) else hole(v.obj(path), path)
                    },
                children = (n["children"] as? List<*> ?: emptyList<Any?>()).mapIndexed { i, c -> child(c, "$at.children[$i]") },
                options =
                    (n["options"]?.obj("$at.options") ?: emptyMap()).mapValues { (builder, o) ->
                        o.obj("$at.options.$builder").mapValues { (option, v) ->
                            // A value that is a hole is read at the node's place; any other is passed as it is.
                            if (v is Map<*, *> && "hole" in v) hole(v.obj("$at.options.$builder.$option"), "$at.options.$builder.$option") else v
                        }
                    },
                settings = n["settings"]?.strings("$at.settings") ?: emptyList(),
                name = n["name"]?.str("$at.name"),
                description = n["description"]?.str("$at.description"),
                optional = n["optional"] == true,
                wrapper = n["wrapper"] == true,
                created = n["created"] == true,
                requires = n["requires"]?.str("$at.requires"),
                whenOption = n["when"]?.str("$at.when"),
                repeat = n["repeat"]?.str("$at.repeat"),
            )

        private fun optionType(t: Map<String, Any?>, at: String): OptionType =
            when (val kind = t["kind"].str("$at.kind")) {
                "values" -> OptionType.Values(t["values"].strings("$at.values"))
                "flag" -> OptionType.Flag
                "text" -> OptionType.Text
                "number" -> OptionType.Number
                "textList" -> OptionType.TextList
                else -> wrong("$at.kind", "one of \"values\", \"flag\", \"text\", \"number\", \"textList\", not \"$kind\"")
            }

        private fun returns(r: Map<String, Any?>, at: String): Returns {
            val optional = r["optional"] == true
            return when (val kind = r["kind"].str("$at.kind")) {
                "attributes" -> Returns.Attributes(optional)
                "text" -> Returns.Text(optional)
                "values" -> Returns.Values(r["values"].strings("$at.values"), optional)
                "list" -> Returns.ListOf(returns(r["of"].obj("$at.of"), "$at.of"), optional)
                "group" -> Returns.Group(r["fields"].obj("$at.fields").mapValues { (field, f) -> returns(f.obj("$at.fields.$field"), "$at.fields.$field") }, optional)
                else -> wrong("$at.kind", "one of \"attributes\", \"text\", \"values\", \"list\", \"group\", not \"$kind\"")
            }
        }

        private fun Any?.texts(at: String): Map<String, String> = obj(at).mapValues { (key, v) -> v.str("$at.$key") }

        private fun tokens(t: Map<String, Any?>, at: String): ManifestTokens {
            val colors = t["colors"].obj("$at.colors")
            return ManifestTokens(
                spacing = t["spacing"].texts("$at.spacing"),
                breakpoints = t["breakpoints"].texts("$at.breakpoints"),
                containers = t["containers"].texts("$at.containers"),
                colors =
                    ManifestColors(
                        families = colors["families"].texts("$at.colors.families"),
                        roles = colors["roles"].texts("$at.colors.roles"),
                        layers = colors["layers"].texts("$at.colors.layers"),
                        tokens = colors["tokens"].strings("$at.colors.tokens"),
                    ),
                components = t["components"].obj("$at.components").mapValues { (component, v) -> v.texts("$at.components.$component") },
            )
        }

        private fun element(tag: String, e: Map<String, Any?>, at: String) =
            ManifestElement(
                tag = tag,
                link = e["link"].str("$at.link"),
                description = e["description"]?.str("$at.description"),
                attributes =
                    e["attributes"].obj("$at.attributes").mapValues { (name, a) ->
                        val path = "$at.attributes.$name"
                        val attribute = a.obj(path)
                        val type = attribute["type"].str("$path.type")
                        ElementAttribute(
                            type = enumOf<AttributeType>(type, "$path.type"),
                            values = if (type == "values") attribute["values"].strings("$path.values") else emptyList(),
                            description = attribute["description"]?.str("$path.description"),
                        )
                    },
                parts = parts(e["parts"], "$at.parts"),
                events =
                    (e["events"]?.obj("$at.events") ?: emptyMap()).mapValues { (name, ev) ->
                        val path = "$at.events.$name"
                        ElementEvent(
                            detail = (ev.obj(path)["detail"]?.obj("$path.detail") ?: emptyMap()).mapValues { (field, t) -> t.str("$path.detail.$field") },
                        )
                    },
                removed = (e["removed"]?.obj("$at.removed") ?: emptyMap()).mapValues { (name, note) -> note.str("$at.removed.$name") },
                named = nameOf(e["name"], "$at.name"),
                texts =
                    (e["texts"]?.obj("$at.texts") ?: emptyMap()).mapValues { (key, t) ->
                        val path = "$at.texts.$key"
                        val text = t.obj(path)
                        DefaultText(text = text["text"].str("$path.text"), replacedBy = text["replacedBy"].strings("$path.replacedBy"))
                    },
            )

        private fun parts(value: Any?, at: String): Map<String, Part> =
            (value?.obj(at) ?: emptyMap()).mapValues { (name, p) ->
                val path = "$at.$name"
                val part = p.obj(path)
                Part(
                    selector = part["selector"].str("$path.selector"),
                    description = part["description"].str("$path.description"),
                    content = enumOf<PartContent>(part["content"].str("$path.content"), "$path.content"),
                    multiple = part["multiple"] == true,
                    unique = part["unique"] == true,
                    optional = part["optional"] == true,
                    stableId = part["stableId"] == true,
                    named = nameOf(part["name"], "$path.name"),
                )
            }

        private fun klass(name: String, c: Map<String, Any?>, at: String) =
            ManifestClass(
                name = name,
                component = c["component"].str("$at.component"),
                title = c["title"].str("$at.title"),
                description = c["description"].str("$at.description"),
                link = c["link"].str("$at.link"),
                content = c["content"]?.let { enumOf<PartContent>(it.str("$at.content"), "$at.content") },
                partOf = c["partOf"]?.str("$at.partOf"),
                parts = parts(c["parts"], "$at.parts"),
                named = nameOf(c["name"], "$at.name"),
                texts =
                    (c["texts"] as? List<*> ?: emptyList<Any?>()).mapIndexed { i, t ->
                        val path = "$at.texts[$i]"
                        val text = t.obj(path)
                        CssText(
                            variable = text["variable"].str("$path.variable"),
                            text = text["text"].str("$path.text"),
                            attribute = text["attribute"].str("$path.attribute"),
                            value = text["value"]?.str("$path.value"),
                            unless = text["unless"]?.strings("$path.unless") ?: emptyList(),
                            siblingsBefore = text["siblingsBefore"] == true,
                        )
                    },
                tags =
                    (c["tags"] as? List<*> ?: emptyList<Any?>()).mapIndexed { i, t ->
                        val path = "$at.tags[$i]"
                        val tag = t.obj(path)
                        ClassTag(
                            tag = tag["tag"].str("$path.tag"),
                            attributes = (tag["attributes"]?.obj("$path.attributes") ?: emptyMap()).mapValues { (name, values) -> values.strings("$path.attributes.$name") },
                            requires = tag["requires"]?.strings("$path.requires") ?: emptyList(),
                        )
                    },
                attributes =
                    c["attributes"].obj("$at.attributes").mapValues { (attr, a) ->
                        val path = "$at.attributes.$attr"
                        val attribute = a.obj(path)
                        val flag = attribute["flag"] == true
                        ClassAttribute(
                            values = if (flag) emptyList() else attribute["values"].strings("$path.values"),
                            default = attribute["default"]?.str("$path.default"),
                            flag = flag,
                            description = attribute["description"]?.str("$path.description"),
                        )
                    },
            )

        @Suppress("UNCHECKED_CAST")
        private fun Any?.obj(at: String): Map<String, Any?> = this as? Map<String, Any?> ?: wrong(at, "an object")

        private fun Any?.str(at: String): String = this as? String ?: wrong(at, "a text")

        private fun Any?.num(at: String): Double = this as? Double ?: wrong(at, "a number")

        private fun Any?.strings(at: String): List<String> =
            (this as? List<*> ?: wrong(at, "a list")).mapIndexed { i, v -> v.str("$at[$i]") }

        private inline fun <reified E : Enum<E>> enumOf(value: String, at: String): E =
            enumValues<E>().firstOrNull { it.json == value }
                ?: wrong(at, "one of ${enumValues<E>().joinToString { "\"${it.json}\"" }}, not \"$value\"")

        private val Enum<*>.json get() = name.lowercase()

        private fun wrong(at: String, expected: String): Nothing =
            throw IllegalArgumentException("The manifest cannot be read: $at should have been $expected.")
    }
}

/** An `<lt-…>` element, with the attributes the component reads and the parts it finds. */
data class ManifestElement(
    val tag: String,
    /** The address of the component page. */
    val link: String,
    /** What the element does, in one or two sentences. */
    val description: String?,
    val attributes: Map<String, ElementAttribute>,
    /** The parts in the markup, with the selector the component searches with. Empty when the element creates its own nodes. */
    val parts: Map<String, Part>,
    /** The events the element dispatches. All bubble. */
    val events: Map<String, ElementEvent>,
    /** Attributes that were removed from the element, with what applies instead. */
    val removed: Map<String, String>,
    /** The name LO-TEK demands for the element itself, beyond WAI-ARIA's. */
    val named: Name? = null,
    /** The texts the element writes itself, by their name in `DEFAULT_TEXTS`. */
    val texts: Map<String, DefaultText> = emptyMap(),
)

/**
 * A name LO-TEK demands where WAI-ARIA does not, or one the component gives
 * itself. [after] is the part the component points `aria-labelledby` at when
 * the markup gives no name; with [id] that part needs an id from the
 * template. With [component] the component names it itself, and no rule
 * judges its name in the markup.
 */
data class Name(
    val after: String?,
    val id: Boolean,
    val component: Boolean,
)

/** A text a component writes itself when nobody has given it another, and the attributes that replace it, any one of them. */
data class DefaultText(
    val text: String,
    val replacedBy: List<String>,
)

/**
 * A text a stylesheet shows on an element with the class and [attribute],
 * with [value] when the selector requires one and none of [unless], and the
 * CSS [variable] that replaces it. With [siblingsBefore], the attribute is on
 * a child of the element with the class, and the text is shown on the
 * children before it, as "Completed " is on the steps before the one with
 * `aria-current="step"` in `lt-steps`.
 */
data class CssText(
    val variable: String,
    val text: String,
    val attribute: String,
    val value: String?,
    val unless: List<String>,
    val siblingsBefore: Boolean = false,
)

/** An attribute on an element, like `server-controlled`. [values] is empty except for [AttributeType.VALUES]. */
data class ElementAttribute(
    val type: AttributeType,
    val values: List<String>,
    val description: String?,
)

enum class AttributeType { FLAG, TEXT, NUMBER, VALUES }

/**
 * A part of an element, like the control in `<lt-field>`. [selector] is the
 * one the component finds the part with, relative to the element. Without
 * [multiple] the first applies, and with [unique] another part of the same
 * kind is an error, not ordinary content. Without [optional] the element
 * needs the part. With [stableId] the part must have an id from the server:
 * the component never writes one.
 */
data class Part(
    val selector: String,
    val description: String,
    val content: PartContent,
    val multiple: Boolean,
    val unique: Boolean,
    val optional: Boolean,
    val stableId: Boolean,
    /** The name LO-TEK demands for the part. */
    val named: Name? = null,
)

/**
 * What a part takes: [TEXT] is text and phrasing content without interactive
 * elements, [FREE] any content, [PARTS] only the other parts, and [NONE] no
 * text, like a control or an element the component fills.
 */
enum class PartContent { TEXT, FREE, PARTS, NONE }

/** An event an element dispatches. [detail] is the fields of `event.detail` with their type: `boolean`, `string` or `number`. */
data class ElementEvent(
    val detail: Map<String, String>,
)

/** A builder function in `lt`, like `button`, with the options it takes and the shape of what it returns. */
data class Builder(
    val name: String,
    /** The options in the manifest's order. */
    val options: List<BuilderOption>,
    val returns: Returns,
    /**
     * The classes for the parts the template writes itself, as `lt.card.title`
     * in TypeScript: the name on the function and the class. Empty for most.
     */
    val classes: Map<String, String> = emptyMap(),
    /**
     * The comment on the function in TypeScript, without the code examples.
     * `null` in a manifest from before 0.40; `schemaVersion` is the same, so
     * the reader tolerates it missing, as with [example], [docs] and [parts].
     */
    val description: String? = null,
    /** The code examples in the comment, in TypeScript. */
    val example: String? = null,
    /** The page the function is documented on. */
    val docs: String? = null,
    /**
     * Which part of a frame component each set in the result fills, as
     * `field.control` fills the control of `lt-field`. A set that fills no
     * part is not here.
     */
    val parts: Map<String, BuilderPart> = emptyMap(),
    /**
     * The markup the function belongs in, which [Anatomies.render] writes.
     * `null` for a function that is only a source in another's anatomy,
     * and in a manifest from before 0.46.
     */
    val anatomy: Anatomy? = null,
)

/** A part of a frame component, as `control` in `lt-field`. Its selector is in [Manifest.elements]. */
data class BuilderPart(
    val element: String,
    val part: String,
)

/** One option, like `variant` in `lt.button()`. [description] is the first paragraph of the comment on the option in the type. */
data class BuilderOption(
    val name: String,
    val required: Boolean,
    val type: OptionType,
    val description: String?,
    /** The value that gives the same answer as leaving the option out, for an option with a closed list. */
    val default: String? = null,
)

/** What an option takes: a closed list, a flag, text, a number or a list of texts. */
sealed interface OptionType {
    data class Values(val values: List<String>) : OptionType

    data object Flag : OptionType

    data object Text : OptionType

    data object Number : OptionType

    data object TextList : OptionType
}

/**
 * The shape of what a builder function returns: an attribute set, a text,
 * one of a few values, a list of a shape, or a group of named shapes, like
 * `dialog` with `host`, `dialog` and `title`. [optional] applies to a field
 * in a group that can be missing.
 */
sealed interface Returns {
    val optional: Boolean

    data class Attributes(override val optional: Boolean = false) : Returns

    data class Text(override val optional: Boolean = false) : Returns

    data class Values(val values: List<String>, override val optional: Boolean = false) : Returns

    data class ListOf(val of: Returns, override val optional: Boolean = false) : Returns

    data class Group(val fields: Map<String, Returns>, override val optional: Boolean = false) : Returns
}

/**
 * The tokens: what a stylesheet outside the package can build on. The colours
 * are listed as axes with what they are for, not as values, since a theme can
 * have other values than LO-TEK's.
 */
data class ManifestTokens(
    /** The spacing scale, name to value, like `--lt-spacing-4` to `1rem`. */
    val spacing: Map<String, String>,
    /** The breakpoints, name to width, like `md` to `768px`. */
    val breakpoints: Map<String, String>,
    /** The container widths, name to width, like `aside` to `384px`. */
    val containers: Map<String, String>,
    val colors: ManifestColors,
    /** The component variables per component, like `--lt-button-padding` under `button`, with the default value. */
    val components: Map<String, Map<String, String>>,
)

/** The colour axes. A colour token is named `--lt-color-<family>-<role>`. */
data class ManifestColors(
    /** The families, with what each is for. */
    val families: Map<String, String>,
    /** The roles as they are written in CSS, with what each is for. */
    val roles: Map<String, String>,
    /** The layers only the neutral family has, like `canvas`. */
    val layers: Map<String, String>,
    /** Every `--lt-color-*` name the package ships. */
    val tokens: List<String>,
)

/**
 * A class in the manifest, like `lt-button`, with the component it belongs
 * to, what the element with the class takes as content, and the parts the
 * markup consists of.
 */
data class ManifestClass(
    val name: String,
    /** The address of the component page, relative, like `button`. */
    val component: String,
    val title: String,
    val description: String,
    val link: String,
    /** What the element with the class takes as content, in the same words as the parts. `null` in a manifest from before 0.34. */
    val content: PartContent?,
    /** The class this one is part of, like `lt-card` for `lt-card__title`. The parent has a part that matches it. */
    val partOf: String?,
    /** The parts the markup consists of, with the selector relative to the element with the class. Empty for the classes without a fixed structure. */
    val parts: Map<String, Part>,
    val attributes: Map<String, ClassAttribute>,
    /** The name LO-TEK demands for the element with the class. */
    val named: Name? = null,
    /** The texts the stylesheet shows on it. */
    val texts: List<CssText> = emptyList(),
    /** The tags the class can be on, the first being the one to write. Empty in a manifest from before 0.46. */
    val tags: List<ClassTag> = emptyList(),
)

/**
 * A tag a class can be on, like `<button>` for `lt-button`. [tag] is `*`
 * for any. [attributes] are the ones the tag must have, with the values it
 * may have there, like `type` on an input. [requires] are the ones it must
 * have with a value of the template's own, like `href` on a link.
 *
 * Not `Tag`: kotlinx.html has one, and the recipes import both packages with
 * a star, so the name would be ambiguous in every app that follows them.
 */
data class ClassTag(
    val tag: String,
    val attributes: Map<String, List<String>> = emptyMap(),
    val requires: List<String> = emptyList(),
)

/**
 * An attribute a class takes, like `data-variant` on `lt-button`. A [flag]
 * works by being present, and has no [values]. [default] is the value its
 * absence means.
 */
data class ClassAttribute(
    val values: List<String>,
    val default: String?,
    val flag: Boolean,
    val description: String?,
)

/**
 * The markup a builder function belongs in: the elements, where each
 * one's attributes come from, and the holes the template fills. A design
 * tool builds a component from it, and [Anatomies.render] writes it, as
 * `renderAnatomy()` does in `@lo-tek/interfaces/anatomy`. There is one
 * [root], so the component is one box in a layout. The rules are the ones
 * on the types in `vocabulary/types.ts` in the npm package.
 */
data class Anatomy(
    /** What each hole holds, by name. */
    val holes: Map<String, AnatomyHoleDeclaration>,
    /** The options of the builder function the panel does not show, and where each gets its value. */
    val options: Map<String, AnatomyOption> = emptyMap(),
    /** The groups that repeat, with how few items each may have. */
    val repeats: Map<String, AnatomyRepeat> = emptyMap(),
    /** The one element the component is, `nodes[0]` in the manifest. */
    val root: AnatomyChild,
)

/** A group that repeats, as the tabs in `lt-tabs`, with how few items it may have. */
data class AnatomyRepeat(
    val min: Int,
    val description: String,
)

/**
 * What a hole holds, declared once for the anatomy, so a tool knows what
 * to ask for and what may be dropped there. A hole among the children has
 * [content]; a hole in an attribute has [kind].
 */
data class AnatomyHoleDeclaration(
    val description: String,
    val content: HoleContent? = null,
    /**
     * What an attribute hole holds. An [HoleKind.ID] hole the instance
     * leaves empty gets `<instance id>-<hole>`, and `-<key>` for each group
     * in [per], so the same component gets the same ids on every render.
     * A [HoleKind.FLAG] writes the attribute bare when it is on, and leaves
     * it out when it is off.
     */
    val kind: HoleKind? = null,
    /**
     * The groups the hole has a value for each item in, outermost first, as
     * a tab's title per `tab`. Empty when the hole has one value for the
     * whole component.
     */
    val per: List<String> = emptyList(),
    /**
     * Without a value, the attribute is left out. Without it, an attribute
     * hole without a value is an error. An empty text is a value.
     */
    val optional: Boolean = false,
    /** What a tool fills in on a new component, so it is correct as created. */
    val example: String? = null,
    /** The values an attribute hole can take, as `true` and `false` for `aria-pressed`. */
    val values: List<String>? = null,
)

/** What a hole among the children takes: [TEXT] is text, [FREE] other elements too, and is where a tool drops them. */
enum class HoleContent { TEXT, FREE }

/** What an attribute hole holds. */
enum class HoleKind { TEXT, ID, NAME, VALUE, URL, FLAG }

/** What can stand among the children of a node. */
sealed interface AnatomyChild

/** An attribute no builder function writes: a fixed value, or an [AnatomyHole]. */
sealed interface AnatomyAttribute {
    data class Fixed(val value: String) : AnatomyAttribute
}

/**
 * A place the template fills, among the children of a node or in an
 * attribute, by the name it is declared under in [Anatomy.holes]. [value]
 * is, in an attribute with a flag hole, the value written when the flag is
 * on, as `true` for `aria-hidden`; without it, the attribute is bare.
 */
data class AnatomyHole(
    val hole: String,
    val value: String? = null,
) : AnatomyChild, AnatomyAttribute

/**
 * A place with alternatives the designer chooses between, as a plain or a
 * sortable column heading. The first in [oneOf] is the one a tool creates.
 * With [repeat], each item in the group chooses for itself.
 */
data class AnatomyChoice(
    val name: String,
    val description: String,
    val oneOf: Map<String, AnatomyNode>,
    val repeat: String? = null,
) : AnatomyChild

/**
 * One element in an anatomy.
 *
 * [from] is where its attributes come from, in order: a builder function
 * (`button`), a set in its answer (`field.control`), or a class the
 * function carries (`checkbox.row`, in [Builder.classes]). The attributes
 * merge in that order: a later value wins, `class` is joined, and a flag is
 * written bare. Then [attributes] are written over them.
 *
 * The first node that names a builder function calls it, as does a node
 * with [options] for it, with what the designer set under [settings] and
 * then [options], and the nodes inside use the same answer; a node outside
 * calls it anew. The anatomy's own builder function takes the instance's
 * options and the bound ones, and is called where a node first uses it.
 */
data class AnatomyNode(
    /** The tags to choose from, the first being the one to write. One for most nodes. */
    val tags: List<String>,
    val from: List<String> = emptyList(),
    val attributes: Map<String, AnatomyAttribute> = emptyMap(),
    val children: List<AnatomyChild> = emptyList(),
    /**
     * Options for a builder function, by its name. The node calls the
     * function anew with them, even when a node above has called it, and
     * they win over the designer's. A value that is an [AnatomyHole] is
     * read at the node's place; any other is the manifest's JSON.
     */
    val options: Map<String, Map<String, Any?>> = emptyMap(),
    /** The options of the builder functions the node calls that the designer sets here. Requires a [name]. */
    val settings: List<String> = emptyList(),
    /** What a tool shows, and what the instance uses for its parts, tag and settings. Unique in an anatomy. */
    val name: String? = null,
    val description: String? = null,
    /** The component works without the node. */
    val optional: Boolean = false,
    /** Optional, and the children stay when it is left out. */
    val wrapper: Boolean = false,
    /** An optional node that is there when a tool creates the component. */
    val created: Boolean = false,
    /** An optional node that can only be there with the named one, as the subtitle with the header. */
    val requires: String? = null,
    /** `when` in the manifest: the node is there exactly when this option of the anatomy's own builder function is on. */
    val whenOption: String? = null,
    /** The node is written once for each item in the group, and nodes in the same group repeat together. */
    val repeat: String? = null,
) : AnatomyChild

/**
 * Where an option of the anatomy's own builder function gets its value,
 * so a tool does not show it in the panel.
 */
sealed interface AnatomyOption {
    /** The value of a hole. */
    data class Hole(val hole: String) : AnatomyOption

    /** The keys of the items in a group. */
    data class Repeat(val repeat: String) : AnatomyOption

    /** The number of items in a group. */
    data class Count(val count: String) : AnatomyOption

    /** The tool itself, with what it does. */
    data class Tool(val tool: String) : AnatomyOption

    /** On exactly when the choice takes the alternative, as `disabled` with a disabled link. */
    data class Choice(val choice: String, val alternative: String) : AnatomyOption
}
