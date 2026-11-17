/**
 * What the types written from `manifest.schema.json` accept and reject.
 *
 * `tsc` is the judge, in `typecheck:scripts`: every value here must compile,
 * and every line under `@ts-expect-error` must not, or the comment itself is
 * the error. The values are written by hand from what the schema says, so
 * the generator is not asked about its own answer. Nothing runs this file.
 */

import type {
  Anatomy,
  AnatomyNode,
  Attribute,
  Builder,
  Manifest,
  ManifestClass,
  Part,
} from "../src/vocabulary/manifest.js"

// A manifest with only what the schema requires, and with everything it has
// at the top.
const smallest: Manifest = {
  schemaVersion: 1,
  version: "0.0.0",
  elements: {},
  classes: {},
  builders: [],
  tokens: {
    spacing: {},
    breakpoints: {},
    containers: {},
    colors: { families: {}, roles: {}, layers: {}, tokens: [] },
    components: {},
  },
}
const whole: Manifest = {
  ...smallest,
  $schema: "./manifest.schema.json",
  textLanguage: "en",
}

// @ts-expect-error schemaVersion is 1, not any number
const nextVersion: Manifest = { ...smallest, schemaVersion: 2 }
// @ts-expect-error tokens is required
const withoutTokens: Manifest = {
  schemaVersion: 1,
  version: "0.0.0",
  elements: {},
  classes: {},
  builders: [],
}
// @ts-expect-error the manifest has no field by that name
const unknownField: Manifest = { ...smallest, language: "en" }

// A closed list is one of its values.
const part: Part = { selector: "input", description: "", content: "none" }
// @ts-expect-error content is text, free, parts or none
const wrongContent: Part = { selector: "p", description: "", content: "html" }
// @ts-expect-error a flag that is there is true, and off is left out
const flagOff: Part = { ...part, optional: false }

// A oneOf is one of its alternatives.
const flag: Attribute = { type: "flag" }
const values: Attribute = { type: "values", values: ["a"] }
// @ts-expect-error a closed list has its values
const valuesWithout: Attribute = { type: "values" }

// A class attribute is a list of values or a flag.
const box: ManifestClass = {
  component: "box",
  title: "Box",
  description: "",
  link: "",
  content: "free",
  attributes: {
    "data-variant": { values: ["filled"], default: "filled" },
    "data-interactive": { flag: true, description: "Reacts to hover." },
  },
  tags: [{ tag: "div" }, { tag: "input", attributes: { type: ["text"] } }],
}
// @ts-expect-error neither a list of values nor a flag
const neither: ManifestClass = { ...box, attributes: { "data-x": {} } }

// A tag is one, or a list to choose from, and null removes an attribute in a
// table.
const node: AnatomyNode = {
  tag: ["h2", "h3"],
  from: ["card.title"],
  attributes: { id: { hole: "titleId" }, role: "heading" },
  children: [{ hole: "title" }, { tag: "span" }],
}
// @ts-expect-error a tag is text
const numberedTag: AnatomyNode = { tag: 2 }
const builder: Builder = {
  name: "box",
  options: [{ name: "variant", required: false, type: { kind: "flag" } }],
  returns: { kind: "list", of: { kind: "attributes" } },
  table: {
    kind: "attributes",
    table: {
      base: { class: "lt-box" },
      options: { variant: { cases: { true: { "data-variant": null } } } },
    },
  },
}
const optionWithout: Builder = {
  ...builder,
  // @ts-expect-error an option says whether it is required
  options: [{ name: "variant", type: { kind: "flag" } }],
}

// An anatomy has exactly one root.
const anatomy: Anatomy = { holes: {}, nodes: [node] }
// @ts-expect-error two roots
const twoRoots: Anatomy = { holes: {}, nodes: [node, node] }
// @ts-expect-error no root
const noRoot: Anatomy = { holes: {}, nodes: [] }

export const accepted = [
  smallest,
  whole,
  part,
  flag,
  values,
  box,
  node,
  builder,
  anatomy,
]
export const rejected = [
  nextVersion,
  withoutTokens,
  unknownField,
  wrongContent,
  flagOff,
  valuesWithout,
  neither,
  numberedTag,
  optionWithout,
  twoRoots,
  noRoot,
]
