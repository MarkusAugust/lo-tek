/// <reference path="../../../types/css.d.ts" />

import { beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  expectNoAccessibilityViolations,
  mount,
  waitForPaint,
} from "../../../testing/a11y"
import { attr } from "../../../testing/markup"
import { datastarPatch } from "../../../testing/update"
import { errorSummary } from "./error-summary"
import { defineLtErrorSummary } from "./lt-error-summary"

import "../../../tokens/tokens.css"
import "./error-summary.css"
import "../../css/input/input.css"
import "../../css/label/label.css"

/** The markup the server sends when it found two errors. */
const ERRORS = errorSummary({ count: 2, id: "errors" })

async function settle() {
  await customElements.whenDefined("lt-error-summary")
  await waitForPaint()
}

describe("lt-error-summary", () => {
  beforeAll(() => {
    defineLtErrorSummary()
  })

  beforeEach(async () => {
    mount(`
      <lt-error-summary ${attr(ERRORS.host)}>
        <h2 ${attr(ERRORS.title)}>The form has two errors</h2>
        <ul>
          <li><a href="#email" id="email-link">Enter a valid address</a></li>
          <li><a href="#deliver-by">Enter a date that exists</a></li>
        </ul>
      </lt-error-summary>

      <label class="lt-label" for="email">Fixer's address</label>
      <input class="lt-input" id="email" type="email" aria-invalid="true" data-state="invalid" />

      <label class="lt-label" for="deliver-by">Deliver by</label>
      <input class="lt-input" id="deliver-by" aria-invalid="true" data-state="invalid" />
    `)
    await settle()
  })

  it("gets the alert role and the heading from the server", () => {
    const box = document.querySelector("lt-error-summary") as HTMLElement
    const title = document.querySelector(
      ".lt-error-summary__title",
    ) as HTMLElement

    // When the component made these itself, both the class and the heading
    // disappeared at the first morph in Datastar, and did not come back.
    expect(box.classList.contains("lt-error-summary")).toBe(true)
    expect(box.getAttribute("role")).toBe("alert")
    expect(box.tabIndex).toBe(-1)
    expect(title.textContent).toBe("The form has two errors")
  })

  it("is named by its heading through the wiring the builder function wrote", () => {
    const box = document.querySelector("lt-error-summary") as HTMLElement
    const title = box.querySelector("h2") as HTMLElement
    // The box takes focus, so it needs a name. What a screen reader gets is
    // checked through AT-SPI in check-accessibility-tree.ts.
    expect(title.id).toBe("errors-title")
    expect(box.getAttribute("aria-labelledby")).toBe("errors-title")
  })

  it("lt.errorSummary() makes the heading's id from the box's", () => {
    expect(errorSummary({ count: 1, id: "e" }).title.id).toBe("e-title")
    expect(errorSummary({ count: 1, id: "e" }).host["aria-labelledby"]).toBe(
      "e-title",
    )
    expect(
      errorSummary({ count: 1, id: "e", titleId: "t" }).host["aria-labelledby"],
    ).toBe("t")
    // No id, no wiring: nothing to point at.
    expect(errorSummary({ count: 1 }).host["aria-labelledby"]).toBeUndefined()
    // An empty one names nothing, and one with whitespace points at two ids.
    expect(errorSummary({ count: 1, titleId: " " }).title.id).toBeUndefined()
    expect(() => errorSummary({ count: 1, titleId: "a b" })).toThrow(
      /contains whitespace/,
    )
  })

  it("leaves a name the server wrote alone", async () => {
    const box = document.querySelector("lt-error-summary") as HTMLElement
    box.removeAttribute("aria-labelledby")
    box.setAttribute("aria-label", "Errors in the form")
    await settle()
    expect(box.hasAttribute("aria-labelledby")).toBe(false)
    expect(box.getAttribute("aria-label")).toBe("Errors in the form")
  })

  it("is hidden by the server when there are no errors", () => {
    const empty = errorSummary({ count: 0 })

    expect(empty.host.hidden).toBe(true)
    expect(ERRORS.host.hidden).toBeUndefined()
  })

  it("moves focus to the box when it appears", () => {
    const box = document.querySelector("lt-error-summary") as HTMLElement

    // Without this, someone listening to the page does not know the
    // submission stopped.
    expect(document.activeElement).toBe(box)
  })

  it("works on links a patch has replaced", async () => {
    // One listener on the host. Before, each new link got its own, and the old
    // ones were kept in memory.
    const list = document.querySelector("lt-error-summary ul") as HTMLElement
    list.innerHTML =
      '<li><a href="#deliver-by" id="new-link">Enter a date that exists</a></li>'
    await settle()

    ;(document.getElementById("new-link") as HTMLElement).click()

    expect(document.activeElement?.id).toBe("deliver-by")
  })

  it("gives focus to the field itself when a link is followed", () => {
    const link = document.getElementById("email-link") as HTMLElement
    link.click()

    // The component gives the field focus itself, so it does not depend on
    // whether the target can take focus from the browser's own jump. Tab
    // continues from the target either way; without it, focus and the
    // announcement are what is missing.
    expect(document.activeElement?.id).toBe("email")
  })

  it("picks up links the server patches in later", async () => {
    const box = document.querySelector("lt-error-summary") as HTMLElement
    const list = box.querySelector("ul") as HTMLElement

    list.innerHTML = `<li><a href="#deliver-by" id="new-link">Enter a date that exists</a></li>`
    await settle()
    ;(document.getElementById("new-link") as HTMLElement).click()

    expect(document.activeElement?.id).toBe("deliver-by")
  })

  it("has no accessibility violations", async () => {
    await waitForPaint()
    await expectNoAccessibilityViolations()
  })
})

