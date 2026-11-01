/// <reference path="./types/css.d.ts" />

/*
 * Every hover that changes the background must keep the contrast.
 *
 * This is the one class of bug the unit tests did not see. `.lt-button:hover`
 * read a token that does not exist, and the pagination's hover won on
 * specificity over `[aria-current="page"]`, so the page number the user was on
 * disappeared. In both cases the resting state was right, and every other
 * guard was green.
 *
 * The browser is the only honest judge here: which colour applies under the
 * mouse is decided by the cascade, and it was precisely the specificity that
 * went wrong. That is why the tests hover with the mouse rather than compute
 * from the stylesheet.
 */

import { beforeEach, describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import { contrastRatio } from "./tokens/color.js"

import "./tokens/tokens.css"
import "./components/css/accordion/accordion.css"
import "./components/css/button/button.css"
import "./components/css/checkbox/checkbox.css"
import "./components/css/radio/radio.css"
import "./components/css/switch/switch.css"
import "./components/css/pagination/pagination.css"
import "./components/css/table/table.css"
import "./components/frame/tabs/tabs.css"
import "./components/css/toggle-group/toggle-group.css"
import "./components/frame/suggestion/suggestion.css"
import "./components/standalone/toast/toast.css"

type Case = {
  /** The rule the case covers, normalised as in the check at the bottom. */
  rule: string
  /** The markup that gives the element a surface to sit on. */
  markup: string
  /** The element the mouse moves over. */
  selector: string
}

const CASES: Case[] = [
  {
    rule: ".lt-accordion summary:hover",
    markup: `<details class="lt-accordion"><summary>Terms</summary><div class="lt-accordion__content">Text</div></details>`,
    selector: ".lt-accordion summary",
  },
  {
    rule: ".lt-button:hover",
    markup: `<button class="lt-button">Order the job</button>`,
    selector: ".lt-button",
  },
  {
    rule: '.lt-button[data-variant="secondary"]:hover:not( :disabled, [aria-disabled="true"] )',
    markup: `<button class="lt-button" data-variant="secondary">Cancel</button>`,
    selector: ".lt-button",
  },
  {
    rule: '.lt-button[data-variant="ghost"]:hover:not( :disabled, [aria-disabled="true"] )',
    markup: `<button class="lt-button" data-variant="ghost">Close</button>`,
    selector: ".lt-button",
  },
  {
    rule: '.lt-button[data-variant="danger"]:hover:not( :disabled, [aria-disabled="true"] )',
    markup: `<button class="lt-button" data-variant="danger">Delete</button>`,
    selector: ".lt-button",
  },
  {
    rule: '.lt-pagination a:not([aria-current="page"]):hover, .lt-pagination button:hover:not(:disabled):not([aria-current="page"])',
    markup: `<ul class="lt-pagination"><li><a href="#">1</a></li></ul>`,
    selector: ".lt-pagination a",
  },
  {
    rule: '.lt-pagination [aria-current="page"]:hover',
    markup: `<ul class="lt-pagination"><li><a href="#" aria-current="page">2</a></li></ul>`,
    selector: ".lt-pagination a",
  },
  {
    rule: ".lt-table[data-hoverable] tbody tr:hover",
    markup: `<table class="lt-table" data-hoverable><tbody><tr><td>Row</td></tr></tbody></table>`,
    selector: ".lt-table td",
  },
  {
    rule: ".lt-table__sort:hover",
    markup: `<table class="lt-table"><thead><tr><th scope="col" aria-sort="ascending"><button type="button" class="lt-table__sort">Date</button></th></tr></thead></table>`,
    selector: ".lt-table__sort",
  },
  {
    rule: ".lt-toggle-group__option:hover",
    markup: `<fieldset class="lt-toggle-group"><label class="lt-toggle-group__option"><input type="radio" name="v" /> Map</label></fieldset>`,
    selector: ".lt-toggle-group__option",
  },
  {
    rule: ".lt-tabs__list a:hover",
    markup: `<ul class="lt-tabs__list"><li><a href="#overview">Overview</a></li></ul><section class="lt-tabs__panel" id="overview">Overview</section>`,
    selector: ".lt-tabs__list a",
  },
  {
    rule: ".lt-suggestion__option:hover",
    markup: `<div><input class="lt-input" /><ul class="lt-suggestion__list"><li class="lt-suggestion__option">Crowbar</li></ul></div>`,
    selector: ".lt-suggestion__option",
  },
  {
    rule: ".lt-toast__close:hover",
    markup: `<div class="lt-toast__message"><p>Saved</p><button class="lt-toast__close" type="button">Close</button></div>`,
    selector: ".lt-toast__close",
  },
]

/*
 * Two rules cannot be hovered by a test, and are listed here so the
 * completeness check at the bottom knows about them.
 *
 * `::file-selector-button` is a pseudo-element: `querySelector` does not find
 * it, and `userEvent.hover` takes an element. `option` in the styled select
 * is inside an `@supports (appearance: base-select)` that Firefox 150 does
 * not have, and in the other two engines it is not rendered until the picker
 * is open.
 *
 * They were once checked against a token pair written in here. That is gone:
 * the pair was copied by hand, so it said nothing about what the CSS actually
 * did, and one of the two was lifted word for word from "text on its own
 * surface", which the contract already checks for every family. An assertion
 * that repeats a stricter guard looks like coverage and is noise.
 */
const WITHOUT_MOUSE = [
  ".lt-file-upload::file-selector-button:hover",
  '.lt-select[data-picker="styled"] option:hover',
  // High contrast: keeps `Highlight` under the mouse too. It is not a hover
  // colour, and it is tested in `high-contrast.browser.test.ts`.
  '.lt-pagination [aria-current="page"], .lt-pagination [aria-current="page"]:hover',
]

/**
 * The colour as `rgb`, or an error.
 *
 * Anything other than `rgb()` and `rgba()` with alpha 1 is rejected rather
 * than interpreted. The first version read the first three numbers in the
 * string, and would have read `color(srgb 0.13 0.43 0.73)` as 0, 0 and 0
 * without a word, giving a wrong ratio that looked right. No component uses
 * such values today, so this is the place to speak up if one does.
 */
function toRgb(value: string) {
  const match = value.match(
    /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)\s*(?:[,/]\s*([\d.]+)\s*)?\)$/,
  )
  if (!match) throw new Error(`Not an rgb colour: ${value}`)
  if (match[4] !== undefined && Number(match[4]) !== 1) {
    throw new Error(
      `Semi-transparent colour, which the test does not compute: ${value}`,
    )
  }
  return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) }
}

