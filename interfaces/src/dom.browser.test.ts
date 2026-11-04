import { beforeEach, describe, expect, it } from "vitest"

import { managedNames } from "./components/css/shared"
import { lt } from "./lt"

describe("lt.setAttributes", () => {
  it("does nothing when the element is missing", () => {
    /*
     * `document.querySelector()` returns `Element | null`, and without this
     * every call site in a `strict` app would have to write a guard around a
     * lookup that almost always finds something. It must not throw, and it
     * must not do anything.
     */
    expect(() => lt.setAttributes(null, lt.button())).not.toThrow()
    expect(() => lt.setAttributes(undefined, lt.button())).not.toThrow()
  })

  let element: HTMLInputElement

  beforeEach(() => {
    document.body.innerHTML = '<input id="field" />'
    element = document.getElementById("field") as HTMLInputElement
  })

  it("applies the attributes from an lt function", () => {
    lt.setAttributes(element, lt.input({ type: "email", state: "invalid" }))

    expect(element.className).toBe("lt-input")
    expect(element.getAttribute("type")).toBe("email")
    expect(element.getAttribute("data-state")).toBe("invalid")
    expect(element.getAttribute("aria-invalid")).toBe("true")
  })

  it("clears state from the previous call", () => {
    lt.setAttributes(element, lt.input({ type: "email", state: "invalid" }))
    lt.setAttributes(element, lt.input({ type: "email" }))

    // The builder function leaves out data-state in the normal state. Without
    // the clean-up the field would have stayed red after the error was fixed.
    expect(element.hasAttribute("data-state")).toBe(false)
    expect(element.hasAttribute("aria-invalid")).toBe(false)
    expect(element.getAttribute("type")).toBe("email")
  })

  it("leaves the consumer's own attributes alone", () => {
    element.setAttribute("data-testid", "email-field")
    element.setAttribute("name", "email")

    lt.setAttributes(element, lt.input({ type: "email", state: "invalid" }))
    lt.setAttributes(element, lt.input({ type: "email" }))

    expect(element.getAttribute("data-testid")).toBe("email-field")
    expect(element.getAttribute("name")).toBe("email")
  })

  it("keeps the consumer's own classes", () => {
    element.className = "my-class lt-old"

    lt.setAttributes(element, lt.input({ type: "text" }))

    expect(element.classList.contains("my-class")).toBe(true)
    expect(element.classList.contains("lt-input")).toBe(true)
    // lt- classes belong to the system and are replaced
    expect(element.classList.contains("lt-old")).toBe(false)
  })

  it("works on a whole field together with lt.field", () => {
    document.body.innerHTML = `
      <label id="label"></label>
      <input id="control" />
      <p id="error"></p>
    `
    const field = lt.field({ id: "email", error: true, invalid: true })

    // Looked up first, since field.control sets the id on the control
    const label = document.getElementById("label") as HTMLLabelElement
    const control = document.getElementById("control") as HTMLInputElement

    lt.setAttributes(label, field.label)
    lt.setAttributes(control, lt.input({ type: "email" }), field.control)

    expect(label.getAttribute("for")).toBe("email")
    expect(control.id).toBe("email")
    expect(control.getAttribute("aria-describedby")).toBe("email-error")
    expect(control.getAttribute("aria-invalid")).toBe("true")
    expect(control.getAttribute("data-state")).toBe("invalid")
  })
})

describe("boolean attributes", () => {
  it("sets a boolean attribute as an empty string, as HTML expects", () => {
    const element = document.createElement("input")

    lt.setAttributes(element, lt.switch({ disabled: true }))

    expect(element.getAttribute("disabled")).toBe("")
    expect(element.disabled).toBe(true)
    expect(element.getAttribute("role")).toBe("switch")
  })

  it("removes the boolean attribute when it is no longer included", () => {
    const element = document.createElement("input")

    lt.setAttributes(element, lt.switch({ disabled: true }))
    lt.setAttributes(element, lt.switch())

    expect(element.hasAttribute("disabled")).toBe(false)
  })

  it("accepts the attributes from a whole field", () => {
    const element = document.createElement("input")
    const field = lt.field({ id: "email", disabled: true })

    lt.setAttributes(element, lt.input({ type: "email" }), field.control)

    expect(element.disabled).toBe(true)
    expect(element.id).toBe("email")
    expect(element.type).toBe("email")
  })
})

