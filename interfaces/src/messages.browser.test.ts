import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { defineLtDialog } from "./components/frame/dialog/lt-dialog"
import { defineLtErrorSummary } from "./components/frame/error-summary/lt-error-summary"
import { defineLtField } from "./components/frame/field/lt-field"
import { defineLtPopover } from "./components/frame/popover/lt-popover"
import { defineLtSessionTimeout } from "./components/frame/session-timeout/lt-session-timeout"
import { defineLtSuggestion } from "./components/frame/suggestion/lt-suggestion"
import { defineLtTabs } from "./components/frame/tabs/lt-tabs"
import { mount, waitForPaint } from "./testing/a11y"

/**
 * That a component speaks up when the markup it was given does not hold
 * together, and only then.
 *
 * The components attach behaviour to markup someone else wrote, and that
 * markup can come from a Go template, a PHP file or a publishing system where
 * no TypeScript compiler is looking. If the component did not find its
 * parts, it did nothing, without a word. The error only showed when someone
 * read the page with a screen reader.
 *
 * The test that matters most is the last one: that correct markup produces
 * not a single word. A warning that also comes when everything is fine gets
 * switched off, and then it is worthless.
 */

/**
 * The warning only comes once the page has settled, that is after two
 * frames. Here we wait two rounds, so the check is done whichever of them
 * was scheduled first.
 */
async function waitUntilSettled(): Promise<void> {
  await waitForPaint()
  await waitForPaint()
}

function messages(warn: { mock: { calls: unknown[][] } }): string[] {
  return warn.mock.calls.map((call) => String(call[0]))
}

