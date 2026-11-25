/**
 * That the visitor chooses which appearances the theme builder shows, and
 * that the choice is theirs and nothing else's.
 *
 * A frame alone has the width of both, so a theme is judged in one
 * appearance at a time, or in the two side by side. The choice stands
 * between "Start again" and the choice of what is framed: Dark, Both and
 * Light, and the page opens on Dark. A frame that is not chosen is not
 * displayed. The choice is about the visitor and not the recipe: the
 * browser remembers it, and "Start again" and "Undo" leave it alone.
 *
 * And the place in the framed page is kept. A frame gets another width when
 * the choice changes, so the same number of pixels is another place: what
 * is held is that the component at the top before is at the top after, in
 * every frame that is shown.
 *
 * Run with: bun documentation/scripts/check-theme-appearances.ts
 * Requires `documentation/dist` to be built.
 */

import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { site } from "./site"
import {
  fieldOn,
  ownOn,
  type Shown,
  showAppearances,
  untilOn,
} from "./theme-page"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

if (!existsSync(`${ROOT}documentation/dist/theme-builder/index.html`)) {
  console.error(
    "✗ dist/theme-builder/index.html is not built. The site is built with bun run build.",
  )
  process.exit(1)
}

const APPEARANCES = ["dark", "light"] as const
/** The frames each choice shows, in the order they stand. */
const SHOWS: Record<Shown, string[]> = {
  dark: ["dark"],
  both: ["dark", "light"],
  light: ["light"],
}

const s = await site({ pages: 1 })
const page = s.page
let points = 0
const expect = (claim: boolean, description: string) => {
  points += 1
  if (!claim) s.fail(description)
}
const button = (name: string) => page.getByRole("button", { name, exact: true })

