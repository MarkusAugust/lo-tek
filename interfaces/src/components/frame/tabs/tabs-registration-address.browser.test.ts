/// <reference path="../../../types/css.d.ts" />

import { afterEach, describe, expect, it } from "vitest"

import { color } from "../../../testing/color"

import "../../../tokens/tokens.css"
import "./tabs.css"

/*
 * Which tab looks selected before the component is registered, and what
 * the reader has in front of them before and after. A document has one
 * address and registers an element once, so every case here is a page of
 * its own: a frame loaded with the address in its URL, as a browser loads
 * a page, with the stylesheets of this file, and with the component loaded
 * into it and registered there after the first measurement.
 *
 * One thing holds in every case: before registration no tab looks selected
 * but the one the component then selects. None may, since a selector
 * cannot follow a link to its panel and the stylesheet marks a tab only
 * where it cannot be wrong. A wrong tab, or two, never.
 */
const COMPONENT = new URL("./lt-tabs.ts", import.meta.url).href

type Loaded = {
  document: Document
  /** Registers `<lt-tabs>` in the page and waits for it to settle. */
  register: () => Promise<void>
}

const frames: HTMLIFrameElement[] = []
const urls: string[] = []

afterEach(() => {
  for (const frame of frames.splice(0)) frame.remove()
  for (const url of urls.splice(0)) URL.revokeObjectURL(url)
})

const painted = (view: Window) =>
  new Promise<void>((done) =>
    view.requestAnimationFrame(() => view.requestAnimationFrame(() => done())),
  )

async function load(body: string, hash: string): Promise<Loaded> {
  const styles = [...document.querySelectorAll("style")]
    .map((style) => `<style>${style.textContent}</style>`)
    .join("")
  const url = URL.createObjectURL(
    new Blob(
      [
        `<!doctype html><html lang="en"><head><meta charset="utf-8">${styles}</head><body>${body}</body></html>`,
      ],
      { type: "text/html" },
    ),
  )
  urls.push(url)
  const frame = document.createElement("iframe")
  frame.style.cssText = "inline-size: 900px; block-size: 600px; border: 0"
  frames.push(frame)
  const loaded = new Promise((done) =>
    frame.addEventListener("load", done, { once: true }),
  )
  frame.src = url + hash
  document.body.append(frame)
  await loaded
  const view = frame.contentWindow as Window & {
    eval: (code: string) => unknown
  }
  await view.document.fonts.ready
  await painted(view)
  expect(view.customElements.get("lt-tabs")).toBeUndefined()
  return {
    document: view.document,
    register: async () => {
      // Loaded in the page itself, so the element is that page's own.
      const module = (await view.eval(
        `import(${JSON.stringify(COMPONENT)})`,
      )) as { defineLtTabs: () => void }
      module.defineLtTabs()
      await view.customElements.whenDefined("lt-tabs")
      await painted(view)
      await painted(view)
    },
  }
}

type Options = {
  id?: string
  count?: number
  /** The tabs in the row, by the number of the panel each leads to. */
  order?: number[]
  /** What the first `<li>` holds, when that is not a tab. */
  first?: string
  /** Attributes on a tab, by the number of its panel. */
  tab?: Record<number, string>
  /** Attributes on a panel, by its number. */
  panel?: Record<number, string>
  /** Where the panels are: in the element, in a `<div>` in it, or after it. */
  panels?: "inside" | "wrapped" | "outside"
  host?: string
  nav?: boolean
  inPanel?: (number: number) => string
}

