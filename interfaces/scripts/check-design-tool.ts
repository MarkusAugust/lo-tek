/**
 * The goal of the anatomies, as a test: a design tool that knows nothing
 * but the manifest can do its job with every component.
 *
 * The tool lets designers make only what can be built. Here it is a few
 * functions that read `manifest.json`, write with `renderAnatomy()` and
 * check with the core, the way `lotek check` does. Nothing in this file
 * may know a component by name: a list of exceptions here is knowledge the
 * manifest lacks, and the test is there to say so.
 *
 * What the tool must be able to do, for every component:
 *
 *   1. Palette. Every builder function either has an anatomy, and is
 *      offered, or is a source in another's, and is not.
 *   2. Create. A component dropped with nothing filled in but the
 *      examples the anatomy gives is correct markup.
 *   3. Panel. Every option the tool shows can take every value it offers,
 *      and the markup stays correct. An option the tool must drive itself
 *      is declared, not guessed.
 *   4. Drop targets. Every hole says what it takes, and says the same as
 *      the class or part around it.
 *   5. Stable. Inserting an item first in a group leaves the ids of the
 *      items already there as they were, so a patch keeps them.
 *   6. Address. The component has one root, and every element the tool
 *      can select has an address that survives a re-render.
 *
 * Run with: bun scripts/check-design-tool.ts (after bun run core).
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { renderAnatomy } from "../src/anatomy/index.js"
import { loadCore } from "../src/diagnostics/core.js"
import type { Manifest } from "../src/vocabulary/types.js"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const manifestText = readFileSync(join(ROOT, "manifest/manifest.json"), "utf8")
const manifest = JSON.parse(manifestText) as Manifest
const core = loadCore(readFileSync(join(ROOT, "core/lotek-core.wasm")))
core.loadManifest(manifestText)

// The anatomy as the tool reads it. Loose on purpose: the tool reads what
// the manifest says, and a field it needs and does not find is a finding.
// biome-ignore lint/suspicious/noExplicitAny: see above
type Loose = any

const failures = new Map<string, string[]>()
const fail = (capability: string, message: string) =>
  failures.set(capability, [...(failures.get(capability) ?? []), message])

/** A page around the markup, so the core checks it as a page. */
const page = (body: string) =>
  `<!doctype html><html lang="en"><head><title>Tool</title></head><body><main><h1>Tool</h1>${body}</main></body></html>`

const findings = (html: string) =>
  core.diagnosePage(page(html)).map((f) => `${f.rule}: ${f.message}`)

/**
 * A new component, as the tool creates it on a drop: an id for it, keys
 * for the fewest items each group may have, and every declared hole filled
 * with the example the anatomy gives, for each item it is per. The tool
 * invents nothing but the keys, which are its own.
 */
function created(anatomy: Loose, id: string): Loose {
  const repeats: Record<string, string[]> = {}
  for (const [group, { min }] of Object.entries(anatomy.repeats ?? {}) as [
    string,
    Loose,
  ][])
    repeats[group] = Array.from({ length: min }, (_, i) => `${group}${i + 1}`)
  const perItem = (per: string[], value: unknown): unknown =>
    per.length === 0
      ? value
      : Object.fromEntries(
          repeats[per[0]].map((key) => [key, perItem(per.slice(1), value)]),
        )
  const holes: Record<string, unknown> = {}
  const content: Record<string, unknown> = {}
  for (const [name, hole] of Object.entries(anatomy.holes ?? {}) as [
    string,
    Loose,
  ][]) {
    if (hole.example === undefined) continue
    const value = perItem(hole.per ?? [], hole.example)
    if (hole.content === "free") content[name] = value
    else holes[name] = value
  }
  return { id, repeats, holes, content }
}

