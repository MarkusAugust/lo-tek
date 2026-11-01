package no.lotek.build

import groovy.json.JsonSlurper
import org.gradle.api.DefaultTask
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.tasks.InputFile
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction

/**
 * Writes the Kotlin API from the manifest.
 *
 * The manifest (`interfaces/manifest/manifest.json`) is written by the
 * package from the TypeScript code. From it come the allowed values as
 * `enum`s, every builder function that has a table, and the types for the
 * results that have several sets. The few builder functions whose options
 * interact have no table and are written by hand in
 * `src/main/kotlin/no/lotek/Handwritten.kt`. All are tested against the
 * build cases in `ContractTest`.
 *
 * The files are written to `build/generated` on every build and are not
 * checked in. The manifest is checked in, and that is where a change shows.
 */
abstract class GenerateApi : DefaultTask() {
    @get:InputFile
    @get:PathSensitive(PathSensitivity.NONE)
    abstract val manifest: RegularFileProperty

    @get:OutputDirectory
    abstract val output: DirectoryProperty

    @TaskAction
    fun generate() {
        @Suppress("UNCHECKED_CAST")
        val parsed = JsonSlurper().parse(manifest.get().asFile) as Map<String, Any?>
        val dir = output.get().asFile.resolve("no/lotek")
        dir.deleteRecursively()
        dir.mkdirs()
        for ((name, content) in Generator(parsed).files()) dir.resolve(name).writeText(content)
    }
}

/** What the generator does, without Gradle, so it can be read on its own. */
class Generator(manifest: Map<String, Any?>) {
    private val version = manifest["version"] as String

    @Suppress("UNCHECKED_CAST")
    private val builders = manifest["builders"] as List<Map<String, Any?>>

    /** Allowed values used in several places get one shared name. */
    private val shared = mapOf(
        "state" to "FieldState",
        "required" to "RequiredMarker",
        "size" to "Size",
        "variant" to "SurfaceVariant",
    )

    private data class ValueSet(val option: String, val values: List<String>)

    private val uses = mutableMapOf<ValueSet, MutableSet<String>>()

    init {
        for (b in builders) {
            for (o in options(b)) {
                values(o)?.let { uses.getOrPut(ValueSet(o.name, it)) { mutableSetOf() }.add(b["name"] as String) }
            }
            collectReturnValues(b["name"] as String, returns(b))
        }
    }

    private fun collectReturnValues(builder: String, r: Map<String, Any?>) {
        @Suppress("UNCHECKED_CAST")
        when (r["kind"]) {
            "group" -> for ((name, field) in r["fields"] as Map<String, Map<String, Any?>>) {
                if (field["kind"] == "values") {
                    uses.getOrPut(ValueSet(name, field["values"] as List<String>)) { mutableSetOf() }
                        .add("$builder()")
                }
            }
        }
    }

    private fun enumName(set: ValueSet, builder: String): String {
        val users = uses[set].orEmpty()
        return if (users.size > 1) {
            shared[set.option] ?: pascal(set.option)
        } else {
            pascal(builder) + pascal(set.option)
        }
    }

    private data class Option(val name: String, val kind: String, val required: Boolean, val raw: Map<String, Any?>)

    @Suppress("UNCHECKED_CAST")
    private fun options(b: Map<String, Any?>): List<Option> =
        (b["options"] as List<Map<String, Any?>>).map {
            val type = it["type"] as Map<String, Any?>
            Option(it["name"] as String, type["kind"] as String, it["required"] as Boolean, type)
        }

    @Suppress("UNCHECKED_CAST")
    private fun values(o: Option): List<String>? =
        if (o.kind == "values") o.raw["values"] as List<String> else null

    @Suppress("UNCHECKED_CAST")
    private fun returns(b: Map<String, Any?>) = b["returns"] as Map<String, Any?>

    fun files(): Map<String, String> = mapOf(
        "Values.kt" to valuesFile(),
        "Lt.kt" to ltFile(),
        "Parts.kt" to partsFile(),
        "Classes.kt" to classesFile(),
        "Dispatch.kt" to dispatchFile(),
        "WebJar.kt" to webJarFile(),
    )

