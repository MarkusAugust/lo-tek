/**
 * That the rulebooks in `agent/` match the package.
 *
 * An agent instruction with a mistake in it is worse than no instruction: it
 * looks authoritative, and the agent writes the mistake into the consumer's
 * app without asking. Every claim in every rulebook is therefore checked
 * against what the package actually ships, in the same way
 * `check-recipes.ts` does for the component pages.
 *
 *   - the files on disk are the ones the generator would write now;
 *   - every class and every element the package has is in every rulebook;
 *   - every markup block passes LO-TEK's own check without findings;
 *   - every `@lo-tek/interfaces/…` exists in `exports`;
 *   - every `defineLtX` matches an element that exists;
 *   - every `lt.x()` is a builder function that exists;
 *   - every token name is in `tokens.css`;
 *   - only the React rulebook shows the React entry, `useEffect` and `createRoot`;
 *   - no markup for the browser imports a package name.
 *
 * Run with: bun scripts/check-agent.ts, or as part of `bun run build`.
 */

import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { diagnoseMarkup } from "../src/diagnostics/index.js"
import { lt } from "../src/index.js"
import { classes } from "../src/vocabulary/classes.js"
import { elements } from "../src/vocabulary/elements.js"
import { PACKAGE, packageJson } from "./agent-parts.js"
import { FAMILIES, ROLES, roleToCss } from "./color-contract.js"
import { files, NAMES } from "./generate-agent.js"
import { checkSetup } from "./page-setup.js"

const problems: string[] = []

/** Every component stylesheet in one string, for looking up variable names. */
function componentStylesheets(
  folder = join(PACKAGE, "src/components"),
): string {
  return readdirSync(folder, { withFileTypes: true })
    .map((entry) => {
      const path = join(folder, entry.name)
      if (entry.isDirectory()) return componentStylesheets(path)
      return entry.name.endsWith(".css") ? readFileSync(path, "utf8") : ""
    })
    .join("\n")
}

/*
 * The counters are not decoration. A guard that goes through a list must
 * count what it actually did, last in the loop, and require the number to be
 * both equal to the expected one and greater than zero. Without that, the
 * summary here printed the number of classes and elements it had *fetched*,
 * not the number it had looked at, and an empty list would have looked like
 * a full run.
 */
let checkedFiles = 0
let checkedClasses = 0
let checkedElements = 0
let checkedTokens = 0
let checkedAxes = 0

/*
 * The token names are counted per kind, not only in total.
 *
 * A single total hid that a whole kind could be missing: when the colours
 * became a matrix, the generator stopped writing a single colour name, and
 * the total was still large because the "Font:" line still listed thirteen
 * `--font-*` names.
 *
 * This guard does not catch exactly that case today, and that should be
 * written here rather than believed: the template in `generate-agent.ts` has
 * two colour names written into the prose, so `--lt-color-` is read in every
 * book even if `tokenList()` returned an empty string. It is the axis check
 * below that fails an empty code fence. This one fails a kind that
 * disappears entirely, such as `--lt-spacing-` or `--lt-line-height-`.
 */
const KINDS = [
  "--lt-color-",
  "--lt-spacing-",
  "--lt-line-height-",
  "--lt-font-",
]
const kindsRead = new Map<string, Set<string>>()
let checkedBlocks = 0
/** The html blocks whose setup `checkSetup` has held, counted where it holds them. */
let checkedSetups = 0
const blocksPerFile = new Map<string, number>()

function demand(condition: boolean, description: string): void {
  if (!condition) problems.push(description)
}

/*
 * The folder on disk is the independent source.
 *
 * Everything else in this guard comes from `RECIPES`: the queue, the
 * expected count, and the content it is compared with. It therefore asks the
 * generator about the generator, and CONTRIBUTING.md is categorical that the
 * expected count must not come from the same source as the queue.
 *
 * The failure is concrete: rename a recipe, and the generator writes the new
 * file without deleting the old one. The old one stays behind, out of date,
 * and it goes into the tarball because `files` takes the whole folder, and is
 * served at `/agent/<name>.md` because the route reads the folder.
 * `lotek agent` cannot print it, and nothing says so.
 */
const onDisk = readdirSync(join(PACKAGE, "agent"))
  .filter((name) => name.endsWith(".md"))
  .sort()
