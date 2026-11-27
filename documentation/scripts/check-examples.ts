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
 * Held: the `code` of every `<Example>`, and every block of HTML on the
 * pages, in a tab or in the text. Not the "Try it" demos, which are not
 * shown as markup to copy and are checked where they are rendered.
 *
 * An example that shows a part on its own, on purpose, is named in
 * `ON_THEIR_OWN` with the reason: the variants of a help text are shown
 * without a field, to show the colours. The list is held from both sides.
 * Such an example must give `text-not-wired` and nothing else, so one that
 * is gone, has been wired, or fails on anything more stops the check. And
 * the recipe of a page, the example the reader is told to paste, is never
 * on it.
 *
 * A block in the text is often less than something to paste: it shows a
 * mistake, or one element with its content left out, or one piece of a
 * page whose other pieces stand in other blocks. Those that `lotek check`
 * has something to say about for such a reason are named in `NOT_A_PAGE`,
 * each with its kind, its reason and the one rule it gives. That list is
 * held from both sides too: a named block must be on its page once and
 * give that rule and no other, so a block that is gone or has been made
 * whole stops the check. A block with a finding that is a mistake on the
 * page is not for the list: the page is what is wrong.
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
 *   - every block of HTML must stand in its page as the file has it. The
 *     blocks in the tabs are looked for one after the other down the page,
 *     and the blocks in the text likewise, so two that are the same are
 *     told apart as long as the file has them in the page's order;
 *   - the blocks of HTML the file has, in the tabs and in the text
 *     together, are counted against the fences for HTML in the pages.
 *
 * What is not seen here is a block the pages have changed since the file
 * was written, when another block the file lacks happens to make up the
 * count. The step "Generated files are up to date" in CI, which runs
 * before this, holds the file itself, and a run by hand after an edit
 * needs the file written first.
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

/** Why a block in the text is not a page to paste. */
const KINDS = {
  "wrong on purpose": "the text around it is about the mistake",
  "content left out":
    "the element is shown with … where its content goes, to show what stands around it",
  "the rest is not in the block":
    "it is one piece of a page, and what it points at stands in other blocks",
}

/**
 * The blocks of HTML in the text that are not a page to paste, by their
 * page and a line only they have, with the one rule each gives.
 */
