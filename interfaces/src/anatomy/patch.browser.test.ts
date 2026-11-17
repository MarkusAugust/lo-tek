import { beforeAll, describe, expect, it } from "vitest"

import manifest from "../../manifest/manifest.json"
import { defineLt } from "../register"
import { waitForPaint } from "../testing/a11y"
import { type Replacement, replace } from "../testing/update"
import type { Anatomy, Manifest } from "../vocabulary/types"
import {
  type AnatomyInstance,
  createdInstance,
  renderAnatomy,
  variantsOf,
  withItem,
} from "./index"

/*
 * Capability 7 of the design tool: a change the designer makes reaches
 * the browser as a Datastar patch and keeps what did not change. The tool
 * puts each component in a box of its own with an id, as a node in its
 * layout, and sends the whole box again on every change. Every element
 * with the same address before and after must then be the same DOM
 * element, or the focus, the text the user typed and the state a web
 * component keeps are lost.
 */

/** Datastar's patch, and idiomorph's morph, which htmx uses. */
const WAYS: Replacement[] = ["Datastar", "idiomorph"]

const BOX = "tool-node"
const box = (html: string) => `<div id="${BOX}">${html}</div>`

/**
 * An id from an address that two addresses never share: every character
 * that is not a letter or a digit is written as its code, so `0[a]/1` and
 * `0[a-1]` stay apart.
 */
const idOf = (component: string, address: string) =>
  `${component}-n-${[...address].map((c) => (/[A-Za-z0-9]/.test(c) ? c : `_${c.charCodeAt(0).toString(16)}`)).join("")}`

/** The markup with an address on every element, as the tool writes it. */
const rendered = (name: string, instance: AnatomyInstance) =>
  renderAnatomy(manifest as unknown as Manifest, name, {
    ...instance,
    // The address as an id too, which is what Datastar and idiomorph know
    // an element by; the anatomy's own ids are kept.
    annotate: (address) => ({
      "data-node": address,
      id: idOf(instance.id, address),
      // A class of the tool's own, which must stand next to the anatomy's.
      class: "tool-node",
    }),
  })

const elements = () =>
  new Map(
    [...document.querySelectorAll<HTMLElement>(`#${BOX} [data-node]`)].map(
      (e) => [e.dataset.node as string, e],
    ),
  )

/** The addresses in the markup, as the patch must leave them. */
const addressesIn = (html: string) =>
  [...html.matchAll(/\sdata-node="([^"]*)"/g)].map((m) => m[1]).sort()

/**
 * Mounts `before`, updates to `after` the way `way` does it, and gives
 * the addresses that were replaced. Fails when the update did not arrive.
 */
async function replaced(
  way: Replacement,
  before: string,
  after: string,
  what = "",
): Promise<string[]> {
  document.body.innerHTML = box(before)
  await waitForPaint()
  const was = elements()
  // The designer works in the tool's panel, so focus is not in the
  // component. An error summary that has taken focus is left alone by
  // idiomorph, which keeps the children of the focused element.
  ;(document.activeElement as HTMLElement | null)?.blur()
  replace(way, BOX, box(after))
  await waitForPaint()
  const is = elements()
  for (const element of is.values())
    expect(
      element.classList.contains("tool-node"),
      `the tool's class on ${element.dataset.node}`,
    ).toBe(true)
  expect(
    [...is.keys()].sort(),
    `${way} did not apply ${what}: ${document.getElementById(BOX)?.innerHTML}`,
  ).toEqual(addressesIn(after))
  return [...was]
    .filter(([a, e]) => is.has(a) && is.get(a) !== e)
    .map(([a]) => a)
}

/** The component as created, with an item in each group that may have none. */
function created(anatomy: Anatomy): AnatomyInstance {
  let instance = createdInstance(anatomy, "c1")
  for (const [group, { min }] of Object.entries(anatomy.repeats ?? {}))
    if (min === 0) instance = withItem(anatomy, instance, group, `${group}1`)
  return instance
}

/**
 * The changes a designer makes, one at a time, from the created component:
 * every variant, an item inserted first in every group, and every text
 * rewritten, for one item when it is per item. An id the designer sets is
 * left out: it is the element's identity, and a new one is a new element.
 */
function changes(anatomy: Anatomy): [string, AnatomyInstance][] {
  const base = created(anatomy)
  const out: [string, AnatomyInstance][] = variantsOf(anatomy)
    .slice(1)
    .map((v) => [JSON.stringify(v), { ...base, ...v }])
  for (const group of Object.keys(anatomy.repeats ?? {}))
    out.push([
      `an item first in ${group}`,
      withItem(anatomy, base, group, "inserted"),
    ])
  for (const [name, hole] of Object.entries(anatomy.holes)) {
    if (hole.content !== "text") continue
    // The first item in each group the hole is per.
    const first = (per: readonly string[]): unknown =>
      per.length === 0
        ? "Rewritten"
        : {
            ...((base.holes?.[name] as object) ?? {}),
            [base.repeats?.[per[0]]?.[0] ?? ""]: first(per.slice(1)),
          }
    out.push([
      `${name} rewritten`,
      {
        ...base,
        holes: { ...base.holes, [name]: first(hole.per ?? []) as string },
      },
    ])
  }
  return out
}

const builders = (manifest as unknown as Manifest).builders.filter(
  (b) => b.anatomy,
)

describe("a Datastar patch of every component", () => {
  beforeAll(() => {
    defineLt()
  })

  it("proves the witness: an element whose id changes is replaced", async () => {
    for (const way of WAYS)
      expect(
        await replaced(
          way,
          `<p data-node="0" id="a" class="tool-node">x</p>`,
          `<p data-node="0" id="b" class="tool-node">x</p>`,
        ),
        way,
      ).toEqual(["0"])
  })

  for (const b of builders)
    it(`${b.name}: every change keeps the elements that did not change`, async () => {
      const anatomy = b.anatomy as Anatomy
      const before = rendered(b.name, created(anatomy))
      for (const way of WAYS)
        for (const [what, instance] of changes(anatomy)) {
          const lost = await replaced(
            way,
            before,
            rendered(b.name, instance),
            what,
          )
          expect(lost, `${b.name}, ${what}, through ${way}`).toEqual([])
        }
    })
})
