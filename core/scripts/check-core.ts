/**
 * That the core answers what it should, on everything it can meet.
 *
 * Three sources of markup, from the narrowest to the widest:
 *
 * 1. The fixtures in `parity/`. The answer must be exactly the expected
 *    result next to it, field by field, and together the fixtures must
 *    trigger every rule the core has. The expected results for the first ten
 *    were written by the TypeScript version of the check before it was
 *    deleted, the others by the core when they were added. It is an ordinary
 *    test: a change in an answer is a change in the expected result, and shows
 *    in the diff. A fixture with a `.css` next to it is also checked with the
 *    stylesheet, like `diagnoseRendered`, and the answer is under `styled`.
 *    `ParityTest` in `kotlin/` requires the same expected results from the JVM.
 * 2. Everything in the repository with markup in it: the documentation, the
 *    rulebooks, the components and their tests. It is markup written by people
 *    and agents, with all the oddities that come with it.
 * 3. Broken markup: every fixture, cut, spliced and with characters inserted
 *    and removed, with a fixed seed, so a finding can be reproduced.
 *
 * The theme has its own expected results in `theme/`: recipes for
 * `buildTheme`, and themes written as CSS for `inspectTheme`, with the answer
 * next to them.
 *
 * In addition the templates in `templates/`, one per template language:
 * Thymeleaf, JTE, Go, Razor and Blade. Each has exactly one deliberate typo,
 * and must give exactly that finding and no others.
 *
 * For 2 and 3 there are no expected results, but the answer must hold: the
 * core does not throw, every finding lies within the text, the line and column
 * match `start`, the rule is one the core has, and a fix lies within the text.
 * The check runs with both `diagnoseMarkup` and `diagnosePage`.
 *
 * Run with: bun core/scripts/check-core.ts (after build.ts)
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import {
  type Finding,
  loadCore,
} from "../../interfaces/src/diagnostics/core.js"
import { MODULE } from "./build.js"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const core = loadCore(readFileSync(MODULE))
// The core carries no data. The check gives it the package's manifest and
// colour contract, as every host does.
core.loadManifest(
  readFileSync(join(ROOT, "interfaces/manifest/manifest.json"), "utf8"),
)
core.loadContract(
  readFileSync(join(ROOT, "interfaces/src/tokens/color-contract.json"), "utf8"),
)

/**
 * The rules the core has, read from `RULES` in `core/src/types.rs`. The list
 * used to be copied out here by hand, and lacked the two `unstyled-*` rules.
 */
const RULES = new Set(
  [
    ...(
      /pub const RULES: &\[&str\] = &\[([^\]]*)\]/.exec(
        readFileSync(join(ROOT, "core/src/types.rs"), "utf8"),
      )?.[1] ?? ""
    ).matchAll(/"([a-z-]+)"/g),
  ].map((m) => m[1]),
)
if (RULES.size === 0) throw new Error("found no RULES in core/src/types.rs")

/** The fields the expected results have, in a fixed order, so two equal findings give equal strings. */
const canonical = (findings: Omit<Finding, "rule" | "line" | "column">[]) =>
  JSON.stringify(
    findings.map((f) => ({
      start: f.start,
      end: f.end,
      severity: f.severity,
      link: f.link,
      message: f.message,
      fix: f.fix && {
        title: f.fix.title,
        edits: f.fix.edits.map((e) => ({
          start: e.start,
          end: e.end,
          text: e.text,
        })),
        preferred: f.fix.preferred ?? false,
      },
    })),
  )

let count = 0
let totalFindings = 0
const failures: string[] = []

/**
 * The line and column `start` has in the text, from 1. A line break is `\n`,
 * `\r\n` or `\r` alone, as in LSP.
 */
function position(html: string, start: number): [number, number] {
  let line = 1
  let lineStart = 0
  for (let i = 0; i < start; i++)
    if (html[i] === "\n" || (html[i] === "\r" && html[i + 1] !== "\n")) {
      line += 1
      lineStart = i + 1
    }
  return [line, start - lineStart + 1]
}

