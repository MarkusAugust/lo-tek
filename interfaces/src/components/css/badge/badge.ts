import { attributes, createGuard } from "../shared.js"

export const BADGE_CLASS = "lt-badge" as const

export const badgeColors = [
  "info",
  "success",
  "warning",
  "danger",
  "neutral",
] as const

export type BadgeColor = (typeof badgeColors)[number]
export type NonInfoBadgeColor = Exclude<BadgeColor, "info">

export type BadgeOptions = {
  /** What the status means. Default: `info`. */
  color?: BadgeColor
}

export type BadgeAttributes = {
  class: typeof BADGE_CLASS
  "data-color"?: NonInfoBadgeColor
}

/**
 * The attributes for a status badge.
 *
 * ```ts
 * <span {...badge({ color: "success" })}>Paid</span>
 * ```
 */
export const badge = Object.assign(
  ({ color = "info" }: BadgeOptions = {}): BadgeAttributes =>
    attributes({
      class: BADGE_CLASS,
      "data-color": color === "info" ? undefined : color,
    }),
  {
    colors: badgeColors,
    isColor: createGuard(badgeColors),
  },
)
