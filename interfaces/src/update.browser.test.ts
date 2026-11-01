/**
 * That fields and suggestion fields, as the recipes show them, work without
 * JavaScript and survive the server sending the region again, in each of the
 * three ways a page is updated.
 *
 * The markup is read straight from the "Plain HTML" tab on the component
 * pages, so the test and the documentation cannot say different things.
 * Datastar and idiomorph, which htmx morphs with, recognise an element by
 * its id. An element without an id is kept, and an element with an id the
 * server did not send is replaced. The components therefore never write an
 * id on the field: `for` and `id` come from the template, or the label wraps
 * the field. What holds for each way:
 *
 * - Datastar keeps the field, focus and the text.
 * - idiomorph keeps the field and focus, but sets the text and `checked`
 *   from the server's HTML. The exception is the focused field when
 *   `ignoreActiveValue` is on, as htmx users do with
 *   `hx-swap="morph:{ignoreActiveValue:true}"`; it is off by default. The
 *   server therefore has to send the values back.
 * - `innerHTML` replaces everything. The new field must be connected again.
 * - Without JavaScript there is no update, and the markup has to stand on
 *   its own: every field has a name, the required marker and the error text
 *   from the server are visible, and the list in the suggestion field is not
 *   open.
 *
 * The mutations that must fail it: an id written on the field by the
 * component (the cases with the label wrapping the field), the `for` write
 * taken out of the component (the case with a label without `for`), and the
 * id taken out of the recipe (the warning).
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import fieldPage from "../../documentation/src/content/docs/components/field.mdx?raw"
import popoverPage from "../../documentation/src/content/docs/components/popover.mdx?raw"
import suggestionPage from "../../documentation/src/content/docs/components/suggestion.mdx?raw"
import checkboxCss from "./components/css/checkbox/checkbox.css?inline"
import errorTextCss from "./components/css/error-text/error-text.css?inline"
import helpTextCss from "./components/css/help-text/help-text.css?inline"
import inputCss from "./components/css/input/input.css?inline"
import labelCss from "./components/css/label/label.css?inline"
import srOnlyCss from "./components/css/sr-only/sr-only.css?inline"
import { defineLtField } from "./components/frame/field/lt-field"
import { defineLtPopover } from "./components/frame/popover/lt-popover"
import { defineLtSuggestion } from "./components/frame/suggestion/lt-suggestion"
import suggestionCss from "./components/frame/suggestion/suggestion.css?inline"
import { waitForPaint } from "./testing/a11y"
import { Idiomorph } from "./testing/idiomorph/idiomorph-v0.8.0.js"
import { htmlBlocks } from "./testing/recipes"
import { datastarPatch, morph, WAYS, type Way } from "./testing/update"
import tokensCss from "./tokens/tokens.css?inline"

/**
 * The recipe in the "Plain HTML" tab on a component page: the first html
 * block containing the element, without the scripts.
 */
function recipe(page: string, tag: string): string {
  // Every block from the first "Plain HTML" tab on: the "Text and code"
  // recipe on the suggestion page stands below the tabs, not in one.
  const blocks = htmlBlocks(
    page.slice(page.indexOf('<TabItem label="Plain HTML">')),
  )
  const block = blocks.find((b) => b.includes(`<${tag}`))
  if (!block) throw new Error(`found no recipe with <${tag}> on the page`)
  return block.replace(/<script[\s\S]*?<\/script>/g, "")
}

const FIELD = recipe(fieldPage, "lt-field")
const SUGGESTION = recipe(suggestionPage, "lt-suggestion")
/** The "Text and code" recipe, with the hidden field for the code. */
const CODE = recipe(suggestionPage, 'input class="lt-suggestion__value"')

/** The recipe with the label wrapping the field, and no id. */
const FIELD_WRAPPED = `
  <lt-field>
    <label class="lt-label">Codename <input class="lt-input" name="codename" type="text"></label>
    <p class="lt-help-text">The name the crew answers to. Never the real one.</p>
  </lt-field>`

const SUGGESTION_WRAPPED = `
  <lt-suggestion>
    <label class="lt-label">Breaker <input class="lt-input" name="breaker" type="text"></label>
    <ul class="lt-suggestion__list"><li>Lockjaw</li><li>Saltwater</li><li>Glasscutter</li></ul>
    <span class="lt-sr-only" role="status"></span>
  </lt-suggestion>`

const CHECKBOX = (checked: boolean) => `
  <div>
    <input class="lt-checkbox" type="checkbox" id="terms" name="terms"${checked ? " checked" : ""}>
    <label class="lt-label" for="terms">I accept the terms</label>
  </div>`

