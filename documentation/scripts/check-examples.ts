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
 * pages, in a tab or in the text. A block of HTML is a fence of three or
 * more backticks at the start of a line, indented or not, whose language
 * is `html`, in small or capital letters. Not the "Try it" demos, which are
 * not shown as markup to copy and are checked where they are rendered.
 *
 * Markup the pages show in other ways is not held, and today that is: the
 * 15 fences for Astro, which are held by `check-astro-tabs.ts` to the type
 * checker and not to this; the fences without a language, 7 of them, one
 * of which, in `markup-and-behaviour.mdx`, shows a tab without its panel;
 * and the two `<TailwindExample code=…>` in `tailwind.mdx`. A fence for
 * HTML in a form this does not read stops the check and says so, since a
 * block nobody holds looks the same on the page as one that is held: a
 * fence of tildes, one in a blockquote, one with a space before the
 * language or with more in the language than `html`, one inside another
 * fence, in a comment, or inside an `<Example>`.
 *
 * An example that shows a part on its own, on purpose, is named in
 * `ON_THEIR_OWN` with the reason: the variants of a help text are shown
 * without a field, to show the colours. A block in the text can be less
 * than something to paste as well: it shows a mistake, or one piece of a
 * page whose other pieces are not in it. Those are named in `NOT_A_PAGE`,
 * each with its kind and its reason.
 *
 * Both lists are held from both sides, and to the letter. A named example
 * or block says exactly what `lotek check` finds in it: how many findings,
 * of which rule, and what each is about. One finding more, one fewer, or
 * one about something else stops the check, so a name on the list hides
 * nothing that it does not say. One that is gone from its page stops it
 * too. The recipe of a page, the example the reader is told to paste, is
 * never on a list, and a finding that is a mistake on the page is not for
 * one either: the page is what is wrong.
 *
 * The markup is read from `generated/recipes.json`, and held against the
 * pages on disk one for one, so a file that has fallen behind the pages
 * stops the check, and no finding is reported at a line it is not on:
 *
 *   - every `<Example>` in a page is read from the page itself, its `code`
 *     and whether it says `recipe`, and must be the example the file has in
 *     that place;
 *   - every fence for HTML in a page is read from the page itself, and the
 *     fences in the tabs must be the blocks the file has in its tabs, one
 *     for one and in order, and the fences in the text the blocks the file
 *     has outside them;
 *   - a page on disk with an example or a fence for HTML that the file
 *     does not have at all stops it as well.
 *
 * The comparison is letter for letter, apart from how far the lines are
 * indented. So a run by hand after an edit needs the file written first,
 * and says so; in CI the step "Generated files are up to date" runs before
 * this and holds the file itself.
 *
 * The rule is fed two cases of its own first, so a check that has gone
 * quiet stops it as well.
 */

import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
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

/** One finding a named example or block gives: its rule, and what it is about. */
type Gives = { rule: string; about: string }

/**
 * The examples that show a part on its own, by their page, the heading they
 * stand under, and a line only they have, with every finding each gives.
 */
const ON_THEIR_OWN: Array<{
  page: string
  section: string
  has: string
  reason: string
  gives: Gives[]
}> = [
  {
    page: "components/help-text.mdx",
    section: "The variants",
    has: '<p class="lt-help-text" data-variant="strong">',
    reason:
      "the three variants of a help text side by side, to show the colours; the recipe above it is the wired field",
    gives: [
      { rule: "text-not-wired", about: "The help text is not wired" },
      { rule: "text-not-wired", about: "The help text is not wired" },
      { rule: "text-not-wired", about: "The help text is not wired" },
    ],
  },
  {
    page: "components/error-text.mdx",
    section: "The variants",
    has: '<p class="lt-error-text" data-variant="warning">',
    reason:
      "the warning variant of an error text by itself, to show the colour; the recipe above it is the wired field",
    gives: [{ rule: "text-not-wired", about: "The error text is not wired" }],
  },
]

/** Why a block in the text is not a page to paste. */
const KINDS = {
  "wrong on purpose": "the text around it is about the mistake",
  "the rest is not in the block":
    "it is one piece of a page, and what it points at is not in the block",
}

/**
 * The blocks of HTML in the text that are not a page to paste, by their
 * page and a line only they have, with every finding each gives.
 */
