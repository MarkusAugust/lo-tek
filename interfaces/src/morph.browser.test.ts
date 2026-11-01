/**
 * That a morph from the server does not strip what the web component has set.
 *
 * Datastar synchronises attributes like this, where `r` is in the page and `s`
 * is the server's node:
 *
 * ```js
 * for (let {name: l} of Array.from(r.attributes))
 *   !s.hasAttribute(l) && !o.includes(l) && r.removeAttribute(l)
 * ```
 *
 * `o` is the list from `data-preserve-attr`, and it is read from the server's
 * node. If a component sets an attribute that is not there, it disappears on
 * every patch. This test runs exactly that loop against real markup, after the
 * component has done its work, and requires the state to remain.
 *
 * The loop assumes the nodes are the same, and they are not always. Datastar
 * does not morph an element with an id into one without; it replaces it, and
 * that affects bare markup where the component created the ids itself. That is
 * tested against the real bundle in
 * `components/frame/tabs/lt-tabs-morph.browser.test.ts`.
 */

import { beforeEach, describe, expect, it } from "vitest"
import { dialog } from "./components/frame/dialog/dialog"
import { defineLtDialog } from "./components/frame/dialog/lt-dialog"
import { defineLtField } from "./components/frame/field/lt-field"
import { defineLtPopover } from "./components/frame/popover/lt-popover"
import { popover } from "./components/frame/popover/popover"
import { defineLtSuggestion } from "./components/frame/suggestion/lt-suggestion"
import { suggestion } from "./components/frame/suggestion/suggestion"
import { defineLtTabs } from "./components/frame/tabs/lt-tabs"
import { tabs } from "./components/frame/tabs/tabs"
import { setAddress } from "./testing/address"

import "./tokens/tokens.css"

defineLtField()
defineLtSuggestion()
defineLtPopover()
defineLtTabs()
defineLtDialog()

/** Datastar's attribute synchronisation, on one element. */
function morphElement(live: Element, server: Element): void {
  // The preserve list is here so the helper is the same loop we quote, and
  // the assertion below keeps it empty. If a name were in it, the loop would
  // remove nothing for exactly that attribute, and the test would check
  // nothing. The fixtures come two ways, and each way has its guard: some are
  // built by `dialog()`, `popover()`, `suggestion()` and `tabs()`, and there
  // the census in `lt.browser.test.ts` fails a builder function that starts
  // emitting the list. Others are written by hand, as a Go template would,
  // and there this line fails it.
  const preserve = (server.getAttribute("data-preserve-attr") ?? "")
    .split(/\s+/)
    .filter(Boolean)
  expect(preserve).toEqual([])

  for (const { name } of [...live.attributes]) {
    if (!server.hasAttribute(name) && !preserve.includes(name)) {
      live.removeAttribute(name)
    }
  }

  // Only when the value is actually different. A morph that rewrote every
  // attribute would close an open `popover` by itself, and the test would
  // then check its own way of writing rather than the morph.
  for (const { name, value } of [...server.attributes]) {
    if (!preserve.includes(name) && live.getAttribute(name) !== value) {
      live.setAttribute(name, value)
    }
  }
}

/** The same, through the whole tree. The nodes are in the same order. */
function morph(live: Element, markup: string): void {
  const template = document.createElement("div")
  template.innerHTML = markup
  const root = template.firstElementChild
  if (!root) throw new Error("The markup has no root")

  const living = [live, ...live.querySelectorAll("*")]
  const sent = [root, ...root.querySelectorAll("*")]

  if (living.length !== sent.length) {
    throw new Error(
      `The component added or removed nodes: ${living.length} in the page against ${sent.length} from the server`,
    )
  }

  for (let i = 0; i < living.length; i++) {
    // Without this, a component that inserts a node could shift the whole
    // comparison, and the test would make demands of the wrong elements
    // without saying so.
    if (living[i].tagName !== sent[i].tagName) {
      throw new Error(
        `The nodes are not in the same order: ${living[i].tagName} against ${sent[i].tagName}`,
      )
    }
    morphElement(living[i], sent[i])
  }
}

function mountMarkup(markup: string): HTMLElement {
  document.body.innerHTML = markup
  return document.body.firstElementChild as HTMLElement
}

