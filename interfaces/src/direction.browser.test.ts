/// <reference path="./types/css.d.ts" />

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { mount, waitForPaint } from "./testing/a11y"

import "./tokens/tokens.css"
import "./components/css/accordion/accordion.css"
import "./components/css/input/input.css"
import "./components/css/search/search.css"
import "./components/css/switch/switch.css"
import "./components/css/select/select.css"
import "./components/css/tooltip/tooltip.css"

/**
 * That the components flip when the language goes from right to left.
 *
 * The system uses logical properties everywhere, that is
 * `padding-inline-start` and `inset-inline-end`, and they flip by
 * themselves. `background-position` has no logical variant, so the three
 * places that draw an icon in the background had to be flipped by hand.
 * Without that the magnifying glass in the search field is on the wrong side,
 * and the knob in the switch shows the opposite of its state.
 */

function style(id: string) {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLElement)) throw new Error(`Missing #${id}`)
  return getComputedStyle(element)
}

describe("right to left", () => {
  beforeEach(() => {
    // The switch slides between off and on. The transition is not what is
    // being checked here, and only makes the reading depend on how fast the
    // machine is.
    const noTransition = document.createElement("style")
    noTransition.dataset.test = ""
    noTransition.textContent = `.lt-switch { transition: none; }`
    document.head.append(noTransition)

    mount(`
      <input class="lt-input lt-search" type="search" id="search" />
      <input class="lt-input" type="date" data-variant="date" id="date" />
      <input class="lt-switch" type="checkbox" role="switch" id="off" />
      <input class="lt-switch" type="checkbox" role="switch" id="on" checked />
      <select class="lt-select" id="list"><option>Option</option></select>
      <select class="lt-select" data-picker="styled" id="list-styled"><option>Option</option></select>
    `)
  })

  afterEach(() => {
    // The direction must be reset even if a test failed, or the next one
    // checks the wrong document.
    document.documentElement.dir = "ltr"
    for (const sheet of document.querySelectorAll("style[data-test]")) {
      sheet.remove()
    }
  })

  it("flips the icon in the search field", async () => {
    await waitForPaint()
    const left = style("search").backgroundPositionX

    document.documentElement.dir = "rtl"
    await waitForPaint()
    const right = style("search").backgroundPositionX

    expect(left).not.toBe(right)
  })

  /*
   * The select is tested with two fields side by side, one in each
   * direction, rather than flipping the document between the readings.
   * WebKit 26.4 answers with padding from the previous direction after such a
   * change, even after two paints, while `background-position` is updated.
   * With two fields nothing needs recomputing, and all three engines answer
   * the same.
   */
  it("flips the arrow in the select, and the space it sits in", async () => {
    mount(`
      <div dir="ltr"><select class="lt-select" id="left-to-right"><option>Option</option></select></div>
      <div dir="rtl"><select class="lt-select" id="right-to-left"><option>خيار</option></select></div>
    `)
    await waitForPaint()

    const ltr = style("left-to-right")
    const rtl = style("right-to-left")

    expect(rtl.backgroundPositionX).not.toBe(ltr.backgroundPositionX)

    // Equally far from the edge in both directions. From the right the
    // distance is written as `calc(100% - …)`, from the left as a length.
    // The arrow used to sit 6 pixels from the edge in right-to-left and 12
    // otherwise.
    const distances = (value: string) =>
      [...value.matchAll(/(\d+(?:\.\d+)?)px/g)]
        .map((match) => Number(match[1]))
        .sort((a, b) => a - b)
    expect(distances(rtl.backgroundPositionX)).toEqual(
      distances(ltr.backgroundPositionX),
    )

    // The space the arrow sits in must follow. Had it stayed on the same
    // physical side, the arrow would have lain on top of the text.
    expect(rtl.paddingLeft).toBe(ltr.paddingRight)
    expect(rtl.paddingRight).toBe(ltr.paddingLeft)
  })

  it("gives the list drawn in the page equal space on both sides", async () => {
    // There the browser draws the arrow itself, and it takes real space in
    // the layout. Neither side should then reserve extra space. Firefox 150
    // does not have `appearance: base-select`, and should get the field as
    // before.
    mount(`
      <div dir="ltr"><select class="lt-select" data-picker="styled" id="styled-ltr"><option>Option</option></select></div>
      <div dir="rtl"><select class="lt-select" data-picker="styled" id="styled-rtl"><option>خيار</option></select></div>
    `)
    await waitForPaint()

    for (const id of ["styled-ltr", "styled-rtl"]) {
      const field = style(id)

      if (CSS.supports("appearance", "base-select")) {
        expect(field.paddingLeft, id).toBe(field.paddingRight)
      } else {
        expect(field.paddingLeft, id).not.toBe(field.paddingRight)
      }
    }
  })

  it("flips the icon in the date field", async () => {
    await waitForPaint()
    const before = style("date").backgroundPositionX

    document.documentElement.dir = "rtl"
    await waitForPaint()

    expect(style("date").backgroundPositionX).not.toBe(before)
  })

  it("keeps the switch knob meaning the same in both directions", async () => {
    await waitForPaint()
    const offBefore = style("off").backgroundPositionX
    const onBefore = style("on").backgroundPositionX

    // Off and on sit on opposite sides. That is the whole signal.
    expect(offBefore).not.toBe(onBefore)

    document.documentElement.dir = "rtl"
    await waitForPaint()

    const offAfter = style("off").backgroundPositionX
    const onAfter = style("on").backgroundPositionX

    expect(offAfter).not.toBe(onAfter)
    // The sides have swapped: the knob that was at the start in one
    // direction is at the end in the other.
    expect(offAfter).toBe(onBefore)
    expect(onAfter).toBe(offBefore)
  })

  it("keeps the tooltip centred over the button in both directions", async () => {
    /*
     * `inset-inline-start: 50%` flips, `translateX(-50%)` does not, and the
     * bubble sat a whole bubble width to the left in RTL. One element in
     * each direction side by side, for the same reason as in the tests
     * above. Both bubbles are shown with `display: block`, since only one
     * button can have focus.
     */
    mount(
      ["ltr", "rtl"]
        .map(
          (direction) => `
        <div dir="${direction}" style="padding: 4rem 12rem">
          <span class="lt-tooltip">
            <button type="button" id="button-${direction}" aria-describedby="bubble-${direction}">Archive</button>
            <span class="lt-tooltip__bubble" role="tooltip" id="bubble-${direction}" style="display: block">The recovery order moves to the archive</span>
          </span>
        </div>`,
        )
        .join(""),
    )
    await waitForPaint()

    for (const direction of ["ltr", "rtl"]) {
      const button = document
        .getElementById(`button-${direction}`)
        ?.getBoundingClientRect() as DOMRect
      const bubble = document
        .getElementById(`bubble-${direction}`)
        ?.getBoundingClientRect() as DOMRect
      const offset =
        bubble.left + bubble.width / 2 - (button.left + button.width / 2)

      expect(Math.abs(offset), direction).toBeLessThan(1)
    }
  })

  it("keeps the arrow in an accordion pointing down and up in both directions", async () => {
    // The borders are logical and swap sides, but `rotate` is physical. The
    // arrow used to point sideways in right-to-left.
    mount(
      ["ltr", "rtl"]
        .map(
          (direction) => `
        <div dir="${direction}">
          <details class="lt-accordion" id="closed-${direction}"><summary>Question</summary></details>
          <details class="lt-accordion" id="open-${direction}" open><summary>Question</summary></details>
        </div>`,
        )
        .join(""),
    )
    await waitForPaint()

    const angle = (id: string) => {
      const summary = document.querySelector(`#${id} summary`) as Element
      const matrix = new DOMMatrix(
        getComputedStyle(summary, "::after").transform,
      )
      return Math.round((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI)
    }
    // Mirrored: the same angle with the opposite sign, so the tip points the same way.
    for (const state of ["closed", "open"]) {
      expect(angle(`${state}-rtl`), state).toBe(-angle(`${state}-ltr`))
    }
  })

  it("lets the logical properties flip by themselves", async () => {
    await waitForPaint()
    const before = style("search").paddingLeft

    document.documentElement.dir = "rtl"
    await waitForPaint()

    // padding-inline-start in the CSS, so no separate rule for the direction.
    expect(style("search").paddingLeft).not.toBe(before)
  })
})
