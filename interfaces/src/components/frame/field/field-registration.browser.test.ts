/// <reference path="../../../types/css.d.ts" />

import { beforeAll, describe, expect, it } from "vitest"

import { mount, waitForPaint } from "../../../testing/a11y"
import { defineLtField } from "./lt-field"

import "../../../tokens/tokens.css"
import "./field.css"

/*
 * The file runs in its own frame, so `lt-field` is unregistered until
 * `beforeAll` registers it, once. The label, the control and what follows
 * the field are where they were, and as large, when the component is
 * registered: the form does not jump when the script arrives. Every case
 * stands on the page from the start, in a box of its own that the others
 * cannot push, and is measured in that box before and after the one
 * registration.
 */
const CASES = {
  // The markup the documentation shows for an optional field.
  bare: `<lt-field optional>
      <label for="bare-note">Note for the fixer</label>
      <textarea class="lt-textarea" id="bare-note" rows="3"></textarea>
    </lt-field>`,
  classed: `<lt-field optional>
      <label class="lt-label" for="classed-note">Note for the fixer</label>
      <textarea class="lt-textarea" id="classed-note" rows="3"></textarea>
    </lt-field>`,
  // A class of the page's own on the label, which styles nothing here.
  own: `<lt-field optional>
      <label class="note-label" for="own-note">Note for the fixer</label>
      <textarea class="lt-textarea" id="own-note" rows="3"></textarea>
    </lt-field>`,
}
type Name = keyof typeof CASES

type Box = { x: number; y: number; width: number; height: number }

/** Where everything in a case is, in the case's own box. */
function measure(name: Name): Record<string, Box> {
  const box = document.getElementById(`case-${name}`) as HTMLElement
  const origin = box.getBoundingClientRect()
  const place = (element: Element): Box => {
    const rect = element.getBoundingClientRect()
    return {
      x: rect.x - origin.x,
      y: rect.y - origin.y,
      width: rect.width,
      height: rect.height,
    }
  }
  return {
    "lt-field": place(box.querySelector("lt-field") as Element),
    "the label": place(box.querySelector("label") as Element),
    "the control": place(box.querySelector("textarea") as Element),
    "the text after": place(box.querySelector(".after") as Element),
  }
}

/** What moved or changed size by more than half a pixel, in words. */
function moved(was: Record<string, Box>, now: Record<string, Box>): string[] {
  const said: string[] = []
  for (const [label, box] of Object.entries(was))
    for (const side of ["x", "y", "width", "height"] as const)
      if (Math.abs(now[label][side] - box[side]) > 0.5)
        said.push(
          `${label}: ${side} ${box[side].toFixed(1)} -> ${now[label][side].toFixed(1)}`,
        )
  return said
}

const before = {} as Record<Name, Record<string, Box>>
const after = {} as Record<Name, Record<string, Box>>
const names = Object.keys(CASES) as Name[]

beforeAll(async () => {
  expect(customElements.get("lt-field")).toBeUndefined()
  mount(`
    <style>.case { position: absolute; inset-inline-start: 16px; inline-size: 600px }</style>
    ${names
      .map(
        (name) =>
          `<div class="case" id="case-${name}">${CASES[name]}<p class="after">The text after the field.</p></div>`,
      )
      .join("")}
  `)
  for (const [index, name] of names.entries())
    (document.getElementById(`case-${name}`) as HTMLElement).style.top =
      `${16 + index * 300}px`
  await document.fonts.ready
  await waitForPaint()
  await waitForPaint()
  for (const name of names) before[name] = measure(name)

  defineLtField()
  await customElements.whenDefined("lt-field")
  await waitForPaint()
  await waitForPaint()
  await waitForPaint()
  for (const name of names) after[name] = measure(name)
})

describe("the transition from field.css to the component, measured", () => {
  for (const [name, title] of [
    ["bare", "a label without a class, as the documentation writes it"],
    ["classed", "a label with lt-label"],
    ["own", "a label with a class of the page's own"],
  ] as const)
    it(`moves nothing and changes the size of nothing at registration, with ${title}`, () => {
      // The component has done its part: the label has the class.
      expect(
        document
          .querySelector(`#case-${name} label`)
          ?.classList.contains("lt-label"),
      ).toBe(true)
      expect(moved(before[name], after[name])).toEqual([])
    })
})
