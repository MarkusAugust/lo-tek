/**
 * What a recipe needs around its markup: the stylesheets, the registration
 * and, in a Datastar recipe, Datastar itself, in that order.
 *
 * The setup was written out by hand in every tab and in the rulebooks, and
 * one copy at a time drifted: eight Datastar tabs and the rulebook loaded
 * Datastar before the registration (0bfbb64). Here it is computed from the
 * markup, so no page lists its components, and every tab is held to the
 * answer.
 *
 * Run with: bun scripts/page-setup.ts, which feeds the rules the cases below.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import pkg from "../package.json"
import { SAMPLE } from "./builder-sample"

const PACKAGE = join(import.meta.dirname, "..")

export type Target = "html" | "datastar" | "react" | "astro"

export interface Setup {
  /**
   * The stylesheets by their name in `exports`: `tokens.css` first, then in
   * the order the markup first uses them, so the component a recipe is about
   * comes before the ones inside it.
   */
  stylesheets: string[]
  /** The `defineLt*` functions the markup needs, in the order it uses them. */
  register: string[]
  /** Whether Datastar is loaded, after the registration. */
  datastar: boolean
}

/**
 * Every component stylesheet in `exports` under its name there, with its
 * text. Only those under `src/components/`: `tokens.css` and `boundary.css`
 * name `lt-` classes too, but define none of them.
 */
const SHEETS: Array<{ name: string; text: string }> = Object.entries(
  pkg.exports as Record<string, unknown>,
)
  .filter(
    ([name, target]) =>
      name.endsWith(".css") &&
      typeof target === "string" &&
      target.startsWith("./src/components/"),
  )
  .map(([name, target]) => ({
    name: name.slice(2),
    text: readFileSync(join(PACKAGE, target as string), "utf8"),
  }))
  .sort((a, b) => a.name.localeCompare(b.name))

/** The stylesheet that defines each `lt-` class. */
const BY_CLASS = new Map<string, string>()
for (const { name, text } of SHEETS)
  for (const m of text.matchAll(/\.(lt-[a-z0-9-]+(?:__[a-z0-9-]+)?)/g))
    if (!BY_CLASS.has(m[1])) BY_CLASS.set(m[1], name)

/** The stylesheets each one brings along with `@import`, all the way down. */
const IMPORTS = new Map<string, Set<string>>()
for (const { name, text } of SHEETS)
  IMPORTS.set(
    name,
    new Set(
      [...text.matchAll(/@import "[^"]*\/([a-z0-9-]+\.css)"/g)].map(
        (m) => m[1],
      ),
    ),
  )
function brought(sheet: string, seen = new Set<string>()): Set<string> {
  for (const next of IMPORTS.get(sheet) ?? [])
    if (!seen.has(next)) {
      seen.add(next)
      brought(next, seen)
    }
  return seen
}

/**
 * The function that registers each web component, paired by name with the
 * `LT_*_TAG` constants of the main entry point. Read from the source, since
 * `generate` runs before `dist` is built.
 */
const entry: Record<string, unknown> = await import("../src/index")
/** The `defineLt*` of each tag the package registers. */
export const DEFINERS = new Map<string, string>()
for (const [name, tag] of Object.entries(entry)) {
  const m = name.match(/^LT_([A-Z_]+)_TAG$/)
  if (!m || typeof tag !== "string") continue
  const definer = `defineLt${m[1].toLowerCase().replace(/(^|_)([a-z])/g, (_, __, c) => c.toUpperCase())}`
  if (typeof entry[definer] !== "function")
    throw new Error(`${name} has no ${definer} in the main entry point`)
  DEFINERS.set(tag, definer)
}

/**
 * The stylesheet of each web component is the one named after it. Looking
 * for the element in the selectors missed `term.css`, which styles only the
 * classes `<lt-term>` writes itself.
 */
const OWN_SHEET = new Map<string, string>()
for (const tag of DEFINERS.keys()) {
  const sheet = `${tag.slice(3)}.css`
  if (!SHEETS.some((s) => s.name === sheet))
    throw new Error(`<${tag}> has no ${sheet} in exports`)
  OWN_SHEET.set(tag, sheet)
}

/**
 * The classes each builder function gives: those its call returns, at any
 * depth, and those hung on the function itself (`lt.switch.row`).
 *
 * The call needs options: `lt.tabs()` throws without `keys`, and
 * `lt.sessionTimeout()` without `titleId`. A function that throws even with
 * them stops the script, since swallowing the error left the classes of the
 * tabs out of the table in `check-recipes.ts` without a word.
 */
