/// <reference path="../../../types/css.d.ts" />

import { beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  expectNoAccessibilityViolations,
  mount,
  waitForPaint,
} from "../../../testing/a11y"
import { defineLtToast, type LtToast, showToast } from "./lt-toast"
import { toast as ltToast } from "./toast"

import "../../../tokens/tokens.css"
import "./toast.css"

async function paint() {
  const toast = document.querySelector("lt-toast") as LtToast
  await customElements.whenDefined("lt-toast")
  await waitForPaint()
  return toast
}

describe("lt-toast", () => {
  beforeAll(() => {
    defineLtToast()
  })

  beforeEach(async () => {
    mount(`<lt-toast label="Messages"></lt-toast>`)
    await paint()
  })

  it("is a polite region, not an alert that interrupts", async () => {
    const toast = await paint()

    // A message in the corner should not interrupt what the screen reader is doing.
    expect(toast.getAttribute("role")).toBe("status")
    expect(toast.getAttribute("aria-live")).toBe("polite")
    expect(toast.getAttribute("aria-label")).toBe("Messages")
  })

  it("shows a message with a close button", async () => {
    const toast = await paint()
    const message = toast.show("Someone is on the wire in sector 3", {
      color: "success",
    })

    expect(message.textContent).toContain("Someone is on the wire in sector 3")
    expect(message.dataset.color).toBe("success")

    const close = message.querySelector(".lt-toast__close") as HTMLElement
    // The close button is always there. A message that only disappears by
    // itself is gone before a slow reader gets to it.
    expect(close.getAttribute("aria-label")).toBe("Close message")
  })

  it("removes the message when the close button is pressed", async () => {
    const toast = await paint()
    const message = toast.show("The attachment has been uploaded")
    const close = message.querySelector(".lt-toast__close") as HTMLElement

    close.click()

    expect(toast.querySelectorAll(".lt-toast__message")).toHaveLength(0)
  })

  it("keeps a message when the duration is zero", async () => {
    const toast = await paint()
    toast.show("Stays", { duration: 0 })

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(toast.querySelectorAll(".lt-toast__message")).toHaveLength(1)
  })

  it("removes the message when the duration has passed", async () => {
    const toast = await paint()
    toast.show("Disappears", { duration: 40 })

    await new Promise((resolve) => setTimeout(resolve, 120))

    expect(toast.querySelectorAll(".lt-toast__message")).toHaveLength(0)
  })

  it("has no accessibility violations", async () => {
    const toast = await paint()
    toast.show("Someone is on the wire in sector 3", {
      color: "success",
      duration: 0,
    })

    await waitForPaint()
    await expectNoAccessibilityViolations()
  })
})

