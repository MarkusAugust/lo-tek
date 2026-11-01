import { attributes, createGuard } from "../shared.js"

export const TAG_CLASS = "lt-tag" as const

export const tagVariants = ["outline", "filled"] as const

export type TagVariant = (typeof tagVariants)[number]
export type NonDefaultTagVariant = Exclude<TagVariant, "outline">

export type TagOptions = {
  /** Outline or muted surface. Default: `outline`. */
  variant?: TagVariant
  /** The tag can be toggled on and off. Use only on a `<button>`. */
  selectable?: boolean
}

export type TagAttributes = {
  class: typeof TAG_CLASS
  "data-variant"?: NonDefaultTagVariant
  "data-selectable"?: ""
}

/**
 * The attributes for a tag.
 *
 * A tag labels content: keywords on an article, selected filters above a
 * list. If it says what state something is in, [Badge](../badge/badge.js)
 * is right instead.
 *
 * `selectable` gives hover and a focus ring, but makes nothing pressable.
 * The element must be a `<button>`, and you set `aria-pressed` yourself,
 * since only you know whether the tag is selected.
 *
 * ```ts
 * <button {...tag({ selectable: true })} aria-pressed="true">Cutter</button>
 * ```
 */
export const tag = Object.assign(
  ({ variant = "outline", selectable }: TagOptions = {}): TagAttributes =>
    attributes({
      class: TAG_CLASS,
      "data-variant": variant === "outline" ? undefined : variant,
      "data-selectable": selectable ? ("" as const) : undefined,
    }),
  {
    variants: tagVariants,
    isVariant: createGuard(tagVariants),
  },
)
