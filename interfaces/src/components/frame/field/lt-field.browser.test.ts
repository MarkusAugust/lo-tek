/// <reference path="../../../types/css.d.ts" />

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import {
  expectNoAccessibilityViolations,
  mount,
  waitForPaint,
} from "../../../testing/a11y"
import { attr } from "../../../testing/markup"
import { replace } from "../../../testing/update"
import { computeFieldAttributes } from "./field-core"
import { defineLtField, type LtField } from "./lt-field"
import "../../../tokens/tokens.css"
import "./field.css"

/** The attribute names on an element, sorted. */
function attributeNames(element: Element): string[] {
  return [...element.attributes].map((a) => a.name).sort()
}

describe("lt-field", () => {
  beforeAll(() => {
    defineLtField()
  })

  beforeEach(() => {
    document.body.innerHTML = ""
  })

  it("wires label[for] to the control id", async () => {
    document.body.innerHTML = `
      <lt-field>
        <label id="label">Email</label>
        <input id="email" class="lt-input" type="email" />
      </lt-field>
    `

    await Promise.resolve()

    const label = document.getElementById("label") as HTMLLabelElement
    expect(label.htmlFor).toBe("email")
  })

  it("adds ids and aria-describedby for help and error text", async () => {
    document.body.innerHTML = `
      <lt-field>
        <label for="email">Email</label>
        <input id="email" class="lt-input" type="email" />
        <p class="lt-help-text">Help</p>
        <p class="lt-error-text">Error</p>
      </lt-field>
    `

    await Promise.resolve()

    const field = document.querySelector("lt-field") as HTMLElement
    const input = field.querySelector("input") as HTMLInputElement
    const help = field.querySelector(".lt-help-text") as HTMLElement
    const error = field.querySelector(".lt-error-text") as HTMLElement

    expect(help.id.length).toBeGreaterThan(0)
    expect(error.id.length).toBeGreaterThan(0)
    expect(input.getAttribute("aria-invalid")).toBe("true")

    const describedBy = input.getAttribute("aria-describedby") || ""
    expect(describedBy).toContain(help.id)
    expect(describedBy).toContain(error.id)
  })

  it("treats the field as invalid when the error text is visible, and valid when it is hidden", async () => {
    /*
     * The visibility of the error text is the truth. A template renders it
     * when the field is invalid, and client code toggles `hidden`. The
     * component never touches it: it used to hide an error text the server
     * had rendered visible, because the host had no `invalid`.
     */
    document.body.innerHTML = `
      <lt-field>
        <label for="email">Email</label>
        <input id="email" class="lt-input" type="email" />
        <p class="lt-error-text" hidden>Enter a valid email.</p>
      </lt-field>
    `
    await Promise.resolve()

    const input = document.querySelector("input") as HTMLInputElement
    const error = document.querySelector(".lt-error-text") as HTMLElement
    expect(input.hasAttribute("aria-invalid")).toBe(false)
    expect(input.getAttribute("aria-describedby")).toBeNull()

    error.hidden = false
    await waitForPaint()
    expect(input.getAttribute("aria-invalid")).toBe("true")
    expect(input.getAttribute("data-state")).toBe("invalid")
    expect(input.getAttribute("aria-describedby")).toBe(error.id)

    error.hidden = true
    await waitForPaint()
    expect(input.hasAttribute("aria-invalid")).toBe(false)
    expect(input.hasAttribute("data-state")).toBe(false)
    expect(input.getAttribute("aria-describedby")).toBeNull()
    expect(error.hidden).toBe(true)
  })

  it("does not touch hidden on the error text", async () => {
    document.body.innerHTML = `
      <lt-field>
        <label for="email">Email</label>
        <input id="email" class="lt-input" type="email" />
        <p class="lt-error-text">Enter a valid email.</p>
      </lt-field>
    `
    await waitForPaint()

    const error = document.querySelector(".lt-error-text") as HTMLElement
    expect(error.hidden).toBe(false)
    expect(error.hasAttribute("aria-hidden")).toBe(false)
  })

  it("leaves the server's aria-invalid alone", async () => {
    // If the server wrote the field with `lt.field()`, `aria-invalid` is on
    // the control. The attribute is then the server's, and the component
    // must read it, not remove it.
    document.body.innerHTML = `
      <lt-field>
        <label for="email">Email</label>
        <input id="email" class="lt-input" type="email" aria-invalid="true" />
        <p class="lt-error-text">Enter a valid email.</p>
      </lt-field>
    `

    await Promise.resolve()
    await Promise.resolve()

    const input = document.querySelector("input") as HTMLInputElement
    const error = document.querySelector(".lt-error-text") as HTMLElement
    expect(input.getAttribute("aria-invalid")).toBe("true")
    expect(error.hidden).toBe(false)
  })

  it("leaves the server's aria-invalid alone, also when the error text is hidden and shown again", async () => {
    /*
     * Two sources that say different things, and the server wins. If
     * `aria-invalid` is on the control in the markup the server sent, it is
     * the server's word about the field, and the same markup must give the
     * same answer whatever states the error text has been through.
     */
    document.body.innerHTML = `
      <lt-field>
        <label for="email">Email</label>
        <input id="email" class="lt-input" type="email" aria-invalid="true" />
        <p class="lt-error-text">Enter a valid email.</p>
      </lt-field>
    `
    await Promise.resolve()

    const input = document.querySelector("input") as HTMLInputElement
    const error = document.querySelector(".lt-error-text") as HTMLElement
    error.hidden = true
    await waitForPaint()
    error.hidden = false
    await waitForPaint()
    error.hidden = true
    await waitForPaint()

    expect(input.getAttribute("aria-invalid")).toBe("true")
    expect(input.getAttribute("data-state")).toBe("invalid")
  })

  for (const way of ["Datastar", "idiomorph"] as const) {
    it(`keeps the server's aria-invalid when it is the value the component wrote, by ${way}`, async () => {
      /*
       * The component wrote `aria-invalid="true"` for the shown error text,
       * and the server then sends the same value with the text hidden. A
       * morph leaves an attribute whose value is already right, and the
       * component took the server's word for its own echo and removed it.
       */
      const form = (invalid: string, error: string) => `
        <form id="order"><lt-field>
          <label class="lt-label" for="codename">Codename</label>
          <input class="lt-input" id="codename" type="text"${invalid} />
          <p class="lt-error-text"${error}>Enter a codename.</p>
        </lt-field></form>`
      document.body.innerHTML = form("", "")
      await waitForPaint()
      const input = document.getElementById("codename") as HTMLInputElement
      expect(input.getAttribute("aria-invalid")).toBe("true")

      replace(way, "order", form(' aria-invalid="true"', " hidden"))
      await waitForPaint()

      expect(input.getAttribute("aria-invalid")).toBe("true")
    })
  }

  it("follows the server when a patch replaces the control", async () => {
    /*
     * The server can say the same thing in two ways, and switch between them
     * in a patch: a visible error text in one round, and a fully written
     * control in the next. If the component ties "this attribute is my own
     * echo" to itself rather than to the control, it treats the field as
     * valid the moment the control is replaced.
     */
    document.body.innerHTML = `
      <lt-field>
        <label for="email">Email</label>
        <input id="email" class="lt-input" type="email" />
        <p class="lt-error-text">Enter a valid email.</p>
      </lt-field>
    `

    await Promise.resolve()
    expect(document.querySelector("input")?.getAttribute("aria-invalid")).toBe(
      "true",
    )

    // The patch: a new control that itself says invalid, and the error text hidden.
    const oldControl = document.querySelector("input") as HTMLInputElement
    const newControl = document.createElement("input")
    newControl.id = "email"
    newControl.className = "lt-input"
    newControl.type = "email"
    newControl.setAttribute("aria-invalid", "true")
    oldControl.replaceWith(newControl)
    const error = document.querySelector(".lt-error-text") as HTMLElement
    error.hidden = true

    await new Promise((done) => requestAnimationFrame(done))

    expect(newControl.getAttribute("aria-invalid")).toBe("true")
    expect(newControl.getAttribute("data-state")).toBe("invalid")
    expect(error.hidden).toBe(true)
  })

  it("never writes an id on the control, not even when a patch replaces it", async () => {
    // The markup in the test has no label on purpose, and the warning about
    // it is expected. It must not show up as noise in the run.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    /*
     * Datastar and idiomorph recognise a node by its id, and a control with
     * an id the server did not send is replaced on the next update, along
     * with focus and what the user has typed. The component used to invent an
     * id when the control had none, and that was exactly what made the field
     * get replaced. If the id is missing, the template has to write it.
     */
    document.body.innerHTML = `
      <div>
        <label class="lt-label" for="email">Email</label>
        <lt-field>
          <input id="email" class="lt-input" type="email" />
        </lt-field>
      </div>
    `
    await Promise.resolve()

    const oldControl = document.querySelector("input") as HTMLInputElement
    const newControl = document.createElement("input")
    newControl.className = "lt-input"
    newControl.type = "email"
    oldControl.replaceWith(newControl)

    await new Promise((done) => requestAnimationFrame(done))

    expect(newControl.hasAttribute("id")).toBe(false)
    warn.mockRestore()
  })

  it("writes neither id nor for when the label wraps the control", async () => {
    document.body.innerHTML = `
      <lt-field>
        <label>Email <input class="lt-input" type="email" /></label>
        <p class="lt-help-text">The board writes to the fixer, never to the crew.</p>
      </lt-field>
    `
    await waitForPaint()

    const label = document.querySelector("label") as HTMLLabelElement
    const input = document.querySelector("input") as HTMLInputElement
    const help = document.querySelector(".lt-help-text") as HTMLElement

    expect(input.hasAttribute("id")).toBe(false)
    expect(label.hasAttribute("for")).toBe(false)
    expect(input.labels?.[0]).toBe(label)
    expect(input.getAttribute("aria-describedby")).toBe(help.id)
  })

  it("leaves the data-required the server wrote, and marks optional fields", async () => {
    document.body.innerHTML = `
      <lt-field>
        <label id="label" for="name" data-required="text">Name</label>
        <input id="name" class="lt-input" required />
      </lt-field>
    `

    await Promise.resolve()

    const label = document.getElementById("label") as HTMLLabelElement
    expect(label.getAttribute("data-required")).toBe("text")

    document.body.innerHTML = `
      <lt-field optional>
        <label id="label-2" for="phone">Phone</label>
        <input id="phone" class="lt-input" />
      </lt-field>
    `

    await Promise.resolve()

    const label2 = document.getElementById("label-2") as HTMLLabelElement
    expect(label2.hasAttribute("data-optional")).toBe(true)
  })
})

