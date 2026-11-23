/**
 * That the theme builder starts from LO-TEK, shows it, and goes back to it.
 *
 * An empty form says nothing about what one is changing from. So a key that
 * is a number has a slider that rests at LO-TEK's own value, a colour
 * family has a picker that rests at LO-TEK's own colour, and "Start again"
 * puts every one of them back. A control that only rests chooses nothing:
 * the recipe is still `{}`, and that is the thing that goes wrong unseen,
 * since a slider standing at 600 looks the same whether the recipe has the
 * weight or not.
 *
 * The values at rest are not written here where the repository states
 * them. The weights and the line heights are read from the descriptions in
 * `theme.schema.json` ("400 if left out"), the corners, the border and the
 * weight of the button from what the component stylesheets fall back to,
 * and the colours from `brands` in the colour contract. The page is held to
 * those, so a slider that rests somewhere LO-TEK does not is found.
 *
 * Run with: bun documentation/scripts/check-theme-resting.ts
 * Requires `documentation/dist` to be built.
 */

import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { site } from "./site"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

if (!existsSync(`${ROOT}documentation/dist/theme-builder/index.html`)) {
  console.error(
    "✗ dist/theme-builder/index.html is not built. The site is built with bun run build.",
  )
  process.exit(1)
}

const { buildTheme } = (await import(
  `${ROOT}interfaces/dist/tokens/theme.js`
)) as { buildTheme(recipe: unknown): { css: string } }
type Schema = { description?: string; properties?: Record<string, Schema> }
const schema = JSON.parse(
  readFileSync(`${ROOT}interfaces/src/tokens/theme.schema.json`, "utf8"),
) as Schema
const contract = JSON.parse(
  readFileSync(`${ROOT}interfaces/src/tokens/color-contract.json`, "utf8"),
) as { families: string[]; brands: Record<string, string> }
const FAMILIES = contract.families
const tokens = readFileSync(`${ROOT}interfaces/src/tokens/tokens.css`, "utf8")
const css = (file: string) =>
  readFileSync(`${ROOT}interfaces/src/components/css/${file}`, "utf8")

const problems: string[] = []

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

/** The value of a token in `tokens.css`, as a number: pixels for a length. */
function token(name: string): number {
  const value = new RegExp(`${name}:\\s*([^;]+);`).exec(tokens)?.[1].trim()
  const number = Number.parseFloat(value ?? "")
  if (Number.isNaN(number)) problems.push(`tokens.css has no ${name}`)
  return value?.endsWith("rem") ? number * 16 : number
}
/** What a stylesheet falls back to when the theme does not set a hook. */
function fallback(file: string, hook: string): number {
  const value = new RegExp(
    `var\\(\\s*${hook}\\s*,\\s*(var\\(\\s*(--lt-[a-z0-9-]+)\\s*\\)|[0-9.]+px)\\s*\\)`,
  ).exec(css(file))
  if (!value) {
    problems.push(`${file} has no fallback for ${hook}`)
    return Number.NaN
  }
  return value[2] ? token(value[2]) : Number.parseFloat(value[1])
}
/** "400 if left out." in the description of a key in the schema. */
function leftOut(group: "weights" | "lineHeights", key: string): number {
  const description =
    schema.properties?.typography?.properties?.[group]?.properties?.[key]
      ?.description ?? ""
  const value = /([0-9.]+) if left out/.exec(description)?.[1]
  if (!value)
    problems.push(`the schema does not say what ${group}.${key} is if left out`)
  return Number.parseFloat(value ?? "")
}

