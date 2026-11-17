/**
 * Writes the markup a builder function belongs in, from its anatomy in the
 * manifest.
 *
 * The anatomy says which elements there are and where each one's attributes
 * come from; the attributes themselves come from calling the builder
 * functions, so the markup is the same as a template that calls them. This
 * is the reference: a design tool, or a server in another language, must
 * write the same, and `check-anatomy.ts` holds it to the component pages.
 * The rules it follows are written on the types in `vocabulary/types.ts`;
 * what is only here is said here.
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
 * A value per item, keyed by the item's key, one level for each group, as
 * the title of each tab, `{ claim: "Claim" }`, or a cell by row and column.
 * Keyed, not by position, so an item inserted first moves nothing.
 */
export type Keyed<T> = T | { readonly [key: string]: Keyed<T> }

/** One component in the designer's document. */
export type AnatomyInstance = {
  /**
   * The component's id in the document. The id holes it leaves empty are
   * made from it, so the same component has the same ids on every render.
   */
  id: string
  /** The options of the builder function the panel shows. */
  options?: Record<string, unknown>
  /** The keys of the items in each group, in order. Left out, `min` items. */
  repeats?: Record<string, readonly string[]>
  /** The text of the text holes and the value of the attribute holes. */
  holes?: Record<string, Keyed<string | boolean>>
  /** Markup for the holes that take other elements, written as it is. */
  content?: Record<string, Keyed<string>>
  /** The alternative each choice takes. Left out, the first. */
  choices?: Record<string, Keyed<string>>
  /** What the designer set on a node, by its name, keyed per item when it repeats. */
  settings?: Record<string, Keyed<Record<string, unknown>>>
  /** Whether each optional node is there. Left out, when it is `created`. */
  parts?: Record<string, boolean>
  /** The tag a node with several takes, by the node's name. */
  tags?: Record<string, string>
  /**
   * Attributes for every element, from its address: the path of child
   * indexes from the root, with `[key]` after a repeated node and
   * `:alternative` after a choice, as `0/1[claim]/0`. It stays the same
   * across renders while the anatomy does.
   */
  annotate?: (address: string) => Record<string, string>
}

type Answer = Record<string, unknown>
type BuilderFunction = (options?: Record<string, unknown>) => unknown

/** Text: `&` and `<`. Attributes: `&` and `"`. Content is written as it is. */
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

/** Where a node is written. */
type Place = {
  address: string
  /** The key of the item in each group around the node. */
  keys: Readonly<Record<string, string>>
  /** The innermost group around the node. */
  group?: string
  answers: ReadonlyMap<string, Answer>
  /** The choice the node is an alternative of. */
  choice?: AnatomyChoice
}

class Writer {
  private options: Record<string, unknown>

  constructor(
    private manifest: Manifest,
    private builder: string,
    private anatomy: Anatomy,
    private instance: AnatomyInstance,
  ) {
    for (const [group, { min }] of Object.entries(anatomy.repeats ?? {}))
      if (this.keys(group).length < min)
        throw new Error(
          `renderAnatomy: ${builder} needs at least ${min} items in ${group}.`,
        )
    const bound: Record<string, unknown> = {}
    for (const [option, from] of Object.entries(anatomy.options ?? {})) {
      if ("hole" in from) bound[option] = this.attribute(from.hole, {})
      else if ("repeat" in from) bound[option] = this.keys(from.repeat)
      else if ("count" in from) bound[option] = this.keys(from.count).length
      else if ("choice" in from)
        bound[option] =
          (instance.choices?.[from.choice] ??
            this.firstAlternative(from.choice)) === from.alternative
    }
    this.options = { ...instance.options, ...bound }
  }

  /** The first alternative of the named choice, the one a tool creates. */
  private firstAlternative(name: string): string | undefined {
    const walk = (children: readonly AnatomyChild[]): string | undefined => {
      for (const child of children) {
        if (isHole(child)) continue
        if (isChoice(child) && child.name === name)
          return Object.keys(child.oneOf)[0]
        const nodes = isChoice(child) ? Object.values(child.oneOf) : [child]
        for (const node of nodes) {
          const found = walk(node.children ?? [])
          if (found) return found
        }
      }
      return undefined
    }
    return walk(this.anatomy.nodes)
  }