describe("lt-toast keeps the pause and focus", () => {
  beforeAll(() => {
    defineLtToast()
  })

  it("keeps the pause until both the mouse and focus have left the message", async () => {
    // The pause was two independent pairs: the mouse leaving restarted the
    // clock while focus was in the message, and the message disappeared from
    // under the user.
    mount(`<lt-toast></lt-toast><button id="other">Other</button>`)
    const toast = await paint()
    const message = toast.show("Saved", { duration: 40 })
    const close = message.querySelector("button") as HTMLElement

    close.focus()
    message.dispatchEvent(new MouseEvent("mouseenter"))
    message.dispatchEvent(new MouseEvent("mouseleave"))
    await new Promise((r) => setTimeout(r, 120))
    expect(
      toast.querySelectorAll(".lt-toast__message"),
      "disappeared with focus in it",
    ).toHaveLength(1)
    ;(document.getElementById("other") as HTMLElement).focus()
    await new Promise((r) => setTimeout(r, 120))
    expect(toast.querySelectorAll(".lt-toast__message")).toHaveLength(0)
  })

  it("moves focus to the neighbouring message when the one with focus is closed", async () => {
    mount(`<lt-toast></lt-toast>`)
    const toast = await paint()
    const oldest = toast.show("First", { duration: 0 })
    const middle = toast.show("Second", { duration: 0 })
    toast.show("Third", { duration: 0 })
    const close = middle.querySelector("button") as HTMLElement

    close.focus()
    close.click()

    expect(toast.querySelectorAll(".lt-toast__message")).toHaveLength(2)
    // The one below, that is the older one, not the newest at the top.
    expect(document.activeElement).toBe(oldest.querySelector("button"))
  })

  it("treats duration=0 on the element as keeping the messages", async () => {
    mount(`<lt-toast duration="0"></lt-toast>`)
    const toast = await paint()
    toast.show("Stays")
    await new Promise((r) => setTimeout(r, 50))
    expect(toast.querySelectorAll(".lt-toast__message")).toHaveLength(1)
  })

  it("treats an empty duration as the default", async () => {
    // `Number("")` is 0, and `<lt-toast duration>` kept the messages.
    mount(`<lt-toast duration></lt-toast>`)
    const toast = await paint()
    expect(toast.duration).toBe(6000)
  })

  it("is not atomic, so only the new message is announced", async () => {
    mount(`<lt-toast></lt-toast>`)
    const toast = await paint()
    expect(toast.getAttribute("aria-atomic")).toBe("false")
    expect(ltToast().host["aria-atomic"]).toBe("false")
  })

  it("is named Notifications in both the builder function and the component", async () => {
    mount(`<lt-toast></lt-toast>`)
    const toast = await paint()
    expect(toast.getAttribute("aria-label")).toBe("Notifications")
    expect(ltToast().host["aria-label"]).toBe("Notifications")
  })

  it("gives an unknown colour no border", async () => {
    mount(`<lt-toast></lt-toast>`)
    const toast = await paint()
    const message = toast.show("Odd", {
      color: "purple" as unknown as "success",
      duration: 0,
    })
    expect(message.hasAttribute("data-color")).toBe(false)
  })

  it("removes all of them with clear()", async () => {
    mount(`<lt-toast></lt-toast>`)
    const toast = await paint()
    toast.show("One", { duration: 0 })
    toast.show("Two", { duration: 0 })
    toast.clear()
    expect(toast.querySelectorAll(".lt-toast__message")).toHaveLength(0)
  })
})

/*
 * A tag name registered late. `lt-toast` has already taken the constructor,
 * so `defineLtToast("lt-toast-late")` registers a subclass of it.
 */
describe("showToast() waits for the registration", () => {
  it("shows the message only once the element is upgraded", async () => {
    mount(`<lt-toast-late role="status" aria-live="polite"></lt-toast-late>`)
    const element = document.querySelector("lt-toast-late") as Element

    let done = false
    const promise = showToast(element, "Relay 14 is back", {
      color: "success",
    }).then((message) => {
      done = true
      return message
    })
    await waitForPaint()
    expect(done).toBe(false)
    expect(element.querySelector(".lt-toast__message")).toBeNull()

    defineLtToast("lt-toast-late")

    const message = await promise
    expect(element.contains(message)).toBe(true)
    expect(message.getAttribute("data-color")).toBe("success")
    expect(message.textContent).toContain("Relay 14 is back")
  })
})

describe("lt-toast under another tag name", () => {
  it("is still fixed in the corner", async () => {
    /*
     * The position was on the element name, so a region registered as
     * anything other than `lt-toast` ended up in normal flow. It is now on
     * the class, which the component sets itself.
     */
    defineLtToast("other-toast")
    mount("<other-toast></other-toast>")
    await customElements.whenDefined("other-toast")
    const region = document.querySelector("other-toast") as LtToast

    region.show("Saved")

    expect(region.classList.contains("lt-toast")).toBe(true)
    expect(getComputedStyle(region).position).toBe("fixed")
    expect(region.querySelectorAll(".lt-toast__message")).toHaveLength(1)
  })

  it("gives the host the class from the builder function", () => {
    expect(ltToast().host.class).toBe("lt-toast")
    expect(ltToast().message.class).toBe("lt-toast__message")
  })
})

