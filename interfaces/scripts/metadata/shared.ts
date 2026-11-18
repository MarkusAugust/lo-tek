/**
 * What a file in this folder says about a component, and the words it says
 * it with.
 *
 * Each component has one file here, by the name of its folder in
 * `src/components/`, with everything the generators know about it that the
 * source does not say: one sentence per attribute and per allowed value of
 * its element, its parts, its classes, and the markup its builder functions
 * belong in. `metadata.ts` puts the files together into the tables the
 * generators read.
 *
 * The text is written by hand, but TypeScript keeps it in step with the
 * components: each element writes its attributes as a `Record` over
 * `observedAttributes`, so an attribute added to a component without a
 * sentence here, or a sentence about an attribute that is gone, stops the
 * type check.
 */

import type {
  Anatomy,
  DefaultText,
  Name,
  Tag,
} from "../../src/vocabulary/types.js"

/** An allowed value, with what it means. */
export type ValueDoc = { name: string; description: string }

/**
 * What an attribute takes.
 *
 * `flag` is a boolean HTML attribute: it is either there or not. The other
 * three have a value, and `values` is a closed list the editor can suggest from.
 */
export type AttributeValue =
  | "flag"
  | "text"
  | "number"
  | { values: readonly ValueDoc[] }

export type AttributeDoc = { description: string; value: AttributeValue }

/** The type of one field in `detail`. */
export type DetailType = "boolean" | "string" | "number"

/**
 * An event the element dispatches, such as `dialog-toggle`. All of them bubble
 * and cross shadow boundaries (`bubbles: true, composed: true`). `detail` is
 * the fields in `event.detail`, or nothing when the event has none.
 */
export type EventDoc = {
  description: string
  detail?: Record<string, DetailType>
}

/**
 * What a part takes as content. `text` is text and phrasing content without
 * interactive elements, `free` is any content, `parts` is only the other
 * parts, and `none` is nothing you write yourself: a control, or an element
 * the component fills.
 */
export type PartContent = "text" | "free" | "parts" | "none"

/**
 * A part of the element, such as the control in `<lt-field>`. `selector` is
 * the one the component itself finds the part with, relative to the element.
 */
export type PartDoc = {
  selector: string
  description: string
  content: PartContent
  /** The part can appear more than once, like the tabs. Otherwise the first one counts. */
  multiple?: true
  /**
   * A second part of the same kind is an error, not ordinary content: a field
   * with two controls wires only the first. Without this flag the rest can be
   * content, like the buttons in the panel of `<lt-popover>`. `lotek check`
   * reports a part with `unique` that appears more than once.
   */
  unique?: true
  /** The element works without the part. */
  optional?: true
  /**
   * The part needs an id the server writes, because an update from the server
   * would otherwise replace it: the component never writes an id on what the
   * user touches. `lotek check` reports the part when the id is missing, and
   * for a control when the label neither has `for` pointing at it nor wraps it.
   */
  stableId?: true
  /** LO-TEK demands a name for the part. See `Name`. */
  name?: Name
}

/**
 * The parts of an element, with one description per selector the component
 * exports, no more and no fewer.
 */
export function parts<P extends Record<string, string>>(
  selectors: P,
  docs: Record<keyof P, Omit<PartDoc, "selector">>,
): Record<string, PartDoc> {
  return Object.fromEntries(
    Object.entries(docs).map(([name, doc]) => [
      name,
      { selector: selectors[name], ...(doc as Omit<PartDoc, "selector">) },
    ]),
  )
}

export type ElementDoc = {
  tag: string
  /** The last segment of the component page's URL, such as `popover`. */
  slug: string
  description: string
  attributes: Record<string, AttributeDoc>
  events: Record<string, EventDoc>
  /** Empty for the elements that create all their content themselves. */
  parts: Record<string, PartDoc>
  /** LO-TEK demands a name for the element itself. */
  name?: Name
  /** The texts the element writes itself, from `TEXT_PLACES`. */
  texts?: Record<string, DefaultText>
  /**
   * Attributes removed from the element, with what applies instead.
   * `lotek check` reports them with the message, so a template from an older
   * version is told what to write.
   */
  removed?: Record<string, string>
}

/** A component's class, as the generator sees it. */
type Component = { observedAttributes: readonly string[] }

/** One sentence per attribute the component observes, no more and no fewer. */
type Attributes<T extends Component> = Record<
  T["observedAttributes"][number],
  AttributeDoc
>

/** A form control's name: the key the server reads its value by. */
export const nameHole = {
  description: "The name the form sends the value under.",
  kind: "name",
  example: "answer",
} as const

/** Where a set from a builder function goes: a part of a frame component. */
export type BuilderPart = { element: string; part: string }

