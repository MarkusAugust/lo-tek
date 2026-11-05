import { describe, expect, it, vi } from "vitest"

import { lt } from "./lt"

describe("lt: the shared shape", () => {
  it("gives every component the same shape: an options object in, attributes out", () => {
    expect(lt.button()).toEqual({ class: "lt-button" })
    expect(lt.badge()).toEqual({ class: "lt-badge" })
    expect(lt.link()).toEqual({ class: "lt-link" })
    expect(lt.label()).toEqual({ class: "lt-label" })
    expect(lt.textarea()).toEqual({ class: "lt-textarea" })
    expect(lt.select()).toEqual({ class: "lt-select" })
    expect(lt.helpText()).toEqual({ class: "lt-help-text" })
    expect(lt.errorText()).toEqual({ class: "lt-error-text" })
  })

  it("omits the attribute when the value is the default", () => {
    expect(lt.button({ variant: "primary" })).toEqual({ class: "lt-button" })
    expect(lt.button({ variant: "danger" })).toEqual({
      class: "lt-button",
      "data-variant": "danger",
    })
  })

  it("exposes the allowed values and a guard on every component", () => {
    expect(lt.button.variants).toContain("ghost")
    expect(lt.button.isVariant("ghost")).toBe(true)
    expect(lt.button.isVariant("gost")).toBe(false)

    expect(lt.badge.colors).toContain("neutral")
    expect(lt.badge.isColor("neutral")).toBe(true)
  })
})

describe("lt.input", () => {
  it("sets the type and the icon variant from the same value", () => {
    // The most common mistake in hand-written markup is that data-variant
    // and type fall out of step. Here it is impossible.
    expect(lt.input({ type: "date" })).toEqual({
      class: "lt-input",
      type: "date",
      "data-variant": "date",
    })
  })

  it("gives no icon variant to types without an icon", () => {
    expect(lt.input({ type: "email" })).toEqual({
      class: "lt-input",
      type: "email",
    })
  })

  it("sets aria-invalid together with data-state", () => {
    expect(lt.input({ state: "invalid" })).toEqual({
      class: "lt-input",
      type: "text",
      "data-state": "invalid",
      "aria-invalid": "true",
    })

    expect(lt.input({ state: "success" })).toEqual({
      class: "lt-input",
      type: "text",
      "data-state": "success",
    })
  })

  it("shares the state type with textarea and select", () => {
    const state = lt.isState("invalid") ? "invalid" : "default"
    expect(lt.input({ state })["data-state"]).toBe("invalid")
    expect(lt.textarea({ state })["data-state"]).toBe("invalid")
    expect(lt.select({ state })["data-state"]).toBe("invalid")
  })
})

describe("lt.label", () => {
  it("lets required win over optional, so only one marker shows", () => {
    expect(lt.label({ required: "text", optional: true })).toEqual({
      class: "lt-label",
      "data-required": "text",
    })
  })
})

