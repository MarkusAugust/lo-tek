/// <reference path="../../../types/css.d.ts" />

/**
 * The list in the suggestion field: its name, the selected state, loading and
 * the top layer.
 *
 * The list is a `listbox`, and like every other control it needs a name
 * (axe: `aria-input-field-name`). Every option says whether it is selected
 * from the start, not only once the list closes. While the answer to a search
 * is on its way, the list says `aria-busy`. And the list sits in the top
 * layer, so a parent with `overflow`, such as the body of a dialog, does not
 * clip it.
 */

import { beforeAll, describe, expect, it } from "vitest"

import {
  expectNoAccessibilityViolations,
  mount,
  waitForPaint,
} from "../../../testing/a11y"
import { attr, wiredName } from "../../../testing/markup"
import { defineLtSuggestion, type LtSuggestion } from "./lt-suggestion"
import { suggestion } from "./suggestion"

import "../../../tokens/tokens.css"
import "./suggestion.css"
import "../../css/sr-only/sr-only.css"

const BREAKERS = ["Crowbar", "Glasscutter", "Lockjaw", "Needle"]
const KEYS = ["crowbar", "glasscutter", "lockjaw", "needle"]

/** The way a template writes it without the builder function: no roles, no name on the list. */
const BARE = `
  <lt-suggestion>
    <label class="lt-label" for="breaker">Breaker</label>
    <input class="lt-input" id="breaker" name="breaker">
    <ul class="lt-suggestion__list">
      ${BREAKERS.map((k) => `<li>${k}</li>`).join("")}
    </ul>
    <span class="lt-sr-only" role="status"></span>
  </lt-suggestion>`

/** The label around the field, with no id on anything. */
const WRAPPED = `
  <lt-suggestion>
    <label class="lt-label">Breaker <input class="lt-input" name="breaker"></label>
    <ul class="lt-suggestion__list">
      ${BREAKERS.map((k) => `<li>${k}</li>`).join("")}
    </ul>
    <span class="lt-sr-only" role="status"></span>
  </lt-suggestion>`

function fromBuilderFunction(choices: { pending?: boolean } = {}) {
  const f = suggestion({ id: "breaker", keys: KEYS, ...choices })
  return `
  <lt-suggestion>
    <label ${attr(f.label)}>Breaker</label>
    <input ${attr(f.control)} name="breaker">
    <ul ${attr(f.list)}>
      ${f.options.map((o, i) => `<li ${attr(o)}>${BREAKERS[i]}</li>`).join("")}
    </ul>
    <p ${attr(f.empty)}>No matches</p>
    <span ${attr(f.status)}></span>
  </lt-suggestion>`
}

async function paint() {
  await customElements.whenDefined("lt-suggestion")
  await waitForPaint()
  await waitForPaint()
  return document.querySelector("lt-suggestion") as LtSuggestion
}

const list = () => document.querySelector("[role='listbox']") as HTMLElement
const field = () => document.querySelector("input") as HTMLInputElement
const options = () => [
  ...document.querySelectorAll<HTMLElement>("[role='option']"),
]

async function openList() {
  field().focus()
  field().dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
  )
  await paint()
}

describe("the list has a name", () => {
  beforeAll(() => {
    defineLtSuggestion()
  })

  it("from the label, when the markup came without one", async () => {
    mount(BARE)
    await paint()
    expect(wiredName(list())).toBe("Breaker")
  })

  it("from the label around the field, with no id on the label or the field", async () => {
    // An id on the label around the field would make a morph replace the
    // label, and the field in it. The name is then the text, without the value.
    mount(WRAPPED)
    await paint()
    field().value = "Loc"
    field().dispatchEvent(new Event("input", { bubbles: true }))
    await paint()
    expect(wiredName(list())).toBe("Breaker")
    expect(document.querySelector("label")?.hasAttribute("id")).toBe(false)
    expect(field().hasAttribute("id")).toBe(false)
  })

  it("from the builder function, without the component writing anything", async () => {
    mount(fromBuilderFunction())
    expect(list().getAttribute("aria-labelledby")).toBe("breaker-label")
    expect(document.querySelector("label")?.id).toBe("breaker-label")
  })

  it("leaves a name the server wrote alone", async () => {
    mount(
      BARE.replace(
        '<ul class="lt-suggestion__list">',
        '<ul class="lt-suggestion__list" aria-label="Breakers in stock">',
      ),
    )
    await paint()
    expect(list().getAttribute("aria-label")).toBe("Breakers in stock")
    expect(list().hasAttribute("aria-labelledby")).toBe(false)
  })

  it("has no accessibility violations with the list open", async () => {
    mount(BARE)
    await paint()
    await openList()
    expect(list().hidden).toBe(false)
    await expectNoAccessibilityViolations()
  })
})

