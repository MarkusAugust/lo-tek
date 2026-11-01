/// <reference path="../../../types/css.d.ts" />

import { beforeEach, describe, expect, it } from "vitest"

import {
  expectNoAccessibilityViolations,
  mount,
  waitForPaint,
} from "../../../testing/a11y"
import { checkbox } from "./checkbox"

import "../../../tokens/tokens.css"
import "./checkbox.css"
import "../label/label.css"

function style(id: string) {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing #${id}`)
  }
  return getComputedStyle(element)
}

describe("lt-checkbox", () => {
  beforeEach(() => {
    mount(`
      <div class="lt-checkbox-row">
        <input class="lt-checkbox" type="checkbox" id="terms" />
        <label class="lt-label" for="terms">I accept that floors below 12 are seasonal.</label>
      </div>
      <div class="lt-checkbox-row">
        <input class="lt-checkbox" type="checkbox" id="newsletter" checked />
        <label class="lt-label" for="newsletter">Tell me when a dry floor comes free</label>
      </div>
      <div class="lt-checkbox-row">
        <input class="lt-checkbox" type="checkbox" id="partial" />
        <label class="lt-label" for="partial">Select all extras</label>
      </div>
      <div class="lt-checkbox-row">
        <input class="lt-checkbox" type="checkbox" id="invalid"
          data-state="invalid" aria-invalid="true" />
        <label class="lt-label" for="invalid">I confirm that I have read the lease</label>
      </div>
    `)

    const partial = document.getElementById("partial") as HTMLInputElement
    partial.indeterminate = true
  })

  it("shows the tick when the box is checked", () => {
    expect(style("newsletter").backgroundImage).toContain("polyline")
    expect(style("terms").backgroundImage).toBe("none")
  })

  it("shows the dash when the box is partly checked", () => {
    expect(style("partial").backgroundImage).toContain("line")
  })

  it("is large enough to hit", () => {
    const box = document.getElementById("terms") as HTMLElement
    const rect = box.getBoundingClientRect()

    // 20 pixels plus the focus ring outside. Below 20 the box is hard to hit
    // with a finger, and the tick is hard to make out.
    expect(rect.width).toBeGreaterThanOrEqual(20)
    expect(rect.height).toBeGreaterThanOrEqual(20)
  })

  it("marks invalid with both colour and aria", () => {
    const invalid = document.getElementById("invalid") as HTMLInputElement

    expect(invalid.getAttribute("aria-invalid")).toBe("true")
    expect(style("invalid").borderColor).not.toBe(style("terms").borderColor)
  })

  it("sets the attributes from the builder function", () => {
    expect(checkbox()).toEqual({ class: "lt-checkbox", type: "checkbox" })
    expect(checkbox({ state: "invalid" })).toEqual({
      class: "lt-checkbox",
      type: "checkbox",
      "data-state": "invalid",
      "aria-invalid": "true",
    })
    expect(checkbox.row).toBe("lt-checkbox-row")
  })

  it("has no accessibility violations", async () => {
    await waitForPaint()
    await expectNoAccessibilityViolations()
  })
})