describe("lt.field", () => {
  it("wires the label and the control", () => {
    const field = lt.field({ id: "email" })

    expect(field.label.for).toBe("email")
    expect(field.control.id).toBe("email")
  })

  it("includes the help text in aria-describedby", () => {
    const field = lt.field({ id: "email", help: true })

    expect(field.control["aria-describedby"]).toBe("email-help")
    expect(field.help.id).toBe("email-help")
  })

  it("includes the error text only when the field is invalid", () => {
    const valid = lt.field({ id: "email", help: true, error: true })
    const invalid = lt.field({
      id: "email",
      help: true,
      error: true,
      invalid: true,
    })

    // A hidden error text must not be in aria-describedby. The screen reader
    // would then point to something that is not on the screen.
    expect(valid.control["aria-describedby"]).toBe("email-help")
    expect(valid.error.hidden).toBe(true)
    expect(valid.control["aria-invalid"]).toBeUndefined()

    expect(invalid.control["aria-describedby"]).toBe("email-help email-error")
    expect(invalid.error.hidden).toBeUndefined()
    expect(invalid.control["aria-invalid"]).toBe("true")
  })

  it("gives a state that can be passed straight into input()", () => {
    const field = lt.field({ id: "email", invalid: true })

    expect(lt.input({ type: "email", state: field.state })).toEqual({
      class: "lt-input",
      type: "email",
      "data-state": "invalid",
      "aria-invalid": "true",
    })
  })

  it("includes extra ids the caller passes", () => {
    const field = lt.field({
      id: "email",
      help: true,
      describedBy: ["terms"],
    })

    expect(field.control["aria-describedby"]).toBe("email-help terms")
  })

  it("requires an id in the type", () => {
    /*
     * The requirement is a type, and a type can only be held in place by the
     * type check. The assignments below are the test, and it is
     * `typecheck:tests` that runs it: if `id` becomes optional again, the
     * error disappears, and `@ts-expect-error` itself becomes an error.
     *
     * Without this the requirement had no guard. The previous test was called
     * "requires an id" and said nothing about the requirement: both assertions
     * were green with the old, optional id too.
     */
    // @ts-expect-error id is required
    const withoutAnything = () => lt.field()
    // @ts-expect-error id is required
    const withoutId = () => lt.field({ help: true })

    expect(typeof withoutAnything).toBe("function")
    expect(typeof withoutId).toBe("function")
  })

  it("creates ids anyway, and says so, when JavaScript leaves them out", () => {
    /*
     * A consumer without TypeScript sees no type, and plain HTML with
     * `<script type="module">` is a first-class way to use LO-TEK. Without the
     * fallback, the ids became strings like `undefined-help` and
     * `undefined-list`, and `for`, `aria-controls` and `aria-describedby`
     * pointed there. The wiring was broken, and it looked valid.
     *
     * Every builder function that takes an id is included. The first version
     * had the fallback only in `lt.field()`, and then the suggestion field
     * said "lt.field()" in the message and sent the developer to the wrong
     * place, while half the ids still became `undefined-…`.
     */
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {})
    const withoutId = <T>(
      builderFunction: (o: unknown) => T,
      options: unknown,
    ): T => builderFunction(options)

    const field = withoutId(
      lt.field as (o: unknown) => ReturnType<typeof lt.field>,
      {
        help: true,
        error: true,
      },
    )
    expect(field.control.id).toMatch(/^lt-field-/)
    expect(field.label.for).toBe(field.control.id)
    expect(JSON.stringify(field)).not.toContain("undefined")

    const suggestion = withoutId(
      lt.suggestion as (o: unknown) => ReturnType<typeof lt.suggestion>,
      { keys: ["a", "b"] },
    )
    expect(JSON.stringify(suggestion)).not.toContain("undefined")
    expect(suggestion.control["aria-controls"]).toBe(suggestion.list.id)

    const tabList = withoutId(
      lt.tabs as (o: unknown) => ReturnType<typeof lt.tabs>,
      {
        keys: ["a", "b"],
        label: "Tabs",
      },
    )
    expect(JSON.stringify(tabList)).not.toContain("undefined")

    const popover = withoutId(
      lt.popover as (o: unknown) => ReturnType<typeof lt.popover>,
      {},
    )
    expect(popover.trigger["aria-controls"]).toBe(popover.panel.id)

    const box = withoutId(
      lt.dialog as (o: unknown) => ReturnType<typeof lt.dialog>,
      {},
    )
    expect(box.dialog["aria-labelledby"]).toBe(box.title.id)

    const messages = warning.mock.calls.map((k) => String(k[0])).join("\n")
    for (const name of [
      "lt.field()",
      "lt.suggestion()",
      "lt.tabs()",
      "lt.popover()",
      "lt.dialog()",
    ]) {
      expect(messages, `${name} did not say so`).toContain(name)
    }

    warning.mockRestore()
  })

  it("treats the empty string as no id", () => {
    // `lt.field({ id: "" })` got past both the type and the fallback, and gave
    // `for=""` and `help.id="-help"`. The wiring was broken, and nothing said so.
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {})

    const field = lt.field({ id: "  ", help: true })

    expect(field.control.id).toMatch(/^lt-field-/)
    expect(field.help.id).toBe(`${field.control.id}-help`)
    warning.mockRestore()
  })
})

