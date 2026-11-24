/**
 * That the theme builder suggests colours around the accent, and that
 * taking a suggestion gives a theme.
 *
 * Someone with one colour has a theme of one colour. The page asks the core
 * for four palettes and shows them folded under the accent: what each is,
 * a colour for every family the recipe has not set, and the recipe's own
 * where it has. "Use" fills the fields with a palette, and another "Use"
 * swaps what the first one filled, never a colour the visitor wrote or
 * picked. The page remembers which is which, also over a reload.
 *
 * What the palettes are is the core's, held in `core/src/theme/mod.rs` and
 * `core/theme/palettes.json`. The check here asks the package the same
 * question the page asks and requires the page to show the answer, and then
 * does what a visitor does with it. Last comes the goal, from outside: from
 * only an accent and one palette, the recipe the page shows and the command
 * it shows give the theme the page built, and `lotek check-theme` says it
 * keeps every promise.
 *
 * Run with: bun documentation/scripts/check-theme-palettes.ts
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
import { comparable, fieldOn, framesHold, ownOn, untilOn } from "./theme-page"
import { BRANDS, FAMILIES } from "./theme-recipe"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

if (!existsSync(`${ROOT}documentation/dist/theme-builder/index.html`)) {
  console.error(
    "✗ dist/theme-builder/index.html is not built. The site is built with bun run build.",
  )
  process.exit(1)
}

type Palettes = {
  from: string
  palettes: {
    name: string
    description: string
    colors: { family: string; color: string; kept: boolean }[]
  }[]
}
const { buildTheme, suggestPalettes } = (await import(
  `${ROOT}interfaces/dist/tokens/theme.js`
)) as {
  buildTheme(recipe: unknown): { css: string }
  suggestPalettes(recipe: unknown): Palettes | null
}

const NAMES = ["Near", "Opposite", "Three ways", "One hue"]
const STATUSES = ["danger", "warning", "success"]
/** The package as the command names it, and the same command from this repository. */
const PACKAGED = /^npx @lo-tek\/interfaces@\S+ /
const LOCAL = ["node", `${ROOT}interfaces/dist/cli.js`]

const s = await site({ pages: 1 })
const page = s.page
let points = 0
const expect = (claim: boolean, description: string) => {
  points += 1
  if (!claim) s.fail(description)
}
const own = ownOn(page)
const field = fieldOn(page)
const button = (name: string) => page.getByRole("button", { name, exact: true })
const suggestions = page.locator("details[data-palettes]")
/** The group of one family: the innermost one around its field, since all the families share a fieldset. */
const groupOf = (family: string) =>
  page
    .locator('fieldset, [role="group"]')
    .filter({ has: page.locator(`[name="${family}"]`) })
    .last()

