/**
 * That no recipe glues two words together when it is built.
 *
 * A code block for Astro or for JSX that has text on one line and an element
 * on the next reads right in the source and in the tab for plain HTML, and
 * loses the space in the consumer's build: "the death was anact of God".
 * `glued-words.ts` has the rule and says why. This reads every code block
 * for those two in the documentation's pages, the component pages, the
 * patterns and the guides alike, and fails on each place the rule finds.
 *
 * The rule is fed its own cases first, so a rule that went quiet stops the
 * check rather than passing every page.
 */

import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { gluedWords, type Language, selfTest } from "./glued-words"

const DOCS = fileURLToPath(new URL("../src/content/docs", import.meta.url))

/** The languages of a code fence that go through a build step with JSX's rule. */
const LANGUAGES: Record<string, Language> = {
  astro: "astro",
  tsx: "jsx",
  jsx: "jsx",
}

function pages(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) return pages(path)
    return /\.mdx?$/.test(entry.name) ? [path] : []
  })
}

const findings: string[] = []
for (const broken of selfTest())
  findings.push(`the rule for glued words: ${broken}`)

let blocks = 0
for (const path of pages(DOCS)) {
  const lines = readFileSync(path, "utf8").split("\n")
  for (let at = 0; at < lines.length; at++) {
    const open = /^(\s*)(`{3,})([a-z]+)\b/.exec(lines[at])
    if (!open) continue
    const [, indent, fence, name] = open
    let end = at + 1
    while (end < lines.length && lines[end].trim() !== fence) end += 1
    const language = LANGUAGES[name]
    if (language) {
      blocks += 1
      // The block as the reader copies it: without the indentation of the tab.
      const code = lines
        .slice(at + 1, end)
        .map((line) =>
          line.startsWith(indent) ? line.slice(indent.length) : line,
        )
        .join("\n")
      for (const glued of gluedWords(code, language))
        findings.push(
          `${relative(DOCS, path)}:${at + 1 + glued.line}: the ${name} block reads "${glued.reads}" when it is built. A line break between text and an element is not a space there. Write {" "} at the end of the line, or the two on one line.`,
        )
    }
    at = end
  }
}

// A check that read no block has checked nothing.
if (blocks === 0)
  findings.push("found no code block for Astro or JSX in the documentation")

if (findings.length > 0) {
  console.error(
    `Found ${findings.length} problems with words glued together:\n${findings.map((f) => `  - ${f}`).join("\n")}`,
  )
  process.exit(1)
}
console.log(
  `No words are glued together in ${blocks} code blocks for Astro and JSX.`,
)