describe("lt.field together with the field functions", () => {
  it("does not overlap with input(), so no attribute is set twice", () => {
    const field = lt.field({
      id: "email",
      help: true,
      error: true,
      invalid: true,
    })
    const input = lt.input({ type: "email" })

    const shared = Object.keys(input).filter((name) => name in field.control)

    // In JSX the last spread overwrites the first, but in templates that
    // write the attributes out literally, like Astro and plain HTML, they end
    // up twice. The markup is then invalid.
    expect(shared, "These are set by both").toEqual([])
  })

  it("lets control carry both the state colour and aria-invalid", () => {
    const field = lt.field({ id: "email", invalid: true })

    expect(field.control["data-state"]).toBe("invalid")
    expect(field.control["aria-invalid"]).toBe("true")
  })

  it("sets neither when the field is valid", () => {
    const field = lt.field({ id: "email" })

    expect(field.control["data-state"]).toBeUndefined()
    expect(field.control["aria-invalid"]).toBeUndefined()
  })
})

/**
 * How many builder functions `lt` has, apart from `setAttributes`, `isState`
 * and `isMarker`.
 *
 * The number is written here rather than read from the list it is meant to
 * check. Otherwise the guard compares the queue with itself, and half the set
 * could disappear without anything saying so. Add a builder function, and the
 * number goes up in the same change. Note that the sum alone does not catch a
 * swap: if you add a builder function and a helper at the same time, the
 * number stays put, and a renamed name does not change it at all.
 */
const BUILDER_FUNCTION_COUNT = 48

/** Those that give attributes per part rather than one flat set. */
const COMPOSITE_NAMES = [
  "dialog",
  "errorSummary",
  "field",
  "popover",
  "sessionTimeout",
  "suggestion",
  "tableSort",
  "tabs",
  "term",
  "toast",
]

describe("the shape of the namespace", () => {
  /** The builder functions, that is, everything in `lt` that can be called without arguments. */
  const builderFunctions = Object.entries(lt).filter(
    ([name, value]) =>
      typeof value === "function" &&
      name !== "setAttributes" &&
      name !== "isState" &&
      name !== "isMarker" &&
      // The composite builder functions give one attribute set per element
      // instead of one flat set, and need an id to wire them together.
      !COMPOSITE_NAMES.includes(name),
  ) as [string, () => Record<string, unknown>][]

  it("has builder functions to check", () => {
    expect(builderFunctions.length).toBe(
      BUILDER_FUNCTION_COUNT - COMPOSITE_NAMES.length,
    )
  })

  it.each(
    builderFunctions,
  )("lt.%s() gives an lt-prefixed class without arguments", (_name, builderFunction) => {
    const attributes = builderFunction()

    expect(typeof attributes.class).toBe("string")
    for (const className of String(attributes.class).split(" ")) {
      expect(className.startsWith("lt-")).toBe(true)
    }
  })

  it.each(
    builderFunctions,
  )("lt.%s() sets no empty attributes", (_name, builderFunction) => {
    const empty = Object.entries(builderFunction())
      .filter(([, value]) => value === undefined)
      .map(([name]) => name)

    // An attribute with the value undefined becomes the string "undefined" in
    // templates that write the attributes out literally, like Astro and plain
    // HTML.
    expect(empty).toEqual([])
  })
})

