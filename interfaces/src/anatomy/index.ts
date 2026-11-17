/**
 * Writes the markup a builder function belongs in, from its anatomy in the
 * manifest.
 *
 * The anatomy says which elements there are and where each one's attributes
 * come from; the attributes themselves come from calling the builder
 * functions, so the markup is the same as a template that calls them. This
 * is the reference: a design tool, or a server in another language, must
 * write the same, and `check-anatomy.ts` holds it to the component pages.
 */

import { lt } from "../lt.js"
import type { AnatomyHole, AnatomyNode, Manifest } from "../vocabulary/types.js"

/** What the template fills in: the value of each hole, by name. */
export type AnatomyInstance = {
  holes?: Record<string, string>
}

type Answer = Record<string, unknown>
type BuilderFunction = (options?: Record<string, unknown>) => unknown

const escapeText = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;")
const escapeAttribute = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/"/g, "&quot;")

/** The elements HTML writes without an end tag. */
const VOID = new Set([
  "area",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
])

const isHole = (child: AnatomyNode | AnatomyHole): child is AnatomyHole =>
  "hole" in child

/** Calls a builder function in `lt` by name. */
function call(name: string): Answer {
  const build = (lt as unknown as Record<string, BuilderFunction>)[name]
  if (typeof build !== "function")
    throw new Error(`renderAnatomy: lt has no builder function ${name}.`)
  return build() as Answer
}

/**
 * The attributes one source gives: the whole answer of a builder function,
 * a set in it, or a class the function carries, as `checkbox.row`.
 */
function attributesOf(source: string): Answer {
  const [name, field] = source.split(".")
  const answer = call(name)
  if (field === undefined) return answer
  if (field in answer) return answer[field] as Answer
  const constant = (lt as unknown as Record<string, Record<string, unknown>>)[
    name
  ][field]
  if (typeof constant === "string") return { class: constant }
  throw new Error(`renderAnatomy: ${source} is neither a set nor a class.`)
}

function write(
  child: AnatomyNode | AnatomyHole,
  instance: AnatomyInstance,
): string {
  if (isHole(child)) return escapeText(instance.holes?.[child.hole] ?? "")
  const attributes: Record<string, string> = {}
  for (const source of child.from ?? [])
    for (const [name, value] of Object.entries(attributesOf(source))) {
      if (value === undefined || value === false) continue
      const text = value === true ? "" : String(value)
      attributes[name] =
        name === "class" && attributes.class
          ? `${attributes.class} ${text}`
          : text
    }
  for (const [name, value] of Object.entries(child.attributes ?? {}))
    attributes[name] =
      typeof value === "string" ? value : (instance.holes?.[value.hole] ?? "")
  const written = Object.entries(attributes)
    .map(([name, value]) =>
      value === "" ? ` ${name}` : ` ${name}="${escapeAttribute(value)}"`,
    )
    .join("")
  if (VOID.has(child.tag)) return `<${child.tag}${written}>`
  const inner = (child.children ?? []).map((c) => write(c, instance)).join("")
  return `<${child.tag}${written}>${inner}</${child.tag}>`
}

/**
 * The markup for the builder function `name`, with the holes filled from
 * `instance`. Throws when the builder function has no anatomy.
 */
export function renderAnatomy(
  manifest: Manifest,
  name: string,
  instance: AnatomyInstance = {},
): string {
  const anatomy = manifest.builders.find((b) => b.name === name)?.anatomy
  if (!anatomy)
    throw new Error(`renderAnatomy: lt.${name} has no anatomy in the manifest.`)
  return anatomy.nodes.map((n) => write(n, instance)).join("")
}
