import { afterEach, describe, expect, it, vi } from "vitest"
import {
  defineLtDialog,
  type LtDialog,
} from "./components/frame/dialog/lt-dialog"
import {
  defineLtPopover,
  type LtPopover,
} from "./components/frame/popover/lt-popover"
import { defineElement, whenUpgraded } from "./components/host-element"
import { defineLtToast, LtToast } from "./components/standalone/toast/lt-toast"
import * as pkg from "./index"
import { defineLt } from "./register"
import { waitForPaint } from "./testing/a11y"

/*
 * The tag names come from the main entry point, not from `register.ts`. Then
 * the test fails on a component added to the package without being included
 * in the registration, which is the mistake that would otherwise be silent.
 */
const tags = Object.entries(pkg)
  .filter(([name]) => name.endsWith("_TAG"))
  .map(([, value]) => value as string)

describe("defineLt()", () => {
  it("copes with a component already registered under a custom name", () => {
    /*
     * A constructor can only be in the registry once. If the class was
     * already registered under another name, `customElements.define` threw
     * NotSupportedError, and the components after it in the list were never
     * registered.
     */
    defineLtToast("app-toast")

    expect(() => defineLt()).not.toThrow()

    for (const tag of tags) {
      expect(customElements.get(tag), tag).toBeDefined()
    }
    expect(document.createElement("app-toast")).toBeInstanceOf(LtToast)
    expect(document.createElement("lt-toast")).toBeInstanceOf(LtToast)
  })

  it("registers every web component in the package", () => {
    expect(tags.length).toBeGreaterThanOrEqual(9)

    defineLt()

    for (const tag of tags) {
      expect(customElements.get(tag), tag).toBeDefined()
    }
  })

  it("copes with being called twice", () => {
    defineLt()
    expect(() => defineLt()).not.toThrow()
  })
})

describe("defineElement()", () => {
  it("registers the same class under two names", () => {
    class Custom extends HTMLElement {}
    defineElement("lt-custom-first", Custom)

    expect(() => defineElement("lt-custom-second", Custom)).not.toThrow()

    expect(customElements.get("lt-custom-second")).toBeDefined()
    expect(document.createElement("lt-custom-second")).toBeInstanceOf(Custom)
  })

  it("works without customElements.getName", () => {
    // Chrome before 117, Firefox before 116 and Safari before 17 lack `getName`.
    class Custom extends HTMLElement {}
    defineElement("lt-custom-without-getname", Custom)
    Object.defineProperty(customElements, "getName", {
      value: undefined,
      configurable: true,
    })

    try {
      expect(() =>
        defineElement("lt-custom-without-getname-two", Custom),
      ).not.toThrow()
    } finally {
      Reflect.deleteProperty(customElements, "getName")
    }

    expect(
      document.createElement("lt-custom-without-getname-two"),
    ).toBeInstanceOf(Custom)
  })
})

describe("whenUpgraded()", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("warns once about an element nobody registers", async () => {
    vi.useFakeTimers()
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {})
    const element = document.createElement("lt-never-registered")

    void whenUpgraded(element)
    void whenUpgraded(element)
    vi.advanceTimersByTime(2999)
    expect(warning).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(warning).toHaveBeenCalledTimes(1)
    expect(String(warning.mock.calls[0]?.[0])).toContain(
      "<lt-never-registered> is not registered",
    )
  })

  it("rejects an element that cannot be a component, without warning", async () => {
    vi.useFakeTimers()
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {})

    await expect(whenUpgraded(document.createElement("div"))).rejects.toThrow()
    vi.advanceTimersByTime(3000)

    expect(warning).not.toHaveBeenCalled()
  })

  it("stays quiet when the registration comes before the deadline", async () => {
    vi.useFakeTimers()
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {})
    const element = document.createElement("lt-registered-in-time")

    const promise = whenUpgraded(element)
    customElements.define("lt-registered-in-time", class extends HTMLElement {})
    await promise
    vi.advanceTimersByTime(3000)

    expect(warning).not.toHaveBeenCalled()
  })
})

/*
 * A property set before the registration. `el.open = true` from a script that
 * ran before `defineLt()` became an own property on the plain element, which
 * shadowed the setter once the element was upgraded: the attribute never came,
 * and later writes never reached the setter either. The tag names are
 * registered late on purpose, as subclasses, since `lt-toast` and
 * `lt-popover` have already taken the constructors in this file.
 */