    private fun webJarFile(): String =
        header +
            """
            |package no.lotek
            |
            |/**
            | * The paths to the CSS and JavaScript in the WebJar that comes with the package.
            | *
            | * The files are under `META-INF/resources/webjars/lo-tek/$version/`, with the
            | * same paths as in the npm package. Spring Boot and servlet containers serve
            | * them as they are. In Ktor: `staticResources("/webjars", "META-INF/resources/webjars")`.
            | *
            | * ```kotlin
            | * ""${'"'}
            | * <link rel="stylesheet" href="${'$'}{LotekWebJar.CSS}">
            | * <script type="module">
            | *   import { defineLt } from "${'$'}{LotekWebJar.REGISTER}"
            | *   defineLt()
            | * </script>
            | * ""${'"'}
            | * ```
            | */
            |object LotekWebJar {
            |    /** The version of LO-TEK, the same as the npm package. */
            |    const val VERSION = "$version"
            |
            |    /** The directory the files are served from. A file in the npm package, like `dist/lotek.css`, is under it with the same path. */
            |    const val ROOT = "/webjars/lo-tek/${'$'}VERSION"
            |
            |    /** All the stylesheets in one file. */
            |    const val CSS = "${'$'}ROOT/dist/lotek.css"
            |
            |    /** The module that registers all the web components with `defineLt()`. */
            |    const val REGISTER = "${'$'}ROOT/dist/register.js"
            |}
            |""".trimMargin()

    private val header = "// Generated from the manifest of @lo-tek/interfaces $version. Do not edit.\n"

    private fun valuesFile(): String {
        val written = mutableMapOf<String, ValueSet>()
        val out = StringBuilder(header).append("package no.lotek\n")
        for ((set, users) in uses.entries.sortedBy { enumName(it.key, it.value.first()) }) {
            val name = enumName(set, users.first())
            // Two different sets with the same name would give one of them the wrong type.
            written.put(name, set)?.let { error("$name is used for both ${it.values} and ${set.values}. Give them separate names in Generator.shared.") }
            val where = users.sorted().joinToString(", ") { "`lt.$it`" }
            out.append("\n/** The allowed values for `${set.option}` in $where. */\n")
            out.append("enum class $name(val value: String) {\n")
            for (v in set.values) out.append("    ${constant(v)}(\"$v\"),\n")
            out.append("    ;\n\n")
            out.append("    override fun toString(): String = value\n\n")
            out.append("    companion object {\n")
            out.append("        /** The value with this text, or `null` when the text is not an allowed value. */\n")
            out.append("        fun of(value: String): $name? = entries.firstOrNull { it.value == value }\n")
            out.append("    }\n}\n")
        }
        return out.toString()
    }

    private fun kotlinType(b: Map<String, Any?>, o: Option): String {
        val base = when (o.kind) {
            "values" -> enumName(ValueSet(o.name, values(o)!!), b["name"] as String)
            "flag" -> "Boolean"
            "text" -> "String"
            "number" -> "Number"
            "textList" -> "List<String>"
            else -> error("Unknown option type ${o.kind} in ${b["name"]}")
        }
        return if (o.required) base else "$base? = null"
    }

    private fun signature(b: Map<String, Any?>): String =
        options(b).joinToString(",\n") { "        ${identifier(it.name)}: ${kotlinType(b, it)}" }

    private fun returnType(b: Map<String, Any?>): String =
        if (returns(b)["kind"] == "group") pascal(b["name"] as String) + "Parts" else "Attributes"

    private fun ltFile(): String {
        val out = StringBuilder(header).append("package no.lotek\n\n")
        out.append("/**\n * The builder functions, with the same names and options as `lt` in TypeScript.\n *\n")
        out.append(" * Each returns the attributes you put on the element. The builder functions\n")
        out.append(" * whose options interact are in `Handwritten.kt`.\n */\n")
        out.append("object Lt {\n")
        for (b in builders) {
            @Suppress("UNCHECKED_CAST")
            val table = b["table"] as Map<String, Any?>? ?: continue
            val name = b["name"] as String
            out.append("    /** `lt.$name` */\n")
            val parameters = if (options(b).isEmpty()) "" else "\n${signature(b)},\n    "
            out.append("    fun ${identifier(name)}($parameters): ${returnType(b)} {\n")
            @Suppress("UNCHECKED_CAST")
            if (table["kind"] == "attributes") {
                out.append(tableBody(b, table["table"] as Map<String, Any?>, "a", "        "))
                out.append("        return Attributes(a)\n")
            } else {
                val fields = table["fields"] as Map<String, Map<String, Any?>>
                for ((field, t) in fields) out.append(tableBody(b, t, "${field}Map", "        "))
                out.append("        return ${returnType(b)}(\n")
                for (field in fields.keys) out.append("            ${identifier(field)} = Attributes(${field}Map),\n")
                out.append("        )\n")
            }
            out.append("    }\n\n")
            if (classesOf(b).isNotEmpty()) {
                val type = classesType(name)
                val list = classesOf(b).keys.joinToString(", ") { "`Lt.$name.$it`" }
                out.append("    /** The parts of `lt.$name` the template writes itself: $list, as in TypeScript. */\n")
                out.append("    val ${identifier(name)}: $type = $type\n\n")
            }
        }
        out.setLength(out.length - 1)
        out.append("}\n")
        return out.toString()
    }

