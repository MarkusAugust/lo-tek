import {
  attributes,
  createGuard,
  type FieldState,
  fieldStates,
  isFieldState,
  type NonDefaultFieldState,
} from "../shared.js"

export const INPUT_CLASS = "lt-input" as const

export const inputTypes = [
  "text",
  "password",
  "email",
  "number",
  "date",
  "datetime-local",
  "week",
  "month",
  "tel",
  "url",
  "search",
  "time",
] as const

export type InputType = (typeof inputTypes)[number]

/** The types that get an icon in the field, and that open the browser's own picker. */
const TYPES_WITH_ICON = ["date", "time", "datetime-local"] as const
export type TypeWithIcon = (typeof TYPES_WITH_ICON)[number]

export type InputOptions = {
  /** The HTML type. Set as `type`, and decides the icon. Default: `text`. */
  type?: InputType
  /** Validation state. Default: `default`. */
  state?: FieldState
}

export type InputAttributes = {
  class: typeof INPUT_CLASS
  type: InputType
  "data-variant"?: TypeWithIcon
  "data-state"?: NonDefaultFieldState
  "aria-invalid"?: "true"
}

/**
 * The attributes for a text field.
 *
 * `type` sets both the HTML type and the icon variant, so the two cannot get
 * out of step. Write them by hand, and it is easy to get a date field that
 * looks like a date field, but where nothing happens when the user presses
 * the icon.
 *
 * ```ts
 * <input {...input({ type: "date", state: "invalid" })} />
 * ```
 */
export const input = Object.assign(
  ({ type = "text", state = "default" }: InputOptions = {}): InputAttributes =>
    attributes({
      class: INPUT_CLASS,
      type,
      "data-variant": (TYPES_WITH_ICON as readonly string[]).includes(type)
        ? (type as TypeWithIcon)
        : undefined,
      "data-state": state === "default" ? undefined : state,
      "aria-invalid": state === "invalid" ? ("true" as const) : undefined,
    }),
  {
    types: inputTypes,
    isType: createGuard(inputTypes),
    states: fieldStates,
    isState: isFieldState,
  },
)
