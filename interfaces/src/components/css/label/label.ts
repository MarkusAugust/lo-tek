import {
  attributes,
  createGuard,
  type RequiredMarker,
  requiredMarkers,
} from "../shared.js"

export const LABEL_CLASS = "lt-label" as const

export type { RequiredMarker }
export { requiredMarkers }

export type LabelOptions = {
  /** Marks the field as required, with an asterisk or with the word "(required)". */
  required?: RequiredMarker
  /** Marks the field as optional. Choose one of `required` and `optional`. */
  optional?: boolean
  /** Mutes the text when the control is disabled. */
  disabled?: boolean
}

export type LabelAttributes = {
  class: typeof LABEL_CLASS
  "data-required"?: RequiredMarker
  "data-optional"?: ""
  "aria-disabled"?: "true"
}

/**
 * The attributes for a label.
 *
 * The marker is only visual, so set `required` on the field itself as well,
 * or the screen reader is not told that it must be filled in.
 *
 * ```ts
 * <label {...label({ required: "symbol" })} htmlFor="fixer">Fixer's address</label>
 * ```
 */
export const label = Object.assign(
  ({ required, optional, disabled }: LabelOptions = {}): LabelAttributes =>
    attributes({
      class: LABEL_CLASS,
      "data-required": required,
      "data-optional": optional && !required ? ("" as const) : undefined,
      "aria-disabled": disabled ? ("true" as const) : undefined,
    }),
  {
    markers: requiredMarkers,
    isMarker: createGuard(requiredMarkers),
  },
)