/** A slider: its range, where it rests, and the unit it writes. */
type Slider = {
  min: number
  max: number
  step: number
  rest: number
  unit: string
}
const SLIDERS: Record<string, Slider> = {
  ...Object.fromEntries(
    ["regular", "medium", "semibold", "bold"].map((key) => [
      `typography.weights.${key}`,
      {
        min: 100,
        max: 900,
        step: 100,
        rest: leftOut("weights", key),
        unit: "",
      },
    ]),
  ),
  ...Object.fromEntries(
    ["default", "heading", "article", "compact"].map((key) => [
      `typography.lineHeights.${key}`,
      {
        min: 1,
        max: 2,
        step: 0.05,
        rest: leftOut("lineHeights", key),
        unit: "",
      },
    ]),
  ),
  "shape.buttonRadius": {
    min: 0,
    max: 32,
    step: 1,
    rest: fallback("button/button.css", "--lt-button-radius"),
    unit: "px",
  },
  "shape.fieldRadius": {
    min: 0,
    max: 32,
    step: 1,
    rest: fallback("input/input.css", "--lt-input-radius"),
    unit: "px",
  },
  // Most surfaces have the corner of the alert; the card and the dialog
  // have a larger one of their own.
  "shape.surfaceRadius": {
    min: 0,
    max: 32,
    step: 1,
    rest: fallback("alert/alert.css", "--lt-alert-radius"),
    unit: "px",
  },
  "shape.buttonBorderWidth": {
    min: 0,
    max: 4,
    step: 1,
    rest: fallback("button/button.css", "--lt-button-border-width"),
    unit: "px",
  },
  "shape.buttonFontWeight": {
    min: 100,
    max: 900,
    step: 100,
    rest: fallback("button/button.css", "--lt-button-font-weight"),
    unit: "",
  },
}
/** The keys that are not numbers, and so have no slider. */
const WITHOUT = KEYS.filter((key) => !(key in SLIDERS))
if (
  JSON.stringify(WITHOUT) !==
  JSON.stringify([...FAMILIES, "typography.fontFamily"])
)
  problems.push(
    `the keys without a slider are ${WITHOUT.join(", ")}, and should be the families and the font: the check is older than the schema`,
  )
for (const [key, { rest, min, max }] of Object.entries(SLIDERS))
  if (!(rest >= min && rest <= max))
    problems.push(`${key} rests at ${rest}, outside ${min} to ${max}`)

if (problems.length > 0) {
  console.error(
    `✗ The check cannot read where LO-TEK rests:\n\n${problems.map((p) => `  ${p}`).join("\n")}\n`,
  )
  process.exit(1)
}

const s = await site({ pages: 1 })
const page = s.page
const expect = (claim: boolean, description: string) => {
  if (!claim) s.fail(description)
}
const field = (name: string) => page.locator(`[name="${name}"]`)
const button = (name: string) => page.getByRole("button", { name, exact: true })

/** Runs in the builder. Every control, and what it stands at. */
function read({ families, keys }: { families: string[]; keys: string[] }) {
  const collapsed = (text: string) => text.replace(/\s+/g, " ").trim()
  const control = (name: string) =>
    document.querySelector<HTMLInputElement>(`[name="${name}"]`)
  /** The slider of a field: the one range in the nearest element around the field that has one. */
  const sliderOf = (key: string) => {
    let around = control(key)?.parentElement ?? null
    while (around && !around.querySelector('input[type="range"]'))
      around = around.parentElement
    const ranges = around?.querySelectorAll<HTMLInputElement>(
      'input[type="range"]',
    )
    const fields = around?.querySelectorAll(
      'input[name]:not([role="switch"]), select[name], textarea[name]',
    )
    // A row of its own: one field and one slider, or it is another field's.
    return ranges?.length === 1 && fields?.length === 1 ? ranges[0] : null
  }
  return {
    own: Object.fromEntries(
      families.map((f) => [f, control(`own.${f}`)?.checked ?? false]),
    ),
    fields: Object.fromEntries(
      keys.map((key) => [key, control(key)?.value ?? "(no field)"]),
    ),
    disabled: Object.fromEntries(
      families.map((f) => [f, control(f)?.disabled ?? false]),
    ),
    placeholders: Object.fromEntries(
      families.map((f) => [f, control(f)?.placeholder ?? ""]),
    ),
    pickers: Object.fromEntries(
      families.map((f) => {
        const picker = control(f)
          ?.closest('fieldset, [role="group"]')
          ?.querySelector<HTMLInputElement>('input[type="color"]')
        return [
          f,
          picker ? { value: picker.value, disabled: picker.disabled } : null,
        ]
      }),
    ),
    sliders: Object.fromEntries(
      keys.map((key) => {
        const slider = sliderOf(key)
        const label = collapsed(control(key)?.labels?.[0]?.textContent ?? "")
        return [
          key,
          slider
            ? {
                value: Number(slider.value),
                min: Number(slider.min),
                max: Number(slider.max),
                step: Number(slider.step),
                named: slider.hasAttribute("name"),
                name: collapsed(
                  slider.getAttribute("aria-label") ??
                    slider.labels?.[0]?.textContent ??
                    "",
                ),
                label,
              }
            : null,
        ]
      }),
    ),
    ranges: document.querySelectorAll('input[type="range"]').length,
    recipe: document.querySelector("[data-recipe]")?.textContent ?? "",
  }
}
const now = () => page.evaluate(read, { families: FAMILIES, keys: KEYS })
type State = Awaited<ReturnType<typeof now>>
async function until(done: (state: State) => boolean): Promise<State> {
  let state = await now()
  for (let attempt = 0; attempt < 40 && !done(state); attempt++) {
    await page.waitForTimeout(100)
    state = await now()
  }
  return state
}

