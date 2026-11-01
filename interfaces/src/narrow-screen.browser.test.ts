/// <reference path="./types/css.d.ts" />

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { page, userEvent } from "vitest/browser"

import { defineLt } from "./register"
import { mount, waitForPaint } from "./testing/a11y"

import "./tokens/tokens.css"

// Every stylesheet in every component folder, so no component can be forgotten here.
import.meta.glob("./components/*/*/*.css", { eager: true })

/**
 * That the components stay within the screen on a phone.
 *
 * A component that becomes wider than the screen lets the whole page be
 * dragged sideways. It is one of the most common mistakes in a design system,
 * and it does not show in a development window 1400 pixels wide.
 *
 * The window itself is set to 320 pixels, not just a box in a wide window. A
 * dialog, a popover and a toast compute their width from the window, and sit
 * in the top layer or with `position: fixed`, where they do not make the page
 * wider but can still stick out of the screen. The test therefore checks
 * both: that the page cannot scroll sideways, and that everything visible is
 * within the window horizontally, except what is clipped on purpose. Top and
 * bottom are not checked: a page scrolls vertically.
 *
 * The text is long on purpose: it is "Order the job against Kestrel Dynamics
 * before the end of the third quarter of 2079" that breaks a button, not
 * "Order".
 */

/** The width of a small phone. */
const NARROW = 320

const LONG =
  "Order the job against Kestrel Dynamics before the end of the third quarter of 2079"

type Case = {
  markup: string
  /** What opens the component or shows the state to be checked. */
  open?: () => void | Promise<void>
  /** What must be visible after `open`, so a case does not check a closed component. */
  opened?: string
}

function element<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector)
  if (!found) throw new Error(`Missing ${selector}`)
  return found
}