const shouldExist = NAMES.map((name) => `${name}.md`).sort()

if (onDisk.join(",") !== shouldExist.join(",")) {
  const extraFiles = onDisk.filter((name) => !shouldExist.includes(name))
  const missing = shouldExist.filter((name) => !onDisk.includes(name))

  if (extraFiles.length > 0)
    demand(
      false,
      `agent/ has files the generator does not write: ${extraFiles.join(", ")}. Delete them.`,
    )
  if (missing.length > 0)
    demand(
      false,
      `agent/ is missing ${missing.join(", ")}. Run bun run generate.`,
    )
}

// 1. The files on disk are up to date.
const expected = files()

for (const [path, content] of Object.entries(expected)) {
  let actual: string | null = null

  try {
    actual = readFileSync(join(PACKAGE, path), "utf8")
  } catch {
    // Missing: reported below.
  }

  if (actual === null)
    demand(false, `${path} does not exist. Run bun run generate.`)
  else if (actual !== content)
    demand(false, `${path} is out of date. Run bun run generate.`)
}

for (const [path, content] of Object.entries(expected)) {
  const name = path.replace(/^agent\/|\.md$/g, "")
  checkedFiles += 1

  // 2. Every class and every element the package has is mentioned. A
  // component that is missing is a component the agent invents an
  // alternative to.
  for (const className of Object.keys(classes)) {
    // With `includes(className)`, `lt-avatar` was satisfied by
    // `lt-avatar-stack`, and 19 of the base classes had a longer sibling
    // class in the same table. A backtick on both sides is the form the
    // tables actually write them in.
    demand(
      content.includes(`\`${className}\``),
      `${path} does not mention the class ${className}`,
    )
    checkedClasses += 1
  }
  for (const tag of Object.keys(elements)) {
    demand(
      content.includes(`<${tag}>`),
      `${path} does not mention the element <${tag}>`,
    )
    checkedElements += 1
  }

  /*
   * 3. The markup passes LO-TEK's own check.
   *
   * `astro` is included because an `.astro` file is HTML with frontmatter on
   * top, and the blocks there carry real markup: all of `## 7` in the astro
   * rulebook is an `<lt-field>`. `tsx` is not included, and that is a
   * deliberate gap: the markup there is JSX, with `invalid={invalid ||
   * undefined}` and other forms the diagnostics do not read, and `## 7` in
   * the react rulebook deliberately shows invalid markup as examples of
   * compile errors.
   */
  const blocks = [...content.matchAll(/```(?:html|astro)\n([\s\S]*?)```/g)]

  for (const [index, block] of blocks.entries()) {
    for (const finding of diagnoseMarkup(block[1])) {
      demand(false, `${path}, markup block ${index + 1}: ${finding.message}`)
    }
    checkedBlocks += 1
  }

  blocksPerFile.set(path, blocks.length)

  // 4. Every import points to something the package promises. A path that
  // does not exist is code that looks right and fails for the consumer.
  for (const match of content.matchAll(
    /(node_modules\/)?@lo-tek\/interfaces\/([a-z0-9-]+(?:\.css)?)/g,
  )) {
    // A path under node_modules is a file path into the package, not a
    // package name `exports` answers for. `dist/lotek.css` exists, but
    // `./dist` does not.
    if (match[1]) continue

    const entryName = `./${match[2]}`
    demand(
      entryName in packageJson.exports,
      `${path} refers to ${match[0]}, which is not in exports`,
    )
  }

  // 5. Every registration function matches an element that exists.
  for (const match of content.matchAll(/\bdefineLt([A-Z][A-Za-z]*)\b/g)) {
    const tag = `lt-${match[1]
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .toLowerCase()}`
    demand(
      tag in elements,
      `${path} calls ${match[0]}, but ${tag} does not exist`,
    )
  }

  // 6. Every builder function exists in `lt`.
  for (const match of content.matchAll(/\blt\.([a-zA-Z]+)\(/g)) {
    demand(
      match[1] in lt,
      `${path} uses lt.${match[1]}(), which does not exist in lt`,
    )
  }

  /*
   * 8. Both axes of the colour matrix are in the code fence.
   *
   * The token check above counts names, and the axes are not names: a family
   * is called `accent`, not `--lt-color-accent`. When the colours became a
   * matrix, the generator stopped writing a single colour name, the code
   * fence was empty, and the name count was still large enough to report
   * green.
   *
   * The check reads only the code fences, not the prose around them. The
   * prose in the template mentions `surface`, `fill`, `content`, `border`,
   * `text` and `neutral` to explain what a role is, so a check on the whole
   * file would be satisfied by the template alone for six of the eighteen
   * claims. An axis could then drop out without anything saying so.
   */
  const fences = [...content.matchAll(/```[\s\S]*?```/g)]
    .map((match) => match[0])
    .join("\n")

  for (const family of FAMILIES) {
    demand(
      fences.includes(`\`${family}\``),
      `${path} does not mention the family ${family} in a code fence`,
    )
    checkedAxes += 1
  }

  for (const role of Object.keys(ROLES)) {
    const name = roleToCss(role)
    demand(
      fences.includes(`\`${name}\``),
      `${path} does not mention the role ${name} in a code fence`,
    )
    checkedAxes += 1
  }

  // 7. Every token name exists. The ellipsis is in the prose as a pattern,
  // and is therefore skipped.
  const tokens = readFileSync(join(PACKAGE, "src/tokens/tokens.css"), "utf8")
  /*
   * A component variable, such as `--lt-label-required-text`, is not a
   * token, but it exists in the component's stylesheet. The name must be in
   * one or the other, so a rulebook cannot mention a variable the package
   * does not have.
   */
  const stylesheets = componentStylesheets()

  /*
   * The pattern must end on a letter or digit, and not have another one
   * after it. Without the first part, `var(--lt-color-…)` in the prose
   * matched as `--lt-color-`, since the kind is now in the name and the
   * hyphen is in the character class. It only got through before because
   * `--semantic-` had no kind to cut at.
   */
  for (const match of content.matchAll(
    /--lt-[a-zA-Z0-9-]*[a-zA-Z0-9](?![a-zA-Z0-9\-…])/g,
  )) {
    /*
     * The name must appear in full in `tokens.css`, not just as a prefix:
     * `--lt-color-danger` does not exist, but would have passed on
     * `--lt-color-danger-fill`.
     */
    const wholeName = new RegExp(`${match[0]}(?![a-zA-Z0-9-])`)

    demand(
      wholeName.test(tokens) || wholeName.test(stylesheets),
      `${path} mentions ${match[0]}, which exists neither in tokens.css nor in a component stylesheet`,
    )
    checkedTokens += 1
    for (const kind of KINDS)
      if (match[0].startsWith(kind))
        kindsRead.set(kind, (kindsRead.get(kind) ?? new Set()).add(path))
  }

  // 8. No cross-contamination. Warning against `className` is useful in the
  // other files, so the word alone is fine; what must not be there is the
  // recipe for using the React entry or an effect.
  if (name !== "react") {
    for (const reactism of [
      '"@lo-tek/interfaces/react"',
      "useEffect",
      "createRoot",
    ]) {
      demand(
        !content.includes(reactism),
        `${path} refers to ${reactism}, which belongs only in react.md`,
      )
    }
  }

  /*
   * 9. No markup for the browser imports a package name.
   *
   * `import … from "@lo-tek/interfaces/field"` in a `<script type="module">`
   * does not resolve without a bundler or an import map: the package name
   * does not exist in the browser, and the import fails silently. The tracks
   * without a build step therefore need the full URL. The check is here
   * rather than per environment, since an `html` block is markup for the
   * browser whichever rulebook it is in.
   */
  /*
   * Only the `html` blocks, not `astro`.
   *
   * In an `.astro` file the package name is correct: the frontmatter runs at
   * build time, and Astro takes the `<script>` tags in the template through
   * the build step. The rule is for markup that goes straight to the browser.
   */
  for (const [index, block] of [
    ...content.matchAll(/```html\n([\s\S]*?)```/g),
  ].entries()) {
    // A side-effect import without `from`, a dynamic import and single quotes
    // fail just as silently in a browser as the one form that was here before.
    const bare = /(?:from|import)\s*\(?\s*\n?\s*["']@lo-tek\/interfaces/.test(
      block[1],
    )
    demand(
      !bare,
      `${path}, markup block ${index + 1} imports a package name in the browser. Use the full URL.`,
    )

    /*
     * The setup in the block, held to `pageSetup` like every tab on the
     * pages. A rulebook spreads the setup over its sections, so each block is
     * an illustration: it need not repeat what another section gave, but
     * what it writes must be right. The rulebook said Datastar before the
     * registration while the pages said the opposite (0bfbb64).
     */
    const target = path === "agent/datastar.md" ? "datastar" : "html"
    for (const finding of checkSetup(target, block[1], { part: true }))
      demand(false, `${path}, markup block ${index + 1} ${finding}`)
    checkedSetups += 1
  }
}

if (problems.length > 0) {
  console.error(
    `The rulebooks do not match the package:\n\n${problems
      .map((line) => `  ${line}`)
      .join("\n")}\n`,
  )
  process.exit(1)
}

/*
 * The guard comes after the report, never instead of it, so an incomplete
 * run does not hide the problems it did manage to find.
 *
 * The expected counts come from `NAMES`, `classes` and `elements`, that is,
 * from the same sources the generator builds from. The guard therefore does
 * not check that the content is right, only that every file was actually
 * gone through. The independent checks are in `diagnoseMarkup`, in `exports`
 * and in `tokens.css`.
 */
const expectedCounts = {
  files: NAMES.length,
  classes: NAMES.length * Object.keys(classes).length,
  elements: NAMES.length * Object.keys(elements).length,
}

const shortfalls: string[] = []

if (checkedFiles !== expectedCounts.files || checkedFiles === 0)
  shortfalls.push(`${checkedFiles} files, expected ${expectedCounts.files}`)
if (checkedClasses !== expectedCounts.classes || checkedClasses === 0)
  shortfalls.push(
    `${checkedClasses} classes, expected ${expectedCounts.classes}`,
  )
if (checkedElements !== expectedCounts.elements || checkedElements === 0)
  shortfalls.push(
    `${checkedElements} elements, expected ${expectedCounts.elements}`,
  )
if (checkedTokens === 0) shortfalls.push("no token names")

const expectedAxes =
  NAMES.length * (FAMILIES.length + Object.keys(ROLES).length)
if (checkedAxes !== expectedAxes || checkedAxes === 0)
  shortfalls.push(`${checkedAxes} axes, expected ${expectedAxes}`)

for (const kind of KINDS) {
  const fileCount = kindsRead.get(kind)?.size ?? 0
  if (fileCount !== NAMES.length)
    shortfalls.push(
      `${kind} read in ${fileCount} rulebooks, expected ${NAMES.length}`,
    )
}
if (checkedBlocks === 0) shortfalls.push("no markup blocks")
if (checkedSetups === 0) shortfalls.push("no setup held to pageSetup")

/*
 * Every rulebook must have at least one markup block that was read, with one
 * exception that is written here rather than kept silent: the react rulebook
 * has none. The markup there is JSX, and the diagnostics do not read it. It
 * is covered by the class, element, path and token checks like the others,
 * but not by this one.
 *
 * The guard has proved that it works both ways. When the theme section came
 * with a shared HTML block, react.md got markup it should not have had, and
 * the guard reported that the file no longer belonged here. The example is
 * now written in each environment's own language, and React got its tsx
 * back.
 */
const WITHOUT_MARKUP_CHECK = new Set(["react"])

for (const [path, count] of blocksPerFile) {
  const name = path.replace(/^agent\/|\.md$/g, "")

  if (count === 0 && !WITHOUT_MARKUP_CHECK.has(name))
    shortfalls.push(`${path} has no markup block that was read`)

  if (count > 0 && WITHOUT_MARKUP_CHECK.has(name))
    shortfalls.push(
      `${path} now has markup that can be read, so it does not belong in WITHOUT_MARKUP_CHECK`,
    )
}

if (shortfalls.length > 0) {
  console.error(
    `The guard did not look at what it should have: ${shortfalls.join("; ")}\n`,
  )
  process.exit(1)
}

console.log(
  `The rulebooks match: ${checkedFiles} files, ${checkedClasses} class claims, ${checkedElements} element claims, ${checkedTokens} token names, ${checkedAxes} axes and ${checkedBlocks} markup blocks, and the setup in ${checkedSetups} html blocks.`,
)
