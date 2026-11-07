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
import {
  checkSetup,
  selfTest as setupSelfTest,
  type Target,
  withoutComments,
} from "../../interfaces/scripts/page-setup"
import recipes from "../generated/recipes.json"

/**
 * The target each tab name with a setup is a recipe for. The kotlinx.html
 * tabs write their setup in Kotlin, in the page template, so `RecipesTest`
 * renders them and holds the HTML to the same answer.
 */
const SETUP_TARGETS: Record<string, Target> = {
  "Plain HTML": "html",
  Datastar: "datastar",
  React: "react",
  Astro: "astro",
}

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
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
/*
 * Every component page, read from `recipes.json`, which `extract-recipes.ts`
 * writes from the tree of the page. The check used to read the MDX itself,
 * with a pattern per form, and missed a tab whose attributes stood in another
 * order.
 *
 * `index.mdx` is the overview of the components, not a component page. The
 * exception is named and not a condition: everything other than exactly
 * that file is checked as before.
 */
const RECIPE = "How to use it"
let pages = 0
for (const entry of recipes.pages.filter(
  (p) => p.path.startsWith("components/") && p.path !== "components/index.mdx",
)) {
  const page = entry.path.replace(/^components\/|\.mdx$/g, "")
  if (![...entry.tabs, ...entry.examples].some((r) => r.section === RECIPE)) {
    report(page, `has no recipe under the heading "${RECIPE}"`)
    continue
  }

  /*
   * Every tab on the whole page, with its name, not just those in the recipe.
   *
   * Sections about behaviour have tabs too, such as "Saving immediately" on
   * the switch. If the check read only the recipe, a React tab further down
   * went free, and it is the same code a reader pastes in.
   */
  const tabs: Array<{
    name: string
    blocks: string[]
    inRecipe?: boolean
    /** Whether `checkSetup` holds its setup, at the bottom of the file. */
    setup?: boolean
  }> = entry.tabs.map((t) => ({
    name: t.label,
    blocks: t.blocks.map((b) => b.code),
    inRecipe: t.section === RECIPE,
    setup: Boolean(t.setup && SETUP_TARGETS[t.label]),
  }))

  /*
   * And every `<Example>`, whether or not the page also has tabs: the markup
   * is "Plain HTML", `slot="ts"` is TypeScript and `slot="kotlin"` the
   * kotlinx.html tab. Merged, the package-name-versus-URL requirement would
   * be impossible to state, since the two have a rule each.
   */
  for (const e of entry.examples) {
    const inRecipe = e.section === RECIPE
    tabs.push({ name: "Plain HTML", blocks: [e.code], inRecipe })
    if (e.kotlin.length > 0)
      tabs.push({
        name: "kotlinx.html",
        blocks: e.kotlin.map((b) => b.code),
        inRecipe,
      })
    if (e.ts.length > 0)
      tabs.push({
        name: "TypeScript",
        blocks: e.ts.map((b) => b.code),
        inRecipe,
      })
  }

  /*
   * And the rest of the page: the blocks outside every tab and example, and
   * the inline code in the prose.
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
  tabs.push({
    name: "rest",
    blocks: [...entry.rest.map((b) => b.code), ...entry.inline],
  })
  pages += 1

  for (const tab of tabs) {
    const where = `"${tab.name}"`
    const code = tab.blocks.join("\n")
    const bare = withoutComments(code)

    if (tab.name !== "rest" && !TAB_NAMES.has(tab.name))
      report(
        page,
        `the tab is called "${tab.name}", which is not one of the names the documentation uses. The rules are selected on the name, so a typo turns them off silently.`,
      )

    for (const m of code.matchAll(
      /@lo-tek\/interfaces(?:\/([a-z0-9/.-]+))?/g,
    )) {
      const entry = m[1] ?? ""
      if (!entryPoints.has(entry))
        report(
          page,
          `${where} imports "@lo-tek/interfaces/${entry}", which does not exist in exports`,
        )
    }

    for (const m of code.matchAll(/\b(defineLt[A-Za-z]+)\b/g)) {
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
    for (const m of code.matchAll(/\blt\.([a-zA-Z]+)\.([a-zA-Z]+)/g)) {
      const builder = (lt as Record<string, unknown>)[m[1]]
      if (typeof builder !== "function") {
        report(page, `${where} uses lt.${m[1]}, which does not exist in lt`)
        continue
      }
      if (!(m[2] in (builder as object)))
        report(page, `${where} uses lt.${m[1]}.${m[2]}, which does not exist`)
    }

    for (const m of code.matchAll(/\blt\.([a-zA-Z]+)\s*\(/g)) {
      if (!builderFunctions.has(m[1]))
        report(page, `${where} calls lt.${m[1]}(), which does not exist in lt`)
    }

    for (const m of code.matchAll(/class(?:Name)?="([^"]*)"/g)) {
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
      const hosts = [...bare.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "g"))]
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
      for (const m of code.matchAll(attribute))
        for (const k of m[1].split(/\s+/))
          if (FROM_BUILDER.has(k))
            report(
              page,
              `${where} writes class="${k}" by hand, but lt.${FROM_BUILDER.get(k)} exists. Where there is a build step, use it.`,
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
    if (tab.name !== "Try it" && tab.name !== "rest" && !tab.setup) {
      const hosts = new Set(
        [...bare.matchAll(/<(lt-[a-z-]+)[\s>]/g)].map((m) => m[1]),
      )
      /*
       * `defineLt()` from `/register` registers all of them, and then covers
       * every element in the tab. The expression requires the parenthesis:
       * `defineLtField(` does not match, and an import without a call does
       * not match either.
       */
      const all = /\bdefineLt\s*\(/.test(bare)
      for (const tag of all ? [] : hosts) {
        const fn = `defineLt${tag
          .slice(3)
          .replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase())}`
        // The call, not the import: `includes` matched `import { defineLtX }`,
        // so a recipe that imported and forgot the call went green.
        if (!new RegExp(`\\b${fn}\\s*\\(`).test(bare))
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
    if (tab.name !== "rest") {
      let imported = false
      for (const fence of tab.blocks.map(withoutComments)) {
        if (/import \{[^}]*\blt\b[^}]*\} from "@lo-tek\/interfaces/.test(fence))
          imported = true
        if (!imported && /\blt\.[a-zA-Z]/.test(fence)) {
          report(page, `${where} uses lt. without importing lt`)
          break
        }
      }
    }

    // The whole CDN address: the version and the path, not just the file name.
    for (const m of code.matchAll(
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

    const packageNameInImport = /from\s+\n?\s*"@lo-tek\/interfaces/.test(code)
    const urlInImport = /from\s+\n?\s*"https:\/\/cdn\./.test(code)
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

/*
 * The setup every tab writes: the stylesheets, the registration and Datastar,
 * held to what `pageSetup` computes from its markup. The rules are fed their
 * cases first, so a rule that went quiet stops the check rather than passing
 * every page.
 */
for (const broken of setupSelfTest()) report("the rules for the setup", broken)
let setupTabs = 0
for (const page of recipes.pages)
  for (const tab of page.tabs) {
    const target = SETUP_TARGETS[tab.label]
    if (!tab.setup || !target) continue
    const code = tab.blocks.map((b) => b.code).join("\n")
    for (const finding of checkSetup(target, code, {
      part: tab.section !== "How to use it",
    }))
      report(page.path, `"${tab.label}" ${finding}`)
    setupTabs += 1
  }
// Every component page on disk must have been read from the file, counted
// from the folder and not from the file, or a page the file lacks would go
// free.
const onDisk = readdirSync(
  join(ROOT, "documentation/src/content/docs/components"),
).filter((f) => f.endsWith(".mdx") && f !== "index.mdx").length
if (pages === 0 || pages !== onDisk)
  report(
    "all pages",
    `read ${pages} component pages from recipes.json, where the folder has ${onDisk}`,
  )

// Counted last, from what was checked, against what the file says has a
// setup, so a change that checks no tab cannot pass for one that checked all.
const withSetup = recipes.pages.reduce(
  (n, p) => n + p.tabs.filter((t) => t.setup && SETUP_TARGETS[t.label]).length,
  0,
)
if (setupTabs === 0 || setupTabs !== withSetup)
  report(
    "all pages",
    `the setup was checked in ${setupTabs} tabs, where recipes.json has ${withSetup}`,
  )

if (findings.length > 0) {
  console.error(
    `Found ${findings.length} problems in the recipes:\n${findings.map((f) => `  - ${f}`).join("\n")}`,
  )
  process.exit(1)
}
console.log(
  `The recipes on ${pages} component pages point at things that exist. The setup is right in ${setupTabs} tabs.`,
)
