/// <reference path="../../../types/css.d.ts" />

import { beforeEach, describe, expect, it } from "vitest"
import {
  expectNoAccessibilityViolations,
  mount,
  waitForPaint,
} from "../../../testing/a11y"
import { color } from "../../../testing/color"
import { findOverflow, mountIsolated } from "../../../testing/isolated"
import inputCss from "./input.css?inline"

import "../../../tokens/tokens.css"
import "./input.css"
import "../label/label.css"

function css(id: string) {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing element #${id}`)
  }

  return getComputedStyle(element)
}

describe("lt-input", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <input id="default" class="lt-input" />
      <input id="date" class="lt-input" type="date" data-variant="date" value="2079-05-31" />
      <input id="time" class="lt-input" type="time" data-variant="time" value="10:30" />
      <input id="datetime" class="lt-input" type="datetime-local" data-variant="datetime-local" value="2079-05-31T10:30" />
      <input id="invalid" class="lt-input" data-state="invalid" />
      <input id="success" class="lt-input" data-state="success" />
      <input id="disabled" class="lt-input" disabled />
    `
  })

  it("applies default styles", () => {
    const input = css("default")

    expect(input.backgroundColor).toBe(color("--lt-color-neutral-canvas"))
    expect(input.borderTopColor).toBe(color("--lt-color-disabled-text"))
    expect(input.color).toBe(color("--lt-color-neutral-text-strong"))
  })

  it("applies invalid styles", () => {
    const input = css("invalid")

    expect(input.backgroundColor).toBe(color("--lt-color-danger-surface"))
    expect(input.borderTopColor).toBe(color("--lt-color-danger-text"))
  })

  it("applies date variant styles", () => {
    const input = css("date")

    expect(input.fontVariantNumeric).toContain("tabular-nums")
    expect(input.backgroundImage).toContain("data:image")
  })

  it("applies time variant icon styles", () => {
    const input = css("time")

    expect(input.backgroundImage).toContain("data:image")
  })

  it("applies datetime-local variant icon styles", () => {
    const input = css("datetime")

    expect(input.backgroundImage).toContain("data:image")
  })

  it("applies success styles", () => {
    const input = css("success")

    expect(input.backgroundColor).toBe(color("--lt-color-success-surface"))
    expect(input.borderTopColor).toBe(color("--lt-color-success-text"))
  })

  it("applies disabled styles", () => {
    const input = css("disabled")

    expect(input.backgroundColor).toBe(color("--lt-color-disabled-surface"))
    expect(input.borderTopColor).toBe(color("--lt-color-disabled-surface"))
    expect(input.color).toBe(color("--lt-color-disabled-text"))
    // The cursor only shows if the pointer hits the element
    expect(input.pointerEvents).toBe("auto")
  })
})

describe("lt-input accessibility", () => {
  it("has enough contrast and a label in every state", async () => {
    mount(`
      <label class="lt-label" for="a11y-default">Fixer's address</label>
      <input class="lt-input" id="a11y-default" type="email" />

      <label class="lt-label" for="a11y-valid">Confirm the fixer's address</label>
      <input class="lt-input" id="a11y-valid" type="email" data-state="success" value="fixer@relay.example" />

      <label class="lt-label" for="a11y-invalid">Backup fixer</label>
      <input class="lt-input" id="a11y-invalid" type="email" data-state="invalid" aria-invalid="true" value="fixer@" />

      <label class="lt-label" for="a11y-date">Deliver by</label>
      <input class="lt-input" id="a11y-date" type="date" data-variant="date" value="2079-05-31" />
    `)

    await waitForPaint()
    await expectNoAccessibilityViolations()
  })
})

describe("lt-input without a CSS reset", () => {
  it("stays inside its box", () => {
    const { box } = mountIsolated(
      inputCss,
      `<input class="lt-input" type="email" value="fixer@relay.example" />`,
    )

    expect(findOverflow(box)).toEqual([])
  })
})

describe("lt-input disabled", () => {
  it("shows the not-allowed cursor, and is actually hit by the mouse", () => {
    mount(`<input class="lt-input" disabled value="Off" />`)

    const element = document.querySelector("input") as HTMLElement
    const rect = element.getBoundingClientRect()

    expect(getComputedStyle(element).cursor).toBe("not-allowed")

    // cursor has no effect if the pointer does not hit the element. All of
    // these had pointer-events: none, so the cursor was never shown.
    expect(
      document.elementFromPoint(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
      ),
    ).toBe(element)
  })
})
