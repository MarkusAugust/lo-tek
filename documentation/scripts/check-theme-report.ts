/**
 * That the theme builder shows what became of each brand colour, to be
 * seen and not only read.
 *
 * The generator takes the hue and the chroma from the colour it is given
 * and the lightness from the role, so a light yellow gives an olive fill.
 * `lotek theme` says so on standard error, and the file says so in a
 * comment. On the page it is a report: a row for each family that was
 * given, with the colour given and the fill it became in the light and in
 * the dark appearance, each as its text and as a swatch painted with it,
 * and the reasons the command gives, which are kept folded until they are
 * asked for: under nine colours they were most of the page.
 *
 * The page writes none of this itself, so the check takes none of it from
 * the page. The colours are those `buildTheme` in the package reports, run
 * here, and the sentences are the ones the command writes for the same
 * recipe, run as a process: a report that words it differently from the
 * command is a second explanation to keep right.
 *
 * Run with: bun documentation/scripts/check-theme-report.ts
 * Requires `documentation/dist` to be built.
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { site } from "./site"
import { ownOn } from "./theme-page"
import { FAMILIES } from "./theme-rest"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

if (!existsSync(`${ROOT}documentation/dist/theme-builder/index.html`)) {
  console.error(
    "✗ dist/theme-builder/index.html is not built. The site is built with bun run build.",
  )
  process.exit(1)
}

type Fill = { fill: string }
const { buildTheme } = (await import(
  `${ROOT}interfaces/dist/tokens/theme.js`
)) as {
  buildTheme(recipe: unknown): {
    brands: { family: string; given: string; light: Fill; dark: Fill }[]
  }
}

const folder = mkdtempSync(join(tmpdir(), "lotek-report-"))
process.on("exit", () => rmSync(folder, { recursive: true, force: true }))

/**
 * What `lotek theme` writes on standard error about each family after its
 * first line, without the indentation: the reasons, sentence by sentence.
 */
function reasons(recipe: Record<string, string>): Record<string, string[]> {
  const file = join(folder, "lotek.theme.json")
  writeFileSync(file, JSON.stringify(recipe))
  const run = Bun.spawnSync(
    ["node", `${ROOT}interfaces/dist/cli.js`, "theme", file],
    {
      env: { ...process.env, LOTEK_PACKAGE: `${ROOT}interfaces/` },
      stdout: "ignore",
      stderr: "pipe",
    },
  )
  if (run.exitCode !== 0)
    throw new Error(`lotek theme exited with ${run.exitCode}: ${run.stderr}`)
  const byFamily: Record<string, string[]> = {}
  let current: string | undefined
  for (const line of run.stderr.toString("utf8").split("\n")) {
    const first = /^([a-z0-9]+): #[0-9a-f]{6} gives the fill /.exec(line)
    if (first) {
      current = first[1]
      byFamily[current] = []
    } else if (line.startsWith("  ") && current)
      byFamily[current].push(line.trim())
  }
  return byFamily
}

/** A colour as the browser writes one. */
function painted(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((at) =>
    Number.parseInt(hex.slice(at, at + 2), 16),
  )
  return `rgb(${r}, ${g}, ${b})`
}

/** What a row must hold, worked out here. */
type Wanted = {
  family: string
  /** The colour given and the two fills, as text and as paint. */
  colours: { text: string; paint: string }[]
  sentences: string[]
}
function wanted(recipe: Record<string, string>): Wanted[] {
  const told = reasons(recipe)
  const rows = buildTheme(recipe).brands.map((brand) => ({
    family: brand.family,
    colours: [brand.given, brand.light.fill, brand.dark.fill].map((hex) => ({
      text: hex,
      paint: painted(hex),
    })),
    sentences: told[brand.family] ?? [],
  }))
  // The command and the package tell of the same families, or the check
  // has read the command wrong.
  if (
    JSON.stringify(Object.keys(told)) !==
    JSON.stringify(rows.map((row) => row.family))
  )
    throw new Error(
      `lotek theme tells of ${Object.keys(told).join(", ")}, and the package of ${rows.map((r) => r.family).join(", ")}`,
    )
  return rows
}

