import type {
  Brand,
  BrandFill,
  Palette,
  PaletteColor,
  Palettes,
  RecipeProblem,
  RecipeValue,
  Violation,
} from "../diagnostics/core.js"
import { defaultCore } from "../diagnostics/default-core.js"
import type { Family } from "./matrix.js"

export type {
  Brand,
  BrandFill,
  Palette,
  PaletteColor,
  Palettes,
  RecipeProblem,
  RecipeValue,
  Violation,
}

/**
 * Builds a complete colour theme from a few brand colours.
 *
 * The theme is the contract applied to the consumer's hues. The hue comes
 * from the consumer, the lightness from the role, and the promises hold by
 * construction. That is why there is no adjustment pass here: there is
 * nothing to adjust afterwards. The brand colour itself is moved to the
 * lightness of the role, and `brands` says how far.
 *
 * ```ts
 * const theme = buildTheme({ accent: "#7c3aed", danger: "#b3261e" })
 * console.log(theme.css)
 * ```
 */

export type ThemeTypography = {
  /** The font stack the whole theme uses, written as in CSS. */
  fontFamily?: string
  /** The weights, as numbers or keywords. */
  weights?: {
    regular?: string | number
    medium?: string | number
    semibold?: string | number
    bold?: string | number
  }
  /** Line heights for controls, headings, body text and small surfaces. */
  lineHeights?: {
    default?: string | number
    heading?: string | number
    article?: string | number
    compact?: string | number
  }
}

/**
 * The shape of the theme: corners and borders.
 *
 * The button, the field and the surfaces are set separately. The distinction
 * is worth keeping: another Norwegian design system has fully round buttons
 * and fields with almost square corners, and one shared number would have
 * turned the fields into capsules.
 *
 * The checkbox, the badge, the tag, the toggle group, the avatar, the
 * skeleton and the progress bar are left out on purpose. There the corner is not a style choice
 * but the shape itself: a checkbox that turns round looks like a radio
 * button, and a badge that turns square looks like a button.
 */
export type ThemeShape = {
  /** Corners on the button, the pagination and the skip link. */
  buttonRadius?: string | 0
  /** Corners on the field, the text area and the select. */
  fieldRadius?: string | 0
  /**
   * Corners on the card, dialog, popover, alert, accordion, error summary,
   * file upload, session timeout, suggestion list, toast, tooltip and the
   * panel of a term.
   */
  surfaceRadius?: string | 0
  /** The border width of the button. */
  buttonBorderWidth?: string | 0
  /** The font weight of the button text. */
  buttonFontWeight?: string | number
}

/**
 * The brand colours.
 *
 * Each family is optional on its own, and one you leave out inherits
 * LO-TEK's default hue. Leave them all out, and the theme only sets type and
 * shape.
 */
export type ThemeColors = Partial<Record<Family, string>>

export type ThemeInput = ThemeColors & {
  /** Type and line height. Left out, LO-TEK's default typography stays. */
  typography?: ThemeTypography
  /** Corners and borders. Left out, LO-TEK's default shape stays. */
  shape?: ThemeShape
}

export type Theme = {
  light: Record<string, string>
  dark: Record<string, string>
  /** Promises that do not hold. Empty when the theme is sound. */
  violations: Violation[]
  /**
   * What became of each brand colour you gave: the fill it got in each
   * appearance, and why it could not be the fill as it was.
   */
  brands: Brand[]
  css: string
}

/**
 * Builds the theme, and checks every promise while it is built.
 *
 * The arithmetic happens in the core, written in Rust, which `lotek theme` and
 * LO-TEK for Kotlin use. The typography and shape values are written straight
 * into a CSS rule, so a value that could break out of it, such as
 * `4px; } html {`, an unclosed parenthesis or `</style>`, is rejected with an
 * explanation that names the field in the recipe.
 */
export function buildTheme(input: ThemeInput): Theme {
  return defaultCore().buildTheme(input)
}

/**
 * Says what is wrong with a recipe, all at once.
 *
 * `buildTheme` refuses with one sentence, which suits a run. A form with a
 * field per key wants every reason, each at its field. The answer is a list
 * of problems: the `path` of the key as segments, the `kind`, and the
 * `message` for a person. A problem about the recipe as a whole is alone.
 * Otherwise the keys the recipe does not have come first, then the values
 * the core refuses, in the order of the keys.
 *
 * The list is empty exactly when `buildTheme` takes the recipe. Decide on
 * `kind`, never on the wording of `message`. It throws for what the core
 * cannot read as JSON at all: a value that cannot be written as JSON, such
 * as `undefined`, and one nested deeper than the core reads.
 */
export function checkRecipe(input: unknown): RecipeProblem[] {
  return defaultCore().checkRecipe(input)
}

/**
 * Says what a recipe gives, as the core reads it.
 *
 * The answer has each key that has a value, in the order of the keys, with
 * its `path` as segments and the value as `text`: the text as it is written,
 * not normalised, a number as its text, and a key that is not given is not
 * there. A text the core then refuses is
 * there, with a problem beside it in `checkRecipe`. A value that cannot be
 * one, `true`, a list or an object, is not, and neither is a key the theme
 * does not have.
 *
 * A form over the recipe is filled from this, so it has no reading of its
 * own that could disagree with the core's about what counts as given.
 */
export function recipeValues(input: unknown): RecipeValue[] {
  return defaultCore().recipeValues(input)
}

/**
 * Says what became of each colour the core takes in a recipe, whatever else
 * in it is wrong.
 *
 * `buildTheme` gives nothing for a recipe with one thing wrong. A form that
 * shows what each colour becomes wants the rows of the colours that are
 * right while another field is still being written. The answer is the rows
 * `buildTheme` gives as `brands`, for every family whose own value is a
 * colour, as they would be without the values the core refuses. For a recipe
 * `buildTheme` takes, it is `buildTheme(recipe).brands`.
 */
export function recipeBrands(input: unknown): Brand[] {
  return defaultCore().recipeBrands(input)
}

/**
 * Suggests four palettes to go with the accent of a recipe: Near, Opposite,
 * Three ways and One hue.
 *
 * Each has a colour for visited, brand1, brand2, brand3 and neutral, made
 * at the lightness of the fill, so the colour is the fill the theme gets in
 * the light theme. danger, warning and success are never suggested, and a
 * suggestion is kept clear of their hues. A family the recipe gives a colour
 * stands as it is, with `kept: true`, and one whose value the core refuses
 * has no row. Without an accent the palettes are built on LO-TEK's own.
 *
 * `null` when the recipe is not an object, and when its accent is not a
 * colour.
 */
export function suggestPalettes(input: unknown): Palettes | null {
  return defaultCore().suggestPalettes(input)
}
