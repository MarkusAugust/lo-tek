/**
 * Words a build step glues together.
 *
 * In JSX a line break between a piece of text and what stands next to it is
 * not a space. Text with a line break in it loses the blank at that end, and
 * blanks alone with a line break in them are dropped, so
 *
 *     the death was an
 *     <lt-term><a href="#term-act-of-god">act of God</a></lt-term>.
 *
 * reaches the page as "the death was anact of God". An Astro template is
 * built the same way where `compressHTML` is `"jsx"`, which is what Astro
 * has when the project says nothing, from Astro 7. With `compressHTML` set
 * to `true` or `false` the line break is kept, and in HTML it is a space:
 * that is why the recipe looks right in the tab for plain HTML, reads right
 * in the source, and builds right in a project with the setting. Nothing
 * fails where it does not: the page just has a word that is two.
 *
 * `gluedWords` reads one code block and answers with every place in running
 * text where two things on separate lines come out without the space:
 *
 *   - text and an element that stands in a sentence, in either order: a
 *     link, an emphasis and the like, a button, a select or a label, and an
 *     element of the page's own or a component that holds such words,
 *     however its tags are broken over the lines;
 *   - text and an expression, such as `{name}` or `{paid && <strong>…}`;
 *   - two elements of the sentence kind, or one and an expression, when
 *     what they are in is running text: a paragraph, a list item, a
 *     heading, a table cell and the like, or anything that has text of its
 *     own beside them.
 *
 * `{" "}` at the end of the line keeps the space, and so does writing the
 * two on one line.
 *
 * It is not a check of layout. Where the stylesheet makes the gap, nothing
 * is glued that a reader sees: buttons in a row, a label over its field, a
 * radio button and its text, an icon in a button, a badge after a button.
 * So it leaves alone two elements with no text beside them outside a
 * paragraph, text next to an input or an image, and text next to a block.
 * It also leaves alone the first text inside an element and the last before
 * its closing tag, punctuation after an element, and everything that is not
 * markup: the frontmatter, the code around the JSX, and what `<script>` and
 * `<style>` hold.
 */

export type Language = "astro" | "jsx"

export type Glued = {
  /** The line in the block, counted from 1, where the first of the two ends. */
  line: number
  /** What the reader gets, around the place the space is missing. */
  reads: string
}

/** The elements with words in them that stand in a sentence. */
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

/**
 * Controls with words on them. Next to text they are in the sentence, as
 * in "Press Go now". Next to each other they are a row, and the stylesheet
 * makes the gap.
 */
const WITH_WORDS_ON = new Set(["button", "select", "label"])