/** Runs in the builder. The suggestions, the fields of the families and the recipe. */
function read(families: string[]) {
  const collapsed = (text: string) => text.replace(/\s+/g, " ").trim()
  const control = (name: string) =>
    document.querySelector<HTMLInputElement>(`[name="${name}"]`)
  /**
   * Shown to the visitor. Asked of the element and what is around it, not
   * of its boxes: what is inside a folded `<details>` keeps its boxes in
   * Chromium and is not shown.
   */
  const shown = (element: Element | null) => element?.checkVisibility() ?? false
  /** The accessible name of a group or a button, as far as the page writes one. */
  const named = (element: Element) =>
    collapsed(
      element.getAttribute("aria-label") ??
        (element.getAttribute("aria-labelledby") ?? "")
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" "),
    ) || collapsed(element.textContent ?? "")
  const details = document.querySelectorAll<HTMLDetailsElement>(
    "details[data-palettes]",
  )
  const first = details[0] ?? null
  const groupOf = (element: Element | null) =>
    element?.closest('fieldset, [role="group"]') ?? null
  return {
    suggestions: {
      count: details.length,
      shown: shown(first),
      open: first?.open ?? false,
      summary: collapsed(first?.querySelector("summary")?.textContent ?? ""),
      text: collapsed(first?.textContent ?? ""),
      /** Whether it stands in the group of the accent family. */
      underAccent:
        groupOf(first) !== null &&
        groupOf(first) === groupOf(control("accent")),
      palettes: [
        ...(first?.querySelectorAll<HTMLElement>("[data-palette]") ?? []),
      ].map((palette) => ({
        role: palette.getAttribute("role") ?? "",
        name: named(palette),
        named:
          palette.hasAttribute("aria-label") ||
          palette.hasAttribute("aria-labelledby"),
        shown: shown(palette),
        text: collapsed(palette.textContent ?? ""),
        // The page has a place for every family, and the core decides
        // which have a row: a place without one is `display: none`. Asked
        // of the place itself, so the rows are read while folded too.
        rows: [...palette.querySelectorAll<HTMLElement>("[data-family]")]
          .filter((row) => getComputedStyle(row).display !== "none")
          .map((row) => ({
            family: row.dataset.family ?? "",
            kept: row.dataset.kept ?? "",
            color: collapsed(row.querySelector("code")?.textContent ?? ""),
          })),
        buttons: [...palette.querySelectorAll("button")].map((b) => named(b)),
        /** Whether the palette says it is the one in use, where a visitor sees it. */
        inUse: [...palette.querySelectorAll<HTMLElement>("*")].some(
          (element) =>
            element.children.length === 0 &&
            /^in use$/i.test(collapsed(element.textContent ?? "")) &&
            shown(element),
        ),
      })),
    },
    own: Object.fromEntries(
      families.map((f) => [f, control(`own.${f}`)?.checked ?? false]),
    ),
    fields: Object.fromEntries(
      families.map((f) => [f, control(f)?.value ?? "(no field)"]),
    ),
    /** The group of each family: whether it says it is changed, and whether its reset button shows. */
    groups: Object.fromEntries(
      families.map((family) => {
        const group = control(family)?.closest<HTMLElement>(
          'fieldset, [role="group"]',
        )
        // Without the suggestions, which stand in the accent's group and
        // have buttons and words of their own.
        const reset = [...(group?.querySelectorAll("button") ?? [])].find(
          (b) =>
            b.closest("details[data-palettes]") === null &&
            /^reset/i.test(
              collapsed(b.getAttribute("aria-label") ?? b.textContent ?? ""),
            ),
        )
        const words = [...(group?.querySelectorAll<HTMLElement>("*") ?? [])]
          .filter(
            (element) =>
              element.children.length === 0 &&
              element.closest("details[data-palettes]") === null &&
              shown(element),
          )
          .map((element) => element.innerText)
          .join(" ")
        return [
          family,
          {
            changed: /changed/i.test(words),
            reset:
              reset !== undefined &&
              shown(reset) &&
              getComputedStyle(reset).visibility !== "hidden",
          },
        ]
      }),
    ),
    recipe: document.querySelector("[data-recipe]")?.textContent ?? "",
    command:
      [...document.querySelectorAll("code, pre, kbd, samp, output, p, span")]
        .map((element) => collapsed(element.textContent ?? ""))
        .find((text) => /^npx @lo-tek\/interfaces@\S+ theme /.test(text)) ?? "",
    href: (() => {
      const link = document.querySelector<HTMLAnchorElement>(
        'a[download="theme.css"]',
      )
      return link && shown(link) ? (link.getAttribute("href") ?? "") : ""
    })(),
  }
}
const now = () => page.evaluate(read, FAMILIES)
type State = Awaited<ReturnType<typeof now>>
const until = (done: (state: State) => boolean): Promise<State> =>
  untilOn(page, now, done)

/** The rows of every palette, as the page shows them or as the core answers. */
type Rows = {
  name: string
  rows: { family: string; kept: string; color: string }[]
}[]
const rowsOf = (answer: Palettes): Rows =>
  answer.palettes.map((palette) => ({
    name: palette.name,
    rows: palette.colors.map((color) => ({
      family: color.family,
      kept: String(color.kept),
      color: color.color,
    })),
  }))
