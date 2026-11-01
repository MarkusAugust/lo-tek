/// <reference path="../../../types/css.d.ts" />

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import {
  expectNoAccessibilityViolations,
  mount,
  waitForPaint,
} from "../../../testing/a11y"
import { goTo, setAddress } from "../../../testing/address"
import { attr } from "../../../testing/markup"
import { replace } from "../../../testing/update"
import { defineLtTabs, type LtTabs } from "./lt-tabs"
import { tabs } from "./tabs"

import "../../../tokens/tokens.css"
import "./tabs.css"

const KEYS = ["claim", "attachments", "messages"]
const LABELS = ["Claim", "Attachments", "Messages"]
const CONTENT = [
  "Claim AV-2079-0481 was filed on 4 March 2079.",
  "Three attachments.",
  "No messages.",
]

/** The markup `lt.tabs()` gives: links, ids and classes. The web component writes the rest. */
const TABS = tabs({
  id: "file",
  keys: KEYS,
  label: "Parts of the claim",
})

/** The links in the tab list and the panels, from the builder function, separately. */
function parts(built: ReturnType<typeof tabs> = TABS, disabled: number[] = []) {
  const links = built.tabs
    .map(
      (tab, i) =>
        `<li><a ${attr(tab)}${disabled.includes(i) ? ' aria-disabled="true"' : ""}>${LABELS[i]}</a></li>`,
    )
    .join("")
  const panels = built.panels.map(
    (panel, i) =>
      `<section ${attr(panel)}><h2 ${attr(built.headings[i])}>${LABELS[i]}</h2><p>${CONTENT[i]}</p></section>`,
  )
  return { links, panels }
}

function fromBuilderFunction(built = TABS, host = ""): string {
  const { links, panels } = parts(built)
  return `
    <lt-tabs${host}>
      <ul ${attr(built.list)}>${links}</ul>
      ${panels.join("")}
    </lt-tabs>`
}

const allTabs = () => [
  ...document.querySelectorAll<HTMLElement>("lt-tabs [role='tab']"),
]
const allPanels = () => [
  ...document.querySelectorAll<HTMLElement>(".lt-tabs__panel"),
]
const selected = () =>
  allTabs().map((f) => f.getAttribute("aria-selected") === "true")
// `hidden` instead of `.hidden`: the property answers "until-found" for that form.
const hidden = () => allPanels().map((p) => p.hasAttribute("hidden"))

function pressKey(element: Element, key: string) {
  element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))
}

async function paint() {
  await customElements.whenDefined("lt-tabs")
  await waitForPaint()
}

beforeEach(async () => {
  // The web component reads the address on load, and the address carries
  // over between tests.
  await setAddress("")
})

describe("lt-tabs", () => {
  beforeAll(() => {
    defineLtTabs()
  })

  beforeEach(async () => {
    mount(fromBuilderFunction())
    await paint()
  })

  it("sets the roles and the wiring on markup from lt.tabs()", () => {
    const list = document.querySelector(".lt-tabs__list") as HTMLElement
    const [tab] = allTabs()
    const panel = document.getElementById("file-claim") as HTMLElement

    expect(list.getAttribute("role")).toBe("tablist")
    expect(list.getAttribute("aria-label")).toBe("Parts of the claim")
    expect(tab.getAttribute("role")).toBe("tab")
    expect(tab.getAttribute("aria-controls")).toBe("file-claim")
    expect(panel.getAttribute("role")).toBe("tabpanel")
    expect(panel.getAttribute("aria-labelledby")).toBe("file-claim-heading")
  })

  it("writes no id on the tabs", () => {
    // Datastar and idiomorph recognise an element by its id. An id the server
    // did not send makes the element get replaced at the next update.
    expect(allTabs().map((f) => f.id)).toEqual(["", "", ""])
  })

  it("hides the panels that are not selected with until-found", () => {
    // `lt.tabs()` does not write `hidden`, so the panels show without
    // JavaScript. The web component hides them, and with `until-found` find in
    // page reaches them.
    expect(allPanels().map((p) => p.getAttribute("hidden"))).toEqual([
      null,
      "until-found",
      "until-found",
    ])
  })

  it("gives only the selected tab a tab stop", () => {
    // Otherwise there is one tab stop per tab, and Tab never gets into the
    // panel without going through the whole tab list.
    expect(allTabs().map((f) => f.tabIndex)).toEqual([0, -1, -1])
  })

  it("does not ask the template to preserve anything", () => {
    // The tab selection belongs to the user, and the web component restores
    // it itself after a patch. If `data-preserve-attr` comes back here,
    // someone has revived the contract the template had to copy from the
    // documentation.
    expect(allTabs()[0].hasAttribute("data-preserve-attr")).toBe(false)
    expect(allPanels()[0].hasAttribute("data-preserve-attr")).toBe(false)
  })

  it("moves between the tabs with the arrow keys", async () => {
    allTabs()[0].focus()
    pressKey(allTabs()[0], "ArrowRight")
    await paint()

    expect(document.activeElement).toBe(allTabs()[1])
    expect(selected()).toEqual([false, true, false])
  })

  it("wraps from the last to the first", async () => {
    allTabs()[2].click()
    await paint()
    pressKey(allTabs()[2], "ArrowRight")
    await paint()

    expect(document.activeElement).toBe(allTabs()[0])
  })

  it("fires an event when a tab is selected", async () => {
    const events: number[] = []
    document
      .querySelector("lt-tabs")
      ?.addEventListener("tab-select", (event) => {
        events.push(event.detail.index)
      })
    allTabs()[1].click()
    await paint()

    expect(events).toEqual([1])
  })

  it("has no accessibility violations", async () => {
    await waitForPaint()
    await expectNoAccessibilityViolations()
  })
})