/** Options that give the composite builder functions something to build. */
const BASE_OPTIONS: Record<string, Record<string, unknown>> = {
  field: { id: "field", help: true, error: true },
  tabs: { id: "tabs", keys: ["a", "b"], label: "Tabs" },
  suggestion: { id: "suggestion", keys: ["a", "b"] },
  dialog: { titleId: "title" },
  popover: { id: "panel" },
  term: { id: "term-signal" },
  errorSummary: { count: 1 },
  sessionTimeout: { titleId: "session" },
}

/**
 * Every option a builder function can take, all switched on at once.
 *
 * A builder function only cares about the options it knows, so one shared
 * object is enough. The value lists, such as `variants` and `colors`, are
 * read from the function itself and added in `optionSets()`.
 */
const ALL_ON: Record<string, unknown> = {
  interactive: true,
  hoverable: true,
  selectable: true,
  disabled: true,
  multiple: true,
  accept: ".pdf",
  open: true,
  pending: true,
  invalid: true,
  optional: true,
  required: "symbol",
  help: true,
  error: true,
  label: "Name",
  placement: "top-end",
  activeIndex: 0,
  selected: 1,
  describedBy: ["other"],
  offlineText: "Down",
  onlineText: "Up",
  warnAt: 10,
  expiresAt: 20,
  value: 4,
  max: 10,
  autofocus: false,
  direction: "descending",
}

/** `lt.label({ required: "symbol" })` hangs on `label.markers`. */
const KEY: Record<string, string> = { markers: "required" }

type BuilderFunction = ((options?: unknown) => unknown) &
  Record<string, unknown>

function builderFunctions(): [string, BuilderFunction][] {
  return Object.entries(lt).filter(([name, value]) => {
    if (typeof value !== "function") return false
    return !["setAttributes", "isState", "isMarker"].includes(name)
  }) as [string, BuilderFunction][]
}

/**
 * The option sets each builder function is called with.
 *
 * One set is not enough. Some options shadow each other: `required` beats
 * `optional` on the label, and the last value in `states` is `success`,
 * which never gives `aria-invalid`. With only "all on", `data-optional` and
 * `aria-invalid` were never switched on, and a builder function that could
 * not remove them again would have passed.
 */
function optionSets(name: string, builder: BuilderFunction) {
  const lists = Object.entries(builder).filter(([, values]) =>
    Array.isArray(values),
  ) as [string, string[]][]
  const key = (list: string) => KEY[list] ?? list.replace(/s$/, "")
  const base = BASE_OPTIONS[name] ?? {}

  const sets: Record<string, unknown>[] = []
  // All on, with the last value in each list.
  const all: Record<string, unknown> = { ...ALL_ON, ...base }
  for (const [list, values] of lists) {
    all[key(list)] = values[values.length - 1]
  }
  sets.push(all)
  // Each value in each list on its own, alongside the boolean options.
  for (const [list, values] of lists) {
    for (const value of values) {
      sets.push({ ...ALL_ON, ...base, [key(list)]: value })
    }
  }
  // Without `required`, so `optional` gets through.
  sets.push({ ...all, required: undefined })
  return sets
}

/** Every attribute set in a return value, with the path to it. */
function attributeSets(
  value: unknown,
  path: string,
  out: [string, Record<string, unknown>][] = [],
) {
  if (Array.isArray(value)) {
    value.forEach((child, i) => {
      attributeSets(child, `${path}[${i}]`, out)
    })
  } else if (value && typeof value === "object") {
    const hasSets = Object.values(value).some(
      (child) => child && typeof child === "object",
    )
    if (hasSets) {
      for (const [name, child] of Object.entries(value)) {
        attributeSets(child, `${path}.${name}`, out)
      }
    } else {
      out.push([path, value as Record<string, unknown>])
    }
  }
  return out
}

