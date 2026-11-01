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
                        )
                    },
                returns = returns(b["returns"].obj("$at.returns"), "$at.returns"),
                classes = b["classes"]?.texts("$at.classes") ?: emptyMap(),
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
 * CSS [variable] that replaces it.
 */
data class CssText(
    val variable: String,
    val text: String,
    val attribute: String,
    val value: String?,
    val unless: List<String>,
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
)

/** One option, like `variant` in `lt.button()`. [description] is the first paragraph of the comment on the option in the type. */
data class BuilderOption(
    val name: String,
    val required: Boolean,
    val type: OptionType,
    val description: String?,
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
