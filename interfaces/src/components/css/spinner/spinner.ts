import { attributes, createGuard } from "../shared.js"

export const SPINNER_CLASS = "lt-spinner" as const

export const spinnerSizes = ["small", "medium", "large"] as const

export type SpinnerSize = (typeof spinnerSizes)[number]
export type NonDefaultSpinnerSize = Exclude<SpinnerSize, "medium">

export type SpinnerOptions = {
  /** Size. Default: `medium`. */
  size?: SpinnerSize
  /** What is loading. Becomes `aria-label`, so the ring has a name for screen readers. */
  label?: string
}

export type SpinnerAttributes = {
  class: typeof SPINNER_CLASS
  "data-size"?: NonDefaultSpinnerSize
  role?: "status"
  "aria-label"?: string
}

/**
 * The attributes for a loading indicator.
 *
 * Without `label` the ring is only a shape, and screen readers announce
 * nothing. With `label` it becomes a `role="status"` that says what is going
 * on. If you already have a visible text next to it, let that carry the
 * message and drop `label`, so the same thing is not announced twice.
 *
 * ```ts
 * <span {...spinner({ label: "Loading sectors" })} />
 * ```
 */
export const spinner = Object.assign(
  ({ size = "medium", label }: SpinnerOptions = {}): SpinnerAttributes =>
    attributes({
      class: SPINNER_CLASS,
      "data-size": size === "medium" ? undefined : size,
      role: label ? ("status" as const) : undefined,
      "aria-label": label,
    }),
  {
    sizes: spinnerSizes,
    isSize: createGuard(spinnerSizes),
  },
)
