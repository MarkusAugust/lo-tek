/**
 * Checks the anatomies in the manifest by writing them with
 * `renderAnatomy()`, the way a design tool or a server would.
 *
 * Each case is the markup on the component page, written here by hand, and
 * the anatomy must give exactly that. The expected markup is not computed:
 * it is what the page tells a reader to write.
 *
 * Run with: bun scripts/check-anatomy.ts, or as part of `bun run build`.
 */

import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { type AnatomyInstance, renderAnatomy } from "../src/anatomy/index.js"
import type { Manifest } from "../src/vocabulary/types.js"
import { allBlocks, type RecipePage, recipePage } from "./recipes.js"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const manifest = (await Bun.file(
  join(ROOT, "manifest/manifest.json"),
).json()) as Manifest

type Case = {
  builder: string
  instance: AnatomyInstance
  /** The markup from the component page. */
  expected: string
}

const cases: Case[] = [
  {
    builder: "button",
    instance: { id: "order", holes: { label: "Order the job" } },
    expected: `<button class="lt-button">Order the job</button>`,
  },
  {
    builder: "checkbox",
    instance: {
      id: "lease",
      holes: {
        control: "seasonal",
        name: "seasonal",
        label: "I accept that floors below 12 are seasonal.",
      },
    },
    expected: `<div class="lt-checkbox-row"><input class="lt-checkbox" type="checkbox" id="seasonal" name="seasonal"><label class="lt-label" for="seasonal">I accept that floors below 12 are seasonal.</label></div>`,
  },
  // The dialog as a tool makes it: in <lt-dialog>, so the server opens it,
  // with the body and an empty footer. The page's own id and data-on are
  // the app's, not the component's.
  {
    builder: "dialog",
    instance: {
      id: "confirm",
      holes: { title: "Cancel job 222-0481?" },
      content: {
        body: "<p>The crew keeps the advance. This cannot be undone.</p>",
      },
    },
    expected: `<lt-dialog><dialog class="lt-dialog" aria-labelledby="confirm-title-id"><h2 class="lt-dialog__title" id="confirm-title-id">Cancel job 222-0481?</h2><div class="lt-dialog__body"><p>The crew keeps the advance. This cannot be undone.</p></div><form class="lt-dialog__footer" method="dialog"></form></dialog></lt-dialog>`,
  },
  // The smallest: the title alone, and the dialog the app opens itself.
  {
    builder: "dialog",
    instance: {
      id: "confirm",
      holes: { "title-id": "confirm-title", title: "Cancel job 222-0481?" },
      parts: { host: false, body: false, footer: false },
    },
    expected: `<dialog class="lt-dialog" aria-labelledby="confirm-title"><h2 class="lt-dialog__title" id="confirm-title">Cancel job 222-0481?</h2></dialog>`,
  },
  // With the header and the subtitle, as the page shows them.
  {
    builder: "dialog",
    instance: {
      id: "job",
      holes: {
        "title-id": "job-title",
        title: "Recover the courier's bag",
        subtitle: "Clean, before the deadline",
      },
      parts: { host: false, header: true, subtitle: true, footer: false },
      content: { body: "<p>The bag is in Kabuki.</p>" },
    },
    expected: `<dialog class="lt-dialog" aria-labelledby="job-title"><div class="lt-dialog__header"><h2 class="lt-dialog__title" id="job-title">Recover the courier's bag</h2><p class="lt-dialog__subtitle">Clean, before the deadline</p></div><div class="lt-dialog__body"><p>The bag is in Kabuki.</p></div></dialog>`,
  },
  // The page says the subtitle belongs in the header: without it, it goes.
  {
    builder: "dialog",
    instance: {
      id: "job",
      holes: { "title-id": "job-title", title: "A", subtitle: "B" },
      parts: { host: false, subtitle: true, body: false, footer: false },
    },
    expected: `<dialog class="lt-dialog" aria-labelledby="job-title"><h2 class="lt-dialog__title" id="job-title">A</h2></dialog>`,
  },
  // The tabs as the Kotlin recipe on the page renders them: the panels get
  // their ids from the id and the keys, and the heading in each panel says
  // the same as its tab.
  {
    builder: "tabs",
    instance: {
      id: "claim",
      repeats: { tab: ["claim", "attachments"] },
      holes: {
        tabs: "claim-tabs",
        label: "Parts of the claim",
        title: { claim: "Claim", attachments: "Attachments" },
      },
      content: {
        panel: {
          claim: "<p>Claim AV-2079-0481 was filed on 4 March 2079.</p>",
          attachments: "<p>Three attachments have been received.</p>",
        },
      },
    },
    expected: `<lt-tabs><ul class="lt-tabs__list" aria-label="Parts of the claim"><li><a href="#claim-tabs-claim">Claim</a></li><li><a href="#claim-tabs-attachments">Attachments</a></li></ul><section id="claim-tabs-claim" class="lt-tabs__panel"><h2 id="claim-tabs-claim-heading">Claim</h2><p>Claim AV-2079-0481 was filed on 4 March 2079.</p></section><section id="claim-tabs-attachments" class="lt-tabs__panel"><h2 id="claim-tabs-attachments-heading">Attachments</h2><p>Three attachments have been received.</p></section></lt-tabs>`,
  },
  // The sortable table on the page, without data-align. Each column heading
  // chooses for itself: sorted by a button, or plain.
  {
    builder: "table",
    instance: {
      id: "orders",
      repeats: { column: ["recovered", "offer"], row: ["0113", "0112"] },
      choices: {
        "row-heading": "sortable",
        heading: { recovered: "sortable", offer: "plain" },
      },
      settings: { heading: { recovered: { direction: "descending" } } },
      holes: {
        caption: "Recovery orders",
        "row-heading": "Reference",
        heading: { recovered: "Recovered", offer: "Offer" },
        "row-name": { "0113": "LR-2079-0113", "0112": "LR-2079-0112" },
        cell: {
          "0113": { recovered: "4 April", offer: "EB 2,750" },
          "0112": { recovered: "4 March", offer: "EB 7,150" },
        },
      },
    },
    expected: `<table class="lt-table"><caption>Recovery orders</caption><thead><tr><th scope="col"><button class="lt-table__sort" type="button">Reference</button></th><th aria-sort="descending" scope="col"><button class="lt-table__sort" type="button">Recovered</button></th><th scope="col">Offer</th></tr></thead><tbody><tr><th scope="row">LR-2079-0113</th><td>4 April</td><td>EB 2,750</td></tr><tr><th scope="row">LR-2079-0112</th><td>4 March</td><td>EB 7,150</td></tr></tbody></table>`,
  },
  // A wide table in the box that scrolls, sorted by a link without
  // JavaScript.
  {
    builder: "table",
    instance: {
      id: "orders",
      parts: { scroll: true },
      repeats: { column: ["recovered"], row: ["0113"] },
      choices: { heading: { recovered: "link" } },
      holes: {
        region: "Recovery orders",
        caption: "Recovery orders",
        "row-heading": "Reference",
        heading: { recovered: "Recovered" },
        sort: { recovered: "?sort=recovered" },
        "row-name": { "0113": "LR-2079-0113" },
        cell: { "0113": { recovered: "4 April" } },
      },
    },
    expected: `<div class="lt-table-scroll" tabindex="0" role="region" aria-label="Recovery orders"><table class="lt-table"><caption>Recovery orders</caption><thead><tr><th scope="col">Reference</th><th scope="col"><a class="lt-table__sort" href="?sort=recovered">Recovered</a></th></tr></thead><tbody><tr><th scope="row">LR-2079-0113</th><td>4 April</td></tr></tbody></table></div>`,
  },
  // The field from the help text page, in the <div> that makes it one box,
  // without the page's inputmode: the builder function writes type, and the
  // name the form sends.
  {
    builder: "field",
    instance: {
      id: "budget",
      options: { help: true },
      holes: {
        control: "budget",
        name: "budget",
        label: "Budget",
        help: "In EB, without the code. The crew sees it.",
      },
    },
    expected: `<div><label class="lt-label" for="budget">Budget</label><input class="lt-input" type="text" id="budget" aria-describedby="budget-help" name="budget"><p class="lt-help-text" id="budget-help">In EB, without the code. The crew sees it.</p></div>`,
  },
  // An invalid field with a text area, as the field page lists what the
  // wiring must be: aria-invalid, and aria-describedby on both texts.
  {
    builder: "field",
    instance: {
      id: "fixer",
      options: { help: true, error: true, invalid: true },
      choices: { control: "textarea" },
      holes: {
        control: "fixer",
        name: "fixer",
        label: "Fixer's address",
        help: "The board writes to the fixer, never to the crew.",
        error: "Enter a valid address.",
      },
    },
    expected: `<div><label class="lt-label" for="fixer">Fixer's address</label><textarea class="lt-textarea" id="fixer" name="fixer" aria-invalid="true" aria-describedby="fixer-help fixer-error" data-state="invalid"></textarea><p class="lt-help-text" id="fixer-help">The board writes to the fixer, never to the crew.</p><p class="lt-error-text" id="fixer-error">Enter a valid address.</p></div>`,
  },
  // A select, with the options the page has: a placeholder that sends
  // nothing, and options that send their text.
  {
    builder: "field",
    instance: {
      id: "building",
      choices: { control: "select" },
      repeats: { option: ["choose", "breakwater", "saltline", "lantern"] },
      holes: {
        control: "building",
        name: "building",
        label: "Building",
        "option-value": { choose: "" },
        "option-selected": { saltline: true },
        "option-label": {
          choose: "Choose a building",
          breakwater: "Breakwater House",
          saltline: "Saltline Tower",
          lantern: "The Lantern Block",
        },
      },
    },
    expected: `<div><label class="lt-label" for="building">Building</label><select class="lt-select" id="building" name="building"><option value="">Choose a building</option><option>Breakwater House</option><option selected>Saltline Tower</option><option>The Lantern Block</option></select></div>`,
  },
  {
    builder: "badge",
    instance: {
      id: "b",
      holes: { label: "Paid" },
      options: { color: "success" },
    },
    expected: `<span class="lt-badge" data-color="success">Paid</span>`,
  },
  {
    builder: "divider",
    instance: { id: "d", options: { variant: "strong" } },
    expected: `<hr class="lt-divider" data-variant="strong">`,
  },
  {
    builder: "heading",
    instance: {
      id: "h",
      holes: { text: "Runner's policy terms" },
      tags: { level: "h1" },
      options: { size: "mega" },
    },
    expected: `<h1 class="lt-heading" data-size="mega">Runner's policy terms</h1>`,
  },
  {
    builder: "paragraph",
    instance: {
      id: "p",
      holes: { text: "Everything a runner's policy covers." },
      options: { variant: "lead" },
    },
    expected: `<p class="lt-paragraph" data-variant="lead">Everything a runner's policy covers.</p>`,
  },
  {
    builder: "link",
    instance: { id: "l", holes: { href: "#", text: "Read the small print" } },
    expected: `<a class="lt-link" href="#">Read the small print</a>`,
  },
  {
    builder: "link",
    instance: {
      id: "l",
      holes: { href: "#", text: "See payout statement" },
      choices: { state: "disabled" },
    },
    expected: `<a class="lt-link" role="link" tabindex="0" aria-disabled="true">See payout statement</a>`,
  },
  {
    builder: "skipLink",
    instance: {
      id: "s",
      holes: { target: "#main-content", text: "Skip to main content" },
    },
    expected: `<a class="lt-skip-link" href="#main-content">Skip to main content</a>`,
  },
  {
    builder: "spinner",
    instance: { id: "s", options: { size: "small" } },
    expected: `<span class="lt-spinner" data-size="small" aria-hidden="true"></span>`,
  },
  {
    builder: "skeleton",
    instance: { id: "s", options: { variant: "circle" } },
    expected: `<div class="lt-skeleton" data-variant="circle" aria-hidden="true"></div>`,
  },
  {
    builder: "srOnly",
    instance: { id: "s", holes: { text: " the report from 4 March" } },
    expected: `<span class="lt-sr-only"> the report from 4 March</span>`,
  },
  {
    builder: "icon",
    instance: { id: "i", content: { paths: '<path d="M12 5v14M5 12h14" />' } },
    expected: `<svg class="lt-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14" /></svg>`,
  },
  {
    builder: "progress",
    instance: {
      id: "p",
      holes: { label: "Subscription CM-2079-0090" },
      options: {
        value: 27,
        max: 30,
        valueText: "Your walls expire in 3 days.",
      },
    },
    expected: `<progress class="lt-progress" value="27" max="30" aria-label="Subscription CM-2079-0090" aria-valuetext="Your walls expire in 3 days."></progress>`,
  },
  {
    builder: "tag",
    instance: {
      id: "t",
      holes: { text: "worm" },
      options: { variant: "filled" },
    },
    expected: `<span class="lt-tag" data-variant="filled">worm</span>`,
  },
  {
    builder: "tag",
    instance: {
      id: "t",
      holes: { text: "Cutter", pressed: "true" },
      choices: { kind: "selectable" },
    },
    expected: `<button class="lt-tag" data-selectable aria-pressed="true" type="button">Cutter</button>`,
  },
  {
    builder: "alert",
    instance: {
      id: "a",
      holes: { title: "Sector 9 is dark" },
      content: { message: "<p>Crews are on the way.</p>" },
      parts: { title: true },
      options: { color: "danger" },
    },
    expected: `<div class="lt-alert" data-color="danger"><p class="lt-alert__title">Sector 9 is dark</p><p>Crews are on the way.</p></div>`,
  },
  {
    builder: "card",
    instance: {
      id: "c",
      holes: { title: "Claim AV-2079-0481" },
      content: { body: "<p>Claim denied. Black ICE is an act of God.</p>" },
      options: { variant: "filled" },
    },
    expected: `<div class="lt-card" data-variant="filled"><h3 class="lt-card__title">Claim AV-2079-0481</h3><p>Claim denied. Black ICE is an act of God.</p></div>`,
  },
  {
    builder: "accordion",
    instance: {
      id: "a",
      holes: { summary: "How long does a claim take?", open: true },
      content: { content: "<p>We process a claim within three weeks.</p>" },
    },
    expected: `<details class="lt-accordion" open><summary>How long does a claim take?</summary><div class="lt-accordion__content"><p>We process a claim within three weeks.</p></div></details>`,
  },
  {
    builder: "list",
    instance: {
      id: "l",
      tags: { list: "ol" },
      repeats: { item: ["objective", "budget"] },
      content: {
        item: { objective: "State the objective", budget: "Set the budget" },
      },
    },
    expected: `<ol class="lt-list"><li>State the objective</li><li>Set the budget</li></ol>`,
  },
  {
    builder: "avatar",
    instance: {
      id: "a",
      holes: { initials: "DP", beside: true },
      options: { size: "small" },
    },
    expected: `<span class="lt-avatar" data-size="small" aria-hidden="true">DP</span>`,
  },
  {
    builder: "avatar",
    instance: {
      id: "a",
      choices: { kind: "stack" },
      repeats: { person: ["dp", "nv"] },
      holes: { initials: { dp: "DP", nv: "NV" }, beside: true },
      options: { size: "small" },
    },
    expected: `<ul class="lt-avatar-stack"><li><span class="lt-avatar" data-size="small" aria-hidden="true">DP</span></li><li><span class="lt-avatar" data-size="small" aria-hidden="true">NV</span></li></ul>`,
  },
  {
    builder: "radio",
    instance: {
      id: "lease",
      repeats: { option: ["1", "6"] },
      settings: { legend: { required: "symbol" } },
      holes: {
        legend: "Lease length",
        name: "lease",
        control: { "1": "lease-1", "6": "lease-6" },
        value: { "1": "1", "6": "6" },
        label: { "1": "One month", "6": "Six months" },
        checked: { "1": true },
      },
    },
    expected: `<fieldset class="lt-fieldset"><legend class="lt-legend" data-required="symbol">Lease length</legend><div class="lt-radio-row"><input class="lt-radio" type="radio" id="lease-1" name="lease" value="1" checked><label class="lt-label" for="lease-1">One month</label></div><div class="lt-radio-row"><input class="lt-radio" type="radio" id="lease-6" name="lease" value="6"><label class="lt-label" for="lease-6">Six months</label></div></fieldset>`,
  },
  {
    builder: "fieldset",
    instance: {
      id: "crew",
      settings: { legend: { required: "symbol" } },
      holes: { legend: "Who takes the job?" },
      content: { content: "<p>The fields.</p>" },
    },
    expected: `<fieldset class="lt-fieldset"><legend class="lt-legend" data-required="symbol">Who takes the job?</legend><p>The fields.</p></fieldset>`,
  },
  {
    builder: "switch",
    instance: {
      id: "renew",
      holes: {
        control: "auto-renew",
        name: "auto-renew",
        label: "Auto-renew",
        checked: true,
      },
    },
    expected: `<div class="lt-switch-row"><input class="lt-switch" type="checkbox" role="switch" id="auto-renew" name="auto-renew" checked><label class="lt-label" for="auto-renew">Auto-renew</label></div>`,
  },
  {
    builder: "search",
    instance: {
      id: "s",
      holes: {
        control: "search",
        name: "q",
        label: "Search breakers",
        placeholder: "Search breakers",
        button: "Search",
      },
    },
    expected: `<form class="lt-search-row" role="search"><label class="lt-label lt-sr-only" for="search">Search breakers</label><input class="lt-input lt-search" type="search" id="search" name="q" placeholder="Search breakers"><button class="lt-button" type="submit">Search</button></form>`,
  },
  {
    builder: "toggleGroup",
    instance: {
      id: "v",
      repeats: { option: ["dry", "all"] },
      holes: {
        legend: "View",
        name: "view",
        value: { dry: "dry", all: "all" },
        label: { dry: " Dry", all: " All" },
        checked: { dry: true },
      },
    },
    expected: `<fieldset class="lt-toggle-group"><legend class="lt-sr-only">View</legend><label class="lt-toggle-group__option"><input type="radio" name="view" value="dry" checked> Dry</label><label class="lt-toggle-group__option"><input type="radio" name="view" value="all"> All</label></fieldset>`,
  },
  // The file upload page's field, in the field's <div>, with the name the form sends.
  {
    builder: "field",
    instance: {
      id: "fw",
      options: { help: true },
      choices: { control: "file" },
      settings: { control: { multiple: true, accept: ".bin" } },
      holes: {
        control: "firmware",
        name: "firmware",
        label: "Upload firmware",
        help: "Deck firmware (.bin, up to 64 MB). Dump it before I open anything.",
      },
    },
    expected: `<div><label class="lt-label" for="firmware">Upload firmware</label><input class="lt-file-upload" type="file" id="firmware" multiple accept=".bin" aria-describedby="firmware-help" name="firmware"><p class="lt-help-text" id="firmware-help">Deck firmware (.bin, up to 64 MB). Dump it before I open anything.</p></div>`,
  },
  {
    builder: "breadcrumbs",
    instance: {
      id: "b",
      repeats: { step: ["home", "claims"] },
      holes: {
        label: "You are here",
        href: { home: "#", claims: "#" },
        text: { home: "Home", claims: "My claims" },
        "current-href": "#",
        current: "Claim AV-2079-0481",
      },
    },
    expected: `<nav aria-label="You are here"><ol class="lt-breadcrumbs"><li><a href="#">Home</a></li><li><a href="#">My claims</a></li><li><a href="#" aria-current="page">Claim AV-2079-0481</a></li></ol></nav>`,
  },
  {
    builder: "pagination",
    instance: {
      id: "p",
      repeats: { page: ["1", "2", "3", "gap", "9"] },
      choices: { page: { "2": "current", gap: "gap" } },
      holes: {
        label: "Pagination",
        href: { "1": "#", "2": "#", "3": "#", "9": "#" },
        name: { "1": "Page 1", "2": "Page 2", "3": "Page 3", "9": "Page 9" },
        number: { "1": "1", "2": "2", "3": "3", "9": "9" },
        gap: "…",
        "previous-href": "#",
        previous: "Previous",
        "previous-name": "Previous page",
        "next-href": "#",
        next: "Next",
        "next-name": "Next page",
      },
    },
    expected: `<nav aria-label="Pagination"><ul class="lt-pagination"><li><a href="#" aria-label="Previous page">Previous</a></li><li><a href="#" aria-label="Page 1">1</a></li><li><a href="#" aria-label="Page 2" aria-current="page">2</a></li><li><a href="#" aria-label="Page 3">3</a></li><li><span class="lt-pagination__gap">…</span></li><li><a href="#" aria-label="Page 9">9</a></li><li><a href="#" aria-label="Next page">Next</a></li></ul></nav>`,
  },
  {
    builder: "steps",
    instance: {
      id: "s",
      repeats: { step: ["site", "survey", "walls", "payment"] },
      choices: { step: { site: "done", survey: "done", walls: "current" } },
      holes: {
        label: "Order",
        href: { site: "#", survey: "#" },
        text: {
          site: "Site",
          survey: "Survey",
          walls: "Walls",
          payment: "Payment",
        },
      },
    },
    expected: `<ol class="lt-steps" aria-label="Order"><li><a href="#">Site</a></li><li><a href="#">Survey</a></li><li aria-current="step">Walls</li><li>Payment</li></ol>`,
  },
  {
    builder: "tooltip",
    instance: {
      id: "t",
      settings: { button: { variant: "ghost" } },
      holes: {
        bubble: "appraise-hint",
        label: "Appraise",
        tip: "All chrome is appraised at street value",
      },
    },
    expected: `<span class="lt-tooltip"><button class="lt-button" data-variant="ghost" type="button" aria-describedby="appraise-hint">Appraise</button><span class="lt-tooltip__bubble" role="tooltip" id="appraise-hint">All chrome is appraised at street value</span></span>`,
  },
  // The page's own id is the app's.
  {
    builder: "toast",
    instance: { id: "messages" },
    expected: `<lt-toast class="lt-toast" role="status" aria-live="polite" aria-atomic="false" data-ignore-morph></lt-toast>`,
  },
  {
    builder: "connectionStatus",
    instance: { id: "c" },
    expected: `<lt-connection-status class="lt-connection-status" role="status" aria-live="polite" data-ignore-morph></lt-connection-status>`,
  },
]

