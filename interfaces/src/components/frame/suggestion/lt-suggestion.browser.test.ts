/// <reference path="../../../types/css.d.ts" />

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import {
  expectNoAccessibilityViolations,
  mount,
  waitForPaint,
} from "../../../testing/a11y"
import { attr } from "../../../testing/markup"
import { datastarPatch, replace } from "../../../testing/update"
import { defineLtSuggestion, type LtSuggestion } from "./lt-suggestion"
import { suggestion } from "./suggestion"

import "../../../tokens/tokens.css"
import "./suggestion.css"
import "../../css/sr-only/sr-only.css"

const BREAKERS = ["Glasscutter", "Corkscrew", "Saltwater", "Needle"]
const KEYS = ["glasscutter", "corkscrew", "saltwater", "needle"]

/** The markup the server sends. The field and the list exist before the script has run. */
const SUGGESTION = suggestion({
  id: "breaker",
  keys: KEYS,
  help: true,
})

async function paint() {
  await customElements.whenDefined("lt-suggestion")
  await waitForPaint()
  return document.querySelector("lt-suggestion") as LtSuggestion
}

function typeInto(field: LtSuggestion, text: string) {
  const input = field.querySelector("input") as HTMLInputElement
  input.value = text
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

describe("lt-suggestion", () => {
  beforeAll(() => {
    defineLtSuggestion()
  })

  beforeEach(async () => {
    mount(`
      <lt-suggestion>
        <label ${attr(SUGGESTION.label)}>Breaker</label>
        <div>
          <input ${attr(SUGGESTION.control)} name="breaker">
          <ul ${attr(SUGGESTION.list)}>
            ${SUGGESTION.options.map((o, i) => `<li ${attr(o)}>${BREAKERS[i]}</li>`).join("\n            ")}
          </ul>
          <p ${attr(SUGGESTION.empty)} hidden>No matches</p>
          <span ${attr(SUGGESTION.status)}></span>
        </div>
        <p class="lt-help-text" ${attr(SUGGESTION.help)}>Start typing</p>
      </lt-suggestion>
    `)
    await paint()
  })

  it("is a real field before the script has run", () => {
    // The web component used to render the whole field itself. Then there was
    // nothing to fill in, and nothing was included in the submission.
    const input = document.querySelector("input") as HTMLInputElement
    const label = document.querySelector("label") as HTMLLabelElement

    expect(input.name).toBe("breaker")
    expect(label.htmlFor).toBe(input.id)
    expect(input.getAttribute("role")).toBe("combobox")
    expect(input.getAttribute("aria-autocomplete")).toBe("list")
    expect(input.getAttribute("aria-expanded")).toBe("false")
    expect(document.querySelectorAll("[role='option']")).toHaveLength(4)
  })

  it("does not ask the template to preserve anything", () => {
    // What the list shows and what is highlighted come from the user, and the
    // web component sets them back itself after a patch. If
    // `data-preserve-attr` comes back here, someone has revived the contract
    // the template had to copy from the documentation.
    const input = document.querySelector("input") as HTMLInputElement
    const list = document.querySelector("[role='listbox']") as HTMLElement
    const options = document.querySelectorAll("[role='option']")

    expect(input.hasAttribute("data-preserve-attr")).toBe(false)
    expect(list.hasAttribute("data-preserve-attr")).toBe(false)
    for (const v of options)
      expect(v.hasAttribute("data-preserve-attr")).toBe(false)
  })

  it("narrows the suggestions while the user types", async () => {
    const field = await paint()
    typeInto(field, "co")
    await paint()

    const visible = [
      ...field.querySelectorAll<HTMLElement>("[role='option']"),
    ].filter((o) => !o.hidden)

    expect(visible.map((o) => o.textContent?.trim())).toEqual(["Corkscrew"])
  })

  it("announces the number of matches to screen readers", async () => {
    const field = await paint()
    typeInto(field, "cor")
    await paint()

    const status = field.querySelector("[role='status']") as HTMLElement
    expect(status.textContent).toBe("One match")
  })

  it("moves the highlight with the arrow keys and points to it with aria", async () => {
    const field = await paint()
    const input = field.querySelector("input") as HTMLInputElement

    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    )
    await paint()

    const active = field.querySelector("[aria-selected='true']") as HTMLElement
    expect(active.textContent?.trim()).toBe("Glasscutter")
    // Focus stays in the field. aria-activedescendant is what makes the
    // screen reader announce the option anyway.
    expect(input.getAttribute("aria-activedescendant")).toBe(active.id)
  })

  it("chooses with Enter and reports it", async () => {
    const field = await paint()
    const input = field.querySelector("input") as HTMLInputElement
    const chosen: string[] = []
    field.addEventListener("suggestion-select", (event) => {
      chosen.push(event.detail.value)
    })

    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    )
    await paint()
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    )
    await paint()

    expect(input.value).toBe("Glasscutter")
    expect(chosen).toEqual(["Glasscutter"])
    expect(input.getAttribute("aria-expanded")).toBe("false")
  })

  it("says so when nothing matches", async () => {
    const field = await paint()
    typeInto(field, "xyz")
    await paint()

    const empty = field.querySelector(".lt-suggestion__empty") as HTMLElement
    expect(empty.hidden).toBe(false)
    expect(
      (field.querySelector("[role='status']") as HTMLElement).textContent,
    ).toBe("No matches")
  })

  it("closes the list on Escape", async () => {
    const field = await paint()
    const input = field.querySelector("input") as HTMLInputElement
    typeInto(field, "co")
    await paint()

    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    )
    await paint()

    const list = field.querySelector("[role='listbox']") as HTMLElement
    expect(list.hidden).toBe(true)
    expect(input.getAttribute("aria-expanded")).toBe("false")
  })

  it("does not filter when something else already has", async () => {
    const field = await paint()
    field.setAttribute("prefiltered", "")
    typeInto(field, "xyz")
    await paint()

    // The server or React has already decided what is shown. Then the web
    // component must keep its hands off.
    const visible = [
      ...field.querySelectorAll<HTMLElement>("[role='option']"),
    ].filter((o) => !o.hidden)
    expect(visible).toHaveLength(4)
  })

  it("can be set as a property, the way React 19 does it", async () => {
    /*
     * React writes the property rather than the attribute when a web
     * component has one with that name. With only a getter the write threw
     * "Cannot set property", the attribute never landed, and the web component
     * hid what React had just rendered.
     */
    const field = await paint()

    field.prefiltered = true
    expect(field.hasAttribute("prefiltered")).toBe(true)

    field.prefiltered = false
    expect(field.hasAttribute("prefiltered")).toBe(false)
  })

  it("announces the number of matches when whoever filtered has rendered the list", async () => {
    /*
     * The message follows the list, not the keystroke. `prefiltered` turns off
     * the hiding, not the announcement: the first version returned at once,
     * and then a Datastar app was left with no word of how many matches were
     * left. It was not written anywhere, and people who cannot see the screen
     * noticed.
     */
    const field = await paint()
    field.prefiltered = true
    const status = field.querySelector("[role='status']") as HTMLElement

    typeInto(field, "c")
    await paint()
    expect(
      status.textContent,
      "announced a count before whoever filtered had answered",
    ).toBe("")

    // The way a server or React would do it: everything except one is hidden.
    const options = [...field.querySelectorAll<HTMLElement>("[role='option']")]
    for (const [i, option] of options.entries()) option.hidden = i !== 0
    await paint()

    expect(status.textContent).toBe("One match")
  })

  it("leaves the empty message alone when something else filtered", async () => {
    /*
     * The empty message is part of what the list shows, and whoever filtered
     * decides that. The web component cannot tell "the search found nothing"
     * from "the answer has not arrived yet", and so made the message visible
     * again in the middle of an asynchronous search, with no way around it.
     */
    const field = await paint()
    field.prefiltered = true
    const empty = field.querySelector(".lt-suggestion__empty") as HTMLElement

    // The app is waiting for an answer: no options, and the message stays hidden.
    for (const option of field.querySelectorAll("[role='option']"))
      option.remove()
    typeInto(field, "xyz")
    await paint()
    expect(empty.hidden, 'the web component showed "No matches" itself').toBe(
      true,
    )

    // The app answers that nothing matched, and shows the message itself.
    empty.hidden = false
    typeInto(field, "xyzæ")
    await paint()
    expect(empty.hidden, 'the web component hid the app\'s "No matches"').toBe(
      false,
    )
  })

  it("has no accessibility violations with the list open", async () => {
    const field = await paint()
    typeInto(field, "o")
    await paint()

    await expectNoAccessibilityViolations()
  })
})

