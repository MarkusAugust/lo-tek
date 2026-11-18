/**
 * What `renderAnatomy()` does with the builder functions it is handed, on a
 * manifest small enough to read. The markup of the real anatomies is held
 * to the pages by `check-anatomy.ts` and to the browsers by the browser
 * tests; here are the rules that need neither.
 *
 * Run with: bun test ./scripts/, or as part of `bun run build`.
 */

import { expect, test } from "bun:test"
import { renderAnatomy } from "../src/anatomy/index.js"
import type { Anatomy, Manifest } from "../src/vocabulary/types.js"

/** A manifest with one builder function, `box`, and its anatomy. */
const manifestWith = (anatomy: Anatomy): Manifest => ({
  schemaVersion: 1,
  version: "0.0.0",
  elements: {},
  classes: {},
  builders: [
    { name: "box", options: [], returns: { kind: "attributes" }, anatomy },
  ],
  tokens: {
    spacing: {},
    breakpoints: {},
    containers: {},
    colors: { families: {}, roles: {}, layers: {}, tokens: [] },
    components: {},
  },
})
const from = (source: string): Anatomy => ({
  holes: {},
  nodes: [{ tag: "div", from: [source] }],
})

test("the attributes come from the builder functions handed in", () => {
  expect(
    renderAnatomy(
      manifestWith(from("box")),
      "box",
      { id: "c1" },
      {
        box: () => ({ class: "lt-box" }),
      },
    ),
  ).toBe('<div class="lt-box"></div>')
})

test("a builder function that was not handed in is said to be missing there, not in lt", () => {
  expect(() =>
    renderAnatomy(manifestWith(from("box")), "box", { id: "c1" }, {}),
  ).toThrow("renderAnatomy: no builder function box among the ones handed in.")
})

test("a name every object has is not a builder function", () => {
  for (const name of ["toString", "constructor", "hasOwnProperty"])
    expect(() =>
      renderAnatomy(manifestWith(from(name)), "box", { id: "c1" }, {}),
    ).toThrow(`no builder function ${name}`)
})

test("a value in the set that is no function is not one either", () => {
  expect(() =>
    renderAnatomy(
      manifestWith(from("states")),
      "box",
      { id: "c1" },
      {
        states: ["default", "invalid"],
      },
    ),
  ).toThrow("no builder function states")
})

/** A dialog-like box: a header that can go, and a subtitle only with it. */
const withHeader: Anatomy = {
  holes: {},
  nodes: [
    {
      tag: "div",
      children: [
        { tag: "header", name: "header", optional: true },
        {
          tag: "p",
          name: "subtitle",
          optional: true,
          created: true,
          requires: "header",
        },
      ],
    },
  ],
}
const parts = (anatomy: Anatomy, given?: Record<string, boolean>) =>
  renderAnatomy(manifestWith(anatomy), "box", { id: "c1", parts: given }, {})

test("a node that requires another is there only with it", () => {
  expect(parts(withHeader)).toBe("<div></div>")
  expect(parts(withHeader, { subtitle: true })).toBe("<div></div>")
  expect(parts(withHeader, { header: true })).toBe(
    "<div><header></header><p></p></div>",
  )
  expect(parts(withHeader, { header: true, subtitle: false })).toBe(
    "<div><header></header></div>",
  )
})

test("the required node is found wherever it stands, also as an alternative of a choice below", () => {
  const deep: Anatomy = {
    holes: {},
    nodes: [
      {
        tag: "div",
        children: [
          { tag: "p", name: "note", optional: true, requires: "mark" },
          {
            tag: "section",
            children: [
              {
                name: "kind",
                description: "Plain or marked.",
                oneOf: {
                  plain: { tag: "span" },
                  marked: { tag: "mark", name: "mark", optional: true },
                },
              },
            ],
          },
        ],
      },
    ],
  }
  expect(parts(deep, { note: true })).toBe(
    "<div><section><span></span></section></div>",
  )
  expect(parts(deep, { note: true, mark: true })).toBe(
    "<div><p></p><section><span></span></section></div>",
  )
})

test("a node that requires a name no node has is never there", () => {
  const alone: Anatomy = {
    holes: {},
    nodes: [
      {
        tag: "div",
        children: [
          { tag: "p", name: "note", optional: true, requires: "gone" },
        ],
      },
    ],
  }
  expect(parts(alone, { note: true, gone: true })).toBe("<div></div>")
})

test("with a name used twice, the first node by that name is the one required", () => {
  const twice: Anatomy = {
    holes: {},
    nodes: [
      {
        tag: "div",
        children: [
          { tag: "p", name: "note", optional: true, requires: "part" },
          // Never there: it requires a name no node has.
          { tag: "b", name: "part", optional: true, requires: "gone" },
          { tag: "i", name: "part", optional: true },
        ],
      },
    ],
  }
  expect(parts(twice, { note: true, part: true })).toBe("<div><i></i></div>")
})

/** A box whose `disabled` option is on exactly when the choice takes `off`. */
const bound: Anatomy = {
  holes: {},
  options: { disabled: { choice: "state", alternative: "off" } },
  nodes: [
    {
      name: "state",
      description: "On or off.",
      oneOf: {
        on: { tag: "a", from: ["box"] },
        off: { tag: "span", from: ["box"] },
      },
    },
  ],
}
const disabledBox = {
  box: ({ disabled }: { disabled?: boolean }) => ({
    "data-disabled": String(disabled),
  }),
}
const choosing = (choices?: Record<string, string>) =>
  renderAnatomy(manifestWith(bound), "box", { id: "c1", choices }, disabledBox)

test("an option bound to a choice is on exactly when the choice takes the alternative", () => {
  expect(choosing({ state: "off" })).toBe('<span data-disabled="true"></span>')
  expect(choosing({ state: "on" })).toBe('<a data-disabled="false"></a>')
})

test("left out, a choice takes its first alternative, and the bound option follows", () => {
  expect(choosing()).toBe('<a data-disabled="false"></a>')
})

test("an option bound to a choice no node has is off", () => {
  const nowhere: Anatomy = {
    ...bound,
    options: { disabled: { choice: "gone", alternative: "off" } },
  }
  expect(
    renderAnatomy(manifestWith(nowhere), "box", { id: "c1" }, disabledBox),
  ).toBe('<a data-disabled="false"></a>')
})