describe("lt-field accessibility", () => {
  it("has no violations for a field with help text and error text", async () => {
    mount(`
      <lt-field>
        <label for="email" data-required="symbol">Fixer's address</label>
        <input id="email" class="lt-input" type="email" value="fixer@" required />
        <p class="lt-help-text">The board writes to the fixer, never to the crew.</p>
        <p class="lt-error-text">Enter a valid address.</p>
      </lt-field>

      <lt-field optional>
        <label for="message">Note for the fixer</label>
        <textarea id="message" class="lt-textarea" rows="3"></textarea>
        <p class="lt-help-text">You can write up to 500 characters.</p>
      </lt-field>
    `)

    await waitForPaint()
    await expectNoAccessibilityViolations()
  })

  it("has no violations for a field without help text", async () => {
    mount(`
      <lt-field>
        <label>Codename <input class="lt-input" type="text" /></label>
      </lt-field>
    `)

    await waitForPaint()
    await expectNoAccessibilityViolations()
  })
})

describe("lt-field label", () => {
  it("gives the label lt-label, so the required marker actually shows", async () => {
    mount(`
      <lt-field>
        <label for="email" data-required="text">Fixer's address</label>
        <input id="email" class="lt-input" type="email" />
      </lt-field>
    `)

    await waitForPaint()

    const label = document.querySelector("label") as HTMLLabelElement
    expect(label.classList.contains("lt-label")).toBe(true)
    expect(label.getAttribute("data-required")).toBe("text")

    // The attribute alone does nothing without the class. The marker comes from ::after
    const marker = getComputedStyle(label, "::after").content
    expect(marker).toContain("required")
  })

  it("marks optional fields the same way", async () => {
    mount(`
      <lt-field optional>
        <label for="address">Address</label>
        <input id="address" class="lt-input" type="text" />
      </lt-field>
    `)

    await waitForPaint()

    const label = document.querySelector("label") as HTMLLabelElement
    expect(label.classList.contains("lt-label")).toBe(true)
    expect(getComputedStyle(label, "::after").content).toContain("optional")
  })
})

