/// <reference path="./types/css.d.ts" />
/// Without this, Vitest's `CDPSession` is an empty interface. The provider
/// fills it in, and here it is Playwright that gives us `send`.
/// <reference types="@vitest/browser-playwright" />

import { afterEach, describe, expect, it } from "vitest"
import { cdp, server, userEvent } from "vitest/browser"

import { mount, waitForPaint } from "./testing/a11y"
import { pixel } from "./testing/pixel"

import "./tokens/tokens.css"
import "./components/css/checkbox/checkbox.css"
import "./components/css/divider/divider.css"
import "./components/css/skeleton/skeleton.css"
import "./components/css/radio/radio.css"
import "./components/css/switch/switch.css"
import "./components/css/select/select.css"
import "./components/css/tag/tag.css"
import "./components/css/toggle-group/toggle-group.css"
import "./components/css/pagination/pagination.css"
import "./components/css/progress/progress.css"
import "./components/css/tooltip/tooltip.css"
import "./components/css/table/table.css"
import "./components/frame/suggestion/suggestion.css"

/**
 * That the components still show their state in high contrast mode.
 *
 * Windows' high contrast replaces the colours on the page with the user's own
 * set. Tested in the mode: custom colours are overridden, gradients and
 * `box-shadow` are removed, while system colours, borders, masks and data URL
 * images survive.
 *
 * That hits exactly the controls that show their state with a colour or a
 * gradient: the tick in the checkbox, the dot in the radio button, the knob in
 * the switch and the selected option in a group. Without the rules tested
 * here, on and off look exactly the same.
 *
 * The mode can only be turned on in Chromium from here, so the tests skip the
 * other two. The rules are plain CSS and behave the same.
 */

async function setHighContrast(on: boolean) {
  await cdp().send("Emulation.setEmulatedMedia", {
    features: on ? [{ name: "forced-colors", value: "active" }] : [],
  })
  await waitForPaint()
}

function style(id: string) {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLElement)) throw new Error(`Missing #${id}`)
  return getComputedStyle(element)
}