const shownRows = (state: State): Rows =>
  state.suggestions.palettes.map(({ name, rows }) => ({ name, rows }))
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** The colours of the families as a recipe, from the fields of the page. */
const recipeOf = (state: State): Record<string, string> =>
  Object.fromEntries(
    FAMILIES.filter((f) => state.own[f]).map((f) => [f, state.fields[f]]),
  )
const showsRecipe = (state: State, recipe: unknown) => {
  try {
    return comparable(JSON.parse(state.recipe)) === comparable(recipe)
  } catch {
    return false
  }
}

/**
 * Waits for the page to show what the core answers for `asked`, the recipe
 * with the suggested families left out, and says how it differs if it does
 * not come to.
 */
async function showsPalettes(what: string, asked: unknown): Promise<State> {
  const answer = suggestPalettes(asked)
  if (answer === null)
    throw new Error(
      `${what}: the check asked about a recipe the core has no palettes for`,
    )
  const wanted = rowsOf(answer)
  const state = await until((state) => same(shownRows(state), wanted))
  expect(
    same(shownRows(state), wanted),
    `${what}: the palettes on the page are not the core's for ${JSON.stringify(asked)}\n  Core: ${JSON.stringify(wanted).slice(0, 500)}\n  Page: ${JSON.stringify(shownRows(state)).slice(0, 500)}`,
  )
  expect(
    state.suggestions.text.toLowerCase().includes(answer.from),
    `${what}: the suggestions do not say they are built on ${answer.from}: ${state.suggestions.text.slice(0, 160)}`,
  )
  return state
}

/** Sets a family by hand: the switch on, and the colour written in the field. */
async function write(family: string, value: string) {
  await own(family).check()
  await field(family).fill(value)
}
const use = (name: string) =>
  suggestions.getByRole("button", { name: `Use ${name}`, exact: true })
/** Opens the suggestions if they are folded. */
async function unfold() {
  if (!(await now()).suggestions.open)
    await suggestions.locator("summary").click()
}
/** As a first visit: nothing set, nothing remembered. */
async function startAgain() {
  await button("Start again").click()
  await until((state) => FAMILIES.every((f) => !state.own[f]))
}
/** What a palette fills: the colour of each row that is not the recipe's own. */
const fills = (answer: Palettes, name: string): Record<string, string> =>
  Object.fromEntries(
    (answer.palettes.find((p) => p.name === name)?.colors ?? [])
      .filter((color) => !color.kept)
      .map((color) => [color.family, color.color]),
  )
/** How the fields of the families differ from what they should hold. */
const differs = (state: State, wanted: Record<string, string>) =>
  FAMILIES.filter(
    (f) => (wanted[f] ?? "") !== (state.own[f] ? state.fields[f] : ""),
  ).map(
    (f) =>
      `${f} is ${state.own[f] ? state.fields[f] : "off"}, expected ${wanted[f] ?? "off"}`,
  )
/** Waits for the families to hold these colours, and no others. */
async function holds(what: string, wanted: Record<string, string>) {
  const state = await until((state) => differs(state, wanted).length === 0)
  expect(
    differs(state, wanted).length === 0,
    `${what}: ${differs(state, wanted).join("; ")}`,
  )
  return state
}

/** The palettes that say they are in use. */
const inUse = (state: State) =>
  state.suggestions.palettes.filter((p) => p.inUse).map((p) => p.name)
/** Waits for exactly these palettes to say they are in use. */
async function marks(what: string, names: string[]) {
  const state = await until((state) => same(inUse(state), names))
  expect(
    same(inUse(state), names),
    `${what}: ${inUse(state).join(", ") || "no palette"} says "In use", expected ${names.join(", ") || "none"}`,
  )
}

const ACCENT = "#7c3aed"
let goals = 0

