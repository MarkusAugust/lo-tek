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
import type {
  Anatomy,
  AnatomyHole,
  AnatomyNode,
  Manifest,
} from "../vocabulary/types.js"

/**
 * A value per item in a group: a list, read at the item's place, as the
 * title of each tab.
 */
type PerItem = string | readonly string[]

/** What the template fills in. */
export type AnatomyInstance = {
  /** The text of each hole, and the value of each attribute hole, by name. */
  holes?: Record<string, PerItem>
  /** Markup for a hole that takes other elements, by name. Written as it is. */
  content?: Record<string, PerItem>
  /**
   * Whether each optional node is there, by its name. Left out, a node is
   * there when the anatomy says it is `created`.
   */
  parts?: Record<string, boolean>
  /**
   * The items in each group: how many, or their keys, as the tabs take
   * keys from the data. Left out, a group has its `min`.
   */
  repeats?: Record<string, number | readonly string[]>
  /** Options for the builder function beyond the required ones, as `open`. */
  options?: Record<string, unknown>
}

/** Where a node is written: the item in each group around it, the innermost last. */
type Place = { index: Record<string, number>; group?: string }

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
function call(name: string, options?: Record<string, unknown>): Answer {
  const build = (lt as unknown as Record<string, BuilderFunction>)[name]
  if (typeof build !== "function")
    throw new Error(`renderAnatomy: lt has no builder function ${name}.`)
  return build(options) as Answer
}

class Writer {
  /** The answers of the builder functions, the anatomy's own first. */
  private answers = new Map<string, Answer>()

  constructor(
    builder: string,
    private anatomy: Anatomy,
    private instance: AnatomyInstance,
  ) {
    const required = Object.fromEntries(
      Object.entries(anatomy.options ?? {}).map(([option, from]) => [
        option,
        "repeat" in from ? this.keys(from.repeat) : instance.holes?.[from.hole],
      ]),
    )
    this.answers.set(
      builder,
      call(builder, { ...instance.options, ...required }),
    )
  }

  /** The keys of the items in a group, made up when the instance gives a count. */
  private keys(group: string): string[] {
    const given = this.instance.repeats?.[group]
    if (Array.isArray(given)) return [...given]
    const count =
      typeof given === "number"
        ? given
        : (this.anatomy.repeats?.[group]?.min ?? 1)
    return Array.from({ length: count }, (_, i) => `${group}-${i + 1}`)
  }

  /** A value that is one per item is read at the item's place. */
  private at<T>(value: T | readonly T[] | undefined, place: Place) {
    if (!Array.isArray(value)) return value as T | undefined
    return value[place.group ? (place.index[place.group] ?? 0) : 0] as T
  }

  /**
   * The attributes one source gives: the whole answer of a builder
   * function, a set in it, or a class the function carries, as
   * `checkbox.row`.
   */
  private attributesOf(source: string, place: Place): Answer {
    const [name, field] = source.split(".")
    let answer = this.answers.get(name)
    if (!answer) {
      answer = call(name)
      this.answers.set(name, answer)
    }
    if (field === undefined) return answer
    if (field in answer)
      return this.at<Answer>(answer[field] as Answer | Answer[], place) ?? {}
    const constant = (lt as unknown as Record<string, Record<string, unknown>>)[
      name
    ][field]
    if (typeof constant === "string") return { class: constant }
    throw new Error(`renderAnatomy: ${source} is neither a set nor a class.`)
  }

  write(child: AnatomyNode | AnatomyHole, place: Place): string {
    if (isHole(child))
      return (
        this.at(this.instance.content?.[child.hole], place) ??
        escapeText(this.at(this.instance.holes?.[child.hole], place) ?? "")
      )
    if (child.repeat && place.index[child.repeat] === undefined)
      return this.keys(child.repeat)
        .map((_, i) =>
          this.write(child, {
            index: { ...place.index, [child.repeat as string]: i },
            group: child.repeat,
          }),
        )
        .join("")
    const inner = () =>
      (child.children ?? []).map((c) => this.write(c, place)).join("")
    if (child.optional || child.wrapper) {
      const there =
        (child.name && this.instance.parts?.[child.name]) ??
        child.created === true
      if (!there) return child.wrapper ? inner() : ""
    }
    const attributes: Record<string, string> = {}
    for (const source of child.from ?? [])
      for (const [name, value] of Object.entries(
        this.attributesOf(source, place),
      )) {
        if (value === undefined || value === false) continue
        const text = value === true ? "" : String(value)
        attributes[name] =
          name === "class" && attributes.class
            ? `${attributes.class} ${text}`
            : text
      }
    for (const [name, value] of Object.entries(child.attributes ?? {}))
      attributes[name] =
        typeof value === "string"
          ? value
          : (this.at(this.instance.holes?.[value.hole], place) ?? "")
    const written = Object.entries(attributes)
      .map(([name, value]) =>
        value === "" ? ` ${name}` : ` ${name}="${escapeAttribute(value)}"`,
      )
      .join("")
    const tag = typeof child.tag === "string" ? child.tag : child.tag[0]
    if (VOID.has(tag)) return `<${tag}${written}>`
    return `<${tag}${written}>${inner()}</${tag}>`
  }
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
  const writer = new Writer(name, anatomy, instance)
  return anatomy.nodes.map((n) => writer.write(n, { index: {} })).join("")
}
