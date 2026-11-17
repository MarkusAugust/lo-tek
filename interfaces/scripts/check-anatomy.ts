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
    instance: { holes: { label: "Order the job" } },
    expected: `<button class="lt-button">Order the job</button>`,
  },
  {
    builder: "checkbox",
    instance: {
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
      holes: { "title-id": "confirm-title", title: "Cancel job 222-0481?" },
      content: {
        body: "<p>The crew keeps the advance. This cannot be undone.</p>",
      },
    },
    expected: `<lt-dialog><dialog class="lt-dialog" aria-labelledby="confirm-title"><h2 class="lt-dialog__title" id="confirm-title">Cancel job 222-0481?</h2><div class="lt-dialog__body"><p>The crew keeps the advance. This cannot be undone.</p></div><form class="lt-dialog__footer" method="dialog"></form></dialog></lt-dialog>`,
  },
  // The smallest: the title alone, and the dialog the app opens itself.
  {
    builder: "dialog",
    instance: {
      holes: { "title-id": "confirm-title", title: "Cancel job 222-0481?" },
      parts: { host: false, body: false, footer: false },
    },
    expected: `<dialog class="lt-dialog" aria-labelledby="confirm-title"><h2 class="lt-dialog__title" id="confirm-title">Cancel job 222-0481?</h2></dialog>`,
  },
  // The tabs as the Kotlin recipe on the page renders them: the panels get
  // their ids from the id and the keys, and the heading in each panel says
  // the same as its tab.
  {
    builder: "tabs",
    instance: {
      holes: {
        tabs: "claim-tabs",
        label: "Parts of the claim",
        title: ["Claim", "Attachments"],
      },
      repeats: { tab: ["claim", "attachments"] },
      content: {
        panel: [
          "<p>Claim AV-2079-0481 was filed on 4 March 2079.</p>",
          "<p>Three attachments have been received.</p>",
        ],
      },
    },
    expected: `<lt-tabs><ul class="lt-tabs__list" aria-label="Parts of the claim"><li><a href="#claim-tabs-claim">Claim</a></li><li><a href="#claim-tabs-attachments">Attachments</a></li></ul><section id="claim-tabs-claim" class="lt-tabs__panel"><h2 id="claim-tabs-claim-heading">Claim</h2><p>Claim AV-2079-0481 was filed on 4 March 2079.</p></section><section id="claim-tabs-attachments" class="lt-tabs__panel"><h2 id="claim-tabs-attachments-heading">Attachments</h2><p>Three attachments have been received.</p></section></lt-tabs>`,
  },
  // The sortable table on the page, without data-align. Each column heading
  // chooses for itself: sorted by a button, or plain.
  {
    builder: "table",
    instance: {
      repeats: { column: 2, row: 2 },
      choices: { "row-heading": "sortable", heading: ["sortable", "plain"] },
      settings: { heading: [{ direction: "descending" }, {}] },
      holes: {
        caption: "Recovery orders",
        "row-heading": "Reference",
        heading: ["Recovered", "Offer"],
        "row-name": ["LR-2079-0113", "LR-2079-0112"],
        cell: [
          ["4 April", "EB 2,750"],
          ["4 March", "EB 7,150"],
        ],
      },
    },
    expected: `<table class="lt-table"><caption>Recovery orders</caption><thead><tr><th scope="col"><button class="lt-table__sort" type="button">Reference</button></th><th aria-sort="descending" scope="col"><button class="lt-table__sort" type="button">Recovered</button></th><th scope="col">Offer</th></tr></thead><tbody><tr><th scope="row">LR-2079-0113</th><td>4 April</td><td>EB 2,750</td></tr><tr><th scope="row">LR-2079-0112</th><td>4 March</td><td>EB 7,150</td></tr></tbody></table>`,
  },
  // A wide table in the box that scrolls, sorted by a link without
  // JavaScript.
  {
    builder: "table",
    instance: {
      parts: { scroll: true },
      repeats: { column: 1, row: 1 },
      choices: { heading: ["link"] },
      holes: {
        region: "Recovery orders",
        caption: "Recovery orders",
        "row-heading": "Reference",
        heading: ["Recovered"],
        sort: ["?sort=recovered"],
        "row-name": ["LR-2079-0113"],
        cell: [["4 April"]],
      },
    },
    expected: `<div class="lt-table-scroll" tabindex="0" role="region" aria-label="Recovery orders"><table class="lt-table"><caption>Recovery orders</caption><thead><tr><th scope="col">Reference</th><th scope="col"><a class="lt-table__sort" href="?sort=recovered">Recovered</a></th></tr></thead><tbody><tr><th scope="row">LR-2079-0113</th><td>4 April</td></tr></tbody></table></div>`,
  },
  // With the header and the subtitle, as the page shows them.
  {
    builder: "dialog",
    instance: {
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
]

const errors: string[] = []
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
  if (written !== c.expected)
    errors.push(
      `${c.builder}: the anatomy gives\n    ${written || "(nothing)"}\n  and the page has\n    ${c.expected}`,
    )
}

if (errors.length) {
  console.error(`✗ The anatomies:\n  ${errors.join("\n  ")}`)
  process.exit(1)
}
console.log(`✓ The anatomies give the page's markup in ${cases.length} cases.`)
