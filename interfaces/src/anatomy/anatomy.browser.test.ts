import { describe, expect, it } from "vitest"

import manifest from "../../manifest/manifest.json"
import type { Anatomy, Manifest } from "../vocabulary/types"
import {
  type AnatomyInstance,
  createdInstance,
  renderAnatomy,
  VOID,
  variantsOf,
  withItem,
} from "./index"

/*
 * The browser's own HTML parser is the witness the core cannot be: it
 * moves an element that may not stand where it is, as a <div> out of a
 * <p> or an <li> without a list. Every anatomy, as created and with every
 * alternative of every choice and every optional part, must come out of
 * the parser with every element at the depth it was written at.
 */

/** Each start tag with its depth, read from the markup as written. */
function written(html: string): string[] {
  const out: string[] = []
  let depth = 0
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)[^>]*?(\/?)>/g)) {
    const [, closing, tag, selfClosing] = m
    if (closing) {
      depth -= 1
      continue
    }
    out.push(`${depth} ${tag.toLowerCase()}`)
    if (!VOID.has(tag.toLowerCase()) && !selfClosing) depth += 1
  }
  return out
}

/** Each element with its depth, as the parser built them. */
function parsed(html: string): string[] {
  const template = document.createElement("template")
  template.innerHTML = html
  const out: string[] = []
  const walk = (node: ParentNode, depth: number) => {
    for (const child of node.children) {
      out.push(`${depth} ${child.localName}`)
      walk(
        child instanceof HTMLTemplateElement ? child.content : child,
        depth + 1,
      )
    }
  }
  walk(template.content, 0)
  return out
}

/** The component as created, with one item in a group that may have none. */
function created(anatomy: Anatomy): AnatomyInstance {
  let instance = createdInstance(anatomy, "c1")
  for (const [group, { min }] of Object.entries(anatomy.repeats ?? {}))
    if (min === 0) instance = withItem(anatomy, instance, group, `${group}1`)
  return instance
}

const builders = (manifest as unknown as Manifest).builders.filter(
  (b) => b.anatomy,
)

describe("the anatomies", () => {
  it("cover components", () => {
    expect(builders.length).toBeGreaterThan(30)
  })

  it("prove the witness: a <div> in a <p> moves", () => {
    const html = "<p><div>x</div></p>"
    expect(parsed(html)).not.toEqual(written(html))
  })

  for (const b of builders)
    it(`${b.name}: the parser keeps every element where the anatomy writes it`, () => {
      const anatomy = b.anatomy as Anatomy
      for (const variant of variantsOf(anatomy)) {
        const instance = { ...created(anatomy), ...variant }
        const html = renderAnatomy(
          manifest as unknown as Manifest,
          b.name,
          instance,
        )
        expect(
          parsed(html),
          `${b.name} ${JSON.stringify(variant)}: ${html}`,
        ).toEqual(written(html))
      }
    })
})