/** What holds running text: two elements side by side in these are a sentence. */
const RUNNING_TEXT = new Set([
  "p",
  "li",
  "dd",
  "dt",
  "td",
  "th",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "figcaption",
  "caption",
  "summary",
  "legend",
  ...IN_A_SENTENCE,
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

type Text = { kind: "text"; raw: string; start: number }
type Element = {
  kind: "element"
  name: string
  start: number
  end: number
  children: Node[]
}
type Expression = {
  kind: "expression"
  code: string
  start: number
  end: number
  /** The first element written in it, if any. */
  first?: string
}
type Node = Text | Element | Expression

type Frame =
  | { kind: "element"; node: Element }
  | { kind: "code"; depth: number; node?: Expression }

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

const own = (name: string) => name.includes("-") || /^[A-Z]/.test(name)

/** What a node has first and last, of things the reader sees. */
function contents(node: Element): Node[] {
  return node.children.filter(
    (child) => child.kind !== "text" || child.raw.trim() !== "",
  )
}

/**
 * Whether the element stands in a sentence. One of the page's own does when
 * what it holds starts with words, with an expression, or with an element
 * that does: `<lt-term>` around a link, wherever the line breaks are.
 */
function inASentence(node: Node): boolean {
  if (node.kind !== "element") return false
  if (IN_A_SENTENCE.has(node.name)) return true
  if (!own(node.name)) return false
  const first = contents(node)[0]
  return first !== undefined && (first.kind !== "element" || inASentence(first))
}

/** An expression that is only the space that keeps two things apart. */
const isSpace = (node: Node) =>
  node.kind === "expression" && /^\{\s*(["'`])\s+\1\s*\}$/.test(node.code)

/** An expression that writes a block of its own, such as a list's items. */
const writesABlock = (node: Expression) =>
  node.first !== undefined &&
  !IN_A_SENTENCE.has(node.first) &&
  !WITH_WORDS_ON.has(node.first) &&
  !own(node.first)

/** The first or the last word the reader sees of a node. */
function word(node: Node, end: "first" | "last"): string {
  if (node.kind === "text") {
    const words = node.raw.trim().split(/\s+/)
    return end === "first" ? words[0] : words[words.length - 1]
  }
  if (node.kind === "expression") {
    const code = node.code.replace(/\s+/g, " ")
    return code.length > 24 ? `${code.slice(0, 23)}…}` : code
  }
  const inside = contents(node)
  const child = end === "first" ? inside[0] : inside[inside.length - 1]
  return child ? word(child, end) : `<${node.name}>`
}

export function gluedWords(source: string, language: Language): Glued[] {
  let code = source
  if (language === "astro") {
    const frontmatter = /^\s*---\n[\s\S]*?\n\s*---[^\n]*/.exec(code)
    if (frontmatter) code = blank(code, 0, frontmatter[0].length)
  }
  // Comments are not there for the reader, and nothing stands in for them.
  for (const comment of [/<!--[\s\S]*?-->/g, /\{\s*\/\*[\s\S]*?\*\/\s*\}/g])
    code = code.replace(comment, (whole) => whole.replace(/[^\n]/g, " "))

  const found: Glued[] = []
  const lineAt = (index: number) => code.slice(0, index).split("\n").length

  /** Looks at what stands side by side among the children of `parent`. */
  const look = (parent: Element) => {
    const running =
      RUNNING_TEXT.has(parent.name) ||
      parent.children.some(
        (child) => child.kind === "text" && child.raw.trim() !== "",
      )
    let before: Node | undefined
    let gap = ""
    const glued = (a: Node, b: Node) => {
      if (a.kind === "text" && !ENDS_A_WORD.test(a.raw.trimEnd())) return false
      if (b.kind === "text" && !STARTS_A_WORD.test(b.raw.trimStart()))
        return false
      const [text, other] =
        a.kind === "text" ? [a, b] : b.kind === "text" ? [b, a] : []
      if (text && other) {
        if (other.kind === "expression") return !writesABlock(other)
        return (
          inASentence(other) ||
          (other.kind === "element" && WITH_WORDS_ON.has(other.name))
        )
      }
      // Two that are not text: a sentence only where there is running text.
      if (!running) return false
      const sentence = (node: Node) =>
        node.kind === "expression" ? !writesABlock(node) : inASentence(node)
      return (
        (a.kind === "element" || b.kind === "element") &&
        sentence(a) &&
        sentence(b)
      )
    }
    for (const child of parent.children) {
      if (child.kind === "text" && child.raw.trim() === "") {
        gap += child.raw
        continue
      }
      if (isSpace(child)) {
        before = undefined
        gap = ""
        continue
      }
      const lead =
        child.kind === "text"
          ? child.raw.slice(0, child.raw.length - child.raw.trimStart().length)
          : ""
      if (before && (gap + lead).includes("\n") && glued(before, child))
        found.push({
          line: lineAt(
            before.kind === "text"
              ? before.start + before.raw.trimEnd().length
              : before.end,
          ),
          reads: `${word(before, "last")}${word(child, "first")}`,
        })
      before = child
      gap =
        child.kind === "text" ? child.raw.slice(child.raw.trimEnd().length) : ""
    }
  }

  // An Astro template is markup from the top. JSX stands in code.
  const root: Element = {
    kind: "element",
    name: "",
    start: 0,
    end: code.length,
    children: [],
  }
  const stack: Frame[] = [
    language === "astro"
      ? { kind: "element", node: root }
      : { kind: "code", depth: 0 },
  ]
  const top = () => stack[stack.length - 1]
  const add = (node: Node) => {
    const frame = top()
    if (frame.kind === "element") frame.node.children.push(node)
  }
  const addText = (from: number, to: number) => {
    if (to > from) add({ kind: "text", raw: code.slice(from, to), start: from })
  }

  /** Reads the tag that opens at `at`, and answers where to go on from. */
  const openTag = (at: number): number => {
    const name = /^<([A-Za-z][\w.:-]*)?/.exec(code.slice(at))?.[1] ?? ""
    const { end, closed } = endOfTag(code, at)
    const frame = top()
    if (frame.kind === "code" && frame.node && frame.node.first === undefined)
      frame.node.first = name
    const node: Element = {
      kind: "element",
      name,
      start: at,
      end,
      children: [],
    }
    add(node)
    if (closed || (language === "astro" && VOID.has(name))) return end
    if (name === "script" || name === "style") {
      const close = code.indexOf(`</${name}>`, end)
      node.end = close === -1 ? code.length : close + name.length + 3
      return node.end
    }
    stack.push({ kind: "element", node })
    return end
  }

  let i = 0
  let textFrom = 0
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
        if (frame.depth === 0 && frame.node) {
          frame.node.end = i + 1
          frame.node.code = code.slice(frame.node.start, i + 1)
          stack.pop()
          textFrom = i + 1
        }
      } else if (
        c === "<" &&
        /[A-Za-z>]/.test(code[i + 1] ?? "") &&
        !/[\w$)\].]/.test(code[i - 1] ?? " ")
      ) {
        i = openTag(i)
        textFrom = i
        continue
      }
      i += 1
      continue
    }

    // Among the children of an element.
    if (c === "{") {
      addText(textFrom, i)
      const node: Expression = {
        kind: "expression",
        code: "",
        start: i,
        end: i,
      }
      add(node)
      stack.push({ kind: "code", depth: 1, node })
      i += 1
      continue
    }
    if (c === "<" && code[i + 1] === "/") {
      addText(textFrom, i)
      const close = code.indexOf(">", i)
      const end = close === -1 ? code.length : close + 1
      const name = code.slice(i + 2, end - 1).trim()
      // Back to the element this closes, past anything left open in it.
      let at = stack.length - 1
      while (at > 0) {
        const open = stack[at]
        if (open.kind === "element" && open.node.name === name) break
        at -= 1
      }
      if (at > 0) {
        for (const open of stack.splice(at))
          if (open.kind === "element") {
            open.node.end = end
            look(open.node)
          }
      }
      i = end
      textFrom = i
      continue
    }
    if (c === "<" && /[A-Za-z>]/.test(code[i + 1] ?? "")) {
      addText(textFrom, i)
      i = openTag(i)
      textFrom = i
      continue
    }
    i += 1
  }
  if (top().kind === "element") addText(textFrom, code.length)
  // What was never closed, and the template itself.
  for (const open of stack.reverse())
    if (open.kind === "element") look(open.node)
  return found.sort((a, b) => a.line - b.line)
}

