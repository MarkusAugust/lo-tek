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

import { existsSync, readFileSync } from "node:fs"
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

/** The component that counts as where a frame is, the columns of the frame, and where one component is. */
async function columnsAt(appearance: string, component = "") {
  return (await framed(appearance)).evaluate((name) => {
    const sections = [
      ...document.querySelectorAll<HTMLElement>("main [data-component]"),
    ]
    const of = (section: HTMLElement | undefined) => ({
      component: section?.dataset.component ?? "",
      top: section?.getBoundingClientRect().top ?? Number.NaN,
      bottom: section?.getBoundingClientRect().bottom ?? Number.NaN,
      title:
        section?.querySelector(":scope > h2")?.getBoundingClientRect().top ??
        Number.NaN,
    })
    const lefts = [
      ...new Set(
        sections.map((section) =>
          Math.round(section.getBoundingClientRect().left),
        ),
      ),
    ].sort((a, b) => a - b)
    return {
      columns: lefts.length,
      /** The components of the first column, from the top down. */
      firstColumn: sections
        .filter(
          (section) =>
            Math.round(section.getBoundingClientRect().left) === lefts[0],
        )
        .map((section) => section.dataset.component ?? ""),
      // Document order is column order: the first component whose bottom
      // is below the top of the frame is the one at the top of the first
      // column.
      counts: of(
        sections.find((section) => section.getBoundingClientRect().bottom > 1),
      ).component,
      one: of(sections.find((section) => section.dataset.component === name)),
      scrolled: window.scrollY,
    }
  }, component)
}
/** Which page the frames show: the radio of the view, by its label. */
const showView = (view: "sheet" | "page") =>
  page.locator(`label:has(input[name="view"][value="${view}"])`).click()
/** Waits until both frames hold this page of the site, loaded. */
async function frameOn(path: string) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const urls = await Promise.all(
      APPEARANCES.map(async (a) => new URL((await framed(a)).url()).pathname),
    )
    if (urls.every((url) => url === path)) break
    await page.waitForTimeout(100)
  }
  for (const appearance of APPEARANCES)
    await (await framed(appearance)).waitForLoadState("load")
}

let widths = 0
let crossed = 0

