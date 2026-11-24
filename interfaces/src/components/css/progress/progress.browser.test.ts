/// <reference path="../../../types/css.d.ts" />

import { describe, expect, it } from "vitest"

import {
  expectNoAccessibilityViolations,
  mount,
  waitForPaint,
} from "../../../testing/a11y"
import { color, contrastRatio, rgb } from "../../../testing/color"

import "../../../tokens/tokens.css"
import "./progress.css"

describe(".lt-progress", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`shows how far the bar has gone, against the page (${theme})`, async () => {
      mount(`
        <div data-theme="${theme}">
          <progress class="lt-progress" id="p" value="30" max="100" aria-label="Uploaded"></progress>
        </div>`)
      await waitForPaint()
      const style = getComputedStyle(document.getElementById("p") as Element)
      const page = rgb(color("--lt-color-neutral-canvas", theme))

      // The track alone is 1.12:1 against the page. The outline holds 3:1, and
      // the fill stands apart from the track.
      expect(style.outlineStyle).toBe("solid")
      expect(
        contrastRatio(rgb(style.outlineColor), page),
      ).toBeGreaterThanOrEqual(3)
      expect(
        contrastRatio(rgb(style.color), rgb(style.backgroundColor)),
      ).toBeGreaterThanOrEqual(3)
    })
  }

  it("does not take the outline from the height, so a thin bar keeps its fill", async () => {
    // A `border` with `border-box` took 2 pixels, and a 2 pixel bar became a
    // grey line with no fill.
    mount(`
      <progress class="lt-progress" id="p" value="30" max="100"
        aria-label="Uploaded" style="--lt-progress-height: 2px"></progress>`)
    await waitForPaint()

    expect((document.getElementById("p") as HTMLElement).clientHeight).toBe(2)
  })

  it("has no accessibility violations", async () => {
    mount(`
      <progress class="lt-progress" value="30" max="100" aria-label="Uploaded"></progress>
      <progress class="lt-progress" aria-label="Loading"></progress>`)
    await waitForPaint()

    await expectNoAccessibilityViolations()
  })
})