/** A tab list as `tabs()` writes it, and what a case adds to that. */
function tabList({
  id = "t",
  count = 3,
  order,
  first,
  tab = {},
  panel = {},
  panels = "inside",
  host = "",
  nav = false,
  inPanel = () => "",
}: Options = {}): string {
  const numbers = Array.from({ length: count }, (_, index) => index + 1)
  const items = (order ?? numbers)
    .map(
      (number) =>
        `<li><a href="#${id}-p${number}"${tab[number] ?? ""}>Part ${number}</a></li>`,
    )
    .join("")
  const list = `<ul class="lt-tabs__list" aria-label="Parts ${id}">${first ? `<li>${first}</li>` : ""}${items}</ul>`
  const sections = numbers
    .map(
      (number) =>
        `<section id="${id}-p${number}" class="lt-tabs__panel"${panel[number] ?? ""}><h2>Part ${number}</h2><p>What part ${number} holds.</p>${inPanel(number)}</section>`,
    )
    .join("")
  return `
    <lt-tabs id="${id}"${host}>
      ${nav ? `<nav>${list}</nav>` : list}
      ${panels === "inside" ? sections : ""}
      ${panels === "wrapped" ? `<div>${sections}</div>` : ""}
    </lt-tabs>
    ${panels === "outside" ? sections : ""}
    <p id="after-${id}">The text after ${id}.</p>`
}

const STRONG = color("--lt-color-neutral-text-strong")

/** What a tab list looks like, and where its parts are in the page. */
function measure(page: Document, id: string) {
  const view = page.defaultView as Window
  const host = page.getElementById(id) as HTMLElement
  // What stands in the row: the tabs, and anything else a first item holds.
  const row = [
    ...host.querySelectorAll<HTMLElement>(".lt-tabs__list li > *"),
  ].filter((element) => element.closest("lt-tabs") === host)
  const name = (element: Element) =>
    element.getAttribute("href") ?? `<${element.localName}>`
  const place = (element: Element) => {
    const rect = element.getBoundingClientRect()
    return [
      rect.x + view.scrollX,
      rect.y + view.scrollY,
      rect.width,
      rect.height,
    ]
  }
  const boxes: Record<string, number[]> = { "lt-tabs": place(host) }
  for (const element of row) boxes[`the tab ${name(element)}`] = place(element)
  const after = page.getElementById(`after-${id}`)
  if (after) boxes["the text after"] = place(after)
  const styles = row.map((element) => view.getComputedStyle(element))
  return {
    // The weight, the colour and the line under each tab.
    looks: styles.map(
      (style) =>
        `${style.fontWeight} ${style.color} ${style.borderBottomColor}`,
    ),
    // A tab looks selected when it has any of the three things the
    // stylesheet gives the selected one: the weight, the colour of text
    // and not of a link, or a line under it that can be seen.
    looksSelected: row.flatMap((element, index) => {
      const style = styles[index]
      const line = style.borderBottomColor
      const lined =
        Number.parseFloat(style.borderBottomWidth) > 0 &&
        line !== "transparent" &&
        !/, 0\)$/.test(line)
      return Number.parseInt(style.fontWeight, 10) >= 600 ||
        style.color === STRONG ||
        lined
        ? [name(element)]
        : []
    }),
    // What the component says is selected, once it is registered.
    selected: row.flatMap((element) =>
      element.getAttribute("aria-selected") === "true" ? [name(element)] : [],
    ),
    // The heading, not the panel: a panel hidden with `until-found` keeps
    // its box, and only its content is gone.
    shown: [...page.querySelectorAll<HTMLElement>(`[id^="${id}-p"]`)].flatMap(
      (panel) =>
        panel.matches(".lt-tabs__panel") &&
        (panel.firstElementChild as HTMLElement).checkVisibility()
          ? [panel.id]
          : [],
    ),
    boxes,
  }
}

type Measured = ReturnType<typeof measure>

function moved(before: Measured, after: Measured): string[] {
  const sides = ["x", "y", "width", "height"]
  return Object.entries(before.boxes).flatMap(([label, was]) =>
    was.flatMap((value, side) => {
      const now = after.boxes[label][side]
      return Math.abs(now - value) > 0.5
        ? [`${label}: ${sides[side]} ${value.toFixed(1)} -> ${now.toFixed(1)}`]
        : []
    }),
  )
}

