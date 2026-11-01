/// <reference path="../../../types/css.d.ts" />

import { beforeEach, describe, expect, it } from "vitest"

import {
  expectNoAccessibilityViolations,
  mount,
  waitForPaint,
} from "../../../testing/a11y"
import { heading } from "./heading"

import "../../../tokens/tokens.css"
import "./heading.css"

describe("lt-heading", () => {
  beforeEach(() => {
    mount(`
      <h1 class="lt-heading" data-size="mega" id="mega">Runner's policy terms</h1>
      <h2 class="lt-heading" id="standard">About the policyholder</h2>
      <h3 class="lt-heading" data-size="s" id="small">Attachments</h3>
    `)
  })

  it("tells the sizes apart without touching the level", () => {
    const large = Number.parseFloat(
      getComputedStyle(document.getElementById("mega") as Element).fontSize,
    )
    const regular = Number.parseFloat(
      getComputedStyle(document.getElementById("standard") as Element).fontSize,
    )
    const small = Number.parseFloat(
      getComputedStyle(document.getElementById("small") as Element).fontSize,
    )

    expect(large).toBeGreaterThan(regular)
    expect(regular).toBeGreaterThan(small)

    // The levels are untouched. An <h3> that looks small is still an h3.
    expect(document.getElementById("small")?.tagName).toBe("H3")
  })

  it("sets the attributes from the builder function", () => {
    expect(heading()).toEqual({ class: "lt-heading" })
    expect(heading({ size: "mega" })).toEqual({
      class: "lt-heading",
      "data-size": "mega",
    })
    expect(heading.isSize("xs")).toBe(true)
  })

  it("has no accessibility violations", async () => {
    await waitForPaint()
    await expectNoAccessibilityViolations()
  })
})
