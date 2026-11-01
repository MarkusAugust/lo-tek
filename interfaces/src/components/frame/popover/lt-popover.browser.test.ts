/// <reference path="../../../types/css.d.ts" />

import { beforeAll, beforeEach, describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"

import {
  expectNoAccessibilityViolations,
  mount,
  waitForPaint,
} from "../../../testing/a11y"
import { attr } from "../../../testing/markup"
import { datastarPatch } from "../../../testing/update"
import { defineLtPopover, type LtPopover } from "./lt-popover"
import { popover, popoverPlacements } from "./popover"

import "../../../tokens/tokens.css"
import "./popover.css"
import "../../css/button/button.css"
import "../../css/list/list.css"

/** The markup the server sends, built with the builder function and not by hand. */
const BOX = popover({ id: "panel" })

async function paint() {
  await customElements.whenDefined("lt-popover")
  await waitForPaint()
}

describe("lt-popover", () => {
  beforeAll(() => {
    defineLtPopover()
  })

  beforeEach(async () => {
    mount(`
      <lt-popover placement="bottom-end" ${attr(BOX.host)}>
        <button ${attr(BOX.trigger)} class="lt-button" id="trigger">Actions</button>
        <ul ${attr(BOX.panel)} data-variant="plain">
          <li><button class="lt-button" data-variant="ghost" type="button">Archive</button></li>
          <li><button class="lt-button" data-variant="ghost" type="button">Delete</button></li>
        </ul>
      </lt-popover>
    `)
    await paint()
  })

  it("gets the wiring from the server, not from the component", () => {
    const trigger = document.getElementById("trigger") as HTMLElement
    const panel = document.getElementById("panel") as HTMLElement

    expect(trigger.getAttribute("aria-expanded")).toBe("false")
    expect(trigger.getAttribute("aria-controls")).toBe("panel")
    expect(panel.getAttribute("popover")).toBe("manual")
    expect(panel.classList.contains("lt-popover")).toBe(true)
  })

  it("does not ask the template to preserve anything", () => {
    // The state is the user's, and the component sets it back itself after
    // a patch. If `data-preserve-attr` comes back here, someone has revived
    // the contract the template had to copy from the documentation.
    const host = document.querySelector("lt-popover") as HTMLElement
    const button = document.querySelector("button") as HTMLElement
    const panel = document.getElementById("panel") as HTMLElement

    expect(host.hasAttribute("data-preserve-attr")).toBe(false)
    expect(button.hasAttribute("data-preserve-attr")).toBe(false)
    expect(panel.hasAttribute("data-preserve-attr")).toBe(false)
  })

  it("opens and closes on click", async () => {
    const trigger = document.getElementById("trigger") as HTMLElement
    const panel = document.getElementById("panel") as HTMLElement

    trigger.click()
    await paint()
    expect(panel.matches(":popover-open")).toBe(true)
    expect(trigger.getAttribute("aria-expanded")).toBe("true")

    trigger.click()
    await paint()
    expect(panel.matches(":popover-open")).toBe(false)
    expect(trigger.getAttribute("aria-expanded")).toBe("false")
  })

  it("closes on Escape and gives focus back to the button", async () => {
    const trigger = document.getElementById("trigger") as HTMLElement

    trigger.click()
    await paint()

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    await paint()

    const panel = document.getElementById("panel") as HTMLElement
    expect(panel.matches(":popover-open")).toBe(false)
    expect(document.activeElement).toBe(trigger)
  })

  it("closes on a click outside", async () => {
    const trigger = document.getElementById("trigger") as HTMLElement
    trigger.click()
    await paint()

    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await paint()

    const panel = document.getElementById("panel") as HTMLElement
    expect(panel.matches(":popover-open")).toBe(false)
  })

  it("reports when the panel opens and closes", async () => {
    const box = document.querySelector("lt-popover") as HTMLElement
    const messages: boolean[] = []
    box.addEventListener("popover-toggle", (event) => {
      messages.push(event.detail.open)
    })

    const trigger = document.getElementById("trigger") as HTMLElement
    trigger.click()
    await paint()
    trigger.click()
    await paint()

    expect(messages).toEqual([true, false])
  })

  it("has no accessibility violations when the panel is open", async () => {
    const trigger = document.getElementById("trigger") as HTMLElement
    trigger.click()
    await paint()

    await expectNoAccessibilityViolations()
  })
})

/**
 * How the component recognises its parts.
 *
 * The button used to be marked with `slot="trigger"`, a leftover from when
 * the component had shadow DOM. Without a shadow root `slot` does nothing in
 * HTML, so the attribute looked like something it was not. Now the component
 * reads the wiring that has to be there anyway: the panel has `popover`, and
 * the button points to it with `aria-controls`.
 */
describe("lt-popover finds its parts", () => {
  beforeAll(() => {
    defineLtPopover()
  })

  it("does not emit slot at all", () => {
    expect(Object.keys(popover({ id: "x" }).trigger)).not.toContain("slot")
  })

  it("works on markup with no slot at all", async () => {
    mount(`
      <lt-popover ${attr(BOX.host)}>
        <button ${attr(BOX.trigger)} class="lt-button" id="aria-only">Actions</button>
        <ul ${attr(BOX.panel)}><li>Archive</li></ul>
      </lt-popover>
    `)
    await paint()

    const button = document.getElementById("aria-only") as HTMLButtonElement
    const panel = document.querySelector("[popover]") as HTMLElement

    expect(document.querySelectorAll("[slot]")).toHaveLength(0)

    button.click()
    await waitForPaint()

    expect(panel.matches(":popover-open")).toBe(true)
    expect(button.getAttribute("aria-expanded")).toBe("true")
  })

  it("leaves an old slot attribute alone without harm", async () => {
    // A server that has not been updated yet still sends `slot="trigger"`.
    // That must not get in the way: the attribute is inert without a shadow root.
    mount(`
      <lt-popover ${attr(BOX.host)}>
        <button ${attr(BOX.trigger)} slot="trigger" class="lt-button" id="with-slot">Actions</button>
        <ul ${attr(BOX.panel)}><li>Archive</li></ul>
      </lt-popover>
    `)
    await paint()

    const button = document.getElementById("with-slot") as HTMLButtonElement
    const panel = document.querySelector("[popover]") as HTMLElement

    button.click()
    await waitForPaint()

    expect(panel.matches(":popover-open")).toBe(true)
  })
})

describe("lt-popover positions the panel", () => {
  beforeAll(() => {
    defineLtPopover()
  })

  function markup(id: string, host = "", panel = 'popover="manual"') {
    return `
      <lt-popover ${host}>
        <button aria-controls="${id}" aria-expanded="false" class="lt-button" id="${id}-button">Breaker actions</button>
        <ul class="lt-popover" id="${id}" ${panel}><li>Mark returned</li><li>Retire the breaker</li></ul>
      </lt-popover>
    `
  }

  async function openPanel(id: string) {
    ;(document.getElementById(`${id}-button`) as HTMLElement).click()
    await paint()
    return {
      button: (
        document.getElementById(`${id}-button`) as HTMLElement
      ).getBoundingClientRect(),
      panel: (
        document.getElementById(id) as HTMLElement
      ).getBoundingClientRect(),
    }
  }

  it("hangs below the button, with the same left edge", async () => {
    mount(markup("p1"))
    await paint()
    const { button, panel } = await openPanel("p1")

    expect(Math.abs(panel.left - button.left)).toBeLessThan(1.5)
    expect(Math.abs(panel.top - (button.bottom + 4))).toBeLessThan(1.5)
  })

  it("aligns the right edges with bottom-end", async () => {
    mount(markup("p2", 'placement="bottom-end"'))
    await paint()
    const { button, panel } = await openPanel("p2")

    expect(Math.abs(panel.right - button.right)).toBeLessThan(1.5)
  })

  it("makes start the right edge in right-to-left", async () => {
    // The position is physical, but `start` and `end` follow the reading
    // direction. With logical `inset-inline-start` and a physical value the
    // panel ended up on the opposite side of the button.
    mount(`<div dir="rtl">${markup("p3")}</div>`)
    await paint()
    const { button, panel } = await openPanel("p3")

    expect(Math.abs(panel.right - button.right)).toBeLessThan(1.5)
    expect(Math.abs(panel.top - (button.bottom + 4))).toBeLessThan(1.5)
  })

  it("drops below the button when there is no room above", async () => {
    // `top-start` did not clamp, and a panel at the top of the page was
    // entirely off screen, with no way to scroll to it.
    mount(markup("p4", 'placement="top-start"'))
    await paint()
    const { button, panel } = await openPanel("p4")

    expect(panel.top).toBeGreaterThanOrEqual(4)
    expect(Math.abs(panel.top - (button.bottom + 4))).toBeLessThan(1.5)
  })

  it("keeps up when the browser itself closes an auto popover", async () => {
    // Hand-written markup with a bare `popover` is `auto`, and then the
    // browser closes the panel itself. The host was left with `open`, and the
    // next click on the button did nothing visible.
    mount(markup("p5", "", "popover"))
    await paint()
    const host = document.querySelector("lt-popover") as HTMLElement
    const button = document.getElementById("p5-button") as HTMLElement
    const panel = document.getElementById("p5") as HTMLElement
    const messages: boolean[] = []
    host.addEventListener("popover-toggle", (e) => messages.push(e.detail.open))

    button.click()
    await paint()
    expect(host.hasAttribute("open")).toBe(true)

    // The way the browser does it on light dismiss.
    panel.hidePopover()
    await paint()

    expect(host.hasAttribute("open")).toBe(false)
    expect(button.getAttribute("aria-expanded")).toBe("false")
    expect(messages).toEqual([true, false])

    button.click()
    await paint()
    expect(panel.matches(":popover-open")).toBe(true)
  })

  it("sets the position again after a patch strips style", async () => {
    mount(markup("p6"))
    await paint()
    await openPanel("p6")
    const panel = document.getElementById("p6") as HTMLElement
    // The attribute is read directly: WebKit returns an empty string from
    // `style.getPropertyValue` for a custom property.
    const position = () => panel.getAttribute("style") ?? ""
    expect(position()).toContain("--lt-popover-top")

    panel.removeAttribute("style")
    await paint()

    expect(position()).toContain("--lt-popover-top")
  })

  it("lets the builder function set placement on the host", () => {
    expect(popover({ id: "x" }).host.placement).toBeUndefined()
    expect(popover({ id: "x", placement: "top-end" }).host.placement).toBe(
      "top-end",
    )
    expect(popoverPlacements).toEqual([
      "bottom-start",
      "bottom-end",
      "top-start",
      "top-end",
    ])
    expect(popover.isPlacement("top-end")).toBe(true)
    expect(popover.isPlacement("middle")).toBe(false)
  })
})

/*
 * Markup written without JavaScript: a button and a panel with the class,
 * without `popover`, id or `aria-controls`. The component fills in `popover`,
 * but never an id: a panel with an id the server did not send is replaced on
 * the next update. `WITH_ID` is what the recipe shows, with the id from the
 * template.
 */
const BARE = `
  <lt-popover>
    <button class="lt-button" id="bare-button">Actions</button>
    <ul class="lt-popover" data-variant="plain">
      <li><button class="lt-button" data-variant="ghost" type="button">Archive</button></li>
    </ul>
  </lt-popover>`

const WITH_ID = BARE.replace(
  '<ul class="lt-popover"',
  '<ul class="lt-popover" id="menu"',
)

describe("lt-popover wires up bare structure", () => {
  beforeAll(() => {
    defineLtPopover()
  })

  function parts() {
    return {
      button: document.getElementById("bare-button") as HTMLButtonElement,
      panel: document.querySelector("ul.lt-popover") as HTMLElement,
    }
  }

  it("never writes an id on the panel, and still opens on click", async () => {
    mount(BARE)
    await paint()
    const { button, panel } = parts()

    expect(panel.getAttribute("popover")).toBe("manual")
    expect(panel.hasAttribute("id")).toBe(false)
    expect(button.hasAttribute("aria-controls")).toBe(false)
    expect(button.getAttribute("aria-expanded")).toBe("false")

    button.click()
    await waitForPaint()
    expect(panel.matches(":popover-open")).toBe(true)
    expect(button.getAttribute("aria-expanded")).toBe("true")
    ;(document.querySelector("lt-popover") as LtPopover).hide()
  })

  it("writes aria-controls from the id the template gave the panel, and opens on click", async () => {
    mount(WITH_ID)
    await paint()
    const { button, panel } = parts()

    expect(panel.getAttribute("popover")).toBe("manual")
    expect(panel.id).toBe("menu")
    expect(button.getAttribute("aria-controls")).toBe("menu")
    expect(button.getAttribute("aria-expanded")).toBe("false")

    button.click()
    await waitForPaint()
    expect(panel.matches(":popover-open")).toBe(true)
    expect(button.getAttribute("aria-expanded")).toBe("true")

    await expectNoAccessibilityViolations()
    ;(document.querySelector("lt-popover") as LtPopover).hide()
  })

  it("keeps the popover open when a patch removes both open and popover", async () => {
    /*
     * A morph from a template without `popover` removes `open` on the host
     * and `popover` on the panel in the same pass. The component closes,
     * reopens in the next microtask, and only after that does `toggle` arrive
     * with "closed" from the closing, as a separate task. It was taken as the
     * user closing it, and the popover stayed closed after a patch that said
     * nothing about it.
     */
    mount(BARE)
    await paint()
    const { button, panel } = parts()
    const host = document.querySelector("lt-popover") as LtPopover
    button.click()
    await waitForPaint()
    expect(panel.matches(":popover-open")).toBe(true)

    host.removeAttribute("open")
    panel.removeAttribute("popover")
    await waitForPaint()
    await waitForPaint()

    expect(host.open).toBe(true)
    expect(panel.getAttribute("popover")).toBe("manual")
    expect(panel.matches(":popover-open")).toBe(true)
    expect(button.getAttribute("aria-expanded")).toBe("true")
    host.hide()
  })

  it("does not open by itself when server-controlled is set and removed again", async () => {
    mount(BARE)
    await paint()
    const { button, panel } = parts()
    const host = document.querySelector("lt-popover") as LtPopover
    button.click()
    await waitForPaint()
    expect(panel.matches(":popover-open")).toBe(true)

    // The server takes over and closes it. Then it lets go again. If the
    // component remembered that the user opened the popover, it popped open
    // the moment the attribute was removed.
    host.setAttribute("server-controlled", "")
    host.removeAttribute("open")
    await waitForPaint()
    host.removeAttribute("server-controlled")
    await waitForPaint()
    await waitForPaint()

    expect(host.open).toBe(false)
    expect(panel.matches(":popover-open")).toBe(false)
  })

  it("leaves what the server wrote", async () => {
    // `popover` without a value is `auto`, which is a different value from
    // the component's `manual`. The id also comes from the server.
    mount(
      BARE.replace(
        '<ul class="lt-popover" data-variant="plain">',
        '<ul class="lt-popover" id="own-panel" popover data-variant="plain">',
      ),
    )
    await paint()
    const { button, panel } = parts()

    expect(panel.getAttribute("popover")).toBe("")
    expect(panel.id).toBe("own-panel")
    expect(button.getAttribute("aria-controls")).toBe("own-panel")
  })

  it("does not pick a button that points to something else", async () => {
    mount(
      WITH_ID.replace(
        '<button class="lt-button" id="bare-button">',
        '<button class="lt-button" aria-controls="something-else" id="wrong-button">Filter</button>' +
          '<button class="lt-button" id="bare-button">',
      ),
    )
    await paint()
    const { button, panel } = parts()
    const wrong = document.getElementById("wrong-button") as HTMLElement

    expect(button.getAttribute("aria-controls")).toBe(panel.id)
    expect(wrong.getAttribute("aria-controls")).toBe("something-else")
    expect(wrong.hasAttribute("aria-expanded")).toBe(false)
  })

  it("sets the wiring back after a patch", async () => {
    mount(WITH_ID)
    await paint()
    const { button, panel } = parts()

    // The way a morph does it: everything that was not in the server's HTML
    // is removed. The id was there, so it stays.
    panel.removeAttribute("popover")
    for (const name of ["aria-controls", "aria-expanded"]) {
      button.removeAttribute(name)
    }
    await waitForPaint()

    expect(panel.id).toBe("menu")
    expect(panel.getAttribute("popover")).toBe("manual")
    expect(button.getAttribute("aria-controls")).toBe("menu")
    expect(button.getAttribute("aria-expanded")).toBe("false")
  })

  it("uses the panel's id when a patch from the server gives it one", async () => {
    mount(BARE)
    await paint()
    const { button, panel } = parts()
    expect(button.hasAttribute("aria-controls")).toBe(false)

    panel.id = "menu"
    await waitForPaint()

    expect(button.getAttribute("aria-controls")).toBe("menu")
  })

  it("makes the button a plain button, so it does not submit the form", async () => {
    mount(`
      <form id="form">
        <lt-popover>
          <button class="lt-button">What does this mean?</button>
          <div class="lt-popover">Explanation</div>
        </lt-popover>
      </form>`)
    await paint()
    let submitted = 0
    document.getElementById("form")?.addEventListener("submit", (event) => {
      submitted++
      event.preventDefault()
    })
    const button = document.querySelector("button") as HTMLButtonElement

    button.click()
    await paint()
    expect(submitted).toBe(0)
    expect(document.querySelector("lt-popover")?.hasAttribute("open")).toBe(
      true,
    )

    // A patch from the template strips `type` again.
    button.removeAttribute("type")
    await paint()
    expect(button.getAttribute("type")).toBe("button")
  })

  it("corrects an empty type, but leaves a button that says submit", async () => {
    mount(`
      <lt-popover id="empty">
        <button class="lt-button" type="">What does this mean?</button>
        <div class="lt-popover">Explanation</div>
      </lt-popover>
      <lt-popover id="send">
        <button class="lt-button" type="submit">Send</button>
        <div class="lt-popover">Explanation</div>
      </lt-popover>`)
    await paint()

    expect(document.querySelector("#empty button")?.getAttribute("type")).toBe(
      "button",
    )
    expect(document.querySelector("#send button")?.getAttribute("type")).toBe(
      "submit",
    )
  })

  it("writes nothing on markup from lt.popover()", async () => {
    // The direct claim behind "what the server wrote stays": zero mutation
    // records from the component's first pass.
    const wrapper = document.createElement("div")
    wrapper.innerHTML = `
      <lt-popover ${attr(BOX.host)}>
        <button ${attr(BOX.trigger)} class="lt-button">Actions</button>
        <ul ${attr(BOX.panel)}><li>Archive</li></ul>
      </lt-popover>`
    const host = wrapper.querySelector("lt-popover") as HTMLElement
    const records: MutationRecord[] = []
    const observer = new MutationObserver((r) => records.push(...r))
    observer.observe(host, {
      attributes: true,
      childList: true,
      subtree: true,
    })

    document.body.append(wrapper)
    await paint()

    expect(records.map((p) => `${p.type} ${p.attributeName}`)).toEqual([])
    observer.disconnect()
    wrapper.remove()
  })
})

describe("lt-popover when React writes the property", () => {
  beforeAll(() => {
    defineLtPopover()
  })

  it("does not open the popover when the property is set to undefined", async () => {
    mount(
      `<lt-popover ${attr(BOX.host)}>
        <button type="button" ${attr(BOX.trigger)}>Actions</button>
        <div ${attr(BOX.panel)}>Content</div>
      </lt-popover>`,
    )
    await customElements.whenDefined("lt-popover")
    await waitForPaint()
    const host = document.querySelector("lt-popover") as LtPopover

    // The way React 19 writes a prop that is gone.
    ;(host as unknown as { open: undefined }).open = undefined
    await waitForPaint()

    expect(host.hasAttribute("open")).toBe(false)
    expect(document.getElementById("panel")?.matches(":popover-open")).toBe(
      false,
    )
  })

  it("sends no popover-toggle when open is set as a property or attribute", async () => {
    /*
     * The event comes from the user and the methods. If it also came from the
     * property and the attribute, the Datastar recipe with `data-attr:open`
     * and `data-on:popover-toggle` would get its own signal back.
     */
    mount(
      `<lt-popover ${attr(BOX.host)}>
        <button type="button" ${attr(BOX.trigger)}>Actions</button>
        <div ${attr(BOX.panel)}>Content</div>
      </lt-popover>`,
    )
    await customElements.whenDefined("lt-popover")
    await waitForPaint()
    const host = document.querySelector("lt-popover") as LtPopover
    const panel = document.getElementById("panel") as HTMLElement
    const log: boolean[] = []
    host.addEventListener("popover-toggle", (e) => log.push(e.detail.open))

    host.open = true
    await waitForPaint()
    expect(panel.matches(":popover-open")).toBe(true)
    host.open = false
    await waitForPaint()
    host.setAttribute("open", "")
    await waitForPaint()
    host.removeAttribute("open")
    await waitForPaint()
    expect(panel.matches(":popover-open")).toBe(false)
    expect(log).toEqual([])

    host.show()
    host.hide()
    expect(log).toEqual([true, false])
  })
})

describe("lt-popover inside a modal dialog", () => {
  beforeAll(() => {
    defineLtPopover()
  })

  it("closes only the popover on Escape, not the dialog", async () => {
    mount(`
      <dialog id="dialog">
        <lt-popover ${attr(BOX.host)}>
          <button type="button" ${attr(BOX.trigger)}>Actions</button>
          <div ${attr(BOX.panel)}><button type="button">Archive</button></div>
        </lt-popover>
      </dialog>`)
    await customElements.whenDefined("lt-popover")
    const dialog = document.getElementById("dialog") as HTMLDialogElement
    const host = document.querySelector("lt-popover") as LtPopover
    dialog.showModal()
    host.show()
    await waitForPaint()
    expect(host.open).toBe(true)

    // A real key press: a synthetic event never closes a dialog, so only
    // this shows that the dialog actually survives.
    ;(document.querySelector("#panel button") as HTMLElement).focus()
    await userEvent.keyboard("{Escape}")
    await waitForPaint()

    expect(host.open, "the popover was not closed").toBe(false)
    expect(dialog.open, "Escape closed the dialog too").toBe(true)
    dialog.close()
  })

  it("closes on Escape in another field, but leaves focus there", async () => {
    // Before, focus jumped from the field the user was in to the button.
    mount(`
      <lt-popover ${attr(BOX.host)}>
        <button type="button" ${attr(BOX.trigger)}>Actions</button>
        <div ${attr(BOX.panel)}>Content</div>
      </lt-popover>
      <input id="other">`)
    await customElements.whenDefined("lt-popover")
    const host = document.querySelector("lt-popover") as LtPopover
    host.show()
    await waitForPaint()

    const other = document.getElementById("other") as HTMLInputElement
    other.focus()
    await userEvent.keyboard("{Escape}")
    await waitForPaint()

    expect(host.open).toBe(false)
    expect(document.activeElement).toBe(other)
  })

  it("lets a modal dialog opened on top of the popover be closed by its own key press", async () => {
    mount(`
      <lt-popover ${attr(BOX.host)}>
        <button type="button" ${attr(BOX.trigger)}>Actions</button>
        <div ${attr(BOX.panel)}>Content</div>
      </lt-popover>
      <dialog id="on-top"><button type="button" id="ok">Ok</button></dialog>`)
    await customElements.whenDefined("lt-popover")
    const host = document.querySelector("lt-popover") as LtPopover
    host.show()
    await waitForPaint()

    const onTop = document.getElementById("on-top") as HTMLDialogElement
    onTop.showModal()
    ;(document.getElementById("ok") as HTMLElement).focus()
    await userEvent.keyboard("{Escape}")
    await waitForPaint()

    expect(onTop.open, "the dialog was not closed").toBe(false)
    expect(host.open, "the popover underneath was closed").toBe(true)
  })

  it("closes the popover, not the dialog, when focus is on the dialog itself", async () => {
    // A click on text in the panel gives the dialog focus, not `body`.
    // Before, Escape then closed the dialog and left the popover open in it.
    mount(`
      <dialog id="dialog" tabindex="-1">
        <lt-popover ${attr(BOX.host)}>
          <button type="button" ${attr(BOX.trigger)}>Actions</button>
          <div ${attr(BOX.panel)}>Content</div>
        </lt-popover>
      </dialog>`)
    await customElements.whenDefined("lt-popover")
    const dialog = document.getElementById("dialog") as HTMLDialogElement
    const host = document.querySelector("lt-popover") as LtPopover
    dialog.showModal()
    host.show()
    await waitForPaint()

    dialog.focus()
    await userEvent.keyboard("{Escape}")
    await waitForPaint()

    expect(host.open, "the popover was not closed").toBe(false)
    expect(dialog.open, "Escape closed the dialog").toBe(true)
    dialog.close()
  })

  it("closes the inner of two nested popovers first", async () => {
    const inner = popover({ id: "inner" })
    mount(`
      <lt-popover ${attr(BOX.host)} id="outer">
        <button type="button" ${attr(BOX.trigger)}>Menu</button>
        <div ${attr(BOX.panel)}>
          <lt-popover ${attr(inner.host)} id="nested">
            <button type="button" ${attr(inner.trigger)}>Help</button>
            <div ${attr(inner.panel)}><button type="button" id="inside">Ok</button></div>
          </lt-popover>
        </div>
      </lt-popover>`)
    await customElements.whenDefined("lt-popover")
    const outer = document.getElementById("outer") as LtPopover
    const nested = document.getElementById("nested") as LtPopover
    outer.show()
    nested.show()
    await waitForPaint()

    ;(document.getElementById("inside") as HTMLElement).focus()
    await userEvent.keyboard("{Escape}")
    await waitForPaint()
    // Before, the outer one closed and left the inner one open.
    expect(nested.open).toBe(false)
    expect(outer.open).toBe(true)

    await userEvent.keyboard("{Escape}")
    await waitForPaint()
    expect(outer.open).toBe(false)
  })

  it("closes on Escape from a field in a shadow root in the panel", async () => {
    if (!customElements.get("shadow-field")) {
      customElements.define(
        "shadow-field",
        class extends HTMLElement {
          connectedCallback() {
            this.attachShadow({ mode: "open" }).innerHTML = "<input>"
          }
        },
      )
    }
    mount(`
      <lt-popover ${attr(BOX.host)}>
        <button type="button" ${attr(BOX.trigger)}>Actions</button>
        <div ${attr(BOX.panel)}><shadow-field></shadow-field></div>
      </lt-popover>`)
    await customElements.whenDefined("lt-popover")
    const host = document.querySelector("lt-popover") as LtPopover
    host.show()
    await waitForPaint()

    const field = document
      .querySelector("shadow-field")
      ?.shadowRoot?.querySelector("input") as HTMLInputElement
    field.focus()
    await userEvent.keyboard("{Escape}")
    await waitForPaint()

    expect(host.open).toBe(false)
  })

  it("leaves a key press something else has already handled", async () => {
    // A suggestion list in the popover closes on Escape and calls
    // `preventDefault`. Before, the same key press closed the popover too.
    mount(`
      <lt-popover ${attr(BOX.host)}>
        <button type="button" ${attr(BOX.trigger)}>Actions</button>
        <div ${attr(BOX.panel)}><input id="field"></div>
      </lt-popover>`)
    await customElements.whenDefined("lt-popover")
    const host = document.querySelector("lt-popover") as LtPopover
    host.show()
    await waitForPaint()

    const field = document.getElementById("field") as HTMLInputElement
    field.addEventListener("keydown", (event) => event.preventDefault())
    field.focus()
    await userEvent.keyboard("{Escape}")
    await waitForPaint()

    expect(host.open).toBe(true)
    expect(document.activeElement).toBe(field)
  })

  it("does not touch Escape when the popover is closed", async () => {
    mount(`
      <lt-popover ${attr(BOX.host)}>
        <button type="button" ${attr(BOX.trigger)}>Actions</button>
        <div ${attr(BOX.panel)}>Content</div>
      </lt-popover>
      <button type="button" id="other">Other</button>`)
    await customElements.whenDefined("lt-popover")
    await waitForPaint()
    const other = document.getElementById("other") as HTMLElement
    other.focus()

    const press = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    })
    other.dispatchEvent(press)

    expect(press.defaultPrevented).toBe(false)
    expect(document.activeElement, "focus was moved to the button").toBe(other)
  })
})