const NOT_A_PAGE: Array<{
  page: string
  has: string
  kind: keyof typeof KINDS
  reason: string
  gives: Gives[]
}> = [
  {
    page: "type-safe-use.mdx",
    has: 'data-variant="secundary"',
    kind: "wrong on purpose",
    reason:
      "the misspelt variant is the point: the page opens with it to show what a string lets through",
    gives: [{ rule: "invalid-class-value", about: '"secundary"' }],
  },
  {
    page: "patterns/form.mdx",
    has: '<lt-error-summary class="lt-error-summary" role="alert" tabindex="-1" data-autofocus="false" id="form-errors"',
    kind: "the rest is not in the block",
    reason:
      "the error summary of the form alone. Its two links go to fields that are not in the block: the field `fixer` stands in another block on the page, and `deliver-by` is in no block there, only in this link",
    gives: [
      { rule: "summary-points-nowhere", about: '"#fixer"' },
      { rule: "summary-points-nowhere", about: '"#deliver-by"' },
    ],
  },
  {
    page: "components/error-summary.mdx",
    has: '<lt-error-summary class="lt-error-summary" role="alert" tabindex="-1" id="errors" aria-labelledby="errors-title">',
    kind: "the rest is not in the block",
    reason:
      "the markup of the summary alone; the two fields its links go to are not part of what the section shows",
    gives: [
      { rule: "summary-points-nowhere", about: '"#fixer"' },
      { rule: "summary-points-nowhere", about: '"#deliver-by"' },
    ],
  },
]

type Named = (typeof ON_THEIR_OWN)[number] | (typeof NOT_A_PAGE)[number]
const met = new Map<Named, number>()

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
/** Two pieces of markup that are the same, apart from how far the lines are indented. */
const same = (a: string, b: string) => flush(a).trim() === flush(b).trim()

const lineAt = (text: string, index: number) =>
  text.slice(0, index).split("\n").length

const BEHIND =
  "The file has fallen behind the pages: write it again with `cd interfaces && bun run generate`."

type Written = {
  /** The markup, as JavaScript reads the template literal. */
  code: string
  recipe: boolean
  /** The line of the page the code starts on, counted from 1. */
  line: number
  /** From the `<Example` to the end of the element. */
  from: number
  to: number
}

/** The `<Example>`s a page has, read from the page itself, in its order. */
function written(page: string, text: string): Written[] {
  const found: Written[] = []
  let from = text.search(/<Example\b/)
  while (from !== -1) {
    const later = text.slice(from + 1).search(/<Example\b/)
    const next = later === -1 ? -1 : from + 1 + later
    const span = text.slice(from, next === -1 ? text.length : next)
    const open = span.indexOf("code={`")
    let close = open === -1 ? -1 : open + 7
    while (close !== -1 && close < span.length && span[close] !== "`")
      close += span[close] === "\\" ? 2 : 1
    if (open === -1 || close >= span.length) {
      findings.push(
        `${page}:${lineAt(text, from)}: an <Example> whose code is not a template literal, which this check cannot read`,
      )
    } else {
      // The attributes: before the code, and after it to the end of the tag.
      const rest = span.slice(close + 1)
      const end = rest.search(/\/?>/)
      const attributes =
        span.slice(0, open) + rest.slice(0, end === -1 ? rest.length : end)
      // The element ends with its tag, or with `</Example>`.
      const closes = end !== -1 && rest[end] === "/"
      const closing = span.indexOf("</Example>")
      found.push({
        code: span
          .slice(open + 7, close)
          .replace(/\\([\s\S])/g, (_, c: string) => (c === "\n" ? "" : c)),
        recipe: /\srecipe(?=[\s/>]|$)/.test(attributes),
        line: lineAt(text, from + open + 7),
        from,
        to:
          from +
          (closes || closing === -1 ? close + 1 + end + 2 : closing + 10),
      })
    }
    from = next
  }
  return found
}

type Fence = {
  /** The line of the opening fence, counted from 1. */
  line: number
  code: string
  inTabs: boolean
}

/**
 * The fences for HTML a page has, read from the page itself: the ones this
 * check reads, and the ones in a form it does not, each with what the form
 * is.
 */