const { lt } = (await import("../src/lt")) as {
  lt: Record<string, unknown>
}
/**
 * The classes of each builder function, each with how the function gives
 * it: `dialog` for a class the call returns, `switch.row` for one hung on
 * the function. `check-recipes.ts` names the function in its messages.
 */
export const BUILDER_CLASSES = new Map<string, Map<string, string>>()
for (const [name, builder] of Object.entries(lt)) {
  if (typeof builder !== "function") continue
  const classes = new Map<string, string>()
  const collect = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(collect)
    if (!value || typeof value !== "object") return
    for (const [key, v] of Object.entries(value)) {
      if (key === "class" && typeof v === "string") {
        for (const k of v.split(/\s+/))
          if (k && !classes.has(k)) classes.set(k, name)
      } else collect(v)
    }
  }
  try {
    collect((builder as (o: unknown) => unknown)(SAMPLE))
  } catch (error) {
    throw new Error(
      `lt.${name}() throws with ${JSON.stringify(SAMPLE)}: ${error}`,
    )
  }
  for (const [key, v] of Object.entries(builder))
    if (typeof v === "string" && v.startsWith("lt-") && !classes.has(v))
      classes.set(v, `${name}.${key}`)
  BUILDER_CLASSES.set(name, classes)
}

/**
 * The strings and the line comments of JavaScript, in one pass from left to
 * right, so a `//` inside a string or an address is not taken for a comment.
 */
const SCRIPT_TOKENS =
  /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\[\s\S])*`|(?<![:\w])\/\/.*$/gm

/**
 * The code without its comments, since a comment that mentions `<lt-dialog>`
 * asks for nothing. Outside a `<script>` a line comment is a line that starts
 * with `//`: one after whitespace further in can be text in an element, and
 * the markup after it went missing from the setup. Inside a `<script>` it is
 * JavaScript, and `go() // defineLtDialog()` registers nothing.
 */
export function withoutComments(code: string): string {
  return code
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(
      /(<script\b[^>]*>)([\s\S]*?)(<\/script>)/g,
      (_, open: string, body: string, close: string) =>
        open +
        body.replace(SCRIPT_TOKENS, (m) => (m[0] === "/" ? "" : m)) +
        close,
    )
}

export function pageSetup(target: Target, written: string): Setup {
  const code = withoutComments(written)
  const register: string[] = []
  // Each needed sheet with where the markup first uses it.
  const needed = new Map<string, number>()
  const need = (sheet: string | undefined, at: number) => {
    if (sheet && !(needed.has(sheet) && (needed.get(sheet) ?? 0) <= at))
      needed.set(sheet, at)
  }
  for (const m of code.matchAll(/<(lt-[a-z0-9-]+)[\s/>]/g)) {
    const definer = DEFINERS.get(m[1])
    if (definer && !register.includes(definer)) register.push(definer)
    need(OWN_SHEET.get(m[1]), m.index)
  }
  for (const m of code.matchAll(/\bclass(?:Name)?="([^"]*)"/g))
    for (const k of m[1].split(/\s+/)) need(BY_CLASS.get(k), m.index)
  // Any reference to a builder function counts, `const box = lt.dialog(…)`
  // as much as `{...lt.button(…)}`: the variable carries the same classes.
  for (const m of code.matchAll(/\blt\.([a-zA-Z]+)\b/g))
    for (const k of BUILDER_CLASSES.get(m[1])?.keys() ?? [])
      need(BY_CLASS.get(k), m.index)
  // A sheet another needed sheet imports comes along by itself.
  for (const sheet of [...needed.keys()])
    for (const inner of brought(sheet)) needed.delete(inner)
  return {
    stylesheets: [
      "tokens.css",
      ...[...needed].sort((a, b) => a[1] - b[1]).map(([sheet]) => sheet),
    ],
    register,
    datastar: target === "datastar",
  }
}

/** The one address every recipe loads Datastar from. */
export const DATASTAR_SRC =
  "https://cdn.jsdelivr.net/gh/starfederation/datastar@v1.0.4/bundles/datastar.js"

/** Every stylesheet in `exports` by the path it has in the package. */
const BY_PATH = new Map<string, string>(
  Object.entries(pkg.exports as Record<string, unknown>)
    .filter(([name, t]) => name.endsWith(".css") && typeof t === "string")
    .map(([name, t]) => [(t as string).slice(2), name.slice(2)]),
)

