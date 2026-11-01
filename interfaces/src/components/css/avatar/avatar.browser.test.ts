/// <reference path="../../../types/css.d.ts" />

import { beforeEach, describe, expect, it } from "vitest"

import {
  expectNoAccessibilityViolations,
  mount,
  waitForPaint,
} from "../../../testing/a11y"
import { pixel } from "../../../testing/pixel"
import { avatar } from "./avatar"
import avatarCss from "./avatar.css?inline"

import "../../../tokens/tokens.css"
import "./avatar.css"

describe("lt-avatar", () => {
  beforeEach(() => {
    mount(`
      <span class="lt-avatar" data-size="small" id="small" aria-hidden="true">DP</span>
      <span class="lt-avatar" id="regular" aria-hidden="true">DP</span>
      <span class="lt-avatar" data-size="large" id="large" aria-hidden="true">DP</span>
      <span class="lt-avatar" data-variant="square" id="square" aria-hidden="true">NS</span>
      <p>Dead Pixel</p>
    `)
  })

  it("tells the sizes apart", () => {
    const widths = ["small", "regular", "large"].map(
      (id) =>
        (document.getElementById(id) as HTMLElement).getBoundingClientRect()
          .width,
    )

    expect(widths[0]).toBeLessThan(widths[1])
    expect(widths[1]).toBeLessThan(widths[2])
  })

  it("is round by default and rounded as a square", () => {
    const round = getComputedStyle(
      document.getElementById("regular") as Element,
    )
    const square = getComputedStyle(
      document.getElementById("square") as Element,
    )

    expect(round.borderRadius).toMatch(/50%|9999px/)
    expect(square.borderRadius).not.toMatch(/50%/)
  })

  it("sets the attributes from the builder function", () => {
    expect(avatar()).toEqual({ class: "lt-avatar" })
    expect(avatar({ size: "large", variant: "square" })).toEqual({
      class: "lt-avatar",
      "data-size": "large",
      "data-variant": "square",
    })
  })

  it("has no accessibility violations", async () => {
    await waitForPaint()
    await expectNoAccessibilityViolations()
  })
})

describe("lt-avatar as a button", () => {
  /*
   * The ring around the image is an `outline` in the layer, and it beat the
   * browser's own focus indicator. An avatar that is a button then only got
   * the thin ring inside the edge when it had focus. Whether `:focus-visible`
   * matches after a programmatic `focus()` is up to the browser, so the test
   * swaps it for an attribute in a copy of the rules, as the test for
   * visited links does.
   */
  it("shows the focus ring and not the ring around the image", () => {
    mount(`
      <style>${avatarCss.replaceAll(":focus-visible", "[data-focus]")}</style>
      <button class="lt-avatar" id="profile" aria-label="Profile">DP</button>
    `)
    const button = document.getElementById("profile") as HTMLButtonElement
    expect(getComputedStyle(button).outlineWidth).toBe("1px")

    button.setAttribute("data-focus", "")
    const style = getComputedStyle(button)
    expect(style.outlineWidth).toBe("2px")
    expect(style.outlineOffset).toBe("2px")
  })
})