/**
 * The background that actually shows: the nearest surface that is not
 * transparent.
 *
 * If there is none, it throws. A fallback to white stood here, and it was
 * wrong in the dark theme. Worse: it was the only thing that made some of the
 * cases sensitive to whether the hover had applied, so a wrong answer kept
 * the test alive. The surrounding surface is set in `mountTwice()` and is
 * always opaque.
 */
function visibleBackground(element: Element): string {
  let node: Element | null = element
  while (node) {
    const value = getComputedStyle(node).backgroundColor
    if (!/^rgba\(.*,\s*0\)$/.test(value)) return value
    node = node.parentElement
  }
  throw new Error("No opaque surface under the element")
}

/**
 * The markup twice: one to hover, one to leave alone.
 *
 * The state without the mouse must be read from an element that has never
 * had the mouse over it. Reading before and after on the same element cannot
 * be trusted, since the mouse can be where the markup is inserted, and a
 * `mouseleave` that never came would make the two readings equal without
 * anything being wrong.
 */
function mountTwice(markup: string) {
  /*
   * `position: relative` on each copy is not decoration: an absolutely
   * positioned child, such as the suggestion list, would otherwise measure
   * from the same origin in both copies and lie on top of the other.
   */
  document.body.innerHTML = `
    <div id="surface" style="background: var(--lt-color-neutral-canvas)">
      <div id="under-mouse" style="position: relative">${markup}</div>
      <div id="at-rest" style="position: relative">${markup}</div>
    </div>`

  const find = (id: string, selector: string) => {
    const element = document.querySelector(`#${id} ${selector}`)
    if (!(element instanceof HTMLElement)) {
      throw new Error(`Did not find ${selector} in #${id}`)
    }
    return element
  }

  return find
}

for (const appearance of ["light", "dark"] as const) {
  describe(`hover in the ${appearance} theme`, () => {
    beforeEach(() => {
      document.documentElement.dataset.theme = appearance
    })

    it.each(
      CASES.map((c) => [c.rule, c] as const),
    )("%s keeps the contrast under the mouse", async (_name, testCase) => {
      const find = mountTwice(testCase.markup)
      const element = find("under-mouse", testCase.selector)
      const resting = find("at-rest", testCase.selector)

      /*
       * Both are read after the mouse has moved. Had we read the resting one
       * first, the pointer was where the previous test left it, and if that
       * point fell inside `#at-rest`, we read a hover state as "at rest".
       */
      await userEvent.hover(element)

      const surface = visibleBackground(element)
      const surfaceAtRest = visibleBackground(resting)

      /*
       * Without this step every case passes on the state without the mouse.
       * In the light theme all twelve kept the contrast at rest, and exactly
       * the case the file was written for, the current page in the
       * pagination, held in both themes. A `userEvent.hover` that stopped
       * hitting would then have turned the guard green in silence, which is
       * worse than no guard.
       */
      expect(surface, "the mouse did not change the surface").not.toBe(
        surfaceAtRest,
      )

      const text = toRgb(getComputedStyle(element).color)
      expect(contrastRatio(text, toRgb(surface))).toBeGreaterThanOrEqual(4.5)
    })
  })
}

