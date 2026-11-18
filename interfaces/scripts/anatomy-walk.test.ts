/**
 * The one way through an anatomy, `src/anatomy/walk.ts`, on anatomies small
 * enough to read. It is here and not next to the module because a test in
 * `src` is a browser test, and this one needs no browser.
 *
 * Run with: bun test ./scripts/, or as part of `bun run build`.
 */

import { expect, test } from "bun:test"
import { aroundOf, holesOf, nodesOf, pathTo } from "../src/anatomy/walk.js"
import type { Anatomy } from "../src/vocabulary/types.js"

const tagOf = (tag: string | readonly string[]) =>
  typeof tag === "string" ? tag : tag.join("|")

/** A table with a choice of heading, a hole in each alternative and one beside them. */
const table: Pick<Anatomy, "nodes"> = {
  nodes: [
    {
      tag: "table",
      children: [
        { hole: "caption" },
        {
          tag: "tr",
          children: [
            {
              name: "heading",
              description: "Plain or sortable.",
              oneOf: {
                plain: { tag: "th", children: [{ hole: "title" }] },
                sortable: {
                  tag: "th",
                  name: "sorted",
                  children: [
                    { tag: ["a", "button"], children: [{ hole: "title" }] },
                  ],
                },
              },
            },
          ],
        },
      ],
    },
  ],
}

test("every node comes once, the one around it before the ones inside", () => {
  expect([...nodesOf(table)].map((place) => tagOf(place.node.tag))).toEqual([
    "table",
    "tr",
    "th",
    "th",
    "a|button",
  ])
})

test("an alternative of a choice says which choice, and which alternative", () => {
  const alternatives = [...nodesOf(table)]
    .filter((place) => place.choice)
    .map((place) => [place.choice?.name, place.alternative, place.node.name])
  expect(alternatives).toEqual([
    ["heading", "plain", undefined],
    ["heading", "sortable", "sorted"],
  ])
})

test("a node inside an alternative is not itself one", () => {
  const link = [...nodesOf(table)].find(
    (place) => place.node.tag !== "th" && place.parent?.choice,
  )
  expect(tagOf(link?.node.tag ?? "")).toBe("a|button")
  expect(link?.choice).toBeUndefined()
})

test("a hole comes with the nodes around it, outermost first, in every place it stands", () => {
  const around = [...holesOf(table)].map((place) => [
    place.hole.hole,
    aroundOf(place).map((node) => tagOf(node.tag)),
  ])
  expect(around).toEqual([
    ["caption", ["table"]],
    ["title", ["table", "tr", "th"]],
    ["title", ["table", "tr", "th", "a|button"]],
  ])
})

test("a hole at the root has nothing around it", () => {
  const [place] = [...holesOf({ nodes: [{ hole: "body" }] })]
  expect(aroundOf(place)).toEqual([])
})

test("the path to a node is every node from the root to it, itself last, with the alternatives taken", () => {
  const link = [...nodesOf(table)].find(
    (place) => tagOf(place.node.tag) === "a|button",
  )
  if (!link) throw new Error("no link in the table")
  expect(
    pathTo(link).map((place) => [tagOf(place.node.tag), place.alternative]),
  ).toEqual([
    ["table", undefined],
    ["tr", undefined],
    ["th", "sortable"],
    ["a|button", undefined],
  ])
})
