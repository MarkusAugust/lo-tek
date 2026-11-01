/// <reference path="../../../types/css.d.ts" />

import { beforeEach, describe, expect, it } from "vitest"

import {
  expectNoAccessibilityViolations,
  mount,
  waitForPaint,
} from "../../../testing/a11y"
import { radio } from "./radio"

import "../../../tokens/tokens.css"
import "./radio.css"
import "../label/label.css"
import "../fieldset/fieldset.css"

describe("lt-radio", () => {
  beforeEach(() => {
    mount(`
      <fieldset class="lt-fieldset">
        <legend class="lt-legend">Lease length</legend>
        <div class="lt-radio-row">
          <input class="lt-radio" type="radio" id="post" name="delivery" checked />
          <label class="lt-label" for="post">One month</label>
        </div>
        <div class="lt-radio-row">
          <input class="lt-radio" type="radio" id="pickup" name="delivery" />
          <label class="lt-label" for="pickup">Six months</label>
        </div>
      </fieldset>
    `)
  })

  it("is round, unlike the checkbox", () => {
    const button = document.getElementById("post") as HTMLElement
    const radius = getComputedStyle(button).borderRadius

    expect(radius).toMatch(/50%|9999px/)
  })

  it("shows the dot only on the selected one", () => {
    const selected = getComputedStyle(
      document.getElementById("post") as Element,
    )
    const unselected = getComputedStyle(
      document.getElementById("pickup") as Element,
    )

    expect(selected.backgroundImage).toContain("radial-gradient")
    expect(unselected.backgroundImage).toBe("none")
  })

  it("keeps only one selected at a time within the same name", () => {
    const pickup = document.getElementById("pickup") as HTMLInputElement
    pickup.click()

    expect((document.getElementById("post") as HTMLInputElement).checked).toBe(
      false,
    )
    expect(pickup.checked).toBe(true)
  })

  it("sets the attributes from the builder function", () => {
    expect(radio()).toEqual({ class: "lt-radio", type: "radio" })
    expect(radio.row).toBe("lt-radio-row")
  })

  it("has no accessibility violations", async () => {
    await waitForPaint()
    await expectNoAccessibilityViolations()
  })
})
