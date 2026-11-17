import { classes } from "../vocabulary/classes"

/**
 * Turns an attribute set from an `lt` builder function into HTML.
 *
 * The tests should write the markup the way a server would, with the
 * builder function, not write the attributes by hand. If they do the latter,
 * the markup in the test can say something other than what the builder
 * function actually outputs, and then we are not testing what the consumer
 * gets.
 */
export function attr(values: Record<string, unknown>): string {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== false)
    .map(([name, value]) =>
      value === true
        ? name
        : `${name}="${String(value).replace(/"/g, "&quot;")}"`,
    )
    .join(" ")
}

/**
 * The name the wiring points at: the text of what `aria-labelledby` refers
 * to (an element's own `aria-label` before its text), otherwise
 * `aria-label`, otherwise a link's text. It reads what the components wrote,
 * and is not the accessible name a screen reader is given: that is read from
 * the browser's accessibility tree through AT-SPI by
 * `scripts/check-accessibility-tree.ts`, against the contracts.
 */
export function wiredName(element: Element): string {
  const text = (e: Element | null) =>
    (e?.textContent ?? "").replace(/\s+/g, " ").trim()
  const referenced = (e: Element | null) =>
    e?.getAttribute("aria-label")?.trim() || text(e)
  const labelledBy = element.getAttribute("aria-labelledby")
  if (labelledBy !== null) {
    const root = element.getRootNode() as Document | ShadowRoot
    return labelledBy
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => referenced(root.getElementById(id)))
      .join(" ")
      .trim()
  }
  const label = element.getAttribute("aria-label")
  if (label !== null) return label.trim()
  return element.localName === "a" ? text(element) : ""
}

/**
 * Whether an element the component wrote is on one of the tags the manifest
 * gives its class, read from `classes.ts`. For the classes no page shows,
 * since the component writes them itself: the component is then the witness
 * that `tags` is right. A class without `tags` is never on one.
 */
export function onItsTags(element: Element, className: string): boolean {
  return (classes[className]?.tags ?? []).some(
    (t) =>
      (t.tag === "*" || element.localName === t.tag) &&
      Object.entries(t.attributes ?? {}).every(([name, values]) =>
        values.includes(element.getAttribute(name) ?? ""),
      ) &&
      (t.requires ?? []).every((name) => element.hasAttribute(name)),
  )
}