/**
 * A prefiltered field that has not yet got anything to show.
 *
 * This is the markup from the Datastar tab in the documentation: the list is
 * empty until the server has sent something. Had the web component counted
 * on focus, the field would have announced "No matches" before the user had
 * typed a character, to exactly the people who cannot see the screen, and
 * the empty message would have been visible on a field nobody had searched
 * in.
 */
describe("lt-suggestion waiting for the first answer", () => {
  beforeAll(() => {
    defineLtSuggestion()
  })

  beforeEach(async () => {
    const noKeys = suggestion({ id: "breaker", keys: [] })

    mount(`
      <lt-suggestion prefiltered>
        <label ${attr(noKeys.label)}>Breaker</label>
        <div>
          <input ${attr(noKeys.control)} name="breaker">
          <ul ${attr(noKeys.list)}></ul>
          <p ${attr(noKeys.empty)}>No matches</p>
          <span ${attr(noKeys.status)}></span>
        </div>
      </lt-suggestion>
    `)
    await paint()
  })

  it("says nothing on focus", async () => {
    const field = await paint()
    const input = field.querySelector("input") as HTMLInputElement

    input.dispatchEvent(new FocusEvent("focus"))
    await paint()

    const status = field.querySelector("[role='status']") as HTMLElement
    expect(status.textContent).toBe("")
    // The builder function no longer writes `hidden` on an empty list. What
    // keeps the message away is that an empty list below an empty field is not
    // opened, and that the stylesheet hides the message after a closed list.
    const list = field.querySelector("ul") as HTMLElement
    const empty = field.querySelector(".lt-suggestion__empty") as HTMLElement
    expect(list.hidden, "an empty list opened on focus").toBe(true)
    expect(
      getComputedStyle(empty).display,
      'showed "No matches" before anyone had searched',
    ).toBe("none")
  })

  it("reports when the server has sent the list", async () => {
    const field = await paint()
    const list = field.querySelector("[role='listbox']") as HTMLElement

    // The way a patch would do it.
    list.innerHTML = `
      <li class="lt-suggestion__option" id="breaker-option-glasscutter" role="option">Glasscutter</li>
      <li class="lt-suggestion__option" id="breaker-option-corkscrew" role="option">Corkscrew</li>
    `
    await paint()

    const status = field.querySelector("[role='status']") as HTMLElement
    expect(status.textContent).toBe("2 matches")
  })
})

/**
 * The server can also decide which option is active.
 *
 * `lt.suggestion({ activeIndex })` writes `aria-selected="true"` on one of
 * them. Had the web component kept a separate counter, the first arrow key
 * would jump to the top of the list instead of to the next option, and the
 * highlight the server had just sent would be gone.
 */
describe("lt-suggestion with the highlight from the server", () => {
  beforeAll(() => {
    defineLtSuggestion()
  })

  beforeEach(async () => {
    const fromServer = suggestion({
      id: "breaker",
      keys: KEYS,
      open: true,
      activeIndex: 2,
    })

    mount(`
      <lt-suggestion>
        <label ${attr(fromServer.label)}>Breaker</label>
        <div>
          <input ${attr(fromServer.control)} name="breaker">
          <ul ${attr(fromServer.list)}>
            ${fromServer.options.map((o, i) => `<li ${attr(o)}>${BREAKERS[i]}</li>`).join("\n            ")}
          </ul>
          <p ${attr(fromServer.empty)}>No matches</p>
          <span ${attr(fromServer.status)}></span>
        </div>
      </lt-suggestion>
    `)
    await paint()
  })

  it("moves on from what the server highlighted", async () => {
    const field = document.querySelector("lt-suggestion") as LtSuggestion
    const input = field.querySelector("input") as HTMLInputElement
    const options = [
      ...field.querySelectorAll("[role='option']"),
    ] as HTMLElement[]

    expect(options[2].getAttribute("aria-selected")).toBe("true")

    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    )
    await waitForPaint()

    expect(
      options[3].getAttribute("aria-selected"),
      "the arrow key did not move to the option after the one the server highlighted",
    ).toBe("true")
    expect(input.getAttribute("aria-activedescendant")).toBe(options[3].id)
  })
})

describe("lt-suggestion with arrow up", () => {
  beforeAll(() => {
    defineLtSuggestion()
  })

  beforeEach(async () => {
    mount(`
      <lt-suggestion>
        <label ${attr(SUGGESTION.label)}>Breaker</label>
        <div>
          <input ${attr(SUGGESTION.control)} name="breaker">
          <ul ${attr(SUGGESTION.list)}>
            ${SUGGESTION.options.map((o, i) => `<li ${attr(o)}>${BREAKERS[i]}</li>`).join("\n            ")}
          </ul>
          <p ${attr(SUGGESTION.empty)}>No matches</p>
          <span ${attr(SUGGESTION.status)}></span>
        </div>
      </lt-suggestion>
    `)
    await paint()
  })

  it("opens the list and goes to the last option", async () => {
    const field = document.querySelector("lt-suggestion") as LtSuggestion
    const input = field.querySelector("input") as HTMLInputElement
    const list = field.querySelector("[role='listbox']") as HTMLElement
    const options = [
      ...field.querySelectorAll("[role='option']"),
    ] as HTMLElement[]

    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    )
    await waitForPaint()

    // Without the opening, aria-activedescendant pointed into a list the
    // field at the same time reported as closed.
    expect(list.hidden, "the list was not opened").toBe(false)
    expect(input.getAttribute("aria-expanded")).toBe("true")

    const last = options[options.length - 1]
    expect(
      last.getAttribute("aria-selected"),
      "arrow up did not go to the last option",
    ).toBe("true")
    expect(input.getAttribute("aria-activedescendant")).toBe(last.id)
  })
})