  /** The keys of the items in a group: the instance's, or `min` made up. */
  private keys(group: string): readonly string[] {
    const given = this.instance.repeats?.[group]
    if (given) return given
    const min = this.anatomy.repeats?.[group]?.min ?? 1
    return Array.from({ length: min }, (_, i) => `${group}-${i + 1}`)
  }

  /** A keyed value, read with the keys of the given groups, outermost first. */
  private read<T>(
    value: Keyed<T> | undefined,
    groups: readonly string[],
    keys: Readonly<Record<string, string>>,
  ): T | undefined {
    let found: unknown = value
    for (const group of groups) {
      if (found === null || typeof found !== "object") break
      if (keys[group] === undefined)
        throw new Error(
          `renderAnatomy: ${this.builder} reads a value per ${group} outside ${group}.`,
        )
      found = (found as Record<string, unknown>)[keys[group]]
    }
    return found as T | undefined
  }

  private declared(hole: string) {
    const declaration = this.anatomy.holes[hole]
    if (!declaration)
      throw new Error(
        `renderAnatomy: ${this.builder} uses the hole ${hole}, which it does not declare.`,
      )
    return declaration
  }

  /** The value of an attribute hole; an empty id hole gets one from the instance id. */
  private attribute(
    hole: string,
    keys: Readonly<Record<string, string>>,
  ): string | boolean | undefined {
    const declaration = this.declared(hole)
    const per = declaration.per ?? []
    const given = this.read(this.instance.holes?.[hole], per, keys)
    // An empty id is no id; an empty value is a value, as value="".
    if (given !== undefined && !(given === "" && declaration.kind === "id"))
      return given
    if (declaration.kind === "id")
      return [this.instance.id, hole, ...per.map((g) => keys[g])].join("-")
    return undefined
  }

  start(child: AnatomyChild): string {
    return this.write(child, {
      address: "0",
      keys: {},
      answers: new Map(),
    })
  }

  private write(child: AnatomyChild, place: Place): string {
    if (isHole(child)) {
      const declaration = this.declared(child.hole)
      const per = declaration.per ?? []
      if (declaration.content === "free")
        return (
          this.read(this.instance.content?.[child.hole], per, place.keys) ?? ""
        )
      const text = this.read(this.instance.holes?.[child.hole], per, place.keys)
      return escapeText(text === undefined ? "" : String(text))
    }
    const repeat = child.repeat
    if (repeat && place.keys[repeat] === undefined)
      return this.keys(repeat)
        .map((key) =>
          this.write(child, {
            ...place,
            address: `${place.address}[${key}]`,
            keys: { ...place.keys, [repeat]: key },
            group: repeat,
          }),
        )
        .join("")
    if (isChoice(child)) {
      const names = Object.keys(child.oneOf)
      const groups = child.repeat ? [child.repeat] : []
      const chosen =
        this.read(this.instance.choices?.[child.name], groups, place.keys) ??
        names[0]
      const node = child.oneOf[chosen]
      if (!node)
        throw new Error(
          `renderAnatomy: ${child.name} has no alternative ${chosen}, only ${names.join(", ")}.`,
        )
      return this.element(node, {
        ...place,
        address: `${place.address}:${chosen}`,
        choice: child,
      })
    }
    return this.element(child, place)
  }

  /** Whether an optional node is there. */
  private there(node: AnatomyNode): boolean {
    if (!node.optional && !node.wrapper) return true
    const given = node.name ? this.instance.parts?.[node.name] : undefined
    if (!(given ?? node.created === true)) return false
    if (!node.requires) return true
    const required = this.find(node.requires)
    return required ? this.there(required) : false
  }

  /** The node with the name, anywhere in the anatomy. */
  private find(
    name: string,
    children: readonly AnatomyChild[] = this.anatomy.nodes,
  ): AnatomyNode | undefined {
    for (const child of children) {
      if (isHole(child)) continue
      const nodes = isChoice(child) ? Object.values(child.oneOf) : [child]
      for (const node of nodes) {
        if (node.name === name) return node
        const inner = this.find(name, node.children ?? [])
        if (inner) return inner
      }
    }
    return undefined
  }