/** Before and after registration, side by side, for one tab list. */
function both(before: Measured, after: Measured) {
  return {
    looksSelectedBefore: before.looksSelected,
    selectedAfter: after.selected,
    looksSelectedAfter: after.looksSelected,
    shownBefore: before.shown,
    shownAfter: after.shown,
    looksTheSame: JSON.stringify(before.looks) === JSON.stringify(after.looks),
    moved: moved(before, after),
  }
}

type Seen = ReturnType<typeof both>

type Case = {
  title: string
  body: string
  hash: string
  /** The tab lists in the page. One, unless they are nested. */
  ids?: string[]
}

/** Loads the case once, however many tests ask about it. */
function seenIn({ body, hash, ids = ["t"] }: Case): () => Promise<Seen[]> {
  let seen: Promise<Seen[]> | undefined
  return () => {
    seen ??= (async () => {
      const page = await load(body, hash)
      const before = ids.map((id) => measure(page.document, id))
      await page.register()
      return ids.map((id, index) =>
        both(before[index], measure(page.document, id)),
      )
    })()
    return seen
  }
}

/** No tab looks selected before registration but the one selected after. */
function expectNoWrongTab(seen: Seen[]): void {
  for (const tabs of seen) {
    expect(
      tabs.selectedAfter.length,
      `tabs selected after registration: ${tabs.selectedAfter}`,
    ).toBeLessThanOrEqual(1)
    expect(
      [[], tabs.selectedAfter],
      `looks selected before registration: [${tabs.looksSelectedBefore}], selected after: [${tabs.selectedAfter}]`,
    ).toContainEqual(tabs.looksSelectedBefore)
    // And after registration the look says what the component says.
    expect(tabs.looksSelectedAfter).toEqual(tabs.selectedAfter)
  }
}

function expectSamePanels(seen: Seen[]): void {
  for (const tabs of seen) {
    expect(tabs.shownBefore).toEqual(tabs.shownAfter)
    expect(tabs.shownAfter.length).toBe(1)
  }
}

/** The reader sees no change at all: the same tab marked, and nothing moved. */
function expectNoChange(seen: Seen[]): void {
  for (const tabs of seen)
    expect({
      marked: tabs.looksSelectedBefore,
      looksTheSame: tabs.looksTheSame,
      moved: tabs.moved,
    }).toEqual({ marked: tabs.selectedAfter, looksTheSame: true, moved: [] })
}

const NOTE = (number: number) => `<p id="in-${number}">A note.</p>`
const SERVER_SECOND = {
  tab: { 2: ' aria-selected="true"' },
  panel: { 1: " hidden", 3: " hidden" },
}

/* Fully right: the same tab marked before and after, and nothing moves. */
const RIGHT: Case[] = [
  { title: "the plain recipe", body: tabList(), hash: "" },
  {
    title: "server-controlled with the plain recipe",
    body: tabList({ host: " server-controlled" }),
    hash: "",
  },
  {
    title:
      "server-controlled with the address at the second panel, which it ignores",
    body: tabList({ host: " server-controlled" }),
    hash: "#t-p2",
  },
  {
    title: "the address pointing outside the tabs",
    body: `${tabList()}<p id="elsewhere">Something else on the page.</p>`,
    hash: "#elsewhere",
  },
  {
    title: "a selection the server wrote with hidden and aria-selected",
    body: tabList(SERVER_SECOND),
    hash: "",
  },
]

/*
 * The known limit. When the address points into a panel the stylesheet
 * shows that panel, as the component will, and marks no tab: it cannot
 * tell which tab leads to the panel. The tab turns semibold and the row
 * moves when the component is registered. The tests of "no change" say
 * what should hold, and fail; when one passes, the limit is gone for that
 * case and `fails` comes off.
 */