/** Runs in the builder. The rows that can be seen, and what is wrong with them. */
function report({
  rows,
  opened,
  fresh,
}: {
  rows: Wanted[]
  opened: boolean
  /** The families whose reasons are new, and so must not be open yet. */
  fresh: string[]
}) {
  const collapsed = (text: string) => text.replace(/\s+/g, " ").trim()
  const seen = [
    ...document.querySelectorAll<HTMLElement>("[data-family]"),
  ].filter((row) => row.getClientRects().length > 0)
  const wrong: string[] = []
  const families = seen.map((row) => row.dataset.family ?? "")
  if (JSON.stringify(families) !== JSON.stringify(rows.map((r) => r.family)))
    wrong.push(
      `the rows are ${families.join(", ") || "none"}, and the recipe gives ${rows.map((r) => r.family).join(", ") || "none"}`,
    )

  for (const row of seen) {
    const region = row.closest('section, [role="region"]')
    const name =
      region?.getAttribute("aria-label") ??
      document.getElementById(region?.getAttribute("aria-labelledby") ?? "")
        ?.textContent ??
      ""
    if (name.trim() === "")
      wrong.push(`the row of ${row.dataset.family} is in no region with a name`)
  }

  for (const { family, colours, sentences } of rows) {
    const row = seen.find((r) => r.dataset.family === family)
    if (!row) continue
    const text = collapsed(row.textContent ?? "")
    const swatches = [...row.querySelectorAll<HTMLElement>("*")]
      .filter((element) => {
        const { width, height } = element.getBoundingClientRect()
        return width > 0 && height > 0
      })
      .map((element) => getComputedStyle(element).backgroundColor)
    for (const { text: hex, paint } of colours) {
      if (!text.toLowerCase().includes(hex))
        wrong.push(`${family}: the row does not say ${hex}`)
      if (!swatches.includes(paint))
        wrong.push(`${family}: nothing in the row is painted ${hex}`)
    }
    /*
     * The reasons are not in plain sight: one `<details>` when the command
     * has something to say of the colour, and none when it has not. Closed
     * until it is asked for, and its summary says the colour was adjusted.
     */
    const details = [...row.querySelectorAll("details")].filter(
      (d) => d.getClientRects().length > 0,
    )
    if (details.length !== (sentences.length > 0 ? 1 : 0))
      wrong.push(
        `${family}: the row has ${details.length} <details>, and the command has ${sentences.length} sentences about the colour`,
      )
    for (const d of details) {
      if (!opened && d.open && fresh.includes(family))
        wrong.push(
          `${family}: the reasons are open before anyone asked for them`,
        )
      if (!/adjusted/i.test(d.querySelector("summary")?.innerText ?? ""))
        wrong.push(
          `${family}: the summary does not say the colour was adjusted: "${collapsed(d.querySelector("summary")?.textContent ?? "")}"`,
        )
      if (!opened) continue
      // Opened: the command's sentences, word for word, and no other.
      const said = collapsed(d.innerText)
      // Each once, in the order the command gives them, and nothing more:
      // what is left of the reasons when the summary is taken away is the
      // sentences, one after the other.
      const summary = collapsed(d.querySelector("summary")?.innerText ?? "")
      const under = collapsed(
        said.startsWith(summary) ? said.slice(summary.length) : said,
      )
      if (under !== sentences.map(collapsed).join(" "))
        wrong.push(
          `${family}: the reasons are not the command's sentences, each once and in its order: "${under}"`,
        )
      for (const sentence of sentences)
        if (!said.includes(collapsed(sentence)))
          wrong.push(`${family}: the reasons do not say "${sentence}"`)
      for (const kind of [
        "cannot be the fill as it is",
        "less saturated than",
      ]) {
        const count = (in_: string) => in_.split(kind).length - 1
        if (count(said) !== count(sentences.join(" ")))
          wrong.push(
            `${family}: the reasons say "${kind}" ${count(said)} times, and the command ${count(sentences.join(" "))}`,
          )
      }
    }
  }
  return wrong
}

