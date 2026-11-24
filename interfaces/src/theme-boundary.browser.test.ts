/// <reference path="./types/css.d.ts" />

import { afterEach, describe, expect, it } from "vitest"
import { color, rgb } from "./testing/color"
import { contrastRatio } from "./testing/color.js"

import "./tokens/tokens.css"
import "./components/css/button/button.css"
import "./components/css/card/card.css"
import "./components/css/paragraph/paragraph.css"
import "./components/standalone/toast/toast.css"

/**
 * A theme boundary gives everything below it the theme, not just the colour
 * tokens.
 *
 * `mount()` puts the page surface on `body`, and so hid that a
 * `<div data-theme="dark">` was transparent. The tests here build the page
 * themselves, the way "Getting started" tells a consumer to.
 */

function contrast(a: string, b: string): number {
  return contrastRatio(rgb(a), rgb(b))
}

/** The first background that is not transparent, going up from the element. */
function surfaceOf(element: Element | null): string {
  let node = element
  while (node) {
    const background = getComputedStyle(node).backgroundColor
    if (rgb(background).a > 0) return background
    node = node.parentElement
  }
  return "rgb(255, 255, 255)"
}

/**
 * The focus ring as it is drawn inside an element, without anything getting
 * focus.
 *
 * `userEvent.tab()` was used here, but in Firefox focus did not always arrive
 * when several test files ran at once. What is tested is the token where the
 * button sits, so a probe with the same `outline` is enough.
 */
function ringIn(inside: Element): string {
  const probe = document.createElement("span")
  probe.style.outline = "var(--lt-focus-ring)"
  inside.append(probe)
  const color = getComputedStyle(probe).outlineColor
  probe.remove()
  return color
}

function page(html: string) {
  document.body.style.background = "var(--lt-color-neutral-canvas)"
  document.body.style.color = "var(--lt-color-neutral-text)"
  document.body.innerHTML = html
}

afterEach(() => {
  document.body.innerHTML = ""
  document.body.removeAttribute("style")
  document.documentElement.removeAttribute("data-theme")
})

describe("a theme boundary", () => {
  it("gives a dark section on a light page a dark surface and readable text", () => {
    page(`
      <div data-theme="dark" id="section">
        <p class="lt-paragraph" id="paragraph">Text</p>
        Text without a class
      </div>`)
    const section = document.getElementById("section") as HTMLElement
    const paragraph = document.getElementById("paragraph") as HTMLElement

    // The section used to be transparent, and the paragraph 1.23:1 against the page's white.
    expect(getComputedStyle(section).backgroundColor).toBe(
      color("--lt-color-neutral-canvas", "dark"),
    )
    expect(
      contrast(getComputedStyle(paragraph).color, surfaceOf(paragraph)),
    ).toBeGreaterThanOrEqual(4.5)
    expect(
      contrast(getComputedStyle(section).color, surfaceOf(section)),
    ).toBeGreaterThanOrEqual(4.5)
  })

  it("lets a component with data-theme keep its own surface", () => {
    page(
      `<div data-theme="dark" class="lt-card" data-variant="filled" id="card">Card</div>`,
    )
    const card = document.getElementById("card") as HTMLElement

    expect(getComputedStyle(card).backgroundColor).toBe(
      color("--lt-color-neutral-surface", "dark"),
    )
  })

  it("does not paint the root", () => {
    // A background on `<html>` stops the page's own `body` background from
    // filling the window. The package can be a guest on a page it does not own.
    document.documentElement.setAttribute("data-theme", "dark")
    page("<p>Text</p>")

    expect(getComputedStyle(document.documentElement).backgroundColor).toBe(
      "rgba(0, 0, 0, 0)",
    )
  })

  it("does not give the message column a surface", () => {
    page(`<lt-toast data-theme="dark" id="messages"></lt-toast>`)

    expect(
      getComputedStyle(document.getElementById("messages") as Element)
        .backgroundColor,
    ).toBe("rgba(0, 0, 0, 0)")
  })

  it("leaves a data-theme without a theme block alone", () => {
    page(`<div data-theme="auto" id="auto">Text</div>`)
    const auto = document.getElementById("auto") as HTMLElement

    expect(getComputedStyle(auto).backgroundColor).toBe("rgba(0, 0, 0, 0)")
  })

  it("gives the focus ring and the disabled state the theme of the section", async () => {
    page(`
      <div data-theme="dark">
        <button class="lt-button" id="button" type="button">Button</button>
        <button class="lt-button" id="off" type="button" disabled>Off</button>
      </div>`)
    const button = document.getElementById("button") as HTMLElement

    // The section used to inherit the ring and the disabled surface already
    // computed from `:root`, that is the light theme: 2.4:1 against the dark
    // surface.
    expect(ringIn(button)).toBe(
      color("--lt-color-accent-border-strong", "dark"),
    )
    expect(
      getComputedStyle(document.getElementById("off") as HTMLElement)
        .backgroundColor,
    ).toBe(color("--lt-color-neutral-raised", "dark"))
  })

  it("gives a light section on a dark page the light focus ring", async () => {
    document.documentElement.setAttribute("data-theme", "dark")
    page(`
      <div data-theme="light">
        <button class="lt-button" id="button" type="button">Button</button>
      </div>`)
    expect(ringIn(document.getElementById("button") as HTMLElement)).toBe(
      color("--lt-color-accent-border-strong", "light"),
    )
  })

  it("lets the focus ring follow a generated theme in a section", async () => {
    const style = document.createElement("style")
    style.textContent = `
      @layer lotek, lotek-theme;
      @layer lotek-theme {
        [data-theme="dark"] { --lt-color-accent-border-strong: #ff0000; }
      }`
    document.head.append(style)
    try {
      page(`
        <div data-theme="dark">
          <button class="lt-button" id="button" type="button">Button</button>
        </div>`)
      expect(ringIn(document.getElementById("button") as HTMLElement)).toBe(
        "rgb(255, 0, 0)",
      )
    } finally {
      style.remove()
    }
  })
})
