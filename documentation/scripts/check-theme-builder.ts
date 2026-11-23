/**
 * That the theme builder, `/theme-builder/`, builds the theme the package
 * builds, from what is chosen on it and nothing else.
 *
 * The page is the theme recipe as a form: a control for every key, a recipe
 * shown as JSON, and the theme to download. Three things about it are easy
 * to get subtly wrong, and none of them shows on the page:
 *
 * - The recipe has a key the form has no control for, or the other way
 *   round. The keys are read from `theme.schema.json`, which the core's own
 *   tests hold to the keys the core knows.
 * - The recipe holds more than was chosen. A colour field always has a
 *   value, so every family has a switch, and a family whose switch is off
 *   is LO-TEK's own and not in the recipe.
 * - The theme is not the core's. The file the page offers is compared, byte
 *   for byte, with what `buildTheme` in the package gives for the same
 *   recipe, run here and not in the page.
 *
 * And the page stands on its own: it is a document without the
 * documentation's chrome, it loads Datastar from the site, in the very file
 * LO-TEK is tested against, and asks no other site for anything. The sharing
 * tags are held by `check-share-card.ts`, which takes it for the page it is.
 *
 * The values are typed through the controls, as a person does, and every
 * case starts by switching every family off and emptying every field, so
 * nothing rests on what the page remembers between two visits.
 *
 * Run with: bun documentation/scripts/check-theme-builder.ts
 * Requires `documentation/dist` to be built.
 */

import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { site } from "./site"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const DIST = `${ROOT}documentation/dist/`
const BUILT = `${DIST}theme-builder/index.html`
const DATASTAR = `${ROOT}interfaces/src/testing/datastar/datastar-v1.0.4.js`

/** The theme as the package builds it, in this process. */
const { buildTheme } = (await import(
  `${ROOT}interfaces/dist/tokens/theme.js`
)) as { buildTheme(recipe: unknown): { css: string } }

type Schema = { properties?: Record<string, Schema> }
const schema = JSON.parse(
  readFileSync(`${ROOT}interfaces/src/tokens/theme.schema.json`, "utf8"),
) as Schema
const contract = JSON.parse(
  readFileSync(`${ROOT}interfaces/src/tokens/color-contract.json`, "utf8"),
) as { families: string[] }

/** Every key of the recipe that takes a value, as a path with dots. */
function leaves(at: Schema, path = ""): string[] {
  return Object.entries(at.properties ?? {}).flatMap(([name, property]) =>
    path === "" && name === "$schema"
      ? []
      : property.properties
        ? leaves(property, `${path}${name}.`)
        : [`${path}${name}`],
  )
}
const KEYS = leaves(schema)
/** The first part of every key: a control named so claims to be a key of the recipe. */
const TOPS = new Set(KEYS.map((key) => key.split(".")[0]))
const FAMILIES = contract.families

const problems: string[] = []
if (KEYS.length < 20 || !FAMILIES.every((family) => KEYS.includes(family)))
  problems.push(
    `read ${KEYS.length} keys from theme.schema.json, and not every colour family among them`,
  )

/*
 * The recipes that are tried. The second has every key there is; its
 * colours are the ones the core's expected results use for every family,
 * and no other value in it is LO-TEK's own, which the page takes for a key
 * that is not chosen.
 */
type Recipe = Record<string, string | Record<string, unknown>>
const EVERY_KEY: Recipe = {
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
    weights: { regular: "300", medium: "400", semibold: "500", bold: "800" },
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
}
const RECIPES: [string, Recipe][] = [
  ["one colour", { accent: "#7c3aed" }],
  ["every key", EVERY_KEY],
  ["a light colour", { brand1: "#f7df1e" }],
]

/** A recipe as paths and values, the way it is typed in. */
function flat(recipe: unknown, path = ""): [string, string][] {
  return Object.entries(recipe as Record<string, unknown>).flatMap(
    ([name, value]) =>
      value !== null && typeof value === "object"
        ? flat(value, `${path}${name}.`)
        : [[`${path}${name}`, String(value)] as [string, string]],
  )
}
{
  const typed = flat(EVERY_KEY).map(([key]) => key)
  if (JSON.stringify([...typed].sort()) !== JSON.stringify([...KEYS].sort()))
    problems.push(
      `the recipe with every key has ${typed.length} keys, and the schema has ${KEYS.length}: the check is older than the schema`,
    )
}

/*
 * The document, as built.
 */
