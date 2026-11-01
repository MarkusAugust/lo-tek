/// <reference path="../../../types/css.d.ts" />

import { beforeEach, describe, expect, it } from "vitest"

import {
  expectNoAccessibilityViolations,
  mount,
  waitForPaint,
} from "../../../testing/a11y"
import { spinner } from "./spinner"

import "../../../tokens/tokens.css"
import "./spinner.css"

describe("lt-spinner", () => {
  beforeEach(() => {
    mount(`
      <span class="lt-spinner" id="default" role="status" aria-label="Loading sectors"></span>
      <span class="lt-spinner" data-size="small" id="small" aria-hidden="true"></span>
      <span class="lt-spinner" data-size="large" id="large" aria-hidden="true"></span>
    `)
  })

  it("tells the sizes apart", () => {
    const widths = ["small", "default", "large"].map(
      (id) =>
        (document.getElementById(id) as HTMLElement).getBoundingClientRect()
          .width,
    )

    expect(widths[0]).toBeLessThan(widths[1])
    expect(widths[1]).toBeLessThan(widths[2])
  })

  it("marks one edge in the interactive colour", () => {
    const style = getComputedStyle(
      document.getElementById("default") as Element,
    )

    expect(style.borderTopColor).not.toBe(style.borderBottomColor)
  })

  it("sets a role only when it has something to announce", () => {
    expect(spinner()).toEqual({ class: "lt-spinner" })
    expect(spinner({ size: "large", label: "Loading sectors" })).toEqual({
      class: "lt-spinner",
      "data-size": "large",
      role: "status",
      "aria-label": "Loading sectors",
    })
  })

  it("has no accessibility violations", async () => {
    await waitForPaint()
    await expectNoAccessibilityViolations()
  })
})
