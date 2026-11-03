/**
 * The parts of the rulebooks that are read from the code, not written by hand.
 *
 * The component list, the attribute values, the token names and the builder
 * functions are data. Copied by hand they would drift from the code in
 * silence, and an agent instruction that mentions a variant that does not
 * exist is worse than no instruction: it looks authoritative, and the agent
 * writes it into the consumer's app.
 *
 * The sources are the same ones the editor files use: `classes.ts` and
 * `elements.ts` are generated from the components, and `lt` is read by calling
 * the builder functions, not by reading the source code. The token names are
 * read out of `tokens.css`, which is itself generated from `tokens.ts`.
 */

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { lt } from "../src/index.js"
import { classes } from "../src/vocabulary/classes.js"
import { elements } from "../src/vocabulary/elements.js"
import { FAMILIES, ROLES, roleToCss } from "./color-contract.js"
import { buildBundledCss, bundledSize } from "./css-bundle.js"

export const PACKAGE = fileURLToPath(new URL("../", import.meta.url))

/** The role names as they appear in CSS, in the order the contract gives them. */
const ROLE_NAMES = Object.keys(ROLES).map((role) => roleToCss(role))

type PackageJson = {
  version: string
  exports: Record<string, string | { import?: string }>
}

export const packageJson = JSON.parse(
  readFileSync(join(PACKAGE, "package.json"), "utf8"),
) as PackageJson

export const VERSION = packageJson.version
export const CDN = `https://cdn.jsdelivr.net/npm/@lo-tek/interfaces@${VERSION}`

/**
 * The size of `lotek.css`, as the rulebooks state it.
 *
 * The number was hard-coded as "about 75 kB, under 10 kB compressed" on three
 * lines in `generate-agent.ts` while the file was 90 kB and 11 kB compressed.
 * The file is therefore built in memory here, by `css-bundle.ts`, which reads
 * the same `exports` entries the CSS build writes it from. It cannot be read
 * from `dist/lotek.css`, since `generate` runs before the CSS build in the
 * package build.
 */
const BUNDLED = bundledSize(buildBundledCss().css)

/** "N kB, M kB compressed", as html, templates and datastar state it, worked out when they are written. */
export const BUNDLED_SIZE = `${BUNDLED.kb} kB, ${BUNDLED.gzipKb} kB compressed`

/** The folder each component is in, which decides who creates the markup. */
function categories(): Map<string, string> {
  const map = new Map<string, string>()

  for (const category of ["css", "frame", "standalone"]) {
    const folder = join(PACKAGE, "src/components", category)
    for (const name of readdirSync(folder)) {
      if (statSync(join(folder, name)).isDirectory()) map.set(name, category)
    }
  }

  return map
}

export const CATEGORY = categories()

/** The stylesheet a component has in `exports`, or null when it has none. */
export function stylesheet(component: string): string | null {
  return `./${component}.css` in packageJson.exports ? `${component}.css` : null
}

