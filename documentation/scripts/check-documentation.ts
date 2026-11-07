/**
 * Checks that the documentation follows the code.
 *
 * The tables of component variables and classes are written by hand, and
 * they drift apart without anything saying so: `--lt-calendar-trigger-padding`
 * and `--lt-date-field-icon-radius` existed in the CSS for several rounds
 * without appearing anywhere a consumer could read them.
 *
 * A name counts as mentioned only when it stands as a whole word, see
 * `mentioned()`. With `includes`, `.lt-button` was documented as long as
 * `.lt-button-group` was on the page.
 *
 * Run with: bun run test:docs
 */

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { compile } from "tailwindcss"
import { CONTRACTS } from "../../interfaces/scripts/accessibility/contracts.ts"
import {
  FAMILIES,
  ROLES,
  roleToCss,
} from "../../interfaces/scripts/color-contract.ts"

const ROOT = fileURLToPath(new URL("../../", import.meta.url))
const COMPONENTS = `${ROOT}interfaces/src/components/`
const PAGES = `${ROOT}documentation/src/content/docs/components/`
const CUSTOMISING = `${ROOT}documentation/src/content/docs/customising.mdx`
const DOCUMENTATION = `${ROOT}documentation/src/`

type Problem = { where: string; what: string }

const problems: Problem[] = []

function read(path: string): string {
  return readFileSync(path, "utf8")
}

function files(pattern: string): string[] {
  return [...new Bun.Glob(pattern).scanSync(COMPONENTS)].map(
    (match) => `${COMPONENTS}${match}`,
  )
}

/**
 * Whether `name` stands in `text` as a whole word: with no letter, digit, `_`
 * or `-` right before or right after. `lt-button` is then not mentioned in
 * `lt-button-group`, and `--lt-card-padding` not in `--lt-card-padding-inline`.
 */
function mentioned(text: string, name: string): boolean {
  const edge = /[\w-]/
  for (let i = text.indexOf(name); i >= 0; i = text.indexOf(name, i + 1)) {
    const after = text[i + name.length] ?? ""
    if (!edge.test(text[i - 1] ?? "") && !edge.test(after)) return true
  }
  return false
}

