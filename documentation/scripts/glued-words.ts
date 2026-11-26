/**
 * Words a build step glues together.
 *
 * In JSX, and in an Astro template, a line break between a piece of text and
 * an element is not a space. Text that has a line break in it loses the
 * blank at that end, so
 *
 *     the death was an
 *     <lt-term><a href="#term-act-of-god">act of God</a></lt-term>.
 *
 * reaches the page as "the death was anact of God". In HTML the same two
 * lines have a space between them, which is why the recipe looks right in
 * the tab for plain HTML and reads right in the source. Nothing fails: the
 * page just has a word that is two.
 *
 * `gluedWords` reads one code block and answers with every place where text
 * on one line and an element with words in it on the next, in either order,
 * come out without the space. `{" "}` at the end of the line keeps it, and
 * so does writing the two on one line.
 *
 * What it leaves alone, since no word is glued there: a line break between
 * an element and the first text inside it or the last text and its closing
 * tag, between two elements, between text and an element that is a block of
 * its own or a control, next to an expression, and everything that is not
 * markup: the frontmatter, the code around the JSX, and what `<script>` and
 * `<style>` hold.
 */

export type Language = "astro" | "jsx"

export type Glued = {
  /** The line in the block, counted from 1, where the text ends or starts. */
  line: number
  /** What the reader gets, around the place the space is missing. */
  reads: string
}

/**
 * The elements with words in them that stand in a sentence: the ones a
 * missing space is seen at. An element of the page's own, such as
 * `<lt-term>` or a component, counts when it has text in it on the same
 * line.
 */
const IN_A_SENTENCE = new Set([
  "a",
  "abbr",
  "b",
  "cite",
  "code",
  "del",
  "dfn",
  "em",
  "i",
  "ins",
  "kbd",
  "mark",
  "q",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "time",
  "u",
  "var",
])

/** The elements HTML closes by itself, which an Astro template may leave open. */
const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
])

