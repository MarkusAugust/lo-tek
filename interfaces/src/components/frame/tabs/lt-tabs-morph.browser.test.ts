/**
 * What survives a patch through Datastar's own morph.
 *
 * `morph.browser.test.ts` runs Datastar's attribute loop on the same nodes,
 * and so assumes the morph keeps them. It does not always. Datastar v1.0.4
 * matches old and new elements like this (`isSoftMatch` in
 * `library/src/plugins/watchers/patchElements.ts`):
 *
 * ```js
 * oldNode.tagName === newNode.tagName &&
 *   (!oldNode.id || oldNode.id === newNode.id)
 * ```
 *
 * If the element in the page has an id, and the server's element has none
 * or a different one, it is not morphed. The old one is removed and the
 * server's is inserted. If a component creates the id itself, every patch
 * from a template without ids therefore gets new nodes, and what the
 * component remembered on the old node is gone.
 *
 * These tests run the real bundle, not a reproduction of the loop:
 * `src/testing/datastar/datastar-v1.0.4.js`, taken from
 * `starfederation/datastar@v1.0.4/bundles/datastar.js` (sha256
 * `727844adfc825ee651fb93c544a2a739986f9a21820a94524b35f0cac470cf91`), with
 * the last line, `//# sourceMappingURL=datastar.js.map`, removed so Vite
 * does not look for a map that is not included. It is the version
 * `agent/datastar.md` points to. The file is here because the npm package,
 * `@starfederation/datastar`, stops at 1.0.0-beta.11: 1.0.x exists only as
 * a file in the Git repository and on the CDN. The patch is sent as the same
 * `datastar-fetch` event the SSE reader itself sends once it has parsed a
 * `datastar-patch-elements`, and one test goes all the way through `@get`
 * and a stream, so we know the shortcut is the same.
 *
 * The tabs write no id: the links have none, and the panels' ids come from
 * the server, since `href` requires them. Datastar therefore morphs them into
 * the old nodes, and the selection stays. The heading in the panel gets an
 * id from the component, since it has nothing the user can lose. Field,
 * suggestion field and popover warn in the console when a patch replaced
 * something the user had interacted with; see the last group.
 */

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest"

import { waitForPaint } from "../../../testing/a11y"
import { setAddress } from "../../../testing/address"
import { attr } from "../../../testing/markup"
import { datastarPatch as patch } from "../../../testing/update"
import { defineLtField } from "../field/lt-field"
import { defineLtPopover } from "../popover/lt-popover"
import { defineLtSuggestion } from "../suggestion/lt-suggestion"
import { defineLtTabs } from "./lt-tabs"
import { tabs } from "./tabs"

/** Whether each node is still the same. */
function sameNodes(before: Element[], after: Element[]): boolean[] {
  return before.map((node, i) => node === after[i])
}

const NAMES = ["Claim", "Attachments", "Messages"]
const KEYS = ["claim", "attachments", "messages"]

/**
 * A tab list as a Go or Kotlin template writes it without `lt.tabs()`: links
 * without an id, and ids only on the panels, which the links require.
 */
const BAR = `<lt-tabs id="claim-tabs">
  <ul class="lt-tabs__list" aria-label="Parts of the claim">
    ${NAMES.map((n, i) => `<li><a href="#${KEYS[i]}">${n}</a></li>`).join("\n    ")}
  </ul>
  ${NAMES.map((n, i) => `<section class="lt-tabs__panel" id="${KEYS[i]}"><h2>${n}</h2><p>Content</p></section>`).join("\n  ")}
</lt-tabs>`

/** What `lt.tabs()` writes: links, the panels' ids, the headings' ids and the classes. */
const TABS = tabs({ id: "file", keys: KEYS, label: "Parts of the claim" })
const FROM_BUILDER = `<lt-tabs id="claim-tabs">
  <ul ${attr(TABS.list)}>
    ${TABS.tabs.map((t, i) => `<li><a ${attr(t)}>${NAMES[i]}</a></li>`).join("\n    ")}
  </ul>
  ${TABS.panels.map((p, i) => `<section ${attr(p)}><h2 ${attr(TABS.headings[i])}>${NAMES[i]}</h2><p>Content</p></section>`).join("\n  ")}
</lt-tabs>`

