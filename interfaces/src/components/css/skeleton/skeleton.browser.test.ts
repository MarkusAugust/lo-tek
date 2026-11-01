/// <reference path="../../../types/css.d.ts" />

import { beforeEach, describe, expect, it } from "vitest"

import {
  expectNoAccessibilityViolations,
  mount,
  waitForPaint,
} from "../../../testing/a11y"
import { skeleton } from "./skeleton"

import "../../../tokens/tokens.css"
import "./skeleton.css"

describe("lt-skeleton", () => {
  beforeEach(() => {
    mount(`
      <p role="status">Loading the sector map</p>
      <div class="lt-skeleton" data-variant="circle" id="circle" aria-hidden="true"></div>
      <div class="lt-skeleton" data-variant="text" id="text" aria-hidden="true"></div>
      <div class="lt-skeleton" id="block" aria-hidden="true"></div>
    `)
  })

  it("is round in the circle variant", () => {
    const circle = getComputedStyle(
      document.getElementById("circle") as Element,
    )

    expect(circle.borderRadius).toMatch(/50%|9999px/)
  })

  it("applies --lt-skeleton-radius to the text lines too", () => {
    // The text variant had a fixed radius and did not read the variable.
    for (const id of ["text", "block"]) {
      const element = document.getElementById(id) as HTMLElement
      element.style.setProperty("--lt-skeleton-radius", "20px")
      expect(getComputedStyle(element).borderTopLeftRadius, id).toBe("20px")
    }
  })

  it("stays out of the accessibility tree", () => {
    // A row of empty boxes read aloud is worse than silence. The wait is
    // announced in one place, in the element with role="status".
    for (const shape of document.querySelectorAll(".lt-skeleton")) {
      expect(shape.getAttribute("aria-hidden")).toBe("true")
    }
  })

  it("sets aria-hidden from the builder function", () => {
    expect(skeleton()).toEqual({ class: "lt-skeleton", "aria-hidden": "true" })
    expect(skeleton({ variant: "text" })).toEqual({
      class: "lt-skeleton",
      "data-variant": "text",
      "aria-hidden": "true",
    })
  })

  it("has no accessibility violations", async () => {
    await waitForPaint()
    await expectNoAccessibilityViolations()
  })
})
