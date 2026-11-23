/**
 * The promise of the theme builder, held from the outside: the theme you
 * saw is the theme you get.
 *
 * Someone chooses colours on the page, looks at the two frames, copies the
 * recipe into `lotek.theme.json` and runs the command the page shows. What
 * the command writes must be what they were looking at. Every other check
 * of the builder compares the page with the package in this process; this
 * one does what the reader does, with nothing in between: the recipe is the
 * text the page shows, the command is the text the page shows, and it runs
 * as a process in an empty folder.
 *
 * Three things must then be one and the same, byte for byte: the file the
 * command writes with `--out`, the file the page offers to download, and
 * the `<style>` in each of the two frames. What the command prints without
 * `--out` is that file too, with the one line break printing adds. And what
 * the command says about each colour on standard error must be the three
 * colours its row in the report shows.
 *
 * Run with: bun documentation/scripts/check-theme-goal.ts
 * Requires `documentation/dist` to be built.
 */

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { site } from "./site"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

if (!existsSync(`${ROOT}documentation/dist/theme-builder/index.html`)) {
  console.error(
    "✗ dist/theme-builder/index.html is not built. The site is built with bun run build.",
  )
  process.exit(1)
}

const contract = JSON.parse(
  readFileSync(`${ROOT}interfaces/src/tokens/color-contract.json`, "utf8"),
) as { families: string[] }
const FAMILIES = contract.families

/** The package as the command names it, and the same command from this repository. */
const PACKAGED = /^npx @lo-tek\/interfaces@\S+ /
const LOCAL = ["node", `${ROOT}interfaces/dist/cli.js`]

type Recipe = Record<string, string | Record<string, unknown>>
/** A recipe as paths and values, the way it is typed in. */
function flat(recipe: unknown, path = ""): [string, string][] {
  return Object.entries(recipe as Record<string, unknown>).flatMap(
    ([name, value]) =>
      value !== null && typeof value === "object"
        ? flat(value, `${path}${name}.`)
        : [[`${path}${name}`, String(value)] as [string, string]],
  )
}
const comparable = (recipe: unknown) =>
  JSON.stringify(flat(recipe).sort(([a], [b]) => (a < b ? -1 : 1)))

/*
 * The recipes, and how each gets onto the page: typed into the controls, or
 * pasted as a file and used.
 */
const CASES: [string, "typed" | "pasted", Recipe][] = [
  ["one colour", "typed", { accent: "#7c3aed" }],
  [
    "every family with typography and shape",
    "typed",
    {
      accent: "#ff0000",
      visited: "#ff8800",
      brand1: "#ffd600",
      brand2: "#39ff14",
      brand3: "#00bcd4",
      neutral: "#2b2b2b",
      danger: "#ff00ff",
      warning: "#8a5a00",
      success: "#00e676",
      typography: {
        fontFamily: "Georgia, serif",
        weights: {
          regular: "300",
          medium: "400",
          semibold: "500",
          bold: "800",
        },
        lineHeights: {
          default: "1.45",
          heading: "1.1",
          article: "1.7",
          compact: "1.3",
        },
      },
      shape: {
        buttonRadius: "999px",
        fieldRadius: "0",
        surfaceRadius: "calc(0.5rem + 2px)",
        buttonBorderWidth: "2px",
        buttonFontWeight: "600",
      },
    },
  ],
  ["a light colour", "typed", { brand1: "#f7df1e" }],
  [
    "a recipe file that is pasted",
    "pasted",
    {
      danger: "#b91c1c",
      accent: "#0f766e",
      typography: { fontFamily: "Georgia, serif" },
      shape: { fieldRadius: "0" },
    },
  ],
]
if (!FAMILIES.every((family) => family in CASES[1][2])) {
  console.error(
    "✗ The recipe with every family does not have every family of the contract. The check is older than the contract.",
  )
  process.exit(1)
}

const s = await site({ pages: 1 })
const page = s.page
const expect = (claim: boolean, description: string) => {
  if (!claim) s.fail(description)
}
const own = (family: string) =>
  page.locator(`input[role="switch"][name="own.${family}"]`)

