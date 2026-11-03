/**
 * That the code in "How to use it" is actually right.
 *
 * Every component page opens with that section, and the tabs in it are what
 * the reader pastes in. A code block that looks right, but points at an entry
 * point that does not exist, or calls a builder function by another name, is
 * worse than no code: it looks authoritative and fails at the consumer.
 *
 * The check reads the mdx files as text and verifies every claim against what
 * the package actually ships:
 *
 *   - every `@lo-tek/interfaces/…` exists in `exports`;
 *   - every `defineLtX` is something that module actually exports;
 *   - every `lt.x()` is a builder function that exists;
 *   - every `lt-` class is in a stylesheet the package ships;
 *   - a package name appears only in tabs that have a build step, and a URL
 *     in those that do not.
 *
 * The last one is not pedantry. `import … from "@lo-tek/interfaces/dialog"`
 * in a `<script type="module">` does not resolve in a browser: without an
 * import map or a build step the package name does not exist. The tracks
 * "Plain HTML" and "Datastar" are defined by having no build step, so there
 * the address must be a URL.
 */

import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { tabItems } from "../../interfaces/scripts/recipes"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const PAGES = join(ROOT, "documentation/src/content/docs/components")
const PACKAGE = JSON.parse(
  readFileSync(join(ROOT, "interfaces/package.json"), "utf8"),
)

const findings: string[] = []
const report = (page: string, message: string) =>
  findings.push(`${page}: ${message}`)

/** The entry points `exports` promises, without the "./" prefix. */
const entryPoints = new Set(
  Object.keys(PACKAGE.exports).map((k) =>
    k === "." ? "" : k.replace(/^\.\//, ""),
  ),
)

/** Every class name the package actually defines. */
const classes = new Set<string>()
function readStylesheets(folder: string) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) readStylesheets(path)
    else if (entry.name.endsWith(".css"))
      for (const m of readFileSync(path, "utf8").matchAll(
        /\.(lt-[a-z0-9-]+(?:__[a-z0-9-]+)?)/g,
      ))
        classes.add(m[1])
  }
}
readStylesheets(join(ROOT, "interfaces/src"))

/** The builder functions that exist, read from the package itself. */
const { lt } = await import(join(ROOT, "interfaces/dist/lt.js"))
const builderFunctions = new Set(Object.keys(lt))

/** The `defineLtX` names each module exports. */
const definers = new Map<string, Set<string>>()
for (const entry of entryPoints) {
  const target = PACKAGE.exports[entry === "" ? "." : `./${entry}`]
  const js = typeof target === "string" ? target : target?.import
  if (typeof js !== "string" || !js.endsWith(".js")) continue
  try {
    const module = await import(join(ROOT, "interfaces", js))
    definers.set(entry, new Set(Object.keys(module)))
  } catch {
    // An entry point that cannot be loaded is `check-server-import`'s job.
  }
}

/**
 * Every `<Example>` on the page, with everything that belongs to it.
 *
 * This has to be parsed, not matched. A regex on `/>` stops at the first
 * self-closing tag *inside* the example, and on nine pages there is an
 * `<input … />` in the markup. Everything past that point was never read,
 * which is exactly the gap this function exists to close. The first attempt
 * moved the bug from one tag form to the other.
 *
 * So: scan up to the `>` that actually ends the opening tag, that is one that
 * stands outside `{…}` and outside a template string. If the character before
 * it is a slash, the tag closes itself. Otherwise everything up to
 * `</Example>` belongs to it.
 */
function examples(text: string): string[] {
  const out: string[] = []
  for (let i = text.indexOf("<Example"); i !== -1; ) {
    let depth = 0
    let inTemplate = false
    let j = i + "<Example".length
    for (; j < text.length; j++) {
      const c = text[j]
      if (c === "`") inTemplate = !inTemplate
      else if (inTemplate) continue
      else if (c === "{") depth++
      else if (c === "}") depth--
      else if (c === ">" && depth === 0) break
    }
    if (text[j - 1] === "/") {
      out.push(text.slice(i, j + 1))
    } else {
      const end = text.indexOf("</Example>", j)
      out.push(
        end === -1
          ? text.slice(i, j + 1)
          : text.slice(i, end + "</Example>".length),
      )
    }
    i = text.indexOf("<Example", j)
  }
  return out
}

