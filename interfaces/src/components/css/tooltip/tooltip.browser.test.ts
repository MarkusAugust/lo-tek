/// <reference path="../../../types/css.d.ts" />
/// <reference types="@vitest/browser-playwright" />

import { beforeEach, describe, expect, it } from "vitest"
import { cdp, server } from "vitest/browser"

import {
  expectNoAccessibilityViolations,
  mount,
  waitForPaint,
} from "../../../testing/a11y"
import { tooltip } from "./tooltip"

import "../../../tokens/tokens.css"
import "./tooltip.css"
import "../button/button.css"

describe("lt-tooltip", () => {
  beforeEach(() => {
    mount(`
      <span class="lt-tooltip">
        <button class="lt-button" data-variant="ghost" type="button"
          aria-describedby="hint" id="trigger">Appraise</button>
        <span class="lt-tooltip__bubble" role="tooltip" id="hint">
          All chrome is appraised at street value
        </span>
      </span>
    `)
  })

  it("shows the bubble when the trigger gets focus, not only on hover", () => {
    const bubble = document.getElementById("hint") as HTMLElement
    expect(getComputedStyle(bubble).display).toBe("none")

    ;(document.getElementById("trigger") as HTMLElement).focus()

    // A bubble that only comes with the mouse does not exist for someone
    // using the keyboard. Hence :focus-within as well as :hover.
    expect(getComputedStyle(bubble).display).toBe("block")
  })

  it("keeps the text in the accessibility tree while it is hidden", () => {
    const bubble = document.getElementById("hint") as HTMLElement

    // The bubble is `display: none` until it shows, and the text is still the
    // button's description: `aria-describedby` includes the content of a
    // hidden element it points to (accname, step 2A). It used to be
    // `visibility: hidden` for this reason, and then took up space and caused
    // horizontal scrolling.
    expect(bubble.textContent?.trim()).not.toBe("")
    expect(
      (document.getElementById("trigger") as HTMLElement).getAttribute(
        "aria-describedby",
      ),
    ).toBe("hint")
  })

  it("covers the gap between the button and the bubble across the button's full width", async () => {
    // There was a gap, and `:hover` was lost on the way up. The bridge is
    // there while the bubble shows, also on focus, and the test uses focus:
    // the browser page has one mouse, and another test file moving it at the
    // same time gave random failures in Firefox.
    const trigger = document.getElementById("trigger") as HTMLElement
    const wrapper = trigger.closest(".lt-tooltip") as HTMLElement
    const bubble = document.getElementById("hint") as HTMLElement
    trigger.focus()
    await waitForPaint()

    const button = trigger.getBoundingClientRect()
    const height = (bubble.getBoundingClientRect().bottom + button.top) / 2
    for (const x of [
      button.left + 2,
      button.left + button.width / 2,
      button.right - 2,
    ]) {
      expect(
        wrapper.contains(document.elementFromPoint(x, height)),
        `x=${x}`,
      ).toBe(true)
    }
    // No wider than the button: beside it is whatever was there.
    expect(
      wrapper.contains(document.elementFromPoint(button.right + 4, height)),
    ).toBe(false)
  })

  it.skipIf(server.browser !== "chromium")(
    "is the button's description also while it is hidden",
    async () => {
      // The bubble is `display: none`, and the text must still be the
      // button's description through `aria-describedby`. The accessibility
      // tree can only be read over CDP, which only Chromium has from here.
      expect(
        getComputedStyle(document.getElementById("hint") as Element).display,
      ).toBe("none")
      const { frameTree } = (await cdp().send("Page.getFrameTree")) as {
        frameTree: {
          frame: { id: string; url: string }
          childFrames?: unknown[]
        }
      }
      type Frame = { frame: { id: string; url: string }; childFrames?: Frame[] }
      const find = (frame: Frame): string | undefined =>
        frame.frame.url === location.href
          ? frame.frame.id
          : (frame.childFrames ?? []).map(find).find(Boolean)
      const frameId = find(frameTree as Frame)
      const { nodes } = (await cdp().send("Accessibility.getFullAXTree", {
        frameId,
      })) as {
        nodes: Array<{
          name?: { value?: string }
          description?: { value?: string }
          role?: { value?: string }
        }>
      }
      const button = nodes.find(
        (node) =>
          node.role?.value === "button" && node.name?.value === "Appraise",
      )

      expect(button?.description?.value?.trim()).toBe(
        "All chrome is appraised at street value",
      )
    },
  )

  it("takes up no space while hidden, so it causes no horizontal scrolling", () => {
    mount(`
      <div style="inline-size: 320px; overflow: auto" id="narrow">
        <div style="display: flex; justify-content: flex-end">
          <span class="lt-tooltip">
            <button type="button" aria-describedby="edge">i</button>
            <span class="lt-tooltip__bubble" role="tooltip" id="edge">A long explanation that is wider than the button</span>
          </span>
        </div>
      </div>`)
    const narrow = document.getElementById("narrow") as HTMLElement

    expect(narrow.scrollWidth).toBe(narrow.clientWidth)
  })

  it("sets the attributes from the builder function", () => {
    expect(tooltip()).toEqual({ class: "lt-tooltip" })
    expect(tooltip.bubble).toBe("lt-tooltip__bubble")
  })

  it("has no accessibility violations", async () => {
    await waitForPaint()
    await expectNoAccessibilityViolations()
  })
})
