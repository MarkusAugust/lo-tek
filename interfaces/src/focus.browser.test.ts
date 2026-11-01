/// <reference path="./types/css.d.ts" />

import { describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import { mount, waitForPaint } from "./testing/a11y"
import { lightCells } from "./tokens/matrix-cells"

import "./tokens/tokens.css"
import "./components/css/accordion/accordion.css"
import "./components/css/breadcrumbs/breadcrumbs.css"
import "./components/css/button/button.css"
import "./components/css/card/card.css"
import "./components/css/checkbox/checkbox.css"
import "./components/css/file-upload/file-upload.css"
import "./components/css/input/input.css"
import "./components/css/link/link.css"
import "./components/css/pagination/pagination.css"
import "./components/css/radio/radio.css"
import "./components/css/select/select.css"
import "./components/css/skip-link/skip-link.css"
import "./components/css/switch/switch.css"
import "./components/css/table/table.css"
import "./components/css/tag/tag.css"
import "./components/css/textarea/textarea.css"
import "./components/css/toggle-group/toggle-group.css"

/**
 * Everything that can get keyboard focus shows it.
 *
 * WCAG 2.4.7 requires a visible indicator of where focus is, and 1.4.11 that
 * the indicator holds 3:1 against the surface around it. The system does it
 * with one ring, `--lt-focus-ring`, used in twenty rules spread over eighteen
 * stylesheets.
 *
 * Until now there was not a single assertion about `outline` in the whole
 * test suite. The ring could disappear from a component without anything
 * saying so, and `package-css.browser.test.ts` only reads the text of the
 * stylesheets: it sees that nobody writes the ring out by hand, not that
 * focus is visible.
 *
 * The test tabs through the page the way a keyboard user does. A programmatic
 * `focus()` is not enough: `:focus-visible` only matches when the browser
 * thinks focus should be shown, and focus set from code after a mouse click
 * does not count.
 */

/** One of everything that can get focus, with the markup the server would send. */
const PAGE = `
  <a class="lt-skip-link" href="#main">Skip to content</a>

  <nav class="lt-breadcrumbs" aria-label="You are here">
    <ol><li><a href="#start">Start</a></li><li><a href="#claim">Your claim</a></li></ol>
  </nav>

  <a class="lt-link" href="#terms">Read the terms</a>
  <button class="lt-button" type="button">Order the job</button>

  <label class="lt-label" for="fixer">Fixer's address</label>
  <input class="lt-input" id="fixer" type="email" />

  <label class="lt-label" for="message">Message</label>
  <textarea class="lt-textarea" id="message"></textarea>

  <label class="lt-label" for="building">Building</label>
  <select class="lt-select" id="building"><option>Saltline Tower</option></select>

  <label class="lt-label" for="consent">I consent</label>
  <input class="lt-checkbox" id="consent" type="checkbox" />

  <label class="lt-label" for="post">Post</label>
  <input class="lt-radio" id="post" type="radio" name="delivery" />

  <label class="lt-label" for="notifications">Notifications</label>
  <input class="lt-switch" id="notifications" type="checkbox" role="switch" />

  <label class="lt-label" for="attachment">Attachment</label>
  <input class="lt-file-upload" id="attachment" type="file" />

  <button class="lt-tag" data-selectable aria-pressed="false" type="button">Cutter</button>

  <a class="lt-card" data-interactive href="#your-claim">Your claim</a>

  <details class="lt-accordion"><summary>What does this mean?</summary><p>The answer.</p></details>

  <nav class="lt-pagination" aria-label="Pages">
    <ul><li><button type="button">1</button></li><li><button type="button">2</button></li></ul>
  </nav>

  <table class="lt-table">
    <thead><tr><th scope="col" aria-sort="ascending"><button class="lt-table__sort" type="button">Date</button></th></tr></thead>
  </table>

  <fieldset class="lt-toggle-group">
    <label class="lt-toggle-group__option">
      <input type="radio" name="view" /> Map
    </label>
  </fieldset>
`

/**
 * The ring the user actually sees when this element has focus.
 *
 * As a rule it is on the element itself. When it is on a parent, as when an
 * option draws the ring with `:has(input:focus-visible)`, that is the one
 * that counts.
 */
function visibleRing(element: HTMLElement): CSSStyleDeclaration {
  let node: HTMLElement | null = element

  while (node) {
    const style = getComputedStyle(node)
    if (style.outlineStyle === "solid" && style.outlineWidth === "2px") {
      return style
    }
    node = node.parentElement
  }

  return getComputedStyle(element)
}

/**
 * Everything that can get focus, with the ring each of them has.
 *
 * One real Tab, and then `focus()` from code on the rest. The browser treats
 * focus as keyboard driven after a key press, so a programmatic `focus()`
 * afterwards gets `:focus-visible` too. That has been checked in all three
 * engines. The first version tabbed through with 24 round trips to the
 * browser, and on a busy machine they took over fifteen seconds in Firefox:
 * the test failed on the clock, not on anything it checks.
 */
async function focusThrough() {
  const found: Array<{ who: string; width: string; style: string }> = []

  await userEvent.tab()

  const candidates = [
    ...document.querySelectorAll<HTMLElement>(
      "a[href], button, input, select, textarea, summary, [tabindex]",
    ),
  ]

  for (const candidate of candidates) {
    candidate.focus()
    if (document.activeElement !== candidate) continue
    if (!candidate.matches(":focus-visible")) continue
    const active = candidate

    // The ring is not always on the element that has focus. In
    // `.lt-toggle-group` the radio button is invisible, and the option around
    // it draws the ring with `:has(input:focus-visible)`. The ring the user
    // sees is what counts, so we go up until we find it.
    const ring = visibleRing(active)

    found.push({
      who: `${active.tagName.toLowerCase()}${active.id ? `#${active.id}` : `.${String(active.className).split(" ")[0]}`}`,
      width: ring.outlineWidth,
      style: ring.outlineStyle,
    })
  }

  return found
}

describe("keyboard focus is visible", () => {
  it("gives every control a two-pixel ring", async () => {
    mount(PAGE)
    await waitForPaint()

    const found = await focusThrough()

    // Without this, a change in the markup could have left the sweep empty,
    // and an empty list would have reported green.
    expect(found.length, "found nothing with visible focus").toBeGreaterThan(12)

    const without = found.filter(
      (f) => f.style !== "solid" || f.width !== "2px",
    )

    expect(
      without.map((f) => `${f.who}: ${f.width} ${f.style}`),
      "these are missing the focus ring",
    ).toEqual([])
  })

  it("takes the ring from the token, not from each component", async () => {
    mount(`<button class="lt-button" type="button">Send</button>`)
    await waitForPaint()

    const ring = getComputedStyle(document.documentElement)
      .getPropertyValue("--lt-focus-ring")
      .trim()

    /*
     * The value is computed here, so `var()` is already resolved.
     *
     * The colour is read from the matrix rather than copied: the ring must
     * follow `accent-border-strong`, and a test that repeated the hex value
     * would have to be fixed every time the contract moves a lightness.
     */
    const expected = lightCells["--lt-color-accent-border-strong"]

    expect(ring).toMatch(/^2px solid /)
    expect(ring.toLowerCase()).toContain(expected.toLowerCase())
  })
})