describe("lt-suggestion closes and cleans up", () => {
  beforeAll(() => {
    defineLtSuggestion()
  })

  function markup(extraHost = "") {
    return `
      <lt-suggestion ${extraHost}>
        <label ${attr(SUGGESTION.label)}>Breaker</label>
        <div>
          <input ${attr(SUGGESTION.control)} name="breaker">
          <ul ${attr(SUGGESTION.list)}>
            ${SUGGESTION.options.map((o, i) => `<li ${attr(o)}>${BREAKERS[i]}</li>`).join("")}
          </ul>
          <p ${attr(SUGGESTION.empty)}>No matches</p>
          <span ${attr(SUGGESTION.status)}></span>
        </div>
      </lt-suggestion>
      <input id="next-field" />
    `
  }

  const press = (input: HTMLInputElement, key: string) =>
    input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))

  it("closes the list when focus leaves the field", async () => {
    // Tab moved on to the next field, and the list stayed over it with
    // `aria-expanded="true"` on a field that no longer had focus.
    mount(markup())
    const field = await paint()
    const input = field.querySelector("input") as HTMLInputElement
    const list = field.querySelector("[role='listbox']") as HTMLElement

    input.focus()
    await paint()
    expect(list.hidden).toBe(false)
    ;(document.getElementById("next-field") as HTMLInputElement).focus()
    await paint()

    expect(list.hidden).toBe(true)
    expect(input.getAttribute("aria-expanded")).toBe("false")
  })

  it("closes the list when focus leaves the web component through a button inside it", async () => {
    // A button next to the field is inside the web component, so the list
    // stays when focus goes there. If focus moves on out from there, the list
    // must close then too.
    mount(`
      <lt-suggestion>
        <label ${attr(SUGGESTION.label)}>Breaker</label>
        <div>
          <input ${attr(SUGGESTION.control)} name="breaker">
          <button type="button" id="clear-button">Clear</button>
          <ul ${attr(SUGGESTION.list)}>
            ${SUGGESTION.options.map((o, i) => `<li ${attr(o)}>${BREAKERS[i]}</li>`).join("")}
          </ul>
          <span ${attr(SUGGESTION.status)}></span>
        </div>
      </lt-suggestion>
      <input id="next-field" />
    `)
    const field = await paint()
    const list = field.querySelector("[role='listbox']") as HTMLElement

    ;(field.querySelector("input") as HTMLInputElement).focus()
    await paint()
    ;(document.getElementById("clear-button") as HTMLElement).focus()
    await paint()
    expect(list.hidden, "the list closed for a button inside").toBe(false)
    ;(document.getElementById("next-field") as HTMLElement).focus()
    await paint()

    expect(list.hidden).toBe(true)
  })

  it("keeps the list open when the user clicks the field inside a shadow root", async () => {
    // The documentation's previews live in a shadow root. The listener on
    // `document` saw `event.target` retargeted to the shadow host, counted the
    // click as outside, and closed the list in the same click that opened it.
    const host = document.createElement("div")
    document.body.append(host)
    const root = host.attachShadow({ mode: "open" })
    root.innerHTML = markup()
    await customElements.whenDefined("lt-suggestion")
    await waitForPaint()

    const input = root.querySelector("input") as HTMLInputElement
    const list = root.querySelector("[role='listbox']") as HTMLElement
    input.focus()
    input.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true }),
    )
    await waitForPaint()

    expect(list.hidden, "the list was closed by the click in the field").toBe(
      false,
    )
    host.remove()
  })

  it('hides "No matches" together with the list', async () => {
    // The empty message is a sibling of the list, not a child, so `hidden` on
    // the list did not hide it, and it stayed below a closed field.
    mount(markup())
    const field = await paint()
    const input = field.querySelector("input") as HTMLInputElement
    const empty = field.querySelector(".lt-suggestion__empty") as HTMLElement

    typeInto(field, "xyz")
    await paint()
    expect(empty.hidden).toBe(false)

    press(input, "Escape")
    await paint()
    expect(empty.hidden).toBe(true)
    expect(getComputedStyle(empty).display).toBe("none")
  })

  it("does not open the list again when server-controlled is set and removed", async () => {
    mount(markup())
    const field = await paint()
    const input = field.querySelector("input") as HTMLInputElement
    const list = field.querySelector("[role='listbox']") as HTMLElement
    press(input, "ArrowDown")
    await paint()
    expect(list.hidden).toBe(false)

    // The server takes over and closes the list. Then it lets go again. Had
    // the web component remembered that the list was open, it would have
    // opened it again on the next patch.
    field.setAttribute("server-controlled", "")
    list.hidden = true
    input.setAttribute("aria-expanded", "false")
    await paint()
    field.removeAttribute("server-controlled")
    input.setAttribute("aria-expanded", "false")
    await paint()

    expect(list.hidden).toBe(true)
    expect(input.getAttribute("aria-expanded")).toBe("false")
  })

  it("clears the highlight when the highlighted option is filtered out, also with server-controlled", async () => {
    mount(markup("server-controlled"))
    const field = await paint()
    const input = field.querySelector("input") as HTMLInputElement

    press(input, "ArrowDown")
    await paint()
    const glasscutter = field.querySelector("[role='option']") as HTMLElement
    expect(glasscutter.getAttribute("aria-selected")).toBe("true")

    typeInto(field, "o")
    await paint()

    expect(glasscutter.hidden).toBe(true)
    expect(glasscutter.getAttribute("aria-selected")).toBe("false")
    expect(input.getAttribute("aria-activedescendant")).toBeNull()
  })

  it("finds the options by role, not by class", async () => {
    mount(`
      <lt-suggestion>
        <label ${attr(SUGGESTION.label)}>Breaker</label>
        <div>
          <input ${attr(SUGGESTION.control)} name="breaker">
          <ul ${attr(SUGGESTION.list)}>
            <li id="own-0" role="option">Glasscutter</li>
            <li id="own-1" role="option">Saltwater</li>
          </ul>
          <span ${attr(SUGGESTION.status)}></span>
        </div>
      </lt-suggestion>
    `)
    const field = await paint()
    const input = field.querySelector("input") as HTMLInputElement

    press(input, "ArrowDown")
    await paint()
    expect(input.getAttribute("aria-activedescendant")).toBe("own-0")

    typeInto(field, "sal")
    await paint()
    expect((document.getElementById("own-0") as HTMLElement).hidden).toBe(true)
    expect((document.getElementById("own-1") as HTMLElement).hidden).toBe(false)
  })

  it("leaves a narrower filter in the app alone", async () => {
    /*
     * The app renders only the matches of a `startsWith` search, without
     * `prefiltered`. Everything it keeps also contains the search term, so the
     * web component's filter hides none of it. The claim is in the
     * documentation, and here.
     */
    const narrow = suggestion({ id: "place", keys: ["a", "b"] })
    mount(`
      <lt-suggestion>
        <label ${attr(narrow.label)}>Place</label>
        <div>
          <input ${attr(narrow.control)} value="s">
          <ul ${attr(narrow.list)}>
            <li ${attr(narrow.options[0])}>Saltwater</li>
            <li ${attr(narrow.options[1])}>Sledge</li>
          </ul>
          <span ${attr(narrow.status)}></span>
        </div>
      </lt-suggestion>
    `)
    const field = await paint()
    const input = field.querySelector("input") as HTMLInputElement

    input.focus()
    await paint()

    const visible = [
      ...field.querySelectorAll<HTMLElement>("[role='option']"),
    ].filter((o) => !o.hidden)
    expect(visible.map((o) => o.textContent)).toEqual(["Saltwater", "Sledge"])
    expect(
      (field.querySelector("[role='status']") as HTMLElement).textContent,
    ).toBe("2 matches")
  })
})

