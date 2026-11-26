/// <reference path="../../../types/css.d.ts" />

import { beforeAll, describe, expect, it } from "vitest"

import { mount, waitForPaint } from "../../../testing/a11y"
import { goTo } from "../../../testing/address"
import { attr } from "../../../testing/markup"
import { defineLtTabs } from "./lt-tabs"
import { tabs } from "./tabs"

import "../../../tokens/tokens.css"
import "./tabs.css"

/*
 * The file runs in its own frame, so `lt-tabs` is unregistered until
 * `beforeAll` registers it, once. What the reader has in front of them
 * before that, from `tabs.css` alone, is what they have afterwards: nothing
 * moves and nothing changes size, so the content does not jump when the
 * script arrives. Every case stands on the page from the start, in a box of
 * its own that the others cannot push, and is measured in that box before
 * and after the one registration.
 */
const KEYS = ["claim", "attachments", "messages"]
const WORDS = ["Claim", "Attachments", "Messages"]

type Case = {
  /** What the server wrote, beyond the plain recipe. */
  host?: string
  /** The index of the panel the server marked as the selected one. */
  server?: number
  /** The panel that is shown, before and after. */
  shown: number
}

const CASES: Record<string, Case> = {
  plain: { shown: 0 },
  address: { shown: 1 },
  server: { server: 1, shown: 1 },
  controlled: { host: " server-controlled", server: 2, shown: 2 },
  "controlled-plain": { host: " server-controlled", shown: 0 },
}

function markup(name: string, { host = "", server }: Case): string {
  const built = tabs({ id: name, keys: KEYS, label: "Parts of the claim" })
  const links = built.tabs
    .map(
      (link, index) =>
        `<li><a ${attr(link)}${server === index ? ' aria-selected="true"' : ""}>${WORDS[index]}</a></li>`,
    )
    .join("")
  // Panels of different heights, so the wrong one shown is seen in the size.
  const panels = built.panels
    .map(
      (panel, index) =>
        `<section ${attr(panel)}${server !== undefined && server !== index ? " hidden" : ""}>
          <h2 ${attr(built.headings[index])}>${WORDS[index]}</h2>
          ${"<p>What this part of the claim holds.</p>".repeat(index + 1)}
        </section>`,
    )
    .join("")
  return `
    <div class="case" id="case-${name}">
      <lt-tabs${host}><ul ${attr(built.list)}>${links}</ul>${panels}</lt-tabs>
      <p id="${name}-after">The text after the tabs.</p>
    </div>`
}

type Box = { x: number; y: number; width: number; height: number }

/** Where everything in a case is, in the case's own box, and what is shown. */
function measure(name: string) {
  const box = document.getElementById(`case-${name}`) as HTMLElement
  const origin = box.getBoundingClientRect()
  const boxes: Record<string, Box> = {}
  const place = (label: string, element: Element) => {
    const rect = element.getBoundingClientRect()
    boxes[label] = {
      x: rect.x - origin.x,
      y: rect.y - origin.y,
      width: rect.width,
      height: rect.height,
    }
  }
  const links = [...box.querySelectorAll<HTMLElement>(".lt-tabs__list a")]
  const panels = [...box.querySelectorAll<HTMLElement>(".lt-tabs__panel")]
  // The heading, not the panel: a panel hidden with `until-found` keeps its
  // box, and only its content is gone.
  const shown = panels.flatMap((panel, index) =>
    (panel.firstElementChild as HTMLElement).checkVisibility() ? [index] : [],
  )
  place("lt-tabs", box.querySelector("lt-tabs") as Element)
  place("the tab list", box.querySelector(".lt-tabs__list") as Element)
  for (const [index, link] of links.entries())
    place(`the tab ${WORDS[index]}`, link)
  for (const index of shown) place("the shown panel", panels[index])
  place("the text after", document.getElementById(`${name}-after`) as Element)
  return {
    boxes,
    shown,
    // The weight, the colour and the line under each tab.
    looks: links.map((link) => {
      const style = getComputedStyle(link)
      return `${style.fontWeight} ${style.color} ${style.borderBottomColor}`
    }),
  }
}

type Measured = ReturnType<typeof measure>

