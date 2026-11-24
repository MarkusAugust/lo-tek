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
import { NAMES } from "./generate-agent"
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

/**
 * An input with one class, `lt-box`, and nothing else. Every component
 * folder handed in is described, unless the test says otherwise.
 */
const input = (more: Partial<Input> = {}): Input => ({
  described: (more.components ?? []).map((folder) => folder.name),
  listed:
    more.described ?? (more.components ?? []).map((folder) => folder.name),
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

test("the manifest is written with schemaVersion 2", () => {
  expect(manifestOf(input()).schemaVersion).toBe(2)
})

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

/** An input with the element `<lt-NAME>` and its folder, with one source file. */
const withSource = (name: string, source: string): Input =>
  input({
    elements: { [`lt-${name}`]: { link: "", attributes: {} } },
    components: [{ ...folder(name, "", source), category: "frame" }],
  })

test("the ids a component creates itself are on its element, by their prefix", () => {
  const { elements } = manifestOf(
    withSource("dialog", 'this.titleId ??= uniqueId("lt-dialog-title")'),
  )
  expect(elements["lt-dialog"].generatedIds).toEqual(["lt-dialog-title"])
})

test("an id the component remembers for a node counts too, each prefix once and in order", () => {
  const { elements } = manifestOf(
    withSource(
      "suggestion",
      `setAttr(
        option,
        "id",
        rememberedId(this.ids, option, "lt-suggestion-option"),
      )
      setAttr(list, "id", rememberedId(this.ids, list, "lt-suggestion-list"))
      this.other = rememberedId(
        this.ids,
        other,
        "lt-suggestion-list",
      )`,
    ),
  )
  expect(elements["lt-suggestion"].generatedIds).toEqual([
    "lt-suggestion-list",
    "lt-suggestion-option",
  ])
})

test("an element that creates no id says nothing about ids", () => {
  const { elements } = manifestOf(withSource("term", "const x = 1"))
  expect("generatedIds" in elements["lt-term"]).toBe(false)
})

test("an id made from something other than a written-out prefix stops the build", () => {
  expect(() =>
    files(withSource("tabs", "const id = uniqueId('lt-tabs-' + kind)")),
  ).toThrow(
    "tabs.ts: uniqueId('lt-tabs-' + kind) does not write its prefix out, so the manifest cannot say which ids <lt-tabs> creates.",
  )
  expect(() =>
    files(withSource("tabs", "rememberedId(this.ids, tab, PREFIX)")),
  ).toThrow("rememberedId(this.ids, tab, PREFIX) does not write its prefix out")
})

test("an id created in a folder that has no element stops the build", () => {
  expect(() =>
    files(
      input({
        components: [
          folder("card", "", 'const id = uniqueId("lt-card-title")'),
        ],
      }),
    ),
  ).toThrow(
    "card.ts creates the id lt-card-title, and there is no <lt-card> to put it on.",
  )
})

test("a call in a comment creates no id, and a comment in a call does not hide its prefix", () => {
  const { elements } = manifestOf(
    withSource(
      "dialog",
      `/** Like uniqueId(), but kept: see rememberedId(memory, node, prefix). */
      // this.old = uniqueId("lt-dialog-old")
      this.titleId ??= uniqueId(
        "lt-dialog-title", // the title
      )
      const url = "https://example.test/uniqueId(x)"`,
    ),
  )
  expect(elements["lt-dialog"].generatedIds).toEqual(["lt-dialog-title"])
})

test("a helper imported under another name stops the build", () => {
  expect(() =>
    files(
      withSource(
        "dialog",
        'import { uniqueId as uid } from "../../host-element.js"\nuid("lt-dialog-body")',
      ),
    ),
  ).toThrow(
    "dialog.ts imports uniqueId under another name, so the manifest cannot find the ids <lt-dialog> creates.",
  )
})

test("a component folder with no file in scripts/metadata/ stops the build", () => {
  expect(() =>
    files(input({ components: [folder("card", "")], described: [] })),
  ).toThrow(
    "src/components/css/card has no file in scripts/metadata/. Write card.ts there, and list it in metadata.ts.",
  )
})

test("a file in scripts/metadata/ with no component folder stops the build", () => {
  expect(() => files(input({ described: ["card"] }))).toThrow(
    "scripts/metadata/card.ts describes a component, and no folder in src/components/ has that name.",
  )
})

test("a helper used as anything but a call by its own name stops the build", () => {
  for (const source of [
    'import * as host from "../../host-element.js"\nhost.uniqueId("lt-dialog-body")',
    'const uid = uniqueId\nuid("lt-dialog-body")',
    '["lt-dialog-body"].map(uniqueId)',
    '(rememberedId as Remember)(ids, node, "lt-dialog-body")',
  ])
    expect(() => files(withSource("dialog", source))).toThrow("dialog.ts uses ")
})

test("an empty prefix stops the build", () => {
  expect(() => files(withSource("dialog", 'uniqueId("")'))).toThrow(
    'dialog.ts: uniqueId("") does not write its prefix out',
  )
})

test("a file in scripts/metadata/ that metadata.ts does not list stops the build", () => {
  expect(() =>
    files(
      input({
        components: [folder("card", "")],
        described: ["card"],
        listed: [],
      }),
    ),
  ).toThrow(
    "scripts/metadata/card.ts is not listed in metadata.ts, so nothing reads it.",
  )
})

/*
 * What schema version 2 added, in the manifest of the package itself: the
 * expected rows are written out here, from what the command line and the
 * editor each held as a list of their own before the manifest had them.
 */
type Option = { name: string; type: { kind: string }; stableId?: unknown }
type Written = {
  rulebooks?: {
    dependencies: { dependency: string; rulebook: string }[]
    aliases: Record<string, string>
  }
  builders: {
    name: string
    options: Option[]
    returns: { kind: string; fields?: Record<string, unknown> }
  }[]
}
const ofThePackage = (): Written =>
  JSON.parse(files()["manifest/manifest.json"])

test("the manifest says which dependency points to which rulebook, in the order they are read", () => {
  const { rulebooks } = ofThePackage()
  // Astro first, since an Astro app with React islands has both, and
  // `vite` last.
  expect(rulebooks?.dependencies).toEqual([
    { dependency: "astro", rulebook: "astro" },
    { dependency: "react", rulebook: "react" },
    { dependency: "vue", rulebook: "bundles" },
    { dependency: "svelte", rulebook: "bundles" },
    { dependency: "solid-js", rulebook: "bundles" },
    { dependency: "lit", rulebook: "bundles" },
    { dependency: "@starfederation/datastar-sdk", rulebook: "datastar" },
    { dependency: "vite", rulebook: "bundles" },
  ])
  // `toEqual` does not see the order of the keys, and the aliases are
  // listed in it when a name is refused.
  expect(Object.entries(rulebooks?.aliases ?? {})).toEqual([
    ["vue", "bundles"],
    ["svelte", "bundles"],
    ["solid", "bundles"],
    ["solid-js", "bundles"],
    ["lit", "bundles"],
    ["vite", "bundles"],
  ])
})

test("every rulebook the manifest points to is one the package has", () => {
  const { rulebooks } = ofThePackage()
  const pointedTo = [
    ...(rulebooks?.dependencies ?? []).map((row) => row.rulebook),
    ...Object.values(rulebooks?.aliases ?? {}),
  ]
  expect(pointedTo.length).toBeGreaterThan(0)
  expect(pointedTo.filter((name) => !NAMES.includes(name))).toEqual([])
  // An alias is another name for a rulebook, never the name of one.
  expect(
    Object.keys(rulebooks?.aliases ?? {}).filter((a) => NAMES.includes(a)),
  ).toEqual([])
})

test("an option that is an id which must be the same on every render says so, and no other option does", () => {
  const marked = ofThePackage()
    .builders.flatMap((builder) =>
      builder.options
        .filter((option) => "stableId" in option)
        .map((option) => `${builder.name}.${option.name}`),
    )
    .sort()
  expect(marked).toEqual(
    [
      "dialog.titleId",
      "errorSummary.id",
      "errorSummary.titleId",
      "field.id",
      "field.helpId",
      "field.errorId",
      "popover.id",
      "sessionTimeout.titleId",
      "suggestion.id",
      "suggestion.helpId",
      "suggestion.errorId",
      "suggestion.keys",
      "tabs.id",
      "tabs.keys",
      "term.id",
    ].sort(),
  )
  // Only `true` is written: an option that is no id says nothing.
  for (const builder of ofThePackage().builders)
    for (const option of builder.options)
      if ("stableId" in option) expect(option.stableId).toBe(true)
})

test("the builder functions with a flag for an error and a part for its text are field and suggestion", () => {
  // The editor warns about an error text nothing shows from exactly these.
  // A third one shows up here.
  const withErrorText = ofThePackage()
    .builders.filter(
      (builder) =>
        builder.options.some(
          (option) => option.name === "error" && option.type.kind === "flag",
        ) &&
        builder.returns.kind === "group" &&
        "error" in (builder.returns.fields ?? {}),
    )
    .map((builder) => builder.name)
  expect(withErrorText).toEqual(["field", "suggestion"])
})