describe("lt.tabs() and the keys", () => {
  it("makes links, panel ids and heading ids from the keys", () => {
    // The full form is in requirement I5, in
    // `lt-tabs-requirements.browser.test.ts`.
    const f = tabs({ id: "file", keys: ["a", "b"], label: "The claim" })

    expect(f.tabs.map((t) => t.href)).toEqual(["#file-a", "#file-b"])
    expect(f.panels.map((p) => p.id)).toEqual(["file-a", "file-b"])
    expect(f.headings.map((h) => h.id)).toEqual([
      "file-a-heading",
      "file-b-heading",
    ])
  })

  it("gives an empty tab list for no keys", () => {
    const f = tabs({ id: "empty", keys: [], label: "Empty" })

    expect(f.tabs).toEqual([])
    expect(f.panels).toEqual([])
    expect(f.headings).toEqual([])
  })

  it("throws on a key that cannot become an id", () => {
    expect(() => tabs({ id: "x", keys: [""], label: "Tabs" })).toThrow(/empty/)
    expect(() => tabs({ id: "x", keys: ["a b"], label: "Tabs" })).toThrow(
      /whitespace/,
    )
    expect(() => tabs({ id: "x", keys: ["a\tb"], label: "Tabs" })).toThrow(
      /whitespace/,
    )
    expect(() => tabs({ id: "x", keys: ["a\u00a0b"], label: "Tabs" })).toThrow(
      /whitespace/,
    )
    expect(() => tabs({ id: "x", keys: ["a", "a"], label: "Tabs" })).toThrow(
      /twice/,
    )
    expect(() => tabs({ id: "x", keys: [1 as never], label: "Tabs" })).toThrow(
      /not a string/,
    )
    expect(() => tabs({ id: "x", label: "Tabs" } as never)).toThrow(
      /keys is missing/,
    )
  })
})

describe("lt-tabs finds the panel through href and skips what cannot be selected", () => {
  beforeAll(() => {
    defineLtTabs()
  })

  const list = (links: string) =>
    `<ul class="lt-tabs__list" role="tablist">${links}</ul>`

  it("skips a disabled tab with the arrow keys, Home and End", async () => {
    // Without this the arrow key selected the disabled tab, and the tab list
    // was left without a single tab that could take focus. The keyboard user
    // was locked out.
    const first = parts(TABS, [1])
    mount(`<lt-tabs>${list(first.links)}${first.panels.join("")}</lt-tabs>`)
    await paint()
    allTabs()[0].focus()

    pressKey(allTabs()[0], "ArrowRight")
    await paint()
    expect(document.activeElement).toBe(allTabs()[2])
    expect(selected()).toEqual([false, false, true])

    pressKey(allTabs()[2], "ArrowLeft")
    await paint()
    expect(document.activeElement).toBe(allTabs()[0])

    const second = parts(TABS, [2])
    mount(`<lt-tabs>${list(second.links)}${second.panels.join("")}</lt-tabs>`)
    await paint()
    allTabs()[0].focus()
    pressKey(allTabs()[0], "End")
    await paint()
    expect(document.activeElement).toBe(allTabs()[1])

    ;(document.querySelector("lt-tabs") as LtTabs).select(2)
    await paint()
    expect(selected()).toEqual([false, true, false])
  })

  it("goes to the first and last tab with Home and End", async () => {
    const { links, panels: p } = parts()
    mount(`<lt-tabs>${list(links)}${p.join("")}</lt-tabs>`)
    await paint()
    allTabs()[1].click()
    await paint()

    pressKey(allTabs()[1], "End")
    await paint()
    expect(document.activeElement).toBe(allTabs()[2])
    expect(selected()).toEqual([false, false, true])

    pressKey(allTabs()[2], "Home")
    await paint()
    expect(document.activeElement).toBe(allTabs()[0])
    expect(selected()).toEqual([true, false, false])
  })

  it("keeps tabs inside tabs as separate tab lists", async () => {
    // `querySelectorAll` over the whole subtree made an inner tab list part of
    // the outer one: a click on an inner tab hid the outer panel it was in.
    const outer = tabs({ id: "outer", keys: ["a", "b"], label: "Outer" })
    const inner = tabs({ id: "inner", keys: ["a", "b"], label: "Inner" })
    const row = (f: typeof outer, name: string) =>
      f.tabs.map((t, i) => `<li><a ${attr(t)}>${name} ${i}</a></li>`).join("")
    mount(`
      <lt-tabs>
        <ul ${attr(outer.list)}>${row(outer, "Outer")}</ul>
        <section ${attr(outer.panels[0])}>
          <h2 ${attr(outer.headings[0])}>Outer 0</h2>
          <lt-tabs>
            <ul ${attr(inner.list)}>${row(inner, "Inner")}</ul>
            <section ${attr(inner.panels[0])}><h3 ${attr(inner.headings[0])}>A</h3></section>
            <section ${attr(inner.panels[1])}><h3 ${attr(inner.headings[1])}>B</h3></section>
          </lt-tabs>
        </section>
        <section ${attr(outer.panels[1])}><h2 ${attr(outer.headings[1])}>Outer 1</h2></section>
      </lt-tabs>
    `)
    await paint()
    ;(
      document.querySelectorAll(
        "lt-tabs lt-tabs [role='tab']",
      )[1] as HTMLElement
    ).click()
    await paint()

    const isHidden = (id: string) =>
      (document.getElementById(id) as HTMLElement).hasAttribute("hidden")
    expect(isHidden("outer-a")).toBe(false)
    expect(isHidden("outer-b")).toBe(true)
    expect(isHidden("inner-a")).toBe(true)
    expect(isHidden("inner-b")).toBe(false)
    expect(
      document
        .querySelector("a[href='#outer-a']")
        ?.getAttribute("aria-selected"),
    ).toBe("true")
  })

  it("finds the panel through href, not through the order", async () => {
    // The wiring is in the markup, and is read from there. With the panels in
    // a different order, a click on tab 1 showed another tab's panel.
    const { links, panels: p } = parts()
    const [first, ...rest] = p
    mount(`<lt-tabs>${list(links)}${[...rest, first].join("")}</lt-tabs>`)
    await paint()
    allTabs()[1].click()
    await paint()

    const isHidden = (id: string) =>
      (document.getElementById(id) as HTMLElement).hasAttribute("hidden")
    expect(isHidden("file-claim")).toBe(true)
    expect(isHidden("file-attachments")).toBe(false)
    expect(isHidden("file-messages")).toBe(true)
  })

  it("finds a panel outside the host", async () => {
    const { links, panels: p } = parts()
    mount(`
      <lt-tabs>${list(links)}${p[0]}</lt-tabs>
      ${p[1]}
      ${p[2]}
    `)
    await paint()
    allTabs()[1].click()
    await paint()

    const isHidden = (id: string) =>
      (document.getElementById(id) as HTMLElement).hasAttribute("hidden")
    expect(isHidden("file-claim")).toBe(true)
    expect(isHidden("file-attachments")).toBe(false)
  })

  it("warns about a link that points to nothing, without freezing", async () => {
    // When the web component did not find the panel, two tabs could get the
    // same one and write opposite `hidden` on it in every round, and the page
    // froze.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const { links, panels: p } = parts()
      mount(`
        <lt-tabs>${list(
          links
            .replace('href="#file-attachments"', 'href="#file-attachmentsx"')
            .replace(
              'aria-controls="file-attachments"',
              'aria-controls="file-attachmentsx"',
            ),
        )}${p.join("")}</lt-tabs>
      `)
      await paint()
      allTabs()[2].click()
      await paint()
      allTabs()[0].click()
      await paint()
      await paint()

      const isHidden = (id: string) =>
        (document.getElementById(id) as HTMLElement).hasAttribute("hidden")
      expect(isHidden("file-claim")).toBe(false)
      expect(isHidden("file-messages")).toBe(true)
      expect(
        warn.mock.calls.some((k) =>
          String(k[0]).includes("has tabs without a panel"),
        ),
      ).toBe(true)
    } finally {
      vi.restoreAllMocks()
    }
  })

  it("shows a panel two tabs share when one of them is selected", async () => {
    // A mistake in the markup, but a silent wrong answer is worse than showing
    // the panel: when only the first tab wrote, the panel stayed hidden while
    // the other was selected.
    const { links, panels: p } = parts()
    mount(`
      <lt-tabs>${list(
        links
          .replace('href="#file-messages"', 'href="#file-claim"')
          .replace(
            'aria-controls="file-messages"',
            'aria-controls="file-claim"',
          ),
      )}${p.join("")}</lt-tabs>
    `)
    await paint()
    allTabs()[2].click()
    await paint()

    const isHidden = (id: string) =>
      (document.getElementById(id) as HTMLElement).hasAttribute("hidden")
    expect(selected()).toEqual([false, false, true])
    expect(isHidden("file-claim")).toBe(false)
    expect(isHidden("file-attachments")).toBe(true)
  })

  it("moves the tab stop when a patch disables the selected tab", async () => {
    const { links, panels: p } = parts()
    mount(`<lt-tabs>${list(links)}${p.join("")}</lt-tabs>`)
    await paint()
    allTabs()[1].click()
    await paint()
    allTabs()[1].setAttribute("aria-disabled", "true")
    await paint()

    // The selection stays, but the tab stop is a tab that can take focus.
    expect(selected()).toEqual([false, true, false])
    expect(allTabs().map((f) => f.tabIndex)).toEqual([-1, -1, 0])
  })

  it("lets selected be set as a property", async () => {
    // React 19 writes the property when it exists, and the documentation
    // shows `tabs.selected` as API. A getter alone threw on assignment.
    const { links, panels: p } = parts()
    mount(`<lt-tabs>${list(links)}${p.join("")}</lt-tabs>`)
    await paint()

    const events: number[] = []
    const host = document.querySelector("lt-tabs") as LtTabs
    host.addEventListener("tab-select", (h) => {
      events.push(h.detail.index)
    })
    host.selected = 2
    await paint()

    expect(host.selected).toBe(2)
    expect(selected()).toEqual([false, false, true])
    expect(events).toEqual([2])
  })

  it("swaps the left and right arrows in right-to-left", async () => {
    // On a page read from right to left the next tab is to the left. Without
    // this the right arrow moved focus visually backwards.
    const { links, panels: p } = parts()
    mount(`
      <div dir="rtl">
        <lt-tabs>${list(links)}${p.join("")}</lt-tabs>
      </div>
    `)
    await paint()
    allTabs()[1].click()
    await paint()

    pressKey(allTabs()[1], "ArrowRight")
    await paint()
    expect(document.activeElement).toBe(allTabs()[0])

    pressKey(allTabs()[0], "ArrowLeft")
    await paint()
    expect(document.activeElement).toBe(allTabs()[1])
  })
})

