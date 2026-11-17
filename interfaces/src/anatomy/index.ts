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
  AnatomyChild,
  AnatomyChoice,
  AnatomyHole,
  AnatomyNode,
  Manifest,
} from "../vocabulary/types.js"

/**
 * A value per item: a list, read at the item's place, as the title of each
 * tab. In several groups the lists are nested, the outermost group first,
 * as the cells of a table by row and then by column.
 */
type PerItem<T> = T | readonly PerItem<T>[]

/** What the template fills in. */
export type AnatomyInstance = {
  /** The text of each hole, and the value of each attribute hole, by name. */
  holes?: Record<string, PerItem<string>>
  /** Markup for a hole that takes other elements, by name. Written as it is. */
  content?: Record<string, PerItem<string>>
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
  /** The alternative each choice takes, by its name. Left out, the first. */
  choices?: Record<string, PerItem<string>>
  /**
   * Options for the builder functions a named node or choice is the first
   * to call, as the direction of a sorted column.
   */
  settings?: Record<string, PerItem<Record<string, unknown>>>
  /** Options for the builder function beyond the required ones, as `open`. */
  options?: Record<string, unknown>
}

type Answer = Record<string, unknown>
type BuilderFunction = (options?: Record<string, unknown>) => unknown

/**
 * Where a node is written: the item it is in, in each group around it,
 * outermost first, the answers of the builder functions called above it,
 * and the name its settings are read under.
 */
type Place = {
  groups: readonly string[]
  index: Readonly<Record<string, number>>
  answers: ReadonlyMap<string, Answer>
  named?: string
}

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

const isHole = (child: AnatomyChild): child is AnatomyHole => "hole" in child
const isChoice = (child: AnatomyChild): child is AnatomyChoice =>
  "oneOf" in child

/** Calls a builder function in `lt` by name. */
function call(name: string, options?: Record<string, unknown>): Answer {
  const build = (lt as unknown as Record<string, BuilderFunction>)[name]
  if (typeof build !== "function")
    throw new Error(`renderAnatomy: lt has no builder function ${name}.`)
  return build(options) as Answer
}

/** A value that is one per item, read at the place: by group, outermost first. */
function at<T>(value: PerItem<T> | undefined, place: Place): T | undefined {
  let found: unknown = value
  for (const group of place.groups) {
    if (!Array.isArray(found)) break
    found = found[place.index[group] ?? 0]
  }
  return found as T | undefined
}

class Writer {
  private own: Answer

  constructor(
    private builder: string,
    private anatomy: Anatomy,
    private instance: AnatomyInstance,
  ) {
    const required = Object.fromEntries(
      Object.entries(anatomy.options ?? {}).map(([option, from]) => [
        option,
        "repeat" in from ? this.keys(from.repeat) : instance.holes?.[from.hole],
      ]),
    )
    this.own = call(builder, { ...instance.options, ...required })
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

  start(child: AnatomyChild): string {
    return this.write(child, {
      groups: [],
      index: {},
      answers: new Map([[this.builder, this.own]]),
    })
  }

  /** Each item in a group, with the place it is written at. */
  private items(group: string, place: Place): Place[] {
    return this.keys(group).map((_, i) => ({
      ...place,
      groups: [...place.groups, group],
      index: { ...place.index, [group]: i },
    }))
  }

  private write(child: AnatomyChild, place: Place): string {
    if (isHole(child))
      return (
        at(this.instance.content?.[child.hole], place) ??
        escapeText(at(this.instance.holes?.[child.hole], place) ?? "")
      )
    const repeat = "repeat" in child ? child.repeat : undefined
    if (repeat && place.index[repeat] === undefined)
      return this.items(repeat, place)
        .map((item) => this.write(child, item))
        .join("")
    if (isChoice(child)) {
      const names = Object.keys(child.oneOf)
      const chosen = at(this.instance.choices?.[child.name], place) ?? names[0]
      const node = child.oneOf[chosen]
      if (!node)
        throw new Error(
          `renderAnatomy: ${child.name} has no alternative ${chosen}, only ${names.join(", ")}.`,
        )
      return this.write(node, { ...place, named: child.name })
    }
    return this.element(child, place)
  }

  private element(node: AnatomyNode, place: Place): string {
    const name = node.name ?? place.named
    const inside: Place = { ...place, named: undefined }
    const inner = () =>
      (node.children ?? []).map((c) => this.write(c, inside)).join("")
    if (node.optional || node.wrapper) {
      const there =
        (node.name && this.instance.parts?.[node.name]) ?? node.created === true
      if (!there) return node.wrapper ? inner() : ""
    }
    // The builder functions this node is the first to call, with the
    // options the anatomy fixes and the ones the designer chose. The nodes
    // inside use the same answer.
    const answers = new Map(place.answers)
    const settings =
      name === undefined ? undefined : at(this.instance.settings?.[name], place)
    for (const source of node.from ?? []) {
      const builder = source.split(".")[0]
      if (!answers.has(builder))
        answers.set(
          builder,
          call(builder, { ...node.options?.[builder], ...settings }),
        )
    }
    inside.answers = answers
    const attributes: Record<string, string> = {}
    for (const source of node.from ?? [])
      for (const [attribute, value] of Object.entries(
        this.attributesOf(source, answers, place),
      )) {
        if (value === undefined || value === false) continue
        const text = value === true ? "" : String(value)
        attributes[attribute] =
          attribute === "class" && attributes.class
            ? `${attributes.class} ${text}`
            : text
      }
    for (const [attribute, value] of Object.entries(node.attributes ?? {}))
      attributes[attribute] =
        typeof value === "string"
          ? value
          : (at(this.instance.holes?.[value.hole], place) ?? "")
    const written = Object.entries(attributes)
      .map(([attribute, value]) =>
        value === ""
          ? ` ${attribute}`
          : ` ${attribute}="${escapeAttribute(value)}"`,
      )
      .join("")
    const tag = typeof node.tag === "string" ? node.tag : node.tag[0]
    if (VOID.has(tag)) return `<${tag}${written}>`
    return `<${tag}${written}>${inner()}</${tag}>`
  }

  /**
   * The attributes one source gives: the whole answer of a builder
   * function, a set in it, the item's own when the set is a list, or a
   * class the function carries, as `checkbox.row`.
   */
  private attributesOf(
    source: string,
    answers: ReadonlyMap<string, Answer>,
    place: Place,
  ): Answer {
    const [name, field] = source.split(".")
    const answer = answers.get(name) as Answer
    if (field === undefined) return answer
    if (field in answer)
      return at<Answer>(answer[field] as PerItem<Answer>, place) ?? {}
    const constant = (lt as unknown as Record<string, Record<string, unknown>>)[
      name
    ][field]
    if (typeof constant === "string") return { class: constant }
    throw new Error(`renderAnatomy: ${source} is neither a set nor a class.`)
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
  return anatomy.nodes.map((n) => writer.start(n)).join("")
}
