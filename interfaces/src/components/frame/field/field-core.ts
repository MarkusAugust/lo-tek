import type { FieldState, RequiredMarker } from "../../css/shared.js"
import { attributes, createFieldId, idOrFallback } from "../../css/shared.js"

// Re-exported here, where it used to live, so consumers that import from
// `./field-core` do not notice the move.
export { createFieldId }

/**
 * Computes the wiring between label, field, help text and error text.
 *
 * This is the one implementation of the accessibility contract in the system.
 * `<lt-field>` applies it to elements already in the DOM, and `lt.field()`
 * returns the same result as data, for whoever writes the markup with
 * JavaScript. Without sharing it, the contract would exist in two places and
 * could drift apart.
 */

export type FieldOptions = {
  /**
   * The id of the control. Required. Make it from a key in the data, never
   * from the loop index or a counter, so it is unique on the page and the
   * same on every render.
   *
   * In React it comes from `useId()`. Otherwise the field's name is usually
   * the obvious choice, and in a loop the name with the row's key. If you know for certain that the markup is rendered
   * once, call `createFieldId()` yourself.
   *
   * It used to be optional, and the function created one when it was
   * missing. That id is random, so two runs give two different ones, and if
   * the same field is rendered on a server and then in the browser, `for`
   * and `aria-describedby` point to something other than what is there.
   * React reports a mismatch on hydration, and the warning itself says the
   * mismatch is not repaired.
   *
   * The type requires it, and that is not enough on its own: a consumer
   * without TypeScript sees no type. If the id is left out anyway, the
   * function creates one and says so in the console. The field then works,
   * and the developer learns why the id should be given anyway. Without the
   * fallback they got `for=""`, `aria-describedby="undefined-help"` and no
   * wiring at all, which is worse than the unstable id the requirement was
   * meant to remove.
   */
  id: string
  /** The field has a help text to connect with `aria-describedby`. */
  help?: boolean
  /** The field has an error text. It is hidden until the field is invalid. */
  error?: boolean
  /** A separate id for the help text. Derived from `id` if left out. */
  helpId?: string
  /** A separate id for the error text. Derived from `id` if left out. */
  errorId?: string
  /** Marks the label as required. */
  required?: RequiredMarker
  /** Marks the label as optional. */
  optional?: boolean
  /** The field is invalid: shows the error text and sets `aria-invalid`. */
  invalid?: boolean
  /** The control is disabled. */
  disabled?: boolean
  /** Extra ids to include in `aria-describedby`. */
  describedBy?: string[]
}

export type FieldAttributes = {
  label: {
    class: "lt-label"
    for: string
    "data-required"?: RequiredMarker
    "data-optional"?: ""
    "aria-disabled"?: "true"
  }
  control: {
    id: string
    "aria-describedby"?: string
    "aria-invalid"?: "true"
    "data-state"?: "invalid"
    disabled?: true
  }
  help: { id: string }
  error: { id: string; hidden?: true }
  /** The state the control should have, for `input()`, `textarea()` and `select()`. */
  state: FieldState
}

/**
 * Joins `aria-describedby` from the help text, the error text and whatever
 * the caller added.
 *
 * The error text is only included when the field is actually invalid.
 * Otherwise `aria-describedby` would point to a hidden element, and screen
 * readers then announce either nothing or something that is not on the
 * screen.
 */
export function joinDescribedBy(
  ids: Array<string | undefined | false>,
): string | undefined {
  const unique = new Set<string>()
  for (const id of ids) {
    if (!id) continue
    for (const part of id.split(/\s+/)) {
      if (part) unique.add(part)
    }
  }
  return unique.size > 0 ? [...unique].join(" ") : undefined
}

export function computeFieldAttributes(options: FieldOptions): FieldAttributes {
  const {
    id: givenId,
    help = false,
    error = false,
    required,
    optional,
    invalid = false,
    disabled = false,
    describedBy = [],
  } = options

  // The fallback is only for callers without a type check. See `idOrFallback`.
  const id = idOrFallback("lt.field()", givenId)
  const helpId = options.helpId ?? `${id}-help`
  const errorId = options.errorId ?? `${id}-error`

  return {
    label: attributes({
      class: "lt-label" as const,
      for: id,
      "data-required": required,
      "data-optional": optional && !required ? ("" as const) : undefined,
      "aria-disabled": disabled ? ("true" as const) : undefined,
    }),
    control: attributes({
      id,
      "aria-describedby": joinDescribedBy([
        help && helpId,
        invalid && error && errorId,
        ...describedBy,
      ]),
      "aria-invalid": invalid ? ("true" as const) : undefined,
      // The colour comes from here, not from input()/textarea()/select().
      // Otherwise both would set aria-invalid, and in templates that write
      // the attributes out literally, such as Astro and plain HTML, it
      // appeared twice.
      "data-state": invalid ? ("invalid" as const) : undefined,
      disabled: disabled ? (true as const) : undefined,
    }),
    help: attributes({ id: helpId }),
    error: attributes({
      id: errorId,
      hidden: invalid ? undefined : (true as const),
    }),
    state: invalid ? "invalid" : "default",
  }
}
