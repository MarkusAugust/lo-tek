/// <reference path="../../../types/css.d.ts" />

import { beforeEach, describe, expect, it } from "vitest"

import {
  expectNoAccessibilityViolations,
  mount,
  waitForPaint,
} from "../../../testing/a11y"
import { card } from "./card"

import "../../../tokens/tokens.css"
import "./card.css"
import "../link/link.css"
import "../paragraph/paragraph.css"
import "../help-text/help-text.css"
import "../badge/badge.css"
import "../button/button.css"

describe("lt-card", () => {
  beforeEach(() => {
    mount(`
      <div class="lt-card" id="regular">
        <h3 class="lt-card__title">Runner's policy AV-2079-0233</h3>
        <p>Taken out 4 March. Premium EB 1,200 a month.</p>
      </div>
      <div class="lt-card" data-variant="filled" id="filled">
        <h3 class="lt-card__title">Claim AV-2079-0481</h3>
        <p>In progress.</p>
      </div>
      <a class="lt-card" data-interactive href="#" id="clickable">
        <h3 class="lt-card__title">See the whole claim</h3>
        <p>All attachments and messages.</p>
      </a>
    `)
  })

  it("lets a badge, a button and a link keep their own width, and stretches the paragraph", () => {
    mount(`
      <div class="lt-card" id="with-badge" style="width: 400px">
        <p>Filed 4 March.</p>
        <span class="lt-badge" data-color="success">Paid</span>
        <button class="lt-button" data-variant="secondary">Upload attachment</button>
        <a class="lt-link" href="#">Read the small print</a>
      </div>
    `)
    const cardElement = document.getElementById("with-badge") as HTMLElement
    const width = (s: string) =>
      (cardElement.querySelector(s) as HTMLElement).getBoundingClientRect()
        .width
    const inside =
      cardElement.clientWidth -
      2 * Number.parseFloat(getComputedStyle(cardElement).paddingLeft)

    expect(width(".lt-badge")).toBeLessThan(inside / 2)
    expect(width(".lt-button")).toBeLessThan(inside)
    expect(width(".lt-link")).toBeLessThan(inside / 2)
    expect(width("p")).toBeCloseTo(inside, 0)
  })

  it("tells filled apart from outlined", () => {
    const regular = getComputedStyle(
      document.getElementById("regular") as Element,
    )
    const filled = getComputedStyle(
      document.getElementById("filled") as Element,
    )

    expect(filled.backgroundColor).not.toBe(regular.backgroundColor)
    expect(filled.borderTopColor).not.toBe(regular.borderTopColor)
  })

  it("keeps the clickable card a real link element", () => {
    const clickable = document.getElementById("clickable") as HTMLElement

    // A <div> with a click listener can neither be reached with the keyboard
    // nor announced as something to press. So data-interactive only sets
    // the style.
    expect(clickable.tagName).toBe("A")
    expect(getComputedStyle(clickable).textDecorationLine).toBe("none")
  })

  it("sets the attributes from the builder function", () => {
    expect(card()).toEqual({ class: "lt-card" })
    expect(card({ variant: "filled", interactive: true })).toEqual({
      class: "lt-card",
      "data-variant": "filled",
      "data-interactive": "",
    })
    expect(card.title).toBe("lt-card__title")
  })

  it("has no accessibility violations", async () => {
    await waitForPaint()
    await expectNoAccessibilityViolations()
  })
})

describe("lt-card as a button", () => {
  it("has the same font as a card that is a link", () => {
    // A <button> does not inherit the font, and the card had 13 pixels.
    mount(`
      <a class="lt-card" data-interactive href="#"><p id="in-link">Text</p></a>
      <button class="lt-card" data-interactive type="button"><p id="in-button">Text</p></button>
    `)
    const font = (id: string) =>
      getComputedStyle(document.getElementById(id) as HTMLElement).fontSize

    expect(font("in-button")).toBe(font("in-link"))
  })
})

describe("paragraphs in lt-card", () => {
  it("lets the class on the paragraph win over the card", () => {
    // `.lt-card p` beat `.lt-paragraph` on specificity, so
    // `--lt-paragraph-line-height` worked everywhere except in a card.
    mount(`
      <p class="lt-paragraph" id="outside" style="--lt-paragraph-line-height: 1.2">Text</p>
      <div class="lt-card">
        <p class="lt-paragraph" id="inside" style="--lt-paragraph-line-height: 1.2">Text</p>
        <p class="lt-help-text" id="help">Help</p>
      </div>
    `)
    const style = (id: string) =>
      getComputedStyle(document.getElementById(id) as HTMLElement)

    expect(style("inside").lineHeight).toBe(style("outside").lineHeight)
    expect(style("help").marginTop).not.toBe("0px")
  })
})
