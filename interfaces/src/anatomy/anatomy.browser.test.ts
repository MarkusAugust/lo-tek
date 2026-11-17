import { describe, expect, it } from "vitest"

import manifest from "../../manifest/manifest.json"
import type { Anatomy, AnatomyChild, Manifest } from "../vocabulary/types"
import {
  type AnatomyInstance,
  canDrop,
  createdInstance,
  type Keyed,
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

/**
 * The host as created, with every optional part and every option a node is
 * there with on, so every hole is written.
 */
function opened(anatomy: Anatomy): AnatomyInstance {
  const parts: Record<string, boolean> = {}
  const options: Record<string, boolean> = {}
  const walk = (children: readonly AnatomyChild[] = []) => {
    for (const c of children) {
      if ("hole" in c) continue
      for (const node of "oneOf" in c ? Object.values(c.oneOf) : [c]) {
        if (node.name && (node.optional || node.wrapper))
          parts[node.name] = true
        if (node.when) options[node.when] = true
        walk(node.children)
      }
    }
  }
  walk(anatomy.nodes)
  return { ...created(anatomy), parts, options }
}

/** The component as created, with one item in a group that may have none. */
function created(anatomy: Anatomy, id = "c1"): AnatomyInstance {
  let instance = createdInstance(anatomy, id)
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

  it("refuse a path a tool cannot build", () => {
    // A hole that lets only some in, and a host with a hole of its own that
    // it does not let in.
    const m = manifest as unknown as Manifest
    const holes = (b: (typeof builders)[number]) =>
      Object.entries((b.anatomy as Anatomy).holes)
    const outer = builders.flatMap((b) =>
      holes(b).flatMap(([hole, h]) =>
        h.only ? [{ b, hole, only: h.only }] : [],
      ),
    )[0]
    expect(outer, "a hole that lets only some in").toBeDefined()
    const host = builders.flatMap((b) =>
      !outer.only.builders.includes(b.name) && !(b.anatomy as Anatomy).page
        ? holes(b).flatMap(([hole, h]) =>
            h.content === "free" ? [{ b, hole }] : [],
          )
        : [],
    )[0]
    expect(host, "a host it does not let in").toBeDefined()
    expect(() =>
      canDrop(m, "button", [
        { builder: outer.b.name, hole: outer.hole },
        { builder: host.b.name, hole: host.hole },
      ]),
    ).toThrow(
      `canDrop: ${host.b.name} cannot stand in ${outer.b.name}.${outer.hole}`,
    )
  })

  for (const host of builders)
    for (const [hole, declaration] of Object.entries(
      (host.anatomy as Anatomy).holes,
    )) {
      if (declaration.content !== "free") continue
      it(`${host.name}.${hole}: every component the manifest lets in stays where it is dropped`, () => {
        const m = manifest as unknown as Manifest
        const base = opened(host.anatomy as Anatomy)
        let dropped = 0
        for (const b of builders) {
          if (!canDrop(m, b.name, [{ builder: host.name, hole }]).ok) continue
          dropped += 1
          // One copy for each item the hole is per, with ids of its own.
          const per = declaration.per ?? []
          const fill = (level: number, keys: string[]): Keyed<string> =>
            level === per.length
              ? renderAnatomy(
                  m,
                  b.name,
                  created(b.anatomy as Anatomy, ["c2", ...keys].join("-")),
                )
              : Object.fromEntries(
                  (base.repeats?.[per[level]] ?? []).map((k) => [
                    k,
                    fill(level + 1, [...keys, k]),
                  ]),
                )
          const html = renderAnatomy(m, host.name, {
            ...base,
            content: { ...base.content, [hole]: fill(0, []) },
          })
          expect(
            parsed(html),
            `${b.name} in ${host.name}.${hole}: ${html}`,
          ).toEqual(written(html))
        }
        expect(dropped, "the hole takes some component").toBeGreaterThan(0)
      })
    }
})