/** One case per component folder, keyed by the folder's name. */
const COMPONENTS: Record<string, Case[]> = {
  accordion: [
    {
      markup: `<details class="lt-accordion" open>
        <summary>Who can take out a runner's policy for the whole of calendar year 2079?</summary>
        <p>Everyone over 18 who jacks in for a living and pays the premium every month.</p>
      </details>`,
    },
  ],
  alert: [
    {
      markup: `<div class="lt-alert" data-color="danger">
        <p class="lt-alert__title">Sector 9 is dark</p>
        <p>Crews are on the way. Try the relay again in a moment.</p>
      </div>`,
    },
  ],
  avatar: [
    {
      markup: `<span class="lt-avatar" data-size="lg" role="img" aria-label="Dead Pixel">DP</span>`,
    },
  ],
  badge: [
    {
      markup: `<span class="lt-badge" data-color="warning">Awaiting the small print from the next of kin</span>`,
    },
  ],
  breadcrumbs: [
    {
      markup: `<ol class="lt-breadcrumbs">
        <li><a href="#">Home</a></li>
        <li><a href="#">My policies and claims</a></li>
        <li><a href="#" aria-current="page">Claim AV-2079-0481</a></li>
      </ol>`,
    },
  ],
  button: [
    { markup: `<button class="lt-button">${LONG}</button>` },
    {
      markup: `<div style="white-space: nowrap">
        <button class="lt-button">${LONG}</button>
      </div>`,
    },
    {
      markup: `<button class="lt-button">Order the job now</button>
        <button class="lt-button" data-variant="secondary">Save as draft</button>`,
    },
  ],
  card: [
    {
      markup: `<div class="lt-card">
        <h3 class="lt-card__title">Claim AV-2079-0481 for a runner called Sixpence</h3>
        <p>Filed 4 March 2079. Status: denied.</p>
      </div>`,
    },
  ],
  checkbox: [
    {
      markup: `<label><input class="lt-checkbox" type="checkbox" /> I accept that floors below 12 are seasonal, and that the rent goes up with the tide</label>`,
    },
  ],
  divider: [{ markup: `<hr class="lt-divider" />` }],
  "error-text": [
    {
      markup: `<p class="lt-error-text">Enter the budget as a whole number, without spaces or the EB code</p>`,
    },
  ],
  fieldset: [
    {
      markup: `<fieldset class="lt-fieldset">
        <legend class="lt-legend">Which crews may take the job against Kestrel Dynamics in 2079?</legend>
        <label><input class="lt-radio" type="radio" name="h" /> Any crew</label>
      </fieldset>`,
    },
  ],
  "file-upload": [
    { markup: `<input class="lt-file-upload" type="file" multiple />` },
    {
      markup: `<ul class="lt-file-upload-list">
        <li>
          deck-firmware-ticket-0331-dump-before-opening-1.bin
          <button class="lt-button" data-variant="ghost" type="button">Remove deck-firmware-ticket-0331-dump-before-opening-1.bin</button>
        </li>
      </ul>`,
    },
  ],
  heading: [
    {
      markup: `<h1 class="lt-heading" data-size="xl">Runner's policies and claims for the whole of calendar year 2079</h1>`,
    },
  ],
  "help-text": [
    {
      markup: `<p class="lt-help-text">A whole number. The board approves anything under EB 5,000,000 without a meeting.</p>`,
    },
  ],
  icon: [
    {
      markup: `<button class="lt-button" type="button"><svg class="lt-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" stroke="currentColor" /></svg>${LONG}</button>`,
    },
  ],
  input: [
    { markup: `<input class="lt-input" value="${LONG}" />` },
    { markup: `<input class="lt-input" type="date" data-variant="date" />` },
  ],
  label: [
    {
      markup: `<label class="lt-label" data-required>The objective of the job, as the board wants it stated to the fixer</label>`,
    },
  ],
  link: [
    {
      markup: `<a class="lt-link" href="#">Read the small print about who can take out a runner's policy for the whole of calendar year 2079</a>`,
    },
  ],
  list: [
    {
      markup: `<ul class="lt-list">
        <li>Floor plans for every level of the target building, from the lobby to the roof</li>
        <li>Budget</li>
      </ul>`,
    },
  ],
  pagination: [
    {
      markup: `<ul class="lt-pagination">
        <li><a href="#">Previous</a></li><li><a href="#">1</a></li><li><a href="#">2</a></li>
        <li><a href="#">3</a></li><li><a href="#">4</a></li><li><a href="#">Next</a></li>
      </ul>`,
    },
  ],
  paragraph: [
    {
      markup: `<p class="lt-paragraph">The deadline is 1 March. We process the claim within four weeks, and send the answer to the next of kin.</p>`,
    },
  ],
  progress: [
    {
      markup: `<progress class="lt-progress" value="40" max="100" aria-label="Uploaded"></progress>
        <progress class="lt-progress" aria-label="Uploading"></progress>`,
    },
  ],
  radio: [
    {
      markup: `<label><input class="lt-radio" type="radio" name="r" /> I want a twelve-month lease on a dry floor for the whole of calendar year 2079</label>`,
    },
  ],
  search: [
    {
      markup: `<input class="lt-input lt-search" type="search" aria-label="Search" value="${LONG}" />`,
    },
  ],
  select: [
    {
      markup: `<select class="lt-select" aria-label="Building">
        <option>Saltline Tower</option>
        <option>Breakwater House and the dry floors of the blocks around it, from floor 12 up</option>
      </select>`,
    },
  ],
  skeleton: [{ markup: `<div class="lt-skeleton"></div>` }],
  "skip-link": [
    {
      markup: `<a class="lt-skip-link" href="#main">Skip past the navigation to the main content of this page</a>`,
      // The link is out of view until it gets focus. One real key press
      // first: a programmatic `focus()` alone sometimes gave no `:focus` in
      // Firefox in CI.
      open: async () => {
        await userEvent.tab()
        element<HTMLAnchorElement>(".lt-skip-link").focus()
      },
      opened: ".lt-skip-link:focus",
    },
  ],
  spinner: [
    {
      markup: `<span class="lt-spinner" role="status" aria-label="Loading the sector"></span>`,
    },
  ],
  "sr-only": [
    {
      markup: `<span class="lt-sr-only">${LONG}, and a long help text only screen readers hear</span>`,
    },
  ],
  switch: [
    {
      markup: `<label><input class="lt-switch" type="checkbox" role="switch" /> Send me a message three days before the walls expire</label>`,
    },
  ],
  table: [
    {
      markup: `<div class="lt-table-scroll" tabindex="0">
        <table class="lt-table">
          <thead><tr><th>Recovery reference</th><th>Recovered</th><th>Offer</th></tr></thead>
          <tbody><tr><td>LR-2079-0112</td><td>4 March 2079</td><td>EB 1,800</td></tr></tbody>
        </table>
      </div>`,
    },
  ],
  tag: [
    {
      markup: `<button class="lt-tag" data-selectable aria-pressed="true">Cutter</button>
        <button class="lt-tag" data-selectable aria-pressed="false">Worm</button>`,
    },
  ],
  textarea: [
    {
      markup: `<textarea class="lt-textarea" aria-label="Objective">${LONG}</textarea>`,
    },
  ],
  "toggle-group": [
    {
      markup: `<fieldset class="lt-toggle-group">
        <legend>View</legend>
        <label class="lt-toggle-group__option"><input type="radio" name="v" checked /> List of free floors</label>
        <label class="lt-toggle-group__option"><input type="radio" name="v" /> Tide chart</label>
      </fieldset>`,
    },
  ],
  tooltip: [
    {
      /*
       * The button is in the middle of the row. The bubble is centred over the
       * button and not moved in from the edge, so at the left edge of a phone
       * it is partly outside. That is a known limitation, described on the
       * component page, and it needs anchor positioning or JavaScript.
       */
      markup: `<div style="text-align: center">
        <span class="lt-tooltip">
          <button class="lt-button" type="button" aria-describedby="hint">Archive</button>
          <span class="lt-tooltip__bubble" role="tooltip" id="hint" style="display: block">The recovery order is moved to the archive, and can be retrieved again later</span>
        </span>
      </div>`,
    },
  ],

  "connection-status": [
    {
      markup: `<lt-connection-status></lt-connection-status>`,
      open: async () => {
        const status = element<HTMLElement & { reportFailure(): void }>(
          "lt-connection-status",
        )
        status.reportFailure()
      },
    },
  ],
  toast: [
    {
      markup: `<lt-toast></lt-toast>`,
      open: () =>
        element<HTMLElement & { show(text: string): void }>("lt-toast").show(
          `${LONG} has been received, and a fixer will answer within four hours`,
        ),
      opened: "lt-toast > *",
    },
  ],

  dialog: [
    {
      markup: `<lt-dialog open>
        <dialog class="lt-dialog" aria-labelledby="box-title" open>
          <h2 class="lt-dialog__title" id="box-title">Do you want to cancel job 222-0481 against Kestrel Dynamics before a crew takes it?</h2>
          <div class="lt-dialog__body"><p>The crew keeps the advance. This cannot be undone.</p></div>
          <form method="dialog" class="lt-dialog__footer">
            <button class="lt-button" value="withdraw">Cancel the job</button>
            <button class="lt-button" data-variant="secondary" value="cancel">Keep the job</button>
          </form>
        </dialog>
      </lt-dialog>`,
    },
  ],
  "error-summary": [
    {
      markup: `<lt-error-summary class="lt-error-summary" role="alert" tabindex="-1" data-autofocus="false">
        <h2 class="lt-error-summary__title">The order has two errors that must be fixed before you can send it</h2>
        <ul class="lt-list">
          <li><a href="#budget">Enter the budget as a whole number, without spaces or the EB code</a></li>
          <li><a href="#deadline">Choose the date in 2079 the crew must deliver by</a></li>
        </ul>
      </lt-error-summary>`,
    },
  ],
  field: [
    {
      markup: `<lt-field>
        <label class="lt-label" for="narrow-fixer">The address the board writes to the fixer at</label>
        <input class="lt-input" id="narrow-fixer" value="a.fixer.with.a.rather.long.handle@example.com" />
        <p class="lt-help-text">The board writes to the fixer, never to the crew.</p>
        <p class="lt-error-text">Enter a valid address with @ and a domain</p>
      </lt-field>`,
    },
  ],
  popover: [
    {
      markup: `<lt-popover open>
        <button class="lt-button" aria-expanded="false" aria-controls="actions">Actions</button>
        <div popover id="actions" class="lt-popover">
          <p>Mark LDG-117 returned, and charge the late fee to the runner who rented it</p>
        </div>
      </lt-popover>`,
    },
  ],
  "session-timeout": [
    {
      markup: `<lt-session-timeout warn-at="600" expires-at="900">
        <dialog class="lt-session-timeout__dialog" role="alertdialog" aria-labelledby="session-title">
          <h2 class="lt-session-timeout__title" id="session-title">Your session on the Lattice is ending, and unsaved routes will be lost</h2>
          <p class="lt-session-timeout__text">Your session on the Lattice ends in
            <span class="lt-session-timeout__count" aria-hidden="true"></span>.</p>
          <span class="lt-sr-only" role="status"></span>
          <form method="dialog" class="lt-session-timeout__actions">
            <button class="lt-button" value="extend">Stay connected</button>
            <button class="lt-button" data-variant="secondary" value="logout">Log out</button>
          </form>
        </dialog>
      </lt-session-timeout>`,
      // The warning as if time were nearly up.
      open: () =>
        element<HTMLDialogElement>(".lt-session-timeout__dialog").showModal(),
    },
  ],
  suggestion: [
    {
      markup: `<lt-suggestion>
        <label class="lt-label">Breaker</label>
        <div>
          <input class="lt-input" name="breaker" type="text" />
          <ul class="lt-suggestion__list">
            <li>Boltcutter</li>
            <li>Boltcutter, the long one with a worm built into the handle, back three days late</li>
          </ul>
          <span class="lt-sr-only" role="status"></span>
        </div>
      </lt-suggestion>`,
      open: () => {
        const field = element<HTMLInputElement>("lt-suggestion input")
        field.focus()
        field.value = "B"
        field.dispatchEvent(new InputEvent("input", { bubbles: true }))
      },
      // The component must have opened the list. A list it never recognised
      // also has no `hidden`, so it is the field that is asked.
      opened: 'lt-suggestion input[aria-expanded="true"]',
    },
  ],
  tabs: [
    {
      markup: `<lt-tabs>
        <ul class="lt-tabs__list" aria-label="Parts of the claim">
          <li><a href="#narrow-claim">The claim</a></li>
          <li><a href="#narrow-attachments">Attachments and documentation</a></li>
          <li><a href="#narrow-decision">Decision</a></li>
          <li><a href="#narrow-appeal">Appeal against the decision</a></li>
        </ul>
        <section class="lt-tabs__panel" id="narrow-claim"><h2>The claim</h2>Claim AV-2079-0481 was filed on 4 March 2079.</section>
        <section class="lt-tabs__panel" id="narrow-attachments"><h2>Attachments and documentation</h2>Two attachments.</section>
        <section class="lt-tabs__panel" id="narrow-decision"><h2>Decision</h2>Not processed yet.</section>
        <section class="lt-tabs__panel" id="narrow-appeal"><h2>Appeal against the decision</h2>No appeal.</section>
      </lt-tabs>`,
    },
  ],
}