const code = await s.run(async () => {
  // As it is served, before any script has run: the frame the page does
  // not open with is not displayed. Otherwise it is laid out and seen
  // until the script takes it away.
  const served = readFileSync(
    `${ROOT}documentation/dist/theme-builder/index.html`,
    "utf8",
  )
  const figures = [
    ...served.matchAll(
      /<figure\b([^>]*\bclass="[^"]*\bbuilder__frame\b[^"]*"[^>]*)>([\s\S]*?)<\/figure>/g,
    ),
  ].map(([, attributes, inside]) => ({
    appearance: /data-appearance="([a-z]+)"/.exec(inside)?.[1] ?? "",
    hidden:
      /\bstyle="[^"]*display:\s*none/.test(attributes) ||
      /\bhidden\b/.test(attributes),
  }))
  expect(
    JSON.stringify(figures) ===
      JSON.stringify([
        { appearance: "dark", hidden: false },
        { appearance: "light", hidden: true },
      ]),
    `as served, the frames are ${JSON.stringify(figures)}: expected the dark one displayed and the light one not, before any script`,
  )

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

  /*
   * The same in a window where a frame alone has room for more than one
   * column. Then what is in the middle of the top edge is in another
   * column than the one the visitor reads from, and the place that counts
   * is the top of the first: the component there before a change is at the
   * top of every shown frame after it.
   */
  for (const [width, wanted] of [
    [1440, 2],
    [1728, 3],
  ]) {
    await page.setViewportSize({ width, height: 900 })
    await showAppearances(page, "dark")
    await shows(`at ${width} pixels wide`, "dark")
    await (await framed("dark")).evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(300)
    const laid = await columnsAt("dark")
    expect(
      laid.columns === wanted,
      `at ${width} pixels wide the dark frame alone has ${laid.columns} columns, and the check is written for ${wanted}`,
    )
    if (laid.columns < 2) continue
    // A component from the middle of the first column, once with its title
    // at the top and once with the top a third of the way into it.
    const component = laid.firstColumn[Math.floor(laid.firstColumn.length / 2)]
    for (const into of [0, 1 / 3]) {
      const how =
        into === 0
          ? `with the top of ${component} at the top`
          : `with the top a third into ${component}`
      await showAppearances(page, "dark")
      await shows(`at ${width} pixels wide, before the place is tried`, "dark")
      await (await framed("dark")).evaluate(
        ([name, part]) => {
          const section = document.querySelector<HTMLElement>(
            `[data-component="${name}"]`,
          )
          const box = section?.getBoundingClientRect()
          window.scrollTo(
            0,
            window.scrollY +
              (box?.top ?? 0) +
              (box?.height ?? 0) * Number(part),
          )
        },
        [component, into] as const,
      )
      const before = await untilOn(
        page,
        () => columnsAt("dark", component),
        (at) => at.counts === component && at.scrolled > 300,
      )
      expect(
        before.counts === component && before.scrolled > 300,
        `at ${width} pixels wide the check could not put ${component} at the top of the first column: ${JSON.stringify(before)}`,
      )
      for (const choice of ["both", "light", "dark"] as const) {
        await showAppearances(page, choice)
        await shows(
          `at ${width} pixels wide, ${how}, after ${choice} was chosen`,
          choice,
        )
        for (const appearance of SHOWS[choice]) {
          const held = (at: Awaited<ReturnType<typeof columnsAt>>) =>
            into === 0
              ? Math.abs(at.one.top) <= 8
              : at.one.top <= 8 && at.one.bottom > 8
          await untilOn(page, () => columnsAt(appearance, component), held)
          // And it stays: a frame that is put right and then drawn along
          // by the other has not kept the place.
          await page.waitForTimeout(500)
          const at = await columnsAt(appearance, component)
          expect(
            held(at),
            `at ${width} pixels wide, ${how} of the dark frame alone: after ${choice} was chosen ${component} is not at the top of the ${appearance} frame, its top is ${Math.round(at.one.top)} pixels from it and ${at.counts} is there`,
          )
        }
      }
    }
    widths += 1
  }
  await page.setViewportSize({ width: 1280, height: 720 })

  /*
   * The place belongs to the page it was noted in. After another page is
   * framed, the frames are at its top, and stay there through a change of
   * what is shown: nothing has been scrolled in the new page, so nothing
   * of the old one's place is to be found in it.
   */
  const tops = async () =>
    Promise.all(
      APPEARANCES.map(async (a) =>
        Math.round(await (await framed(a)).evaluate(() => window.scrollY)),
      ),
    )
  for (const [from, to, depths] of [
    ["sheet", "page", [60, 140, 240, 360, 520, 900, 2400]],
    ["page", "sheet", [80, 200, 400, 700, 1100]],
  ] as const) {
    const paths = {
      sheet: "/theme-builder/sheet/",
      page: "/theme-builder/page/",
    }
    for (const depth of depths) {
      await showAppearances(page, "dark")
      await showView(from)
      await frameOn(paths[from])
      await (await framed("dark")).evaluate((y) => window.scrollTo(0, y), depth)
      await page.waitForTimeout(250)
      await showView(to)
      await frameOn(paths[to])
      await page.waitForTimeout(250)
      const opened = await tops()
      expect(
        opened.every((y) => y === 0),
        `from ${depth} pixels down the ${from} view, the ${to} view opens with the frames at ${opened.join(" and ")} pixels, expected the top`,
      )
      for (const choice of ["both", "light", "dark"] as const) {
        await showAppearances(page, choice)
        await shows(`in the ${to} view, after ${choice} was chosen`, choice)
        await page.waitForTimeout(250)
        const after = await tops()
        expect(
          after.every((y) => y === 0),
          `from ${depth} pixels down the ${from} view, in the ${to} view after ${choice} was chosen: the frames are at ${after.join(" and ")} pixels, and nothing was scrolled there`,
        )
      }
      crossed += 1
    }
  }
  await showView("sheet")
})

if (code !== 0) process.exit(code)
if (places !== 8 || widths !== 2 || crossed !== 12 || points < 150) {
  console.error(
    `✗ The check held the place in ${places} of 8 frames, at ${widths} of 2 widths and across ${crossed} of 12 changes of view, and ${points} points. It has not looked at what it should.`,
  )
  process.exit(1)
}
console.log(
  `✓ The theme builder opens on the dark frame alone, shows the dark, both or the light as chosen with the dark one first, remembers the choice over a reload and through "Start again" and "Undo", believes nothing else that is remembered, and keeps the place in the sheet through ${places} changes of what is shown.`,
)
