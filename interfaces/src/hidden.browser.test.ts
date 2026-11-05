/// <reference path="./types/css.d.ts" />

import { afterEach, describe, expect, it } from "vitest"
import { classes } from "./vocabulary/classes"
import { elements } from "./vocabulary/elements"

import "./tokens/tokens.css"

// Every component stylesheet, as `lotek.css` has them.
import.meta.glob("./components/**/*.css", { eager: true })

/**
 * That `hidden` hides, also on a component that sets `display` itself.
 *
 * Author styles in any layer beat the browser's `[hidden] { display: none }`,
 * and only three components had a rule of their own.
 * `<div class="lt-alert" hidden>` was visible, and so were 41 other classes
 * and eight of the elements.
 */

const TAGS = [
  "div",
  "span",
  "p",
  "button",
  "a",
  "input",
  "select",
  "textarea",
  "label",
  "ul",
  "li",
  "nav",
  "details",
  "progress",
  "fieldset",
  "table",
  "h2",
  "hr",
  "dialog",
]

/** The rules that give a child without a class `display`. Each is covered by `CHILDREN`. */
const CHILDREN_WITH_DISPLAY = [
  ".lt-accordion summary",
  ".lt-breadcrumbs li",
  ".lt-file-upload-list li",
  ".lt-pagination a",
  ".lt-pagination button",
  '.lt-pagination span[aria-disabled="true"]',
  '.lt-select[data-picker="styled"] option',
  ".lt-tabs__list a",
]

/** The selector list split on commas, but not on those inside parentheses and brackets. */
function outsideParentheses(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    if ("([".includes(text[i])) depth++
    else if (")]".includes(text[i])) depth--
    else if (text[i] === "," && depth === 0) {
      parts.push(text.slice(start, i))
      start = i + 1
    }
  }
  parts.push(text.slice(start))
  return parts
}

/**
 * The selector without what is inside brackets and parentheses.
 *
 * The space in `[hidden="until-found" i]` is not a descendant combinator, and
 * what is inside `:is(…)` does not belong to the selector itself.
 */
function withoutGroups(selector: string): string {
  let previous = ""
  let out = selector
  while (out !== previous) {
    previous = out
    out = out.replace(/\[[^\]]*\]|\([^()]*\)/g, "")
  }
  return out
}

afterEach(() => {
  document.body.replaceChildren()
})

function isVisible(element: HTMLElement): boolean {
  document.body.append(element)
  const visible = getComputedStyle(element).display !== "none"
  element.remove()
  return visible
}

describe("hidden", () => {
  it("hides every class, with every variant", () => {
    const visibleOnes = new Set<string>()
    for (const [className, info] of Object.entries(classes)) {
      const variants: Array<[string, string] | null> = [null]
      for (const [name, attribute] of Object.entries(info.attributes)) {
        for (const value of attribute.values) {
          variants.push([name, value])
        }
        if (attribute.flag) variants.push([name, ""])
      }
      for (const tag of TAGS) {
        for (const variant of variants) {
          const element = document.createElement(tag)
          element.className = className
          if (variant) element.setAttribute(...variant)
          element.hidden = true
          if (isVisible(element)) visibleOnes.add(`${tag}.${className}`)
        }
      }
    }

    expect([...visibleOnes]).toEqual([])
  })

  it("hides every element", () => {
    const visibleOnes = Object.keys(elements).filter((tag) => {
      const element = document.createElement(tag)
      element.hidden = true
      return isVisible(element)
    })

    expect(visibleOnes).toEqual([])
  })

  it("hides children that get display from the component", () => {
    // The children have no class, and get `display` from the component. Two of
    // them with specificity (0,2,1).
    document.body.innerHTML = `
      <select class="lt-select" data-picker="styled">
        <option id="option" hidden>Hidden</option>
        <option>Visible</option>
      </select>
      <nav class="lt-pagination">
        <span id="page" aria-disabled="true" hidden>Previous</span>
      </nav>
      <nav class="lt-breadcrumbs"><ol><li id="crumb" hidden>Between</li></ol></nav>
      <ul class="lt-file-upload-list"><li id="file" hidden>attachment.pdf</li></ul>
      <details class="lt-accordion"><summary id="summary" hidden>Question</summary></details>
      <ul class="lt-tabs__list"><li><a id="tab" href="#attachments" hidden>Attachments</a></li></ul>`

    for (const id of ["option", "page", "crumb", "file", "summary", "tab"]) {
      const element = document.getElementById(id) as HTMLElement
      expect(getComputedStyle(element).display, id).toBe("none")
    }
  })

  it("knows every child without a class that gets display from a component", () => {
    // Children without an `lt-` class of their own must be in `CHILDREN` in
    // generate-tokens.ts. The test finds the rules itself, so a new child
    // fails here and not for the user.
    const found = new Set<string>()
    const visit = (rules: CSSRuleList) => {
      for (const rule of rules) {
        if ("cssRules" in rule && !(rule instanceof CSSStyleRule)) {
          visit((rule as CSSGroupingRule).cssRules)
          continue
        }
        if (!(rule instanceof CSSStyleRule)) continue
        const display = rule.style.getPropertyValue("display")
        if (!display || display === "none") continue
        for (const selector of outsideParentheses(rule.selectorText)) {
          const last =
            withoutGroups(selector.trim())
              .split(/\s*[\s>+~]\s*/)
              .pop() ?? ""
          if (/(^|[.:(])lt-|^lt-/.test(last) || last.includes(".lt-")) continue
          // A pseudo-element is not a child `hidden` can be on, and goes
          // with the element it belongs to: the marker in `lt-steps`.
          if (/::(before|after)$/.test(last)) continue
          found.add(selector.trim().replace(/\s+/g, " "))
        }
      }
    }
    for (const sheet of document.styleSheets) visit(sheet.cssRules)

    expect([...found].sort()).toEqual(CHILDREN_WITH_DISPLAY)
  })

  it("hides a class preceded by a tab or a line break", () => {
    document.body.innerHTML = `
      <div class="mb-4\tlt-alert" id="tab" hidden></div>
      <div class="mb-4\nlt-alert" id="newline" hidden></div>`

    for (const id of ["tab", "newline"]) {
      const element = document.getElementById(id) as HTMLElement
      expect(getComputedStyle(element).display, id).toBe("none")
    }
  })

  it("leaves alone a class that only shares the prefix, such as lt-1", () => {
    const style = document.createElement("style")
    style.textContent = ".lt-1[hidden] { display: block; }"
    document.head.append(style)
    try {
      document.body.innerHTML = '<h1 class="lt-1" id="large" hidden>Title</h1>'
      expect(
        getComputedStyle(document.getElementById("large") as HTMLElement)
          .display,
      ).toBe("block")
    } finally {
      style.remove()
    }
  })

  it("leaves alone a class that merely contains lt-", () => {
    const style = document.createElement("style")
    style.textContent = ".salt-grid[hidden] { display: grid; }"
    document.head.append(style)
    try {
      document.body.innerHTML = '<div class="salt-grid" id="grid" hidden></div>'
      expect(
        getComputedStyle(document.getElementById("grid") as HTMLElement)
          .display,
      ).toBe("grid")
    } finally {
      style.remove()
    }
  })

  it("leaves until-found alone, so the browser can search the content", () => {
    document.body.innerHTML =
      '<div class="lt-card" id="card" hidden="until-found">Text</div>'

    expect(
      getComputedStyle(document.getElementById("card") as HTMLElement).display,
    ).not.toBe("none")
  })
})
