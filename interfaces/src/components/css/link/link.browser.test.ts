/// <reference path="../../../types/css.d.ts" />

import { beforeEach, describe, expect, it } from "vitest"
import { setAttributes } from "../../../dom"
import {
  expectNoAccessibilityViolations,
  mount,
  waitForPaint,
} from "../../../testing/a11y"
import { color } from "../../../testing/color"
import { link } from "./link"
import linkCss from "./link.css?inline"

import "../../../tokens/tokens.css"
import "./link.css"

function css(id: string) {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing element #${id}`)
  }

  return getComputedStyle(element)
}

describe("lt-link variants", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <a id="default" class="lt-link" href="#">Default</a>
      <a id="disabled" class="lt-link" role="link" tabindex="0" aria-disabled="true">Disabled</a>
    `
  })

  it("applies default link styles", () => {
    const defaultLink = css("default")

    expect(defaultLink.color).toBe(color("--lt-color-accent-text"))
    expect(defaultLink.textDecorationLine).toBe("underline")
  })

  it("applies aria-disabled styles", () => {
    const disabled = css("disabled")

    expect(disabled.color).toBe(color("--lt-color-neutral-text-subtle"))
    expect(disabled.textDecorationLine).toBe("none")
    expect(disabled.pointerEvents).toBe("none")
  })
})

describe("lt-link accessibility", () => {
  it("has enough contrast in text and when disabled", async () => {
    mount(`
      <p>
        Your claim has been filed. The terms are in
        <a class="lt-link" href="/small-print">the small print</a>.
      </p>
      <a class="lt-link" role="link" tabindex="0" aria-disabled="true">See payout statement</a>
    `)

    await waitForPaint()
    await expectNoAccessibilityViolations()
  })
})

describe("lt.link({ disabled })", () => {
  /*
   * The disabled link had `href`, and Enter followed it: `pointer-events`
   * only stops the mouse. Without `href`, an `<a>` is not a link to the screen
   * reader and is not in the tab order, so the builder function gives both
   * back.
   */
  it("gives a link without href the role and the place in the tab order", () => {
    mount(`<a id="annual-statement">See payout statement</a>`)
    const anchor = document.getElementById(
      "annual-statement",
    ) as HTMLAnchorElement

    setAttributes(anchor, link({ disabled: true }))
    expect(anchor.getAttribute("role")).toBe("link")
    expect(anchor.getAttribute("aria-disabled")).toBe("true")
    anchor.focus()
    expect(document.activeElement).toBe(anchor)

    // Ready: the app sets href, and the builder function takes back what it
    // set.
    anchor.href = "/annual-statement"
    setAttributes(anchor, link())
    expect(anchor.hasAttribute("role")).toBe(false)
    expect(anchor.hasAttribute("tabindex")).toBe(false)
    expect(anchor.hasAttribute("aria-disabled")).toBe(false)
  })
})

describe("lt-link visited", () => {
  /*
   * The browser hides `:visited` from scripts, so a link cannot be made
   * visited from here. The test therefore swaps `:visited` for an attribute
   * in a copy of the rules, in the same order. `:hover` came before
   * `:visited` with the same specificity, and a visited link did not change
   * colour under the mouse. `:hover` is swapped too, because the browser page
   * has one mouse, and hover.browser.test.ts moves it at the same time.
   */
  it("changes colour under the mouse also when the link is visited", () => {
    mount(`
      <style>
        ${linkCss.replaceAll(":visited", "[data-visited]").replaceAll(":hover", "[data-mouse]")}
        .lt-link { transition: none; }
      </style>
      <a id="visited" class="lt-link" href="#" data-visited>Your claim</a>
    `)
    const visited = document.getElementById("visited") as HTMLElement
    expect(getComputedStyle(visited).color).toBe(
      color("--lt-color-visited-text"),
    )

    visited.setAttribute("data-mouse", "")
    expect(getComputedStyle(visited).color).toBe(
      color("--lt-color-accent-text-strong"),
    )
  })
})
