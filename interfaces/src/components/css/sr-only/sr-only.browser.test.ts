/// <reference path="../../../types/css.d.ts" />

import { beforeEach, describe, expect, it } from "vitest"

import {
  expectNoAccessibilityViolations,
  mount,
  waitForPaint,
} from "../../../testing/a11y"
import { srOnly } from "./sr-only"

import "../../../tokens/tokens.css"
import "./sr-only.css"
import "../button/button.css"

describe("lt-sr-only", () => {
  beforeEach(() => {
    mount(`
      <button class="lt-button" type="button">
        Delete<span id="hidden" class="lt-sr-only"> the report from 4 March</span>
      </button>
    `)
  })

  it("takes up no space in the layout", () => {
    const hidden = document.getElementById("hidden") as HTMLElement
    const style = getComputedStyle(hidden)

    expect(style.position).toBe("absolute")
    expect(hidden.getBoundingClientRect().width).toBeLessThanOrEqual(1)
  })

  it("stays in the accessibility tree", () => {
    const button = document.querySelector("button") as HTMLButtonElement

    // The text must be part of the name the screen reader reads out. With
    // display: none or visibility: hidden it would be gone here too.
    expect(button.textContent?.replace(/\s+/g, " ").trim()).toBe(
      "Delete the report from 4 March",
    )
  })

  it("gives the class from the builder function", () => {
    expect(srOnly()).toEqual({ class: "lt-sr-only" })
  })

  it("has no accessibility violations", async () => {
    await waitForPaint()
    await expectNoAccessibilityViolations()
  })
})