/**
 * The region the server sends, with an id so Datastar finds it. An update
 * carries a marker, so each case can see that the patch actually arrived and
 * not just that nothing happened.
 */
const region = (content: string, updated = false) =>
  `<div id="region">${updated ? "<span hidden data-updated></span>" : ""}${content}</div>`

async function update(way: Way, content: string): Promise<void> {
  const root = document.getElementById("region") as HTMLElement
  // The marker from the previous update is removed, so this one has to bring it.
  root.querySelector("[data-updated]")?.remove()
  if (way === "Datastar") {
    // Like a `datastar-patch-elements` without a selector: `outer` on the id.
    datastarPatch(region(content, true))
  } else if (way === "idiomorph") {
    morph(root, region(content, true))
  } else {
    root.innerHTML = `<span hidden data-updated></span>${content}`
  }
  await settle()
  expect(
    document.querySelector("#region [data-updated]"),
    `the update with ${way} did not arrive`,
  ).not.toBeNull()
}

/** Waits until the observers have run. */
async function settle() {
  await waitForPaint()
  await waitForPaint()
}

/** Waits until `warnAboutMarkup` has seen the page settle. */
/*
 * 300 ms is enough when the frames come. In a hidden tab `whenSettled` falls
 * back to one second, and a silence test would then pass without having
 * seen anything; but "reports once when the recipe has no id on the field"
 * waits just as long and would fail, so the run as a whole cannot pass
 * empty.
 */
const quiet = () => new Promise((r) => setTimeout(r, 300))

async function mount(content: string) {
  document.body.innerHTML = region(content)
  await settle()
}

const field = () =>
  document.querySelector("input:not([type='checkbox'])") as HTMLInputElement