/*
 * Markup written without JavaScript: a list of links and one panel per link,
 * without roles, wiring or `hidden`. What the template must write is an id on
 * the panels, and it needs the links anyway. The web component fills in the
 * rest.
 */
const BARE = `
  <lt-tabs>
    <ul class="lt-tabs__list" aria-label="Parts of the claim">
      <li><a href="#claim">Claim</a></li>
      <li><a href="#attachments">Attachments</a></li>
      <li><a href="#messages">Messages</a></li>
    </ul>
    <section class="lt-tabs__panel" id="claim"><h2>Claim</h2><p>Claim AV-2079-0481 was filed on 4 March 2079.</p></section>
    <section class="lt-tabs__panel" id="attachments"><h2>Attachments</h2><p>Three attachments.</p></section>
    <section class="lt-tabs__panel" id="messages"><h2>Messages</h2><p>No messages.</p></section>
  </lt-tabs>`

describe("lt-tabs wires bare structure", () => {
  beforeAll(() => {
    defineLtTabs()
  })

  function bareParts() {
    return {
      list: document.querySelector(".lt-tabs__list") as HTMLElement,
      items: [...document.querySelectorAll<HTMLElement>(".lt-tabs__list li")],
      links: [
        ...document.querySelectorAll<HTMLAnchorElement>(".lt-tabs__list a"),
      ],
      panels: [...document.querySelectorAll<HTMLElement>(".lt-tabs__panel")],
    }
  }

  it("sets roles, wiring and tab stops", async () => {
    mount(BARE)
    await paint()
    const { list, items, links, panels: p } = bareParts()

    expect(list.getAttribute("role")).toBe("tablist")
    // Without the role a screen reader says "list, 3 items" before each tab.
    expect(items.map((li) => li.getAttribute("role"))).toEqual([
      "presentation",
      "presentation",
      "presentation",
    ])
    expect(links.map((l) => l.getAttribute("role"))).toEqual([
      "tab",
      "tab",
      "tab",
    ])
    expect(p.map((x) => x.getAttribute("role"))).toEqual([
      "tabpanel",
      "tabpanel",
      "tabpanel",
    ])
    links.forEach((link, i) => {
      expect(link.getAttribute("aria-controls")).toBe(p[i].id)
    })
    // Only the selected panel is a tab stop. A hidden panel that can take
    // focus is an invisible stop for the keyboard.
    expect(p.map((x) => x.getAttribute("tabindex"))).toEqual(["0", null, null])

    expect(links.map((l) => l.getAttribute("aria-selected"))).toEqual([
      "true",
      "false",
      "false",
    ])
    expect(links.map((l) => l.tabIndex)).toEqual([0, -1, -1])
    // Without `until-found`, find in page does not reach a hidden panel.
    expect(p.map((x) => x.getAttribute("hidden"))).toEqual([
      null,
      "until-found",
      "until-found",
    ])

    await expectNoAccessibilityViolations()
  })

  it("writes no id on links, list items, the tab list or the panels", async () => {
    mount(BARE)
    await paint()
    const { list, items, links, panels: p } = bareParts()

    expect([list, ...items, ...links].map((e) => e.id)).toEqual([
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ])
    // The panels' ids come from the server, and are the same as before.
    expect(p.map((x) => x.id)).toEqual(["claim", "attachments", "messages"])
  })

  it("names the panel from the heading in it", async () => {
    mount(BARE)
    await paint()
    const { panels: p } = bareParts()

    for (const panel of p) {
      const heading = panel.querySelector("h2") as HTMLElement
      expect(heading.id).not.toBe("")
      expect(panel.getAttribute("aria-labelledby")).toBe(heading.id)
      expect(panel.hasAttribute("aria-label")).toBe(false)
    }
  })

  it("uses the tab's text as the name when the panel has no heading", async () => {
    mount(BARE.replaceAll(/<h2>[^<]*<\/h2>/g, ""))
    await paint()
    const { panels: p } = bareParts()

    expect(p.map((x) => x.getAttribute("aria-label"))).toEqual([
      "Claim",
      "Attachments",
      "Messages",
    ])
    expect(p.some((x) => x.hasAttribute("aria-labelledby"))).toBe(false)
  })

  it("uses the tab's text as the name when aria-labelledby points to nothing", async () => {
    // An `aria-labelledby` without a valid id is ignored when the name is
    // computed, and then `aria-label` takes over.
    mount(
      BARE.replaceAll(/<h2>[^<]*<\/h2>/g, "").replace(
        'id="attachments"',
        'id="attachments" aria-labelledby="does-not-exist"',
      ),
    )
    await paint()
    const { panels: p } = bareParts()

    expect(p[1].getAttribute("aria-label")).toBe("Attachments")
    expect(p[1].getAttribute("aria-labelledby")).toBe("does-not-exist")
  })

  it("leaves a name the server wrote, and removes the fallback when it arrives", async () => {
    mount(
      BARE.replaceAll(/<h2>[^<]*<\/h2>/g, "").replace(
        'id="attachments"',
        'id="attachments" aria-labelledby="own-name"',
      ),
    )
    await paint()
    const { panels: p } = bareParts()
    expect(p[1].getAttribute("aria-label")).toBe("Attachments")

    p[1].insertAdjacentHTML("afterend", '<p id="own-name">My attachments</p>')
    await paint()

    expect(p[1].getAttribute("aria-labelledby")).toBe("own-name")
    expect(p[1].hasAttribute("aria-label")).toBe(false)
  })

  it("leaves an aria-label the server wrote", async () => {
    mount(
      BARE.replace(
        'id="attachments"',
        'id="attachments" aria-label="All attachments"',
      ),
    )
    await paint()
    const { panels: p } = bareParts()

    expect(p[1].getAttribute("aria-label")).toBe("All attachments")
    expect(p[1].hasAttribute("aria-labelledby")).toBe(false)
  })

  it("reads the selection from hidden when no tab is marked", async () => {
    mount(
      BARE.replace('id="claim"', 'id="claim" hidden').replace(
        'id="messages"',
        'id="messages" hidden',
      ),
    )
    await paint()
    const { links, panels: p } = bareParts()

    expect(links.map((l) => l.getAttribute("aria-selected"))).toEqual([
      "false",
      "true",
      "false",
    ])
    expect(links.map((l) => l.tabIndex)).toEqual([-1, 0, -1])
    expect(p.map((x) => x.hasAttribute("hidden"))).toEqual([true, false, true])
    // The form the server used, also on the panel it had not hidden.
    expect(p[0].getAttribute("hidden")).toBe("")
  })

  it("leaves what the server wrote", async () => {
    // Values the web component would never write itself, so the test tells
    // "left alone" from "wrote the same".
    mount(BARE.replace('id="attachments"', 'id="attachments" tabindex="-1"'))
    await paint()
    const { panels: p } = bareParts()

    expect(p[1].tabIndex).toBe(-1)
  })

  it("writes aria-controls from href, also when the server wrote another", async () => {
    // The two are the same information, and `href` is the one that works
    // without JavaScript.
    mount(
      BARE.replace(
        '<a href="#attachments">',
        '<a href="#attachments" aria-controls="wrong">',
      ),
    )
    await paint()
    const { links } = bareParts()

    expect(links[1].getAttribute("aria-controls")).toBe("attachments")
  })

  it("restores the wiring with the same heading id after a patch", async () => {
    mount(BARE)
    await paint()
    const { links, panels: p } = bareParts()
    const heading = p[1].querySelector("h2") as HTMLElement
    const id = heading.id

    // As a morph does it: everything that was not in the server's HTML is
    // removed.
    for (const name of ["role", "aria-controls", "aria-selected", "tabindex"]) {
      links[1].removeAttribute(name)
    }
    for (const name of ["role", "aria-labelledby", "tabindex", "hidden"]) {
      p[1].removeAttribute(name)
    }
    heading.removeAttribute("id")
    await waitForPaint()

    expect(heading.id).toBe(id)
    expect(p[1].getAttribute("aria-labelledby")).toBe(id)
    expect(links[1].getAttribute("aria-controls")).toBe("attachments")
    expect(links[1].getAttribute("role")).toBe("tab")
    expect(links[1].getAttribute("aria-selected")).toBe("false")
    expect(p[1].getAttribute("hidden")).toBe("until-found")
  })

  it("lets the server switch tab with hidden alone under server-controlled", async () => {
    /*
     * The idiomatic Datastar way: `data-attr:hidden` on each panel, and
     * nothing on the tabs. The web component had written
     * `aria-selected="true"` on the first itself, and read it back as the
     * server's word, so the panel the server had just shown was hidden again.
     */
    mount(BARE.replace("<lt-tabs>", "<lt-tabs server-controlled>"))
    await paint()
    const { links, panels: p } = bareParts()
    expect(links[0].getAttribute("aria-selected")).toBe("true")

    p[0].setAttribute("hidden", "")
    p[1].removeAttribute("hidden")
    await waitForPaint()

    expect(p.map((x) => x.hasAttribute("hidden"))).toEqual([true, false, true])
    expect(links.map((l) => l.getAttribute("aria-selected"))).toEqual([
      "false",
      "true",
      "false",
    ])
    expect(links.map((l) => l.tabIndex)).toEqual([-1, 0, -1])
  })

  it("leaves a link without a role alone when the server wrote the roles", async () => {
    // If the server has written the roles itself, a link without a role in
    // the tab list is something other than a tab.
    mount(`
      <lt-tabs>
        <ul class="lt-tabs__list" role="tablist" aria-label="Parts of the claim">
          <li role="presentation"><a href="#claim" role="tab">Claim</a></li>
          <li role="presentation"><a href="#attachments" role="tab">Attachments</a></li>
          <li><a href="#other" class="back-to-top">Back to top</a></li>
        </ul>
        <section class="lt-tabs__panel" id="claim"><h2>Claim</h2></section>
        <section class="lt-tabs__panel" id="attachments"><h2>Attachments</h2></section>
      </lt-tabs>
    `)
    await paint()
    const other = document.querySelector(".back-to-top") as HTMLElement

    expect(other.hasAttribute("role")).toBe(false)
    expect(other.hasAttribute("aria-selected")).toBe(false)
    expect(other.tabIndex).toBe(0)
  })

  it("takes a new link in a bare tab list as a tab", async () => {
    mount(BARE)
    await paint()
    const { list, panels: p } = bareParts()

    const item = document.createElement("li")
    item.innerHTML = '<a href="#history">History</a>'
    list.append(item)
    const panel = document.createElement("section")
    panel.className = "lt-tabs__panel"
    panel.id = "history"
    panel.innerHTML = "<h2>History</h2>"
    p[2].after(panel)
    await waitForPaint()
    const newLink = item.querySelector("a") as HTMLElement

    expect(item.getAttribute("role")).toBe("presentation")
    expect(newLink.getAttribute("role")).toBe("tab")
    expect(newLink.getAttribute("aria-controls")).toBe("history")
    expect(panel.getAttribute("hidden")).toBe("until-found")
  })

  it("keeps the user's selection through a patch that removes everything the web component wrote", async () => {
    mount(BARE)
    await paint()
    const { links, panels: p } = bareParts()

    links[2].click()
    await waitForPaint()
    expect(p[2].hasAttribute("hidden")).toBe(false)

    for (const link of links) {
      for (const name of ["aria-selected", "tabindex", "aria-controls"]) {
        link.removeAttribute(name)
      }
    }
    for (const panel of p) panel.removeAttribute("hidden")
    await waitForPaint()

    expect(links.map((l) => l.getAttribute("aria-selected"))).toEqual([
      "false",
      "false",
      "true",
    ])
    expect(p.map((x) => x.hasAttribute("hidden"))).toEqual([true, true, false])
  })
})