/**
 * Which stylesheets an `lt-` class requires, with the `@import` closure
 * counted in.
 *
 * `search.css` pulls in `input.css` itself, so a recipe that uses `.lt-input`
 * together with `.lt-search` does not need both. Without the closure the rule
 * would require stylesheets that already come along.
 */
const FROM_STYLESHEET = new Map<string, string>()

/** The stylesheet each `lt-` element is styled by. */
const FROM_ELEMENT = new Map<string, string>()
const IMPORTS = new Map<string, Set<string>>()
{
  const readSheets = (folder: string) => {
    // Sorted: unsorted `readdirSync` on Linux would have let `search.css` win
    // over `input.css` for `.lt-input`, and the check failed at random in CI.
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const p = join(folder, entry.name)
      if (entry.isDirectory()) readSheets(p)
      else if (entry.name.endsWith(".css")) {
        const text = readFileSync(p, "utf8")
        for (const m of text.matchAll(/\.(lt-[a-z0-9-]+(?:__[a-z0-9-]+)?)/g))
          if (!FROM_STYLESHEET.has(m[1])) FROM_STYLESHEET.set(m[1], entry.name)
        /*
         * And the element selectors.
         *
         * Nine stylesheets style an `lt-` element and no class: toast, field,
         * dialog, popover, tabs, suggestion, error-summary,
         * connection-status and session-timeout. A rule that only knows
         * classes can never require them, and then `toast.css` disappeared
         * from the toast recipe without anything saying so.
         */
        for (const m of text.matchAll(/^\s*(lt-[a-z0-9-]+)[\s,{[:.]/gm))
          if (!FROM_ELEMENT.has(m[1])) FROM_ELEMENT.set(m[1], entry.name)
        IMPORTS.set(
          entry.name,
          new Set(
            [...text.matchAll(/@import "[^"]*\/([a-z-]+\.css)"/g)].map(
              (m) => m[1],
            ),
          ),
        )
      }
    }
  }
  readSheets(join(ROOT, "interfaces/src"))
}

/** The class each builder function gives, looked up by function name. */
const FROM_BUILDER_REVERSED = new Map<string, string>()

/** The stylesheets a set of given sheets brings along, all the way down. */
function closure(start: string[]): Set<string> {
  const out = new Set<string>()
  const queue = [...start]
  while (queue.length) {
    const n = queue.pop()
    if (!n || out.has(n)) continue
    out.add(n)
    for (const h of IMPORTS.get(n) ?? []) queue.push(h)
  }
  return out
}

/**
 * Only the code in a tab, without the prose around it.
 *
 * Two of the rules ask about something that only makes sense in code: that an
 * `<lt-…>` is registered, and that `lt.` is imported. If they read the whole
 * tab, a sentence that *mentions* `<lt-dialog>` would fail CI for a reason
 * that is not a bug, and the obvious fix would have been to weaken the rule
 * again.
 */
/** Each code fence on its own, without comments. */
function fences(text: string): string[] {
  return [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) =>
    m[1].replace(/<!--[\s\S]*?-->/g, "").replace(/^\s*\/\/.*$/gm, ""),
  )
}

/**
 * The markup in `<Example code={`…`}>`, which is not in a code fence.
 *
 * Three rules read only fences, and on the 32 CSS pages `<Example>` is the
 * only markup there is. The registration, the host attributes and
 * element-to-stylesheet could therefore structurally never fire there. Same
 * shape as the six previous gaps: the rule was bound to one way of writing the
 * code.
 */
function exampleMarkup(text: string): string {
  return [...text.matchAll(/(?:code|customCss)=\{`([\s\S]*?)`\}/g)]
    .map((m) => m[1])
    .join("\n")
}