/**
 * The rule that Datastar loads after the registration, as cases both sides
 * answer: `checkSetup` here, and `templateProblems` in `RecipesTest.kt`, which
 * reads them from `recipes.json`. A case is the scripts of a page in order,
 * each side writing a block with its own addresses, and whether Datastar
 * then stands before the registration. The answers are written out by hand.
 */
export const ORDER_CASES: Array<{
  name: string
  blocks: Array<"registration" | "commented-registration" | "datastar">
  before: boolean
}> = [
  {
    name: "Datastar after the registration",
    blocks: ["registration", "datastar"],
    before: false,
  },
  {
    name: "Datastar before the registration",
    blocks: ["datastar", "registration"],
    before: true,
  },
  {
    name: "Datastar on a page with nothing to register",
    blocks: ["datastar"],
    before: false,
  },
  {
    name: "a registration in a comment after code is no registration",
    blocks: ["datastar", "commented-registration"],
    before: false,
  },
  {
    name: "Datastar twice, once on each side of the registration",
    blocks: ["datastar", "registration", "datastar"],
    before: true,
  },
]

/** What `recipes.json` carries for the Kotlin side, so it has no copy of its own. */
export const SHARED_SETUP = {
  datastar: DATASTAR_SRC,
  /** The `defineLt*` of each tag, from the package, never made from the tag's name. */
  definers: Object.fromEntries(DEFINERS),
  orderCases: ORDER_CASES,
}

/** The setup a tab actually writes, read from its code. */
function written(code: string): {
  stylesheets: Set<string>
  register: string[]
} {
  const stylesheets = new Set<string>()
  // The calls, not the imports: a recipe that imports and forgets the call
  // registers nothing.
  const register = [
    ...new Set(
      [...code.matchAll(/\b(defineLt\w*)\s*\(\s*\)/g)].map((m) => m[1]),
    ),
  ]
  for (const m of code.matchAll(
    /href="https:\/\/cdn\.jsdelivr\.net\/npm\/@lo-tek\/interfaces@[^/]+\/([^"]+)"/g,
  ))
    stylesheets.add(BY_PATH.get(m[1]) ?? m[1])
  for (const m of code.matchAll(
    /["']@lo-tek\/interfaces\/([a-z0-9-]+\.css)["']/g,
  ))
    stylesheets.add(m[1])
  return { stylesheets, register }
}

/**
 * What is wrong with the setup a tab writes, held to what its markup needs.
 * Each finding is a sentence that completes "the tab …".
 *
 * `part` is a piece of a recipe. An `illustration` is a tab outside "How to
 * use it": it need not repeat the stylesheets the recipe gave, but it must
 * register what it shows and, in Datastar, load Datastar, since a reader
 * pastes the tab as it is. A `fragment` is a block in a rulebook, which
 * spreads the setup over its sections, so it may leave out all of it. What
 * either writes is held to the same rules as a whole recipe.
 */
