/// <reference path="../../../types/css.d.ts" />

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { userEvent } from "vitest/browser"

import {
  expectNoAccessibilityViolations,
  mount,
  waitForPaint,
} from "../../../testing/a11y"
import { attr, onItsTags } from "../../../testing/markup"
import { datastarPatch, morph } from "../../../testing/update"
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
    mount(`<lt-toast></lt-toast>`)
    await paint()
  })

  it("is a polite region, not an alert that interrupts", async () => {
    const toast = await paint()

    // A message in the corner should not interrupt what the screen reader is doing.
    expect(toast.getAttribute("role")).toBe("status")
    expect(toast.getAttribute("aria-live")).toBe("polite")
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

  it("writes the message and the close button on the tags the manifest names", async () => {
    const toast = await paint()
    const message = toast.show("The floor plans have been uploaded")
    const close = message.querySelector(".lt-toast__close") as HTMLElement

    // No page shows these, since the component writes them, so the component
    // is the witness that `tags` in the manifest is right.
    expect(onItsTags(message, "lt-toast__message")).toBe(true)
    expect(onItsTags(close, "lt-toast__close")).toBe(true)
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

  it("has no name, from the builder function or the component", async () => {
    // Safari announces nothing put into a named live region.
    mount(`<lt-toast></lt-toast>`)
    const toast = await paint()
    for (const name of ["aria-label", "aria-labelledby", "title"])
      expect(toast.hasAttribute(name), name).toBe(false)
    expect(Object.keys(ltToast().host)).not.toContain("aria-label")
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

describe("a region that had to be filled in", () => {
  it("is put back where it stood, with its content", async () => {
    mount(
      `<p id="before"></p><lt-toast-bare><b id="inside"></b></lt-toast-bare><p id="after"></p>`,
    )
    const element = document.querySelector("lt-toast-bare") as LtToast
    const inside = document.getElementById("inside")
    await waitForPaint()

    defineLtToast("lt-toast-bare")

    expect(element.getAttribute("role")).toBe("status")
    expect(element.isConnected).toBe(true)
    expect(element.previousElementSibling?.id).toBe("before")
    expect(element.nextElementSibling?.id).toBe("after")
    expect(element.firstElementChild).toBe(inside)
    // It works after the second connect: the message has its close button.
    const message = element.show("Relay 14 is back")
    expect(message.querySelector("button")).not.toBeNull()
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

  for (const name of ["aria-label", "aria-labelledby", "title"])
    it(`warns about a name from ${name}, and leaves it`, async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      try {
        mount(
          `<span id="name">Messages</span><lt-toast ${name}="${name === "aria-labelledby" ? "name" : "Messages"}"></lt-toast>`,
        )
        const region = document.querySelector("lt-toast") as LtToast
        // The warning waits for the page to settle: the parser, then two frames.
        await waitForPaint()
        await waitForPaint()

        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining(`the region has a name (${name})`),
          region,
        )
        // Never removed: the name is the markup's.
        expect(region.hasAttribute(name)).toBe(true)
      } finally {
        warn.mockRestore()
      }
    })

  it("warns about a name set after it connected, when a message is shown", async () => {
    // A framework can fill in the attributes in a later step.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      mount(`<lt-toast></lt-toast>`)
      const region = document.querySelector("lt-toast") as LtToast
      await waitForPaint()
      region.setAttribute("aria-label", "Messages")
      region.show("Saved")
      await waitForPaint()
      await waitForPaint()
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("the region has a name (aria-label)"),
        region,
      )
    } finally {
      warn.mockRestore()
    }
  })

  it("does not warn about a region without a name", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      mount(`<lt-toast></lt-toast>`)
      await waitForPaint()
      await waitForPaint()
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
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

/*
 * The messages and what happens to them from outside the component.
 *
 * A message can be in the region without `show()` having made it: the
 * server may patch one in, if it writes the message and its close button as
 * the component does, and a page restored from history comes back with the
 * messages it had, under an element that made none of them. Its close button
 * closes it all the same.
 *
 * And an update can take the messages away. The region asks to be left
 * alone with `data-ignore-morph`, and a morph that does not know that word
 * removes every child the server did not send. A message the component
 * showed and the user has not closed is still to be read: it is back, the
 * same node in the same place, until it is closed or its time is out. A
 * message the server wrote is the server's to take away.
 */
describe("lt-toast and messages from outside, and updates that take messages away", () => {
  beforeAll(() => {
    defineLtToast()
  })

  /** A message as `show()` writes it, written by someone else. */
  const written = (text: string) =>
    `<div class="lt-toast__message"><span>${text}</span><button type="button" class="lt-toast__close" aria-label="Close message">×</button></div>`
  const messages = (region: Element) => [
    ...region.querySelectorAll<HTMLElement>(".lt-toast__message"),
  ]
  const texts = (region: Element) =>
    messages(region).map(
      (message) => message.querySelector("span")?.textContent,
    )
  const closeOf = (message: Element) =>
    message.querySelector(".lt-toast__close") as HTMLButtonElement

  /** The region as the builder function writes it, with a button before it and what the page is told. */
  async function region(inner = "") {
    mount(
      `<button id="outside" type="button">Save</button><lt-toast ${attr(ltToast().host)}>${inner}</lt-toast>`,
    )
    await customElements.whenDefined("lt-toast")
    await waitForPaint()
    const toast = document.querySelector("lt-toast") as LtToast
    const told = { dismissed: 0 }
    toast.addEventListener("toast-dismiss", () => {
      told.dismissed += 1
    })
    return {
      toast,
      told,
      outside: document.getElementById("outside") as HTMLButtonElement,
    }
  }
  /** Long enough for the component to see what was done to it and to act. */
  async function settled() {
    for (let frame = 0; frame < 3; frame++) await waitForPaint()
  }
  /** What goes wrong in the page while `during` runs. */
  async function faultsDuring(during: () => Promise<void>): Promise<string[]> {
    const faults: string[] = []
    const fault = (event: ErrorEvent | PromiseRejectionEvent) =>
      faults.push("message" in event ? event.message : String(event.reason))
    window.addEventListener("error", fault)
    window.addEventListener("unhandledrejection", fault)
    try {
      await during()
      await settled()
    } finally {
      window.removeEventListener("error", fault)
      window.removeEventListener("unhandledrejection", fault)
    }
    return faults
  }

  /** The two ways a message comes to be in the region without `show()`. */
  const ARRIVES: Record<
    string,
    (text: string[]) => Promise<Awaited<ReturnType<typeof region>>>
  > = {
    "was in the markup when the region connected": (text) =>
      region(text.map(written).join("")),
    "was added to the region afterwards": async (text) => {
      const page = await region()
      page.toast.insertAdjacentHTML("afterbegin", text.map(written).join(""))
      await settled()
      return page
    },
  }

  for (const [how, arrive] of Object.entries(ARRIVES)) {
    it(`closes a message that ${how}, on a click on its close button`, async () => {
      const { toast, told } = await arrive(["Saved", "Sent"])
      const [first, second] = messages(toast)

      // A press elsewhere in the message is no press on the button.
      await userEvent.click(first.querySelector("span") as HTMLElement)
      expect(texts(toast)).toEqual(["Saved", "Sent"])
      expect(told.dismissed).toBe(0)

      await userEvent.click(closeOf(first))

      expect(texts(toast), "the messages left").toEqual(["Sent"])
      expect(told.dismissed, "toast-dismiss events").toBe(1)
      expect(second.isConnected).toBe(true)
    })

    for (const key of ["Enter", "Space"])
      it(`closes a message that ${how}, on ${key} on its close button`, async () => {
        const { toast, told } = await arrive(["Saved"])
        closeOf(messages(toast)[0]).focus()

        await userEvent.keyboard(key === "Enter" ? "{Enter}" : " ")

        expect(texts(toast), "the messages left").toEqual([])
        expect(told.dismissed, "toast-dismiss events").toBe(1)
      })

    it(`moves focus on from a closed message that ${how}, as for its own`, async () => {
      const { toast, outside } = await arrive(["Saved", "Sent"])
      const [first, second] = messages(toast)
      outside.focus()
      closeOf(first).focus()

      // The neighbouring message first.
      closeOf(first).click()
      expect(document.activeElement, "focus after the first was closed").toBe(
        closeOf(second),
      )
      // And then back where it came from.
      closeOf(second).click()
      expect(document.activeElement, "focus after the last was closed").toBe(
        outside,
      )
      expect(messages(toast)).toEqual([])
    })
  }

  it("closes a message of its own and one from outside alike, side by side", async () => {
    const { toast, told } = await region(written("From the server"))
    const own = toast.show("From the page", { duration: 0 })
    const [, served] = messages(toast)

    closeOf(served).click()
    expect(texts(toast)).toEqual(["From the page"])
    closeOf(own).click()
    expect(texts(toast)).toEqual([])
    // One for each, and not two for the component's own.
    expect(told.dismissed, "toast-dismiss events").toBe(2)
  })

  // An update takes messages: everything in the region, or one of them.
  it("has its messages back, the same and in order, when the region is emptied", async () => {
    const { toast, told } = await region()
    const shown = [
      toast.show("First", { duration: 0 }),
      toast.show("Second", { duration: 0, color: "success" }),
      toast.show("Third", { duration: 0 }),
    ]
    const before = messages(toast)
    expect(texts(toast)).toEqual(["Third", "Second", "First"])

    const faults = await faultsDuring(async () => {
      toast.replaceChildren()
      expect(messages(toast), "the messages were taken").toEqual([])
    })

    expect(messages(toast), "the messages in the region").toEqual(before)
    expect(told.dismissed, "toast-dismiss events").toBe(0)
    expect(faults, "what went wrong in the page").toEqual([])
    // And they are live: the close button of one closes that one.
    closeOf(shown[1]).click()
    expect(texts(toast)).toEqual(["Third", "First"])
    expect(told.dismissed, "toast-dismiss events").toBe(1)
  })

  for (const [which, index] of [
    ["first", 0],
    ["middle", 1],
    ["last", 2],
  ] as const)
    it(`has a message back in its place when the ${which} of three is removed`, async () => {
      const { toast, told } = await region()
      toast.show("First", { duration: 0 })
      toast.show("Second", { duration: 0 })
      toast.show("Third", { duration: 0 })
      const before = messages(toast)

      before[index].remove()
      await settled()

      expect(messages(toast), "the messages in the region").toEqual(before)
      expect(told.dismissed, "toast-dismiss events").toBe(0)
    })

  it("comes to rest: nothing more happens to the region after the messages are back", async () => {
    const { toast } = await region()
    toast.show("First", { duration: 0 })
    toast.show("Second", { duration: 0 })
    toast.replaceChildren()
    await settled()
    expect(messages(toast).length, "the messages in the region").toBe(2)

    let changes = 0
    const watch = new MutationObserver((records) => {
      changes += records.length
    })
    watch.observe(toast, { childList: true, subtree: true, attributes: true })
    const faults = await faultsDuring(
      () => new Promise((done) => setTimeout(done, 300)),
    )
    watch.disconnect()

    expect(changes, "changes to the region while nothing was done to it").toBe(
      0,
    )
    expect(faults).toEqual([])
  })

  it("lets a message that was taken and put back go when its time is out, once", async () => {
    const { toast, told } = await region()
    const timed = toast.show("Goes", { duration: 250 })
    const kept = toast.show("Stays", { duration: 0 })

    toast.replaceChildren()
    await settled()
    expect(messages(toast), "the messages in the region").toEqual([kept, timed])

    await new Promise((done) => setTimeout(done, 400))
    await settled()
    expect(messages(toast), "the messages after the time of one").toEqual([
      kept,
    ])
    expect(told.dismissed, "toast-dismiss events").toBe(1)

    // And the one that stays, stays.
    await new Promise((done) => setTimeout(done, 300))
    expect(messages(toast)).toEqual([kept])
  })

  it("has its messages back when it was emptied out of the document, once it is in again", async () => {
    const { toast, told } = await region()
    const shown = toast.show("Saved", { duration: 0 })
    const parent = toast.parentElement as HTMLElement

    toast.remove()
    toast.replaceChildren()
    parent.append(toast)
    await settled()

    expect(messages(toast), "the messages in the region").toEqual([shown])
    expect(told.dismissed).toBe(0)
  })

  // What does not come back.
  it("does not bring back a message that was dismissed, cleared or timed out", async () => {
    const { toast, told } = await region()
    const dismissed = toast.show("Dismissed", { duration: 0 })
    toast.show("Timed out", { duration: 100 })
    const kept = toast.show("Kept", { duration: 0 })

    toast.dismiss(dismissed)
    await new Promise((done) => setTimeout(done, 250))
    await settled()
    expect(messages(toast)).toEqual([kept])
    expect(told.dismissed, "toast-dismiss events").toBe(2)

    // An update later is no reason to show them again.
    toast.replaceChildren()
    await settled()
    expect(messages(toast), "the messages after an update").toEqual([kept])

    toast.clear()
    await settled()
    toast.replaceChildren()
    await settled()
    expect(messages(toast), "the messages after clear() and an update").toEqual(
      [],
    )
    expect(told.dismissed, "toast-dismiss events").toBe(2)
  })

  it("dismisses a message for good when it is dismissed right after an update took it", async () => {
    // The app asked for a message that was live to be dismissed. That the
    // update got to it a moment before is not the app's to know: the
    // message is gone for good, and the page is told so once.
    const { toast, told } = await region()
    const gone = toast.show("Gone", { duration: 0 })
    const kept = toast.show("Kept", { duration: 0 })

    toast.replaceChildren()
    toast.dismiss(gone)
    await settled()

    expect(messages(toast), "the messages in the region").toEqual([kept])
    expect(told.dismissed, "toast-dismiss events").toBe(1)
    // And not a second time for the same message.
    toast.dismiss(gone)
    expect(told.dismissed, "toast-dismiss events").toBe(1)
  })

  for (const [how, arrive] of Object.entries(ARRIVES))
    it(`leaves a message that ${how} gone when an update takes it`, async () => {
      // The server wrote it, and the server took it away.
      const { toast, told } = await arrive(["From the server"])
      const own = toast.show("From the page", { duration: 0 })
      expect(texts(toast)).toEqual(["From the page", "From the server"])

      toast.replaceChildren()
      await settled()

      expect(messages(toast), "the messages in the region").toEqual([own])
      expect(told.dismissed, "toast-dismiss events").toBe(0)
    })

  /*
   * The same with the updates themselves, and not a stand-in for them. The
   * server's version of the page has the region empty, as the recipe
   * writes it: the messages are the page's and the server knows none.
   */
  const SERVED = `<lt-toast id="messages" ${attr(ltToast().host)}></lt-toast>`
  const PAGE = `<div id="page"><p>Routes</p>${SERVED}</div>`
  /** The served page with two messages showing, and what the page is told. */
  async function served() {
    mount(PAGE)
    await customElements.whenDefined("lt-toast")
    await waitForPaint()
    const toast = document.querySelector("lt-toast") as LtToast
    const told = { dismissed: 0 }
    toast.addEventListener("toast-dismiss", () => {
      told.dismissed += 1
    })
    const oldest = toast.show("First", { duration: 0 })
    const newest = toast.show("Second", { duration: 0, color: "success" })
    expect(messages(toast)).toEqual([newest, oldest])
    return { toast, told, oldest, newest }
  }
  /** The real updates that reach the region with the server's empty version of it. */
  const UPDATES: Record<string, (toast: LtToast) => void> = {
    // idiomorph does not know `data-ignore-morph`, and removes what the
    // server did not send.
    "idiomorph morphs the page around the region": () =>
      morph(document.getElementById("page") as HTMLElement, PAGE),
    "idiomorph morphs the region itself": (toast) => morph(toast, SERVED),
    // Datastar knows the word, and leaves the region alone.
    "Datastar patches the page around the region": () => datastarPatch(PAGE),
    "Datastar patches the region itself": () => datastarPatch(SERVED),
  }
  for (const [how, update] of Object.entries(UPDATES))
    it(`has its messages after ${how}, the same and in order`, async () => {
      const { toast, told, oldest, newest } = await served()

      const faults = await faultsDuring(async () => {
        update(toast)
      })

      expect(
        document.querySelector("lt-toast"),
        "the region is the element it was",
      ).toBe(toast)
      expect(messages(toast), "the messages in the region").toEqual([
        newest,
        oldest,
      ])
      expect(texts(toast)).toEqual(["Second", "First"])
      expect(newest.dataset.color).toBe("success")
      expect(told.dismissed, "toast-dismiss events").toBe(0)
      expect(faults, "what went wrong in the page").toEqual([])

      // And a second update of the same kind leaves them as they are.
      update(toast)
      await settled()
      expect(messages(toast), "the messages after a second update").toEqual([
        newest,
        oldest,
      ])

      closeOf(newest).click()
      expect(messages(toast)).toEqual([oldest])
      expect(told.dismissed, "toast-dismiss events").toBe(1)
    })

  it("puts its own message back first, before a message from outside that stayed", async () => {
    // The newest stands first. The server's message was there before the
    // page showed its own, and the update took only the page's.
    const { toast, told } = await region(written("From the server"))
    const own = toast.show("From the page", { duration: 0 })
    const [, served] = messages(toast)
    expect(texts(toast)).toEqual(["From the page", "From the server"])

    own.remove()
    await settled()

    expect(texts(toast), "the messages in the region, first to last").toEqual([
      "From the page",
      "From the server",
    ])
    expect(messages(toast), "the messages in the region").toEqual([own, served])
    expect(told.dismissed, "toast-dismiss events").toBe(0)
  })

  it("puts its own messages back around one from outside, each where it stood", async () => {
    const { toast } = await region()
    const oldest = toast.show("First", { duration: 0 })
    toast.insertAdjacentHTML("afterbegin", written("From the server"))
    const served = messages(toast)[0]
    const newest = toast.show("Second", { duration: 0 })
    await settled()
    expect(messages(toast)).toEqual([newest, served, oldest])

    newest.remove()
    oldest.remove()
    await settled()

    expect(texts(toast), "the messages in the region, first to last").toEqual([
      "Second",
      "From the server",
      "First",
    ])
    expect(messages(toast), "the messages in the region").toEqual([
      newest,
      served,
      oldest,
    ])
  })

  it("keeps where focus goes as it was, for messages that were taken and put back", async () => {
    const { toast, outside } = await region()
    const oldest = toast.show("First", { duration: 0 })
    const newest = toast.show("Second", { duration: 0 })
    toast.replaceChildren()
    await settled()
    expect(messages(toast)).toEqual([newest, oldest])

    outside.focus()
    closeOf(newest).focus()
    closeOf(newest).click()
    expect(document.activeElement).toBe(closeOf(oldest))
    closeOf(oldest).click()
    expect(document.activeElement).toBe(outside)
  })
})