/**
 * The rule against cases of its own, so a rule that has gone quiet stops the
 * check rather than passing every page. Answers with what is wrong.
 *
 * What is glued in each case is what `transform` in `@astrojs/compiler-rs`
 * 0.5.2 writes with `compact: "jsx"`, the mode Astro builds in by default:
 * `<p>Hello${name}and welcome</p>`, `<p>Press<button>Go</button>now</p>`,
 * `<label><input type="radio">Dry</label>` and so on.
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
      'export function Policy() {\n  return (\n    <p>\n      the death was an\n      <a href="#x">act of God</a>.\n    </p>\n  )\n}',
      ["anact"],
    ],
    [
      "a plain element in a sentence, both sides",
      "astro",
      "<p>\n  This is\n  <strong>very</strong>\n  important.\n</p>",
      ["isvery", "veryimportant."],
    ],
    [
      "an element of the page's own that opens on a line by itself",
      "astro",
      "<p>\n  was an\n  <lt-term>\n    <a>act</a>\n  </lt-term>.\n</p>",
      ["anact"],
    ],
    [
      "a tag whose attributes are on lines of their own",
      "astro",
      '<p>\n  was an\n  <a\n    href="#x"\n    class="lt-term"\n  >act</a>.\n</p>',
      ["anact"],
    ],
    [
      "after frontmatter",
      "astro",
      '---\nimport { lt } from "@lo-tek/interfaces"\nconst word = "an"\n---\n\n<p>\n  an\n  <em>act</em>\n</p>',
      ["anact"],
    ],
    [
      "a comment between text and an element",
      "astro",
      "<p>\n  an\n  <!-- the term -->\n  <em>act</em>\n</p>",
      ["anact"],
    ],
    [
      "text next to an expression, both sides",
      "jsx",
      "const a = (\n  <p>\n    Hello\n    {name}\n    and welcome\n  </p>\n)",
      ["Hello{name}", "{name}and"],
    ],
    [
      "text before a condition",
      "astro",
      "<p>\n  Total\n  {paid && <strong>paid</strong>}\n</p>",
      ["Total{paid && <strong>paid</…}"],
    ],
    [
      "two elements of a sentence in a paragraph",
      "astro",
      '<p>\n  <strong>One</strong>\n  <em>Two</em>\n</p>\n<p>\n  <a href="#a">One</a>\n  <a href="#b">Two</a>\n</p>',
      ["OneTwo", "OneTwo"],
    ],
    [
      "two elements of a sentence beside text, in anything",
      "astro",
      "<div>\n  Read <strong>One</strong>\n  <em>Two</em>\n</div>",
      ["OneTwo"],
    ],
    [
      "an element and an expression in a paragraph",
      "astro",
      "<p>\n  <strong>Total</strong>\n  {amount}\n</p>",
      ["Total{amount}"],
    ],
    [
      "text next to a button, a select and a label",
      "astro",
      "<p>\n  Press\n  <button>Go</button>\n  now, or pick\n  <select><option>One</option></select>\n</p>\n<div>\n  Then\n  <label>Name</label>\n</div>",
      ["PressGo", "Gonow,", "pickOne", "ThenName"],
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
      "rows the stylesheet spaces: links, buttons, a label over its field",
      "astro",
      '<nav>\n  <a href="#a">One</a>\n  <a href="#b">Two</a>\n</nav>\n<footer>\n  <button>Cancel</button>\n  <button>Delete</button>\n  <span class="lt-badge">New</span>\n</footer>\n<lt-field>\n  <label>Name</label>\n  <input />\n</lt-field>',
      [],
    ],
    [
      "a radio button and its text, an icon and its text",
      "astro",
      '<label>\n  <input type="radio" />\n  Dry\n</label>\n<button>\n  <svg><path d="M0 0" /></svg>\n  Save\n</button>',
      [],
    ],
    [
      "terms and their descriptions",
      "astro",
      "<dl>\n  <dt>Act of God</dt>\n  <dd>Not covered.</dd>\n</dl>",
      [],
    ],
    [
      "text over a block, an input, or a block of the page's own with words",
      "astro",
      '<div>\n  Pick one\n  <ul><li>One</li></ul>\n  or write it\n  <input class="lt-input" />\n  or pick one\n  <lt-field><label>Name</label></lt-field>\n</div>',
      [],
    ],
    [
      "text over a list written by an expression",
      "jsx",
      "const list = (\n  <ul>\n    {items.map((item) => (\n      <li key={item}>{item}</li>\n    ))}\n  </ul>\n)\nconst a = (\n  <div>\n    Items\n    {items.map((item) => <p>{item}</p>)}\n  </div>\n)",
      [],
    ],
    [
      "punctuation after an element",
      "astro",
      `<p>\n  Not covered: an ${TERM}\n  .\n</p>`,
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