describe("lt-error-summary names itself from a heading the template gave an id", () => {
  beforeAll(() => {
    defineLtErrorSummary()
  })

  const BOX = (heading: string, attributes = "") =>
    `<lt-error-summary${attributes}>${heading}<ul><li><a href="#x">Enter a date</a></li></ul></lt-error-summary><input id="x">`

  it("points aria-labelledby at the heading's id", async () => {
    mount(BOX('<h2 id="t">There is a problem</h2>'))
    await settle()
    const box = document.querySelector("lt-error-summary") as HTMLElement
    expect(box.getAttribute("aria-labelledby")).toBe("t")
  })

  it("never writes an id on the heading", async () => {
    // Datastar and idiomorph replace an element whose id the server did not
    // send, so an id from the component gave the heading a new one on every
    // patch.
    mount(BOX("<h2>There is a problem</h2>"))
    await settle()
    const box = document.querySelector("lt-error-summary") as HTMLElement
    expect(box.querySelector("h2")?.hasAttribute("id")).toBe(false)
    expect(box.hasAttribute("aria-labelledby")).toBe(false)
  })

  it("keeps the heading node and the name when the server sends the same box again", async () => {
    const html = `<div id="region">${BOX('<h2 id="t">There is a problem</h2>')}</div>`
    mount(html)
    await settle()
    const heading = document.querySelector("h2")
    datastarPatch(html)
    await settle()
    expect(document.querySelector("h2")).toBe(heading)
    expect(
      document
        .querySelector("lt-error-summary")
        ?.getAttribute("aria-labelledby"),
    ).toBe("t")
  })

  it("follows a heading a patch has replaced", async () => {
    mount(BOX('<h2 id="t">There is a problem</h2>'))
    await settle()
    const box = document.querySelector("lt-error-summary") as HTMLElement
    const fresh = document.createElement("h2")
    fresh.id = "t2"
    fresh.textContent = "There are 2 problems"
    ;(box.querySelector("h2") as HTMLElement).replaceWith(fresh)
    await settle()
    expect(box.getAttribute("aria-labelledby")).toBe("t2")
  })

  it("takes its own name back when the heading loses its id", async () => {
    mount(BOX('<h2 id="t">There is a problem</h2>'))
    await settle()
    const box = document.querySelector("lt-error-summary") as HTMLElement
    box.querySelector("h2")?.removeAttribute("id")
    await settle()
    // Pointing at an id that is gone names nothing.
    expect(box.hasAttribute("aria-labelledby")).toBe(false)
  })

  it("takes its own name back when the server names the box", async () => {
    mount(BOX('<h2 id="t">There is a problem</h2>'))
    await settle()
    const box = document.querySelector("lt-error-summary") as HTMLElement
    box.setAttribute("aria-label", "Errors in the form")
    await settle()
    // aria-labelledby wins over aria-label, so the component's had to go.
    expect(box.hasAttribute("aria-labelledby")).toBe(false)
  })

  it("names the box when aria-label or aria-labelledby is blank", async () => {
    mount(BOX('<h2 id="t">There is a problem</h2>', ' aria-label=" "'))
    await settle()
    const box = document.querySelector("lt-error-summary") as HTMLElement
    // A blank value names nothing, so it is not the server's word.
    expect(box.getAttribute("aria-labelledby")).toBe("t")
    box.removeAttribute("aria-label")
    box.setAttribute("aria-labelledby", " ")
    await settle()
    expect(box.getAttribute("aria-labelledby")).toBe("t")
  })

  it("keeps the server's aria-labelledby when the heading is replaced", async () => {
    mount(
      BOX(
        '<h2 id="server-title">There is a problem</h2>',
        ' aria-labelledby="server-title"',
      ),
    )
    await settle()
    const box = document.querySelector("lt-error-summary") as HTMLElement
    const fresh = document.createElement("h2")
    fresh.id = "other"
    ;(box.querySelector("h2") as HTMLElement).replaceWith(fresh)
    await settle()
    expect(box.getAttribute("aria-labelledby")).toBe("server-title")
  })
})