describe("fields and suggestion fields through a server update", () => {
  beforeAll(() => {
    defineLtField()
    defineLtSuggestion()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ""
  })

  it("reads the recipes from the component pages", () => {
    expect(FIELD).toContain('for="codename"')
    expect(FIELD).toContain('id="codename"')
    expect(SUGGESTION).toContain('for="breaker"')
    expect(SUGGESTION).toContain('id="breaker"')
    expect(CODE).toContain('data-value="LDG-117"')
  })

  for (const way of WAYS) {
    it(`a chosen suggestion with a code: ${way}`, async () => {
      // The plan's 6.1: choose a suggestion, then update. The server sends
      // the value field empty; with `innerHTML` it must send both values back.
      const warning = vi.spyOn(console, "warn").mockImplementation(() => {})
      await mount(CODE)
      const input = field()
      input.focus()
      ;(document.querySelector("li") as HTMLElement).click()
      await settle()
      const code = () =>
        document.querySelector(".lt-suggestion__value") as HTMLInputElement
      expect(input.value).toBe("Crowbar")
      expect(code().value).toBe("LDG-117")

      await update(
        way,
        way === "innerHTML"
          ? CODE.replace('type="text"', 'type="text" value="Crowbar"').replace(
              'type="hidden"',
              'type="hidden" value="LDG-117"',
            )
          : CODE,
      )

      expect(field().value).toBe("Crowbar")
      expect(code().value).toBe("LDG-117")
      await quiet()
      expect(warning).not.toHaveBeenCalled()
    })
  }

  const CASES = [
    {
      name: "field from the recipe",
      markup: FIELD,
      label: "Codename",
      id: "codename",
    },
    {
      name: "field with the label wrapping it, no id",
      markup: FIELD_WRAPPED,
      label: "Codename",
      id: "",
    },
    {
      name: "suggestion field from the recipe",
      markup: SUGGESTION,
      label: "Breaker",
      id: "breaker",
    },
    {
      name: "suggestion field with the label wrapping it, no id",
      markup: SUGGESTION_WRAPPED,
      label: "Breaker",
      id: "",
    },
  ]

  for (const way of WAYS) {
    for (const t of CASES) {
      it(`${t.name}: ${way}`, async () => {
        const warning = vi.spyOn(console, "warn").mockImplementation(() => {})
        await mount(t.markup)
        const before = field()
        before.focus()
        before.value = "Static"
        before.dispatchEvent(new Event("input", { bubbles: true }))
        await settle()

        await update(way, t.markup)

        const after = field()
        if (way === "innerHTML") {
          expect(after).not.toBe(before)
        } else {
          expect(after).toBe(before)
          expect(after.value).toBe("Static")
          expect(document.activeElement).toBe(after)
        }
        expect(after.id).toBe(t.id)
        expect(after.labels?.length).toBe(1)
        expect(after.labels?.[0]?.textContent).toContain(t.label)
        const help = document.querySelector(".lt-help-text")
        if (help) expect(after.getAttribute("aria-describedby")).toBe(help.id)
        if (after.closest("lt-suggestion")) {
          expect(after.getAttribute("role")).toBe("combobox")
          expect(after.getAttribute("aria-controls")).toBe(
            document.querySelector("ul")?.id,
          )
        }
        await quiet()
        expect(warning).not.toHaveBeenCalled()
      })
    }
  }

  it("idiomorph without ignoreActiveValue also sets the focused field from the server", async () => {
    // The default in idiomorph, and so in htmx without a setting in `hx-swap`.
    await mount(FIELD)
    const input = field()
    input.focus()
    input.value = "Static"
    Idiomorph.morph(
      document.getElementById("region") as HTMLElement,
      region(FIELD, true),
      { morphStyle: "outerHTML" },
    )
    await settle()
    expect(field()).toBe(input)
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe("")
  })

  for (const way of ["Datastar", "idiomorph"] as const) {
    it(`a field without focus: ${way} and what the server sends back`, async () => {
      /*
       * Datastar leaves the text. idiomorph sets it from the server's HTML,
       * so with htmx the server must send the value back. That is the one
       * sentence the documentation gives htmx users, and it is checked here.
       */
      await mount(FIELD)
      field().value = "Static"
      field().blur()

      await update(way, FIELD)
      expect(field().value).toBe(way === "Datastar" ? "Static" : "")

      // The server sends a different text from what is there. Both morphers
      // set the property when the attribute differs: Datastar in
      // patchElements.ts (`oldElt.value = newValue`), idiomorph always.
      field().value = "Ghost"
      await update(
        way,
        FIELD.replace('id="codename"', 'id="codename" value="Static"'),
      )
      expect(field().value).toBe("Static")
    })

    it(`checkbox: ${way} and what the server sends back`, async () => {
      await mount(CHECKBOX(false))
      const box = document.getElementById("terms") as HTMLInputElement
      box.click()
      expect(box.checked).toBe(true)

      await update(way, CHECKBOX(false))
      expect(document.getElementById("terms")).toBe(box)
      expect(box.checked).toBe(way === "Datastar")

      // The server sends `checked` while the box is unchecked after the user
      // touched it. Both morphers set the check from the server's HTML.
      box.checked = false
      await update(way, CHECKBOX(true))
      expect(box.checked).toBe(true)
    })

    it(`list with ids from a key: the text stays in the right row (${way})`, async () => {
      /*
       * An id that follows the position moves what the user typed to the
       * wrong row when the server inserts a new one at the top. An id from a
       * key in the data keeps the row where it belongs. The test is about the
       * rule the documentation gives templates, not the components: all the
       * ids come from the server.
       */
      const list = (names: string[]) =>
        names
          .map((n) => {
            const k = n.toLowerCase()
            // An id on the row too, as `hx-target` and `hx-swap-oob` need it.
            return `<lt-field id="row-${k}"><label class="lt-label" for="note-${k}">${n}</label><input class="lt-input" id="note-${k}" name="note-${k}"></lt-field>`
          })
          .join("")
      await mount(list(["Needle", "Sledge"]))
      const needle = document.getElementById("note-needle") as HTMLInputElement
      const row = document.getElementById("row-needle")
      needle.focus()
      needle.value = "Back three days late"

      await update(way, list(["Boltcutter", "Needle", "Sledge"]))

      expect(
        (document.getElementById("note-boltcutter") as HTMLInputElement).value,
      ).toBe("")
      expect(document.getElementById("note-needle")).toBe(needle)
      expect(document.getElementById("row-needle")).toBe(row)
      expect(needle.value).toBe("Back three days late")
    })
  }

  it("writes for on a label without one, from the field's id", async () => {
    // The mutation: take the `for` write out of the component.
    await mount(FIELD.replace(' for="codename"', ""))
    const label = document.querySelector("label") as HTMLLabelElement
    expect(label.htmlFor).toBe("codename")
  })

  it("reports once when the recipe has no id on the field", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {})
    await mount(FIELD.replace(' id="codename"', ""))
    await quiet()
    expect(warning).toHaveBeenCalledTimes(1)
    expect(String(warning.mock.calls[0][0])).toContain("not connected")
  })
})

