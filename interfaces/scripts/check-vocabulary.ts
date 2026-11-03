/**
 * Checks that the vocabulary and the editor files on disk are what
 * `generate-vocabulary.ts` would write now, and that `metadata.ts` covers
 * every element the package registers and every class in the CSS, with parts
 * that match the markup on the component pages.
 *
 * The type check covers the attributes: `metadata.ts` writes them as a
 * `Record` over the component's `observedAttributes`, so a missing or extra
 * attribute stops `tsc`. What the type check cannot see is a whole element
 * missing from the list. So `exports` in the package is read here, every
 * module is imported, and every class with `observedAttributes` must have its
 * entry. The list of expected elements comes from the package, not from the
 * metadata, otherwise the guard would only be checking itself.
 *
 * Run with: bun scripts/check-vocabulary.ts, or as part of `bun run build`.
 * Requires `interfaces/dist` to be built.
 *
 * In the build, `generate` has just written the files, so part 1 compares
 * against what was written and finds nothing; it is the CI step that checks
 * nothing is ungenerated that fails a change where the files were not
 * committed. Run on its own, part 1 says whether the files on disk are out of
 * date. Part 2 applies in both cases.
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { classesData, files, ROOT } from "./generate-vocabulary"
import { elements } from "./metadata"

const findings: string[] = []

// 1. The files on disk are up to date. The generator stops on a class with
// no content in `classDocs`, and on a row with no class, and then the message
// is printed here.
let generated: Record<string, string>
try {
  generated = files()
} catch (error) {
  console.error(`  - ${error instanceof Error ? error.message : error}`)
  process.exit(1)
}
for (const [path, expected] of Object.entries(generated)) {
  let actual: string | null = null
  try {
    actual = readFileSync(join(ROOT, path), "utf8")
  } catch {
    // Missing: reported below.
  }
  if (actual === null)
    findings.push(
      `${path} does not exist. Run bun --filter @lo-tek/interfaces vocabulary.`,
    )
  else if (actual !== expected)
    findings.push(
      `${path} is out of date. Run bun --filter @lo-tek/interfaces vocabulary.`,
    )
}

// 2. Every element the package registers has an entry in metadata.ts.
type Component = { observedAttributes: readonly string[] }
const pkg = JSON.parse(
  readFileSync(join(ROOT, "interfaces/package.json"), "utf8"),
)
/*
 * Only the modules that export exactly one element count. The main entry
 * point and `/react` export all nine, and there "the first tag" and "the
 * first class" could belong to different components. A `Map` also keeps the
 * same element from being counted twice when it is behind two entry points.
 */
const registered = new Map<string, readonly string[]>()
/** The parts the module exports in `LT_…_PARTS`, for the elements that have them. */
const exportedParts = new Map<string, Record<string, string>>()
/** Every tag any module exports, the main entry point included. */
const allTags = new Set<string>()
for (const target of Object.values(
  pkg.exports as Record<string, string | Record<string, string>>,
)) {
  const js = typeof target === "string" ? target : target.import
  if (typeof js !== "string" || !js.endsWith(".js")) continue
  const module: Record<string, unknown> = await import(
    join(ROOT, "interfaces", js)
  )
  const tags = Object.entries(module)
    .filter(
      ([name, value]) => name.endsWith("_TAG") && typeof value === "string",
    )
    .map(([, value]) => value as string)
  const components = Object.values(module).filter(
    (value): value is Component =>
      typeof value === "function" && "observedAttributes" in value,
  )
  for (const tag of tags) allTags.add(tag)
  if (tags.length !== 1 || components.length !== 1) continue
  registered.set(tags[0], components[0].observedAttributes)
  const parts = Object.entries(module).filter(([name]) =>
    name.endsWith("_PARTS"),
  )
  if (parts.length > 1)
    findings.push(`<${tags[0]}> exports more than one set of parts`)
  if (parts.length === 1)
    exportedParts.set(tags[0], parts[0][1] as Record<string, string>)
}

const documented = new Map(elements.map((e) => [e.tag, e]))
for (const [tag, attributes] of registered) {
  const doc = documented.get(tag)
  if (!doc) {
    findings.push(
      `<${tag}> is registered in the package, but is missing in metadata.ts`,
    )
    continue
  }
  const missing = attributes.filter((a) => !(a in doc.attributes))
  const extra = Object.keys(doc.attributes).filter(
    (a) => !attributes.includes(a),
  )
  if (missing.length)
    findings.push(`<${tag}> is missing attributes in metadata.ts: ${missing}`)
  if (extra.length)
    findings.push(
      `<${tag}> has attributes in metadata.ts that do not exist: ${extra}`,
    )
}
// A tag that only exists in a module with several elements, such as the main
// entry point, would otherwise silently skip both this check and the metadata.
for (const tag of allTags)
  if (!registered.has(tag))
    findings.push(
      `<${tag}> is exported, but not from an entry point with one element`,
    )
for (const tag of documented.keys())
  if (!registered.has(tag))
    findings.push(
      `<${tag}> is in metadata.ts, but the package does not register it`,
    )

