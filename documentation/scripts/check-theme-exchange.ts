/**
 * That a recipe gets out of the theme builder and in again, and that the
 * builder remembers where it was left.
 *
 * The builder is a form, and a form that can only be filled in by hand is
 * one whose work is lost: the recipe has to reach a file in a repository,
 * and a recipe that is already in one has to be looked at again. So the
 * recipe can be copied, a recipe file can be pasted and used, the page
 * shows the command that builds the theme from the file, and what is on
 * the page is still there after it is loaded again.
 *
 * Each of these fails quietly. A copy that puts something else on the
 * clipboard than what is shown, a pasted recipe that leaves a family from
 * before switched on, a paste that is refused without a word, or one that
 * half changes the form before it finds the mistake: none of it is seen
 * until the theme is in use. So the check reads the clipboard back, reads
 * every switch and every field after a paste and not only the ones the
 * recipe names, and reads them again after a paste that was refused.
 *
 * Run with: bun documentation/scripts/check-theme-exchange.ts
 * Requires `documentation/dist` to be built.
 */

import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { site } from "./site"
import { framesHold as holds } from "./theme-page"
import { RESTING } from "./theme-rest"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

if (!existsSync(`${ROOT}documentation/dist/theme-builder/index.html`)) {
  console.error(
    "✗ dist/theme-builder/index.html is not built. The site is built with bun run build.",
  )
  process.exit(1)
}

const { buildTheme, checkRecipe, recipeValues } = (await import(
  `${ROOT}interfaces/dist/tokens/theme.js`
)) as {
  buildTheme(recipe: unknown): { css: string }
  checkRecipe(
    recipe: unknown,
  ): { path: string[]; kind: string; message: string }[]
  recipeValues(recipe: unknown): { path: string[]; text: string }[]
}
const { version } = JSON.parse(
  readFileSync(`${ROOT}interfaces/package.json`, "utf8"),
) as { version: string }
type Schema = { properties?: Record<string, Schema> }
const schema = JSON.parse(
  readFileSync(`${ROOT}interfaces/src/tokens/theme.schema.json`, "utf8"),
) as Schema
const contract = JSON.parse(
  readFileSync(`${ROOT}interfaces/src/tokens/color-contract.json`, "utf8"),
) as { families: string[] }
const FAMILIES = contract.families

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

/** A recipe as paths and values as text, the way a form holds it. */
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

/** The whole form: every switch and every field. */
type Form = { own: Record<string, boolean>; fields: Record<string, string> }
/** The form a recipe gives, and nothing left over from before. */
function formOf(recipe: unknown): Form {
  const values = Object.fromEntries(flat(recipe))
  return {
    own: Object.fromEntries(FAMILIES.map((f) => [f, f in values])),
    // A field the recipe does not name holds LO-TEK's own value, which
    // for a colour is nothing.
    fields: Object.fromEntries(
      KEYS.map((key) => [key, values[key] ?? RESTING[key] ?? ""]),
    ),
  }
}

/*
 * The recipe file that is pasted: with the address of its schema, as an
 * editor wants it, numbers where a file has numbers, and neither the family
 * nor the field that was on the page before. No value in it is LO-TEK's
 * own: the page takes such a key for one that is not chosen.
 */
const PASTED = {
  accent: "#7c3aed",
  danger: "#b91c1c",
  typography: { fontFamily: "Georgia, serif", weights: { bold: 800 } },
  shape: { buttonRadius: "1rem", fieldRadius: 0 },
}
const FILE = JSON.stringify(
  { $schema: "https://lo-tek.sobernetics.no/theme.schema.json", ...PASTED },
  null,
  2,
)
const UNKNOWN = { acent: "#7c3aed", shape: { radius: "0" } }
// A key with a dot in its name, at the top of the recipe, is not the corner
// of the button inside `shape`: it is a key the recipe does not have.
const DOTTED = { "shape.buttonRadius": "4px", accent: "#7c3aed" }

