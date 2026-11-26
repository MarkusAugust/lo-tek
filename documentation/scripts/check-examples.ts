/**
 * That the markup the pages show is markup `lotek check` has nothing to say
 * about, on a page.
 *
 * A reader pastes an example into a page and runs `lotek check` on the
 * address, or opens the page with the editor's check on. The check then
 * reads the page as a whole, and holds it to more than the vocabulary: that
 * every id pointed at exists, that no id is there twice, and that every
 * field, help text and error text is wired. An example with a help text
 * that no field points at is right as a picture of the class and wrong as
 * something to paste: the reader gets our warning on our own example.
 *
 * `lotek check` on a file does not see it. A file is read as a template,
 * where the id can be in another file, so the rules for a whole page do not
 * run. They run on an address, and on a string through `diagnosePage` in
 * `@lo-tek/interfaces/diagnostics`, which is what this calls: the package's
 * own built check, on each example by itself, as if it were all the page
 * held.
 *
 * Every finding counts, of every rule and both severities. The whole-page
 * rules are all about wiring between elements. None of them asks for a
 * `<main>`, a `<title>` or an order of headings, so a fragment is not
 * failed for being one. An example is held alone and not together with the
 * others on its page, since two examples may well use the same id.
 *
 * Held: the `code` of every `<Example>`, and every block of HTML in the
 * tabs, which is what the reader copies. Not the "Try it" demos, which are
 * not shown as markup to copy, and are checked where they are rendered.
 *
 * The markup is read from `generated/recipes.json`, and the examples are
 * counted against the pages on disk, so a file that has fallen behind the
 * pages stops the check. The rule is fed two cases of its own first, so a
 * check that has gone quiet stops it as well.
 */

import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import recipes from "../generated/recipes.json"

type Finding = {
  line: number
  message: string
  severity: "error" | "warning"
  rule: string
}

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const DOCS = join(ROOT, "documentation/src/content/docs")
const { diagnosePage } = (await import(
  join(ROOT, "interfaces/dist/diagnostics/index.js")
)) as { diagnosePage: (html: string) => Finding[] }

const findings: string[] = []

/* The check itself, on a text that must be found and one that must not. */
const BARE = '<p class="lt-help-text">State the budget in EB.</p>'
const WIRED =
  '<label class="lt-label" for="budget">Budget</label><input class="lt-input" id="budget" aria-describedby="budget-help" /><p class="lt-help-text" id="budget-help">State the budget in EB.</p>'
const bare = diagnosePage(BARE).map((finding) => finding.rule)
if (JSON.stringify(bare) !== '["text-not-wired"]')
  findings.push(
    `the check itself: a help text no field points at gave ${JSON.stringify(bare)}, where it should give ["text-not-wired"]`,
  )
const wired = diagnosePage(WIRED).map((finding) => finding.rule)
if (wired.length > 0)
  findings.push(
    `the check itself: a help text its field points at gave ${JSON.stringify(wired)}, where it should give nothing`,
  )

/**
 * The line in the page where `code` starts. An example whose markup is not
 * in the page letter for letter is placed at its `<Example`, the `at`th on
 * the page.
 */
function lineOf(page: string, code: string, at: number): number {
  const text = readFileSync(join(DOCS, page), "utf8")
  let from = code.trim() === "" ? -1 : text.indexOf(code.trim())
  if (from === -1)
    for (let i = 0; i <= at; i++) from = text.indexOf("<Example", from + 1)
  return from === -1 ? 1 : text.slice(0, from).split("\n").length
}

/** The findings in `code`, worded for the list, at their lines in the page. */
function held(page: string, what: string, code: string, at: number): string[] {
  const found = diagnosePage(code)
  if (found.length === 0) return []
  // The first line of the code as it is trimmed here, in the page.
  const first = lineOf(page, code, at)
  const lead = code.length - code.trimStart().length
  const skipped = code.slice(0, lead).split("\n").length - 1
  return found.map(
    (finding) =>
      `${page}:${first + finding.line - 1 - skipped}: ${what}: ${finding.severity} ${finding.rule}: ${finding.message}`,
  )
}

let examples = 0
let blocks = 0
for (const page of recipes.pages) {
  for (const [index, example] of page.examples.entries()) {
    examples += 1
    findings.push(
      ...held(
        page.path,
        `example ${index + 1} on the page, under "${example.section}"`,
        example.code,
        index,
      ),
    )
  }
  for (const tab of page.tabs)
    for (const block of tab.blocks) {
      if (block.lang !== "html") continue
      blocks += 1
      findings.push(
        ...held(
          page.path,
          `the HTML in the tab "${tab.label}", under "${tab.section}"`,
          block.code,
          0,
        ),
      )
    }
}

// Counted against the pages on disk, so a recipes.json that lacks an
// example the pages have cannot pass for one that has them all.
function count(folder: string): number {
  return readdirSync(folder, { withFileTypes: true }).reduce((sum, entry) => {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) return sum + count(path)
    if (!/\.mdx$/.test(entry.name)) return sum
    return sum + (readFileSync(path, "utf8").match(/<Example\b/g) ?? []).length
  }, 0)
}
const onDisk = count(DOCS)
if (examples === 0 || examples !== onDisk)
  findings.push(
    `read ${examples} examples from recipes.json, where the pages have ${onDisk} <Example. Run the build that writes the file.`,
  )

if (findings.length > 0) {
  console.error(
    `Found ${findings.length} problems in the examples, read as a page:\n${findings.map((f) => `  - ${f}`).join("\n")}`,
  )
  process.exit(1)
}
console.log(
  `lotek check has nothing to say about ${examples} examples and ${blocks} blocks of HTML in the tabs, each read as a page.`,
)