describe("every set knows what it manages", () => {
  /*
   * `setAttributes` clears what the builder function manages, and it knows
   * that from `attributes()`, which notes every key it is given. The whole
   * arrangement rests on two things nobody would otherwise see break: that
   * every set goes through `attributes()`, and that every optional key is
   * passed in also when the option is off. A conditional spread,
   * `...(x ? { a } : {})`, would give an attribute that can be set and never
   * removed.
   */
  const all = builderFunctions()

  it("finds the builder functions", () => {
    expect(all.length).toBeGreaterThan(40)
  })

  it.each(all)("lt.%s() sends every set through attributes()", (name, f) => {
    const sets = attributeSets(f(BASE_OPTIONS[name] ?? {}), name)

    expect(sets.length).toBeGreaterThan(0)
    for (const [path, one] of sets) {
      expect(managedNames(one), path).toBeDefined()
    }
  })

  it.each(
    all,
  )("lt.%s() manages the same names whatever the options", (name, f) => {
    const off = new Map(attributeSets(f(BASE_OPTIONS[name] ?? {}), name))

    for (const options of optionSets(name, f)) {
      for (const [path, one] of attributeSets(f(options), name)) {
        const base = off.get(path)
        // A set that only exists when an option is on, such as the error text
        // in a field, has nothing to be compared with.
        if (!base) continue
        expect([...(managedNames(one) ?? [])].sort(), path).toEqual(
          [...(managedNames(base) ?? [])].sort(),
        )
      }
    }
  })

  /** The names that count, apart from the class and those never removed. */
  const counts = (n: string) => n !== "class" && n !== "id" && n !== "for"

  function namesOn(element: Element): string[] {
    return [...element.attributes]
      .map((a) => a.name)
      .filter(counts)
      .sort()
  }

  function namesIn(set: Record<string, unknown>): string[] {
    return Object.keys(set).filter(counts).sort()
  }

  it.each(
    all,
  )("lt.%s() can move between every option set and the base set, both ways", (name, f) => {
    type AttributeSet = Parameters<typeof lt.setAttributes>[1]
    const off = new Map(attributeSets(f(BASE_OPTIONS[name] ?? {}), name))
    let checked = 0

    for (const options of optionSets(name, f)) {
      for (const [path, on] of attributeSets(f(options), name)) {
        const base = off.get(path)
        if (!base) continue

        // From the options and back: everything the options set must go.
        const down = document.createElement("div")
        lt.setAttributes(down, on as AttributeSet)
        lt.setAttributes(down, base as AttributeSet)
        expect(namesOn(down), `${path}, back to the base set`).toEqual(
          namesIn(base),
        )

        // And the other way: what the base set had and the options do not,
        // such as `hidden` on an error text, must also go.
        const up = document.createElement("div")
        lt.setAttributes(up, base as AttributeSet)
        lt.setAttributes(up, on as AttributeSet)
        expect(namesOn(up), `${path}, from the base set`).toEqual(namesIn(on))
        checked++
      }
    }

    expect(checked).toBeGreaterThan(0)
  })
})

