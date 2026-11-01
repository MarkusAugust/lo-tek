/**
 * That the core fails on every error type it should, and only on those.
 *
 * The core is the Rust module as `bun run core` last built it, with the
 * package's manifest. A rule switched off in Rust fails here after the
 * next build of the module. Each case says how many findings it must give
 * and what the message must mention, and the clean cases must give none.
 * The snippets from the component pages are included as clean cases: if one
 * of them gives a finding, either the rule or the recipe is wrong, and both
 * must come out.
 *
 * The cases cover the parser too, not just the rules: a value with `>` in
 * it, an unquoted value, single quotes, a tag over several lines, a field
 * without a closing tag. A branch without a case survives being removed,
 * and then nobody knows it works.
 *
 * Run with: bun core/scripts/check-diagnostics.ts (after bun core/scripts/build.ts)
 */

import { readFileSync } from "node:fs"
import {
  classesData,
  diagnosticsData,
  snippets,
} from "../../interfaces/scripts/generate-vocabulary"
import {
  type Finding,
  loadCore,
} from "../../interfaces/src/diagnostics/core.js"
import type {
  Classes,
  Elements,
} from "../../interfaces/src/vocabulary/types.js"
import { MODULE } from "./build.js"

const all: Elements = diagnosticsData()
const classes: Classes = classesData()
const core = loadCore(readFileSync(MODULE))
// The core carries no data, and gets the package's manifest as every host gives it.
core.loadManifest(
  readFileSync(
    new URL("../../interfaces/manifest/manifest.json", import.meta.url),
    "utf8",
  ),
)
const findings: string[] = []

type Case = {
  name: string
  html: string
  count: number
  mentions?: string[]
  severity?: "error" | "warning"
  /** The text the finding must cover, when the position is the point. */
  covers?: string
  /**
   * Where the finding must start. Needed when the same text appears in several
   * places: `covers` alone then passes even when the finding points at the
   * wrong occurrence.
   */
  coversAt?: number
  /** What the message must not mention. */
  notMentions?: string[]
  /** The fix applied to html must give this. */
  fixed?: string
  fixTitle?: string
  fixPreferred?: boolean
  /** The finding must have no fix. */
  noFix?: boolean
  /** How long the case may take, when speed is the point. */
  maxMs?: number
  /** Check as a whole page, with the wiring rules. */
  page?: boolean
}

const FIELD_OK = `<lt-field id="f"><label for="handle">Handle</label><input class="lt-input" name="handle" id="handle"></lt-field>`