describe("a property set before the registration", () => {
  afterEach(() => {
    document.body.innerHTML = ""
  })

  it("reaches the attribute, and the setter works from then on", async () => {
    document.body.innerHTML = `<lt-toast-early></lt-toast-early>`
    const region = document.querySelector("lt-toast-early") as LtToast
    region.duration = 1234

    defineLtToast("lt-toast-early")
    await Promise.resolve()

    expect(region.getAttribute("duration")).toBe("1234")
    expect(region.duration).toBe(1234)
    expect(Object.getOwnPropertyDescriptor(region, "duration")).toBeUndefined()

    region.duration = 99
    expect(region.getAttribute("duration")).toBe("99")
  })

  it("takes the last write when the script writes again right after", async () => {
    document.body.innerHTML = `<lt-toast-rewritten></lt-toast-rewritten>`
    const region = document.querySelector("lt-toast-rewritten") as LtToast
    region.duration = 1234

    defineLtToast("lt-toast-rewritten")
    region.duration = 99
    await Promise.resolve()

    expect(region.getAttribute("duration")).toBe("99")
    expect(region.duration).toBe(99)
  })

  it("opens a dialog the script opened before the registration", async () => {
    document.body.innerHTML = `
      <lt-dialog-early>
        <dialog class="lt-dialog">
          <h2>The order is placed</h2>
          <form method="dialog">
            <button class="lt-button" value="close">Close</button>
          </form>
        </dialog>
      </lt-dialog-early>`
    const box = document.querySelector("lt-dialog-early") as LtDialog
    const dialog = box.querySelector("dialog") as HTMLDialogElement
    box.open = true

    defineLtDialog("lt-dialog-early")
    await Promise.resolve()
    await waitForPaint()

    expect(box.hasAttribute("open")).toBe(true)
    expect(dialog.matches(":modal")).toBe(true)

    // `close` is a queued task, so wait for the event rather than a frame.
    const closed = new Promise<void>((resolve) => {
      dialog.addEventListener("close", () => resolve(), { once: true })
    })
    box.open = false
    await closed
    await waitForPaint()
    expect(dialog.matches(":modal")).toBe(false)
    expect(box.hasAttribute("open")).toBe(false)
  })

  it("leaves a dialog closed when the script closes it right after", async () => {
    // GitHub's review found this: the upgrade's `connectedCallback` read the
    // shadowing property and opened the dialog, the script then wrote `false`
    // into the same shadow, and the adoption removed an attribute that was
    // never there, so nothing closed the dialog again.
    document.body.innerHTML = `
      <lt-dialog-reclosed>
        <dialog class="lt-dialog">
          <h2>The order is placed</h2>
          <form method="dialog">
            <button class="lt-button" value="close">Close</button>
          </form>
        </dialog>
      </lt-dialog-reclosed>`
    const box = document.querySelector("lt-dialog-reclosed") as LtDialog
    const dialog = box.querySelector("dialog") as HTMLDialogElement
    box.open = true

    defineLtDialog("lt-dialog-reclosed")
    box.open = false
    await Promise.resolve()
    await waitForPaint()

    expect(box.open).toBe(false)
    expect(box.hasAttribute("open")).toBe(false)
    expect(dialog.matches(":modal")).toBe(false)
  })

  it("holds for a setter that notes something on the instance", async () => {
    // `<lt-popover>` remembers in `set open` that the user wanted it open, in
    // a field the component initialises after `super()`. Adopting the property
    // in the constructor would have run the setter before the field existed.
    document.body.innerHTML = `
      <lt-popover-early>
        <button class="lt-button" type="button">Actions</button>
        <ul popover class="lt-popover"><li>Archive</li></ul>
      </lt-popover-early>`
    const menu = document.querySelector("lt-popover-early") as LtPopover
    menu.open = true

    defineLtPopover("lt-popover-early")
    await Promise.resolve()
    await waitForPaint()

    expect(menu.hasAttribute("open")).toBe(true)
    expect(menu.querySelector("[popover]")?.matches(":popover-open")).toBe(true)

    // The note survived the field initialiser: a morph that tears `open` off
    // gets it put back, which the component does only when the user opened it.
    menu.removeAttribute("open")
    await waitForPaint()
    expect(menu.hasAttribute("open")).toBe(true)

    menu.open = false
    await waitForPaint()
    expect(menu.hasAttribute("open")).toBe(false)
    expect(menu.querySelector("[popover]")?.matches(":popover-open")).toBe(
      false,
    )
  })

  it("leaves a property without a setter alone", async () => {
    document.body.innerHTML = `<lt-toast-plain></lt-toast-plain>`
    const region = document.querySelector("lt-toast-plain") as LtToast &
      Record<string, unknown>
    region.appData = { saved: true }

    defineLtToast("lt-toast-plain")
    await Promise.resolve()

    expect(Object.getOwnPropertyDescriptor(region, "appData")?.value).toEqual({
      saved: true,
    })
    expect(region.hasAttribute("app-data")).toBe(false)
  })
})
