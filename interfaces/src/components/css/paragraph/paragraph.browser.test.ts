/// <reference path="../../../types/css.d.ts" />

import { beforeEach, describe, expect, it } from "vitest"

import {
  expectNoAccessibilityViolations,
  mount,
  waitForPaint,
} from "../../../testing/a11y"
import { paragraph } from "./paragraph"

import "../../../tokens/tokens.css"
import "./paragraph.css"

describe("lt-paragraph", () => {
  beforeEach(() => {
    mount(`
      <p class="lt-paragraph" data-variant="lead" id="lead">
        Everything a runner's policy covers, and everything it does not.
      </p>
      <p class="lt-paragraph" id="body">
        The premium is drawn on the first of every month. A claim must be filed within 30 days.
      </p>
      <p class="lt-paragraph" id="second">Next paragraph.</p>
    `)
  })

  it("keeps the line length down", () => {
    const style = getComputedStyle(document.getElementById("body") as Element)

    // 70ch. Longer lines make it hard to find the start of the next line.
    expect(style.maxInlineSize).not.toBe("none")
  })

  it("tells the lead apart from the body text", () => {
    const lead = getComputedStyle(document.getElementById("lead") as Element)
    const body = getComputedStyle(document.getElementById("body") as Element)

    expect(lead.fontSize).not.toBe(body.fontSize)
    expect(lead.color).not.toBe(body.color)
  })

  it("adds space between consecutive paragraphs", () => {
    const second = getComputedStyle(
      document.getElementById("second") as Element,
    )

    expect(second.marginBlockStart).not.toBe("0px")
  })

  it("sets the attributes from the builder function", () => {
    expect(paragraph()).toEqual({ class: "lt-paragraph" })
    expect(paragraph({ size: "large", variant: "lead" })).toEqual({
      class: "lt-paragraph",
      "data-size": "large",
      "data-variant": "lead",
    })
  })

  it("has no accessibility violations", async () => {
    await waitForPaint()
    await expectNoAccessibilityViolations()
  })
})
