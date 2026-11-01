/// <reference path="../../../types/css.d.ts" />

import { beforeEach, describe, expect, it } from "vitest"

import {
  expectNoAccessibilityViolations,
  mount,
  waitForPaint,
} from "../../../testing/a11y"
import { search } from "./search"

import "../../../tokens/tokens.css"
import "./search.css"
import "../button/button.css"
import "../label/label.css"

describe("lt-search", () => {
  beforeEach(() => {
    mount(`
      <form class="lt-search-row" role="search">
        <label class="lt-label lt-sr-only" for="search">Search breakers</label>
        <input class="lt-input lt-search" type="search" id="search" name="q"
          placeholder="Search breakers" />
        <button class="lt-button" type="submit">Search</button>
      </form>
    `)
  })

  it("is an lt-input with room for the icon", () => {
    const field = document.getElementById("search") as HTMLElement
    const style = getComputedStyle(field)

    expect(field.classList.contains("lt-input")).toBe(true)
    expect(style.backgroundImage).toContain("svg")
    expect(Number.parseFloat(style.paddingInlineStart)).toBeGreaterThan(24)
  })

  it("uses type=search, so the browser gives a clear button and a search keyboard", () => {
    const field = document.getElementById("search") as HTMLInputElement

    expect(field.type).toBe("search")
  })

  it("sets both classes from the builder function", () => {
    expect(search()).toEqual({
      class: "lt-input lt-search",
      type: "search",
    })
    expect(search({ state: "invalid" })).toMatchObject({
      "data-state": "invalid",
      "aria-invalid": "true",
    })
    expect(search.row).toBe("lt-search-row")
  })

  it("has no accessibility violations", async () => {
    await waitForPaint()
    await expectNoAccessibilityViolations()
  })
})
