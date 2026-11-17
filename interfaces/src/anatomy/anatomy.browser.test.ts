import { describe, expect, it } from "vitest"

import manifest from "../../manifest/manifest.json"
import type { Anatomy, Manifest } from "../vocabulary/types"
import { type AnatomyInstance, renderAnatomy } from "./index"

/*
 * The browser's own HTML parser is the witness the core cannot be: it
 * moves an element that may not stand where it is, as a <div> out of a
 * <p> or an <li> without a list. Every anatomy, as created and with every
 * alternative of every choice and every optional part, must come out of
 * the parser with every element at the depth it was written at.
 */

const VOID = new Set([
  "area",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
])

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

/** The component as a tool creates it, with every example filled in. */
function created(anatomy: Anatomy): AnatomyInstance {
  const repeats: Record<string, string[]> = {}
  for (const [group, { min }] of Object.entries(anatomy.repeats ?? {}))
    repeats[group] = Array.from(
      { length: Math.max(min, 1) },
      (_, i) => `${group}${i + 1}`,
    )
  const perItem = (per: readonly string[], value: string): unknown =>
    per.length === 0
      ? value
      : Object.fromEntries(
          repeats[per[0]].map((key) => [key, perItem(per.slice(1), value)]),
        )
  const holes: Record<string, unknown> = {}
  const content: Record<string, unknown> = {}
  for (const [name, hole] of Object.entries(anatomy.holes)) {
    if (hole.example === undefined) continue
    ;(hole.content === "free" ? content : holes)[name] = perItem(
      hole.per ?? [],
      hole.example,
    )
  }
  return { id: "c1", repeats, holes, content } as AnatomyInstance
}

/** Every choice with its alternatives, and every optional node's name. */
function variants(anatomy: Anatomy): Partial<AnatomyInstance>[] {
  const out: Partial<AnatomyInstance>[] = [{}]
  const walk = (value: unknown) => {
    if (value === null || typeof value !== "object") return
    const node = value as {
      name?: string
      oneOf?: Record<string, unknown>
      optional?: true
      wrapper?: true
    }
    if (node.oneOf && node.name)
      for (const alternative of Object.keys(node.oneOf))
        out.push({ choices: { [node.name]: alternative } })
    if (node.name && (node.optional || node.wrapper))
      out.push({ parts: { [node.name]: true } })
    for (const child of Object.values(value)) walk(child)
  }
  walk(anatomy.nodes)
  return out
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
      for (const variant of variants(anatomy)) {
        const instance = { ...created(anatomy), ...variant }
        let html: string
        try {
          html = renderAnatomy(
            manifest as unknown as Manifest,
            b.name,
            instance,
          )
        } catch {
          // An instance the anatomy refuses, as a subtitle without its header,
          // writes nothing to parse; check-design-tool.ts holds what it allows.
          continue
        }
        expect(
          parsed(html),
          `${b.name} ${JSON.stringify(variant)}: ${html}`,
        ).toEqual(written(html))
      }
    })
})