describe("a morph does not strip what the component sets", () => {
  beforeEach(async () => {
    // The component reads the address on load, and a click on a tab writes
    // it.
    await setAddress("")
  })

  /*
   * The markup is written the way a Go template should write it: `for` and
   * `id`, which HTML requires for the field to have a name without
   * JavaScript, and otherwise no wiring and no `data-preserve-attr`.
   *
   * The wiring between the field, the help text and the error text is
   * something the component computes, not something the server sent, so the
   * morph strips it. The component sees that the attributes are gone and sets
   * them back.
   */
  const FIELD = `
    <lt-field>
      <label class="lt-label" for="fixer">Fixer's address</label>
      <input class="lt-input" id="fixer" />
      <p class="lt-help-text">The board writes to the fixer, never to the crew.</p>
      <p class="lt-error-text">Enter a valid address.</p>
    </lt-field>`

  it("keeps the field wired through a patch, without a preserve list", async () => {
    const field = mountMarkup(FIELD)
    await customElements.whenDefined("lt-field")
    await new Promise((done) => requestAnimationFrame(done))

    const control = field.querySelector("input") as HTMLInputElement
    const label = field.querySelector("label") as HTMLLabelElement
    const before = control.getAttribute("aria-describedby")
    expect(
      before,
      "the wiring did not even exist before the patch",
    ).toBeTruthy()
    expect(control.getAttribute("aria-invalid")).toBe("true")

    morph(field, FIELD)
    // The repair happens in an observer, that is, in the next turn of the loop.
    await new Promise((done) => requestAnimationFrame(done))

    const after = control.getAttribute("aria-describedby")
    expect(after, "the wiring did not come back after the patch").toBe(before)
    expect(control.getAttribute("aria-invalid")).toBe("true")

    for (const id of (after ?? "").split(/\s+/).filter(Boolean)) {
      expect(
        document.getElementById(id),
        `aria-describedby points to "${id}", which does not exist after the patch`,
      ).not.toBeNull()
    }

    expect(label.htmlFor).toBe("fixer")
    expect(document.getElementById(label.htmlFor)).toBe(control)
    expect(label.classList.contains("lt-label")).toBe(true)
  })

  it("writes no id on the control when the label wraps it", async () => {
    /*
     * A control without an id has nothing a morph can recognise it by, and is
     * therefore kept. If the component wrote an id on it, that would be an id
     * the server did not send, and Datastar and idiomorph would replace the
     * control on the next patch, along with focus and what the user had typed.
     */
    const WRAPPED = `
      <lt-field>
        <label class="lt-label">Fixer's address <input class="lt-input" /></label>
        <p class="lt-help-text">The board writes to the fixer, never to the crew.</p>
      </lt-field>`
    const field = mountMarkup(WRAPPED)
    await customElements.whenDefined("lt-field")
    await new Promise((done) => requestAnimationFrame(done))

    const control = field.querySelector("input") as HTMLInputElement
    expect(control.hasAttribute("id")).toBe(false)
    const before = control.getAttribute("aria-describedby")
    expect(before).toBeTruthy()

    morph(field, WRAPPED)
    await new Promise((done) => requestAnimationFrame(done))

    expect(control.hasAttribute("id")).toBe(false)
    expect(control.getAttribute("aria-describedby")).toBe(before)
  })

  it("rewires the field when the patch replaced the control", async () => {
    /*
     * If the patch replaces the control itself, the server's node arrives with
     * the server's id. The wiring to the help text and the error text is
     * written on the new one.
     */
    const field = mountMarkup(FIELD)
    await customElements.whenDefined("lt-field")
    await new Promise((done) => requestAnimationFrame(done))

    const label = field.querySelector("label") as HTMLLabelElement
    const old = field.querySelector("input") as HTMLInputElement
    const replacement = document.createElement("input")
    replacement.className = "lt-input"
    replacement.id = "fixer"
    old.replaceWith(replacement)

    await new Promise((done) => requestAnimationFrame(done))

    const control = field.querySelector("input") as HTMLInputElement
    expect(control).toBe(replacement)
    expect(label.htmlFor).toBe("fixer")
    expect(document.getElementById(label.htmlFor)).toBe(control)
    expect(control.getAttribute("aria-describedby")).toBeTruthy()
    expect(control.getAttribute("aria-invalid")).toBe("true")
  })

  /*
   * The server decides the dialog. `open` is therefore not preserved, unlike
   * on the popover: if it were, the server could never open the dialog again
   * after the user had closed it once.
   */
  it("lets the server open a dialog the user has closed", async () => {
    const box = dialog({ titleId: "title", open: true })
    const MARKUP = `
      <lt-dialog ${attr(box.host)}>
        <dialog ${attr(box.dialog)}>
          <h2 ${attr(box.title)}>The order is placed</h2>
          <div ${attr(box.body)}><p>Job 222-0481 is open to crews.</p></div>
        </dialog>
      </lt-dialog>`

    const host = mountMarkup(MARKUP)
    await customElements.whenDefined("lt-dialog")
    await new Promise((done) => requestAnimationFrame(done))

    const d = host.querySelector("dialog") as HTMLDialogElement
    expect(d.open, "the dialog did not open at all").toBe(true)

    // Wait for `close`, not for a paint: the event is a queued task, and in
    // Firefox a paint came before it one time in eight.
    const closed = new Promise((done) =>
      d.addEventListener("close", done, { once: true }),
    )
    d.close()
    await closed
    expect(host.hasAttribute("open")).toBe(false)

    morph(host, MARKUP)
    await new Promise((done) => requestAnimationFrame(done))

    expect(d.open, "the patch did not open the dialog again").toBe(true)
    d.close()
  })

  /*
   * The browser sets `open` on the `<dialog>` itself when `showModal()` is
   * called.
   *
   * The server does write `open` itself when it knows the dialog should be
   * shown, but it does not always know. If the dialog is opened by a signal
   * in the browser, or by a user, `open` exists only in the live page, and
   * then only the component can set it back. The test therefore sends the
   * server's `<dialog>` **without** `open`. If it did not, the morph would
   * have left the attribute alone anyway, since it only removes what the
   * server's node lacks, and the test could not fail.
   */
  it("does not close an open dialog in a patch", async () => {
    const box = dialog({ titleId: "title", open: true })
    const { open: _serverOpen, ...dialogWithoutOpen } = box.dialog
    const MARKUP = `
      <lt-dialog ${attr(box.host)}>
        <dialog ${attr(dialogWithoutOpen)}>
          <h2 ${attr(box.title)}>The order is placed</h2>
          <div ${attr(box.body)}><p>Job 222-0481 is open to crews.</p></div>
        </dialog>
      </lt-dialog>`

    const host = mountMarkup(MARKUP)
    await customElements.whenDefined("lt-dialog")
    await new Promise((done) => requestAnimationFrame(done))

    const d = host.querySelector("dialog") as HTMLDialogElement
    expect(d.matches(":modal"), "the dialog did not open as a modal").toBe(true)

    // The server patches the region while the dialog is open, for example
    // because the scoreboard next to it has changed.
    morph(host, MARKUP)
    await new Promise((done) => requestAnimationFrame(done))

    // `open` and `:modal` are not the same here either: if the attribute is
    // removed from a modal dialog, it disappears from the screen while
    // `:modal` is still true. It is the attribute that must remain.
    expect(d.open, "the patch stripped open and hid the dialog").toBe(true)
    expect(d.matches(":modal")).toBe(true)
    d.close()
  })

  /*
   * The suggestion field hides "No matches" when something matches. It does
   * so with `hidden`, and the server does not send that state, because it
   * follows from what the user has typed.
   */
  const SUGGESTION = suggestion({ id: "breaker", keys: ["a", "b"] })
  const attr = (values: Record<string, unknown>) =>
    Object.entries(values)
      .map(([name, value]) => (value === true ? name : `${name}="${value}"`))
      .join(" ")

  const FIELD_WITH_SUGGESTIONS = `
    <lt-suggestion>
      <label ${attr(SUGGESTION.label)}>Breaker</label>
      <div>
        <input ${attr(SUGGESTION.control)} name="breaker">
        <ul ${attr(SUGGESTION.list)}>
          <li ${attr(SUGGESTION.options[0])}>Crowbar</li>
          <li ${attr(SUGGESTION.options[1])}>Needle</li>
        </ul>
        <p ${attr(SUGGESTION.empty)}>No matches</p>
        <span ${attr(SUGGESTION.status)}></span>
      </div>
    </lt-suggestion>`

  it("keeps the suggestion list open and the highlight through a patch", async () => {
    /*
     * Everything the user has done in a suggestion field comes from the
     * component: that the list is expanded, what the filter hides, and which
     * option she has moved to with the arrow keys. None of it is in the
     * server's version, and none of it is preserved. The morph strips it, and
     * the component sets it back.
     */
    const field = mountMarkup(FIELD_WITH_SUGGESTIONS)
    await customElements.whenDefined("lt-suggestion")
    await new Promise((done) => requestAnimationFrame(done))

    const control = field.querySelector("input") as HTMLInputElement
    const list = field.querySelector("[role='listbox']") as HTMLElement
    const options = [
      ...field.querySelectorAll("[role='option']"),
    ] as HTMLElement[]

    control.focus()
    control.dispatchEvent(new Event("input", { bubbles: true }))
    control.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    )

    expect(list.hidden, "the list did not open").toBe(false)
    expect(control.getAttribute("aria-expanded")).toBe("true")
    expect(options[0].getAttribute("aria-selected")).toBe("true")

    morph(field, FIELD_WITH_SUGGESTIONS)
    await new Promise((done) => requestAnimationFrame(done))

    expect(list.hidden, "the list closed in the patch").toBe(false)
    expect(
      control.getAttribute("aria-expanded"),
      "the screen reader was told the list was closed while it was showing",
    ).toBe("true")
    expect(
      options[0].getAttribute("aria-selected"),
      "the highlight disappeared in the patch",
    ).toBe("true")
    expect(control.getAttribute("aria-activedescendant")).toBe(options[0].id)
  })

  it("lets the server control the suggestion list when it says it decides it", async () => {
    const SERVERS = FIELD_WITH_SUGGESTIONS.replace(
      "<lt-suggestion>",
      "<lt-suggestion server-controlled>",
    )
    const field = mountMarkup(SERVERS)
    await customElements.whenDefined("lt-suggestion")
    await new Promise((done) => requestAnimationFrame(done))

    const control = field.querySelector("input") as HTMLInputElement
    const list = field.querySelector("[role='listbox']") as HTMLElement

    control.focus()
    control.dispatchEvent(new Event("input", { bubbles: true }))
    expect(list.hidden).toBe(false)

    morph(field, SERVERS)
    await new Promise((done) => requestAnimationFrame(done))

    expect(
      list.hidden,
      "the server said it decides the list, but the component opened it again",
    ).toBe(true)
  })

  it("restores the reading position when only aria-activedescendant is stripped", async () => {
    /*
     * The highlight can remain while the pointer is gone. Then nothing looks
     * wrong in the markup, but the screen reader has lost its reading
     * position, and the user does not hear the option she is on.
     */
    const field = mountMarkup(FIELD_WITH_SUGGESTIONS)
    await customElements.whenDefined("lt-suggestion")
    await new Promise((done) => requestAnimationFrame(done))

    const control = field.querySelector("input") as HTMLInputElement
    control.focus()
    control.dispatchEvent(new Event("input", { bubbles: true }))
    control.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    )
    await new Promise((done) => requestAnimationFrame(done))

    const options = [
      ...field.querySelectorAll("[role='option']"),
    ] as HTMLElement[]
    expect(control.getAttribute("aria-activedescendant")).toBe(options[0].id)

    control.removeAttribute("aria-activedescendant")
    await new Promise((done) => requestAnimationFrame(done))

    expect(
      control.getAttribute("aria-activedescendant"),
      "the reading position did not come back",
    ).toBe(options[0].id)
  })

  it("forgets the highlight when the server sends an entirely new list", async () => {
    /*
     * The ids from `lt.suggestion()` are positional, so a new list reuses
     * them. If the component remembered only the id, it set the highlight
     * back on option number two in an entirely different list, and the screen
     * reader announced a breaker the user never navigated to. The text
     * is the identity.
     */
    const field = mountMarkup(FIELD_WITH_SUGGESTIONS)
    await customElements.whenDefined("lt-suggestion")
    await new Promise((done) => requestAnimationFrame(done))

    const control = field.querySelector("input") as HTMLInputElement
    control.focus()
    control.dispatchEvent(new Event("input", { bubbles: true }))
    control.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    )
    control.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    )

    const options = [
      ...field.querySelectorAll("[role='option']"),
    ] as HTMLElement[]
    expect(options[1].getAttribute("aria-selected")).toBe("true")

    /*
     * `morph()` here imitates Datastar's attribute synchronisation, and a real
     * patch also replaces the text. That part is therefore set by hand, so the
     * list actually becomes a different list and not just the same names with
     * new attributes.
     */
    const NEW_LIST = FIELD_WITH_SUGGESTIONS.replace(
      ">Crowbar<",
      ">Lockjaw<",
    ).replace(">Needle<", ">Saltwater<")
    options[0].textContent = "Lockjaw"
    options[1].textContent = "Saltwater"
    morph(field, NEW_LIST)
    await new Promise((done) => requestAnimationFrame(done))

    const after = [
      ...field.querySelectorAll("[role='option']"),
    ] as HTMLElement[]
    expect(
      after.map((o) => o.getAttribute("aria-selected")),
      "the highlight was set on an option the user never navigated to",
    ).toEqual(["false", "false"])
    expect(control.hasAttribute("aria-activedescendant")).toBe(false)
  })

  it("lets “No matches” stay hidden through a patch", async () => {
    const field = mountMarkup(FIELD_WITH_SUGGESTIONS)
    await customElements.whenDefined("lt-suggestion")
    await new Promise((done) => requestAnimationFrame(done))

    const control = field.querySelector("input") as HTMLInputElement
    control.value = "Cr"
    control.dispatchEvent(new Event("input", { bubbles: true }))

    const empty = field.querySelector(".lt-suggestion__empty") as HTMLElement
    expect(
      empty.hidden,
      "“No matches” was showing although Crowbar matched",
    ).toBe(true)

    morph(field, FIELD_WITH_SUGGESTIONS)

    expect(empty.hidden, "“No matches” reappeared in the patch").toBe(true)
  })

  /*
   * The tabs carry the selection in `aria-selected` and `tabindex` on the
   * links, and in `hidden` on the panels. The server's version only says
   * what was selected when it was written, not what the user has done since,
   * and none of the parts is preserved: the builder function writes no
   * `data-preserve-attr`. So the morph strips them, and the component sets
   * them back.
   */
  const TABS = tabs({
    id: "file",
    keys: ["overview", "attachments"],
    label: "The claim",
  })

  const TAB_MARKUP = `
    <lt-tabs>
      <ul ${attr(TABS.list)}>
        <li><a ${attr(TABS.tabs[0])}>Overview</a></li>
        <li><a ${attr(TABS.tabs[1])}>Attachments</a></li>
      </ul>
      <section ${attr(TABS.panels[0])}><h2 ${attr(TABS.headings[0])}>Overview</h2>Summary</section>
      <section ${attr(TABS.panels[1])}><h2 ${attr(TABS.headings[1])}>Attachments</h2>Files</section>
    </lt-tabs>`

  it("keeps the selected tab through a patch", async () => {
    const field = mountMarkup(TAB_MARKUP)
    await customElements.whenDefined("lt-tabs")
    await new Promise((done) => requestAnimationFrame(done))

    const links = [...field.querySelectorAll("[role='tab']")] as HTMLElement[]
    const panels = [
      ...field.querySelectorAll("[role='tabpanel']"),
    ] as HTMLElement[]

    links[1].click()
    expect(links[1].getAttribute("aria-selected")).toBe("true")

    morph(field, TAB_MARKUP)
    // The repair happens in an observer, that is, in the next turn of the loop.
    await new Promise((done) => requestAnimationFrame(done))

    expect(
      links[1].getAttribute("aria-selected"),
      "the selected tab became the first one again",
    ).toBe("true")
    expect(links[1].tabIndex, "the tab stop did not follow").toBe(0)
    expect(
      panels[1].hasAttribute("hidden"),
      "the panel of the selected tab was hidden",
    ).toBe(false)
    expect(panels[0].hasAttribute("hidden")).toBe(true)
  })

  it("lets the user switch tabs in markup without ids on the tabs", async () => {
    /*
     * Hand-written markup from a Go or Kotlin template has no id on the tabs,
     * and it should not have one: the link points to the panel's id, and an
     * id on the tab would get it replaced on the next patch.
     *
     * If the component remembered the selection as an id, the empty string
     * became an identity that matched the first tab, and the repair set the
     * selection back in the next microtask. The user then could not switch
     * tabs at all, and nothing said so.
     */
    const WITHOUT_IDS = `
      <lt-tabs>
        <ul class="lt-tabs__list" role="tablist">
          <li role="presentation"><a href="#overview" role="tab" aria-selected="true" tabindex="0">Overview</a></li>
          <li role="presentation"><a href="#attachments" role="tab" aria-selected="false" tabindex="-1">Attachments</a></li>
        </ul>
        <section class="lt-tabs__panel" id="overview" role="tabpanel" tabindex="0">Summary</section>
        <section class="lt-tabs__panel" id="attachments" role="tabpanel" tabindex="0" hidden>Files</section>
      </lt-tabs>`

    const field = mountMarkup(WITHOUT_IDS)
    await customElements.whenDefined("lt-tabs")
    await new Promise((done) => requestAnimationFrame(done))

    const links = [...field.querySelectorAll("[role='tab']")] as HTMLElement[]
    const panels = [
      ...field.querySelectorAll("[role='tabpanel']"),
    ] as HTMLElement[]

    links[1].click()
    await new Promise((done) => requestAnimationFrame(done))

    expect(
      links[1].getAttribute("aria-selected"),
      "the selection jumped back to the first tab",
    ).toBe("true")
    expect(panels[1].hasAttribute("hidden")).toBe(false)

    morph(field, WITHOUT_IDS)
    await new Promise((done) => requestAnimationFrame(done))

    expect(links[1].getAttribute("aria-selected")).toBe("true")
    expect(panels[1].hasAttribute("hidden")).toBe(false)
  })

  it("keeps the tabs consistent when the patch removes the selected one", async () => {
    /*
     * The server can send a shorter list. The component then forgets the
     * selection, because the tab no longer exists, but the markup must hang
     * together afterwards.
     *
     * Without the clean-up, the list was left without a single
     * `aria-selected="true"`, with every panel hidden, and a click on the one
     * remaining tab did nothing: `select(0)` compared against a `selected`
     * that answers 0 also when nothing is highlighted. The user got a tab
     * list that did not respond.
     */
    const field = mountMarkup(TAB_MARKUP)
    await customElements.whenDefined("lt-tabs")
    await new Promise((done) => requestAnimationFrame(done))

    const links = [...field.querySelectorAll("[role='tab']")] as HTMLElement[]
    links[1].click()
    await new Promise((done) => requestAnimationFrame(done))
    expect(links[1].getAttribute("aria-selected")).toBe("true")

    const reported: number[] = []
    field.addEventListener("tab-select", (e) => reported.push(e.detail.index))

    // The patch removes the tab the user selected, and its panel.
    links[1].closest("li")?.remove()
    ;(field.querySelectorAll("[role='tabpanel']")[1] as HTMLElement).remove()
    await new Promise((done) => requestAnimationFrame(done))

    const remaining = [
      ...field.querySelectorAll("[role='tab']"),
    ] as HTMLElement[]
    const panels = [
      ...field.querySelectorAll("[role='tabpanel']"),
    ] as HTMLElement[]

    expect(
      remaining.map((k) => k.getAttribute("aria-selected")),
      "no tab was highlighted after the patch",
    ).toEqual(["true"])
    expect(
      reported,
      "the clean-up made a new selection without saying so, so an app that loads panel content never found out",
    ).toContain(0)
    expect(
      panels[0].hasAttribute("hidden"),
      "no panels were visible after the patch",
    ).toBe(false)
  })

  it("lets the server move the tab when it says it decides the selection", async () => {
    /*
     * What preserving gave, and what the repair had to replace.
     *
     * "Go on to step 2" is a real thing a server will want to do. With
     * `data-preserve-attr` it never could: the list applied both ways.
     * `server-controlled` says the server decides the selection, and then
     * every patch decides.
     */
    const SERVERS = TAB_MARKUP.replace(
      "<lt-tabs>",
      "<lt-tabs server-controlled>",
    )
    const field = mountMarkup(SERVERS)
    await customElements.whenDefined("lt-tabs")
    await new Promise((done) => requestAnimationFrame(done))

    const links = [...field.querySelectorAll("[role='tab']")] as HTMLElement[]
    links[1].click()
    expect(links[1].getAttribute("aria-selected")).toBe("true")

    morph(field, SERVERS)
    await new Promise((done) => requestAnimationFrame(done))

    expect(
      links[0].getAttribute("aria-selected"),
      "the server said it decides the selection, but the component set it back",
    ).toBe("true")
    expect(links[1].getAttribute("aria-selected")).toBe("false")
  })

  /*
   * The popover carries its state on the host, and the position in `style` on
   * the panel. The patch must be triggered from something inside the popover;
   * a click outside closes it, and then you are checking your own clicking.
   */
  const POPOVER = popover({ id: "menu" })

  const POPOVER_MARKUP = `
    <lt-popover ${attr(POPOVER.host)}>
      <button ${attr(POPOVER.trigger)}>Actions</button>
      <ul ${attr(POPOVER.panel)}><li>Archive</li></ul>
    </lt-popover>`

  it("keeps the popover open through a patch", async () => {
    const field = mountMarkup(POPOVER_MARKUP)
    await customElements.whenDefined("lt-popover")
    await new Promise((done) => requestAnimationFrame(done))

    const button = field.querySelector("button") as HTMLButtonElement
    const panel = field.querySelector("ul") as HTMLElement

    button.click()
    await new Promise((done) => requestAnimationFrame(done))
    expect(panel.matches(":popover-open"), "the popover did not open").toBe(
      true,
    )

    morph(field, POPOVER_MARKUP)
    await new Promise((done) => requestAnimationFrame(done))

    expect(field.hasAttribute("open"), "the host lost its state").toBe(true)
    expect(
      button.getAttribute("aria-expanded"),
      "the button reported closed to the screen reader",
    ).toBe("true")
    expect(
      panel.matches(":popover-open"),
      "the popover closed in the patch",
    ).toBe(true)
  })

  it("lets the server close the popover when it says it decides it", async () => {
    const SERVERS = POPOVER_MARKUP.replace(
      "<lt-popover ",
      "<lt-popover server-controlled ",
    )
    const host = mountMarkup(SERVERS) as HTMLElement & { show(): void }
    await customElements.whenDefined("lt-popover")
    await new Promise((done) => requestAnimationFrame(done))

    host.show()
    await new Promise((done) => requestAnimationFrame(done))
    expect(host.hasAttribute("open")).toBe(true)

    morph(host, SERVERS)
    await new Promise((done) => requestAnimationFrame(done))

    expect(
      host.hasAttribute("open"),
      "the server said it decides the popover, but the component opened it again",
    ).toBe(false)
  })

  it("closes when the patch both removes open and hands over the state", async () => {
    /*
     * A morph sets one attribute at a time, and `open` comes before
     * `server-controlled` in document order. If the component repaired
     * immediately, it set `open` back while the server was in the middle of
     * saying it takes over the state, and the popover stayed open afterwards.
     */
    const host = mountMarkup(POPOVER_MARKUP) as HTMLElement & { show(): void }
    await customElements.whenDefined("lt-popover")
    await new Promise((done) => requestAnimationFrame(done))

    host.show()
    await new Promise((done) => requestAnimationFrame(done))
    expect(host.hasAttribute("open")).toBe(true)

    host.removeAttribute("open")
    host.setAttribute("server-controlled", "")
    await new Promise((done) => requestAnimationFrame(done))

    expect(
      host.hasAttribute("open"),
      "the popover opened again because the repair came before the whole patch had landed",
    ).toBe(false)
  })

  it("lets an app close the popover with the property", async () => {
    /*
     * The repair must not get in the way of an app that controls the popover
     * itself. The first version remembered only "the user opened it", and
     * then set `open` straight back when the app removed it. The Datastar
     * example in the documentation closes the menu from an action inside the
     * panel, and it stayed open.
     */
    const host = mountMarkup(POPOVER_MARKUP) as HTMLElement & {
      show(): void
      open: boolean
    }
    await customElements.whenDefined("lt-popover")
    await new Promise((done) => requestAnimationFrame(done))

    host.show()
    await new Promise((done) => requestAnimationFrame(done))
    expect(host.hasAttribute("open")).toBe(true)

    host.open = false
    await new Promise((done) => requestAnimationFrame(done))

    expect(host.hasAttribute("open"), "the popover would not close").toBe(false)
    const panel = host.querySelector("[popover]") as HTMLElement
    expect(panel.matches(":popover-open")).toBe(false)
  })
})