export const flag = (description: string): AttributeDoc => ({
  description,
  value: "flag",
})

export const text = (description: string): AttributeDoc => ({
  description,
  value: "text",
})

export const number = (description: string): AttributeDoc => ({
  description,
  value: "number",
})

/**
 * What each class takes as content, and the parts it consists of.
 *
 * The elements say what the web components look for. The classes said
 * nothing: the manifest did not know that `lt-button` takes text, that
 * `lt-list` consists of `<li>`, or that `lt-table` has `<thead>` and `<tbody>`
 * with an `lt-table__sort` in a `<th>`. A tool that assembles markup from the
 * classes had to keep that in a list of its own.
 *
 * `content` uses the same vocabulary as the parts. `parts` is on the classes
 * with a fixed structure, and the selectors are relative to the element with
 * the class, as for the elements. A class that is only a part of another
 * component's markup, such as `lt-card__title` and `lt-table__sort`, points to
 * its parent with `partOf` instead of having parts of its own, and the parent
 * has a part that matches it.
 *
 * The classes are kept in step with the package by `generate-vocabulary.ts`,
 * which stops on a class in the CSS that no component's file has and on an
 * entry without a class, and by `check-vocabulary.ts`, which requires every
 * selector to match the markup on the component page, and `partOf` to point
 * to a class with a part that matches this one.
 */
export type ClassDoc = {
  content: PartContent
  parts?: Record<string, PartDoc>
  /** The class this one is a part of. */
  partOf?: string
  /** LO-TEK demands a name for the element with the class. */
  name?: Name
  /** The tags the class can be on, the first being the one to write. */
  tags?: readonly Tag[]
}

/** A row in a form: the control and the label side by side. */
export const row = (control: string, what: string): ClassDoc => ({
  content: "parts",
  tags: [{ tag: "div" }],
  parts: {
    control: {
      selector: control,
      description: `${what}, with its class.`,
      content: "none",
      unique: true,
    },
    label: {
      selector: "label",
      description: "The label, wired to the control with `for`.",
      content: "text",
    },
  },
})

/**
 * The element as its component's file writes it. `metadata.ts` adds the
 * parts, the name and the texts.
 */
export type ElementBase = Omit<ElementDoc, "parts" | "name" | "texts">

export function element<T extends Component>(
  tag: string,
  slug: string,
  description: string,
  attributes: Attributes<T>,
  events: Record<string, EventDoc> = {},
  removed?: Record<string, string>,
): ElementBase {
  return {
    tag,
    slug,
    description,
    attributes,
    events,
    ...(removed ? { removed } : {}),
  }
}

/** Everything written by hand about one component. Each field is left out when the component has none. */
export type ComponentDoc = {
  /** The `<lt-…>` element, for the frame components and the standalone ones. */
  element?: ElementBase
  /** The name LO-TEK demands for the element itself. */
  name?: Name
  /** The parts the element finds in the markup. */
  parts?: Record<string, PartDoc>
  /** The classes the component's stylesheet has, by name. See `ClassDoc`. */
  classes?: Record<string, ClassDoc>
  /**
   * The markup each builder function belongs in, by the name of the
   * function, written once here from the component page.
   * `check-anatomy.ts` holds each to the page, and `check-design-tool.ts`
   * to what a design tool must do with it. See `anatomy` in
   * `manifest/manifest.schema.json`.
   */
  anatomies?: Record<string, Anatomy>
  /**
   * Which part of a frame component each set from a builder function fills,
   * by the name of the function: `field.control` is the control in
   * `<lt-field>`. The selector stays on the part, so what a set may go on is
   * said in one place, the same place the component and `lotek check` read.
   * `null` is a set that fills no part, such as the host itself or a box
   * only the stylesheet knows.
   *
   * Every set a builder function returns must be here, with a part that
   * exists: `generate-manifest.ts` stops otherwise, so a new set gets a
   * decision rather than a hole. The editors read it from
   * `builders[].parts` in the manifest.
   */
  builderParts?: Record<string, Record<string, BuilderPart | null>>
}

/**
 * One table from what each component has of it, in the order of the
 * components. A name in two of them stops the build: with one literal for
 * the whole table the compiler refused that, and here the last would have
 * won without a word.
 */
export function together<T>(
  what: string,
  tables: Record<string, Record<string, T> | undefined>,
): Record<string, T> {
  const all: Record<string, T> = {}
  const from: Record<string, string> = {}
  for (const [component, table] of Object.entries(tables))
    for (const [name, entry] of Object.entries(table ?? {})) {
      if (from[name])
        throw new Error(
          `${what}: ${name} is in both ${from[name]}.ts and ${component}.ts.`,
        )
      from[name] = component
      all[name] = entry
    }
  return all
}