if (!existsSync(BUILT)) {
  problems.push(
    "dist/theme-builder/index.html is not built. The page is src/pages/theme-builder/index.astro, and the site is built with bun run build.",
  )
} else {
  const html = readFileSync(BUILT, "utf8")
  if (!/^<!doctype html>/i.test(html.trimStart()))
    problems.push("the page does not start with a doctype")
  for (const mark of [
    "sl-markdown-content",
    "starlight__sidebar",
    "starlight-theme-select",
    "site-search",
    'content="Starlight',
  ])
    if (html.includes(mark))
      problems.push(
        `the page carries the documentation's chrome: ${mark} is in it`,
      )
  const root = /<html\b[^>]*>/i.exec(html)?.[0] ?? ""
  if (!/\slang="en"/.test(root) || !/\sdata-theme="dark"/.test(root))
    problems.push(
      `the page is always dark and in English, and its root element is ${root || "missing"}`,
    )
  for (const tag of ["h1", "main"]) {
    const count = [...html.matchAll(new RegExp(`<${tag}[\\s>]`, "gi"))].length
    if (count !== 1) problems.push(`the page has ${count} <${tag}>, not one`)
  }

  /*
   * Datastar from the site, in the file LO-TEK is tested against. A module
   * script with an address on the site whose file is that file: a copy the
   * build has bundled or minified again is another file, and one from a CDN
   * is a version nobody here has tested, and a visit somebody else can see.
   */
  const vendored = readFileSync(DATASTAR)
  const modules = [...html.matchAll(/<script\b[^>]*>/gi)]
    .map((m) => m[0])
    .filter((tag) => /\stype="module"/.test(tag))
    .flatMap((tag) => /\ssrc="([^"]+)"/.exec(tag)?.[1] ?? [])
  const local = modules.filter(
    (src) => src.startsWith("/") && !src.startsWith("//"),
  )
  if (
    !local.some((src) => {
      const file = `${DIST}${decodeURIComponent(src.split(/[?#]/)[0]).slice(1)}`
      return existsSync(file) && readFileSync(file).equals(vendored)
    })
  )
    problems.push(
      `no <script type="module"> of the page loads interfaces/src/testing/datastar/datastar-v1.0.4.js from the site, byte for byte. Its module scripts: ${modules.join(", ") || "none"}`,
    )
}

if (problems.length > 0) {
  console.error(
    `✗ The theme builder is not the page it should be:\n\n${problems.map((p) => `  ${p}`).join("\n")}\n`,
  )
  process.exit(1)
}

/*
 * The page in a browser.
 */
const s = await site({ pages: 1 })
const page = s.page

// Everything the page asks for, from the first request on.
const asked: string[] = []
page.on("request", (request) => asked.push(request.url()))

const field = (name: string) => page.locator(`[name="${name}"]`)
const own = (family: string) =>
  page.locator(`input[role="switch"][name="own.${family}"]`)

/** The recipe the page shows, or why it could not be read. */
async function shown(): Promise<unknown> {
  const text = (await page.locator("[data-recipe]").textContent()) ?? ""
  try {
    return JSON.parse(text)
  } catch {
    return `not JSON: ${text.slice(0, 80)}`
  }
}

/**
 * The same recipe whether a weight is the number or the text: the form
 * gives text, the theme is the same for both, and which the page writes is
 * its own business.
 */
const comparable = (recipe: unknown) =>
  JSON.stringify(flat(recipe).sort(([a], [b]) => (a < b ? -1 : 1)))

/** Waits until the page shows the recipe, and says whether it came to. */
async function shows(recipe: unknown): Promise<boolean> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const now = await shown()
    if (typeof now !== "string" && comparable(now) === comparable(recipe))
      return true
    await page.waitForTimeout(100)
  }
  return false
}

/** Types a value into a control, or chooses it where the control is a list. */
async function type(name: string, value: string) {
  const control = field(name)
  if ((await control.evaluate((e) => e.tagName)) === "SELECT")
    await control.selectOption(value)
  else await control.fill(value)
}

/** Every family LO-TEK's own again, and every field empty. */
async function cleared() {
  for (const family of FAMILIES) await own(family).uncheck()
  for (const key of KEYS.filter((k) => !FAMILIES.includes(k))) {
    const control = field(key)
    if ((await control.evaluate((e) => e.tagName)) === "SELECT")
      await control.selectOption({ index: 0 })
    else await control.fill("")
  }
}

/** Chooses a recipe on the page, from nothing. */
async function chosen(recipe: Recipe) {
  await cleared()
  for (const [key, value] of flat(recipe)) {
    if (FAMILIES.includes(key)) await own(key).check()
    await type(key, value)
  }
}

/** The file behind the link the page offers, or nothing when there is none to follow. */
async function offered(): Promise<string | null> {
  return page.evaluate(async () => {
    const link = document.querySelector<HTMLAnchorElement>(
      'a[download="theme.css"]',
    )
    const href = link?.getAttribute("href") ?? ""
    if (!link || href === "" || link.getClientRects().length === 0) return null
    if (!/^(data|blob):/.test(href))
      return `not a data: or blob: address: ${href.slice(0, 60)}`
    return (await fetch(href)).text()
  })
}

let themes = 0
let controls = 0

