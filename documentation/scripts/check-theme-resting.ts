/**
 * That the theme builder starts from LO-TEK, shows it, and goes back to it.
 *
 * An empty form says nothing about what one is changing from. So the fields
 * of typography and shape hold LO-TEK's own value as text where LO-TEK has
 * one, each number has a slider that stands at it, and a colour family has
 * a picker that shows LO-TEK's colour. What stands at rest is not chosen:
 * the recipe is `{}` on a first visit, and a key is in it exactly when its
 * field holds something else than its resting text. That is the thing that
 * goes wrong unseen, since `600` in a field looks the same whether the
 * recipe has the weight or not. So a field that is changed says so, and has
 * a button that puts that one value back.
 *
 * The values at rest are read from where the repository states them, in
 * `theme-rest.ts`, and the page is held to those.
 *
 * Run with: bun documentation/scripts/check-theme-resting.ts
 * Requires `documentation/dist` to be built.
 */

import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { site } from "./site"
import {
  fieldOn,
  flat,
  framesHold as holds,
  nested,
  untilOn,
} from "./theme-page"
import {
  BLOCK_KEYS,
  BRANDS,
  FAMILIES,
  HELP,
  KEYS,
  PAGE_CHOOSES,
  RESTING,
  SLIDERS,
  unread,
} from "./theme-rest"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

if (!existsSync(`${ROOT}documentation/dist/theme-builder/index.html`)) {
  console.error(
    "✗ dist/theme-builder/index.html is not built. The site is built with bun run build.",
  )
  process.exit(1)
}
if (unread.length > 0) {
  console.error(
    `✗ The check cannot read where LO-TEK rests:\n\n${unread.map((p) => `  ${p}`).join("\n")}\n`,
  )
  process.exit(1)
}

/*
 * The page reads where a field rests from the schema's `default`, and not
 * from the prose of a description or a table of its own: a value LO-TEK has
 * when a key is left out is stated once, in the schema. The range of a
 * slider is the page's own business.
 */
{
  const source = readFileSync(
    `${ROOT}documentation/src/pages/theme-builder.astro`,
    "utf8",
  )
  const written = ["if left out", '"0.25rem"', '"1px"'].filter((text) =>
    source.includes(text),
  )
  // What a key says is read from the source the schema is written from.
  // The schema's own prose is for an editor, and the page may link to the
  // file but does not read it for its fields.
  if (/import\b[^;\n]*theme\.schema\.json/.test(source))
    written.push("an import of theme.schema.json")
  if (written.length > 0) {
    console.error(
      `✗ theme-builder.astro writes ${written.join(", ")} itself. Where a field rests is the schema's default for its key.`,
    )
    process.exit(1)
  }
}

const { buildTheme } = (await import(
  `${ROOT}interfaces/dist/tokens/theme.js`
)) as {
  buildTheme(recipe: unknown): { css: string; brands: { given: string }[] }
}

/** The keys that are not numbers, and so have no slider. */
const WITHOUT = KEYS.filter((key) => !(key in SLIDERS))