/**
 * The markup with the attributes of each tag in alphabetical order. HTML
 * does not care about the order, so a case can be written as the page has
 * it.
 */
const sorted = (html: string) =>
  html.replace(
    /<([a-z][\w-]*)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*>/g,
    (_, tag, rest: string) => {
      const attributes = rest.match(/[\w:-]+(?:="[^"]*")?/g) ?? []
      return `<${tag}${attributes
        .sort()
        .map((a) => ` ${a}`)
        .join("")}>`
    },
  )

const errors: string[] = []

// The comparison itself: the order does not count, a value or a missing
// attribute does.
if (sorted('<a href="/x" class="y">') !== sorted('<a class="y" href="/x">'))
  errors.push("the comparison counts the order of the attributes")
for (const other of [
  '<a class="y" href="/z">',
  '<a class="y">',
  '<b class="y" href="/x">',
])
  if (sorted(other) === sorted('<a class="y" href="/x">'))
    errors.push(`the comparison takes ${other} for <a class="y" href="/x">`)
for (const c of cases) {
  let written: string
  try {
    written = renderAnatomy(manifest, c.builder, c.instance)
  } catch (error) {
    errors.push(
      `${c.builder}: ${error instanceof Error ? error.message : error}`,
    )
    continue
  }
  if (sorted(written) !== sorted(c.expected))
    errors.push(
      `${c.builder}: the anatomy gives\n    ${written || "(nothing)"}\n  and the page has\n    ${c.expected}`,
    )
}

/*
 * The page is the witness for the structure. What an anatomy writes,
 * reduced to the elements with a LO-TEK class and LO-TEK's own elements,
 * must stand in an example on the component page with the same elements
 * inside the same ones. Elements without a class, as a <div> around a
 * field, do not count, and their children take their place. Every
 * alternative of every choice is tried, so a structure only a choice
 * reaches is held to the page too.
 */
type Tree = { name: string; children: Tree[] }

const VOID_TAGS = new Set([
  "area",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
])

/** The elements with a LO-TEK class or tag, as nested trees: "tag.class". */
function reduced(html: string): Tree[] {
  const root: Tree = { name: "", children: [] }
  const stack: { tag: string; tree: Tree; kept: boolean }[] = [
    { tag: "", tree: root, kept: true },
  ]
  const clean = html.replace(/<!--[\s\S]*?-->/g, "")
  for (const m of clean.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
    const [, closing, rawTag, attributes, selfClosing] = m
    const tag = rawTag.toLowerCase()
    if (closing) {
      const at = stack.map((e) => e.tag).lastIndexOf(tag)
      if (at > 0) stack.length = at
      continue
    }
    const classes = (attributes.match(/\bclass="([^"]*)"/)?.[1] ?? "")
      .split(/\s+/)
      .filter((c) => c.startsWith("lt-"))
      .sort()
    const kept = tag.startsWith("lt-") || classes.length > 0
    const parent = [...stack].reverse().find((e) => e.kept)?.tree ?? root
    const tree: Tree = { name: [tag, ...classes].join("."), children: [] }
    if (kept) parent.children.push(tree)
    if (!VOID_TAGS.has(tag) && !selfClosing)
      stack.push({ tag, tree: kept ? tree : parent, kept })
  }
  return root.children
}

/** Every element in the trees, with the trees under it. */
const everything = (trees: Tree[]): Tree[] =>
  trees.flatMap((t) => [t, ...everything(t.children)])

/** Whether `want` stands in `have`: same name, its children inside, in order. */
function embeds(want: Tree, have: Tree): boolean {
  if (want.name !== have.name) return false
  let from = 0
  const below = everything(have.children)
  for (const child of want.children) {
    const at = below.slice(from).findIndex((t) => embeds(child, t))
    if (at < 0) return false
    from += at + 1
  }
  return true
}

/** Whether every tree stands in one example, in order. */
const onPage = (want: Tree[], examples: string[]) =>
  examples.some((html) => {
    const all = everything(reduced(html))
    let from = 0
    for (const tree of want) {
      const at = all.slice(from).findIndex((t) => embeds(tree, t))
      if (at < 0) return false
      from += at + 1
    }
    return true
  })

// The guard itself: a dialog with its title moved out is not on the page.
{
  const examples = [
    `<dialog class="lt-dialog"><h2 class="lt-dialog__title">A</h2></dialog>`,
  ]
  if (
    !onPage(
      reduced(
        `<dialog class="lt-dialog"><h2 class="lt-dialog__title">A</h2></dialog>`,
      ),
      examples,
    )
  )
    errors.push("the page guard does not find a dialog that is on the page")
  if (
    onPage(
      reduced(
        `<h2 class="lt-dialog__title">A</h2><dialog class="lt-dialog"></dialog>`,
      ),
      examples,
    )
  )
    errors.push("the page guard finds a dialog with its title moved out")
}

/** The examples on the page a builder function is documented on. */
function examplesFor(docs: string | undefined): string[] {
  const slug = docs?.match(/\/components\/([^/]+)\/?$/)?.[1]
  if (!slug) return []
  const page: RecipePage = recipePage(slug)
  return [
    ...page.examples.map((e) => e.code),
    ...allBlocks(page, "html"),
    ...allBlocks(page, "tsx"),
    ...allBlocks(page, "astro"),
  ]
}

for (const b of manifest.builders) {
  if (!b.anatomy) continue
  // The builder function's page, and the pages of the builder functions
  // its anatomy takes from, as the file upload's for the field.
  const sources = new Set(
    (JSON.stringify(b.anatomy).match(/"from":\[[^\]]*\]/g) ?? []).flatMap(
      (list) => [...list.matchAll(/"([A-Za-z]+)[."]/g)].map((m) => m[1]),
    ),
  )
  const examples = [b.name, ...sources]
    .filter((name) => name !== "from")
    .flatMap((name) =>
      examplesFor(manifest.builders.find((x) => x.name === name)?.docs),
    )
  // Every alternative of every choice in the anatomy.
  const choicesIn = (value: unknown): [string, string][] => {
    if (value === null || typeof value !== "object") return []
    const node = value as { name?: string; oneOf?: Record<string, unknown> }
    const own: [string, string][] = node.oneOf
      ? Object.keys(node.oneOf).map((a) => [node.name ?? "", a])
      : []
    return [...own, ...Object.values(value).flatMap(choicesIn)]
  }
  const choices = choicesIn(b.anatomy)
  for (const [choice, alternative] of [["", ""], ...choices]) {
    const holes: Record<string, unknown> = {}
    for (const [name, hole] of Object.entries(b.anatomy.holes))
      if (hole.example !== undefined && hole.content !== "free")
        holes[name] = hole.example
    const instance = {
      id: "c1",
      holes: holes as Record<string, string>,
      ...(choice ? { choices: { [choice]: alternative } } : {}),
    }
    let html = ""
    try {
      html = renderAnatomy(manifest, b.name, instance)
    } catch {
      continue
    }
    if (!onPage(reduced(html), examples))
      errors.push(
        `${b.name}${choice ? ` with ${choice} = ${alternative}` : ""}: the structure is in no example on its page:\n    ${html}`,
      )
  }
}

if (errors.length) {
  console.error(`✗ The anatomies:\n  ${errors.join("\n  ")}`)
  process.exit(1)
}
console.log(`✓ The anatomies give the page's markup in ${cases.length} cases.`)
