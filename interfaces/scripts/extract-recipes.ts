/**
 * Reads every MDX page of the documentation once, as a tree, and writes the
 * recipes on them to `documentation/generated/recipes.json`.
 *
 * The pages were read as text by seven readers, each with its own pattern
 * (`tabItems`, `kotlinBlocks`, `ExtractRecipes.kt`), and a tab written a
 * little differently was missed by one of them. Every reader now takes the
 * file, and only this script reads the pages.
 *
 * Run with: bun scripts/extract-recipes.ts, the first step of `generate`.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { Glob } from "bun"
import remarkMdx from "remark-mdx"
import remarkParse from "remark-parse"
import { unified } from "unified"
import {
  pageSetup,
  type Setup,
  selfTest as setupSelfTest,
  type Target,
} from "./page-setup"
import { RECIPES } from "./recipes"

export interface Block {
  lang: string | null
  meta: string | null
  code: string
}

export interface Tab {
  label: string
  /** Which `<Tabs>` on the page it stands in, counted from 0. */
  group: number
  /** The `##` heading above it, or `null` before the first one. */
  section: string | null
  blocks: Block[]
}

/** An `<Example>`: the markup in `code`, and the blocks in its slots. */
export interface Example {
  section: string | null
  /** `<Example recipe>`: the code tabs show the setup the markup needs. */
  recipe: boolean
  code: string
  ts: Block[]
  kotlin: Block[]
}

export interface Page {
  tabs: Tab[]
  examples: Example[]
  /** The blocks outside every tab and example: prose that shows code. */
  rest: Array<Block & { section: string | null }>
  /** The inline code in the prose, inside tabs too: `lt.button.variants`. */
  inline: string[]
}

interface Node {
  type: string
  name?: string | null
  lang?: string | null
  meta?: string | null
  value?: string
  attributes?: Array<{ type: string; name?: string; value?: unknown }>
  children?: Node[]
  position?: { start: { line: number } }
  depth?: number
}

const parser = unified().use(remarkParse).use(remarkMdx)

/** A string attribute on a JSX element, by name, wherever it stands. */
function attribute(node: Node, name: string): string | undefined {
  const found = node.attributes?.find(
    (a) => a.type === "mdxJsxAttribute" && a.name === name,
  )
  return typeof found?.value === "string" ? found.value : undefined
}

/** The text of a node, as a reader sees it. */
function textOf(node: Node): string {
  if (node.type === "text" || node.type === "inlineCode")
    return node.value ?? ""
  return (node.children ?? []).map(textOf).join("")
}

/** Every fenced block below a node, in document order. */
function blocksIn(node: Node): Block[] {
  if (node.type === "code")
    return [
      {
        lang: node.lang ?? null,
        meta: node.meta ?? null,
        code: node.value ?? "",
      },
    ]
  return (node.children ?? []).flatMap(blocksIn)
}

/**
 * An attribute written as a template literal, `code={`…`}`, as JavaScript
 * reads it: escapes resolved. An interpolation would need the page's own
 * variables, so it stops the reading rather than giving a guess.
 */
function templateAttribute(node: Node, name: string): string | undefined {
  const found = node.attributes?.find(
    (a) => a.type === "mdxJsxAttribute" && a.name === name,
  )
  if (found === undefined) return undefined
  const value = found.value as
    | { data?: { estree?: { body: Array<{ expression?: Template }> } } }
    | undefined
  const template = value?.data?.estree?.body[0]?.expression
  if (template?.type !== "TemplateLiteral" || template.expressions.length > 0)
    throw new Error(
      `line ${node.position?.start.line}: the ${name} of an <${node.name}> must be a template literal without \${…}`,
    )
  return template.quasis[0].value.cooked
}

interface Template {
  type: string
  expressions: unknown[]
  quasis: Array<{ value: { cooked: string } }>
}

/**
 * The blocks in `<Fragment slot="…">` anywhere inside a node: a slot wrapped
 * in another element is still the slot Astro fills.
 */
function slot(node: Node, name: string): Block[] {
  if (isElement(node, "Fragment") && attribute(node, "slot") === name)
    return blocksIn(node)
  return (node.children ?? []).flatMap((c) => slot(c, name))
}

/**
 * A JSX element by name, on a line of its own or inside a paragraph: MDX
 * makes `<TabItem label="…">a</TabItem>` on one line a text element.
 */
