/// <reference path="../../../types/css.d.ts" />

import { beforeEach, describe, expect, it } from "vitest"

import {
  expectNoAccessibilityViolations,
  mount,
  waitForPaint,
} from "../../../testing/a11y"
import { divider } from "./divider"

import "../../../tokens/tokens.css"
import "./divider.css"

describe("lt-divider", () => {
  beforeEach(() => {
    mount(`
      <p>The recovery order has been registered.</p>
      <hr class="lt-divider" id="default" />
      <p>The appraisal follows within three days.</p>
      <hr class="lt-divider" data-variant="strong" id="strong" />
      <hr class="lt-divider" data-variant="subtle" id="subtle" aria-hidden="true" />
    `)
  })

  it("removes the browser's own border", () => {
    const style = getComputedStyle(
      document.getElementById("default") as Element,
    )

    expect(style.borderTopWidth).toBe("0px")
    expect(style.height).toBe("1px")
  })

  it.each([
    "display: flex; flex-direction: column",
    "display: flex; flex-direction: column; align-items: center",
    "display: grid",
    "display: grid; justify-items: start",
  ])("fills the width of a parent with %s", (layout) => {
    // The browser's auto margins on the sides win over stretch in flex, and
    // the line was 0 pixels wide. The documentation page showed no line.
    mount(`
      <div id="parent" style="${layout}; inline-size: 20rem">
        <p>The recovery order has been registered.</p>
        <hr class="lt-divider" id="in-parent" />
        <p>The appraisal follows within three days.</p>
      </div>
    `)
    const parent = document.getElementById("parent") as Element
    const line = document.getElementById("in-parent") as Element

    expect(line.getBoundingClientRect().width).toBe(
      parent.getBoundingClientRect().width,
    )
  })

  it("gives each variant its own strength", () => {
    const colours = ["default", "strong", "subtle"].map(
      (id) =>
        getComputedStyle(document.getElementById(id) as Element)
          .backgroundColor,
    )

    expect(new Set(colours).size).toBe(3)
  })

  it("sets the attributes from the builder function", () => {
    expect(divider()).toEqual({ class: "lt-divider" })
    expect(divider({ variant: "strong" })).toEqual({
      class: "lt-divider",
      "data-variant": "strong",
    })
  })

  it("has no accessibility violations", async () => {
    await waitForPaint()
    await expectNoAccessibilityViolations()
  })
})