/** What an answer must hold, also without expected results. */
function holds(name: string, html: string) {
  for (const [mode, check] of [
    ["markup", core.diagnoseMarkup],
    ["page", core.diagnosePage],
  ] as const) {
    count += 1
    let findings: Finding[]
    try {
      findings = check(html)
    } catch (e) {
      failures.push(
        `${name} (${mode}): threw ${e instanceof Error ? e.message : e}`,
      )
      continue
    }
    totalFindings += findings.length
    for (const f of findings) {
      const wrong = !(0 <= f.start && f.start <= f.end && f.end <= html.length)
        ? "outside the text"
        : position(html, f.start).join(":") !== `${f.line}:${f.column}`
          ? `line and column ${f.line}:${f.column}, expected ${position(html, f.start).join(":")}`
          : !RULES.has(f.rule)
            ? `unknown rule ${f.rule}`
            : f.fix &&
                !f.fix.edits.every(
                  (e) =>
                    0 <= e.start && e.start <= e.end && e.end <= html.length,
                )
              ? "the fix is outside the text"
              : f.fix?.edits.some(
                    (e, i) =>
                      i > 0 && e.start < (f.fix?.edits[i - 1]?.end ?? 0),
                  )
                ? "the edits in the fix overlap or are in the wrong order"
                : undefined
      if (wrong)
        failures.push(`${name} (${mode}): ${wrong} in ${JSON.stringify(f)}`)
    }
  }
}

// 1. The fixtures.
const PARITY = join(ROOT, "core/parity")
const fixtures = readdirSync(PARITY)
  .filter((f) => f.endsWith(".html"))
  .map((f) => [f, readFileSync(join(PARITY, f), "utf8")] as const)
const covered = new Set<string>()
for (const [name, html] of fixtures) {
  const expectedResult = JSON.parse(
    readFileSync(join(PARITY, name.replace(/\.html$/, ".json")), "utf8"),
  )
  const cssFile = join(PARITY, name.replace(/\.html$/, ".css"))
  const css = existsSync(cssFile) ? [readFileSync(cssFile, "utf8")] : undefined
  requireSameKeys(name, expectedResult, css !== undefined)
  for (const [mode, check] of [
    ["markup", core.diagnoseMarkup],
    ["page", core.diagnosePage],
    ...(css
      ? ([
          ["styled", (h: string) => core.diagnoseStyled(h, css, true)],
        ] as const)
      : []),
  ] as const) {
    count += 1
    const findings = check(html)
    for (const f of findings) covered.add(f.rule)
    const expected = canonical(expectedResult[mode] ?? [])
    const answer = canonical(findings)
    if (answer !== expected)
      failures.push(
        `${name} (${mode})\n  Expected: ${expected.slice(0, 600)}\n  Core:     ${answer.slice(0, 600)}`,
      )
  }
  holds(name, html)
}
const uncovered = [...RULES].filter((r) => !covered.has(r))
if (uncovered.length > 0)
  failures.push(
    `no fixture in parity/ triggers ${uncovered.join(", ")}. Add one, so the rule is also tested on the JVM.`,
  )

/** An expected result with `styled` and no stylesheet, or the reverse, checks nothing. */
function requireSameKeys(
  name: string,
  expectedResult: object,
  hasCss: boolean,
) {
  const keys = Object.keys(expectedResult).sort().join(",")
  const expected = hasCss ? "markup,page,styled" : "markup,page"
  if (keys !== expected)
    failures.push(
      `${name}: the expected file has ${keys}, expected ${expected}`,
    )
}

// The theme: the recipes and themes in `theme/` against the expected results
// next to them. They were written by the TypeScript version of the theme
// before it was deleted.
const THEME = join(ROOT, "core/theme")
/** JSON with the keys sorted: the order in an object is not part of the answer. */
const sorted = (value: unknown): string =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : v,
  )
const recipes: Record<
  string,
  { recipe: unknown; theme?: unknown; error?: string }
> = JSON.parse(readFileSync(join(THEME, "recipes.json"), "utf8"))
for (const [name, { recipe, theme, error: expectedError }] of Object.entries(
  recipes,
)) {
  count += 1
  let answer: unknown
  try {
    answer = { theme: core.buildTheme(recipe) }
  } catch (e) {
    answer = { error: e instanceof Error ? e.message : String(e) }
  }
  const expected =
    expectedError === undefined ? { theme } : { error: expectedError }
  if (sorted(answer) !== sorted(expected))
    failures.push(
      `theme/recipes.json, ${name}\n  Expected: ${sorted(expected).slice(0, 400)}\n  Core:     ${sorted(answer).slice(0, 400)}`,
    )
}
const reports: Record<string, unknown> = JSON.parse(
  readFileSync(join(THEME, "reports.json"), "utf8"),
)
for (const [name, expected] of Object.entries(reports)) {
  count += 1
  const answer = core.inspectTheme(
    readFileSync(join(THEME, `${name}.css`), "utf8"),
  )
  if (sorted(answer) !== sorted(expected))
    failures.push(
      `theme/${name}.css\n  Expected: ${sorted(expected).slice(0, 400)}\n  Core:     ${sorted(answer).slice(0, 400)}`,
    )
}