function links(): HTMLAnchorElement[] {
  return [
    ...document.querySelectorAll<HTMLAnchorElement>(
      "#claim-tabs .lt-tabs__list a",
    ),
  ]
}

function panels(): HTMLElement[] {
  return [
    ...document.querySelectorAll<HTMLElement>("#claim-tabs .lt-tabs__panel"),
  ]
}

function selected(): (string | null)[] {
  return links().map((link) => link.getAttribute("aria-selected"))
}

/** Clicks tab 2, patches with `markup`, and reports what survived. */
async function clickAndPatch(markup: string) {
  document.body.innerHTML = markup
  await customElements.whenDefined("lt-tabs")
  await waitForPaint()

  const linksBefore = links()
  const panelsBefore = panels()
  linksBefore[1].click()
  await waitForPaint()
  expect(selected()).toEqual(["false", "true", "false"])

  const reported: number[] = []
  const listener = new AbortController()
  document.addEventListener(
    "tab-select",
    (e) => reported.push((e as CustomEvent<{ index: number }>).detail.index),
    { signal: listener.signal },
  )
  patch(markup)
  await waitForPaint()
  listener.abort()

  return {
    links: sameNodes(linksBefore, links()),
    panels: sameNodes(panelsBefore, panels()),
    selected: selected(),
    hiddenFlags: panels().map((p) => p.hasAttribute("hidden")),
    hidden: panels().map((p) => p.getAttribute("hidden")),
    linkIds: links().map((f) => f.id),
    names: panels().map((p) => {
      const target = p.getAttribute("aria-labelledby")
      return target ? document.getElementById(target)?.textContent : null
    }),
    reported,
  }
}

describe("lt-tabs through Datastar's morph", () => {
  beforeAll(() => {
    defineLtTabs()
  })

  beforeEach(async () => {
    // A click on a tab writes the address, and the component reads it on
    // load.
    await setAddress("")
  })

  it("bare markup: the links and panels are morphed, and the selection stays", async () => {
    /*
     * The component writes no id on the links, and the panels' ids come from
     * the server. Datastar therefore has something to recognise in both, and
     * morphs them into the old nodes. `chosenTab` points to a node that is
     * still in the page, and the selection is restored after the morph took
     * `aria-selected`, `tabindex` and `hidden`.
     */
    const r = await clickAndPatch(BAR)
    expect(r.links).toEqual([true, true, true])
    expect(r.panels).toEqual([true, true, true])
    expect(r.selected).toEqual(["false", "true", "false"])
    expect(r.hiddenFlags).toEqual([true, false, true])
    expect(r.linkIds).toEqual(["", "", ""])
    expect(r.reported).toEqual([])
  })

  it("bare markup: the panels keep their name from the heading", async () => {
    // The heading has no id from the server, so it can be replaced. The new
    // one gets the same id back, and the panel still points to it.
    const r = await clickAndPatch(BAR)
    expect(r.names).toEqual(NAMES)
  })

  it("markup from lt.tabs(): the same, and the panels are hidden with until-found", async () => {
    const r = await clickAndPatch(FROM_BUILDER)
    expect(r.links).toEqual([true, true, true])
    expect(r.panels).toEqual([true, true, true])
    expect(r.selected).toEqual(["false", "true", "false"])
    expect(r.hidden).toEqual(["until-found", null, "until-found"])
    expect(r.names).toEqual(NAMES)
    expect(r.reported).toEqual([])
  })

  it("bare markup in a patch that wraps the tab list: the same", async () => {
    /*
     * The server often patches a region, not the tab list itself. Then
     * `<lt-tabs>` has no id and is morphed into the old one, and the links
     * inside are kept the same way.
     */
    const page = (content: string) => `<main id="page">${content}</main>`
    const withoutId = BAR.replace(' id="claim-tabs"', ' class="claim-tabs"')
    document.body.innerHTML = page(withoutId)
    await waitForPaint()
    const regionLinks = () => [
      ...document.querySelectorAll("#page .lt-tabs__list a"),
    ]
    const before = regionLinks()
    ;(before[1] as HTMLElement).click()
    await waitForPaint()

    patch(page(withoutId))
    await waitForPaint()

    expect(sameNodes(before, regionLinks())).toEqual([true, true, true])
    expect(regionLinks().map((k) => k.getAttribute("aria-selected"))).toEqual([
      "false",
      "true",
      "false",
    ])
  })

  it("all the way through @get and an SSE stream gives the same", async () => {
    /*
     * The same scenario as the first test, but the patch arrives as a real
     * `datastar-patch-elements` in a `text/event-stream`, fetched by
     * `data-on:click="@get(…)"`. Confirms that the event above is the same
     * path the bundle itself takes.
     */
    const updated = BAR.replace("<p>Content</p>", "<p>Updated</p>")
    const stream = [
      "event: datastar-patch-elements",
      ...updated.split("\n").map((line) => `data: elements ${line}`),
      "",
      "",
    ].join("\n")
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(stream, {
          headers: { "Content-Type": "text/event-stream" },
        }),
    )

    try {
      document.body.innerHTML = `${BAR}
        <button id="refresh" data-on:click="@get('/claim')">Refresh</button>`
      await waitForPaint()
      // Datastar reads `data-*` in a `setTimeout` after the node arrived.
      await new Promise((done) => setTimeout(done, 20))

      const before = links()
      const panelsBefore = panels()
      before[1].click()
      await waitForPaint()
      expect(selected()).toEqual(["false", "true", "false"])

      document.getElementById("refresh")?.click()
      // The links are kept, so the patch is recognised by the content of the first panel.
      await vi.waitFor(() =>
        expect(panels()[0].textContent).toContain("Updated"),
      )
      await waitForPaint()

      expect(fetchSpy).toHaveBeenCalledOnce()
      expect(sameNodes(before, links())).toEqual([true, true, true])
      expect(sameNodes(panelsBefore, panels())).toEqual([true, true, true])
      expect(selected()).toEqual(["false", "true", "false"])
    } finally {
      // Otherwise `fetch` answered with this stream for the rest of the file
      // after a failure here.
      fetchSpy.mockRestore()
    }
  })
})