const code = await s.run(async () => {
  const expect = (claim: boolean, description: string) => {
    if (!claim) s.fail(description)
  }
  await s.open("/theme-builder/")

  // A control for every key, and for nothing else.
  const names = await page.evaluate(() =>
    [...document.querySelectorAll("input, select, textarea")].map(
      (control) => control.getAttribute("name") ?? "",
    ),
  )
  for (const key of KEYS) {
    const count = names.filter((name) => name === key).length
    expect(count === 1, `${count} controls are named ${key}, not one`)
    controls += count === 1 ? 1 : 0
  }
  const strangers = names.filter(
    (name) => TOPS.has(name.split(".")[0]) && !KEYS.includes(name),
  )
  expect(
    strangers.length === 0,
    `controls are named as keys the recipe does not have: ${strangers.join(", ")}`,
  )

  // A family is LO-TEK's until its switch says it is yours.
  for (const family of FAMILIES) {
    expect(
      (await own(family).count()) === 1,
      `${family} has no switch named own.${family}`,
    )
    if ((await own(family).count()) !== 1) continue
    expect(
      !(await own(family).isChecked()),
      `the switch of ${family} is on when the page opens`,
    )
    expect(
      await field(family).isDisabled(),
      `the field of ${family} can be typed in while its switch is off`,
    )
  }
  expect(
    await shows({}),
    `the recipe is not {} when the page opens: ${JSON.stringify(await shown())}`,
  )
  expect(
    (await offered()) === null,
    "the page offers a theme to download before anything is chosen",
  )

  // The recipe is what was chosen, and only that.
  await own("accent").check()
  expect(
    !(await field("accent").isDisabled()),
    "the field of accent cannot be typed in while its switch is on",
  )
  await type("accent", "#7c3aed")
  expect(
    await shows({ accent: "#7c3aed" }),
    `a colour that is yours is not the recipe: ${JSON.stringify(await shown())}`,
  )
  await own("accent").uncheck()
  expect(
    await shows({}),
    `a family whose switch is off again is still in the recipe: ${JSON.stringify(await shown())}`,
  )
  expect(
    await field("accent").isDisabled(),
    "the field of accent can be typed in after its switch is off again",
  )
  await type("typography.fontFamily", "Georgia, serif")
  await type("shape.fieldRadius", "0")
  expect(
    await shows({
      typography: { fontFamily: "Georgia, serif" },
      shape: { fieldRadius: "0" },
    }),
    `a font and a corner are not the recipe: ${JSON.stringify(await shown())}`,
  )
  await type("typography.fontFamily", "")
  await type("shape.fieldRadius", "")
  expect(
    await shows({}),
    `fields that are emptied are still in the recipe: ${JSON.stringify(await shown())}`,
  )
  expect(
    (await offered()) === null,
    "the page still offers a theme to download when the recipe is empty again",
  )

  // The theme is the core's.
  for (const [name, recipe] of RECIPES) {
    const expected = buildTheme(recipe).css
    await chosen(recipe)
    expect(
      await shows(recipe),
      `${name}: the page shows another recipe: ${JSON.stringify(await shown())}`,
    )
    let got: string | null = null
    for (let attempt = 0; attempt < 50; attempt++) {
      got = await offered()
      if (got === expected) break
      await page.waitForTimeout(100)
    }
    if (got === expected) {
      themes += 1
      continue
    }
    if (got === null)
      s.fail(`${name}: the page offers no theme.css to download`)
    else {
      const at = [...expected].findIndex((c, i) => got?.[i] !== c)
      s.fail(
        `${name}: the theme the page offers is not the one the package builds. They part at character ${at}: the page has ${JSON.stringify(got.slice(Math.max(0, at - 20), at + 40))}, the package ${JSON.stringify(expected.slice(Math.max(0, at - 20), at + 40))}`,
      )
    }
  }

  // Nobody else is asked for anything, from the first request to the last theme.
  const origin = new URL(page.url()).origin
  const elsewhere = [
    ...new Set(
      asked.filter(
        (url) => /^https?:/.test(url) && new URL(url).origin !== origin,
      ),
    ),
  ]
  expect(
    elsewhere.length === 0,
    `the page asks another site for: ${elsewhere.join(", ")}`,
  )
  expect(asked.length > 0, "the check saw no request of the page at all")
})

if (code !== 0) {
  console.error(
    "✗ The theme builder does not build the package's theme from what is chosen, or the check did not get to look.",
  )
  process.exit(code)
}

// The guard comes last: a run that compared nothing must not pass.
if (themes !== RECIPES.length || controls !== KEYS.length) {
  console.error(
    `✗ The check compared ${themes} themes where it has ${RECIPES.length} recipes, and found ${controls} of ${KEYS.length} controls. It has not looked at everything.`,
  )
  process.exit(1)
}

console.log(
  `✓ The theme builder has a control for each of the ${KEYS.length} keys of the recipe, shows what is chosen and only that, offers the package's own theme for ${themes} recipes, and asks no other site for anything.`,
)