/** The component folders, read from the test files. Each folder has one, see `check-test-files.ts`. */
const FOLDERS = Object.keys(
  import.meta.glob("./components/*/*/*.browser.test.ts"),
).map((path) => path.split("/")[3])

const CASES = Object.entries(COMPONENTS).flatMap(([folder, list]) =>
  list.map((entry, i) => [`${folder} #${i + 1}`, entry] as const),
)

describe(`the components in a window ${NARROW} pixels wide`, () => {
  beforeAll(async () => {
    defineLt()
    await page.viewport(NARROW, 640)
  })

  afterAll(async () => {
    document.body.innerHTML = ""
    // Vitest's default window, so the tests that run afterwards in the same
    // browser do not inherit the phone width.
    await page.viewport(414, 896)
  })

  it("has a case for every component folder", () => {
    expect(FOLDERS.length).toBeGreaterThan(40)
    expect(Object.keys(COMPONENTS).sort()).toEqual([...new Set(FOLDERS)].sort())
  })

  it.each(CASES)("%s stays within the window", async (_name, entry) => {
    mount(entry.markup)
    await waitForPaint()
    await entry.open?.()
    await waitForPaint()
    await waitForPaint()

    expect(window.innerWidth).toBe(NARROW)

    // The page cannot scroll sideways.
    const root = document.documentElement
    expect(
      root.scrollWidth,
      "the page is wider than the window",
    ).toBeLessThanOrEqual(root.clientWidth)

    // What was supposed to open is open.
    if (entry.opened) {
      const opened = document.querySelector(entry.opened)
      expect(opened, `${entry.opened} did not appear`).not.toBeNull()
      expect(opened?.getBoundingClientRect().width).toBeGreaterThan(0)
    }

    // And everything visible is within the window. What is fixed or in the
    // top layer, and everything inside it, does not make the page wider, so
    // the line above does not see it. The exception is what is clipped on
    // purpose: the table in its scroll container, and text only screen
    // readers hear.
    let onTop = 0
    for (const node of document.querySelectorAll("body *")) {
      if (node.closest(".lt-table-scroll, .lt-sr-only")) continue
      const style = getComputedStyle(node)
      if (style.visibility === "hidden") continue
      const box = node.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) continue
      const who = `${node.tagName.toLowerCase()}.${node.className}`
      expect(box.left, `${who} on the left`).toBeGreaterThanOrEqual(-0.5)
      expect(box.right, `${who} on the right`).toBeLessThanOrEqual(NARROW + 0.5)
      if (
        node.closest(":modal, :popover-open") ||
        getComputedStyle(node).position === "fixed"
      )
        onTop += 1
    }
    if (
      [
        "dialog",
        "popover",
        "toast",
        "session-timeout",
        "connection-status",
      ].some((m) => _name.startsWith(`${m} `))
    )
      expect(onTop, "did not find the open element").toBeGreaterThan(0)

    for (const dialog of document.querySelectorAll("dialog")) dialog.close()
  })
})
