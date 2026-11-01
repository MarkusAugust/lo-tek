package no.lotek

import com.dylibso.chicory.runtime.ExportFunction
import com.dylibso.chicory.runtime.Instance

/**
 * LO-TEK's diagnostics on the JVM, without Node and without JavaScript.
 *
 * The diagnostics are written in Rust (`core/`) and compiled to one
 * WebAssembly module. Node and the browser run the same module. Here it is
 * run by Chicory, a WebAssembly runtime written in pure Java: an ordinary
 * Maven dependency, with no JNI and nothing to install.
 *
 * ```kotlin
 * val html = client.get("/jobs/222-0481").bodyAsText()
 * assertEquals(emptyList(), Lotek.diagnosePage(html))
 * ```
 *
 * Positions are UTF-16 character indices, the same indices a Kotlin `String`
 * uses. `html.substring(finding.start, finding.end)` therefore gives exactly
 * the text the finding is about.
 */
object Lotek {
    /**
     * What `diagnoseMarkup` finds: the vocabulary, for a template or a fragment.
     *
     * With [css], the text of the stylesheets the page loads, it also reports
     * a class none of them styles, and a value without a rule. An empty list
     * is a page without stylesheets, where nothing is styled, as in
     * TypeScript: a glob that matched nothing should fail the test, not turn
     * the check off.
     *
     * With [manifest], the text of a `manifest.json`, the markup is checked
     * against it instead of the manifest in the package. That is the manifest
     * `lotek manifest` and the Gradle task `lotekManifest` write, with the
     * components the project has taken over. A manifest the core cannot read
     * throws [IllegalArgumentException] with the reason.
     */
    fun diagnoseMarkup(html: String, css: List<String>? = null, manifest: String? = null): List<Finding> =
        if (css == null) diagnose(MARKUP, html, manifest) else diagnoseStyled(html, css, page = false, manifest)

    /**
     * What `diagnosePage` finds: the vocabulary, and in addition that every
     * id something points to exists, that no id appears twice, and that every
     * field is wired. Use it on the HTML the server sends, not on a template.
     * [css] and [manifest] as for [diagnoseMarkup].
     */
    fun diagnosePage(html: String, css: List<String>? = null, manifest: String? = null): List<Finding> =
        if (css == null) diagnose(PAGE, html, manifest) else diagnoseStyled(html, css, page = true, manifest)

    /**
     * The script that reads the rendered page in the browser: the DOM as it
     * stands now, and the text of every stylesheet. Pass it to
     * `page.evaluate` in Playwright, or use [assertLotekRendered].
     *
     * The result is an object with `html` and `css`. The same script is in
     * `@lo-tek/interfaces/diagnostics`. The text is only the function, with
     * no comments around it: Playwright wraps it in parentheses and calls it.
     */
    const val READ_RENDERED_PAGE: String = """async () => {
  const sheets = [...document.styleSheets, ...document.adoptedStyleSheets]
  const css = []
  const read = async (sheet) => {
    let rules
    try {
      rules = sheet.cssRules
    } catch {
      if (!sheet.href) return
      const answer = await fetch(sheet.href)
      if (!answer.ok)
        throw new Error(
          `The stylesheet ${'$'}{sheet.href} could not be read, and answered ${'$'}{answer.status} when it was fetched again.`,
        )
      css.push(await answer.text())
      return
    }
    for (const rule of rules)
      if (rule instanceof CSSImportRule && rule.styleSheet) await read(rule.styleSheet)
    css.push([...rules].map((rule) => rule.cssText).join("\n"))
  }
  for (const sheet of sheets) await read(sheet)
  const doctype = document.doctype ? `<!DOCTYPE ${'$'}{document.doctype.name}>` : ""
  return { html: doctype + document.documentElement.outerHTML, css }
}"""

    /**
     * Checks the result of [READ_RENDERED_PAGE]: the page as the browser
     * rendered it, with the stylesheets it loaded.
     */
    fun diagnoseRendered(rendered: Map<*, *>): List<Finding> =
        diagnoseStyled(
            rendered["html"] as String,
            (rendered["css"] as List<*>).map { it as String },
            page = true,
        )

