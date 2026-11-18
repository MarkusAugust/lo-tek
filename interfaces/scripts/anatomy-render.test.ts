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
