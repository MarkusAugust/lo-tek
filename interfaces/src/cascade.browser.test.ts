/// <reference path="./types/css.d.ts" />

/*
 * States that lost in the cascade.
 *
 * Every bug here had the same shape: two rules with equal specificity, or a
 * hover raised above the state, and the outcome decided by the order in the
 * file or by the order the stylesheets were loaded in. The resting state
 * was correct in each of them, so the tests that only read it saw nothing.
 *
 * The cases that need the mouse are in `hover.browser.test.ts`. The browser
 * page has one mouse, and two files hovering at the same time move it for
 * each other.
 */

import { beforeEach, describe, expect, it } from "vitest"
import inputSource from "./components/css/input/input.css?inline"
import searchSource from "./components/css/search/search.css?inline"
import { mount, waitForPaint } from "./testing/a11y"
import { contrastRatio } from "./testing/color.js"
import tokenSource from "./tokens/tokens.css?inline"

import "./tokens/tokens.css"
import "./components/css/button/button.css"
import "./components/css/label/label.css"
import "./components/css/fieldset/fieldset.css"

function style(id: string, pseudo?: string) {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLElement)) throw new Error(`Missing #${id}`)
  return getComputedStyle(element, pseudo)
}

/** `rgb(r, g, b)` from the browser to the numbers the contrast calculation takes. */
function toRgb(value: string) {
  const [r, g, b] = (value.match(/[\d.]+/g) ?? []).map(Number)
  return { r, g, b }
}

function appearance(id: string) {
  const s = style(id)
  return [s.backgroundColor, s.color, s.borderTopColor].join(" / ")
}

describe("disabled button", () => {
  const VARIANTS = ["secondary", "ghost", "danger"] as const

  beforeEach(() => {
    mount(`
      <button class="lt-button" id="primary" disabled>Send</button>
      ${VARIANTS.map(
        (v) => `
        <button class="lt-button" data-variant="${v}" id="${v}-on">Active</button>
        <button class="lt-button" data-variant="${v}" id="${v}-off" disabled>Off</button>
        <button class="lt-button" data-variant="${v}" id="${v}-aria" aria-disabled="true">Off</button>`,
      ).join("")}
    `)
  })

  for (const variant of VARIANTS) {
    it(`looks disabled also as ${variant}`, () => {
      expect(appearance(`${variant}-off`)).toBe(appearance("primary"))
      expect(appearance(`${variant}-aria`)).toBe(appearance("primary"))
      expect(appearance(`${variant}-off`)).not.toBe(appearance(`${variant}-on`))
    })
  }
})

describe("the search field when input.css loads last", () => {
  it("keeps the icon in every state", async () => {
    /*
     * A separate document, since the order is the whole point: the consumer
     * links `search.css` and then `input.css`. `?inline` of `search.css`
     * already has `input.css` in it first, and then it is added once more
     * afterwards.
     */
    const frame = document.createElement("iframe")
    document.body.append(frame)
    const doc = frame.contentDocument as Document
    doc.open()
    doc.write(`<!doctype html>
      <style>${tokenSource}</style>
      <style>${searchSource}</style>
      <style>${inputSource}</style>
      <input class="lt-input lt-search" id="plain" />
      <input class="lt-input lt-search" id="invalid" data-state="invalid" />
      <input class="lt-input lt-search" id="valid" data-state="success" />
      <input class="lt-input lt-search" id="off" disabled />`)
    doc.close()
    await waitForPaint()

    for (const id of ["plain", "invalid", "valid", "off"]) {
      const field = doc.getElementById(id) as HTMLElement
      expect(getComputedStyle(field).backgroundImage, id).not.toBe("none")
    }
    // The state must still colour the surface.
    expect(
      getComputedStyle(doc.getElementById("invalid") as HTMLElement)
        .backgroundColor,
    ).not.toBe(
      getComputedStyle(doc.getElementById("plain") as HTMLElement)
        .backgroundColor,
    )
    frame.remove()
  })
})

describe("the markers on label and legend", () => {
  beforeEach(() => {
    mount(`
      <label class="lt-label" id="l-text" data-required="text">Name</label>
      <label class="lt-label" id="l-optional" data-optional>Name</label>
      <label class="lt-label" id="l-both" data-required="symbol" data-optional>Name</label>
      <fieldset class="lt-fieldset">
        <legend class="lt-legend" id="g-text" data-required="text">Contact</legend>
      </fieldset>
      <fieldset class="lt-fieldset">
        <legend class="lt-legend" id="g-optional" data-optional>Contact</legend>
      </fieldset>
      <fieldset class="lt-fieldset">
        <legend class="lt-legend" id="g-both" data-required="text" data-optional>Contact</legend>
      </fieldset>
    `)
  })

  it("shows the required text on both label and legend", () => {
    // That the stylesheet stays ASCII outside comments is guarded by
    // `package-css`.
    expect(style("l-text", "::after").content).toBe('" (required)"')
    expect(style("g-text", "::after").content).toBe('" (required)"')
  })

  it("shows required when the markup has both markers", () => {
    // The builder function picks required. The CSS picked "(optional)",
    // because that rule came last.
    expect(style("l-both", "::after").content).toBe('" *"')
    expect(style("g-both", "::after").content).toBe('" (required)"')
  })

  it('gives "(optional)" enough contrast to be read', () => {
    for (const id of ["l-optional", "g-optional"]) {
      const label = style(id, "::after")
      expect(label.content).toBe('" (optional)"')

      const text = toRgb(label.color)
      const surface = toRgb(getComputedStyle(document.body).backgroundColor)
      expect(contrastRatio(text, surface), id).toBeGreaterThanOrEqual(4.5)
    }
  })
})