    /**
     * Builds a colour theme from the recipe, as `lotek theme` does.
     *
     * [recipe] is the JSON text of a recipe file: the nine colours
     * (`accent`, `danger` and so on), `typography` and `shape`.
     * An unknown key, and a recipe the core rejects, throw
     * [IllegalArgumentException] with the explanation. The promises hold by
     * construction, so [Theme.violations] is empty for a recipe with valid
     * colours. Check it anyway before you write [Theme.css] to a file:
     * `lotek theme` refuses to write when it is not empty, while this returns
     * the theme with the list, like `buildTheme` in TypeScript.
     * If the colour contract is missing from the jar, it throws
     * [IllegalStateException].
     */
    fun buildTheme(recipe: String): Theme {
        val input = Json.write(ThemeRecipe.toCore(recipe))
        val (status, answer) = withCore { it.useContract(); it.callWithStatus(BUILD_THEME, input) }
        if (status != 0L) throw IllegalArgumentException((Json.parse(answer) as Map<*, *>)["error"] as String)
        val theme = Json.parse(answer) as Map<*, *>
        return Theme(
            light = theme["light"].texts(),
            dark = theme["dark"].texts(),
            violations =
                (theme["violations"] as List<*>).map { v ->
                    val m = v as Map<*, *>
                    ThemeViolation(
                        family = m["family"] as String,
                        promise = m["promise"] as String,
                        ratio = m["ratio"] as Double,
                        required = m["required"] as Double,
                    )
                },
            css = theme["css"] as String,
        )
    }

    /**
     * Checks every promise in a theme written as CSS, as `lotek check-theme`
     * does. [ThemeReport.problems] is empty when the theme holds; the counts
     * say how much was actually read, so an empty result cannot be mistaken
     * for a theme without tokens.
     */
    fun inspectTheme(css: String): ThemeReport {
        val (status, answer) = withCore { it.useContract(); it.callWithStatus(INSPECT_THEME, css) }
        if (status != 0L) throw IllegalArgumentException((Json.parse(answer) as Map<*, *>)["error"] as String)
        val report = Json.parse(answer) as Map<*, *>
        return ThemeReport(
            problems =
                (report["problems"] as List<*>).map { p ->
                    val m = p as Map<*, *>
                    ThemeProblem(selector = m["selector"] as String, message = m["message"] as String)
                },
            blocks = (report["blocks"] as Double).toInt(),
            declarations = (report["declarations"] as Double).toInt(),
            promises = (report["promises"] as Double).toInt(),
        )
    }

    private fun Any?.texts(): Map<String, String> = (this as Map<*, *>).entries.associate { (k, v) -> k as String to v as String }

    private fun diagnoseStyled(html: String, css: List<String>, page: Boolean, manifest: String? = null): List<Finding> {
        val input = "{\"html\":${Json.string(html)},\"css\":[${css.joinToString(",") { Json.string(it) }}],\"page\":$page}"
        return diagnose(STYLED, input, manifest)
    }

    /*
     * An instance has its own memory, and the result of a call stays there
     * until the next call. Two threads therefore cannot use the same one at
     * once. Each call borrows an instance and hands it back, so calls do not
     * wait for each other.
     *
     * With one instance per thread, every thread in a large pool, like the
     * ones IntelliJ runs the check on, got its own, and none was released.
     * Here no more idle instances are kept than the machine has cores, and a
     * new one costs almost nothing, since the module is compiled to bytecode.
     */
    private val idle = java.util.concurrent.ConcurrentLinkedQueue<Core>()
    private val idleCount = java.util.concurrent.atomic.AtomicInteger()
    private val maxIdle = Runtime.getRuntime().availableProcessors()

    internal fun <T> withCore(block: (Core) -> T): T {
        val core = idle.poll()?.also { idleCount.decrementAndGet() } ?: Core()
        try {
            return block(core)
        } finally {
            if (idleCount.incrementAndGet() <= maxIdle) idle.offer(core) else idleCount.decrementAndGet()
        }
    }

    /** How many idle instances are kept. For the tests. */
    internal fun idleCores(): Int = idleCount.get()

    private fun diagnose(entry: String, html: String, manifest: String?): List<Finding> {
        val (status, answer) =
            withCore {
                it.use(manifest)
                it.callWithStatus(entry, html)
            }
        // An empty result must mean no findings, not that nothing was checked.
        if (status != 0L) throw IllegalArgumentException((Json.parse(answer) as Map<*, *>)["error"] as String)
        return (Json.parse(answer) as List<*>).map { finding(it as Map<*, *>) }
    }

    /**
     * The manifest in the package, which is in the jar. The core carries no
     * data, so this is what the check runs against when `manifest` is not
     * given.
     */
    internal val PACKAGE_MANIFEST: String by lazy {
        Lotek::class.java.getResourceAsStream("/no/lotek/manifest.json")?.use {
            it.readBytes().toString(Charsets.UTF_8)
        } ?: error("manifest.json is missing from the jar")
    }

