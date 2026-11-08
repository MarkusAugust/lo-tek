import { describe, expect, expectTypeOf, it } from "vitest"
import type { Attributes } from "./dom"
import { lt } from "./lt"
import { lt as ltReact, type ReactSet } from "./react"

describe("lt from /react", () => {
  it("gives className instead of class", () => {
    expect(ltReact.button({ variant: "danger" })).toEqual({
      className: "lt-button",
      "data-variant": "danger",
    })
  })

  it("gives htmlFor instead of for on the label", () => {
    const field = ltReact.field({ id: "email" })

    expect(field.label).toEqual({ className: "lt-label", htmlFor: "email" })
  })

  it("leaves data attributes and aria untouched", () => {
    expect(ltReact.input({ type: "date", state: "invalid" })).toEqual({
      className: "lt-input",
      type: "date",
      "data-variant": "date",
      "data-state": "invalid",
      "aria-invalid": "true",
    })
  })

  it("keeps the allowed values and the guards from the function", () => {
    expect(ltReact.button.variants).toEqual(lt.button.variants)
    expect(ltReact.button.isVariant("ghost")).toBe(true)
    expect(ltReact.badge.isColor("neutral")).toBe(true)
    expect(ltReact.input.isType("date")).toBe(true)
  })

  it("gives the same wiring as lt.field for everything that need not be renamed", () => {
    const plain = lt.field({
      id: "email",
      help: true,
      error: true,
      invalid: true,
    })
    const forReact = ltReact.field({
      id: "email",
      help: true,
      error: true,
      invalid: true,
    })

    expect(forReact.control).toEqual(plain.control)
    expect(forReact.help).toEqual(plain.help)
    expect(forReact.error).toEqual(plain.error)
    expect(forReact.state).toBe(plain.state)
  })

  /**
   * Attributes React spells differently from HTML.
   *
   * The list is taken from React's own table of DOM properties, and is longer
   * than the four we actually rename. That is the point: a builder function
   * that one day emits `readonly` or `maxlength` must stop here, not in a
   * consumer's console.
   */
  const SPELLED_DIFFERENTLY = [
    "accesskey",
    "autocapitalize",
    "autocomplete",
    "autofocus",
    "class",
    "colspan",
    "contenteditable",
    "crossorigin",
    "datetime",
    "enctype",
    "for",
    "formaction",
    "formnovalidate",
    "inputmode",
    "maxlength",
    "minlength",
    "novalidate",
    "readonly",
    "rowspan",
    "spellcheck",
    "srcset",
    "tabindex",
    "usemap",
  ]

  /** Every attribute name in a result, including those in lists and nested levels. */
  function allKeys(value: unknown, collected = new Set<string>()): Set<string> {
    if (Array.isArray(value)) {
      for (const part of value) allKeys(part, collected)
    } else if (value && typeof value === "object") {
      for (const [name, child] of Object.entries(value)) {
        collected.add(name)
        allKeys(child, collected)
      }
    }
    return collected
  }

  /**
   * Every call we can put together from the builder function's own
   * information.
   *
   * The call without arguments alone is not enough: `class` comes from each
   * of them, but `for` only comes when the field has an id, and `tabindex`
   * only when the tabs get a count. The allowed values hang on the function,
   * so they can be read without a hand-written list.
   */
  function optionSets(
    builder: (options?: Record<string, unknown>) => unknown,
  ): Record<string, unknown>[] {
    /*
     * The smallest call is included because most builder functions must work
     * without arguments. `id` is sent anyway, since the builder functions that
     * take an id require it: without it the guard would have tried a call that
     * is not allowed, and got a warning in the console as well.
     */
    // `label` because `lt.tabs()` requires a name for the tab list and throws without one.
    const extra: Record<string, unknown>[] = [
      { id: "job" },
      {
        id: "job",
        count: 2,
        keys: ["a", "b"],
        label: "Parts",
        help: true,
        error: true,
        invalid: true,
      },
    ]
    const holder = builder as unknown as Record<string, unknown>
    for (const [name, values] of Object.entries(holder)) {
      if (!name.endsWith("s") || !Array.isArray(values)) continue
      const option =
        { markers: "required", types: "type" }[name] ?? name.slice(0, -1)
      for (const value of values)
        extra.push({
          [option]: value,
          id: "job",
          count: 2,
          keys: ["a", "b"],
          label: "Parts",
        })
    }

    // Every id given, so no builder function makes a random one, and two
    // calls with the same options give the same result.
    return extra.map((options) => ({ titleId: "job-title", ...options }))
  }

  function calls(
    builder: (options?: Record<string, unknown>) => unknown,
  ): unknown[] {
    const results: unknown[] = []
    for (const options of optionSets(builder)) {
      try {
        results.push(builder(options))
      } catch {
        // A builder function that rejects the combination says nothing about names.
      }
    }
    return results
  }

  /** `setAttributes` takes an element and writes on it, and builds nothing. */
  const NOT_BUILDER_FUNCTIONS = ["setAttributes"]

  const builders = Object.entries(ltReact).filter(
    ([name, value]) =>
      typeof value === "function" && !NOT_BUILDER_FUNCTIONS.includes(name),
  ) as [string, (options?: Record<string, unknown>) => unknown][]

  it("covers every builder function in /react", () => {
    // Without this the guard below can become empty without a word.
    expect(builders.length).toBeGreaterThan(30)
    for (const [name, builder] of builders) {
      expect(calls(builder).length, `${name}() never answered`).toBeGreaterThan(
        0,
      )
    }
  })

  it("has no keys React would complain about", () => {
    for (const [name, builder] of builders) {
      for (const result of calls(builder)) {
        for (const key of allKeys(result)) {
          expect(SPELLED_DIFFERENTLY, `${name}() gives "${key}"`).not.toContain(
            key,
          )
        }
      }
    }
  })

  /**
   * The main entry's result with the React names, all the way down. A set
   * is told here by its shape, and in `react.ts` by what `attributes()`
   * notes on it, so the two can disagree and the test can fail. What
   * `/react` promises for every builder function but the two that give the
   * whole state, so React hydrates without mismatches.
   */
  function renamed(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(renamed)
    if (!value || typeof value !== "object") return value
    const entries = Object.entries(value)
    const flat = entries.every(
      ([, child]) => !child || typeof child !== "object",
    )
    if (!flat)
      return Object.fromEntries(
        entries.map(([k, child]) => [k, renamed(child)]),
      )
    return Object.fromEntries(
      entries.map(([k, child]) => [
        {
          class: "className",
          for: "htmlFor",
          tabindex: "tabIndex",
          autocomplete: "autoComplete",
        }[k] ?? k,
        k === "tabindex" ? Number(child) : child,
      ]),
    )
  }
  const WHOLE_STATE = ["tabs", "term"]

  it("gives the main entry's result with React's names, for every builder function", () => {
    const main = lt as unknown as Record<string, (o?: unknown) => unknown>
    let compared = 0
    for (const [name, builder] of builders) {
      if (WHOLE_STATE.includes(name)) continue
      for (const options of optionSets(builder)) {
        let expected: unknown
        try {
          expected = main[name](options)
        } catch {
          // What the main entry refuses, /react refuses too.
          expect(() => builder(options), `${name}()`).toThrow()
          continue
        }
        // The guards answer a boolean and build nothing.
        if (typeof expected !== "object") continue
        expect(builder(options), `${name}()`).toEqual(renamed(expected))
        compared++
      }
    }
    expect(compared).toBeGreaterThan(100)
  })

  it("gives the guards and the lists as the same values as the main entry", () => {
    expect([
      ltReact.isState === lt.isState,
      ltReact.isMarker === lt.isMarker,
      ltReact.states === lt.states,
      ltReact.markers === lt.markers,
    ]).toEqual([true, true, true, true])
  })

  it("keeps what hangs on every builder function", () => {
    const main = lt as unknown as Record<string, Record<string, unknown>>
    const react = ltReact as unknown as Record<string, Record<string, unknown>>
    for (const [name] of builders) {
      expect(Object.keys(react[name]).sort(), name).toEqual(
        Object.keys(main[name]).sort(),
      )
      for (const key of Object.keys(main[name]))
        expect(react[name][key], `${name}.${key}`).toBe(main[name][key])
    }
  })

  it("has exactly the same builder functions as the main entry", () => {
    // `react.ts` goes over `lt`, and adds the two with the whole state.
    // The check goes both ways: a function that only exists in one is just
    // as wrong whichever of them it is.
    expect(Object.keys(ltReact).sort()).toEqual(Object.keys(lt).sort())
  })
})

