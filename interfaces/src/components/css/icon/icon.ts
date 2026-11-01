import { attributes } from "../shared.js"

export const ICON_CLASS = "lt-icon" as const

export type IconOptions = {
  /**
   * What the icon means, when it stands alone and means something, such as a
   * warning sign with no text next to it. Becomes `aria-label` with
   * `role="img"`. Without it the icon is decoration, and is hidden from
   * screen readers.
   */
  label?: string
}

export type IconAttributes = {
  class: typeof ICON_CLASS
  role?: "img"
  "aria-label"?: string
  "aria-hidden"?: "true"
}

/**
 * The attributes for an icon. The class goes on an `<svg>`, and the svg comes
 * from the app's icon set: LO-TEK ships no icons.
 *
 * The icon is as large as the text around it, and is drawn in the colour the
 * svg says, which should be `currentColor`. Without `label` it is decoration,
 * and if it stands alone in a button, the button must get its name somewhere
 * else: `aria-label` on the button, or a text with `lt-sr-only`. The core
 * reports a button that lacks one.
 *
 * ```ts
 * <button {...button()} aria-label="Delete ticket #0331">
 *   <svg {...icon()} viewBox="0 0 24 24">…</svg>
 * </button>
 * ```
 */
export const icon = ({ label }: IconOptions = {}): IconAttributes =>
  attributes({
    class: ICON_CLASS,
    role: label ? ("img" as const) : undefined,
    "aria-label": label || undefined,
    "aria-hidden": label ? undefined : ("true" as const),
  })