const s = await site({ pages: 1 })
const page = s.page
const expect = (claim: boolean, description: string) => {
  if (!claim) s.fail(description)
}
const field = fieldOn(page)
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
    blockPlaceholders: Object.fromEntries(
      keys.map((key) => [key, control(key)?.placeholder ?? ""]),
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
                valuetext: slider.getAttribute("aria-valuetext"),
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
    /** The group of each family: whether it says it is changed, and its reset button. */
    groups: Object.fromEntries(
      families.map((family) => {
        const group = control(family)?.closest<HTMLElement>(
          'fieldset, [role="group"]',
        )
        const reset = [...(group?.querySelectorAll("button") ?? [])].find(
          (button) =>
            /^reset/i.test(
              collapsed(
                button.getAttribute("aria-label") ?? button.textContent ?? "",
              ),
            ),
        )
        return [
          family,
          {
            changed: /changed/i.test(group?.innerText ?? ""),
            reset: reset
              ? {
                  name: collapsed(
                    reset.getAttribute("aria-label") ?? reset.textContent ?? "",
                  ),
                  shown:
                    reset.getClientRects().length > 0 &&
                    getComputedStyle(reset).visibility !== "hidden",
                  width: reset.getBoundingClientRect().width,
                  height: reset.getBoundingClientRect().height,
                }
              : null,
          },
        ]
      }),
    ),
    /** The families the report has a row for. */
    rows: [...document.querySelectorAll<HTMLElement>("[data-family]")]
      .filter((row) => row.getClientRects().length > 0)
      .map((row) => row.dataset.family ?? ""),
    /** The block of each field: whether it says it is changed, its reset button, its help. */
    blocks: Object.fromEntries(
      keys.map((key) => {
        const field = control(key)
        let block = field?.parentElement ?? null
        const fieldsIn = (element: Element) =>
          element.querySelectorAll(
            'input[name]:not([role="switch"]), select[name], textarea[name]',
          ).length
        // The nearest element that holds this field and no other.
        while (block?.parentElement && fieldsIn(block.parentElement) === 1)
          block = block.parentElement
        const reset = [...(block?.querySelectorAll("button") ?? [])].find(
          (button) =>
            /^reset/i.test(
              collapsed(
                button.getAttribute("aria-label") ?? button.textContent ?? "",
              ),
            ),
        )
        return [
          key,
          {
            changed: /changed/i.test(block?.innerText ?? ""),
            reset: reset
              ? {
                  name: collapsed(
                    reset.getAttribute("aria-label") ?? reset.textContent ?? "",
                  ),
                  shown:
                    reset.getClientRects().length > 0 &&
                    getComputedStyle(reset).visibility !== "hidden",
                  width: reset.getBoundingClientRect().width,
                  height: reset.getBoundingClientRect().height,
                }
              : null,
            label: collapsed(field?.labels?.[0]?.textContent ?? ""),
            help: collapsed(
              (field?.getAttribute("aria-describedby") ?? "")
                .split(/\s+/)
                .map((id) => document.getElementById(id)?.textContent ?? "")
                .join(" "),
            ),
          },
        ]
      }),
    ),
    ranges: document.querySelectorAll('input[type="range"]').length,
    /** Where the keyboard is: the name of the control, or its tag. */
    active:
      document.activeElement?.getAttribute("name") ??
      document.activeElement?.tagName.toLowerCase() ??
      "",
    recipe: document.querySelector("[data-recipe]")?.textContent ?? "",
  }
}
const now = () => page.evaluate(read, { families: FAMILIES, keys: KEYS })
type State = Awaited<ReturnType<typeof now>>
const until = (done: (state: State) => boolean): Promise<State> =>
  untilOn(page, now, done)

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
const framesHold = (css: string | null) => holds(page, css)

/** The text a field rests at: LO-TEK's own, and nothing for a colour. */
const rest = (key: string) => RESTING[key] ?? ""