describe("the component reports markup that does not hold together", () => {
  beforeAll(() => {
    defineLtField()
    defineLtSuggestion()
    defineLtPopover()
    defineLtTabs()
    defineLtErrorSummary()
    defineLtDialog()
    defineLtSessionTimeout()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function listen() {
    return vi.spyOn(console, "warn").mockImplementation(() => {})
  }

  it("a mark the component writes, copied into the template", async () => {
    const warn = listen()

    mount(`
      <lt-field>
        <label class="lt-label" for="copied">Fixer's address</label>
        <input class="lt-input" id="copied" aria-invalid="true" data-lt-written="aria-invalid" />
      </lt-field>
      <lt-tabs>
        <ul class="lt-tabs__list" aria-label="Parts">
          <li><a href="#copied-a" aria-selected="true" data-lt-written="aria-selected">A</a></li>
        </ul>
        <section class="lt-tabs__panel" id="copied-a">A</section>
      </lt-tabs>
    `)
    await waitUntilSettled()

    const said = messages(warn).filter((m) => m.includes("data-lt-written"))
    expect(said.map((m) => m.split(":")[0]).sort()).toEqual([
      "lt-field",
      "lt-tabs",
    ])
  })

  it("the field without a control", async () => {
    const warn = listen()

    mount(`
      <lt-field>
        <label class="lt-label">Fixer's address</label>
        <p class="lt-help-text">The board writes to the fixer, never to the crew.</p>
      </lt-field>
    `)
    await waitUntilSettled()

    expect(messages(warn).some((m) => m.includes("found no control"))).toBe(
      true,
    )
  })

  it("the field without a label", async () => {
    const warn = listen()

    mount(`
      <lt-field>
        <input class="lt-input" />
      </lt-field>
    `)
    await waitUntilSettled()

    expect(messages(warn).some((m) => m.includes("<label>"))).toBe(true)
  })

  it("but not when the field gets its name from aria-label", async () => {
    // A search field with only an icon has no visible label, and that is a
    // valid solution. A warning there would be wrong.
    const warn = listen()

    mount(`
      <lt-field>
        <input class="lt-input lt-search" type="search" aria-label="Search the catalogue" />
      </lt-field>
    `)
    await waitUntilSettled()

    expect(warn).not.toHaveBeenCalled()
  })

  it("but not when the label is outside the element", async () => {
    // A `<label for>` outside `<lt-field>` names the field just as well, and
    // the component connects it the same way as one inside.
    const warn = listen()

    const surface = mount(`
      <div>
        <label class="lt-label" for="fixer" data-required="symbol">Fixer's address</label>
        <lt-field>
          <input class="lt-input" id="fixer" type="email" />
        </lt-field>
      </div>
    `)
    await waitUntilSettled()

    const label = surface.querySelector("label") as HTMLLabelElement
    expect(warn).not.toHaveBeenCalled()
    expect(label.getAttribute("data-required")).toBe("symbol")
  })

  it("the field with more than one control", async () => {
    // Only the first control gets the wiring. The second has no label, and
    // that must be reported.
    const warn = listen()

    mount(`
      <lt-field>
        <label class="lt-label">Search</label>
        <input class="lt-input" type="search" />
        <select class="lt-select"><option>All</option></select>
      </lt-field>
    `)
    await waitUntilSettled()

    expect(
      messages(warn).filter((m) => m.includes("more than one control")),
    ).toHaveLength(1)
  })

  it("the label that neither has for nor wraps the field", async () => {
    /*
     * Without JavaScript the field then has no label. The component does not
     * create the id itself: an id the server did not send makes a server
     * update replace the field, along with focus and what the user has typed.
     */
    const warn = listen()

    const surface = mount(`
      <lt-field>
        <label class="lt-label">Fixer's address</label>
        <input class="lt-input" type="email" />
      </lt-field>
    `)
    await waitUntilSettled()

    expect(
      messages(warn).filter((m) => m.includes("is not connected to the field")),
    ).toHaveLength(1)
    expect(surface.querySelector("input")?.hasAttribute("id")).toBe(false)
  })

  it("but not when the label wraps the field", async () => {
    const warn = listen()

    mount(`
      <lt-field>
        <label class="lt-label">Fixer's address <input class="lt-input" type="email" /></label>
      </lt-field>
    `)
    await waitUntilSettled()

    expect(warn).not.toHaveBeenCalled()
  })

  it("the field that was replaced because the id from the server changed", async () => {
    /*
     * A template that builds the id from a random number or a counter gives a
     * new id on every render, and a server update then does not recognise the
     * field. What the user typed is lost.
     */
    const warn = listen()

    const surface = mount(`
      <lt-field>
        <label class="lt-label" for="codename-1">Codename</label>
        <input class="lt-input" id="codename-1" name="codename" />
      </lt-field>
    `)
    await waitUntilSettled()

    const old = surface.querySelector("input") as HTMLInputElement
    old.value = "Glass"
    const replacement = document.createElement("input")
    replacement.className = "lt-input"
    replacement.id = "codename-2"
    replacement.name = "codename"
    const label = surface.querySelector("label") as HTMLLabelElement
    label.htmlFor = "codename-2"
    old.replaceWith(replacement)
    await waitUntilSettled()

    expect(
      messages(warn).filter((m) =>
        m.includes("control's id was different from last time"),
      ),
    ).toHaveLength(1)
  })

  it("but not when the server sent a different field on purpose", async () => {
    const warn = listen()

    const surface = mount(`
      <lt-field>
        <label class="lt-label" for="codename">Codename</label>
        <input class="lt-input" id="codename" name="codename" />
      </lt-field>
    `)
    await waitUntilSettled()

    const old = surface.querySelector("input") as HTMLInputElement
    old.value = "Glass"
    const replacement = document.createElement("input")
    replacement.className = "lt-input"
    replacement.id = "fixer"
    replacement.name = "fixer"
    const label = surface.querySelector("label") as HTMLLabelElement
    label.htmlFor = "fixer"
    old.replaceWith(replacement)
    await waitUntilSettled()

    expect(warn).not.toHaveBeenCalled()
  })

  it("but not when the second control is in a field inside", async () => {
    // A field in a field is ordinary markup: a search field in a popover
    // inside the field. Each field then has its own control.
    const warn = listen()

    mount(`
      <lt-field>
        <label class="lt-label" for="target">Target</label>
        <input class="lt-input" id="target" type="text" />
        <div popover>
          <lt-field>
            <label class="lt-label">Search the list <input class="lt-input" type="search" /></label>
          </lt-field>
        </div>
      </lt-field>
    `)
    await waitUntilSettled()

    expect(warn).not.toHaveBeenCalled()
  })

  it("the dialog without a name", async () => {
    // No aria-labelledby, no aria-label, and the only heading is in the
    // body, where it belongs to the content and not to the dialog.
    const warn = listen()

    mount(`
      <lt-dialog>
        <dialog>
          <div class="lt-dialog__body"><h3>Floor plans</h3><p>Two floor plans.</p></div>
        </dialog>
      </lt-dialog>
    `)
    await waitUntilSettled()

    expect(
      messages(warn).filter((m) => m.includes("has no name")),
    ).toHaveLength(1)
  })

  it("but not about an empty dialog the server has not filled yet", async () => {
    const warn = listen()

    mount(`
      <lt-dialog>
        <dialog></dialog>
      </lt-dialog>
    `)
    await waitUntilSettled()

    expect(warn).not.toHaveBeenCalled()
  })

  it("the tabs without links", async () => {
    // The tabs are links to the panels. A row with only buttons, as the tabs
    // used to be, has no tabs the component can connect.
    const warn = listen()

    mount(`
      <lt-tabs>
        <ul class="lt-tabs__list">
          <li><button>Claim</button></li>
          <li><button>Attachments</button></li>
        </ul>
      </lt-tabs>
    `)
    await waitUntilSettled()

    expect(messages(warn).some((m) => m.includes("found no tabs"))).toBe(true)
  })

  it("tabs without a panel", async () => {
    const warn = listen()

    mount(`
      <lt-tabs>
        <ul class="lt-tabs__list">
          <li><a href="#claim">Claim</a></li>
          <li><a href="#attachments">Attachments</a></li>
        </ul>
        <section class="lt-tabs__panel" id="claim"><h2>Claim</h2>Claim AV-2079-0481 was filed on 4 March 2079.</section>
      </lt-tabs>
    `)
    await waitUntilSettled()

    expect(messages(warn).some((m) => m.includes("tabs without a panel"))).toBe(
      true,
    )
  })

  it("the dialog without a <dialog>", async () => {
    const warn = listen()

    mount(`
      <lt-dialog>
        <div class="lt-dialog">
          <h2 class="lt-dialog__title">Cancel job 222-0481?</h2>
        </div>
      </lt-dialog>
    `)
    await waitUntilSettled()

    expect(messages(warn).some((m) => m.includes("<dialog>"))).toBe(true)
  })

  it("the session timeout without a <dialog>", async () => {
    const warn = listen()

    mount(`
      <lt-session-timeout>
        <div class="lt-session-timeout__dialog">
          <h2>Your session is ending</h2>
        </div>
      </lt-session-timeout>
    `)
    await waitUntilSettled()

    expect(messages(warn).some((m) => m.includes("<dialog>"))).toBe(true)
  })

  it("the session timeout without a count, announcement or buttons", async () => {
    const warn = listen()

    mount(`
      <lt-session-timeout>
        <dialog>
          <h2>Your session is ending</h2>
          <p>Your session on the Lattice ends soon.</p>
        </dialog>
      </lt-session-timeout>
    `)
    await waitUntilSettled()

    const said = messages(warn)
    expect(said.some((m) => m.includes(".lt-session-timeout__count"))).toBe(
      true,
    )
    expect(said.some((m) => m.includes("[role=status]"))).toBe(true)
    expect(said.some((m) => m.includes('<form method="dialog">'))).toBe(true)
  })

  it("the suggestion field without a field", async () => {
    // An `<input>` is enough: the component gives it the role. Without a
    // field at all it finds nothing to listen to.
    const warn = listen()

    mount(`
      <lt-suggestion>
        <label class="lt-label">Breaker</label>
        <ul class="lt-suggestion__list"><li>Crowbar</li></ul>
      </lt-suggestion>
    `)
    await waitUntilSettled()

    expect(messages(warn).some((m) => m.includes("combobox"))).toBe(true)
  })

  it("the suggestion field without a listbox", async () => {
    const warn = listen()

    mount(`
      <lt-suggestion>
        <label class="lt-label" for="breaker">Breaker</label>
        <input class="lt-input" id="breaker" role="combobox"
               aria-expanded="false" aria-autocomplete="list" />
      </lt-suggestion>
    `)
    await waitUntilSettled()

    expect(messages(warn).some((m) => m.includes("listbox"))).toBe(true)
  })

  it("the suggestion field without a status element", async () => {
    // The number of matches is announced in the status element. Without it
    // the component stayed silent, and someone who cannot see the screen
    // never learnt that the list narrowed.
    const warn = listen()

    mount(`
      <lt-suggestion>
        <label class="lt-label" for="breaker">Breaker</label>
        <input class="lt-input" id="breaker" role="combobox"
               aria-expanded="false" aria-controls="breakers" aria-autocomplete="list" />
        <ul class="lt-suggestion__list" id="breakers" role="listbox" hidden>
          <li class="lt-suggestion__option" id="breaker-0" role="option">Crowbar</li>
        </ul>
      </lt-suggestion>
    `)
    await waitUntilSettled()

    expect(messages(warn).some((m) => m.includes('[role="status"]'))).toBe(true)
  })

  it("the popover without a panel", async () => {
    const warn = listen()

    mount(`
      <lt-popover>
        <button class="lt-button">Actions</button>
      </lt-popover>
    `)
    await waitUntilSettled()

    expect(messages(warn).some((m) => m.includes("found no panel"))).toBe(true)
  })

  it("the popover with a panel without an id", async () => {
    // The component never writes an id on the panel, so the button cannot be connected.
    const warn = listen()

    mount(`
      <lt-popover>
        <button class="lt-button">Actions</button>
        <div class="lt-popover">Mark LDG-117 returned</div>
      </lt-popover>
    `)
    await waitUntilSettled()

    const reported = messages(warn).filter((m) =>
      m.includes("the panel has no id"),
    )
    expect(reported).toHaveLength(1)
  })

  it("the popover without a button", async () => {
    // A button outside the panel is enough: the component connects it.
    // Without a single one, or with only one pointing to something else, it
    // finds none.
    const warn = listen()

    mount(`
      <lt-popover>
        <a href="/actions" class="lt-link">Actions</a>
        <div popover id="actions" class="lt-popover">Mark LDG-117 returned</div>
      </lt-popover>
    `)
    await waitUntilSettled()

    expect(messages(warn).some((m) => m.includes("found no button"))).toBe(true)
  })

  it("the error summary with items that link nowhere", async () => {
    const warn = listen()

    mount(`
      <lt-error-summary class="lt-error-summary" role="alert" tabindex="-1">
        <h2 class="lt-error-summary__title">The form has one error</h2>
        <ul class="lt-list"><li>Enter a valid address</li></ul>
      </lt-error-summary>
    `)
    await waitUntilSettled()

    expect(messages(warn).some((m) => m.includes("found no links"))).toBe(true)
  })

  it("the error summary with a heading without an id", async () => {
    // The box takes focus, and the heading names it only through an id the
    // template writes; the component writes none.
    const warn = listen()

    mount(`
      <lt-error-summary class="lt-error-summary" role="alert" tabindex="-1">
        <h2 class="lt-error-summary__title">The form has one error</h2>
        <ul class="lt-list"><li><a href="#fixer-m">Enter the fixer's address with an @</a></li></ul>
      </lt-error-summary>
      <input id="fixer-m">
    `)
    await waitUntilSettled()

    expect(
      messages(warn).filter((m) => m.includes("heading without an id")),
    ).toHaveLength(1)
  })

  it("the error summary with links that point to nothing", async () => {
    // Without a click. A link that leads nowhere is just as broken if nobody
    // tries it, and whoever reads the summary has just failed with a form.
    // Each link reports itself.
    const warn = listen()

    mount(`
      <lt-error-summary class="lt-error-summary" role="alert" tabindex="-1">
        <h2 class="lt-error-summary__title">The form has two errors</h2>
        <ul class="lt-list">
          <li><a href="#does-not-exist">Enter a valid address</a></li>
          <li><a href="#nor-this">Choose a breaker</a></li>
        </ul>
      </lt-error-summary>
    `)
    await waitUntilSettled()

    const said = messages(warn)
    expect(said.some((m) => m.includes("#does-not-exist"))).toBe(true)
    expect(said.some((m) => m.includes("#nor-this"))).toBe(true)
  })

  it("says it once, not once per sync", async () => {
    const warn = listen()

    const surface = mount(`
      <lt-field>
        <label class="lt-label">Fixer's address</label>
      </lt-field>
    `)
    const field = surface.querySelector("lt-field") as HTMLElement
    await waitUntilSettled()

    // Every change to the children triggers a new sync, as a patch does.
    for (let n = 0; n < 5; n += 1) {
      field.append(document.createElement("span"))
      await waitUntilSettled()
    }

    expect(
      messages(warn).filter((m) => m.includes("found no control")),
    ).toHaveLength(1)
  })

  it("also says it only once when the panels arrive one at a time", async () => {
    /*
     * The message must be the same every round.
     *
     * If the numbers were in the text, as in "has 3 tabs but 1 panels", each
     * round would be a new message, and the deduplication was gone: three
     * panels arriving one at a time gave three warnings.
     */
    const warn = listen()

    const surface = mount(`
      <lt-tabs>
        <ul class="lt-tabs__list" aria-label="Parts of the claim">
          <li><a href="#one">One</a></li>
          <li><a href="#two">Two</a></li>
          <li><a href="#three">Three</a></li>
        </ul>
      </lt-tabs>
    `)
    const tabs = surface.querySelector("lt-tabs") as HTMLElement
    await waitUntilSettled()

    // Two of three panels, one at a time. The third tab has no panel throughout.
    for (const id of ["one", "two"]) {
      const panel = document.createElement("section")
      panel.className = "lt-tabs__panel"
      panel.id = id
      tabs.append(panel)
      await waitUntilSettled()
    }

    expect(
      messages(warn).filter((m) => m.includes("tabs without a panel")),
    ).toHaveLength(1)
  })

  it("says nothing about markup that is completed in the next round", async () => {
    /*
     * HTML streamed from a server arrives in chunks, and a break between the
     * label and the field is entirely normal. The component sees its markup
     * the moment it is connected, and there it is half finished. The warning
     * waits until the page has settled, and checks again.
     */
    const warn = listen()

    const surface = mount(`
      <lt-field>
        <label class="lt-label" for="fixer">Fixer's address</label>
      </lt-field>
    `)
    const control = document.createElement("input")
    control.className = "lt-input"
    control.id = "fixer"
    surface.querySelector("lt-field")?.append(control)

    await waitUntilSettled()

    expect(warn).not.toHaveBeenCalled()
  })

  it("says nothing about an empty region the server has not filled", async () => {
    const warn = listen()

    mount(`
      <div>
        <lt-field></lt-field>
        <lt-tabs></lt-tabs>
        <lt-dialog></lt-dialog>
        <lt-popover></lt-popover>
        <lt-suggestion></lt-suggestion>
        <lt-error-summary hidden></lt-error-summary>
        <lt-session-timeout></lt-session-timeout>
      </div>
    `)
    await waitUntilSettled()

    expect(warn).not.toHaveBeenCalled()
  })

  it("says nothing about markup that holds together", async () => {
    const warn = listen()

    mount(`
      <div>
        <lt-field>
          <label class="lt-label" for="fixer">Fixer's address</label>
          <input class="lt-input" id="fixer" />
          <p class="lt-help-text">The board writes to the fixer, never to the crew.</p>
        </lt-field>

        <lt-field>
          <label class="lt-label">Budget <input class="lt-input" type="number" /></label>
        </lt-field>

        <lt-tabs>
          <ul class="lt-tabs__list" aria-label="Parts of the claim">
            <li><a href="#file-claim">Claim</a></li>
            <li><a href="#file-attachments">Attachments</a></li>
          </ul>
          <section class="lt-tabs__panel" id="file-claim"><h2>Claim</h2>Claim AV-2079-0481 was filed on 4 March 2079.</section>
          <section class="lt-tabs__panel" id="file-attachments"><h2>Attachments</h2>Two attachments.</section>
        </lt-tabs>

        <lt-dialog>
          <dialog class="lt-dialog" aria-labelledby="dialog-title">
            <h2 class="lt-dialog__title" id="dialog-title">The order is placed</h2>
            <div class="lt-dialog__body"><p>Job 222-0481 is open to crews.</p></div>
            <form method="dialog" class="lt-dialog__footer">
              <button class="lt-button" value="close">Close</button>
            </form>
          </dialog>
        </lt-dialog>

        <lt-popover>
          <button class="lt-button" aria-expanded="false"
                  aria-controls="actions">Actions</button>
          <div popover id="actions" class="lt-popover__panel">Mark LDG-117 returned</div>
        </lt-popover>

        <lt-suggestion>
          <label class="lt-label" for="breaker">Breaker</label>
          <input class="lt-input" id="breaker" role="combobox"
                 aria-expanded="false" aria-controls="breakers"
                 aria-autocomplete="list" />
          <ul class="lt-suggestion__list" id="breakers" role="listbox" hidden>
            <li class="lt-suggestion__option" id="breaker-0" role="option"
                aria-selected="false">Crowbar</li>
          </ul>
          <span class="lt-sr-only" role="status"></span>
        </lt-suggestion>

        <lt-error-summary class="lt-error-summary" role="alert" tabindex="-1"
                          data-autofocus="false" aria-labelledby="summary-title">
          <h2 class="lt-error-summary__title" id="summary-title">The form has one error</h2>
          <ul class="lt-list"><li><a href="#breaker">Choose a breaker</a></li></ul>
        </lt-error-summary>

        <lt-session-timeout data-ignore-morph>
          <dialog class="lt-session-timeout__dialog" role="alertdialog"
                  aria-labelledby="session-title">
            <h2 class="lt-session-timeout__title" id="session-title">Your session is ending</h2>
            <p class="lt-session-timeout__text">Your session on the Lattice ends in
              <span class="lt-session-timeout__count" aria-hidden="true"></span>.</p>
            <span class="lt-sr-only" role="status"></span>
            <form method="dialog" class="lt-session-timeout__actions">
              <button class="lt-button" value="extend">Stay connected</button>
              <button class="lt-button" data-variant="secondary" value="logout">Log out</button>
            </form>
          </dialog>
        </lt-session-timeout>
      </div>
    `)
    await waitUntilSettled()

    expect(warn).not.toHaveBeenCalled()
  })
})
