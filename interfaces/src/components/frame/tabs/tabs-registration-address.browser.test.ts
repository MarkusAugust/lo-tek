/// <reference path="../../../types/css.d.ts" />

import { afterEach, describe, expect, it } from "vitest"

import "../../../tokens/tokens.css"
import "./tabs.css"

/*
 * The tab that looks selected before the component is registered is the
 * one the component selects, wherever the address points. A document has
 * one address and registers an element once, so every case here is a page
 * of its own: a frame loaded with the address in its URL, as a browser
 * loads a page, with the stylesheets of this file, and with the component
 * loaded into it and registered there after the first measurement.
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

/** A tab list as `tabs()` writes it, with `count` tabs. */
function tabList(
  id: string,
  count: number,
  inPanel: (index: number) => string = () => "",
  host = "",
): string {
  const keys = Array.from({ length: count }, (_, index) => index + 1)
  return `
    <lt-tabs id="${id}"${host}>
      <ul class="lt-tabs__list" aria-label="Parts ${id}">${keys
        .map((key) => `<li><a href="#${id}-${key}">Part ${key}</a></li>`)
        .join("")}</ul>
      ${keys
        .map(
          (key, index) =>
            `<section id="${id}-${key}" class="lt-tabs__panel"><h2 id="${id}-${key}-heading">Part ${key}</h2><p>What part ${key} holds.</p>${inPanel(index)}</section>`,
        )
        .join("")}
    </lt-tabs>
    <p id="after-${id}">The text after ${id}.</p>`
}

/** What a tab list looks like, and where its parts are in the page. */
function measure(page: Document, id: string) {
  const view = page.defaultView as Window
  const host = page.getElementById(id) as HTMLElement
  const own = <T extends Element>(selector: string) =>
    [...host.querySelectorAll<T>(selector)].filter(
      (element) => element.closest("lt-tabs") === host,
    )
  const links = own<HTMLElement>(".lt-tabs__list a")
  const panels = own<HTMLElement>(".lt-tabs__panel")
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
  for (const [index, link] of links.entries())
    boxes[`tab ${index + 1}`] = place(link)
  const after = page.getElementById(`after-${id}`)
  if (after) boxes["the text after"] = place(after)
  return {
    // The weight, the colour and the line under each tab.
    looks: links.map((link) => {
      const style = view.getComputedStyle(link)
      return `${style.fontWeight} ${style.color} ${style.borderBottomColor}`
    }),
    // The heading, not the panel: a panel hidden with `until-found` keeps
    // its box, and only its content is gone.
    shown: panels.flatMap((panel, index) =>
      (panel.firstElementChild as HTMLElement).checkVisibility()
        ? [index + 1]
        : [],
    ),
    boxes,
  }
}

type Measured = ReturnType<typeof measure>

/** The tabs that look unlike most of the others: the ones that look selected. */
function standingOut(looks: string[]): number[] {
  const counts = new Map<string, number>()
  for (const look of looks) counts.set(look, (counts.get(look) ?? 0) + 1)
  const common = [...counts].sort((a, b) => b[1] - a[1])[0][0]
  return looks.flatMap((look, index) => (look === common ? [] : [index + 1]))
}

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
    selectedBefore: standingOut(before.looks),
    selectedAfter: standingOut(after.looks),
    shownBefore: before.shown,
    shownAfter: after.shown,
    looksTheSame: JSON.stringify(before.looks) === JSON.stringify(after.looks),
    moved: moved(before, after),
  }
}

const same = (tab: number) => ({
  selectedBefore: [tab],
  selectedAfter: [tab],
  shownBefore: [tab],
  shownAfter: [tab],
  looksTheSame: true,
  moved: [],
})

async function transition(body: string, hash: string, ids: string[]) {
  const page = await load(body, hash)
  const before = ids.map((id) => measure(page.document, id))
  await page.register()
  return ids.map((id, index) => both(before[index], measure(page.document, id)))
}

describe("the tab that looks selected before registration, by the address", () => {
  it("is the first when the address points to the first panel", async () => {
    const [tabs] = await transition(tabList("file", 3), "#file-1", ["file"])
    expect(tabs).toEqual(same(1))
  })

  it("is the third when the address points to something inside the third panel", async () => {
    const [tabs] = await transition(
      tabList("file", 3, (index) => `<p id="in-${index + 1}">A note.</p>`),
      "#in-3",
      ["file"],
    )
    expect(tabs).toEqual(same(3))
  })

  it("is the first under server-controlled, though the address points to the second panel", async () => {
    const [tabs] = await transition(
      tabList("file", 3, () => "", " server-controlled"),
      "#file-2",
      ["file"],
    )
    expect(tabs).toEqual(same(1))
  })

  it("is the first when the address points outside the tabs", async () => {
    const [tabs] = await transition(
      `${tabList("file", 3)}<p id="elsewhere">Something else on the page.</p>`,
      "#elsewhere",
      ["file"],
    )
    expect(tabs).toEqual(same(1))
  })

  it("is the second in both when the address points to the second panel of tabs in the second panel", async () => {
    const [outer, inner] = await transition(
      tabList("outer", 2, (index) => (index === 1 ? tabList("inner", 2) : "")),
      "#inner-2",
      ["outer", "inner"],
    )
    expect({ outer, inner }).toEqual({ outer: same(2), inner: same(2) })
  })

  it("is the tenth of ten, the last place the stylesheet has a line for", async () => {
    const [tabs] = await transition(tabList("file", 10), "#file-10", ["file"])
    expect(tabs).toEqual(same(10))
  })

  /*
   * A known limit. A selector cannot follow a link to its panel, so the
   * stylesheet finds the tab by its place in the row, one line per place,
   * and has lines for ten. With the address at the eleventh panel the
   * panel is right before registration and no tab looks selected, so the
   * eleventh turns semibold and the row moves when the component is
   * registered. The test says what should hold, and fails; when it passes,
   * the limit is gone and `fails` comes off.
   */
  it.fails("is the eleventh when the address points to the eleventh panel", async () => {
    const [tabs] = await transition(tabList("file", 11), "#file-11", ["file"])
    expect(tabs).toEqual(same(11))
  })
})