/** The component folders: the folder name, such as `button`, and its path. */
function componentFolders(): { name: string; path: string }[] {
  const folders = new Map<string, string>()
  for (const file of files("*/*/*.ts")) {
    const parts = file.slice(COMPONENTS.length).split("/")
    if (parts.length < 3) continue
    folders.set(parts[1], `${COMPONENTS}${parts[0]}/${parts[1]}/`)
  }
  return [...folders]
    .map(([name, path]) => ({ name, path }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function source(path: string, extension: string): string {
  const matches = [...new Bun.Glob(`*${extension}`).scanSync(path)].filter(
    (name) => !name.includes(".test."),
  )
  return matches.map((name) => read(`${path}${name}`)).join("\n")
}

/** The class names a stylesheet defines. */
function classes(css: string): string[] {
  const clean = css
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/url\([^)]*\)/g, " ")
    .replace(/"[^"]*"/g, " ")
  return [
    ...new Set((clean.match(/\.lt-[\w-]+/g) ?? []).map((n) => n.slice(1))),
  ]
}

/**
 * The component variables, that is what the consumer can set on one component.
 *
 * The list is read from the manifest, which `generate-manifest.ts` writes from
 * the stylesheets: every `var(--lt-<component>-…, <fallback>)`, assigned to the
 * component the name starts with. This check used to read the stylesheets
 * itself, with its own rule for what is a token and what is a component
 * variable, and then the list existed in two places. Now the manifest is the
 * one place, and a variable that is not there does not exist for the
 * documentation either. That the manifest has been regenerated is guarded by
 * the CI step "Nothing is ungenerated".
 */
const MANIFEST: {
  tokens: { components: Record<string, Record<string, string>> }
} = JSON.parse(read(`${ROOT}interfaces/manifest/manifest.json`))
const COMPONENT_VARIABLES = MANIFEST.tokens.components

/**
 * Examples must be possible to copy straight in.
 *
 * `style=` in an example is nearly always a cheat to make the preview look
 * right, and the reader cannot tell it apart from the system. If the preview
 * needs an adjustment, it belongs in `previewCss` on `<Example>`, which is not
 * shown in the code tab.
 */
/*
 * The class names from our own namespace, collected from all MDX.
 *
 * The candidate is anything that looks like a utility class with `-lt-` in it,
 * with no list of prefixes. A list of allowed prefixes stood here first, and
 * it was wrong in both directions: `shadow-lt-accent-fill` exists in
 * Tailwind 4, since `--color-*` also feeds `shadow-<colour>`, and would have
 * been reported as unknown, while an outdated `w-lt-aside` or `p-lt-4` would
 * never have been seen. A `data-lt-…` is an attribute, not a class, and is not
 * counted.
 */
const CANDIDATE = /(?<![\w-])(?!data-lt-)[a-z][a-z-]*-lt-[a-z0-9][a-z0-9-]*/g

const candidates = new Map<string, Set<string>>()

/*
 * Occurrences of `-lt-` that did not become a candidate.
 *
 * This is the independent count. `candidates.size` is derived from the regex
 * itself, so a regex that narrows from nineteen matches to three gives a
 * number greater than zero and a check that reports green. This asks the
 * opposite: is there a `-lt-` left in the text after every candidate match is
 * removed? Then there is something the regex did not classify, and it must be
 * said.
 */
const unclassified = new Map<string, number>()

for (const file of new Bun.Glob("**/*.mdx").scanSync(
  `${ROOT}documentation/src/content/docs`,
)) {
  const text = read(`${ROOT}documentation/src/content/docs/${file}`)

  // `previewCss` is CSS, and can contain the word without it being markup.
  const withoutPreviewCss = text.replace(/previewCss=\{`[\s\S]*?`\}/g, " ")

  // `style = '…'` and `style='…'` are as valid as `style="…"`.
  if (/\bstyle\s*=/.test(withoutPreviewCss)) {
    problems.push({
      where: file,
      what: "has a style attribute in an example. Use previewCss, or a class from the system.",
    })
  }

  for (const match of text.matchAll(CANDIDATE)) {
    candidates.set(match[0], (candidates.get(match[0]) ?? new Set()).add(file))
  }

  /*
   * `--lt-…` is a token name and not a class, and `lt-button` and
   * `lt-tabs__list` are our own classes. Both are removed before what is left
   * is counted.
   */
  const rest = text
    .replace(CANDIDATE, " ")
    .replace(/--lt-[a-z0-9-]*/g, " ")
    .replace(/(?<![\w-])data-lt-[a-z0-9-]*/g, " ")
    .replace(/(?<![\w-])lt-[a-z0-9_-]+/g, " ")
    /*
     * A code word with a placeholder in it is a naming pattern and not a name:
     * `<utility>-lt-<family>-<role>` says how the classes are named. The whole
     * code word is struck out, otherwise `-lt-` is left between the
     * placeholders.
     */
    .replace(/`[^`\n]*<[^`\n]+`/g, " ")

  const left = rest.match(/-lt-/g)?.length ?? 0
  if (left > 0) unclassified.set(file, left)
}

/*
 * Every candidate is tried against a real Tailwind.
 *
 * Tailwind says nothing about a class it does not know: it just makes no rule.
 * The colours were renamed in 0.22.0, and twelve class names from before were
 * left in body text and tables on two pages. I fixed one page, and five of the
 * names were still on the other. A guard on the example markup alone does not
 * catch that, since a table row is not markup.
 *
 * The compiler is asked rather than interpreting the namespaces here.
 * `build()` is cumulative, so a candidate that produces nothing leaves the
 * length unchanged.
 */
const compiler = await compile(
  [
    '@import "tailwindcss/theme.css" layer(theme);',
    '@import "tailwindcss/utilities.css" layer(utilities);',
    '@import "@lo-tek/interfaces/tailwind.css";',
  ].join("\n"),
  {
    base: `${ROOT}documentation`,
    loadStylesheet: async (id: string, basedir: string) => {
      const path = id.startsWith(".")
        ? join(basedir, id)
        : Bun.resolveSync(id, basedir)
      return { path, base: dirname(path), content: read(path) }
    },
  },
)

let length = compiler.build([]).length
let triedClasses = 0

for (const [className, classFiles] of candidates) {
  const next = compiler.build([className]).length
  triedClasses += 1

  if (next <= length) {
    for (const file of classFiles) {
      problems.push({
        where: file,
        what: `mentions the Tailwind class \`${className}\`, which does not exist in the theme`,
      })
    }
  }
  length = Math.max(length, next)
}

/*
 * Three parts that must fail a check that has not looked at anything.
 *
 * The first is the independent count above: a `-lt-` that did not become a
 * candidate. The second is that there were any candidates at all. The third
 * is a negative control: without it the check would be permanently green the
 * day `build()` stopped being selective, since every real candidate is valid
 * and the rejection path is therefore never exercised by them.
 */
for (const [file, count] of unclassified) {
  problems.push({
    where: file,
    what: `has ${count} occurrences of "-lt-" that were not read as a class. The regex does not match everything it should.`,
  })
}

if (triedClasses === 0) {
  problems.push({
    where: "check-documentation.ts",
    what: "found no Tailwind classes to try. The regex no longer matches.",
  })
}

const beforeControl = length
if (compiler.build(["bg-lt-not-in-the-theme"]).length > beforeControl) {
  problems.push({
    where: "check-documentation.ts",
    what: "Tailwind made a rule for a class that does not exist. The check above cannot reject anything.",
  })
}

const customising = read(CUSTOMISING)
const allVariables = new Set<string>()

// The tokens must be on the tokens page. Otherwise they exist only in the
// source code, and a consumer building their own theme does not know they are
// there.
const tokenPage = read(
  `${ROOT}documentation/src/content/docs/design-tokens.mdx`,
)

/*
 * The colours are documented as a matrix, not as 86 names.
 *
 * `--lt-color-<family>-<role>` is systematic, so the page is complete when
 * every family and every role is on it. Requiring every cell would give a page
 * that is a list rather than an explanation, and it would have to be rewritten
 * every time a family was added.
 *
 * Everything that is not a cell is still required by name.
 */
const tokenCss = read(`${ROOT}interfaces/src/tokens/tokens.css`)
const allTokens = [...tokenCss.matchAll(/^\s*(--lt-[\w-]+):/gm)].map(
  (match) => match[1],
)

/*
 * The axes are read from `FAMILIES` and `ROLES`, not out of the names in
 * `tokens.css`.
 *
 * Deriving them from the names gave `disabled` as a tenth family, because
 * `--lt-color-disabled-text` looks like a cell. It has only two of the nine
 * roles and is precisely not a family. Everything that is not a real cell must
 * have its full token name on the page, as before.
 */
const families = new Set<string>(FAMILIES)
const roles = new Set<string>(
  Object.keys(ROLES).map((role) => roleToCss(role as keyof typeof ROLES)),
)
const others = new Set<string>()

for (const token of allTokens) {
  const cell = token.match(/^--lt-color-([a-z0-9]+)-(.+)$/)
  if (cell && families.has(cell[1]) && roles.has(cell[2])) continue
  others.add(token)
}

/*
 * The name must be first in a table row, not just somewhere on the page.
 *
 * `tokenPage.includes(name)` on the bare word was much weaker than the name
 * check it replaced: `border` is a substring of `border-subtle`, so it could
 * never fail on its own, and `danger`, `success` and `accent` also matched in
 * prose and in paths. Backticks alone were not enough either: the row for
 * `border` could be removed, since the promise in the row below mentions it.
 * The requirement is that the name stands as the first cell in a row, that is
 * that it is explained and not just mentioned.
 */
const firstCells = tokenPage
  .split("\n")
  .filter((line) => line.startsWith("|"))
  .map((line) => line.split("|")[1] ?? "")

const listed = (name: string) =>
  firstCells.some((cell) => cell.includes(`\`${name}\``))

for (const family of families) {
  if (!listed(family)) {
    problems.push({
      where: "design-tokens.mdx",
      what: `the family \`${family}\` is not documented`,
    })
  }
}

for (const role of roles) {
  if (!listed(role)) {
    problems.push({
      where: "design-tokens.mdx",
      what: `the role \`${role}\` is not documented`,
    })
  }
}

for (const token of others) {
  if (!mentioned(tokenPage, token)) {
    problems.push({
      where: "design-tokens.mdx",
      what: `the token \`${token}\` is not documented`,
    })
  }
}

for (const { name, path } of componentFolders()) {
  const page = `${PAGES}${name}.mdx`
  let text: string
  try {
    text = read(page)
  } catch {
    problems.push({
      where: `components/${name}.mdx`,
      what: "the component has no documentation page",
    })
    continue
  }

  const css = source(path, ".css")
  const variables = Object.keys(COMPONENT_VARIABLES[name] ?? {})
  const where = `components/${name}.mdx`

  if (!/^## .*[Aa]ccessibility/m.test(text)) {
    problems.push({ where, what: 'is missing the section "Accessibility"' })
  }

  /*
   * A component with an accessibility contract shows it, in its section
   * "Accessibility": the steps and what a screen reader is given, written
   * out by <ScreenReaderContract> from the data check-accessibility-tree.ts
   * checks. A page cannot then promise one thing while the check tests
   * another.
   */
  const section =
    text.split(/^## .*[Aa]ccessibility.*$/m)[1]?.split(/^## /m)[0] ?? ""
  const shown = [
    ...text.matchAll(/<ScreenReaderContract component="([^"]+)"/g),
  ].map((m) => m[1])
  const inSection = [
    ...section.matchAll(/<ScreenReaderContract component="([^"]+)"/g),
  ].map((m) => m[1])
  if (CONTRACTS.some((c) => c.component === name) && !inSection.includes(name))
    problems.push({
      where,
      what: `has an accessibility contract, but the section "Accessibility" does not show it: add <ScreenReaderContract component="${name}" />`,
    })
  for (const other of shown.filter((c) => c !== name))
    problems.push({
      where,
      what: `shows the accessibility contract of "${other}", not its own`,
    })

  // <Example> for the simple ones, or a separate demo component where the
  // example needs a script, such as <CalendarDemo>.
  if (!/<(Example|[A-Z][A-Za-z]*Demo)\b/.test(text)) {
    problems.push({ where, what: "is missing a live preview" })
  }

  /*
   * The imports belong in the recipe, not anywhere on the page.
   *
   * The rule used to look for a `js` block with the package name in it,
   * anywhere in the text. It went green on most pages for the wrong reason:
   * "TypeScript" at the bottom mentions `@lo-tek/interfaces/react`, and that
   * counted. Now "How to use it" itself must say what to import, either in a
   * code tab or with `recipe` on <Example>, which shows the stylesheets
   * `pageSetup` computes from its markup.
   */
  const recipeStart = text.indexOf("## How to use it")
  const recipeEnd = text.indexOf("\n## ", recipeStart + 5)
  const recipe =
    recipeStart === -1
      ? ""
      : text.slice(recipeStart, recipeEnd === -1 ? undefined : recipeEnd)

  if (recipeStart === -1) {
    problems.push({ where, what: 'is missing the section "How to use it"' })
  } else if (!/\.css/.test(recipe) && !/<Example\s+recipe\b/.test(recipe)) {
    /*
     * A stylesheet, not just the package name.
     *
     * The rule used to require the recipe to mention `@lo-tek/interfaces`,
     * and `tabs.mdx` went green on `@lo-tek/interfaces/tabs`, the JavaScript
     * module, without a word about `tabs.css`. The reader who followed the
     * recipe got unstyled tabs.
     */
    problems.push({
      where,
      what: "does not say which stylesheets the recipe needs",
    })
  }

  // Components that render nothing themselves, such as <lt-field>, have
  // nothing to expose and therefore need no such section.
  const exposes = classes(css).length > 0 || variables.length > 0
  const styleable = /## (Classes|Parts) you can style/.test(text)
  if (exposes && !styleable) {
    problems.push({
      where,
      what: 'is missing the section "Classes you can style" or "Parts you can style"',
    })
  }

  for (const className of classes(css)) {
    if (!mentioned(text, className)) {
      problems.push({
        where,
        what: `the class \`.${className}\` is not documented`,
      })
    }
  }

  for (const variable of variables) {
    allVariables.add(variable)
    if (!mentioned(text, variable)) {
      problems.push({
        where,
        what: `the variable \`${variable}\` is not documented`,
      })
    }
  }
}