/** A recipe as paths and values as text. */
function flat(recipe: unknown, path = ""): [string, string][] {
  return Object.entries(recipe as Record<string, unknown>).flatMap(
    ([name, value]) =>
      value !== null && typeof value === "object"
        ? flat(value, `${path}${name}.`)
        : [[`${path}${name}`, String(value)] as [string, string]],
  )
}
/** The recipe a state shows, as paths and values, or why it could not be read. */
const shown = (state: State) => {
  try {
    return JSON.stringify(flat(JSON.parse(state.recipe)).sort())
  } catch {
    return `not JSON: ${state.recipe.slice(0, 60)}`
  }
}
const recipeOf = (values: Record<string, string>) =>
  JSON.stringify(Object.entries(values).sort())
/** The nested recipe of paths and values, for the package. */
function nested(values: Record<string, string>) {
  const recipe: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(values)) {
    const parts = key.split(".")
    let at = recipe
    for (const part of parts.slice(0, -1)) {
      at[part] ??= {}
      at = at[part] as Record<string, unknown>
    }
    at[parts[parts.length - 1]] = value
  }
  return recipe
}

/** Whether both frames hold this theme, or none when it is `null`. */
async function framesHold(theme: string | null): Promise<boolean> {
  const held = () =>
    Promise.all(
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
  const holds = (frames: string[][]) =>
    frames.every((f) =>
      theme === null ? f.length === 0 : f.length === 1 && f[0] === theme,
    )
  let frames = await held()
  for (let attempt = 0; attempt < 40 && !holds(frames); attempt++) {
    await page.waitForTimeout(100)
    frames = await held()
  }
  return holds(frames)
}

/** What is not at rest, in words. Nothing when the page is LO-TEK's own. */
function away(state: State): string[] {
  return [
    ...FAMILIES.filter((f) => state.own[f]).map(
      (f) => `the switch of ${f} is on`,
    ),
    ...KEYS.filter((k) => state.fields[k] !== "").map(
      (k) => `${k} holds ${JSON.stringify(state.fields[k])}`,
    ),
    ...Object.entries(SLIDERS)
      .filter(([key, { rest }]) => state.sliders[key]?.value !== rest)
      .map(
        ([key, { rest }]) =>
          `the slider of ${key} stands at ${state.sliders[key]?.value ?? "nothing"}, not ${rest}`,
      ),
    ...FAMILIES.filter(
      (f) => state.pickers[f]?.value.toLowerCase() !== contract.brands[f],
    ).map(
      (f) =>
        `the picker of ${f} shows ${state.pickers[f]?.value ?? "nothing"}, not ${contract.brands[f]}`,
    ),
    ...(shown(state) === "[]" ? [] : [`the recipe is ${state.recipe}`]),
  ]
}
const rested = (state: State) => away(state).length === 0

/** Moves a slider with the keyboard, as it can be. */
async function slide(key: string, ...keys: string[]) {
  let around = field(key).locator("xpath=..")
  for (let up = 0; up < 6; up++) {
    if ((await around.locator('input[type="range"]').count()) > 0) break
    around = around.locator("xpath=..")
  }
  const slider = around.locator('input[type="range"]')
  if ((await slider.count()) !== 1) return false
  await slider.focus()
  for (const pressed of keys) await page.keyboard.press(pressed)
  return true
}

let points = 0

const code = await s.run(async () => {
  await s.open("/theme-builder/")
  const first = await until(rested)

  /*
   * A first visit: everything at rest, and nothing chosen.
   */
  for (const finding of away(first)) s.fail(`on a first visit, ${finding}`)
  expect(
    first.ranges === Object.keys(SLIDERS).length,
    `the page has ${first.ranges} sliders, and ${Object.keys(SLIDERS).length} keys are numbers`,
  )
  for (const [key, wanted] of Object.entries(SLIDERS)) {
    const slider = first.sliders[key]
    expect(slider !== null, `${key} has no slider beside its field`)
    if (!slider) continue
    expect(
      slider.min === wanted.min &&
        slider.max === wanted.max &&
        slider.step === wanted.step,
      `the slider of ${key} goes from ${slider.min} to ${slider.max} by ${slider.step}, not from ${wanted.min} to ${wanted.max} by ${wanted.step}`,
    )
    expect(
      !slider.named,
      `the slider of ${key} has a name of its own in the form: the field is the key`,
    )
    expect(
      slider.label !== "" &&
        slider.name.toLowerCase().includes(slider.label.toLowerCase()),
      `the slider of ${key} is called "${slider.name}", which does not have the label of its field, "${slider.label}", in it`,
    )
  }
  for (const key of WITHOUT)
    expect(
      first.sliders[key] === null,
      `${key} has a slider, and is not a number`,
    )
  for (const family of FAMILIES) {
    expect(
      first.pickers[family]?.disabled === false,
      `the picker of ${family} cannot be used while its switch is off`,
    )
    expect(
      first.disabled[family],
      `the field of ${family} can be typed in while its switch is off`,
    )
    expect(
      first.placeholders[family].toLowerCase() === contract.brands[family],
      `the field of ${family} has the placeholder "${first.placeholders[family]}", not LO-TEK's ${contract.brands[family]}`,
    )
  }
  points += 1

  /*
   * A slider that is moved writes its field, and the key is then chosen.
   */
  const moves: [string, string[], string][] = [
    ["typography.weights.bold", ["ArrowLeft"], "600"],
    ["typography.lineHeights.article", ["ArrowRight"], "1.65"],
    ["shape.buttonRadius", ["End"], "32px"],
    ["shape.buttonBorderWidth", ["ArrowRight"], "2px"],
    ["shape.fieldRadius", ["Home"], "0px"],
  ]
  // The expected text is the resting value moved by the keys, worked out
  // here: a step up from 1.6 is 1.65 and not 1.6500000000000001.
  for (const [key, keys, text] of moves) {
    const { rest, step, min, max, unit } = SLIDERS[key]
    const moved = keys.reduce(
      (value, pressed) =>
        pressed === "End"
          ? max
          : pressed === "Home"
            ? min
            : value + (pressed === "ArrowRight" ? step : -step),
      rest,
    )
    if (`${Number(moved.toFixed(2))}${unit}` !== text)
      throw new Error(
        `the check expects ${text} for ${key}, and the keys give ${moved}`,
      )
  }
  const chosen: Record<string, string> = {}
  for (const [key, keys, text] of moves) {
    expect(await slide(key, ...keys), `${key} has no slider to move`)
    chosen[key] = text
    const after = await until(
      (state) =>
        state.fields[key] === text && shown(state) === recipeOf(chosen),
    )
    expect(
      after.fields[key] === text,
      `moving the slider of ${key} wrote ${JSON.stringify(after.fields[key])} in its field, not ${JSON.stringify(text)}`,
    )
    expect(
      shown(after) === recipeOf(chosen),
      `after the slider of ${key} was moved the recipe is ${after.recipe}`,
    )
  }
  expect(
    await framesHold(buildTheme(nested(chosen)).css),
    "the frames do not have the theme of what the sliders chose",
  )
  points += 1

  /*
   * A field that is written moves its slider, when the text is a number
   * the slider can show.
   */
  const written: [string, string, number | "stays" | "rest"][] = [
    ["typography.weights.bold", "300", 300],
    ["shape.fieldRadius", "12px", 12],
    ["shape.fieldRadius", "0", 0],
    ["shape.fieldRadius", "0.5rem", 8],
    ["shape.fieldRadius", "calc(1rem + 2px)", "stays"],
    ["typography.weights.bold", "bold", "stays"],
    ["typography.lineHeights.heading", "1.35", 1.35],
    ["shape.fieldRadius", "", "rest"],
    ["typography.weights.bold", "", "rest"],
  ]
  for (const [key, text, where] of written) {
    const before = (await now()).sliders[key]?.value
    await field(key).fill(text)
    const wanted =
      where === "stays" ? before : where === "rest" ? SLIDERS[key].rest : where
    if (text === "") delete chosen[key]
    else chosen[key] = text
    const after = await until(
      (state) =>
        state.sliders[key]?.value === wanted &&
        shown(state) === recipeOf(chosen),
    )
    expect(
      after.sliders[key]?.value === wanted,
      `with ${JSON.stringify(text)} in ${key} its slider stands at ${after.sliders[key]?.value}, not ${wanted}`,
    )
    expect(
      shown(after) === recipeOf(chosen),
      `with ${JSON.stringify(text)} in ${key} the recipe is ${after.recipe}`,
    )
  }
  points += 1

  /*
   * The picker: LO-TEK's colour until one is picked, and picking one is
   * choosing the family.
   */
  const picker = (family: string) =>
    field(family)
      .locator('xpath=ancestor::*[self::fieldset or @role="group"][1]')
      .locator('input[type="color"]')
  let picked = true
  try {
    await picker("accent").fill("#7c3aed", { timeout: 3000 })
  } catch {
    picked = false
  }
  expect(picked, "a colour cannot be picked for accent while its switch is off")
  chosen.accent = "#7c3aed"
  const afterPick = await until(
    (state) => state.own.accent && state.fields.accent === "#7c3aed",
  )
  expect(
    afterPick.own.accent && afterPick.fields.accent === "#7c3aed",
    `picking a colour for accent left its switch ${afterPick.own.accent ? "on" : "off"} and its field holding ${JSON.stringify(afterPick.fields.accent)}`,
  )
  expect(
    shown(afterPick) === recipeOf(chosen),
    `after a colour was picked the recipe is ${afterPick.recipe}`,
  )
  if (afterPick.own.accent) {
    await field("accent").fill("#0f766e")
    const typed = await until(
      (state) => state.pickers.accent?.value.toLowerCase() === "#0f766e",
    )
    expect(
      typed.pickers.accent?.value.toLowerCase() === "#0f766e",
      `with #0f766e in the field of accent its picker shows ${typed.pickers.accent?.value}`,
    )
    await field("accent").fill("")
    const emptied = await until(
      (state) =>
        state.pickers.accent?.value.toLowerCase() === contract.brands.accent,
    )
    expect(
      emptied.pickers.accent?.value.toLowerCase() === contract.brands.accent,
      `with the field of accent emptied its picker shows ${emptied.pickers.accent?.value}, not LO-TEK's ${contract.brands.accent}`,
    )
    await field("accent").fill("#0f766e")
  }
  points += 1

  /*
   * Start again: everything back to LO-TEK. From controls that were moved,
   * from a pasted recipe, and from what the page remembered.
   */
  const startsAgain = async (from: string) => {
    await button("Start again").click()
    const after = await until(rested)
    for (const finding of away(after))
      s.fail(`after "Start again" ${from}, ${finding}`)
    expect(
      await framesHold(null),
      `after "Start again" ${from}, the frames still hold a theme`,
    )
    points += 1
  }
  await startsAgain("from controls that were moved")

  const pasted = {
    brand1: "#f7df1e",
    typography: { weights: { bold: 800 }, lineHeights: { article: 1.75 } },
    shape: { surfaceRadius: "16px", buttonBorderWidth: "3px" },
  }
  const paste = async () => {
    await page
      .getByRole("textbox", { name: /recipe/i })
      .and(page.locator("textarea"))
      .fill(JSON.stringify(pasted))
    await button("Use this recipe").click()
    return until(
      (state) =>
        state.own.brand1 && state.fields["shape.surfaceRadius"] === "16px",
    )
  }
  const afterPaste = await paste()
  // A pasted recipe moves the sliders and the picker as writing does.
  for (const [key, value] of [
    ["typography.weights.bold", 800],
    ["typography.lineHeights.article", 1.75],
    ["shape.surfaceRadius", 16],
    ["shape.buttonBorderWidth", 3],
  ] as const)
    expect(
      afterPaste.sliders[key]?.value === value,
      `after a pasted recipe the slider of ${key} stands at ${afterPaste.sliders[key]?.value}, not ${value}`,
    )
  expect(
    afterPaste.pickers.brand1?.value.toLowerCase() === "#f7df1e",
    `after a pasted recipe the picker of brand1 shows ${afterPaste.pickers.brand1?.value}`,
  )
  await startsAgain("from a pasted recipe")

  await paste()
  await page.waitForTimeout(300)
  await s.open("/theme-builder/")
  const remembered = await until((state) => state.own.brand1)
  expect(
    remembered.own.brand1 &&
      remembered.sliders["shape.surfaceRadius"]?.value === 16,
    "the page loaded again did not remember what was pasted, so there was nothing to start again from",
  )
  await startsAgain("on a page that remembered")
})

if (code !== 0) {
  console.error(
    "✗ The theme builder does not rest at LO-TEK's own, or does not go back to it, or the check did not get to look.",
  )
  process.exit(code)
}

// The guard comes last: the first visit, the sliders moved, the fields
// written, the picker, and three times started again.
if (points !== 7) {
  console.error(
    `✗ The check went through ${points} points where it has 7. It has not looked at everything.`,
  )
  process.exit(1)
}

console.log(
  `✓ The theme builder rests at LO-TEK's own in ${Object.keys(SLIDERS).length} sliders and ${FAMILIES.length} pickers, chooses nothing until one is moved, and goes back with "Start again" (${points} points).`,
)
