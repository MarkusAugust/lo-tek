/**
 * The recipes for the scripts, from `documentation/generated/recipes.json`,
 * with the helpers in `src/testing/recipes.ts`, which the browser tests use
 * too, and the stylesheets the recipes link, read from the package's own
 * `exports`.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import pkg from "../package.json"
import { findPage, type RecipePage } from "../src/testing/recipes"

/** The file `extract-recipes.ts` writes, and every reader reads. */
export const RECIPES = join(
  import.meta.dirname,
  "../../documentation/generated/recipes.json",
)

export {
  allBlocks,
  blocks,
  CDN,
  kotlinTab,
  type RecipePage,
  VERSION_PLACEHOLDER,
} from "../src/testing/recipes"

/**
 * The pages as the file has them, read at the first call and kept: the
 * scripts ask for a page per contract and per element. Not when the module
 * loads, since `generate` writes the file in its first step and the scripts
 * after it read it.
 */
let pages: RecipePage[] | undefined
export function recipePage(name: string): RecipePage {
  pages ??= JSON.parse(readFileSync(RECIPES, "utf8")).pages as RecipePage[]
  return findPage(pages, name)
}

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
