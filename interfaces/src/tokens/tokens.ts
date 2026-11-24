import {
  darkCells,
  type Family,
  lightCells,
  type MatrixToken,
  type Role,
} from "./matrix-cells.js"

export const Breakpoints = {
  sm: "640px",
  md: "768px",
  lg: "1024px",
  xl: "1280px",
  "2xl": "1536px",
} as const

export const Containers = {
  xs: "100%",
  sm: "576px",
  md: "960px",
  lg: "1152px",
  xl: "1536px",
  aside: "384px",
  asideNarrow: "288px",
  wideContent: "768px",
} as const

export type Breakpoint = keyof typeof Breakpoints
export type Container = keyof typeof Containers

/*
 * What each family, role and layer is for, in the same words as
 * `design-tokens.mdx`. The manifest writes them out, so a tool can choose a
 * colour by what it means rather than by its name. Typed against the axes of
 * the matrix: a new family or role needs a sentence here.
 */
export const FAMILY_DESCRIPTIONS: Record<Family, string> = {
  accent: "Links, primary button, focus, selected state",
  visited: "Visited links",
  brand1:
    "First brand colour: surfaces, sections and categories. Carries no meaning of its own",
  brand2:
    "Second brand colour: surfaces, sections and categories. Carries no meaning of its own",
  brand3:
    "Third brand colour: surfaces, sections and categories. Carries no meaning of its own",
  neutral: "The page, body text, borders",
  danger: "Errors, deletion, rejection",
  warning: "Needs attention",
  success: "Completed, approved",
}

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  surface: "Tinted surface: a badge, an alert, a section",
  borderSubtle: "Decorative line, such as between two rows",
  border: "The border around a field or a surface",
  borderStrong: "The field border on hover, and a table line",
  fill: "Filled surface: a button, a checked checkbox",
  content: "The text on top of fill, and on top of text on a button on hover",
  textSubtle: "Muted text: help text, placeholders",
  text: "The family's colour as text, and the button on hover",
  textStrong: "Body text, headings and the link on hover",
}

/** The layers only the neutral family has, because it carries the page itself. */
export const LAYER_DESCRIPTIONS: Record<"canvas" | "raised", string> = {
  canvas: "The page",
  raised: "A surface that lies above a card",
}

/**
 * Everything that is not colour.
 *
 * The colours are not here. The core computes them from the colour contract
 * (`color-contract.json`) and writes them to `matrix-cells.ts`, so the
 * system's colours are the same contract applied to the system's hues. See
 * `colorTokens` below.
 */
export const cssTokens = {
  // Font sizes
  "--lt-font-size-reference": "16px",
  "--lt-font-size-xxs": "0.625rem",
  "--lt-font-size-xs": "0.75rem",
  "--lt-font-size-s": "0.875rem",
  "--lt-font-size-m": "1rem",
  "--lt-font-size-l": "1.125rem",
  "--lt-font-size-xl": "1.375rem",
  "--lt-font-size-xxl": "1.875rem",
  "--lt-font-size-mega": "2.625rem",

  /*
   * Font weights and line heights are here, not in each component, because
   * an organisation adopting the system often has its own typography.
   * Another Norwegian design system has bold buttons with a line height of
   * 1.666, ours are semibold with 1.5, and the difference should be set in
   * one place.
   */
  "--lt-font-weight-regular": "400",
  "--lt-font-weight-medium": "500",
  "--lt-font-weight-semibold": "600",
  "--lt-font-weight-bold": "700",

  /** Controls and buttons. */
  "--lt-line-height-default": "1.5",
  /** Headings. */
  "--lt-line-height-heading": "1.2",
  /** Body text in an article. */
  "--lt-line-height-article": "1.6",
  /** Tighter text on small surfaces: tags, tooltips. */
  "--lt-line-height-compact": "1.4",

  /*
   * The spacing scale, with 4 pixels as the base unit.
   *
   * One scale, not two. Tailwind has one namespace for both spacing and
   * size, `--spacing-*`, and computes `p-4` as `calc(var(--spacing) * 4)`.
   * Two scales would have meant only one of them could be mapped there.
   */
  "--lt-spacing-px": "1px",
  "--lt-spacing-0-5": "0.125rem",
  "--lt-spacing-1": "0.25rem",
  "--lt-spacing-2": "0.5rem",
  "--lt-spacing-3": "0.75rem",
  "--lt-spacing-4": "1rem",
  "--lt-spacing-5": "1.25rem",
  "--lt-spacing-6": "1.5rem",
  "--lt-spacing-7": "1.75rem",
  "--lt-spacing-8": "2rem",
  "--lt-spacing-10": "2.5rem",
  "--lt-spacing-12": "3rem",
  "--lt-spacing-16": "4rem",

  /*
   * The icons are images with the stroke painted in, so they do not follow
   * the matrix.
   *
   * An icon drawn into a background cannot read a CSS variable. They
   * therefore have a dark and a light version, and switch with the theme.
   */
  "--lt-icon-search":
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%234d4d4d' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cline x1='16.5' y1='16.5' x2='21' y2='21'/%3E%3C/svg%3E\")",
  "--lt-icon-check":
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23ffffff' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='20 6 9 17 4 12'/%3E%3C/svg%3E\")",
  "--lt-icon-dash":
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23ffffff' stroke-width='3' stroke-linecap='round'%3E%3Cline x1='6' y1='12' x2='18' y2='12'/%3E%3C/svg%3E\")",
  "--lt-icon-calendar":
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%234d4d4d' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='4' width='18' height='18' rx='2' ry='2'/%3E%3Cline x1='16' y1='2' x2='16' y2='6'/%3E%3Cline x1='8' y1='2' x2='8' y2='6'/%3E%3Cline x1='3' y1='10' x2='21' y2='10'/%3E%3C/svg%3E\")",
  "--lt-icon-clock":
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%234d4d4d' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='9'/%3E%3Cpolyline points='12 7 12 12 15 15'/%3E%3C/svg%3E\")",
} as const