describe("lt-field does not fight the server", () => {
  /**
   * The demo apps caught this, not the unit tests.
   *
   * If the server wrote the field with `lt.field()`, the component computed
   * its own answer from the attributes on the host, found no `invalid` and
   * no `required-marker`, and removed what the server had just written. In
   * React it became a hydration error, in Datastar an error text that
   * appeared on a valid field on the next patch.
   *
   * The component therefore reads the state from the markup, not from a
   * parallel attribute.
   */
  it("leaves the attributes the server wrote", async () => {
    const field = computeFieldAttributes({
      id: "email",
      help: true,
      error: true,
      invalid: true,
      required: "symbol",
    })

    mount(`
      <lt-field>
        <label ${attr(field.label)}>Fixer's address</label>
        <input class="lt-input" type="email" ${attr(field.control)} />
        <p class="lt-help-text" ${attr(field.help)}>The board writes to the fixer, never to the crew.</p>
        <p class="lt-error-text" ${attr(field.error)}>Enter a valid address.</p>
      </lt-field>
    `)

    await waitForPaint()

    const input = document.getElementById("email") as HTMLInputElement
    const label = document.querySelector("label") as HTMLLabelElement
    const errorText = document.querySelector(".lt-error-text") as HTMLElement

    expect(input.getAttribute("aria-invalid")).toBe("true")
    expect(input.getAttribute("aria-describedby")).toBe(
      "email-help email-error",
    )
    expect(label.getAttribute("data-required")).toBe("symbol")
    expect(errorText.hidden).toBe(false)
  })

  it("does not set aria-hidden on a hidden error text", async () => {
    // `hidden` already takes it out of the accessibility tree, and an
    // attribute the server does not write gives a hydration error in React.
    mount(`
      <lt-field>
        <label for="email">Fixer's address</label>
        <input id="email" class="lt-input" type="email" />
        <p class="lt-error-text" hidden>Enter a valid address.</p>
      </lt-field>
    `)

    await waitForPaint()

    const errorText = document.querySelector(".lt-error-text") as HTMLElement
    expect(errorText.hidden).toBe(true)
    expect(errorText.hasAttribute("aria-hidden")).toBe(false)
  })
})

