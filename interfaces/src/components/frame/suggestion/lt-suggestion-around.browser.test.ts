/// <reference path="../../../types/css.d.ts" />

/*
 * What an open list does to the page around the field, held with a real
 * pointer and a real keyboard.
 *
 * The list itself sits in the top layer and moves nothing. Two things beside
 * it did: the message that nothing matches stood in the flow and pushed
 * everything below the field down while it was shown, so a press on a
 * button there landed on the button and the release beside it, and no click
 * arrived. Out of the flow it lies over what is below the field, as the
 * list does, and a press on it is a press on it; and a list tall enough to scroll was a tab stop of its own in
 * Chromium, so Tab from the field went to the list and not on.
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"

import { mount, waitForPaint } from "../../../testing/a11y"
import { attr } from "../../../testing/markup"
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
