/// <reference path="../../../types/css.d.ts" />

import { beforeEach, describe, expect, it } from "vitest"

import {
  expectNoAccessibilityViolations,
  mount,
  waitForPaint,
} from "../../../testing/a11y"
import { alert } from "./alert"

import "../../../tokens/tokens.css"
import "./alert.css"
import "../help-text/help-text.css"

describe("lt-alert", () => {
  beforeEach(() => {
    mount(`
      <div class="lt-alert">
        <p class="lt-alert__title">Incident LAT-0412 has been logged</p>
        <p>The duty crew reports back within the hour.</p>
      </div>
      <div class="lt-alert" data-color="success" id="success">
        <p>Relay 14 is back.</p>
      </div>
      <div class="lt-alert" data-color="warning" id="warning">
        <p>Someone is on the wire in sector 3.</p>
      </div>
      <div class="lt-alert" data-color="danger" id="danger" role="alert">
        <p class="lt-alert__title">Sector 9 is dark</p>
        <p>Crews are on the way.</p>
      </div>
      <div class="lt-alert" data-color="info" id="info">
        <p>The console has been updated.</p>
      </div>
    `)
  })

  it("gives each colour its own surface", () => {
    const colours = ["success", "warning", "danger", "info"].map(
      (id) =>
        getComputedStyle(document.getElementById(id) as Element)
          .backgroundColor,
    )

    expect(new Set(colours).size).toBe(colours.length)
  })

  it("marks the edge in the status colour", () => {
    const danger = getComputedStyle(
      document.getElementById("danger") as Element,
    )

    expect(danger.borderInlineStartWidth).not.toBe("0px")
    expect(danger.borderInlineStartColor).not.toBe(danger.backgroundColor)
  })

  it("leaves the margin of a help text in the message alone", () => {
    // `.lt-alert p` set it to zero, since it beat `.lt-help-text` on specificity.
    mount(`
      <div class="lt-alert">
        <p>You will get an answer within three weeks.</p>
        <p class="lt-help-text" id="help">The incident number is in the log.</p>
      </div>
    `)

    expect(
      getComputedStyle(document.getElementById("help") as HTMLElement)
        .marginTop,
    ).not.toBe("0px")
  })

  it("sets the attributes from the builder function", () => {
    expect(alert()).toEqual({ class: "lt-alert" })
    expect(alert({ color: "danger" })).toEqual({
      class: "lt-alert",
      "data-color": "danger",
    })
    expect(alert.title).toBe("lt-alert__title")
    expect(alert.isColor("danger")).toBe(true)
    expect(alert.isColor("critical")).toBe(false)
  })

  it("has no accessibility violations", async () => {
    await waitForPaint()
    await expectNoAccessibilityViolations()
  })
})
