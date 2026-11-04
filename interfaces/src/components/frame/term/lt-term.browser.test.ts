/// <reference path="../../../types/css.d.ts" />

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { page, userEvent } from "vitest/browser"

import {
  expectNoAccessibilityViolations,
  mount,
  waitForPaint,
} from "../../../testing/a11y"
import { attr } from "../../../testing/markup"
import { datastarPatch, morph } from "../../../testing/update"
import { defineLtPopover, type LtPopover } from "../popover/lt-popover"
import { defineLtTerm, LtTerm } from "./lt-term"
import { term, termWithState } from "./term"

import "../../../tokens/tokens.css"
import "./term.css"
import "../popover/popover.css"

const SIGNAL = term({ id: "term-signal" })
const PATCH = term({ id: "term-patch" })

const GLOSSARY = `
  <dl id="glossary">
    <div ${attr(SIGNAL.entry)}>
      <dt>Signal</dt>
      <dd>A value Datastar keeps in the browser and sends to the server with
        every request. <a href="#more" id="in-card">More</a></dd>
    </div>
    <div ${attr(PATCH.entry)}>
      <dt>Patch</dt>
      <dd>The markup the server sends back, morphed into the page.</dd>
    </div>
  </dl>
`

function page1(): void {
  mount(`
    <p><button type="button" id="elsewhere">Elsewhere</button></p>
    <p id="text">Datastar keeps
      <lt-term id="host"><a ${attr(SIGNAL.word)} id="word">signals</a></lt-term>
      in the browser, and a
      <lt-term id="host-2"><a ${attr(PATCH.word)} id="word-2">patch</a></lt-term>
      brings new markup.
    </p>
    ${GLOSSARY}
  `)
}

/** The box of the last line of an inline element: the card goes under it. */
const lastBox = (element: Element) => {
  const boxes = element.getClientRects()
  return boxes[boxes.length - 1]
}

const $ = (id: string) => document.getElementById(id) as HTMLElement

async function paint() {
  await customElements.whenDefined("lt-term")
  await waitForPaint()
}

/** Waits for the hover delay and a frame. */
async function rest(ms = 400) {
  await new Promise((resolve) => setTimeout(resolve, ms))
  await waitForPaint()
}

/**
 * Gives the test its own clock, for the tests about the hover delays. With
 * the machine's clock, one hover on a busy machine took longer than the 300
 * ms the card waits, and the card was open before the test could see it
 * closed. `userEvent` works with a fake `setTimeout`, as in the model test.
 *
 * The mouse is parked in a corner first, on the machine's clock. The test
 * before may have left it over the word, and the browser then sends
 * `pointerenter` to the new word by itself, with the delay started on a
 * clock the test does not move.
 */
async function useClock() {
  const park = document.createElement("div")
  park.id = "lt-park"
  park.style.cssText =
    "position: fixed; inset-block-end: 0; inset-inline-end: 0; inline-size: 8px; block-size: 8px"
  document.body.append(park)
  await userEvent.hover(park)
  await rest()
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
}

async function tick(ms: number) {
  vi.advanceTimersByTime(ms)
  await waitForPaint()
}

function pointer(type: string, target: Element, pointerType: string) {
  target.dispatchEvent(
    new PointerEvent(type, { pointerType, bubbles: type !== "pointerenter" }),
  )
}

/**
 * Clicks `link` and answers whether the web component left the click to the
 * browser. The test stops the navigation itself afterwards: a click with
 * Cmd opens a new tab, and the test runner lost its page to it.
 */
function leftToTheBrowser(link: Element, keys: MouseEventInit): boolean {
  let left = false
  const stop = (event: Event) => {
    left = !event.defaultPrevented
    event.preventDefault()
  }
  document.addEventListener("click", stop)
  link.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
      ...keys,
    }),
  )
  document.removeEventListener("click", stop)
  return left
}