// 2a. Every part the component exports has a description in metadata.ts,
// with the same selector. The type in `parts()` requires it for a component
// in the table; this catches the component that is not in it.
for (const [tag, parts] of exportedParts) {
  const doc = documented.get(tag)?.parts ?? {}
  for (const [name, selector] of Object.entries(parts))
    if (!doc[name])
      findings.push(
        `<${tag}> has the part "${name}", which is missing in metadata.ts`,
      )
    else if (doc[name].selector !== selector)
      findings.push(
        `<${tag}> has a different selector for "${name}" in dist than in the source. Build the package.`,
      )
  for (const name of Object.keys(doc))
    if (!(name in parts))
      findings.push(
        `<${tag}> has the part "${name}" in metadata.ts, but does not export it`,
      )
}

// 2b. The events in metadata.ts are the ones the component dispatches, no
// more and no fewer. The type check does not see this: the name is only in a
// string, in `new CustomEvent("…")` or in the component's own `emit("…")`.
const sourceOf = (tag: string): string | null => {
  const slug = tag.replace(/^lt-/, "")
  for (const category of ["frame", "standalone"]) {
    try {
      return readFileSync(
        join(ROOT, "interfaces/src/components", category, slug, `${tag}.ts`),
        "utf8",
      )
    } catch {
      // Try the next category.
    }
  }
  return null
}
for (const element of elements) {
  const text = sourceOf(element.tag)
  if (text === null) {
    findings.push(`Could not find the source code of <${element.tag}>`)
    continue
  }
  const dispatched = new Set(
    [...text.matchAll(/(?:new CustomEvent|emit)\(\s*"([a-z-]+)"/g)].map(
      (m) => m[1],
    ),
  )
  const described = new Set(Object.keys(element.events))
  for (const name of dispatched)
    if (!described.has(name))
      findings.push(
        `<${element.tag}> dispatches "${name}", which is missing in metadata.ts`,
      )
  for (const name of described)
    if (!dispatched.has(name))
      findings.push(
        `<${element.tag}> has "${name}" in metadata.ts, but does not dispatch it`,
      )
}

// 2c. Every part a class has matches the markup on the component page, and
// `partOf` points at a class with a part that matches this one. The
// selectors are relative to the element with the class, as for the elements,
// so each is put after `.the-class` before it is tried. The pages are read as
// text, and what is tried is every `code={…}` and every ```html block, that
// is everything the reader sees. When a part matches nothing there, the page
// does not show the part, or the selector was written for something other
// than what the page shows.
const classes = classesData()
const PAGES = join(ROOT, "documentation/src/content/docs")
const markupByPage = new Map<string, string>()
function pageMarkup(component: string): string {
  const path = [
    join(PAGES, "components", `${component}.mdx`),
    join(PAGES, `${component}.mdx`),
  ].find((p) => existsSync(p))
  if (!path) {
    findings.push(`Found no page for the component "${component}"`)
    return ""
  }
  let markup = markupByPage.get(path)
  if (markup === undefined) {
    const page = readFileSync(path, "utf8")
    markup = [
      ...[...page.matchAll(/code=\{`([\s\S]*?)`\}/g)].map((m) => m[1]),
      ...[...page.matchAll(/```html\n([\s\S]*?)```/g)].map((m) => m[1]),
    ].join("\n")
    markupByPage.set(path, markup)
  }
  return markup
}
/** The alternatives in a selector list, split on commas outside brackets. */
function alternatives(selector: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i]
    if (c === "(" || c === "[") depth++
    else if (c === ")" || c === "]") depth--
    else if (c === "," && depth === 0) {
      out.push(selector.slice(start, i).trim())
      start = i + 1
    }
  }
  out.push(selector.slice(start).trim())
  return out
}
/** The number of matches for a selector in the markup, with Bun's built-in parser. */
async function matches(selector: string, markup: string): Promise<number> {
  let count = 0
  await new HTMLRewriter()
    .on(selector, {
      element() {
        count++
      },
    })
    .transform(new Response(markup))
    .text()
  return count
}
let classParts = 0
for (const [name, info] of Object.entries(classes)) {
  if (info.partOf !== undefined) {
    const parent = classes[info.partOf]
    if (!parent)
      findings.push(`${name} has partOf "${info.partOf}", which is not a class`)
    else if (
      !Object.values(parent.parts ?? {}).some((part) =>
        // The whole name: `.lt-dialog` must not count as `.lt-dialog__title`.
        new RegExp(`\\.${name}(?![\\w-])`).test(part.selector),
      )
    )
      findings.push(
        `${name} has partOf "${info.partOf}", but ${info.partOf} has no part that matches .${name}`,
      )
  }
  if (!info.parts) continue
  const markup = pageMarkup(info.component)
  for (const [part, { selector }] of Object.entries(info.parts)) {
    classParts++
    const absolute = alternatives(selector)
      .map((s) => `.${name} ${s}`)
      .join(", ")
    if ((await matches(absolute, markup)) === 0)
      findings.push(
        `${name}: the part "${part}" (${selector}) does not match the markup on the page for ${info.component}`,
      )
  }
}

