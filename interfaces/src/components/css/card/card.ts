import { attributes, createGuard } from "../shared.js"

export const CARD_CLASS = "lt-card" as const
/** The heading inside the card. */
export const CARD_TITLE_CLASS = "lt-card__title" as const

export const cardVariants = ["outline", "filled"] as const

export type CardVariant = (typeof cardVariants)[number]
export type NonDefaultCardVariant = Exclude<CardVariant, "outline">

export type CardOptions = {
  /** Surface or outline. Default: `outline`. */
  variant?: CardVariant
  /** The whole card is clickable. Use only on `<a>` or `<button>`. */
  interactive?: boolean
}

export type CardAttributes = {
  class: typeof CARD_CLASS
  "data-variant"?: NonDefaultCardVariant
  "data-interactive"?: ""
}

/**
 * The attributes for a card.
 *
 * `interactive` gives hover and a focus ring, but makes nothing clickable by
 * itself. If the whole card should be pressable, the element must be an
 * `<a>` or a `<button>`. A `<div>` with a click listener can neither be
 * reached with the keyboard nor be announced as something to press.
 *
 * ```ts
 * <a {...card({ interactive: true })} href="/claims/AV-2079-0481">…</a>
 * ```
 */
export const card = Object.assign(
  ({ variant = "outline", interactive }: CardOptions = {}): CardAttributes =>
    attributes({
      class: CARD_CLASS,
      "data-variant": variant === "outline" ? undefined : variant,
      "data-interactive": interactive ? ("" as const) : undefined,
    }),
  {
    /** The class on the heading inside the card. */
    title: CARD_TITLE_CLASS,
    variants: cardVariants,
    isVariant: createGuard(cardVariants),
  },
)
