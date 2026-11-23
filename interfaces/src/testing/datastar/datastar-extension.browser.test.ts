/**
 * That the vendored Datastar can be extended the way the theme builder on
 * the documentation site extends it.
 *
 * The builder is written with Datastar, and the one thing Datastar cannot
 * do for it is build the theme, which the core does. So a small module
 * registers an action with the `action` the bundle exports, and the page
 * calls it from an expression like any action of Datastar's own. That is
 * the mechanism of Datastar's "custom plugin" example, and nothing promises
 * it stays: `action` and `mergePatch` are exports of a bundle, not a
 * documented interface.
 *
 * When the bundle in this folder is replaced by a newer one and any of this
 * has changed, this is the test that says so, by name, rather than a theme
 * builder that shows nothing.
 */
import { beforeAll, describe, expect, it } from "vitest"

import { mount } from "../a11y"

/** What the builder takes from the bundle. */
type Datastar = {
  action(plugin: {
    name: string
    apply(context: unknown, ...args: unknown[]): unknown
  }): void
  mergePatch(patch: Record<string, unknown>): void
}

// By address, as a page loads it. The bundle has no types to import it by.
const BUNDLE = "/src/testing/datastar/datastar-v1.0.4.js"

/** What the action was called with, call by call. */
const calls: unknown[][] = []
let datastar: Datastar

/** Datastar applies attributes from a MutationObserver, and effects after it. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 50))

beforeAll(async () => {
  datastar = (await import(/* @vite-ignore */ BUNDLE)) as Datastar
  datastar.action({
    name: "lotekTestDouble",
    apply(_context, ...args) {
      // A copy: the signal handed over may be Datastar's own object.
      calls.push(JSON.parse(JSON.stringify(args)))
      return { doubled: Number(args[0]) * 2 }
    },
  })
})

describe("the vendored Datastar, extended", () => {
  it("exports what the builder registers its actions and sets its signals with", () => {
    expect(typeof datastar.action).toBe("function")
    expect(typeof datastar.mergePatch).toBe("function")
  })

  it("calls a registered action from a data-effect, with what the expression passes, and takes what it returns", async () => {
    calls.length = 0
    mount(`
      <div data-signals="{count: 21, recipe: {accent: '#7c3aed'}, answer: {doubled: 0}}"
           data-effect="$answer = @lotekTestDouble($count, $recipe)"></div>
      <output id="answer" data-text="$answer.doubled"></output>
    `)
    await settled()

    expect(calls[calls.length - 1]).toEqual([21, { accent: "#7c3aed" }])
    expect(document.getElementById("answer")?.textContent).toBe("42")
  })

  it("runs the effect again when a nested value of a signal it passed changes, set from outside with mergePatch", async () => {
    calls.length = 0
    mount(`
      <div data-signals="{count: 1, recipe: {accent: '#7c3aed'}, answer: {doubled: 0}}"
           data-effect="$answer = @lotekTestDouble($count, $recipe)"></div>
      <output id="answer" data-text="$answer.doubled"></output>
      <input id="accent" data-bind:recipe.accent>
    `)
    await settled()
    const before = calls.length
    expect(before).toBeGreaterThan(0)

    datastar.mergePatch({ recipe: { accent: "#f7df1e" }, count: 4 })
    await settled()

    expect(calls.length).toBeGreaterThan(before)
    expect(calls[calls.length - 1]).toEqual([4, { accent: "#f7df1e" }])
    expect(document.getElementById("answer")?.textContent).toBe("8")
    // And the page sees the value that was set from outside.
    expect(
      (document.getElementById("accent") as HTMLInputElement).value,
    ).toBe("#f7df1e")
  })

  it("binds a field to a nested signal, so typing reaches the action", async () => {
    calls.length = 0
    mount(`
      <div data-signals="{count: 1, recipe: {accent: ''}, answer: {doubled: 0}}"
           data-effect="$answer = @lotekTestDouble($count, $recipe)"></div>
      <input id="accent" data-bind:recipe.accent>
    `)
    await settled()

    const field = document.getElementById("accent") as HTMLInputElement
    field.value = "#0f766e"
    field.dispatchEvent(new Event("input", { bubbles: true }))
    await settled()

    expect(calls[calls.length - 1]).toEqual([1, { accent: "#0f766e" }])
  })
})
