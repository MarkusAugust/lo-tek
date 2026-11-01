/// <reference path="../../../types/css.d.ts" />

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import page from "../../../../../documentation/src/content/docs/components/breadcrumbs.mdx?raw"
import {
  expectNoAccessibilityViolations,
  mount,
  waitForPaint,
} from "../../../testing/a11y"
import { breadcrumbs } from "./breadcrumbs"

import "../../../tokens/tokens.css"
import "./breadcrumbs.css"

describe("lt-breadcrumbs", () => {
  afterEach(() => {
    document.getElementById("recipe")?.remove()
  })

  beforeEach(() => {
    mount(`
      <nav aria-label="You are here">
        <ol class="lt-breadcrumbs">
          <li><a href="#">Home</a></li>
          <li><a href="#">My claims</a></li>
          <li><a href="#" aria-current="page" id="here">Claim AV-2079-0481</a></li>
        </ol>
      </nav>
    `)
  })

  it("gives the separator an empty alternative text, so it is not read aloud", () => {
    // Generated content is read aloud, and the screen reader said "slash"
    // between every step. Browsers without the syntax keep the slash.
    const item = document.querySelectorAll(".lt-breadcrumbs li")[1] as Element
    const content = getComputedStyle(item, "::before").content

    if (CSS.supports("content", '"/" / ""')) {
      expect(content).toBe('"/" / ""')
    } else {
      expect(content).toBe('"/"')
    }
  })

  it("lets the recipe on the page swap the character without it being read aloud", () => {
    // The page shows how to swap the separator. The snippet sits outside the
    // layer and beats the stylesheet, so if it forgets the alternative text,
    // "›" is back in the accessibility tree and the screen reader reads it
    // between every step again. The snippet is read from the page, so it
    // cannot drift from the code.
    const snippet = /```css\n([\s\S]*?)```/.exec(page)?.[1]
    if (snippet === undefined)
      throw new Error("Found no CSS snippet on the page")
    const style = document.createElement("style")
    style.id = "recipe"
    style.textContent = snippet
    document.head.append(style)

    const item = document.querySelectorAll(".lt-breadcrumbs li")[1] as Element
    const content = getComputedStyle(item, "::before").content

    // The character is swapped, and the alternative text is there where the
    // browser supports it.
    expect(/^"(.)"/.exec(content)?.[1]).not.toBe("/")
    if (CSS.supports("content", '"/" / ""')) {
      expect(content).toMatch(/^"."\s*\/\s*""$/)
    } else {
      expect(content).toMatch(/^"."$/)
    }
  })

  it("adds the separator with CSS, not in the markup", () => {
    const second = document.querySelectorAll(".lt-breadcrumbs li")[1]
    const separator = getComputedStyle(second, "::before")

    // Had the slash been in the markup, screen readers would have read it
    // between every step.
    expect(separator.content).toContain("/")
    expect(
      document.querySelector(".lt-breadcrumbs")?.textContent,
    ).not.toContain("/")
  })

  it("sets the current page apart from the links", () => {
    const here = getComputedStyle(document.getElementById("here") as Element)
    const before = getComputedStyle(
      document.querySelector(".lt-breadcrumbs a") as Element,
    )

    expect(here.color).not.toBe(before.color)
    expect(here.textDecorationLine).toBe("none")
  })

  it("sets the attributes from the builder function", () => {
    expect(breadcrumbs()).toEqual({ class: "lt-breadcrumbs" })
  })

  it("has no accessibility violations", async () => {
    await waitForPaint()
    await expectNoAccessibilityViolations()
  })
})