/*
 * Every variable in the manifest, including those of a component without a
 * page: the overview must have them all, and the count must be greater than
 * zero, otherwise the manifest has no component variables and the check above
 * said nothing.
 */
for (const variables of Object.values(COMPONENT_VARIABLES))
  for (const variable of Object.keys(variables)) allVariables.add(variable)
if (allVariables.size === 0) {
  problems.push({
    where: "manifest.json",
    what: "has no component variables, so no variable was checked",
  })
}
/*
 * As the first cell in a table row, not just mentioned: `--lt-card-padding`
 * stands in the prose about scope further up, and the row could be taken out
 * of the overview without anything saying so.
 */
const listedInCustomising = new Set(
  customising
    .split("\n")
    .filter((line) => line.startsWith("| `--lt-"))
    .map((line) => line.split("|")[1]?.trim().replace(/`/g, "") ?? ""),
)
for (const variable of [...allVariables].sort()) {
  if (!listedInCustomising.has(variable)) {
    problems.push({
      where: "customising.mdx",
      what: `the variable \`${variable}\` is missing from the overview`,
    })
  }
}

/*
 * Examples that call `lt.field()` without `id`.
 *
 * `id` is required, and a consumer who copies an example without it gets a
 * warning in the console and an id that does not survive hydration. Nothing
 * else in the run reads the code blocks: `check-documentation` looks for names
 * in the text, and none of them is compiled. When this change was made, all
 * the examples were already right, but that was by chance and not guarded.
 */
