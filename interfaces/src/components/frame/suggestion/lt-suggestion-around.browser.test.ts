/// <reference path="../../../types/css.d.ts" />

/*
 * What an open list does to the page around the field, held with a real
 * pointer and a real keyboard.
 *
 * The list itself sits in the top layer and moves nothing. Two things beside
 * it did. The message that nothing matches stood in the flow and pushed
 * everything below the field down while it was shown, so a press on a
 * button there landed on the button and the release beside it, and no click
 * arrived. And a list tall enough to scroll was a tab stop of its own in
 * Chromium, so Tab from the field went to the list and not on.
 *
 * The message belongs where the list is: below the field, as wide as the
 * field, above everything and clipped by nothing. Then it lies over what is
 * below the field, as the list does, and a press on it is a press on it.
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { page, userEvent } from "vitest/browser"

import { mount, waitForPaint } from "../../../testing/a11y"
import { attr } from "../../../testing/markup"
import { morph } from "../../../testing/update"
import { defineLtSuggestion, type LtSuggestion } from "./lt-suggestion"
import { suggestion } from "./suggestion"

import "../../../tokens/tokens.css"
import "./suggestion.css"
import "../../css/button/button.css"
import "../dialog/dialog.css"

const NAMES = [
  "Glasscutter",
  "Corkscrew",
  "Saltwater",
  "Needle",
  "Crowbar",
  "Lantern",
  "Hinge",
  "Rivet",
  "Bellows",
  "Anvil",
  "Tinder",
  "Marrow",
]

async function paint() {
  await customElements.whenDefined("lt-suggestion")
  await waitForPaint()
}

/**
 * A field with this many options, with a text field before it and one
 * after it, then a button and a line of text. `prefiltered` is the app
 * filtering itself, with a message of its own that it hides or shows.
 */
function fieldBetween(options: {
  count: number
  prefiltered?: boolean
  pending?: boolean
}) {
  const built = suggestion({
    id: "breaker",
    keys: NAMES.slice(0, options.count).map((name) => name.toLowerCase()),
    pending: options.pending,
  })
  return `
    <input id="before" aria-label="Runner">
    <lt-suggestion${options.prefiltered ? " prefiltered" : ""}>
      <label ${attr(built.label)}>Breaker</label>
      <div>
        <input ${attr(built.control)} name="breaker">
        <ul ${attr(built.list)}>${built.options
          .map((option, i) => `<li ${attr(option)}>${NAMES[i]}</li>`)
          .join("")}</ul>
        <p ${attr(built.empty)}>No matches</p>
        <span ${attr(built.status)}></span>
      </div>
    </lt-suggestion>
    <input id="next" aria-label="Note">
    <button class="lt-button" type="button" id="below">Save</button>
    <p id="after">The run is logged when it is saved.</p>
    <p style="margin-block-start: 14rem">
      <button class="lt-button" type="button" id="far">Archive</button>
    </p>
  `
}
const parts = () => ({
  host: document.querySelector("lt-suggestion") as LtSuggestion,
  input: document.querySelector("lt-suggestion input") as HTMLInputElement,
  list: document.querySelector("lt-suggestion ul") as HTMLElement,
  empty: document.querySelector(".lt-suggestion__empty") as HTMLElement,
  // Text fields on either side: every browser stops at those on Tab, and
  // one of them does not stop at a button unless it is asked to.
  before: document.getElementById("before") as HTMLInputElement,
  next: document.getElementById("next") as HTMLInputElement,
  below: document.getElementById("below") as HTMLButtonElement,
  after: document.getElementById("after") as HTMLElement,
  /** A button far enough below the field that nothing of the field lies over it. */
  far: document.getElementById("far") as HTMLButtonElement,
})
/** The user writes something nothing matches, with focus in the field. */
async function searchFor(input: HTMLInputElement, text: string) {
  input.focus()
  input.value = text
  input.dispatchEvent(new Event("input", { bubbles: true }))
  await paint()
}
const place = (element: Element) => {
  const { left, top, width, height } = element.getBoundingClientRect()
  return [left, top, width, height].map((n) => Math.round(n * 10) / 10)
}
const isShown = (element: HTMLElement) =>
  element.checkVisibility() && element.getBoundingClientRect().height > 0

