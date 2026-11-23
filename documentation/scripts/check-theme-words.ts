/**
 * That the theme builder and the page about your own theme say who decides
 * what, and that the two are tied together.
 *
 * A theme is a few choices of yours and many of the generator's, and the
 * builder shows only the first. Someone who wants a darker button than the
 * generator gives needs to be told that it is the generator's, why, and
 * what the way out is, before they look for a field that is not there. So
 * the page about your own theme has a section for it, and the builder
 * links to it.
 *
 * The sentences are free. Three things are held, because they rot without
 * anyone reading them again:
 *
 * - the links land: from the builder to the section, from the builder to
 *   the page about customising, and from the section on to the three
 *   headings it rests on and to that same page;
 * - what the section says you decide is every group of keys the recipe has,
 *   read from `theme.schema.json`. A key that is added to the recipe and
 *   not to the sentence is a choice the reader is not told they have;
 * - the section is the one about who decides.
 *
 * Run with: bun documentation/scripts/check-theme-words.ts
 * Requires `documentation/dist` to be built.
 */

import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { select, selectAll } from "hast-util-select"
import { toText } from "hast-util-to-text"
import rehypeParse from "rehype-parse"
import { unified } from "unified"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const DIST = `${ROOT}documentation/dist`

const parser = unified().use(rehypeParse)
type Tree = ReturnType<typeof parser.parse>
type Element = Extract<Tree["children"][number], { type: "element" }>

const problems: string[] = []
const collapsed = (text: string) => text.replace(/\s+/g, " ").trim()

/** A built page, parsed, or nothing when the site does not have it. */
const pages = new Map<string, Tree | null>()
function built(path: string): Tree | null {
  if (!pages.has(path)) {
    const file = `${DIST}${path}index.html`
    pages.set(
      path,
      existsSync(file) ? parser.parse(readFileSync(file, "utf8")) : null,
    )
  }
  return pages.get(path) ?? null
}

/** Where an address of the site leads: the page, and the element of its fragment. */
function lands(href: string, from: string) {
  const [path, fragment] = href.split("#") as [string, string | undefined]
  const page = built(path === "" ? from : path)
  const target =
    page && fragment ? (select(`[id="${fragment}"]`, page) ?? null) : null
  return { path: path === "" ? from : path, fragment, page, target }
}
/** Files what is wrong with where a link leads, and gives the target when all is well. */
function held(what: string, href: string, from: string) {
  const { path, fragment, page, target } = lands(href, from)
  if (!page)
    problems.push(`${what} leads to ${path}, which the site does not have`)
  else if (fragment && !target)
    problems.push(
      `${what} leads to ${href}, and ${path} has nothing with that id`,
    )
  return target
}
/**
 * The addresses a part of a page links to, each as the place on the site it
 * leads to from that page: `../customising/#x` on `/your-own-theme/` is
 * `/customising/#x`, and `#x` is `/your-own-theme/#x`. The pages link to
 * each other relatively, so an address is only comparable once it is
 * resolved. A link that leaves the site is left out.
 */
const SITE = "https://site.invalid"
const hrefs = (within: Tree | Element, from: string) =>
  selectAll("a[href]", within).flatMap((a) => {
    const url = new URL(String(a.properties.href), `${SITE}${from}`)
    return url.origin === SITE ? [`${url.pathname}${url.hash}`] : []
  })

/*
 * The builder: its introduction leads to the section, and what stands by
 * the recipe leads to the page about customising.
 */
const builder = built("/theme-builder/")
const page = built("/your-own-theme/")
if (!builder || !page) {
  console.error(
    "✗ dist has no /theme-builder/ or no /your-own-theme/. The site is built with bun run build.",
  )
  process.exit(1)
}

/** The fragment of the section, as the builder links to it. */
let section: string | undefined
{
  // The introduction: what stands between the heading of the page and the
  // next heading.
  const all = selectAll("*", builder)
  const from = all.findIndex((e) => e.tagName === "h1")
  const next = all.findIndex((e, i) => i > from && /^h[2-6]$/.test(e.tagName))
  const intro = hrefs(
    {
      type: "root",
      children: all
        .slice(from + 1, next < 0 ? undefined : next)
        .filter((e) => e.tagName === "a"),
    },
    "/theme-builder/",
  ).filter((href) => href.startsWith("/your-own-theme/#"))
  if (intro.length === 0)
    problems.push(
      "the introduction of the theme builder has no link to a section of /your-own-theme/",
    )
  for (const href of intro) {
    const target = held(
      "the introduction of the theme builder",
      href,
      "/theme-builder/",
    )
    if (!target) continue
    if (!/^h[2-6]$/.test(target.tagName) || !/decides/i.test(toText(target)))
      problems.push(
        `the introduction of the theme builder leads to ${href}, which is "${collapsed(toText(target)).slice(0, 60)}" and not the heading about who decides`,
      )
    else section = href.split("#")[1]
  }

  // By the recipe as a file: in the part of the page that has the recipe and
  // neither the form nor the frames.
  const beside = selectAll("*", builder).filter(
    (e) =>
      select("[data-recipe]", e) &&
      !select("iframe", e) &&
      !select('input[name="accent"]', e),
  )
  const customising = beside
    .flatMap((e) => hrefs(e, "/theme-builder/"))
    .filter((href) => href.startsWith("/customising/"))
  if (customising.length === 0)
    problems.push(
      "nothing by the recipe file on the theme builder links to /customising/",
    )
  for (const href of new Set(customising))
    held(
      "the link by the recipe file on the theme builder",
      href,
      "/theme-builder/",
    )
}

/*
 * The section on the page: from its heading to the next of the same level,
 * among the blocks of the page's text.
 */
