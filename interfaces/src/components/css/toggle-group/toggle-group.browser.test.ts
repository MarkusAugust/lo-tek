/// <reference path="../../../types/css.d.ts" />

import { beforeEach, describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"

import {
  expectNoAccessibilityViolations,
  mount,
  waitForPaint,
} from "../../../testing/a11y"
import { rgb } from "../../../testing/color"
import { contrastRatio } from "../../../tokens/color"
import { toggleGroup } from "./toggle-group"

import "../../../tokens/tokens.css"
import "./toggle-group.css"
import "../sr-only/sr-only.css"

describe("lt-toggle-group", () => {
  beforeEach(() => {
    mount(`
      <fieldset class="lt-toggle-group">
        <legend class="lt-sr-only">View</legend>
        <label class="lt-toggle-group__option" id="dry">
          <input type="radio" name="view" value="dry" checked /> Dry
        </label>
        <label class="lt-toggle-group__option" id="seasonal">
          <input type="radio" name="view" value="seasonal" /> Seasonal
        </label>
      </fieldset>
    `)
  })

  it("marks the selected option", () => {
    const selected = getComputedStyle(document.getElementById("dry") as Element)
    const unselected = getComputedStyle(
      document.getElementById("seasonal") as Element,
    )

    expect(selected.backgroundColor).not.toBe(unselected.backgroundColor)
  })

  it("is radio buttons underneath", () => {
    const seasonal = document.querySelector(
      "#seasonal input",
    ) as HTMLInputElement
    seasonal.click()

    // Arrow keys, FormData and "2 of 2" from the screen reader come for free
    // because the controls are real radio buttons.
    expect(seasonal.checked).toBe(true)
    expect(
      (document.querySelector("#dry input") as HTMLInputElement).checked,
    ).toBe(false)
  })

  it("keeps the radio button in the keyboard order", () => {
    const input = document.querySelector("#dry input") as HTMLInputElement
    const style = getComputedStyle(input)

    expect(style.display).not.toBe("none")
    expect(style.visibility).not.toBe("hidden")
  })

  it("sets the attributes from the builder function", () => {
    expect(toggleGroup()).toEqual({ class: "lt-toggle-group" })
    expect(toggleGroup.option).toBe("lt-toggle-group__option")
  })

  it("has no accessibility violations", async () => {
    await waitForPaint()
    await expectNoAccessibilityViolations()
  })
})

describe("the focus ring on the selected option", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`is visible against the selected surface (${theme})`, async () => {
      mount(`
        <div data-theme="${theme}">
          <fieldset class="lt-toggle-group">
            <legend class="lt-sr-only">View</legend>
            <label class="lt-toggle-group__option">
              <input type="radio" name="view" value="dry" id="dry" checked /> Dry
            </label>
            <label class="lt-toggle-group__option">
              <input type="radio" name="view" value="seasonal" /> Seasonal
            </label>
          </fieldset>
        </div>`)
      // Focus from the keyboard, so `:focus-visible` applies. In a radio group
      // the focused option is always the selected one. Tab alone does not get
      // there in WebKit on macOS, where Tab skips radio buttons as in Safari,
      // so focus is set from code after the one key press. That counts as
      // keyboard focus in all three engines, as in the focus test.
      await userEvent.tab()
      const selected = document.getElementById("dry") as HTMLInputElement
      selected.focus()
      expect(document.activeElement).toBe(selected)
      await waitForPaint()

      const style = getComputedStyle(selected.closest("label") as Element)
      expect(style.outlineStyle).toBe("solid")
      // The ring used to be 1.23:1 in the light theme and 2.01:1 in the dark.
      expect(
        contrastRatio(rgb(style.outlineColor), rgb(style.backgroundColor)),
      ).toBeGreaterThanOrEqual(3)
    })
  }
})
