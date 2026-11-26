import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { userEvent } from "vitest/browser"

import { mount, waitForPaint } from "../../../testing/a11y"
import { setAddress } from "../../../testing/address"
import { attr } from "../../../testing/markup"
import { REPLACEMENTS, replace } from "../../../testing/update"
import { defineLtTabs } from "./lt-tabs"
import { tabs, tabsWithState } from "./tabs"

/*
 * Under `server-controlled` a click asks, and the server answers: the app
 * writes which tab is selected, on the tabs, on the panels or on both. The
 * answer comes as a morph of new markup, or as plain writes of attributes
 * from a script or a framework that renders again.
 *
 * The component marks the values it writes itself with `data-lt-written`,
 * and warns when it finds that attribute in markup it was given: copied
 * into a template, it makes the component take the server's word for its
 * own. Here no template has it. The only one who wrote it is the
 * component, for the click, so the warning must never come, however the
 * answer is written.
 */
const KEYS = ["claim", "attachments", "messages"]
const WORDS = ["Claim", "Attachments", "Messages"]
const OPTIONS = { id: "file", keys: KEYS, label: "Parts of the claim" }

/** The plain recipe: what `tabs()` writes, and nothing about the selection. */
function plain(): string {
  const built = tabs(OPTIONS)
  return `
    <lt-tabs id="file-tabs" server-controlled>
      <ul ${attr(built.list)}>${built.tabs
        .map((tab, index) => `<li><a ${attr(tab)}>${WORDS[index]}</a></li>`)
        .join("")}</ul>
      ${built.panels
        .map(
          (panel, index) =>
            `<section ${attr(panel)}><h2 ${attr(built.headings[index])}>${WORDS[index]}</h2><p>What this part holds.</p></section>`,
        )
        .join("")}
    </lt-tabs>`
}

/** The whole state from the server, as the React entry point writes it. */
function stated(selected: number): string {
  const built = tabsWithState({ ...OPTIONS, selected })
  return `
    <lt-tabs id="file-tabs" server-controlled>
      <ul ${attr(built.list)}>${built.tabs
        .map(
          (tab, index) =>
            `<li ${attr(built.item)}><a ${attr(tab)}>${WORDS[index]}</a></li>`,
        )
        .join("")}</ul>
      ${built.panels
        .map(
          (panel, index) =>
            `<section ${attr(panel)}><h2>${WORDS[index]}</h2><p>What this part holds.</p></section>`,
        )
        .join("")}
    </lt-tabs>`
}

const links = () => [
  ...document.querySelectorAll<HTMLElement>("#file-tabs .lt-tabs__list a"),
]
const panels = () => [
  ...document.querySelectorAll<HTMLElement>("#file-tabs .lt-tabs__panel"),
]

/** What the reader has: the tab that says it is selected, and the panel shown. */
function showing() {
  return {
    selected: links().flatMap((link, index) =>
      link.getAttribute("aria-selected") === "true" ? [index] : [],
    ),
    shown: panels().flatMap((panel, index) =>
      (panel.firstElementChild as HTMLElement).checkVisibility() ? [index] : [],
    ),
  }
}

/*
 * The ways an answer is written with plain attribute writes. `from` is the
 * tab the app had selected before, `to` the one it selects now.
 */
const SCRIPTS: Record<string, (from: number, to: number) => void> = {
  // Every tab and every panel, each time.
  "a script that writes aria-selected on every tab and hidden on every panel": (
    _from,
    to,
  ) => {
    for (const [index, link] of links().entries())
      link.setAttribute("aria-selected", String(index === to))
    for (const [index, panel] of panels().entries())
      panel.toggleAttribute("hidden", index !== to)
  },
  // A framework that renders again writes the attributes whose values
  // differ from what it rendered last, whatever the page holds now: on the
  // tab and the panel it leaves, and on the ones it goes to.
  "a new render that writes only what changed since the last one": (
    from,
    to,
  ) => {
    if (from === to) return
    const [tabList, panelList] = [links(), panels()]
    tabList[from].setAttribute("aria-selected", "false")
    tabList[from].setAttribute("tabindex", "-1")
    tabList[to].setAttribute("aria-selected", "true")
    tabList[to].setAttribute("tabindex", "0")
    panelList[from].setAttribute("hidden", "")
    panelList[from].removeAttribute("tabindex")
    panelList[to].removeAttribute("hidden")
    panelList[to].setAttribute("tabindex", "0")
  },
  "a script that moves only hidden": (_from, to) => {
    for (const [index, panel] of panels().entries())
      panel.toggleAttribute("hidden", index !== to)
  },
  "a script that moves only aria-selected": (_from, to) => {
    for (const [index, link] of links().entries())
      link.setAttribute("aria-selected", String(index === to))
  },
}