/** The end of a word or a sentence: what a following word needs a space after. */
const ENDS_A_WORD = /[\p{L}\p{N}.,;:!?)%"'’”]$/u
/** The start of a word: what needs a space before it. */
const STARTS_A_WORD = /^[\p{L}\p{N}(“‘"']/u

type Frame = {
  kind: "element" | "code"
  name: string
  /** Open braces in a frame of code. */
  depth: number
  /** The element that ended last among the children, if nothing came after. */
  ended?: { name: string; words: string }
}

/** `text` with everything between `from` and `to` made blank, the lines kept. */
function blank(text: string, from: number, to: number): string {
  return (
    text.slice(0, from) +
    text.slice(from, to).replace(/[^\n]/g, " ") +
    text.slice(to)
  )
}

/** Where the tag that starts at `at` ends, and whether it closes itself. */
function endOfTag(code: string, at: number): { end: number; closed: boolean } {
  let braces = 0
  let quote = ""
  for (let i = at; i < code.length; i++) {
    const c = code[i]
    if (quote) {
      if (c === quote) quote = ""
      continue
    }
    if (braces > 0) {
      if (c === "{") braces += 1
      else if (c === "}") braces -= 1
      else if (c === '"' || c === "'" || c === "`") quote = c
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if (c === "{") braces = 1
    else if (c === ">") return { end: i + 1, closed: code[i - 1] === "/" }
  }
  return { end: code.length, closed: true }
}

/** The words an element starts with, when they stand on the line it opens on. */
function firstWords(code: string, from: number): string {
  const end = code.indexOf("\n", from)
  return code
    .slice(from, end === -1 ? code.length : end)
    .replace(/<[^>]*>/g, "")
    .replace(/\{[^}]*\}/g, "")
    .trim()
}

function inASentence(name: string, words: string): boolean {
  if (IN_A_SENTENCE.has(name)) return true
  // An element of the page's own: only when it visibly holds words.
  const own = name.includes("-") || /^[A-Z]/.test(name)
  return own && /[\p{L}\p{N}]/u.test(words)
}

export function gluedWords(source: string, language: Language): Glued[] {
  let code = source
  if (language === "astro") {
    const frontmatter = /^\s*---\n[\s\S]*?\n\s*---[^\n]*/.exec(code)
    if (frontmatter) code = blank(code, 0, frontmatter[0].length)
  }
  for (const pattern of [
    /<!--[\s\S]*?-->/g,
    /\{\s*\/\*[\s\S]*?\*\/\s*\}/g,
    /(<(script|style)\b[^>]*>)([\s\S]*?)(?=<\/\2>)/g,
  ])
    code = code.replace(pattern, (whole, open?: string) =>
      typeof open === "string" && whole.startsWith("<s")
        ? open + whole.slice(open.length).replace(/[^\n]/g, " ")
        : whole.replace(/[^\n]/g, " "),
    )

  const found: Glued[] = []
  const lineAt = (index: number) => code.slice(0, index).split("\n").length
  // An Astro template is markup from the top. JSX stands in code.
  const stack: Frame[] = [
    language === "astro"
      ? { kind: "element", name: "", depth: 0 }
      : { kind: "code", name: "", depth: 0 },
  ]
  const top = () => stack[stack.length - 1]

  /** The text of a run among an element's children, with what stood before it. */
  let run = ""
  let runStart = 0
  const endRun = (at: number, next?: { name: string; words: string }) => {
    const frame = top()
    const text = run
    run = ""
    const words = text.trim()
    if (words === "") {
      // Only blanks: what ended before still stands next to what comes.
      if (next) frame.ended = undefined
      return
    }
    const before = frame.ended
    frame.ended = undefined
    const lead = text.slice(0, text.length - text.trimStart().length)
    const trail = text.slice(text.trimEnd().length)
    if (
      before &&
      lead.includes("\n") &&
      STARTS_A_WORD.test(words) &&
      inASentence(before.name, before.words)
    )
      found.push({
        line: lineAt(runStart + lead.length),
        reads: `${before.words.split(/\s+/).pop() ?? ""}${words.split(/\s+/)[0]}`,
      })
    if (
      next &&
      trail.includes("\n") &&
      ENDS_A_WORD.test(words) &&
      inASentence(next.name, next.words)
    )
      found.push({
        line: lineAt(at - trail.length),
        reads: `${words.split(/\s+/).pop() ?? ""}${next.words.split(/\s+/)[0] ?? ""}`,
      })
  }

  let i = 0
  while (i < code.length) {
    const frame = top()
    const c = code[i]

    if (frame.kind === "code") {
      if (c === '"' || c === "'" || c === "`") {
        let j = i + 1
        while (j < code.length && code[j] !== c) j += code[j] === "\\" ? 2 : 1
        i = j + 1
        continue
      }
      if (
        c === "/" &&
        code[i + 1] === "/" &&
        !/[:\w]/.test(code[i - 1] ?? " ")
      ) {
        const end = code.indexOf("\n", i)
        i = end === -1 ? code.length : end
        continue
      }
      if (c === "/" && code[i + 1] === "*") {
        const end = code.indexOf("*/", i + 2)
        i = end === -1 ? code.length : end + 2
        continue
      }
      if (c === "{") frame.depth += 1
      else if (c === "}") {
        frame.depth -= 1
        // The end of an expression among an element's children.
        if (frame.depth === 0 && stack.length > 1 && frame.name === "{") {
          stack.pop()
          top().ended = undefined
          runStart = i + 1
        }
      } else if (
        c === "<" &&
        /[A-Za-z>]/.test(code[i + 1] ?? "") &&
        !/[\w$)\].]/.test(code[i - 1] ?? " ")
      ) {
        i = openTag(i)
        continue
      }
      i += 1
      continue
    }

    // Among the children of an element.
    if (c === "{") {
      endRun(i)
      top().ended = undefined
      stack.push({ kind: "code", name: "{", depth: 1 })
      i += 1
      continue
    }
    if (c === "<" && code[i + 1] === "/") {
      endRun(i)
      const end = code.indexOf(">", i)
      const name = code.slice(i + 2, end === -1 ? code.length : end).trim()
      // Back to the element this closes, past anything left open in it.
      let at = stack.length - 1
      while (
        at > 0 &&
        !(stack[at].kind === "element" && stack[at].name === name)
      )
        at -= 1
      if (at > 0) {
        const closed = stack[at]
        stack.length = at
        // The words the element ended with are the ones before its tag.
        const inside = code
          .slice(0, i)
          .replace(/<[^>]*>/g, " ")
          .trimEnd()
        top().ended = {
          name: closed.name,
          words: inside.split(/\s+/).pop() ?? "",
        }
      }
      i = end === -1 ? code.length : end + 1
      runStart = i
      continue
    }
    if (c === "<" && /[A-Za-z>]/.test(code[i + 1] ?? "")) {
      i = openTag(i)
      continue
    }
    if (run === "") runStart = i
    run += c
    i += 1
  }
  return found

  /** Reads the tag that opens at `at`, and answers where to go on from. */
  function openTag(at: number): number {
    const name = /^<([A-Za-z][\w.:-]*)?/.exec(code.slice(at))?.[1] ?? ""
    const { end, closed } = endOfTag(code, at)
    const words = firstWords(code, at)
    if (top().kind === "element") endRun(at, { name, words })
    if (closed || (language === "astro" && VOID.has(name.toLowerCase()))) {
      if (top().kind === "element") top().ended = { name, words: "" }
      runStart = end
      return end
    }
    if (name === "script" || name === "style") {
      const close = code.indexOf(`</${name}>`, end)
      const after = close === -1 ? code.length : close + name.length + 3
      if (top().kind === "element") top().ended = undefined
      runStart = after
      return after
    }
    stack.push({ kind: "element", name, depth: 0 })
    runStart = end
    return end
  }
}