describe("lt.suggestion() writes what the web component would otherwise write", () => {
  it("writes hidden on the empty message when there are matches or the answer is on its way", () => {
    // That the list is closed is no longer checked here: the stylesheet hides
    // the message after a closed list, and "the empty message when the app
    // filters itself" checks that it is actually not shown on page load.
    expect(suggestion({ id: "k", keys: [] }).empty.hidden).toBe(undefined)
    expect(suggestion({ id: "k", keys: [], pending: true }).empty.hidden).toBe(
      true,
    )
    expect(
      suggestion({ id: "k", keys: ["a", "b"], open: true }).empty.hidden,
    ).toBe(true)
  })

  it("writes the highlight only when the list is open, both halves together", () => {
    const closed = suggestion({
      id: "k",
      keys: ["a", "b", "c"],
      activeIndex: 1,
    })
    expect(closed.options[1]["aria-selected"]).toBe("false")
    expect(closed.control["aria-activedescendant"]).toBeUndefined()

    const open = suggestion({
      id: "k",
      keys: ["a", "b", "c"],
      activeIndex: 1,
      open: true,
    })
    expect(open.options[1]["aria-selected"]).toBe("true")
    expect(open.control["aria-activedescendant"]).toBe("k-option-b")
  })
})

/*
 * Markup written without JavaScript: a label with `for`, a field with `id`,
 * a list with `<li>` and a status element, with no roles or wiring
 * otherwise. `for` and `id` are what HTML requires for the field to have a
 * name without JavaScript, and the web component never writes an id on the
 * field. It fills in the rest. The status element must be written: it is
 * content the server sends.
 */
const BARE = `
  <lt-suggestion>
    <label for="breaker">Breaker</label>
    <div>
      <input class="lt-input" id="breaker" name="breaker">
      <ul class="lt-suggestion__list">
        ${BREAKERS.map((k) => `<li>${k}</li>`).join("")}
      </ul>
      <p class="lt-suggestion__empty" hidden>No matches</p>
      <span class="lt-sr-only" role="status"></span>
    </div>
  </lt-suggestion>`