export function checkSetup(
  target: Target,
  code: string,
  { part }: { part?: "illustration" | "fragment" } = {},
): string[] {
  const clean = withoutComments(code)
  const wanted = pageSetup(target, clean)
  const given = written(clean)
  const out: string[] = []
  // An illustration that shows only the setup, with no markup of its own,
  // cannot give too much: what it shows is for the markup elsewhere.
  const onlySetup =
    part && wanted.stylesheets.length === 1 && wanted.register.length === 0
  // `lotek.css` is every stylesheet in one file, so alone it is exactly right.
  const whole =
    given.stylesheets.size === 1 && given.stylesheets.has("lotek.css")
  if (!whole && !onlySetup) {
    if (!part)
      for (const sheet of wanted.stylesheets)
        if (!given.stylesheets.has(sheet)) out.push(`does not give ${sheet}`)
    for (const sheet of given.stylesheets)
      if (!wanted.stylesheets.includes(sheet))
        out.push(`gives ${sheet}, which the markup does not need`)
  }
  // `defineLt()` registers every web component, so alone it is exactly right.
  const all = given.register.length === 1 && given.register[0] === "defineLt"
  if (!all && !onlySetup) {
    if (part !== "fragment")
      for (const definer of wanted.register)
        if (!given.register.includes(definer))
          out.push(`does not call ${definer}()`)
    for (const definer of given.register)
      if (!wanted.register.includes(definer))
        out.push(`calls ${definer}(), which the markup does not need`)
  }

  // Module scripts run in the order they stand, so Datastar after the
  // registration means no request at load reaches a web component that has
  // not been upgraded (0bfbb64).
  const tags = [...clean.matchAll(/<script\b[^>]*>/g)].filter((m) =>
    /\bsrc="[^"]*datastar[^"]*\.js"/.test(m[0]),
  )
  if (part !== "fragment" && wanted.datastar && tags.length === 0)
    out.push("does not load Datastar")
  if (!wanted.datastar && tags.length > 0)
    out.push("loads Datastar, which only a Datastar recipe does")
  const registration = clean.search(/\bdefineLt\w*\s*\(\s*\)/)
  for (const tag of tags) {
    if (registration !== -1 && (tag.index ?? 0) < registration)
      out.push("loads Datastar before the registration")
    if (/\basync\b/.test(tag[0]))
      out.push("loads Datastar with async, which takes it out of the order")
    const src = tag[0].match(/\bsrc="([^"]*)"/)?.[1]
    if (src !== DATASTAR_SRC)
      out.push(`loads Datastar from ${src}, not ${DATASTAR_SRC}`)
    if (!/\btype="module"/.test(tag[0]))
      out.push(
        'loads Datastar without type="module", which runs it before the module scripts',
      )
  }
  return out
}

/**
 * The rules, fed known markup every time something reads the setup. Each case
 * is a worked example with the answer written out, never computed the way
 * `pageSetup` computes it.
 */