/**
 * A call to a builder function that takes an id, and the argument it got.
 *
 * The object is captured with one level of nesting, so `${x}` and a nested
 * object inside do not end the match too early. If the argument is a variable
 * rather than an object, the check says nothing: it cannot know what is in
 * it, and a false alarm on correct code is worse than a gap.
 */
const CODE_CALL =
  /\blt\.(field|suggestion|tabs|popover|dialog)\(\s*(\{(?:[^{}]|\{[^{}]*\})*\})?\s*\)?/g

/** The same, but only when the call has an argument list. See `inlineCode`. */
const CODE_CALL_WITH_ARGUMENT =
  /\blt\.(field|suggestion|tabs|popover|dialog)\(\s*(\{(?:[^{}]|\{[^{}]*\})*\})\s*\)/g

/**
 * Only the code.
 *
 * In body text `lt.field()` is mentioned without being a call, and on the
 * front page it even stands inside a `<code>` tag in a sentence. In mdx the
 * code is what stands in the code fences, in Astro it is the frontmatter and
 * the scripts.
 */
function codeSnippets(file: string, content: string): string[] {
  if (file.endsWith(".mdx")) {
    return [...content.matchAll(/```[a-zA-Z]*\n([\s\S]*?)```/g)].map(
      (match) => match[1],
    )
  }

  const frontmatter = content.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ""
  const scripts = [
    ...content.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g),
  ].map((match) => match[1])
  return [frontmatter, ...scripts]
}