    /** The expression for a value in the table: text, or the value of an option. */
    private fun valueExpression(b: Map<String, Any?>, value: String): String {
        val placeholder = Regex("^\\{(\\w+)}$").find(value)?.groupValues?.get(1)
        val option = placeholder?.let { p -> options(b).firstOrNull { it.name == p } }
        return when (option?.kind) {
            "text" -> identifier(option.name)
            "number" -> "jsNumber(${identifier(option.name)})"
            "values" -> "${identifier(option.name)}.value"
            else -> literal(value)
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun statements(b: Map<String, Any?>, map: String, attrs: Map<String, Any?>, indent: String): String =
        attrs.entries.joinToString("") { (k, v) ->
            if (v == null) "$indent$map.remove(${literal(k)})\n"
            else "$indent$map[${literal(k)}] = ${valueExpression(b, v as String)}\n"
        }

    @Suppress("UNCHECKED_CAST")
    private fun tableBody(b: Map<String, Any?>, table: Map<String, Any?>, map: String, indent: String): String {
        val out = StringBuilder()
        val base = table["base"] as Map<String, Any?>
        out.append("${indent}val $map = linkedMapOf<String, String>()\n")
        out.append(statements(b, map, base, indent))
        val tableOptions = table["options"] as Map<String, Map<String, Any?>>
        for (o in options(b)) {
            val t = tableOptions[o.name] ?: continue
            val cases = t["cases"] as Map<String, Map<String, Any?>>
            val id = identifier(o.name)
            when (o.kind) {
                "values" -> {
                    val enum = enumName(ValueSet(o.name, values(o)!!), b["name"] as String)
                    val nonEmpty = cases.filterValues { it.isNotEmpty() }
                    if (nonEmpty.isEmpty()) continue
                    out.append("${indent}when ($id) {\n")
                    for ((value, attrs) in nonEmpty) {
                        out.append("$indent    $enum.${constant(value)} -> {\n")
                        out.append(statements(b, map, attrs, "$indent        "))
                        out.append("$indent    }\n")
                    }
                    out.append("$indent    else -> {}\n$indent}\n")
                }
                "flag" -> for ((value, attrs) in cases) {
                    if (attrs.isEmpty()) continue
                    out.append("${indent}if ($id == $value) {\n")
                    out.append(statements(b, map, attrs, "$indent    "))
                    out.append("$indent}\n")
                }
                "text", "number" -> {
                    val template = t["template"] as Map<String, Any?>? ?: emptyMap()
                    val empty = t["empty"] as Map<String, Any?>?
                    out.append("${indent}if ($id != null) {\n")
                    if (empty != null && o.kind == "text") {
                        out.append("$indent    if ($id.isEmpty()) {\n")
                        out.append(statements(b, map, empty, "$indent        "))
                        out.append("$indent    } else {\n")
                        out.append(statements(b, map, template, "$indent        "))
                        out.append("$indent    }\n")
                    } else {
                        out.append(statements(b, map, template, "$indent    "))
                    }
                    out.append("$indent}\n")
                }
            }
        }
        return out.toString()
    }

    private fun partsFile(): String {
        val out = StringBuilder(header).append("package no.lotek\n")
        for (b in builders) {
            val r = returns(b)
            if (r["kind"] != "group") continue
            val name = returnType(b)
            @Suppress("UNCHECKED_CAST")
            val fields = r["fields"] as Map<String, Map<String, Any?>>
            out.append("\n/** The sets `lt.${b["name"]}` returns. */\n")
            out.append("data class $name(\n")
            for ((field, f) in fields) out.append("    val ${identifier(field)}: ${fieldType(b, field, f)},\n")
            out.append(") {\n")
            out.append("    /** The result as values, in the same shape TypeScript gives it. */\n")
            out.append("    fun toMap(): Map<String, Any> = buildMap {\n")
            for ((field, f) in fields) {
                val id = identifier(field)
                val value = when (f["kind"]) {
                    "values" -> "$id.value"
                    else -> id
                }
                if (f["optional"] == true) out.append("        if ($id != null) put(${literal(field)}, $value)\n")
                else out.append("        put(${literal(field)}, $value)\n")
            }
            out.append("    }\n}\n")
        }
        return out.toString()
    }

    @Suppress("UNCHECKED_CAST")
    private fun fieldType(b: Map<String, Any?>, field: String, f: Map<String, Any?>): String {
        val base = when (f["kind"]) {
            "attributes" -> "Attributes"
            "list" -> "List<Attributes>"
            "values" -> enumName(ValueSet(field, f["values"] as List<String>), "${b["name"]}()")
            "text" -> "String"
            else -> error("Unknown result shape ${f["kind"]} in ${b["name"]}.$field")
        }
        return if (f["optional"] == true) "$base?" else base
    }

    /** The classes a builder function carries for the parts the template writes itself, `lt.card.title` and the like. */
    @Suppress("UNCHECKED_CAST")
    private fun classesOf(b: Map<String, Any?>): Map<String, String> =
        b["classes"] as Map<String, String>? ?: emptyMap()

    private fun classesType(builder: String): String = pascal(builder) + "Classes"

    /**
     * One object per builder function with class constants. Each constant is
     * a set with the class, so it goes where every other answer goes:
     * `h3 { lt(Lt.card.title) }` in kotlinx.html, `Lt.card.title.toHtml()` in
     * a string. In TypeScript the same constant is the class as text.
     */
    private fun classesFile(): String {
        val out = StringBuilder(header).append("package no.lotek\n")
        for (b in builders) {
            val classes = classesOf(b)
            if (classes.isEmpty()) continue
            val name = b["name"] as String
            out.append("\n/** The classes `lt.$name` carries for the parts the template writes itself. Reached as `Lt.$name`. */\n")
            out.append("object ${classesType(name)} {\n")
            for ((part, className) in classes) {
                out.append("    /** `lt.$name.$part` in TypeScript: the class `$className`. */\n")
                out.append("    val ${identifier(part)}: Attributes = Attributes(linkedMapOf(\"class\" to ${literal(className)}))\n\n")
            }
            out.setLength(out.length - 1)
            out.append("}\n")
        }
        return out.toString()
    }

    private fun dispatchFile(): String {
        val out = StringBuilder(header).append("package no.lotek\n\n")
        out.append("/**\n * Calls a builder function with options read from JSON. Used by the tests that\n")
        out.append(" * compare every build case with the result from TypeScript.\n */\n")
        out.append("internal object Dispatch {\n")
        out.append("    val names: List<String> = listOf(${builders.joinToString(", ") { literal(it["name"] as String) }})\n\n")
        out.append("    /** The class constants, by builder function and part, for the test against the manifest. */\n")
        out.append("    val classes: Map<String, Map<String, Attributes>> = mapOf(\n")
        for (b in builders) {
            val classes = classesOf(b)
            if (classes.isEmpty()) continue
            val name = b["name"] as String
            val entries = classes.keys.joinToString(", ") { "${literal(it)} to Lt.${identifier(name)}.${identifier(it)}" }
            out.append("        ${literal(name)} to mapOf($entries),\n")
        }
        out.append("    )\n\n")
        out.append("    fun call(name: String, o: Map<String, Any?>): Any = when (name) {\n")
        for (b in builders) {
            val name = b["name"] as String
            out.append("        ${literal(name)} -> Lt.${identifier(name)}(\n")
            for (opt in options(b)) {
                val key = literal(opt.name)
                val read = when (opt.kind) {
                    "values" -> "(o[$key] as String?)?.let { ${enumName(ValueSet(opt.name, values(opt)!!), name)}.of(it)!! }"
                    "flag" -> "o[$key] as Boolean?"
                    "text" -> "o[$key] as String?"
                    "number" -> "o[$key] as Number?"
                    "textList" -> "(o[$key] as List<*>?)?.map { it as String }"
                    else -> error("Unknown option type ${opt.kind}")
                }
                val value = if (opt.required) "($read)!!" else read
                out.append("            ${identifier(opt.name)} = $value,\n")
            }
            val result = if (returnType(b) == "Attributes") "" else ".toMap()"
            out.append("        )$result\n")
        }
        out.append("        else -> error(\"No builder function is named \$name.\")\n")
        out.append("    }\n}\n")
        return out.toString()
    }

    companion object {
        private val KEYWORDS = setOf("switch", "object", "in", "is", "as", "fun", "val", "var", "when", "class")

        fun pascal(s: String): String =
            s.split('-', '_').joinToString("") { part -> part.replaceFirstChar { it.uppercase() } }

        fun constant(v: String): String = v.uppercase().replace('-', '_')

        /** `switch` is an ordinary name in TypeScript and a keyword in neither language, but other names can be keywords. */
        fun identifier(s: String): String = if (s in KEYWORDS) "`$s`" else s

        fun literal(s: String): String =
            "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("$", "\\$") + "\""
    }
}