/**
 * Every variable name the system ships.
 *
 * The colours are included even though they are not in `cssTokens`: they are
 * computed by the contract and so have no literal in the source. `ColorToken`
 * derives them from the axes instead. Without the colours here, the lookup
 * table was typed for everything *except* what the consumer writes most
 * often, and a typo in a colour name gave no error in the editor.
 */
export type CssToken = keyof typeof cssTokens | ColorToken

/** The icons in dark theme, with a lighter stroke. */
export const darkTokens = {
  "--lt-icon-search":
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23b2b2b2' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cline x1='16.5' y1='16.5' x2='21' y2='21'/%3E%3C/svg%3E\")",
  "--lt-icon-check":
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%231a1a1a' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='20 6 9 17 4 12'/%3E%3C/svg%3E\")",
  "--lt-icon-dash":
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%231a1a1a' stroke-width='3' stroke-linecap='round'%3E%3Cline x1='6' y1='12' x2='18' y2='12'/%3E%3C/svg%3E\")",
  "--lt-icon-calendar":
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23b2b2b2' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='4' width='18' height='18' rx='2' ry='2'/%3E%3Cline x1='16' y1='2' x2='16' y2='6'/%3E%3Cline x1='8' y1='2' x2='8' y2='6'/%3E%3Cline x1='3' y1='10' x2='21' y2='10'/%3E%3C/svg%3E\")",
  "--lt-icon-clock":
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23b2b2b2' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='9'/%3E%3Cpolyline points='12 7 12 12 15 15'/%3E%3C/svg%3E\")",
} as const satisfies Partial<Record<CssToken, string>>

/**
 * System colours that are not a cell in the matrix.
 *
 * The disabled state is exempt from the contrast requirement in WCAG 1.4.3,
 * and the value is low on purpose: a disabled control should look disabled.
 * 3.44:1 against the surface is still readable, while a lighter grey gave
 * 1.83 and was not.
 *
 * The backdrop behind a modal and the shadow under a panel are translucent
 * black in both themes, not a colour from a scale.
 */
const SYSTEM_COLORS = {
  "--lt-color-disabled-surface": "var(--lt-color-neutral-raised)",
  "--lt-color-disabled-text": "var(--lt-color-neutral-border)",
  "--lt-focus-ring": "2px solid var(--lt-color-accent-border-strong)",
} as const

/**
 * The colours, computed by the contract.
 *
 * The system's colours are the same contract applied to the system's hues.
 * There is no hand-picked palette beside it, so there is no version that can
 * drift out of step with the promises.
 */
/** The colour names that are not a cell: disabled state, ring, backdrop, shadow. */
export type SystemColorToken =
  | keyof typeof SYSTEM_COLORS
  | "--lt-color-overlay"
  | "--lt-shadow-overlay"

/** Every colour name the system ships. */
export type ColorToken = MatrixToken | SystemColorToken

export const colorTokens: Record<ColorToken, string> = {
  ...lightCells,
  ...SYSTEM_COLORS,
  "--lt-color-overlay": "#1a1a1a80",
  "--lt-shadow-overlay": "0 16px 40px rgba(0, 0, 0, 0.12)",
}

export const darkColorTokens: Record<
  MatrixToken | "--lt-color-overlay" | "--lt-shadow-overlay",
  string
> = {
  ...darkCells,
  "--lt-color-overlay": "rgba(0, 0, 0, 0.72)",
  "--lt-shadow-overlay": "0 16px 40px rgba(0, 0, 0, 0.6)",
}