/*
 * The list above must cover every hover rule that changes the background.
 *
 * Without this step the list is a collection of cases someone remembered, and
 * a new hover rule would come in without a case covering it. The rule is read
 * from the stylesheets, so the source decides what must be listed here.
 */
const stylesheets = import.meta.glob("./components/**/*.css", {
  query: "?inline",
  import: "default",
  eager: true,
}) as Record<string, string>

describe("the list is complete", () => {
  it("has a case for every stylesheet with a hover that changes the background", () => {
    const withHover = new Set<string>()

    for (const css of Object.values(stylesheets)) {
      const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, " ")
      for (const match of withoutComments.matchAll(
        /([^{}]*:hover[^{}]*)\{([^}]*)\}/g,
      )) {
        if (/\bbackground(-color)?\s*:/.test(match[2]))
          withHover.add(match[1].split(/\s+/).join(" ").trim())
      }
    }

    const covered = new Set([...CASES.map((c) => c.rule), ...WITHOUT_MOUSE])
    expect([...withHover].filter((r) => !covered.has(r)).sort()).toEqual([])
    expect([...covered].filter((r) => !withHover.has(r)).sort()).toEqual([])
  })
})

/*
 * The opposite of the cases above: a hover that must not beat the state.
 *
 * They are in this file because the browser page has one mouse. A separate
 * file hovering at the same time moved the mouse for the tests above, and
 * both failed at random in Firefox.
 */
function border(id: string) {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLElement)) throw new Error(`Missing #${id}`)
  return getComputedStyle(element).borderTopColor
}

function surfaceAndText(id: string) {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLElement)) throw new Error(`Missing #${id}`)
  const s = getComputedStyle(element)
  return [s.backgroundColor, s.color, s.borderTopColor].join(" / ")
}

/**
 * The reading at rest, with an assertion that the mouse is really not there.
 *
 * If the mouse was already over the element, "before" was read with hover
 * on, "after" was the same, and the test passed whatever the stylesheet did.
 */
function atRest<T>(id: string, read: (id: string) => T): T {
  const element = document.getElementById(id) as HTMLElement
  expect(
    element.matches(":hover"),
    "the mouse is already over the element",
  ).toBe(false)
  return read(id)
}

async function over(id: string) {
  const element = document.getElementById(id) as HTMLElement
  await userEvent.hover(element)
  await new Promise((done) => requestAnimationFrame(done))
  expect(element.matches(":hover"), "the mouse is not over the element").toBe(
    true,
  )
}

describe("hover does not beat the state", () => {
  beforeEach(async () => {
    document.documentElement.removeAttribute("data-theme")
    document.body.innerHTML = `
      <style>.lt-button, .lt-checkbox, .lt-radio, .lt-switch { transition: none; }</style>
      <div id="parking" style="inline-size: 3rem; block-size: 3rem"></div>
      <div style="padding: 2rem; display: flex; gap: 2rem; flex-wrap: wrap">
        <button class="lt-button" data-variant="secondary" id="secondary-off" disabled>Off</button>
        <button class="lt-button" data-variant="ghost" id="ghost-off" disabled>Off</button>
        <button class="lt-button" data-variant="danger" id="danger-off" disabled>Off</button>
        <input type="checkbox" class="lt-checkbox" id="box-plain" />
        <input type="checkbox" class="lt-checkbox" id="box-invalid" data-state="invalid" />
        <input type="checkbox" class="lt-checkbox" id="box-checked" checked />
        <input type="checkbox" class="lt-checkbox" id="box-off" disabled />
        <input type="radio" class="lt-radio" id="radio-invalid" data-state="invalid" />
        <input type="radio" class="lt-radio" id="radio-checked" checked />
        <input type="checkbox" role="switch" class="lt-switch" id="switch-checked" checked />
      </div>`
    // To a separate, empty element. `unhover(body)` moves the mouse to the
    // middle of `body`, that is into the markup above, and could land on one
    // of the controls.
    await userEvent.hover(document.getElementById("parking") as HTMLElement)
  })

  it("still gives a plain box a darker border under the mouse", async () => {
    // Otherwise the tests below could pass because hover had been removed entirely.
    const rest = atRest("box-plain", border)
    await over("box-plain")

    expect(border("box-plain")).not.toBe(rest)
  })

  for (const id of ["secondary-off", "ghost-off", "danger-off"]) {
    it(`gives no hover colour to ${id}`, async () => {
      const rest = atRest(id, surfaceAndText)
      await over(id)

      expect(surfaceAndText(id)).toBe(rest)
    })
  }

  for (const id of [
    "box-invalid",
    "box-checked",
    "box-off",
    "radio-invalid",
    "radio-checked",
    "switch-checked",
  ]) {
    it(`keeps the border on ${id} under the mouse`, async () => {
      const rest = atRest(id, border)
      await over(id)

      expect(border(id)).toBe(rest)
    })
  }
})
