/**
 * That the component sheet of the theme builder, `/theme-builder/sheet/`,
 * shows every component, with the markup its own page has, and that the
 * component can be seen there.
 *
 * The sheet is what a theme is looked at on. A component that is not on it
 * is a component nobody sees with the new colours before the theme is in
 * use, and an example written a second time for the sheet is one that
 * drifts from the page it came from. So the sheet is held to two sources it
 * does not write itself: the manifest says which components there are, and
 * `generated/recipes.json` has what each one's page shows. That is its
 * `<Example>`s, or, for a web component whose page has a live demo and no
 * example, the markup of the recipe in its "Plain HTML" tab, without the
 * scripts, which belong to the page template.
 *
 * The comparison is of the parsed elements, not the text: the markup has
 * been through Astro on its way to the page. Both sides are read with the
 * same parser and written out the same way, with the attributes sorted, the
 * white space in a text collapsed, and the comments and the texts that are
 * only white space left out. An example is on the sheet when its elements
 * stand there together, in order, inside the section of its component.
 *
 * Markup that is there is not a component that is seen. A toast without a
 * message, a popover that is closed and a dialog nobody opened are all on
 * the page and show nothing of the theme. So the sheet is opened in a
 * browser, and every class and custom element of a component that is in
 * its section must be rendered there at least once: a box with a width and
 * a height, not `display: none` and not `visibility: hidden`. An element
 * with `display: contents`, as four of the custom elements have, has no box
 * of its own by design, and is rendered when something inside it is. A
 * custom element must also have something rendered inside it.
 *
 * Each example stands in a shadow root of its own, as the previews on the
 * component pages do: an example is a fragment and not a page, and five ids
 * are used by examples of different pages. Side by side in one document a
 * label pointed at the first field with its id, which was another page's.
 * So a section is read through the open shadow roots in it, and the
 * isolation is held: no id is twice in one tree, the document or one shadow
 * root, as built and after the sheet's scripts have run.
 *
 * And an example is shown as its page shows it. The page gives it a layout,
 * a width and CSS of its own, some of it only to force into view what does
 * not show itself in a box. Without them the progress bars lay on top of
 * each other and the buttons touched. So, where the page wrote one: the CSS
 * is in the shadow root of the example, the example stands in an element
 * that names its layout with `data-layout`, and in the browser an element
 * that lays an example out is no wider than the page said. The layout is
 * read from the attribute and the width is measured, so only the attribute
 * is taken from how the previews are written.
 *
 * Run with: bun documentation/scripts/check-theme-sheet.ts
 * Requires `documentation/dist` to be built.
 */

import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { Glob } from "bun"
import { selectAll } from "hast-util-select"
import rehypeParse from "rehype-parse"
import { unified } from "unified"
import { site } from "./site"
import { CONTRACT } from "./theme-recipe"

/** The roles the theme at a glance shows of each family, as CSS writes them. */
const GLANCE_ROLES = [
  "surface",
  "border-subtle",
  "border",
  "border-strong",
  "fill",
  "text-subtle",
  "text",
  "text-strong",
]

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const SHEET = `${ROOT}documentation/dist/theme-builder/sheet/index.html`
const PAGES = `${ROOT}documentation/src/content/docs/`

const manifest = JSON.parse(
  readFileSync(`${ROOT}interfaces/manifest/manifest.json`, "utf8"),
) as {
  classes: Record<string, { component: string; link: string }>
  elements: Record<string, { link: string }>
}
const recipes = JSON.parse(
  readFileSync(`${ROOT}documentation/generated/recipes.json`, "utf8"),
) as {
  pages: {
    path: string
    examples: Shown[]
    tabs: { label: string; blocks: { lang: string | null; code: string }[] }[]
  }[]
}

/** An example, and how its page shows it. A recipe from a tab has only the markup. */
type Shown = {
  code: string
  layout?: string
  maxWidth?: string
  previewCss?: string
  customCss?: string
}

/**
 * The components that are left off the sheet on purpose, each with why. A
 * name here that the manifest does not have fails, so the list cannot keep
 * an exception for something that is gone.
 */