describe("lt-popover when the app and the server both open and close it", () => {
  beforeAll(() => {
    defineLtPopover()
  })

  /** The recipe on the component page. */
  const RECIPE = `<lt-popover id="menu" placement="bottom-end">
    <button class="lt-button" type="button">Actions</button>
    <ul class="lt-popover" id="actions">
      <li><button class="lt-button" data-variant="ghost" type="button">Mark LDG-117 returned</button></li>
    </ul>
  </lt-popover>`
  const host = () => document.getElementById("menu") as LtPopover
  const panel = () => document.getElementById("actions") as HTMLElement
  const item = () => panel().querySelector("button") as HTMLElement

  it("remembers show() on a popover the server opened", async () => {
    /*
     * `show()` returned before the setter when the panel was open already,
     * so the app's message was not noted, and the next patch without `open`
     * closed the panel.
     */
    mount(RECIPE.replace("<lt-popover", "<lt-popover open"))
    await paint()
    host().show()

    datastarPatch(RECIPE)
    await paint()

    expect(panel().matches(":popover-open")).toBe(true)
  })

  it("gives focus in the panel back to the button when hide() closes it", async () => {
    // Escape alone did it, and otherwise the focus was lost to the page.
    mount(RECIPE)
    await paint()
    host().show()
    await paint()
    item().focus()

    host().hide()
    await paint()

    expect(document.activeElement).toBe(host().querySelector("button"))
  })

  it("keeps the panel open and focus in it when the server sends the same recipe again", async () => {
    /*
     * The morph takes `open` for a moment, and the component puts it back
     * once the patch has landed. Closing the panel while it waited took the
     * focus from the button in it to the trigger on every patch.
     */
    mount(RECIPE)
    await paint()
    host().show()
    await paint()
    item().focus()

    datastarPatch(RECIPE)
    await paint()

    expect(panel().matches(":popover-open")).toBe(true)
    expect(document.activeElement).toBe(item())
  })
})