describe("the recipes without JavaScript", () => {
  /*
   * A sandboxed iframe without `allow-scripts` runs no scripts, so the web
   * components do not exist, and the markup has to manage by itself. The
   * stylesheets are inlined as text; `@import` is not resolved in a
   * `srcdoc`, so each stylesheet the recipe links to is included
   * separately.
   */
  let doc: Document

  beforeAll(async () => {
    const iframe = document.createElement("iframe")
    iframe.sandbox.add("allow-same-origin")
    const styles = [
      tokensCss,
      labelCss,
      inputCss,
      helpTextCss,
      errorTextCss,
      checkboxCss,
      srOnlyCss,
      suggestionCss.replace(/@import[^;]*;/g, ""),
    ].join("\n")
    iframe.srcdoc = `<!doctype html><meta charset="utf-8"><style>${styles}</style>
      <script>document.documentElement.dataset.script = "ran"</script>
      ${FIELD}
      <div id="invalid">${FIELD.replace(" hidden>", ">").replaceAll('"codename"', '"codename-invalid"')}</div>
      ${SUGGESTION}
      ${CHECKBOX(false)}`
    await new Promise((r) => {
      iframe.onload = r
      document.body.append(iframe)
    })
    doc = iframe.contentDocument as Document
  })

  it("runs no scripts", () => {
    // The script in the sandbox would have set a marker. It is not there.
    expect(doc.documentElement.dataset.script).toBeUndefined()
    expect(doc.defaultView?.customElements.get("lt-field")).toBeUndefined()
  })

  it("every field has a name from the label", () => {
    for (const input of doc.querySelectorAll("input")) {
      expect(input.labels?.length, input.outerHTML).toBe(1)
      expect(input.labels?.[0]?.htmlFor).toBe(input.id)
    }
  })

  it("the required marker is visible", () => {
    const label = doc.querySelector("label[for='codename']") as HTMLElement
    const after = doc.defaultView?.getComputedStyle(label, "::after")
    expect(after?.content).toContain("*")
  })

  it("the error text from the server is visible, and the hidden one is not", () => {
    const view = doc.defaultView as Window
    const hidden = doc.querySelector(".lt-error-text[hidden]") as HTMLElement
    const visible = doc.querySelector("#invalid .lt-error-text") as HTMLElement
    expect(view.getComputedStyle(hidden).display).toBe("none")
    expect(view.getComputedStyle(visible).display).toBe("block")
  })

  it("the list in the suggestion field is not open", () => {
    const list = doc.querySelector(".lt-suggestion__list") as HTMLElement
    expect(doc.defaultView?.getComputedStyle(list).display).toBe("none")
  })
})

/*
 * The popover: the component never writes an id on the panel. With an id
 * from the template, as in the recipe, and without one, Datastar and
 * idiomorph recognise the panel, so it stays open with focus where it was.
 * When the component wrote an id itself, the panel was replaced.
 * `innerHTML` replaces everything, the host included.
 */
const POPOVER = recipe(popoverPage, "lt-popover")
const POPOVER_BARE = POPOVER.replace(' id="actions"', "")

describe("the popover through a server update", () => {
  beforeAll(() => {
    defineLtPopover()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ""
  })

  it("reads the recipe from the component page, with an id on the panel", () => {
    expect(POPOVER).toContain('class="lt-popover" id="actions"')
    expect(POPOVER_BARE).not.toContain('id="actions"')
  })

  for (const [name, markup] of [
    ["the recipe", POPOVER],
    ["bare markup without an id", POPOVER_BARE],
  ] as const) {
    for (const way of WAYS) {
      it(`${name}: ${way}`, async () => {
        await mount(markup)
        const button = document.querySelector(
          "lt-popover > button",
        ) as HTMLElement
        const panel = document.querySelector(".lt-popover") as HTMLElement
        button.click()
        await settle()
        const option = panel.querySelector("button") as HTMLElement
        option.focus()
        expect(panel.matches(":popover-open")).toBe(true)

        await update(way, markup)

        const after = document.querySelector(".lt-popover") as HTMLElement
        expect(after.hasAttribute("id")).toBe(markup === POPOVER)
        if (way === "innerHTML") {
          expect(after).not.toBe(panel)
        } else {
          expect(after).toBe(panel)
          expect(after.matches(":popover-open")).toBe(true)
          expect(document.activeElement).toBe(option)
        }
        ;(
          document.querySelector("lt-popover") as HTMLElement & { hide(): void }
        ).hide()
      })
    }
  }
})