// 1. Palette.
const sources = new Set<string>()
const collectSources = (children: Loose[] = []) => {
  for (const child of children) {
    for (const s of child.from ?? []) sources.add(String(s).split(".")[0])
    for (const alt of Object.values(child.oneOf ?? {}) as Loose[])
      collectSources([alt])
    collectSources(child.children)
  }
}
for (const b of manifest.builders)
  if (b.anatomy) collectSources([...b.anatomy.nodes] as Loose[])
const palette = manifest.builders.filter((b) => b.anatomy)
for (const b of manifest.builders)
  if (!b.anatomy && !sources.has(b.name))
    fail(
      "1. palette",
      `lt.${b.name} has no anatomy and is in none, so the tool can neither offer it nor build it`,
    )

for (const b of palette) {
  const anatomy = b.anatomy as Loose

  // 2. Create.
  let markup = ""
  try {
    markup = renderAnatomy(manifest, b.name, created(anatomy, "c1"))
  } catch (error) {
    fail(
      "2. create",
      `${b.name}: ${error instanceof Error ? error.message : error}`,
    )
    continue
  }
  for (const f of findings(markup)) fail("2. create", `${b.name}: ${f}`)

  // 3. Panel: every option the tool shows, with every value it offers.
  const driven = new Set(Object.keys(anatomy.options ?? {}))
  for (const option of b.options) {
    if (driven.has(option.name)) continue
    if (!option.description)
      fail("3. panel", `${b.name}.${option.name} has no description to show`)
    const tried: readonly unknown[] =
      option.type.kind === "values"
        ? option.type.values
        : option.type.kind === "flag"
          ? [true]
          : option.type.kind === "number"
            ? [0, 3]
            : option.type.kind === "text"
              ? ["A text a designer wrote"]
              : [["a"]]
    for (const value of tried) {
      const instance = created(anatomy, "c1")
      instance.options = { ...instance.options, [option.name]: value }
      let html = ""
      try {
        html = renderAnatomy(manifest, b.name, instance)
      } catch (error) {
        fail(
          "3. panel",
          `${b.name} with ${option.name} = ${JSON.stringify(value)}: ${error instanceof Error ? error.message : error}`,
        )
        continue
      }
      for (const f of findings(html))
        fail(
          "3. panel",
          `${b.name} with ${option.name} = ${JSON.stringify(value)}: ${f}`,
        )
    }
  }

  // 3. Panel, inside the component: every alternative of every choice,
  // every optional part on and off, every tag a node offers, and every
  // value of every setting a node takes. Each is one change from the
  // created component, as a designer makes it.
  const nodesOf = (children: Loose[] = []): Loose[] =>
    children.flatMap((c) =>
      c.hole
        ? []
        : c.oneOf
          ? [
              c,
              ...(Object.values(c.oneOf) as Loose[]).flatMap((a) => [
                a,
                ...nodesOf(a.children),
              ]),
            ]
          : [c, ...nodesOf(c.children)],
    )
  const changes: [string, (i: Loose) => void][] = []
  for (const node of nodesOf(anatomy.nodes)) {
    if (node.oneOf)
      for (const alternative of Object.keys(node.oneOf))
        changes.push([
          `${node.name} = ${alternative}`,
          (i) => {
            i.choices = { ...i.choices, [node.name]: alternative }
          },
        ])
    if (node.name && (node.optional || node.wrapper))
      for (const on of [true, false])
        changes.push([
          `${node.name} ${on ? "on" : "off"}`,
          (i) => {
            i.parts = { ...i.parts, [node.name]: on }
          },
        ])
    if (node.name && Array.isArray(node.tag))
      for (const tag of node.tag)
        changes.push([
          `${node.name} as <${tag}>`,
          (i) => {
            i.tags = { ...i.tags, [node.name]: tag }
          },
        ])
  }
  // A setting is an option of a builder function the node calls; the
  // values come from that function in the manifest.
  for (const choice of nodesOf(anatomy.nodes).filter((n) => n.oneOf))
    for (const [alternative, node] of Object.entries(choice.oneOf) as [
      string,
      Loose,
    ][])
      for (const setting of node.settings ?? [])
        for (const source of node.from ?? []) {
          const builder = manifest.builders.find(
            (x) => x.name === String(source).split(".")[0],
          )
          const option = builder?.options.find((o) => o.name === setting)
          if (!option) continue
          const values =
            option.type.kind === "values"
              ? option.type.values
              : option.type.kind === "flag"
                ? [true]
                : []
          for (const value of values)
            changes.push([
              `${choice.name} = ${alternative} with ${setting} = ${value}`,
              (i) => {
                i.choices = { ...i.choices, [choice.name]: alternative }
                i.settings = {
                  ...i.settings,
                  [choice.name]: { [setting]: value },
                }
              },
            ])
        }
  for (const [what, change] of changes) {
    const instance = created(anatomy, "c1")
    change(instance)
    let html = ""
    try {
      html = renderAnatomy(manifest, b.name, instance)
    } catch (error) {
      fail(
        "3. panel",
        `${b.name} with ${what}: ${error instanceof Error ? error.message : error}`,
      )
      continue
    }
    for (const f of findings(html))
      fail("3. panel", `${b.name} with ${what}: ${f}`)
  }

  // 4. Drop targets: every hole in the tree is declared with what it takes.
  const declared = anatomy.holes ?? {}
  const holesIn = (children: Loose[] = []): string[] =>
    children.flatMap((c) => [
      ...(c.hole && !c.kind ? [c.hole] : []),
      ...holesIn(c.children),
      ...(Object.values(c.oneOf ?? {}) as Loose[]).flatMap((a) => holesIn([a])),
    ])
  for (const hole of new Set(holesIn(anatomy.nodes)))
    if (!declared[hole]?.content)
      fail(
        "4. drop targets",
        `${b.name}: the hole ${hole} does not say what it takes`,
      )

  // 5. Stable: an item inserted first leaves the others' ids alone.
  for (const group of Object.keys(anatomy.repeats ?? {})) {
    const base = created(anatomy, "c1")
    const before = renderAnatomy(manifest, b.name, base)
    const inserted = created(anatomy, "c1")
    inserted.repeats[group] = ["inserted", ...inserted.repeats[group]]
    let after = ""
    try {
      after = renderAnatomy(manifest, b.name, inserted)
    } catch (error) {
      fail(
        "5. stable",
        `${b.name}: inserting into ${group}: ${error instanceof Error ? error.message : error}`,
      )
      continue
    }
    const ids = (html: string) =>
      [...html.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1])
    for (const id of ids(before))
      if (!ids(after).includes(id))
        fail(
          "5. stable",
          `${b.name}: inserting into ${group} took away the id ${id}`,
        )
  }

  // 6. Address: one root, and an address on every element the anatomy
  // writes. What is dropped into a hole is the tool's own node, with its
  // own address, so the holes are left empty here.
  const annotated = renderAnatomy(manifest, b.name, {
    ...created(anatomy, "c1"),
    content: {},
    annotate: (path: string) => ({ "data-node": path }),
  })
  const roots = annotated.match(/^(<[a-z][\w-]*)/)
  const tags = [...annotated.matchAll(/<([a-z][\w-]*)([^>]*)>/g)]
  if (!roots || !annotated.endsWith(`</${roots[1].slice(1)}>`))
    fail("6. address", `${b.name} has no single root`)
  for (const [, tag, attributes] of tags)
    if (!/\sdata-node="/.test(attributes))
      fail("6. address", `${b.name}: <${tag}> has no address`)
}

const total = [...failures.values()].reduce((n, list) => n + list.length, 0)
if (total) {
  for (const [capability, list] of [...failures].sort()) {
    console.error(`✗ ${capability}: ${list.length}`)
    for (const line of list.slice(0, 8)) console.error(`    ${line}`)
    if (list.length > 8) console.error(`    … and ${list.length - 8} more`)
  }
  process.exit(1)
}
console.log(
  `✓ A tool that reads only the manifest can offer, create, set up, fill, insert into and address all ${palette.length} components.`,
)
