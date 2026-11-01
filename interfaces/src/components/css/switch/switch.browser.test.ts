/// <reference path="../../../types/css.d.ts" />

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import page from "../../../../../documentation/src/content/docs/components/switch.mdx?raw"
import {
  expectNoAccessibilityViolations,
  mount,
  waitForPaint,
} from "../../../testing/a11y"
import { switchControl } from "./switch"

import "../../../tokens/tokens.css"
import "./switch.css"
import "../label/label.css"

/**
 * The saving example on the page, run the way a reader pastes it.
 *
 * Nothing else runs the code blocks on the component pages. The "Plain HTML"
 * tab under "Saving immediately" promises that the switch flips back when
 * saving fails, and the page promises that the keyboard works as for a plain
 * checkbox. The example used to disable the switch while it saved, and then
 * the browser took focus from it without giving it back; and `fetch` does
 * not reject a response with an error status, so a refusal from the server
 * was reported as a success.
 */
describe("the saving example on the page", () => {
  /** The markup and script in the "Plain HTML" tab, read from the page. */
  function readTab(): { markup: string; script: string } {
    const tab = /<TabItem label="Plain HTML">\s*```html\n([\s\S]*?)```/.exec(
      page,
    )?.[1]
    if (tab === undefined) throw new Error('Found no "Plain HTML" tab')
    const script = /<script type="module">([\s\S]*?)<\/script>/.exec(tab)?.[1]
    if (script === undefined) throw new Error("Found no script in the tab")
    return { markup: tab.replace(/<script[\s\S]*<\/script>/, ""), script }
  }
  const { markup, script } = readTab()

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** Mounts the example with a server that answers `status`, and flips the switch. */
  function flip(status: number) {
    mount(markup)
    let calls = 0
    vi.stubGlobal("fetch", () => {
      calls += 1
      return new Promise((resolve) => {
        setTimeout(() => resolve(new Response("", { status })), 50)
      })
    })
    new Function(script)()

    const toggle = document.getElementById("auto-renew") as HTMLInputElement
    const message = document.getElementById("auto-renew-status") as HTMLElement
    toggle.focus()
    toggle.click()

    return { toggle, message, calls: () => calls }
  }

  it("rolls back and reports it when the server answers with an error status", async () => {
    const { toggle, message } = flip(500)
    expect(toggle.checked).toBe(true)

    await vi.waitFor(() => expect(message.textContent).not.toBe(""))

    expect(toggle.checked).toBe(false)
    expect(message.textContent).toBe("Could not save. Try again.")
  })

  it("keeps focus and blocks another press while it saves", async () => {
    const { toggle, message, calls } = flip(200)
    expect(document.activeElement).toBe(toggle)

    // Another press while saving should neither flip the switch nor send.
    toggle.click()
    expect(toggle.checked).toBe(true)

    await vi.waitFor(() =>
      expect(message.textContent).toBe("Auto-renew is on."),
    )

    expect(document.activeElement).toBe(toggle)
    expect(calls()).toBe(1)

    // And afterwards it works as before.
    toggle.click()
    expect(toggle.checked).toBe(false)
    expect(calls()).toBe(2)
    await vi.waitFor(() =>
      expect(message.textContent).toBe(
        "Auto-renew is off. Your walls expire with the subscription.",
      ),
    )
  })
})

describe("lt-switch", () => {
  beforeEach(() => {
    mount(`
      <div class="lt-switch-row">
        <input class="lt-switch" type="checkbox" role="switch" id="alerts" checked />
        <label class="lt-label" for="alerts">Auto-renew</label>
      </div>
      <div class="lt-switch-row">
        <input class="lt-switch" type="checkbox" role="switch" id="sms" />
        <label class="lt-label" for="sms">Lethal response</label>
      </div>
    `)
  })

  it("announces itself as a switch, not a checkbox", () => {
    const toggle = document.getElementById("alerts") as HTMLInputElement

    // role="switch" makes screen readers say "on" and "off". The element is
    // still a checkbox, so FormData finds it as before.
    expect(toggle.getAttribute("role")).toBe("switch")
    expect(toggle.type).toBe("checkbox")
  })

  it("moves the knob to the right when it is on", () => {
    const on = getComputedStyle(document.getElementById("alerts") as Element)
    const off = getComputedStyle(document.getElementById("sms") as Element)

    expect(on.backgroundPositionX).not.toBe(off.backgroundPositionX)
    expect(on.backgroundColor).not.toBe(off.backgroundColor)
  })

  it("is submitted with the form like a checkbox", () => {
    document.body.innerHTML = `
      <form id="form">
        <input class="lt-switch" type="checkbox" role="switch"
          name="alerts" value="yes" checked />
      </form>
    `
    const form = document.getElementById("form") as HTMLFormElement

    expect(Object.fromEntries(new FormData(form))).toEqual({ alerts: "yes" })
  })

  it("sets the attributes from the builder function", () => {
    expect(switchControl()).toEqual({
      class: "lt-switch",
      type: "checkbox",
      role: "switch",
    })
    expect(switchControl({ disabled: true }).disabled).toBe(true)
    expect(switchControl.row).toBe("lt-switch-row")
  })

  it("has no accessibility violations", async () => {
    await waitForPaint()
    await expectNoAccessibilityViolations()
  })
})
