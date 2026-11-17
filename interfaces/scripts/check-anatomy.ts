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

if (errors.length) {
  console.error(`✗ The anatomies:\n  ${errors.join("\n  ")}`)
  process.exit(1)
}
console.log(`✓ The anatomies give the page's markup in ${cases.length} cases.`)
