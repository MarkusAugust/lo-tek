/**
 * The rules the manifest is written by, each with an input small enough to
 * read: a builder function or two, a class, an anatomy. Every test calls
 * `files()`, which is what the generator writes and `check-manifest.ts`
 * compares, and reads the answer from the manifest it gives.
 *
 * Run with: bun test scripts, or as part of `bun run build`.
 */

import { expect, test } from "bun:test"
import type { Anatomy, ClassInfo } from "../src/vocabulary/types.js"
import { files, type Input } from "./generate-manifest"

type Builder = Input["builders"][number]

const builder = (name: string, more: Partial<Builder> = {}): Builder => ({
  name,
  description: "",
  options: [],
  returns: { kind: "attributes" },
  ...more,
})

const classInfo = (more: Partial<ClassInfo> = {}): ClassInfo => ({
  component: "box",
  title: "Box",
  description: "A box.",
  link: "https://example.test/box/",
  content: "free",
  attributes: {},
  ...more,
})

/** An input with one class, `lt-box`, and nothing else. */
const input = (more: Partial<Input> = {}): Input => ({
  version: "0.0.0",
  textLanguage: "en",
  elements: {},
  classes: { "lt-box": classInfo() },
  builders: [],
  lt: {},
  parts: {},
  anatomies: {},
  tokens: {
    css: {},
    colors: {},
    breakpoints: {},
    containers: {},
    families: {},
    roles: {},
    layers: {},
  },
  components: [],
  agent: [],
  ...more,
})

const manifestOf = (given: Input) =>
  JSON.parse(files(given)["manifest/manifest.json"])

/** A `box` whose anatomy is one tag around a hole that takes other elements. */
const boxIn = (tag: string): Input => {
  const anatomy: Anatomy = {
    holes: {
      body: { description: "What it holds.", content: "free", example: "" },
    },
    nodes: [{ tag, from: ["box"], children: [{ hole: "body" }] }],
  }
  return input({
    builders: [builder("box")],
    lt: { box: () => ({ class: "lt-box" }) },
    anatomies: { box: anatomy },
  })
}

test("a hole inside a form forbids another form, and says why", () => {
  const { forbids } = manifestOf(boxIn("form")).builders[0].anatomy.holes.body
  expect(forbids).toEqual([
    {
      tags: ["form"],
      why: "A form cannot be inside another form: the browser drops the inner <form>.",
    },
  ])
})

test("a form further out than the nearest element forbids a form too", () => {
  const given = boxIn("form")
  const [form] = given.anatomies.box.nodes
  if (!("tag" in form)) throw new Error("the box is a node")
  const inner = { tag: "div", children: form.children }
  const { forbids } = manifestOf({
    ...given,
    anatomies: {
      box: { ...given.anatomies.box, nodes: [{ ...form, children: [inner] }] },
    },
  }).builders[0].anatomy.holes.body
  expect(forbids?.map((f: { tags: string[] }) => f.tags)).toEqual([["form"]])
})

test("a hole inside a div forbids nothing", () => {
  const { body } = manifestOf(boxIn("div")).builders[0].anatomy.holes
  expect("forbids" in body).toBe(false)
})

test("a hole for other elements inside a button stops the build", () => {
  expect(() => files(boxIn("button"))).toThrow(
    "box.body takes other elements inside <button>",
  )
})

/** A builder function that writes `data-variant` on `lt-box` from its `variant`. */
const variantBuilder = (name: string, description: string): Builder =>
  builder(name, {
    options: [
      {
        name: "variant",
        required: false,
        type: { kind: "values", values: ["filled"] },
        description,
      },
    ],
  })
const writesVariant = ({ variant }: { variant?: string }) => ({
  class: "lt-box",
  ...(variant ? { "data-variant": variant } : {}),
})
const boxWithVariant = classInfo({
  attributes: { "data-variant": { values: ["filled"] } },
})

test("a class attribute is described by the option that writes it, the first builder function in the list winning", () => {
  const manifest = manifestOf(
    input({
      classes: { "lt-box": boxWithVariant },
      builders: [
        variantBuilder("alpha", "Alpha's words."),
        variantBuilder("beta", "Beta's words."),
      ],
      lt: { alpha: writesVariant, beta: writesVariant },
    }),
  )
  expect(manifest.classes["lt-box"].attributes["data-variant"]).toEqual({
    values: ["filled"],
    description: "Alpha's words.",
  })
})

test("a flag has no list of values in the manifest", () => {
  const manifest = manifestOf(
    input({
      classes: {
        "lt-box": classInfo({
          attributes: { "data-interactive": { values: [], flag: true } },
        }),
      },
    }),
  )
  expect(manifest.classes["lt-box"].attributes["data-interactive"]).toEqual({
    flag: true,
  })
})