/** What is not at rest, in words. Nothing when the page is LO-TEK's own. */
function away(state: State): string[] {
  return [
    ...FAMILIES.filter((f) => state.own[f]).map(
      (f) => `the switch of ${f} is on`,
    ),
    ...KEYS.filter((k) => state.fields[k] !== rest(k)).map(
      (k) =>
        `${k} holds ${JSON.stringify(state.fields[k])}, not ${JSON.stringify(rest(k))}`,
    ),
    ...Object.entries(SLIDERS)
      .filter(([key, slider]) => state.sliders[key]?.value !== slider.rest)
      .map(
        ([key, slider]) =>
          `the slider of ${key} stands at ${state.sliders[key]?.value ?? "nothing"}, not ${slider.rest}`,
      ),
    ...FAMILIES.filter(
      (f) => state.pickers[f]?.value.toLowerCase() !== BRANDS[f],
    ).map(
      (f) =>
        `the picker of ${f} shows ${state.pickers[f]?.value ?? "nothing"}, not ${BRANDS[f]}`,
    ),
    ...BLOCK_KEYS.filter((k) => state.blocks[k].changed).map(
      (k) => `${k} says it is changed`,
    ),
    ...BLOCK_KEYS.filter((k) => state.blocks[k].reset?.shown).map(
      (k) => `${k} has a button to reset it`,
    ),
    ...FAMILIES.filter((f) => state.groups[f].changed).map(
      (f) => `the family ${f} says it is changed`,
    ),
    ...FAMILIES.filter((f) => state.groups[f].reset?.shown).map(
      (f) => `the family ${f} has a button to reset it`,
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
  // Where the two sliders without a default stand is the page's choice:
  // read off the page, held to the slider's range, and from here on what
  // "at rest" means for them.
  const arrival = await now()
  for (const key of PAGE_CHOOSES) {
    const stands = arrival.sliders[key]?.value ?? Number.NaN
    expect(
      stands >= SLIDERS[key].min && stands <= SLIDERS[key].max,
      `the slider of ${key} stands at ${stands} on arrival, outside ${SLIDERS[key].min} to ${SLIDERS[key].max}`,
    )
    SLIDERS[key].rest = Number.isNaN(stands) ? SLIDERS[key].min : stands
  }
  const first = await until(rested)

  /*
   * A first visit: every field at LO-TEK's own, and nothing chosen.
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
  // The help under a field is what the source of the schema says the key
  // is for, exactly, and for a key of typography or shape without a default
  // also what holds when it is left out. The page takes no sentence apart.
  for (const key of KEYS) {
    const wanted = (HELP[key] ?? "").replace(/\s+/g, " ").trim()
    expect(
      wanted !== "" && first.blocks[key].help === wanted,
      `the help of ${key} is "${first.blocks[key].help}", and the source of the schema has "${wanted}"`,
    )
    if (key.includes(".") && rest(key) === "")
      expect(
        first.blockPlaceholders[key] === "",
        `${key} rests empty and has the placeholder "${first.blockPlaceholders[key]}": what holds when it is left out is in its description`,
      )
  }
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
      first.placeholders[family].toLowerCase() === BRANDS[family],
      `the field of ${family} has the placeholder "${first.placeholders[family]}", not LO-TEK's ${BRANDS[family]}`,
    )
  }
  points += 1

  /** The recipe that is chosen so far, as paths and values. */
  const chosen: Record<string, string> = {}
  /** What a slider says its value is, held to the slider: pixels say so. */
  const spoken = (what: string, key: string, state: State) => {
    const slider = state.sliders[key]
    if (!slider) return
    if (SLIDERS[key].unit === "px") {
      const said = /^(\d+(?:\.\d+)?) ?(?:px|pixels)$/.exec(
        slider.valuetext ?? "",
      )
      expect(
        said !== null && Number(said[1]) === slider.value,
        `${what}: the slider of ${key} stands at ${slider.value} and says "${slider.valuetext ?? ""}", not the number in pixels`,
      )
    } else
      expect(
        slider.valuetext === null || Number(slider.valuetext) === slider.value,
        `${what}: the slider of ${key} has no unit, and says "${slider.valuetext}"`,
      )
  }
  /** A button that is shown can be hit: 24 by 24 CSS pixels at least. */
  const hittable = (
    what: string,
    button:
      | { shown: boolean; width: number; height: number }
      | null
      | undefined,
  ) => {
    if (button?.shown)
      expect(
        button.width >= 24 && button.height >= 24,
        `${what}: the reset button is ${Math.round(button.width)} by ${Math.round(button.height)} pixels, under 24 by 24`,
      )
  }
  /**
   * Holds one field after something was done to it: what it holds, where
   * its slider stands and what the slider says, and whether it is in the
   * recipe. It says it is changed exactly when it is in the recipe, and has
   * a button to reset it whenever it does not hold its resting text, so an
   * emptied field, which is out of the recipe, can still be put back.
   */
  const holds = async (
    what: string,
    key: string,
    text: string,
    slider: number | undefined,
  ) => {
    // The text as it stands: a blank is a text, and the core is the one to
    // say what it makes of it.
    const inRecipe = text !== rest(key) && text !== ""
    const away = text !== rest(key)
    if (inRecipe) chosen[key] = text
    else delete chosen[key]
    const after = await until(
      (state) =>
        state.fields[key] === text &&
        shown(state) === recipeOf(chosen) &&
        state.blocks[key].changed === inRecipe &&
        (state.blocks[key].reset?.shown ?? false) === away,
    )
    expect(
      after.fields[key] === text,
      `${what}: ${key} holds ${JSON.stringify(after.fields[key])}, not ${JSON.stringify(text)}`,
    )
    if (slider !== undefined)
      expect(
        after.sliders[key]?.value === slider,
        `${what}: the slider of ${key} stands at ${after.sliders[key]?.value}, not ${slider}`,
      )
    spoken(what, key, after)
    expect(
      shown(after) === recipeOf(chosen),
      `${what}: the recipe is ${after.recipe}, and what is changed is ${JSON.stringify(chosen)}`,
    )
    expect(
      after.blocks[key].changed === inRecipe,
      `${what}: ${key} ${inRecipe ? "does not say" : "says"} it is changed, and it is ${inRecipe ? "" : "not "}in the recipe`,
    )
    const reset = after.blocks[key].reset
    expect(
      (reset?.shown ?? false) === away,
      `${what}: ${key} ${away ? "has no" : "has a"} button to reset it`,
    )
    hittable(`${what}, ${key}`, reset)
    if (away && reset?.shown)
      expect(
        reset.name
          .toLowerCase()
          .includes(after.blocks[key].label.toLowerCase()),
        `${what}: the reset button of ${key} is called "${reset.name}", which does not name "${after.blocks[key].label}"`,
      )
    return after
  }
  /**
   * Presses the reset button of a field, with the keyboard, and holds that
   * the keyboard is then on the field: a button that goes away under the
   * one who pressed it leaves them nowhere.
   */
  const reset = async (key: string) => {
    let block = field(key).locator("xpath=..")
    for (let up = 0; up < 6; up++) {
      if ((await block.getByRole("button", { name: /^reset/i }).count()) > 0)
        break
      block = block.locator("xpath=..")
    }
    const button = block.getByRole("button", { name: /^reset/i })
    if ((await button.count()) !== 1) return false
    await button.focus()
    await page.keyboard.press("Enter")
    const after = await until((state) => state.active === key)
    expect(
      after.active === key,
      `after ${key} was reset by keyboard, the keyboard is on ${after.active || "nothing"} and not on its field`,
    )
    return true
  }

  /*
   * Written by hand: another value is changed and in the recipe, the
   * resting text written again is at rest, and an emptied field is out of
   * the recipe, and so not changed, but can be put back.
   */
  const bold = "typography.weights.bold"
  await field(bold).fill("800")
  await holds("800 written", bold, "800", 800)
  await field(bold).fill(rest(bold))
  await holds(
    "the resting text written again",
    bold,
    rest(bold),
    SLIDERS[bold].rest,
  )
  await field(bold).fill("")
  await holds("the field emptied", bold, "", SLIDERS[bold].rest)
  expect(
    await reset(bold),
    `${bold} has no reset button to press while it is empty`,
  )
  await holds("an emptied field reset", bold, rest(bold), SLIDERS[bold].rest)
  // A text the slider cannot show is the value, and the slider stays.
  const fieldRadius = "shape.fieldRadius"
  await field(fieldRadius).fill("12px")
  await holds("12px written", fieldRadius, "12px", 12)
  await field(fieldRadius).fill("0.5rem")
  await holds("0.5rem written", fieldRadius, "0.5rem", 8)
  await field(fieldRadius).fill("calc(1rem + 2px)")
  await holds("a calculation written", fieldRadius, "calc(1rem + 2px)", 8)
  await field(fieldRadius).fill("0")
  await holds("0 written", fieldRadius, "0", 0)
  // The page has no reading of its own of what is given: the text counts as
  // it stands. A resting value with blanks around it is another text, and
  // a font that is one blank is a value, which the core takes.
  const regular = "typography.weights.regular"
  await field(regular).fill(` ${rest(regular)} `)
  await holds(
    "the resting text with blanks around it",
    regular,
    ` ${rest(regular)} `,
    undefined,
  )
  await field(regular).fill(rest(regular))
  await holds(
    "the resting text again",
    regular,
    rest(regular),
    SLIDERS[regular].rest,
  )
  await field("typography.fontFamily").fill(" ")
  await holds(
    "a font that is one blank",
    "typography.fontFamily",
    " ",
    undefined,
  )
  await field("typography.fontFamily").fill("")
  await holds("the font emptied", "typography.fontFamily", "", undefined)
  points += 1

  /*
   * The sliders, moved with the keyboard. One that is moved back to where
   * it rests is at rest: the field holds its resting text again, `0.25rem`
   * for a corner and not the `4px` the slider would write anywhere else.
   */
  expect(await slide(bold, "ArrowLeft"), `${bold} has no slider to move`)
  await holds("the slider moved a step down", bold, "600", 600)
  await slide(bold, "ArrowRight")
  await holds("the slider moved back", bold, rest(bold), SLIDERS[bold].rest)
  const article = "typography.lineHeights.article"
  await slide(article, "ArrowRight")
  // A step up from 1.6 is 1.65, and not 1.6500000000000001.
  await holds("a line height moved a step up", article, "1.65", 1.65)
  const buttonRadius = "shape.buttonRadius"
  await slide(buttonRadius, "End")
  await holds("a corner moved to the end", buttonRadius, "32px", 32)
  await slide(buttonRadius, "Home")
  await holds("a corner moved to the start", buttonRadius, "0px", 0)
  for (const key of [
    buttonRadius,
    "shape.fieldRadius",
    "shape.buttonBorderWidth",
  ]) {
    await slide(key, "Home")
    for (let step = 0; step < SLIDERS[key].rest; step++)
      await slide(key, "ArrowRight")
    await holds(
      "a slider moved away and back to where it rests",
      key,
      rest(key),
      SLIDERS[key].rest,
    )
  }
  // Where the field rests empty there is no resting text to go back to:
  // the slider at its resting number is a choice, and is written.
  for (const [key, text] of [
    ["shape.surfaceRadius", `${SLIDERS["shape.surfaceRadius"].rest}px`],
    ["shape.buttonFontWeight", `${SLIDERS["shape.buttonFontWeight"].rest}`],
  ] as const) {
    await slide(key, "ArrowRight")
    await slide(key, "ArrowLeft")
    await holds(
      "a slider without a resting text moved away and back",
      key,
      text,
      SLIDERS[key].rest,
    )
  }
  await slide(buttonRadius, "End")
  await holds("a corner moved to the end again", buttonRadius, "32px", 32)
  points += 1

  /*
   * The three fields that rest empty: written is changed, reset is empty.
   */
  for (const [key, text, slider] of [
    ["typography.fontFamily", "Georgia, serif", undefined],
    ["shape.surfaceRadius", "0.5rem", 8],
    ["shape.buttonFontWeight", "700", 700],
  ] as const) {
    expect(rest(key) === "", `${key} was expected to rest empty`)
    await field(key).fill(text)
    await holds(`${text} written`, key, text, slider)
  }
  expect(
    await framesHold(buildTheme(nested(chosen)).css),
    "the frames do not have the theme of what is changed, and of that only",
  )

  /*
   * Reset of one value: that field back to rest, and every other as it was.
   */
  const before = await now()
  for (const key of [buttonRadius, article, "shape.surfaceRadius"]) {
    expect(await reset(key), `${key} has no reset button to press`)
    await holds("reset", key, rest(key), SLIDERS[key].rest)
  }
  const after = await now()
  const touched = KEYS.filter(
    (key) =>
      ![buttonRadius, article, "shape.surfaceRadius"].includes(key) &&
      after.fields[key] !== before.fields[key],
  )
  expect(
    touched.length === 0,
    `resetting three values changed others too: ${touched.join(", ")}`,
  )
  expect(
    await framesHold(buildTheme(nested(chosen)).css),
    "the frames do not have the theme of what is left after three values were reset",
  )
  points += 1

  /*
   * The picker: LO-TEK's colour until one is picked, and picking one is
   * choosing the family.
   */
  const picker = (family: string) =>
    field(family)
      .locator('xpath=ancestor::*[self::fieldset or @role="group"][1]')
      .locator('input[type="color"]')
  await picker("accent").fill("#7c3aed", { timeout: 3000 })
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
  // A family that is in the recipe says so, and can be put back.
  expect(
    afterPick.groups.accent.changed &&
      afterPick.groups.accent.reset?.shown === true,
    "a family with a colour of its own does not say it is changed, or has no button to reset it",
  )
  expect(
    /accent/i.test(afterPick.groups.accent.reset?.name ?? ""),
    `the reset button of accent is called "${afterPick.groups.accent.reset?.name ?? ""}"`,
  )
  hittable("accent", afterPick.groups.accent.reset)

  /*
   * The picker shows the colour as the core reads it: a short form, capital
   * letters, a missing hash and blanks around it are all a colour to the
   * core, and the picker shows the one it made. What the core refuses
   * leaves the picker where it was.
   */
  let showing = "#7c3aed"
  for (const typed of [
    "#f0a",
    "#F0A",
    "F7DF1E",
    " #7C3AED ",
    "purple",
    "#0f7",
  ]) {
    await field("accent").fill(typed)
    try {
      showing = buildTheme({ accent: typed }).brands[0].given
    } catch {
      // Refused: the picker keeps what it showed.
    }
    const state = await until(
      (now) => now.pickers.accent?.value.toLowerCase() === showing,
    )
    expect(
      state.pickers.accent?.value.toLowerCase() === showing,
      `with ${JSON.stringify(typed)} in the field of accent its picker shows ${state.pickers.accent?.value}, not ${showing}`,
    )
  }
  await field("accent").fill("")
  const emptied = await until(
    (state) => state.pickers.accent?.value.toLowerCase() === BRANDS.accent,
  )
  expect(
    emptied.pickers.accent?.value.toLowerCase() === BRANDS.accent,
    `with the field of accent emptied its picker shows ${emptied.pickers.accent?.value}, not LO-TEK's ${BRANDS.accent}`,
  )
  // The switch on with nothing in the field is not in the recipe, so it
  // is not marked, but it is not at rest either, and can be put back.
  expect(
    emptied.own.accent &&
      !emptied.groups.accent.changed &&
      emptied.groups.accent.reset?.shown === true,
    `a family whose switch is on and whose field is empty ${emptied.groups.accent.changed ? "says it is changed" : "is not marked"}, and ${emptied.groups.accent.reset?.shown ? "has" : "has no"} button to reset it`,
  )
  // Blanks are a text: the family is in the recipe with them, as they
  // stand, it says it is changed, and the core's answer is at the field.
  await field("accent").fill("  ")
  chosen.accent = "  "
  const blank = await until(
    (state) => state.groups.accent.changed && shown(state) === recipeOf(chosen),
  )
  expect(
    blank.groups.accent.changed && shown(blank) === recipeOf(chosen),
    `a family whose field holds blanks ${blank.groups.accent.changed ? "says" : "does not say"} it is changed, and the recipe is ${blank.recipe}`,
  )
  delete chosen.accent
  points += 1

  /*
   * Switching a family off puts it back: the field empty and the picker at
   * LO-TEK's colour, and so it is when the switch goes on again.
   */
  /** Holds that a family is at rest, with its switch as given. */
  const familyRests = async (what: string, family: string, on: boolean) => {
    const state = await until(
      (now) =>
        now.own[family] === on &&
        now.fields[family] === "" &&
        now.pickers[family]?.value.toLowerCase() === BRANDS[family] &&
        !now.groups[family].changed &&
        (now.groups[family].reset?.shown ?? false) === on &&
        !now.rows.includes(family),
    )
    expect(
      state.own[family] === on,
      `${what}: the switch of ${family} is ${state.own[family] ? "on" : "off"}`,
    )
    expect(
      state.fields[family] === "",
      `${what}: the field of ${family} still holds ${JSON.stringify(state.fields[family])}`,
    )
    expect(
      state.pickers[family]?.value.toLowerCase() === BRANDS[family],
      `${what}: the picker of ${family} shows ${state.pickers[family]?.value}, not LO-TEK's ${BRANDS[family]}`,
    )
    expect(
      !state.groups[family].changed &&
        (state.groups[family].reset?.shown ?? false) === on,
      `${what}: ${family} ${state.groups[family].changed ? "says" : "does not say"} it is changed, and ${state.groups[family].reset?.shown ? "has" : "has no"} button to reset it`,
    )
    expect(
      !state.rows.includes(family) && shown(state) === recipeOf(chosen),
      `${what}: ${family} is still in the report or the recipe: ${state.recipe}`,
    )
  }
  await field("accent").fill("#7c3aed")
  await until((state) => state.rows.includes("accent"))
  delete chosen.accent
  await page.locator('input[role="switch"][name="own.accent"]').uncheck()
  await familyRests("the switch of accent turned off", "accent", false)
  await page.locator('input[role="switch"][name="own.accent"]').check()
  await familyRests("the switch of accent turned on again", "accent", true)
  await page.locator('input[role="switch"][name="own.accent"]').uncheck()

  // The reset button of a family does the same from a colour that was given.
  await picker("visited").fill("#9f1239", { timeout: 3000 })
  const given = await until(
    (state) =>
      state.rows.includes("visited") &&
      state.groups.visited.reset?.shown === true,
  )
  expect(
    given.groups.visited.reset?.shown === true,
    "visited has no reset button to press after a colour was picked for it",
  )
  hittable("visited", given.groups.visited.reset)
  if (given.groups.visited.reset?.shown) {
    await field("visited")
      .locator('xpath=ancestor::*[self::fieldset or @role="group"][1]')
      .getByRole("button", { name: /^reset/i })
      .focus()
    await page.keyboard.press("Enter")
  }
  await familyRests("visited reset", "visited", false)
  // Its field is disabled now, so the keyboard is on its switch.
  const afterReset = await until((state) => state.active === "own.visited")
  expect(
    afterReset.active === "own.visited",
    `after visited was reset by keyboard, the keyboard is on ${afterReset.active || "nothing"} and not on its switch`,
  )
  points += 1

  // Something chosen again, to be remembered below.
  await picker("accent").fill("#0f766e", { timeout: 3000 })
  chosen.accent = "#0f766e"
  await until((state) => state.fields.accent === "#0f766e")

  /*
   * What is remembered comes back as it was: the changed, the emptied and
   * the rest.
   */
  await field("typography.weights.medium").fill("")
  await until(
    (state) => state.blocks["typography.weights.medium"].reset?.shown === true,
  )
  await page.waitForTimeout(300)
  const left = await now()
  await s.open("/theme-builder/")
  const back = await until(
    (state) => JSON.stringify(state.fields) === JSON.stringify(left.fields),
  )
  const differing = KEYS.filter((key) => back.fields[key] !== left.fields[key])
  expect(
    differing.length === 0 &&
      JSON.stringify(back.own) === JSON.stringify(left.own),
    `the page loaded again is not as it was left: ${differing.map((k) => `${k} holds ${JSON.stringify(back.fields[k])}, not ${JSON.stringify(left.fields[k])}`).join("; ")}`,
  )
  expect(
    !back.blocks["typography.weights.medium"].changed &&
      back.blocks["typography.weights.medium"].reset?.shown === true &&
      back.blocks["typography.fontFamily"].changed &&
      !back.blocks[bold].changed,
    "the page loaded again does not say of the same fields that they are changed, or can be reset",
  )
  expect(
    shown(back) === shown(left),
    `the page loaded again shows the recipe ${back.recipe}`,
  )
  points += 1

  /*
   * Start again: everything back to LO-TEK. From what was changed and
   * remembered, and from a pasted recipe.
   */
  const startsAgain = async (from: string) => {
    await button("Start again").click()
    const state = await until(rested)
    for (const finding of away(state))
      s.fail(`after "Start again" ${from}, ${finding}`)
    expect(
      await framesHold(null),
      `after "Start again" ${from}, the frames still hold a theme`,
    )
    points += 1
  }
  await startsAgain("on a page that remembered")

  // A pasted recipe sets the fields it names and puts the others at rest.
  await field("shape.fieldRadius").fill("12px")
  await field("typography.fontFamily").fill("Georgia, serif")
  const pasted = {
    brand1: "#f7df1e",
    typography: { weights: { bold: 800 }, lineHeights: { article: 1.75 } },
    shape: { surfaceRadius: "16px", buttonBorderWidth: "3px" },
  }
  await page
    .getByRole("textbox", { name: /recipe/i })
    .and(page.locator("textarea"))
    .fill(JSON.stringify(pasted))
  await button("Use this recipe").click()
  const named: Record<string, string> = {
    brand1: "#f7df1e",
    "typography.weights.bold": "800",
    "typography.lineHeights.article": "1.75",
    "shape.surfaceRadius": "16px",
    "shape.buttonBorderWidth": "3px",
  }
  const afterPaste = await until((state) =>
    KEYS.every((key) => state.fields[key] === (named[key] ?? rest(key))),
  )
  const wrong = KEYS.filter(
    (key) => afterPaste.fields[key] !== (named[key] ?? rest(key)),
  )
  expect(
    wrong.length === 0,
    `after a pasted recipe: ${wrong.map((k) => `${k} holds ${JSON.stringify(afterPaste.fields[k])}, not ${JSON.stringify(named[k] ?? rest(k))}`).join("; ")}`,
  )
  for (const [key, value] of [
    ["typography.weights.bold", 800],
    ["typography.lineHeights.article", 1.75],
    ["shape.surfaceRadius", 16],
    ["shape.buttonBorderWidth", 3],
    ["shape.fieldRadius", SLIDERS["shape.fieldRadius"].rest],
  ] as const)
    expect(
      afterPaste.sliders[key]?.value === value,
      `after a pasted recipe the slider of ${key} stands at ${afterPaste.sliders[key]?.value}, not ${value}`,
    )
  expect(
    afterPaste.pickers.brand1?.value.toLowerCase() === "#f7df1e",
    `after a pasted recipe the picker of brand1 shows ${afterPaste.pickers.brand1?.value}`,
  )
  expect(
    shown(afterPaste) === recipeOf(named),
    `after a pasted recipe the page shows ${afterPaste.recipe}`,
  )
  await startsAgain("from a pasted recipe")
})

if (code !== 0) {
  console.error(
    "✗ The theme builder does not rest at LO-TEK's own, or does not go back to it, or the check did not get to look.",
  )
  process.exit(code)
}

// The guard comes last: the first visit, the fields written, the sliders
// moved, the values reset, the picker, a family put back, the page loaded
// again, and twice started again.
if (points !== 9) {
  console.error(
    `✗ The check went through ${points} points where it has 9. It has not looked at everything.`,
  )
  process.exit(1)
}

console.log(
  `✓ The theme builder shows LO-TEK's own in its fields, ${Object.keys(SLIDERS).length} sliders and ${FAMILIES.length} pickers, has in the recipe only what is changed, says which that is, and puts one value or all of them back (${points} points).`,
)