/** The module `defineLt*` is in, as `exports` points to it. */
export function moduleOf(component: string): string {
  const entry = packageJson.exports[`./${component}`]
  if (!entry || typeof entry === "string") {
    throw new Error(`${component} has no JS entry in exports`)
  }
  const path = entry.import
  if (!path) throw new Error(`${component} is missing "import" in exports`)
  return path.replace(/^\.\//, "")
}

/**
 * The full CDN URL of something `exports` points to.
 *
 * The examples wrote the path by hand. When `lt-field.ts` moves, the table
 * updates itself while the copyable examples are left pointing at a 404, and
 * that is exactly the part the consumer pastes in.
 */
export function cdnUrl(entryName: string): string {
  const entry = packageJson.exports[`./${entryName}`]
  const path = typeof entry === "string" ? entry : (entry?.import ?? "")

  if (!path) throw new Error(`${entryName} does not exist in exports`)

  return `${CDN}/${path.replace(/^\.\//, "")}`
}

const capitalise = (part: string) => part[0].toUpperCase() + part.slice(1)

/** `defineLtSessionTimeout` from `session-timeout`, as the naming convention says. */
export function registration(component: string): string {
  return `defineLt${component.split("-").map(capitalise).join("")}`
}

type ClassRow = {
  classNames: string[]
  attributes: string[]
}

/** The components that are only CSS, with their classes and attributes. */
function cssComponents(): Map<string, ClassRow> {
  const map = new Map<string, ClassRow>()

  for (const [className, info] of Object.entries(classes)) {
    if (CATEGORY.get(info.component) !== "css") continue

    const row = map.get(info.component) ?? { classNames: [], attributes: [] }
    row.classNames.push(className)

    for (const [name, a] of Object.entries(info.attributes ?? {})) {
      row.attributes.push(attributeLabel(name, a))
    }

    map.set(info.component, row)
  }

  return map
}

/**
 * The table of CSS components, sorted by component name.
 *
 * `stylesheet` is the address the reader should write, and it is not the same
 * everywhere: without a build step it is a full URL, with one it is the
 * package name. For a long time the column held only the file name, and the
 * reader had to guess the path. An agent that generalised from the button
 * example wrote `src/components/css/field/field.css` for `<lt-field>`, which
 * is under `frame/`, and got a 404.
 */
export function cssTable(stylesheet: (component: string) => string): string {
  const rows = [...cssComponents()].sort(([a], [b]) => a.localeCompare(b))

  return [
    "| Class | Stylesheet | Attributes |",
    "| --- | --- | --- |",
    ...rows.map(([name, row]) => {
      const classNames = row.classNames
        .map((className) => `\`${className}\``)
        .join("<br>")
      const attributes = row.attributes.join("<br>") || "none"
      return `| ${classNames} | \`${stylesheet(name)}\` | ${attributes} |`
    }),
  ].join("\n")
}

/**
 * A class attribute as the tables write it: the values, or `(flag)` for an
 * attribute that works by being present, as the element table writes it.
 */
function attributeLabel(
  name: string,
  a: { values?: readonly string[]; flag?: true },
): string {
  const values = a.values ?? []
  if (a.flag) return `\`${name}\` (flag)`
  return values.length > 0 ? `\`${name}\`: ${values.join(", ")}` : `\`${name}\``
}

/**
 * The classes that belong to an element, such as `lt-tabs__list` under
 * `<lt-tabs>`, with their attributes. `data-color` on `.lt-dialog` used to be
 * nowhere in the rulebooks, since the dialog is not a CSS component.
 */
function classesUnder(component: string): string {
  const found = Object.entries(classes)
    .filter(([, info]) => info.component === component)
    .map(([className, info]) => {
      const attributes = Object.entries(info.attributes ?? {}).map(
        ([name, a]) => attributeLabel(name, a),
      )
      return attributes.length > 0
        ? `\`${className}\` (${attributes.join("; ")})`
        : `\`${className}\``
    })

  return found.join("<br>") || "none"
}

/**
 * The table of web components.
 *
 * `address` is the path the consumer writes in the import, and it is not the
 * same everywhere: a browser without a bundler does not resolve the package
 * name, so there it has to be a URL. That is why each framework decides its own.
 */
export function webTable(
  address: (component: string, modulePath: string) => string,
  stylesheet: (component: string) => string,
): string {
  const rows = Object.keys(elements).map((tag) => {
    const component = tag.replace(/^lt-/, "")

    const attributes =
      Object.entries(elements[tag].attributes ?? {})
        .map(([name, attribute]) =>
          attribute.type === "values"
            ? `\`${name}\`: ${attribute.values.join(", ")}`
            : `\`${name}\` (${attribute.type})`,
        )
        .join("<br>") || "none"

    const call = `\`${registration(component)}()\``
    const from = `\`${address(component, moduleOf(component))}\``

    // The events, with the fields in `detail`. An agent that needed to listen
    // to the dialog used to have to read the component code to find the name.
    const events =
      Object.entries(elements[tag].events ?? {})
        .map(([name, event]) =>
          event.detail
            ? `\`${name}\` (${Object.keys(event.detail).join(", ")})`
            : `\`${name}\``,
        )
        .join("<br>") || "none"

    return `| \`<${tag}>\` | ${CATEGORY.get(component)} | \`${stylesheet(component)}\` | ${call} from ${from} | ${attributes} | ${events} | ${classesUnder(component)} |`
  })

  return [
    "| Element | Category | Stylesheet | Registration | Attributes | Events | Classes inside |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n")
}

/** The token names, read out of the generated stylesheet. */
function tokenNames(pattern: RegExp): string[] {
  const css = readFileSync(join(PACKAGE, "src/tokens/tokens.css"), "utf8")
  return [...new Set(css.match(pattern) ?? [])].sort()
}

/**
 * The colour matrix, as two axes rather than 93 names.
 *
 * The axes are written out in full, and the name is
 * `--lt-color-<family>-<role>`, so every cell can be derived without guessing.
 * A list that ends with "and so on" is an invitation to invent the rest, and
 * invented names are exactly what this rulebook exists to prevent. Two axes
 * are not such a list: they are complete, and the cells follow from them.
 *
 * The axes are read from `FAMILIES` and `ROLES`, not out of the names in
 * `tokens.css`. Deriving them from the names went wrong:
 * `--lt-color-disabled-text` gave `disabled` as a tenth family, and it has
 * only two of the nine roles. Everything in the generated stylesheet that is
 * not a cell is listed separately.
 */
export function tokenList(): string {
  const cells = new Set(
    FAMILIES.flatMap((family) =>
      ROLE_NAMES.map((role) => `--lt-color-${family}-${role}`),
    ),
  )

  const outside = tokenNames(/--lt-(?:color|shadow|focus|icon)-[a-z0-9-]+/g)
    .filter((name) => !cells.has(name))
    .sort()

  const list = (names: readonly string[]) =>
    names.map((n) => `\`${n}\``).join(", ")

  return [
    `Families: ${list(FAMILIES)}.`,
    "",
    `Roles: ${list(ROLE_NAMES)}.`,
    "",
    `Outside the matrix: ${list(outside)}.`,
  ].join("\n")
}

/** Spacing, font and line height, as one sentence rather than a list. */
export function spacingAndFont(): string {
  const list = (names: string[]) =>
    names.map((token) => `\`${token}\``).join(", ")

  return [
    `Spacing: ${list(tokenNames(/--lt-spacing-[a-z0-9-]+/g))}.`,
    "",
    `Font: ${list(tokenNames(/--lt-font-[a-z0-9-]+/g))}.`,
    "",
    `Line height: ${list(tokenNames(/--lt-line-height-[a-z0-9-]+/g))}.`,
  ].join("\n")
}

/*
 * The keys in `lt` that do not build attributes. They belong to the type
 * safety, and would otherwise be in the list as builder functions that do not
 * exist.
 */
const HELPERS = new Set([
  "isMarker",
  "isState",
  "markers",
  "setAttributes",
  "states",
])

/** The builder functions in `lt`. Kotlin and Java have the same ones in `Lt`. */
export function builderFunctions(): string {
  const name = Object.keys(lt)
    .filter((key) => !HELPERS.has(key))
    .sort()

  return name.map((builderFunction) => `\`lt.${builderFunction}()\``).join(", ")
}

export function countBuilderFunctions(): number {
  return Object.keys(lt).filter((key) => !HELPERS.has(key)).length
}

export function countComponents(): number {
  return new Set(Object.values(classes).map((info) => info.component)).size
}

/**
 * The rows in the CSS table.
 *
 * `countComponents()` counts components that have at least one class, and
 * `field` has none. The number therefore matched neither the CSS table, the
 * sum of the two tables, nor the reading "so many components and so many
 * elements".
 */
export function countCssComponents(): number {
  return new Set(
    Object.values(classes)
      .filter((info) => CATEGORY.get(info.component) === "css")
      .map((info) => info.component),
  ).size
}

export function countElements(): number {
  return Object.keys(elements).length
}

/**
 * Reflows the paragraphs to 78 characters, and leaves what is not prose alone.
 *
 * The prose in the recipes is in template literals, where the indentation
 * follows the code rather than the text. Without this every recipe would have
 * to be wrapped by hand, and a sentence that changed would leave a ragged
 * edge. Code blocks, tables and the token list are left untouched: there every
 * line means something.
 */
export function reflow(markdown: string): string {
  const WIDTH = 78
  const lines = markdown.split("\n")
  const out: string[] = []
  let paragraph: string[] = []
  let inCode = false
  let indent = ""

  /** List items hang under their own marker, so the text lines up in a column. */
  function flush(): void {
    if (paragraph.length === 0) return

    const text = paragraph.join(" ").replace(/\s+/g, " ").trim()
    const marker = /^(\d+\.\s+|[-*]\s+)/.exec(text)
    const hang = indent + (marker ? " ".repeat(marker[1].length) : "")
    /*
     * A word is characters and code spans together, the spaces inside the
     * span included. Without this, `npx @lo-tek/interfaces check page.html`
     * was split after "check", and an agent that copied the command got a
     * line break in the middle of it. The characters around it must be part
     * of the same word, or the comma after a code span ends up alone on the
     * next line.
     */
    const words = text.match(/(?:`[^`]*`|\S)+/g) ?? []
    let line = ""

    for (const word of words) {
      const candidate = line === "" ? `${indent}${word}` : `${line} ${word}`
      if (line !== "" && candidate.length > WIDTH) {
        out.push(line)
        line = hang + word
      } else {
        line = candidate
      }
    }

    if (line !== "") out.push(line)
    paragraph = []
    indent = ""
  }

  for (const line of lines) {
    /*
     * Indentation does not count. A fence under a numbered item has three
     * spaces in front, and without this the reflow did not see it: the whole
     * code block was reflowed as prose, and `check-agent` did not find it
     * again, since the pattern requires the fence to be on a line of its own.
     * The same goes for an indented table row.
     */
    const trimmed = line.trimStart()

    if (trimmed.startsWith("```")) {
      flush()
      inCode = !inCode
      out.push(line)
      continue
    }

    // A block quote is line-based: reflowed, `> a` and `> b` become `> a > b`.
    if (
      inCode ||
      trimmed.startsWith("|") ||
      trimmed.startsWith("#") ||
      trimmed.startsWith(">")
    ) {
      flush()
      out.push(line)
      continue
    }

    if (line.trim() === "") {
      flush()
      out.push("")
      continue
    }

    // A new item starts a new paragraph, or the whole list would become one.
    if (/^(\d+\.\s|[-*]\s)/.test(trimmed) && paragraph.length > 0) flush()

    /*
     * The indentation of the first item in the paragraph is kept, so a nested
     * list is not flattened to one level. Without it, "- top / ␣␣- level two"
     * became two items on the same level.
     */
    if (paragraph.length === 0)
      indent = line.slice(0, line.length - trimmed.length)

    paragraph.push(trimmed)
  }

  flush()

  // Never two blank lines in a row, and never one at the end.
  return `${out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`
}