describe("lt-tabs under server-controlled", () => {
  beforeAll(() => {
    defineLtTabs()
  })

  /** The recipe from the Datastar tab on the component page, bare structure. */
  const RECIPE = `
    <lt-tabs server-controlled>
      <ul class="lt-tabs__list" aria-label="Parts of the claim">
        <li><a href="#claim">Claim</a></li>
        <li><a href="#attachments">Attachments</a></li>
      </ul>
      <section class="lt-tabs__panel" id="claim"><h2>Claim</h2></section>
      <section class="lt-tabs__panel" id="attachments" hidden><h2>Attachments</h2></section>
    </lt-tabs>`

  function state() {
    return {
      selected: [...document.querySelectorAll("lt-tabs a")].map((l) =>
        l.getAttribute("aria-selected"),
      ),
      hidden: allPanels().map((p) => p.hasAttribute("hidden")),
    }
  }

  it("lets a click stand after the observer has run", async () => {
    /*
     * The click was undone in the next microtask: `repair()` read the
     * server's old word from memory. A test that reads right after the click
     * does not see it, so this one waits for a frame first.
     */
    mount(RECIPE)
    await paint()

    document.querySelectorAll<HTMLElement>("lt-tabs a")[1].click()
    await waitForPaint()

    expect(state()).toEqual({
      selected: ["false", "true"],
      hidden: [true, false],
    })
  })

  it("follows a server that moves with hidden alone, after server-controlled was set after a click", async () => {
    // When the attribute is set midway, what is there is the starting point.
    // But the web component wrote `aria-selected` on the tabs itself on the
    // click. When that counted as the server's, it took precedence over
    // `hidden`, and the server could not move the tab.
    mount(RECIPE.replace("<lt-tabs server-controlled>", "<lt-tabs>"))
    await paint()
    const host = document.querySelector("lt-tabs") as HTMLElement
    document.querySelectorAll<HTMLElement>("lt-tabs a")[1].click()
    await waitForPaint()
    host.setAttribute("server-controlled", "")
    await waitForPaint()

    const p = allPanels()
    p[0].removeAttribute("hidden")
    p[1].setAttribute("hidden", "")
    await waitForPaint()

    expect(state()).toEqual({
      selected: ["true", "false"],
      hidden: [false, true],
    })
  })

  it("takes what is there as the starting point when server-controlled is set, and repairs again when it is removed", async () => {
    // Without the attribute from the start, as when a patch sets it.
    mount(RECIPE.replace("<lt-tabs server-controlled>", "<lt-tabs>"))
    await paint()
    const host = document.querySelector("lt-tabs") as HTMLElement
    const links = [...document.querySelectorAll<HTMLElement>("lt-tabs a")]
    links[1].click()
    await waitForPaint()

    // The server takes over, and a patch writes the panel as it is. Unless
    // the web component forgot its memory, the tab list jumped back to what
    // the server said before the click.
    host.setAttribute("server-controlled", "")
    const p = allPanels()
    p[0].setAttribute("hidden", p[0].getAttribute("hidden") ?? "")
    await waitForPaint()
    expect(state()).toEqual({
      selected: ["false", "true"],
      hidden: [true, false],
    })

    // The server lets go again and sends the first. The earlier click is
    // forgotten, and does not come back.
    host.removeAttribute("server-controlled")
    p[0].removeAttribute("hidden")
    p[1].setAttribute("hidden", "")
    await waitForPaint()
    expect(state()).toEqual({
      selected: ["true", "false"],
      hidden: [false, true],
    })

    // A new click stands through a patch that strips it.
    links[1].click()
    await waitForPaint()
    p[0].removeAttribute("hidden")
    p[1].setAttribute("hidden", "")
    await waitForPaint()

    expect(state()).toEqual({
      selected: ["false", "true"],
      hidden: [true, false],
    })
  })

  it("lets the server move the selection after the click", async () => {
    mount(RECIPE)
    await paint()
    const p = allPanels()

    document.querySelectorAll<HTMLElement>("lt-tabs a")[1].click()
    await waitForPaint()

    // The server sends the first tab again, and touches only the panels.
    p[0].removeAttribute("hidden")
    p[1].setAttribute("hidden", "")
    await waitForPaint()

    expect(state()).toEqual({
      selected: ["true", "false"],
      hidden: [false, true],
    })
  })

  /** Three tabs: with two, "back to the first" is also the wrong answer. */
  const THREE = `
    <lt-tabs server-controlled>
      <ul class="lt-tabs__list" aria-label="Parts of the claim">
        <li><a href="#claim">Claim</a></li>
        <li><a href="#attachments">Attachments</a></li>
        <li><a href="#messages">Messages</a></li>
      </ul>
      <section class="lt-tabs__panel" id="claim"><h2>Claim</h2></section>
      <section class="lt-tabs__panel" id="attachments" hidden><h2>Attachments</h2></section>
      <section class="lt-tabs__panel" id="messages" hidden><h2>Messages</h2></section>
    </lt-tabs>`

  async function clickSecond() {
    mount(THREE)
    await paint()
    document.querySelectorAll<HTMLElement>("lt-tabs a")[1].click()
    await waitForPaint()
    return {
      links: [...document.querySelectorAll<HTMLElement>("lt-tabs a")],
      panels: allPanels(),
    }
  }

  it("follows the server to a third tab, not back to the first", async () => {
    const { panels: p } = await clickSecond()

    // The server answers with the third, and touches only the panels.
    p[1].setAttribute("hidden", "")
    p[2].removeAttribute("hidden")
    await waitForPaint()

    expect(state()).toEqual({
      selected: ["false", "false", "true"],
      hidden: [true, true, false],
    })
  })

  it("follows the server when it moves aria-selected to a third tab", async () => {
    const { links } = await clickSecond()

    links[1].setAttribute("aria-selected", "false")
    links[2].setAttribute("aria-selected", "true")
    await waitForPaint()

    expect(state()).toEqual({
      selected: ["false", "false", "true"],
      hidden: [true, true, false],
    })
  })

  it("follows the server also after a tab was added while the click was pending", async () => {
    const { panels: p } = await clickSecond()
    const host = document.querySelector("lt-tabs") as HTMLElement

    // A patch adds a fourth tab. It has said nothing about the selection.
    host
      .querySelector(".lt-tabs__list")
      ?.insertAdjacentHTML(
        "beforeend",
        '<li><a href="#history">History</a></li>',
      )
    host.insertAdjacentHTML(
      "beforeend",
      '<section class="lt-tabs__panel" id="history" hidden><h2>History</h2></section>',
    )
    await waitForPaint()
    expect(state().selected).toEqual(["false", "true", "false", "false"])

    // Then the server moves to the third, with `hidden` alone.
    p[1].setAttribute("hidden", "")
    p[2].removeAttribute("hidden")
    await waitForPaint()

    expect(state()).toEqual({
      selected: ["false", "false", "true", "false"],
      hidden: [true, true, false, true],
    })
  })

  it("stays on the clicked tab when the server confirms it with bare markup", async () => {
    /*
     * The morph strips `aria-selected` from the tabs, since the server's
     * markup does not have it, and leaves the panels: they are already as the
     * server sent them. The server's old word about the panels then won, and
     * the tab list jumped back.
     */
    const { links } = await clickSecond()

    for (const link of links) link.removeAttribute("aria-selected")
    await waitForPaint()

    expect(state()).toEqual({
      selected: ["false", "true", "false"],
      hidden: [true, false, true],
    })
  })

  it("ignores the address, so the server decides", async () => {
    await setAddress("#messages")
    mount(THREE)
    await paint()

    expect(state().selected).toEqual(["true", "false", "false"])
  })

  it("ignores the address also when it changes", async () => {
    mount(THREE)
    await paint()

    await goTo("#messages")
    await paint()

    expect(state().selected).toEqual(["true", "false", "false"])
  })

  it("reports a click with tab-select, and writes it to the address", async () => {
    mount(THREE)
    await paint()
    const reported: number[] = []
    document
      .querySelector("lt-tabs")
      ?.addEventListener("tab-select", (e) =>
        reported.push((e as CustomEvent<{ index: number }>).detail.index),
      )

    document.querySelectorAll<HTMLElement>("lt-tabs a")[2].click()
    await waitForPaint()

    expect(reported).toEqual([2])
    expect(location.hash).toBe("#messages")
  })
})

