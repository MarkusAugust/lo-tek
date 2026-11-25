/**
 * That the theme builder offers the core's palettes around the accent, and
 * that taking one gives a theme.
 *
 * Someone with one colour has a theme of one colour. Under the accent the
 * page has a button for each palette the core suggests, with a dot for every
 * colour it would give, and one for LO-TEK's own. Pressing a palette fills
 * the families the recipe has not set; another palette swaps what the first
 * one filled, never a colour the visitor wrote or picked, and LO-TEK's own
 * takes the suggestions away. The palette in use follows the accent and the
 * statuses. The page remembers which colours are suggestions and which
 * palette is in use, also over a reload.
 *
 * What the palettes are is the core's, held in `core/src/theme/mod.rs` and
 * `core/theme/palettes.json`. The check here asks the package the same
 * question the page asks and requires the page to show the answer, and then
 * does what a visitor does with it. "Start again" and its "Undo" are held
 * here too, since what they put back includes the suggestions. Last comes
 * the goal, from outside: from only an accent and one palette, the recipe
 * the page shows and the command it shows give the theme the page built,
 * and `lotek check-theme` says it keeps every promise.
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

const NAMES = ["Near", "Opposite", "Three ways", "One hue", "Quiet"]
const DEFAULT = "LO-TEK"
const SUGGESTED = ["visited", "brand1", "brand2", "brand3", "neutral"]
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
const palettes = page.locator("[data-palettes]")
/** The group of one family: the innermost one around its field, since all the families share a fieldset. */
const groupOf = (family: string) =>
  page
    .locator('fieldset, [role="group"]')
    .filter({ has: page.locator(`[name="${family}"]`) })
    .last()