// The themes broken, cut and spliced: the core must answer, not crash. A
// panic in Rust becomes a crash in WebAssembly, and then the host only gets
// "unreachable". A recipe may be rejected, but only with an explanation.
let themeSeed = 20261008
const themeRandom = (n: number) => {
  themeSeed = (themeSeed * 1103515245 + 12345) % 2 ** 31
  return themeSeed % n
}
const themeSources = readdirSync(THEME)
  .filter((f) => f.endsWith(".css"))
  .map((f) => readFileSync(join(THEME, f), "utf8"))
const THEME_PIECES = [
  "{",
  "}",
  ";",
  ":",
  '"',
  "'",
  "/*",
  "*/",
  "\\",
  "url(",
  ")",
  "@media x {",
  "!important",
  "\n",
  "ø",
  "#",
]
const BROKEN_THEMES = 2000
for (let n = 0; n < BROKEN_THEMES; n++) {
  let css = themeSources[themeRandom(themeSources.length)]
  for (let step = 0, times = 1 + themeRandom(6); step < times; step++) {
    const at = themeRandom(css.length + 1)
    const choice = themeRandom(3)
    if (choice === 0)
      css =
        css.slice(0, at) +
        THEME_PIECES[themeRandom(THEME_PIECES.length)] +
        css.slice(at)
    else if (choice === 1)
      css = css.slice(0, at) + css.slice(at + 1 + themeRandom(30))
    else css = css.slice(0, at)
  }
  count += 1
  try {
    core.inspectTheme(css)
  } catch (e) {
    failures.push(
      `inspectTheme crashed on ${JSON.stringify(css).slice(0, 300)}: ${e}`,
    )
  }
  // The same broken CSS through the selector reader, and as a stylesheet for
  // the check.
  try {
    core.inspectStyles(css)
    core.diagnoseStyled(
      '<div class="lt-card lt-button" data-variant="ghost"></div>',
      [css],
      true,
    )
  } catch (e) {
    failures.push(
      `inspectStyles crashed on ${JSON.stringify(css).slice(0, 300)}: ${e}`,
    )
  }
}
for (const [name, { recipe }] of Object.entries(recipes)) {
  for (const broken of [
    { ...(recipe as object), accent: 42 },
    { typography: { fontFamily: ["Arial"] } },
    { shape: { buttonRadius: null } },
    "not an object",
    [],
  ]) {
    count += 1
    try {
      core.buildTheme(broken)
    } catch (e) {
      if (!(e instanceof Error) || /unreachable|RuntimeError/.test(String(e)))
        failures.push(
          `buildTheme crashed on ${name}, ${JSON.stringify(broken)}: ${e}`,
        )
    }
  }
}

// The template languages: every file in `templates/` has markup with template
// syntax, and exactly one deliberate typo. The template syntax must give no
// findings, and the typo must.
const TEMPLATES = join(ROOT, "core/templates")
const THE_TYPO: Record<string, string> = {
  "thymeleaf.html": "unknown-class",
  "jte.kte": "invalid-class-value",
  "go.tmpl": "unknown-class",
  "razor.cshtml": "invalid-class-value",
  "blade.blade.php": "unknown-element",
}
for (const name of readdirSync(TEMPLATES)) {
  count += 1
  const findings = core.diagnoseMarkup(
    readFileSync(join(TEMPLATES, name), "utf8"),
  )
  const rules = findings.map((f) => f.rule).join(", ") || "none"
  if (!(name in THE_TYPO))
    failures.push(`templates/${name}: is not in THE_TYPO in check-core.ts`)
  else if (rules !== THE_TYPO[name])
    failures.push(
      `templates/${name}: expected one finding, ${THE_TYPO[name]}, got ${rules}: ${findings.map((f) => f.message).join(" | ")}`,
    )
}

// 2. The markup in the repository.
const EXTENSIONS = /\.(html|astro|mdx?|ts)$/
const SKIP = new Set([
  "node_modules",
  "dist",
  ".astro",
  "target",
  "build",
  ".gradle",
])
function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name.startsWith(".")) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* files(path)
    else if (EXTENSIONS.test(name)) yield path
  }
}
let repoFiles = 0
for (const dir of [
  "documentation/src",
  "interfaces/src",
  "interfaces/agent",
  "vscode/src",
]) {
  for (const path of files(join(ROOT, dir))) {
    const text = readFileSync(path, "utf8")
    if (!text.includes("<")) continue
    repoFiles += 1
    holds(relative(ROOT, path), text)
  }
}