describe("lt-tabs when a patch touches the panels and the links", () => {
  beforeAll(() => {
    defineLtTabs()
  })

  it("gives a new panel with the same id the role, the name and hidden", async () => {
    mount(BARE)
    await paint()
    const oldPanel = document.getElementById("attachments") as HTMLElement

    const newPanel = document.createElement("section")
    newPanel.className = "lt-tabs__panel"
    newPanel.id = "attachments"
    newPanel.innerHTML = "<h2>New attachments</h2>"
    oldPanel.replaceWith(newPanel)
    await waitForPaint()

    expect(newPanel.getAttribute("role")).toBe("tabpanel")
    expect(
      newPanel.hasAttribute("hidden"),
      "the panel of a tab that is not selected is visible",
    ).toBe(true)
    // The heading says something other than the tab, so the panel is named
    // what the tab is named.
    expect(newPanel.getAttribute("aria-label")).toBe("Attachments")
  })

  it("follows the markup when the patch replaces the links", async () => {
    /*
     * The selection is tied to the link itself and only survives a morph that
     * keeps the nodes. `innerHTML` and htmx's default swap create new nodes,
     * and then what the markup says applies, and otherwise the address.
     */
    const bare = BARE.slice(BARE.indexOf(">") + 1, BARE.lastIndexOf("<"))
    mount(BARE)
    await paint()
    const host = document.querySelector("lt-tabs") as LtTabs
    allTabs()[1].click()
    await waitForPaint()
    expect(host.selected).toBe(1)
    expect(location.hash).toBe("#attachments")

    // No tab marked by the server: the address says where the user was.
    host.innerHTML = bare
    await waitForPaint()
    expect(host.selected).toBe(1)

    // The server marks a tab itself, and it wins over the address.
    host.innerHTML = bare
      .replace('<a href="#claim">', '<a href="#claim" aria-selected="true">')
      .replace('id="attachments"', 'id="attachments" hidden')
    await waitForPaint()
    expect(host.selected).toBe(0)

    // Nothing in the address either: the first.
    history.replaceState(null, "", location.pathname + location.search)
    host.innerHTML = bare
    await waitForPaint()
    expect(host.selected).toBe(0)
    expect(allTabs()[0].getAttribute("aria-selected")).toBe("true")
  })

  it("warns and leaves the other panels alone when one is removed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      mount(BARE)
      await paint()
      const links = allTabs()
      const p = allPanels()

      p[1].remove()
      await paint()
      await paint()

      expect(links[2].getAttribute("aria-controls")).toBe("messages")
      expect(p[2].getAttribute("role")).toBe("tabpanel")
      expect(
        warn.mock.calls.some((k) =>
          String(k[0]).includes("has tabs without a panel"),
        ),
      ).toBe(true)
    } finally {
      vi.restoreAllMocks()
    }
  })

  it("leaves the browser's shortcuts with Alt and Cmd alone", async () => {
    mount(BARE)
    await paint()
    allTabs()[0].focus()

    for (const modifier of ["altKey", "metaKey", "ctrlKey"] as const) {
      const keyEvent = new KeyboardEvent("keydown", {
        key: "ArrowRight",
        [modifier]: true,
        bubbles: true,
        cancelable: true,
      })
      allTabs()[0].dispatchEvent(keyEvent)

      expect(keyEvent.defaultPrevented, modifier).toBe(false)
      expect(allTabs()[0].getAttribute("aria-selected"), modifier).toBe("true")
    }
  })
})