/** Runs in the builder. The palettes, the fields of the families, the recipe and "Start again". */
function read(families: string[]) {
  const collapsed = (text: string) => text.replace(/\s+/g, " ").trim()
  const control = (name: string) =>
    document.querySelector<HTMLInputElement>(`[name="${name}"]`)
  /** Shown to the visitor: asked of the element and what is around it. */
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
  /** A colour as the browser writes one. */
  const painted = (hex: string) =>
    `rgb(${[1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)).join(", ")})`
  const groupOf = (element: Element | null) =>
    element?.closest('fieldset, [role="group"]') ?? null
  const all = document.querySelectorAll<HTMLElement>("[data-palettes]")
  const first = all[0] ?? null
  const says = document.querySelectorAll<HTMLElement>("[data-palette-says]")
  const again = [...document.querySelectorAll("button")].filter(
    (b) => shown(b) && /^(start again|undo)$/i.test(named(b)),
  )
  const head = document.querySelector(".builder__preview-head")
  const choice = head?.querySelector(".lt-toggle-group") ?? null
  return {
    palettes: {
      count: all.length,
      folded: document.querySelectorAll("details[data-palettes]").length,
      /** What the palettes can be folded away with: the `<details>` around them. */
      fold: (() => {
        const details = first?.closest("details") ?? null
        return {
          accordion: details?.matches("details.lt-accordion") === true,
          open: details?.open ?? false,
          summary: collapsed(
            details?.querySelector(":scope > summary")?.textContent ?? "",
          ),
          inContent: first?.closest(".lt-accordion__content") !== null,
          saysInside:
            details !== null &&
            says[0] !== undefined &&
            says[0].closest(".lt-accordion__content") !== null &&
            details.contains(says[0]),
          saysShown: shown(says[0] ?? null),
        }
      })(),
      role: first?.getAttribute("role") ?? "",
      name: first
        ? collapsed(
            first.getAttribute("aria-label") ??
              (first.getAttribute("aria-labelledby") ?? "")
                .split(/\s+/)
                .map((id) => document.getElementById(id)?.textContent ?? "")
                .join(" "),
          )
        : "",
      shown: shown(first),
      /** Whether it stands in the group of the accent family. */
      underAccent:
        groupOf(first?.parentElement ?? null) !== null &&
        groupOf(first?.parentElement ?? null) === groupOf(control("accent")),
      /** Whether a colour is written out as text anywhere in it. */
      hex: /#[0-9a-f]{3,8}\b/i.test(first?.innerText ?? ""),
      buttons: [...(first?.querySelectorAll("button") ?? [])].map((b) => ({
        kind: b.hasAttribute("data-palette")
          ? "palette"
          : b.hasAttribute("data-palette-default")
            ? "default"
            : "other",
        type: b.getAttribute("type") ?? "",
        name: named(b),
        pressed: b.getAttribute("aria-pressed") ?? "",
        /** What the button is described by, for one who does not see its dots. */
        described: collapsed(
          b.getAttribute("aria-description") ??
            (b.getAttribute("aria-describedby") ?? "")
              .split(/\s+/)
              .map((id) => document.getElementById(id)?.textContent ?? "")
              .join(" "),
        ),
        disabled: b.disabled,
        shown: shown(b),
        /** Whether the button says it is the one in use, where a visitor sees it. */
        inUse: [...b.querySelectorAll<HTMLElement>("*")].some(
          (element) =>
            element.children.length === 0 &&
            /^in use$/i.test(collapsed(element.textContent ?? "")) &&
            shown(element),
        ),
        // A dot for every row the core gives. A place without a row is
        // `display: none`.
        dots: [...b.querySelectorAll<HTMLElement>("[data-family]")]
          .filter((dot) => getComputedStyle(dot).display !== "none")
          .map((dot) => {
            const color = (dot.dataset.color ?? "").toLowerCase()
            return {
              family: dot.dataset.family ?? "",
              kept: dot.dataset.kept ?? "",
              color,
              /** Whether the dot is painted in the colour it says it has. */
              painted: [dot, ...dot.querySelectorAll<HTMLElement>("*")].some(
                (element) => {
                  const style = getComputedStyle(element)
                  return (
                    /^#[0-9a-f]{6}$/.test(color) &&
                    [style.backgroundColor, style.fill, style.color].includes(
                      painted(color),
                    )
                  )
                },
              ),
            }
          }),
      })),
      says: {
        count: says.length,
        text: shown(says[0] ?? null) ? collapsed(says[0]?.innerText ?? "") : "",
      },
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
        // Without the palettes, which stand in the accent's group and have
        // buttons and words of their own.
        const reset = [...(group?.querySelectorAll("button") ?? [])].find(
          (b) =>
            b.closest("[data-palettes]") === null &&
            /^reset/i.test(
              collapsed(b.getAttribute("aria-label") ?? b.textContent ?? ""),
            ),
        )
        const words = [...(group?.querySelectorAll<HTMLElement>("*") ?? [])]
          .filter(
            (element) =>
              element.children.length === 0 &&
              element.closest("[data-palettes]") === null &&
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
    /** The buttons that start again or undo it, by name, and where they stand. */
    again: again.map((b) => ({
      name: named(b),
      inHead: head?.contains(b) === true,
      beforeChoice:
        choice !== null &&
        (b.compareDocumentPosition(choice) &
          Node.DOCUMENT_POSITION_FOLLOWING) !==
          0,
      leftOfChoice:
        choice !== null &&
        b.getBoundingClientRect().right <=
          choice.getBoundingClientRect().left + 1,
    })),
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

/** The rows of every palette, as the page's dots show them or as the core answers. */
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
/** The buttons of the core's palettes, without LO-TEK's own. */
const paletteButtons = (state: State) =>
  state.palettes.buttons.filter((b) => b.kind === "palette")
/** The name of the palette a button is for: what its accessible name begins with. */
const paletteOf = (name: string) =>
  NAMES.find((palette) => name.startsWith(palette)) ?? name
const shownRows = (state: State): Rows =>
  paletteButtons(state).map(({ name, dots }) => ({
    name: paletteOf(name),
    rows: dots.map(({ family, kept, color }) => ({ family, kept, color })),
  }))
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
  // The dots are paint. One who does not see them is told what the palette
  // is in the core's own sentence, whether it is the one in use or not.
  const undescribed = paletteButtons(state)
    .filter(
      (b) =>
        b.described !==
        (answer.palettes.find((p) => p.name === paletteOf(b.name))
          ?.description ?? ""),
    )
    .map((b) => `${paletteOf(b.name)} is described by "${b.described}"`)
  expect(
    undescribed.length === 0,
    `${what}: a palette's button is not described by the core's sentence about it: ${undescribed.slice(0, 3).join("; ")}`,
  )
  const unpainted = paletteButtons(state).flatMap(({ name, dots }) =>
    dots.filter((dot) => !dot.painted).map((dot) => `${dot.family} of ${name}`),
  )
  expect(
    unpainted.length === 0,
    `${what}: the dots of ${unpainted.slice(0, 5).join(", ")} are not painted in the colour they say`,
  )
  return state
}

/** Sets a family by hand: the switch on, and the colour written in the field. */
async function write(family: string, value: string) {
  await own(family).check()
  await field(family).fill(value)
}
/** The button of a palette: its accessible name begins with the palette's name. */
const press = (name: string) =>
  palettes.locator("button[data-palette]").filter({
    hasText: new RegExp(`^\\s*${name}`),
  })
const pressDefault = () => palettes.locator("button[data-palette-default]")
/** As a first visit: nothing set, nothing remembered. */
async function startAgain() {
  // Named "Undo" when the page was just emptied: then it is empty already.
  if ((await button("Start again").count()) === 1)
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
const describes = (answer: Palettes, name: string) =>
  answer.palettes.find((p) => p.name === name)?.description ?? ""
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

/** How the buttons say which palette is in use: pressed, "In use" and the core's sentence. */
const marked = (state: State) => ({
  pressed: state.palettes.buttons
    .filter((b) => b.pressed === "true")
    .map((b) => (b.kind === "default" ? DEFAULT : paletteOf(b.name))),
  unpressed: state.palettes.buttons.filter((b) => b.pressed === "false").length,
  inUse: state.palettes.buttons
    .filter((b) => b.inUse)
    .map((b) => (b.kind === "default" ? DEFAULT : paletteOf(b.name))),
  says: state.palettes.says.text,
})
/**
 * Waits for this palette to be the one in use, or none when it is `null`:
 * its button pressed and no other, "In use" in it and nowhere else, and the
 * core's sentence about it under the buttons. With none in use LO-TEK's own
 * is the one pressed, nothing says "In use" and no sentence is shown.
 */
async function marks(what: string, name: string | null, says = "") {
  const wanted = {
    pressed: [name ?? DEFAULT],
    unpressed: NAMES.length,
    inUse: name === null ? [] : [name],
    says,
  }
  const state = await until((state) => same(marked(state), wanted))
  expect(
    same(marked(state), wanted),
    `${what}: the page marks ${JSON.stringify(marked(state))}, expected ${JSON.stringify(wanted)}`,
  )
}

const ACCENT = "#7c3aed"
let goals = 0

const code = await s.run(async () => {
  await s.open("/theme-builder/")
  const first = await now()

  // Where they are and what they are: a group of six buttons under the
  // accent, shown without being asked for.
  expect(
    first.palettes.count === 1 && first.palettes.folded === 0,
    `the page has ${first.palettes.count} [data-palettes], ${first.palettes.folded} of them itself a <details>, expected one group`,
  )
  // Open until the visitor folds it: LO-TEK's accordion around the group
  // and the sentence, with the heading to press.
  const { fold } = first.palettes
  expect(
    fold.accordion && fold.inContent && fold.saysInside,
    `the palettes and their sentence do not stand in the content of a details.lt-accordion: ${JSON.stringify(fold)}`,
  )
  expect(
    fold.summary === "Palette",
    `the summary of the palettes says "${fold.summary}", expected "Palette"`,
  )
  expect(
    fold.open && first.palettes.shown,
    "on a first visit the palettes are not shown in an accordion that is open",
  )
  if (first.palettes.count !== 1) return
  expect(
    first.palettes.role === "group" && first.palettes.name === "Palette",
    `the palettes are a "${first.palettes.role}" named "${first.palettes.name}", expected a group named "Palette"`,
  )
  expect(
    first.palettes.shown && first.palettes.underAccent,
    "the palettes do not stand, shown, in the group of the accent",
  )
  const buttons = first.palettes.buttons
  expect(
    same(
      buttons.map((b) => [
        b.kind,
        b.kind === "default" ? b.name : paletteOf(b.name),
      ]),
      [...NAMES.map((name) => ["palette", name]), ["default", DEFAULT]],
    ) && buttons.every((b) => b.type === "button" && b.shown && !b.disabled),
    `the palettes are not six shown buttons, the core's five and then "${DEFAULT}": ${JSON.stringify(buttons.map(({ kind, type, name, shown, disabled }) => ({ kind, type, name, shown, disabled })))}`,
  )
  expect(
    !first.palettes.hex,
    "a colour is written out as text among the palettes, and they show colours as paint only",
  )
  expect(
    first.palettes.says.count === 1,
    `the page has ${first.palettes.says.count} [data-palette-says], expected one`,
  )
  // Without an accent they are built on LO-TEK's own, and nothing is in use.
  await showsPalettes("with no accent", {})
  await marks("on a first visit", null)
  const ownDots = buttons.find((b) => b.kind === "default")?.dots ?? []
  expect(
    same(
      ownDots.map((dot) => [dot.family, dot.color]),
      SUGGESTED.map((family) => [family, BRANDS[family]]),
    ) && ownDots.every((dot) => dot.painted),
    `"${DEFAULT}" does not have a painted dot for each of LO-TEK's own ${SUGGESTED.join(", ")}: ${JSON.stringify(ownDots)}`,
  )

  // The keyboard is seen on every button: one that has the focus looks
  // another way than the same one without it, pressed or not, and a
  // pressed one another way than one that is not.
  const look = (locator: ReturnType<typeof press>) =>
    locator.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        focused: element.matches(":focus-visible"),
        paint: [
          style.outlineStyle,
          style.outlineWidth,
          style.outlineColor,
          style.outlineOffset,
          style.boxShadow,
          style.borderTopColor,
          style.borderTopWidth,
          style.backgroundColor,
        ].join(" | "),
      }
    })
  // From the keyboard, so the browser shows the focus as it does for one
  // who uses it.
  await page.keyboard.press("Tab")
  for (const [what, strip] of [
    [`"${DEFAULT}", which is pressed`, pressDefault()],
    ["Near, which is not pressed", press("Near")],
  ] as const) {
    await strip.blur()
    const without = await look(strip)
    await strip.focus()
    const withFocus = await look(strip)
    expect(
      withFocus.focused && !without.focused,
      `the check could not give ${what} the focus of the keyboard`,
    )
    expect(
      withFocus.paint !== without.paint,
      `${what} looks the same with the focus of the keyboard as without it: ${withFocus.paint}`,
    )
    await strip.blur()
  }
  expect(
    (await look(pressDefault())).paint !== (await look(press("Near"))).paint,
    "a pressed palette button looks the same as one that is not pressed",
  )

  // An accent: the palettes are the core's for it, and one of them is used.
  await write("accent", ACCENT)
  await showsPalettes("with an accent", { accent: ACCENT })
  const forAccent = suggestPalettes({ accent: ACCENT }) as Palettes
  await press("Near").click()
  const near = { accent: ACCENT, ...fills(forAccent, "Near") }
  const afterNear = await holds("after Near was pressed", near)
  expect(
    STATUSES.every((status) => !afterNear.own[status]),
    "after Near was pressed a status has a colour, and they are never suggested",
  )
  const shown = await until((state) => showsRecipe(state, near))
  expect(
    showsRecipe(shown, near),
    `after Near was pressed the recipe on the page is not the accent and the palette: ${shown.recipe.slice(0, 300)}`,
  )
  expect(
    await framesHold(page, buildTheme(near).css),
    "after Near was pressed the frames do not hold the theme of the accent and the palette",
  )
  // As if written by hand: each filled family says it is changed and can
  // be reset.
  const unmarked = Object.keys(fills(forAccent, "Near")).filter(
    (family) => !shown.groups[family].changed || !shown.groups[family].reset,
  )
  expect(
    unmarked.length === 0,
    `after Near was pressed, ${unmarked.join(", ")} do not show "Changed" and "Reset" as a family set by hand does`,
  )
  // The core is asked with the suggested families left out, so the
  // palettes stay as they were and can still be chosen between.
  await showsPalettes("after Near was pressed", { accent: ACCENT })
  await marks("after Near was pressed", "Near", describes(forAccent, "Near"))
  expect(
    !(await now()).palettes.hex,
    "with a palette in use a colour is written out as text among the palettes",
  )

  // The heading folds the palettes away and brings them back. That is all
  // it does: the palette in use and the colours stand.
  const heading = page
    .locator("details.lt-accordion")
    .filter({ has: palettes })
    .locator("summary")
  expect(
    (await heading.count()) === 1,
    `the palettes have ${await heading.count()} summaries to fold them with, expected one`,
  )
  if ((await heading.count()) === 1) {
    await heading.click()
    const folded = await until((state) => !state.palettes.fold.open)
    expect(
      !folded.palettes.fold.open &&
        folded.palettes.buttons.length === NAMES.length + 1 &&
        folded.palettes.buttons.every((b) => !b.shown) &&
        !folded.palettes.fold.saysShown,
      `after the heading was pressed the six buttons and the sentence are not hidden: ${JSON.stringify({ open: folded.palettes.fold.open, shown: folded.palettes.buttons.filter((b) => b.shown).map((b) => b.name), sentence: folded.palettes.fold.saysShown })}`,
    )
    expect(
      same(marked(folded).pressed, ["Near"]),
      `folded away, the palette in use is ${marked(folded).pressed.join(", ") || "none"}, expected Near still`,
    )
    await holds("with the palettes folded away", near)
    await heading.click()
    const unfolded = await until((state) => state.palettes.fold.open)
    expect(
      unfolded.palettes.fold.open &&
        unfolded.palettes.buttons.every((b) => b.shown),
      "after the heading was pressed again the six buttons are not shown",
    )
    await marks(
      "with the palettes unfolded again",
      "Near",
      describes(forAccent, "Near"),
    )
    await holds("with the palettes unfolded again", near)
  }

  // Another palette takes the place of the first.
  await press("Opposite").click()
  await holds("after Opposite was pressed", {
    accent: ACCENT,
    ...fills(forAccent, "Opposite"),
  })
  await showsPalettes("after Opposite was pressed", { accent: ACCENT })
  await marks(
    "after Opposite was pressed",
    "Opposite",
    describes(forAccent, "Opposite"),
  )
  await press("Quiet").click()
  await holds("after Quiet was pressed", {
    accent: ACCENT,
    ...fills(forAccent, "Quiet"),
  })
  await marks("after Quiet was pressed", "Quiet", describes(forAccent, "Quiet"))
  await press("Opposite").click()

  // A suggested colour changed by hand is the visitor's from then on: its
  // dot is the recipe's own in every palette, and no palette touches it.
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
  await press("Three ways").click()
  await holds(
    "after Three ways was pressed beside two colours changed by hand",
    {
      ...mine,
      ...fills(withMine, "Three ways"),
    },
  )

  // A family switched off, and one reset, is no longer filled by a
  // suggestion: it is empty, the palettes have a colour for it again, and
  // the next palette pressed fills it.
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
  await press("One hue").click()
  await holds("after One hue was pressed", {
    ...mine,
    ...fills(withMine, "One hue"),
  })

  // A family the core refuses has no dot, and a palette leaves its field alone.
  await field("brand2").fill("purple")
  const refusedOne = { accent: ACCENT, brand2: "purple", brand3: "#654321" }
  const withRefused = await showsPalettes("with a refused brand2", refusedOne)
  expect(
    paletteButtons(withRefused).every((b) =>
      b.dots.every((dot) => dot.family !== "brand2"),
    ),
    "a palette has a dot for brand2 while the core refuses its value",
  )
  await press("Near").click()
  await holds("after Near was pressed beside a refused brand2", {
    ...refusedOne,
    ...fills(suggestPalettes(refusedOne) as Palettes, "Near"),
  })
  await field("brand2").fill("#123456")
  const answered = await showsPalettes("with brand2 a colour again", mine)

  // No answer from the core: the buttons stand with the colours of the
  // last answer and cannot be pressed, and work again when the accent is a
  // colour.
  await field("accent").fill("#7c3a")
  const refused = await until((state) =>
    paletteButtons(state).every((b) => b.disabled),
  )
  expect(
    paletteButtons(refused).length === NAMES.length &&
      paletteButtons(refused).every((b) => b.disabled && b.shown),
    `while the accent is half a colour the palettes are not five shown buttons that cannot be pressed: ${JSON.stringify(paletteButtons(refused).map(({ name, disabled, shown }) => ({ name, disabled, shown })))}`,
  )
  expect(
    same(shownRows(refused), shownRows(answered)),
    "while the accent is half a colour the palettes do not stand with the colours of the last answer",
  )
  await field("accent").fill(ACCENT)
  const back = await until((state) =>
    paletteButtons(state).every((b) => !b.disabled),
  )
  expect(
    paletteButtons(back).every((b) => !b.disabled),
    "the palettes cannot be pressed after the accent was a colour again",
  )
  await showsPalettes("with the accent written out again", mine)

  // LO-TEK's own takes the suggestions away, and leaves what the visitor
  // wrote or picked.
  await press("Opposite").click()
  await holds("after Opposite was pressed, before LO-TEK's own", {
    ...mine,
    ...fills(withMine, "Opposite"),
  })
  await marks(
    "after Opposite was pressed beside two colours changed by hand",
    "Opposite",
    describes(withMine, "Opposite"),
  )
  await pressDefault().click()
  await holds(`after "${DEFAULT}" was pressed`, mine)
  await marks(`after "${DEFAULT}" was pressed`, null)
  await showsPalettes(`after "${DEFAULT}" was pressed`, mine)

  // What is remembered survives the page being loaded again: the colours,
  // which of them a palette filled, and which palette.
  await press("Opposite").click()
  const before = await holds(
    "after Opposite was pressed, before the page is loaded again",
    { ...mine, ...fills(withMine, "Opposite") },
  )
  await s.open("/theme-builder/")
  await holds("the page loaded again", recipeOf(before))
  await showsPalettes("the page loaded again", mine)
  await marks(
    "the page loaded again",
    "Opposite",
    describes(withMine, "Opposite"),
  )
  await press("Near").click()
  await holds("after Near was pressed on the page loaded again", {
    ...mine,
    ...fills(withMine, "Near"),
  })

  // A pasted recipe is the visitor's, every colour of it, and no palette
  // is in use.
  const pasted = { accent: ACCENT, ...fills(forAccent, "Near") }
  const paste = async (recipe: unknown) => {
    await page
      .getByRole("textbox", { name: /recipe/i })
      .and(page.locator("textarea"))
      .fill(JSON.stringify(recipe))
    await button("Use this recipe").click()
  }
  await paste(pasted)
  await holds("after a recipe was pasted", pasted)
  const allKept = await showsPalettes("after a recipe was pasted", pasted)
  expect(
    paletteButtons(allKept).every((b) =>
      b.dots.every((dot) => dot.kept === "true"),
    ),
    "after a recipe with every family was pasted, a palette still suggests a colour",
  )
  await marks("after a recipe was pasted", null)
  // A palette that fills nothing changes nothing, and is not in use.
  await press("Opposite").click()
  await page.waitForTimeout(300)
  await holds("after Opposite was pressed on a pasted recipe", pasted)
  await marks("after Opposite was pressed on a pasted recipe", null)

  /*
   * The palette in use is followed. When the accent or a status changes,
   * the families that are still its suggestions are filled again, for the
   * new recipe. A colour written or picked by hand, and a family reset or
   * switched off, is the visitor's and is not touched.
   */
  await startAgain()
  await write("accent", ACCENT)
  await showsPalettes("with an accent, before a palette is pressed", {
    accent: ACCENT,
  })
  await press("Near").click()
  await holds("after Near was pressed", near)
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
  await marks(
    "after the accent was changed with Near in use",
    "Near",
    describes(suggestPalettes({ accent: TEAL }) as Palettes, "Near"),
  )
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
  await marks(
    "after danger was set where brand1 stood, with Near in use",
    "Near",
    describes(suggestPalettes({ accent: TEAL, danger }) as Palettes, "Near"),
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
  const BLUE = "#1d4ed8"
  await field("accent").fill(BLUE)
  await holds(
    "after the accent was changed on the page loaded again",
    following({ ...mineNow, accent: BLUE }, "Near", ["brand1", "neutral"]),
  )

  // No family is a suggestion any more: nothing is in use, and nothing follows.
  await field("visited").fill("#334455")
  await field("brand3").fill("#554433")
  await marks("when every suggested colour has been changed by hand", null)
  const allMine = recipeOf(await now())
  await field("accent").fill(TEAL)
  await page.waitForTimeout(500)
  await holds("after the accent was changed with nothing suggested", {
    ...allMine,
    accent: TEAL,
  })

  /*
   * What the browser remembers is not to be believed beyond what the core
   * suggests colours for. A remembered "this was a suggestion" for the
   * accent or a status, which no palette has a dot for, would leave that
   * colour out of what the core is asked, and the palettes would be built
   * on another accent than the one in the field. Such a family is the
   * visitor's own.
   */
  await startAgain()
  await write("accent", ACCENT)
  await press("Opposite").click()
  await holds(
    "after Opposite was pressed, before what is remembered is changed",
    {
      accent: ACCENT,
      ...fills(forAccent, "Opposite"),
    },
  )
  const REMEMBERED = "lotek-theme-builder"
  const changed = await page.evaluate((key) => {
    const kept = JSON.parse(localStorage.getItem(key) ?? "null")
    if (!kept?.own || !kept.fields || !kept.suggested) return false
    for (const [family, colour] of [
      ["accent", "#ff0000"],
      ["danger", "#00ff00"],
    ]) {
      kept.own[family] = true
      kept.fields[family] = colour
      kept.suggested[family] = true
    }
    localStorage.setItem(key, JSON.stringify(kept))
    return true
  }, REMEMBERED)
  expect(
    changed,
    `the page remembers nothing under "${REMEMBERED}" with own, fields and suggested, so the check cannot change it`,
  )
  await s.open("/theme-builder/")
  const theirs = { accent: "#ff0000", danger: "#00ff00" }
  const remembered = await until(
    (state) =>
      state.fields.accent === "#ff0000" && state.fields.danger === "#00ff00",
  )
  expect(
    remembered.fields.accent === "#ff0000" &&
      remembered.fields.danger === "#00ff00",
    `the page loaded again does not hold the remembered accent and danger: ${remembered.fields.accent}, ${remembered.fields.danger}`,
  )
  await showsPalettes(
    "with an accent and a status remembered as suggestions",
    theirs,
  )
  await press("Near").click()
  await holds(
    "after Near was pressed with an accent and a status remembered as suggestions",
    { ...theirs, ...fills(suggestPalettes(theirs) as Palettes, "Near") },
  )
  await pressDefault().click()
  await holds(
    `after "${DEFAULT}" was pressed with an accent and a status remembered as suggestions`,
    theirs,
  )

  /*
   * "Start again" stands in the head of the preview, before the choice
   * between the components and the page, and nowhere else. It empties
   * everything, and is then "Undo", which puts everything back: the
   * colours, which of them were suggestions, and the palette in use. It is
   * "Start again" again once something is set, and after "Undo".
   */
  await pressDefault().click()
  await paste({ accent: ACCENT, brand2: "#123456", danger: "#b91c1c" })
  const set = { accent: ACCENT, brand2: "#123456", danger: "#b91c1c" }
  await holds("before starting again", set)
  const withSet = suggestPalettes(set) as Palettes
  await press("Three ways").click()
  const full = await holds("before starting again, with Three ways in use", {
    ...set,
    ...fills(withSet, "Three ways"),
  })
  expect(
    same(
      full.again.map((b) => b.name),
      ["Start again"],
    ) &&
      full.again[0].inHead &&
      full.again[0].beforeChoice &&
      full.again[0].leftOfChoice,
    `the page does not have one "Start again", in the head of the preview before the choice of what is shown: ${JSON.stringify(full.again)}`,
  )
  await button("Start again").click()
  const emptied = await holds('after "Start again"', {})
  await marks('after "Start again"', null)
  const offered = await until((state) =>
    same(
      state.again.map((b) => b.name),
      ["Undo"],
    ),
  )
  expect(
    same(
      offered.again.map((b) => b.name),
      ["Undo"],
    ) &&
      offered.again[0].inHead &&
      offered.again[0].beforeChoice,
    `after "Start again" the button is not "Undo" in its place: ${JSON.stringify(offered.again)}`,
  )
  expect(
    showsRecipe(emptied, {}) || emptied.recipe.trim() === "",
    `after "Start again" the page still shows a recipe: ${emptied.recipe.slice(0, 120)}`,
  )
  await button("Undo").click()
  await holds('after "Undo"', recipeOf(full))
  await marks('after "Undo"', "Three ways", describes(withSet, "Three ways"))
  await showsPalettes('after "Undo"', set)
  const undone = await until((state) =>
    same(
      state.again.map((b) => b.name),
      ["Start again"],
    ),
  )
  expect(
    same(
      undone.again.map((b) => b.name),
      ["Start again"],
    ),
    `after "Undo" the button is not "Start again" again: ${JSON.stringify(undone.again)}`,
  )
  // What was a suggestion is one again: another palette swaps it, and the
  // colours written by hand stand.
  await press("Near").click()
  await holds('after Near was pressed after "Undo"', {
    ...set,
    ...fills(withSet, "Near"),
  })
  // Something set after "Start again": nothing to undo any more.
  await button("Start again").click()
  await holds('after "Start again" a second time', {})
  await write("accent", TEAL)
  const moved = await until((state) =>
    same(
      state.again.map((b) => b.name),
      ["Start again"],
    ),
  )
  expect(
    same(
      moved.again.map((b) => b.name),
      ["Start again"],
    ),
    `after "Start again" and a colour written, the button is still ${JSON.stringify(moved.again.map((b) => b.name))}`,
  )
  // And none over a reload.
  await button("Start again").click()
  await holds('after "Start again" a third time', {})
  await until((state) => state.again.some((b) => b.name === "Undo"))
  await s.open("/theme-builder/")
  const fresh = await holds('the page loaded again after "Start again"', {})
  expect(
    same(
      fresh.again.map((b) => b.name),
      ["Start again"],
    ),
    `the page loaded again after "Start again" offers ${JSON.stringify(fresh.again.map((b) => b.name))}, expected only "Start again"`,
  )
  await marks('the page loaded again after "Start again"', null)

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
    ["#1d4ed8", "Quiet"],
  ]) {
    const name = `${palette} of ${accent}`
    await startAgain()
    await write("accent", accent)
    await showsPalettes(name, { accent })
    await press(palette).click()
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
      const offeredFile = await page.evaluate(
        async (href) => (href ? (await fetch(href)).text() : ""),
        from.href,
      )
      expect(
        offeredFile === theme,
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
if (goals !== 5 || points < 110) {
  console.error(
    `✗ The check reached the goal for ${goals} of 5 palettes and held ${points} points. It has not looked at what it should.`,
  )
  process.exit(1)
}
console.log(
  `✓ The theme builder has a button for each of the core's five palettes and one for LO-TEK's own under the accent, fills and swaps what a palette filled and never a colour written or picked, follows the palette in use, remembers it over a reload, undoes "Start again", and for ${goals} accents a palette gives the theme the command writes, which keeps every promise.`,
)