/**
 * The documentation shows what the server sends and what is on the page
 * afterwards. That list was wrong: `aria-describedby` was missing the error
 * text's id, and nothing said so, because no test read it. Now the claim is
 * here.
 */
describe("lt-field connects markup that has only structure", () => {
  beforeAll(() => {
    defineLtField()
  })

  it("gives the full wiring from for, id and a visible error text", async () => {
    mount(`
      <lt-field>
        <label data-required="symbol">Email</label>
        <input id="email" class="lt-input" type="email">
        <p class="lt-help-text">We never send spam.</p>
        <p class="lt-error-text">Enter a valid address.</p>
      </lt-field>
    `)

    await waitForPaint()

    const label = document.querySelector("label") as HTMLLabelElement
    const input = document.querySelector("input") as HTMLInputElement
    const help = document.querySelector(".lt-help-text") as HTMLElement
    const errorText = document.querySelector(".lt-error-text") as HTMLElement

    expect(label.getAttribute("class")).toBe("lt-label")
    expect(label.getAttribute("for")).toBe("email")
    expect(label.getAttribute("data-required")).toBe("symbol")
    expect(input.id).toBe("email")
    expect(help.id).toMatch(/^lt-field-help-/)
    expect(errorText.id).toMatch(/^lt-field-error-/)
    expect(input.getAttribute("aria-describedby")).toBe(
      `${help.id} ${errorText.id}`,
    )
    expect(input.getAttribute("aria-invalid")).toBe("true")
    expect(input.getAttribute("data-state")).toBe("invalid")
    expect(errorText.hidden).toBe(false)
  })

  /*
   * The component looks for the help text and the error text by the
   * system's classes, and only there. It once also read `[data-role='help']`
   * and `[data-role='error']`, a hook no documentation mentioned.
   * `data-role` is unprefixed, and in practice used by others: an app that
   * used it for something else inside a field had its paragraph adopted as
   * the error text, without anything saying so.
   */
  it("does not adopt a paragraph that only has a role on it", async () => {
    mount(`
      <lt-field>
        <label for="postcode">Postcode</label>
        <input id="postcode" class="lt-input" aria-invalid="true">
        <p class="own-error" data-role="error">The postcode must have four digits.</p>
      </lt-field>
    `)

    await waitForPaint()

    const input = document.querySelector("input") as HTMLInputElement
    const paragraph = document.querySelector(".own-error") as HTMLElement

    // One positive anchor. Without it the test would also pass if `sync()`
    // gave up before getting that far, and then it only claims that nothing
    // happened.
    expect(input.getAttribute("aria-invalid")).toBe("true")

    expect(attributeNames(paragraph)).toEqual(["class", "data-role"])
    expect(input.hasAttribute("aria-describedby")).toBe(false)
  })
})

describe("lt-field is a block element", () => {
  beforeAll(() => {
    defineLtField()
  })

  it("declares itself a block", async () => {
    // Without this the element is `display: inline`, and spacing set on the
    // outside does nothing. The children are blocks, so the bug does not
    // show until someone puts the field in a grid or gives it a margin.
    mount(`
      <lt-field>
        <label class="lt-label">Email</label>
        <input class="lt-input" type="email" />
      </lt-field>
    `)

    await waitForPaint()

    const field = document.querySelector("lt-field") as HTMLElement
    expect(getComputedStyle(field).display).toBe("block")
  })
})

/**
 * The component only controls what it wrote itself.
 *
 * Three attributes are read from the control and written back to it:
 * `aria-invalid`, `aria-describedby` and `disabled`. For each of them the
 * component must know what it wrote last, or it reads its own echo as the
 * server's word. That was fixed for `aria-invalid` alone, and the other two
 * had exactly the same bug: `aria-describedby` never shrank, and `disabled`
 * could not be turned off again.
 */