describe("lt-suggestion wires up from bare structure", () => {
  beforeAll(() => {
    defineLtSuggestion()
  })

  function parts() {
    return {
      field: document.querySelector("lt-suggestion") as LtSuggestion,
      label: document.querySelector("label") as HTMLLabelElement,
      input: document.querySelector("input") as HTMLInputElement,
      list: document.querySelector("ul") as HTMLElement,
      options: [...document.querySelectorAll<HTMLElement>("li")],
    }
  }

  it("sets roles, ids and wiring, and keeps the list closed", async () => {
    mount(BARE)
    await paint()
    const { field, label, input, list, options } = parts()

    expect(input.getAttribute("role")).toBe("combobox")
    expect(input.getAttribute("autocomplete")).toBe("off")
    expect(input.getAttribute("aria-autocomplete")).toBe("list")
    expect(input.id).toBe("breaker")
    expect(label.htmlFor).toBe("breaker")
    expect(label.classList.contains("lt-label")).toBe(true)
    expect(list.getAttribute("role")).toBe("listbox")
    expect(list.id).not.toBe("")
    expect(input.getAttribute("aria-controls")).toBe(list.id)
    expect(input.getAttribute("aria-expanded")).toBe("false")
    expect(list.hidden).toBe(true)
    for (const v of options) {
      expect(v.getAttribute("role")).toBe("option")
      expect(v.id).not.toBe("")
      expect(v.classList.contains("lt-suggestion__option")).toBe(true)
    }

    typeInto(field, "c")
    await waitForPaint()
    expect(list.hidden).toBe(false)
    expect(options.filter((v) => !v.hidden).map((v) => v.textContent)).toEqual([
      "Glasscutter",
      "Corkscrew",
    ])
    expect(document.querySelector("[role='status']")?.textContent).toBe(
      "2 matches",
    )

    await expectNoAccessibilityViolations()
  })

  it("leaves what the server wrote", async () => {
    mount(
      BARE.replace('<label for="breaker">', '<label for="own">')
        .replace(
          '<input class="lt-input" id="breaker" name="breaker">',
          '<input class="lt-input" name="breaker" id="own" aria-expanded="true">',
        )
        .replace(
          '<ul class="lt-suggestion__list">',
          '<ul class="lt-suggestion__list" id="own-list">',
        ),
    )
    await paint()
    const { label, input, list } = parts()

    expect(input.id).toBe("own")
    expect(label.htmlFor).toBe("own")
    expect(list.id).toBe("own-list")
    expect(input.getAttribute("aria-controls")).toBe("own-list")
    // The server said the list is open, and then it stays open.
    expect(input.getAttribute("aria-expanded")).toBe("true")
    expect(list.hidden).toBe(false)
  })

  it("sets the wiring back with the same ids after a patch", async () => {
    mount(BARE)
    await paint()
    const { label, input, list, options } = parts()
    const ids = [input.id, list.id, options[0].id]

    // The way a morph does it: everything not in the server's HTML is
    // removed. The field's id and the label's `for` were there, and stay.
    for (const name of [
      "role",
      "aria-controls",
      "aria-expanded",
      "autocomplete",
      "aria-autocomplete",
    ]) {
      input.removeAttribute(name)
    }
    for (const name of ["role", "id", "hidden"]) list.removeAttribute(name)
    for (const name of ["role", "id", "class"]) options[0].removeAttribute(name)
    await waitForPaint()

    expect([input.id, list.id, options[0].id]).toEqual(ids)
    expect(label.htmlFor).toBe(ids[0])
    expect(input.getAttribute("aria-controls")).toBe(ids[1])
    expect(options[0].getAttribute("role")).toBe("option")
    expect(list.hidden).toBe(true)
  })

  it("writes nothing on markup from lt.suggestion()", async () => {
    // The direct claim behind "what the server wrote stays": zero mutation
    // records from the web component's first round.
    const wrapper = document.createElement("div")
    wrapper.innerHTML = `
      <lt-suggestion>
        <label ${attr(SUGGESTION.label)}>Breaker</label>
        <div>
          <input ${attr(SUGGESTION.control)} name="breaker">
          <ul ${attr(SUGGESTION.list)}>
            ${SUGGESTION.options.map((o, i) => `<li ${attr(o)}>${BREAKERS[i]}</li>`).join("")}
          </ul>
          <p ${attr(SUGGESTION.empty)} hidden>No matches</p>
          <span ${attr(SUGGESTION.status)}></span>
        </div>
        <p class="lt-help-text" ${attr(SUGGESTION.help)}>Start typing</p>
      </lt-suggestion>`
    const host = wrapper.querySelector("lt-suggestion") as HTMLElement
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

describe("the empty message when the app filters itself", () => {
  beforeAll(() => {
    defineLtSuggestion()
  })

  /** The way a React app renders the field: only the matches, and `prefiltered`. */
  async function field(options: { keys: string[]; pending?: boolean }) {
    const built = suggestion({ id: "breaker", ...options })
    mount(`
      <lt-suggestion prefiltered>
        <label ${attr(built.label)}>Breaker</label>
        <div>
          <input ${attr(built.control)} name="breaker">
          <ul ${attr(built.list)}>${built.options
            .map((options, i) => `<li ${attr(options)}>Match ${i}</li>`)
            .join("")}</ul>
          <p ${attr(built.empty)}>No matches</p>
          <span ${attr(built.status)}></span>
        </div>
      </lt-suggestion>
    `)
    const host = await paint()
    return {
      input: host.querySelector("input") as HTMLInputElement,
      list: host.querySelector("ul") as HTMLElement,
      empty: host.querySelector(".lt-suggestion__empty") as HTMLElement,
    }
  }

  const isVisible = (element: HTMLElement) =>
    getComputedStyle(element).display !== "none"

  it("does not show the message while the list is closed, even without matches", async () => {
    // The app does not know whether the list is open: that state belongs to
    // the web component. The stylesheet hides the message after a list with
    // `hidden`.
    const { list, empty } = await field({ keys: [] })

    expect(list.hidden).toBe(true)
    expect(empty.hasAttribute("hidden")).toBe(false)
    expect(isVisible(empty)).toBe(false)
  })

  it("shows the message when the list opens and the search found nothing", async () => {
    const { input, list, empty } = await field({ keys: [] })

    input.focus()
    input.value = "xyz"
    input.dispatchEvent(new Event("input", { bubbles: true }))
    await paint()

    expect(list.hidden, "the list did not open").toBe(false)
    expect(isVisible(empty)).toBe(true)
  })

  it("keeps the message hidden while the answer is on its way", async () => {
    const { input, list, empty } = await field({ keys: [], pending: true })

    input.focus()
    input.value = "xyz"
    input.dispatchEvent(new Event("input", { bubbles: true }))
    await paint()

    expect(list.hidden).toBe(false)
    expect(isVisible(empty)).toBe(false)
  })

  it("hides the message when there are matches", async () => {
    const { empty } = await field({ keys: ["a", "b"] })
    expect(empty.hasAttribute("hidden")).toBe(true)
  })
})

describe("lt-suggestion when a patch replaces the field or the list", () => {
  beforeAll(() => {
    defineLtSuggestion()
  })

  it("never writes an id on a new field, and gives the list the id the field points to", async () => {
    /*
     * The web component used to invent an id for a new field without one. That
     * very id made the next update from the server replace the field, with
     * focus and what the user had typed. The list holds no state the user can
     * lose, and still gets the id the field already points to.
     */
    mount(`
      <lt-suggestion>
        <label>Breaker
          <input class="lt-input">
        </label>
        <div>
          <ul class="lt-suggestion__list"><li>Saltwater</li></ul>
          <p class="lt-suggestion__empty">No matches</p>
          <span class="lt-suggestion__status" role="status"></span>
        </div>
      </lt-suggestion>
    `)
    const host = await paint()
    const listId = (host.querySelector("input") as HTMLElement).getAttribute(
      "aria-controls",
    )

    const newField = document.createElement("input")
    newField.className = "lt-input"
    newField.setAttribute("aria-controls", listId ?? "")
    host.querySelector("input")?.replaceWith(newField)
    const newList = document.createElement("ul")
    newList.className = "lt-suggestion__list"
    newList.innerHTML = "<li>Glasscutter</li>"
    host.querySelector("ul")?.replaceWith(newList)
    await paint()

    expect(newField.hasAttribute("id")).toBe(false)
    expect(newList.id, "aria-controls points to nothing").toBe(listId)
  })
})

describe("lt-suggestion announces the count in the page's language", () => {
  beforeAll(() => {
    defineLtSuggestion()
  })

  /** The suggestion field on a page with `lang`, and the texts as attributes. */
  async function field(lang: string, attributes: string) {
    mount(`
      <div lang="${lang}">
        <lt-suggestion ${attributes}>
          <label ${attr(SUGGESTION.label)}>Breaker</label>
          <div>
            <input ${attr(SUGGESTION.control)} name="breaker">
            <ul ${attr(SUGGESTION.list)}>
              ${SUGGESTION.options.map((o, i) => `<li ${attr(o)}>${BREAKERS[i]}</li>`).join("\n")}
            </ul>
            <span ${attr(SUGGESTION.status)}></span>
          </div>
        </lt-suggestion>
      </div>
    `)
    return paint()
  }

  async function announced(element: LtSuggestion, text: string) {
    typeInto(element, text)
    await paint()
    return (element.querySelector("[role='status']") as HTMLElement).textContent
  }

  it("uses the form the language requires, with the number filled in", async () => {
    const element = await field(
      "en",
      'count-none="No results" count-one="{n} result" count-other="{n} results"',
    )

    expect(await announced(element, "cor")).toBe("1 result")
    expect(await announced(element, "s")).toBe("3 results")
    expect(await announced(element, "xyz")).toBe("No results")
  })

  it("falls back to count-other when a form is missing", async () => {
    // English has the form `one`. When only `count-other` is set, it must
    // apply to one match as well, rather than the announcement falling back to
    // the default text.
    const element = await field("en", 'count-other="{n} results"')

    expect(await announced(element, "cor")).toBe("1 results")
    expect(await announced(element, "xyz")).toBe("0 results")
  })

  it("picks the inflection by language, not by the number alone", async () => {
    // Polish has four forms. 2, 3 and 4 are `few`, and 1 is `one`.
    const element = await field(
      "pl",
      'count-one="{n} wynik" count-few="{n} wyniki" count-many="{n} wyników" count-other="{n} wyniku"',
    )

    expect(await announced(element, "s")).toBe("3 wyniki")
    expect(await announced(element, "cor")).toBe("1 wynik")
  })

  it("uses the default text when no text is set", async () => {
    const element = await field("en", "")

    expect(await announced(element, "cor")).toBe("One match")
    expect(await announced(element, "s")).toBe("3 matches")
  })
})

/**
 * Imitates the value tracking React adds to a controlled field: a `value`
 * of its own on the node that remembers the last value set through it, and
 * `onChange` only when the value from the prototype differs.
 */
function controlledByReact(field: HTMLInputElement | HTMLTextAreaElement) {
  const original = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(field),
    "value",
  ) as PropertyDescriptor
  let remembered = field.value
  Object.defineProperty(field, "value", {
    configurable: true,
    get() {
      return original.get?.call(this)
    },
    set(value) {
      remembered = `${value}`
      original.set?.call(this, value)
    },
  })
  const changes: string[] = []
  field.addEventListener("input", () => {
    const actual = original.get?.call(field) as string
    if (actual !== remembered) {
      remembered = actual
      changes.push(actual)
    }
  })
  return changes
}

describe("lt-suggestion with a field React controls", () => {
  beforeAll(() => {
    defineLtSuggestion()
  })

  for (const control of [
    '<input id="breaker" role="combobox" aria-controls="breaker-list" aria-expanded="false" aria-autocomplete="list">',
    '<textarea id="breaker" role="combobox" aria-controls="breaker-list" aria-expanded="false" aria-autocomplete="list"></textarea>',
  ]) {
    it(`gives onChange the chosen option (${control.slice(1, 6)})`, async () => {
      // Set directly on the node, React saw no change, and wrote the old text
      // back on the next render.
      mount(`
        <lt-suggestion>
          <label for="breaker">Breaker</label>
          <div>
            ${control}
            <ul class="lt-suggestion__list" role="listbox" id="breaker-list" hidden>
              <li role="option" id="breaker-0">Glasscutter</li>
              <li role="option" id="breaker-1">Saltwater</li>
            </ul>
          </div>
        </lt-suggestion>`)
      const field = document.getElementById("breaker") as
        | HTMLInputElement
        | HTMLTextAreaElement
      const changes = controlledByReact(field)
      await customElements.whenDefined("lt-suggestion")
      await waitForPaint()

      field.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      )
      await waitForPaint()
      field.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      )
      await waitForPaint()

      expect(field.value).toBe("Glasscutter")
      expect(changes).toEqual(["Glasscutter"])
    })
  }
})

/*
 * Markup the way a template writes it when the form should submit the code:
 * the options have `data-value`, and a hidden `.lt-suggestion__value` gets
 * the code.
 */
const WITH_CODE = `
  <lt-suggestion>
    <label for="breaker">Breaker</label>
    <div>
      <input class="lt-input" id="breaker" name="breaker-text">
      <input type="hidden" class="lt-suggestion__value" name="breaker">
      <ul class="lt-suggestion__list">
        <li data-value="LDG-101">Glasscutter</li>
        <li data-value="LDG-088">Corkscrew</li>
        <li data-value="LDG-064">Saltwater</li>
      </ul>
      <span class="lt-sr-only" role="status"></span>
    </div>
  </lt-suggestion>`

function press(input: HTMLElement, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  })
  input.dispatchEvent(event)
  return event
}