/** Runs in the builder. What the reader takes from the page. */
function taken(command: string) {
  const collapsed = (text: string) => text.replace(/\s+/g, " ").trim()
  const link = document.querySelector<HTMLAnchorElement>(
    'a[download="theme.css"]',
  )
  const href = link?.getAttribute("href") ?? ""
  return {
    recipe: document.querySelector("[data-recipe]")?.textContent ?? "",
    /** The command as the page shows it, the first element whose whole text it is. */
    command:
      [...document.querySelectorAll("code, pre, kbd, samp, output, p, span")]
        .map((element) => collapsed(element.textContent ?? ""))
        .find((text) => new RegExp(command).test(text)) ?? "",
    href: link && link.getClientRects().length > 0 ? href : "",
    rows: [...document.querySelectorAll<HTMLElement>("[data-family]")]
      .filter((row) => row.getClientRects().length > 0)
      .map((row) => ({
        family: row.dataset.family ?? "",
        text: collapsed(row.textContent ?? "").toLowerCase(),
        paints: [...row.querySelectorAll<HTMLElement>("*")]
          .filter((element) => {
            const { width, height } = element.getBoundingClientRect()
            return width > 0 && height > 0
          })
          .map((element) => getComputedStyle(element).backgroundColor),
      })),
  }
}
const now = () => page.evaluate(taken, `${PACKAGED.source}theme `)

/** The theme each frame holds. */
async function themes(): Promise<string[][]> {
  return Promise.all(
    ["light", "dark"].map(async (appearance) => {
      const handle = await page
        .locator(`iframe[data-appearance="${appearance}"]`)
        .elementHandle()
      const frame = await handle?.contentFrame()
      if (!frame) return ["(no document)"]
      return frame.evaluate(() =>
        [...document.querySelectorAll("style")]
          .map((style) => style.textContent ?? "")
          .filter((text) => text.includes("lotek-theme")),
      )
    }),
  )
}

/** Where two texts part, for the message. */
function parting(got: string, wanted: string): string {
  const at = [...wanted].findIndex((c, i) => got[i] !== c)
  const from = Math.max(0, (at < 0 ? wanted.length : at) - 20)
  return `they part at character ${at < 0 ? wanted.length : at}: ${JSON.stringify(got.slice(from, from + 60))} against ${JSON.stringify(wanted.slice(from, from + 60))}`
}

/** A colour as the browser writes one. */
function painted(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((at) =>
    Number.parseInt(hex.slice(at, at + 2), 16),
  )
  return `rgb(${r}, ${g}, ${b})`
}

let held = 0