describe("lt-field only controls what it wrote itself", () => {
  beforeAll(() => {
    defineLtField()
  })

  beforeEach(() => {
    document.body.innerHTML = ""
  })

  it("takes the error text out of aria-describedby when it is hidden", async () => {
    document.body.innerHTML = `
      <lt-field>
        <label for="email">Email</label>
        <input id="email" class="lt-input" type="email" />
        <p class="lt-help-text" id="h">Help</p>
        <p class="lt-error-text" id="x">Error</p>
      </lt-field>
    `
    await Promise.resolve()

    const input = document.querySelector("input") as HTMLInputElement
    expect(input.getAttribute("aria-describedby")).toBe("h x")

    const error = document.getElementById("x") as HTMLElement
    error.hidden = true
    await waitForPaint()

    expect(input.getAttribute("aria-describedby")).toBe("h")
  })

  it("takes the help text out of aria-describedby when a patch removes it", async () => {
    document.body.innerHTML = `
      <lt-field>
        <label for="email">Email</label>
        <input id="email" class="lt-input" type="email" />
        <p class="lt-help-text" id="h">Help</p>
      </lt-field>
    `
    await Promise.resolve()

    const input = document.querySelector("input") as HTMLInputElement
    expect(input.getAttribute("aria-describedby")).toBe("h")

    document.querySelector(".lt-help-text")?.remove()
    await new Promise((done) => requestAnimationFrame(done))

    expect(input.getAttribute("aria-describedby")).toBeNull()
  })

  it("takes the extra ids out again when described-by is removed from the host", async () => {
    document.body.innerHTML = `
      <p id="extra">Read the terms first.</p>
      <lt-field described-by="extra">
        <label for="email">Email</label>
        <input id="email" class="lt-input" type="email" />
      </lt-field>
    `
    await Promise.resolve()

    const input = document.querySelector("input") as HTMLInputElement
    expect(input.getAttribute("aria-describedby")).toBe("extra")

    const field = document.querySelector("lt-field") as LtField
    field.describedBy = undefined
    await Promise.resolve()

    expect(input.getAttribute("aria-describedby")).toBeNull()
  })

  it("keeps ids the server put in aria-describedby", async () => {
    // `lt.field({ describedBy: ["terms"] })` writes the id straight on the
    // control. It is the server's, and must stay, also after the component
    // has rewritten the attribute to remove the error text.
    document.body.innerHTML = `
      <p id="terms">Terms</p>
      <lt-field>
        <label for="email">Email</label>
        <input id="email" class="lt-input" type="email"
               aria-describedby="email-help email-error terms" />
        <p class="lt-help-text" id="email-help">Help</p>
        <p class="lt-error-text" id="email-error">Error</p>
      </lt-field>
    `
    await Promise.resolve()

    const input = document.querySelector("input") as HTMLInputElement
    expect(input.getAttribute("aria-describedby")).toBe(
      "email-help email-error terms",
    )

    const error = document.getElementById("email-error") as HTMLElement
    error.hidden = true
    await waitForPaint()

    expect(input.getAttribute("aria-describedby")).toBe("email-help terms")
  })

  it("turns disabled off again when the host turns it off", async () => {
    document.body.innerHTML = `
      <lt-field disabled>
        <label for="email">Email</label>
        <input id="email" class="lt-input" type="email" />
      </lt-field>
    `
    await Promise.resolve()

    const input = document.querySelector("input") as HTMLInputElement
    const label = document.querySelector("label") as HTMLLabelElement
    expect(input.disabled).toBe(true)
    expect(label.getAttribute("aria-disabled")).toBe("true")
    // A real `disabled` needs no copy, and `lt.field()` writes none.
    expect(input.hasAttribute("aria-disabled")).toBe(false)

    const field = document.querySelector("lt-field") as LtField
    field.disabled = false
    await Promise.resolve()

    expect(input.disabled).toBe(false)
    expect(label.hasAttribute("aria-disabled")).toBe(false)
  })

  it("leaves a disabled the server wrote on the control", async () => {
    document.body.innerHTML = `
      <lt-field>
        <label for="email">Email</label>
        <input id="email" class="lt-input" type="email" disabled="disabled" />
      </lt-field>
    `
    await Promise.resolve()

    const input = document.querySelector("input") as HTMLInputElement
    const label = document.querySelector("label") as HTMLLabelElement
    expect(input.getAttribute("disabled")).toBe("disabled")
    expect(label.getAttribute("aria-disabled")).toBe("true")

    // The host has had `disabled` and lost it again. The server's word on
    // the control still stands.
    const field = document.querySelector("lt-field") as LtField
    field.disabled = true
    await Promise.resolve()
    field.disabled = false
    await Promise.resolve()

    expect(input.getAttribute("disabled")).toBe("disabled")
  })

  it("does not touch an aria-disabled the consumer wrote", async () => {
    document.body.innerHTML = `
      <lt-field>
        <label for="email">Email</label>
        <input id="email" class="lt-input" type="email" aria-disabled="true" />
      </lt-field>
    `
    await Promise.resolve()

    const input = document.querySelector("input") as HTMLInputElement
    expect(input.getAttribute("aria-disabled")).toBe("true")
  })

  it("remembers what it wrote also after being moved", async () => {
    /*
     * React throws away and recreates nodes on a restructure, and moves them
     * on a `key` change. If the component forgot what it had written the
     * moment it was disconnected, it read its own `aria-invalid="true"` as
     * the server's word when it came back, and the field could never become
     * valid.
     */
    document.body.innerHTML = `
      <div id="a"></div>
      <div id="b"></div>
    `
    const a = document.getElementById("a") as HTMLElement
    const b = document.getElementById("b") as HTMLElement
    a.innerHTML = `
      <lt-field>
        <label for="email">Email</label>
        <input id="email" class="lt-input" type="email" />
        <p class="lt-error-text">Error</p>
      </lt-field>
    `
    await Promise.resolve()

    const field = a.querySelector("lt-field") as LtField
    const input = field.querySelector("input") as HTMLInputElement
    expect(input.getAttribute("aria-invalid")).toBe("true")

    b.append(field)
    await Promise.resolve()
    ;(field.querySelector(".lt-error-text") as HTMLElement).hidden = true
    await waitForPaint()

    expect(input.getAttribute("aria-invalid")).toBeNull()
  })

  it("remembers what it wrote on a control that disappears and comes back", async () => {
    document.body.innerHTML = `
      <lt-field>
        <label for="email">Email</label>
        <input id="email" class="lt-input" type="email" />
        <p class="lt-error-text">Error</p>
      </lt-field>
    `
    await Promise.resolve()

    const field = document.querySelector("lt-field") as LtField
    const input = field.querySelector("input") as HTMLInputElement
    expect(input.getAttribute("aria-invalid")).toBe("true")

    input.remove()
    await new Promise((done) => requestAnimationFrame(done))
    field.append(input)
    await new Promise((done) => requestAnimationFrame(done))

    ;(field.querySelector(".lt-error-text") as HTMLElement).hidden = true
    await waitForPaint()

    expect(input.getAttribute("aria-invalid")).toBeNull()
  })

  it("leaves the server's aria-invalid=false alone", async () => {
    // Valid and common in handwritten HTML, which is exactly the markup the
    // component exists for. It was removed, and every patch that sent it had
    // it removed again.
    document.body.innerHTML = `
      <lt-field>
        <label for="email">Email</label>
        <input id="email" class="lt-input" type="email" aria-invalid="false" />
        <p class="lt-error-text" hidden>Error</p>
      </lt-field>
    `
    await Promise.resolve()

    const input = document.querySelector("input") as HTMLInputElement
    const error = document.querySelector(".lt-error-text") as HTMLElement
    expect(input.getAttribute("aria-invalid")).toBe("false")

    // The error text is shown and hidden again. The server's "false" comes back.
    error.hidden = false
    await waitForPaint()
    expect(input.getAttribute("aria-invalid")).toBe("true")
    error.hidden = true
    await waitForPaint()
    expect(input.getAttribute("aria-invalid")).toBe("false")
  })

  it("leaves the server's aria-invalid=spelling alone, and treats the field as invalid", async () => {
    // `grammar` and `spelling` are valid values and mean invalid. They were
    // read as "not true", and removed.
    document.body.innerHTML = `
      <lt-field>
        <label for="text">Text</label>
        <input id="text" class="lt-input" aria-invalid="spelling" />
        <p class="lt-error-text">The word does not exist.</p>
      </lt-field>
    `
    await Promise.resolve()

    const input = document.querySelector("input") as HTMLInputElement
    const error = document.querySelector(".lt-error-text") as HTMLElement
    expect(input.getAttribute("aria-invalid")).toBe("spelling")
    expect(input.getAttribute("data-state")).toBe("invalid")
    expect(error.hidden).toBe(false)
  })

  it("reads aria-invalid with an empty string as valid", async () => {
    // ARIA says the empty string is read as `false`, and assistive
    // technology does so. The component treated it as invalid, and showed a
    // red border and an error text on a field the screen reader called
    // valid.
    document.body.innerHTML = `
      <lt-field>
        <label for="email">Email</label>
        <input id="email" class="lt-input" aria-invalid="" />
        <p class="lt-error-text" hidden>Error</p>
      </lt-field>
    `
    await Promise.resolve()

    const input = document.querySelector("input") as HTMLInputElement
    const error = document.querySelector(".lt-error-text") as HTMLElement
    expect(input.getAttribute("data-state")).toBeNull()

    // The error text is shown and hidden again. The server's empty string
    // comes back.
    error.hidden = false
    await waitForPaint()
    expect(input.getAttribute("aria-invalid")).toBe("true")
    error.hidden = true
    await waitForPaint()
    expect(input.getAttribute("aria-invalid")).toBe("")
    expect(input.getAttribute("data-state")).toBeNull()
  })

  it("leaves an id when the server moves the help text out and keeps it", async () => {
    // The id has been managed by the component. If it still points to an
    // element, it is the server's: the DOM decides that, not what the
    // component has dealt with before.
    document.body.innerHTML = `
      <div id="frame">
        <lt-field>
          <label for="email">Email</label>
          <input id="email" class="lt-input" aria-describedby="email-help" />
          <p class="lt-help-text" id="email-help">Help</p>
        </lt-field>
      </div>
    `
    await Promise.resolve()

    const field = document.querySelector("lt-field") as LtField
    const help = document.querySelector(".lt-help-text") as HTMLElement
    const frame = document.getElementById("frame") as HTMLElement
    frame.append(help)
    await new Promise((done) => requestAnimationFrame(done))

    expect(field.contains(help)).toBe(false)
    const input = document.querySelector("input") as HTMLInputElement
    expect(input.getAttribute("aria-describedby")).toBe("email-help")
  })

  it("does not treat a removed help text as an extra id from the server", async () => {
    // The server wrote `aria-describedby="email-help"`. A script removes the
    // help text without touching the control. The id was managed by the
    // component, and must not stay as if the server had added it.
    document.body.innerHTML = `
      <lt-field>
        <label for="email">Email</label>
        <input id="email" class="lt-input" aria-describedby="email-help" />
        <p class="lt-help-text" id="email-help">Help</p>
      </lt-field>
    `
    await Promise.resolve()

    document.querySelector(".lt-help-text")?.remove()
    await new Promise((done) => requestAnimationFrame(done))

    const input = document.querySelector("input") as HTMLInputElement
    expect(input.getAttribute("aria-describedby")).toBeNull()
  })
})

