/**
 * That every text the package writes into the page can be translated.
 *
 * LO-TEK has almost no text: whoever renders writes it, in their own
 * language. What is left are defaults, and each of them has to be
 * replaceable. A new text written straight into a component could not be,
 * and nobody would notice until an English page read something out in
 * another language.
 *
 * Three rules:
 *
 *   - a text for the user in a component is in `default-texts.ts`, not a
 *     string in the component. That covers `setText`, `textContent`,
 *     `append`, `aria-label` and constants named `DEFAULT_…`;
 *   - a text in `content:` in CSS is read from an `--lt-` variable, with the
 *     text as the fallback, since a stylesheet cannot import anything. The
 *     variable may be the alternative text after a symbol, as in
 *     `"\2713" / var(--lt-steps-done-text, "Completed")`;
 *   - each of the texts is in the table on the documentation page about
 *     translation, so the page cannot promise that everything can be
 *     translated without saying how.
 *
 * The check reads the source, as `check-writes.ts` does. It catches the
 * forms that appear in these files and the ones closest to hand next time,
 * not every conceivable way of getting text into a page.
 *
 * Run with: bun scripts/check-texts.ts, or as part of `bun run build`.
 */

import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { DEFAULT_TEXTS } from "../src/components/default-texts.js"
import { isText, replaceableText, stringsIn } from "./css-text.js"

const COMPONENTS = new URL("../src/components", import.meta.url).pathname
const TEXT_FILE = join(COMPONENTS, "default-texts.ts")
const PAGE = new URL(
  "../../documentation/src/content/docs/translation.mdx",
  import.meta.url,
).pathname

function files(folder: string, extension: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) return files(path, extension)
    if (!entry.name.endsWith(extension)) return []
    if (entry.name.includes(".test.")) return []
    return [path]
  })
}

/** The source without comments, keeping the line breaks so the line numbers match. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length
}

/** A string that contains at least one letter, so text and not a symbol. */
// `\x60` is a backtick, which cannot be escaped the usual way with the Unicode flag.
const TEXT = String.raw`(["'\x60])((?:(?!\1)[^\\]|\\.)*\p{L}(?:(?!\1)[^\\]|\\.)*)\1`

/**
 * A line that writes text into the page. A string with letters on such a
 * line is text for the user, wherever in the call it stands:
 * `setText(s, n ? "a" : "b")` is as much text as `setText(s, "a")`, and
 * `setText(this.querySelector("[role=status]"), "a")` as much as both.
 */
const WRITES_TEXT = new RegExp(
  [
    String.raw`\bsetText\(`,
    String.raw`\.(?:textContent|innerText|ariaLabel)\s*=`,
    String.raw`\bcreateTextNode\(`,
    String.raw`\.(?:append|prepend)\(`,
    String.raw`["'](?:aria-label|title|placeholder)["']\s*,`,
    String.raw`\bconst\s+DEFAULT_\w+\s*=`,
  ].join("|"),
)

/** The attribute names themselves are not text. */
const NOT_TEXT = new Set(["aria-label", "title", "placeholder"])

/**
 * The line without what is not text: the arguments to DOM lookups, which are
 * selectors, and the string in a comparison, like `name === "label"`.
 */
function withoutSelectors(code: string): string {
  return code
    .replace(
      /\b(?:querySelector(?:All)?|closest|matches|getAttribute|hasAttribute)\((?:[^()]|\([^()]*\))*\)/g,
      "",
    )
    .replace(/[!=]==\s*(["'])(?:(?!\1).)*\1/g, "")
}

const problems: string[] = []

let tsRead = 0
for (const file of files(COMPONENTS, ".ts")) {
  if (file === TEXT_FILE) continue
  const source = withoutComments(readFileSync(file, "utf8"))
  source.split("\n").forEach((code, i) => {
    if (!WRITES_TEXT.test(code)) return
    for (const match of withoutSelectors(code).matchAll(
      new RegExp(TEXT, "gu"),
    )) {
      if (NOT_TEXT.has(match[2])) continue
      problems.push(
        `${relative(process.cwd(), file)}:${i + 1}: the text "${match[2]}" ` +
          "is in the component. Put it in default-texts.ts, with a way to " +
          "replace it.",
      )
    }
  })
  tsRead++
}

const fallbacks: string[] = []
let cssRead = 0
for (const file of files(COMPONENTS, ".css")) {
  const source = withoutComments(readFileSync(file, "utf8"))
  // Not the condition of an `@supports (content: …)`, which is no text.
  for (const match of source.matchAll(/(?<![(\w-])content\s*:\s*([^;}]+)/g)) {
    const value = match[1].trim()
    // A symbol like "/" or "×" is not language. A letter is, also when
    // escaped: `\e5 ` is å.
    const texts = stringsIn(value).filter(isText)
    if (texts.length === 0) continue
    // The whole value has to be one variable with the text as the fallback,
    // or a symbol with the variable as its alternative text. Text next to the
    // variable cannot be replaced, and a letter in the symbol is text.
    if (replaceableText(value) === undefined) {
      problems.push(
        `${relative(process.cwd(), file)}:${lineOf(source, match.index ?? 0)}: ` +
          `content: ${value} has text that cannot be replaced. ` +
          "Read it from an --lt- variable, with the text as the fallback.",
      )
      continue
    }
    fallbacks.push(...texts)
  }
  cssRead++
}

/*
 * Every text has to be on the page about translation. Leading and trailing
 * spaces are decoration in the CSS, not part of the text, and `{n}` stays as
 * it is.
 */
let pageText = ""
try {
  pageText = readFileSync(PAGE, "utf8")
} catch {
  problems.push(`Could not find ${relative(process.cwd(), PAGE)}.`)
}
if (pageText !== "" && pageText.trim() === "") {
  problems.push(`${relative(process.cwd(), PAGE)} is empty.`)
}
/*
 * The text has to be in a cell of the table, not anywhere on the page. A
 * word in the body text, or an asterisk in bold, is not the table.
 */
const cells = new Set(
  [...pageText.matchAll(/\|([^|\n]+)(?=\|)/g)].map((cell) =>
    cell[1].trim().replace(/^`(.*)`$/, "$1"),
  ),
)
const expected = [...Object.values(DEFAULT_TEXTS), ...new Set(fallbacks)]
let documented = 0
for (const text of expected) {
  const core = text.trim()
  if (!cells.has(core)) {
    problems.push(
      `The text "${core}" is not in the table on ${relative(process.cwd(), PAGE)}.`,
    )
    continue
  }
  documented++
}

/*
 * Count what was actually done, and require it to be more than zero. A check
 * that found not a single file or text has checked nothing.
 */
if (tsRead === 0 || cssRead === 0) {
  problems.push(
    `Read ${tsRead} TypeScript files and ${cssRead} stylesheets. Both must be more than zero.`,
  )
}
if (expected.length === 0) {
  problems.push("Found no default texts to check.")
}

if (problems.length > 0) {
  console.error(
    `The texts cannot be translated:\n\n${problems.map((a) => `  ${a}`).join("\n")}\n`,
  )
  process.exit(1)
}

console.log(
  `The texts can be translated: ${tsRead} component files and ${cssRead} stylesheets read, ` +
    `${documented} of ${expected.length} default texts are on the translation page.`,
)