    /** The colour contract in the package, which is in the jar. The theme is computed from it. */
    internal val PACKAGE_CONTRACT: String by lazy {
        Lotek::class.java.getResourceAsStream("/no/lotek/color-contract.json")?.use {
            it.readBytes().toString(Charsets.UTF_8)
        } ?: error("color-contract.json is missing from the jar")
    }

    /**
     * The manifest in the package, the same one the check runs against: the
     * elements with attributes, parts and events, the classes with their
     * attributes, the allowed values, the content and parts, the tokens, and
     * the builder functions with their options and the shape of the result.
     * A project's own manifest is read with [Manifest.parse].
     */
    val manifest: Manifest by lazy { Manifest.parse(PACKAGE_MANIFEST) }

    private const val MARKUP = "diagnose_markup_raw"
    private const val PAGE = "diagnose_page_raw"
    private const val STYLED = "diagnose_styled_raw"
    private const val BUILD_THEME = "build_theme_raw"
    private const val INSPECT_THEME = "inspect_theme_raw"

    private fun finding(f: Map<*, *>): Finding =
        Finding(
            start = (f["start"] as Double).toInt(),
            end = (f["end"] as Double).toInt(),
            line = (f["line"] as Double).toInt(),
            column = (f["column"] as Double).toInt(),
            message = f["message"] as String,
            severity = f["severity"] as String,
            rule = f["rule"] as String,
            link = f["link"] as String,
            fix = (f["fix"] as Map<*, *>?)?.let { fix ->
                Fix(
                    title = fix["title"] as String,
                    edits = (fix["edits"] as List<*>).map { e ->
                        e as Map<*, *>
                        Edit(
                            start = (e["start"] as Double).toInt(),
                            end = (e["end"] as Double).toInt(),
                            text = e["text"] as String,
                        )
                    },
                    preferred = fix["preferred"] as Boolean?,
                )
            },
        )
}

/** One instance of the module, with the functions it exports. */
internal class Core {
    /*
     * `LotekCore` is the module compiled to JVM bytecode when the package was
     * built (see `buildSrc/`). It runs on the JIT, not in Chicory's
     * interpreter, which took seconds on a page this takes milliseconds on,
     * and a new instance costs almost nothing.
     */
    private val instance: Instance =
        Instance.builder(LotekCore.load()).withMachineFactory(LotekCore::create).build()
    private val alloc: ExportFunction = instance.export("alloc")
    private val resultPtr: ExportFunction = instance.export("result_ptr")
    private val resultLen: ExportFunction = instance.export("result_len")

    /*
     * The manifest the instance checks against now, `null` before the first
     * is given. An instance is lent out again after the call, so it remembers
     * what is loaded, and the same manifest is read only once per instance.
     */
    private var manifest: String? = null

    /** Gives the instance [manifest], or the manifest in the package with `null`. */
    fun use(manifest: String?) {
        val wanted = manifest ?: Lotek.PACKAGE_MANIFEST
        if (wanted === this.manifest || wanted == this.manifest) return
        val (status, answer) = callWithStatus("load_manifest_raw", wanted)
        if (status != 0L) {
            // The core keeps the previous one on an error. The next call gives
            // the wanted one again, rather than trusting what is there.
            this.manifest = null
            throw IllegalArgumentException((Json.parse(answer) as Map<*, *>)["error"] as String)
        }
        this.manifest = wanted
    }

    /** Whether the colour contract is given. It is always the package's, so once per instance is enough. */
    private var contractLoaded = false

    /** Gives the instance the colour contract in the package, the first time it is needed. */
    fun useContract() {
        if (contractLoaded) return
        val (status, answer) = callWithStatus("load_contract_raw", Lotek.PACKAGE_CONTRACT)
        if (status != 0L) throw IllegalStateException((Json.parse(answer) as Map<*, *>)["error"] as String)
        contractLoaded = true
    }

    /** Calls one of the functions that take a text, and returns the number it returns, where 0 is success, and the result. */
    fun callWithStatus(entry: String, text: String): Pair<Long, String> {
        val bytes = text.toByteArray(Charsets.UTF_8)
        val pointer = alloc.apply(bytes.size.toLong())[0]
        instance.memory().write(pointer.toInt(), bytes)
        val status = instance.export(entry).apply(pointer, bytes.size.toLong())?.firstOrNull() ?: 0L
        return status to instance.memory().readString(resultPtr.apply()[0].toInt(), resultLen.apply()[0].toInt())
    }
}

/** One finding, with the same fields as `Finding` in TypeScript, plus rule, line and column. */
data class Finding(
    val start: Int,
    val end: Int,
    val line: Int,
    val column: Int,
    val message: String,
    val severity: String,
    val rule: String,
    val link: String,
    val fix: Fix? = null,
)

