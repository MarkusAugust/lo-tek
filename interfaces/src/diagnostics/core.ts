/**
 * The core: LO-TEK's check and theme generator, written in Rust and built to
 * a single WebAssembly module.
 *
 * The same module runs here, in VS Code, on the JVM (Chicory) and in
 * IntelliJ, and gives the same answer everywhere. The module has no imports,
 * so it needs no glue: the loader writes the text in as UTF-8 and reads the
 * answer out as JSON, as every host language does.
 *
 * The core carries no data. The vocabulary and the colour contract are given
 * to it with `loadManifest` and `loadContract`, from the files in the package.
 *
 * `diagnoseMarkup` and `diagnosePage` in `index.ts` load the module and the
 * files from the package themselves. `loadCore` is for anyone who has the
 * module some other way, such as an extension that bundles it, or a browser:
 *
 * ```ts
 * const core = loadCore(await WebAssembly.compileStreaming(fetch(url)))
 * core.loadManifest(await (await fetch(manifestUrl)).text())
 * core.diagnosePage(html)
 * ```
 *
 * Synchronous, because Node, Bun and VS Code allow it. In the browser the
 * module must be compiled with `WebAssembly.compile` first, and the compiled
 * module passed here.
 */

export type Severity = "error" | "warning"

/** One edit in a fix: replace the text from `start` to `end` with `text`. */
export type Edit = {
  start: number
  end: number
  text: string
}

/**
 * A fix the editor can offer: one or more edits that belong together, such
 * as `id` on the field and `for` on the label. They are in text order and do
 * not overlap; apply them from the end, so the positions hold. `preferred`
 * marks the safe one, such as `onlinetext` to `online-text`: the same
 * letters, only written differently. A suggestion at a distance is a
 * suggestion.
 */
export type Fix = {
  title: string
  edits: Edit[]
  preferred?: boolean
}

export type Finding = {
  /** Where the finding starts, as an index into the text (UTF-16, like a `string`). */
  start: number
  end: number
  /** The line the finding starts on, from 1. */
  line: number
  /** The column the finding starts at, from 1, in UTF-16 units. */
  column: number
  message: string
  severity: Severity
  /** The name of the rule, such as `unknown-class`. That is what `lotek-ignore-next` takes. */
  rule: string
  /** The component page, as a link in the message. */
  link: string
  fix?: Fix
}

export type CoreVersion = {
  /** The version of the core. */
  core: string
  /** The version of `@lo-tek/interfaces` the manifest was written from, or `null` without a manifest. */
  manifest: string | null
  /** The manifest format the core understands. */
  schemaVersion: number
}

/** A promise in the colour contract that does not hold. */
export type Violation = {
  family: string
  promise: string
  ratio: number
  required: number
}

/** The fill a brand colour got in one appearance. */
export type BrandFill = {
  /** The value of `--lt-color-<family>-fill`. */
  fill: string
  /**
   * The share of the brand colour's chroma the fill has. Below 1 when sRGB
   * cannot show that much chroma at the lightness of the role.
   */
  chromaKept: number
  /**
   * The promises about `fill` the given colour would break if it were the
   * fill itself. Empty when it could have been.
   */
  breaks: Violation[]
}

/**
 * What became of one brand colour. The lightness is the role's, so a light
 * brand colour comes out much darker as a fill.
 */
export type Brand = {
  family: string
  /** The colour the recipe gave, as `#rrggbb`. */
  given: string
  light: BrandFill
  dark: BrandFill
  /** What became of the colour, in one sentence: the first line `lotek theme` writes about it. */
  summary: string
  /**
   * Why, in the core's own sentences: where the colour could not be the fill
   * as it is, and where the fill has less chroma. Show them as they are.
   */
  reasons: string[]
}

/**
 * One thing that is wrong with a recipe.
 *
 * `kind` says what sort of problem it is, and is what code decides on:
 * `unknown` is a key the recipe does not have, `refused` a value the core
 * does not take, and `empty` and `notARecipe` are about the recipe as a
 * whole. `message` is the sentence for a person, and is not to be read by
 * code: its wording may change.
 */
export type RecipeProblem = {
  /**
   * The key it is about, as the segments of its path: `["shape",
   * "buttonRadius"]`. Empty for `empty` and `notARecipe`. A key may have a
   * dot in its name, which is why the path is not one text.
   */
  path: string[]
  kind: "unknown" | "refused" | "empty" | "notARecipe"
  message: string
}

/**
 * One value a recipe gives, as the core reads it: the key, as the segments
 * of its path, and the value as text. A number is its text.
 */
export type RecipeValue = {
  path: string[]
  text: string
}

/** The theme `buildTheme` returns: the tokens per appearance, the promises that break, what became of the brand colours, and the CSS. */
export type CoreTheme = {
  light: Record<string, string>
  dark: Record<string, string>
  /** Promises that do not hold. Empty when the theme is sound. */
  violations: Violation[]
  /** One row per family the recipe gave a colour for, in the order of the families. */
  brands: Brand[]
  css: string
}

/** What `inspectTheme` found in a theme the consumer has written by hand. */
export type CoreThemeReport = {
  problems: { selector: string; message: string }[]
  /** Blocks that were actually read. */
  blocks: number
  /** Values the consumer wrote, and that were understood. */
  declarations: number
  /** Promises that were actually checked. */
  promises: number
}

