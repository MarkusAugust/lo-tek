/**
 * The recipes on the documentation pages, as `extract-recipes.ts` writes them
 * to `documentation/generated/recipes.json`.
 *
 * The script reads the pages once, as a tree, as the first step of
 * `generate`. The readers used to parse the MDX each in their own way, with
 * patterns that missed a tab whose attributes stood in another order, so no
 * reader parses a page any more. The browser tests take the file from
 * `recipe-pages.ts`, the scripts from `scripts/recipes.ts`.
 */

export interface Block {
  lang: string | null
  meta: string | null
  code: string
}

/** What `pageSetup` says a recipe must write around its markup. */
export interface Setup {
  stylesheets: string[]
  register: string[]
  datastar: boolean
}

export interface RecipePage {
  /** The path under `src/content/docs`, `components/dialog.mdx`. */
  path: string
  tabs: Array<{
    label: string
    group: number
    section: string | null
    blocks: Block[]
    /** `null` for a tab that is no recipe, such as "Try it". */
    setup: Setup | null
  }>
  examples: Array<{
    section: string | null
    code: string
    ts: Block[]
    kotlin: Block[]
    setup: Setup
  }>
  /** The blocks outside every tab and example. */
  rest: Array<Block & { section: string | null }>
  /** The inline code in the prose, inside tabs too. */
  inline: string[]
}

/** A page by the name of its component, `dialog`, or by its whole path. */
export function findPage(pages: RecipePage[], name: string): RecipePage {
  const path = name.includes("/") ? name : `components/${name}.mdx`
  const page = pages.find((p) => p.path === path)
  if (!page) throw new Error(`recipes.json has no page ${path}`)
  return page
}

/**
 * The code of the blocks in the tabs with a label, or outside every tab and
 * example with `tab: "rest"`, optionally of one language, in page order.
 */
export function blocks(
  page: RecipePage,
  { tab, lang }: { tab: string; lang?: string },
): string[] {
  const found =
    tab === "rest"
      ? page.rest
      : page.tabs.filter((t) => t.label === tab).flatMap((t) => t.blocks)
  return found.filter((b) => !lang || b.lang === lang).map((b) => b.code)
}

/**
 * Every block of a language on the page: in the tabs, then in the slots of
 * the examples, then outside both, each in page order.
 */
export function allBlocks(page: RecipePage, lang: string): string[] {
  return [
    ...page.tabs.flatMap((t) => t.blocks),
    ...page.examples.flatMap((e) => [...e.ts, ...e.kotlin]),
    ...page.rest,
  ]
    .filter((b) => b.lang === lang)
    .map((b) => b.code)
}

/**
 * The ```kotlin blocks of the kotlinx.html tab: the first `<TabItem>` with
 * that label, or else the `<Fragment slot="kotlin">` of the first example
 * that has one. `undefined` when the page has neither.
 */
export function kotlinTab(page: RecipePage): string[] | undefined {
  const tab = page.tabs.find((t) => t.label === "kotlinx.html")
  const found =
    tab?.blocks ?? page.examples.find((e) => e.kotlin.length)?.kotlin
  return found?.filter((b) => b.lang === "kotlin").map((b) => b.code)
}

/** The package address in the examples. `remark-version.mjs` fills in the version. */
export const VERSION_PLACEHOLDER = "@lo-tek/interfaces@VERSION"

/** Where the examples load the package from, with the placeholder. */
export const CDN = `https://cdn.jsdelivr.net/npm/${VERSION_PLACEHOLDER}/`