/** What moved or changed size by more than half a pixel, in words. */
function moved(before: Measured, after: Measured): string[] {
  const said: string[] = []
  for (const [label, was] of Object.entries(before.boxes)) {
    const now = after.boxes[label]
    if (!now) {
      said.push(`${label} is gone`)
      continue
    }
    for (const side of ["x", "y", "width", "height"] as const)
      if (Math.abs(now[side] - was[side]) > 0.5)
        said.push(
          `${label}: ${side} ${was[side].toFixed(1)} -> ${now[side].toFixed(1)}`,
        )
  }
  return said
}

const before: Record<string, Measured> = {}
const after: Record<string, Measured> = {}

beforeAll(async () => {
  expect(customElements.get("lt-tabs")).toBeUndefined()
  mount(`
    <style>.case { position: absolute; inset-inline-start: 16px; inline-size: 600px }</style>
    ${Object.entries(CASES)
      .map(([name, options]) => markup(name, options))
      .join("")}
  `)
  for (const [index, name] of Object.keys(CASES).entries())
    (document.getElementById(`case-${name}`) as HTMLElement).style.top =
      `${16 + index * 500}px`
  // The address points at the second panel of one case, and at nothing in
  // the others.
  await goTo("#address-attachments")
  await document.fonts.ready
  await waitForPaint()
  await waitForPaint()
  for (const name of Object.keys(CASES)) before[name] = measure(name)

  defineLtTabs()
  await customElements.whenDefined("lt-tabs")
  await waitForPaint()
  await waitForPaint()
  await waitForPaint()
  for (const name of Object.keys(CASES)) after[name] = measure(name)
})

describe("the transition from tabs.css to the component, measured", () => {
  for (const [name, title] of [
    ["plain", "the plain recipe"],
    ["address", "the plain recipe with the address at the second panel"],
    ["server", "a selection the server wrote with hidden and aria-selected"],
    ["controlled", "server-controlled with the server's selection"],
    ["controlled-plain", "server-controlled with the plain recipe"],
  ])
    describe(title, () => {
      it("shows the same panel before and after registration", () => {
        expect({
          before: before[name].shown,
          after: after[name].shown,
        }).toEqual({ before: [CASES[name].shown], after: [CASES[name].shown] })
      })

      it("moves nothing and changes the size of nothing at registration", () => {
        expect(moved(before[name], after[name])).toEqual([])
      })

      it("has the weight, the colour and the line on every tab before registration that it has after", () => {
        expect(before[name].looks).toEqual(after[name].looks)
        // And the tab of the shown panel is the one that stands out.
        const selected = after[name].looks[CASES[name].shown]
        expect(after[name].looks.filter((look) => look === selected)).toEqual([
          selected,
        ])
      })
    })
})

/*
 * After registration, whichever tab is selected: what follows the tabs
 * stands as far under the last line of the shown panel for the last tab as
 * for the first. The last panel has nothing after it, and the margin under
 * its last line went out through the component, while the panels before it
 * had a hidden panel after them that kept theirs in.
 */
describe("the text after the tabs, tab by tab", () => {
  it("stands the same distance under the shown panel's last line for every tab", async () => {
    mount(markup("each", { shown: 0 }))
    await waitForPaint()
    await waitForPaint()
    const box = document.getElementById("case-each") as HTMLElement
    const after = document.getElementById("each-after") as HTMLElement
    const distances: number[] = []
    for (const link of box.querySelectorAll<HTMLElement>(".lt-tabs__list a")) {
      link.click()
      await waitForPaint()
      await waitForPaint()
      const shown = [
        ...box.querySelectorAll<HTMLElement>(".lt-tabs__panel"),
      ].filter((panel) =>
        (panel.firstElementChild as HTMLElement).checkVisibility(),
      )
      expect(shown.map((panel) => panel.id)).toEqual([
        link.getAttribute("href")?.slice(1),
      ])
      const last = shown[0].lastElementChild as HTMLElement
      distances.push(
        Math.round(
          (after.getBoundingClientRect().top -
            last.getBoundingClientRect().bottom) *
            10,
        ) / 10,
      )
    }
    expect(distances).toEqual([distances[0], distances[0], distances[0]])
    expect(distances[0]).toBeGreaterThan(0)
  })
})