describe("lt-error-summary in a shadow root", () => {
  /**
   * The previews in the documentation sit in a shadow root, and so do forms
   * inside other components. `document.getElementById` does not see in
   * there, so the link became a plain anchor link without moving focus.
   */
  it("finds the field in its own root", async () => {
    const host = document.createElement("div")
    document.body.append(host)
    const root = host.attachShadow({ mode: "open" })
    const summary = errorSummary({ count: 1 })

    root.innerHTML = `
      <lt-error-summary ${attr(summary.host)} data-autofocus="false">
        <h2 ${attr(summary.title)}>The form has one error</h2>
        <ul><li><a href="#shadow-email" id="shadow-link">Enter a valid address</a></li></ul>
      </lt-error-summary>
      <input id="shadow-email" type="email" />
    `

    await waitForPaint()
    ;(root.getElementById("shadow-link") as HTMLElement).click()

    expect(root.activeElement?.id).toBe("shadow-email")

    host.remove()
  })
})

/**
 * The second time the same form fails.
 *
 * The pattern in a Datastar app is that the server sends the box hidden and
 * only removes `hidden` when something is wrong. The list then keeps the same
 * links all along, and the component cannot use "have I moved focus here
 * before" to tell whether this is a new submission.
 */
describe("lt-error-summary when the form fails again", () => {
  beforeAll(() => {
    defineLtErrorSummary()
  })

  beforeEach(async () => {
    mount(`
      <lt-error-summary ${attr(ERRORS.host)} hidden>
        <h2 ${attr(ERRORS.title)}>The form has two errors</h2>
        <ul>
          <li><a href="#email">Enter a valid address</a></li>
          <li><a href="#deliver-by">Enter a date that exists</a></li>
        </ul>
      </lt-error-summary>
      <input id="email" />
    `)
    await settle()
  })

  it("takes focus every time the box is shown again", async () => {
    const box = document.querySelector("lt-error-summary") as HTMLElement
    const field = document.getElementById("email") as HTMLInputElement

    box.hidden = false
    await waitForPaint()
    expect(document.activeElement).toBe(box)

    // The user corrects something, the server hides the box again.
    box.hidden = true
    field.focus()
    await waitForPaint()

    // And then the submission fails again, with the same errors.
    box.hidden = false
    await waitForPaint()

    expect(
      document.activeElement,
      "the box did not take focus the second time the form failed",
    ).toBe(box)
  })
})