describe("lt-suggestion chooses correctly", () => {
  beforeAll(() => {
    defineLtSuggestion()
  })

  function parts() {
    return {
      input: document.getElementById("breaker") as HTMLInputElement,
      code: document.querySelector(".lt-suggestion__value") as HTMLInputElement,
      list: document.querySelector("ul") as HTMLElement,
      options: [...document.querySelectorAll<HTMLElement>("li")],
    }
  }

  it("shows the text in the field and puts the code in the value field and the event", async () => {
    mount(WITH_CODE)
    const host = await paint()
    const { input, code, options } = parts()
    const details: unknown[] = []
    host.addEventListener("suggestion-select", (e) =>
      details.push((e as CustomEvent).detail),
    )

    input.focus()
    options[0].click()
    await waitForPaint()

    expect(input.value).toBe("Glasscutter")
    expect(code.value).toBe("LDG-101")
    expect(details).toEqual([{ value: "LDG-101", label: "Glasscutter" }])
  })

  it("empties the value field when the user changes the text after a choice", async () => {
    // Otherwise the form would have submitted the code for Glasscutter with "Corkscrew" in the field.
    mount(WITH_CODE)
    await paint()
    const { input, code, options } = parts()

    input.focus()
    options[0].click()
    await waitForPaint()
    input.value = "Glasscutte"
    input.dispatchEvent(new Event("input", { bubbles: true }))
    await waitForPaint()

    expect(code.value).toBe("")
  })

  it("sets the code back when an update empties the value field", async () => {
    // The value field's `value` is an attribute, and a morph writes the
    // server's empty value over the code the user chose.
    mount(WITH_CODE)
    await paint()
    const { input, code, options } = parts()

    input.focus()
    options[2].click()
    await waitForPaint()
    code.removeAttribute("value")
    await waitForPaint()

    expect(input.value).toBe("Saltwater")
    expect(code.value).toBe("LDG-064")
  })

  it("leaves a different code from the server alone", async () => {
    // Only an emptied value is set back. A code the server sends, for instance
    // after looking up an ambiguous name, is the server's word.
    mount(WITH_CODE)
    await paint()
    const { input, code, options } = parts()

    input.focus()
    options[0].click()
    await waitForPaint()
    code.setAttribute("value", "LDG-102")
    await waitForPaint()
    await waitForPaint()

    expect(input.value).toBe("Glasscutter")
    expect(code.value).toBe("LDG-102")
  })

  it("dispatches input and change on the value field when the code is written and emptied", async () => {
    // Otherwise neither `data-bind` in Datastar nor the state in React sees the code.
    mount(WITH_CODE)
    await paint()
    const { input, code, options } = parts()
    const events: string[] = []
    for (const type of ["input", "change"])
      code.addEventListener(type, () => events.push(`${type}:${code.value}`))

    input.focus()
    options[0].click()
    input.value = "Glasscutte"
    input.dispatchEvent(new Event("input", { bubbles: true }))

    expect(events).toEqual([
      "input:LDG-101",
      "change:LDG-101",
      "input:",
      "change:",
    ])
  })

  it("closes an open list when the field becomes readonly", async () => {
    // The repair kept it open, and Escape does nothing in a locked field.
    mount(WITH_CODE)
    await paint()
    const { input, list } = parts()
    input.focus()
    press(input, "ArrowDown")
    await waitForPaint()
    expect(list.hidden).toBe(false)

    input.setAttribute("readonly", "")
    await waitForPaint()
    await waitForPaint()

    expect(list.hidden).toBe(true)
    expect(input.getAttribute("aria-expanded")).toBe("false")
  })

  it("chooses on click alone, and not on mousedown alone", async () => {
    /*
     * Assistive technology that activates an element sends `click`. The choice
     * used to happen on `mousedown`, and a `click` alone chose nothing.
     * `mousedown` still keeps focus in the field.
     */
    mount(WITH_CODE)
    await paint()
    const { input, options } = parts()
    input.focus()

    const down = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    })
    options[1].dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    expect(input.value).toBe("")

    options[1].click()
    expect(input.value).toBe("Corkscrew")
  })

  it("skips an option with aria-disabled, with keyboard and mouse", async () => {
    mount(
      WITH_CODE.replace(
        '<li data-value="LDG-101">Glasscutter</li>',
        '<li data-value="LDG-101" aria-disabled="true">Glasscutter</li>',
      ),
    )
    await paint()
    const { input, options } = parts()
    input.focus()

    options[0].click()
    expect(input.value).toBe("")

    press(input, "ArrowDown")
    press(input, "Enter")
    expect(input.value).toBe("Corkscrew")
  })

  it("does not open the list or change the value in a readonly field", async () => {
    mount(
      WITH_CODE.replace('name="breaker-text"', 'name="breaker-text" readonly'),
    )
    await paint()
    const { input, list, options } = parts()

    input.focus()
    press(input, "ArrowDown")
    press(input, "Enter")
    options[0].click()
    await waitForPaint()

    expect(list.hidden).toBe(true)
    expect(input.value).toBe("")
  })

  it("leaves the keys alone during IME composition", async () => {
    // Enter confirms the characters in the composition, and must not choose anything.
    mount(WITH_CODE)
    await paint()
    const { input } = parts()

    input.focus()
    press(input, "ArrowDown")
    const enter = press(input, "Enter", { isComposing: true })

    expect(enter.defaultPrevented).toBe(false)
    expect(input.value).toBe("")
  })

  it("goes to the first and last option with PgUp and PgDn, and leaves Home and End alone", async () => {
    mount(WITH_CODE)
    await paint()
    const { input, options } = parts()

    input.focus()
    press(input, "ArrowDown")
    press(input, "PageDown")
    expect(input.getAttribute("aria-activedescendant")).toBe(options[2].id)
    press(input, "PageUp")
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0].id)

    // Home and End move the caret in the text. The web component leaves them alone.
    expect(press(input, "Home").defaultPrevented).toBe(false)
    expect(press(input, "End").defaultPrevented).toBe(false)
  })

  it("finds the highlighted option again by its text when the list is replaced", async () => {
    // The list and the options get ids from the web component, and an update
    // that sends the list again replaces them. The highlight follows the text.
    mount(WITH_CODE)
    await paint()
    const { input, list } = parts()
    input.focus()
    press(input, "ArrowDown")
    press(input, "ArrowDown")
    await waitForPaint()
    expect(parts().options[1].getAttribute("aria-selected")).toBe("true")

    const replacement = document.createElement("ul")
    replacement.className = "lt-suggestion__list"
    replacement.innerHTML = `<li data-value="LDG-101">Glasscutter</li><li data-value="LDG-088">Corkscrew</li><li data-value="LDG-064">Saltwater</li>`
    list.replaceWith(replacement)
    await waitForPaint()
    await waitForPaint()

    const corkscrew = [...replacement.querySelectorAll("li")].find(
      (li) => li.textContent === "Corkscrew",
    ) as HTMLElement
    expect(corkscrew.getAttribute("aria-selected")).toBe("true")
    expect(corkscrew.id).not.toBe("")
    expect(input.getAttribute("aria-activedescendant")).toBe(corkscrew.id)
  })

  it("writes the number of matches again when an update empties the status element", async () => {
    // The text is not in the server's version, so without this the template
    // would have to write Datastar's `data-ignore-morph`, which means nothing to
    // htmx.
    mount(WITH_CODE)
    await paint()
    const { input } = parts()
    const status = document.querySelector("[role='status']") as HTMLElement
    input.focus()
    input.value = "C"
    input.dispatchEvent(new Event("input", { bubbles: true }))
    await waitForPaint()
    const announcedText = status.textContent
    expect(announcedText).not.toBe("")

    status.textContent = ""
    await waitForPaint()
    await waitForPaint()

    expect(status.textContent).toBe(announcedText)
  })

  it("places the list right below the field also when the help text comes after", async () => {
    // The host is the positioning box. Without its own `inset-block-start`
    // the list gets its static position, right after the field in the flow, and
    // not below the help text.
    mount(
      WITH_CODE.replace(
        "</lt-suggestion>",
        '<p class="lt-help-text">We fill in the rest of the address for you.</p></lt-suggestion>',
      ),
    )
    await paint()
    const { input, list } = parts()
    const help = document.querySelector(".lt-help-text") as HTMLElement
    input.focus()
    press(input, "ArrowDown")
    await waitForPaint()

    const field = input.getBoundingClientRect()
    const box = list.getBoundingClientRect()
    expect(list.hidden).toBe(false)
    expect(box.top).toBeGreaterThanOrEqual(field.bottom)
    expect(box.top - field.bottom).toBeLessThan(12)
    expect(help.getBoundingClientRect().top).toBeLessThan(box.bottom)
  })

  it("tells two options with the same text apart by code when the list is replaced", async () => {
    mount(
      WITH_CODE.replace(
        '<li data-value="LDG-064">Saltwater</li>',
        '<li data-value="LDG-042">Needle</li><li data-value="LDG-043">Needle</li>',
      ),
    )
    await paint()
    const { input, list } = parts()
    input.focus()
    for (let i = 0; i < 4; i += 1) press(input, "ArrowDown")
    await waitForPaint()
    expect(parts().options[3].getAttribute("aria-selected")).toBe("true")

    const replacement = list.cloneNode(true) as HTMLElement
    for (const li of replacement.querySelectorAll("li")) {
      li.removeAttribute("id")
      li.removeAttribute("aria-selected")
    }
    list.replaceWith(replacement)
    await waitForPaint()
    await waitForPaint()

    const chosen = replacement.querySelector(
      '[aria-selected="true"]',
    ) as HTMLElement
    expect(chosen.getAttribute("data-value")).toBe("LDG-043")
  })

  it("sets the code back to the server's when the form is reset", async () => {
    // A hidden field has no default value to go back to, since the code is
    // written as an attribute. Without this the form submitted the code for
    // Corkscrew with empty text after a reset.
    mount(
      `<form>${WITH_CODE.replace('name="breaker-text"', 'name="breaker-text" value="Glasscutter"').replace('class="lt-suggestion__value" name="breaker"', 'class="lt-suggestion__value" name="breaker" value="LDG-101"')}</form>`,
    )
    await paint()
    const { input, code, options } = parts()
    input.focus()
    options[1].click()
    await waitForPaint()
    expect(input.value).toBe("Corkscrew")
    expect(code.value).toBe("LDG-088")

    ;(document.querySelector("form") as HTMLFormElement).reset()
    await new Promise((r) => setTimeout(r, 20))
    await waitForPaint()

    expect(input.value).toBe("Glasscutter")
    expect(code.value).toBe("LDG-101")

    // And with no code from the server: empty.
    mount(`<form>${WITH_CODE}</form>`)
    await paint()
    const second = parts()
    second.input.focus()
    second.options[0].click()
    await waitForPaint()
    ;(document.querySelector("form") as HTMLFormElement).reset()
    await new Promise((r) => setTimeout(r, 20))
    await waitForPaint()
    expect(second.input.value).toBe("")
    expect(second.code.value).toBe("")
  })

  it("writes for from the field's id, and reports it, when the label pointed elsewhere", async () => {
    // Same rule as in <lt-field>: `for` and `id` are the same information.
    // But without JavaScript the field had no label, so it must be reported.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    mount(WITH_CODE.replace('for="breaker"', 'for="wrong"'))
    await paint()
    await new Promise((r) => setTimeout(r, 300))
    expect((document.querySelector("label") as HTMLLabelElement).htmlFor).toBe(
      "breaker",
    )
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain("pointed to a different id")
    warn.mockRestore()
  })

  it("does not let the events on the value field bubble to the host", async () => {
    // The recipe fetches suggestions with `data-on:input` on <lt-suggestion>.
    // Had the code fired it, every choice would have searched for "LDG-101".
    mount(WITH_CODE)
    const host = await paint()
    const { input, options } = parts()
    const onHost: string[] = []
    host.addEventListener("input", (e) =>
      onHost.push((e.target as HTMLInputElement).name),
    )
    host.addEventListener("change", (e) =>
      onHost.push((e.target as HTMLInputElement).name),
    )

    input.focus()
    options[0].click()
    await waitForPaint()

    expect(onHost).toEqual(["breaker-text", "breaker-text"])
  })

  it("keeps the code on reset when the server has sent the choice back", async () => {
    // With htmx the server sends the text and the code back. Then the chosen
    // one is also the form's default value, and a reset must land there.
    mount(`<form>${WITH_CODE}</form>`)
    await paint()
    const { input, code, options } = parts()
    input.focus()
    options[0].click()
    await waitForPaint()
    // The server's answer: both values as attributes, the way a morph writes them.
    input.setAttribute("value", "Glasscutter")
    code.setAttribute("value", "LDG-101")
    await waitForPaint()
    await waitForPaint()

    ;(document.querySelector("form") as HTMLFormElement).reset()
    await new Promise((r) => setTimeout(r, 20))
    await waitForPaint()

    expect(input.value).toBe("Glasscutter")
    expect(code.value).toBe("LDG-101")
  })

  it("finds the code from the option when the text after reset is a different choice", async () => {
    // The server sent Corkscrew back after the user chose it, and the user kept
    // typing. The reset gives "Corkscrew", and the code follows the option.
    mount(`<form>${WITH_CODE}</form>`)
    await paint()
    const { input, code, options } = parts()
    input.focus()
    options[1].click()
    await waitForPaint()
    input.setAttribute("value", "Corkscrew")
    code.setAttribute("value", "LDG-088")
    await waitForPaint()
    input.value = "Cork"
    input.dispatchEvent(new Event("input", { bubbles: true }))
    await waitForPaint()
    expect(code.value).toBe("")

    ;(document.querySelector("form") as HTMLFormElement).reset()
    await new Promise((r) => setTimeout(r, 20))
    await waitForPaint()

    expect(input.value).toBe("Corkscrew")
    expect(code.value).toBe("LDG-088")
  })

  it("does not write the count back when something else filters", async () => {
    // A patch is then the answer to a keystroke, and `announceFiltered`
    // announces the new count right after. Two numbers in a row are noise.
    mount(WITH_CODE.replace("<lt-suggestion>", "<lt-suggestion prefiltered>"))
    await paint()
    const { input, list } = parts()
    const status = document.querySelector("[role='status']") as HTMLElement
    input.focus()
    list.removeChild(list.children[2])
    await waitForPaint()
    await waitForPaint()
    expect(status.textContent).not.toBe("")

    status.textContent = ""
    await waitForPaint()
    await waitForPaint()

    expect(status.textContent).toBe("")
  })

  it("says nothing when the label wraps the whole element", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    mount(
      `<label>Breaker <lt-suggestion><input class="lt-input" name="breaker"><ul class="lt-suggestion__list"><li>Glasscutter</li></ul><span class="lt-sr-only" role="status"></span></lt-suggestion></label>`,
    )
    await paint()
    await new Promise((r) => setTimeout(r, 300))
    expect(
      (document.querySelector("input") as HTMLInputElement).labels?.length,
    ).toBe(1)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it("follows the form when form on the field points to another", async () => {
    // The `reset` listener belongs to the form the field belongs to now.
    // `form` on the field can point to another form without anything moving,
    // and a patch can change it.
    mount(`<form id="a">${WITH_CODE}</form><form id="b"></form>`)
    await paint()
    const { input, code, options } = parts()
    input.focus()
    options[0].click()
    await waitForPaint()
    expect(code.value).toBe("LDG-101")

    input.setAttribute("form", "b")
    await waitForPaint()
    await waitForPaint()
    input.value = "Glass"
    input.dispatchEvent(new Event("input", { bubbles: true }))
    await waitForPaint()
    expect(code.value).toBe("")
    input.value = "Glasscutter"
    code.setAttribute("value", "LDG-101")
    await waitForPaint()
    ;(document.getElementById("b") as HTMLFormElement).reset()
    await new Promise((r) => setTimeout(r, 20))
    await waitForPaint()

    // The text goes back to empty, and the code follows.
    expect(input.value).toBe("")
    expect(code.value).toBe("")
  })

  it("does not write the count back when the list is closed", async () => {
    // Every patch of the region would otherwise announce the old count again.
    mount(WITH_CODE)
    await paint()
    const { input } = parts()
    const status = document.querySelector("[role='status']") as HTMLElement
    input.focus()
    input.value = "C"
    input.dispatchEvent(new Event("input", { bubbles: true }))
    await waitForPaint()
    expect(status.textContent).not.toBe("")
    press(input, "Escape")
    await waitForPaint()

    status.textContent = ""
    await waitForPaint()
    await waitForPaint()

    expect(status.textContent).toBe("")
  })

  it("gives the code back as soon as the user types the chosen text again", async () => {
    // After a morph emptied both text and code, as idiomorph does without
    // ignoreActiveValue, the code must not wait for some random next patch.
    mount(WITH_CODE)
    await paint()
    const { input, code, options } = parts()
    input.focus()
    options[0].click()
    await waitForPaint()
    input.value = ""
    code.setAttribute("value", "")
    await waitForPaint()
    await waitForPaint()
    expect(code.value).toBe("")

    input.value = "Glasscutter"
    input.dispatchEvent(new Event("input", { bubbles: true }))

    expect(code.value).toBe("LDG-101")
  })

  it("says nothing about a field without an id that is named by aria-labelledby", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    mount(
      `<lt-suggestion><label id="l">Breaker</label><input class="lt-input" name="breaker" aria-labelledby="l"><ul class="lt-suggestion__list"><li>Glasscutter</li></ul><span class="lt-sr-only" role="status"></span></lt-suggestion>`,
    )
    await paint()
    await new Promise((r) => setTimeout(r, 300))
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it("goes back to the server's Needle when the user had chosen the other one", async () => {
    // Two options with the same text: on reset the text is the server's, and
    // then the server's code applies, not the one the user chose.
    mount(
      `<form>${WITH_CODE.replace(
        'name="breaker-text"',
        'name="breaker-text" value="Needle"',
      )
        .replace(
          'class="lt-suggestion__value" name="breaker"',
          'class="lt-suggestion__value" name="breaker" value="LDG-043"',
        )
        .replace(
          '<li data-value="LDG-064">Saltwater</li>',
          '<li data-value="LDG-042">Needle</li><li data-value="LDG-043">Needle</li>',
        )}</form>`,
    )
    await paint()
    const { input, code, options } = parts()
    input.focus()
    options[2].click()
    await waitForPaint()
    expect(code.value).toBe("LDG-042")

    ;(document.querySelector("form") as HTMLFormElement).reset()
    await new Promise((r) => setTimeout(r, 20))
    await waitForPaint()

    expect(input.value).toBe("Needle")
    expect(code.value).toBe("LDG-043")
  })

  it("gives a label outside the element the class, as lt-field does", async () => {
    mount(
      `<label for="breaker">Breaker</label><lt-suggestion><input class="lt-input" id="breaker"><ul class="lt-suggestion__list"><li>Glasscutter</li></ul><span class="lt-sr-only" role="status"></span></lt-suggestion>`,
    )
    await paint()
    expect(
      document.querySelector("label")?.classList.contains("lt-label"),
    ).toBe(true)
  })
})