/**
 * The rule against cases of its own, so a rule that has gone quiet stops the
 * check rather than passing every page. Answers with what is wrong.
 */
export function selfTest(): string[] {
  const TERM = "<lt-term><a {...actOfGod.word}>act of God</a></lt-term>"
  const cases: Array<[string, Language, string, string[]]> = [
    [
      "text, then an element on the next line",
      "astro",
      `<p>\n  the death was an\n  ${TERM}.\n</p>`,
      ["anact"],
    ],
    [
      "an element, then text on the next line",
      "astro",
      `<p>\n  An ${TERM}\n  is not covered.\n</p>`,
      ["Godis"],
    ],
    [
      "the same in JSX, in a component",
      "jsx",
      `export function Policy() {\n  return (\n    <p>\n      the death was an\n      <a href="#x">act of God</a>.\n    </p>\n  )\n}`,
      ["anact"],
    ],
    [
      "a plain element in a sentence, both sides",
      "astro",
      "<p>\n  This is\n  <strong>very</strong>\n  important.\n</p>",
      ["isvery", "veryimportant."],
    ],
    [
      "after frontmatter that has a line of text over an import",
      "astro",
      `---\nimport { lt } from "@lo-tek/interfaces"\nconst word = "an"\n---\n\n<p>\n  an\n  <em>act</em>\n</p>`,
      ["anact"],
    ],
    [
      'kept with {" "} at the end of the line',
      "astro",
      `<p>\n  the death was an{" "}\n  ${TERM}.\n</p>`,
      [],
    ],
    ["kept on one line", "astro", `<p>the death was an ${TERM}.</p>`, []],
    [
      "the first text in an element, and the last",
      "astro",
      '<p>\n  A claim is paid out.\n</p>\n<a href="#x">\n  Read on\n</a>',
      [],
    ],
    [
      "two elements, one under the other",
      "astro",
      '<dl>\n  <dt>Act of God</dt>\n  <dd>Not covered.</dd>\n</dl>\n<a href="#a">One</a>\n<a href="#b">Two</a>',
      [],
    ],
    [
      "text over a block or a control",
      "astro",
      '<div>\n  Pick one\n  <ul><li>One</li></ul>\n  or write it\n  <input class="lt-input" />\n  <lt-field><label>Name</label></lt-field>\n</div>',
      [],
    ],
    [
      "punctuation after an element",
      "astro",
      `<p>\n  Not covered: an ${TERM}\n  .\n</p>`,
      [],
    ],
    [
      "text next to an expression",
      "jsx",
      "const a = (\n  <p>\n    Hello\n    {name}\n    and welcome\n  </p>\n)",
      [],
    ],
    [
      "code around JSX, with types and comparisons",
      "jsx",
      'const [open, setOpen] = useState<boolean>(false)\nconst small = a < b\n// A link\nconst link = <a href="#x">act</a>\nconst next = 1\nexport function Page() {\n  return open ? <b>yes</b> : null\n}',
      [],
    ],
    [
      "script and style in a template",
      "astro",
      '<p>Text</p>\n<script>\n  const a = 1\n  customElements.define("x-y", Y)\n</script>\n<style>\n  p { color: red }\n</style>',
      [],
    ],
    [
      "a comment between text and an element",
      "astro",
      "<p>\n  an\n  <!-- the term -->\n  <em>act</em>\n</p>",
      ["anact"],
    ],
  ]
  const broken: string[] = []
  for (const [name, language, code, expected] of cases) {
    const got = gluedWords(code, language).map((glued) => glued.reads)
    if (JSON.stringify(got) !== JSON.stringify(expected))
      broken.push(
        `"${name}": expected ${JSON.stringify(expected)}, found ${JSON.stringify(got)}`,
      )
  }
  return broken
}
