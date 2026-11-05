/// <reference path="../../../types/css.d.ts" />

import { describe, expect, it } from "vitest"
import {
  expectNoAccessibilityViolations,
  mount,
  waitForPaint,
} from "../../../testing/a11y"
import { steps } from "./steps"

import "../../../tokens/tokens.css"
import "./steps.css"

const ORDER = `
  <ol class="lt-steps" aria-label="Order">
    <li id="site"><a href="#site">Site</a></li>
    <li id="survey">Survey</li>
    <li id="walls" aria-current="step">Walls</li>
    <li id="payment">Payment</li>
  </ol>
`

/** The marker of a step: on its link when it has one, otherwise on itself. */
const marker = (id: string) => {
  const step = document.getElementById(id) as Element
  return getComputedStyle(step.querySelector(":scope > a") ?? step, "::before")
}

const ALTERNATIVE = CSS.supports("content", '"x" / "y"')

describe("lt-steps", () => {
  it("draws the steps before the current one as done, and reads them as completed", () => {
    mount(ORDER)

    for (const id of ["site", "survey"]) {
      if (ALTERNATIVE) {
        expect(marker(id).content).toBe('"" / "Completed "')
      } else {
        expect(marker(id).content).toBe('""')
      }
    }
    // The check is the checkbox's token, cut out of the marker as a mask,
    // and not a character.
    const check = getComputedStyle(document.documentElement)
      .getPropertyValue("--lt-icon-check")
      .trim()
      .replace(/^url\("?/, 'url("')
      .replace(/"?\)$/, '")')
    for (const id of ["site", "survey"]) {
      expect(marker(id).maskImage, id).toContain(check)
      expect(marker(id).maskComposite, id).toMatch(/^exclude(, exclude)*$/)
    }
    // Both, not only the one right before the current step.
    for (const id of ["site", "survey"]) {
      expect(marker(id).backgroundColor, id).not.toBe(
        marker("payment").backgroundColor,
      )
    }
  })

  it("numbers the current step and the ones after it, without reading the number", () => {
    mount(ORDER)

    const number = ALTERNATIVE ? 'counter(lt-steps) / ""' : "counter(lt-steps)"
    expect(marker("walls").content).toBe(number)
    expect(marker("payment").content).toBe(number)
    // The current step stands apart from the ones after it.
    expect(marker("walls").borderTopColor).not.toBe(
      marker("payment").borderTopColor,
    )
    expect(
      getComputedStyle(document.getElementById("walls") as Element).fontWeight,
    ).not.toBe(
      getComputedStyle(document.getElementById("payment") as Element)
        .fontWeight,
    )
  })

  it("draws no step as done when no step is current", () => {
    mount(ORDER.replace(' aria-current="step"', ""))

    for (const id of ["site", "survey", "walls", "payment"]) {
      expect(marker(id).content).not.toContain("Completed")
      expect(marker(id).maskImage).toBe("none")
    }
  })

  it("takes the image from --lt-steps-done-icon", () => {
    mount(ORDER)
    const list = document.querySelector(".lt-steps") as HTMLElement
    list.style.setProperty("--lt-steps-done-icon", "linear-gradient(red, red)")

    expect(marker("survey").maskImage).toMatch(/^linear-gradient/)
    expect(marker("payment").maskImage).toBe("none")
  })

  it("takes the text from --lt-steps-done-text", () => {
    mount(ORDER)
    const list = document.querySelector(".lt-steps") as HTMLElement
    list.style.setProperty("--lt-steps-done-text", '"Fullført "')

    // Without the alternative text the variable is not read, and the check
    // stays as it is.
    expect(marker("survey").content).toBe(
      ALTERNATIVE ? '"" / "Fullført "' : '""',
    )
  })

  it("breaks a name longer than its share of the row, rather than run into the next step", async () => {
    mount(`<div id="box" style="inline-size: 37rem">
      <ol class="lt-steps" aria-label="Order">
        <li id="first">Site</li>
        <li id="long" aria-current="step">Confirmationofthesmallprint</li>
        <li>Survey</li><li>Walls</li><li>Payment</li><li>Done</li>
      </ol>
    </div>`)
    await waitForPaint()

    const long = document.getElementById("long") as HTMLElement
    // Still a row, and the name stays inside its own step.
    expect(long.getBoundingClientRect().top).toBe(
      (document.getElementById("first") as Element).getBoundingClientRect().top,
    )
    // The text, not the step: the line to the next marker reaches past the
    // step on purpose, and `scrollWidth` counts it.
    const text = document.createRange()
    text.selectNodeContents(long)
    const name = text.getBoundingClientRect()
    const step = long.getBoundingClientRect()
    expect(name.left).toBeGreaterThanOrEqual(step.left)
    expect(name.right).toBeLessThanOrEqual(step.right)
  })

  it("lines up the steps in a row, and in a column below 28rem", async () => {
    mount(`<div id="box">${ORDER}</div>`)
    const box = document.getElementById("box") as HTMLElement
    const top = (id: string) =>
      (document.getElementById(id) as Element).getBoundingClientRect().top

    // 30rem is the content column of the documentation, and of many forms.
    box.style.inlineSize = "30rem"
    await waitForPaint()
    expect(top("payment")).toBe(top("site"))

    // A phone at 375 pixels is 23.4rem.
    box.style.inlineSize = "27rem"
    await waitForPaint()
    expect(top("survey")).toBeGreaterThan(top("site"))
    expect(top("payment")).toBeGreaterThan(top("walls"))
  })

  it.each([
    ["row", "40rem", "borderTopWidth", "borderTopColor"],
    ["column", "20rem", "borderInlineStartWidth", "borderInlineStartColor"],
  ] as const)("draws a line to the next step in a %s, and none after the last", async (_layout, width, side, colour) => {
    mount(`<div id="box" style="inline-size: ${width}">${ORDER}</div>`)
    await waitForPaint()

    const line = (id: string) =>
      getComputedStyle(document.getElementById(id) as Element, "::after")
    expect(line("site").content).toBe('""')
    expect(line("site")[side]).toBe("2px")
    expect(line("payment").content).toBe("none")
    // The lines out of the done steps are done, the one out of the current
    // step is not.
    for (const id of ["site", "survey"]) {
      expect(line(id)[colour], id).not.toBe(line("walls")[colour])
    }
  })

  it("draws no line after the last step when something else follows it", () => {
    // A framework can leave a template or a script last in the list, and
    // then the last step is no longer `:last-child`.
    mount(ORDER.replace("</ol>", "<template></template></ol>"))

    expect(
      getComputedStyle(document.getElementById("payment") as Element, "::after")
        .content,
    ).toBe("none")
  })

  it("sets the attributes from the builder function", () => {
    expect(steps()).toEqual({ class: "lt-steps" })
  })

  it("has no accessibility violations", async () => {
    mount(ORDER)
    await waitForPaint()
    await expectNoAccessibilityViolations()
  })
})