/** What `inspectStyles` found in a stylesheet. */
export type CoreStyles = {
  /** Every class that appears in a selector. */
  classes: string[]
  /** Every class with an attribute, and the value when the selector requires one. */
  attributes: { class: string; attribute: string; value?: string }[]
  /** The URLs in `@import`. */
  imports: string[]
}

export type Core = {
  /** Checks a template or a fragment. Throws without a manifest. */
  diagnoseMarkup(html: string): Finding[]
  /** Checks a whole page, including the wiring. Throws without a manifest. */
  diagnosePage(html: string): Finding[]
  /** Gives the core the vocabulary. Throws with the core's explanation if it cannot be read. */
  loadManifest(json: string): void
  /** Gives the core the colour contract. Throws with the core's explanation if it cannot be read. */
  loadContract(json: string): void
  version(): CoreVersion
  /** Builds a theme from the recipe. Throws without a colour contract, or when the recipe cannot be used. */
  buildTheme(recipe: unknown): CoreTheme
  /**
   * What is wrong with a recipe, all at once. Empty exactly when `buildTheme`
   * takes the recipe. Throws without a colour contract, and for a value that
   * cannot be written as JSON.
   */
  checkRecipe(recipe: unknown): RecipeProblem[]
  /**
   * What a recipe gives, as the core reads it: each key that has a value,
   * with the value as text. Throws as `checkRecipe` does.
   */
  recipeValues(recipe: unknown): RecipeValue[]
  /** Checks every promise in a theme written as CSS. Throws without a colour contract. */
  inspectTheme(css: string): CoreThemeReport
  /** The classes and attribute values a stylesheet styles, read with the core's CSS reader. */
  inspectStyles(css: string): CoreStyles
  /**
   * The check with the stylesheets as well: a class none of them styles, and
   * a value without a rule. `page` checks as `diagnosePage`, otherwise as
   * `diagnoseMarkup`. Throws without a manifest.
   */
  diagnoseStyled(html: string, css: string[], page: boolean): Finding[]
}

type Exports = {
  memory: WebAssembly.Memory
  alloc(length: number): number
  diagnose_markup_raw(pointer: number, length: number): number
  diagnose_page_raw(pointer: number, length: number): number
  load_manifest_raw(pointer: number, length: number): number
  load_contract_raw(pointer: number, length: number): number
  version_raw(): void
  build_theme_raw(pointer: number, length: number): number
  check_recipe_raw(pointer: number, length: number): number
  recipe_values_raw(pointer: number, length: number): number
  inspect_theme_raw(pointer: number, length: number): number
  inspect_styles_raw(pointer: number, length: number): void
  diagnose_styled_raw(pointer: number, length: number): number
  accessibility_tree_raw(pointer: number, length: number): number
  accessibility_facts_raw(): void
  accessibility_roles_raw(): void
  accessibility_states_raw(): void
  result_ptr(): number
  result_len(): number
}

/**
 * @internal Not part of the package's API.
 *
 * An instance of the core and the helpers every call goes through: the text
 * written into the module's memory, and the answer read back. Not part of
 * the package: `index.ts` exports `loadCore`. The tests reach the core's
 * other functions, such as the accessibility tree, through this.
 */
export function instantiate(source: BufferSource | WebAssembly.Module) {
  const module =
    source instanceof WebAssembly.Module
      ? source
      : new WebAssembly.Module(source)
  const e = new WebAssembly.Instance(module, {}).exports as unknown as Exports
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  /** Writes the text into the module's memory and returns the pointer and length. */
  const write = (text: string): [number, number] => {
    const bytes = encoder.encode(text)
    const pointer = e.alloc(bytes.length)
    // The memory can grow on every call, so the view is created after `alloc`.
    new Uint8Array(e.memory.buffer, pointer, bytes.length).set(bytes)
    return [pointer, bytes.length]
  }
  const read = <T>(): T =>
    JSON.parse(
      decoder.decode(
        new Uint8Array(e.memory.buffer, e.result_ptr(), e.result_len()),
      ),
    ) as T
  /** The answer from a call that can be rejected: the value, or the core's explanation as an error. */
  const answer = <T>(status: number): T => {
    if (status !== 0) throw new Error(read<{ error: string }>().error)
    return read<T>()
  }
  return { e, write, read, answer }
}

/** Loads the core from the module's bytes or an already compiled module. */
export function loadCore(source: BufferSource | WebAssembly.Module): Core {
  const { e, write, read, answer } = instantiate(source)

  return {
    diagnoseMarkup: (html) => answer(e.diagnose_markup_raw(...write(html))),
    diagnosePage: (html) => answer(e.diagnose_page_raw(...write(html))),
    loadManifest: (json) => {
      answer(e.load_manifest_raw(...write(json)))
    },
    loadContract: (json) => {
      answer(e.load_contract_raw(...write(json)))
    },
    version: () => {
      e.version_raw()
      return read()
    },
    buildTheme: (recipe) =>
      answer(e.build_theme_raw(...write(JSON.stringify(recipe)))),
    checkRecipe: (recipe) =>
      answer(e.check_recipe_raw(...write(JSON.stringify(recipe)))),
    recipeValues: (recipe) =>
      answer(e.recipe_values_raw(...write(JSON.stringify(recipe)))),
    inspectTheme: (css) => answer(e.inspect_theme_raw(...write(css))),
    inspectStyles: (css) => {
      e.inspect_styles_raw(...write(css))
      return read()
    },
    diagnoseStyled: (html, css, page) =>
      answer(
        e.diagnose_styled_raw(...write(JSON.stringify({ html, css, page }))),
      ),
  }
}