const LEFT_OUT: Record<string, string> = {
  customising:
    "The theme control switches the theme of the page it is on, and the builder has set each frame to light or to dark: a control inside the frame would work against it. The radio buttons it is made of are on the sheet.",
}

const problems: string[] = []

/*
 * The components, and the page of each. A class names its component, and a
 * custom element is `lt-` and its component: `lt-field` is the only one
 * whose component has no class. The page is where the manifest links, so no
 * list of pages is written here.
 */
const components = new Map<string, string>()
const linked = (name: string, link: string) => {
  const path = `${new URL(link).pathname.replace(/^\/|\/$/g, "")}.mdx`
  const before = components.get(name)
  if (before !== undefined && before !== path)
    problems.push(`the manifest links ${name} to both ${before} and ${path}`)
  components.set(name, path)
}
for (const { component, link } of Object.values(manifest.classes))
  linked(component, link)
for (const [tag, { link }] of Object.entries(manifest.elements))
  linked(tag.replace(/^lt-/, ""), link)

if (components.size < 40)
  problems.push(`found only ${components.size} components in the manifest`)

for (const [name, why] of Object.entries(LEFT_OUT)) {
  if (!components.has(name))
    problems.push(
      `${name} is left off the sheet on purpose, and the manifest has no such component`,
    )
  if (why.trim().length < 40)
    problems.push(`${name} is left off the sheet without a reason`)
}
/** The components the sheet shows, and the page of each. */
const shown = new Map([...components].filter(([name]) => !(name in LEFT_OUT)))

// Every component page is the page of a component, so a page the manifest
// does not know cannot be left off the sheet without a word.
const ofAComponent = new Set(components.values())
for (const rel of new Glob("components/*.mdx").scanSync(PAGES)) {
  if (rel !== "components/index.mdx" && !ofAComponent.has(rel))
    problems.push(`${rel} is the page of no component in the manifest`)
}

/**
 * What the sheet shows of each component, from its page: the examples, or
 * the markup of the "Plain HTML" recipe when the page has none. The recipe
 * is the tab's blocks that are not the stylesheets the page needs.
 */
const examples = new Map<string, Shown[]>()
let fromRecipes = 0
for (const [name, path] of shown) {
  const page = recipes.pages.find((p) => p.path === path)
  if (!page) {
    problems.push(`${name}: generated/recipes.json has no ${path}`)
    continue
  }
  if (page.examples.length > 0) {
    examples.set(name, page.examples)
    continue
  }
  const markup = page.tabs
    .filter((tab) => tab.label === "Plain HTML")
    .flatMap((tab) => tab.blocks)
    .filter(
      (b) => b.lang === "html" && !/<link\s[^>]*rel="stylesheet"/.test(b.code),
    )
    .map((b) => b.code)
  if (markup.length === 0) {
    problems.push(
      `${name}: ${path} has neither an <Example> nor a recipe in a "Plain HTML" tab, so the sheet has nothing to show the theme on`,
    )
    continue
  }
  fromRecipes += 1
  examples.set(
    name,
    markup.map((code) => ({ code })),
  )
}

/*
 * The pages give 25 examples a layout and nine their own CSS. A file that
 * records none is one written before the reading knew them, and every
 * example would then pass for having nothing to be held to.
 */
const everyExample = [...examples.values()].flat()
if (
  !everyExample.some((e) => e.layout) ||
  !everyExample.some((e) => e.maxWidth)
)
  problems.push(
    "generated/recipes.json records no layout or no width for any example. Run bun --filter @lo-tek/interfaces generate.",
  )
if (
  !everyExample.some((e) => e.previewCss) ||
  !everyExample.some((e) => e.customCss)
)
  problems.push(
    "generated/recipes.json records no previewCss or no customCss for any example. Run bun --filter @lo-tek/interfaces generate.",
  )

const fragment = unified().use(rehypeParse, { fragment: true })
const wholeDocument = unified().use(rehypeParse)
type Tree = ReturnType<typeof wholeDocument.parse>
type Nodes = Tree | Tree["children"][number]

