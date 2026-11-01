/// <reference path="../../../types/css.d.ts" />

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { server } from "vitest/browser"
import page from "../../../../../documentation/src/content/docs/components/accordion.mdx?raw"
import {
  expectNoAccessibilityViolations,
  mount,
  waitForPaint,
} from "../../../testing/a11y"
import { accordion } from "./accordion"

import "../../../tokens/tokens.css"
import "./accordion.css"

describe("lt-accordion", () => {
  afterEach(() => {
    document.getElementById("recipe")?.remove()
  })

  beforeEach(() => {
    mount(`
      <details class="lt-accordion" id="first">
        <summary>Who can take out a runner's policy?</summary>
        <div class="lt-accordion__content">
          <p>Anyone who jacks in for a living, once our medical has cleared them.</p>
        </div>
      </details>
      <details class="lt-accordion" id="second" open>
        <summary>How long does a claim take?</summary>
        <div class="lt-accordion__content">
          <p>We process a claim within three weeks.</p>
        </div>
      </details>
    `)
  })

  it("lets the browser handle opening and closing", () => {
    const panel = document.getElementById("first") as HTMLDetailsElement
    const button = panel.querySelector("summary") as HTMLElement

    expect(panel.open).toBe(false)
    button.click()
    expect(panel.open).toBe(true)
  })

  it("replaces the browser's own triangle with one that is the same in every browser", () => {
    const button = document.querySelector("summary") as HTMLElement

    expect(getComputedStyle(button).listStyleType).toBe("none")
    expect(getComputedStyle(button, "::after").content).not.toBe("normal")
  })

  it("turns the arrow when the panel is open", () => {
    const closed = getComputedStyle(
      document.querySelector("#first summary") as Element,
      "::after",
    ).transform
    const open = getComputedStyle(
      document.querySelector("#second summary") as Element,
      "::after",
    ).transform

    expect(closed).not.toBe(open)
  })

  it("lets the recipe on the page replace the arrow without it being turned", () => {
    // The page shows how to replace the arrow. The rotation is in `transform`
    // and changes when the panel is open, so a snippet that only overrode
    // `content` and `border` gave a tilted "+", and a "×" when the panel was
    // open. The character must also have empty alternative text, or it
    // becomes part of the button's name: the screen reader says "Who can
    // apply? +" when `<summary>` gets focus. The snippet is read from the
    // page, so it cannot drift from the code.
    const snippet = /```css\n([\s\S]*?)```/.exec(page)?.[1]
    if (snippet === undefined)
      throw new Error("Found no CSS snippet on the page")
    const style = document.createElement("style")
    style.id = "recipe"
    style.textContent = snippet
    document.head.append(style)

    const closed = getComputedStyle(
      document.querySelector("#first summary") as Element,
      "::after",
    )
    const open = getComputedStyle(
      document.querySelector("#second summary") as Element,
      "::after",
    )

    expect(closed.transform).toBe("none")
    expect(open.transform).toBe("none")
    expect(closed.content).not.toBe('""')
    if (CSS.supports("content", '"/" / ""')) {
      expect(closed.content).toMatch(/\/\s*""$/)
    }
  })

  /*
   * <details> keeps the content searchable. Build the same thing from buttons
   * and aria-expanded, and the text is hidden with `hidden`, and the browser's
   * find does not find it. The test used to check only `textContent`, which is
   * set in both cases, so it could not tell them apart. `window.find` is
   * find-in-page from script. It is not standard, and whether it finds text in
   * a closed <details> differs between the engines, so the test runs where
   * that has been checked.
   */
  it.skipIf(server.browser !== "chromium")(
    "lets find-in-page find the text in a closed panel",
    () => {
      mount(`
        <details class="lt-accordion" id="closed">
          <summary>Who can take out a runner's policy?</summary>
          <div class="lt-accordion__content"><p>Dustbunnyhabitat</p></div>
        </details>
        <button type="button" aria-expanded="false">Who can take out a policy?</button>
        <div hidden><p>Dormerwindowmotif</p></div>
      `)
      const find = (text: string) => {
        getSelection()?.removeAllRanges()
        return (window as unknown as { find(text: string): boolean }).find(text)
      }

      expect(find("Dustbunnyhabitat")).toBe(true)
      expect(find("Dormerwindowmotif")).toBe(false)
    },
  )

  it("gives a heading in summary the same size as without one", () => {
    // The documentation shows `<summary><h3>`. The heading used to get the
    // browser's margin and size.
    mount(`
      <details class="lt-accordion"><summary id="without">Question</summary></details>
      <details class="lt-accordion"><summary><h3 id="with">Question</h3></summary></details>
    `)
    const heading = getComputedStyle(document.getElementById("with") as Element)
    const without = getComputedStyle(
      document.getElementById("without") as Element,
    )

    expect(heading.marginBlockStart).toBe("0px")
    expect(heading.fontSize).toBe(without.fontSize)
  })

  it("gives the heading and the content the same inline padding", () => {
    mount(`
      <details class="lt-accordion" open style="--lt-accordion-padding-inline: 40px">
        <summary id="top">Question</summary>
        <div class="lt-accordion__content" id="content"><p>Answer</p></div>
      </details>
    `)

    expect(
      getComputedStyle(document.getElementById("content") as Element)
        .paddingInlineStart,
    ).toBe("40px")
    expect(
      getComputedStyle(document.getElementById("top") as Element)
        .paddingInlineStart,
    ).toBe("40px")
  })

  it("sets the attributes from the builder function", () => {
    expect(accordion()).toEqual({ class: "lt-accordion" })
    expect(accordion({ variant: "plain" })).toEqual({
      class: "lt-accordion",
      "data-variant": "plain",
    })
    expect(accordion.content).toBe("lt-accordion__content")
  })

  it("has no accessibility violations", async () => {
    await waitForPaint()
    await expectNoAccessibilityViolations()
  })
})