const content = select(".sl-markdown-content", page)
const blocks = (content?.children ?? []).filter(
  (child): child is Element => child.type === "element",
)
const heading = (block: Element, levels: string) =>
  selectAll(levels, { type: "root", children: [block] })[0]
const start = blocks.findIndex(
  (block) =>
    section !== undefined &&
    heading(block, "h2, h3")?.properties.id === section,
)
if (section !== undefined && start < 0)
  problems.push(
    `the heading #${section} is not a heading of the text of /your-own-theme/`,
  )
if (start >= 0) {
  const level = heading(blocks[start], "h2, h3").tagName
  const end = blocks.findIndex(
    (block, i) =>
      i > start &&
      heading(block, level === "h2" ? "h2" : "h2, h3") !== undefined,
  )
  const inSection = blocks.slice(start + 1, end < 0 ? undefined : end)
  const whole: Tree = { type: "root", children: inSection }

  /*
   * What you decide: the part of the section that says so. A part with a
   * heading of its own that has "you decide" in it, or else the first
   * paragraph or list item that has.
   */
  const says = (element: Element) => /\byou decide\b/i.test(toText(element))
  const sub = inSection.findIndex((block) => {
    const h = heading(block, "h3, h4")
    return h !== undefined && says(h)
  })
  let yours = ""
  if (sub >= 0) {
    const next = inSection.findIndex(
      (block, i) => i > sub && heading(block, "h3, h4") !== undefined,
    )
    yours = inSection
      .slice(sub, next < 0 ? undefined : next)
      .map((block) => toText(block))
      .join(" ")
  } else {
    const part = selectAll("p, li, dd", whole).find(says)
    yours = part ? toText(part) : ""
  }
  yours = collapsed(yours)
  if (yours === "")
    problems.push(
      'the section does not say what you decide: no heading, paragraph or list item in it has the words "you decide"',
    )

  /*
   * The groups of keys the recipe has, each with the word a reader knows
   * it by. Every key of the schema belongs to one, or the check stops: a
   * key that is added to the recipe has to be added to the sentence.
   */
  const GROUPS: [string, (key: string) => boolean, RegExp[]][] = [
    [
      "the colours, by hue",
      (key) => !key.includes("."),
      [/\bcolou?rs?\b/i, /\bhues?\b/i],
    ],
    // "font weights" is the weights, and not the font.
    [
      "the font",
      (key) => key === "typography.fontFamily",
      [/\bfont\b(?!\s+weights?)/i],
    ],
    [
      "the weights",
      (key) => key.startsWith("typography.weights."),
      [/\bweights?\b/i],
    ],
    [
      "the line heights",
      (key) => key.startsWith("typography.lineHeights."),
      [/\bline[- ]heights?\b/i],
    ],
    [
      "the corners",
      (key) => /^shape\.[a-z]+Radius$/.test(key),
      [/\bcorners?\b|\bradius\b|\bradii\b/i],
    ],
    [
      "the border of the button",
      (key) => key === "shape.buttonBorderWidth",
      [/\bborder\b/i, /\bbuttons?\b/i],
    ],
    [
      "the weight of the button text",
      (key) => key === "shape.buttonFontWeight",
      [/\bweights?\b/i, /\bbuttons?\b/i],
    ],
  ]
  type Schema = { properties?: Record<string, Schema> }
  const leaves = (at: Schema, path = ""): string[] =>
    Object.entries(at.properties ?? {}).flatMap(([name, property]) =>
      path === "" && name === "$schema"
        ? []
        : property.properties
          ? leaves(property, `${path}${name}.`)
          : [`${path}${name}`],
    )
  const keys = leaves(
    JSON.parse(
      readFileSync(`${ROOT}interfaces/src/tokens/theme.schema.json`, "utf8"),
    ) as Schema,
  )
  if (keys.length < 20)
    problems.push(`read only ${keys.length} keys from the schema`)
  for (const key of keys)
    if (!GROUPS.some(([, has]) => has(key)))
      problems.push(
        `the schema has a key the section does not mention: ${key} belongs to no group the check knows a word for`,
      )
  if (yours !== "")
    for (const [name, has, words] of GROUPS) {
      const of = keys.filter(has)
      if (of.length === 0)
        problems.push(
          `the check has words for ${name}, and the schema has no such key`,
        )
      else if (!words.every((word) => word.test(yours)))
        problems.push(
          `what you decide does not mention ${name} (${of.join(", ")}): it has no ${words.map(String).join(" and ")}`,
        )
    }

  /*
   * The section links on: to the three headings it rests on, found by what
   * they are called, and to the page about customising.
   */
  const links = hrefs(whole, "/your-own-theme/")
  const headings = selectAll("h2, h3, h4", page)
  for (const title of [
    "What the generator does",
    "What the generator does not do",
    "The theme beats the defaults",
  ]) {
    const id = headings.find((h) => collapsed(toText(h)) === title)?.properties
      .id
    if (!id) problems.push(`/your-own-theme/ has no heading "${title}"`)
    else if (!links.includes(`/your-own-theme/#${id}`))
      problems.push(`the section does not link to "${title}" (#${id})`)
  }
  const customising = links.filter((href) => href.startsWith("/customising/"))
  if (customising.length === 0)
    problems.push("the section does not link to /customising/")
  for (const href of new Set(customising))
    held("the section about who decides", href, "/your-own-theme/")
}

if (problems.length > 0) {
  console.error(
    `✗ The theme builder and the page about your own theme do not say who decides what, or are not tied together:\n\n${problems.map((p) => `  ${p}`).join("\n")}\n`,
  )
  process.exit(1)
}

console.log(
  "✓ The theme builder leads to the section about who decides what, the section names every group of keys the recipe has, and its links land.",
)