/** The node written out so that two readings of the same markup are equal. */
function written(node: Nodes): string {
  if (node.type === "text") return node.value.replace(/\s+/g, " ").trim()
  if (node.type === "root") return node.children.map(written).join("")
  // The scripts of a recipe register the component and wire the page, once
  // for the whole app. On the sheet that is the frame's work.
  if (node.type !== "element" || node.tagName === "script") return ""
  const attributes = Object.entries(node.properties)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(
      ([name, value]) =>
        `${name}=${JSON.stringify(Array.isArray(value) ? value.join(" ") : String(value))}`,
    )
    .sort()
  // A `<template>` keeps its children in `content`.
  const children = node.content ? [node.content] : node.children
  return `<${[node.tagName, ...attributes].join(" ")}>${children.map(written).join("")}</${node.tagName}>`
}

let held = 0
let laidOut = 0

if (!existsSync(SHEET)) {
  problems.push(
    "dist/theme-builder/sheet/index.html is not built. The page is src/pages/theme-builder/sheet.astro, and the site is built with bun run build.",
  )
} else {
  const html = readFileSync(SHEET, "utf8")
  const tree = wholeDocument.parse(html)

  /*
   * A document of its own, as the pages under `demo/` are: it is shown in an
   * `<iframe>`, and the header, the sidebar and the search of the
   * documentation would be shown inside it. The marks are the ones every
   * Starlight page has and no demo page has.
   */
  if (!/^<!doctype html>/i.test(html.trimStart()))
    problems.push("the sheet does not start with a doctype")
  if (selectAll("html[lang]", tree).length !== 1)
    problems.push("the sheet has no <html lang>")
  if (
    !selectAll("head > title", tree).some((title) => written(title).length > 15)
  )
    problems.push("the sheet has no <title>")
  for (const mark of [
    "sl-markdown-content",
    "starlight__sidebar",
    "starlight-theme-select",
    "site-search",
    'content="Starlight',
  ]) {
    if (html.includes(mark))
      problems.push(
        `the sheet carries the documentation's chrome: ${mark} is in it`,
      )
  }

  // No id twice in one tree. A `<template shadowrootmode>` becomes a tree
  // of its own, so what is in it is counted there and not in the document.
  const trees: { where: string; ids: string[] }[] = []
  const collect = (node: Nodes, into: string[]) => {
    if (node.type !== "element" && node.type !== "root") return
    if (node.type === "element") {
      if (typeof node.properties.id === "string") into.push(node.properties.id)
      if (node.content) {
        const own: string[] = []
        trees.push({ where: `shadow root ${trees.length}`, ids: own })
        collect(node.content, own)
        return
      }
    }
    for (const child of node.children) collect(child, into)
  }
  const inDocument: string[] = []
  trees.push({ where: "the document", ids: inDocument })
  collect(tree, inDocument)
  for (const { where, ids } of trees) {
    const twice = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))]
    if (twice.length > 0)
      problems.push(
        `as built, ${where} has an id more than once: ${twice.join(", ")}`,
      )
  }
  if (trees.length < 40)
    problems.push(
      `the sheet has ${trees.length - 1} shadow roots as built. Each example should stand in one of its own.`,
    )

  const sections = selectAll("[data-component]", tree)
  const names = sections.map((s) => String(s.properties.dataComponent))
  for (const name of new Set(names)) {
    if (!components.has(name))
      problems.push(
        `the sheet has a section for ${name}, which the manifest does not have`,
      )
    if (name in LEFT_OUT)
      problems.push(
        `the sheet has a section for ${name}, which is left off on purpose: ${LEFT_OUT[name]}`,
      )
    if (names.filter((n) => n === name).length > 1)
      problems.push(`the sheet has more than one section for ${name}`)
  }

  for (const [name, codes] of examples) {
    const section = sections.find((s) => s.properties.dataComponent === name)
    if (!section) {
      problems.push(`the sheet has no section for ${name}`)
      continue
    }
    const inSection = written(section)
    // The shadow roots of the section: what each `<template>` holds.
    const roots = selectAll("template", section).flatMap((t) =>
      t.content ? [t.content] : [],
    )
    const collapsed = (text: string) => text.replace(/\s+/g, " ").trim()
    codes.forEach((shown, index) => {
      const example = written(fragment.parse(shown.code))
      if (example === "") {
        problems.push(`${name}: example ${index + 1} of its page is empty`)
        return
      }
      if (!inSection.includes(example)) {
        problems.push(
          `${name}: example ${index + 1} of its page is not in its section as it stands on the page. It starts ${example.slice(0, 80)}`,
        )
        return
      }
      held += 1

      const root = roots.find((r) => written(r).includes(example))
      const css = root
        ? collapsed(
            selectAll("style", root)
              .flatMap((style) => style.children)
              .map((child) => (child.type === "text" ? child.value : ""))
              .join("\n"),
          )
        : ""
      for (const key of ["previewCss", "customCss"] as const) {
        const own = shown[key]
        if (own === undefined) continue
        if (!css.includes(collapsed(own)))
          problems.push(
            `${name}: example ${index + 1} has a ${key} on its page, and it is not in the shadow root of the example on the sheet`,
          )
        else laidOut += 1
      }
      if (shown.layout !== undefined) {
        if (
          !root ||
          !selectAll(`[data-layout="${shown.layout}"]`, root).some((surface) =>
            written(surface).includes(example),
          )
        )
          problems.push(
            `${name}: example ${index + 1} has layout="${shown.layout}" on its page, and stands in no element with that data-layout on the sheet`,
          )
        else laidOut += 1
      }
    })
  }
}