/** Runs in the builder. The choice, where it stands, and the frames. */
function read() {
  const collapsed = (text: string) => text.replace(/\s+/g, " ").trim()
  const shown = (element: Element | null) => element?.checkVisibility() ?? false
  const radios = [
    ...document.querySelectorAll<HTMLInputElement>('input[name="appearances"]'),
  ]
  const group = radios[0]?.closest("fieldset") ?? null
  const tools = document.querySelector(".builder__preview-tools")
  const before = (
    a: Element | null | undefined,
    b: Element | null | undefined,
  ) =>
    a != null &&
    b != null &&
    (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  const again = [...(tools?.querySelectorAll("button") ?? [])].find((b) =>
    /^(start again|undo)$/i.test(collapsed(b.textContent ?? "")),
  )
  const framed = [
    ...(tools?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? []),
  ].find((radio) => radio.name !== "appearances")
  const frames = [
    ...document.querySelectorAll<HTMLIFrameElement>("iframe[data-appearance]"),
  ]
  return {
    radios: radios.map((radio) => ({
      type: radio.type,
      value: radio.value,
      checked: radio.checked,
      label: collapsed(radio.labels?.[0]?.textContent ?? ""),
      shown: shown(radio.labels?.[0] ?? radio),
    })),
    group: {
      toggle: group?.matches(".lt-toggle-group") === true,
      named: collapsed(group?.querySelector("legend")?.textContent ?? ""),
      inTools: tools?.contains(group) === true,
      afterAgain: before(again, group),
      beforeFramed: before(group, framed?.closest("fieldset")),
    },
    /** The frames in the order they stand, with whether each is displayed and where. */
    frames: frames.map((frame) => {
      const figure = frame.closest("figure.builder__frame")
      return {
        appearance: frame.dataset.appearance ?? "",
        figure: figure !== null,
        displayed: shown(frame) && shown(figure),
        left: Math.round(frame.getBoundingClientRect().left),
        width: Math.round(frame.getBoundingClientRect().width),
      }
    }),
    again: collapsed(again?.textContent ?? ""),
  }
}
const now = () => page.evaluate(read)
type State = Awaited<ReturnType<typeof now>>
const until = (done: (state: State) => boolean): Promise<State> =>
  untilOn(page, now, done)
const chosen = (state: State) =>
  state.radios.filter((radio) => radio.checked).map((radio) => radio.value)
const displayed = (state: State) =>
  state.frames
    .filter((frame) => frame.displayed)
    .map((frame) => frame.appearance)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Waits for this choice to stand, with the frames it shows and no other. */
async function shows(what: string, choice: Shown) {
  const state = await until(
    (state) =>
      same(chosen(state), [choice]) && same(displayed(state), SHOWS[choice]),
  )
  expect(
    same(chosen(state), [choice]),
    `${what}: the choice is ${chosen(state).join(", ") || "none"}, expected ${choice}`,
  )
  expect(
    same(displayed(state), SHOWS[choice]),
    `${what}: with ${choice} chosen the frames displayed are ${displayed(state).join(", ") || "none"}, expected ${SHOWS[choice].join(" then ")}`,
  )
  return state
}

/** The document in the frame of an appearance. */
async function framed(appearance: string) {
  const handle = await page
    .locator(`iframe[data-appearance="${appearance}"]`)
    .elementHandle()
  const content = await handle?.contentFrame()
  if (!content) throw new Error(`the ${appearance} frame has no document`)
  return content
}
/** How far the title of a component is from the top of what is seen of a frame, and which title is nearest it. */
async function place(appearance: string, component: string) {
  return (await framed(appearance)).evaluate((name) => {
    const titles = [
      ...document.querySelectorAll<HTMLElement>("[data-component] > h2"),
    ].map((title) => ({
      component:
        title.closest<HTMLElement>("[data-component]")?.dataset.component ?? "",
      top: title.getBoundingClientRect().top,
    }))
    const nearest = titles.reduce(
      (best, title) =>
        Math.abs(title.top) < Math.abs(best.top) ? title : best,
      { component: "", top: Number.POSITIVE_INFINITY },
    )
    return {
      top: titles.find((title) => title.component === name)?.top ?? Number.NaN,
      nearest: nearest.component,
      scrolled: window.scrollY,
    }
  }, component)
}

let places = 0

const code = await s.run(async () => {
  await s.open("/theme-builder/")
  const first = await now()

  // The choice: three radios in LO-TEK's toggle group, where it belongs.
  expect(
    same(
      first.radios.map(({ type, value, label }) => [type, value, label]),
      [
        ["radio", "dark", "Dark"],
        ["radio", "both", "Both"],
        ["radio", "light", "Light"],
      ],
    ) && first.radios.every((radio) => radio.shown),
    `the page does not have the shown radios Dark, Both and Light named "appearances", in that order: ${JSON.stringify(first.radios)}`,
  )
  if (first.radios.length !== 3) return
  expect(
    first.group.toggle && first.group.named !== "",
    `the choice of appearances is not a named toggle group: ${JSON.stringify(first.group)}`,
  )
  expect(
    first.group.inTools && first.group.afterAgain && first.group.beforeFramed,
    `the choice of appearances does not stand in the tools of the preview, between "Start again" and the choice of what is framed: ${JSON.stringify(first.group)}`,
  )
  expect(
    same(
      first.frames.map((frame) => [frame.appearance, frame.figure]),
      APPEARANCES.map((appearance) => [appearance, true]),
    ),
    `the frames are not the dark one and then the light one, each in a figure.builder__frame: ${JSON.stringify(first.frames)}`,
  )

  // Dark on a first visit, and each choice shows its frames and no other.
  await shows("on a first visit", "dark")
  for (const choice of ["both", "light", "both", "dark"] as const) {
    await showAppearances(page, choice)
    const state = await shows(`after ${choice} was chosen`, choice)
    if (choice === "both") {
      const [dark, light] = state.frames
      expect(
        dark.appearance === "dark" &&
          light.appearance === "light" &&
          dark.left + dark.width <= light.left + 1,
        `with both chosen the dark frame does not stand to the left of the light one: ${JSON.stringify(state.frames)}`,
      )
    }
  }
  // A frame alone has the room of both.
  await showAppearances(page, "both")
  const both = await shows("with both chosen", "both")
  await showAppearances(page, "light")
  const alone = await shows("with light chosen", "light")
  const lightBoth =
    both.frames.find((f) => f.appearance === "light")?.width ?? 0
  const lightAlone =
    alone.frames.find((f) => f.appearance === "light")?.width ?? 0
  expect(
    lightAlone > lightBoth * 1.5,
    `the light frame alone is ${lightAlone} pixels wide, and ${lightBoth} beside the dark one: alone it should have the room of both`,
  )

  // The choice is the visitor's: "Start again" and "Undo" leave it, with
  // something to empty and to put back.
  await ownOn(page)("accent").check()
  await fieldOn(page)("accent").fill("#7c3aed")
  await button("Start again").click()
  await until((state) => state.again === "Undo")
  await shows('after "Start again"', "light")
  await button("Undo").click()
  await until((state) => state.again === "Start again")
  await shows('after "Undo"', "light")
  expect(
    (await fieldOn(page)("accent").inputValue()) === "#7c3aed",
    'after "Undo" the accent is not back, so the check did not undo anything',
  )

  // And the browser remembers it over a reload, each of the three.
  for (const choice of ["both", "dark", "light"] as const) {
    await showAppearances(page, choice)
    await shows(`after ${choice} was chosen`, choice)
    await s.open("/theme-builder/")
    await shows(`the page loaded again after ${choice} was chosen`, choice)
  }
  // What is remembered and is none of the three is not believed. The
  // check finds where the page keeps the choice by the value it just kept.
  const kept = await page.evaluate(() =>
    Object.keys(localStorage).filter(
      (key) => localStorage.getItem(key) === "light",
    ),
  )
  expect(
    kept.length === 1,
    `the browser remembers "light" under ${kept.length} names, so the check cannot say where the choice is kept: ${kept.join(", ")}`,
  )
  if (kept.length === 1)
    for (const value of ["sideways", "", "DARK", "both light"]) {
      await page.evaluate(
        ([key, wrong]) => localStorage.setItem(key, wrong),
        [kept[0], value],
      )
      await s.open("/theme-builder/")
      await shows(`with "${value}" remembered as the choice`, "dark")
    }

  /*
   * The place is kept. With a component's title at the top of the frame
   * that is shown, every choice after it has that title at the top of each
   * frame it shows, through every change between the three.
   */
  await showAppearances(page, "dark")
  await shows("before the place is tried", "dark")
  const COMPONENT = "dialog"
  await (await framed("dark")).evaluate((name) => {
    document
      .querySelector(`[data-component="${name}"] > h2`)
      ?.scrollIntoView({ block: "start" })
  }, COMPONENT)
  const start = await untilOn(
    page,
    () => place("dark", COMPONENT),
    (at) => Math.abs(at.top) <= 2 && at.scrolled > 500,
  )
  expect(
    Math.abs(start.top) <= 2 && start.scrolled > 500,
    `the check could not put the title of ${COMPONENT} at the top of the dark frame, far down the sheet: ${JSON.stringify(start)}`,
  )
  for (const choice of [
    "both",
    "light",
    "both",
    "dark",
    "light",
    "dark",
  ] as const) {
    await showAppearances(page, choice)
    await shows(
      `with ${COMPONENT} at the top, after ${choice} was chosen`,
      choice,
    )
    for (const appearance of SHOWS[choice]) {
      const at = await untilOn(
        page,
        () => place(appearance, COMPONENT),
        (at) => Math.abs(at.top) <= 8,
      )
      expect(
        Math.abs(at.top) <= 8 && at.nearest === COMPONENT,
        `after ${choice} was chosen, the title of ${COMPONENT} is ${Math.round(at.top)} pixels from the top of the ${appearance} frame, and ${at.nearest} is the one nearest it`,
      )
      places += 1
    }
  }
})

if (code !== 0) process.exit(code)
if (places !== 8 || points < 50) {
  console.error(
    `✗ The check held the place in ${places} of 8 frames and ${points} points. It has not looked at what it should.`,
  )
  process.exit(1)
}
console.log(
  `✓ The theme builder opens on the dark frame alone, shows the dark, both or the light as chosen with the dark one first, remembers the choice over a reload and through "Start again" and "Undo", believes nothing else that is remembered, and keeps the place in the sheet through ${places} changes of what is shown.`,
)
