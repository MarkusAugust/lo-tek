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
     * Says what is wrong with a recipe, all at once.
     *
     * [buildTheme] refuses with one sentence. This answers with every
     * problem: the path of its key as segments, the kind, and the message
     * for a person. The problems about the recipe as a whole come first, then
     * the keys the recipe does not have, then the values the core refuses, in
     * the order of the keys. The list is empty exactly when [buildTheme]
     * takes the recipe.
     *
     * [recipe] is the JSON text of a recipe, handed to the core as it is.
     * Text that is not JSON throws [IllegalArgumentException]. If the colour
     * contract is missing from the jar, it throws [IllegalStateException].
     */
    fun checkRecipe(recipe: String): List<RecipeProblem> {
        val answer = askTheme(CHECK_RECIPE, recipe)
        return (Json.parse(answer) as List<*>).map { p ->
            val m = p as Map<*, *>
            RecipeProblem(
                path = (m["path"] as List<*>).map { it as String },
                kind = m["kind"] as String,
                message = m["message"] as String,
            )
        }
    }

    /**
     * Says what a recipe gives, as the core reads it: each key that has a
     * value, in the order of the keys, with its path as segments and the
     * value as text. A key that is not given is not there, and neither is a
     * value that cannot be one, or a key the theme does not have. A text the
     * core then refuses is there, with a problem beside it in [checkRecipe].
     *
     * [recipe] is the JSON text of a recipe, handed to the core as it is.
     * Text that is not JSON throws [IllegalArgumentException]. If the colour
     * contract is missing from the jar, it throws [IllegalStateException].
     */
    fun recipeValues(recipe: String): List<RecipeValue> {
        val answer = askTheme(RECIPE_VALUES, recipe)
        return (Json.parse(answer) as List<*>).map { v ->
            val m = v as Map<*, *>
            RecipeValue(path = (m["path"] as List<*>).map { it as String }, text = m["text"] as String)
        }
    }

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
        val answer = askTheme(BUILD_THEME, recipe)
        val theme = Json.parse(answer) as Map<*, *>
        return Theme(
            light = theme["light"].texts(),
            dark = theme["dark"].texts(),
            violations = theme["violations"].violations(),
            brands = theme["brands"].brands(),
            css = theme["css"] as String,
        )
    }

    private fun Any?.violations(): List<ThemeViolation> =
        (this as List<*>).map { v ->
            val m = v as Map<*, *>
            ThemeViolation(
                family = m["family"] as String,
                promise = m["promise"] as String,
                ratio = m["ratio"] as Double,
                required = m["required"] as Double,
            )
        }

    /**
     * Says what became of each colour the core takes in a recipe, whatever
     * else in it is wrong: the rows [buildTheme] gives as [Theme.brands], for
     * every family whose own value is a colour, as they would be without the
     * values the core refuses. For a recipe [buildTheme] takes, it is its
     * [Theme.brands].
     *
     * [recipe] is the JSON text of a recipe, handed to the core as it is.
     * Text that is not JSON throws [IllegalArgumentException]. If the colour
     * contract is missing from the jar, it throws [IllegalStateException].
     */
    fun recipeBrands(recipe: String): List<ThemeBrand> {
        val answer = askTheme(RECIPE_BRANDS, recipe)
        return Json.parse(answer).brands()
    }

    /**
     * One call to an operation of the theme: the core is given the colour
     * contract first, and what it refuses is thrown as
     * [IllegalArgumentException] with the core's own explanation.
     */
    private fun askTheme(operation: String, text: String): String {
        val (status, answer) = withCore { it.useContract(); it.callWithStatus(operation, text) }
        if (status != 0L) throw IllegalArgumentException((Json.parse(answer) as Map<*, *>)["error"] as String)
        return answer
    }

    private fun Any?.brands(): List<ThemeBrand> =
        (this as List<*>).map { b ->
            val m = b as Map<*, *>
            ThemeBrand(
                family = m["family"] as String,
                given = m["given"] as String,
                light = m["light"].brandFill(),
                dark = m["dark"].brandFill(),
                summary = m["summary"] as String,
                reasons = (m["reasons"] as List<*>).map { it as String },
            )
        }

    private fun Any?.brandFill(): ThemeBrandFill {
        val m = this as Map<*, *>
        return ThemeBrandFill(
            fill = m["fill"] as String,
            chromaKept = m["chromaKept"] as Double,
            breaks = m["breaks"].violations(),
        )
    }

    /**
     * Checks every promise in a theme written as CSS, as `lotek check-theme`
     * does. [ThemeReport.problems] is empty when the theme holds; the counts
     * say how much was actually read, so an empty result cannot be mistaken
     * for a theme without tokens.
     */
    fun inspectTheme(css: String): ThemeReport {
        val answer = askTheme(INSPECT_THEME, css)
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
            others = (report["others"] as Double).toInt(),
            verdict =
                (report["verdict"] as Map<*, *>).let {
                    ThemeVerdict(kind = it["kind"] as String, message = it["message"] as String)
                },
        )
    }

    /**
     * What there is to write at [offset] in a template: the classes inside a
     * class attribute, the values of an attribute, and the `<lt-…>` elements
     * and their attributes. [offset] counts as a Kotlin string does, in
     * UTF-16 units, and so do [Suggestion.start] and [Suggestion.end].
     *
     * [html] says the editor has a service of its own for the elements and
     * their attributes, and leaves them out. [manifest] is the JSON text of
     * the project's own manifest; without it, the manifest in the package
     * applies. A manifest the core cannot read throws
     * [IllegalArgumentException].
     */
    fun complete(text: String, offset: Int, html: Boolean = false, manifest: String? = null): List<Suggestion> {
        val input = "{\"text\":${Json.string(text)},\"offset\":$offset,\"html\":$html}"
        return (Json.parse(edit(COMPLETE, input, manifest)) as List<*>).map { s ->
            val m = s as Map<*, *>
            Suggestion(
                label = m["label"] as String,
                kind = SuggestionKind.valueOf((m["kind"] as String).uppercase()),
                detail = m["detail"] as String?,
                documentation = m["documentation"] as String?,
                start = (m["start"] as Double).toInt(),
                end = (m["end"] as Double).toInt(),
            )
        }
    }

    /**
     * What there is to say about the word at [offset]: an `lt-` class in a
     * class attribute, or `null`. [offset] and [manifest] are as in
     * [complete].
     */
    fun hover(text: String, offset: Int, manifest: String? = null): Hover? {
        val input = "{\"text\":${Json.string(text)},\"offset\":$offset}"
        val m = Json.parse(edit(HOVER, input, manifest)) as Map<*, *>? ?: return null
        return Hover(text = m["text"] as String, start = (m["start"] as Double).toInt(), end = (m["end"] as Double).toInt())
    }

    private fun edit(entry: String, input: String, manifest: String?): String {
        val (status, answer) =
            withCore {
                it.use(manifest)
                it.callWithStatus(entry, input)
            }
        if (status != 0L) throw IllegalArgumentException((Json.parse(answer) as Map<*, *>)["error"] as String)
        return answer
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
    private const val CHECK_RECIPE = "check_recipe_raw"
    private const val RECIPE_VALUES = "recipe_values_raw"
    private const val RECIPE_BRANDS = "recipe_brands_raw"
    private const val INSPECT_THEME = "inspect_theme_raw"
    private const val COMPLETE = "complete_raw"
    private const val HOVER = "hover_raw"

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

/** What a suggestion is, so an editor can show the kind. The names are the ones TypeScript has, in capitals. */
enum class SuggestionKind { CLASS, VALUE, ELEMENT, ATTRIBUTE }

/**
 * Something to write where the cursor is, with the same fields as
 * `Suggestion` in TypeScript. [start] and [end] are the word it replaces, in
 * UTF-16 units, and the same when there is no word.
 */
data class Suggestion(
    val label: String,
    val kind: SuggestionKind,
    /** A few words beside the label. */
    val detail: String?,
    /** More, as Markdown. */
    val documentation: String?,
    val start: Int,
    val end: Int,
)

/** What an editor shows about the word under the pointer, as Markdown, and the word it is about. */
data class Hover(
    val text: String,
    val start: Int,
    val end: Int,
)

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
 * that break, what became of the brand colours, and the CSS, the same fields
 * as `CoreTheme` in TypeScript.
 */
data class Theme(
    /** Every `--lt-color-*` token with its value in the light scheme. */
    val light: Map<String, String>,
    val dark: Map<String, String>,
    /** Promises that do not hold. Empty when the theme is in order. */
    val violations: List<ThemeViolation>,
    /** What became of each brand colour the recipe gave, in the order of the families. */
    val brands: List<ThemeBrand>,
    /** The theme as CSS, ready to be linked after `tokens.css`. */
    val css: String,
)

/**
 * One thing that is wrong with a recipe, the same fields as `RecipeProblem`
 * in TypeScript. [kind] is what code decides on: `unknown` is a key the
 * recipe does not have, `refused` a value the core does not take, and `empty`
 * and `notARecipe` are about the recipe as a whole, with an empty [path].
 * [message] is the sentence for a person, and its wording may change.
 */
data class RecipeProblem(
    /** The key it is about, as the segments of its path. A key may have a dot in its name. */
    val path: List<String>,
    val kind: String,
    val message: String,
)

/** One value a recipe gives, as the core reads it: the key, as the segments of its path, and the value as text. */
data class RecipeValue(
    val path: List<String>,
    val text: String,
)

/**
 * What became of one brand colour: the colour the recipe [given], as
 * `#rrggbb`, the fill it got in each scheme, and what the core says about
 * it, as a [summary] and the [reasons]. The lightness is the role's,
 * so a light brand colour comes out much darker as a fill.
 */
data class ThemeBrand(
    val family: String,
    val given: String,
    val light: ThemeBrandFill,
    val dark: ThemeBrandFill,
    /** What became of the colour, in one sentence: the first line `lotek theme` writes about it. */
    val summary: String,
    /** Why, in the core's own sentences. Show them as they are. */
    val reasons: List<String>,
)

/** The fill a brand colour got in one scheme, the same fields as `BrandFill` in TypeScript. */
data class ThemeBrandFill(
    /** The value of `--lt-color-<family>-fill`. */
    val fill: String,
    /** The share of the brand colour's chroma the fill has. Below 1 when sRGB cannot show that much at the lightness of the role. */
    val chromaKept: Double,
    /** The promises about `fill` the given colour would break if it were the fill itself. Empty when it could have been. */
    val breaks: List<ThemeViolation>,
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
    /** Other `--lt-*` tokens the file sets, without a contrast promise: the font, the shape and the system colours. */
    val others: Int,
    /** What the check came to, as `lotek check-theme` says it. */
    val verdict: ThemeVerdict,
)

/**
 * What a check of a theme came to. [kind] is what code decides on: `kept`
 * when every promise holds, `broken` with a problem, and `withoutColours`
 * for a theme of only font and shape. A file with no value in it is `broken`:
 * that nothing was found is one of the problems. [message] is the sentence
 * `lotek check-theme` writes for one file, and ends "… in 1 file."
 */
data class ThemeVerdict(
    val kind: String,
    val message: String,
)

/** A promise that does not hold in a handwritten theme, with the selector it is in. */
data class ThemeProblem(
    val selector: String,
    val message: String,
)

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