/*
 * The sheet in a browser, after the web components are registered and have
 * done their work: what of each component is rendered.
 */
type Asked = {
  name: string
  classes: string[]
  element: string | null
  /** The widths the page gives its examples, one per example that has one. */
  widths: string[]
}
const asked: Asked[] = [...shown.keys()].map((name) => ({
  name,
  widths: (examples.get(name) ?? []).flatMap((e) =>
    e.maxWidth === undefined ? [] : [e.maxWidth],
  ),
  classes: Object.entries(manifest.classes)
    .filter(([, c]) => c.component === name)
    .map(([className]) => className),
  element: `lt-${name}` in manifest.elements ? `lt-${name}` : null,
}))

/**
 * Runs in the page. What is in each section and not rendered, how much was,
 * and the ids that are twice in one tree.
 */
function unseen(components: Asked[]): {
  missing: string[]
  seen: number
  roots: number
} {
  /** The tree and every open shadow root below it. */
  const trees = (top: ParentNode): ParentNode[] => [
    top,
    ...[...top.querySelectorAll("*")].flatMap((element) =>
      element.shadowRoot ? trees(element.shadowRoot) : [],
    ),
  ]
  const box = (element: Element) => {
    const { width, height } = element.getBoundingClientRect()
    return width > 0 && height > 0
  }
  const rendered = (element: Element): boolean => {
    const style = getComputedStyle(element)
    if (style.display === "none" || style.visibility === "hidden") return false
    // No box of its own by design: it is rendered when its content is.
    if (style.display === "contents")
      return [...element.querySelectorAll("*")].some(rendered)
    return box(element)
  }
  const missing: string[] = []
  let seen = 0

  const all = trees(document)
  all.forEach((tree, index) => {
    const ids = [...tree.querySelectorAll("[id]")].map((element) => element.id)
    const twice = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))]
    if (twice.length > 0)
      missing.push(
        `${index === 0 ? "the document" : `a shadow root (the ${index}. on the page)`} has an id more than once after the scripts have run: ${twice.join(", ")}`,
      )
  })

  /** A width as the browser computes it, so `26rem` and `416px` are one. */
  const computed = (width: string) => {
    const probe = document.createElement("div")
    probe.style.maxWidth = width
    document.body.append(probe)
    const value = getComputedStyle(probe).maxWidth
    probe.remove()
    return value
  }

  for (const { name, classes, element, widths } of components) {
    const section = document.querySelector(`[data-component="${name}"]`)
    if (!section) continue
    const inSection = trees(section)
    const find = (selector: string) =>
      inSection.flatMap((tree) => [...tree.querySelectorAll(selector)])
    // As many of the elements that lay an example out are held to a width
    // as the page has examples with that width.
    const surfaces = find("[data-layout]").map(
      (surface) => getComputedStyle(surface).maxWidth,
    )
    for (const width of new Set(widths)) {
      const wanted = widths.filter((w) => w === width).length
      const got = surfaces.filter((s) => s === computed(width)).length
      if (got < wanted)
        missing.push(
          `${name}: ${wanted} of its examples are at most ${width} wide on their page, and ${got} are on the sheet`,
        )
      else seen += 1
    }
    const selectors = [
      ...classes.map((c) => `.${c}`),
      ...(element ? [element] : []),
    ]
    const present = selectors.filter((selector) => find(selector).length > 0)
    if (present.length === 0)
      missing.push(
        `${name}: nothing of the component is in its section: no ${selectors.join(", ")}`,
      )
    for (const selector of present) {
      const found = find(selector)
      if (!found.some(rendered))
        missing.push(
          `${name}: ${selector} is in the section ${found.length} times and is rendered in none of them`,
        )
      else if (
        selector === element &&
        !found.some(
          (host) =>
            rendered(host) && [...host.querySelectorAll("*")].some(rendered),
        )
      )
        missing.push(`${name}: <${selector}> has nothing rendered inside it`)
      else seen += 1
    }
  }
  return { missing, seen, roots: all.length - 1 }
}