describe("lt-error-summary moves focus where it can actually land", () => {
  beforeAll(() => {
    defineLtErrorSummary()
  })

  it("takes focus when the parent is shown and the list is replaced", async () => {
    /*
     * The box can be in a tab panel or a closed dialog when it connects.
     * `focus()` then does nothing, but the "has moved focus" flag was set
     * anyway, and the box never got focus when the parent became visible and
     * the list was replaced.
     */
    mount(`
      <div id="panel" hidden>
        <lt-error-summary ${attr(ERRORS.host)}>
          <h2 ${attr(ERRORS.title)}>The form has one error</h2>
          <ul><li><a href="#email">Enter a valid address</a></li></ul>
        </lt-error-summary>
      </div>
      <input id="email" />
    `)
    await settle()

    const box = document.querySelector("lt-error-summary") as HTMLElement
    expect(document.activeElement).not.toBe(box)

    const panel = document.getElementById("panel") as HTMLElement
    panel.hidden = false
    ;(box.querySelector("ul") as HTMLElement).innerHTML =
      `<li><a href="#email">Enter a valid address</a></li>`
    await settle()

    expect(document.activeElement).toBe(box)
  })

  it("does not pull focus out of a field the user is in", async () => {
    // If the first attempt did not land, the component tries again at the
    // next change to the list. But not while someone is typing: then live
    // validation patches the list, and focus should stay where it is.
    mount(`
      <div id="panel" hidden>
        <lt-error-summary ${attr(ERRORS.host)}>
          <h2 ${attr(ERRORS.title)}>The form has one error</h2>
          <ul><li><a href="#email">Enter a valid address</a></li></ul>
        </lt-error-summary>
      </div>
      <input id="email" />
    `)
    await settle()

    const box = document.querySelector("lt-error-summary") as HTMLElement
    const field = document.getElementById("email") as HTMLInputElement
    ;(document.getElementById("panel") as HTMLElement).hidden = false
    field.focus()
    ;(box.querySelector("ul") as HTMLElement).innerHTML =
      `<li><a href="#email">The address is missing an @</a></li>`
    await settle()

    expect(document.activeElement).toBe(field)
  })

  it("follows for to a group when the label has no control", async () => {
    mount(`
      <lt-error-summary ${attr(ERRORS.host)} data-autofocus="false">
        <h2 ${attr(ERRORS.title)}>The form has one error</h2>
        <ul><li><a href="#choice-label" id="choice-link">Choose at least one option</a></li></ul>
      </lt-error-summary>
      <label id="choice-label" for="choice">Options</label>
      <div id="choice" role="group"><input type="checkbox" /></div>
    `)
    await settle()
    ;(document.getElementById("choice-link") as HTMLElement).click()

    expect(document.activeElement?.id).toBe("choice")
  })

  it("does not pull focus out of a field outside the shadow root the box is in", async () => {
    // The root's `activeElement` is null when focus is outside the shadow
    // tree, so the user was counted as "nobody", and the retry took focus.
    mount(`<input id="outside" />`)
    const host = document.createElement("div")
    host.hidden = true
    document.body.append(host)
    const root = host.attachShadow({ mode: "open" })
    root.innerHTML = `
      <lt-error-summary ${attr(ERRORS.host)}>
        <h2 ${attr(ERRORS.title)}>The form has one error</h2>
        <ul><li><a href="#outside">Write something</a></li></ul>
      </lt-error-summary>
    `
    await settle()

    const field = document.getElementById("outside") as HTMLInputElement
    host.hidden = false
    field.focus()
    ;(root.querySelector("ul") as HTMLElement).innerHTML =
      `<li><a href="#outside">Write something else</a></li>`
    await settle()

    expect(document.activeElement).toBe(field)
    host.remove()
  })

  it("follows a label that wraps the control", async () => {
    // `for` is not the only wiring between label and control. With the
    // control inside the label, the label got focus and a `tabindex` it
    // should not have had.
    mount(`
      <lt-error-summary ${attr(ERRORS.host)} data-autofocus="false">
        <h2 ${attr(ERRORS.title)}>The form has one error</h2>
        <ul><li><a href="#name-label" id="name-link">Enter a codename</a></li></ul>
      </lt-error-summary>
      <label id="name-label">Name <input id="name" /></label>
    `)
    await settle()
    ;(document.getElementById("name-link") as HTMLElement).click()

    expect(document.activeElement?.id).toBe("name")
    expect(
      document.getElementById("name-label")?.hasAttribute("tabindex"),
    ).toBe(false)
  })
})

