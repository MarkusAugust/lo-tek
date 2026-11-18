/**
 * That no markup for the browser imports a package name.
 *
 * `import … from "@lo-tek/interfaces/field"` in a `<script type="module">`
 * does not resolve in a browser: without a build step or an import map the
 * package name does not exist, and the import fails silently. The code looks
 * right, and does not work when pasted.
 *
 * The rule already existed in `check-recipes.ts`, but it only reads the
 * component pages and picks the rule from the name of the tab. Two pages
 * outside that search therefore had the bug for several rounds: the Datastar
 * track in `frameworks.mdx` and the dialog in `patterns/confirmation.mdx`.
 * This check is simpler and covers everything: an `html` block is markup for
 * the browser whatever page it is on, and whatever the surrounding tab is
 * called.
 *
 * `ts`, `tsx`, `js` and `astro` are not checked. There is a build step there,
 * and then the package name is right.
 *
 * Run with: bun documentation/scripts/check-browser-import.ts
 */

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { Glob } from "bun"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const PAGES = "documentation/src/content/docs/**/*.{mdx,md}"

/** The pages in the folder, counted without a glob, so the two sources are
 * independent. */
function countPages(folder: string): number {
  let count = 0

  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (entry.isDirectory()) count += countPages(`${folder}/${entry.name}`)
    else if (/\.(mdx|md)$/.test(entry.name)) count += 1
  }

  return count
}

const findings: string[] = []

let read = 0
let blocks = 0

/*
 * The fence can have more than the language in it, like ```html
 * title="index.html", and the language can be in capitals. The closing fence
 * must be at the start of a line: without that, a ``` inside the block, as in
 * `<pre>```</pre>`, cut off the rest of it, and the imports below were never
 * read while the counter went up.
 *
 * The import can be written in more ways than `from "…"`: a side-effect
 * import without `from`, single quotes, and `import("…")`. All fail just as
 * silently in a browser.
 */
const FENCE = /^[ \t]*```html[^\n]*\n([\s\S]*?)^[ \t]*```/gim
const IMPORT = /(?:from|import)\s*\(?\s*\n?\s*["'](@lo-tek\/[^"']*)["']/g

/*
 * A hard-coded CDN address must point to a file the package actually ships,
 * at the released version.
 *
 * `check-recipes.ts` has the same rule, but only reads the component pages.
 * Four of the addresses are outside that folder, and a typo like
 * `lt-fields.js` would have passed every single guard in the repository and
 * given a 404 in the browser. The guard has the address in hand anyway, so it
 * checks it.
 *
 * The version segment must be the placeholder, not a number:
 * `remark-version.mjs` replaces it when the page is built, and
 * `check-built-version.ts` checks that it actually happened.
 */
const CDN = /cdn\.jsdelivr\.net\/npm\/@lo-tek\/interfaces@([^/]+)\/([^"'\s]+)/g

const lineOf = (text: string, index: number) =>
  text.slice(0, index).split("\n").length

for (const rel of new Glob(PAGES).scanSync(ROOT)) {
  const text = readFileSync(ROOT + rel, "utf8")

  for (const block of text.matchAll(FENCE)) {
    // The content starts after the fence line, not on it.
    const start = (block.index ?? 0) + block[0].indexOf("\n") + 1

    for (const match of block[1].matchAll(IMPORT)) {
      findings.push(
        `${rel}:${lineOf(text, start + (match.index ?? 0))} imports "${match[1]}" in markup for the browser. Use the full URL.`,
      )
    }

    blocks += 1
  }

  for (const match of text.matchAll(CDN)) {
    const [, version, filePath] = match
    const where = `${rel}:${lineOf(text, match.index ?? 0)}`

    if (version !== "VERSION") {
      findings.push(
        `${where} points to @lo-tek/interfaces@${version}. Write @lo-tek/interfaces@VERSION, which remark-version.mjs replaces when the page is built.`,
      )
    }

    if (!existsSync(`${ROOT}interfaces/${filePath}`)) {
      findings.push(
        `${where} points to ${filePath}, which the package does not ship.`,
      )
    }
  }

  read += 1
}

/*
 * Count what was actually done, and require the number to be both equal to
 * the expected and greater than zero. The expected comes from a different
 * mechanism than the queue: the glob filled the list, and a plain walk of the
 * folder counts it. If the pattern drops from 58 pages to 1, the two give
 * different numbers.
 */
const expected = [...new Glob(PAGES).scanSync(ROOT)].length
const fromFolder = countPages(`${ROOT}documentation/src/content/docs`)

const incomplete =
  read === 0 || blocks === 0 || read !== expected || read !== fromFolder
if (incomplete) {
  console.error(
    `The check did not look at what it was meant to: ${read} pages read, ${expected} from the glob, ${fromFolder} in the folder, and ${blocks} markup blocks.\n`,
  )
}

if (findings.length > 0) {
  console.error(
    `Found ${findings.length} addresses that do not work in a browser:\n${findings
      .map((line) => `  - ${line}`)
      .join("\n")}\n`,
  )
}

if (incomplete || findings.length > 0) process.exit(1)

console.log(
  `None of ${blocks} markup blocks in ${read} pages imports a package name, and every CDN address uses the placeholder and points to a file that exists.`,
)
