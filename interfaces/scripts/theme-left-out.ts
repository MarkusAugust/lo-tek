/**
 * What LO-TEK does when a key of the theme recipe is left out, read from
 * where LO-TEK does it: the tokens and the component stylesheets.
 *
 * A theme sets a hook, and a hook that is not set falls back: the weights
 * and the line heights to the tokens in `tokens.css`, the corner of a
 * component to what its stylesheet writes after the comma in
 * `var(--lt-button-radius, …)`. That is the fact the schema states, as a
 * `default` where a key has one value and in its description where it has
 * not, and what the theme builder rests at. It is read here, once, for the
 * tests that hold the schema and the page to it, so neither is held to a
 * list written beside it.
 *
 * A key of the shape sets several components at once, and which ones is the
 * core's to say: the lists are read from its source. The key has one value
 * when every component of its list falls back to the same.
 */

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { Glob } from "bun"

const PACKAGE = fileURLToPath(new URL("..", import.meta.url))
const tokens = readFileSync(`${PACKAGE}src/tokens/tokens.css`, "utf8")
const core = readFileSync(`${PACKAGE}../core/src/theme/mod.rs`, "utf8")
const sheets = [
  ...new Glob("**/*.css").scanSync(`${PACKAGE}src/components`),
].map((file) => readFileSync(`${PACKAGE}src/components/${file}`, "utf8"))

/** What could not be read. A test that imports this stops when it is not empty. */
export const unread: string[] = []

/** The value of a token, as `tokens.css` writes it. */
function token(name: string): string {
  const value = new RegExp(`${name}:\\s*([^;]+);`).exec(tokens)?.[1].trim()
  if (!value) unread.push(`tokens.css has no ${name}`)
  return value ?? ""
}
/**
 * What the stylesheets fall back to when the theme does not set a hook: the
 * value as text, and the token it is, when it is one. Every place a hook is
 * read must fall back to the same.
 */
function fallback(hook: string): { value: string; token?: string } {
  const found = sheets.flatMap((sheet) => [
    ...sheet.matchAll(
      new RegExp(
        `var\\(\\s*${hook}\\s*,\\s*(var\\(\\s*(--lt-[a-z0-9-]+)\\s*\\)|[0-9.]+px)\\s*\\)`,
        "g",
      ),
    ),
  ])
  const distinct = [...new Set(found.map((match) => match[1]))]
  if (distinct.length !== 1) {
    unread.push(
      `the stylesheets fall back from ${hook} to ${distinct.join(" and ") || "nothing"}, not to one value`,
    )
    return { value: "" }
  }
  const [, literal, name] = found[0]
  return name ? { value: token(name), token: name } : { value: literal }
}
/** A list of components in the core's source, by the name of the constant. */
function components(name: string): string[] {
  const list = [
    ...(
      new RegExp(`const ${name}: \\[&str; \\d+\\] = \\[([^\\]]*)\\]`).exec(
        core,
      )?.[1] ?? ""
    ).matchAll(/"([a-z-]+)"/g),
  ].map((match) => match[1])
  if (list.length === 0) unread.push(`the core has no list ${name}`)
  return list
}
const kebab = (key: string) =>
  key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)

/** The corner each component of a list has when the theme sets none, by its value. */
function corners(list: string): Record<string, string[]> {
  const by: Record<string, string[]> = {}
  for (const component of components(list)) {
    const { value } = fallback(`--lt-${component}-radius`)
    by[value] = [...(by[value] ?? []), component]
  }
  return by
}
/** The one corner of a list, or nothing when its components differ. */
function oneCorner(list: string): string | undefined {
  const values = Object.keys(corners(list))
  return values.length === 1 ? values[0] : undefined
}

/**
 * The corner of every surface when the theme sets none, by its value: most
 * surfaces have one, and a few have another of their own.
 */
export const SURFACE_CORNERS = corners("SURFACES")

/** The key another key follows when it is left out, where it follows one. */
export const FOLLOWS: Record<string, string> = {}
{
  // The weight of the button text is the medium weight unless it is set.
  const followed = /^--lt-font-weight-([a-z]+)$/.exec(
    fallback("--lt-button-font-weight").token ?? "",
  )?.[1]
  if (followed) FOLLOWS["shape.buttonFontWeight"] = `weights.${followed}`
  else unread.push("the button's font weight falls back to no weight token")
}

/** Whether LO-TEK sets a font of its own. It does not: the page's is inherited. */
export const HAS_OWN_FONT = /--lt-font-family-base\s*:/.test(tokens)

/**
 * The one value each key has when it is left out, by the path of the key
 * with dots, as LO-TEK writes it: `"400"`, `"1.5"`, `"0.25rem"`, `"1px"`.
 * A key that is not here has no one value.
 */
export const LEFT_OUT: Record<string, string> = Object.fromEntries(
  [
    ...["regular", "medium", "semibold", "bold"].map((key) => [
      `typography.weights.${key}`,
      token(`--lt-font-weight-${key}`),
    ]),
    ...["default", "heading", "article", "compact"].map((key) => [
      `typography.lineHeights.${key}`,
      token(`--lt-line-height-${kebab(key)}`),
    ]),
    ["shape.buttonRadius", oneCorner("BUTTONS")],
    ["shape.fieldRadius", oneCorner("FIELDS")],
    ["shape.surfaceRadius", oneCorner("SURFACES")],
    ["shape.buttonBorderWidth", fallback("--lt-button-border-width").value],
  ].filter((entry): entry is [string, string] => entry[1] !== undefined),
)