describe("lt-error-summary wires from bare structure", () => {
  beforeAll(() => {
    defineLtErrorSummary()
  })

  beforeEach(async () => {
    mount(`
      <lt-error-summary id="bare-summary">
        <h2>The form has one error</h2>
        <ul>
          <li><a href="#bare-email">Enter a valid address</a></li>
        </ul>
      </lt-error-summary>

      <label class="lt-label" for="bare-email">Fixer's address</label>
      <input class="lt-input" id="bare-email" type="email" />
    `)
    await settle()
  })

  function box() {
    return document.getElementById("bare-summary") as HTMLElement
  }

  it("gives the box the class, the role and the tab stop, and the heading the class", async () => {
    const title = box().querySelector("h2") as HTMLElement

    expect(box().classList.contains("lt-error-summary")).toBe(true)
    expect(box().getAttribute("role")).toBe("alert")
    expect(box().tabIndex).toBe(-1)
    expect(title.classList.contains("lt-error-summary__title")).toBe(true)
    // And then it can take focus, which is the whole reason for the
    // component.
    expect(document.activeElement).toBe(box())

    await expectNoAccessibilityViolations()
  })

  it("leaves a role the server wrote", async () => {
    mount(`
      <lt-error-summary id="bare-summary" role="status">
        <h2>The form has one error</h2>
        <ul><li><a href="#bare-email">Enter a valid address</a></li></ul>
      </lt-error-summary>
      <input class="lt-input" id="bare-email" type="email" />
    `)
    await settle()

    expect(box().getAttribute("role")).toBe("status")
    expect(box().classList.contains("lt-error-summary")).toBe(true)
  })

  it("puts the classes and the tab stop back after a patch", async () => {
    const title = box().querySelector("h2") as HTMLElement

    // The way a morph does it: everything not in the server's HTML is removed.
    box().removeAttribute("class")
    box().removeAttribute("role")
    box().removeAttribute("tabindex")
    title.removeAttribute("class")
    await waitForPaint()

    expect(box().classList.contains("lt-error-summary")).toBe(true)
    expect(box().getAttribute("role")).toBe("alert")
    expect(box().tabIndex).toBe(-1)
    expect(title.classList.contains("lt-error-summary__title")).toBe(true)
  })
})