  private element(node: AnatomyNode, place: Place): string {
    const children = (inside: Place) =>
      (node.children ?? [])
        .map((c, i) =>
          this.write(c, {
            ...inside,
            address: `${place.address}/${i}`,
            choice: undefined,
          }),
        )
        .join("")
    if (node.when !== undefined && !this.options[node.when]) return ""
    if (!this.there(node)) return node.wrapper ? children(place) : ""

    // The builder functions this node is the first to call. The designer's
    // settings come first, and the anatomy's fixed options win over them.
    const named = node.name ?? place.choice?.name
    const settings =
      named === undefined
        ? undefined
        : this.read(
            this.instance.settings?.[named],
            place.group ? [place.group] : [],
            place.keys,
          )
    const answers = new Map(place.answers)
    for (const source of node.from ?? []) {
      const builder = source.split(".")[0]
      const fixed = node.options?.[builder]
      if (answers.has(builder) && !fixed) continue
      // The anatomy's own builder function, unless the node calls it anew,
      // takes the instance's options and the bound ones.
      if (builder === this.builder && !fixed) {
        answers.set(builder, call(builder, this.options))
        continue
      }
      const options = Object.fromEntries(
        Object.entries(fixed ?? {}).map(([option, value]) => [
          option,
          value !== null && typeof value === "object" && "hole" in value
            ? this.attribute((value as AnatomyHole).hole, place.keys)
            : value,
        ]),
      )
      answers.set(builder, call(builder, { ...settings, ...options }))
    }

    const attributes: Record<string, string | true> = {}
    for (const source of node.from ?? [])
      for (const [attribute, value] of Object.entries(
        this.attributesOf(source, answers, place),
      )) {
        if (value === undefined || value === false) continue
        // A builder function writes a flag as true or as "", which HTML
        // reads the same; both are written bare.
        if (value === true || value === "") {
          attributes[attribute] = true
          continue
        }
        const text = String(value)
        const before = attributes[attribute]
        attributes[attribute] =
          attribute === "class" && typeof before === "string"
            ? `${before} ${text}`
            : text
      }
    for (const [attribute, value] of Object.entries(node.attributes ?? {})) {
      if (typeof value === "string") {
        attributes[attribute] = value
        continue
      }
      const declaration = this.declared(value.hole)
      const given = this.attribute(value.hole, place.keys)
      if (declaration.kind === "flag") {
        if (given === true || given === "true")
          attributes[attribute] = value.value ?? true
        continue
      }
      if (
        declaration.values &&
        given !== undefined &&
        !declaration.values.includes(String(given))
      )
        throw new Error(
          `renderAnatomy: the hole ${value.hole} can be ${declaration.values.join(", ")}, not ${given}.`,
        )
      if (given === undefined || given === false) {
        if (declaration.optional) continue
        throw new Error(
          `renderAnatomy: ${this.builder} needs a value for the hole ${value.hole}.`,
        )
      }
      attributes[attribute] = String(given)
    }
    Object.assign(attributes, this.instance.annotate?.(place.address))

    const written = Object.entries(attributes)
      .map(([attribute, value]) =>
        value === true
          ? ` ${attribute}`
          : ` ${attribute}="${escapeAttribute(value)}"`,
      )
      .join("")
    const tags = typeof node.tag === "string" ? [node.tag] : node.tag
    const asked = node.name ? this.instance.tags?.[node.name] : undefined
    if (asked !== undefined && !tags.includes(asked))
      throw new Error(
        `renderAnatomy: ${node.name} can be ${tags.join(", ")}, not ${asked}.`,
      )
    const tag = asked ?? tags[0]
    if (VOID.has(tag)) return `<${tag}${written}>`
    return `<${tag}${written}>${children({ ...place, answers })}</${tag}>`
  }

