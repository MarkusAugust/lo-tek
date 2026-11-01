/// <reference path="../../../types/css.d.ts" />

import { beforeEach, describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"

import { mount, waitForPaint } from "../../../testing/a11y"
import { goTo, setAddress } from "../../../testing/address"

import "../../../tokens/tokens.css"
import "./tabs.css"

/*
 * No `defineLtTabs()` here, on purpose. The file runs in its own frame, so
 * `lt-tabs` stays unregistered for the whole test, and that is the state the
 * rule in `tabs.css` is for: markup written without JavaScript, before the
 * component has had time to hide the panels itself.
 */
const BARE = `
  <lt-tabs>
    <ul class="lt-tabs__list">
      <li><a href="#claim">Claim</a></li>
      <li><a href="#attachments">Attachments</a></li>
      <li><a href="#messages">Messages</a></li>
    </ul>
    <section class="lt-tabs__panel" id="claim">Claim</section>
    <section class="lt-tabs__panel" id="attachments">Attachments <p id="in-attachments">Inside</p></section>
    <section class="lt-tabs__panel" id="messages">Messages</section>
  </lt-tabs>`

/** Tabs in tabs: `#deep` is in the inner panel `ib`, inside the outer `yb`. */
const TABS_IN_TABS = (inner = "") => `
  <lt-tabs>
    <ul class="lt-tabs__list"><li><a href="#ya">YA</a></li><li><a href="#yb">YB</a></li></ul>
    <section class="lt-tabs__panel" id="ya">Outer a</section>
    <section class="lt-tabs__panel" id="yb">Outer b
      <lt-tabs${inner}>
        <ul class="lt-tabs__list"><li><a href="#ia">IA</a></li><li><a href="#ib">IB</a></li></ul>
        <section class="lt-tabs__panel" id="ia">Inner a</section>
        <section class="lt-tabs__panel" id="ib">Inner b <p id="deep">Deep</p></section>
      </lt-tabs>
    </section>
  </lt-tabs>`

function shown(...ids: string[]): boolean[] {
  return ids.map(
    (id) =>
      getComputedStyle(document.getElementById(id) as HTMLElement).display !==
      "none",
  )
}

function displays(): string[] {
  return [...document.querySelectorAll<HTMLElement>(".lt-tabs__panel")].map(
    (panel) => getComputedStyle(panel).display,
  )
}

beforeEach(async () => {
  await setAddress("")
})

describe("tabs.css before the component is registered", () => {
  it("shows only the first panel when the server said nothing", async () => {
    expect(customElements.get("lt-tabs")).toBeUndefined()
    mount(BARE)
    await waitForPaint()

    expect(displays()).toEqual(["block", "none", "none"])
  })

  it("lets the server's hidden decide which panel is the first visible one", async () => {
    mount(BARE.replace('id="claim">Claim', 'id="claim" hidden>Claim'))
    await waitForPaint()

    expect(displays()).toEqual(["none", "block", "none"])
  })

  /*
   * When the address points at a panel, or at something in it, the CSS shows
   * that panel. That is what the component selects when it is registered
   * (requirement E1), so the content does not jump (A4). Mounted first and
   * navigated afterwards, the way the browser finds the element when the page
   * loads; see `goTo()`.
   */
  it("shows the panel the address points at", async () => {
    mount(BARE)
    await goTo("#messages")
    await waitForPaint()

    expect(displays()).toEqual(["none", "none", "block"])
  })

  it("shows the panel with what the address points at inside it", async () => {
    mount(BARE)
    await goTo("#in-attachments")
    await waitForPaint()

    expect(displays()).toEqual(["none", "block", "none"])
  })

  it("shows the panel an encoded fragment points at", async () => {
    mount(BARE.replace('id="attachments"', 'id="café-2"'))
    await goTo("#caf%C3%A9-2")
    await waitForPaint()

    expect(displays()).toEqual(["none", "block", "none"])
  })

  it("shows the first panel when the address points outside the tab list", async () => {
    mount(`<p id="other">Other</p>${BARE}`)
    await goTo("#other")
    await waitForPaint()

    expect(displays()).toEqual(["block", "none", "none"])
  })

  it("puts the server's hidden before the address", async () => {
    mount(
      BARE.replace('id="messages">', 'id="messages" hidden>').replace(
        'id="claim">',
        'id="claim" hidden>',
      ),
    )
    await goTo("#messages")
    await waitForPaint()

    expect(displays()).toEqual(["none", "block", "none"])
  })

  it("ignores the address under server-controlled, where the component does not select from it", async () => {
    mount(BARE.replace("<lt-tabs>", "<lt-tabs server-controlled>"))
    await goTo("#messages")
    await waitForPaint()

    expect(displays()).toEqual(["block", "none", "none"])
  })

  it("shows the target in tabs in tabs, in both tab lists", async () => {
    mount(TABS_IN_TABS())
    await goTo("#deep")
    await waitForPaint()

    expect(shown("ya", "yb", "ia", "ib")).toEqual([false, true, false, true])
  })

  it("shows the first panel in an inner tab list with server-controlled, and the target in the outer one", async () => {
    mount(TABS_IN_TABS(" server-controlled"))
    await goTo("#deep")
    await waitForPaint()

    expect(shown("ya", "yb", "ia", "ib")).toEqual([false, true, true, false])
  })

  it("shows the panel a link in the tab list leads to, even when the component is never registered", async () => {
    mount(BARE)
    await waitForPaint()

    await userEvent.click(
      document.querySelector('a[href="#messages"]') as HTMLElement,
    )
    await waitForPaint()

    expect(displays()).toEqual(["none", "none", "block"])
  })
})