describe("lt-error-summary while the user corrects", () => {
  beforeAll(() => {
    defineLtErrorSummary()
  })

  it("does not take focus when a visible list is emptied and filled again", async () => {
    mount(
      `<lt-error-summary ${attr(ERRORS.host)}>
        <h2 ${attr(ERRORS.title)}>The form has errors</h2>
        <ul><li><a href="#name">Name is missing</a></li></ul>
      </lt-error-summary>
      <label for="name">Name</label><input id="name" />
      <label for="email">Email</label><input id="email" />`,
    )
    await settle()
    const list = document.querySelector("lt-error-summary ul") as HTMLElement
    const name = document.getElementById("name") as HTMLInputElement

    name.focus()
    list.innerHTML = ""
    await waitForPaint()
    list.innerHTML = '<li><a href="#email">Email is missing</a></li>'
    await waitForPaint()

    expect(document.activeElement).toBe(name)
  })

  it("takes focus again when the list is emptied before the box is hidden", async () => {
    /*
     * The order React gives: the items are removed before `hidden` is set on
     * the host. The reset on `hidden` came after the return for an empty
     * list, so the box took focus on the first failed submission and never
     * again.
     */
    mount(
      `<lt-error-summary ${attr(ERRORS.host)}>
        <h2 ${attr(ERRORS.title)}>The form has errors</h2>
        <ul><li><a href="#name">Name is missing</a></li></ul>
      </lt-error-summary>
      <label for="name">Name</label><input id="name" />`,
    )
    await settle()
    const box = document.querySelector("lt-error-summary") as HTMLElement
    const list = box.querySelector("ul") as HTMLElement
    const name = document.getElementById("name") as HTMLInputElement
    expect(document.activeElement, "first submission").toBe(box)

    name.focus()
    list.innerHTML = ""
    box.hidden = true
    await waitForPaint()

    list.innerHTML = '<li><a href="#name">Name is missing</a></li>'
    box.hidden = false
    await waitForPaint()

    expect(document.activeElement, "second submission").toBe(box)
  })
})

describe("lt-error-summary and a percent-encoded link", () => {
  beforeAll(() => {
    defineLtErrorSummary()
  })

  it("finds the field and does not say the link is broken", async () => {
    const warnings: string[] = []
    const original = console.warn
    console.warn = (...args: unknown[]) => {
      warnings.push(String(args[0]))
    }
    try {
      mount(
        `<lt-error-summary ${attr(ERRORS.host)} data-autofocus="false">
          <h2 ${attr(ERRORS.title)}>The form has one error</h2>
          <ul><li><a href="#d%C3%A9lai">Enter a date that exists</a></li></ul>
        </lt-error-summary>
        <label for="délai">Deliver by</label><input id="délai" />`,
      )
      await settle()
      await waitForPaint()
      await waitForPaint()

      expect(warnings.filter((a) => a.includes("the link points"))).toEqual([])

      ;(document.querySelector("lt-error-summary a") as HTMLElement).click()
      expect(document.activeElement?.id).toBe("délai")
    } finally {
      console.warn = original
    }
  })
})

describe("lt-error-summary under another tag name", () => {
  it("is still hidden by hidden", async () => {
    /*
     * The README lists `<lt-error-summary>` among those that look the same
     * under another name. `lt-error-summary[hidden]` in error-summary.css
     * does not come along, but `display: block` is on the class the component
     * sets itself, and the `[hidden]` rule in tokens.css is written on the
     * same class, so the box is hidden anyway.
     */
    defineLtErrorSummary("other-summary")
    mount(`
      <other-summary ${attr(ERRORS.host)} hidden>
        <h2 ${attr(ERRORS.title)}>The form has two errors</h2>
        <ul>
          <li><a href="#email">Enter a valid address</a></li>
          <li><a href="#deliver-by">Enter a date that exists</a></li>
        </ul>
      </other-summary>
      <input id="email" />
    `)
    await customElements.whenDefined("other-summary")
    await waitForPaint()
    const box = document.querySelector("other-summary") as HTMLElement

    expect(box.classList.contains("lt-error-summary")).toBe(true)
    expect(getComputedStyle(box).display).toBe("none")

    box.hidden = false
    await waitForPaint()
    expect(getComputedStyle(box).display).toBe("block")
    expect(document.activeElement).toBe(box)
  })
})