function fences(
  text: string,
  examples: Written[],
): { read: Fence[]; unread: Array<{ line: number; form: string }> } {
  const read: Fence[] = []
  const unread: Array<{ line: number; form: string }> = []
  const lines = text.split("\n")
  const starts: number[] = []
  let offset = 0
  for (const line of lines) {
    starts.push(offset)
    offset += line.length + 1
  }
  const comments = [...text.matchAll(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g)].map(
    (match) => [match.index, match.index + match[0].length] as const,
  )
  const within = (
    ranges: ReadonlyArray<readonly [number, number]>,
    at: number,
  ) => ranges.some(([from, to]) => at >= from && at < to)
  const inExample = (at: number) =>
    within(
      examples.map((each) => [each.from, each.to] as const),
      at,
    )
  const html = (info: string) => /^html/i.test(info.trim())

  let tabs = 0
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at]
    if (/^[ \t]*>[ \t]*(`{3,}|~{3,})/.test(line)) {
      if (html(line.replace(/^[ \t]*>[ \t]*[`~]+/, "")))
        unread.push({ line: at + 1, form: "it is in a blockquote" })
      continue
    }
    const open = /^([ \t]*)(`{3,}|~{3,})(.*)$/.exec(line)
    if (!open) {
      tabs += (line.match(/<Tabs[\s>]/g) ?? []).length
      tabs -= (line.match(/<\/Tabs>/g) ?? []).length
      continue
    }
    const [, indent, marker, info] = open
    const closes = new RegExp(`^[ \\t]*${marker[0]}{${marker.length},}[ \\t]*$`)
    let end = at + 1
    while (end < lines.length && !closes.test(lines[end])) end += 1
    const inside = lines.slice(at + 1, end)
    const word = info.trim().split(/\s+/)[0] ?? ""
    if (!html(info)) {
      // Another language. A fence for HTML in it is text in that block.
      for (const [index, each] of inside.entries())
        if (/^[ \t]*(`{3,}|~{3,})[ \t]*html/i.test(each))
          unread.push({
            line: at + 2 + index,
            form: "it is inside another fence",
          })
    } else if (within(comments, starts[at])) {
      unread.push({ line: at + 1, form: "it is in a comment" })
    } else if (inExample(starts[at])) {
      unread.push({ line: at + 1, form: "it is inside an <Example>" })
    } else if (marker[0] === "~") {
      unread.push({ line: at + 1, form: "it is written with tildes" })
    } else if (/^\s/.test(info)) {
      unread.push({
        line: at + 1,
        form: "there is a space before the language",
      })
    } else if (word.toLowerCase() !== "html") {
      unread.push({
        line: at + 1,
        form: `its language is written "${word}"`,
      })
    } else {
      read.push({
        line: at + 1,
        // As the reader copies it: without the indentation of the fence.
        code: inside
          .map((each) =>
            each.startsWith(indent) ? each.slice(indent.length) : each,
          )
          .join("\n"),
        inTabs: tabs > 0,
      })
    }
    at = end
  }
  return { read, unread }
}

/** What `lotek check` says about `code` as a page. */
type Said = { rule: string; message: string; said: string }
function read(page: string, what: string, code: string, first: number): Said[] {
  return diagnosePage(code).map((finding) => ({
    rule: finding.rule,
    message: finding.message,
    said: `${page}:${first + finding.line - 1}: ${what}: ${finding.severity} ${finding.rule}: ${finding.message}`,
  }))
}

/**
 * Holds a named example or block to exactly the findings it says it gives,
 * each met by one finding of its own: nothing more, nothing fewer, and
 * nothing about something else.
 */
function holdNamed(
  list: string,
  named: Named,
  where: string,
  what: string,
  found: Said[],
): void {
  met.set(named, (met.get(named) ?? 0) + 1)
  const left = [...found]
  const missing: Gives[] = []
  for (const expected of named.gives) {
    const at = left.findIndex(
      (finding) =>
        finding.rule === expected.rule &&
        finding.message.includes(expected.about),
    )
    if (at === -1) missing.push(expected)
    else left.splice(at, 1)
  }
  if (missing.length === 0 && left.length === 0) return
  const because = `It is on the list because: ${named.reason}.`
  for (const expected of missing)
    findings.push(
      `${where}: ${what} is in ${list} for a finding of ${expected.rule} about ${expected.about}, and lotek check does not say that about it. ${because} Take the finding off the list in check-examples.ts, or the block if it is whole now.`,
    )
  // What the name on the list does not say is a finding like any other.
  findings.push(
    ...left.map(
      (finding) => `${finding.said} (${list} names this one, and not for this)`,
    ),
  )
}

const htmlBlock = (block: { lang: string | null }) =>
  (block.lang ?? "").toLowerCase() === "html"