const cases: Case[] = [
  {
    name: "a button with only an icon and no name",
    html: `<button class="lt-button"><svg class="lt-icon" aria-hidden="true"><path d="M0 0"/></svg><span aria-hidden="true">x</span></button>`,
    count: 1,
    mentions: ["<button> has only an icon", "aria-label", "lt-sr-only"],
    severity: "error",
    covers: "button",
    coversAt: 1,
  },
  {
    name: "a link with only an image without alt",
    html: `<a href="/hjem"><img src="hus.svg" alt=""></a>`,
    count: 1,
    mentions: ["<a> has only an icon", '"link"'],
    severity: "error",
  },
  {
    name: "an icon named by text, aria-label, title, alt or an svg title",
    html: `<button><svg class="lt-icon" aria-hidden="true"></svg> Delete</button>
<button aria-label="Delete"><svg class="lt-icon" aria-hidden="true"></svg></button>
<button title="Delete"><svg class="lt-icon" aria-hidden="true"></svg></button>
<button><svg class="lt-icon" aria-hidden="true"></svg><span class="lt-sr-only">Delete</span></button>
<button><img src="x.svg" alt="Delete"></button>
<button><svg><title>Delete</title></svg></button>
<a><svg class="lt-icon" aria-hidden="true"></svg></a>
<button>{{ .Handle }}<svg class="lt-icon" aria-hidden="true"></svg></button>
<button></button>`,
    count: 0,
  },
  {
    name: "a hidden button without a name: it can be shown, and then has none",
    html: `<button hidden><svg class="lt-icon" aria-hidden="true"></svg></button>`,
    count: 1,
    mentions: ["<button> has only an icon"],
  },
  {
    name: "a field with two controls",
    html: `<lt-field><label for="a">Phone</label><input name="a" id="a"><select name="b"></select></lt-field>`,
    count: 1,
    mentions: [
      '<lt-field> has the part "control" more than once',
      "only uses the first",
    ],
    severity: "warning",
    covers: "select",
  },
  {
    name: "two help texts in a field, where only the first is wired",
    html: `<lt-field><label for="n">Name</label><input name="n" id="n"><p class="lt-help-text">A</p><p class="lt-help-text">B</p></lt-field>`,
    count: 1,
    mentions: ['"help"'],
    coversAt: 90,
  },
  {
    name: "a class with two of a part that must appear once",
    html: `<table class="lt-table"><caption>A</caption><caption>B</caption><thead></thead><tbody></tbody></table>`,
    count: 1,
    mentions: ['lt-table has the part "caption"', "must appear once"],
    coversAt: 45,
  },
  {
    name: "parts repeated where that is allowed, or belonging to something else",
    html: `<lt-popover><button>Menu</button><ul class="lt-popover" id="menu"><li><button>A</button></li><li><button>B</button></li></ul></lt-popover>
<lt-dialog><dialog><h2>Title</h2><div class="lt-dialog__body"><h3>Part</h3></div></dialog></lt-dialog>
<lt-field><label>A <input name="a"></label><lt-field><label>B <input name="b"></label></lt-field></lt-field>
<lt-tabs><ul class="lt-tabs__list" aria-label="Parts"><li><a href="#pa">A</a></li><li><a href="#pb">B</a></li></ul><div class="lt-tabs__panel" id="pa">A</div><div class="lt-tabs__panel" id="pb">B</div></lt-tabs>
<div class="lt-card"><h3 class="lt-card__title">A</h3><div class="lt-card"><h3 class="lt-card__title">B</h3></div></div>
<ul class="lt-list"><li>A</li><li>B</li></ul>`,
    count: 0,
  },
  {
    name: "two dialogs directly under <lt-dialog>, but not a nested one",
    html: `<lt-dialog><dialog></dialog><dialog></dialog></lt-dialog>
<lt-dialog><dialog></dialog><div><dialog></dialog></div></lt-dialog>`,
    count: 1,
    mentions: ['"dialog"'],
  },
  {
    name: "a hidden value is not another control, and a split button is not two triggers",
    html: `<lt-field><input type="hidden" name="x"><label><input type="checkbox" name="y"> Jeg godtar</label></lt-field>
<lt-popover><button type="button">Save</button><button type="button" aria-controls="m">More options</button><ul class="lt-popover" id="m"><li><button type="button">Save as</button></li></ul></lt-popover>
<fieldset class="lt-fieldset"><legend class="lt-legend">Address</legend><p class="lt-help-text">Where you sleep</p><lt-field><label for="g">Street</label><input name="g" id="g"><p class="lt-help-text">With the number</p></lt-field></fieldset>
<table class="lt-table"><caption>A</caption><thead></thead><tbody></tbody><tbody></tbody></table>`,
    count: 0,
  },
  {
    name: "deep nesting and a field with many controls are fast",
    html: `<ul class="lt-list">${"<li>x".repeat(3000)}</ul><lt-field><label for="a">A</label><input name="a" id="a">${'<input name="a">'.repeat(1999)}</lt-field>`,
    count: 1999,
    maxMs: 500,
  },
  {
    name: "two parts behind a condition in a template are not two parts",
    html: `<lt-field><label>Answer</label>{{if .Long}}<textarea name="s"></textarea>{{else}}<input name="s">{{end}}</lt-field>`,
    count: 0,
  },
  {
    name: "an extra part can be suppressed",
    html: `<lt-field><label for="a">A</label><input name="a" id="a"><!-- lotek-ignore-next part-repeated --><input name="b"></lt-field>`,
    count: 0,
  },
  {
    name: "an element that does not exist",
    html: `<lt-dialog><lt-dialog-header>Title</lt-dialog-header></lt-dialog>`,
    count: 1,
    mentions: ["<lt-dialog-header> does not exist", "lt-dialog"],
    severity: "error",
    covers: "lt-dialog-header",
  },
  {
    name: "an attribute the element does not have",
    html: `<lt-popover placemnet="top-start"></lt-popover>`,
    count: 1,
    mentions: ['"placemnet"', "placement"],
    severity: "warning",
    covers: "placemnet",
  },
  {
    name: "global attributes, data-, aria- and event handlers pass",
    html: `<lt-popover id="p" class="x" data-on-click="@get('/x')" aria-label="Help" onclick="1" role="dialog" hidden></lt-popover>`,
    count: 0,
  },
  {
    name: "HTMX, Alpine and Vue prefixes pass",
    html: `<lt-popover hx-get="/x" x-data="{}" v-if="c"></lt-popover>`,
    count: 0,
  },
  {
    name: "Alpine, Svelte and Angular syntax passes",
    html: `<lt-popover @click="a" :open="b" on:click="d" bind:open="e" [open]="f" (close)="g"></lt-popover>`,
    count: 0,
  },
  {
    name: "Angular structural directives and i18n, and hyperscript's _, pass",
    html: `<lt-popover *ngIf="x" i18n placement="top-start"></lt-popover><lt-dialog _="on click toggle @open"></lt-dialog>`,
    count: 0,
  },
  {
    name: "a web component whose name starts with select is not a control",
    html: `<lt-field><label-x>N</label-x><select-all></select-all></lt-field>`,
    count: 1,
    mentions: ["found no control"],
  },
  {
    name: "Alpine in the tag does not make the rest a template",
    html: `<lt-popover @click="a" placemnet="top-start"></lt-popover>`,
    count: 1,
    mentions: ['"placemnet"'],
  },
  {
    name: "a Razor partial inside the field",
    html: `<lt-field><label>Handle</label>@Html.Partial("Input")</lt-field>`,
    count: 0,
  },
  {
    name: "a value outside the list",
    html: `<lt-popover placement="midt"></lt-popover>`,
    count: 1,
    mentions: ['"midt"', "Valid values"],
    severity: "error",
    covers: "placement",
  },
  {
    name: "a list attribute without a value",
    html: `<lt-popover placement></lt-popover>`,
    count: 1,
    mentions: ["Valid values"],
    severity: "error",
  },
  {
    name: 'a boolean attribute with "false"',
    html: `<lt-field disabled="false"><label>N <input></label></lt-field>`,
    count: 1,
    mentions: ["boolean", 'disabled="false" means the same as disabled'],
    severity: "warning",
  },
  {
    name: "a boolean attribute with its own name or an empty value is fine",
    html: `<lt-field disabled="disabled" optional=""><label>N <input></label></lt-field>`,
    count: 0,
  },
  {
    name: "hidden=until-found is HTML",
    html: `<lt-error-summary hidden="until-found"></lt-error-summary>`,
    count: 0,
  },
  {
    name: "a number that is not a number",
    html: `<lt-toast duration="lenge"></lt-toast>`,
    count: 1,
    mentions: ["must be a number", '"lenge"'],
    severity: "error",
  },
  {
    name: "a number that is a number",
    html: `<lt-toast duration="5000"></lt-toast>`,
    count: 0,
  },
  {
    name: "a field without a control",
    html: `<lt-field><label>Handle</label><p class="lt-help-text">Help</p></lt-field>`,
    count: 1,
    mentions: ["found no control", "<input>, <textarea> or <select>"],
    severity: "warning",
    covers: "lt-field",
  },
  {
    name: "a hidden input is not a control, as in the component",
    html: `<lt-field><label>X</label><input type="hidden" name="csrf"></lt-field>`,
    count: 1,
    mentions: ["found no control"],
  },
  {
    name: "the control after a hidden input counts",
    html: `<lt-field><input type="hidden" name="csrf"><input aria-label="Search"></lt-field>`,
    count: 0,
  },
  {
    name: "a field without a label",
    html: `<lt-field><input class="lt-input"></lt-field>`,
    count: 1,
    page: true,
    mentions: ["has no label", "without a name"],
    severity: "error",
  },
  {
    name: "a session timeout without a dialog, as it used to be written",
    html: `<lt-session-timeout warn-at="1500"></lt-session-timeout>`,
    count: 1,
    mentions: ["found no <dialog>", "without warning"],
    severity: "warning",
    covers: "lt-session-timeout",
  },
  {
    name: "a session timeout with a dialog",
    html: `<lt-session-timeout><dialog><h2>Ends soon</h2></dialog></lt-session-timeout>`,
    count: 0,
  },
  {
    name: "a session timeout without a closing tag, with another dialog further down",
    html: `<lt-session-timeout warn-at="1500">\n<lt-dialog><dialog><h2>Other</h2></dialog></lt-dialog>`,
    count: 0,
  },
  {
    name: "a session timeout whose dialog is in a partial",
    html: `<lt-session-timeout>{{ template "okt" . }}</lt-session-timeout>`,
    count: 0,
  },
  {
    name: "an empty field is an area the server has not filled",
    html: `<lt-field id="senere"></lt-field>`,
    count: 0,
  },
  {
    name: "label outside, with for",
    html: `<label for="email">Email</label><lt-field><input id="email"></lt-field>`,
    count: 0,
  },
  {
    name: "label outside, with an unquoted for",
    html: `<label for=email>Email</label><lt-field><input id="email"></lt-field>`,
    count: 0,
  },
  {
    name: "an id with brackets and parentheses does not throw",
    html: `<label for="a[0].x(1)">X</label><lt-field><input id="a[0].x(1)"></lt-field>`,
    count: 0,
  },
  {
    name: "a full stop in the id is a full stop, not any character",
    html: `<label for="ab">X</label><lt-field><input id="a.b"></lt-field>`,
    count: 2,
    page: true,
    mentions: ["Write for on the label and id on the field"],
  },
  {
    name: "aria-label on the control",
    html: `<lt-field><input aria-label="Search"></lt-field>`,
    count: 0,
  },
  {
    name: "aria-labelledby on the control",
    html: `<lt-field><input aria-labelledby="tittel"></lt-field>`,
    count: 0,
  },
  {
    name: "a Go template in the tag",
    html: `<lt-field {{ if .Av }}disabled{{ end }}><label>N</label><input></lt-field>`,
    count: 0,
  },
  {
    name: "Jinja in the tag and in the value",
    html: `<lt-popover {% if x %}open{% endif %} placement="{{ p }}"></lt-popover>`,
    count: 0,
  },
  {
    name: "PHP in the tag",
    html: `<lt-field <?= $av ? 'disabled' : '' ?>><label>N <input></label></lt-field>`,
    count: 0,
  },
  {
    name: "Razor in the value",
    html: `<lt-field disabled="@Model.Disabled"><label>N <input></label></lt-field>`,
    count: 0,
  },
  {
    name: "a partial inside the field is not a field without a control",
    html: `<lt-field><label>Handle</label>{{ template "input" . }}</lt-field>`,
    count: 0,
  },
  {
    name: "an unknown element is reported in a template too",
    html: `<lt-feild {{ if .X }}disabled{{ end }}></lt-feild>`,
    count: 1,
    mentions: ["does not exist"],
  },
  {
    name: "comments, scripts and stylesheets are not read",
    html: `<!-- <lt-finnes-ikke> --><script>"<lt-nei>"</script><style>/* <lt-nei> */</style>${FIELD_OK}`,
    count: 0,
  },
  {
    name: "the position holds when a comment spans several lines",
    html: `<!--\n<lt-nei>\n-->\n<lt-tull></lt-tull>`,
    count: 1,
    covers: "lt-tull",
  },
  {
    name: "upper case in tag and attribute, and self-closing",
    html: `<LT-TOAST DURATION="x"/>`,
    count: 1,
    mentions: ["must be a number"],
    covers: "DURATION",
  },
  {
    name: "a value with > in it",
    html: `<lt-toast label="a > b" duration="5"></lt-toast>`,
    count: 0,
  },
  {
    name: "an unquoted value",
    html: `<lt-popover placement=top-start></lt-popover><lt-popover placement=topp></lt-popover>`,
    count: 1,
    mentions: ['"topp"'],
  },
  {
    name: "single quotes",
    html: `<lt-popover placement='top-start'></lt-popover><lt-popover placement='topp'></lt-popover>`,
    count: 1,
    mentions: ['"topp"'],
  },
  {
    name: "a tag over several lines",
    html: `<lt-popover\n  placement="top-start"\n  open\n></lt-popover>`,
    count: 0,
  },
  {
    name: "a field in a field",
    html: `<lt-field><label>A <input></label><lt-field><label>B <input></label></lt-field></lt-field>`,
    count: 0,
  },
  {
    name: "a field without a closing tag",
    html: `<lt-field><label>A <input></label>`,
    count: 0,
  },
  {
    name: "Alpine on the control does not make the field a template",
    html: `<lt-field><input @input="x = 1"></lt-field>`,
    count: 1,
    page: true,
    mentions: ["has no label"],
  },
  {
    name: "nor does Alpine on a button in the field",
    html: `<lt-field><label>N</label><button @click="x">Send</button></lt-field>`,
    count: 1,
    mentions: ["found no control"],
  },
  {
    name: "upper-case field: an empty field is silent",
    html: `<LT-FIELD id="senere"></LT-FIELD>\n<p>text</p>`,
    count: 0,
  },
  {
    name: "upper-case field: without a label it fails",
    html: `<LT-FIELD><INPUT></LT-FIELD>\n<label>x</label>`,
    count: 1,
    page: true,
    mentions: ["has no label"],
  },
  {
    name: "a typo that resembles a known attribute",
    html: `<lt-connection-status onlinetext="Tilkoblet"></lt-connection-status>`,
    count: 1,
    mentions: ["Did you mean online-text?"],
    covers: "onlinetext",
  },
  {
    name: "a typo without a hyphen",
    html: `<lt-field describedBy="vilkar"><label>N <input></label></lt-field>`,
    count: 1,
    mentions: ["Did you mean described-by?"],
  },
  {
    name: "an unterminated control does not read the rest as its attributes",
    html: `<lt-field><input placeholder=it's><span aria-label="x"></span></lt-field>`,
    count: 1,
    mentions: ["found no"],
  },
  {
    name: "numbers as the components read them",
    html: `<lt-toast duration=" 5000 "></lt-toast><lt-toast duration="1e3"></lt-toast><lt-toast duration=""></lt-toast>`,
    count: 1,
    mentions: ["must be a number"],
  },
  {
    name: "a Jinja comment in the tag",
    html: `<lt-popover {# note #} placement="top-start"></lt-popover>`,
    count: 0,
  },
  {
    name: "PHP in the tag does not end it, and the error after it fails",
    html: `<lt-popover <?= $x ?> placement="midt"></lt-popover>`,
    count: 1,
    mentions: ['"midt"'],
  },
  {
    name: "a class that does not exist, with a suggestion and a fix",
    html: `<button class="lt-buton">Send</button>`,
    count: 1,
    mentions: ['"lt-buton" does not exist', "Did you mean lt-button?"],
    severity: "warning",
    covers: "lt-buton",
    fixed: `<button class="lt-button">Send</button>`,
    fixTitle: "Change to lt-button",
  },
  {
    name: "a class far from every known one gets no suggestion",
    html: `<button class="lt-knapp">Send</button>`,
    count: 1,
    mentions: ['"lt-knapp" does not exist'],
    notMentions: ["Did you mean"],
  },
  {
    name: "a plain value in a tag with a template is still checked",
    html: `<button class="lt-button" {{ if .X }}disabled{{ end }} data-variant="ghots"></button>`,
    count: 1,
    mentions: ['"ghots"'],
  },
  {
    name: "a class with a template in its name is not a typo",
    html: `<div class="lt-{{ .Type }} card"></div><div class="lt-<?= $x ?>"></div>`,
    count: 0,
  },
  {
    name: "known classes, also several in one attribute and with a template",
    html: `<input class="lt-input lt-search" type="search"><div class="{{ .Class }} lt-card"></div><p class="card lt-paragraph"></p>`,
    count: 0,
  },
  {
    name: "a variant outside the list, with a suggestion and a fix",
    html: `<button class="lt-button" data-variant="ghots">Send</button>`,
    count: 1,
    mentions: [
      'data-variant cannot be "ghots" on button',
      "secondary, ghost, danger",
      "primary without the attribute",
    ],
    fixed: `<button class="lt-button" data-variant="ghost">Send</button>`,
    fixTitle: "Change to ghost",
  },
  {
    name: "valid variants, the default value and type on input",
    html: `<button class="lt-button" data-variant="danger"></button><button class="lt-button" data-variant="primary"></button><input class="lt-input" type="email"><h2 class="lt-heading" data-size="xl"></h2>`,
    count: 0,
  },
  {
    name: "an attribute another class takes is not checked here",
    html: `<div class="lt-card" data-variant="ghost"></div><span class="lt-badge" data-size="xl"></span>`,
    count: 1,
    mentions: ['data-variant cannot be "ghost" on card'],
  },
  {
    name: "a variant value from a template is not checked",
    html: `<button class="lt-button" data-variant="{{ .Variant }}"></button><button class="lt-button" data-variant="@Model.V"></button>`,
    count: 0,
  },
  {
    name: "the fix for an attribute name",
    html: `<lt-connection-status onlinetext="Tilkoblet"></lt-connection-status>`,
    count: 1,
    fixed: `<lt-connection-status online-text="Tilkoblet"></lt-connection-status>`,
    fixTitle: "Change to online-text",
  },
  {
    name: "the fix for a boolean attribute takes the value and the space",
    html: `<lt-field disabled="false" id="x"><label>N <input></label></lt-field>`,
    count: 1,
    fixed: `<lt-field id="x"><label>N <input></label></lt-field>`,
    fixTitle: "Remove disabled",
    fixPreferred: true,
  },
  {
    name: "the fix for a boolean attribute last in the tag",
    html: `<lt-field id="x" disabled="false"><label>N <input></label></lt-field>`,
    count: 1,
    fixed: `<lt-field id="x"><label>N <input></label></lt-field>`,
  },
  {
    name: "the fix for a field without a label",
    html: `<lt-field><input class="lt-input" id="handle"></lt-field>`,
    count: 1,
    page: true,
    fixed: `<lt-field><label for="handle">Label</label><input class="lt-input" id="handle"></lt-field>`,
    fixTitle: "Add a label",
  },
  {
    // A `<label>` without `for` next to the field is not wired to it.
    // Without an id there is no fix that is a single insertion.
    name: "a field without a label and without an id gets no fix",
    html: `<lt-field><input class="lt-input"></lt-field>`,
    count: 1,
    page: true,
    mentions: ["put the label around the field"],
    noFix: true,
  },
  {
    name: "the label gets its own line with the same indentation",
    html: `<lt-field>\n  <input class="lt-input" id="handle">\n</lt-field>`,
    count: 1,
    page: true,
    fixed: `<lt-field>\n  <label for="handle">Label</label>\n  <input class="lt-input" id="handle">\n</lt-field>`,
  },
  {
    name: "the label gets its own line with \\r line breaks too",
    html: `<lt-field>\r  <input class="lt-input" id="handle">\r</lt-field>`,
    count: 1,
    page: true,
    fixed: `<lt-field>\r  <label for="handle">Label</label>\r  <input class="lt-input" id="handle">\r</lt-field>`,
  },
  {
    name: "data-required on label and legend",
    html: `<label class="lt-label" data-required="stjerne">N</label><legend class="lt-legend" data-required="text">G</legend>`,
    count: 1,
    mentions: ['data-required cannot be "stjerne"', "symbol, text"],
  },
  {
    name: "data-variant on input, which the CSS reads",
    html: `<input class="lt-input" data-variant="dato" type="date"><input class="lt-input" data-variant="date" type="date">`,
    count: 1,
    mentions: ['data-variant cannot be "dato"', "date, datetime-local, time"],
    fixed: `<input class="lt-input" data-variant="date" type="date"><input class="lt-input" data-variant="date" type="date">`,
  },
  {
    name: "type on input belongs to HTML and is not checked, hidden included",
    html: `<input class="lt-input" type="color"><input class="lt-input" type="hidden"><input class="lt-input" type="file">`,
    count: 0,
  },
  {
    name: "a short name gets no suggestion two characters away",
    html: `<div class="lt-tabs"></div>`,
    count: 1,
    notMentions: ["Did you mean"],
  },
  {
    name: "a swap is one error, and the suggestion is not preferred",
    html: `<button class="lt-button" data-variant="ghots"></button>`,
    count: 1,
    fixTitle: "Change to ghost",
    fixPreferred: false,
  },
  {
    name: "the same letters are the safe fix",
    html: `<lt-connection-status onlinetext="x"></lt-connection-status>`,
    count: 1,
    mentions: ["Did you mean online-text"],
    fixPreferred: true,
  },
  {
    name: "a long name gets two characters of slack",
    html: `<p class="lt-eror-txt"></p>`,
    count: 1,
    mentions: ["Did you mean lt-error-text?"],
  },
  {
    name: "the length filter lets through exactly at the limit",
    html: `<a class="lt-lin"></a>`,
    count: 1,
    mentions: ["Did you mean lt-link?"],
  },
  {
    name: "at equal distance the one sharing the beginning wins",
    html: `<table class="lt-tabel"></table>`,
    count: 1,
    mentions: ["Did you mean lt-table?"],
  },
  {
    name: '"Remove" over several lines',
    html: `<lt-field\n  disabled="false"\n  id="x"><label>N <input></label></lt-field>`,
    count: 1,
    fixed: `<lt-field\n  id="x"><label>N <input></label></lt-field>`,
  },
  {
    name: "a fix on an unquoted class",
    html: `<p class=lt-buton></p>`,
    count: 1,
    fixed: `<p class=lt-button></p>`,
  },
  {
    name: "a fix on an unquoted value",
    html: `<button class=lt-button data-variant=ghots></button>`,
    count: 1,
    fixed: `<button class=lt-button data-variant=ghost></button>`,
  },
  {
    name: "two classes taking the same attribute give one finding",
    html: `<input class="lt-input lt-search" data-state="failed">`,
    count: 1,
  },
  {
    name: "Astro and Svelte: a value in braces is an expression",
    html: `<lt-popover placement={placement} open={isOpen}></lt-popover><lt-toast duration={ms}></lt-toast><button class="lt-button" data-variant={v}></button>`,
    count: 0,
  },
  {
    name: "Astro and Svelte: braces with quotes and nesting inside",
    html: `<input class="lt-input" data-state={error ? "invalid" : undefined}><lt-field class:list={["lt-card", { card }]}></lt-field>`,
    count: 0,
  },
  {
    name: "a brace inside a quote in the expression does not end it",
    html: `<lt-popover placement={a ? "}" : "x"} open></lt-popover>`,
    count: 0,
  },
  {
    name: "braces in braces, and the error after them still fails",
    html: `<lt-popover placement={c ? {a:1}.p : "top-start"} plasement="x"></lt-popover>`,
    count: 1,
    mentions: ['"plasement"'],
  },
  {
    name: "Svelte: a class with an expression in it is not checked, the others are",
    html: `<div class="lt-card lt-{b} lt-buton"></div>`,
    count: 1,
    mentions: ['"lt-buton"'],
  },
  {
    name: "a braced value followed by a real error",
    html: `<lt-popover open={isOpen} placemnet="top-start"></lt-popover>`,
    count: 1,
    mentions: ['"placemnet"'],
    covers: "placemnet",
  },
  {
    name: "an empty value is no value",
    html: `<button class="lt-button" data-variant=""></button>`,
    count: 0,
  },
  {
    name: "the same letters in a class are the safe fix",
    html: `<p class="lt-error_text"></p>`,
    count: 1,
    fixTitle: "Change to lt-error-text",
    fixPreferred: true,
  },
  {
    name: "the same unknown class many times is fast",
    html: Array.from(
      { length: 3000 },
      () => `<td class="lt-cell lt-celle">x</td>`,
    ).join("\n"),
    count: 6000,
    maxMs: 60,
  },
  {
    name: "the findings come in the order of the text",
    html: `<lt-popover placemnet="x"></lt-popover><button class="lt-buton"></button><lt-tull></lt-tull>`,
    count: 3,
    mentions: ["placemnet"],
  },
  {
    name: "several findings in one tag are reported separately",
    html: `<lt-popover placemnet="top-start" open="false"></lt-popover>`,
    count: 2,
  },
  {
    name: "a clean file",
    html: `<!doctype html><html><body>${FIELD_OK}<lt-popover placement="top-start" open></lt-popover></body></html>`,
    count: 0,
  },
]

