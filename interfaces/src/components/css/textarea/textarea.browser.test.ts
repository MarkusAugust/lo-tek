/// <reference path="../../../types/css.d.ts" />

import { beforeEach, describe, expect, it } from "vitest"
import {
  expectNoAccessibilityViolations,
  mount,
  waitForPaint,
} from "../../../testing/a11y"
import { color } from "../../../testing/color"
import { findOverflow, mountIsolated } from "../../../testing/isolated"
import textareaCss from "./textarea.css?inline"

import "../../../tokens/tokens.css"
import "./textarea.css"
import "../label/label.css"

function css(id: string) {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing element #${id}`)
  }

  return getComputedStyle(element)
}

describe("lt-textarea", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <textarea id="default" class="lt-textarea"></textarea>
      <textarea id="invalid" class="lt-textarea" data-state="invalid"></textarea>
      <textarea id="success" class="lt-textarea" data-state="success"></textarea>
      <textarea id="disabled" class="lt-textarea" disabled></textarea>
    `
  })

  it("applies default styles", () => {
    const textarea = css("default")

    expect(textarea.backgroundColor).toBe(color("--lt-color-neutral-canvas"))
    expect(textarea.borderTopColor).toBe(color("--lt-color-neutral-border"))
    expect(textarea.color).toBe(color("--lt-color-neutral-text-strong"))
  })

  it("applies invalid styles", () => {
    const textarea = css("invalid")

    expect(textarea.backgroundColor).toBe(color("--lt-color-danger-surface"))
    expect(textarea.borderTopColor).toBe(color("--lt-color-danger-text"))
  })

  it("applies success styles", () => {
    const textarea = css("success")

    expect(textarea.backgroundColor).toBe(color("--lt-color-success-surface"))
    expect(textarea.borderTopColor).toBe(color("--lt-color-success-text"))
  })

  it("applies disabled styles", () => {
    const textarea = css("disabled")

    expect(textarea.backgroundColor).toBe(color("--lt-color-disabled-surface"))
    expect(textarea.borderTopColor).toBe(color("--lt-color-disabled-surface"))
    expect(textarea.color).toBe(color("--lt-color-neutral-border"))
    // The cursor only shows if the pointer hits the element
    expect(textarea.pointerEvents).toBe("auto")
  })
})

describe("lt-textarea accessibility", () => {
  it("has enough contrast and a label in every state", async () => {
    mount(`
      <label class="lt-label" for="a11y-note">Note for the fixer</label>
      <textarea class="lt-textarea" id="a11y-note" rows="3"></textarea>

      <label class="lt-label" for="a11y-objective">Objective</label>
      <textarea class="lt-textarea" id="a11y-objective" rows="3" data-state="invalid" aria-invalid="true">Too short</textarea>
    `)

    await waitForPaint()
    await expectNoAccessibilityViolations()
  })
})

describe("lt-textarea without a CSS reset", () => {
  it("stays inside its box", () => {
    const { box } = mountIsolated(
      textareaCss,
      `<textarea class="lt-textarea" rows="3">The floor plans follow by the usual drop.</textarea>`,
    )

    expect(findOverflow(box)).toEqual([])
  })
})

describe("lt-textarea disabled", () => {
  it("shows the not-allowed cursor, and is actually hit by the mouse", () => {
    mount(`<textarea class="lt-textarea" disabled>Off</textarea>`)

    const element = document.querySelector("textarea") as HTMLElement
    const rect = element.getBoundingClientRect()

    expect(getComputedStyle(element).cursor).toBe("not-allowed")

    // cursor has no effect if the pointer does not hit the element.
    // All of these had pointer-events: none, so the cursor never showed.
    expect(
      document.elementFromPoint(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
      ),
    ).toBe(element)
  })
})