/*
 * React gives focus back to the element that had it before a commit, right
 * after the DOM has changed. The component moves focus when `hidden` is
 * removed or when it connects, that is inside the same commit, so React took
 * it back to the submit button. The tests do what React does, without React:
 * change the DOM and give the button focus again in the same turn.
 */
describe("lt-error-summary when a framework gives focus back", () => {
  beforeAll(() => {
    defineLtErrorSummary()
  })

  const R = errorSummary({ count: 1, id: "summary-r" })
  const box = () => `
    <lt-error-summary ${attr(R.host)} hidden>
      <h2 ${attr(R.title)}>The form has one error</h2>
      <ul><li><a href="#email-r">Enter the fixer's address</a></li></ul>
    </lt-error-summary>`

  it("takes focus back when the box is shown", async () => {
    mount(
      `<form>${box()}<input id="email-r"><button type="submit" id="submit-r">Order the job</button></form>`,
    )
    await settle()
    const submit = document.getElementById("submit-r") as HTMLButtonElement
    const summary = document.getElementById("summary-r") as HTMLElement
    submit.focus()

    summary.hidden = false
    submit.focus()
    await waitForPaint()

    expect(document.activeElement).toBe(summary)
  })

  it("takes focus back when the box is inserted", async () => {
    mount(
      `<form id="form-r"><input id="email-r"><button type="submit" id="submit-r">Order the job</button></form>`,
    )
    await settle()
    const submit = document.getElementById("submit-r") as HTMLButtonElement
    submit.focus()

    const template = document.createElement("template")
    template.innerHTML = box().replace(" hidden>", ">")
    const summary = template.content.firstElementChild as HTMLElement
    document.getElementById("form-r")?.prepend(summary)
    submit.focus()
    await waitForPaint()

    expect(document.activeElement).toBe(summary)
  })

  it("does not take focus from a field in the same shadow root", async () => {
    const host = document.createElement("div")
    document.body.append(host)
    const root = host.attachShadow({ mode: "open" })
    root.innerHTML = `${box()}<input id="email-r"><button type="submit" id="submit-r">Order the job</button>`
    await settle()
    const submit = root.getElementById("submit-r") as HTMLButtonElement
    const email = root.getElementById("email-r") as HTMLInputElement
    const summary = root.getElementById("summary-r") as HTMLElement
    submit.focus()

    summary.hidden = false
    // The box takes focus once the update is done, a microtask later.
    await Promise.resolve()
    // The box got focus; otherwise the test says nothing about the condition.
    expect(root.activeElement).toBe(summary)
    email.focus()
    await waitForPaint()

    expect(root.activeElement).toBe(email)
    host.remove()
  })

  it("leaves focus where a script moved it in the same turn as the box was shown", async () => {
    mount(
      `<form>${box()}<input id="email-r"><button type="submit" id="submit-r">Order the job</button></form>`,
    )
    await settle()
    const submit = document.getElementById("submit-r") as HTMLButtonElement
    const email = document.getElementById("email-r") as HTMLInputElement
    const summary = document.getElementById("summary-r") as HTMLElement
    submit.focus()
    summary.hidden = false
    // Not the element that had focus, as React gives back, but another one.
    email.focus()
    await waitForPaint()
    expect(document.activeElement).toBe(email)
  })

  it("leaves focus where it is when a script has moved it elsewhere", async () => {
    mount(
      `<form>${box()}<input id="email-r"><button type="submit" id="submit-r">Order the job</button></form>`,
    )
    await settle()
    const submit = document.getElementById("submit-r") as HTMLButtonElement
    const email = document.getElementById("email-r") as HTMLInputElement
    const summary = document.getElementById("summary-r") as HTMLElement
    submit.focus()

    summary.hidden = false
    await Promise.resolve()
    expect(document.activeElement).toBe(summary)
    email.focus()
    await waitForPaint()

    expect(document.activeElement).toBe(email)
  })
})