/**
 * What stops a paste, in the core's words and order: every problem that is
 * not a text the core refuses at a key the recipe gives. Such a text is
 * taken into its field and told there; anything else is about the paste.
 * A paste is taken exactly when this is empty.
 */
function stopping(recipe: unknown): string[] {
  const given = recipeValues(recipe).map((value) => JSON.stringify(value.path))
  return checkRecipe(recipe)
    .filter(
      (problem) =>
        !(
          problem.kind === "refused" &&
          given.includes(JSON.stringify(problem.path))
        ),
    )
    .map((problem) => problem.message)
}
/** A recipe as it is pasted, with what must stop it. */
const stopped = (name: string, recipe: unknown): [string, string, string[]] => [
  name,
  JSON.stringify(recipe),
  stopping(recipe),
]

/**
 * What is not taken, and the lines the text area must hold about it: each
 * problem that stops the paste on a line of its own. For text that is not
 * JSON the page has a sentence of its own, since that is about the paste
 * field and not about a recipe.
 */
const NOT_RECIPES: [string, string, string[]][] = [
  ["text that is not JSON", '{"accent": "#7c3aed"', []],
  // JSON, and no recipe: the core says so, and the page shows its sentence.
  stopped("JSON that is a list", ["#7c3aed"]),
  stopped("JSON that is a text", "#7c3aed"),
  stopped("JSON that is null", null),
  // Two unknown keys are two problems, and two lines: one for each key.
  stopped("keys the core does not know", UNKNOWN),
  stopped("a key with a dot in its name", DOTTED),
  // The colour alone would be taken and told at its field. What stops the
  // paste is the corner, and the paste field says that and not the other.
  stopped("a refused text next to a value that is not text", {
    accent: "purple",
    shape: { buttonRadius: true },
  }),
  // A recipe that gives nothing is the empty theme: pasted over a form
  // that holds something, it would empty it without a word.
  stopped("an empty recipe", {}),
  stopped("a recipe with only a family that is 0", { accent: 0 }),
  stopped("a recipe with only its schema", {
    $schema: "https://lo-tek.sobernetics.no/theme.schema.json",
  }),
  stopped("a recipe with only a corner that is null", {
    shape: { buttonRadius: null },
  }),
]
{
  const lines = Object.fromEntries(
    NOT_RECIPES.map(([name, , said]) => [name, said]),
  )
  const wrong = [
    lines["keys the core does not know"].length !== 2 &&
      "two unknown keys are not two problems",
    lines["a key with a dot in its name"].join() !==
      "Unknown key in the recipe: shape.buttonRadius" &&
      "a key with a dot in its name is not one unknown key",
    !lines["JSON that is null"][0]?.startsWith(
      "The recipe is not an object.",
    ) && "null is not answered as no recipe",
    (lines["a refused text next to a value that is not text"].length !== 1 ||
      lines["a refused text next to a value that is not text"][0].includes(
        "purple",
      )) &&
      "the refused colour is among what stops the paste",
    !lines["an empty recipe"][0]?.startsWith("The theme is empty") &&
      "an empty recipe is not the empty theme",
    stopping({ accent: "purple" }).length !== 0 &&
      "a refused colour alone stops a paste",
  ].filter(Boolean)
  if (wrong.length > 0) {
    console.error(
      `✗ The package does not answer as this check is written for: ${wrong.join("; ")}. The check is older than the core.`,
    )
    process.exit(1)
  }
}

const COMMAND = `npx @lo-tek/interfaces@${version} theme lotek.theme.json --out=theme.css`

const s = await site({ pages: 1 })
const page = s.page
const expect = (claim: boolean, description: string) => {
  if (!claim) s.fail(description)
}

// The clipboard is read back, which a page may only do when it is allowed to.
await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
const asked: { url: string; method: string }[] = []
page.on("request", (r) => asked.push({ url: r.url(), method: r.method() }))