  /**
   * The attributes one source gives: the whole answer of a builder
   * function, a set in it, the item's own when the set is a list, or a
   * class the function carries, read from `classes` in the manifest.
   */
  private attributesOf(
    source: string,
    answers: ReadonlyMap<string, Answer>,
    place: Place,
  ): Answer {
    const [name, field] = source.split(".")
    const answer = answers.get(name) as Answer
    if (field === undefined) return answer
    if (field in answer) {
      const set = answer[field]
      if (!Array.isArray(set)) return (set as Answer | undefined) ?? {}
      // A list from the anatomy's own builder function has one set for each
      // key of the group its keys come from.
      const group = Object.values(this.anatomy.options ?? {}).find(
        (o): o is { repeat: string } => "repeat" in o,
      )?.repeat
      const at = group ? this.keys(group).indexOf(place.keys[group]) : -1
      return (set[at] as Answer | undefined) ?? {}
    }
    const constant = this.manifest.builders.find((b) => b.name === name)
      ?.classes?.[field]
    if (constant) return { class: constant }
    throw new Error(`renderAnatomy: ${source} is neither a set nor a class.`)
  }
}

/**
 * The markup for the builder function `name`, from the instance. Throws
 * when the builder function has no anatomy, or the instance is not one the
 * anatomy allows: too few items, a hole without a value, a tag or an
 * alternative the node does not have.
 */
export function renderAnatomy(
  manifest: Manifest,
  name: string,
  instance: AnatomyInstance,
): string {
  const anatomy = manifest.builders.find((b) => b.name === name)?.anatomy
  if (!anatomy)
    throw new Error(`renderAnatomy: lt.${name} has no anatomy in the manifest.`)
  return new Writer(manifest, name, anatomy, instance).start(anatomy.nodes[0])
}

/**
 * A new component, as a tool creates it on a drop: the fewest items each
 * group may have, keyed `<group>1`, `<group>2` and so on, and every hole
 * filled with the example its declaration gives, for each item it is per.
 * Optional nodes are there when they are `created`, and every choice takes
 * its first alternative. `renderAnatomy()` writes it as correct markup.
 */
export function createdInstance(anatomy: Anatomy, id: string): AnatomyInstance {
  const repeats: Record<string, string[]> = {}
  for (const [group, { min }] of Object.entries(anatomy.repeats ?? {}))
    repeats[group] = Array.from({ length: min }, (_, i) => `${group}${i + 1}`)
  const perItem = (per: readonly string[], value: string): Keyed<string> =>
    per.length === 0
      ? value
      : Object.fromEntries(
          (repeats[per[0]] ?? []).map((key) => [
            key,
            perItem(per.slice(1), value),
          ]),
        )
  const holes: Record<string, Keyed<string>> = {}
  const content: Record<string, Keyed<string>> = {}
  for (const [name, hole] of Object.entries(anatomy.holes)) {
    if (hole.example === undefined) continue
    const value = perItem(hole.per ?? [], hole.example)
    if (hole.content === "free") content[name] = value
    else holes[name] = value
  }
  return { id, repeats, holes, content }
}

/**
 * The instance with an item inserted in a group, at `at` (first when left
 * out), its holes filled with the examples, as a tool inserts a tab or a
 * row. The other items keep their keys, so their ids stay as they were.
 */
export function withItem(
  anatomy: Anatomy,
  instance: AnatomyInstance,
  group: string,
  key: string,
  at = 0,
): AnatomyInstance {
  const keys = [...(instance.repeats?.[group] ?? [])]
  keys.splice(at, 0, key)
  const repeats = { ...instance.repeats, [group]: keys }
  // Sets the example at the new key, and at every key of the groups around it.
  const filled = (
    value: Keyed<string> | undefined,
    per: readonly string[],
    example: string,
  ): Keyed<string> => {
    if (per.length === 0) return value ?? example
    const level = { ...((value as Record<string, Keyed<string>>) ?? {}) }
    for (const k of repeats[per[0]] ?? [])
      if (per[0] !== group || k === key || level[k] !== undefined)
        level[k] = filled(level[k], per.slice(1), example)
    return level
  }
  const holes = { ...instance.holes } as Record<string, Keyed<string>>
  const content = { ...instance.content } as Record<string, Keyed<string>>
  for (const [name, hole] of Object.entries(anatomy.holes)) {
    if (hole.example === undefined || !hole.per?.includes(group)) continue
    const target = hole.content === "free" ? content : holes
    target[name] = filled(target[name], hole.per, hole.example)
  }
  return { ...instance, repeats, holes, content }
}