describe.skipIf(server.browser !== "chromium")("in high contrast mode", () => {
  afterEach(async () => {
    // The mode applies to the whole page, and would otherwise stay on and
    // affect the tests that run afterwards.
    await setHighContrast(false)
  })

  it("keeps the divider and the skeleton visible", async () => {
    // Both were only a background, and backgrounds are forced to the page
    // surface colour.
    mount(`
      <hr class="lt-divider" id="line" />
      <hr class="lt-divider" data-variant="subtle" id="subtle" />
      <div class="lt-skeleton" id="skeleton"></div>
    `)
    await setHighContrast(true)
    const surface = getComputedStyle(document.body).backgroundColor

    expect(style("line").backgroundColor).not.toBe(surface)
    expect(style("subtle").backgroundColor).not.toBe(surface)
    expect(style("skeleton").borderTopStyle).toBe("solid")
    expect(style("skeleton").borderTopWidth).toBe("1px")
  })

  it("lets the browser draw the checkbox, the radio button and the switch", async () => {
    mount(`
      <input class="lt-checkbox" type="checkbox" id="box" checked />
      <input class="lt-radio" type="radio" id="radio" checked />
      <input class="lt-switch" type="checkbox" role="switch" id="switch" checked />
      <select class="lt-select" id="list"><option>Option</option></select>
      <select class="lt-select" data-picker="styled" id="list-styled"><option>Option</option></select>
    `)

    await setHighContrast(true)

    for (const id of ["box", "radio", "switch", "list", "list-styled"]) {
      // `appearance: auto` gives back the browser's own drawing, which is
      // right in every theme the user can choose.
      expect(style(id).appearance, id).toBe("auto")
      expect(style(id).backgroundImage, id).toBe("none")
    }
  })

  it("keeps the role on the switch even though its shape disappears", async () => {
    mount(
      `<input class="lt-switch" type="checkbox" role="switch" id="switch" checked />`,
    )

    await setHighContrast(true)

    const toggle = document.getElementById("switch") as HTMLInputElement
    expect(toggle.getAttribute("role")).toBe("switch")
    expect(toggle.checked).toBe(true)
  })

  it("distinguishes the selected option with the system colours", async () => {
    mount(`
      <fieldset class="lt-toggle-group">
        <legend>View</legend>
        <label class="lt-toggle-group__option" id="selected">
          <input type="radio" name="view" checked /> List
        </label>
        <label class="lt-toggle-group__option" id="unselected">
          <input type="radio" name="view" /> Map
        </label>
      </fieldset>

      <button class="lt-tag" data-selectable aria-pressed="true" id="tag-on" type="button">Cutter</button>
      <button class="lt-tag" data-selectable aria-pressed="false" id="tag-off" type="button">Worm</button>

      <ul class="lt-pagination">
        <li><a href="#" aria-current="page" id="page-current">2</a></li>
        <li><a href="#" id="page-other">3</a></li>
      </ul>

      <ul class="lt-suggestion__list" role="listbox">
        <li class="lt-suggestion__option" role="option" aria-selected="true" id="suggestion-on">Crowbar</li>
        <li class="lt-suggestion__option" role="option" aria-selected="false" id="suggestion-off">Needle</li>
      </ul>
    `)

    await setHighContrast(true)

    for (const [on, off] of [
      ["selected", "unselected"],
      ["tag-on", "tag-off"],
      ["page-current", "page-other"],
      ["suggestion-on", "suggestion-off"],
    ]) {
      expect(style(on).backgroundColor, on).not.toBe(style(off).backgroundColor)
      expect(style(on).color, on).not.toBe(style(off).color)
    }
  })

  it("keeps the current page readable under the mouse", async () => {
    // The hover rule beat the high contrast rule on specificity, and the
    // background was forced to `Canvas` under `HighlightText`: the same
    // colour on both.
    mount(`
      <ul class="lt-pagination">
        <li><a href="#" aria-current="page" id="page-current">2</a></li>
      </ul>
    `)
    await setHighContrast(true)

    await userEvent.hover(
      document.getElementById("page-current") as HTMLElement,
    )
    await waitForPaint()

    expect(style("page-current").backgroundColor).not.toBe(
      style("page-current").color,
    )
    await userEvent.unhover(
      document.getElementById("page-current") as HTMLElement,
    )
  })

  it("gives the tooltip bubble a border, so it does not float on the content", async () => {
    mount(`
      <span class="lt-tooltip">
        <button type="button" aria-describedby="hint">Archive</button>
        <span class="lt-tooltip__bubble" role="tooltip" id="hint">Moved to the archive</span>
      </span>
    `)

    await setHighContrast(true)

    // Outside the mode the bubble has a dark surface and light text, and
    // needs no border.
    expect(style("hint").borderTopWidth).toBe("1px")
  })

  it("draws the arrow in a sortable column in the system text colour", async () => {
    // The arrow is a mask with a background colour, and backgrounds are
    // forced to the page surface colour. Without the rule it became
    // invisible.
    mount(`
      <table class="lt-table">
        <thead><tr>
          <th scope="col" aria-sort="ascending"><button type="button" class="lt-table__sort" id="sorted">Date</button></th>
          <th scope="col"><button type="button" class="lt-table__sort" id="unsorted">Amount</button></th>
        </tr></thead>
      </table>
    `)
    await setHighContrast(true)
    const surface = getComputedStyle(document.body).backgroundColor

    for (const id of ["sorted", "unsorted"]) {
      const arrow = getComputedStyle(
        document.getElementById(id) as HTMLElement,
        "::after",
      )
      expect(arrow.backgroundColor, id).not.toBe(surface)
      expect(arrow.maskImage, id).toContain("svg")
    }
  })

  it("shows that something is in progress in an indeterminate progress bar", async () => {
    // The stripe that sweeps across is a gradient, and gradients are removed
    // in the mode. Without the exception an empty frame was left.
    mount(`
      <progress class="lt-progress" id="indeterminate" aria-label="Uploading"></progress>
      <span id="highlight" style="color: Highlight">x</span>
      <span id="text" style="color: CanvasText">x</span>
    `)
    await setHighContrast(true)

    const indeterminate = style("indeterminate")
    expect(indeterminate.backgroundImage).toContain("gradient")
    // The stripe is in the system highlight colour, so it stands out from
    // the surface.
    expect(indeterminate.backgroundImage).toContain(style("highlight").color)
    expect(indeterminate.outlineStyle).toBe("solid")
    expect(indeterminate.outlineColor).toBe(style("text").color)
  })

  it("shows how far a determinate progress bar has come", async () => {
    // The filled part is a pseudo-element that read `currentColor`, and the
    // mode forced the background to `Canvas`. The style on the host looked
    // right, but the bar was empty, so it is the pixels that must be read.
    mount(`
      <progress class="lt-progress" id="determinate" value="50" max="100"
        aria-label="Uploaded" style="--lt-progress-height: 16px"></progress>
      <progress class="lt-progress" id="coloured" value="50" max="100"
        data-color="danger" aria-label="Uploaded" style="--lt-progress-height: 16px"></progress>
    `)
    await setHighContrast(true)

    for (const id of ["determinate", "coloured"]) {
      const bar = document.getElementById(id) as HTMLElement
      const filled = await pixel(bar, 0.25)
      const empty = await pixel(bar, 0.75)
      expect(filled, id).not.toEqual(empty)
    }
  })

  it("leaves the state unchanged outside the mode", async () => {
    mount(`<input class="lt-checkbox" type="checkbox" id="box" checked />`)
    await waitForPaint()

    expect(style("box").appearance).toBe("none")
    expect(style("box").backgroundImage).toContain("svg")
  })
})