// 3. Broken markup, with a fixed seed.
let seed = 20261007
const random = (n: number) => {
  seed = (seed * 1103515245 + 12345) % 2 ** 31
  return seed % n
}
const PIECES = [
  "<",
  ">",
  '"',
  "'",
  "=",
  "/",
  " ",
  "\n",
  "lt-",
  "<lt-field>",
  "</lt-field>",
  "<label>",
  "{{",
  "}}",
  "<!--",
  "-->",
  "<script>",
  "&amp;",
  "&#x41;",
  "%C3%B8",
  "#",
  "ø",
  "🧾",
  'class="lt-',
  'aria-describedby="',
  'id="x"',
]
const BROKEN = 4000
for (let n = 0; n < BROKEN; n++) {
  const [name, original] = fixtures[random(fixtures.length)]
  let html = original
  for (let step = 0, times = 1 + random(6); step < times; step++) {
    const at = random(html.length + 1)
    const choice = random(4)
    if (choice === 0)
      html = html.slice(0, at) + PIECES[random(PIECES.length)] + html.slice(at)
    else if (choice === 1)
      html = html.slice(0, at) + html.slice(at + 1 + random(8))
    else if (choice === 2) html = html.slice(0, at)
    else
      html =
        html.slice(at) +
        fixtures[random(fixtures.length)][1].slice(0, random(200))
  }
  holds(
    `broken #${n} from ${name}: ${JSON.stringify(html).slice(0, 300)}`,
    html,
  )
}

/*
 * The core carries no data, and reads nothing outside `core/` when it is
 * built. The vocabulary and the colour contract come in through the two
 * ports, from the host. The first version carried them with `include_str!`,
 * and the build then needed the package's generated files, which needed the
 * core: a ring. Cargo answers for the dependencies, not the text of
 * `Cargo.toml`, so a table or a renamed key cannot hide one.
 */
const CORE = join(ROOT, "core")
if (existsSync(join(CORE, "build.rs")))
  failures.push(
    "core/build.rs exists: the core is built from core/ alone, with no build script",
  )
const rust = [...new Bun.Glob("src/**/*.rs").scanSync(CORE)]
for (const file of rust)
  for (const [i, line] of readFileSync(join(CORE, file), "utf8")
    .split("\n")
    .entries())
    if (/\binclude_(?:str|bytes)!/.test(line))
      failures.push(
        `core/${file}:${i + 1}: ${line.trim()}\n  The core carries no data: the host gives it through load_manifest_raw and load_contract_raw.`,
      )
if (rust.length === 0) failures.push("found no Rust files in core/src")
const metadata = Bun.spawnSync(
  [
    "cargo",
    "metadata",
    "--format-version",
    "1",
    "--no-deps",
    "--manifest-path",
    join(CORE, "Cargo.toml"),
  ],
  { stderr: "pipe" },
)
if (metadata.exitCode !== 0)
  failures.push(`cargo metadata failed: ${metadata.stderr.toString()}`)
else {
  const own = (
    JSON.parse(metadata.stdout.toString()) as {
      packages: Array<{
        name: string
        dependencies: Array<{ name: string; kind: string | null }>
      }>
    }
  ).packages.find((p) => p.name === "lotek-core")
  const normal = (own?.dependencies ?? [])
    .filter((d) => d.kind === null)
    .map((d) => d.name)
    .sort()
  if (JSON.stringify(normal) !== JSON.stringify(["cssparser"]))
    failures.push(
      `lotek-core depends on ${normal.join(", ") || "nothing"}, not on cssparser alone`,
    )
}

console.log(
  `${count} checks: ${fixtures.length} fixtures against the expected results with ${covered.size} of ${RULES.size} rules, ${readdirSync(TEMPLATES).length} templates, ${Object.keys(recipes).length + Object.keys(reports).length} themes and ${BROKEN_THEMES} broken ones, ${repoFiles} files from the repository and ${BROKEN} broken ones, with ${totalFindings} findings in total. The core read for data it carries: ${rust.length} Rust files, its build script and its dependencies.`,
)
if (failures.length > 0) {
  console.error(`\n${failures.length} failures:\n`)
  for (const f of failures.slice(0, 15)) console.error(`${f}\n`)
  process.exit(1)
}
console.log("The core answers what it should on everything.")
