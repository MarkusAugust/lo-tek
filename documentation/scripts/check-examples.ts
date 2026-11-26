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
 * `lotek check` on a file does not see it unless it is asked to. A file is
 * read as a template, where the id can be in another file, so the rules for
 * a whole page do not run. They run on an address, on a file with
 * `--rendered`, and on a string through `diagnosePage` in
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
 * The markup is read from `generated/recipes.json`, and held against the
 * pages on disk, so a file that has fallen behind the pages stops the
 * check:
 *
 *   - every `<Example>` in a page is read from the page itself, its `code`
 *     and whether it says `recipe`, and must be the example the file has in
 *     that place, letter for letter apart from how far the lines are
 *     indented. A finding is reported at the line of that `<Example>`'s own
 *     code, so the same markup twice on a page cannot be mixed up;
 *   - every block of HTML from a tab must stand in its page as the file has
 *     it, and is looked for after the block before it, so two that are the
 *     same are told apart as long as the file has them in the page's order.
 *
 * What is not seen here is a block of HTML in a tab that the pages have and
 * the file lacks: the tabs are not read from the pages again. The step
 * "Generated files are up to date" in CI, which runs before this, holds
 * that, and a run by hand after an edit needs the file written first.
 *
 * The rule is fed two cases of its own first, so a check that has gone
 * quiet stops it as well.
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

const lineAt = (text: string, index: number) =>
  text.slice(0, index).split("\n").length

type Written = {
  /** The markup, as JavaScript reads the template literal. */
  code: string
  recipe: boolean
  /** The line of the page the code starts on, counted from 1. */
  line: number
}

/** The `<Example>`s a page has, read from the page itself, in its order. */
function written(text: string): Written[] {
  const found: Written[] = []
  let from = text.indexOf("<Example")
  while (from !== -1) {
    const next = text.indexOf("<Example", from + 1)
    const span = text.slice(from, next === -1 ? text.length : next)
    const open = span.indexOf("code={`")
    let close = open === -1 ? -1 : open + 7
    while (close !== -1 && close < span.length && span[close] !== "`")
      close += span[close] === "\\" ? 2 : 1
    if (open === -1 || close >= span.length) {
      findings.push(
        `line ${lineAt(text, from)}: an <Example> whose code is not a template literal, which this check cannot read`,
      )
    } else {
      // The attributes: before the code, and after it to the end of the tag.
      const rest = span.slice(close + 1)
      const end = rest.search(/\/?>/)
      const attributes =
        span.slice(0, open) + rest.slice(0, end === -1 ? rest.length : end)
      found.push({
        code: span
          .slice(open + 7, close)
          .replace(/\\([\s\S])/g, (_, c: string) => (c === "\n" ? "" : c)),
        recipe: /\srecipe(?=[\s/>]|$)/.test(attributes),
        line: lineAt(text, from + open + 7),
      })
    }
    from = next
  }
  return found
}

/** What `lotek check` says about `code` as a page, at its lines in the page. */
function read(
  page: string,
  what: string,
  code: string,
  first: number,
): Array<{ rule: string; said: string }> {
  return diagnosePage(code).map((finding) => ({
    rule: finding.rule,
    said: `${page}:${first + finding.line - 1}: ${what}: ${finding.severity} ${finding.rule}: ${finding.message}`,
  }))
}

const BEHIND =
  "The file has fallen behind the pages: run the build that writes it."

let examples = 0
let blocks = 0
for (const page of recipes.pages) {
  const text = readFileSync(join(DOCS, page.path), "utf8")
  const onPage = written(text)
  if (onPage.length !== page.examples.length)
    findings.push(
      `${page.path}: the page has ${onPage.length} <Example, and generated/recipes.json has ${page.examples.length} for it. ${BEHIND}`,
    )
  for (const [index, example] of page.examples.entries()) {
    examples += 1
    const what = `example ${index + 1} on the page, under "${example.section}"`
    const own = onPage[index]
    if (!own) continue
    if (
      flush(own.code) !== flush(example.code) ||
      own.recipe !== Boolean(example.recipe)
    ) {
      findings.push(
        `${page.path}:${own.line}: ${what} is not in generated/recipes.json as the page has it${own.recipe !== Boolean(example.recipe) ? ": one of them says it is the recipe, and the other does not" : ""}. ${BEHIND}`,
      )
      continue
    }
    const found = read(page.path, what, example.code, own.line)
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
    if (own.recipe)
      findings.push(
        `${page.path}:${own.line}: ${what} is the page's recipe, and is in ON_THEIR_OWN. The recipe is what the reader pastes, and is held as a page: take it off the list in check-examples.ts.`,
      )
    else if (found.length === 0)
      findings.push(
        `${page.path}:${own.line}: ${what} is in ON_THEIR_OWN, and lotek check has nothing to say about it. It is wired now: take it off the list in check-examples.ts.`,
      )
    // A part on its own is not wired, and that is all that is wrong with it.
    findings.push(
      ...found
        .filter((finding) => finding.rule !== "text-not-wired")
        .map((finding) => finding.said),
    )
  }

  // The blocks in the tabs, each looked for after the one before it.
  const flat = flush(text)
  let after = 0
  for (const tab of page.tabs)
    for (const block of tab.blocks) {
      if (block.lang !== "html") continue
      blocks += 1
      const what = `the HTML in the tab "${tab.label}", under "${tab.section}"`
      const code = flush(block.code).trim()
      let at = flat.indexOf(code, after)
      if (at === -1) at = flat.indexOf(code)
      if (code === "" || at === -1) {
        findings.push(
          `${page.path}: ${what} is in generated/recipes.json and not in the page as the file has it. ${BEHIND}`,
        )
        continue
      }
      after = at + code.length
      const lead = block.code.length - block.code.trimStart().length
      const skipped = block.code.slice(0, lead).split("\n").length - 1
      findings.push(
        ...read(page.path, what, block.code, lineAt(flat, at) - skipped).map(
          (finding) => finding.said,
        ),
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

// A page with examples that the file does not have at all.
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
    `read ${examples} examples from recipes.json, where the pages have ${onDisk} <Example. ${BEHIND}`,
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