// The wiring on a whole page, with `--rendered` or an address.
const LABELLED = `<label class="lt-label" for="email">Email</label><input class="lt-input" id="email" aria-describedby="email-help"><p class="lt-help-text" id="email-help">Help</p>`
cases.push(
  {
    name: "page: a clean field with label and help text",
    html: LABELLED,
    count: 0,
    page: true,
  },
  {
    name: "page: for points at an id that does not exist",
    html: `<label class="lt-label" for="e-mail">Email</label><input class="lt-input" id="email">`,
    count: 2,
    page: true,
    severity: "error",
    mentions: ["for=", '"e-mail"', "the label", "lt.field({ id })"],
    covers: "e-mail",
  },
  {
    name: "page: one of several ids in aria-describedby does not exist",
    html: LABELLED.replace(
      'aria-describedby="email-help"',
      'aria-describedby="email-help email-error"',
    ),
    count: 1,
    page: true,
    severity: "error",
    mentions: ['"email-error"', "the description"],
    covers: "email-error",
  },
  {
    name: "page: aria-labelledby points at an id that does not exist",
    html: `<input class="lt-input" id="sok" aria-labelledby="sok-tittel">`,
    count: 1,
    page: true,
    mentions: ["aria-labelledby", "the name"],
  },
  {
    name: "page: aria-controls gets no recipe about the field",
    html: `<button class="lt-button" aria-controls="menu">Menu</button>`,
    count: 1,
    page: true,
    mentions: ["aria-controls", '"menu"'],
    notMentions: ["lt.field("],
  },
  {
    name: "page: an id that appears twice",
    html: `${LABELLED}<p id="email">Again</p>`,
    count: 1,
    page: true,
    severity: "error",
    mentions: ['id="email"', "more than once"],
    covers: "email",
  },
  {
    name: "page: a LO-TEK field without a label",
    html: `<label class="lt-label">Handle</label><input class="lt-input" id="handle">`,
    count: 1,
    page: true,
    severity: "error",
    mentions: ["<input> has no label", "lt.field({ id })"],
    covers: "input",
  },
  {
    name: "page: a field with <label> around it has a label",
    html: `<label class="lt-label">Handle <input class="lt-input"></label>`,
    count: 0,
    page: true,
  },
  {
    name: "page: a field with aria-label has a label",
    html: `<input class="lt-input lt-search" type="search" aria-label="Search">`,
    count: 0,
    page: true,
  },
  {
    name: "page: a hidden field and a submit button need no label",
    html: `<input class="lt-input" type="hidden" name="t"><input class="lt-button" type="submit" value="Send">`,
    count: 0,
    page: true,
  },
  {
    name: "page: bare markup inside <lt-field> is correct",
    html: `<lt-field><label class="lt-label" for="handle">Handle</label><input class="lt-input" id="handle"><p class="lt-help-text">Help</p><p class="lt-error-text" hidden>Error</p></lt-field>`,
    count: 0,
    page: true,
  },
  {
    name: "page: an id pointing wrong inside <lt-field> is still reported, and the label is then not wired",
    html: `<lt-field><label class="lt-label" for="x">Handle</label><input class="lt-input" id="y"></lt-field>`,
    count: 2,
    page: true,
    mentions: ['"x"'],
  },
  {
    name: "page: a help text without an id",
    html: `<label class="lt-label" for="a">A</label><input class="lt-input" id="a"><p class="lt-help-text">Help</p>`,
    count: 1,
    page: true,
    severity: "warning",
    mentions: ["The help text", "has no id"],
  },
  {
    name: "page: a visible error text nothing points at",
    html: `<label class="lt-label" for="a">A</label><input class="lt-input" id="a"><p class="lt-error-text" id="a-error">Error</p>`,
    count: 1,
    page: true,
    mentions: ["The error text", '"a-error"'],
  },
  {
    name: "page: a hidden error text needs no wiring",
    html: `<label class="lt-label" for="a">A</label><input class="lt-input" id="a"><p class="lt-error-text" id="a-error" hidden>Error</p>`,
    count: 0,
    page: true,
  },
  {
    name: "page: an id in a comment does not count",
    html: `<!-- <p id="help"></p> --><label class="lt-label" for="help">A</label><input class="lt-input" id="a">`,
    count: 2,
    page: true,
    mentions: ['"help"'],
  },
  {
    name: "page: a label without for inside <lt-suggestion> is reported, since the template must write it",
    html: `<lt-suggestion><label class="lt-label">Target</label><input class="lt-input" type="text"></lt-suggestion>`,
    count: 1,
    page: true,
    mentions: ["The label is not wired"],
  },
  {
    name: "page: a help text inside <lt-suggestion> must be wired",
    html: `<lt-suggestion><label class="lt-label" for="k">Target</label><input class="lt-input" type="text" id="k"><p class="lt-help-text">Help</p></lt-suggestion>`,
    count: 1,
    page: true,
    mentions: ["The help text"],
  },
  {
    name: "page: ids in a shadow root have their own scope",
    html: `${LABELLED}<div><template shadowrootmode="open"><label class="lt-label" for="email">Email</label><input class="lt-input" id="email"></template></div>`,
    count: 0,
    page: true,
  },
  {
    name: "page: markup in an attribute value is text, not elements",
    html: `${LABELLED}<button class="lt-button" data-code='<lt-modal open><input class="lt-input" id="email">'>Copy</button>`,
    count: 0,
    page: true,
  },
  {
    name: "page: a value ending in = does not swallow the rest of the page",
    html: `<img src="data:image/png;base64,iVBORw0KGgo=" alt="">${LABELLED}`,
    count: 0,
    page: true,
  },
  {
    name: "page: a field after a value ending in = is still checked",
    html: `<a href="/s" title="1+1=">x</a><input class="lt-input" id="q">`,
    count: 1,
    page: true,
    mentions: ["<input> has no label"],
  },
  {
    name: "page: for pointing at a <div>",
    html: `<label class="lt-label" for="box">Handle</label><div id="box"></div><input class="lt-input" aria-label="Handle">`,
    count: 1,
    page: true,
    severity: "error",
    mentions: ["<div>", "cannot have a label"],
    covers: "box",
  },
  {
    name: "page: a link in the error summary to a field that does not exist",
    html: `${LABELLED}<lt-error-summary><h2 id="errors-title">Fix the errors</h2><ul><li><a href="#e-mail">Email</a></li></ul></lt-error-summary>`,
    count: 1,
    page: true,
    severity: "error",
    mentions: ["error summary", '"#e-mail"'],
    covers: "e-mail",
  },
  {
    name: "page: a link in the error summary to a field that exists",
    html: `${LABELLED}<lt-error-summary><h2 id="errors-title">Fix the errors</h2><ul><li><a href="#email">Email</a></li></ul></lt-error-summary>`,
    count: 0,
    page: true,
  },
  {
    name: "page: a help text in a hidden parent or closed dialog",
    html: `<div hidden><p class="lt-help-text">A</p></div><dialog><p class="lt-error-text">B</p></dialog>`,
    count: 0,
    page: true,
  },
  {
    name: "page: a help text in an open dialog is checked",
    html: `<dialog open><p class="lt-help-text">A</p></dialog>`,
    count: 1,
    page: true,
    mentions: ["The help text"],
  },
  {
    name: "page: a help text that is a status region needs no wiring",
    html: `<p class="lt-help-text" role="status"></p><p class="lt-error-text" aria-live="assertive"></p>`,
    count: 0,
    page: true,
  },
  {
    name: "page: entities are decoded before the ids are compared",
    html: `<label class="lt-label" for="c&#46;d">C</label><input class="lt-input" id="c.d">`,
    count: 0,
    page: true,
  },
  {
    name: "page: markup in a <textarea> is text",
    html: `${LABELLED}<label class="lt-label" for="t">T</label><textarea class="lt-textarea" id="t"><input class="lt-input" id="email"></textarea>`,
    count: 0,
    page: true,
  },
  {
    name: "page: a <textarea> in an attribute value does not swallow the page",
    html: `<button class="lt-button" data-code="<textarea>">Copy</button><label class="lt-label" for="gone">X</label><label class="lt-label" for="t">T</label><textarea class="lt-textarea" id="t"></textarea>`,
    count: 1,
    page: true,
    mentions: ['"gone"'],
  },
  {
    name: "page: a <template> in an attribute value does not swallow the page",
    html: `<button class="lt-button" data-code='<template>'>Copy</button><label class="lt-label" for="gone">X</label><p>text</p><template></template>`,
    count: 1,
    page: true,
    mentions: ['"gone"'],
  },
  {
    name: "page: a comment in an attribute value does not swallow the page",
    html: `<button class="lt-button" data-code="<!--">Copy</button><label class="lt-label" for="gone">X</label><!-- end -->`,
    count: 1,
    page: true,
    mentions: ['"gone"'],
  },
  {
    name: "page: a numeric entity outside Unicode does not crash",
    html: `<p id="&#99999999;">A</p><p id="&#x110000;">B</p>`,
    count: 0,
    page: true,
  },
  {
    name: "page: a percent-encoded link in the error summary",
    html: `<label class="lt-label" for="café">F</label><input class="lt-input" id="café"><lt-error-summary><h2 id="errors-title">Error</h2><ul><li><a href="#caf%C3%A9">Date</a></li></ul></lt-error-summary>`,
    count: 0,
    page: true,
  },
  {
    name: "page: an id that is part of another id counts on its own",
    html: `${LABELLED.replace('aria-describedby="email-help"', 'aria-describedby="email-help email"')}`,
    count: 0,
    page: true,
  },
  {
    name: "page: the finding points at the id that is missing",
    html: `<input class="lt-input" aria-label="A" aria-describedby="x-help x"><p id="x-help">H</p>`,
    count: 1,
    page: true,
    covers: "x",
    // The second `x` in the value, not the first letter of `x-help`.
    coversAt: '<input class="lt-input" aria-label="A" aria-describedby="x-help '
      .length,
  },
  {
    name: "page: <label/> opens an element in HTML",
    html: `<label class="lt-label"/>Handle <input class="lt-input"></label>`,
    count: 0,
    page: true,
  },
  {
    name: "page: a trailing / in an unquoted value belongs to the value",
    html: `<label class="lt-label" for=a/>A</label><input class="lt-input" id="a/">`,
    count: 0,
    page: true,
  },
  {
    name: "template: markup in an attribute value is read as before without --rendered",
    html: `<button class="lt-button" data-code="<lt-modal>">Copy</button>`,
    count: 1,
    mentions: ["lt-modal"],
  },
  {
    name: "template: an id pointing out of the file is not reported without --rendered",
    html: `<label class="lt-label" for="e-mail">Email</label><input class="lt-input" id="email">`,
    count: 0,
  },
)