describe("setAttributes leaves alone what the builder function does not manage", () => {
  /** The element already has the attributes, and loses none of them. */
  const CASES: [string, Record<string, string>, () => unknown][] = [
    [
      "a disabled button and lt.button()",
      { type: "submit", disabled: "" },
      () => lt.button({ variant: "secondary" }),
    ],
    [
      "a disabled field with help text and lt.input()",
      { disabled: "", "aria-describedby": "help", name: "email" },
      () => lt.input({ state: "invalid" }),
    ],
    [
      "an open details and lt.accordion()",
      { open: "" },
      () => lt.accordion({ variant: "plain" }),
    ],
    [
      "a hidden paragraph and lt.helpText()",
      { hidden: "" },
      () => lt.helpText({ variant: "warning" }),
    ],
    ["a disabled select and lt.select()", { disabled: "" }, () => lt.select()],
    [
      "a textarea connected to a counter and lt.textarea()",
      { "aria-describedby": "counter" },
      () => lt.textarea(),
    ],
    [
      "a disabled checkbox and lt.checkbox()",
      { disabled: "", "aria-describedby": "error" },
      () => lt.checkbox({ state: "invalid" }),
    ],
  ]

  it.each(CASES)("%s", (_name, before, set) => {
    const element = document.createElement("div")
    for (const [name, value] of Object.entries(before)) {
      element.setAttribute(name, value)
    }

    lt.setAttributes(element, set() as Parameters<typeof lt.setAttributes>[1])

    for (const name of Object.keys(before)) {
      expect(element.hasAttribute(name), name).toBe(true)
    }
  })

  it("still clears what the builder function itself manages", () => {
    const toggle = document.createElement("input")
    lt.setAttributes(toggle, lt.switch({ disabled: true }))
    expect(toggle.hasAttribute("disabled")).toBe(true)
    lt.setAttributes(toggle, lt.switch())
    expect(toggle.hasAttribute("disabled"), "the switch").toBe(false)

    const fileField = document.createElement("input")
    lt.setAttributes(
      fileField,
      lt.fileUpload({ multiple: true, accept: ".pdf" }),
    )
    lt.setAttributes(fileField, lt.fileUpload())
    expect(fileField.hasAttribute("multiple"), "multiple").toBe(false)
    expect(fileField.hasAttribute("accept"), "accept").toBe(false)

    const link = document.createElement("a")
    lt.setAttributes(link, lt.link({ disabled: true }))
    lt.setAttributes(link, lt.link())
    expect(link.hasAttribute("aria-disabled"), "the link").toBe(false)
  })

  it("leaves data attributes another set manages alone", () => {
    // The shared list of `data-*` also applied to sets straight from a
    // builder function, and the trigger of a popover turned a secondary
    // button primary.
    const button = document.createElement("button")
    lt.setAttributes(button, lt.button({ variant: "secondary" }))
    lt.setAttributes(button, lt.popover({ id: "p" }).trigger)
    expect(button.getAttribute("data-variant")).toBe("secondary")

    const date = document.createElement("input")
    lt.setAttributes(date, lt.input({ type: "date", state: "success" }))
    lt.setAttributes(date, lt.field({ id: "d", help: true }).help)
    expect(date.getAttribute("data-variant")).toBe("date")
    expect(date.getAttribute("data-state")).toBe("success")
  })

  it("never removes id, not even when the builder function has an option for it", () => {
    const box = document.createElement("lt-error-summary")
    box.id = "form-errors"

    lt.setAttributes(box, lt.errorSummary({ count: 2 }).host)

    expect(box.id).toBe("form-errors")
  })

  it("lets the builder function decide the attributes it has an option for", () => {
    // `lt.spinner()` has `label`. If you wrote `aria-label` by hand and call
    // without the option, the builder function's word is what counts.
    const ring = document.createElement("span")
    lt.setAttributes(ring, lt.spinner({ label: "Loading" }))
    expect(ring.getAttribute("role")).toBe("status")

    lt.setAttributes(ring, lt.spinner())

    expect(ring.hasAttribute("role")).toBe(false)
    expect(ring.hasAttribute("aria-label")).toBe(false)
  })

  it("hides and shows the error summary by the count", () => {
    const box = document.createElement("lt-error-summary")
    lt.setAttributes(box, lt.errorSummary({ count: 0 }).host)
    expect(box.hasAttribute("hidden")).toBe(true)

    lt.setAttributes(box, lt.errorSummary({ count: 2 }).host)
    expect(box.hasAttribute("hidden")).toBe(false)
  })

  it("does nothing without a set", () => {
    const field = document.createElement("input")
    field.setAttribute("data-state", "invalid")

    lt.setAttributes(field)

    expect(field.getAttribute("data-state")).toBe("invalid")
  })

  it("lets a hand-written set remove an attribute with false, not with undefined", () => {
    const field = document.createElement("input")
    lt.setAttributes(field, lt.input({ state: "invalid" }), {
      "aria-invalid": undefined,
    })
    expect(
      field.getAttribute("aria-invalid"),
      "undefined does not override",
    ).toBe("true")

    lt.setAttributes(field, lt.input({ state: "invalid" }), {
      "aria-invalid": false,
    })
    expect(field.hasAttribute("aria-invalid"), "false removes").toBe(false)
  })

  it("clears the data attributes the server wrote, when the set manages them", () => {
    // The server wrote the state, and the browser must be able to remove it.
    const field = document.createElement("input")
    field.setAttribute("data-state", "invalid")

    lt.setAttributes(field, lt.input())

    expect(field.hasAttribute("data-state")).toBe(false)
  })
})