const own = (family: string) =>
  page.locator(`input[role="switch"][name="own.${family}"]`)
const field = (name: string) => page.locator(`[name="${name}"]`)
const button = (name: string) => page.getByRole("button", { name, exact: true })
const area = page
  .getByRole("textbox", { name: /recipe/i })
  .and(page.locator("textarea"))

/** Runs in the builder. Every switch, every field, and what else the checks ask about. */
function read({ families, keys }: { families: string[]; keys: string[] }) {
  const collapsed = (text: string) => text.replace(/\s+/g, " ").trim()
  const control = (name: string) =>
    document.querySelector<HTMLInputElement>(`[name="${name}"]`)
  const described = (element: Element | null) =>
    (element?.getAttribute("aria-describedby") ?? "")
      .split(/\s+/)
      .map((id) => (id ? document.getElementById(id) : null))
      .filter((text) => text && text.getClientRects().length > 0)
      .map((text) => collapsed(text?.textContent ?? ""))
      .join(" ")
  const link = document.querySelector<HTMLAnchorElement>(
    'a[download="theme.css"]',
  )
  return {
    form: {
      own: Object.fromEntries(
        families.map((f) => [f, control(`own.${f}`)?.checked ?? false]),
      ),
      fields: Object.fromEntries(
        keys.map((key) => [key, control(key)?.value ?? "(no field)"]),
      ),
    },
    recipe: document.querySelector("[data-recipe]")?.textContent ?? "",
    invalid: keys.filter(
      (key) => control(key)?.getAttribute("aria-invalid") === "true",
    ),
    /** What the text area is told, through `aria-describedby`. */
    told: described(document.querySelector("textarea")),
    /** The same, line by line as it is rendered. */
    toldLines: (
      document.querySelector("textarea")?.getAttribute("aria-describedby") ?? ""
    )
      .split(/\s+/)
      .map((id) => (id ? document.getElementById(id) : null))
      .filter((text) => text && text.getClientRects().length > 0)
      .flatMap((text) => (text as HTMLElement).innerText.split("\n"))
      .map(collapsed)
      .filter((line) => line !== ""),
    statuses: [...document.querySelectorAll('[role="status"]')]
      .filter((status) => status.getClientRects().length > 0)
      .map((status) => collapsed(status.textContent ?? "")),
    offered:
      link !== null &&
      (link.getAttribute("href") ?? "") !== "" &&
      link.getClientRects().length > 0,
    /** Every piece of text on the page that is exactly one element's own. */
    texts: [
      ...document.querySelectorAll("code, pre, kbd, samp, output, p, span"),
    ].map((element) => collapsed(element.textContent ?? "")),
    body: collapsed(document.body.textContent ?? ""),
  }
}
const now = () => page.evaluate(read, { families: FAMILIES, keys: KEYS })
type State = Awaited<ReturnType<typeof now>>

/** Waits for a state of the page, and gives the state it came to. */
async function until(done: (state: State) => boolean): Promise<State> {
  let state = await now()
  for (let attempt = 0; attempt < 50 && !done(state); attempt++) {
    await page.waitForTimeout(100)
    state = await now()
  }
  return state
}
const same = (a: Form, b: Form) => JSON.stringify(a) === JSON.stringify(b)
const collapse = (text: string) => text.replace(/\s+/g, " ").trim()
/** Where two forms part, for the message. */
const parting = (got: Form, wanted: Form) =>
  [
    ...FAMILIES.filter((f) => got.own[f] !== wanted.own[f]).map(
      (f) => `the switch of ${f} is ${got.own[f] ? "on" : "off"}`,
    ),
    ...KEYS.filter((k) => got.fields[k] !== wanted.fields[k]).map(
      (k) =>
        `${k} holds ${JSON.stringify(got.fields[k])}, not ${JSON.stringify(wanted.fields[k])}`,
    ),
  ].join("; ")