// The snippets from the component pages must be clean, also as whole pages:
// they must work when pasted in, wiring included.
/**
 * The snippet as it stands in the document after the user has accepted the
 * tab stops: `${1:handle}` becomes `handle`, and `$1` the same, as VS Code
 * mirrors them. The escaping is removed last.
 */
function withoutTabStops(body: string[]): string {
  const text = body.join("\n")
  const defaults = new Map<string, string>()
  for (const m of text.matchAll(/\$\{(\d+):([^}]*)\}/g))
    defaults.set(m[1], m[2])
  return text
    .replace(/\$\{(\d+):([^}]*)\}/g, (_, _n, value: string) => value)
    .replace(/(?<!\\)\$(\d+)\b/g, (_, n: string) => defaults.get(n) ?? "")
    .replace(/\\\$/g, "$")
    .replace(/\\\\/g, "\\")
}

for (const [tag, snippet] of Object.entries(snippets()))
  for (const page of [false, true])
    cases.push({
      name: `the snippet for <${tag}>${page ? " as a whole page" : ""}`,
      html: withoutTabStops(snippet.body),
      count: 0,
      page,
    })

const started = performance.now()

// The wiring the template must write itself, so the field works without
// JavaScript and survives an update from the server (plan v6, PR 3).
const TABS = (
  list: string,
  panels = `<section class="lt-tabs__panel" id="claim"><h2>Claim</h2></section><section class="lt-tabs__panel" id="attachments"><h2>Attachments</h2></section>`,
) => `<lt-tabs>${list}${panels}</lt-tabs>`
const LIST = `<ul class="lt-tabs__list" aria-label="Case sections"><li><a href="#claim">Claim</a></li><li><a href="#attachments">Attachments</a></li></ul>`
cases.push(
  {
    name: "a label without for next to a field without an id",
    html: `<lt-field><label class="lt-label">Target</label><input class="lt-input" name="target"></lt-field>`,
    count: 1,
    mentions: ["The label is not wired to <input>", "for on the label"],
    severity: "warning",
    covers: "input",
    fixTitle: 'Give the field the id "target"',
    fixed: `<lt-field><label for="target" class="lt-label">Target</label><input id="target" class="lt-input" name="target"></lt-field>`,
    fixPreferred: true,
  },
  {
    name: "a label pointing at a different id than the field's",
    html: `<lt-field><label class="lt-label" for="other">Target</label><input class="lt-input" id="target" name="target"></lt-field>`,
    count: 1,
    mentions: ["The label is not wired"],
    noFix: true,
  },
  {
    name: "a name that cannot become an id gives no fix",
    html: `<lt-field><label class="lt-label">Email</label><input class="lt-input" name="items[0].email"></lt-field>`,
    count: 1,
    noFix: true,
  },
  {
    name: "a name that is already an id on the page gives no fix",
    html: `<p id="target"></p><lt-field><label class="lt-label">Target</label><input class="lt-input" name="target"></lt-field>`,
    count: 1,
    noFix: true,
  },
  {
    name: "a field with for and id is wired",
    html: `<lt-field><label class="lt-label" for="target">Target</label><input class="lt-input" id="target" name="target"></lt-field>`,
    count: 0,
  },
  {
    name: "a label around the field is wired",
    html: `<lt-field><label class="lt-label">Target <input class="lt-input" name="target"></label></lt-field>`,
    count: 0,
  },
  {
    name: "a field with aria-label needs no wiring",
    html: `<lt-field><label class="lt-label">Search</label><input class="lt-input" name="q" aria-label="Search the claim"></lt-field>`,
    count: 0,
  },
  {
    name: "a bound id is up to the server",
    html: `<lt-field><label class="lt-label" :for="id">Target</label><input class="lt-input" :id="id" name="target"></lt-field>`,
    count: 0,
  },
  {
    name: "an id with template syntax is up to the server",
    html: `<lt-field><label class="lt-label" for="{{ .Id }}">Target</label><input class="lt-input" id="{{ .Id }}" name="target"></lt-field>`,
    count: 0,
  },
  {
    name: "asp-for gives an id in Razor",
    html: `<lt-field><label class="lt-label" asp-for="Target">Target</label><input class="lt-input" asp-for="Target"></lt-field>`,
    count: 0,
  },
  {
    name: "the suggestion field with a label without for",
    html: `<lt-suggestion><label class="lt-label">Breaker</label><input class="lt-input" id="breaker" name="breaker"><ul class="lt-suggestion__list"><li>Crowbar</li></ul><span class="lt-sr-only" role="status"></span></lt-suggestion>`,
    count: 1,
    mentions: ["The label is not wired"],
    noFix: true,
  },
  {
    name: "the suggestion field with no label at all",
    html: `<lt-suggestion><input class="lt-input" name="breaker"><ul class="lt-suggestion__list"><li>Crowbar</li></ul><span class="lt-sr-only" role="status"></span></lt-suggestion>`,
    count: 1,
    mentions: ["no label wired to it"],
    noFix: true,
  },
  {
    name: "a panel in the popover without an id",
    html: `<lt-popover><button class="lt-button" type="button">Menu</button><div class="lt-popover" popover>Contents</div></lt-popover>`,
    count: 1,
    mentions: ['"panel" without an id', "aria-controls", "never creates one"],
    covers: "div",
    noFix: true,
  },
  {
    name: "a panel with an id",
    html: `<lt-popover><button class="lt-button" type="button" popovertarget="menu">Menu</button><div class="lt-popover" popover id="menu">Contents</div></lt-popover>`,
    count: 0,
  },
  {
    name: "a panel with a bound id",
    html: `<lt-popover><button class="lt-button" type="button">Menu</button><div class="lt-popover" popover :id="id">Contents</div></lt-popover>`,
    count: 0,
  },
  {
    name: "a tab pointing at a panel that does not exist",
    html: TABS(
      LIST,
      `<section class="lt-tabs__panel" id="claim"><h2>Claim</h2></section>`,
    ),
    count: 1,
    mentions: ["#attachments", "no element has that id"],
    covers: "a",
  },
  {
    name: "a panel outside the tab list counts",
    html: `${TABS(LIST, `<section class="lt-tabs__panel" id="claim"><h2>Claim</h2></section>`)}<section class="lt-tabs__panel" id="attachments"><h2>Attachments</h2></section>`,
    count: 0,
  },
  {
    name: "a link with template syntax in href is up to the server",
    html: TABS(
      `<ul class="lt-tabs__list" aria-label="Parts"><li><a href="#{{ .Id }}">Claim</a></li></ul>`,
      `<section class="lt-tabs__panel" id="{{ .Id }}"></section>`,
    ),
    count: 0,
  },
  {
    name: "a button with role=tab in the tab list",
    html: TABS(
      `<ul class="lt-tabs__list" aria-label="Case sections"><li><a href="#claim">Claim</a></li><li><button type="button" role="tab">Attachments</button></li></ul>`,
    ),
    count: 1,
    mentions: ['role="tab" is on <button>', "The tabs are links"],
    covers: "button",
  },
  {
    name: "a link with role=tab is a tab",
    html: TABS(
      `<ul class="lt-tabs__list" aria-label="Case sections" role="tablist"><li role="presentation"><a href="#claim" role="tab">Claim</a></li><li role="presentation"><a href="#attachments" role="tab">Attachments</a></li></ul>`,
    ),
    count: 0,
  },
  {
    name: "a tab list without a name",
    html: TABS(
      `<ul class="lt-tabs__list"><li><a href="#claim">Claim</a></li><li><a href="#attachments">Attachments</a></li></ul>`,
    ),
    count: 1,
    mentions: ["tab list without a name", '"tab list"'],
    covers: "ul",
    fixTitle: "Give the tab list a name with aria-label",
    fixed: TABS(
      `<ul aria-label="Case sections" class="lt-tabs__list"><li><a href="#claim">Claim</a></li><li><a href="#attachments">Attachments</a></li></ul>`,
    ),
  },
  {
    name: "a tab list with aria-labelledby",
    html: `<h2 id="parts">Parts of the claim</h2>${TABS(`<ul class="lt-tabs__list" aria-labelledby="parts"><li><a href="#claim">Claim</a></li><li><a href="#attachments">Attachments</a></li></ul>`)}`,
    count: 0,
  },
  {
    name: "a tab list with a bound aria-label",
    html: TABS(
      `<ul class="lt-tabs__list" :aria-label="handle"><li><a href="#claim">Claim</a></li><li><a href="#attachments">Attachments</a></li></ul>`,
    ),
    count: 0,
  },
  {
    name: "the help text inside the label",
    html: `<lt-field><label class="lt-label" for="email">Email <span class="lt-help-text">We never send adverts.</span></label><input class="lt-input" id="email" name="email"></lt-field>`,
    count: 1,
    mentions: ["The help text is inside <label>", "part of the field's name"],
    covers: "span",
  },
  {
    name: "the error text inside the label",
    html: `<lt-field><label class="lt-label" for="email">Email <span class="lt-error-text">Enter an email address.</span></label><input class="lt-input" id="email" name="email"></lt-field>`,
    count: 1,
    mentions: ["The error text is inside <label>"],
  },
  {
    name: "the help text next to the label",
    html: `<lt-field><label class="lt-label" for="email">Email</label><input class="lt-input" id="email" name="email"><p class="lt-help-text">We never send adverts.</p></lt-field>`,
    count: 0,
  },
  {
    name: "options with data-value without a value field",
    html: `<lt-suggestion><label class="lt-label" for="k">Target</label><input class="lt-input" id="k" name="k"><ul class="lt-suggestion__list"><li data-value="4601">Crowbar</li></ul><span class="lt-sr-only" role="status"></span></lt-suggestion>`,
    count: 1,
    mentions: ["data-value, but no .lt-suggestion__value"],
    covers: "li",
  },
  {
    name: "a value field without options with data-value",
    html: `<lt-suggestion><label class="lt-label" for="k">Target</label><input class="lt-input" id="k" name="k"><input type="hidden" class="lt-suggestion__value" name="number"><ul class="lt-suggestion__list"><li>Crowbar</li></ul><span class="lt-sr-only" role="status"></span></lt-suggestion>`,
    count: 1,
    mentions: ["no options with data-value"],
    covers: "input",
  },
  {
    name: "data-value and a value field together",
    html: `<lt-suggestion><label class="lt-label" for="k">Target</label><input class="lt-input" id="k" name="k"><input type="hidden" class="lt-suggestion__value" name="number"><ul class="lt-suggestion__list"><li data-value="4601">Crowbar</li></ul><span class="lt-sr-only" role="status"></span></lt-suggestion>`,
    count: 0,
  },
  {
    name: "an empty list the server fills later",
    html: `<lt-suggestion><label class="lt-label" for="k">Target</label><input class="lt-input" id="k" name="k"><input type="hidden" class="lt-suggestion__value" name="number"><ul class="lt-suggestion__list"></ul><span class="lt-sr-only" role="status"></span></lt-suggestion>`,
    count: 0,
  },
  {
    name: "a hidden error text next to aria-invalid",
    html: `<lt-field><label class="lt-label" for="budget">Budget</label><input class="lt-input" id="budget" name="budget" aria-invalid="true"><p class="lt-error-text" hidden>Enter the budget in EB.</p></lt-field>`,
    count: 1,
    mentions: ["The error text has hidden", 'aria-invalid="true"'],
    covers: "p",
  },
  {
    name: "a hidden error text on a valid field",
    html: `<lt-field><label class="lt-label" for="budget">Budget</label><input class="lt-input" id="budget" name="budget"><p class="lt-error-text" hidden>Enter the budget in EB.</p></lt-field>`,
    count: 0,
  },
  {
    name: "an error text Datastar hides is up to the server",
    html: `<lt-field><label class="lt-label" for="budget">Budget</label><input class="lt-input" id="budget" name="budget" aria-invalid="true"><p class="lt-error-text" data-attr:hidden="!$failed">Enter the budget in EB.</p></lt-field>`,
    count: 0,
  },
  {
    name: "invalid on lt-field, as it used to be written",
    html: `<lt-field invalid><label class="lt-label" for="budget">Budget</label><input class="lt-input" id="budget" name="budget"></lt-field>`,
    count: 1,
    mentions: ["invalid has been removed from <lt-field>", "aria-invalid"],
    covers: "invalid",
    fixTitle: "Remove invalid",
    fixed: `<lt-field><label class="lt-label" for="budget">Budget</label><input class="lt-input" id="budget" name="budget"></lt-field>`,
  },
  {
    name: "required-marker on lt-field, as it used to be written",
    html: `<lt-field required-marker="*"><label class="lt-label" for="budget">Budget</label><input class="lt-input" id="budget" name="budget"></lt-field>`,
    count: 1,
    mentions: ["data-required"],
    fixed: `<lt-field><label class="lt-label" for="budget">Budget</label><input class="lt-input" id="budget" name="budget"></lt-field>`,
  },
  {
    name: "an id the component made itself, copied into the template",
    html: `<lt-field><label class="lt-label" for="e">Email</label><input class="lt-input" id="e" name="email"><p class="lt-help-text" id="lt-field-help-a1b2c3d">Help</p></lt-field>`,
    count: 1,
    mentions: ["copied from DevTools"],
    covers: "lt-field-help-a1b2c3d",
  },
  {
    name: "an id from createFieldId, copied into the template",
    html: `<lt-field><label class="lt-label" for="lt-field-3-k2x9qa">Email</label><input class="lt-input" id="lt-field-3-k2x9qa" name="email"></lt-field>`,
    count: 1,
    mentions: ["copied from DevTools"],
  },
  {
    name: "the same id on a rendered page is correct",
    html: `<lt-field><label class="lt-label" for="e">Email</label><input class="lt-input" id="e" name="email" aria-describedby="lt-field-help-a1b2c3d"><p class="lt-help-text" id="lt-field-help-a1b2c3d">Help</p></lt-field>`,
    count: 0,
    page: true,
  },
  {
    name: "a custom id starting with lt-",
    html: `<lt-field><label class="lt-label" for="e">Email</label><input class="lt-input" id="e" name="email"><p class="lt-help-text" id="lt-field-help">Help</p></lt-field>`,
    count: 0,
  },
  {
    name: "an encoded fragment finds its panel, as in the browser",
    html: TABS(
      `<ul class="lt-tabs__list" aria-label="Parts"><li><a href="#caf%C3%A9">Claim</a></li></ul>`,
      `<section class="lt-tabs__panel" id="café"></section>`,
    ),
    count: 0,
  },
  {
    name: "invalid bound in Datastar, as the old recipe wrote it",
    html: `<lt-field data-attr:invalid="$failed"><label class="lt-label" for="e">Email</label><input class="lt-input" id="e"></lt-field>`,
    count: 1,
    mentions: ["invalid has been removed from <lt-field>"],
    fixTitle: "Remove data-attr:invalid",
    fixed: `<lt-field><label class="lt-label" for="e">Email</label><input class="lt-input" id="e"></lt-field>`,
  },
  {
    name: "invalid bound in Vue",
    html: `<lt-field :invalid="failed"><label class="lt-label" for="e">Email</label><input class="lt-input" id="e"></lt-field>`,
    count: 1,
    mentions: ["invalid has been removed from <lt-field>"],
  },
  {
    name: "the ids the suggestion field makes itself, copied into the template",
    html: `<lt-suggestion><label class="lt-label" for="k">Target</label><input class="lt-input" id="k"><ul class="lt-suggestion__list" id="lt-suggestion-list-a1b2c3d" aria-labelledby="lt-suggestion-label-z8y7x6w"><li id="lt-suggestion-option-q9w8e7r">Crowbar</li></ul><span id="lt-suggestion-label-z8y7x6w"></span></lt-suggestion>`,
    count: 3,
    mentions: ["copied from DevTools"],
  },
  {
    name: "a bound for on the label is up to the server",
    html: `<lt-suggestion><label class="lt-label" :for="'k'">Target</label><input class="lt-input" id="k"><ul class="lt-suggestion__list"><li>Crowbar</li></ul></lt-suggestion>`,
    count: 0,
  },
  {
    name: "[attr.id] and [attr.for] in Angular are up to the server",
    html: `<lt-field><label class="lt-label" [attr.for]="id">Target</label><input class="lt-input" [attr.id]="id" name="target"></lt-field>`,
    count: 0,
  },
  {
    name: "the message about a panel without an id is plain text",
    html: `<lt-popover><button class="lt-button" type="button">Menu</button><div class="lt-popover" popover>Contents</div></lt-popover>`,
    count: 1,
    notMentions: ["`"],
  },
  {
    name: "a host in a loop in the template is up to the server",
    html: `{{ range .Fields }}<lt-field><label class="lt-label">{{ .Handle }}</label><input class="lt-input" name="{{ .Handle }}"></lt-field>{{ end }}`,
    count: 0,
  },
  {
    name: "a label with v-if is up to the server",
    html: `<lt-field><label class="lt-label" v-if="show">Target</label><input class="lt-input" name="target"></lt-field>`,
    count: 0,
  },
)

