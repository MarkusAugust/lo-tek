import { attributes, createGuard } from "../shared.js"

export const AVATAR_CLASS = "lt-avatar" as const
/** Several profile pictures that overlap. */
export const AVATAR_STACK_CLASS = "lt-avatar-stack" as const

export const avatarSizes = ["small", "medium", "large"] as const
export const avatarVariants = ["circle", "square"] as const

export type AvatarSize = (typeof avatarSizes)[number]
export type AvatarVariant = (typeof avatarVariants)[number]
export type NonDefaultAvatarSize = Exclude<AvatarSize, "medium">
export type NonDefaultAvatarVariant = Exclude<AvatarVariant, "circle">

export type AvatarOptions = {
  /** Size. Default: `medium`. */
  size?: AvatarSize
  /** Round or rounded square. Default: `circle`. */
  variant?: AvatarVariant
}

export type AvatarAttributes = {
  class: typeof AVATAR_CLASS
  "data-size"?: NonDefaultAvatarSize
  "data-variant"?: NonDefaultAvatarVariant
}

/**
 * The attributes for a profile picture or initials.
 *
 * If the name is already next to it, the picture is decoration: set
 * `aria-hidden="true"` on it, or the name is announced twice. If the
 * picture stands alone, it must have a text that says who it is.
 *
 * ```ts
 * <span {...avatar({ size: "small" })} aria-hidden="true">DP</span>
 * ```
 */
export const avatar = Object.assign(
  ({
    size = "medium",
    variant = "circle",
  }: AvatarOptions = {}): AvatarAttributes =>
    attributes({
      class: AVATAR_CLASS,
      "data-size": size === "medium" ? undefined : size,
      "data-variant": variant === "circle" ? undefined : variant,
    }),
  {
    /** The class on the list of overlapping profile pictures. */
    stack: AVATAR_STACK_CLASS,
    sizes: avatarSizes,
    isSize: createGuard(avatarSizes),
    variants: avatarVariants,
    isVariant: createGuard(avatarVariants),
  },
)