/**
 * What stands in single backticks in the body text.
 *
 * `lt.suggestion({ count: matches.length })` without `id` stood in a sentence
 * below an example and slipped through, since only the code fences were read.
 * A call with an argument list is an example wherever it stands.
 */
function inlineCode(file: string, content: string): string[] {
  if (!file.endsWith(".mdx")) return []
  const withoutFences = content.replace(/```[\s\S]*?```/g, "")
  return [...withoutFences.matchAll(/`([^`\n]+)`/g)].map((match) => match[1])
}

function readCall(file: string, match: RegExpMatchArray): void {
  const builder = match[1]
  const argument = match[2]
  // No argument list to read, so a variable. Then we say nothing.
  if (argument === undefined && !/\(\s*\)/.test(match[0])) return

  const key = builder === "dialog" ? "titleId" : "id"
  // Without a colon: `{ titleId }` is the shorthand, and it counts. The word
  // boundaries keep `helpId` and `errorId` from passing for `id`.
  if (argument && new RegExp(`\\b${key}\\b`).test(argument)) return

  problems.push({
    where: file,
    what: `\`lt.${builder}()\` without \`${key}\`. It is required, and an example without it teaches a trap`,
  })
}

for (const file of [
  ...new Bun.Glob("**/*.{mdx,astro}").scanSync(DOCUMENTATION),
]) {
  const content = read(`${DOCUMENTATION}${file}`)

  for (const code of codeSnippets(file, content)) {
    for (const match of code.matchAll(CODE_CALL)) readCall(file, match)
  }

  /*
   * In the body text only a call that actually has an argument list counts.
   * `lt.field()` without arguments is the name of a function, and stands like
   * that in dozens of sentences.
   */
  for (const code of inlineCode(file, content)) {
    for (const match of code.matchAll(CODE_CALL_WITH_ARGUMENT))
      readCall(file, match)
  }
}