describe("lt-toast, focus and name", () => {
  beforeAll(() => {
    defineLtToast()
  })

  it("sends focus back where it came from when all messages are removed", () => {
    // Before, focus fell to `body`, and the next Tab started at the top of the page.
    mount(
      `<button id="outside">Save</button><lt-toast duration="0"></lt-toast>`,
    )
    const region = document.querySelector("lt-toast") as LtToast
    const outside = document.getElementById("outside") as HTMLButtonElement
    const message = region.show("Saved")
    outside.focus()
    ;(message.querySelector("button") as HTMLButtonElement).focus()

    region.clear()

    expect(document.activeElement).toBe(outside)
  })

  it("sends focus back when the last message is closed", () => {
    mount(
      `<button id="outside">Save</button><lt-toast duration="0"></lt-toast>`,
    )
    const region = document.querySelector("lt-toast") as LtToast
    const outside = document.getElementById("outside") as HTMLButtonElement
    const message = region.show("Saved")
    outside.focus()
    const close = message.querySelector("button") as HTMLButtonElement
    close.focus()

    close.click()

    expect(document.activeElement).toBe(outside)
  })

  it("forgets where focus came from when it leaves the region", () => {
    // Before, focus later came back to an element the user left long ago,
    // and the page scrolled there.
    mount(`
      <button id="a">A</button><button id="b">B</button>
      <lt-toast duration="0"></lt-toast>`)
    const region = document.querySelector("lt-toast") as LtToast
    const a = document.getElementById("a") as HTMLButtonElement
    const b = document.getElementById("b") as HTMLButtonElement
    const message = region.show("Saved")
    const close = message.querySelector("button") as HTMLButtonElement
    a.focus()
    close.focus()
    b.focus()
    ;(document.activeElement as HTMLElement).blur()

    close.focus()
    close.click()

    expect(document.activeElement).not.toBe(a)
  })

  it("gives the region the default name when label is removed", () => {
    mount(`<lt-toast label="Messages"></lt-toast>`)
    const region = document.querySelector("lt-toast") as LtToast
    expect(region.getAttribute("aria-label")).toBe("Messages")

    region.removeAttribute("label")

    expect(region.getAttribute("aria-label")).toBe("Notifications")
  })

  it("leaves an aria-label the author set", () => {
    // Before, `label` overwrote it.
    mount(`<lt-toast aria-label="Author"></lt-toast>`)
    const region = document.querySelector("lt-toast") as LtToast

    region.setAttribute("label", "Other")
    expect(region.getAttribute("aria-label")).toBe("Author")
    region.removeAttribute("label")
    expect(region.getAttribute("aria-label")).toBe("Author")
  })
})

/*
 * The region in a shadow root, as in every preview in the documentation.
 * `document.activeElement` then points to the shadow host, not the close
 * button, and the component believed no message had focus: focus fell to
 * `body` instead of to the neighbouring message or where it came from.
 */
describe("lt-toast in a shadow root", () => {
  beforeAll(() => {
    defineLtToast()
  })

  function mountInShadow() {
    mount(`<button id="outside">Save</button><div id="host"></div>`)
    const host = document.getElementById("host") as HTMLElement
    const root = host.attachShadow({ mode: "open" })
    root.innerHTML = `<lt-toast duration="0"></lt-toast>`
    const region = root.querySelector("lt-toast") as LtToast
    const outside = document.getElementById("outside") as HTMLButtonElement
    return { root, region, outside }
  }

  it("moves focus to the neighbouring message", () => {
    const { root, region } = mountInShadow()
    const oldest = region.show("First")
    const newest = region.show("Second")
    const close = newest.querySelector("button") as HTMLButtonElement

    close.focus()
    close.click()

    expect(root.activeElement).toBe(oldest.querySelector("button"))
  })

  it("sends focus back when the last message is closed", () => {
    const { region, outside } = mountInShadow()
    const message = region.show("Saved")
    const close = message.querySelector("button") as HTMLButtonElement
    outside.focus()
    close.focus()

    close.click()

    expect(document.activeElement).toBe(outside)
  })

  it("sends focus back when all messages are removed", () => {
    const { region, outside } = mountInShadow()
    const message = region.show("Saved")
    outside.focus()
    ;(message.querySelector("button") as HTMLButtonElement).focus()

    region.clear()

    expect(document.activeElement).toBe(outside)
  })
})