describe("lt-field does not read its own echo from the label", () => {
  beforeAll(() => {
    defineLtField()
  })

  async function mountField(
    host: string,
    control = '<input id="name" class="lt-input" />',
  ) {
    mount(
      `<lt-field ${host}><label for="name">Name</label>${control}</lt-field>`,
    )
    await customElements.whenDefined("lt-field")
    await waitForPaint()
    return {
      host: document.querySelector("lt-field") as LtField,
      label: document.querySelector("label") as HTMLLabelElement,
      control: document.querySelector("input") as HTMLInputElement,
    }
  }

  it("removes data-optional when optional is removed from the host", async () => {
    const { host, label } = await mountField("optional")
    expect(label.hasAttribute("data-optional")).toBe(true)

    host.removeAttribute("optional")
    await waitForPaint()

    expect(label.hasAttribute("data-optional")).toBe(false)
  })

  it("leaves the markers the server wrote on the label", async () => {
    mount(
      `<lt-field><label for="name" data-required="text">Name</label><input id="name" class="lt-input" /></lt-field>`,
    )
    await customElements.whenDefined("lt-field")
    await waitForPaint()
    const label = document.querySelector("label") as HTMLLabelElement
    const host = document.querySelector("lt-field") as LtField

    // One more round, as a patch would trigger.
    host.setAttribute("described-by", "other")
    await waitForPaint()

    expect(label.getAttribute("data-required")).toBe("text")
  })

  it("removes disabled and optional when the property is set to undefined", async () => {
    // This is how React 19 writes a prop that is gone. `toggleAttribute`
    // with `undefined` toggles, and the attribute came back.
    const { host } = await mountField("")
    const properties = host as unknown as Record<string, boolean | undefined>

    for (const attribute of ["disabled", "optional"]) {
      properties[attribute] = undefined
      expect(
        host.hasAttribute(attribute),
        `${attribute} on a field without`,
      ).toBe(false)

      properties[attribute] = true
      properties[attribute] = undefined
      expect(host.hasAttribute(attribute), `${attribute} on a field with`).toBe(
        false,
      )
    }
  })

  it("leaves a data-state the template wrote by hand", async () => {
    const { control } = await mountField(
      "",
      '<input id="name" class="lt-input" data-state="invalid" />',
    )
    expect(control.getAttribute("data-state")).toBe("invalid")
  })

  it("still removes the data-state it wrote when the field becomes valid", async () => {
    const { control } = await mountField(
      "",
      '<input id="name" class="lt-input" /><p class="lt-error-text">Error</p>',
    )
    expect(control.getAttribute("data-state")).toBe("invalid")

    ;(document.querySelector(".lt-error-text") as HTMLElement).hidden = true
    await waitForPaint()

    expect(control.hasAttribute("data-state")).toBe(false)
  })

  it("connects only its own parts when a field is inside another", async () => {
    /*
     * A search field in a popover inside the field, or a field in a field, is
     * ordinary markup. `querySelector` over the whole subtree found the
     * innermost field's control first, and the outer field wrote `for`,
     * `aria-describedby` and `id` on it. Each field must see only its own
     * parts.
     */
    document.body.innerHTML = `
      <lt-field id="outer">
        <label id="outer-label">City</label>
        <div popover>
          <lt-field id="inner">
            <label id="inner-label">Search the list</label>
            <input id="inner-input" class="lt-input" type="search" />
            <p class="lt-help-text" id="inner-help">Type at least two letters.</p>
            <p class="lt-error-text" id="inner-error">No matches.</p>
          </lt-field>
        </div>
        <input id="outer-input" class="lt-input" type="text" />
        <p class="lt-help-text" id="outer-help">The city you live in.</p>
      </lt-field>
    `
    await waitForPaint()

    const outerLabel = document.getElementById(
      "outer-label",
    ) as HTMLLabelElement
    const outerInput = document.getElementById(
      "outer-input",
    ) as HTMLInputElement
    const innerLabel = document.getElementById(
      "inner-label",
    ) as HTMLLabelElement
    const innerInput = document.getElementById(
      "inner-input",
    ) as HTMLInputElement

    expect(outerLabel.htmlFor).toBe("outer-input")
    expect(outerInput.getAttribute("aria-describedby")).toBe("outer-help")
    expect(outerInput.hasAttribute("aria-invalid")).toBe(false)

    expect(innerLabel.htmlFor).toBe("inner-input")
    expect(innerInput.getAttribute("aria-describedby")).toBe(
      "inner-help inner-error",
    )
    expect(innerInput.getAttribute("aria-invalid")).toBe("true")
  })

  it("treats an error text hidden with a class as hidden", async () => {
    // `display: none` from a class, such as a utility class in the app, is
    // just as hidden as `hidden`. Only the inline style used to be read.
    document.body.innerHTML = `
      <style>.gone { display: none }</style>
      <lt-field>
        <label class="lt-label" for="e">Email</label>
        <input class="lt-input" id="e">
        <p class="lt-error-text gone">Enter a valid address.</p>
      </lt-field>`
    await waitForPaint()
    const input = document.getElementById("e") as HTMLInputElement
    expect(input.hasAttribute("aria-invalid")).toBe(false)

    ;(document.querySelector(".lt-error-text") as HTMLElement).classList.remove(
      "gone",
    )
    await waitForPaint()
    expect(input.getAttribute("aria-invalid")).toBe("true")
  })

  it("says nothing when the label wraps the whole element", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    document.body.innerHTML = `<label>Name <lt-field><input class="lt-input" name="name"></lt-field></label>`
    await waitForPaint()
    await new Promise((r) => setTimeout(r, 300))
    expect(
      (document.querySelector("input") as HTMLInputElement).labels?.length,
    ).toBe(1)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it("rewrites for, and reports it, when the label pointed to another id", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    document.body.innerHTML = `<lt-field><label class="lt-label" for="wrong">Name</label><input class="lt-input" id="name"></lt-field>`
    await waitForPaint()
    await new Promise((r) => setTimeout(r, 300))
    expect((document.querySelector("label") as HTMLLabelElement).htmlFor).toBe(
      "name",
    )
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain("pointed to a different id")
    warn.mockRestore()
  })

  it("says nothing about a control without an id that is named by aria-labelledby", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    document.body.innerHTML = `<lt-field><label id="l">Name</label><input class="lt-input" name="name" aria-labelledby="l"></lt-field>`
    await waitForPaint()
    await new Promise((r) => setTimeout(r, 300))
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it("does not point aria-describedby to a hidden error text even when the server says invalid", async () => {
    document.body.innerHTML = `<lt-field>
      <label class="lt-label" for="e">Email</label>
      <input class="lt-input" id="e" aria-invalid="true">
      <p class="lt-error-text" hidden>Enter a valid address.</p>
    </lt-field>`
    await waitForPaint()
    const input = document.getElementById("e") as HTMLInputElement
    expect(input.getAttribute("aria-invalid")).toBe("true")
    expect(input.getAttribute("aria-describedby")).toBeNull()
  })
})
