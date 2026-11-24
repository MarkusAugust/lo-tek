/**
 * Where the theme builder rests: LO-TEK's own value for each key of the
 * recipe, for the checks that hold the page to it.
 *
 * The values are what LO-TEK does when a key is left out, read from the
 * tokens and the component stylesheets by `interfaces/scripts/theme-left-out.ts`,
 * which the schema's `default` is held to as well: the page reads the
 * schema, and the checks read the stylesheets, so a page that rests
 * somewhere LO-TEK does not is found. The colours are `brands` in the
 * colour contract.
 *
 * Three keys have no single value in LO-TEK, and their fields rest empty:
 * the font, the corner of the surfaces and the weight of the button text.
 * The last two still have a slider, which rests where most of LO-TEK is.
 */

import {
  LEFT_OUT,
  unread as unreadDefaults,
} from "../../interfaces/scripts/theme-left-out"
import { leaves as themeKeys } from "../../interfaces/src/tokens/theme-keys"
import { FAMILIES, KEYS } from "./theme-recipe"

/**
 * What could not be read. The checks that import this file,
 * `check-theme-resting.ts` and `check-theme-exchange.ts`, stop when it is
 * not empty.
 */
export const unread: string[] = [...unreadDefaults]

/**
 * What the page shows under the field of each key, from the source the
 * schema is written from, `theme-keys.ts`: what the key is for, and for a
 * key of typography or shape without a default also what holds when it is
 * left out, since the field is empty at rest and that sentence says it. A
 * colour family says what "left out" means without a sentence: its switch
 * is off and its picker shows LO-TEK's colour.
 */
export const HELP: Record<string, string> = Object.fromEntries(
  themeKeys().map((key) => [
    key.path.join("."),
    key.path.length > 1 && key.default === undefined
      ? `${key.purpose} ${key.leftOut}`
      : key.purpose,
  ]),
)

/** A length or a number as the number a slider shows: pixels for a length. */
const shown = (text: string) =>
  Number.parseFloat(text) * (text.trim().endsWith("rem") ? 16 : 1)

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
export const RESTING: Record<string, string> = Object.fromEntries(
  KEYS.filter((key) => key.includes(".")).map((key) => [
    key,
    LEFT_OUT[key] ?? "",
  ]),
)

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
  "shape.surfaceRadius": corner(""),
  "shape.buttonBorderWidth": {
    ...corner(RESTING["shape.buttonBorderWidth"]),
    max: 4,
  },
  "shape.buttonFontWeight": weight(""),
}

/**
 * The two sliders whose key has no one value. Where each stands before
 * anything is chosen is the page's own choice, so `rest` is not a number
 * here: a check reads it off the page, and holds it to the slider's range.
 */
export const PAGE_CHOOSES = Object.keys(SLIDERS).filter((key) =>
  Number.isNaN(SLIDERS[key].rest),
)

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
  if (!PAGE_CHOOSES.includes(key) && !(rest >= min && rest <= max))
    unread.push(`${key} rests at ${rest}, outside ${min} to ${max}`)
