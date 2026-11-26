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
  // The label outside the field, pointing at the control: the component
  // finds it by `for`.
  outside: `<label for="outside-note">Note for the fixer</label>
    <lt-field optional>
      <textarea class="lt-textarea" id="outside-note" rows="3"></textarea>
    </lt-field>`,
  // A label in the field that is not the field's own: the one for a
  // checkbox in the help text.
  second: `<lt-field>
      <label class="lt-label" for="second-note">Note for the fixer</label>
      <textarea class="lt-textarea" id="second-note" rows="3"></textarea>
      <p class="lt-help-text"><input type="checkbox" id="second-box" /> <label for="second-box">Send a copy</label></p>
    </lt-field>`,
}
type Name = keyof typeof CASES

/*
 * The text that marks a field, which the label has in its `::after`. With
 * `optional` on `<lt-field>` the component writes `data-optional` on the
 * label when it is registered, and the text is there before that too.
 */
const MARKED = {
  "optional, a label with lt-label": `<lt-field optional>
      <label class="lt-label" for="m1">Note for the fixer</label>
      <textarea class="lt-textarea" id="m1" rows="3"></textarea>
    </lt-field>`,
  "optional, a label without a class": `<lt-field optional>
      <label for="m2">Note for the fixer</label>
      <textarea class="lt-textarea" id="m2" rows="3"></textarea>
    </lt-field>`,
  "optional, and a label with lt-label that says required": `<lt-field optional>
      <label class="lt-label" for="m3" data-required="text">Fixer's address</label>
      <input class="lt-input" id="m3" type="email" required />
    </lt-field>`,
  "optional, and a label without a class that says required": `<lt-field optional>
      <label for="m4" data-required="symbol">Fixer's address</label>
      <input class="lt-input" id="m4" type="email" required />
    </lt-field>`,
  "neither, a label without a class": `<lt-field>
      <label for="m5">Codename</label>
      <input class="lt-input" id="m5" />
    </lt-field>`,
}
type Mark = keyof typeof MARKED
const marks = Object.keys(MARKED) as Mark[]

/*
 * Labels that are no field's: on the page by themselves, and in another
 * element that is not registered. They are the browser's.
 */
const PLAIN = `
  <p id="plain">
    <span id="plain-text">Words in the paragraph</span>
    <label id="plain-label" for="plain-box">Remember me</label>
    <input type="checkbox" id="plain-box" />
    <lt-something-else><label id="other-label" for="plain-box">Remember me</label></lt-something-else>
  </p>`

/** What a label looks like: the properties `label.css` sets. */
function look(element: Element) {
  const style = getComputedStyle(element)
  return {
    display: style.display,
    size: style.fontSize,
    weight: style.fontWeight,
    lineHeight: style.lineHeight,
    colour: style.color,
    marker: getComputedStyle(element, "::after").content,
  }
}

const marker = (name: Mark) =>
  getComputedStyle(
    document.querySelector(
      `[data-mark="${marks.indexOf(name)}"] label`,
    ) as Element,
    "::after",
  ).content

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
  const second = box.querySelectorAll("label")[1]
  return {
    ...(second ? { "the other label": place(second) } : {}),
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
const markerBefore = {} as Record<Mark, string>
const markerAfter = {} as Record<Mark, string>
let plainBefore: Record<string, ReturnType<typeof look>>

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
    <div class="case" style="top: 1800px">
      ${marks.map((name, index) => `<div data-mark="${index}">${MARKED[name]}</div>`).join("")}
      ${PLAIN}
    </div>
  `)
  for (const [index, name] of names.entries())
    (document.getElementById(`case-${name}`) as HTMLElement).style.top =
      `${16 + index * 300}px`
  await document.fonts.ready
  await waitForPaint()
  await waitForPaint()
  for (const name of names) before[name] = measure(name)
  for (const name of marks) markerBefore[name] = marker(name)
  plainBefore = {
    text: look(document.getElementById("plain-text") as Element),
    label: look(document.getElementById("plain-label") as Element),
    other: look(document.getElementById("other-label") as Element),
  }

  defineLtField()
  await customElements.whenDefined("lt-field")
  await waitForPaint()
  await waitForPaint()
  await waitForPaint()
  for (const name of names) after[name] = measure(name)
  for (const name of marks) markerAfter[name] = marker(name)
})

describe("the transition from field.css to the component, measured", () => {
  for (const [name, title] of [
    ["bare", "a label without a class, as the documentation writes it"],
    ["classed", "a label with lt-label"],
    ["own", "a label with a class of the page's own"],
    ["outside", "a label outside the field that points at the control"],
    ["second", "a second label in the field, for a checkbox in the help text"],
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

describe("the text that marks a field, before and after registration", () => {
  for (const name of marks.slice(0, 2))
    it(`says optional before the component is registered, as after: ${name}`, () => {
      expect(markerAfter[name]).toContain("optional")
      expect(markerBefore[name]).toBe(markerAfter[name])
    })

  for (const name of marks.slice(2, 4))
    it(`says required and never optional: ${name}`, () => {
      expect(markerAfter[name]).not.toBe("none")
      expect(markerAfter[name]).not.toContain("optional")
      expect(markerBefore[name]).toBe(markerAfter[name])
    })

  it("says nothing on a label in a field that is neither", () => {
    expect([
      markerBefore["neither, a label without a class"],
      markerAfter["neither, a label without a class"],
    ]).toEqual(["none", "none"])
  })
})

describe("a label that is no field's, while lt-field is not registered", () => {
  it("looks like the text around it, as the browser has it", () => {
    // Measured before registration, when the rule for a label in an
    // unregistered field is the one that could have reached it.
    expect(plainBefore.label).toEqual(plainBefore.text)
    expect(plainBefore.other).toEqual(plainBefore.text)
    expect(plainBefore.label).toMatchObject({
      display: "inline",
      marker: "none",
    })
  })
})