function isElement(node: Node, name: string): boolean {
  return (
    (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") &&
    node.name === name
  )
}

export function extractPage(mdx: string): Page {
  const tabs: Tab[] = []
  const examples: Example[] = []
  const rest: Page["rest"] = []
  let groups = 0
  let section: string | null = null
  const walk = (node: Node, group: number | undefined) => {
    if (node.type === "heading" && node.depth === 2) {
      section = textOf(node)
      return
    }
    if (node.type === "code") {
      rest.push({ ...blocksIn(node)[0], section })
      return
    }
    if (isElement(node, "Tabs")) {
      const own = groups++
      for (const child of node.children ?? []) walk(child, own)
      return
    }
    if (isElement(node, "Example")) {
      const code = templateAttribute(node, "code")
      if (code === undefined)
        throw new Error(
          `line ${node.position?.start.line}: an <Example> without code`,
        )
      examples.push({
        section,
        recipe:
          node.attributes?.some(
            (a) => a.type === "mdxJsxAttribute" && a.name === "recipe",
          ) ?? false,
        code,
        ts: slot(node, "ts"),
        kotlin: slot(node, "kotlin"),
      })
      return
    }
    if (isElement(node, "TabItem")) {
      const line = node.position?.start.line
      if (group === undefined)
        throw new Error(`line ${line}: a <TabItem> outside <Tabs>`)
      const label = attribute(node, "label")
      if (label === undefined)
        throw new Error(`line ${line}: a <TabItem> without a label`)
      tabs.push({ label, group, section, blocks: blocksIn(node) })
      return
    }
    for (const child of node.children ?? []) walk(child, group)
  }
  const tree = parser.parse(mdx) as Node
  walk(tree, undefined)
  const inline: string[] = []
  const spans = (node: Node) => {
    if (node.type === "inlineCode") inline.push(node.value ?? "")
    for (const child of node.children ?? []) spans(child)
  }
  spans(tree)
  return { tabs, examples, rest, inline }
}

/**
 * The target each tab name is a recipe for. Other tabs have no setup, the
 * kotlinx.html tabs among them: they write the setup in Kotlin, which
 * `pageSetup` does not read, and `RecipesTest` holds their rendered page
 * template to the HTML tab instead.
 */
const TARGETS: Record<string, Target> = {
  "Plain HTML": "html",
  Datastar: "datastar",
  React: "react",
  Astro: "astro",
}

export interface Recipes {
  pages: Array<{
    path: string
    tabs: Array<Tab & { setup: Setup | null }>
    examples: Array<Example & { setup: Setup }>
    rest: Page["rest"]
    inline: string[]
  }>
}

/**
 * Every page, with the setup each recipe must show next to it.
 *
 * The count is the guard: what the tree gave must equal a count of the text
 * that does not go through the tree, and be more than zero, or the reading
 * stops. A tab the tree does not see, in a comment or written in a form it
 * does not know, then cannot pass for a page without tabs.
 */
export function extractAll(
  files: Array<{ path: string; text: string }>,
): Recipes {
  const pages: Recipes["pages"] = []
  let tabs = 0
  let examples = 0
  let rawTabs = 0
  let rawExamples = 0
  for (const { path, text } of files) {
    const page = extractPage(text)
    pages.push({
      path,
      tabs: page.tabs.map((tab) => {
        const target = TARGETS[tab.label]
        return {
          ...tab,
          setup: target
            ? pageSetup(target, tab.blocks.map((b) => b.code).join("\n"))
            : null,
        }
      }),
      examples: page.examples.map((example) => ({
        ...example,
        setup: pageSetup("html", example.code),
      })),
      rest: page.rest,
      inline: page.inline,
    })
    rawTabs += (text.match(/<TabItem\b/g) ?? []).length
    rawExamples += (text.match(/<Example\b/g) ?? []).length
    tabs += page.tabs.length
    examples += page.examples.length
  }
  if (
    pages.length === 0 ||
    tabs !== rawTabs ||
    examples !== rawExamples ||
    tabs + examples === 0
  )
    throw new Error(
      `read ${pages.length} pages, ${tabs} tabs and ${examples} examples, where the pages have ${rawTabs} <TabItem and ${rawExamples} <Example`,
    )
  return { pages }
}

/**
 * The reading, fed known pages every time it runs. The answers are written
 * out by hand.
 */
export function selfTest(): string[] {
  const broken: string[] = []
  const expect = (name: string, actual: unknown, wanted: unknown) => {
    if (JSON.stringify(actual) !== JSON.stringify(wanted))
      broken.push(
        `${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(wanted)}`,
      )
  }

  expect(
    "the tabs come out with their names and blocks, whatever the order of the attributes",
    extractPage(
      [
        "<Tabs>",
        '  <TabItem label="Plain HTML">',
        "    ```html",
        '    <p class="lt-paragraph">Saved</p>',
        "    ```",
        "  </TabItem>",
        '  <TabItem icon="seti:html" label="Datastar">',
        "    ```html",
        "    <p>Patched</p>",
        "    ```",
        "  </TabItem>",
        "</Tabs>",
      ].join("\n"),
    ).tabs,
    [
      {
        label: "Plain HTML",
        group: 0,
        section: null,
        blocks: [
          {
            lang: "html",
            meta: null,
            code: '<p class="lt-paragraph">Saved</p>',
          },
        ],
      },
      {
        label: "Datastar",
        group: 0,
        section: null,
        blocks: [{ lang: "html", meta: null, code: "<p>Patched</p>" }],
      },
    ],
  )

  expect(
    "each tab knows which <Tabs> it stands in",
    extractPage(
      [
        "<Tabs>",
        '  <TabItem label="Plain HTML">a</TabItem>',
        '  <TabItem label="kotlinx.html">b</TabItem>',
        "</Tabs>",
        "",
        "<Tabs>",
        '  <TabItem label="Plain HTML">c</TabItem>',
        "</Tabs>",
      ].join("\n"),
    ).tabs.map((t) => [t.label, t.group]),
    [
      ["Plain HTML", 0],
      ["kotlinx.html", 0],
      ["Plain HTML", 1],
    ],
  )
  expect(
    "a tab outside <Tabs> stops the reading",
    (() => {
      try {
        extractPage('<TabItem label="kotlinx.html">b</TabItem>')
        return "read"
      } catch (error) {
        return String(error)
      }
    })(),
    "Error: line 1: a <TabItem> outside <Tabs>",
  )

  expect(
    "an <Example> gives its markup as JavaScript reads it, and its slots",
    extractPage(
      [
        "<Example styles={['paragraph']} code={`",
        '<p class="lt-paragraph">Run \\`lotek check\\`</p>',
        "`}>",
        '  <Fragment slot="ts">',
        "    ```ts",
        "    lt.paragraph()",
        "    ```",
        "  </Fragment>",
        '  <Fragment slot="kotlin">',
        "    ```kotlin",
        "    p(Lt.paragraph()) {}",
        "    ```",
        "  </Fragment>",
        "</Example>",
      ].join("\n"),
    ).examples,
    [
      {
        section: null,
        recipe: false,
        code: '\n<p class="lt-paragraph">Run `lotek check`</p>\n',
        ts: [{ lang: "ts", meta: null, code: "lt.paragraph()" }],
        kotlin: [{ lang: "kotlin", meta: null, code: "p(Lt.paragraph()) {}" }],
      },
    ],
  )
  expect(
    "every recipe knows the heading it stands under, and the blocks outside tabs and examples come out on their own",
    (() => {
      const page = extractPage(
        [
          "## How to use it",
          "",
          "<Tabs>",
          '  <TabItem label="Plain HTML">',
          "    ```html",
          "    <p>a</p>",
          "    ```",
          "  </TabItem>",
          "</Tabs>",
          "",
          "## Saving immediately",
          "",
          "```js",
          "save()",
          "```",
          "",
          "<Example code={`<p>b</p>`} />",
        ].join("\n"),
      )
      return {
        tabs: page.tabs.map((t) => t.section),
        examples: page.examples.map((e) => e.section),
        rest: page.rest,
      }
    })(),
    {
      tabs: ["How to use it"],
      examples: ["Saving immediately"],
      rest: [
        {
          lang: "js",
          meta: null,
          code: "save()",
          section: "Saving immediately",
        },
      ],
    },
  )
  expect(
    "the code in the prose comes out too, also inside a tab",
    extractPage(
      [
        "Call `lt.button()` once.",
        "",
        "<Tabs>",
        '  <TabItem label="React">',
        "    Spread `lt.dialog.title` on the heading.",
        "  </TabItem>",
        "</Tabs>",
      ].join("\n"),
    ).inline,
    ["lt.button()", "lt.dialog.title"],
  )
  const stops = (run: () => unknown) => {
    try {
      run()
      return "read"
    } catch (error) {
      return String(error)
    }
  }
  expect(
    "every tab with a target gets the setup it must show",
    extractAll([
      {
        path: "components/toast.mdx",
        text: [
          "<Tabs>",
          '  <TabItem label="Datastar">',
          "    ```html",
          '    <lt-toast label="Notifications"></lt-toast>',
          "    ```",
          "  </TabItem>",
          '  <TabItem label="Try it">',
          "    <ToastDemo />",
          "  </TabItem>",
          "</Tabs>",
        ].join("\n"),
      },
    ]).pages[0].tabs.map((t) => [t.label, t.setup]),
    [
      [
        "Datastar",
        {
          stylesheets: ["tokens.css", "toast.css"],
          register: ["defineLtToast"],
          datastar: true,
        },
      ],
      ["Try it", null],
    ],
  )
  expect(
    "a kotlinx.html tab has no setup, since pageSetup does not read Kotlin",
    extractAll([
      {
        path: "components/button.mdx",
        text: '<Tabs>\n  <TabItem label="kotlinx.html">\n    ```kotlin\n    button(classes = "lt-button") {}\n    ```\n  </TabItem>\n</Tabs>',
      },
    ]).pages[0].tabs.map((t) => t.setup),
    [null],
  )
  expect(
    "a page with no pages to read stops the reading",
    stops(() => extractAll([])),
    "Error: read 0 pages, 0 tabs and 0 examples, where the pages have 0 <TabItem and 0 <Example",
  )
  expect(
    "a tab the tree does not see stops the reading",
    stops(() =>
      extractAll([
        {
          path: "a.mdx",
          text: '<Tabs>\n  <TabItem label="Plain HTML">a</TabItem>\n  {/* <TabItem label="React">b</TabItem> */}\n</Tabs>',
        },
      ]),
    ),
    "Error: read 1 pages, 1 tabs and 0 examples, where the pages have 2 <TabItem and 0 <Example",
  )
  expect(
    "an <Example> says whether it is the recipe, and finds a slot inside another element",
    extractPage(
      [
        "<Example styles={['paragraph']} recipe code={`<p>a</p>`}>",
        "  <div>",
        '    <Fragment slot="ts">',
        "      ```ts",
        "      lt.paragraph()",
        "      ```",
        "    </Fragment>",
        "  </div>",
        "</Example>",
        "",
        "<Example code={`<p>b</p>`} />",
      ].join("\n"),
    ).examples.map((e) => [e.recipe, e.ts.length]),
    [
      [true, 1],
      [false, 0],
    ],
  )
  expect(
    "an interpolation in the markup of an <Example> stops the reading",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the MDX under test, not a placeholder
    stops(() => extractPage("<Example code={`<p>${name}</p>`} />")),
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the message names the form
    "Error: line 1: the code of an <Example> must be a template literal without ${…}",
  )

  return broken
}

const DOCS = join(import.meta.dirname, "../../documentation/src/content/docs")

if (import.meta.main) {
  const broken = [...setupSelfTest(), ...selfTest()]
  if (broken.length > 0) {
    console.error(
      `The rules for the recipes answer wrong:\n${broken.map((b) => `  - ${b}`).join("\n")}`,
    )
    process.exit(1)
  }
  const files = [...new Glob("**/*.mdx").scanSync(DOCS)]
    .sort()
    .map((path) => ({ path, text: readFileSync(join(DOCS, path), "utf8") }))
  const recipes = extractAll(files)
  mkdirSync(dirname(RECIPES), { recursive: true })
  writeFileSync(RECIPES, `${JSON.stringify(recipes, null, 2)}\n`)
  const count = (key: "tabs" | "examples") =>
    recipes.pages.reduce((n, p) => n + p[key].length, 0)
  console.log(
    `Wrote the recipes of ${recipes.pages.length} pages: ${count("tabs")} tabs and ${count("examples")} examples`,
  )
}