describe("lt-suggestion through Datastar's morph", () => {
  beforeAll(() => {
    defineLtSuggestion()
  })

  beforeEach(() => {
    document.body.innerHTML = ""
  })

  /** Bare markup from a template: the label around the field, no ids, no roles. */
  const SUGGESTION_BAR = `<lt-suggestion id="town-host">
  <div>
    <label>Town <input class="lt-input"></label>
    <ul class="lt-suggestion__list"><li>Bath</li><li>Bristol</li><li>Leeds</li></ul>
    <span class="lt-sr-only" role="status"></span>
  </div>
</lt-suggestion>`

  const SUGGESTION_WITH_ID = `<lt-suggestion id="town-host">
  <label for="town">Town</label>
  <div>
    <input class="lt-input" id="town">
    <ul class="lt-suggestion__list" id="town-list"><li id="town-option-0">Bath</li><li id="town-option-1">Bristol</li><li id="town-option-2">Leeds</li></ul>
    <span class="lt-sr-only" role="status"></span>
  </div>
</lt-suggestion>`

  async function typeAndPatch(markup: string) {
    document.body.innerHTML = markup
    await customElements.whenDefined("lt-suggestion")
    await waitForPaint()

    const field = document.querySelector("input") as HTMLInputElement
    const list = document.querySelector("ul") as HTMLElement
    field.focus()
    field.value = "B"
    field.dispatchEvent(new Event("input", { bubbles: true }))
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    )
    await waitForPaint()
    expect(field.getAttribute("aria-expanded")).toBe("true")

    patch(markup)
    await waitForPaint()

    const newField = document.querySelector("input") as HTMLInputElement
    return {
      sameField: newField === field,
      sameList: document.querySelector("ul") === list,
      value: newField.value,
      focus: document.activeElement === newField,
      expanded: newField.getAttribute("aria-expanded"),
    }
  }

  it("bare markup: the field is morphed, and what the user typed and focus stay", async () => {
    /*
     * The component writes no id on the field, so Datastar has nothing to
     * recognise it by and morphs it. The list gets an id from the component
     * and is replaced, but it has no state the user loses: the component
     * wires up the new one and opens it again.
     */
    const { sameList: _, ...r } = await typeAndPatch(SUGGESTION_BAR)
    expect(r).toEqual({
      sameField: true,
      value: "B",
      focus: true,
      expanded: "true",
    })
  })

  it("id from the server: the field is morphed, and the text, focus and list stay", async () => {
    const r = await typeAndPatch(SUGGESTION_WITH_ID)
    expect(r).toEqual({
      sameField: true,
      sameList: true,
      value: "B",
      focus: true,
      expanded: "true",
    })
  })
})