describe("lt-tabs as links", () => {
  beforeAll(() => {
    defineLtTabs()
  })

  it("writes the selection to the address without jumping, and without a new history entry", async () => {
    mount(fromBuilderFunction())
    await paint()
    const historyLength = history.length

    const clickEvent = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    })
    allTabs()[1].dispatchEvent(clickEvent)
    await paint()

    expect(clickEvent.defaultPrevented).toBe(true)
    expect(location.hash).toBe("#file-attachments")
    expect(history.length).toBe(historyLength)
    expect(selected()).toEqual([false, true, false])
  })

  it("selects the tab even when the address cannot be written", async () => {
    // Safari throws after a hundred calls in ten seconds. The throw stopped
    // the click before the tab was selected.
    mount(fromBuilderFunction())
    await paint()
    const write = vi.spyOn(history, "replaceState").mockImplementation(() => {
      throw new DOMException("Too many calls", "SecurityError")
    })
    try {
      allTabs()[1].click()
      await paint()

      expect(write).toHaveBeenCalled()
      expect(selected()).toEqual([false, true, false])
    } finally {
      write.mockRestore()
    }
  })

  it("lets the browser open the link when a modifier is held down", async () => {
    mount(fromBuilderFunction())
    await paint()
    const link = allTabs()[1]

    // The listener on the link runs after the web component's, and stops the
    // test from actually navigating.
    let prevented: boolean | undefined
    link.addEventListener("click", (event) => {
      prevented = event.defaultPrevented
      event.preventDefault()
    })
    link.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
      }),
    )
    await paint()

    expect(prevented).toBe(false)
    expect(selected()).toEqual([true, false, false])
    expect(location.hash).toBe("")
  })

  it("selects the tab the address points to on load", async () => {
    await setAddress("#file-attachments")
    mount(fromBuilderFunction())
    await paint()

    expect(selected()).toEqual([false, true, false])
    expect(hidden()).toEqual([true, false, true])
  })

  it("selects the tab when the address changes", async () => {
    mount(fromBuilderFunction())
    await paint()

    history.replaceState(null, "", "#file-messages")
    window.dispatchEvent(new HashChangeEvent("hashchange"))
    await paint()

    expect(selected()).toEqual([false, false, true])
  })

  it("selects the tab on beforematch", async () => {
    mount(BARE)
    await paint()

    allPanels()[2].dispatchEvent(new Event("beforematch", { bubbles: true }))
    await paint()

    expect(selected()).toEqual([false, false, true])
  })

  it("lets a panel hidden with until-found take no space", async () => {
    // A hidden panel keeps its box, so the spacing around the content must be
    // zeroed, or there is an empty gap under the selected panel.
    mount(BARE)
    await paint()

    const heights = allPanels().map((p) => p.getBoundingClientRect().height)

    expect(heights[0]).toBeGreaterThan(0)
    expect(heights[1]).toBe(0)
    expect(heights[2]).toBe(0)
  })

  it("hides the panels in the same form across the whole tab list", async () => {
    // The server hides with `hidden=""`. The first panel was never hidden by
    // the server, but gets the same form as the others when it is hidden.
    mount(
      BARE.replace('id="attachments"', 'id="attachments" hidden').replace(
        'id="messages"',
        'id="messages" hidden',
      ),
    )
    await paint()

    allTabs()[1].click()
    await paint()

    expect(allPanels().map((p) => p.getAttribute("hidden"))).toEqual([
      "",
      null,
      "",
    ])
  })

  it("only moves focus with the arrow keys under manual activation, and selects with Space", async () => {
    mount(fromBuilderFunction(TABS, ' activation="manual"'))
    await paint()
    allTabs()[0].focus()

    pressKey(allTabs()[0], "ArrowRight")
    await paint()
    expect(document.activeElement).toBe(allTabs()[1])
    expect(selected()).toEqual([true, false, false])

    const space = new KeyboardEvent("keydown", {
      key: " ",
      bubbles: true,
      cancelable: true,
    })
    allTabs()[1].dispatchEvent(space)
    await paint()

    expect(space.defaultPrevented).toBe(true)
    expect(selected()).toEqual([false, true, false])
  })

  it("selects at once by default", async () => {
    mount(fromBuilderFunction())
    await paint()
    allTabs()[0].focus()

    pressKey(allTabs()[0], "ArrowRight")
    await paint()

    expect(selected()).toEqual([false, true, false])
  })
})