let code = 0
let seen = 0
let narrowed = 0
if (existsSync(SHEET)) {
  const s = await site({ pages: 1 })
  code = await s.run(async () => {
    const page = await s.open("/theme-builder/sheet/")
    // The theme at a glance stands first, before any component: every
    // colour family of the contract, in its order, with the roles of each.
    // It is where a change of the theme is seen without scrolling
    // (`check-theme-glance.ts`), and it is no component: the count of
    // those is the manifest's, with or without it.
    const glance = await page.evaluate(() => {
      const main = document.querySelector("main")
      const block = document.querySelector<HTMLElement>("[data-glance]")
      const after = [...(main?.children ?? [])].filter(
        (child) => child.tagName !== "H1",
      )
      return {
        count: document.querySelectorAll("[data-glance]").length,
        first: block !== null && after[0] === block,
        afterTitle:
          block !== null &&
          main?.querySelector("h1") !== null &&
          main?.querySelector("h1") !== undefined &&
          (main.querySelector("h1")?.compareDocumentPosition(block) ?? 0) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        component:
          block?.matches(".sheet__component, [data-component]") === true ||
          block?.querySelector(".sheet__component, [data-component]") !== null,
        families: [
          ...(block?.querySelectorAll<HTMLElement>("li[data-family]") ?? []),
        ].map((ramp) => ({
          family: ramp.dataset.family ?? "",
          roles: [...ramp.querySelectorAll<HTMLElement>("[data-role]")].map(
            (role) => role.dataset.role ?? "",
          ),
        })),
        components: document.querySelectorAll(".sheet__component").length,
      }
    })
    if (glance.count !== 1 || !glance.first || !glance.afterTitle)
      s.fail(
        `the sheet has ${glance.count} [data-glance], and it is ${glance.first ? "" : "not "}the first thing in main after the title`,
      )
    if (glance.component)
      s.fail("the theme at a glance is, or holds, a component of the sheet")
    if (
      JSON.stringify(glance.families.map((ramp) => ramp.family)) !==
      JSON.stringify(CONTRACT.families)
    )
      s.fail(
        `the theme at a glance has the families ${glance.families.map((ramp) => ramp.family).join(", ") || "none"}, expected the contract's in order: ${CONTRACT.families.join(", ")}`,
      )
    for (const { family, roles } of glance.families)
      if (JSON.stringify(roles) !== JSON.stringify(GLANCE_ROLES))
        s.fail(
          `the theme at a glance shows ${roles.join(", ") || "no roles"} of ${family}, expected ${GLANCE_ROLES.join(", ")}`,
        )
    if (glance.components !== shown.size)
      s.fail(
        `the sheet has ${glance.components} components beside the theme at a glance, and the manifest gives it ${shown.size}`,
      )
    // Registered first, or an element that has not done its work yet is
    // read as one that shows nothing.
    const elements = asked.flatMap((a) => (a.element ? [a.element] : []))
    const unregistered = await page.evaluate(
      (tags) =>
        Promise.all(
          tags.map((tag) =>
            Promise.race([
              customElements.whenDefined(tag).then(() => ""),
              new Promise<string>((resolve) =>
                setTimeout(() => resolve(tag), 5000),
              ),
            ]),
          ),
        ).then((late) => late.filter((tag) => tag !== "")),
      elements,
    )
    for (const tag of unregistered)
      s.fail(`the sheet does not register <${tag}>`)
    // What opens with a transition is given the time to open, and no more
    // than it needs: the question is put again until nothing is missing.
    let result = await page.evaluate(unseen, asked)
    for (
      let attempt = 0;
      attempt < 12 && result.missing.length > 0;
      attempt++
    ) {
      await page.waitForTimeout(250)
      result = await page.evaluate(unseen, asked)
    }
    for (const finding of result.missing) s.fail(finding)

    /*
     * In a narrow frame the sheet does not scroll sideways: the two frames
     * of the builder are narrow on a small screen, and a page that is wider
     * than its frame is one where every example is cut on the right. What
     * does not fit, as a table, scrolls inside its own preview and can be
     * reached in full there.
     */
    for (const width of [320, 335, 375]) {
      await page.setViewportSize({ width, height: 800 })
      await page.waitForTimeout(300)
      const narrow = await page.evaluate(() => {
        const root = document.documentElement
        const trees = (top: ParentNode): ParentNode[] => [
          top,
          ...[...top.querySelectorAll("*")].flatMap((element) =>
            element.shadowRoot ? trees(element.shadowRoot) : [],
          ),
        ]
        /** A table that is cut and that nothing around it scrolls to. */
        const unreachable = trees(document)
          .flatMap((tree) => [...tree.querySelectorAll("table")])
          .filter((table) => {
            const right = table.getBoundingClientRect().right
            if (right <= root.clientWidth + 1) return false
            for (
              let around: Element | null = table;
              around;
              around = around.parentElement
            ) {
              const overflow = getComputedStyle(around).overflowX
              if (
                (overflow === "auto" || overflow === "scroll") &&
                around.scrollWidth > around.clientWidth
              )
                return false
            }
            return true
          }).length
        return {
          scrollWidth: root.scrollWidth,
          clientWidth: root.clientWidth,
          tables: trees(document).flatMap((tree) => [
            ...tree.querySelectorAll("table"),
          ]).length,
          unreachable,
        }
      })
      if (narrow.scrollWidth > narrow.clientWidth)
        s.fail(
          `at ${width} pixels wide the sheet is ${narrow.scrollWidth} wide and scrolls sideways`,
        )
      if (narrow.tables === 0)
        s.fail(`at ${width} pixels wide the check found no table on the sheet`)
      if (narrow.unreachable > 0)
        s.fail(
          `at ${width} pixels wide ${narrow.unreachable} tables are cut and nothing around them scrolls sideways`,
        )
      narrowed += 1
    }
    if (result.roots < 40)
      s.fail(
        `the sheet has ${result.roots} open shadow roots in the browser. Each example should stand in one of its own.`,
      )
    seen = result.seen
  })
}

if (problems.length > 0) {
  console.error(
    `✗ The component sheet does not show every component with its examples:\n\n${problems.map((p) => `  ${p}`).join("\n")}\n`,
  )
  process.exit(1)
}

if (code !== 0) {
  console.error(
    "✗ The component sheet has components that cannot be seen on it, or the check did not get to look.",
  )
  process.exit(code)
}

// The guard comes last: a run that held or saw nothing must not pass.
if (held === 0 || laidOut === 0 || seen < shown.size || narrowed !== 3) {
  console.error(
    `✗ The check held ${held} examples, ${laidOut} layouts and pieces of CSS, and saw ${seen} classes, elements and widths rendered, for ${shown.size} components. It has not looked at everything.`,
  )
  process.exit(1)
}

console.log(
  `✓ The component sheet has ${shown.size} of the ${components.size} components of the manifest, ${Object.keys(LEFT_OUT).length} left out on purpose, with the ${held} examples and recipes of their pages (${fromRecipes} from a recipe), shown with the ${laidOut} layouts and pieces of CSS their pages give them, and ${seen} classes, elements and widths are rendered on it.`,
)