describe("every option says whether it is selected", () => {
  beforeAll(() => {
    defineLtSuggestion()
  })

  it("from the start, before the list has been open", async () => {
    // Firefox reads an option without `aria-selected` as selected.
    mount(BARE)
    await paint()
    expect(options().map((o) => o.getAttribute("aria-selected"))).toEqual([
      "false",
      "false",
      "false",
      "false",
    ])
  })
})

describe("the list says so while the answer is on its way", () => {
  beforeAll(() => {
    defineLtSuggestion()
  })

  it("lt.suggestion({ pending }) writes aria-busy on the list", () => {
    expect(suggestion({ id: "k", pending: true }).list["aria-busy"]).toBe(
      "true",
    )
    expect(suggestion({ id: "k" }).list["aria-busy"]).toBeUndefined()
  })

  it("keeps the empty message hidden while the list says aria-busy", async () => {
    mount(
      BARE.replace(
        '<ul class="lt-suggestion__list">',
        '<ul class="lt-suggestion__list" aria-busy="true">',
      ).replace(
        '<span class="lt-sr-only"',
        '<p class="lt-suggestion__empty">No matches</p><span class="lt-sr-only"',
      ),
    )
    await paint()
    await openList()
    field().value = "xyz"
    field().dispatchEvent(new Event("input", { bubbles: true }))
    await paint()
    const empty = document.querySelector(".lt-suggestion__empty") as HTMLElement
    expect(getComputedStyle(empty).display).toBe("none")

    list().removeAttribute("aria-busy")
    await paint()
    expect(getComputedStyle(empty).display).not.toBe("none")
  })
})

describe("the list sits in the top layer", () => {
  beforeAll(() => {
    defineLtSuggestion()
  })

  it("is a popover, open when the list is open and closed otherwise", async () => {
    mount(BARE)
    await paint()
    expect(list().getAttribute("popover")).toBe("manual")
    expect(list().matches(":popover-open")).toBe(false)
    await openList()
    expect(list().matches(":popover-open")).toBe(true)
    field().dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    )
    await paint()
    expect(list().hidden).toBe(true)
    expect(list().matches(":popover-open")).toBe(false)
  })

  it("is not clipped by a parent with overflow", async () => {
    mount(`<div class="scroll-box">${BARE}</div>`)
    const box = document.querySelector(".scroll-box") as HTMLElement
    // Like the body of a dialog: short, and scrollable.
    box.style.blockSize = "4rem"
    box.style.overflow = "auto"
    await paint()
    await openList()
    const last = options()[3]
    const r = last.getBoundingClientRect()
    const hit = document.elementFromPoint(
      r.left + r.width / 2,
      r.top + r.height / 2,
    )
    expect(hit).toBe(last)
  })

  it("sits below the field, as wide as it", async () => {
    mount(BARE)
    await paint()
    await openList()
    const f = field().getBoundingClientRect()
    const l = list().getBoundingClientRect()
    expect(Math.abs(l.left - f.left)).toBeLessThan(2)
    expect(Math.abs(l.width - f.width)).toBeLessThan(2)
    expect(l.top).toBeGreaterThanOrEqual(f.bottom)
    expect(l.top - f.bottom).toBeLessThan(12)
  })

  it("stays open when an update takes popover off the list", async () => {
    mount(BARE)
    await paint()
    await openList()
    // The way a morph from the server's markup does it.
    list().removeAttribute("popover")
    await paint()
    expect(list().getAttribute("popover")).toBe("manual")
    expect(list().matches(":popover-open")).toBe(true)
  })

  it("follows the server closing the list with hidden", async () => {
    mount(BARE.replace("<lt-suggestion>", "<lt-suggestion server-controlled>"))
    await paint()
    await openList()
    list().hidden = true
    field().setAttribute("aria-expanded", "false")
    await paint()
    expect(list().matches(":popover-open")).toBe(false)
  })

  it("the builder function writes popover", () => {
    expect(suggestion({ id: "k" }).list.popover).toBe("manual")
  })
})
