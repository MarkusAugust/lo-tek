/**
 * Where the theme builder rests: LO-TEK's own value for each key of the
 * recipe, read from where the repository states it, for the checks that
 * hold the page to it.
 *
 * Nothing here is written down where it can be read. The weights and the
 * line heights are in the descriptions in `theme.schema.json` ("400 if left
 * out"), the corners, the border and the weight of the button are what the
 * component stylesheets fall back to, and the colours are `brands` in the
 * colour contract. A page that rests somewhere LO-TEK does not is then
 * found by the checks, and not agreed with by a second list.
 *
 * Three keys have no single value in LO-TEK, and their fields rest empty:
 * the font, which LO-TEK inherits from the page; the corner of the
 * surfaces, where most have one and the card and the dialog another; and
 * the weight of the button text, which follows the medium weight unless it
 * is set. The last two still have a slider, which rests where most of
 * LO-TEK is.
 */

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

type Schema = { description?: string; properties?: Record<string, Schema> }
const schema = JSON.parse(
  readFileSync(`${ROOT}interfaces/src/tokens/theme.schema.json`, "utf8"),
) as Schema
const contract = JSON.parse(
  readFileSync(`${ROOT}interfaces/src/tokens/color-contract.json`, "utf8"),
) as { families: string[]; brands: Record<string, string> }
const tokens = readFileSync(`${ROOT}interfaces/src/tokens/tokens.css`, "utf8")
const css = (file: string) =>
  readFileSync(`${ROOT}interfaces/src/components/css/${file}`, "utf8")

/** What could not be read. A check that imports this stops when it is not empty. */
export const unread: string[] = []

/** The colour families, and LO-TEK's own colour for each. */
export const FAMILIES = contract.families
export const BRANDS = contract.brands

/** Every key of the recipe that takes a value, as a path with dots. */
function leaves(at: Schema, path = ""): string[] {
  return Object.entries(at.properties ?? {}).flatMap(([name, property]) =>
    path === "" && name === "$schema"
      ? []
      : property.properties
        ? leaves(property, `${path}${name}.`)
        : [`${path}${name}`],
  )
}
export const KEYS = leaves(schema)

/** A length or a number as the number a slider shows: pixels for a length. */
const shown = (text: string) =>
  Number.parseFloat(text) * (text.trim().endsWith("rem") ? 16 : 1)

/** The value of a token, as `tokens.css` writes it. */
function token(name: string): string {
  const value = new RegExp(`${name}:\\s*([^;]+);`).exec(tokens)?.[1].trim()
  if (!value) unread.push(`tokens.css has no ${name}`)
  return value ?? ""
}
/** What a stylesheet falls back to when the theme does not set a hook, as text. */
function fallback(file: string, hook: string): string {
  const value = new RegExp(
    `var\\(\\s*${hook}\\s*,\\s*(var\\(\\s*(--lt-[a-z0-9-]+)\\s*\\)|[0-9.]+px)\\s*\\)`,
  ).exec(css(file))
  if (!value) {
    unread.push(`${file} has no fallback for ${hook}`)
    return ""
  }
  return value[2] ? token(value[2]) : value[1]
}
/** "400 if left out." in the description of a key in the schema, as text. */
function leftOut(group: "weights" | "lineHeights", key: string): string {
  const description =
    schema.properties?.typography?.properties?.[group]?.properties?.[key]
      ?.description ?? ""
  const value = /([0-9.]+) if left out/.exec(description)?.[1]
  if (!value)
    unread.push(`the schema does not say what ${group}.${key} is if left out`)
  return value ?? ""
}

/** A slider: its range, the number it rests at, and the unit it writes. */
export type Slider = {
  min: number
  max: number
  step: number
  rest: number
  unit: string
}

const weight = (text: string): Slider => ({
  min: 100,
  max: 900,
  step: 100,
  rest: shown(text),
  unit: "",
})
const height = (text: string): Slider => ({
  min: 1,
  max: 2,
  step: 0.05,
  rest: shown(text),
  unit: "",
})
const corner = (text: string): Slider => ({
  min: 0,
  max: 32,
  step: 1,
  rest: shown(text),
  unit: "px",
})

/** The text each field of typography and shape rests at. Empty where LO-TEK has no one value. */
export const RESTING: Record<string, string> = {
  "typography.fontFamily": "",
  ...Object.fromEntries(
    ["regular", "medium", "semibold", "bold"].map((key) => [
      `typography.weights.${key}`,
      leftOut("weights", key),
    ]),
  ),
  ...Object.fromEntries(
    ["default", "heading", "article", "compact"].map((key) => [
      `typography.lineHeights.${key}`,
      leftOut("lineHeights", key),
    ]),
  ),
  "shape.buttonRadius": fallback("button/button.css", "--lt-button-radius"),
  "shape.fieldRadius": fallback("input/input.css", "--lt-input-radius"),
  "shape.surfaceRadius": "",
  "shape.buttonBorderWidth": fallback(
    "button/button.css",
    "--lt-button-border-width",
  ),
  "shape.buttonFontWeight": "",
}

/** The sliders, by the key of the field each stands beside. */
export const SLIDERS: Record<string, Slider> = {
  ...Object.fromEntries(
    ["regular", "medium", "semibold", "bold"].map((key) => [
      `typography.weights.${key}`,
      weight(RESTING[`typography.weights.${key}`]),
    ]),
  ),
  ...Object.fromEntries(
    ["default", "heading", "article", "compact"].map((key) => [
      `typography.lineHeights.${key}`,
      height(RESTING[`typography.lineHeights.${key}`]),
    ]),
  ),
  "shape.buttonRadius": corner(RESTING["shape.buttonRadius"]),
  "shape.fieldRadius": corner(RESTING["shape.fieldRadius"]),
  // Most surfaces have the corner of the alert.
  "shape.surfaceRadius": corner(
    fallback("alert/alert.css", "--lt-alert-radius"),
  ),
  "shape.buttonBorderWidth": {
    ...corner(RESTING["shape.buttonBorderWidth"]),
    max: 4,
  },
  // The button text follows the medium weight.
  "shape.buttonFontWeight": weight(
    fallback("button/button.css", "--lt-button-font-weight"),
  ),
}

/** The keys of typography and shape: the ones with a resting text, empty or not. */
export const BLOCK_KEYS = KEYS.filter((key) => !FAMILIES.includes(key))

if (
  JSON.stringify([...BLOCK_KEYS].sort()) !==
  JSON.stringify(Object.keys(RESTING).sort())
)
  unread.push(
    `the keys of typography and shape are ${BLOCK_KEYS.join(", ")}, and the resting texts are written for ${Object.keys(RESTING).join(", ")}: this file is older than the schema`,
  )
for (const [key, { rest, min, max }] of Object.entries(SLIDERS))
  if (!(rest >= min && rest <= max))
    unread.push(`${key} rests at ${rest}, outside ${min} to ${max}`)