export function selfTest(): string[] {
  const broken: string[] = []
  const expect = (name: string, actual: Setup, wanted: Setup) => {
    if (JSON.stringify(actual) !== JSON.stringify(wanted))
      broken.push(
        `${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(wanted)}`,
      )
  }

  expect(
    "a CSS class needs its stylesheet and the tokens",
    pageSetup("html", `<button class="lt-button" type="button">Save</button>`),
    {
      stylesheets: ["tokens.css", "button.css"],
      register: [],
      datastar: false,
    },
  )
  expect(
    "a stylesheet another one imports is not needed on its own",
    pageSetup("html", `<input class="lt-input lt-search" type="search">`),
    {
      stylesheets: ["tokens.css", "search.css"],
      register: [],
      datastar: false,
    },
  )
  expect(
    "a web component needs its stylesheet and its registration, and Datastar a tab of its own",
    pageSetup(
      "datastar",
      `<lt-dialog id="confirm" open><dialog class="lt-dialog" open><h2>Cancel?</h2></dialog></lt-dialog>`,
    ),
    {
      stylesheets: ["tokens.css", "dialog.css"],
      register: ["defineLtDialog"],
      datastar: true,
    },
  )
  expect(
    "a web component styled by its element alone needs its stylesheet",
    pageSetup("html", `<lt-toast label="Notifications"></lt-toast>`),
    {
      stylesheets: ["tokens.css", "toast.css"],
      register: ["defineLtToast"],
      datastar: false,
    },
  )
  expect(
    "a web component needs its own stylesheet, also when the classes in it are ones the web component writes",
    pageSetup(
      "html",
      `<p>Paid unless an <lt-term><a href="#act">act of God</a></lt-term>.</p>`,
    ),
    {
      stylesheets: ["tokens.css", "term.css"],
      register: ["defineLtTerm"],
      datastar: false,
    },
  )
  expect(
    "a builder function needs the stylesheets of the classes it gives, also through a variable, in the order the markup uses them",
    pageSetup(
      "react",
      [
        `const box = lt.dialog({ titleId: "confirm-title" })`,
        `return <><button {...lt.button({ variant: "danger" })}>Cancel</button>`,
        `<dialog {...box.dialog}><h2 {...box.title}>Cancel?</h2></dialog></>`,
      ].join("\n"),
    ),
    {
      stylesheets: ["tokens.css", "dialog.css", "button.css"],
      register: [],
      datastar: false,
    },
  )
  expect(
    "the classes a builder function gives in nested sets count too",
    pageSetup(
      "react",
      `const field = lt.field({ id: useId() })\n<label {...field.label}>Codename</label>`,
    ),
    {
      stylesheets: ["tokens.css", "label.css"],
      register: [],
      datastar: false,
    },
  )
  expect(
    "className in React is a class, and markup in a comment is not markup",
    pageSetup(
      "react",
      [
        `// Not <lt-dialog>: React opens it with showModal().`,
        `<p className="lt-paragraph">Saved</p>`,
        `{/* <lt-toast> */}`,
      ].join("\n"),
    ),
    {
      stylesheets: ["tokens.css", "paragraph.css"],
      register: [],
      datastar: false,
    },
  )
  expect(
    "markup in an HTML comment is not markup",
    pageSetup(
      "html",
      `<!-- Or <lt-dialog> when the server opens it --><p class="lt-paragraph">Saved</p>`,
    ),
    {
      stylesheets: ["tokens.css", "paragraph.css"],
      register: [],
      datastar: false,
    },
  )

  const findings = (name: string, actual: string[], wanted: string[]) => {
    if (JSON.stringify(actual) !== JSON.stringify(wanted))
      broken.push(
        `${name}: found ${JSON.stringify(actual)}, expected ${JSON.stringify(wanted)}`,
      )
  }
  const CDN = "https://cdn.jsdelivr.net/npm/@lo-tek/interfaces@VERSION"
  const paragraph = (sheets: string[]) =>
    [
      ...sheets.map((s) => `<link rel="stylesheet" href="${CDN}/${s}">`),
      `<p class="lt-paragraph">Saved</p>`,
    ].join("\n")
  findings(
    "a tab with the setup it needs has nothing to say",
    checkSetup(
      "html",
      paragraph([
        "src/tokens/tokens.css",
        "src/components/css/paragraph/paragraph.css",
      ]),
    ),
    [],
  )
  findings(
    "a stylesheet the markup needs and the tab leaves out",
    checkSetup("html", paragraph(["src/tokens/tokens.css"])),
    ["does not give paragraph.css"],
  )
  findings(
    "a stylesheet the tab gives and the markup does not need",
    checkSetup(
      "html",
      paragraph([
        "src/tokens/tokens.css",
        "src/components/css/paragraph/paragraph.css",
        "src/components/css/button/button.css",
      ]),
    ),
    ["gives button.css, which the markup does not need"],
  )
  findings(
    "an illustration outside the recipe need not repeat the setup, but what it writes must be right",
    checkSetup("html", paragraph(["src/components/css/button/button.css"]), {
      part: "illustration",
    }),
    ["gives button.css, which the markup does not need"],
  )
  findings(
    "an illustration must still register the web components it shows",
    checkSetup(
      "html",
      `<lt-dialog><dialog class="lt-dialog"><h2>Cancel?</h2></dialog></lt-dialog>`,
      { part: "illustration" },
    ),
    ["does not call defineLtDialog()"],
  )
  findings(
    "a Datastar illustration must still load Datastar",
    checkSetup(
      "datastar",
      `<button class="lt-button" data-on:click="@post('/save')">Save</button>`,
      { part: "illustration" },
    ),
    ["does not load Datastar"],
  )
  findings(
    "a block in a rulebook may leave out all of the setup, which another section gives",
    checkSetup(
      "datastar",
      `<lt-dialog><dialog class="lt-dialog"><h2>Cancel?</h2></dialog></lt-dialog>`,
      { part: "fragment" },
    ),
    [],
  )
  findings(
    "markup after // in the text of an element is still markup",
    checkSetup(
      "html",
      `<p>See https: // the guide <lt-dialog><dialog class="lt-dialog"><h2>a</h2></dialog></lt-dialog></p>`,
      { part: "illustration" },
    ),
    ["does not call defineLtDialog()"],
  )
  findings(
    "an illustration with only the setup in it and no markup of its own gives nothing too much",
    checkSetup(
      "html",
      [
        `<link rel="stylesheet" href="${CDN}/src/components/css/button/button.css">`,
        `<script type="module">\nimport { defineLtField } from "${CDN}/dist/components/frame/field/lt-field.js"\ndefineLtField()\n</script>`,
      ].join("\n"),
      { part: "fragment" },
    ),
    [],
  )
  findings(
    "the one file stands for every stylesheet",
    checkSetup("html", paragraph(["dist/lotek.css"])),
    [],
  )
  const dialog = (script: string) =>
    [
      `<link rel="stylesheet" href="${CDN}/dist/lotek.css">`,
      `<script type="module">\n${script}\n</script>`,
      `<lt-dialog><dialog class="lt-dialog"><h2>Cancel?</h2></dialog></lt-dialog>`,
    ].join("\n")
  findings(
    "a web component the tab imports and never registers",
    checkSetup(
      "html",
      dialog(
        `import { defineLtDialog } from "${CDN}/dist/components/frame/dialog/lt-dialog.js"`,
      ),
    ),
    ["does not call defineLtDialog()"],
  )
  findings(
    "a registration in a comment after code registers nothing",
    checkSetup(
      "html",
      dialog(
        `import { defineLtDialog } from "${CDN}/dist/components/frame/dialog/lt-dialog.js"\nconsole.info("ready") // defineLtDialog()`,
      ),
    ),
    ["does not call defineLtDialog()"],
  )
  findings(
    "one defineLt() stands for every registration",
    checkSetup(
      "html",
      dialog(`import { defineLt } from "${CDN}/dist/register.js"\ndefineLt()`),
    ),
    [],
  )
  findings(
    "a registration the markup does not need",
    checkSetup(
      "html",
      dialog(
        `import { defineLtDialog, defineLtToast } from "${CDN}/dist/index.js"\ndefineLtDialog()\ndefineLtToast()`,
      ),
    ),
    ["calls defineLtToast(), which the markup does not need"],
  )
  const DATASTAR = `<script type="module" src="https://cdn.jsdelivr.net/gh/starfederation/datastar@v1.0.4/bundles/datastar.js"></script>`
  const registration = `<script type="module">\nimport { defineLt } from "${CDN}/dist/register.js"\ndefineLt()\n</script>`
  const host = `<lt-dialog><dialog class="lt-dialog"><h2>Cancel?</h2></dialog></lt-dialog>`
  const css = `<link rel="stylesheet" href="${CDN}/dist/lotek.css">`
  findings(
    "Datastar after the registration is right",
    checkSetup("datastar", [css, registration, DATASTAR, host].join("\n")),
    [],
  )
  findings(
    "a Datastar tab without Datastar",
    checkSetup("datastar", [css, registration, host].join("\n")),
    ["does not load Datastar"],
  )
  findings(
    "Datastar before the registration",
    checkSetup("datastar", [css, DATASTAR, registration, host].join("\n")),
    ["loads Datastar before the registration"],
  )
  findings(
    "Datastar with async",
    checkSetup(
      "datastar",
      [
        css,
        registration,
        DATASTAR.replace("<script ", "<script async "),
        host,
      ].join("\n"),
    ),
    ["loads Datastar with async, which takes it out of the order"],
  )
  findings(
    "Datastar in a tab that is not a Datastar recipe",
    checkSetup("html", [css, registration, DATASTAR, host].join("\n")),
    ["loads Datastar, which only a Datastar recipe does"],
  )
  findings(
    "Datastar from another address",
    checkSetup(
      "datastar",
      [css, registration, DATASTAR.replace("v1.0.4", "v1.0.3"), host].join(
        "\n",
      ),
    ),
    [
      "loads Datastar from https://cdn.jsdelivr.net/gh/starfederation/datastar@v1.0.3/bundles/datastar.js, not https://cdn.jsdelivr.net/gh/starfederation/datastar@v1.0.4/bundles/datastar.js",
    ],
  )
  const BLOCKS = {
    registration,
    // Only the comment tells it from a registration, so nothing else can
    // make the rule turn it down.
    "commented-registration": `<script type="module">\nimport { defineLt } from "${CDN}/dist/register.js" // defineLt()\n</script>`,
    datastar: DATASTAR,
  }
  for (const { name, blocks, before } of ORDER_CASES)
    findings(
      `the order case "${name}"`,
      checkSetup(
        "datastar",
        [css, ...blocks.map((b) => BLOCKS[b]), host].join("\n"),
      ).filter((f) => f === "loads Datastar before the registration"),
      before ? ["loads Datastar before the registration"] : [],
    )
  findings(
    "Datastar as a classic script",
    checkSetup(
      "datastar",
      [css, registration, DATASTAR.replace(' type="module"', ""), host].join(
        "\n",
      ),
    ),
    [
      'loads Datastar without type="module", which runs it before the module scripts',
    ],
  )

  return broken
}

if (import.meta.main) {
  const broken = selfTest()
  if (broken.length > 0) {
    console.error(
      `pageSetup answers wrong:\n${broken.map((b) => `  - ${b}`).join("\n")}`,
    )
    process.exit(1)
  }
  console.log("pageSetup answers every case")
}