const ADDRESSED: Case[] = [
  { title: "the address at the first panel", body: tabList(), hash: "#t-p1" },
  { title: "the address at the second panel", body: tabList(), hash: "#t-p2" },
  {
    title: "the address at something inside the third panel",
    body: tabList({ inPanel: NOTE }),
    hash: "#in-3",
  },
  {
    title:
      "tabs in the second panel of tabs, the address at the inner second panel",
    body: tabList({
      id: "outer",
      count: 2,
      inPanel: (number) =>
        number === 2 ? tabList({ id: "inner", count: 2 }) : "",
    }),
    hash: "#inner-p2",
    ids: ["outer", "inner"],
  },
  {
    title: "ten tabs, the address at the tenth panel",
    body: tabList({ count: 10 }),
    hash: "#t-p10",
  },
  {
    title: "eleven tabs, the address at the eleventh panel",
    body: tabList({ count: 11 }),
    hash: "#t-p11",
  },
]

/*
 * Markup where the first tab in the row is not the tab of the first panel,
 * or where the server has said something the stylesheet has to read. Here
 * the one thing asked is that no wrong tab is marked.
 */
const OTHERS: Case[] = [
  {
    title:
      "the server's selection of the second tab, with the panels after the element",
    body: tabList({ ...SERVER_SECOND, panels: "outside" }),
    hash: "",
  },
  {
    title:
      "the server's selection of the second tab, with the panels in a div in the element",
    body: tabList({ ...SERVER_SECOND, panels: "wrapped" }),
    hash: "",
  },
  {
    title: "aria-selected on the second tab and hidden nowhere",
    body: tabList({ tab: SERVER_SECOND.tab }),
    hash: "",
  },
  {
    title: "the tabs in another order than the panels",
    body: tabList({ order: [3, 1, 2] }),
    hash: "",
  },
  {
    title:
      "the tabs in another order than the panels, the address at the third panel",
    body: tabList({ order: [3, 1, 2] }),
    hash: "#t-p3",
  },
  {
    title: "a first item that is a link to another page",
    body: tabList({ first: '<a href="/help">Help</a>' }),
    hash: "",
  },
  {
    title:
      "a first item that is a link to another page, the address at the second panel",
    body: tabList({ first: '<a href="/help">Help</a>' }),
    hash: "#t-p2",
  },
  {
    title: "a first item that is a span",
    body: tabList({ first: "<span>Parts</span>" }),
    hash: "",
  },
  {
    title: "a first item that is a span, the address at the second panel",
    body: tabList({ first: "<span>Parts</span>" }),
    hash: "#t-p2",
  },
  {
    title: "a first tab that is disabled",
    body: tabList({ tab: { 1: ' aria-disabled="true"' } }),
    hash: "",
  },
  {
    title: "the address at the panel of a tab that is disabled",
    body: tabList({ tab: { 2: ' aria-disabled="true"' } }),
    hash: "#t-p2",
  },
  {
    title: "hidden on the first and the third panel and no aria-selected",
    body: tabList({ panel: SERVER_SECOND.panel }),
    hash: "",
  },
  { title: "the list in a nav", body: tabList({ nav: true }), hash: "" },
  {
    title:
      "the panels in a div in the element, the address at the second panel",
    body: tabList({ panels: "wrapped" }),
    hash: "#t-p2",
  },
]

describe("the transition from tabs.css to the component, page by page", () => {
  for (const [cases, kind] of [
    [RIGHT, "right"],
    [ADDRESSED, "addressed"],
    [OTHERS, "other"],
  ] as const)
    for (const each of cases)
      describe(each.title, () => {
        const seen = seenIn(each)

        it("marks no tab before registration but the one that is selected after it", async () => {
          expectNoWrongTab(await seen())
        })

        if (kind !== "other")
          it("shows the same panel before and after registration", async () => {
            expectSamePanels(await seen())
          })

        if (kind === "right")
          it("marks the same tab before and after registration, and moves nothing", async () => {
            expectNoChange(await seen())
          })

        if (kind === "addressed")
          it.fails("marks the same tab before and after registration, and moves nothing", async () => {
            expectNoChange(await seen())
          })
      })
})
