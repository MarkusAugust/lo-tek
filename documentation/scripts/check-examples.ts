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
 * tabs. Not the blocks of HTML that stand in the text outside the tabs,
 * and not the "Try it" demos, which are not shown as markup to copy and are
 * checked where they are rendered.
 *
 * An example that shows a part on its own, on purpose, is named in
 * `ON_THEIR_OWN` with the reason: the variants of a help text are shown
 * without a field, to show the colours. The list is held from both sides.
 * Such an example must give `text-not-wired` and nothing else, so one that
 * is gone, has been wired, or fails on anything more stops the check. And
 * the recipe of a page, the example the reader is told to paste, is never
 * on it.
 *
 * The markup is read from `generated/recipes.json`. Every piece read from
 * it must stand in its page as it is in the file, apart from how far the
 * lines are indented, so a file that has fallen behind the pages stops the
 * check and no finding is reported at a line it is not on. The examples
 * are also counted against the pages on disk. The rule is fed two cases of
 * its own first, so a check that has gone quiet stops it as well.
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

/**
 * The examples that show a part on its own, by their page, the heading they
 * stand under, and a line only they have.
 */
const ON_THEIR_OWN: Array<{
  page: string
  section: string
  has: string
  reason: string
}> = [
  {
    page: "components/help-text.mdx",
    section: "The variants",
    has: '<p class="lt-help-text" data-variant="strong">',
    reason:
      "the three variants of a help text side by side, to show the colours; the recipe above it is the wired field",
  },
  {
    page: "components/error-text.mdx",
    section: "The variants",
    has: '<p class="lt-error-text" data-variant="warning">',
    reason:
      "the warning variant of an error text by itself, to show the colour; the recipe above it is the wired field",
  },
]
const onItsOwn = new Map<(typeof ON_THEIR_OWN)[number], number>()

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

/** A text with the blanks at the start of every line taken off. */
const flush = (text: string) => text.replace(/^[ \t]+/gm, "")

const pageTexts = new Map<string, string>()
function pageText(page: string): string {
  let text = pageTexts.get(page)
  if (text === undefined) {
    text = flush(readFileSync(join(DOCS, page), "utf8"))
    pageTexts.set(page, text)
  }
  return text
}

/**
 * The line in the page where `code` starts, or nothing when the page does
 * not hold the code: the file was written from other pages than these.
 */
function lineOf(page: string, code: string): number | undefined {
  const from = pageText(page).indexOf(flush(code).trim())
  return from === -1
    ? undefined
    : pageText(page).slice(0, from).split("\n").length
}

/** What `lotek check` says about `code` as a page, at its lines in the page. */
function read(
  page: string,
  what: string,
  code: string,
): Array<{ rule: string; said: string }> {
  const first = lineOf(page, code)
  if (first === undefined) {
    findings.push(
      `${page}: ${what} is in generated/recipes.json and not in the page as the file has it. The file has fallen behind the pages: run the build that writes it.`,
    )
    return []
  }
  const lead = code.length - code.trimStart().length
  const skipped = code.slice(0, lead).split("\n").length - 1
  return diagnosePage(code).map((finding) => ({
    rule: finding.rule,
    said: `${page}:${first + finding.line - 1 - skipped}: ${what}: ${finding.severity} ${finding.rule}: ${finding.message}`,
  }))
}

let examples = 0
let blocks = 0
for (const page of recipes.pages) {
  for (const [index, example] of page.examples.entries()) {
    examples += 1
    const what = `example ${index + 1} on the page, under "${example.section}"`
    const found = read(page.path, what, example.code)
    const alone = ON_THEIR_OWN.find(
      (each) =>
        each.page === page.path &&
        each.section === example.section &&
        example.code.includes(each.has),
    )
    if (!alone) {
      findings.push(...found.map((finding) => finding.said))
      continue
    }
    onItsOwn.set(alone, (onItsOwn.get(alone) ?? 0) + 1)
    if (example.recipe)
      findings.push(
        `${page.path}: ${what} is the page's recipe, and is in ON_THEIR_OWN. The recipe is what the reader pastes, and is held as a page: take it off the list in check-examples.ts.`,
      )
    else if (found.length === 0)
      findings.push(
        `${page.path}: ${what} is in ON_THEIR_OWN, and lotek check has nothing to say about it. It is wired now: take it off the list in check-examples.ts.`,
      )
    // A part on its own is not wired, and that is all that is wrong with it.
    findings.push(
      ...found
        .filter((finding) => finding.rule !== "text-not-wired")
        .map((finding) => finding.said),
    )
  }
  for (const tab of page.tabs)
    for (const block of tab.blocks) {
      if (block.lang !== "html") continue
      blocks += 1
      findings.push(
        ...read(
          page.path,
          `the HTML in the tab "${tab.label}", under "${tab.section}"`,
          block.code,
        ).map((finding) => finding.said),
      )
    }
}

for (const each of ON_THEIR_OWN) {
  const found = onItsOwn.get(each) ?? 0
  if (found !== 1)
    findings.push(
      `${each.page}: ON_THEIR_OWN names an example under "${each.section}" with \`${each.has}\` in it, and the page has ${found} such examples. Correct the list in check-examples.ts.`,
    )
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
  `lotek check has nothing to say about ${examples - ON_THEIR_OWN.length} examples and ${blocks} blocks of HTML in the tabs, each read as a page. ${ON_THEIR_OWN.length} examples show a part on its own, and are held to be unwired and nothing else.`,
)