/*
 * The recipes, in the order they are chosen. The first has no reason for
 * light and two for dark, the second three broken promises in light and
 * chroma lost in both, the third several families, given in another order
 * than the report must have them, and the last is the third with one family
 * changed and one switched off.
 */
const STEPS: [string, Record<string, string>][] = [
  ["a colour in the middle", { accent: "#7c3aed" }],
  ["a light colour", { brand1: "#f7df1e" }],
  [
    "several families",
    { danger: "#b91c1c", brand1: "#f7df1e", accent: "#7c3aed" },
  ],
  [
    "one changed and one switched off",
    { danger: "#b91c1c", accent: "#0f766e" },
  ],
]
{
  const first = wanted(STEPS[0][1])[0].sentences
  const second = wanted(STEPS[1][1])[0].sentences
  if (
    first.length !== 2 ||
    !first.every((s) => s.startsWith("In the dark theme")) ||
    second.length !== 3 ||
    !second[0].includes("text on it would have a contrast of")
  ) {
    console.error(
      `✗ lotek theme does not give the reasons the check is written for: ${JSON.stringify([first, second])}. The check is older than the command.`,
    )
    process.exit(1)
  }
}

const s = await site({ pages: 1 })
const page = s.page
let steps = 0
let opened = 0
/** What each family was told in the step before, to know which reasons are new. */
const told: Record<string, string> = {}

const code = await s.run(async () => {
  await s.open("/theme-builder/")
  const own = ownOn(page)

  const holds = async (name: string, recipe: Record<string, string>) => {
    for (const family of FAMILIES) {
      if (family in recipe) {
        await own(family).check()
        await page.locator(`[name="${family}"]`).fill(recipe[family])
      } else await own(family).uncheck()
    }
    const rows = Object.keys(recipe).length === 0 ? [] : wanted(recipe)
    // Reasons that are the same as in the step before may still be open,
    // or closed again: the page is free to do either. New ones are closed.
    const fresh = rows
      .filter((row) => told[row.family] !== row.sentences.join(" "))
      .map((row) => row.family)
    for (const family of Object.keys(told)) delete told[family]
    for (const row of rows) told[row.family] = row.sentences.join(" ")
    let wrong = await page.evaluate(report, { rows, opened: false, fresh })
    for (let attempt = 0; attempt < 50 && wrong.length > 0; attempt++) {
      await page.waitForTimeout(100)
      wrong = await page.evaluate(report, { rows, opened: false, fresh })
    }
    for (const finding of wrong) s.fail(`${name}: ${finding}`)
    // The reasons, asked for as a reader asks, by the summary, where they
    // are not open already.
    for (const { family, sentences } of rows) {
      const details = page.locator(`[data-family="${family}"] details`)
      if (sentences.length === 0 || (await details.count()) !== 1) continue
      if (!(await details.evaluate((d) => (d as HTMLDetailsElement).open)))
        await details.locator("summary").click()
      opened += 1
    }
    if (rows.some((row) => row.sentences.length > 0))
      for (const finding of await page.evaluate(report, {
        rows,
        opened: true,
        fresh,
      }))
        s.fail(`${name}, with the reasons opened: ${finding}`)
    steps += 1
  }

  // Nothing given, nothing to report, whatever the page remembers.
  await holds("with no recipe", {})
  for (const [name, recipe] of STEPS) await holds(name, recipe)
  await holds("with the recipe emptied", {})
})

if (code !== 0) {
  console.error(
    "✗ The theme builder does not report what became of the colours as the package and the command do, or the check did not get to look.",
  )
  process.exit(code)
}

// The guard comes last.
if (steps !== STEPS.length + 2 || opened < 7) {
  console.error(
    `✗ The check went through ${steps} recipes where it has ${STEPS.length + 2}, and opened the reasons of ${opened} colours where the recipes have 7. It has not looked at everything.`,
  )
  process.exit(1)
}

console.log(
  `✓ The theme builder reports each family that was given, with the three colours as text and as paint and the reasons in the command's words, and follows the recipe (${steps} recipes).`,
)