function codeOnly(text: string): string {
  const codeFences = [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map(
    (m) => m[1],
  )
  // Without the comments: a comment that *mentions* `<lt-dialog>` is not
  // markup, and a rule that reads it requires a registration that is not
  // needed.
  return [...codeFences, exampleMarkup(text)]
    .join("\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s*\/\/.*$/gm, "")
}

/**
 * The paths `exports` points at, as they look inside the tarball.
 *
 * A CDN address must match one of them. In the tracks without a build step
 * the address *is* the recipe, and only the last part was checked: wrong
 * folder, wrong version and a made-up file all went green, because the regex
 * stopped at the `@` in `@0.14.0` and the entry point became the empty string.
 */
const FILES = new Set<string>()
for (const target of Object.values(
  PACKAGE.exports as Record<string, string | Record<string, string>>,
)) {
  if (typeof target === "string") FILES.add(target.slice(2))
  else
    for (const v of Object.values(target))
      if (typeof v === "string") FILES.add(v.slice(2))
}

const WITH_BUILD_STEP = new Set(["React", "Astro", "TypeScript"])

/**
 * The tab names the documentation uses, and only these.
 *
 * Every rule is selected on a name as a string: `WITH_BUILD_STEP`, the
 * requirement of a URL rather than a package name, the registration and the
 * `lt` import. If someone wrote `label="Plain html"`, two of them were turned
 * off without anything saying so. An enforced vocabulary makes the
 * classification verifiable rather than something the check just assumes.
 */
const TAB_NAMES = new Set([
  "Try it",
  "Example",
  "Plain HTML",
  "React",
  "Astro",
  "Datastar",
  "TypeScript",
  // The kotlinx.html tabs are compiled, rendered and compared with the page's HTML
  // recipe by `RecipesTest` in `kotlin/kotlinx-html`, which no text rule here
  // could do.
  "kotlinx.html",
])

/**
 * Hosts where the builder function gives attributes the component does not
 * set itself.
 *
 * There the host is something you write once in the app, and the temptation
 * to write it by hand is greatest. All three have `data-ignore-morph`, which
 * the component cannot set on itself.
 */
const HOSTS: Array<[string, string]> = [
  ["lt-toast", "toast"],
  ["lt-connection-status", "connectionStatus"],
  ["lt-session-timeout", "sessionTimeout"],
]

/**
 * Classes a builder function actually emits, and which function it is.
 *
 * Without this the rule would fail every `lt-` class in a React or Astro tab,
 * including those that have no function to call. One class is like that
 * today, and the component creates it itself: `lt-connection-status__bar`.
 */
const FROM_BUILDER = new Map<string, string>()
for (const [name, f] of Object.entries(lt)) {
  if (typeof f !== "function") continue
  let result: unknown
  try {
    // `keys` because `lt.tabs()` and `lt.suggestion()` throw without it. Then
    // `catch` swallowed the error, the tabs' classes never got into the
    // table, and the rule about classes written by hand was silent for them.
    result = (f as (o?: unknown) => unknown)({
      id: "x",
      titleId: "t",
      count: 1,
      keys: ["a"],
      label: "L",
    })
  } catch {
    continue
  }
  const collect = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(collect)
    if (!value || typeof value !== "object") return
    const o = value as Record<string, unknown>
    if (typeof o.class === "string")
      for (const k of o.class.split(/\s+/))
        if (k && !FROM_BUILDER.has(k)) FROM_BUILDER.set(k, name)
    for (const v of Object.values(o)) if (typeof v === "object") collect(v)
  }
  collect(result)

  /*
   * And the class names that hang on the function itself.
   *
   * `lt.switch.row`, `lt.alert.title` and a dozen others are classes without
   * attributes, so they are not returned by a call, but hung on the function
   * with `Object.assign`. Looking only at the return value, it looks like a
   * gap in the API where there is none. Nineteen classes were like that, and
   * `.lt-switch-row` was one of them.
   */
  for (const [key, value] of Object.entries(f))
    if (
      typeof value === "string" &&
      value.startsWith("lt-") &&
      !FROM_BUILDER.has(value)
    )
      FROM_BUILDER.set(value, `${name}.${key}`)

  for (const [className, builder] of FROM_BUILDER)
    if (!FROM_BUILDER_REVERSED.has(builder.replace(/[.(].*$/, "")))
      FROM_BUILDER_REVERSED.set(builder.replace(/[.(].*$/, ""), className)
}

/** The attribute names a builder function actually emits for its host. */
function required(builder: string): string[] {
  // The same sample options as above: `lt.sessionTimeout()` requires `titleId`.
  const result = (
    lt as Record<string, (o?: unknown) => Record<string, unknown>>
  )[builder]({ titleId: "t" })
  const set = (result.host ?? result) as Record<string, unknown>
  return Object.keys(set).filter((k) => k !== "class")
}

/*
 * `index.mdx` is the overview of the components, not a component page.
 *
 * The exception is named and not a condition: everything other than exactly
 * that file is checked as before. A rule that turned the check off for a whole
 * class of pages would be more dangerous than no rule.
 */
for (const file of readdirSync(PAGES).filter(
  (f) => f.endsWith(".mdx") && f !== "index.mdx",
)) {
  const page = file.replace(/\.mdx$/, "")
  const text = readFileSync(join(PAGES, file), "utf8")

  const start = text.indexOf("## How to use it")
  if (start === -1) {
    report(page, 'is missing the section "How to use it"')
    continue
  }
  const next = text.indexOf("\n## ", start + 5)
  const section = text.slice(start, next === -1 ? undefined : next)

  /*
   * Every tab on the whole page, with its name, not just those in the recipe.
   *
   * Sections about behaviour have tabs too now, such as "Saving
   * immediately" on the switch. If the check read only the recipe, a React tab
   * further down went free, and it is the same code a reader pastes in.
   */
  const tabs: Array<{ name: string; code: string; inRecipe?: boolean }> = []
  for (const tab of tabItems(text))
    tabs.push({ ...tab, inRecipe: section.includes(tab.code) })

  /*
   * And every `<Example>`, whether or not the page also has tabs.
   *
   * This stood as a fallback that only kicked in when the page had zero
   * `<TabItem>`. Then the whole `<Example>` part dropped out of the check on
   * the ten pages that have a `<Tabs>` block somewhere, and with it the
   * hand-written TypeScript blocks. Worst of all, it was silent and
   * asymmetric: if someone put a `<Tabs>` on one of the CSS pages, it turned
   * off the checking of that page's own recipe.
   */
  for (const m of examples(text)) {
    // The two halves separately: the markup belongs to "Plain HTML", and
    // `slot="ts"` to TypeScript. Merged, the package-name-versus-URL
    // requirement would be impossible to state, since the two have a rule
    // each.
    const ts = m.match(/<Fragment slot="ts">([\s\S]*?)<\/Fragment>/)
    // `slot="kotlin"` is the kotlinx.html tab, which `RecipesTest` compiles
    // and compares with the markup; it is neither half here.
    const kotlin = m.match(/<Fragment slot="kotlin">([\s\S]*?)<\/Fragment>/)
    let markup = ts ? m.replace(ts[0], "") : m
    if (kotlin) markup = markup.replace(kotlin[0], "")
    tabs.push({
      name: "Plain HTML",
      code: markup,
      inRecipe: section.includes(m),
    })
    if (kotlin)
      tabs.push({
        name: "kotlinx.html",
        code: kotlin[1],
        inRecipe: section.includes(m),
      })
    // `imports` belongs to both halves: it says which stylesheets the example
    // needs, whichever tab they are shown in.
    const declaration = m.match(/imports=\{\[[^\]]*\]\}/)?.[0] ?? ""
    if (ts)
      tabs.push({
        name: "TypeScript",
        code: declaration + ts[1],
        inRecipe: section.includes(m),
      })
  }

  /*
   * And the rest of the page.
   *
   * The check read only `<TabItem>` and `<Example>`, so a code block that
   * stood outside both went free. The toast page had one: it repeated the
   * "Plain HTML" recipe in the old version, with a package name in an
   * environment without a build step and without `data-ignore-morph`, three
   * paragraphs after the page says the attribute is not optional.
   *
   * The tab name is "rest", not an environment, so the package-name-versus-URL
   * rule is not applied here: a prose block may rightly mention the package
   * name. What applies is that classes, builder functions and addresses
   * exist.
   */
  let rest = text
  for (const t of tabs) rest = rest.replace(t.code, "")
  tabs.push({ name: "rest", code: rest })

  for (const tab of tabs) {
    const where = `"${tab.name}"`

    if (tab.name !== "rest" && !TAB_NAMES.has(tab.name))
      report(
        page,
        `the tab is called "${tab.name}", which is not one of the names the documentation uses. The rules are selected on the name, so a typo turns them off silently.`,
      )

    for (const m of tab.code.matchAll(
      /@lo-tek\/interfaces(?:\/([a-z0-9/.-]+))?/g,
    )) {
      const entry = m[1] ?? ""
      if (!entryPoints.has(entry))
        report(
          page,
          `${where} imports "@lo-tek/interfaces/${entry}", which does not exist in exports`,
        )
    }

    for (const m of tab.code.matchAll(/\b(defineLt[A-Za-z]+)\b/g)) {
      const name = m[1]
      const exists = [...definers.values()].some((set) => set.has(name))
      if (!exists)
        report(page, `${where} calls ${name}(), which no module exports`)
    }

    /*
     * And the names that are not calls.
     *
     * The rule required a parenthesis, so `lt.card.title`, `lt.switch.row` and
     * twenty other property references were never checked. A typo there gives
     * `className={undefined}`, an element without a class, and nothing said
     * so. The guards, such as `lt.button.isVariant`, fell between both rules.
     */
    for (const m of tab.code.matchAll(/\blt\.([a-zA-Z]+)\.([a-zA-Z]+)/g)) {
      const builder = (lt as Record<string, unknown>)[m[1]]
      if (typeof builder !== "function") {
        report(page, `${where} uses lt.${m[1]}, which does not exist in lt`)
        continue
      }
      if (!(m[2] in (builder as object)))
        report(page, `${where} uses lt.${m[1]}.${m[2]}, which does not exist`)
    }

    for (const m of tab.code.matchAll(/\blt\.([a-zA-Z]+)\s*\(/g)) {
      if (!builderFunctions.has(m[1]))
        report(page, `${where} calls lt.${m[1]}(), which does not exist in lt`)
    }

    for (const m of tab.code.matchAll(/class(?:Name)?="([^"]*)"/g)) {
      for (const k of m[1].split(/\s+/).filter((k) => k.startsWith("lt-")))
        if (!classes.has(k))
          report(
            page,
            `${where} uses the class .${k}, which no stylesheet defines`,
          )
    }

    /*
     * Attributes the builder function emits must be in the markup.
     *
     * A recipe that writes the host by hand rather than spreading the builder
     * function loses what the builder function would have given. The toast
     * page wrote `<lt-toast label="Notifications">` in all four tabs, and then
     * `data-ignore-morph` was missing in all four, the Datastar tab included,
     * where the page itself says the attribute is not optional. The component
     * sets `role` and `aria-label` itself, but not that, so a patch would have
     * torn the messages away.
     */
    for (const [tag, builder] of HOSTS) {
      const hosts = [
        ...codeOnly(tab.code).matchAll(new RegExp(`<${tag}\\b[^>]*>`, "g")),
      ]
      /*
       * Every host actually written out, not just the first, and only in code:
       * a bare `<lt-toast>` in a comment before the real host made the rule
       * dead.
       *
       * A bare `<lt-toast>` in a sentence is prose, not markup, so the
       * requirement applies to those that have attributes. And a second host
       * in the same tab is as much a recipe as the first.
       */
      for (const host of hosts.filter(
        (v) => v[0].includes("=") && !/\{\.\.\./.test(v[0]),
      ))
        for (const attribute of required(builder)) {
          if (!host[0].includes(attribute))
            report(
              page,
              `${where} writes <${tag}> by hand without ${attribute}, which lt.${builder}() gives`,
            )
        }
    }

    /*
     * If you create the markup with JavaScript, you call the builder function.
     *
     * That is the whole distinction the documentation is meant to teach, and a
     * tab that writes `class="lt-input"` by hand in React or Astro teaches the
     * reader nothing about `lt`. Four tabs had drifted there without anything
     * saying so.
     *
     * The rule applies only where there is a build step. In "Plain HTML" and
     * "Datastar" writing the class is exactly right: there is no function to
     * call there.
     */
    /*
     * `className` and not `class`.
     *
     * The TypeScript tab shows two scenarios, and the second is markup a
     * server or a template has sent. There `class="lt-button"` is exactly
     * right, and a rule that failed it would have made the tab's own point
     * illegal. `className` exists only in JSX, that is where the builder
     * function should be called.
     */
    if (WITH_BUILD_STEP.has(tab.name)) {
      // Astro writes `class`, React `className`. The TypeScript tab shows
      // server-written markup on purpose, and there `class` is right.
      const attribute =
        tab.name === "Astro" ? /class="(lt-[^"]*)"/g : /className="(lt-[^"]*)"/g
      for (const m of tab.code.matchAll(attribute))
        for (const k of m[1].split(/\s+/))
          if (FROM_BUILDER.has(k))
            report(
              page,
              `${where} writes class="${k}" by hand, but lt.${FROM_BUILDER.get(k)} exists. Where there is a build step, use it.`,
            )
    }

    /*
     * The stylesheets must cover the classes the tab uses, however they are
     * given.
     *
     * This is the same bug three rounds in a row, and each time because the
     * rule was bound to one way of giving the stylesheets. First it saw only
     * `imports` on `<Example>`, and then the nine behaviour pages went free.
     * Then they got hand-written `<link>` blocks, and the rule did not see
     * those either: two of them lacked `button.css` while the markup used
     * `.lt-button`.
     *
     * So the rule is now one, and it asks about what matters: which sheets has
     * the reader been told about, and which do the classes in this tab
     * require. The sheets can come from `imports`, from a `<link>` or from an
     * `import "@lo-tek/interfaces/x.css"`. Where they stand does not matter.
     */
    const given = new Set<string>()
    const fromImports = tab.code.match(/imports=\{\[([^\]]*)\]\}/)
    if (fromImports)
      for (const m of fromImports[1].matchAll(/"([^"]+)"/g)) given.add(m[1])
    for (const m of tab.code.matchAll(/href="[^"]*\/([a-z-]+\.css)"/g))
      given.add(m[1])
    for (const m of tab.code.matchAll(/@lo-tek\/interfaces\/([a-z-]+\.css)/g))
      given.add(m[1])

    const usedClasses = new Set<string>()
    for (const m of tab.code.matchAll(/class(?:Name)?="([^"]*)"/g))
      for (const k of m[1].split(/\s+/))
        if (k.startsWith("lt-")) usedClasses.add(k)
    /*
     * The builder function counts, also when it goes through a variable.
     *
     * The rule read `class="…"` and `{...lt.x(` literally. The dominant form in
     * React and Astro tabs is `const box = lt.dialog(...)` and then
     * `{...box.dialog}`, and that gave zero classes. Then `dialog.css` could be
     * removed from the dialog's React tab without anything saying so, which is
     * the same blindness four rounds in a row.
     */
    for (const m of tab.code.matchAll(/\{\.\.\.lt\.([a-zA-Z]+)[.(]/g)) {
      const className = FROM_BUILDER_REVERSED.get(m[1])
      if (className) usedClasses.add(className)
    }
    const variables = new Map<string, string>()
    for (const m of tab.code.matchAll(
      /(?:const|let)\s+(?:\{[^}]*\}|(\w+))\s*=\s*lt\.([a-zA-Z]+)\(/g,
    ))
      if (m[1]) variables.set(m[1], m[2])
    for (const m of tab.code.matchAll(/\{\.\.\.(\w+)[.}\s]/g)) {
      const builder = variables.get(m[1])
      const className = builder && FROM_BUILDER_REVERSED.get(builder)
      if (className) usedClasses.add(className)
    }

    // "rest" is prose around the recipe, not a recipe in itself, and should
    // not have to repeat the stylesheets the section above has already given.
    /*
     * `given.size > 0` stood here, and was the same silent pass once more: a
     * tab that gave no stylesheets at all went free, while one that gave too
     * few was failed. The tabs page tabs for React and Astro were like that.
     */
    /*
     * Only the recipe.
     *
     * Later examples on the page are illustrations, not whole recipes, and
     * should not repeat the imports the section at the top has already given.
     * There it is `styles` on `<Example>` that controls what the preview
     * loads.
     */
    /*
     * And that the sheets the recipe advertises exist.
     *
     * Only the direction "required, so given" was checked, never "given, so
     * exists". `imports={["buton.css"]}` gave a 404 link and a build error at
     * the reader, without a word. `exports` has the answer.
     */
    for (const sheet of given)
      if (!entryPoints.has(sheet))
        report(page, `${where} gives ${sheet}, which does not exist in exports`)

    const usedElements = new Set(
      [...codeOnly(tab.code).matchAll(/<(lt-[a-z0-9-]+)[\s/>]/g)].map(
        (m) => m[1],
      ),
    )

    if (tab.inRecipe && (usedClasses.size > 0 || usedElements.size > 0)) {
      const has = closure([...given])
      for (const el of usedElements) {
        const sheet = FROM_ELEMENT.get(el)
        if (sheet && !has.has(sheet))
          report(page, `${where} shows <${el}>, but ${sheet} is not given`)
      }
      const missing = new Set<string>()
      for (const k of usedClasses) {
        const sheet = FROM_STYLESHEET.get(k)
        if (sheet && !has.has(sheet)) missing.add(sheet)
      }
      for (const sheet of missing)
        report(page, `${where} uses a class from ${sheet}, which is not given`)

      /*
       * And `tokens.css`, which no class can require.
       *
       * It defines no `lt-` classes, only the variables everything else reads.
       * A class-driven rule can therefore structurally never ask for it, and
       * without it every `var(--lt-spacing-…)` is left unresolved: padding,
       * font size and weight fall away.
       */
      if (!has.has("tokens.css"))
        report(
          page,
          `${where} does not give tokens.css, which everything else reads`,
        )
    }

    /*
     * A recipe that shows an `<lt-…>` must register it.
     *
     * Five Datastar tabs showed the markup and nothing more. The element is
     * then an empty host: no keyboard, no focus, no events. The registration
     * stood in a separate block further down the page, and it does not run in
     * a page without a build step just because it is in the text.
     *
     * "Try it" is exempt: there Astro has registered it, and "rest" because
     * prose is not a recipe.
     */
    if (tab.name !== "Try it" && tab.name !== "rest") {
      const code = codeOnly(tab.code)
      const hosts = new Set(
        [...code.matchAll(/<(lt-[a-z-]+)[\s>]/g)].map((m) => m[1]),
      )
      /*
       * `defineLt()` from `/register` registers all of them, and then covers
       * every element in the tab. The expression requires the parenthesis:
       * `defineLtField(` does not match, and an import without a call does
       * not match either.
       */
      const all = /\bdefineLt\s*\(/.test(code)
      for (const tag of all ? [] : hosts) {
        const fn = `defineLt${tag
          .slice(3)
          .replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase())}`
        // The call, not the import: `includes` matched `import { defineLtX }`,
        // so a recipe that imported and forgot the call went green.
        if (!new RegExp(`\\b${fn}\\s*\\(`).test(code))
          report(page, `${where} shows <${tag}> without calling ${fn}()`)
      }
    }

    /*
     * If the tab uses `lt.`, it must import it.
     *
     * The Astro tab on the field page called `lt.input()` and `lt.errorText()`
     * while the frontmatter imported only stylesheets. Pasted in, `lt` is
     * undefined, and the page fails at build time. The bug came from
     * hand-written classes being swapped for builder functions without the
     * import following along.
     */
    if (tab.name !== "rest" && !/<Example\b/.test(tab.code)) {
      let imported = false
      for (const fence of fences(tab.code)) {
        if (/import \{[^}]*\blt\b[^}]*\} from "@lo-tek\/interfaces/.test(fence))
          imported = true
        if (!imported && /\blt\.[a-zA-Z]/.test(fence)) {
          report(page, `${where} uses lt. without importing lt`)
          break
        }
      }
    }

    // The whole CDN address: the version and the path, not just the file name.
    for (const m of tab.code.matchAll(
      /cdn\.jsdelivr\.net\/npm\/@lo-tek\/interfaces@([^/]+)\/([^"'\s]+)/g,
    )) {
      /*
       * The version must stand as the placeholder `VERSION`, which
       * `remark-version.mjs` replaces with the one from `package.json` when
       * the page is built. If the number stood here in the source, all 74
       * addresses had to change at every release, and one that was forgotten
       * pointed at an older package than the text around it described.
       */
      if (m[1] !== "VERSION")
        report(
          page,
          `${where} points at @lo-tek/interfaces@${m[1]}. Write @lo-tek/interfaces@VERSION, which remark-version.mjs replaces.`,
        )
      if (!FILES.has(m[2]))
        report(
          page,
          `${where} points at ${m[2]}, which the package does not ship`,
        )
    }

    const packageNameInImport = /from\s+\n?\s*"@lo-tek\/interfaces/.test(
      tab.code,
    )
    const urlInImport = /from\s+\n?\s*"https:\/\/cdn\./.test(tab.code)
    if (
      !WITH_BUILD_STEP.has(tab.name) &&
      tab.name !== "rest" &&
      tab.name !== "Try it"
    ) {
      if (packageNameInImport && !urlInImport)
        report(
          page,
          `${where} imports a package name in an environment without a build step. A browser cannot resolve it, so the code does not work pasted in. Use the full URL.`,
        )
    }
  }
}

if (findings.length > 0) {
  console.error(
    `Found ${findings.length} problems in the recipes:\n${findings.map((f) => `  - ${f}`).join("\n")}`,
  )
  process.exit(1)
}
console.log("The recipes point at things that exist.")
