/// <reference path="../../../types/css.d.ts" />

import { beforeEach, describe, expect, it } from "vitest"
import {
  expectNoAccessibilityViolations,
  mount,
  waitForPaint,
} from "../../../testing/a11y"
import { color } from "../../../testing/color"

import "../../../tokens/tokens.css"
import "./help-text.css"
import "../input/input.css"
import "../label/label.css"

function css(id: string) {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing element #${id}`)
  }

  return getComputedStyle(element)
}

describe("lt-help-text", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <p id="muted" class="lt-help-text">Muted help</p>
      <p id="strong" class="lt-help-text" data-variant="strong">Strong help</p>
      <p id="success" class="lt-help-text" data-variant="success">Success help</p>
      <p id="warning" class="lt-help-text" data-variant="warning">Warning help</p>
    `
  })

  it("applies muted defaults", () => {
    const help = css("muted")

    expect(help.color).toBe(color("--lt-color-neutral-text-subtle"))
  })

  it("applies strong variant", () => {
    const help = css("strong")

    expect(help.color).toBe(color("--lt-color-neutral-text-strong"))
  })

  it("applies success variant", () => {
    const help = css("success")

    expect(help.color).toBe(color("--lt-color-success-text"))
  })

  it("applies warning variant", () => {
    const help = css("warning")

    expect(help.color).toBe(color("--lt-color-warning-text"))
  })
})

describe("lt-help-text accessibility", () => {
  it("has enough contrast and is wired to the field", async () => {
    mount(`
      <label class="lt-label" for="a11y-budget">Budget</label>
      <input class="lt-input" id="a11y-budget" inputmode="numeric" aria-describedby="a11y-budget-help" />
      <p class="lt-help-text" id="a11y-budget-help">In EB, without the code. The crew sees it.</p>

      <p class="lt-help-text" data-variant="strong">The order is binding once a crew takes it.</p>
      <p class="lt-help-text" data-variant="success">The floor plans have been uploaded.</p>
      <p class="lt-help-text" data-variant="warning">The window closes in three days.</p>
    `)

    await waitForPaint()
    await expectNoAccessibilityViolations()
  })
})