describe("lt-term", () => {
  beforeAll(() => {
    defineLtTerm()
  })

  // Wider than `sm`, where the card is next to the word. Vitest's window is
  // 414 pixels, and there the card is a sheet; those tests set their own.
  beforeEach(async () => {
    await page.viewport(1280, 720)
  })

  afterAll(async () => {
    await page.viewport(414, 896)
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ""
  })

  it("leaves the server's markup as a link, and adds only aria-expanded", async () => {
    page1()
    await paint()
    const word = $("word")
    expect(word.getAttribute("href")).toBe("#term-signal")
    expect(word.getAttribute("aria-details")).toBe("term-signal")
    expect(word.getAttribute("aria-expanded")).toBe("false")
    // Closed, the entry is an ordinary part of the glossary.
    const entry = $("term-signal")
    expect(entry.hasAttribute("popover")).toBe(false)
    expect(getComputedStyle(entry).display).toBe("block")
    expect(entry.getBoundingClientRect().height).toBeGreaterThan(0)
  })

  it("opens the entry itself as a card under the word on a click, and pins it", async () => {
    page1()
    await paint()
    const word = $("word")
    const entry = $("term-signal")
    const before = location.href

    await userEvent.click(word)
    await paint()

    expect(entry.matches(":popover-open")).toBe(true)
    expect(word.getAttribute("aria-expanded")).toBe("true")
    expect(location.href).toBe(before)
    const card = entry.getBoundingClientRect()
    const box = lastBox(word)
    expect(card.top).toBeGreaterThanOrEqual(box.bottom)
    expect(card.top - box.bottom).toBeLessThan(12)

    // Pinned: the mouse leaving does not close it.
    await userEvent.hover($("elsewhere"))
    await rest()
    expect(entry.matches(":popover-open")).toBe(true)

    await userEvent.click(word)
    await paint()
    expect(entry.matches(":popover-open")).toBe(false)
    expect(entry.hasAttribute("popover")).toBe(false)
    expect(word.getAttribute("aria-expanded")).toBe("false")
  })

  it("opens on hover after a rest, stays while the pointer is in the card, and closes when it leaves", async () => {
    page1()
    await paint()
    const word = $("word")
    const entry = $("term-signal")
    await useClock()

    await userEvent.hover(word)
    await tick(299)
    expect(entry.matches(":popover-open")).toBe(false)
    await tick(1)
    expect(entry.matches(":popover-open")).toBe(true)

    await userEvent.hover($("in-card"))
    await tick(400)
    expect(entry.matches(":popover-open")).toBe(true)

    await userEvent.hover($("elsewhere"))
    await tick(199)
    expect(entry.matches(":popover-open")).toBe(true)
    await tick(1)
    expect(entry.matches(":popover-open")).toBe(false)
  })

  it("does not open when the pointer only passes over the word", async () => {
    page1()
    await paint()
    await useClock()
    await userEvent.hover($("word"))
    await userEvent.hover($("elsewhere"))
    await tick(400)
    expect($("term-signal").matches(":popover-open")).toBe(false)
  })

  it("pins a card opened by hover on a click, rather than closing it", async () => {
    page1()
    await paint()
    const word = $("word")
    const entry = $("term-signal")

    await userEvent.hover(word)
    await rest()
    await userEvent.click(word)
    await paint()
    expect(entry.matches(":popover-open")).toBe(true)

    await userEvent.hover($("elsewhere"))
    await rest()
    expect(entry.matches(":popover-open")).toBe(true)
  })

  it("ignores a touch pointer, and opens on the tap's click", async () => {
    page1()
    await paint()
    const word = $("word")
    const entry = $("term-signal")

    pointer("pointerenter", word, "touch")
    await rest()
    expect(entry.matches(":popover-open")).toBe(false)

    word.click()
    await paint()
    expect(entry.matches(":popover-open")).toBe(true)
    pointer("pointerleave", word, "touch")
    await rest()
    expect(entry.matches(":popover-open")).toBe(true)
  })

  it("opens with Enter, and closes with Escape with focus back on the word, without scrolling", async () => {
    mount(`
      <div style="block-size: 150vh"></div>
      <p>Datastar keeps <lt-term><a ${attr(SIGNAL.word)} id="word">signals</a></lt-term>.</p>
      <div style="block-size: 150vh"></div>
      ${GLOSSARY}
    `)
    await paint()
    const word = $("word")
    const entry = $("term-signal")
    word.scrollIntoView({ block: "center" })
    await paint()
    const y = window.scrollY

    word.focus()
    await userEvent.keyboard("{Enter}")
    await paint()
    expect(entry.matches(":popover-open")).toBe(true)
    expect(window.scrollY).toBe(y)

    await userEvent.keyboard("{Escape}")
    await paint()
    expect(entry.matches(":popover-open")).toBe(false)
    expect(document.activeElement).toBe(word)
    expect(window.scrollY).toBe(y)
  })

  it("closes on a click outside, and not on a click in the card", async () => {
    page1()
    await paint()
    const entry = $("term-signal")
    await userEvent.click($("word"))
    await paint()

    $("in-card").addEventListener("click", (event) => event.preventDefault())
    await userEvent.click($("in-card"))
    await paint()
    expect(entry.matches(":popover-open")).toBe(true)

    await userEvent.click($("elsewhere"))
    await paint()
    expect(entry.matches(":popover-open")).toBe(false)
  })

  it("closes when the word scrolls out of view", async () => {
    mount(`
      <p>Datastar keeps <lt-term><a ${attr(SIGNAL.word)} id="word">signals</a></lt-term>.</p>
      <div style="block-size: 300vh"></div>
      ${GLOSSARY}
    `)
    await paint()
    await userEvent.click($("word"))
    await paint()
    expect($("term-signal").matches(":popover-open")).toBe(true)

    window.scrollBy({ top: window.innerHeight * 1.5, behavior: "instant" })
    await rest(200)
    expect($("term-signal").matches(":popover-open")).toBe(false)
    window.scrollTo({ top: 0, behavior: "instant" })
  })

  it("puts the gap in --lt-term-gap between the word and the card", async () => {
    page1()
    await paint()
    const word = $("word")
    const entry = $("term-signal")
    const gap = () => entry.getBoundingClientRect().top - lastBox(word).bottom

    await userEvent.click(word)
    await paint()
    // The default is `--lt-spacing-2`, 0.5rem.
    expect(Math.abs(gap() - 8)).toBeLessThan(1.5)
    await userEvent.click(word)
    await paint()

    document.documentElement.style.setProperty("--lt-term-gap", "1.5rem")
    try {
      await userEvent.click(word)
      await paint()
      expect(Math.abs(gap() - 24)).toBeLessThan(1.5)
    } finally {
      document.documentElement.style.removeProperty("--lt-term-gap")
    }
  })

  it("hands the entry over when another word opens it", async () => {
    mount(`
      <p>
        <lt-term><a ${attr(SIGNAL.word)} id="a">signals</a></lt-term> and
        <lt-term><a ${attr(SIGNAL.word)} id="b">the signal</a></lt-term>
      </p>
      ${GLOSSARY}
    `)
    await paint()
    await userEvent.click($("a"))
    await paint()
    await userEvent.click($("b"))
    await paint()
    expect($("term-signal").matches(":popover-open")).toBe(true)
    expect($("a").getAttribute("aria-expanded")).toBe("false")
    expect($("b").getAttribute("aria-expanded")).toBe("true")
    const card = $("term-signal").getBoundingClientRect()
    expect(card.top).toBeGreaterThanOrEqual(
      $("b").getBoundingClientRect().bottom,
    )
  })

  it("wires hand-written markup, and takes off what it set when the card closes", async () => {
    mount(`
      <p>Datastar keeps <lt-term><a href="#term-signal" id="word">signals</a></lt-term>.</p>
      <dl><div id="term-signal"><dt>Signal</dt><dd>A value.</dd></div></dl>
    `)
    await paint()
    const word = $("word")
    const entry = $("term-signal")
    expect(word.classList.contains("lt-term")).toBe(true)
    expect(word.getAttribute("aria-details")).toBe("term-signal")

    await userEvent.click(word)
    await paint()
    expect(entry.getAttribute("popover")).toBe("manual")
    expect(entry.classList.contains("lt-term__entry")).toBe(true)

    await userEvent.keyboard("{Escape}")
    await paint()
    expect(entry.hasAttribute("popover")).toBe(false)
    expect(entry.hasAttribute("class")).toBe(false)
    expect(entry.hasAttribute("style")).toBe(false)
  })

  it("keeps the card open through a patch that strips the entry and the word", async () => {
    page1()
    await paint()
    await userEvent.click($("word"))
    await paint()

    // Datastar and idiomorph remove every attribute the server did not send.
    datastarPatch(GLOSSARY)
    morph(
      $("host"),
      `<lt-term id="host"><a ${attr(SIGNAL.word)} id="word">signals</a></lt-term>`,
    )
    await paint()
    expect($("term-signal").matches(":popover-open")).toBe(true)
    expect($("word").getAttribute("aria-expanded")).toBe("true")
    const card = $("term-signal").getBoundingClientRect()
    expect(card.top).toBeGreaterThanOrEqual(
      $("word").getBoundingClientRect().bottom,
    )
  })

  it("puts back the class it set on the word after a morph takes it", async () => {
    mount(`
      <p><lt-term><a href="#term-signal" id="word">signals</a></lt-term></p>
      <dl><div id="term-signal"><dt>Signal</dt><dd>A value.</dd></div></dl>
    `)
    await paint()
    expect($("word").classList.contains("lt-term")).toBe(true)
    // What a morph does to an attribute the server did not send, and nothing
    // else: no node changes, so only the observer on the element sees it.
    $("word").removeAttribute("class")
    await paint()
    expect($("word").classList.contains("lt-term")).toBe(true)
  })

  it("notices an entry that arrives after the word, and one that goes", async () => {
    mount(`
      <p><lt-term><a ${attr(SIGNAL.word)} id="word">signals</a></lt-term></p>
      <div id="later"></div>
    `)
    await paint()
    expect($("word").hasAttribute("aria-expanded")).toBe(false)

    // The glossary arrives in a later update, outside the element.
    $("later").innerHTML = GLOSSARY
    await paint()
    expect($("word").getAttribute("aria-expanded")).toBe("false")

    $("term-signal").removeAttribute("id")
    await paint()
    expect($("word").hasAttribute("aria-expanded")).toBe(false)
  })

  it("follows a new link out of view after an update replaces it while the card is open", async () => {
    mount(`
      <p><lt-term id="host"><a ${attr(SIGNAL.word)} id="word">signals</a></lt-term></p>
      <div style="block-size: 300vh"></div>
      ${GLOSSARY}
    `)
    await paint()
    await userEvent.click($("word"))
    await paint()
    $("host").innerHTML = `<a ${attr(SIGNAL.word)} id="word">signals</a>`
    await rest(200)
    expect($("term-signal").matches(":popover-open")).toBe(true)

    window.scrollBy({ top: window.innerHeight * 1.5, behavior: "instant" })
    await rest(200)
    expect($("term-signal").matches(":popover-open")).toBe(false)
    window.scrollTo({ top: 0, behavior: "instant" })
  })

  it("points aria-details at the entry the link points at now, and leaves the server's", async () => {
    mount(`
      <p>
        <lt-term><a href="#term-signal" id="mine">signals</a></lt-term>
        <lt-term><a href="#term-signal" aria-details="server-said" id="theirs">signals</a></lt-term>
      </p>
      ${GLOSSARY}
    `)
    await paint()
    expect($("mine").getAttribute("aria-details")).toBe("term-signal")

    $("mine").setAttribute("href", "#term-patch")
    $("theirs").setAttribute("href", "#term-patch")
    await paint()
    expect($("mine").getAttribute("aria-details")).toBe("term-patch")
    expect($("theirs").getAttribute("aria-details")).toBe("server-said")

    $("mine").setAttribute("href", "#term-nowhere")
    await paint()
    expect($("mine").hasAttribute("aria-details")).toBe(false)
  })

  it("closes a card in an open popover with Escape, and leaves the popover open", async () => {
    defineLtPopover()
    mount(`
      <lt-popover id="menu">
        <button class="lt-button" type="button">Policy</button>
        <div class="lt-popover" id="panel">
          <p>Paid unless an <lt-term><a ${attr(SIGNAL.word)} id="word">act of God</a></lt-term>.</p>
        </div>
      </lt-popover>
      ${GLOSSARY}
    `)
    await paint()
    ;(document.getElementById("menu") as LtPopover).show()
    await paint()
    $("word").focus()
    await userEvent.keyboard("{Enter}")
    await paint()
    expect($("term-signal").matches(":popover-open")).toBe(true)

    await userEvent.keyboard("{Escape}")
    await paint()
    expect($("term-signal").matches(":popover-open")).toBe(false)
    expect($("panel").matches(":popover-open")).toBe(true)

    await userEvent.keyboard("{Escape}")
    await paint()
    expect($("panel").matches(":popover-open")).toBe(false)
  })

  it("leaves the focus in a field outside its shadow root on Escape", async () => {
    mount(
      `<div id="shadow-host"></div><input id="field" aria-label="Claim number" />`,
    )
    const root = $("shadow-host").attachShadow({ mode: "open" })
    root.innerHTML = `<p><lt-term><a ${attr(SIGNAL.word)} id="word">signals</a></lt-term></p>${GLOSSARY}`
    await paint()
    const word = root.getElementById("word") as HTMLElement
    word.click()
    await paint()
    expect(root.getElementById("term-signal")?.matches(":popover-open")).toBe(
      true,
    )

    $("field").focus()
    await userEvent.keyboard("{Escape}")
    await paint()
    expect(root.getElementById("term-signal")?.matches(":popover-open")).toBe(
      false,
    )
    expect(document.activeElement).toBe($("field"))
  })

  it("finds an entry whose id is written with a percent sign, as the browser does", async () => {
    mount(`
      <p><lt-term><a href="#term-a%41" id="word">signals</a></lt-term></p>
      <dl><div id="term-a%41"><dt>Signal</dt><dd>A value.</dd></div></dl>
    `)
    await paint()
    expect($("word").getAttribute("aria-expanded")).toBe("false")
    expect($("word").getAttribute("aria-details")).toBe("term-a%41")
  })

  it("shows the new entry when the glossary is replaced while the card is open, and closes when it is gone", async () => {
    page1()
    await paint()
    await userEvent.click($("word"))
    await paint()

    $("glossary").outerHTML = GLOSSARY.replace("A value", "A new value")
    await paint()
    const entry = $("term-signal")
    expect(entry.matches(":popover-open")).toBe(true)
    expect(entry.textContent).toContain("A new value")

    $("glossary").outerHTML = "<dl id='glossary'></dl>"
    await paint()
    expect($("word").hasAttribute("aria-expanded")).toBe(false)
  })

  it("stays a plain link, and says so once, when the id does not exist or is not an entry", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    mount(`
      <p>
        <lt-term id="missing"><a href="#term-nowhere" id="w1">signals</a></lt-term>
        <lt-term id="dt"><a href="#term-dt" id="w2">patch</a></lt-term>
      </p>
      <dl><dt id="term-dt">Patch</dt><dd>The markup.</dd></dl>
    `)
    await paint()
    await rest(100)
    const said = warn.mock.calls.map((call) => String(call[0]))
    warn.mockRestore()
    expect(
      said.filter((text) => text.includes("an id the page does not have")),
    ).toHaveLength(1)
    expect(
      said.filter((text) => text.includes("not a glossary entry")),
    ).toHaveLength(1)
    expect($("w1").hasAttribute("aria-expanded")).toBe(false)

    expect(leftToTheBrowser($("w2"), {})).toBe(true)
  })

  it("says nothing about markup that is right", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    page1()
    await paint()
    await rest(100)
    const said = warn.mock.calls.length
    warn.mockRestore()
    expect(said).toBe(0)
  })

  it("leaves a click with a modifier key to the browser", async () => {
    page1()
    await paint()
    expect(leftToTheBrowser($("word"), { metaKey: true })).toBe(true)
    expect($("term-signal").matches(":popover-open")).toBe(false)
  })

  it("places the card from the word's start edge in a right-to-left document", async () => {
    mount(`
      <div dir="rtl">
        <p>نص <lt-term><a ${attr(SIGNAL.word)} id="word">إشارة</a></lt-term> نص</p>
        ${GLOSSARY}
      </div>
    `)
    await paint()
    await userEvent.click($("word"))
    await paint()
    const card = $("term-signal").getBoundingClientRect()
    const word = $("word").getBoundingClientRect()
    // The card's right edge lines up with the word's, unless the window
    // pushed it in.
    expect(Math.abs(card.right - word.right) < 2 || card.left <= 5).toBe(true)
  })

  it("keeps the card inside a narrow window", async () => {
    await page.viewport(320, 640)
    try {
      mount(`
        <p style="text-align: end">Keeps <lt-term><a ${attr(SIGNAL.word)} id="word">signals</a></lt-term></p>
        ${GLOSSARY}
      `)
      await paint()
      await userEvent.click($("word"))
      await paint()
      const card = $("term-signal").getBoundingClientRect()
      expect(card.left).toBeGreaterThanOrEqual(0)
      expect(card.right).toBeLessThanOrEqual(
        document.documentElement.clientWidth,
      )
    } finally {
      await page.viewport(1280, 720)
    }
  })

  describe("on a narrow screen", () => {
    it("is a sheet across the bottom of the window, with the word above it", async () => {
      await page.viewport(390, 700)
      page1()
      await paint()
      await userEvent.click($("word"))
      await paint()
      const card = $("term-signal").getBoundingClientRect()
      expect(card.left).toBe(0)
      expect(Math.round(card.right)).toBe(document.documentElement.clientWidth)
      expect(Math.round(card.bottom)).toBe(
        document.documentElement.clientHeight,
      )
      expect($("word").getBoundingClientRect().bottom).toBeLessThanOrEqual(
        card.top,
      )
    })

    it("goes to the top when the word is down where the sheet would cover it", async () => {
      await page.viewport(390, 700)
      mount(`
        <div style="block-size: 560px"></div>
        <p>Datastar keeps <lt-term><a ${attr(SIGNAL.word)} id="word">signals</a></lt-term>.</p>
        <div style="block-size: 150vh"></div>
        ${GLOSSARY}
      `)
      await paint()
      await userEvent.click($("word"))
      await paint()
      const card = $("term-signal").getBoundingClientRect()
      expect(Math.round(card.top)).toBe(0)
      expect($("word").getBoundingClientRect().top).toBeGreaterThanOrEqual(
        card.bottom,
      )
    })

    it("scrolls an explanation taller than the sheet inside it", async () => {
      await page.viewport(390, 500)
      mount(`
        <p>Datastar keeps <lt-term><a ${attr(SIGNAL.word)} id="word">signals</a></lt-term>.</p>
        <dl><div ${attr(SIGNAL.entry)}><dt>Signal</dt><dd>${"A value Datastar keeps in the browser. ".repeat(40)}</dd></div></dl>
      `)
      await paint()
      await userEvent.click($("word"))
      await paint()
      const entry = $("term-signal")
      expect(entry.getBoundingClientRect().height).toBeLessThanOrEqual(
        window.innerHeight * 0.6 + 1,
      )
      expect(entry.scrollHeight).toBeGreaterThan(entry.clientHeight)
      // Scrolling to the end of it does not move the page behind.
      expect(getComputedStyle(entry).overscrollBehaviorY).toBe("contain")
    })
  })

  it("marks the word whose card is open", async () => {
    page1()
    await paint()
    const word = $("word")
    const closed = getComputedStyle(word).backgroundColor
    await userEvent.click(word)
    await paint()
    expect(getComputedStyle(word).backgroundColor).not.toBe(closed)
  })

  it("is the class the web component exports, and termWithState has the state it writes", () => {
    expect(customElements.get("lt-term")).toBe(LtTerm)
    expect(termWithState({ id: "term-signal" }).word["aria-expanded"]).toBe(
      "false",
    )
    expect(() => term({ id: "" })).toThrow()
  })

  it("has no accessibility violations, closed and open", async () => {
    page1()
    await paint()
    await expectNoAccessibilityViolations(document.body)
    await userEvent.click($("word"))
    await paint()
    await expectNoAccessibilityViolations(document.body)
  })
})
