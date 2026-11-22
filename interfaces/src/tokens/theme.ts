import type { Brand, BrandFill, Violation } from "../diagnostics/core.js"
import { defaultCore } from "../diagnostics/default-core.js"
import type { Family } from "./matrix.js"

export type { Brand, BrandFill, Violation }

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
 * The checkbox, the badge, the tag, the toggle group, the avatar and the
 * skeleton are left out on purpose. There the corner is not a style choice
 * but the shape itself: a checkbox that turns round looks like a radio
 * button, and a badge that turns square looks like a button.
 */
export type ThemeShape = {
  /** Corners on the button, the pagination and the skip link. */
  buttonRadius?: string | number
  /** Corners on the field, the text area and the select. */
  fieldRadius?: string | number
  /**
   * Corners on the card, dialog, popover, alert, accordion, error summary,
   * file upload, session timeout, suggestion list, toast and tooltip.
   */
  surfaceRadius?: string | number
  /** The border width of the button. */
  buttonBorderWidth?: string | number
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