test("options that each add fixed attributes give a table another language can build from", () => {
  const [alpha] = manifestOf(
    input({
      classes: { "lt-box": boxWithVariant },
      builders: [variantBuilder("alpha", "")],
      lt: { alpha: writesVariant },
    }),
  ).builders
  expect(alpha.table).toEqual({
    kind: "attributes",
    table: {
      base: { class: "lt-box" },
      options: { variant: { cases: { filled: { "data-variant": "filled" } } } },
    },
  })
})

test("a default that the comment on the option does not name stops the build", () => {
  const filledAnyway = () => ({ class: "lt-box", "data-variant": "filled" })
  expect(() =>
    files(
      input({
        builders: [variantBuilder("alpha", "How it looks.")],
        lt: { alpha: filledAnyway },
      }),
    ),
  ).toThrow('End the comment with "Default: `filled`."')
})

test("a builder function with no page stops the build", () => {
  expect(() =>
    files(
      input({
        builders: [builder("orphan")],
        lt: { orphan: () => ({ class: "lt-nowhere" }) },
      }),
    ),
  ).toThrow("lt.orphan has no page")
})

test("a set that BUILDER_PARTS does not list stops the build", () => {
  const pair = builder("pair", {
    returns: {
      kind: "group",
      fields: { host: { kind: "attributes" }, title: { kind: "attributes" } },
    },
  })
  expect(() =>
    files(
      input({
        builders: [pair],
        lt: {
          pair: () => ({ host: { class: "lt-box" }, title: { class: "" } }),
        },
        parts: { pair: { host: null } },
      }),
    ),
  ).toThrow("Missing: title.")
})

/** A component folder with one stylesheet and one source file. */
const folder = (name: string, css: string, source = "") => ({
  category: "css",
  name,
  files: [`${name}.css`, `${name}.ts`],
  sources: { [`${name}.css`]: css, [`${name}.ts`]: source },
})

test("a component variable belongs to the component its name starts with, with the first fallback", () => {
  const { components } = manifestOf(
    input({
      components: [
        folder(
          "fieldset",
          ".a { gap: var(--lt-fieldset-gap, calc(1px + var(--x))); content: var(--lt-label-mark, '*'); }",
        ),
        folder("label", ".b { content: var(--lt-label-mark, '+'); }"),
      ],
    }),
  ).tokens
  expect(components).toEqual({
    fieldset: { "--lt-fieldset-gap": "calc(1px + var(--x))" },
    label: { "--lt-label-mark": "'*'" },
  })
})

test("a variable the component sets itself is not one the consumer overrides", () => {
  const { components } = manifestOf(
    input({
      components: [
        folder(
          "popover",
          ".p { top: var(--lt-popover-top, 0); gap: var(--lt-popover-gap, 4px); }",
          'panel.style.setProperty("--lt-popover-top", "1px")',
        ),
      ],
    }),
  ).tokens
  expect(components).toEqual({ popover: { "--lt-popover-gap": "4px" } })
})

test("a token read with a fallback is not a component variable", () => {
  const { components } = manifestOf(
    input({
      tokens: { ...input().tokens, css: { "--lt-spacing-2": "8px" } },
      components: [folder("box", ".b { gap: var(--lt-spacing-2, 8px); }")],
    }),
  ).tokens
  expect(components).toEqual({})
})

test("an anatomy is rendered with the builder functions of the input, not the package's own", () => {
  const anatomy: Anatomy = {
    holes: { body: { description: "What it holds.", content: "text" } },
    nodes: [{ tag: "div", from: ["box"], children: [{ hole: "body" }] }],
  }
  const { cases } = JSON.parse(
    files(
      input({
        builders: [builder("box")],
        lt: { box: () => ({ class: "lt-box", "data-from": "the input" }) },
        anatomies: { box: anatomy },
      }),
    )["manifest/anatomy-cases.json"],
  )
  expect(cases[0].expected).toBe(
    '<div class="lt-box" data-from="the input"></div>',
  )
})

test("a node that can be several tags and requires another part gets its tag cases with that part on", () => {
  const anatomy: Anatomy = {
    holes: {},
    nodes: [
      {
        tag: "div",
        from: ["box"],
        children: [
          { tag: "header", name: "header", optional: true },
          {
            tag: ["h2", "h3"],
            name: "title",
            optional: true,
            requires: "header",
          },
        ],
      },
    ],
  }
  const { cases } = JSON.parse(
    files(
      input({
        builders: [builder("box")],
        lt: { box: () => ({ class: "lt-box" }) },
        anatomies: { box: anatomy },
      }),
    )["manifest/anatomy-cases.json"],
  )
  const asH3 = cases.find(
    (c: { instance: { tags?: Record<string, string> } }) =>
      c.instance.tags?.title === "h3",
  )
  expect(asH3.instance.parts).toEqual({ title: true, header: true })
  expect(asH3.expected).toBe(
    '<div class="lt-box"><header></header><h3></h3></div>',
  )
})