let examples = 0
let blocks = 0
let inText = 0
const inFile = new Set<string>()
for (const page of recipes.pages) {
  inFile.add(page.path)
  const text = readFileSync(join(DOCS, page.path), "utf8")
  const onPage = written(page.path, text)
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
    if (own.recipe)
      findings.push(
        `${page.path}:${own.line}: ${what} is the page's recipe, and is in ON_THEIR_OWN. The recipe is what the reader pastes, and is held as a page: take it off the list in check-examples.ts.`,
      )
    holdNamed("ON_THEIR_OWN", alone, `${page.path}:${own.line}`, what, found)
  }

  // The fences for HTML, read from the page and held to the file one for
  // one: those in the tabs to the file's tabs, those in the text to the
  // blocks it has outside them.
  const { read: onDisk, unread } = fences(text, onPage)
  for (const each of unread)
    findings.push(
      `${page.path}:${each.line}: a fence for HTML in a form this check does not read: ${each.form}. Its markup would be held by nothing. Write it as a fence of backticks at the start of a line, with the language html, in a tab or in the text.`,
    )
  const inTabs = page.tabs.flatMap((tab) =>
    tab.blocks.filter(htmlBlock).map((block) => ({
      code: block.code,
      what: `the HTML in the tab "${tab.label}", under "${tab.section}"`,
    })),
  )
  const outside = page.rest.filter(htmlBlock).map((block) => ({
    code: block.code,
    // A block before the first heading has the page's frontmatter for its
    // section in the file, which is no heading to name it by.
    what: `the HTML in the text${block.section && !block.section.includes("\n") ? `, under "${block.section}"` : ", before the first heading"}`,
  }))
  blocks += inTabs.length
  inText += outside.length
  // A fence in a form that is not read may be a block in the file all the
  // same, and then the two would not line up for a reason already given.
  if (unread.length > 0) continue

  for (const [where, fromFile, fromPage] of [
    ["in the tabs", inTabs, onDisk.filter((fence) => fence.inTabs)],
    ["in the text", outside, onDisk.filter((fence) => !fence.inTabs)],
  ] as const) {
    for (let at = 0; at < Math.max(fromFile.length, fromPage.length); at++) {
      const block = fromFile[at]
      const fence = fromPage[at]
      if (!block || !fence || !same(block.code, fence.code)) {
        findings.push(
          fence
            ? `${page.path}:${fence.line}: the fence for HTML ${where} is ${block ? "not in generated/recipes.json as the page has it" : "not in generated/recipes.json"}. ${BEHIND}`
            : `${page.path}: generated/recipes.json has ${fromFile.length} blocks of HTML ${where}, and the page has ${fromPage.length} fences for HTML there. ${BEHIND}`,
        )
        // The ones after it would not line up either.
        break
      }
      // Line 1 of the code is the line under the fence.
      const found = read(page.path, block.what, fence.code, fence.line + 1)
      const named =
        where === "in the text"
          ? NOT_A_PAGE.find(
              (each) =>
                each.page === page.path && fence.code.includes(each.has),
            )
          : undefined
      if (named)
        holdNamed(
          "NOT_A_PAGE",
          named,
          `${page.path}:${fence.line}`,
          block.what,
          found,
        )
      else findings.push(...found.map((finding) => finding.said))
    }
  }
}

for (const [list, entries] of [
  ["ON_THEIR_OWN", ON_THEIR_OWN],
  ["NOT_A_PAGE", NOT_A_PAGE],
] as const)
  for (const each of entries) {
    const found = met.get(each) ?? 0
    if (found !== 1)
      findings.push(
        `${each.page}: ${list} names ${list === "ON_THEIR_OWN" ? "an example" : "a block of HTML in the text"} with \`${each.has}\` in it, and the page has ${found} such. Correct the list in check-examples.ts.`,
      )
  }

// A page on disk that the file does not have at all.
function pages(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) return pages(path)
    return /\.mdx?$/.test(entry.name) ? [path] : []
  })
}
for (const path of pages(DOCS)) {
  const page = relative(DOCS, path)
  if (inFile.has(page)) continue
  const text = readFileSync(path, "utf8")
  const own = written(page, text)
  const { read: held, unread } = fences(text, own)
  if (own.length + held.length + unread.length > 0)
    findings.push(
      `${page}: the page has ${own.length} <Example and ${held.length + unread.length} fences for HTML, and is not in generated/recipes.json${page.endsWith(".md") ? ", which is written from the .mdx pages only: its markup would be held by nothing" : `. ${BEHIND}`}`,
    )
}
if (examples === 0)
  findings.push(`read no example from generated/recipes.json. ${BEHIND}`)

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
    .join(", ")}. Each gives exactly the findings it is named for.`,
)