/*
 * When the answer comes: while the click is still being handled, as a
 * handler that writes straight away does; in a microtask or in the next
 * task, as a framework that renders after the handler does; or later, when
 * the page has settled, as an answer from the network does.
 */
const WHEN = ["at once", "in a microtask", "in the next task", "later"] as const
type When = (typeof WHEN)[number]

async function settled(): Promise<void> {
  await waitForPaint()
  await waitForPaint()
  await waitForPaint()
}

describe("lt-tabs server-controlled, and the answer to a click", () => {
  beforeAll(() => {
    defineLtTabs()
  })

  beforeEach(async () => {
    await setAddress("")
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** Every warning about the mark, from now on. */
  function listen(): () => string[] {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    return () =>
      warn.mock.calls
        .map((call) => String(call[0]))
        .filter((message) => message.includes("data-lt-written"))
  }

  /**
   * Clicks the tabs in `clicks`, one after another, and lets `answer` say
   * what the server answers to each, `when` it does.
   */
  async function converse(
    clicks: number[],
    answer: (from: number, to: number) => void,
    when: When,
    says: (clicked: number) => number = (clicked) => clicked,
  ) {
    let current = 0
    const seen: ReturnType<typeof showing>[] = []
    for (const clicked of clicks) {
      const to = says(clicked)
      const from = current
      const reply = () => answer(from, to)
      if (when !== "later")
        document.getElementById("file-tabs")?.addEventListener(
          "tab-select",
          () => {
            if (when === "at once") reply()
            else if (when === "in a microtask") queueMicrotask(reply)
            else setTimeout(reply)
          },
          { once: true },
        )
      await userEvent.click(links()[clicked])
      if (when === "later") {
        await settled()
        reply()
      }
      await settled()
      current = to
      seen.push(showing())
    }
    return seen
  }

  const MARKUPS = [
    ["the plain recipe", plain],
    ["the whole state from the server", () => stated(0)],
  ] as const

  for (const [markup, write] of MARKUPS)
    describe(`with ${markup}`, () => {
      for (const [way, answer] of Object.entries(SCRIPTS))
        for (const when of WHEN)
          it(`says nothing about data-lt-written when the answer is ${way}, ${when}`, async () => {
            mount(write())
            await settled()
            const said = listen()

            await converse([1], answer, when)

            expect(said()).toEqual([])
          })

      for (const when of WHEN)
        it(`says nothing when the answer is another tab than the one clicked, ${when}`, async () => {
          mount(write())
          await settled()
          const said = listen()

          const seen = await converse(
            [1],
            Object.values(SCRIPTS)[0],
            when,
            () => 2,
          )

          expect(said()).toEqual([])
          expect(seen).toEqual([{ selected: [2], shown: [2] }])
        })

      for (const [way, answer] of Object.entries(SCRIPTS).slice(0, 2))
        for (const when of WHEN)
          it(`says nothing through three clicks, each answered by ${way}, ${when}`, async () => {
            mount(write())
            await settled()
            const said = listen()

            const seen = await converse([1, 2, 0], answer, when)

            expect(said()).toEqual([])
            // And the answer is what shows, each time.
            expect(seen).toEqual(
              [1, 2, 0].map((index) => ({ selected: [index], shown: [index] })),
            )
          })

      for (const way of REPLACEMENTS)
        it(`says nothing through three clicks, each answered by new markup through ${way}`, async () => {
          mount(write())
          await settled()
          const said = listen()

          const seen = await converse(
            [1, 2, 0],
            (_from, to) => replace(way, "file-tabs", stated(to).trim()),
            "later",
          )

          expect(said()).toEqual([])
          expect(seen).toEqual(
            [1, 2, 0].map((index) => ({ selected: [index], shown: [index] })),
          )
        })
    })
})