/**
 * A theme built by [Lotek.buildTheme]: the tokens per scheme, the promises
 * that break, and the CSS, the same fields as `CoreTheme` in TypeScript.
 */
data class Theme(
    /** Every `--lt-color-*` token with its value in the light scheme. */
    val light: Map<String, String>,
    val dark: Map<String, String>,
    /** Promises that do not hold. Empty when the theme is in order. */
    val violations: List<ThemeViolation>,
    /** The theme as CSS, ready to be linked after `tokens.css`. */
    val css: String,
)

/** A promise that breaks: the contrast [ratio] against the requirement [required], for [promise] in [family]. */
data class ThemeViolation(
    val family: String,
    val promise: String,
    val ratio: Double,
    val required: Double,
)

/** What [Lotek.inspectTheme] found, the same fields as `CoreThemeReport` in TypeScript. */
data class ThemeReport(
    val problems: List<ThemeProblem>,
    /** Blocks that were actually read. */
    val blocks: Int,
    /** Values the consumer wrote, and that were understood. */
    val declarations: Int,
    /** Promises that were actually checked. */
    val promises: Int,
)

/** A promise that does not hold in a handwritten theme, with the selector it is in. */
data class ThemeProblem(
    val selector: String,
    val message: String,
)

/**
 * The recipe as `lotek theme` reads it, translated to what the core takes.
 *
 * The keys are the same as in `cli/src/theme.rs`, and a key that is not
 * there throws, since a typo would otherwise look like a recipe that worked.
 */
internal object ThemeRecipe {
    private val COLORS =
        listOf("accent", "danger", "success", "warning", "neutral", "visited", "brand1", "brand2", "brand3")
    private val TYPOGRAPHY_KEYS = listOf("fontFamily", "weights", "lineHeights")
    private val WEIGHT_KEYS = listOf("regular", "medium", "semibold", "bold")
    private val LINE_KEYS = listOf("default", "heading", "article", "compact")
    private val SHAPE_KEYS = listOf("buttonRadius", "fieldRadius", "surfaceRadius", "buttonBorderWidth", "buttonFontWeight")

    fun toCore(recipe: String): Map<String, Any?> {
        val parsed = Json.parse(recipe)
        val file =
            parsed as? Map<*, *>
                ?: throw IllegalArgumentException("The recipe is valid JSON, but not an object with the colours in it.")
        val topLevel = COLORS + listOf("typography", "shape", "\$schema")
        val unknown = file.keys.map { it.toString() }.filter { it !in topLevel }.toMutableList()
        val typography = spread(file["typography"])
        val shape = spread(file["shape"])
        unknown += unknownKeys(typography, TYPOGRAPHY_KEYS, "typography")
        unknown += unknownKeys(spread(typography["weights"]), WEIGHT_KEYS, "typography.weights")
        unknown += unknownKeys(spread(typography["lineHeights"]), LINE_KEYS, "typography.lineHeights")
        unknown += unknownKeys(shape, SHAPE_KEYS, "shape")
        if (unknown.isNotEmpty()) throw IllegalArgumentException("Unknown key in the recipe: ${unknown.joinToString(", ")}")

        val input = linkedMapOf<String, Any?>()
        for (color in COLORS) {
            val value = file[color]
            if (value is String && value.isNotEmpty()) input[color] = value
        }
        if (typography.isNotEmpty()) input["typography"] = typography
        if (shape.isNotEmpty()) input["shape"] = shape
        return input
    }

    /**
     * `{ ...value }` as JavaScript spreads it, like `spread` in `theme.rs`: a
     * list gets its indices as keys and a string one character per key, so
     * `"typography": "Inter"` is reported as unknown keys rather than vanishing.
     */
    private fun spread(value: Any?): Map<String, Any?> =
        when (value) {
            is Map<*, *> -> value.entries.associate { (k, v) -> k.toString() to v }
            is List<*> -> value.withIndex().associate { (i, v) -> i.toString() to v }
            is String -> value.withIndex().associate { (i, c) -> i.toString() to c.toString() }
            else -> emptyMap()
        }

    private fun unknownKeys(value: Map<String, Any?>, allowed: List<String>, path: String): List<String> =
        value.keys.filter { it !in allowed }.map { "$path.$it" }
}

/** One edit in a fix: replace the text from `start` to `end` with `text`. */
data class Edit(
    val start: Int,
    val end: Int,
    val text: String,
)

/**
 * A fix: one or more edits that belong together, in text order and without
 * overlap. Apply them from the end, so the positions hold.
 */
data class Fix(
    val title: String,
    val edits: List<Edit>,
    val preferred: Boolean? = null,
)