describe("attributes only the morpher reads", () => {
  /*
   * Preserving and "do not touch this" are not properties of morphing. They
   * are `data-*` attributes, and such an attribute only means something to
   * the code that reads it. The repair needs none of them: the component
   * reads the markup.
   *
   * The exception is the components that create their own content. A
   * component can set an attribute back, but it cannot guess its way to
   * messages it created itself and a patch emptied. There the server's markup
   * has to say so, and the name of the attribute is the morpher's.
   *
   * The test is a census and not a ban. It fails both on a new place the
   * attribute turns up and on a place it disappears from, since both are a
   * change in what the template must write.
   */
  const MORPHER_ATTRIBUTES = ["data-ignore-morph", "data-preserve-attr"]

  /** Everything in `lt` that is not a builder function. */
  const HELPERS = ["setAttributes", "isState", "isMarker"]

  /**
   * One valid call per builder function that gives attributes per part rather
   * than one flat set. Most of them require arguments. `toast` does not, and
   * is here so the list is the whole set.
   */
  const COMPOSITES: Record<string, () => unknown> = Object.assign(
    Object.create(null),
    {
      dialog: () => lt.dialog({ titleId: "title" }),
      errorSummary: () => lt.errorSummary({ count: 2, id: "errors" }),
      field: () => lt.field({ id: "email", help: true, error: true }),
      popover: () => lt.popover({ id: "panel" }),
      sessionTimeout: () => lt.sessionTimeout({ titleId: "session" }),
      suggestion: () =>
        lt.suggestion({ id: "search", keys: ["a", "b"], open: true }),
      tableSort: () => lt.tableSort({ direction: "ascending" }),
      tabs: () => lt.tabs({ id: "tabs", keys: ["a", "b"], label: "Tabs" }),
      term: () => lt.term({ id: "term-signal" }),
      toast: () => lt.toast(),
    },
  )

  const builderFunctions = Object.entries(lt).filter(
    ([name, value]) => typeof value === "function" && !HELPERS.includes(name),
  ) as [string, () => unknown][]

  const call = ([name, builderFunction]: [string, () => unknown]) =>
    (COMPOSITES[name] ?? builderFunction)()

  /** Every attribute name in the result, however deep it lies. */
  function attributeNames(value: unknown, out: string[] = []): string[] {
    if (Array.isArray(value)) {
      for (const part of value) attributeNames(part, out)
      return out
    }
    if (value && typeof value === "object") {
      for (const [name, part] of Object.entries(value)) {
        out.push(name)
        attributeNames(part, out)
      }
    }
    return out
  }

  it("has every builder function in lt, and only builder functions", () => {
    // Without this the table below could have been empty, or lost a builder
    // function that was renamed, and the census would still have matched. And
    // a new guard in `lt`, like `isColor`, would have been called as a builder
    // function and given `false`, that is, no attributes to count.
    expect(builderFunctions.length).toBe(BUILDER_FUNCTION_COUNT)
    expect(Object.keys(COMPOSITES).sort()).toEqual([...COMPOSITE_NAMES].sort())

    for (const name of COMPOSITE_NAMES) {
      expect(
        builderFunctions.map(([n]) => n),
        `lt.${name} does not exist`,
      ).toContain(name)
    }

    for (const builderFunction of builderFunctions) {
      // That the result is an object is not enough: `typeof null` is also
      // "object", and an empty object would have passed. The assertion must be
      // that the traversal finds something, because that is what the census
      // below rests on: "no morpher attributes" must mean they are not there,
      // not that nobody looked.
      expect(
        attributeNames(call(builderFunction)).length,
        `lt.${builderFunction[0]}() gave no attributes`,
      ).toBeGreaterThan(0)
    }
  })

  it("emits them from exactly the three that create their own content", () => {
    const findings: Record<string, string[]> = {}
    let called = 0

    for (const builderFunction of builderFunctions) {
      const result = call(builderFunction)
      const hits = [
        ...new Set(
          attributeNames(result).filter((n) => MORPHER_ATTRIBUTES.includes(n)),
        ),
      ].sort()
      if (hits.length > 0) findings[builderFunction[0]] = hits
      called += 1
    }

    expect(called).toBe(BUILDER_FUNCTION_COUNT)
    // The suggestion field is not included: the status element is in the
    // server's markup, and the component writes the count again when an
    // update empties it.
    expect(findings).toEqual({
      connectionStatus: ["data-ignore-morph"],
      sessionTimeout: ["data-ignore-morph"],
      toast: ["data-ignore-morph"],
    })
  })
})
