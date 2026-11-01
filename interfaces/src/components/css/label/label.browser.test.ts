/// <reference path="../../../types/css.d.ts" />

import { beforeEach, describe, expect, it } from "vitest"
import {
  expectNoAccessibilityViolations,
  mount,
  waitForPaint,
} from "../../../testing/a11y"
import { color } from "../../../testing/color"

import "../../../tokens/tokens.css"
import "./label.css"
import "../input/input.css"

function css(id: string, pseudo?: string) {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing element #${id}`)
  }

  return getComputedStyle(element, pseudo)
}

describe("lt-label", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <label id="default" class="lt-label" for="a">Name</label>
      <label id="required-symbol" class="lt-label" data-required="symbol" for="b">Email</label>
      <label id="required-text" class="lt-label" data-required="text" for="e">Phone</label>
      <label id="optional" class="lt-label" data-optional="" for="c">Address</label>
      <label id="disabled" class="lt-label" aria-disabled="true" for="d">Description</label>
    `
  })

  it("default: correct color and weight", () => {
    const label = css("default")
    expect(label.color).toBe(color("--lt-color-neutral-text-strong"))
    expect(label.fontWeight).toBe("600")
  })

  it("disabled: muted color", () => {
    const label = css("disabled")
    expect(label.color).toBe(color("--lt-color-neutral-text-subtle"))
  })

  it("required symbol: ::after has danger color", () => {
    const after = css("required-symbol", "::after")
    expect(after.color).toBe(color("--lt-color-danger-text"))
    expect(after.content).toBe('" *"')
  })

  it("required text: ::after shows (required) in danger color", () => {
    const after = css("required-text", "::after")
    expect(after.color).toBe(color("--lt-color-danger-text"))
    expect(after.content).toBe('" (required)"')
  })

  it("optional: ::after has muted color", () => {
    const after = css("optional", "::after")
    expect(after.color).toBe(color("--lt-color-neutral-text-subtle"))
  })
})

describe("lt-label accessibility", () => {
  it("connects the label to the field in every marker", async () => {
    mount(`
      <label class="lt-label" for="a11y-codename">Codename</label>
      <input class="lt-input" id="a11y-codename" type="text" />

      <label class="lt-label" data-required="symbol" for="a11y-fixer">Fixer's address</label>
      <input class="lt-input" id="a11y-fixer" type="email" required />

      <label class="lt-label" data-required="text" for="a11y-budget">Budget</label>
      <input class="lt-input" id="a11y-budget" type="text" required />

      <label class="lt-label" data-optional="" for="a11y-entry">Entry point</label>
      <input class="lt-input" id="a11y-entry" type="text" />
    `)

    await waitForPaint()
    await expectNoAccessibilityViolations()
  })
})

describe("the text in the marker can be replaced", () => {
  it("is English when the variables are not set", () => {
    mount(`
      <label id="req" class="lt-label" data-required="text">Name</label>
      <label id="opt" class="lt-label" data-optional>Middle name</label>
    `)

    expect(css("req", "::after").content).toBe('" (required)"')
    expect(css("opt", "::after").content).toBe('" (optional)"')
  })

  it("reads the text from the variables, so it can be translated", () => {
    // A package cannot ship every language, so the text belongs to the app.
    // `:lang(nb)` is one way, a variable set from i18next another. The
    // values differ from the defaults, so the test fails if the variables
    // are not read. The Norwegian texts are deliberate: they are the
    // translation.
    mount(`
      <div style="--lt-label-required-text: ' (påkrevd)'; --lt-label-optional-text: ' (valgfri)'; --lt-label-required-symbol: ' †'">
        <label id="req" class="lt-label" data-required="text">Name</label>
        <label id="opt" class="lt-label" data-optional>Middle name</label>
        <label id="sym" class="lt-label" data-required>Email</label>
      </div>
    `)

    expect(css("req", "::after").content).toBe('" (påkrevd)"')
    expect(css("opt", "::after").content).toBe('" (valgfri)"')
    expect(css("sym", "::after").content).toBe('" †"')
  })
})