/*
 * The version in a CDN address must come from `remark-version.mjs`, not from
 * the keyboard.
 *
 * The addresses were hard-coded in 74 places in 12 files, and
 * `prepare-version` rewrote them at every release. A rewriting step has to
 * find the old version to replace it, so a file that had drifted was left
 * pointing at an older package than the text around it described. The
 * placeholder cannot drift.
 *
 * The requirement is that the version part is exactly `VERSION`, not just that
 * it is not digits: `@latest` would otherwise pass and give an address
 * jsdelivr answers differently from what the text promises.
 */
for (const file of [
  ...new Bun.Glob("**/*.{mdx,astro}").scanSync(DOCUMENTATION),
]) {
  const content = read(`${DOCUMENTATION}${file}`)

  for (const match of content.matchAll(/@lo-tek\/interfaces@([^/\s"'`)]+)/g)) {
    // `VERSION` is the form in markdown. In an `.astro` file no remark runs,
    // and there the right form is to read the version from `package.json` in
    // the code. The exception must be bound to the file type: without that,
    // `@lo-tek/interfaces@${version}` slipped through in an mdx code block
    // too, where nobody replaces it and no other guard looks for it.
    if (match[1] === "VERSION") continue
    if (file.endsWith(".astro") && match[1].startsWith("${")) continue

    const line = content.slice(0, match.index).split("\n").length
    problems.push({
      where: `${file}:${line}`,
      what: `${match[0]} has the version written by hand. Use @lo-tek/interfaces@VERSION, which remark-version.mjs replaces.`,
    })
  }
}

// A contract for a component that has no folder is shown on no page.
const folders = new Set(componentFolders().map((f) => f.name))
for (const contract of CONTRACTS)
  if (!folders.has(contract.component))
    problems.push({
      where: "interfaces/scripts/accessibility/contracts.ts",
      what: `the contract for "${contract.component}" names no component folder, so no page shows it`,
    })

if (problems.length > 0) {
  const summary = problems.map((p) => `  ${p.where}: ${p.what}`).join("\n")
  console.error(
    `Found ${problems.length} mismatches between the code and the documentation:\n\n${summary}\n`,
  )
  process.exit(1)
}

console.log(
  `The documentation follows the code. ${triedClasses} Tailwind classes tried against the theme.`,
)
