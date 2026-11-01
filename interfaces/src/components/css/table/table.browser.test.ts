/// <reference path="../../../types/css.d.ts" />

import { beforeEach, describe, expect, it } from "vitest"

import {
  expectNoAccessibilityViolations,
  mount,
  waitForPaint,
} from "../../../testing/a11y"
import { table, tableSort, tableSortDirections } from "./table"

import "../../../tokens/tokens.css"
import "./table.css"

describe("lt-table", () => {
  beforeEach(() => {
    mount(`
      <div class="lt-table-scroll" tabindex="0" role="region" aria-label="Appraisal">
        <table class="lt-table" data-variant="striped" id="table">
          <caption>Appraisal LR-2079-0112</caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Condition</th>
              <th scope="col" data-align="end">Offer</th>
            </tr>
          </thead>
          <tbody>
            <tr><th scope="row">Smartgun link, left eye</th><td>Removed intact</td><td data-align="end">EB 1,800</td></tr>
            <tr id="second"><th scope="row">Subdermal plating, torso</th><td>Dented</td><td data-align="end">EB 950</td></tr>
          </tbody>
        </table>
      </div>
    `)
  })

  it("marks every other row when striped", () => {
    const second = getComputedStyle(
      document.getElementById("second") as Element,
    )

    expect(second.backgroundColor).not.toBe("rgba(0, 0, 0, 0)")
  })

  it("uses the same digit width, so columns of numbers can be read downwards", () => {
    const style = getComputedStyle(document.getElementById("table") as Element)

    expect(style.fontVariantNumeric).toContain("tabular-nums")
  })

  it("aligns the cells marked for it to the end", () => {
    const cell = document.querySelector("td[data-align='end']") as HTMLElement

    expect(getComputedStyle(cell).textAlign).toBe("end")
  })

  it("sets the attributes from the builder function", () => {
    expect(table()).toEqual({ class: "lt-table" })
    expect(table({ variant: "striped", hoverable: true })).toEqual({
      class: "lt-table",
      "data-variant": "striped",
      "data-hoverable": "",
    })
    expect(table.scroll).toBe("lt-table-scroll")
  })

  it("has no accessibility violations", async () => {
    await waitForPaint()
    await expectNoAccessibilityViolations()
  })
})

describe("sortable columns", () => {
  /** The same table twice: with plain headers and with buttons. */
  beforeEach(() => {
    const row = (buttons: boolean, id: string) => `
      <table class="lt-table">
        <thead>
          <tr id="${id}">
            <th scope="col" ${buttons ? 'aria-sort="ascending"' : ""}>${buttons ? '<button type="button" class="lt-table__sort">Date</button>' : "Date"}</th>
            <th scope="col">${buttons ? '<button type="button" class="lt-table__sort">Amount</button>' : "Amount"}</th>
            <th scope="col" data-align="end" ${buttons ? 'aria-sort="descending"' : ""}>${buttons ? '<button type="button" class="lt-table__sort">Quantity</button>' : "Quantity"}</th>
          </tr>
        </thead>
        <tbody>
          <tr><td id="${id}-cell">4 March</td><td>EB 1,800</td><td data-align="end">3</td></tr>
        </tbody>
      </table>
    `
    mount(row(false, "without") + row(true, "with"))
  })

  /** Where the text in an element actually is, not where the box is. */
  function textBox(element: Element): DOMRect {
    const range = document.createRange()
    range.selectNodeContents(element)
    return range.getBoundingClientRect()
  }

  it("gives the header row the same height as without buttons", () => {
    const without = document.getElementById("without") as HTMLElement
    const withButtons = document.getElementById("with") as HTMLElement

    expect(withButtons.getBoundingClientRect().height).toBe(
      without.getBoundingClientRect().height,
    )
  })

  it("places the header text where it is without a button", () => {
    const button = document.querySelector(
      "#with .lt-table__sort",
    ) as HTMLElement
    const plain = document.querySelector("#without th") as HTMLElement
    const cell = document.getElementById("with-cell") as HTMLElement
    const fromRow = (text: Element, row: string) =>
      textBox(text).top -
      (document.getElementById(row) as HTMLElement).getBoundingClientRect().top

    expect(fromRow(button, "with")).toBe(fromRow(plain, "without"))
    expect(textBox(button).left).toBe(textBox(cell).left)
  })

  it("lets the text in an end-aligned header end where the numbers end", () => {
    const button = document.querySelector(
      "#with th[data-align='end'] .lt-table__sort",
    ) as HTMLElement
    const number = document.querySelector(
      "#with-cell ~ td[data-align='end']",
    ) as HTMLElement

    expect(textBox(button).right).toBeCloseTo(textBox(number).right, 1)
  })

  it("lets the button fill the cell, so the whole cell can be pressed", () => {
    const cell = document.querySelector("#with th") as HTMLElement
    const button = cell.querySelector(".lt-table__sort") as HTMLElement

    expect(button.getBoundingClientRect().width).toBe(
      cell.getBoundingClientRect().width,
    )
  })

  it("draws its own arrow for each direction, and one for none", () => {
    const arrow = (th: Element) =>
      getComputedStyle(
        th.querySelector(".lt-table__sort") as Element,
        "::after",
      ).maskImage
    const cells = [...document.querySelectorAll("#with th")]
    const direction = (th: Element) => th.getAttribute("aria-sort") ?? "unset"

    expect(cells.map(direction)).toEqual(["ascending", "unset", "descending"])
    const arrows = cells.map(arrow)
    for (const a of arrows) expect(a).toContain("svg")
    expect(new Set(arrows).size).toBe(3)
  })

  it("keeps the arrow out of the button's name", () => {
    const button = document.querySelector(
      "#with .lt-table__sort",
    ) as HTMLElement

    expect(getComputedStyle(button, "::after").content).toBe('""')
  })

  it("sets aria-sort on the header and the class on the button", () => {
    expect(tableSort()).toEqual({
      header: {},
      button: { class: "lt-table__sort", type: "button" },
    })
    for (const direction of tableSortDirections) {
      expect(tableSort({ direction }).header).toEqual({
        "aria-sort": direction,
      })
    }
    expect(tableSort.isDirection("ascending")).toBe(true)
    expect(tableSort.isDirection("none")).toBe(false)
  })

  it("has no accessibility violations", async () => {
    await waitForPaint()
    await expectNoAccessibilityViolations()
  })
})
