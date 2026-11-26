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
  // The field's label inside it, but not its child.
  wrapped: `<lt-field optional>
      <div><label for="wrapped-note">Note for the fixer</label></div>
      <textarea class="lt-textarea" id="wrapped-note" rows="3"></textarea>
    </lt-field>`,
  // Two labels that are the field's children: the first is the field's.
  two: `<lt-field>
      <label for="two-note">Note for the fixer</label>
      <textarea class="lt-textarea" id="two-note" rows="3"></textarea>
      <input type="checkbox" id="two-box" /> <label for="two-box">Send a copy</label>
    </lt-field>`,
  // Not a field the component wires: nothing in it is a control.
  uncontrolled: `<lt-field>
      <label>Codename</label>
      <div contenteditable="true" class="control">Molly</div>
    </lt-field>`,
  // Nor this: a hidden input does not count as one.
  hidden: `<lt-field optional>
      <label>Pick a fixer</label>
      <input type="hidden" name="fixer" value="7" />
      <button type="button" class="control">Choose</button>
    </lt-field>`,
}
type Name = keyof typeof CASES
/** The fields with no control, which the component leaves as they are. */
const LEFT_ALONE: Name[] = ["uncontrolled", "hidden"]

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
  "optional, and a label with data-required and no value": `<lt-field optional>
      <label for="m6" data-required>Fixer's address</label>
      <input class="lt-input" id="m6" type="email" required />
    </lt-field>`,
  'optional, and a label with data-required="none"': `<lt-field optional>
      <label for="m7" data-required="none">Fixer's address</label>
      <input class="lt-input" id="m7" type="email" required />
    </lt-field>`,
  "a label in a div with data-optional": `<lt-field>
      <div><label for="m8" data-optional>Note for the fixer</label></div>
      <textarea class="lt-textarea" id="m8" rows="3"></textarea>
    </lt-field>`,
  'a label in a div with data-required="symbol"': `<lt-field>
      <div><label for="m9" data-required="symbol">Fixer's address</label></div>
      <input class="lt-input" id="m9" type="email" required />
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
    "the control": place(box.querySelector("textarea, .control") as Element),
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
let secondBefore: ReturnType<typeof look>
const aloneBefore = {} as Record<Name, ReturnType<typeof look>>
const ownLabel = (name: Name) =>
  document.querySelector(`#case-${name} label`) as Element

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
    <div class="case" style="top: 3000px">
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
  for (const name of LEFT_ALONE) aloneBefore[name] = look(ownLabel(name))
  secondBefore = look(document.querySelectorAll("#case-two label")[1])
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
  /*
   * The known limits. The stylesheet gives the field's label its look
   * before registration by where it stands: the first `<label>` that is a
   * child of `<lt-field>`. The component finds its label in more places
   * than a selector can: anywhere inside the field, and outside it by
   * `for`. Such a label without `lt-label` gets the class at registration
   * and grows, so the documentation says to write the class on it. The
   * tests say what should hold, and fail; when one passes, that limit is
   * gone and `fails` comes off.
   */
  const LIMITS: Name[] = ["outside", "wrapped"]

  for (const [name, title] of [
    ["bare", "a label without a class, as the documentation writes it"],
    ["classed", "a label with lt-label"],
    ["own", "a label with a class of the page's own"],
    ["outside", "a label outside the field that points at the control"],
    ["wrapped", "a label in the field that is not its child"],
    ["second", "a second label in the field, for a checkbox in the help text"],
    ["two", "two labels that are the field's children"],
  ] as const)
    (LIMITS.includes(name) ? it.fails : it)(
      `moves nothing and changes the size of nothing at registration, with ${title}`,
      () => {
        // The component has done its part: the label has the class.
        expect(
          document
            .querySelector(`#case-${name} label`)
            ?.classList.contains("lt-label"),
        ).toBe(true)
        expect(moved(before[name], after[name])).toEqual([])
      },
    )

  it("leaves the second of two labels as the browser draws it, before and after", () => {
    const second = document.querySelectorAll("#case-two label")[1]
    expect(second.classList.contains("lt-label")).toBe(false)
    expect(secondBefore).toEqual(plainBefore.text)
    expect(look(second)).toEqual(plainBefore.text)
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

  /*
   * The known limit of the labels above: the stylesheet reaches only the
   * first `<label>` that is a child of `<lt-field>`. A label in a `<div>`
   * without `lt-label` has no marker until the component gives it the
   * class, so the documentation says to write the class on it. The tests
   * say what should hold, and fail; when one passes, the limit is gone and
   * `fails` comes off.
   */
  const WRAPPED: Mark[] = [
    "a label in a div with data-optional",
    'a label in a div with data-required="symbol"',
  ]

  for (const name of marks.slice(5))
    (WRAPPED.includes(name) ? it.fails : it)(
      `says the same before the component is registered as after: ${name}`,
      () => {
        expect(markerBefore[name]).toBe(markerAfter[name])
      },
    )

  it("says nothing on a label in a field that is neither", () => {
    expect([
      markerBefore["neither, a label without a class"],
      markerAfter["neither, a label without a class"],
    ]).toEqual(["none", "none"])
  })
})

/*
 * A field with nothing in it that the component counts as a control is
 * left as it is: the label gets no class. So it has no look to wait for,
 * and is the browser's before registration too.
 */
describe("a field without a control, before and after registration", () => {
  for (const [name, title] of [
    ["uncontrolled", "an element the reader can write in"],
    ["hidden", "a hidden input and a button"],
  ] as const)
    it(`leaves the label looking as it did, and moves nothing, with ${title}`, () => {
      expect(ownLabel(name).classList.contains("lt-label")).toBe(false)
      expect(look(ownLabel(name))).toEqual(aloneBefore[name])
      expect(moved(before[name], after[name])).toEqual([])
    })

  it("never says optional about a field with only a hidden input", () => {
    expect([
      aloneBefore.hidden.marker,
      look(ownLabel("hidden")).marker,
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