for (const c of cases) {
  const fail = (message: string) => findings.push(`${c.name}: ${message}`)
  let found: Finding[]
  const before = performance.now()
  try {
    found = c.page ? core.diagnosePage(c.html) : core.diagnoseMarkup(c.html)
  } catch (error) {
    fail(`threw: ${error instanceof Error ? error.message : String(error)}`)
    continue
  }
  // The time limit is a local guard for the cache, not a claim about a
  // shared CI machine: there the wall clock can go red with nothing wrong.
  const took = performance.now() - before
  if (c.maxMs && took > c.maxMs && !process.env.CI)
    fail(`took ${Math.round(took)} ms, and must take less than ${c.maxMs}`)
  if (found.length !== c.count) {
    fail(
      `expected ${c.count} findings, got ${found.length}: ${found.map((f) => f.message).join(" | ") || "none"}`,
    )
    continue
  }
  if (!found.length) continue
  const first = found[0]
  for (const m of c.mentions ?? [])
    if (!first.message.includes(m))
      fail(`the message does not mention "${m}": ${first.message}`)
  for (const m of c.notMentions ?? [])
    if (first.message.includes(m))
      fail(`the message mentions "${m}": ${first.message}`)
  if (c.severity && first.severity !== c.severity)
    fail(`expected ${c.severity}, got ${first.severity}`)
  if (c.covers) {
    const covered = c.html.slice(first.start, first.end)
    if (covered !== c.covers)
      fail(`the finding covers "${covered}", not "${c.covers}"`)
  }
  if (c.coversAt !== undefined && first.start !== c.coversAt)
    fail(`the finding starts at ${first.start}, not at ${c.coversAt}`)
  if (!first.link.startsWith("https://lo-tek.sobernetics.no/"))
    fail(`the link does not point at the documentation: ${first.link}`)
  if (c.noFix && first.fix)
    fail(
      `the finding has a fix, "${first.fix.edits.map((e) => e.text).join('", "')}", and should not have one`,
    )
  if (c.fixed !== undefined || c.fixTitle || c.fixPreferred !== undefined) {
    if (!first.fix) fail("the finding has no fix")
    else {
      // From the end, so the positions in the first edits hold.
      const applied = [...first.fix.edits]
        .sort((a, b) => b.start - a.start)
        .reduce(
          (text, e) => text.slice(0, e.start) + e.text + text.slice(e.end),
          c.html,
        )
      if (c.fixed !== undefined && applied !== c.fixed)
        fail(`the fix gave "${applied}", not "${c.fixed}"`)
      if (c.fixTitle && first.fix.title !== c.fixTitle)
        fail(`the fix is called "${first.fix.title}", not "${c.fixTitle}"`)
      const preferred = first.fix.preferred ?? false
      if (c.fixPreferred !== undefined && preferred !== c.fixPreferred)
        fail(
          `the fix is ${preferred ? "" : "not "}preferred, and should ${c.fixPreferred ? "" : "not "}have been`,
        )
    }
  }
}

const elapsed = performance.now() - started
if (elapsed > 2000)
  findings.push(
    `all the cases took ${Math.round(elapsed)} ms, and must take less than 2000`,
  )

if (findings.length) {
  console.error(
    `The diagnostics fail on ${findings.length} points:\n  ${findings.join("\n  ")}`,
  )
  process.exit(1)
}
console.log(
  `The diagnostics pass ${cases.length} cases, ${Object.keys(all).length} elements and ${Object.keys(classes).length} classes.`,
)