describe("the types a React app sees", () => {
  // Checked by `typecheck:tests`: the entry is derived from `lt` by a mapped
  // type, and a type that widened to `unknown` would still run.
  it("keeps the option types, the names, the lists and the guards", () => {
    expectTypeOf(
      ltReact.button({ variant: "secondary" }).className,
    ).toEqualTypeOf<"lt-button">()
    expectTypeOf(ltReact.button)
      .parameter(0)
      .toEqualTypeOf<Parameters<typeof lt.button>[0]>()
    expectTypeOf(ltReact.button.variants).toEqualTypeOf(lt.button.variants)
    expectTypeOf(
      ltReact.field({ id: "f" }).label.htmlFor,
    ).toEqualTypeOf<string>()
    expectTypeOf(ltReact.field({ id: "f" }).state).toEqualTypeOf(
      lt.field({ id: "f" }).state,
    )
    expectTypeOf(
      ltReact.tabs({ id: "f", keys: ["a"], label: "L" }).tabs[0].tabIndex,
    ).toEqualTypeOf<number>()
    expectTypeOf(ltReact.dialog.colors).toEqualTypeOf(lt.dialog.colors)
    expectTypeOf(ltReact.dialog({ titleId: "t" }).title.className).toBeString()
    expectTypeOf(ltReact.tableSort.isDirection).toEqualTypeOf(
      lt.tableSort.isDirection,
    )
    expectTypeOf(ltReact.isState).toEqualTypeOf(lt.isState)
    expectTypeOf(ltReact.isMarker).toEqualTypeOf(lt.isMarker)
    expectTypeOf(ltReact.button.isVariant).toEqualTypeOf(lt.button.isVariant)
    expectTypeOf(ltReact.suggestion({ id: "s" }).options).toBeArray()
    expectTypeOf(ltReact.breadcrumbs).parameters.toEqualTypeOf<[]>()
  })
})