describe("lt-tabs after a morph and with arrow keys", () => {
  beforeAll(() => {
    defineLtTabs()
  })

  const CASE_TABS = tabs({
    id: "s",
    keys: ["a", "b", "c"],
    label: "The claim",
  })
  const links = () =>
    CASE_TABS.tabs
      .map((tab, i) => `<li><a ${attr(tab)}>Tab ${i}</a></li>`)
      .join("")

  async function mountTabs() {
    mount(`
      <lt-tabs>
        <ul ${attr(CASE_TABS.list)}>${links()}</ul>
        ${CASE_TABS.panels
          .map(
            (panel, i) =>
              `<section ${attr(panel)}><h2 ${attr(CASE_TABS.headings[i])}>Panel ${i}</h2></section>`,
          )
          .join("")}
      </lt-tabs>`)
    await paint()
    return document.querySelector("lt-tabs") as HTMLElement
  }

  it("works on tabs a morph has replaced", async () => {
    // One listener on the host. Before, every new tab got its own listeners,
    // and the old ones were kept in memory.
    const host = await mountTabs()
    const row = host.querySelector(".lt-tabs__list") as HTMLElement
    for (let round = 0; round < 3; round++) {
      row.innerHTML = links()
      await waitForPaint()
    }

    allTabs()[2].click()
    await waitForPaint()
    expect(
      (document.getElementById("s-c") as HTMLElement).hasAttribute("hidden"),
    ).toBe(false)

    allTabs()[2].focus()
    pressKey(allTabs()[2], "ArrowRight")
    await waitForPaint()
    expect(document.activeElement).toBe(allTabs()[0])
  })

  it("works even when something on the tab list stops the events", async () => {
    // The listener is on the host. Without the capture phase, clicks and
    // arrow keys did not get through when the tab list had a listener that
    // stopped them.
    const host = await mountTabs()
    const row = host.querySelector(".lt-tabs__list") as HTMLElement
    row.addEventListener("keydown", (event) => event.stopPropagation())
    row.addEventListener("click", (event) => event.stopPropagation())

    allTabs()[0].focus()
    pressKey(allTabs()[0], "ArrowRight")
    await waitForPaint()
    expect(document.activeElement).toBe(allTabs()[1])

    allTabs()[2].click()
    await waitForPaint()
    expect(
      (document.getElementById("s-c") as HTMLElement).hasAttribute("hidden"),
    ).toBe(false)
  })

  it("leaves the down arrow alone in a horizontal tab list", async () => {
    // Before, it moved focus and stole page scrolling.
    await mountTabs()
    const first = allTabs()[0]
    first.focus()
    const keyEvent = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    })

    first.dispatchEvent(keyEvent)
    await waitForPaint()

    expect(document.activeElement).toBe(first)
    expect(keyEvent.defaultPrevented).toBe(false)
  })

  it("uses the down arrow in a vertical tab list", async () => {
    const host = await mountTabs()
    host
      .querySelector("[role='tablist']")
      ?.setAttribute("aria-orientation", "vertical")
    allTabs()[0].focus()

    pressKey(allTabs()[0], "ArrowDown")
    await waitForPaint()

    expect(document.activeElement).toBe(allTabs()[1])
  })
})