/** The contrast between two colours as the browser writes them, as WCAG 2 computes it. */
function contrast(a: string, b: string): number {
  const luminance = (colour: string) => {
    const [r, g, bl] = (colour.match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => {
      const c = Number(v) / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}
/** The first colour behind an element that is not see-through. */
function behind(element: Element): string {
  for (let at: Element | null = element; at; at = at.parentElement) {
    const colour = getComputedStyle(at).backgroundColor
    if (!/rgba\(.*,\s*0\)$|transparent/.test(colour)) return colour
  }
  const page = getComputedStyle(document.documentElement).backgroundColor
  return /rgba\(.*,\s*0\)$|transparent/.test(page)
    ? getComputedStyle(document.documentElement).colorScheme.includes("dark")
      ? "rgb(18, 18, 18)"
      : "rgb(255, 255, 255)"
    : page
}

/** The two ways the message comes to be shown: the component's own filter, and the app's. */
const WAYS = {
  "the component filters": { count: 4 },
  "the app filters, with its own message": { count: 0, prefiltered: true },
} as const

afterEach(() => {
  document.documentElement.style.colorScheme = ""
  for (const dialog of document.querySelectorAll("dialog")) dialog.close()
})

describe("the message that nothing matches moves nothing on the page", () => {
  beforeAll(() => {
    defineLtSuggestion()
  })

  for (const [way, options] of Object.entries(WAYS)) {
    for (const within of ["the page", "a modal dialog"] as const) {
      /** The field, in the page or in a dialog opened modal, at rest. */
      async function opened() {
        const markup = fieldBetween(options)
        mount(
          within === "the page"
            ? markup
            : `<dialog class="lt-dialog" aria-label="Log a run">${markup}</dialog>`,
        )
        if (within !== "the page")
          (document.querySelector("dialog") as HTMLDialogElement).showModal()
        await paint()
        return parts()
      }

      it(`leaves what stands after the field where it is, when ${way}, in ${within}`, async () => {
        const { input, list, empty, below, after } = await opened()
        const closed = { below: place(below), after: place(after) }

        await searchFor(input, "xyz")
        expect(list.hidden, "the list did not open").toBe(false)
        expect(isShown(empty), "the message is not shown").toBe(true)

        expect(
          { below: place(below), after: place(after) },
          "the button and the text below the field moved when the message was shown",
        ).toEqual(closed)
      })

      /** Counts the clicks that arrive on an element. */
      const counted = (element: HTMLElement) => {
        const seen = { clicks: 0 }
        element.addEventListener("click", () => {
          seen.clicks += 1
        })
        return seen
      }

      it(`lets one click through to a button the message does not cover, when ${way}, in ${within}`, async () => {
        const { input, empty, far } = await opened()
        const stood = place(far)
        const onFar = counted(far)

        await searchFor(input, "xyz")
        expect(isShown(empty), "the message is not shown").toBe(true)
        expect(
          place(far),
          "the button moved when the message was shown",
        ).toEqual(stood)
        const covers = empty.getBoundingClientRect()
        const button = far.getBoundingClientRect()
        expect(
          button.top >= covers.bottom || button.left >= covers.right,
          "the test's button is under the message, so it says nothing of a button that is clear of it",
        ).toBe(true)
        // A real press and release.
        await userEvent.click(far)
        await paint()

        expect(onFar.clicks, "clicks that arrived on the button").toBe(1)
      })

      it(`takes a press on the message as a press on the list, when ${way}, in ${within}`, async () => {
        // The message lies over what is below the field, as the open list
        // does. A press there is on the message: it reaches nothing under
        // it, the field keeps the focus and the list stays open.
        const { input, list, empty, below, next } = await opened()
        const under = [counted(below), counted(next)]

        await searchFor(input, "xyz")
        expect(isShown(empty), "the message is not shown").toBe(true)
        await userEvent.click(empty)
        await paint()

        expect(
          under.map((seen) => seen.clicks),
          "clicks that reached what stands under the message",
        ).toEqual([0, 0])
        expect(document.activeElement, "focus left the field").toBe(input)
        expect(list.hidden, "the list closed").toBe(false)
        expect(isShown(empty), "the message went away").toBe(true)
      })

      for (const [how, close] of [
        ["Escape", () => userEvent.keyboard("{Escape}")],
        [
          "focus leaving the field",
          async () => {
            ;(document.getElementById("before") as HTMLElement).focus()
          },
        ],
      ] as const)
        it(`gives the button below back after ${how}, when ${way}, in ${within}`, async () => {
          const { input, list, empty, below } = await opened()
          const stood = place(below)
          const onBelow = counted(below)

          await searchFor(input, "xyz")
          expect(isShown(empty), "the message is not shown").toBe(true)
          await close()
          await paint()
          expect(list.hidden, "the list is still open").toBe(true)
          expect(isShown(empty), "the message is still shown").toBe(false)
          expect(place(below), "the button is not where it stood").toEqual(
            stood,
          )

          await userEvent.click(below)
          await paint()
          expect(onBelow.clicks, "clicks that arrived on the button").toBe(1)
        })

      it(`shows the message where it can be read, when ${way}, in ${within}`, async () => {
        const { host, input, empty } = await opened()
        await searchFor(input, "xyz")

        const box = empty.getBoundingClientRect()
        expect(box.width > 0 && box.height > 0, "the message has no size").toBe(
          true,
        )
        expect(
          box.left >= 0 &&
            box.top >= 0 &&
            box.right <= window.innerWidth &&
            box.bottom <= window.innerHeight,
          `the message reaches outside the window: ${place(empty)}`,
        ).toBe(true)
        // As wide as the field it belongs to, give or take a border.
        expect(
          Math.abs(box.width - input.getBoundingClientRect().width),
          `the message is ${box.width} wide, the field ${input.getBoundingClientRect().width} and its host ${host.getBoundingClientRect().width}`,
        ).toBeLessThanOrEqual(4)
        // Nothing lies over it: the middle of it is the message itself.
        const top = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2,
        )
        expect(
          top !== null && (top === empty || empty.contains(top)),
          `the middle of the message is covered by <${top?.tagName.toLowerCase()} id="${top?.id}">`,
        ).toBe(true)
        // And it can be read, in the light theme and the dark.
        for (const scheme of ["light", "dark"]) {
          document.documentElement.style.colorScheme = scheme
          await waitForPaint()
          const ratio = contrast(getComputedStyle(empty).color, behind(empty))
          expect(
            ratio,
            `in the ${scheme} theme the message is ${getComputedStyle(empty).color} on ${behind(empty)}`,
          ).toBeGreaterThanOrEqual(4.5)
        }
      })
    }

    it(`shows no message while the list is closed, when ${way}`, async () => {
      mount(fieldBetween(options))
      await paint()
      const { input, list, empty, below } = parts()
      expect(list.hidden).toBe(true)
      expect(isShown(empty)).toBe(false)

      // Shown, and then gone again with the list.
      await searchFor(input, "xyz")
      expect(isShown(empty)).toBe(true)
      below.focus()
      await paint()
      expect(list.hidden).toBe(true)
      expect(isShown(empty)).toBe(false)
    })
  }

  it("shows no message while the answer is on its way", async () => {
    mount(fieldBetween({ count: 0, prefiltered: true, pending: true }))
    await paint()
    const { input, list, empty } = parts()

    await searchFor(input, "xyz")

    expect(list.hidden).toBe(false)
    expect(list.getAttribute("aria-busy")).toBe("true")
    expect(isShown(empty)).toBe(false)
  })

  it("leaves the app's own hidden on the message, with the list open", async () => {
    // The app filters and found matches: it hides its message itself.
    mount(fieldBetween({ count: 2, prefiltered: true }))
    await paint()
    const { input, list, empty } = parts()

    await searchFor(input, "g")

    expect(list.hidden).toBe(false)
    expect(empty.hasAttribute("hidden")).toBe(true)
    expect(isShown(empty)).toBe(false)
  })
})

describe("the open list is not a place the keyboard stops at", () => {
  beforeAll(() => {
    defineLtSuggestion()
  })

  /** The field with this many options, the list open with the highlight on the first. */
  async function open(count: number) {
    mount(fieldBetween({ count }))
    await paint()
    const page = parts()
    page.input.focus()
    await userEvent.keyboard("{ArrowDown}")
    await paint()
    expect(page.list.hidden, "the list did not open").toBe(false)
    return page
  }

  for (const count of [2, 4, 12]) {
    it(`goes on to what stands after the field on Tab, with ${count} options`, async () => {
      const { list, next } = await open(count)

      await userEvent.tab()
      await paint()

      expect(
        document.activeElement,
        `focus is on <${document.activeElement?.tagName.toLowerCase()} class="${document.activeElement?.className}">`,
      ).toBe(next)
      expect(list.hidden, "the list is still open").toBe(true)
    })

    it(`goes back to what stands before the field on Shift and Tab, with ${count} options`, async () => {
      const { list, before } = await open(count)

      await userEvent.tab({ shift: true })
      await paint()

      expect(
        document.activeElement,
        `focus is on <${document.activeElement?.tagName.toLowerCase()} class="${document.activeElement?.className}">`,
      ).toBe(before)
      expect(list.hidden, "the list is still open").toBe(true)
    })
  }

  it("does not scroll with the four options it is made to hold", async () => {
    const { list } = await open(4)

    expect(
      list.scrollHeight,
      `the list is ${list.clientHeight} high inside and its options ${list.scrollHeight}`,
    ).toBeLessThanOrEqual(list.clientHeight)
  })

  it("scrolls with twelve, and the arrow keys bring the highlighted option into view", async () => {
    const { input, list } = await open(12)
    expect(list.scrollHeight).toBeGreaterThan(list.clientHeight)

    for (let press = 0; press < 9; press++) {
      await userEvent.keyboard("{ArrowDown}")
      await paint()
      const highlighted = list.querySelector<HTMLElement>(
        '[role="option"][aria-selected="true"]',
      )
      expect(highlighted, "an option is highlighted").not.toBeNull()
      const [option, box] = [
        (highlighted as HTMLElement).getBoundingClientRect(),
        list.getBoundingClientRect(),
      ]
      expect(
        option.top >= box.top - 1 && option.bottom <= box.bottom + 1,
        `${highlighted?.textContent} is not within what is seen of the list after ${press + 1} more presses`,
      ).toBe(true)
      expect(document.activeElement, "focus left the field").toBe(input)
    }
    expect(list.scrollTop).toBeGreaterThan(0)
  })

  it("leaves focus in the field when an option is pressed with the pointer", async () => {
    const { input, list } = await open(12)
    const option = list.querySelectorAll<HTMLElement>('[role="option"]')[2]

    await userEvent.click(option)
    await paint()

    expect(document.activeElement).toBe(input)
    expect(input.value).toBe(NAMES[2])
  })
})

/*
 * The message is placed like the open list: below the field, as wide as the
 * field, above everything, clipped by nothing. A message that is only taken
 * out of the flow is cut off by a dialog or a box that ends under the field,
 * makes them scroll, and lands on the field itself when the host lays its
 * children out another way.
 */
describe("the message that nothing matches is placed like the open list", () => {
  beforeAll(() => {
    defineLtSuggestion()
  })

  /**
   * The field alone, as the app filters it: no matches, so the message is
   * shown as soon as the list opens. `matches` gives it options all the
   * same, for an app that shows its message beside them.
   */
  function fieldAlone(
    options: {
      host?: string
      wrapper?: string
      input?: string
      matches?: number
      /** The field, the list and the message as the host's own children, with no element around them. */
      flat?: boolean
    } = {},
  ) {
    const built = suggestion({
      id: "breaker",
      keys: NAMES.slice(0, options.matches ?? 0).map((n) => n.toLowerCase()),
    })
    const { hidden: _, ...empty } = built.empty
    const inner = `<input ${attr(built.control)} name="breaker"${options.input ? ` style="${options.input}"` : ""}>
          <ul ${attr(built.list)}>${built.options
            .map((option, i) => `<li ${attr(option)}>${NAMES[i]}</li>`)
            .join("")}</ul>
          <p ${attr(empty)}>No matches</p>
          <span ${attr(built.status)}></span>`
    return `
      <lt-suggestion prefiltered${options.host ? ` style="${options.host}"` : ""}>
        <label ${attr(built.label)}>Breaker</label>
        ${options.flat ? inner : `<div${options.wrapper ? ` style="${options.wrapper}"` : ""}>${inner}</div>`}
      </lt-suggestion>`
  }
  const field = () => ({
    host: document.querySelector("lt-suggestion") as LtSuggestion,
    label: document.querySelector("lt-suggestion label") as HTMLElement,
    input: document.querySelector("lt-suggestion input") as HTMLInputElement,
    list: document.querySelector("lt-suggestion ul") as HTMLElement,
    empty: document.querySelector(".lt-suggestion__empty") as HTMLElement,
  })
  /** The list open with nothing found, by the user writing in the field. */
  async function search() {
    const { input, list, empty } = field()
    await searchFor(input, "xyz")
    expect(list.hidden, "the list did not open").toBe(false)
    expect(isShown(empty), "the message is not shown").toBe(true)
  }
  /** What is wrong with where the message stands, measured against the field. */
  function misplaced(): string[] {
    const { input, label, empty } = field()
    const [m, f, l] = [empty, input, label].map((e) =>
      e.getBoundingClientRect(),
    )
    const faults: string[] = []
    if (!(m.width > 0 && m.height > 0)) return ["the message has no size"]
    if (!(m.top >= f.bottom - 1 || m.bottom <= f.top + 1))
      faults.push(
        `the message, from ${Math.round(m.top)} to ${Math.round(m.bottom)}, lies over the field, from ${Math.round(f.top)} to ${Math.round(f.bottom)}`,
      )
    if (
      m.top < l.bottom - 1 &&
      m.bottom > l.top + 1 &&
      m.left < l.right &&
      m.right > l.left
    )
      faults.push(
        `the message, from ${Math.round(m.top)} to ${Math.round(m.bottom)}, lies over the label, from ${Math.round(l.top)} to ${Math.round(l.bottom)}`,
      )
    if (Math.abs(m.width - f.width) > 2 || Math.abs(m.left - f.left) > 2)
      faults.push(
        `the message is ${Math.round(m.width)} wide from ${Math.round(m.left)}, and the field ${Math.round(f.width)} from ${Math.round(f.left)}`,
      )
    if (
      m.left < 0 ||
      m.top < 0 ||
      m.right > window.innerWidth + 1 ||
      m.bottom > window.innerHeight + 1
    )
      faults.push(`the message reaches outside the window: ${place(empty)}`)
    // Seen whole: the middle and a point just inside each corner are the
    // message, and nothing that cuts it off or lies over it.
    for (const [name, x, y] of [
      ["the middle", (m.left + m.right) / 2, (m.top + m.bottom) / 2],
      ["the top left corner", m.left + 3, m.top + 3],
      ["the top right corner", m.right - 3, m.top + 3],
      ["the bottom left corner", m.left + 3, m.bottom - 3],
      ["the bottom right corner", m.right - 3, m.bottom - 3],
    ] as const) {
      const at = document.elementFromPoint(x, y)
      if (at === null || !(at === empty || empty.contains(at)))
        faults.push(
          `${name} of the message is ${at === null ? "outside the window" : `covered or cut off: <${at.tagName.toLowerCase()}${at.id ? ` id="${at.id}"` : ""}${at.className ? ` class="${at.className}"` : ""}> is there`}`,
        )
    }
    return faults
  }

  /** Where the field stands, what ends right under it, and what stands after that. */
  const PLACES: Record<
    string,
    { markup: string; scrolls: string; open?: boolean }
  > = {
    "last in the body of a modal dialog": {
      markup: `<dialog class="lt-dialog" aria-label="Log a run">
        <div class="lt-dialog__body">${fieldAlone()}</div>
        <div class="lt-dialog__footer"><button class="lt-button" type="button" id="after">Save</button></div>
      </dialog>`,
      scrolls: ".lt-dialog__body",
      open: true,
    },
    "last in a plain modal dialog": {
      markup: `<dialog class="lt-dialog" aria-label="Log a run">
        <p id="after">Name the breaker.</p>
        ${fieldAlone()}
      </dialog>`,
      scrolls: "dialog",
      open: true,
    },
    "in a box that hides what reaches out of it": {
      markup: `<div id="box" style="overflow: hidden">${fieldAlone()}</div>
        <p id="after">Below the box.</p>`,
      scrolls: "#box",
    },
    "in a box that scrolls what reaches out of it": {
      markup: `<div id="box" style="overflow: auto">${fieldAlone()}</div>
        <p id="after">Below the box.</p>`,
      scrolls: "#box",
    },
    "at the bottom of the page": {
      markup: `<p id="after">Above the field.</p>
        <div id="box" style="block-size: calc(100vh - 12rem)"></div>
        ${fieldAlone()}`,
      scrolls: "html",
    },
  }

  for (const [where, { markup, scrolls, open }] of Object.entries(PLACES))
    it(`is seen whole, and makes nothing scroll or move, ${where}`, async () => {
      mount(markup)
      if (open)
        (document.querySelector("dialog") as HTMLDialogElement).showModal()
      await paint()
      const container = document.querySelector(scrolls) as HTMLElement
      const after = document.getElementById("after") as HTMLElement
      const sizes = () => ({
        container: [container.scrollHeight, container.scrollWidth],
        page: [
          document.documentElement.scrollHeight,
          document.documentElement.scrollWidth,
        ],
        after: place(after),
      })
      const closed = sizes()

      await search()

      expect(misplaced().join("; ")).toBe("")
      expect(
        sizes(),
        "something scrolls or stands elsewhere while the message is shown",
      ).toEqual(closed)
    })

  for (const [how, options] of Object.entries({
    "the host is a flex column": {
      host: "display: flex; flex-direction: column; gap: 4px",
    },
    "the host is a grid": { host: "display: grid; gap: 4px" },
    "the host is a flex column with the field as its own child": {
      host: "display: flex; flex-direction: column; gap: 4px",
      flat: true,
    },
    "the host is a grid with the field as its own child": {
      host: "display: grid; gap: 4px",
      flat: true,
    },
    "the app has a flex column around field, list and message": {
      wrapper: "display: flex; flex-direction: column; gap: 4px",
    },
  }))
    it(`stands under the field and not over it when ${how}`, async () => {
      mount(`${fieldAlone(options)}<p id="after">Below the field.</p>`)
      await paint()
      const stood = place(document.getElementById("after") as HTMLElement)

      await search()

      expect(misplaced().join("; ")).toBe("")
      expect(place(document.getElementById("after") as HTMLElement)).toEqual(
        stood,
      )
    })

  for (const direction of ["ltr", "rtl"])
    it(`is as wide as the field when the field is narrower than its host, ${direction}`, async () => {
      mount(
        `<div dir="${direction}">${fieldAlone({ input: "inline-size: 12rem" })}</div>`,
      )
      await paint()
      const { host, input } = field()
      expect(
        host.getBoundingClientRect().width -
          input.getBoundingClientRect().width,
        "the field is not narrower than its host, so the test says nothing",
      ).toBeGreaterThan(100)

      await search()

      expect(misplaced().join("; ")).toBe("")
    })

  it("has a ground of its own, and lies over what is raised below the field", async () => {
    mount(`${fieldAlone()}
      <div id="raised" style="position: relative; z-index: 5; background: rgb(200, 200, 200); block-size: 6rem">
        <button class="lt-button" type="button">Save</button>
      </div>`)
    await paint()
    await search()
    const { empty } = field()

    // Read from the message itself: what is behind it must not show through.
    const ground = getComputedStyle(empty).backgroundColor
    const alpha = /^rgba?\(([^)]*)\)$/.exec(ground)?.[1].split(/[,/]/)[3]
    expect(
      ground !== "transparent" && (alpha === undefined || Number(alpha) === 1),
      `the ground of the message is ${ground}`,
    ).toBe(true)
    expect(
      contrast(getComputedStyle(empty).color, ground),
      `the message is ${getComputedStyle(empty).color} on its own ${ground}`,
    ).toBeGreaterThanOrEqual(4.5)
    expect(misplaced().join("; ")).toBe("")
  })

  it("follows the app: hidden on the message and aria-busy on the list, each time in its place", async () => {
    mount(`${fieldAlone()}<p id="after">Below the field.</p>`)
    await paint()
    await search()
    const { list, empty } = field()
    expect(misplaced().join("; ")).toBe("")

    // The app found matches, and then none again.
    for (let round = 0; round < 2; round++) {
      empty.hidden = true
      await paint()
      expect(isShown(empty), "shown with the app's hidden on it").toBe(false)
      empty.hidden = false
      await paint()
      expect(isShown(empty), "not shown after the app took hidden off").toBe(
        true,
      )
      expect(misplaced().join("; ")).toBe("")
    }
    // The app is asking the server, and then has its answer: nothing.
    for (let round = 0; round < 2; round++) {
      list.setAttribute("aria-busy", "true")
      await paint()
      expect(isShown(empty), "shown while the answer is on its way").toBe(false)
      list.removeAttribute("aria-busy")
      await paint()
      expect(isShown(empty), "not shown after the answer came").toBe(true)
      expect(misplaced().join("; ")).toBe("")
    }
  })

  for (const [how, close] of [
    ["Escape", () => userEvent.keyboard("{Escape}")],
    [
      "focus leaving the field",
      async () => (document.getElementById("next") as HTMLElement).focus(),
    ],
    [
      "an option being chosen",
      () =>
        userEvent.click(
          document.querySelector('[role="option"]') as HTMLElement,
        ),
    ],
  ] as const)
    it(`goes when the list closes, by ${how}, and comes back in its place`, async () => {
      // With options beside it: an app may show its message with them.
      mount(`${fieldAlone({ matches: 2 })}<input id="next" aria-label="Note">`)
      await paint()
      const { input, list, empty } = field()
      await searchFor(input, "g")
      expect(list.hidden).toBe(false)
      expect(isShown(empty), "the message is not shown").toBe(true)

      await close()
      await paint()
      expect(list.hidden, "the list is still open").toBe(true)
      expect(isShown(empty), "the message is still shown").toBe(false)

      await searchFor(input, "xyz")
      expect(isShown(empty), "the message did not come back").toBe(true)
      const [m, f] = [empty, input].map((e) => e.getBoundingClientRect())
      expect(
        Math.abs(m.width - f.width) <= 2 && Math.abs(m.left - f.left) <= 2,
        `the message came back ${Math.round(m.width)} wide from ${Math.round(m.left)}, and the field is ${Math.round(f.width)} from ${Math.round(f.left)}`,
      ).toBe(true)
    })

  /** What is wrong with where the options and the message stand together, measured against the field. */
  function together(): string[] {
    const { input, list, empty } = field()
    const [o, m, f] = [list, empty, input].map((e) => e.getBoundingClientRect())
    const span = (box: DOMRect) =>
      `from ${Math.round(box.top)} to ${Math.round(box.bottom)}`
    const over = (a: DOMRect, b: DOMRect) =>
      a.top < b.bottom - 1 &&
      a.bottom > b.top + 1 &&
      a.left < b.right - 1 &&
      a.right > b.left + 1
    const faults: string[] = []
    if (!(o.height > 0)) faults.push("the options are not shown")
    if (!(m.height > 0)) faults.push("the message is not shown")
    if (faults.length > 0) return faults
    for (const [name, box] of [
      ["the options", o],
      ["the message", m],
    ] as const) {
      if (over(box, f))
        faults.push(`${name}, ${span(box)}, lie over the field, ${span(f)}`)
      if (
        box.left < 0 ||
        box.top < 0 ||
        box.right > window.innerWidth + 1 ||
        box.bottom > window.innerHeight + 1
      )
        faults.push(
          `${name}, ${span(box)}, reach outside the window, which is ${window.innerHeight} high`,
        )
    }
    if (over(o, m))
      faults.push(
        `the options, ${span(o)}, and the message, ${span(m)}, lie over each other`,
      )
    const below = (box: DOMRect) => box.top >= f.bottom - 1
    if (below(o) !== below(m))
      faults.push(
        `the options, ${span(o)}, and the message, ${span(m)}, are on different sides of the field, ${span(f)}`,
      )
    else if (below(o) && m.top < o.bottom - 1)
      faults.push(
        `the message, ${span(m)}, does not come after the options, ${span(o)}`,
      )
    return faults
  }

  // With options and the message both shown, an app's choice with
  // `prefiltered`: the two stand together on one side of the field, the
  // message after the options, whatever room there is under the field.
  for (const [room, pixels] of [
    ["room for both under the field", 360],
    ["room for the options and not the message", 104],
    ["room for less than the options", 64],
    ["room for neither", 24],
  ] as const)
    it(`keeps the options and the message together and off the field, with ${room}`, async () => {
      mount(`<p id="after">Above the field.</p>
        <div id="spacer" style="block-size: 10rem"></div>
        ${fieldAlone({ matches: 2 })}`)
      await paint()
      const { input, list, empty } = field()
      // The field this far from the bottom of the window, to the pixel.
      const spacer = document.getElementById("spacer") as HTMLElement
      const under = () =>
        window.innerHeight - input.getBoundingClientRect().bottom
      spacer.style.blockSize = `${spacer.getBoundingClientRect().height + under() - pixels}px`
      await paint()
      expect(
        Math.abs(under() - pixels),
        `the field is ${Math.round(under())} pixels from the bottom of the window, and the test is written for ${pixels}`,
      ).toBeLessThanOrEqual(2)

      await searchFor(input, "g")
      expect(list.hidden, "the list did not open").toBe(false)
      expect(isShown(empty), "the message is not shown").toBe(true)
      // What the names of the cases say there is room for.
      const [o, m] = [list, empty].map((e) => e.getBoundingClientRect().height)
      expect(
        { both: o + m <= pixels, options: o <= pixels },
        `the options are ${Math.round(o)} high and the message ${Math.round(m)}, with ${pixels} pixels under the field`,
      ).toEqual({
        both: pixels === 360,
        options: pixels === 360 || pixels === 104,
      })

      expect(together().join("; ")).toBe("")
    })

  it("puts the options alone right above the field when there is no room under it", async () => {
    // The list is placed against the field's own box, as the panel of a
    // popover is against its button. A label that stands above the field is
    // then under the list while it is open; the field itself never is.
    mount(`<p id="after">Above the field.</p>
      <div id="spacer" style="block-size: 10rem"></div>
      ${fieldAlone({ matches: 2 })}`)
    await paint()
    const { input, list, empty } = field()
    empty.hidden = true
    const spacer = document.getElementById("spacer") as HTMLElement
    spacer.style.blockSize = `${spacer.getBoundingClientRect().height + window.innerHeight - input.getBoundingClientRect().bottom - 24}px`
    await paint()

    await searchFor(input, "g")
    expect(list.hidden, "the list did not open").toBe(false)
    const [o, f] = [list, input].map((e) => e.getBoundingClientRect())
    expect(
      o.bottom <= f.top + 1,
      `the options, from ${Math.round(o.top)} to ${Math.round(o.bottom)}, are not above the field, from ${Math.round(f.top)} to ${Math.round(f.bottom)}`,
    ).toBe(true)
    // Right above it: the small gap the list keeps to the field, and no more.
    expect(
      f.top - o.bottom,
      "how far the options are above the field",
    ).toBeLessThanOrEqual(8)
    expect(
      o.top >= 0 && o.left >= 0 && o.right <= window.innerWidth + 1,
      `the options reach outside the window: from ${Math.round(o.top)} to ${Math.round(o.bottom)}`,
    ).toBe(true)
  })

  it("shows no message when the list is gone, and shows it again when a list comes back", async () => {
    // An app that writes the list only when it has something to list, or
    // an update that drops it.
    mount(`${fieldAlone()}<p id="after">Below the field.</p>`)
    await paint()
    await search()
    const { input, list, empty } = field()
    const again = list.outerHTML

    list.remove()
    await paint()
    expect(isShown(empty), "the message is shown with no list").toBe(false)

    empty.insertAdjacentHTML("beforebegin", again)
    await paint()
    await searchFor(input, "xyzz")
    expect(field().list.hidden, "the list that came back did not open").toBe(
      false,
    )
    expect(isShown(empty), "the message did not come back with the list").toBe(
      true,
    )
    expect(misplaced().join("; ")).toBe("")
  })

  for (const way of ["outerHTML", "a new element in its place"] as const)
    it(`is seen whole after the list is replaced by ${way}, when the component filters`, async () => {
      mount(fieldBetween({ count: 4 }))
      await paint()
      const { input, list, empty } = parts()
      await searchFor(input, "xyz")
      expect(isShown(empty), "the message is not shown").toBe(true)

      if (way === "outerHTML") {
        // The same markup, written anew: the element is another one.
        const markup = list.outerHTML
        list.outerHTML = markup
      } else {
        const fresh = list.cloneNode(true) as HTMLElement
        list.replaceWith(fresh)
      }
      await paint()
      await waitForPaint()

      expect(
        isShown(empty),
        "the message went when the list was replaced",
      ).toBe(true)
      const m = empty.getBoundingClientRect()
      // The top edge too: the list that was opened last lies over it.
      const covered = (
        [
          ["the middle", (m.left + m.right) / 2, (m.top + m.bottom) / 2],
          ["the top edge", (m.left + m.right) / 2, m.top + 1],
          ["the top left corner", m.left + 3, m.top + 3],
          ["the top right corner", m.right - 3, m.top + 3],
          ["the bottom left corner", m.left + 3, m.bottom - 3],
          ["the bottom right corner", m.right - 3, m.bottom - 3],
        ] as const
      ).flatMap(([name, x, y]) => {
        const at = document.elementFromPoint(x, y)
        return at !== null && (at === empty || empty.contains(at))
          ? []
          : [
              `${name} is <${at?.tagName.toLowerCase()} class="${at?.className}">`,
            ]
      })
      expect(covered.join("; ")).toBe("")
    })

  it("follows the field when the page is scrolled", async () => {
    mount(`<div style="block-size: 6rem"></div>${fieldAlone()}
      <div id="after" style="block-size: 200vh"></div>`)
    await paint()
    await search()
    const { input, empty } = field()
    const before = [input, empty].map((e) => e.getBoundingClientRect().top)

    window.scrollBy(0, 60)
    await paint()
    await waitForPaint()

    const after = [input, empty].map((e) => e.getBoundingClientRect().top)
    expect(
      Math.round(before[0] - after[0]),
      "the field did not move with the page",
    ).toBe(60)
    expect(
      Math.round(before[1] - after[1]),
      "the message did not move as far as the field",
    ).toBe(60)
    expect(misplaced().join("; ")).toBe("")
    window.scrollTo(0, 0)
  })

  it("follows the field when the window gets another size", async () => {
    await page.viewport(900, 700)
    mount(`${fieldAlone()}<p id="after">Below the field.</p>`)
    await paint()
    await search()
    const { input, empty } = field()
    const wide = input.getBoundingClientRect().width

    await page.viewport(420, 700)
    await paint()
    await waitForPaint()

    expect(
      input.getBoundingClientRect().width,
      "the field is no narrower in a narrower window, so the test says nothing",
    ).toBeLessThan(wide - 100)
    expect(isShown(empty), "the message went when the window changed").toBe(
      true,
    )
    expect(misplaced().join("; ")).toBe("")
    await page.viewport(414, 896)
  })

  it("has an edge of its own all the way round", async () => {
    mount(fieldAlone())
    await paint()
    await search()
    const style = getComputedStyle(field().empty)

    for (const side of ["Top", "Right", "Bottom", "Left"] as const) {
      const [width, kind, colour] = [
        style[`border${side}Width`],
        style[`border${side}Style`],
        style[`border${side}Color`],
      ]
      expect(
        Number.parseFloat(width) >= 1 &&
          kind !== "none" &&
          kind !== "hidden" &&
          !/rgba\(.*,\s*0\)$|transparent/.test(colour),
        `the ${side.toLowerCase()} edge of the message is ${width} ${kind} ${colour}`,
      ).toBe(true)
    }
  })
})

/*
 * The open list and the message are placed by the component, with values it
 * writes in `style` on each of them. A server never writes that attribute,
 * so an update with the server's markup takes it off, and a morph takes off
 * everything the new markup lacks. The list must be back under the field
 * when the component has settled, and not in the corner of the window,
 * where the stylesheet puts it with nothing to go by. It is measured by
 * where its box is, not by what is written on it.
 */
describe("the open list and the message stay under the field when an update takes their style", () => {
  beforeAll(() => {
    defineLtSuggestion()
  })

  const HOSTS = {
    "the component decides": "",
    "server-controlled": " server-controlled",
  }

  /** The field with the list open, as the user's typing or the server's answer opens it. */
  async function opened(host: string, way: keyof typeof WAYS, text: string) {
    mount(
      fieldBetween(WAYS[way]).replace(
        "<lt-suggestion",
        `<lt-suggestion${host}`,
      ),
    )
    await paint()
    await searchFor(parts().input, text)
    await waitForPaint()
  }

  /** What is wrong with where `shown` stands, measured against the field. */
  function astray(shown: HTMLElement, name: string): string[] {
    const { input } = parts()
    const [box, field] = [shown, input].map((e) => e.getBoundingClientRect())
    const faults: string[] = []
    if (!isShown(shown)) return [`${name} is not shown`]
    if (Math.abs(box.left - field.left) > 1)
      faults.push(
        `${name} starts at ${Math.round(box.left)}, and the field at ${Math.round(field.left)}`,
      )
    if (Math.abs(box.width - field.width) > 1)
      faults.push(
        `${name} is ${Math.round(box.width)} wide, and the field ${Math.round(field.width)}`,
      )
    if (box.top < field.bottom - 1 || box.top > field.bottom + 16)
      faults.push(
        `${name} starts at ${Math.round(box.top)} down the window, and the field ends at ${Math.round(field.bottom)}`,
      )
    return faults
  }

  /** The ways an update takes `style` off an element and changes nothing else. */
  const TAKEN = {
    "the attribute is removed": (element: HTMLElement) =>
      element.removeAttribute("style"),
    // The element as it stands, written as a server writes it: without
    // `style`. The morph then has that one attribute to take off.
    "a morph writes the element without it": (element: HTMLElement) => {
      const clone = element.cloneNode(true) as HTMLElement
      clone.removeAttribute("style")
      morph(element, clone.outerHTML)
    },
  }

  async function settled() {
    await paint()
    await waitForPaint()
    await waitForPaint()
  }

  for (const [control, host] of Object.entries(HOSTS))
    for (const [how, take] of Object.entries(TAKEN)) {
      it(`has the list under the field after ${how}, when ${control}`, async () => {
        await opened(host, "the component filters", "e")
        const { list } = parts()
        expect(astray(list, "the list").join("; "), "before the update").toBe(
          "",
        )
        const before = place(list)

        take(list)
        await settled()

        expect(astray(list, "the list").join("; ")).toBe("")
        expect(place(list)).toEqual(before)
      })

      for (const way of Object.keys(WAYS) as Array<keyof typeof WAYS>)
        it(`has the message under the field after ${how}, when ${control} and ${way}`, async () => {
          await opened(host, way, "xyz")
          const { empty } = parts()
          expect(
            astray(empty, "the message").join("; "),
            "before the update",
          ).toBe("")
          const before = place(empty)

          take(empty)
          await settled()

          expect(astray(empty, "the message").join("; ")).toBe("")
          expect(place(empty)).toEqual(before)
        })

      it(`has the list and the message in their places after ${how} on both, when ${control}`, async () => {
        await opened(host, "the component filters", "xyz")
        const { list, empty } = parts()
        const before = [place(list), place(empty)]

        take(list)
        take(empty)
        await settled()

        expect(astray(empty, "the message").join("; ")).toBe("")
        expect([place(list), place(empty)]).toEqual(before)
      })
    }

  it("has the list under the field after a morph of the whole field with the markup the server first sent", async () => {
    // Without `server-controlled` the component puts back what it had
    // opened, and the list is then open again where it was.
    const markup = fieldBetween(WAYS["the component filters"])
    const sent = /<lt-suggestion[\s\S]*<\/lt-suggestion>/.exec(markup)?.[0]
    mount(markup)
    await paint()
    await searchFor(parts().input, "e")
    await waitForPaint()
    const before = place(parts().list)

    morph(parts().host, sent ?? "")
    await settled()

    expect(astray(parts().list, "the list").join("; ")).toBe("")
    expect(place(parts().list)).toEqual(before)
  })

  /*
   * Placing writes `style`, and the component must not take its own
   * writing for an update: with nothing changing on the page, nothing is
   * written, frame after frame, and after an update has taken the style
   * the writing stops when the list is back in its place.
   */
  for (const [control, host] of Object.entries(HOSTS))
    it(`writes nothing on the list or the message while nothing changes, when ${control}`, async () => {
      await opened(host, "the component filters", "xyz")
      const { list, empty } = parts()
      let writes = 0
      const watching = new MutationObserver((records) => {
        writes += records.length
      })
      const frames = async (count: number) => {
        for (let i = 0; i < count; i++) await waitForPaint()
        writes += watching.takeRecords().length
      }
      try {
        for (const element of [list, empty])
          watching.observe(element, { attributes: true })
        await frames(10)
        expect(writes, "writes with nothing changing").toBe(0)

        list.removeAttribute("style")
        empty.removeAttribute("style")
        await frames(10)
        // The two removals, and what it takes to put three values back on
        // each. Not a write for every frame.
        expect(writes, "writes while it settles").toBeLessThanOrEqual(20)
        writes = 0
        await frames(10)
        expect(writes, "writes after it has settled").toBe(0)
      } finally {
        watching.disconnect()
      }
    })
})