describe("lt-popover through Datastar's morph", () => {
  beforeAll(() => {
    defineLtPopover()
  })

  beforeEach(() => {
    document.body.innerHTML = ""
  })

  const MENU_BAR = `<lt-popover id="menu-host">
  <button class="lt-button">Actions</button>
  <div class="lt-popover"><button>Delete</button></div>
</lt-popover>`

  /** An id from the server, but `popover` left to the component. */
  const MENU_WITH_ID = `<lt-popover id="menu-host">
  <button class="lt-button" aria-controls="menu">Actions</button>
  <div class="lt-popover" id="menu"><button>Delete</button></div>
</lt-popover>`

  /** What `lt.popover()` and the Kotlin binding write. */
  const MENU_MANUAL = `<lt-popover id="menu-host">
  <button class="lt-button" aria-controls="menu">Actions</button>
  <div class="lt-popover" id="menu" popover="manual"><button>Delete</button></div>
</lt-popover>`

  async function openAndPatch(markup: string) {
    document.body.innerHTML = markup
    await customElements.whenDefined("lt-popover")
    await waitForPaint()

    const button = document.querySelector("lt-popover > button") as HTMLElement
    const panel = document.querySelector(".lt-popover") as HTMLElement
    button.click()
    await waitForPaint()
    const deleteButton = panel.querySelector("button") as HTMLButtonElement
    deleteButton.focus()
    expect(panel.matches(":popover-open")).toBe(true)

    patch(markup)
    await waitForPaint()

    const newPanel = document.querySelector(".lt-popover") as HTMLElement
    return {
      sameButton: document.querySelector("lt-popover > button") === button,
      samePanel: newPanel === panel,
      open: newPanel.matches(":popover-open"),
      focusInPanel: newPanel.contains(document.activeElement),
    }
  }

  it("bare markup: the panel is morphed, stays open, and focus stays", async () => {
    // The component writes no id on the panel, so the panel in the page and
    // the one the server sends are the same to the morph. When it wrote an
    // id, the panel was replaced and focus was gone.
    const r = await openAndPatch(MENU_BAR)
    expect(r).toEqual({
      sameButton: true,
      samePanel: true,
      open: true,
      focusInPanel: true,
    })
  })

  it("id from the server without popover: the panel is morphed and stays open", async () => {
    /*
     * The server did not send `popover`, so the morph removes it along with
     * `open` on the host. The component closes, reopens in the next
     * microtask, and then "closed" from the closing arrives as a separate
     * task. It was taken as the user closing it, and the popover stayed
     * closed after the patch.
     */
    const r = await openAndPatch(MENU_WITH_ID)
    expect(r).toEqual({
      sameButton: true,
      samePanel: true,
      open: true,
      focusInPanel: true,
    })
  })

  it("id and popover from the server: the panel is morphed, stays open, and focus stays", async () => {
    const r = await openAndPatch(MENU_MANUAL)
    expect(r).toEqual({
      sameButton: true,
      samePanel: true,
      open: true,
      focusInPanel: true,
    })
  })
})

