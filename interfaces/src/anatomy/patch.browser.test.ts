import { beforeAll, describe, expect, it } from "vitest"

import manifest from "../../manifest/manifest.json"
import { defineLt } from "../register"
import { waitForPaint } from "../testing/a11y"
import { datastarPatch } from "../testing/update"
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

const BOX = "tool-node"
const box = (html: string) => `<div id="${BOX}">${html}</div>`

/** The markup with an address on every element, as the tool writes it. */
const rendered = (name: string, instance: AnatomyInstance) =>
  renderAnatomy(manifest as unknown as Manifest, name, {
    ...instance,
    // The address as an id too, which is what Datastar and idiomorph know
    // an element by; the anatomy's own ids are kept.
    annotate: (address) => ({
      "data-node": address,
      // With the component's id first, so two on a page do not clash.
      id: `${instance.id}-n-${address.replace(/[^\w-]+/g, "-")}`,
    }),
  })

const elements = () =>
  new Map(
    [...document.querySelectorAll<HTMLElement>(`#${BOX} [data-node]`)].map(
      (e) => [e.dataset.node as string, e],
    ),
  )

/** Mounts `before`, patches to `after`, and gives the addresses that were replaced. */
async function replaced(before: string, after: string): Promise<string[]> {
  document.body.innerHTML = box(before)
  await waitForPaint()
  const was = elements()
  datastarPatch(box(after))
  await waitForPaint()
  const is = elements()
  return [...was]
    .filter(([a, e]) => is.has(a) && is.get(a) !== e)
    .map(([a]) => a)
}

/** The changes a designer makes, one at a time, from the created component. */
function changes(anatomy: Anatomy): [string, AnatomyInstance][] {
  const base = createdInstance(anatomy, "c1")
  const out: [string, AnatomyInstance][] = variantsOf(anatomy)
    .slice(1)
    .map((v) => [JSON.stringify(v), { ...base, ...v }])
  for (const group of Object.keys(anatomy.repeats ?? {}))
    out.push([
      `an item first in ${group}`,
      withItem(anatomy, base, group, "inserted"),
    ])
  for (const [name, hole] of Object.entries(anatomy.holes))
    if (hole.content === "text" && !hole.per)
      out.push([
        `${name} rewritten`,
        { ...base, holes: { ...base.holes, [name]: "Rewritten" } },
      ])
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
    expect(
      await replaced(
        `<p data-node="0" id="a">x</p>`,
        `<p data-node="0" id="b">x</p>`,
      ),
    ).toEqual(["0"])
  })

  for (const b of builders)
    it(`${b.name}: every change keeps the elements that did not change`, async () => {
      const anatomy = b.anatomy as Anatomy
      const before = rendered(b.name, createdInstance(anatomy, "c1"))
      for (const [what, instance] of changes(anatomy)) {
        const lost = await replaced(before, rendered(b.name, instance))
        expect(lost, `${b.name}, ${what}`).toEqual([])
      }
    })
})