describe("setAttributes with several sets", () => {
  it("sets both, and clears what both manage", () => {
    const control = document.createElement("input")
    const invalid = lt.field({ id: "email", error: true, invalid: true })
    lt.setAttributes(control, lt.input({ type: "email" }), invalid.control)
    expect(control.getAttribute("aria-invalid")).toBe("true")
    expect(control.className).toBe("lt-input")
    expect(control.id).toBe("email")

    const valid = lt.field({ id: "email", error: true })
    lt.setAttributes(control, lt.input({ type: "email" }), valid.control)

    expect(control.hasAttribute("aria-invalid")).toBe(false)
    expect(control.hasAttribute("aria-describedby")).toBe(false)
    expect(control.id).toBe("email")
  })

  it("warns once about a spread set, and clears only the data attributes", async () => {
    /*
     * The warning comes once per page, and the flag lives in the module. A
     * fresh copy of the module, loaded with a query string, has its own flag.
     * Without that another test in the file used up the warning, and this one
     * stayed green even if `console.warn` was removed entirely.
     */
    // @ts-expect-error The query string is Vite's, and gives a fresh module.
    const fresh = (await import("./dom?warning")) as typeof import("./dom")
    const warnings: string[] = []
    const real = console.warn
    console.warn = (message: unknown) => {
      warnings.push(String(message))
    }
    try {
      const control = document.createElement("input")
      control.setAttribute("disabled", "")

      fresh.setAttributes(control, { ...lt.input({ state: "invalid" }) })
      fresh.setAttributes(control, { ...lt.input() })

      expect(control.hasAttribute("data-state"), "data-state").toBe(false)
      expect(control.hasAttribute("disabled"), "disabled").toBe(true)
      expect(
        warnings.filter((a) => a.includes("lt.setAttributes()")),
      ).toHaveLength(1)
    } finally {
      console.warn = real
    }
  })

  it("does not warn about a set straight from a builder function", async () => {
    // @ts-expect-error The query string is Vite's, and gives a fresh module.
    const fresh = (await import("./dom?silent")) as typeof import("./dom")
    const warnings: string[] = []
    const real = console.warn
    console.warn = (message: unknown) => {
      warnings.push(String(message))
    }
    try {
      const control = document.createElement("input")
      fresh.setAttributes(control, lt.input(), lt.field({ id: "a" }).control)
      expect(warnings).toEqual([])
    } finally {
      console.warn = real
    }
  })
})

/**
 * `open` comes from `lt.dialog()`, but the sweep over the builder functions
 * skips it, since it requires an options object. If `lt.dialog()` did not
 * manage `open`, `setAttributes` could open a dialog but never close it
 * again, and that is exactly the bug `data-size` had.
 */
describe("setAttributes and the dialog", () => {
  it("can both set and remove open on the host", () => {
    const host = document.createElement("lt-dialog")

    lt.setAttributes(host, lt.dialog({ titleId: "t", open: true }).host)
    expect(host.hasAttribute("open")).toBe(true)

    lt.setAttributes(host, lt.dialog({ titleId: "t" }).host)
    expect(host.hasAttribute("open")).toBe(false)
  })
})

describe("setAttributes and the boolean options", () => {
  it("removes the boolean options on card, table and tag", () => {
    const card = document.createElement("a")
    lt.setAttributes(card, lt.card({ interactive: true }))
    lt.setAttributes(card, lt.card())
    expect(card.hasAttribute("data-interactive")).toBe(false)

    const table = document.createElement("table")
    lt.setAttributes(table, lt.table({ hoverable: true }))
    lt.setAttributes(table, lt.table())
    expect(table.hasAttribute("data-hoverable")).toBe(false)

    const tag = document.createElement("span")
    lt.setAttributes(tag, lt.tag({ selectable: true }))
    lt.setAttributes(tag, lt.tag())
    expect(tag.hasAttribute("data-selectable")).toBe(false)
  })

  it("leaves id, name and role alone when two different sets are used one after the other", () => {
    // The label's `for` points to the id. Had the second call cleared it,
    // the wiring would have been broken without a word. The same applies to
    // the role a suggestion field has been given.
    const control = document.createElement("input")
    const field = lt.field({ id: "email" })
    lt.setAttributes(control, {
      ...lt.input(),
      ...field.control,
      name: "email",
    })

    lt.setAttributes(control, lt.input({ state: "invalid" }))

    expect(control.id).toBe("email")
    expect(control.getAttribute("name")).toBe("email")

    const search = document.createElement("input")
    lt.setAttributes(
      search,
      lt.suggestion({ id: "city", keys: ["a", "b", "c"] }).control,
    )
    lt.setAttributes(search, lt.input({ state: "invalid" }))
    expect(search.getAttribute("role")).toBe("combobox")
  })

  it("leaves type alone on a button", () => {
    // `type` was in the list of what gets cleared, and `lt.button()` never
    // writes it: the button lost `type="submit"` without a word.
    const button = document.createElement("button")
    button.setAttribute("type", "submit")

    lt.setAttributes(button, lt.button({ variant: "secondary" }))

    expect(button.getAttribute("type")).toBe("submit")
  })

  it("removes placement when the popover goes back to the default", () => {
    const host = document.createElement("lt-popover")
    lt.setAttributes(host, lt.popover({ id: "p", placement: "top-end" }).host)
    expect(host.getAttribute("placement")).toBe("top-end")

    lt.setAttributes(host, lt.popover({ id: "p" }).host)

    expect(host.hasAttribute("placement")).toBe(false)
  })
})