describe("lt-tabs through a morph from the server", () => {
  beforeAll(() => {
    defineLtTabs()
  })

  const link = (key: string, extra = "") =>
    `<li><a href="#${key}"${extra}>${LABELS[KEYS.indexOf(key)] ?? "Summary"}</a></li>`
  const panel = (key: string, extra = "") =>
    `<section class="lt-tabs__panel" id="${key}"${extra}><h2>${LABELS[KEYS.indexOf(key)] ?? "Summary"}</h2></section>`
  /** The recipe on the component page, with `links` and `panels` as given. */
  const host = (links: string[], panels: string[], extra = "") =>
    `<lt-tabs id="claim-tabs"${extra}><ul class="lt-tabs__list" aria-label="Parts of the claim">${links.join("")}</ul>${panels.join("")}</lt-tabs>`
  const RECIPE = host(
    [link("claim"), link("attachments")],
    [panel("claim"), panel("attachments")],
  )
  /** The recipe with a tab first in the row: the same index is another tab. */
  const INSERTED = host(
    [link("summary"), link("claim"), link("attachments")],
    [panel("summary"), panel("claim"), panel("attachments")],
  )
  const ways = ["Datastar", "idiomorph"] as const

  it("hears the server's hidden when it is the value the component wrote", async () => {
    /*
     * The server selects the second tab with `aria-selected`, and the
     * component hides the first panel. Then the server selects it by hiding
     * the first panel alone, as the component had: the morph leaves a value
     * that is already right, the component took it for its own echo, and the
     * tab list went to the first tab, not where the same markup mounted fresh
     * goes.
     */
    mount(RECIPE)
    await paint()
    replace(
      "Datastar",
      "claim-tabs",
      host(
        [link("claim"), link("attachments", ' aria-selected="true"')],
        [panel("claim"), panel("attachments")],
      ),
    )
    await waitForPaint()
    replace(
      "Datastar",
      "claim-tabs",
      host(
        [link("claim"), link("attachments")],
        [panel("claim", ' hidden="until-found"'), panel("attachments")],
      ),
    )
    await waitForPaint()

    expect(selected()).toEqual([false, true])
  })

  for (const way of ways) {
    it(`keeps the user's tab when the server inserts a tab before it, by ${way}`, async () => {
      /*
       * The morphers match links without ids by position, and the link the
       * user pressed became the inserted tab: only the panel it pointed to
       * tells which tab was the user's. The server marks the new tab, so the
       * address, which would have said it too, loses.
       */
      mount(RECIPE)
      await paint()
      allTabs()[1].click()
      await waitForPaint()

      replace(
        way,
        "claim-tabs",
        INSERTED.replace(
          'href="#summary"',
          'href="#summary" aria-selected="true"',
        ),
      )
      await waitForPaint()

      expect(selected()).toEqual([false, false, true])
      expect(location.hash).toBe("#attachments")
    })

    it(`keeps the user's tab when a morph drops its link and keeps others, by ${way}`, async () => {
      /*
       * The row shrinks from the front, and the morph removes the last link,
       * the user's, and keeps the others: only the panel it pointed to tells
       * which tab was the user's. The server marks another tab, so the
       * address loses, as above.
       */
      mount(INSERTED)
      await paint()
      allTabs()[2].click()
      await waitForPaint()

      replace(
        way,
        "claim-tabs",
        RECIPE.replace('href="#claim"', 'href="#claim" aria-selected="true"'),
      )
      await waitForPaint()

      expect(selected()).toEqual([false, true])
    })
  }

  it("hears the server move the selection with hidden alone, after a click on one of three tabs under server-controlled", async () => {
    /*
     * A click on the second leaves the third tab as the server said, so the
     * component marks nothing there. The missing mark was read as the
     * server's touch, the click was released at once, and its own
     * `aria-selected` became the server's word, so the answer through
     * `hidden`, as `data-attr:hidden` in Datastar writes it, was not heard.
     */
    const until = ' hidden="until-found"'
    mount(
      host(
        [
          link("claim", ' aria-selected="true"'),
          link("attachments", ' aria-selected="false"'),
          link("messages", ' aria-selected="false"'),
        ],
        [panel("claim"), panel("attachments", until), panel("messages", until)],
        " server-controlled",
      ),
    )
    await paint()
    allTabs()[1].click()
    await waitForPaint()

    const [first, ...rest] = allPanels()
    first.removeAttribute("hidden")
    for (const p of rest) p.setAttribute("hidden", "until-found")
    await waitForPaint()

    expect(selected()).toEqual([true, false, false])
  })
})