describe("lt-suggestion through a morph from the server", () => {
  beforeAll(() => {
    defineLtSuggestion()
  })

  /** The recipe on the component page, with `options` in the list. */
  const recipe = (
    options = "<li>Crowbar</li><li>Needle</li>",
    host = "",
    input = "",
  ) => `<lt-suggestion id="breaker-search"${host}>
    <label class="lt-label" for="breaker">Breaker</label>
    <input class="lt-input" id="breaker" name="breaker" type="text"${input}>
    <ul class="lt-suggestion__list">${options}</ul>
    <p class="lt-suggestion__empty">No matches</p>
    <span class="lt-sr-only" role="status"></span>
  </lt-suggestion>`
  const input = () => document.getElementById("breaker") as HTMLInputElement
  const list = () =>
    document.querySelector(".lt-suggestion__list") as HTMLElement
  const status = () => document.querySelector("[role='status']") as HTMLElement
  const shown = () =>
    [...list().querySelectorAll("li")]
      .filter((o) => !o.hidden)
      .map((o) => o.textContent)

  it("filters an open list an update changed under server-controlled", async () => {
    /*
     * `server-controlled` is about whether the list is open and what is
     * highlighted, not what matches. The repair returned before the filter,
     * so the list showed every option the server sent.
     */
    const controlled = recipe(
      '<li id="breaker-option-crowbar">Crowbar</li><li id="breaker-option-needle" aria-selected="true">Needle</li>',
      " server-controlled",
      ' role="combobox" aria-expanded="true" aria-controls="breaker-list" aria-activedescendant="breaker-option-needle"',
    ).replace(
      '<ul class="lt-suggestion__list">',
      '<ul class="lt-suggestion__list" id="breaker-list">',
    )
    mount(controlled)
    const field = await paint()
    input().focus()
    typeInto(field, "c")
    await paint()

    datastarPatch(controlled)
    await paint()

    expect(shown()).toEqual(["Crowbar"])
  })

  it("announces nothing on focus over a list with nothing to show", async () => {
    // The filter came before `setOpen`, which keeps an empty list closed,
    // and announced "No matches" for it.
    mount(recipe())
    await paint()
    datastarPatch(recipe(""))
    await paint()

    input().focus()
    await paint()

    expect(list().hidden).toBe(true)
    expect(status().textContent).toBe("")
  })

  it("announces no count for a list an update closes by locking the field", async () => {
    /*
     * The update removes `prefiltered` and makes the field readonly. The
     * count was taken before the morph had replaced the options, and for a
     * list the same update closed.
     */
    mount(recipe())
    await paint()
    const prefiltered = recipe("<li>Needle</li>", " prefiltered").replace(
      '<p class="lt-suggestion__empty">',
      '<p class="lt-suggestion__empty" hidden>',
    )
    replace("outerHTML", "breaker-search", prefiltered)
    await paint()
    input().focus()
    await paint()

    datastarPatch(recipe(undefined, "", " readonly"))
    await paint()

    expect(list().hidden).toBe(true)
    expect(status().textContent).toBe("")
  })
})