describe("the components warn when a patch replaced the elements", () => {
  let warn: MockInstance<typeof console.warn>

  beforeAll(() => {
    defineLtTabs()
    defineLtSuggestion()
    defineLtField()
    defineLtPopover()
  })

  beforeEach(() => {
    document.body.innerHTML = ""
    warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
  })

  /** The warnings that mention that something was replaced. */
  function warnings(): string[] {
    return warn.mock.calls
      .map((call) => String(call[0]))
      .filter((m) => m.includes("replaced the"))
  }

  /**
   * Waits until `warnAboutMarkup` has checked its condition.
   *
   * It waits two frames after the patch landed, and its two are registered
   * after the test's two, so one `waitForPaint` is not enough.
   */
  async function settle() {
    await waitForPaint()
    await waitForPaint()
  }

  /** Patches like a `datastar-patch-elements` with a selector and mode. */
  const patchInside = (selector: string, elements: string) =>
    patch(elements, { selector, mode: "inner" })

  it("lt-tabs: does not warn, since the component writes no id that could be replaced", async () => {
    await clickAndPatch(BAR)
    await settle()
    expect(warnings()).toEqual([])

    links()[1].click()
    await waitForPaint()
    patch(BAR)
    await settle()
    expect(selected()).toEqual(["false", "true", "false"])
    expect(warnings()).toEqual([])
  })

  it("lt-tabs: not on a narrow patch, where the selection stays", async () => {
    document.body.innerHTML = BAR
    await waitForPaint()
    links()[1].click()
    await waitForPaint()

    patchInside("#claim-tabs > section:last-child", "Three new messages.")
    await settle()
    expect(selected()).toEqual(["false", "true", "false"])
    expect(panels()[2].textContent).toBe("Three new messages.")
    // The heading disappeared in the patch, so the name is the tab's text.
    expect(panels()[2].getAttribute("aria-label")).toBe("Messages")
    expect(warnings()).toEqual([])
  })

  const SUGGESTION = (id: string) => `<lt-suggestion id="town-host">
  <label for="${id}">Town</label>
  <div>
    <input class="lt-input" name="town" id="${id}">
    <ul class="lt-suggestion__list"><li>Bath</li><li>Bristol</li></ul>
    <span class="lt-sr-only" role="status"></span>
  </div>
</lt-suggestion>`

  async function typeAndPatchSuggestion(markup: string, text: string) {
    document.body.innerHTML = markup
    await waitForPaint()
    const field = document.querySelector("input") as HTMLInputElement
    field.focus()
    field.value = text
    field.dispatchEvent(new Event("input", { bubbles: true }))
    await waitForPaint()
    patch(markup)
    await settle()
  }

  it("lt-suggestion: when the id from the server changed between two renders", async () => {
    document.body.innerHTML = SUGGESTION("town-1")
    await waitForPaint()
    const field = document.querySelector("input") as HTMLInputElement
    field.focus()
    field.value = "B"
    field.dispatchEvent(new Event("input", { bubbles: true }))
    await waitForPaint()
    patch(SUGGESTION("town-2"))
    await settle()
    expect(warnings()).toHaveLength(1)
    expect(warnings()[0]).toContain(
      "lt-suggestion: a server update replaced the field",
    )
  })

  it("lt-suggestion: not when the server wrote the same id", async () => {
    await typeAndPatchSuggestion(SUGGESTION("town"), "B")
    expect(warnings()).toEqual([])
  })

  /** A field wrapped in its label, optionally with an id from the server. */
  const FIELD = (id: string, value = "") => `<lt-field id="name-host">
  <label>Name <input class="lt-input" name="name"${id}${value}></label>
</lt-field>`

  async function typeAndPatchField(
    before: string,
    after: string,
    text: string,
  ) {
    document.body.innerHTML = before
    await waitForPaint()
    const field = document.querySelector("input") as HTMLInputElement
    field.value = text
    patch(after)
    await settle()
    return field
  }

  it("lt-field: bare markup keeps the field and the text, without a warning", async () => {
    /*
     * The component writes no id on the control, so Datastar has nothing to
     * recognise it by and morphs it. The node, and the text the user typed,
     * stay. The component used to write an id, and that id was exactly what
     * made the field get replaced.
     */
    const old = await typeAndPatchField(FIELD(""), FIELD(""), "Kate")
    const field = document.querySelector("input") as HTMLInputElement
    expect(field).toBe(old)
    expect(field.value).toBe("Kate")
    expect(warnings()).toEqual([])
  })

  it("lt-field: when the id from the server changed between two renders", async () => {
    await typeAndPatchField(
      FIELD(' id="name-1"'),
      FIELD(' id="name-2"'),
      "Kate",
    )
    expect(warnings()).toHaveLength(1)
    expect(warnings()[0]).toContain(
      "lt-field: a server update replaced the control",
    )
  })

  it("lt-field: not when the server wrote the same id", async () => {
    const old = await typeAndPatchField(
      FIELD(' id="name"'),
      FIELD(' id="name"'),
      "Kate",
    )
    expect(document.querySelector("input")).toBe(old)
    expect(warnings()).toEqual([])
  })

  it("lt-field: not when the user had not typed anything", async () => {
    await typeAndPatchField(FIELD(' id="name-1"'), FIELD(' id="name-2"'), "")
    expect(warnings()).toEqual([])
  })

  it("lt-field: not when the server sends the text back", async () => {
    // The server did what the message asks for. Then nothing is lost, even
    // though the node is new.
    await typeAndPatchField(
      FIELD(' id="name-1"'),
      FIELD(' id="name-2"', ' value="Kate"'),
      "Kate",
    )
    expect((document.querySelector("input") as HTMLInputElement).value).toBe(
      "Kate",
    )
    expect(warnings()).toEqual([])
  })

  it("lt-field: not for a bare <select> the user left alone", async () => {
    // The browser selects the first option without anything being
    // `defaultSelected`, so a comparison with that saw a choice the user
    // never made.
    const select = `<lt-field id="building-host">
  <label>Building <select class="lt-select"><option>Saltline Tower</option><option>Breakwater House</option></select></label>
</lt-field>`
    document.body.innerHTML = select
    await waitForPaint()
    patch(select)
    await settle()
    expect(warnings()).toEqual([])
  })

  it("lt-field: a checked box without an id stays after the patch", async () => {
    const box = `<lt-field id="consent-host">
  <label><input class="lt-checkbox" type="checkbox" name="consent"> Consent</label>
</lt-field>`
    document.body.innerHTML = box
    await waitForPaint()
    const old = document.querySelector("input") as HTMLInputElement
    old.checked = true
    patch(box)
    await settle()
    const fresh = document.querySelector("input") as HTMLInputElement
    expect(fresh).toBe(old)
    expect(fresh.checked).toBe(true)
    expect(warnings()).toEqual([])
  })

  it("lt-field: when a checked box is replaced because the id changed", async () => {
    // `value` and `defaultValue` are always equal on a checkbox, so a
    // comparison of them never saw that the check was gone.
    const box = (id: string) => `<lt-field id="consent-host">
  <label><input class="lt-checkbox" type="checkbox" name="consent" id="${id}"> Consent</label>
</lt-field>`
    document.body.innerHTML = box("consent-1")
    await waitForPaint()
    ;(document.querySelector("input") as HTMLInputElement).checked = true
    patch(box("consent-2"))
    await settle()
    expect((document.querySelector("input") as HTMLInputElement).checked).toBe(
      false,
    )
    expect(warnings()).toHaveLength(1)
    expect(warnings()[0]).toContain(
      "lt-field: a server update replaced the control",
    )
  })

  const MENU = (id: string) => `<lt-popover id="menu-host">
  <button class="lt-button"${id && ' aria-controls="menu"'}>Actions</button>
  <div class="lt-popover"${id} popover="manual"><button>Delete</button></div>
</lt-popover>`

  async function openAndPatchMenu(markup: string, open: boolean) {
    document.body.innerHTML = markup
    await waitForPaint()
    if (open) {
      ;(document.querySelector("lt-popover > button") as HTMLElement).click()
      await waitForPaint()
    }
    patch(markup)
    await settle()
  }

  it("lt-popover: when the id from the server changed while the popover was open", async () => {
    // How a template writes it when the id is made from a counter.
    const menu = (id: string) => `<lt-popover id="menu-host">
  <button class="lt-button" aria-controls="${id}">Actions</button>
  <div class="lt-popover" id="${id}" popover="manual"><button>Delete</button></div>
</lt-popover>`
    document.body.innerHTML = menu("menu-1")
    await waitForPaint()
    ;(document.querySelector("lt-popover > button") as HTMLElement).click()
    await waitForPaint()
    patch(menu("menu-2"))
    await settle()
    expect(warnings()).toHaveLength(1)
    expect(warnings()[0]).toContain(
      "lt-popover: a server update replaced the panel",
    )
  })

  it("lt-popover: not when the panel is bare, since it is then kept", async () => {
    await openAndPatchMenu(MENU(""), true)
    expect(warnings()).toEqual([])
  })

  it("lt-popover: not when the server wrote an id", async () => {
    await openAndPatchMenu(MENU(' id="menu"'), true)
    expect(warnings()).toEqual([])
  })

  it("lt-popover: not when the popover was closed", async () => {
    await openAndPatchMenu(MENU(""), false)
    expect(warnings()).toEqual([])
  })
})
