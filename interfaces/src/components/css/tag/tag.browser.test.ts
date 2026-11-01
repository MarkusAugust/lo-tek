/// <reference path="../../../types/css.d.ts" />

import { beforeEach, describe, expect, it } from "vitest"

import {
  expectNoAccessibilityViolations,
  mount,
  waitForPaint,
} from "../../../testing/a11y"
import { tag } from "./tag"

import "../../../tokens/tokens.css"
import "./tag.css"

describe("lt-tag", () => {
  beforeEach(() => {
    mount(`
      <span class="lt-tag" id="plain">cutter</span>
      <span class="lt-tag" data-variant="filled" id="filled">worm</span>
      <button class="lt-tag" data-selectable aria-pressed="true" id="selected" type="button">
        Cutter
      </button>
      <button class="lt-tag" data-selectable aria-pressed="false" id="unselected" type="button">
        Decoy
      </button>
    `)
  })

  it("distinguishes the selected from the unselected", () => {
    const selected = getComputedStyle(
      document.getElementById("selected") as Element,
    )
    const unselected = getComputedStyle(
      document.getElementById("unselected") as Element,
    )

    expect(selected.backgroundColor).not.toBe(unselected.backgroundColor)
    expect(selected.color).not.toBe(unselected.color)
  })

  it("keeps the selectable tag a real button", () => {
    const selectable = document.getElementById("selected") as HTMLElement

    expect(selectable.tagName).toBe("BUTTON")
    expect(selectable.getAttribute("aria-pressed")).toBe("true")
  })

  it("sets the attributes from the builder function", () => {
    expect(tag()).toEqual({ class: "lt-tag" })
    expect(tag({ variant: "filled", selectable: true })).toEqual({
      class: "lt-tag",
      "data-variant": "filled",
      "data-selectable": "",
    })
  })

  it("has no accessibility violations", async () => {
    await waitForPaint()
    await expectNoAccessibilityViolations()
  })
})
