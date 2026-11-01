/// <reference path="../../../types/css.d.ts" />

import { beforeEach, describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import {
  expectNoAccessibilityViolations,
  mount,
  waitForPaint,
} from "../../../testing/a11y"
import { color } from "../../../testing/color"
import { findOverflow, mountIsolated } from "../../../testing/isolated"
import { contrastRatio, parseHex } from "../../../tokens/color"
import selectCss from "./select.css?inline"

import "../../../tokens/tokens.css"
import "./select.css"
import "../label/label.css"

function css(id: string) {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing element #${id}`)
  }

  return getComputedStyle(element)
}

describe("lt-select", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <select id="default" class="lt-select"><option>Choose</option></select>
      <select id="invalid" class="lt-select" data-state="invalid"><option>Choose</option></select>
      <select id="success" class="lt-select" data-state="success"><option>Choose</option></select>
      <select id="disabled" class="lt-select" disabled><option>Choose</option></select>
    `
  })

  it("applies default styles", () => {
    const select = css("default")

    expect(select.backgroundColor).toBe(color("--lt-color-neutral-canvas"))
    expect(select.borderTopColor).toBe(color("--lt-color-disabled-text"))
    expect(select.color).toBe(color("--lt-color-neutral-text-strong"))
  })

  it("applies invalid styles", () => {
    const select = css("invalid")

    expect(select.backgroundColor).toBe(color("--lt-color-danger-surface"))
    expect(select.borderTopColor).toBe(color("--lt-color-danger-text"))
  })

  it("applies success styles", () => {
    const select = css("success")

    expect(select.backgroundColor).toBe(color("--lt-color-success-surface"))
    expect(select.borderTopColor).toBe(color("--lt-color-success-text"))
  })

  it("applies disabled styles", () => {
    const select = css("disabled")

    expect(select.backgroundColor).toBe(color("--lt-color-disabled-surface"))
    expect(select.borderTopColor).toBe(color("--lt-color-disabled-surface"))
    expect(select.color).toBe(color("--lt-color-disabled-text"))
    // The cursor only shows if the pointer hits the element
    expect(select.pointerEvents).toBe("auto")
  })
})

describe("lt-select accessibility", () => {
  it("has enough contrast and a label in every state", async () => {
    mount(`
      <label class="lt-label" for="a11y-building">Building</label>
      <select class="lt-select" id="a11y-building">
        <option value="">Choose a building</option>
        <option value="saltline">Saltline Tower</option>
      </select>

      <label class="lt-label" for="a11y-floor">Floor</label>
      <select class="lt-select" id="a11y-floor" data-state="invalid" aria-invalid="true">
        <option value="">Choose a floor</option>
      </select>
    `)

    await waitForPaint()
    await expectNoAccessibilityViolations()
  })
})

describe("lt-select without a CSS reset", () => {
  it("stays inside its box", () => {
    const { box } = mountIsolated(
      selectCss,
      `<select class="lt-select"><option>Saltline Tower</option></select>`,
    )

    expect(findOverflow(box)).toEqual([])
  })
})

describe("lt-select disabled", () => {
  it("shows the not-allowed cursor, and is actually hit by the mouse", () => {
    mount(`<select class="lt-select" disabled><option>Off</option></select>`)

    const element = document.querySelector("select") as HTMLElement
    const rect = element.getBoundingClientRect()

    expect(getComputedStyle(element).cursor).toBe("not-allowed")

    // cursor has no effect if the pointer does not hit the element. All of
    // these had pointer-events: none, so the cursor was never shown.
    expect(
      document.elementFromPoint(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
      ),
    ).toBe(element)
  })
})

/*
 * The dropdown list drawn in the page.
 *
 * `appearance: base-select` exists in Chromium and WebKit, but not in Firefox
 * 150. The test runs in all three and says what should happen in each: where
 * it exists, the list is drawn in the page; where it does not, the field stays
 * exactly like a plain field. Both are correct behaviour, and that is why this
 * is something you turn on and not the default.
 */
const hasBaseSelect = CSS.supports("appearance", "base-select")

/** Reads a computed colour value as three numbers. */
function rgb(value: string): [number, number, number] {
  const numbers = value.match(/\d+/g)
  if (!numbers || numbers.length < 3) {
    throw new Error(`Unreadable color "${value}"`)
  }
  return [Number(numbers[0]), Number(numbers[1]), Number(numbers[2])]
}

/**
 * Waits until the list has faded in, not on the clock. The transition lasts
 * 120 milliseconds, and a fixed wait would fail at random on a slow run.
 */
async function waitForList(element: HTMLElement): Promise<void> {
  for (let i = 0; i < 90; i++) {
    if (getComputedStyle(element, "::picker(select)").opacity === "1") return
    await new Promise((resolve) => requestAnimationFrame(resolve))
  }
  throw new Error("The list did not open")
}

/** Closes the list again, so it does not stay open into the next test. */
async function closeList(element: HTMLElement): Promise<void> {
  await userEvent.keyboard("{Escape}")
  await waitForPaint(element)
}

describe('lt-select with data-picker="styled"', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <select id="plain" class="lt-select">
        <option value="saltline">Saltline Tower</option>
        <option value="breakwater">Breakwater House</option>
      </select>
      <select id="styled" class="lt-select" data-picker="styled">
        <option value="saltline">Saltline Tower</option>
        <option value="breakwater" selected>Breakwater House</option>
      </select>
    `
  })

  it("lets the browser draw the list when it can", () => {
    const styled = css("styled")

    if (hasBaseSelect) {
      expect(styled.appearance).toBe("base-select")
      // The arrow comes from ::picker-icon now, so the two gradients go.
      expect(styled.backgroundImage).toBe("none")
    } else {
      // Firefox: the attribute does nothing, and the field looks as it always does.
      expect(styled.appearance).toBe("none")
      expect(styled.backgroundImage).toContain("gradient")
    }
  })

  it("leaves a field without the attribute alone", () => {
    const plain = css("plain")

    expect(plain.appearance).toBe("none")
    expect(plain.backgroundImage).toContain("gradient")
  })

  it("keeps the colours and state from the rest of the component", () => {
    const styled = css("styled")

    expect(styled.backgroundColor).toBe(color("--lt-color-neutral-canvas"))
    expect(styled.borderTopColor).toBe(color("--lt-color-disabled-text"))
    expect(styled.color).toBe(color("--lt-color-neutral-text-strong"))
  })

  it("opens the list inside the page, with our own surface", async () => {
    if (!hasBaseSelect) return

    const element = document.getElementById("styled")
    if (!(element instanceof HTMLElement))
      throw new Error("Could not find the field")

    await userEvent.click(element)
    await waitForList(element)

    const list = getComputedStyle(element, "::picker(select)")

    expect(element.matches(":open")).toBe(true)
    expect(list.backgroundColor).toBe(color("--lt-color-neutral-canvas"))
    expect(list.borderTopColor).toBe(color("--lt-color-disabled-text"))
    expect(list.overflowY).toBe("auto")

    // The height animates from zero in Chromium. If something goes wrong with
    // the transition, the list is open without being visible, and that is a
    // bug nobody sees in the CSS.
    expect(Number.parseFloat(list.blockSize)).toBeGreaterThan(40)

    await closeList(element)
  })

  it("gives the selected option our own highlight", async () => {
    if (!hasBaseSelect) return

    const element = document.getElementById("styled")
    if (!(element instanceof HTMLElement))
      throw new Error("Could not find the field")

    await userEvent.click(element)
    await waitForList(element)

    const selected = element.querySelector("option[value='breakwater']")
    const other = element.querySelector("option[value='saltline']")
    if (!(selected instanceof HTMLElement) || !(other instanceof HTMLElement)) {
      throw new Error("Could not find the options")
    }

    expect(getComputedStyle(selected).backgroundColor).toBe(
      color("--lt-color-accent-fill"),
    )
    expect(getComputedStyle(selected).color).toBe(
      color("--lt-color-accent-content"),
    )
    expect(getComputedStyle(other).backgroundColor).toBe(
      color("--lt-color-neutral-canvas"),
    )
    expect(getComputedStyle(other).padding).toBe("8px 12px")

    await closeList(element)
  })
  it("tells the group heading apart from the options", async () => {
    if (!hasBaseSelect) return

    document.body.innerHTML = `
      <select id="grouped" class="lt-select" data-picker="styled">
        <optgroup label="Above the waterline">
          <option value="saltline">Saltline Tower</option>
        </optgroup>
        <option value="lantern" selected>The Lantern Block</option>
      </select>
    `

    const element = document.getElementById("grouped")
    if (!(element instanceof HTMLElement))
      throw new Error("Could not find the field")

    await userEvent.click(element)
    await waitForList(element)

    const group = element.querySelector("optgroup")
    const inGroup = element.querySelector("option[value='saltline']")
    const outside = element.querySelector("option[value='lantern']")
    if (
      !(group instanceof HTMLElement) ||
      !(inGroup instanceof HTMLElement) ||
      !(outside instanceof HTMLElement)
    ) {
      throw new Error("Could not find the group")
    }

    // The heading comes from `label=`, and is not an element we can target.
    // It inherits from the group, so the group is what must have the values.
    expect(getComputedStyle(group).fontSize).toBe("14px")
    expect(getComputedStyle(group).color).toBe(
      color("--lt-color-neutral-text-subtle"),
    )
    expect(getComputedStyle(group).textIndent).toBe("12px")

    // And the options inside must look like the options outside. `lantern` is
    // the selected one, so `saltline` shows the plain text.
    expect(getComputedStyle(inGroup).fontSize).toBe("16px")
    expect(getComputedStyle(inGroup).color).toBe(
      color("--lt-color-neutral-text-strong"),
    )
    expect(getComputedStyle(inGroup).textIndent).toBe("0px")
    expect(inGroup.getBoundingClientRect().width).toBe(
      outside.getBoundingClientRect().width,
    )

    await closeList(element)
  })

  it("clips a long option when <selectedcontent> is in the button", async () => {
    // <selectedcontent> is an element the author writes. The browser does not
    // create it, so the rule matched nothing with plain markup, and a long
    // option wrapped onto two lines.
    if (!hasBaseSelect || !("HTMLSelectedContentElement" in window)) return

    const long = "Seasonal floor below the waterline, weekly pump-out included"
    document.body.innerHTML = `
      <div style="inline-size: 260px">
        <select id="long" class="lt-select" data-picker="styled">
          <button><selectedcontent></selectedcontent></button>
          <option>${long}</option>
        </select>
        <select id="short" class="lt-select" data-picker="styled">
          <button><selectedcontent></selectedcontent></button>
          <option>Dry floor</option>
        </select>
      </div>
    `
    const element = document.getElementById("long") as HTMLElement
    await waitForPaint(element)

    const content = element.querySelector("selectedcontent") as HTMLElement
    expect(content.textContent).toBe(long)
    expect(content.scrollWidth).toBeGreaterThan(content.clientWidth)
    expect(element.getBoundingClientRect().height).toBe(
      (document.getElementById("short") as HTMLElement).getBoundingClientRect()
        .height,
    )
  })
})

