/// <reference path="./types/css.d.ts" />

import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { buttonVariants } from "./components/css/button/button"
import { defineLtField } from "./components/frame/field/lt-field"

import "./tokens/tokens.css"
import "./tokens/boundary.css"
import "./components/css/button/button.css"
import "./components/frame/field/field.css"

/**
 * That `data-lt-boundary` gives an embedded component its style back on a
 * host page with unlayered CSS.
 *
 * The host's rules below are the usual ones: a button reset, an excerpt of
 * normalize, and resets with (0,1,1), which is why the attribute appears
 * twice in `boundary.css`. All of them are unlayered, and so beat
 * `@layer lotek` without the boundary.
 */
const INHERITED = "body { font-family: Georgia, serif; }"

const RESET = `
  button { background: none; text-decoration: none; border: none; border-radius: 0; cursor: pointer; color: rgb(200, 0, 0); }
  button, input, optgroup, select, textarea { margin: 0; font-family: inherit; font-size: 100%; line-height: 1.15; }
  button:not(:disabled) { padding: 0; }
  input[type="text"] { border: 0; padding: 0; }
  label { display: inline; font-weight: 400; }
  label::after { content: none; }
`

const PROPERTIES = [
  "background-color",
  "border-top-width",
  "border-top-style",
  "border-top-color",
  "border-top-left-radius",
  "color",
  "cursor",
  "display",
  "font-size",
  "font-weight",
  "line-height",
  "margin-top",
  "padding-top",
  "padding-inline-start",
  "text-decoration-line",
] as const

const MARKUP = `
  <div id="outside"><button type="button" class="lt-button">Outside</button></div>
  <div data-lt-boundary data-theme="light">
    ${buttonVariants
      .map(
        (variant) =>
          `<button type="button" class="lt-button" data-variant="${variant}" data-target="button-${variant}">Save</button>`,
      )
      .join("")}
    <select class="lt-select" data-target="select"><option>Ten</option></select>
    <input type="text" class="lt-input" data-target="input" />
    <label class="lt-label" data-required data-target="label">Codename</label>
    <lt-field data-target="field">
      <label class="lt-label" data-target="field-label">Deliver by</label>
      <input type="text" class="lt-input" required data-target="field-input" />
      <p class="lt-help-text" data-target="help-text">Type the date as 31/05/2079.</p>
    </lt-field>
  </div>
`

function host(css: string): void {
  const sheet = document.createElement("style")
  sheet.dataset.host = ""
  sheet.textContent = css
  document.head.append(sheet)
}

function read(): Record<string, Record<string, string>> {
  const all: Record<string, Record<string, string>> = {}
  for (const el of document.querySelectorAll<HTMLElement>("[data-target]")) {
    const style = getComputedStyle(el)
    const values: Record<string, string> = {}
    for (const name of PROPERTIES) values[name] = style.getPropertyValue(name)
    values["::after content"] = getComputedStyle(el, "::after").content
    all[el.dataset.target as string] = values
  }
  return all
}

describe("the boundary with a host page", () => {
  beforeAll(() => defineLtField())

  afterEach(() => {
    for (const sheet of document.querySelectorAll("style[data-host]"))
      sheet.remove()
    document.body.innerHTML = ""
  })

  it("gives the components the same values as without the host's resets", () => {
    /*
     * The font from the host's `body` is in both readings, since it should be
     * inherited inside the boundary too. The font family is checked in the
     * test below and not here. If the font is set on `body` in the same style
     * recalculation as a `<select>` is inserted, `getComputedStyle` in WebKit
     * answers with the old value, `-webkit-standard`, even though the list is
     * drawn with the right font. The comparison would then be about WebKit
     * and not about the boundary.
     */
    document.body.innerHTML = MARKUP
    host(INHERITED)
    const without = read()
    expect(Object.keys(without)).toHaveLength(buttonVariants.length + 7)
    // The marker is a pseudo-element, and it must exist to be compared
    expect(without.label["::after content"]).not.toBe("none")

    host(RESET)

    expect(read()).toEqual(without)
  })

  it("lets the font come from the host", () => {
    document.body.innerHTML = MARKUP
    host(INHERITED + RESET)

    for (const target of ["button-primary", "input", "label"]) {
      const el = document.querySelector(
        `[data-target="${target}"]`,
      ) as HTMLElement
      expect(getComputedStyle(el).fontFamily, target).toBe("Georgia, serif")
    }
  })

  it("leaves the host outside the boundary as it was", () => {
    document.body.innerHTML = MARKUP
    host(INHERITED + RESET)

    const outside = getComputedStyle(
      document.querySelector("#outside button") as HTMLElement,
    )
    expect(outside.backgroundColor).toBe("rgba(0, 0, 0, 0)")
    expect(outside.borderTopStyle).toBe("none")
    expect(outside.color).toBe("rgb(200, 0, 0)")
  })

  it("lets the --lt variables on the root element work", () => {
    document.body.innerHTML = MARKUP
    host(INHERITED + RESET)
    const root = document.querySelector("[data-lt-boundary]") as HTMLElement
    root.style.setProperty("--lt-button-radius", "9999px")

    const button = document.querySelector(
      '[data-target="button-primary"]',
    ) as HTMLElement
    expect(getComputedStyle(button).borderTopLeftRadius).toBe("9999px")
  })

  it("lets the host take the style without the boundary", () => {
    // A control that the comparison above compares something: without the
    // boundary the host's CSS must actually take the style from the button.
    document.body.innerHTML = MARKUP
    const without = read()
    document
      .querySelector("[data-lt-boundary]")
      ?.removeAttribute("data-lt-boundary")
    host(RESET)

    expect(read()["button-primary"]).not.toEqual(without["button-primary"])
  })
})