const NOT_A_PAGE: Array<{
  page: string
  has: string
  kind: keyof typeof KINDS
  rule: string
  reason: string
}> = [
  {
    page: "type-safe-use.mdx",
    has: 'data-variant="secundary"',
    kind: "wrong on purpose",
    rule: "invalid-class-value",
    reason:
      "the misspelt variant is the point: the page opens with it to show what a string lets through",
  },
  {
    page: "patterns/list.mdx",
    has: '<table class="lt-table" data-variant="striped">…</table>',
    kind: "content left out",
    rule: "without-name",
    reason:
      "the scroll container around a table; the table's caption and rows are the … in it",
  },
  {
    page: "components/table.mdx",
    has: '<table class="lt-table">…</table>',
    kind: "content left out",
    rule: "without-name",
    reason:
      "the scroll container around a table; the table's caption and rows are the … in it",
  },
  {
    page: "patterns/form.mdx",
    has: '<lt-error-summary class="lt-error-summary" role="alert" tabindex="-1" data-autofocus="false" id="form-errors"',
    kind: "the rest is not in the block",
    rule: "summary-points-nowhere",
    reason:
      "the error summary of the form alone; the fields its links go to are in the blocks around it",
  },
  {
    page: "components/error-summary.mdx",
    has: '<lt-error-summary class="lt-error-summary" role="alert" tabindex="-1" id="errors" aria-labelledby="errors-title">',
    kind: "the rest is not in the block",
    rule: "summary-points-nowhere",
    reason:
      "the markup of the summary alone; the fields its links go to are not part of what the section shows",
  },
]
const notAPage = new Map<(typeof NOT_A_PAGE)[number], number>()

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
let inText = 0
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

  // The blocks of HTML, in the tabs and in the text: each kind looked for
  // down the page, one after the other.
  const flat = flush(text)
  const place = (code: string, after: number) => {
    const wanted = flush(code).trim()
    let at = wanted === "" ? -1 : flat.indexOf(wanted, after)
    if (at === -1 && wanted !== "") at = flat.indexOf(wanted)
    const lead = code.length - code.trimStart().length
    const skipped = code.slice(0, lead).split("\n").length - 1
    return at === -1
      ? undefined
      : { end: at + wanted.length, line: lineAt(flat, at) - skipped }
  }

  let after = 0
  for (const tab of page.tabs)
    for (const block of tab.blocks) {
      if (block.lang !== "html") continue
      blocks += 1
      const what = `the HTML in the tab "${tab.label}", under "${tab.section}"`
      const placed = place(block.code, after)
      if (!placed) {
        findings.push(
          `${page.path}: ${what} is in generated/recipes.json and not in the page as the file has it. ${BEHIND}`,
        )
        continue
      }
      after = placed.end
      findings.push(
        ...read(page.path, what, block.code, placed.line).map(
          (finding) => finding.said,
        ),
      )
    }

  after = 0
  for (const block of page.rest) {
    if (block.lang !== "html") continue
    inText += 1
    // A block before the first heading has the page's frontmatter for its
    // section in the file, which is no heading to name it by.
    const heading =
      block.section && !block.section.includes("\n") ? block.section : null
    const what = `the HTML in the text${heading ? `, under "${heading}"` : ", before the first heading"}`
    const placed = place(block.code, after)
    if (!placed) {
      findings.push(
        `${page.path}: ${what} is in generated/recipes.json and not in the page as the file has it. ${BEHIND}`,
      )
      continue
    }
    after = placed.end
    const found = read(page.path, what, block.code, placed.line)
    const named = NOT_A_PAGE.find(
      (each) => each.page === page.path && block.code.includes(each.has),
    )
    if (!named) {
      findings.push(...found.map((finding) => finding.said))
      continue
    }
    notAPage.set(named, (notAPage.get(named) ?? 0) + 1)
    if (!found.some((finding) => finding.rule === named.rule))
      findings.push(
        `${page.path}:${placed.line}: ${what} is in NOT_A_PAGE for ${named.rule}, and lotek check does not say that about it. Take it off the list in check-examples.ts, or correct the rule there.`,
      )
    // What the block is named for, and nothing else.
    findings.push(
      ...found
        .filter((finding) => finding.rule !== named.rule)
        .map((finding) => finding.said),
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

for (const each of NOT_A_PAGE) {
  const found = notAPage.get(each) ?? 0
  if (found !== 1)
    findings.push(
      `${each.page}: NOT_A_PAGE names a block of HTML in the text with \`${each.has}\` in it, and the page has ${found} such blocks. Correct the list in check-examples.ts.`,
    )
}

// A page with examples that the file does not have at all.
function count(folder: string, what: RegExp): number {
  return readdirSync(folder, { withFileTypes: true }).reduce((sum, entry) => {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) return sum + count(path, what)
    if (!/\.mdx$/.test(entry.name)) return sum
    return sum + (readFileSync(path, "utf8").match(what) ?? []).length
  }, 0)
}
const onDisk = count(DOCS, /<Example\b/g)
// A fence for HTML, however far in it stands and whatever follows the word.
const fences = count(DOCS, /^[ \t]*`{3,}html\b/gm)
if (blocks + inText !== fences)
  findings.push(
    `read ${blocks} blocks of HTML in the tabs and ${inText} in the text from recipes.json, where the pages have ${fences} fences for HTML. ${BEHIND}`,
  )
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
  `lotek check has nothing to say about ${examples - ON_THEIR_OWN.length} examples, ${blocks} blocks of HTML in the tabs and ${inText - NOT_A_PAGE.length} in the text, each read as a page. ${ON_THEIR_OWN.length} examples show a part on its own, and ${NOT_A_PAGE.length} blocks in the text are not a page to paste: ${Object.keys(
    KINDS,
  )
    .map(
      (kind) =>
        `${NOT_A_PAGE.filter((each) => each.kind === kind).length} ${kind}`,
    )
    .join(", ")}. Each is held to its one rule and nothing else.`,
)