const parses = (text: string, recipe: unknown) => {
  try {
    return comparable(JSON.parse(text)) === comparable(recipe)
  } catch {
    return false
  }
}

const framesHold = (css: string | null) => holds(page, css)

/** A button that cannot be used: disabled, or said to be. */
async function unusable(name: string): Promise<boolean> {
  const b = button(name)
  return (
    (await b.count()) === 1 &&
    ((await b.isDisabled()) ||
      (await b.getAttribute("aria-disabled")) === "true")
  )
}

const EMPTY = formOf({})
let points = 0

const code = await s.run(async () => {
  await s.open("/theme-builder/")

  // The first visit is empty: this browser has never seen the page.
  const first = await until((state) => parses(state.recipe, {}))
  expect(
    same(first.form, EMPTY) && parses(first.recipe, {}),
    `on a first visit the page is not empty: ${parting(first.form, EMPTY) || first.recipe}`,
  )
  points += 1

  // The command, with the version the site is built with, which the page
  // also states somewhere else.
  expect(
    first.texts.includes(COMMAND),
    `the page does not show the command as text of its own: ${COMMAND}`,
  )
  expect(
    first.body.split(version).length - 1 >= 2,
    `the page states the version ${version} only where the command has it`,
  )
  points += 1

  // Nothing to copy while there is nothing, or nothing that builds.
  expect(
    await unusable("Copy the recipe"),
    'the button "Copy the recipe" can be used while the recipe is empty, or is not there',
  )
  await own("brand1").check()
  await field("brand1").fill("purple")
  await until((state) => state.invalid.includes("brand1"))
  expect(
    await unusable("Copy the recipe"),
    'the button "Copy the recipe" can be used while the recipe does not build',
  )

  // Something on the page that the pasted recipe does not have.
  await field("brand1").fill("#f7df1e")
  await field("shape.surfaceRadius").fill("4px")
  const before = await until(
    (state) =>
      state.offered &&
      parses(state.recipe, {
        brand1: "#f7df1e",
        shape: { surfaceRadius: "4px" },
      }),
  )

  // Copy: what is shown is what is on the clipboard.
  expect(
    !before.statuses.some((status) => /copied/i.test(status)),
    "the page says the recipe was copied before it was",
  )
  if (
    (await button("Copy the recipe").count()) === 1 &&
    !(await unusable("Copy the recipe"))
  ) {
    await button("Copy the recipe").click()
    const copied = await until((state) =>
      state.statuses.some((status) => /copied/i.test(status)),
    )
    expect(
      copied.statuses.some((status) => /copied/i.test(status)),
      "no status on the page says the recipe was copied",
    )
    const clipboard = await page.evaluate(() => navigator.clipboard.readText())
    expect(
      clipboard === copied.recipe && clipboard.trim() !== "",
      `the clipboard does not hold the recipe as it is shown: ${JSON.stringify(clipboard.slice(0, 120))}`,
    )
  } else
    s.fail(
      'the button "Copy the recipe" cannot be used with a recipe that builds',
    )
  points += 1

  // Paste a recipe file: the form is that recipe, and nothing from before.
  expect(
    (await area.count()) === 1,
    `${await area.count()} text areas are named for taking a recipe, not one`,
  )
  expect(
    (await button("Use this recipe").count()) === 1,
    'the page has no button named "Use this recipe"',
  )
  if (
    (await area.count()) !== 1 ||
    (await button("Use this recipe").count()) !== 1
  )
    throw new Error("the page has nowhere to paste a recipe")
  await area.fill(FILE)
  await button("Use this recipe").click()
  const pasted = await until((state) => same(state.form, formOf(PASTED)))
  expect(
    same(pasted.form, formOf(PASTED)),
    `after a recipe is pasted the form is not that recipe: ${parting(pasted.form, formOf(PASTED))}`,
  )
  expect(
    parses(pasted.recipe, PASTED),
    `after a recipe is pasted the page shows another: ${pasted.recipe}`,
  )
  expect(
    await framesHold(buildTheme(PASTED).css),
    "after a recipe is pasted the frames do not have its theme",
  )
  /** What the text area is told when all is well. */
  const quiet = pasted.told
  points += 1

  // What is not taken changes nothing, and says why: each problem that
  // stops the paste on a line of its own, in the core's order.
  for (const [name, text, lines] of NOT_RECIPES) {
    await area.fill(text)
    await button("Use this recipe").click()
    const after = await until(
      (state) =>
        state.told !== quiet &&
        lines.every((line) => state.toldLines.includes(collapse(line))),
    )
    expect(
      same(after.form, formOf(PASTED)),
      `${name} changed the form: ${parting(after.form, formOf(PASTED))}`,
    )
    expect(
      after.told !== quiet && after.told.trim() !== "",
      `${name}: the text area is not told what is wrong`,
    )
    const at = after.toldLines.indexOf(collapse(lines[0] ?? ""))
    expect(
      lines.length === 0 ||
        (at >= 0 &&
          JSON.stringify(after.toldLines.slice(at, at + lines.length)) ===
            JSON.stringify(lines.map(collapse))),
      `${name}: the text area is told ${JSON.stringify(after.toldLines)}, and what stops the paste is ${JSON.stringify(lines)}, each on a line of its own`,
    )
    // And nothing else the core says of the recipe: what would be taken
    // into a field is not what stopped the paste.
    for (const other of text.startsWith("{") && lines.length > 0
      ? checkRecipe(JSON.parse(text))
          .map((problem) => problem.message)
          .filter((message) => !lines.includes(message))
      : [])
      expect(
        !after.told.includes(collapse(other)),
        `${name}: the text area also says "${other}", which did not stop the paste`,
      )
    // What is JSON and no recipe is told in the core's words only.
    expect(
      !/but not a recipe/i.test(after.told),
      `${name}: the text area is still told in the page's own words: ${JSON.stringify(after.told)}`,
    )
    points += 1
  }

  // A recipe with the right keys and a value the core refuses is taken:
  // the field holds it, and says so, as it does when it is typed.
  const refused = { accent: "purple" }
  await area.fill(JSON.stringify(refused))
  await button("Use this recipe").click()
  const taken = await until(
    (state) => same(state.form, formOf(refused)) && state.invalid.length > 0,
  )
  expect(
    same(taken.form, formOf(refused)),
    `a recipe with a refused value is not taken: ${parting(taken.form, formOf(refused))}`,
  )
  expect(
    JSON.stringify(taken.invalid) === '["accent"]',
    `after a recipe with a refused colour, the fields marked are: ${taken.invalid.join(", ") || "none"}`,
  )
  points += 1

  /*
   * What a pasted recipe puts in the fields is what the core says the
   * recipe gives, and not the page's own reading of it. `0` is not a colour,
   * so a family with `0` is not given: its switch stays off and its field
   * empty, and the rest of the recipe is taken. And a text is a text as it
   * stands: a font that is one blank is a value to the core, so the field
   * holds the blank and the recipe on the page has it.
   */
  for (const [what, pasted, gives] of [
    [
      "a family that is 0",
      { accent: 0, danger: "#b91c1c" },
      { danger: "#b91c1c" },
    ],
    [
      "a number for a weight and 0 for a corner",
      { typography: { weights: { bold: 800 } }, shape: { fieldRadius: 0 } },
      { typography: { weights: { bold: "800" } }, shape: { fieldRadius: "0" } },
    ],
    [
      "a font that is one blank",
      { typography: { fontFamily: " " }, danger: "#b91c1c" },
      { typography: { fontFamily: " " }, danger: "#b91c1c" },
    ],
  ] as const) {
    if (stopping(pasted).length > 0)
      throw new Error(
        `the core stops a recipe with ${what}: ${stopping(pasted)}`,
      )
    await area.fill(JSON.stringify(pasted))
    await button("Use this recipe").click()
    const after = await until(
      (state) =>
        same(state.form, formOf(gives)) &&
        state.told === quiet &&
        parses(state.recipe, gives),
    )
    expect(
      same(after.form, formOf(gives)),
      `after a pasted recipe with ${what}, the form is not what the recipe gives: ${parting(after.form, formOf(gives))}`,
    )
    expect(
      after.told === quiet,
      `a pasted recipe with ${what} is told ${JSON.stringify(after.told)}`,
    )
    expect(
      parses(after.recipe, gives),
      `after a pasted recipe with ${what}, the page shows the recipe ${after.recipe}`,
    )
  }
  points += 1

  // Remembered: the page loaded again is the page that was left.
  await area.fill(FILE)
  await button("Use this recipe").click()
  await until((state) => same(state.form, formOf(PASTED)))
  expect(
    await framesHold(buildTheme(PASTED).css),
    "the frames lost the theme before the page was loaded again",
  )
  await s.open("/theme-builder/")
  const again = await until((state) => same(state.form, formOf(PASTED)))
  expect(
    same(again.form, formOf(PASTED)),
    `the page loaded again is not as it was left: ${parting(again.form, formOf(PASTED))}`,
  )
  expect(
    parses(again.recipe, PASTED),
    `the page loaded again shows another recipe: ${again.recipe}`,
  )
  expect(
    await framesHold(buildTheme(PASTED).css),
    "the page loaded again does not give its frames the theme",
  )
  points += 1

  // Start again: as on a first visit, also after the page is loaded again.
  expect(
    (await button("Start again").count()) === 1,
    'the page has no button named "Start again"',
  )
  if ((await button("Start again").count()) === 1)
    await button("Start again").click()
  const emptied = await until(
    (state) => same(state.form, EMPTY) && parses(state.recipe, {}),
  )
  expect(
    same(emptied.form, EMPTY) && parses(emptied.recipe, {}),
    `after "Start again" the page is not empty: ${parting(emptied.form, EMPTY) || emptied.recipe}`,
  )
  expect(
    await framesHold(null),
    'after "Start again" the frames still hold a theme',
  )
  await s.open("/theme-builder/")
  const fresh = await until(
    (state) => same(state.form, EMPTY) && parses(state.recipe, {}),
  )
  expect(
    same(fresh.form, EMPTY) && parses(fresh.recipe, {}),
    `the page loaded again after "Start again" is not empty: ${parting(fresh.form, EMPTY) || fresh.recipe}`,
  )
  points += 1

  // Remembering is the browser's own: nothing was sent, and nobody else asked.
  const origin = new URL(page.url()).origin
  const sent = asked.filter(
    ({ url, method }) =>
      /^https?:/.test(url) &&
      (new URL(url).origin !== origin || method !== "GET"),
  )
  expect(
    sent.length === 0,
    `the page sends something, or asks another site: ${[...new Set(sent.map((r) => `${r.method} ${r.url}`))].join(", ")}`,
  )
  expect(asked.length > 0, "the check saw no request of the page at all")
})

if (code !== 0) {
  console.error(
    "✗ A recipe does not get out of the theme builder and in again as it should, or the check did not get to look.",
  )
  process.exit(code)
}

// The guard comes last. Eight points of its own, and one for each text
// that is not a recipe: the first visit, the command, the copy, the paste,
// the refused value that is taken, what a recipe gives, the page loaded
// again and the start again.
const POINTS = 8 + NOT_RECIPES.length
if (points !== POINTS) {
  console.error(
    `✗ The check went through ${points} points where it has ${POINTS}. It has not looked at everything.`,
  )
  process.exit(1)
}

console.log(
  `✓ The recipe of the theme builder is copied as it is shown, a recipe file is pasted and used, what is not a recipe is refused with a reason, and the page remembers and starts again (${points} points).`,
)
