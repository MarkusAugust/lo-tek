/**
 * The stylesheets the recipes link, read from the package's own `exports`,
 * and the reading of the pages from `src/testing/recipes.ts`, which the
 * browser tests use too.
 */
import { readFileSync } from "node:fs"
import pkg from "../package.json"

export {
  CDN,
  dedent,
  htmlBlocks,
  tabItems,
  VERSION_PLACEHOLDER,
} from "../src/testing/recipes"

/**
 * The file behind a stylesheet name such as "input" or "tokens", read from
 * the package's own `exports`, as `Example.astro` reads it.
 */
export function stylesheetPath(name: string): string {
  const target = (pkg.exports as Record<string, unknown>)[`./${name}.css`]
  if (typeof target !== "string")
    throw new Error(`"./${name}.css" is not in the package's exports`)
  return target.slice(2)
}

/**
 * The ```kotlin blocks in the kotlinx.html tab of a component page, without
 * the tab's indentation, or `undefined` when the page has none. The tab is a
 * `<TabItem>`, or a `<Fragment slot="kotlin">` in an `<Example>`: both forms
 * `ExtractRecipes` in `kotlin/buildSrc` reads, with the same pattern as its
 * `tabStarts`, spacing included. That task compiles the blocks, so what is
 * read here has been compiled and rendered by `RecipesTest`.
 */
export function kotlinBlocks(page: string): string[] | undefined {
  const text = readFileSync(page, "utf8")
  const tabStart = text.search(/<TabItem\s+label\s*=\s*"kotlinx\.html"\s*>/)
  const slotStart = text.indexOf('<Fragment slot="kotlin">')
  const start = tabStart >= 0 ? tabStart : slotStart
  if (start < 0) return undefined
  const end = text.indexOf(tabStart >= 0 ? "</TabItem>" : "</Fragment>", start)
  const tab = text.slice(start, end < 0 ? text.length : end)
  return [...tab.matchAll(/^([ \t]*)```kotlin\n([\s\S]*?)\n[ \t]*```/gm)].map(
    (m) =>
      m[2]
        .split("\n")
        .map((line) => (line.startsWith(m[1]) ? line.slice(m[1].length) : line))
        .join("\n"),
  )
}