describe("lt-select with the list in the page, accessibility", () => {
  it("has enough contrast and a label", async () => {
    mount(`
      <label class="lt-label" for="a11y-styled">Building</label>
      <select class="lt-select" id="a11y-styled" data-picker="styled">
        <optgroup label="Above the waterline">
          <option value="">Choose a building</option>
          <option value="saltline">Saltline Tower</option>
        </optgroup>
      </select>
    `)

    await waitForPaint()
    await expectNoAccessibilityViolations()
  })

  /*
   * axe does not look inside the open list. Tested: with the colour of an
   * option set to light grey, axe still reports green, with the list both
   * open and closed. So the contrast has to be computed here, or the test
   * holds an assertion that cannot fail.
   */
  it("meets the contrast requirement on the options in the open list", async () => {
    if (!hasBaseSelect) return

    mount(`
      <label class="lt-label" for="contrast-styled">Building</label>
      <select class="lt-select" id="contrast-styled" data-picker="styled">
        <optgroup label="Above the waterline">
          <option value="saltline">Saltline Tower</option>
          <option value="breakwater" selected>Breakwater House</option>
        </optgroup>
      </select>
    `)

    const element = document.getElementById("contrast-styled")
    if (!(element instanceof HTMLElement))
      throw new Error("Could not find the field")

    await userEvent.click(element)
    await waitForList(element)

    const surface = rgb(
      getComputedStyle(element, "::picker(select)").backgroundColor,
    )

    for (const [name, selector] of [
      ["an option", "option[value='saltline']"],
      ["the selected option", "option[value='breakwater']"],
      ["the group heading", "optgroup"],
    ] as const) {
      const part = element.querySelector(selector)
      if (!(part instanceof HTMLElement)) {
        throw new Error(`Could not find ${name}`)
      }

      const behind = getComputedStyle(part).backgroundColor
      const background = behind.includes("rgba(0, 0, 0, 0)")
        ? surface
        : rgb(behind)

      expect(
        contrastBetween(rgb(getComputedStyle(part).color), background),
        name,
      ).toBeGreaterThanOrEqual(4.5)
    }

    await closeList(element)
  })
})

/** The contrast between two computed colours, as `rgb(r, g, b)`. */
function contrastBetween(
  a: [number, number, number],
  b: [number, number, number],
): number {
  const hex = (f: [number, number, number]) =>
    `#${f.map((v) => v.toString(16).padStart(2, "0")).join("")}`
  return contrastRatio(parseHex(hex(a)), parseHex(hex(b)))
}