// 3. Every snippet shows its element. "Has markup" was not enough: the
// dialog's snippet had a `<dialog>` and no `<lt-dialog>`.
const snippets = JSON.parse(generated["interfaces/snippets.json"]) as Record<
  string,
  { body: string[] }
>
for (const element of elements) {
  const body = snippets[element.tag]?.body ?? []
  if (!body.some((line) => line.includes(`<${element.tag}`)))
    findings.push(
      `The snippet for <${element.tag}> does not contain the element`,
    )
  // Every id is an empty tab stop, and every pointer mirrors one of them: the
  // id is typed once, and `for` and `href` follow it. A tab stop with the id
  // from the recipe filled in gave two equal ids when the snippet was pasted
  // twice on a page.
  const text = body.join("\n")
  const defined = new Set<string>()
  for (const m of text.matchAll(/\bid="([^"]*)"/g)) {
    const stop = m[1].match(/^\$(\d+)$/)
    if (stop) defined.add(stop[1])
    else
      findings.push(
        `The snippet for <${element.tag}> has id="${m[1]}", which is not an empty tab stop`,
      )
  }
  for (const m of text.matchAll(/(?<!\\)\$\{(\d+):/g))
    findings.push(
      `The snippet for <${element.tag}> fills in tab stop ${m[1]}. The ids are left empty.`,
    )
  for (const m of text.matchAll(/(?<!\\)\$(\d+)\b/g))
    if (!defined.has(m[1]))
      findings.push(
        `The snippet for <${element.tag}> mirrors $${m[1]}, which is not defined`,
      )
}

// The IntelliJ live templates have the same ids as variables.
const liveTemplates = generated["interfaces/live-templates.xml"] ?? ""
for (const element of elements) {
  if (!liveTemplates.includes(`<template name="${element.tag}"`))
    findings.push(`Live templates are missing <${element.tag}>`)
}
for (const m of liveTemplates.matchAll(/id=&quot;([^&]*)&quot;/g))
  if (!/^\$[A-Za-z0-9_]+\$$/.test(m[1]))
    findings.push(
      `Live templates have id=&quot;${m[1]}&quot; without a variable`,
    )
// The Kotlin live templates: one per web component with a kotlinx.html tab, counted in the
// pages rather than in the file, and the ids empty there too.
const kotlinTemplates = generated["interfaces/live-templates-kotlin.xml"] ?? ""
const pagesWithKotlin = elements.filter((element) =>
  readFileSync(
    join(ROOT, `documentation/src/content/docs/components/${element.slug}.mdx`),
    "utf8",
  ).includes('<TabItem label="kotlinx.html">'),
)
const kotlinCount = [...kotlinTemplates.matchAll(/<template name="/g)].length
if (pagesWithKotlin.length === 0 || kotlinCount !== pagesWithKotlin.length)
  findings.push(
    `${pagesWithKotlin.length} pages have a kotlinx.html tab, and there are ${kotlinCount} Kotlin live templates`,
  )
// Every place an id stands is the variable, not only `id = "…"`: a literal
// left behind, such as `it.field == "fixer"`, no longer matches the id the
// user typed.
for (const t of kotlinTemplates.matchAll(
  /<template name="([^"]+)" value="([^"]*)"[^>]*>([\s\S]*?)<\/template>/g,
)) {
  const value = t[2].replace(/&quot;/g, '"')
  for (const v of t[3].matchAll(/<variable name="([^"]+)"/g))
    for (const literal of new Set([v[1], v[1].replace(/_/g, "-")]))
      if (value.includes(`"${literal}"`))
        findings.push(
          `The Kotlin live template ${t[1]} has the id "${literal}" as text next to the variable $${v[1]}$`,
        )
}
for (const m of kotlinTemplates.matchAll(/defaultValue="([^"]*)"/g))
  if (m[1] !== "")
    findings.push(
      `A Kotlin live template fills in ${m[1]}. The ids are left empty.`,
    )
for (const m of liveTemplates.matchAll(/defaultValue="([^"]*)"/g))
  if (m[1] !== "")
    findings.push(
      `A live template fills in ${m[1]}. The ids are left empty, as in the snippets.`,
    )

// 4. Count, last. Both equal to the expected number and greater than zero.
const counted = registered.size
console.log(
  `Checked ${counted} elements in the package against ${documented.size} in metadata.ts, ${exportedParts.size} with parts, ${Object.keys(classes).length} classes with ${classParts} parts, ${Object.keys(snippets).length} snippets and ${Object.keys(generated).length} files`,
)
if (counted === 0)
  findings.push("Found no elements in the package. Is dist built?")
if (exportedParts.size === 0)
  findings.push("Found no parts in the package. Is dist built?")
if (classParts === 0)
  findings.push("No class had parts, so no selector was tried.")

if (findings.length) {
  console.error(findings.map((f) => `  - ${f}`).join("\n"))
  process.exit(1)
}