/**
 * `tabindex` is not just a different name.
 *
 * In HTML the value is a string, in React `tabIndex` is a number. Had we left
 * the string, `lt.tabs()` came out with `tabIndex: "0"`, and TypeScript
 * rejected it in every React app. It worked in the browser, since React
 * converts the value itself, so the bug only showed as a type error for the
 * consumer. It was found in a real React app, not here.
 */
describe("tabIndex comes out as a number", () => {
  it("on the error summary", () => {
    expect(typeof ltReact.errorSummary({ count: 1 }).host.tabIndex).toBe(
      "number",
    )
  })
})

/**
 * `setAttributes` from here gets sets with the React names, and must
 * translate them back. Passed straight to the main entry's function,
 * `className` became the attribute `classname` and `htmlFor` became
 * `htmlfor`, and the new object from the renaming was not in the map of what
 * the set manages, so `aria-invalid` stayed after the field was fixed. Found
 * with a fake element in a script, not in an app, but a `ref` in React is
 * exactly an element to call it on.
 */
describe("lt.setAttributes from /react", () => {
  it("writes class and for, not className and htmlFor", () => {
    const label = document.createElement("label")

    ltReact.setAttributes(
      label,
      ltReact.label(),
      ltReact.field({ id: "email" }).label,
    )

    expect(label.getAttribute("class")).toBe("lt-label")
    expect(label.getAttribute("for")).toBe("email")
    expect(label.hasAttribute("classname")).toBe(false)
    expect(label.hasAttribute("htmlfor")).toBe(false)
  })

  it("clears what the builder function manages, as the main entry does", () => {
    const field = document.createElement("input")

    ltReact.setAttributes(field, ltReact.input({ state: "invalid" }))
    expect(field.getAttribute("aria-invalid")).toBe("true")
    expect(field.getAttribute("data-state")).toBe("invalid")

    ltReact.setAttributes(field, ltReact.input())
    expect(field.hasAttribute("aria-invalid")).toBe(false)
    expect(field.hasAttribute("data-state")).toBe(false)
    expect(field.className).toBe("lt-input")
  })

  it("writes tabIndex as tabindex", () => {
    const box = document.createElement("div")
    const { host } = ltReact.errorSummary({ count: 1 })

    ltReact.setAttributes(box, host)

    expect(box.getAttribute("tabindex")).toBe(String(host.tabIndex))
  })

  it("gives the same element as the main entry", () => {
    const pairs: [Attributes, ReactSet][] = [
      [lt.button({ variant: "danger" }), ltReact.button({ variant: "danger" })],
      [
        lt.input({ type: "date", state: "invalid" }),
        ltReact.input({ type: "date", state: "invalid" }),
      ],
      [lt.field({ id: "a" }).label, ltReact.field({ id: "a" }).label],
      [
        lt.errorSummary({ count: 1 }).host,
        ltReact.errorSummary({ count: 1 }).host,
      ],
      [lt.suggestion({ id: "s" }).list, ltReact.suggestion({ id: "s" }).list],
    ]
    for (const [plain, forReact] of pairs) {
      const a = document.createElement("div")
      const b = document.createElement("div")
      lt.setAttributes(a, plain)
      ltReact.setAttributes(b, forReact)
      expect(b.outerHTML).toBe(a.outerHTML)
    }
  })
})
