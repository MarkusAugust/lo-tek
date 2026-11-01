/// <reference path="../../../types/css.d.ts" />
/// <reference types="@vitest/browser-playwright" />

/**
 * The requirements for the tabs, one requirement per test, with the
 * requirement's number in the name.
 *
 * The requirements are in `krav-faner.md` in the investigation, with a
 * source for each. Requirements that already have a test that can fail are
 * in `lt-tabs.browser.test.ts` and `lt-tabs-morph.browser.test.ts`. The page
 * without JavaScript is tested in `scripts/check-without-javascript.ts`,
 * since Vitest is itself a script.
 */

import { createElement as h } from "react"
import { hydrateRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { cdp, server, userEvent } from "vitest/browser"

import { lt as ltReact } from "../../../react"
import { mount, waitForPaint } from "../../../testing/a11y"
import { setAddress } from "../../../testing/address"
import { rgb } from "../../../testing/color"
import { Idiomorph } from "../../../testing/idiomorph/idiomorph-v0.8.0.js"
import { attr, wiredName } from "../../../testing/markup"
import { contrastRatio } from "../../../tokens/color"
import { defineLtTabs, LtTabs } from "./lt-tabs"
import { tabs } from "./tabs"

import "../../../tokens/tokens.css"
import "./tabs.css"

const NAMES = ["Claim", "Attachments", "Messages"]
const KEYS = ["claim", "attachments", "messages"]

type Bar = {
  host?: string
  list?: string
  heading?: (i: number) => string | null
  link?: (i: number) => string
  panel?: (i: number) => string
  inside?: (i: number) => string
}

/** The tabs as a template writes them by hand: links, and ids only on the panels. */
function bar(options: Bar = {}): string {
  const heading = options.heading ?? ((i) => NAMES[i])
  return `
    <lt-tabs${options.host ?? ""}>
      <ul class="lt-tabs__list"${options.list ?? ' aria-label="Parts of the claim"'}>
        ${NAMES.map((n, i) => `<li><a href="#${KEYS[i]}"${options.link?.(i) ?? ""}>${n}</a></li>`).join("")}
      </ul>
      ${NAMES.map((_, i) => {
        const title = heading(i)
        return `<section class="lt-tabs__panel" id="${KEYS[i]}"${options.panel?.(i) ?? ""}>${title === null ? "" : `<h2>${title}</h2>`}<p id="inside-${KEYS[i]}">Content of ${NAMES[i].toLowerCase()}.</p>${options.inside?.(i) ?? ""}</section>`
      }).join("")}
    </lt-tabs>`
}

/** What `lt.tabs()` writes, put together the way a template does it. */
function fromBuilder(): string {
  const f = tabs({ id: "file", keys: KEYS, label: "Parts of the claim" })
  return `
    <lt-tabs>
      <ul ${attr(f.list)}>
        ${f.tabs.map((t, i) => `<li><a ${attr(t)}>${NAMES[i]}</a></li>`).join("")}
      </ul>
      ${f.panels.map((p, i) => `<section ${attr(p)}><h2 ${attr(f.headings[i])}>${NAMES[i]}</h2><p>Content of ${NAMES[i].toLowerCase()}.</p></section>`).join("")}
    </lt-tabs>`
}

const host = () => document.querySelector("lt-tabs") as LtTabs
const links = () => [
  ...document.querySelectorAll<HTMLElement>("lt-tabs .lt-tabs__list a"),
]
const panels = () => [
  ...document.querySelectorAll<HTMLElement>(".lt-tabs__panel"),
]
const selectedTabs = () =>
  links().map((f) => f.getAttribute("aria-selected") === "true")
const hiddenPanels = () => panels().map((p) => p.hasAttribute("hidden"))

/**
 * Tab, as a keyboard user presses it. WebKit on macOS, like Safari, skips
 * links with Tab, and there it is Alt+Tab that moves to links.
 */
async function tab() {
  if (server.browser === "webkit") await userEvent.keyboard("{Alt>}{Tab}{/Alt}")
  else await userEvent.tab()
}

async function settle() {
  await customElements.whenDefined("lt-tabs")
  await waitForPaint()
}

/**
 * Stops `hashchange`, as find in page does: the browser reveals the match
 * and sends `beforematch`, but does not change the address. Without this the
 * address selected the tab, and a test of `beforematch` could not fail.
 *
 * Called before `mount()`: Chromium calls the listeners on `window` in the
 * order they were added, a listener in the capture phase included, so a
 * stopper added after the component's stopped nothing there.
 */
function likeFindInPage(): () => void {
  const stop = (e: Event) => e.stopImmediatePropagation()
  window.addEventListener("hashchange", stop, true)
  return () => window.removeEventListener("hashchange", stop, true)
}

function spyOnWarnings() {
  return vi.spyOn(console, "warn").mockImplementation(() => {})
}

/** The warnings that have arrived, once `warnAboutMarkup` has checked its condition. */
async function warnings(spy: ReturnType<typeof spyOnWarnings>) {
  await waitForPaint()
  await waitForPaint()
  return spy.mock.calls.map((k) => String(k[0]))
}

beforeAll(() => {
  defineLtTabs()
})

beforeEach(async () => {
  await setAddress("")
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("A. Three states of the page", () => {
  it("A6: registration gives markup from lt.tabs() the same state as hand-written markup, and changes nothing the builder function wrote", async () => {
    /** The attributes that carry the tabs, without ids, which differ between the two sources. */
    const state = () =>
      [...document.querySelectorAll("lt-tabs, lt-tabs *")].map((e) =>
        [...e.attributes]
          .filter(
            (a) =>
              ![
                "id",
                "href",
                "aria-controls",
                "aria-labelledby",
                "class",
                "aria-label",
              ].includes(a.name),
          )
          .map((a) => `${a.name}=${a.value}`)
          .sort()
          .join(" "),
      )

    mount(bar({ heading: (i) => NAMES[i] }))
    await settle()
    const expected = state()

    const wrapper = document.createElement("div")
    wrapper.innerHTML = fromBuilder()
    const written = new Map<Element, Map<string, string | null>>()
    for (const e of wrapper.querySelectorAll("*"))
      written.set(e, new Map([...e.attributes].map((a) => [a.name, a.value])))
    const changed: string[] = []
    const observer = new MutationObserver((records) => {
      for (const p of records) {
        const from = written.get(p.target as Element)
        if (p.attributeName && from?.has(p.attributeName))
          changed.push(`${(p.target as Element).localName} ${p.attributeName}`)
      }
    })
    observer.observe(wrapper, { attributes: true, subtree: true })
    document.body.replaceChildren(wrapper)
    await settle()
    observer.disconnect()

    expect(
      changed,
      "registration changed something the builder function wrote",
    ).toEqual([])
    expect(state()).toEqual(expected)
  })

  /** A React app that renders the tabs with `lt.tabs()` from the React entry point. */
  const App = ({ counter }: { counter: number }) => {
    const f = ltReact.tabs({
      id: "file",
      keys: KEYS,
      label: "Parts of the claim",
    })
    return h(
      "div",
      { "data-counter": counter },
      h(
        "lt-tabs",
        null,
        h(
          "ul",
          f.list,
          ...f.tabs.map((t, i) =>
            h("li", { ...f.item, key: KEYS[i] }, h("a", t, NAMES[i])),
          ),
        ),
        ...f.panels.map((p, i) =>
          h(
            "section",
            { ...p, key: KEYS[i] },
            h("h2", null, NAMES[i]),
            h("p", null, "Content"),
          ),
        ),
      ),
    )
  }

  it("A7: React hydrates markup from lt.tabs() in the React entry point without mismatches, also when the user has switched tabs and React renders again", async () => {
    const mismatches: string[] = []
    const errorSpy = vi.spyOn(console, "error").mockImplementation((...a) => {
      mismatches.push(a.map(String).join(" "))
    })

    const surface = mount("")
    surface.innerHTML = renderToString(h(App, { counter: 0 }))
    await settle()
    const root = hydrateRoot(surface, h(App, { counter: 0 }), {
      onRecoverableError: (e) => mismatches.push(String(e)),
    })
    await waitForPaint()

    links()[1].click()
    await settle()
    root.render(h(App, { counter: 1 }))
    await settle()

    errorSpy.mockRestore()
    expect(mismatches).toEqual([])
    expect(selectedTabs()).toEqual([false, true, false])
    expect(hiddenPanels()).toEqual([true, false, true])
    root.unmount()
  })

  it("A7 with D11: React hydrates without mismatches also when the address points to another tab", async () => {
    await setAddress("#file-attachments")
    const mismatches: string[] = []
    const errorSpy = vi.spyOn(console, "error").mockImplementation((...a) => {
      mismatches.push(a.map(String).join(" "))
    })

    const surface = mount("")
    surface.innerHTML = renderToString(h(App, { counter: 0 }))
    await settle()
    const root = hydrateRoot(surface, h(App, { counter: 0 }), {
      onRecoverableError: (e) => mismatches.push(String(e)),
    })
    await waitForPaint()

    errorSpy.mockRestore()
    expect(mismatches).toEqual([])
    expect(selectedTabs()).toEqual([true, false, false])
    expect(location.hash).toBe("#file-claim")
    root.unmount()
  })

  it("A9: the component writes nothing on markup from lt.tabs() in the React entry point", async () => {
    const wrapper = document.createElement("div")
    wrapper.innerHTML = renderToString(h(App, { counter: 0 }))
    const records: string[] = []
    const observer = new MutationObserver((r) =>
      records.push(
        ...r.map(
          (p) =>
            `${(p.target as Element).localName} ${p.attributeName ?? p.type}`,
        ),
      ),
    )
    observer.observe(wrapper, {
      attributes: true,
      childList: true,
      subtree: true,
    })

    document.body.replaceChildren(wrapper)
    await settle()
    observer.disconnect()

    expect(records).toEqual([])
  })
})

describe("B. Semantics and names", () => {
  it("B5: an icon-only tab gives the panel its name from aria-label, without hidden text", async () => {
    mount(
      bar({ heading: () => null })
        .replace(
          '<a href="#attachments">Attachments</a>',
          '<a href="#attachments" aria-label="Attachments"><svg aria-hidden="true" width="16" height="16"></svg></a>',
        )
        .replace(
          '<a href="#messages">Messages</a>',
          '<a href="#messages">Messages<span aria-hidden="true"> (3)</span></a>',
        ),
    )
    await settle()

    expect(panels().map(wiredName)).toEqual(NAMES)
  })

  it("B6: the panel has the same name as the tab, also when the heading says something else", async () => {
    mount(
      bar({
        heading: (i) => (i === 1 ? "Documents you have uploaded" : NAMES[i]),
      }),
    )
    await settle()

    expect(panels().map(wiredName)).toEqual(links().map(wiredName))
  })

  it("B7: an aria-labelledby the server wrote is not changed, also when it points to something that arrives later", async () => {
    mount(
      bar({
        panel: (i) => (i === 1 ? ' aria-labelledby="arrives-later"' : ""),
      }),
    )
    await settle()
    const panel = panels()[1]

    expect(panel.getAttribute("aria-labelledby")).toBe("arrives-later")

    panel.insertAdjacentHTML(
      "beforebegin",
      '<p id="arrives-later">Attachments</p>',
    )
    await settle()

    expect(panel.getAttribute("aria-labelledby")).toBe("arrives-later")
    expect(wiredName(panel)).toBe("Attachments")
  })

  it("B8: the name follows when the tab's text changes in the text node, as idiomorph does it", async () => {
    mount(bar({ heading: () => null }))
    await settle()

    ;(links()[1].firstChild as Text).nodeValue = "Attachments (2)"
    await settle()

    expect(wiredName(panels()[1])).toBe("Attachments (2)")
  })

  /*
   * B5 and B6 with the name computed from hidden text, aria-hidden, an
   * image's alt, aria-label and aria-labelledby on children, and nested
   * aria-labelledby: the variants are accessibility contracts, in
   * scripts/accessibility/contracts.ts, and the names are read from the
   * browser's own tree through AT-SPI. Here they were computed with axe's
   * copy of AccName.
   */

  it("B6: the heading is the name only when its name is the same as the tab's", async () => {
    mount(
      bar().replace(
        "<h2>Attachments</h2>",
        '<h2 aria-label="Something entirely different">Attachments</h2>',
      ),
    )
    await settle()

    expect(panels().map(wiredName)).toEqual(NAMES)
  })

  it("B5: a tab with aria-labelledby pointing to a hidden element is named what that element says", async () => {
    mount(
      `<span id="hidden-name" hidden>Enclosures</span>${bar({
        heading: () => null,
      }).replace(
        '<a href="#attachments">',
        '<a href="#attachments" aria-labelledby="hidden-name">',
      )}`,
    )
    await settle()

    expect(wiredName(panels()[1])).toBe("Enclosures")
  })

  it("B5: text hidden with CSS and a tab with only a title", async () => {
    mount(
      bar({ heading: () => null })
        .replace(
          '<a href="#attachments">Attachments</a>',
          '<a href="#attachments">Attachments<span style="display: none"> (2)</span></a>',
        )
        .replace(
          '<a href="#messages">Messages</a>',
          '<a href="#messages" title="Messages"><svg aria-hidden="true" width="16" height="16"></svg></a>',
        ),
    )
    await settle()

    expect(panels().map(wiredName)).toEqual(NAMES)
  })

  it("B8: the name follows when the text in the heading changes", async () => {
    mount(bar())
    await settle()
    expect(wiredName(panels()[1])).toBe("Attachments")

    // As idiomorph does it: only the text node changes.
    const text = panels()[1].querySelector("h2")?.firstChild as Text
    text.nodeValue = "Enclosures"
    await settle()

    // The heading no longer says what the tab says, so the panel has the
    // tab's name.
    expect(wiredName(panels()[1])).toBe("Attachments")
  })

  it("B8: the name follows when the text aria-labelledby points to inside a panel changes", async () => {
    mount(
      bar({ heading: () => null })
        .replace(
          '<a href="#attachments">',
          '<a href="#attachments" aria-labelledby="late-name">',
        )
        .replace(
          '<p id="inside-claim">',
          '<p id="inside-claim"><span id="late-name" hidden><b>Enclosures</b></span>',
        ),
    )
    await settle()
    expect(wiredName(panels()[1])).toBe("Enclosures")

    // The text is inside the element the id points to, not directly in it.
    const text = document.querySelector("#late-name b")?.firstChild as Text
    text.nodeValue = "Documents"
    await settle()

    expect(wiredName(panels()[1])).toBe("Documents")
  })

  it("B8: the same when aria-labelledby is on a child of the tab", async () => {
    mount(
      bar({ heading: () => null })
        .replace(
          '<a href="#attachments">Attachments</a>',
          '<a href="#attachments"><svg role="img" aria-labelledby="late-name" width="16" height="16"></svg></a>',
        )
        .replace(
          '<p id="inside-claim">',
          '<p id="inside-claim"><span id="late-name" hidden>Enclosures</span>',
        ),
    )
    await settle()
    expect(wiredName(panels()[1])).toBe("Enclosures")

    const text = document.getElementById("late-name")?.firstChild as Text
    text.nodeValue = "Documents"
    await settle()

    expect(wiredName(panels()[1])).toBe("Documents")
  })

  it("B7: the fallback is removed when the element the server's aria-labelledby points to arrives inside a panel", async () => {
    mount(
      bar({
        heading: () => null,
        panel: (i) => (i === 1 ? ' aria-labelledby="late-name"' : ""),
      }),
    )
    await settle()
    expect(panels()[1].getAttribute("aria-label")).toBe("Attachments")

    const deep = document.getElementById("inside-claim") as HTMLElement
    deep.insertAdjacentHTML(
      "beforeend",
      '<span id="late-name">Attachments</span>',
    )
    await settle()

    expect(panels()[1].hasAttribute("aria-label")).toBe(false)
    expect(panels()[1].getAttribute("aria-labelledby")).toBe("late-name")
  })

  it("B8: the name follows when the element aria-labelledby points to arrives inside a panel", async () => {
    mount(
      bar({ heading: () => null }).replace(
        '<a href="#attachments">',
        '<a href="#attachments" aria-labelledby="late-name">',
      ),
    )
    await settle()
    expect(wiredName(panels()[1])).toBe("Attachments")

    const deep = document.getElementById("inside-claim") as HTMLElement
    deep.insertAdjacentHTML(
      "beforeend",
      '<span hidden><span id="late-name">Enclosures</span></span>',
    )
    await settle()

    expect(wiredName(panels()[1])).toBe("Enclosures")
  })

  it("B8: the name follows when an element inside a panel gets the id aria-labelledby points to", async () => {
    mount(
      bar({ heading: () => null })
        .replace(
          '<a href="#attachments">',
          '<a href="#attachments" aria-labelledby="late-name">',
        )
        .replace(
          '<p id="inside-claim">',
          '<p id="inside-claim"><span id="not-yet" hidden>Enclosures</span>',
        ),
    )
    await settle()
    expect(wiredName(panels()[1])).toBe("Attachments")

    document.getElementById("not-yet")?.setAttribute("id", "late-name")
    await settle()

    expect(wiredName(panels()[1])).toBe("Enclosures")
  })

  it("D7: the heading becomes the name when its text changes to the tab's", async () => {
    mount(bar({ heading: (i) => (i === 1 ? "Enclosures" : NAMES[i]) }))
    await settle()
    expect(panels()[1].getAttribute("aria-label")).toBe("Attachments")

    const heading = panels()[1].querySelector("h2") as HTMLElement
    ;(heading.firstChild as Text).nodeValue = "Attachments"
    await settle()

    expect(panels()[1].hasAttribute("aria-label")).toBe(false)
    expect(panels()[1].getAttribute("aria-labelledby")).toBe(heading.id)
  })

  it("B8: the name follows when the element aria-labelledby points to loses its id inside a panel", async () => {
    mount(
      bar({ heading: () => null })
        .replace(
          '<a href="#attachments">',
          '<a href="#attachments" aria-labelledby="late-name">',
        )
        .replace(
          '<p id="inside-claim">',
          '<p id="inside-claim"><span id="late-name" hidden>Enclosures</span>',
        ),
    )
    await settle()
    expect(wiredName(panels()[1])).toBe("Enclosures")

    document.getElementById("late-name")?.setAttribute("id", "something-else")
    await settle()

    expect(wiredName(panels()[1])).toBe("Attachments")
  })

  it("B8: the name follows when alt on an image in the tab changes", async () => {
    mount(
      bar({ heading: () => null }).replace(
        '<a href="#attachments">Attachments</a>',
        '<a href="#attachments"><img alt="Attachments" width="1" height="1"></a>',
      ),
    )
    await settle()

    ;(links()[1].querySelector("img") as HTMLElement).setAttribute(
      "alt",
      "Enclosures",
    )
    await settle()

    expect(wiredName(panels()[1])).toBe("Enclosures")
  })

  it("B9: the component warns when the tab list has no name", async () => {
    const spy = spyOnWarnings()
    mount(bar({ list: "" }))
    await settle()

    expect((await warnings(spy)).some((m) => m.includes("aria-label"))).toBe(
      true,
    )
  })

  it("B9: the component does not warn when the tab list has a name", async () => {
    const spy = spyOnWarnings()
    mount(bar())
    await settle()

    expect(
      (await warnings(spy)).filter((m) => m.startsWith("lt-tabs")),
    ).toEqual([])
  })

  it("B9 and D8: lt.tabs() throws when label is missing or empty", () => {
    // A non-breaking space and a BOM are whitespace to JavaScript, and to
    // Kotlin only when it checks the same way.
    for (const label of [undefined, "", "   ", "\u00a0\ufeff"]) {
      for (const build of [tabs, ltReact.tabs]) {
        expect(() =>
          build({ id: "unnamed", keys: ["a"], label } as never),
        ).toThrow(/label/)
      }
    }
  })

  it("I1: label is checked before keys, as in Kotlin", () => {
    expect(() => tabs({ id: "x", keys: [""], label: "" })).toThrow(/label/)
  })
})

describe("C. Keyboard and focus", () => {
  const around = (content: string) =>
    `<button type="button" id="before">Before</button>${content}<button type="button" id="after">After</button>`

  it("C1: Tab into the tab list lands on the selected tab, and Tab again moves to the selected panel", async () => {
    mount(around(bar()))
    await settle()
    links()[1].click()
    await settle()
    ;(document.getElementById("before") as HTMLElement).focus()

    await tab()
    expect(document.activeElement).toBe(links()[1])
    await tab()
    expect(document.activeElement).toBe(panels()[1])
  })

  it("C2: nothing in a panel that is not selected can be reached with Tab, the panel itself included", async () => {
    mount(
      around(
        bar({
          inside: (i) =>
            `<button type="button" id="button-${KEYS[i]}">Do something</button>`,
        }),
      ),
    )
    await settle()
    ;(document.getElementById("before") as HTMLElement).focus()

    const visited: Element[] = []
    for (let i = 0; i < 10 && document.activeElement?.id !== "after"; i++) {
      await tab()
      if (document.activeElement) visited.push(document.activeElement)
    }

    const inHidden = visited.filter((e) =>
      panels().some(
        (p) => p.hasAttribute("hidden") && (p === e || p.contains(e)),
      ),
    )
    expect(inHidden.map((e) => e.id || e.localName)).toEqual([])
    expect(visited[visited.length - 1]?.id).toBe("after")
  })

  it("C3: left arrow wraps from the first to the last", async () => {
    mount(bar())
    await settle()
    links()[0].focus()

    await userEvent.keyboard("{ArrowLeft}")
    await settle()

    expect(document.activeElement).toBe(links()[2])
    expect(selectedTabs()).toEqual([false, false, true])
  })

  it("C7: Enter selects with manual activation", async () => {
    mount(bar({ host: ' activation="manual"' }))
    await settle()
    links()[0].focus()

    await userEvent.keyboard("{ArrowRight}")
    expect(selectedTabs()).toEqual([true, false, false])
    await userEvent.keyboard("{Enter}")
    await settle()

    expect(selectedTabs()).toEqual([false, true, false])
  })

  it("C8: a tab with hidden is skipped by the arrow keys and never gets the tab stop", async () => {
    mount(
      around(
        bar().replace(
          '<a href="#attachments">',
          '<a href="#attachments" hidden>',
        ),
      ),
    )
    await settle()
    links()[0].focus()

    await userEvent.keyboard("{ArrowRight}")
    await settle()

    expect(selectedTabs()).toEqual([false, false, true])
    expect(links().map((f) => f.getAttribute("tabindex"))).toEqual([
      "-1",
      "-1",
      "0",
    ])
    expect(document.activeElement).toBe(links()[2])
  })

  it("C10: focus is visible on the tab and on the panel", async () => {
    mount(around(bar()))
    await settle()
    ;(document.getElementById("before") as HTMLElement).focus()

    for (const element of [links()[0], panels()[0]]) {
      await tab()
      expect(document.activeElement).toBe(element)
      const style = getComputedStyle(element)
      expect(style.outlineStyle, element.localName).not.toBe("none")
      expect(
        Number.parseFloat(style.outlineWidth),
        element.localName,
      ).toBeGreaterThanOrEqual(2)
    }
  })
})

describe("D. Mouse and links", () => {
  it("D2: a real middle click does not select the tab", async () => {
    mount(bar())
    await settle()
    const link = links()[1]
    let clicks = 0
    link.addEventListener("click", () => clicks++)
    // A middle click opens the link in a new browser tab. In the test the new
    // tab would load Vitest's test page, which sends messages the run does
    // not recognise, and WebKit navigates in the same page instead. The
    // browser's default action is stopped, so the test asks only about the
    // component. The listener is on `window` and runs last, so it sees
    // whether anything before it has stopped the link.
    let stopped: boolean | undefined
    const stop = (e: Event) => {
      stopped = e.defaultPrevented
      e.preventDefault()
    }
    window.addEventListener("auxclick", stop)
    try {
      await userEvent.click(link, { button: "middle" } as never)
      await settle()
    } finally {
      window.removeEventListener("auxclick", stop)
    }

    expect(stopped).toBe(false)
    expect(clicks).toBe(0)
    expect(selectedTabs()).toEqual([true, false, false])
    expect(location.hash).toBe("")
  })

  it('D3: a role="tab" without href is not a tab, and the component warns', async () => {
    const spy = spyOnWarnings()
    mount(
      bar().replace(
        "</ul>",
        '<li><button type="button" role="tab" aria-controls="claim" id="without-href">Other</button></li></ul>',
      ),
    )
    await settle()
    const button = document.getElementById("without-href") as HTMLElement

    expect(button.hasAttribute("aria-selected")).toBe(false)
    expect(button.hasAttribute("tabindex")).toBe(false)
    expect((await warnings(spy)).some((m) => m.includes("href"))).toBe(true)
  })
})

describe("E. The address and find in page", () => {
  it("E1: an address to something inside a panel selects that tab on load", async () => {
    await setAddress("#inside-messages")
    mount(bar())
    await settle()

    expect(selectedTabs()).toEqual([false, false, true])
    expect(location.hash).toBe("#inside-messages")
  })

  /** The tab list with one more tab, which points to a panel that does not exist. */
  const withTabWithoutPanel = (markup: string) =>
    markup.replace(
      '<li><a href="#attachments">',
      '<li><a href="#missing">Missing</a></li><li><a href="#attachments">',
    )

  it("E1: a tab without a panel does not stop the address from selecting", async () => {
    spyOnWarnings()
    await setAddress("#attachments")
    mount(withTabWithoutPanel(bar()))
    await settle()

    expect(selectedTabs()).toEqual([false, false, true, false])
  })

  for (const [fragment, id] of [
    ["late-content", "late-content"],
    ["r%C3%A9sum%C3%A9-late", "résumé-late"],
  ]) {
    it(`E1: content the address points to, arriving after the panel, selects the tab (#${fragment})`, async () => {
      await setAddress(`#${fragment}`)
      mount(
        bar({ inside: (i) => (i === 2 ? '<div id="container"></div>' : "") }),
      )
      await settle()
      expect(selectedTabs()).toEqual([true, false, false])

      // Deep in the panel, where what happens otherwise does not trigger a new round (F11).
      ;(document.getElementById("container") as HTMLElement).insertAdjacentHTML(
        "beforeend",
        `<p id="${id}">Arrived later</p>`,
      )
      await settle()

      expect(selectedTabs()).toEqual([false, false, true])
      expect(location.hash).toBe(`#${fragment}`)
    })
  }

  for (const [what, make] of [
    ["a complete tab list", (m: string) => m],
    ["a tab list with a tab without a panel", withTabWithoutPanel],
  ] as const) {
    it(`E6: the address is corrected after a patch, also in ${what}`, async () => {
      spyOnWarnings()
      mount(make(bar()))
      await settle()

      // The app moves the address without selecting, and the server touches a panel.
      history.replaceState(null, "", "#attachments")
      panels()[0].setAttribute("data-patch", "1")
      panels()[0].setAttribute("hidden", "")
      panels()[0].removeAttribute("hidden")
      await settle()

      expect(selectedTabs()[0]).toBe(true)
      expect(location.hash).toBe("#claim")
    })
  }

  it("G2: an address to something that does not exist stays, and a click is reported once", async () => {
    await setAddress("#/claim/1")
    mount(bar())
    await settle()
    expect(selectedTabs()).toEqual([true, false, false])
    expect(location.hash).toBe("#/claim/1")
    const reported: number[] = []
    host().addEventListener("tab-select", (e) => reported.push(e.detail.index))

    links()[1].click()
    await settle()
    await settle()

    expect(selectedTabs()).toEqual([false, true, false])
    expect(location.hash).toBe("#attachments")
    expect(reported).toEqual([1])
  })

  it("E1: the tab list first and the panels afterwards: the address still selects", async () => {
    await setAddress("#messages")
    const markup = bar()
    const end = markup.indexOf("</ul>") + "</ul>".length
    mount(`${markup.slice(0, end)}</lt-tabs>`)
    await settle()

    host().insertAdjacentHTML(
      "beforeend",
      markup.slice(end, markup.lastIndexOf("</lt-tabs>")),
    )
    await settle()
    await settle()

    expect(selectedTabs()).toEqual([false, false, true])
    expect(location.hash).toBe("#messages")
  })

  it("E1: when the tab list is disconnected and reconnected, the address is read again", async () => {
    mount(bar())
    await settle()
    links()[1].click()
    await settle()
    const v = host()
    const parent = v.parentElement as HTMLElement

    v.remove()
    history.replaceState(null, "", "#messages")
    parent.append(v)
    await settle()
    await settle()

    expect(selectedTabs()).toEqual([false, false, true])
  })

  it("E3: a link to something inside a hidden panel selects the tab through beforematch", async () => {
    const release = likeFindInPage()
    let seen = 0
    try {
      mount(bar())
      await settle()
      panels()[1].addEventListener("beforematch", () => seen++)

      // `hashchange` is stopped, so it is `beforematch` that must select.
      location.hash = "#inside-attachments"
      await settle()
      await settle()
    } finally {
      release()
    }

    expect(seen).toBe(1)
    expect(selectedTabs()).toEqual([false, true, false])
    expect(hiddenPanels()).toEqual([true, false, true])
  })

  it("E4: the same when the panel is outside <lt-tabs>", async () => {
    const markup = bar()
    const [front, back] = markup.split(
      '<section class="lt-tabs__panel" id="attachments"',
    )
    const end = back.indexOf("</section>") + "</section>".length
    const attachments = `<section class="lt-tabs__panel" id="attachments"${back.slice(0, end)}`
    const release = likeFindInPage()
    try {
      mount(`${front}${back.slice(end)}${attachments}`)
      await settle()
      location.hash = "#inside-attachments"
      await settle()
      await settle()
    } finally {
      release()
    }

    expect(selectedTabs()).toEqual([false, true, false])
    expect(
      panels()
        .filter((p) => !p.hasAttribute("hidden"))
        .map((p) => p.id),
    ).toEqual(["attachments"])
  })

  /** Tabs in tabs: the match `#deep` is in the inner panel `ib`, inside the outer `yb`. */
  const TABS_IN_TABS = (inner = "") => `
    <a href="#deep" id="to-deep">To the match</a>
    <lt-tabs id="outer">
      <ul class="lt-tabs__list" aria-label="Outer"><li><a href="#ya">YA</a></li><li><a href="#yb">YB</a></li></ul>
      <section class="lt-tabs__panel" id="ya"><h2>YA</h2>Outer a</section>
      <section class="lt-tabs__panel" id="yb"><h2>YB</h2>
        <lt-tabs id="inner"${inner}>
          <ul class="lt-tabs__list" aria-label="Inner"><li><a href="#ia">IA</a></li><li><a href="#ib">IB</a></li></ul>
          <section class="lt-tabs__panel" id="ia"><h3>IA</h3>Inner a</section>
          <section class="lt-tabs__panel" id="ib"><h3>IB</h3><p id="deep">Deep inside</p></section>
        </lt-tabs>
      </section>
    </lt-tabs>`

  const hiddenIn = (...ids: string[]) =>
    ids.map((id) =>
      (document.getElementById(id) as HTMLElement).hasAttribute("hidden"),
    )

  /*
   * A real click, not `location.hash` from the script: when the navigation
   * comes from the user, the browser runs the microtasks after each
   * listener, in the middle of revealing, as it does with find in page. From
   * a script it does not, and the test could not fail. `hashchange` is
   * stopped, as with find in page, or the address selected the outer tab
   * afterwards.
   */
  it("E3: find in page reveals a match in a tab list inside a hidden panel", async () => {
    const release = likeFindInPage()
    try {
      mount(TABS_IN_TABS())
      await settle()
      await userEvent.click(document.getElementById("to-deep") as HTMLElement)
      await settle()
      await settle()
    } finally {
      release()
    }

    expect(
      (document.getElementById("deep") as HTMLElement).checkVisibility(),
    ).toBe(true)
    expect(hiddenIn("ya", "yb", "ia", "ib")).toEqual([true, false, true, false])
  })

  it("E3: the same when the inner tab list is server-controlled, and the selection is reported once", async () => {
    const release = likeFindInPage()
    const reported: number[] = []
    try {
      mount(TABS_IN_TABS(" server-controlled"))
      await settle()
      ;(document.getElementById("inner") as HTMLElement).addEventListener(
        "tab-select",
        (e) => {
          e.stopPropagation()
          reported.push((e as CustomEvent<{ index: number }>).detail.index)
        },
      )
      await userEvent.click(document.getElementById("to-deep") as HTMLElement)
      await settle()
      await settle()
    } finally {
      release()
    }

    expect(
      (document.getElementById("deep") as HTMLElement).checkVisibility(),
    ).toBe(true)
    expect(hiddenIn("ya", "yb", "ia", "ib")).toEqual([true, false, true, false])
    expect(reported).toEqual([1])
  })

  it("E3: find in page opens a closed <details> around the tab list", async (ctx) => {
    const release = likeFindInPage()
    try {
      // First without tabs: if the engine does not open a <details> itself,
      // the test has nothing to say about the component.
      mount(
        '<a href="#control-match" id="to-control">To</a><details id="control"><summary>K</summary><p id="control-match">Match</p></details>',
      )
      await userEvent.click(
        document.getElementById("to-control") as HTMLElement,
      )
      await settle()
      const engineOpens = (
        document.getElementById("control") as HTMLDetailsElement
      ).open
      if (!engineOpens) ctx.skip()

      mount(
        `<a href="#inside-attachments" id="to-match">To the match</a><details id="around"><summary>More</summary>${bar()}</details>`,
      )
      await settle()
      await userEvent.click(document.getElementById("to-match") as HTMLElement)
      await settle()
      await settle()
    } finally {
      release()
    }

    expect((document.getElementById("around") as HTMLDetailsElement).open).toBe(
      true,
    )
    expect(
      (
        document.getElementById("inside-attachments") as HTMLElement
      ).checkVisibility(),
    ).toBe(true)
    expect(selectedTabs()).toEqual([false, true, false])
  })

  it("E3: a panel removed during revealing and inserted again is shown", async () => {
    // The browser does not reveal a panel that is not in the document after
    // `beforematch`. Without a fallback the component waited for it forever,
    // and the panel stayed hidden even though the tab was selected.
    const release = likeFindInPage()
    try {
      mount(
        `<a href="#inside-attachments" id="to-match">To the match</a>${bar()}`,
      )
      await settle()
      const panel = panels()[1]
      const parent = panel.parentElement as HTMLElement
      const next = panel.nextSibling
      panel.addEventListener(
        "beforematch",
        () => {
          panel.remove()
          setTimeout(() => parent.insertBefore(panel, next), 0)
        },
        { once: true },
      )
      await userEvent.click(document.getElementById("to-match") as HTMLElement)
      await new Promise((r) => setTimeout(r, 10))
      await settle()
    } finally {
      release()
    }

    expect(selectedTabs()).toEqual([false, true, false])
    expect(hiddenPanels()).toEqual([true, false, true])
  })

  it("E3: when something else sets hidden during revealing, the panel is still shown", async () => {
    // The browser stops when the panel no longer has `until-found` after
    // `beforematch`. The change triggered a round while the component was
    // waiting, and no round came afterwards, unless the component wrote the
    // tab list itself.
    const release = likeFindInPage()
    try {
      mount(
        `<a href="#inside-attachments" id="to-match">To the match</a>${bar()}`,
      )
      await settle()
      const panel = panels()[1]
      panel.addEventListener(
        "beforematch",
        () => panel.setAttribute("hidden", ""),
        { once: true },
      )
      await userEvent.click(document.getElementById("to-match") as HTMLElement)
      await new Promise((r) => setTimeout(r, 10))
      await settle()
    } finally {
      release()
    }

    expect(selectedTabs()).toEqual([false, true, false])
    expect(hiddenPanels()).toEqual([true, false, true])
  })

  it("E3: a beforematch sent by a script selects at once", async () => {
    // No browser reveals the panel after an event from a script, so the
    // component does not wait for it.
    mount(bar())
    await settle()

    panels()[2].dispatchEvent(new Event("beforematch", { bubbles: true }))
    await Promise.resolve()
    await Promise.resolve()

    expect(hiddenPanels()).toEqual([true, true, false])
  })

  it("E1: an empty <lt-tabs> filled afterwards selects the tab the address points to", async () => {
    await setAddress("#messages")
    mount("<lt-tabs></lt-tabs>")
    await settle()

    host().innerHTML = bar().slice(
      bar().indexOf(">") + 1,
      bar().lastIndexOf("<"),
    )
    await settle()

    expect(selectedTabs()).toEqual([false, false, true])
  })

  it("E6: the address is corrected when the server moves the selection with a patch", async () => {
    mount(bar())
    await settle()
    links()[1].click()
    await settle()
    expect(location.hash).toBe("#attachments")

    const content = bar().slice(bar().indexOf(">") + 1, bar().lastIndexOf("<"))
    host().innerHTML = content.replace(
      '<a href="#claim">',
      '<a href="#claim" aria-selected="true">',
    )
    await settle()

    expect(selectedTabs()).toEqual([true, false, false])
    expect(location.hash).toBe("#claim")
  })

  it("E6: the address is corrected when the server moves the selection under server-controlled", async () => {
    mount(bar({ host: " server-controlled" }))
    await settle()
    links()[1].click()
    await settle()
    expect(location.hash).toBe("#attachments")

    // The server answers with the first one, and touches only the panels.
    panels()[1].setAttribute("hidden", "")
    panels()[0].removeAttribute("hidden")
    await settle()

    expect(selectedTabs()).toEqual([true, false, false])
    expect(location.hash).toBe("#claim")
  })

  it("E3: find in page selects the tab under server-controlled too, like a click", async () => {
    mount(bar({ host: " server-controlled" }))
    await settle()
    const reported: number[] = []
    host().addEventListener("tab-select", (e) => reported.push(e.detail.index))

    panels()[2].dispatchEvent(new Event("beforematch", { bubbles: true }))
    // The browser itself removes `hidden` after the event.
    panels()[2].removeAttribute("hidden")
    await settle()
    await settle()

    expect(selectedTabs()).toEqual([false, false, true])
    expect(hiddenPanels()).toEqual([true, true, false])
    expect(reported).toEqual([2])
  })

  it("E3: find in page selects the tab when the tab list is in a shadow root", async () => {
    const surface = mount('<div id="root-host"></div>')
    const root = (
      surface.querySelector("#root-host") as HTMLElement
    ).attachShadow({ mode: "open" })
    root.innerHTML = bar()
    await settle()
    const p = [...root.querySelectorAll<HTMLElement>(".lt-tabs__panel")]

    // As the browser sends it: bubbles, but is not `composed`.
    p[2].dispatchEvent(new Event("beforematch", { bubbles: true }))
    await settle()

    expect(
      [...root.querySelectorAll(".lt-tabs__list a")].map(
        (a) => a.getAttribute("aria-selected") === "true",
      ),
    ).toEqual([false, false, true])
  })

  it("E8: the address is written also with a <base> to another origin", async () => {
    const base = document.createElement("base")
    base.href = "https://example.invalid/other/"
    document.head.prepend(base)
    try {
      mount(bar())
      await settle()
      const path = location.pathname

      links()[1].click()
      await settle()

      expect(location.pathname).toBe(path)
      expect(location.hash).toBe("#attachments")
    } finally {
      base.remove()
    }
  })

  it("D11: the server's aria-selected wins over the address when the page loads", async () => {
    await setAddress("#attachments")
    mount(
      bar().replace(
        '<a href="#messages">',
        '<a href="#messages" aria-selected="true">',
      ),
    )
    await settle()

    expect(selectedTabs()).toEqual([false, false, true])
    // The address is corrected to the tab that is actually selected (E6).
    expect(location.hash).toBe("#messages")
  })

  it("D11: an address to something outside the tab list stays when the server has selected", async () => {
    await setAddress("#other")
    mount(
      `<p id="other">Other</p>${bar().replace('<a href="#messages">', '<a href="#messages" aria-selected="true">')}`,
    )
    await settle()

    expect(selectedTabs()).toEqual([false, false, true])
    expect(location.hash).toBe("#other")
  })

  it("E8: a click does not change the path in the address, not even with <base>", async () => {
    const base = document.createElement("base")
    base.href = "/another-page/"
    document.head.prepend(base)
    try {
      mount(bar())
      await settle()
      const path = location.pathname

      links()[1].click()
      await settle()

      expect(location.pathname).toBe(path)
      expect(location.hash).toBe("#attachments")
    } finally {
      base.remove()
    }
  })

  it("E5: a link to something inside a hidden panel opens the tab and scrolls there", async () => {
    mount(
      `${bar()}<div style="block-size: 200vh"></div><a href="#inside-messages" id="jump">To the messages</a>`,
    )
    await settle()
    window.scrollTo(0, document.body.scrollHeight)

    ;(document.getElementById("jump") as HTMLElement).click()
    await settle()
    await settle()
    const target = (
      document.getElementById("inside-messages") as HTMLElement
    ).getBoundingClientRect()

    expect(selectedTabs()).toEqual([false, false, true])
    // The scroll can land on a fraction of a pixel.
    expect(target.top).toBeGreaterThan(-1)
    expect(target.bottom).toBeLessThanOrEqual(window.innerHeight)
  })

  describe("E6: the address points to the selected panel after every selection", () => {
    const ways: [string, () => Promise<void>, number][] = [
      ["click", async () => links()[2].click(), 2],
      [
        "right arrow",
        async () => {
          links()[0].focus()
          await userEvent.keyboard("{ArrowRight}")
        },
        1,
      ],
      [
        "End",
        async () => {
          links()[0].focus()
          await userEvent.keyboard("{End}")
        },
        2,
      ],
      ["select()", async () => host().select(1), 1],
      [
        "selected",
        async () => {
          host().selected = 2
        },
        2,
      ],
      [
        "find in page (beforematch)",
        async () => {
          panels()[1].dispatchEvent(new Event("beforematch", { bubbles: true }))
        },
        1,
      ],
      [
        "the fallback when the selected tab disappears",
        async () => {
          links()[1].click()
          await settle()
          links()[1].closest("li")?.remove()
          panels()[1].remove()
        },
        0,
      ],
    ]

    for (const [way, act, index] of ways) {
      it(way, async () => {
        mount(bar())
        await settle()
        await act()
        await settle()

        expect(selectedTabs().indexOf(true)).toBe(index)
        expect(location.hash).toBe(`#${panels()[index].id}`)
      })
    }

    it("Space and Enter with manual activation", async () => {
      mount(bar({ host: ' activation="manual"' }))
      await settle()
      links()[0].focus()
      await userEvent.keyboard("{ArrowRight}")
      await userEvent.keyboard(" ")
      await settle()
      expect(location.hash).toBe("#attachments")

      await userEvent.keyboard("{ArrowRight}")
      await userEvent.keyboard("{Enter}")
      await settle()
      expect(location.hash).toBe("#messages")
    })

    it("an address to something inside the selected panel stays", async () => {
      mount(bar())
      await settle()

      location.hash = "#inside-attachments"
      await settle()
      await settle()

      expect(selectedTabs()).toEqual([false, true, false])
      expect(location.hash).toBe("#inside-attachments")
    })
  })

  it("E7 with E6: after innerHTML the tab the user last selected with the arrow key is selected", async () => {
    const content = bar()
    mount(content)
    await settle()
    links()[1].click()
    await settle()
    links()[1].focus()
    await userEvent.keyboard("{ArrowRight}")
    await settle()

    host().innerHTML = content.slice(
      content.indexOf(">") + 1,
      content.lastIndexOf("<"),
    )
    await settle()

    expect(selectedTabs()).toEqual([false, false, true])
  })
})

describe("F. Updates from the server", () => {
  it("F11: what happens deep in a panel does not trigger a new round", async () => {
    mount(
      bar({
        inside: (i) =>
          i === 1
            ? '<div role="listbox" id="suggestions"><div role="option" aria-selected="false">A</div></div><p id="counter">0</p>'
            : "",
      }),
    )
    await settle()
    const rounds = vi.spyOn(
      LtTabs.prototype as unknown as { sync: () => void },
      "sync",
    )

    // As a suggestion field and a counter in the panel do it on every keystroke.
    const option = document.querySelector('[role="option"]') as HTMLElement
    option.setAttribute("aria-selected", "true")
    ;(document.getElementById("suggestions") as HTMLElement).hidden = true
    option.insertAdjacentHTML("afterend", '<div role="option">B</div>')
    ;(
      (document.getElementById("counter") as HTMLElement).firstChild as Text
    ).nodeValue = "1"
    await settle()

    expect(rounds).not.toHaveBeenCalled()
  })

  it("F11: the same when the address points to something that does not exist, as in an app with routing", async () => {
    await setAddress("#/claim/1")
    // In a container: what is put directly in the panel could be a heading.
    mount(
      bar({
        inside: (i) => (i === 1 ? '<div><p id="counter">0</p></div>' : ""),
      }),
    )
    await settle()
    const rounds = vi.spyOn(
      LtTabs.prototype as unknown as { sync: () => void },
      "sync",
    )

    ;(
      (document.getElementById("counter") as HTMLElement).firstChild as Text
    ).nodeValue = "1"
    document
      .getElementById("counter")
      ?.insertAdjacentHTML("afterend", "<p>More</p>")
    await settle()

    expect(rounds).not.toHaveBeenCalled()
  })

  it("F11: a patch on the panel itself triggers a new round", async () => {
    mount(bar())
    await settle()
    const rounds = vi.spyOn(
      LtTabs.prototype as unknown as { sync: () => void },
      "sync",
    )

    panels()[1].removeAttribute("hidden")
    await settle()

    expect(rounds).toHaveBeenCalled()
    expect(hiddenPanels()).toEqual([false, true, true])
  })

  it("F1: an inner tab list before the outer tab list does not take the roles from the outer one", async () => {
    // The panels come before the tab list, and the first panel has a tab list of its own.
    mount(`
      <lt-tabs id="outer">
        <section class="lt-tabs__panel" id="ya"><h2>YA</h2>
          <lt-tabs>
            <ul class="lt-tabs__list" aria-label="Inner"><li><a href="#ia">IA</a></li></ul>
            <section class="lt-tabs__panel" id="ia"><h3>IA</h3></section>
          </lt-tabs>
        </section>
        <section class="lt-tabs__panel" id="yb"><h2>YB</h2></section>
        <ul class="lt-tabs__list" aria-label="Outer" id="outer-list"><li><a href="#ya">YA</a></li><li><a href="#yb">YB</a></li></ul>
      </lt-tabs>`)
    await settle()
    const rad = document.getElementById("outer-list") as HTMLElement

    expect(rad.getAttribute("role")).toBe("tablist")
    expect([...rad.children].map((li) => li.getAttribute("role"))).toEqual([
      "presentation",
      "presentation",
    ])
  })

  /**
   * F3: a morph with idiomorph keeps the links and panels, and the
   * selection stays.
   *
   * idiomorph recognises an element by its id, as Datastar does. The server
   * sends the markup as the template writes it, without `aria-selected` and
   * without `hidden`, so the morph strips everything the component wrote.
   * The links have no id, and the panels have the server's, so the nodes are
   * kept, and the component writes the selection back on the same nodes.
   */
  for (const [source, markup] of [
    ["bare markup", bar],
    ["markup from lt.tabs()", fromBuilder],
  ] as const) {
    it(`F3: idiomorph keeps the links and panels, and the selection stays (${source})`, async () => {
      const spy = spyOnWarnings()
      const surface = mount(markup())
      await settle()
      const linksBefore = links()
      const panelsBefore = panels()
      linksBefore[1].click()
      await settle()
      expect(selectedTabs()).toEqual([false, true, false])

      Idiomorph.morph(surface, `<div id="lt-test-surface">${markup()}</div>`, {
        morphStyle: "outerHTML",
      })
      await settle()
      await settle()

      expect(links().map((f, i) => f === linksBefore[i])).toEqual([
        true,
        true,
        true,
      ])
      expect(panels().map((p, i) => p === panelsBefore[i])).toEqual([
        true,
        true,
        true,
      ])
      expect(selectedTabs()).toEqual([false, true, false])
      expect(panels().map((p) => p.getAttribute("hidden"))).toEqual([
        "until-found",
        null,
        "until-found",
      ])
      expect(links().map((f) => f.id)).toEqual(["", "", ""])
      expect(await warnings(spy)).toEqual([])
    })
  }

  it("G2 with F4: tab-select is not sent when innerHTML only replaces the links", async () => {
    mount(bar())
    await settle()
    links()[1].click()
    await settle()
    const reported: number[] = []
    host().addEventListener("tab-select", (e) => reported.push(e.detail.index))

    host().innerHTML = bar().slice(
      bar().indexOf(">") + 1,
      bar().lastIndexOf("<"),
    )
    await settle()

    expect(selectedTabs()).toEqual([false, true, false])
    expect(reported).toEqual([])
  })

  it("I2: an encoded fragment finds its panel", async () => {
    mount(`
      <lt-tabs>
        <ul class="lt-tabs__list" aria-label="Parts"><li><a href="#r%C3%A9sum%C3%A9">Résumé</a></li><li><a href="#attachments">Attachments</a></li></ul>
        <section class="lt-tabs__panel" id="résumé"><h2>Résumé</h2></section>
        <section class="lt-tabs__panel" id="attachments"><h2>Attachments</h2></section>
      </lt-tabs>`)
    await settle()

    expect(links()[0].getAttribute("aria-controls")).toBe("résumé")
    links()[1].click()
    await settle()
    links()[0].click()
    await settle()
    expect(hiddenPanels()).toEqual([false, true])
  })

  it("F7: when the server selects a tab after the selection was lost, the panels and the tab stop agree", async () => {
    mount(bar())
    await settle()
    links()[1].click()
    await settle()

    // The server replaces the tab list with full markup, and marks the third.
    host().querySelector("ul")?.remove()
    host().insertAdjacentHTML(
      "afterbegin",
      `<ul class="lt-tabs__list" aria-label="Parts of the claim" role="tablist">${NAMES.map(
        (n, i) =>
          `<li role="presentation"><a role="tab" aria-controls="${KEYS[i]}" href="#${KEYS[i]}"${i === 2 ? ' aria-selected="true"' : ""}>${n}</a></li>`,
      ).join("")}</ul>`,
    )
    await settle()
    await settle()

    expect(hiddenPanels()).toEqual([true, true, false])
    expect(links().map((f) => f.getAttribute("tabindex"))).toEqual([
      "-1",
      "-1",
      "0",
    ])
  })
})

describe("G. API and events", () => {
  it("G2: tab-select is sent when the address selects the tab on load", async () => {
    const reported: number[] = []
    const listener = (e: Event) =>
      reported.push((e as CustomEvent<{ index: number }>).detail.index)
    document.addEventListener("tab-select", listener)
    try {
      await setAddress("#attachments")
      mount(bar())
      await settle()
      expect(reported).toEqual([1])
    } finally {
      document.removeEventListener("tab-select", listener)
    }
  })

  it("G2: tab-select is sent when find in page selects the tab", async () => {
    mount(bar())
    await settle()
    const reported: number[] = []
    host().addEventListener("tab-select", (e) => reported.push(e.detail.index))

    panels()[2].dispatchEvent(new Event("beforematch", { bubbles: true }))
    await settle()

    expect(reported).toEqual([2])
  })

  it("G2: tab-select is not sent on a click on the tab that is already selected", async () => {
    mount(bar())
    await settle()
    links()[1].click()
    await settle()
    const reported: number[] = []
    host().addEventListener("tab-select", (e) => reported.push(e.detail.index))

    links()[1].click()
    await settle()

    expect(selectedTabs()).toEqual([false, true, false])
    expect(reported).toEqual([])
  })

  it("G2: tab-select is not sent when the address changes to the tab that is already selected", async () => {
    mount(bar())
    await settle()
    const reported: number[] = []
    host().addEventListener("tab-select", (e) => reported.push(e.detail.index))

    location.hash = "#claim"
    await settle()
    await settle()

    expect(selectedTabs()).toEqual([true, false, false])
    expect(reported).toEqual([])
  })

  it("G3: tab-select is not sent when the server moves the selection", async () => {
    mount(bar({ host: " server-controlled" }))
    await settle()
    const reported: number[] = []
    host().addEventListener("tab-select", (e) => reported.push(e.detail.index))

    panels()[0].setAttribute("hidden", "")
    panels()[1].removeAttribute("hidden")
    await settle()

    expect(selectedTabs()).toEqual([false, true, false])
    expect(reported).toEqual([])
  })
})

describe("H. Appearance", () => {
  it("H1: the selected tab stands out by more than colour", async () => {
    mount(bar())
    await settle()
    const [chosen, other] = links().map((f) => getComputedStyle(f))

    expect(Number(chosen.fontWeight)).toBeGreaterThan(Number(other.fontWeight))
    expect(rgb(chosen.borderBottomColor).a).toBeGreaterThan(0)
    expect(rgb(other.borderBottomColor).a).toBe(0)
  })

  for (const scheme of ["light", "dark"] as const) {
    it(`H2: the contrast of the tabs and the underline holds in the ${scheme} theme`, async () => {
      document.documentElement.dataset.theme = scheme
      try {
        mount(bar())
        await settle()
        const surface = rgb(
          getComputedStyle(
            document.getElementById("lt-test-surface") as HTMLElement,
          ).backgroundColor,
        )
        const [chosen, other] = links().map((f) => getComputedStyle(f))

        expect(
          contrastRatio(rgb(chosen.color), surface),
          "text, selected",
        ).toBeGreaterThanOrEqual(4.5)
        expect(
          contrastRatio(rgb(other.color), surface),
          "text, not selected",
        ).toBeGreaterThanOrEqual(4.5)
        expect(
          contrastRatio(rgb(chosen.borderBottomColor), surface),
          "the underline",
        ).toBeGreaterThanOrEqual(3)
      } finally {
        delete document.documentElement.dataset.theme
      }
    })
  }

  describe.skipIf(server.browser !== "chromium")(
    "H3 in forced colours mode",
    () => {
      afterEach(async () => {
        await cdp().send("Emulation.setEmulatedMedia", { features: [] })
        await waitForPaint()
      })

      it("H3: the selected tab is visible", async () => {
        mount(bar())
        await settle()
        await cdp().send("Emulation.setEmulatedMedia", {
          features: [{ name: "forced-colors", value: "active" }],
        })
        await waitForPaint()
        const [chosen, other] = links().map((f) => getComputedStyle(f))

        expect(chosen.borderBottomStyle).toBe("solid")
        expect(chosen.borderBottomColor).not.toBe(other.borderBottomColor)
        expect(chosen.color).not.toBe(other.color)
      })
    },
  )
})

describe("I. The builder function", () => {
  it("I2: an id stem with whitespace throws, like the keys", () => {
    expect(() => tabs({ id: "a b", keys: ["x"], label: "Tabs" })).toThrow(
      /whitespace/,
    )
    expect(() =>
      ltReact.tabs({ id: "a b", keys: ["x"], label: "Tabs" }),
    ).toThrow(/whitespace/)
  })

  it("I6: a selected that is not an integer gives the first tab", () => {
    for (const selected of [Number.NaN, 1.5]) {
      const f = ltReact.tabs({
        id: "file",
        keys: ["a", "b"],
        label: "Tabs",
        selected,
      })
      expect(f.tabs.map((t) => t["aria-selected"])).toEqual(["true", "false"])
      expect(f.panels.map((p) => p.hidden)).toEqual([undefined, true])
    }
  })

  it("I6: lt.tabs() in the React entry point gives the whole state", () => {
    expect(
      ltReact.tabs({
        id: "file",
        keys: ["a", "b"],
        label: "Parts of the claim",
        selected: 1,
      }),
    ).toEqual({
      list: {
        className: "lt-tabs__list",
        role: "tablist",
        "aria-label": "Parts of the claim",
      },
      item: { role: "presentation" },
      tabs: [
        {
          id: "file-a-tab",
          href: "#file-a",
          role: "tab",
          "aria-selected": "false",
          "aria-controls": "file-a",
          tabIndex: -1,
        },
        {
          id: "file-b-tab",
          href: "#file-b",
          role: "tab",
          "aria-selected": "true",
          "aria-controls": "file-b",
          tabIndex: 0,
        },
      ],
      panels: [
        {
          id: "file-a",
          className: "lt-tabs__panel",
          role: "tabpanel",
          "aria-labelledby": "file-a-tab",
          hidden: true,
        },
        {
          id: "file-b",
          className: "lt-tabs__panel",
          role: "tabpanel",
          "aria-labelledby": "file-b-tab",
          tabIndex: 0,
        },
      ],
    })
  })

  it("I5: lt.tabs() writes only links, ids and classes", () => {
    expect(
      tabs({ id: "file", keys: ["a", "b"], label: "Parts of the claim" }),
    ).toEqual({
      list: { class: "lt-tabs__list", "aria-label": "Parts of the claim" },
      tabs: [{ href: "#file-a" }, { href: "#file-b" }],
      panels: [
        { id: "file-a", class: "lt-tabs__panel" },
        { id: "file-b", class: "lt-tabs__panel" },
      ],
      headings: [{ id: "file-a-heading" }, { id: "file-b-heading" }],
    })
  })
})
