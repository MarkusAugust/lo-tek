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
 *   9. Drop. For every component dropped into every hole that takes other
 *      elements, the manifest says yes, or no and why. A yes is correct
 *      markup. A no because HTML forbids it is one `lotek check` reports.
 *      A no that is LO-TEK's own choice is valid HTML, and `lotek check`
 *      leaves it alone: a developer may write any valid HTML.
 *
 * Capabilities 7 and 8, a Datastar patch and a renderer in Kotlin, are
 * tested in `src/anatomy/patch.browser.test.ts` and `AnatomyCasesTest`.
 *
 * Run with: bun scripts/check-design-tool.ts (after bun run core).
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  type AnatomyInstance,
  canDrop,
  createdInstance,
  type Keyed,
  renderAnatomy,
  withItem,
} from "../src/anatomy/index.js"
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

/** A new component, as the tool creates it: with the package's own function. */
const created = (anatomy: Loose, id: string): Loose =>
  createdInstance(anatomy, id)

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
  // Options that share a name must send different values, or the server
  // cannot tell which was picked. The core does not judge this.
  const sent = new Map<string, string[]>()
  for (const m of markup.matchAll(/<input\b[^>]*>/g)) {
    const name = m[0].match(/\sname="([^"]*)"/)?.[1]
    const type = m[0].match(/\stype="([^"]*)"/)?.[1]
    if (!name || (type !== "radio" && type !== "checkbox")) continue
    sent.set(name, [
      ...(sent.get(name) ?? []),
      m[0].match(/\svalue="([^"]*)"/)?.[1] ?? "on",
    ])
  }
  for (const [name, values] of sent)
    if (new Set(values).size < values.length)
      fail(
        "2. create",
        `${b.name}: the options named ${name} send ${values.join(", ")}, the same twice`,
      )

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
  // values come from that function in the manifest. In a repeat the
  // setting is keyed by the item, for every item. A value other than the
  // option's default must change the markup, or the setting never arrives.
  const effects: [string, (i: Loose) => void, (i: Loose) => void][] = []
  const withSettings = (
    node: Loose,
    target: string,
    repeat: string | undefined,
    choose: (i: Loose) => void,
  ) => {
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
        for (const value of values) {
          const set = (i: Loose) => {
            choose(i)
            const one = { [setting]: value }
            i.settings = {
              ...i.settings,
              [target]: repeat
                ? Object.fromEntries(
                    (i.repeats[repeat] ?? []).map((k: string) => [k, one]),
                  )
                : one,
            }
          }
          const what = `${target} with ${setting} = ${value}`
          changes.push([what, set])
          if (value !== option.default) effects.push([what, set, choose])
        }
      }
  }
  for (const node of nodesOf(anatomy.nodes)) {
    if (node.oneOf)
      for (const [alternative, inner] of Object.entries(node.oneOf) as [
        string,
        Loose,
      ][])
        withSettings(inner, node.name, node.repeat, (i) => {
          i.choices = { ...i.choices, [node.name]: alternative }
        })
    else if (node.name) withSettings(node, node.name, node.repeat, () => {})
  }
  for (const [what, set, choose] of effects) {
    const without = created(anatomy, "c1")
    choose(without)
    const withIt = created(anatomy, "c1")
    set(withIt)
    try {
      if (
        renderAnatomy(manifest, b.name, without) ===
        renderAnatomy(manifest, b.name, withIt)
      )
        fail(
          "3. panel",
          `${b.name}: ${what} changes nothing, so it never arrives`,
        )
    } catch {
      // Reported with the change below.
    }
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
    // The tool fills the new item as it fills a new component.
    const inserted = withItem(anatomy, base, group, "inserted")
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
  // One root: the markup is one element, an end tag closing it, or a void
  // element with nothing after it.
  const first = annotated.match(/^<([a-z][\w-]*)[^>]*>/)
  const single =
    first !== null &&
    (annotated.endsWith(`</${first[1]}>`) || annotated === first[0])
  const tags = [...annotated.matchAll(/<([a-z][\w-]*)([^>]*)>/g)]
  if (!single) fail("6. address", `${b.name} has no single root`)
  for (const [, tag, attributes] of tags)
    if (!/\sdata-node="/.test(attributes))
      fail("6. address", `${b.name}: <${tag}> has no address`)
}

// 9. Drop: every component, as created, into every hole that takes other
// elements, in every component.
/**
 * The host as created, with every optional part and every option a node
 * is there with on, so every hole is written.
 */
const opened = (anatomy: Loose): AnatomyInstance => {
  const parts: Record<string, boolean> = {}
  const options: Record<string, boolean> = {}
  const walk = (children: Loose[] = []) => {
    for (const c of children) {
      if (c.name && (c.optional || c.wrapper)) parts[c.name] = true
      if (c.when) options[c.when] = true
      for (const alternative of Object.values(c.oneOf ?? {}) as Loose[])
        walk([alternative])
      walk(c.children)
    }
  }
  walk(anatomy.nodes)
  return { ...created(anatomy, "c1"), parts, options }
}
let drops = 0
for (const host of palette) {
  const anatomy = host.anatomy as Loose
  for (const [hole, declaration] of Object.entries(anatomy.holes ?? {}) as [
    string,
    Loose,
  ][]) {
    if (declaration.content !== "free") continue
    let yes = 0
    let lotek = 0
    const base = opened(anatomy)
    for (const dropped of palette) {
      const where = `${dropped.name} in ${host.name}.${hole}`
      const answer = canDrop(manifest, dropped.name, [
        { builder: host.name, hole },
      ])
      drops += 1
      // One copy for each item the hole is per, each with ids of its own.
      const per: string[] = declaration.per ?? []
      const fill = (level: number, keys: string[]): Keyed<string> =>
        level === per.length
          ? renderAnatomy(
              manifest,
              dropped.name,
              created(dropped.anatomy, ["c2", ...keys].join("-")),
            )
          : Object.fromEntries(
              (base.repeats?.[per[level]] ?? []).map((k) => [
                k,
                fill(level + 1, [...keys, k]),
              ]),
            )
      const inner = fill(0, [])
      const html = renderAnatomy(manifest, host.name, {
        ...base,
        content: { ...base.content, [hole]: inner },
      })
      // The first copy must be in the markup, or the drop tested nothing.
      let first: Keyed<string> | undefined = inner
      while (first !== undefined && typeof first !== "string")
        first = Object.values(first)[0]
      if (first === undefined || !html.includes(first))
        fail("9. drop", `${where}: the hole is not written`)
      const found = findings(html)
      if (answer.ok) {
        yes += 1
        for (const f of found) fail("9. drop", `${where}: ${f}`)
        continue
      }
      if (!answer.why)
        fail("9. drop", `${where}: the manifest says no without saying why`)
      // The rule must be the one for what HTML forbids, not any finding.
      if (
        answer.by === "html" &&
        !found.some((f) => f.startsWith("invalid-nesting:"))
      )
        fail(
          "9. drop",
          `${where}: the manifest says HTML forbids it, and lotek check does not report it`,
        )
      if (answer.by === "lotek") lotek += 1
      if (answer.by === "lotek")
        for (const f of found)
          fail(
            "9. drop",
            `${where}: LO-TEK's own no, but lotek check reports valid HTML: ${f}`,
          )
    }
    // A hole HTML lets nothing into is a fact; one LO-TEK closes is not.
    if (yes === 0 && lotek > 0)
      fail("9. drop", `${host.name}.${hole} takes no component at all`)
  }
}
if (drops === 0) fail("9. drop", "no hole takes other elements")

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
  `✓ A tool that reads only the manifest can offer, create, set up, fill, insert into and address all ${palette.length} components, and knows every one of ${drops} drops.`,
)
