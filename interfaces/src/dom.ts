/**
 * Applying the attributes to an element in the plain DOM.
 *
 * In JSX you spread the object straight onto the element. Without JSX you
 * would have to loop through it yourself, and take care to remove attributes
 * from the previous state. When a field goes from invalid to valid, the
 * builder function leaves out `data-state`, and a `setAttribute` alone would
 * have left the old value in place.
 */

import { managedNames } from "./components/css/shared.js"

/**
 * What gets cleaned up for a set without a builder function behind it.
 *
 * A handwritten or spread set is not in the map of what it manages, and then
 * the `data-*` names are the only ones the function can safely remove: they
 * belong to the system. A set straight from a builder function does not use
 * this list. It cleans up exactly what the builder function manages, so
 * `lt.popover().trigger` on a secondary button leaves `data-variant` alone.
 */
const SAFE_FOR_UNKNOWN = [
  "data-variant",
  "data-state",
  "data-color",
  "data-size",
  "data-picker",
  "data-required",
  "data-optional",
  "data-interactive",
  "data-hoverable",
  "data-selectable",
  "data-autofocus",
] as const

/**
 * Names that are never removed, not even when the builder function manages
 * them.
 *
 * `id` and `for` are connections other elements point to. `lt.errorSummary()`
 * takes an optional `id`, and a call without it removed the id the consumer
 * had written on the box: every link and every `aria-*` pointing there broke.
 */
const NEVER_REMOVED: readonly string[] = ["id", "for"]

let warnedAboutUnknownSet = false

/** The classes that belong to the system. The consumer's classes are kept. */
const IS_SYSTEM_CLASS = /^lt-/

/**
 * The values a builder function can output.
 *
 * `true` and `false` are included because several of them are boolean HTML
 * attributes: `disabled` on a switch, `multiple` on a file field, `hidden` on
 * an error text. In HTML such an attribute is true as long as it exists,
 * whatever its value, so `true` is set as the empty string and `false`
 * removes it.
 */
export type Attributes = Record<string, string | boolean | undefined>

/**
 * Sets the attributes from an `lt` function on an element.
 *
 * ```ts
 * import { lt } from "@lo-tek/interfaces"
 *
 * const field = document.querySelector("input")
 * lt.setAttributes(field, lt.input({ type: "email", state: "invalid" }))
 * ```
 *
 * Call it again to change state. What the builder function manages and is
 * not in the new set is removed, and the `lt-` classes are replaced. A
 * builder function manages the attributes it has an option for:
 * `lt.spinner()` has `label`, and so manages `role`, `aria-label` and
 * `aria-hidden`. What it
 * has no option for stays as it is: `lt.button()` has never written
 * `disabled`, so a disabled button is still disabled afterwards. `id` and
 * `for` are never removed.
 *
 * When two sets go on the same element, pass them separately, not spread
 * together:
 *
 * ```ts
 * lt.setAttributes(field, lt.input({ type: "email" }), wiring.control)
 * ```
 *
 * A spread object is a new object, and then the function does not know which
 * builder function it came from. It is set correctly, but only `data-*` is
 * cleaned up. An explicit `false` in a handwritten set removes the attribute.
 *
 * It accepts `null`, and then does nothing. `document.querySelector()`
 * returns `Element | null`, so without that every call site in a `strict` app
 * would need a guard or an exclamation mark around a lookup that almost
 * always succeeds. It is the same trade-off as `element?.classList`.
 */
export function setAttributes(
  element: Element | null | undefined,
  ...sets: Attributes[]
): void {
  if (!element || sets.length === 0) return

  const merged: Attributes = {}
  const removable = new Set<string>()
  const classes: string[] = []

  for (const set of sets) {
    const names = managedNames(set)
    if (names) {
      for (const name of names) removable.add(name)
    } else {
      for (const name of SAFE_FOR_UNKNOWN) removable.add(name)
      warnAboutUnknownSet(set)
    }
    for (const [name, value] of Object.entries(set)) {
      if (name === "class") {
        if (typeof value === "string") classes.push(...value.split(/\s+/))
      } else if (value === false) {
        // An explicit `false` in a handwritten set is a request.
        merged[name] = false
        removable.add(name)
      } else if (value !== undefined) {
        // `undefined` does not override an earlier set: the builder functions
        // drop such keys themselves, and a handwritten set must not be able to
        // take `aria-invalid` from `lt.input()` by naming it without a value.
        merged[name] = value
      }
    }
  }
  for (const name of NEVER_REMOVED) removable.delete(name)

  if (classes.length > 0) {
    const ownClasses = [...element.classList].filter(
      (token) => !IS_SYSTEM_CLASS.test(token),
    )
    // `setAttribute` and not `className`: on an `<svg>`, `className` is a
    // read-only `SVGAnimatedString`, and `lt.icon()` belongs on an svg.
    element.setAttribute(
      "class",
      [...new Set([...classes, ...ownClasses])].filter(Boolean).join(" "),
    )
  }

  for (const name of removable) {
    if (name === "class") continue
    setOrRemove(element, name, merged[name])
  }

  for (const [name, value] of Object.entries(merged)) {
    if (removable.has(name)) continue
    if (value === undefined || value === false) continue
    element.setAttribute(name, value === true ? "" : value)
  }
}

/**
 * Warns, once, about a set that looks like two spread together.
 *
 * `{ ...lt.input(), ...field.control }` is set correctly, but is a new object
 * without a builder function behind it. The next call then does not remove
 * `aria-invalid` when the field becomes valid, and nothing else would have
 * said so.
 */
function warnAboutUnknownSet(set: Attributes): void {
  if (warnedAboutUnknownSet) return
  if (typeof set.class !== "string" || !/(^|\s)lt-/.test(set.class)) return
  warnedAboutUnknownSet = true
  console.warn(
    "lt.setAttributes(): the set does not come straight from a builder " +
      "function, so only the data attributes are cleaned up. Pass the sets " +
      "separately instead of spreading them: " +
      "lt.setAttributes(element, lt.input(), field.control).",
  )
}

function setOrRemove(
  element: Element,
  name: string,
  value: string | boolean | undefined,
): void {
  if (value === undefined || value === false) {
    element.removeAttribute(name)
  } else {
    element.setAttribute(name, value === true ? "" : value)
  }
}