const code = await s.run(async () => {
  await s.open("/theme-builder/")
  const first = await now()

  // Where they are, and that they wait until asked for.
  expect(
    first.suggestions.count === 1,
    `the page has ${first.suggestions.count} <details data-palettes>, expected one`,
  )
  if (first.suggestions.count !== 1) return
  expect(
    first.suggestions.shown && first.suggestions.underAccent,
    "the suggestions do not stand in the group of the accent",
  )
  expect(
    first.suggestions.summary.startsWith("Suggest colours"),
    `the summary of the suggestions is "${first.suggestions.summary}", expected it to begin "Suggest colours"`,
  )
  expect(
    !first.suggestions.open &&
      first.suggestions.palettes.every((palette) => !palette.shown),
    "the suggestions are unfolded before anyone has asked for them",
  )

  // Without an accent they are built on LO-TEK's own, and say so.
  await unfold()
  const unfolded = await showsPalettes("with no accent", {})
  expect(
    unfolded.suggestions.text.toLowerCase().includes(BRANDS.accent),
    `with no accent, the suggestions do not name LO-TEK's accent ${BRANDS.accent}`,
  )
  expect(
    same(
      unfolded.suggestions.palettes.map((palette) => palette.name),
      NAMES,
    ) &&
      unfolded.suggestions.palettes.every(
        (palette) => palette.role === "group" && palette.named && palette.shown,
      ),
    `the palettes are not four shown groups named ${NAMES.join(", ")}: ${JSON.stringify(unfolded.suggestions.palettes.map(({ role, name, named, shown }) => ({ role, name, named, shown })))}`,
  )
  const core = suggestPalettes({})
  for (const palette of unfolded.suggestions.palettes) {
    const description =
      core?.palettes.find((p) => p.name === palette.name)?.description ?? ""
    expect(
      description !== "" && palette.text.includes(description),
      `${palette.name} does not say what it is in the core's words, "${description}": ${palette.text.slice(0, 160)}`,
    )
    expect(
      same(palette.buttons, [`Use ${palette.name}`]),
      `${palette.name} has the buttons ${JSON.stringify(palette.buttons)}, expected one named "Use ${palette.name}"`,
    )
  }

  // An accent: the palettes are the core's for it, and one of them is used.
  await write("accent", ACCENT)
  await showsPalettes("with an accent", { accent: ACCENT })
  const forAccent = suggestPalettes({ accent: ACCENT }) as Palettes
  await use("Near").click()
  const near = { accent: ACCENT, ...fills(forAccent, "Near") }
  const afterNear = await holds('after "Use Near"', near)
  expect(
    STATUSES.every((status) => !afterNear.own[status]),
    'after "Use Near" a status has a colour, and they are never suggested',
  )
  const shown = await until((state) => showsRecipe(state, near))
  expect(
    showsRecipe(shown, near),
    `after "Use Near" the recipe on the page is not the accent and the palette: ${shown.recipe.slice(0, 300)}`,
  )
  expect(
    await framesHold(page, buildTheme(near).css),
    'after "Use Near" the frames do not hold the theme of the accent and the palette',
  )
  // As if written by hand: each filled family says it is changed and can
  // be reset.
  const unmarked = Object.keys(fills(forAccent, "Near")).filter(
    (family) => !shown.groups[family].changed || !shown.groups[family].reset,
  )
  expect(
    unmarked.length === 0,
    `after "Use Near", ${unmarked.join(", ")} do not show "Changed" and "Reset" as a family set by hand does`,
  )
  // The core is asked with the suggested families left out, so the four
  // stay as they were and can still be chosen between.
  await showsPalettes('after "Use Near"', { accent: ACCENT })

  // Another palette takes the place of the first.
  await use("Opposite").click()
  await holds('after "Use Opposite"', {
    accent: ACCENT,
    ...fills(forAccent, "Opposite"),
  })
  await showsPalettes('after "Use Opposite"', { accent: ACCENT })

  // A suggested colour changed by hand is the visitor's from then on: it
  // is kept in every palette, and no "Use" touches it.
  await field("brand2").fill("#123456")
  const picker = groupOf("brand3").locator('input[type="color"]')
  expect(
    (await picker.count()) === 1,
    `brand3 has ${await picker.count()} colour pickers, expected one`,
  )
  if ((await picker.count()) === 1) await picker.fill("#654321")
  const mine = { accent: ACCENT, brand2: "#123456", brand3: "#654321" }
  await showsPalettes("after two suggested colours were changed by hand", mine)
  const withMine = suggestPalettes(mine) as Palettes
  await use("Three ways").click()
  await holds('after "Use Three ways" beside two colours changed by hand', {
    ...mine,
    ...fills(withMine, "Three ways"),
  })

  // A family switched off, and one reset, is no longer filled by a
  // suggestion: it is empty, the palettes have a colour for it again, and
  // the next "Use" fills it.
  await own("visited").uncheck()
  const reset = groupOf("brand1").getByRole("button", { name: /^reset/i })
  expect(
    (await reset.count()) === 1,
    `brand1 has ${await reset.count()} buttons named "Reset …", expected one`,
  )
  if ((await reset.count()) === 1) await reset.click()
  await holds("after visited was switched off and brand1 reset", {
    ...mine,
    neutral: fills(withMine, "Three ways").neutral,
  })
  await showsPalettes("after visited was switched off and brand1 reset", mine)
  await use("One hue").click()
  await holds('after "Use One hue"', { ...mine, ...fills(withMine, "One hue") })

  // A family the core refuses has no row, and "Use" leaves its field alone.
  await field("brand2").fill("purple")
  const refusedOne = { accent: ACCENT, brand2: "purple", brand3: "#654321" }
  const withRefused = await showsPalettes("with a refused brand2", refusedOne)
  expect(
    withRefused.suggestions.palettes.every((palette) =>
      palette.rows.every((row) => row.family !== "brand2"),
    ),
    "a palette has a row for brand2 while the core refuses its value",
  )
  await use("Near").click()
  await holds('after "Use Near" beside a refused brand2', {
    ...refusedOne,
    ...fills(suggestPalettes(refusedOne) as Palettes, "Near"),
  })
  await field("brand2").fill("#123456")

  // No answer from the core, nothing to show: the suggestions are hidden
  // while the accent is refused, and back when it is a colour again.
  await field("accent").fill("#7c3a")
  const refused = await until((state) => !state.suggestions.shown)
  expect(
    !refused.suggestions.shown,
    "the suggestions are still shown while the accent is half a colour",
  )
  await field("accent").fill(ACCENT)
  await showsPalettes("with the accent written out again", mine)
  expect(
    (await now()).suggestions.shown,
    "the suggestions did not come back when the accent was a colour again",
  )

  // What is remembered survives the page being loaded again: the colours,
  // and which of them a suggestion filled.
  await use("Opposite").click()
  const before = await holds(
    'after "Use Opposite", before the page is loaded again',
    {
      ...mine,
      ...fills(withMine, "Opposite"),
    },
  )
  await s.open("/theme-builder/")
  await holds("the page loaded again", recipeOf(before))
  await unfold()
  await showsPalettes("the page loaded again", mine)
  await use("Near").click()
  await holds('after "Use Near" on the page loaded again', {
    ...mine,
    ...fills(withMine, "Near"),
  })

  // A pasted recipe is the visitor's, every colour of it.
  const pasted = { accent: ACCENT, ...fills(forAccent, "Near") }
  await page
    .getByRole("textbox", { name: /recipe/i })
    .and(page.locator("textarea"))
    .fill(JSON.stringify(pasted))
  await button("Use this recipe").click()
  await holds("after a recipe was pasted", pasted)
  await unfold()
  const allKept = await showsPalettes("after a recipe was pasted", pasted)
  expect(
    allKept.suggestions.palettes.every((palette) =>
      palette.rows.every((row) => row.kept === "true"),
    ),
    "after a recipe with every family was pasted, a palette still suggests a colour",
  )
  await use("Opposite").click()
  await page.waitForTimeout(300)
  await holds('after "Use Opposite" on a pasted recipe', pasted)

  // "Start again" forgets everything, also what was suggested.
  await startAgain()
  await unfold()
  await showsPalettes('after "Start again"', {})
  await use("Near").click()
  await holds(
    'after "Start again" and "Use Near"',
    fills(suggestPalettes({}) as Palettes, "Near"),
  )

  /*
   * The suggested colours follow the palette. The page remembers which
   * palette is in use and marks it, and when the accent or a status changes
   * it fills the families that are still its suggestions again, for the new
   * recipe. A colour written or picked by hand, and a family reset or
   * switched off, is the visitor's and is not touched.
   */
  await startAgain()
  await unfold()
  await marks("before a palette is used", [])
  await write("accent", ACCENT)
  await showsPalettes("with an accent, before a palette is used", {
    accent: ACCENT,
  })
  await use("Near").click()
  await holds('after "Use Near"', {
    accent: ACCENT,
    ...fills(forAccent, "Near"),
  })
  await marks('after "Use Near"', ["Near"])
  await use("Three ways").click()
  await marks('after "Use Three ways"', ["Three ways"])
  await use("Near").click()
  await marks('after "Use Near" again', ["Near"])

  /** What the families hold when the still-suggested ones follow a palette for this recipe. */
  const following = (
    asked: Record<string, string>,
    palette: string,
    notFilled: string[] = [],
  ) => {
    const filled = fills(suggestPalettes(asked) as Palettes, palette)
    for (const family of notFilled) delete filled[family]
    return { ...asked, ...filled }
  }
  // Another accent: every suggested colour is the palette's for it.
  const TEAL = "#0f766e"
  await field("accent").fill(TEAL)
  const forTeal = following({ accent: TEAL }, "Near")
  expect(
    !same(forTeal, { ...fills(forAccent, "Near"), accent: TEAL }),
    "the check's two accents give the same palette, so following one shows nothing",
  )
  await holds("after the accent was changed with Near in use", forTeal)
  await marks("after the accent was changed with Near in use", ["Near"])
  await showsPalettes("after the accent was changed", { accent: TEAL })

  // A status where a suggestion stood: the core moves the suggestion, and
  // the page follows.
  const danger = forTeal.brand1
  await write("danger", danger)
  const withDanger = following({ accent: TEAL, danger }, "Near")
  expect(
    withDanger.brand1 !== forTeal.brand1,
    "the check's danger does not move a suggested colour, so following it shows nothing",
  )
  await holds(
    "after danger was set where brand1 stood, with Near in use",
    withDanger,
  )

  // A colour written by hand is the visitor's, and one reset or switched
  // off is empty by their choice: neither follows.
  await field("brand2").fill("#123456")
  await groupOf("brand1")
    .getByRole("button", { name: /^reset/i })
    .click()
  await own("neutral").uncheck()
  const ORANGE = "#b45309"
  await field("accent").fill(ORANGE)
  const mineNow = { accent: ORANGE, danger, brand2: "#123456" }
  await holds(
    "after the accent was changed beside a colour written by hand, a family reset and one switched off",
    following(mineNow, "Near", ["brand1", "neutral"]),
  )
  await marks("with two families still suggestions of Near", ["Near"])

  // While the core has no answer, the suggested colours stand as they were.
  const standing = recipeOf(await now())
  await field("accent").fill("#b453")
  await page.waitForTimeout(500)
  await holds("while the accent is half a colour", {
    ...standing,
    accent: "#b453",
  })
  await field("accent").fill(ORANGE)
  await holds("with the accent written out again", standing)

  // A reload remembers the palette in use, and it is still followed.
  await s.open("/theme-builder/")
  await holds("the page loaded again with Near in use", standing)
  await unfold()
  await marks("the page loaded again", ["Near"])
  const BLUE = "#1d4ed8"
  await field("accent").fill(BLUE)
  await holds(
    "after the accent was changed on the page loaded again",
    following({ ...mineNow, accent: BLUE }, "Near", ["brand1", "neutral"]),
  )

  // No family is a suggestion any more: nothing is in use.
  await field("visited").fill("#334455")
  await field("brand3").fill("#554433")
  await marks("when every suggested colour has been changed by hand", [])
  const allMine = recipeOf(await now())
  await field("accent").fill(TEAL)
  await page.waitForTimeout(500)
  await holds("after the accent was changed with nothing suggested", {
    ...allMine,
    accent: TEAL,
  })

  // A palette that fills nothing is not in use, and one that fills a
  // single family is.
  await write("brand1", "#445566")
  await write("neutral", "#333333")
  await use("Opposite").click()
  await marks('after "Use Opposite" with every family the visitor\'s own', [])
  await own("brand3").uncheck()
  await use("Opposite").click()
  await marks('after "Use Opposite" with one family to fill', ["Opposite"])

  // A pasted recipe and "Start again" forget the palette in use.
  const toPaste = { accent: ACCENT, brand1: "#0d7a5f" }
  await page
    .getByRole("textbox", { name: /recipe/i })
    .and(page.locator("textarea"))
    .fill(JSON.stringify(toPaste))
  await button("Use this recipe").click()
  await holds("after a recipe was pasted with Opposite in use", toPaste)
  await unfold()
  await marks("after a recipe was pasted", [])
  await field("accent").fill(BLUE)
  await page.waitForTimeout(500)
  await holds("after the accent of a pasted recipe was changed", {
    ...toPaste,
    accent: BLUE,
  })
  await use("One hue").click()
  await marks('after "Use One hue"', ["One hue"])
  await startAgain()
  await unfold()
  await marks('after "Start again"', [])
  await write("accent", ACCENT)
  await page.waitForTimeout(500)
  await holds('after "Start again" and an accent', { accent: ACCENT })

  /*
   * The goal, from outside: only an accent, one palette, and then what a
   * reader does with the page. The recipe the page shows, in the file the
   * command names, and the command the page shows give the theme the page
   * built, and `lotek check-theme` says it keeps every promise.
   */
  for (const [accent, palette] of [
    ["#d32f2f", "Near"],
    ["#7c3aed", "Opposite"],
    ["#f7df1e", "Three ways"],
    ["#2e7d32", "One hue"],
  ]) {
    const name = `${palette} of ${accent}`
    await startAgain()
    await write("accent", accent)
    await unfold()
    await showsPalettes(name, { accent })
    await use(palette).click()
    const recipe = {
      accent,
      ...fills(suggestPalettes({ accent }) as Palettes, palette),
    }
    const from = await until(
      (state) => showsRecipe(state, recipe) && state.href !== "",
    )
    expect(
      showsRecipe(from, recipe) && Object.keys(recipe).length === 6,
      `${name}: the recipe on the page is not the accent and the five colours of the palette: ${from.recipe.slice(0, 300)}`,
    )
    expect(
      PACKAGED.test(from.command),
      `${name}: the page shows no command that starts with npx @lo-tek/interfaces@…`,
    )
    if (!showsRecipe(from, recipe) || !PACKAGED.test(from.command)) continue

    const folder = mkdtempSync(join(tmpdir(), "lotek-palette-"))
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
      const written = run(args)
      const target = join(folder, out.slice("--out=".length))
      expect(
        written.exitCode === 0 && existsSync(target),
        `${name}: the command exited with ${written.exitCode} and ${existsSync(target) ? "wrote" : "did not write"} the file: ${written.stderr}`,
      )
      if (written.exitCode !== 0 || !existsSync(target)) continue
      const theme = readFileSync(target, "utf8")
      expect(
        await framesHold(page, theme),
        `${name}: the frames do not hold the theme the command wrote`,
      )
      const offered = await page.evaluate(
        async (href) => (href ? (await fetch(href)).text() : ""),
        from.href,
      )
      expect(
        offered === theme,
        `${name}: the theme.css the page offers is not the one the command wrote`,
      )
      const checked = run(["check-theme", out.slice("--out=".length)])
      expect(
        checked.exitCode === 0 &&
          checked.stdout
            .toString("utf8")
            .startsWith("The theme keeps every promise."),
        `${name}: lotek check-theme does not say the theme keeps every promise: ${checked.stdout}${checked.stderr}`,
      )
      goals += 1
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  }
})

if (code !== 0) process.exit(code)
if (goals !== 4 || points < 100) {
  console.error(
    `✗ The check reached the goal for ${goals} of 4 palettes and held ${points} points. It has not looked at what it should.`,
  )
  process.exit(1)
}
console.log(
  `✓ The theme builder suggests the core's four palettes around the accent, folded until asked for, fills and swaps what a suggestion filled and never a colour written or picked, remembers which over a reload, and for ${goals} accents a palette gives the theme the command writes, which keeps every promise.`,
)