const code = await s.run(async () => {
  await s.open("/theme-builder/")

  for (const [name, how, recipe] of CASES) {
    // Onto the page, from nothing.
    if (how === "pasted") {
      const area = page
        .getByRole("textbox", { name: /recipe/i })
        .and(page.locator("textarea"))
      const use = page.getByRole("button", {
        name: "Use this recipe",
        exact: true,
      })
      expect(
        (await area.count()) === 1 && (await use.count()) === 1,
        `${name}: the page has nowhere to paste a recipe and use it`,
      )
      if ((await area.count()) !== 1 || (await use.count()) !== 1) continue
      await area.fill(JSON.stringify(recipe, null, 2))
      await use.click()
    } else {
      const values = Object.fromEntries(flat(recipe))
      for (const family of FAMILIES)
        if (!(family in values)) await own(family).uncheck()
      for (const key of await page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLInputElement>(
            "input[name]:not([role=switch]), select[name], textarea[name]",
          ),
        ]
          .map((control) => control.name)
          .filter((key) => /^(typography|shape)\./.test(key)),
      ))
        await page.locator(`[name="${key}"]`).fill(values[key] ?? "")
      for (const family of FAMILIES)
        if (family in values) {
          await own(family).check()
          await page.locator(`[name="${family}"]`).fill(values[family])
        }
    }

    // What the reader takes: the recipe and the command, as the page shows them.
    let from = await now()
    const shows = (text: string) => {
      try {
        return comparable(JSON.parse(text)) === comparable(recipe)
      } catch {
        return false
      }
    }
    for (let attempt = 0; attempt < 50; attempt++) {
      if (shows(from.recipe) && from.href !== "" && from.rows.length > 0) break
      await page.waitForTimeout(100)
      from = await now()
    }
    expect(
      shows(from.recipe),
      `${name}: the page shows another recipe: ${from.recipe.slice(0, 200)}`,
    )
    if (!shows(from.recipe)) continue
    expect(
      PACKAGED.test(from.command),
      `${name}: the page shows no command that starts with npx @lo-tek/interfaces@…`,
    )
    if (!PACKAGED.test(from.command)) continue

    // The reader's folder: the recipe as it was shown, under the name the
    // command gives it, and nothing else.
    const folder = mkdtempSync(join(tmpdir(), "lotek-goal-"))
    try {
      const args = from.command.replace(PACKAGED, "").split(" ")
      const file = args.find((arg) => arg.endsWith(".json"))
      const out = args.find((arg) => arg.startsWith("--out="))
      expect(
        args[0] === "theme" && file !== undefined && out !== undefined,
        `${name}: the command on the page is not "theme <file>.json --out=<file>": ${from.command}`,
      )
      if (args[0] !== "theme" || !file || !out) continue
      writeFileSync(join(folder, file), from.recipe)
      const run = (withArgs: string[]) =>
        Bun.spawnSync([...LOCAL, ...withArgs], {
          cwd: folder,
          env: { ...process.env, LOTEK_PACKAGE: `${ROOT}interfaces/` },
          stdout: "pipe",
          stderr: "pipe",
        })

      // Once to standard output, and once as the page writes it, to a file.
      const printed = run(args.filter((arg) => arg !== out))
      const written = run(args)
      expect(
        printed.exitCode === 0 && written.exitCode === 0,
        `${name}: the command exited with ${printed.exitCode} and ${written.exitCode}: ${printed.stderr}${written.stderr}`,
      )
      if (printed.exitCode !== 0 || written.exitCode !== 0) continue
      // The file is the theme. Standard output is the same text, with the
      // line break a line printed on a terminal ends with; the command has
      // always printed it so, and the theme means the same with it.
      const target = join(folder, out.slice("--out=".length))
      expect(
        existsSync(target),
        `${name}: the command wrote no ${out.slice("--out=".length)}`,
      )
      if (!existsSync(target)) continue
      const theme = readFileSync(target, "utf8")
      const print = printed.stdout.toString("utf8")
      expect(
        print === theme || print === `${theme}\n`,
        `${name}: what the command prints is not the file it writes; ${parting(print, theme)}`,
      )
      expect(
        theme.includes("lotek-theme"),
        `${name}: the command wrote no theme`,
      )

      // The file the page offers.
      const offered = await page.evaluate(
        async (href) => (href ? (await fetch(href)).text() : ""),
        from.href,
      )
      expect(
        offered === theme,
        `${name}: the theme.css the page offers is not the one the command writes; ${parting(offered, theme)}`,
      )

      // What the reader was looking at.
      let framed = await themes()
      for (let attempt = 0; attempt < 50; attempt++) {
        if (framed.every((f) => f.length === 1 && f[0] === theme)) break
        await page.waitForTimeout(100)
        framed = await themes()
      }
      framed.forEach((frame, index) => {
        const which = index === 0 ? "light" : "dark"
        expect(
          frame.length === 1,
          `${name}: the ${which} frame has ${frame.length} themes, not one`,
        )
        if (frame.length === 1)
          expect(
            frame[0] === theme,
            `${name}: the ${which} frame does not show the theme the command writes; ${parting(frame[0], theme)}`,
          )
      })

      // What the command says about each colour is what its row shows.
      const said = [
        ...written.stderr
          .toString("utf8")
          .matchAll(
            /^([a-z0-9]+): (#[0-9a-f]{6}) gives the fill (#[0-9a-f]{6}) in the light theme and (#[0-9a-f]{6}) in the dark theme\.$/gm,
          ),
      ]
      const given = flat(recipe)
        .map(([key]) => key)
        .filter((key) => FAMILIES.includes(key))
      expect(
        said.length === given.length,
        `${name}: the command tells of ${said.length} colours, and the recipe gives ${given.length}`,
      )
      expect(
        JSON.stringify(from.rows.map((row) => row.family)) ===
          JSON.stringify(said.map((line) => line[1])),
        `${name}: the report has the rows ${from.rows.map((r) => r.family).join(", ")}, and the command tells of ${said.map((l) => l[1]).join(", ")}`,
      )
      for (const [, family, ...colours] of said) {
        const row = from.rows.find((r) => r.family === family)
        if (!row) continue
        for (const hex of colours) {
          expect(
            row.text.includes(hex),
            `${name}: the row of ${family} does not say ${hex}, which the command does`,
          )
          expect(
            row.paints.includes(painted(hex)),
            `${name}: nothing in the row of ${family} is painted ${hex}`,
          )
        }
      }
      held += 1
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  }
})

if (code !== 0) {
  console.error(
    "✗ The theme the builder shows is not the theme the command writes from the recipe it shows, or the check did not get to look.",
  )
  process.exit(code)
}

// The guard comes last.
if (held !== CASES.length) {
  console.error(
    `✗ The check held ${held} recipes where it has ${CASES.length}. It has not looked at everything.`,
  )
  process.exit(1)
}

console.log(
  `✓ For ${held} recipes, the command the page shows, run on the recipe the page shows, writes the theme the page offers and both frames show, and says of each colour what its row shows.`,
)