describe("lt-avatar with an image", () => {
  it("draws the ring over a light image", async () => {
    // The ring was an inset shadow, and that is painted below the content. An
    // image that filled the surface covered it, so the ring only existed with
    // initials. The ring gets a colour here that appears nowhere else, so it
    // cannot be mistaken for the background showing through at the edge of a
    // rounded surface.
    const white = `data:image/svg+xml,${encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="white"/></svg>',
    )}`
    const style =
      "--lt-avatar-size: 96px; --lt-color-neutral-border-subtle: rgb(255, 0, 0)"
    mount(`
      <span class="lt-avatar" id="round" style="${style}"><img src="${white}" alt="" /></span>
      <span class="lt-avatar" data-variant="square" id="square" style="${style}"><img src="${white}" alt="" /></span>
    `)
    for (const image of document.querySelectorAll("img")) await image.decode()
    await waitForPaint()

    for (const id of ["round", "square"]) {
      const element = document.getElementById(id) as HTMLElement
      expect(await pixel(element, 0.5), id).toEqual([255, 255, 255])
      // The outermost pixels, since the edge of a circle is anti-aliased against the page.
      let reddest = 0
      for (const x of [0, 0.01, 0.02, 0.03]) {
        const [r, g, b] = await pixel(element, x)
        reddest = Math.max(reddest, r - Math.max(g, b))
      }
      expect(reddest, id).toBeGreaterThan(60)
    }
  })
  it("lets the front avatar cover the ring of the one behind it in a stack", async () => {
    // The ring is an `outline`, and an outline is painted after all the
    // content in the stacking context. Without a context of its own per
    // avatar, the ring of the avatar behind lay as an arc over the image of
    // the one in front. The one behind gets a red ring and the one in front a
    // white image with a white ring, so every red pixel inside the one in
    // front is the ring behind showing through.
    const white = `data:image/svg+xml,${encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="white"/></svg>',
    )}`
    mount(`
      <ul class="lt-avatar-stack" style="--lt-avatar-size: 96px; --lt-avatar-stack-overlap: -24px">
        <li><span class="lt-avatar" id="behind" style="--lt-color-neutral-border-subtle: rgb(255, 0, 0)"><img src="${white}" alt="" /></span></li>
        <li><span class="lt-avatar" id="front" style="--lt-color-neutral-border-subtle: rgb(255, 255, 255)"><img src="${white}" alt="" /></span></li>
      </ul>
    `)
    for (const image of document.querySelectorAll("img")) await image.decode()
    await waitForPaint()

    // The stack reverses the order: the first in the markup is furthest to
    // the right, and the second lies over its left edge, 24 px in.
    const behind = document.getElementById("behind") as HTMLElement
    const front = document.getElementById("front") as HTMLElement
    // The ring behind exists: red at the outermost edge on the side that is not covered.
    let reddest = 0
    for (const x of [0.97, 0.98, 0.99, 1]) {
      const [r, g, b] = await pixel(behind, x)
      reddest = Math.max(reddest, r - Math.max(g, b))
    }
    expect(reddest, "the ring behind").toBeGreaterThan(60)
    // Where the left edge of the one behind, with its ring, lies under the one
    // in front, only the white image in front is visible. The edge is 72 px
    // into the one in front, and is read over a width of a few pixels and at
    // three heights.
    for (const x of [0.73, 0.75, 0.77, 0.79])
      for (const y of [0.3, 0.5, 0.7]) {
        const [r, g, b] = await pixel(front, x, y)
        expect(r - Math.max(g, b), `front at ${x},${y}`).toBeLessThan(40)
      }
  })
  it("shows the whole focus ring of an avatar behind another in a stack", async () => {
    // Each avatar in the stack is painted on its own, and that applies to the
    // focus ring too: the one behind had its ring covered where the one in
    // front overlaps. The one with focus is lifted above its neighbours. The
    // ring gets a red colour that appears nowhere else, and `:focus-visible`
    // is swapped for an attribute in a copy of the rules, as in the test for
    // the button. The screenshot is taken of the stack, since the ring lies
    // outside the avatar's own box.
    const white = `data:image/svg+xml,${encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="white"/></svg>',
    )}`
    mount(`
      <style>${avatarCss.replaceAll(":focus-visible", "[data-focus]")}</style>
      <ul class="lt-avatar-stack" id="stack" style="--lt-avatar-size: 96px; --lt-avatar-stack-overlap: -24px; --lt-focus-ring: 2px solid rgb(255, 0, 0)">
        <li><button class="lt-avatar" id="behind" data-focus aria-label="Behind"><img src="${white}" alt="" /></button></li>
        <li><button class="lt-avatar" id="front" aria-label="Front"><img src="${white}" alt="" /></button></li>
      </ul>
    `)
    for (const image of document.querySelectorAll("img")) await image.decode()
    await waitForPaint()

    // The stack is 168 px wide. The one behind starts 72 px in, and the focus
    // ring lies 2 to 4 px outside its left edge, under the one in front
    // without the lift.
    const stack = document.getElementById("stack") as HTMLElement
    expect(stack.getBoundingClientRect().width).toBeCloseTo(168, 0)
    let reddest = 0
    for (const x of [0.4, 0.405, 0.41, 0.415]) {
      const [r, g, b] = await pixel(stack, x)
      reddest = Math.max(reddest, r - Math.max(g, b))
    }
    expect(reddest, "the focus ring behind").toBeGreaterThan(60)
  })
})
