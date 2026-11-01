/// <reference path="../../../types/css.d.ts" />

import { beforeEach, describe, expect, it } from "vitest"

import {
  expectNoAccessibilityViolations,
  mount,
  waitForPaint,
} from "../../../testing/a11y"
import { fieldset, legend } from "./fieldset"

import "../../../tokens/tokens.css"
import "./fieldset.css"
import "../radio/radio.css"

describe("lt-fieldset", () => {
  beforeEach(() => {
    mount(`
      <fieldset class="lt-fieldset" id="group">
        <legend class="lt-legend" id="title" data-required="symbol">Delivery method</legend>
        <div class="lt-radio-row">
          <input class="lt-radio" type="radio" id="post" name="delivery" />
          <label for="post">Dead drop</label>
        </div>
      </fieldset>
    `)
  })

  it("removes the browser's own border and indent", () => {
    const style = getComputedStyle(document.getElementById("group") as Element)

    expect(style.borderTopWidth).toBe("0px")
    expect(style.paddingInlineStart).toBe("0px")
  })

  it("marks the label as required", () => {
    const marker = getComputedStyle(
      document.getElementById("title") as Element,
      "::after",
    )

    expect(marker.content).toContain("*")
  })

  it("disables every control in the group at once", () => {
    const group = document.getElementById("group") as HTMLFieldSetElement
    group.disabled = true

    // The controls inside inherit the state from the group. The `disabled`
    // property on each of them is still false, so `:disabled` is what tells
    // whether the user can reach them, not the property.
    const radio = document.getElementById("post") as HTMLInputElement
    expect(radio.matches(":disabled")).toBe(true)
    expect(radio.disabled).toBe(false)
  })

  it("sets the attributes from the builder functions", () => {
    expect(fieldset()).toEqual({ class: "lt-fieldset" })
    expect(fieldset({ state: "invalid" })).toEqual({
      class: "lt-fieldset",
      "data-state": "invalid",
    })
    expect(legend({ required: "text" })).toEqual({
      class: "lt-legend",
      "data-required": "text",
    })
  })

  it("has no accessibility violations", async () => {
    await waitForPaint()
    await expectNoAccessibilityViolations()
  })
})
