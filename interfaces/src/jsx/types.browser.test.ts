import type { JSX } from "react"
import { describe, expect, it } from "vitest"

import { lt } from "../react"

import "./react"

/**
 * That what the builder functions emit fits the package's own JSX declarations.
 *
 * Both are public API, and they can drift apart without anything saying so.
 * `lt.popover().host` gave `open: ""`, while the declaration said
 * `open?: true | undefined`. In that case the builder function was wrong:
 * React 19 sets the property, and `el.open = ""` is false, so the panel did
 * not open. Both now emit `true`.
 *
 * The assignments below are the test, and `typecheck:tests` is what runs it.
 * What runs in the browser only checks that the values are actually there.
 */
describe("the builder functions fit the JSX declarations", () => {
  it("the popover's host", () => {
    const host: JSX.IntrinsicElements["lt-popover"] = lt.popover({
      id: "h",
      open: true,
    }).host

    expect(host.open).toBe(true)
  })

  it("the dialog's host", () => {
    const host: JSX.IntrinsicElements["lt-dialog"] = lt.dialog({
      titleId: "t",
      open: true,
    }).host

    expect(host.open).toBe(true)
  })

  /**
   * `hidden` is `boolean` in `HTMLAttributes`, and `hidden={false}` compiled
   * on `<lt-error-summary>`. React 18 writes it as `hidden="false"`, which is
   * true, so the box was always hidden. The declaration now says `Flag`, as
   * for `open`, and the builder function emits `true` or nothing.
   */
  it("the error summary's host, where hidden is a flag", () => {
    const empty: JSX.IntrinsicElements["lt-error-summary"] = lt.errorSummary({
      count: 0,
    }).host
    const withErrors: JSX.IntrinsicElements["lt-error-summary"] =
      lt.errorSummary({
        count: 2,
      }).host
    const hidden: JSX.IntrinsicElements["lt-error-summary"] = {
      // @ts-expect-error `false` becomes `hidden="false"` in React 18, which is true.
      hidden: false,
    }

    expect(empty.hidden).toBe(true)
    expect(withErrors.hidden).toBeUndefined()
    expect(hidden.hidden).toBe(false)
  })

  /**
   * That `server-controlled` is declared on every component that has it.
   *
   * The guard in `react.browser.test.ts` reads the source as text, and it
   * cannot see this: the name is in the shared `ServerControlled` type, so
   * the regex matches whether or not a component actually uses it. The
   * assignments here go through TypeScript, and a component that loses the
   * alias becomes a compile error in `typecheck:tests`.
   */
  it("the four components that let the server decide the state", () => {
    const tabs: JSX.IntrinsicElements["lt-tabs"] = {
      "server-controlled": true,
    }
    const popover: JSX.IntrinsicElements["lt-popover"] = {
      "server-controlled": true,
    }
    const suggestion: JSX.IntrinsicElements["lt-suggestion"] = {
      "server-controlled": true,
    }
    const dialog: JSX.IntrinsicElements["lt-dialog"] = {
      "server-controlled": true,
    }

    for (const el of [tabs, popover, suggestion, dialog]) {
      expect(el["server-controlled"]).toBe(true)
    }
  })

  /**
   * The tabs from the React entry point are links with `tabIndex` as a
   * number, and the list item and the panel must fit their elements.
   * `tabindex: "0"` as a string did not compile in a React app, and the type
   * alone was what said so.
   */
  it("the tabs, which are links with tabIndex", () => {
    const tabs = lt.tabs({ id: "file", keys: ["a", "b"], label: "The claim" })
    const [first] = tabs.tabs
    const tab: JSX.IntrinsicElements["a"] = first ?? {}
    const item: JSX.IntrinsicElements["li"] = tabs.item
    const panel: JSX.IntrinsicElements["section"] = tabs.panels[0] ?? {}

    expect(tab.tabIndex).toBe(0)
    expect(item.role).toBe("presentation")
    expect(panel.tabIndex).toBe(0)
  })
})
