/// <reference path="../../../types/css.d.ts" />
/// <reference path="../../../testing/vite-url.d.ts" />

/**
 * Every sequence of server updates and user actions on a field, to a fixed
 * depth, with the screen reader's view checked after each step.
 *
 * The scenario tests in `lt-field.browser.test.ts` each follow one path:
 * a patch, then a look. This one does not choose: the server can send any of
 * the versions below, by any of the ways an update arrives, and the user can
 * move into the field, type and leave it, in any order. After every step the
 * page as the browser rendered it goes to the core, which computes the
 * accessibility tree from the specifications, and the invariants are checked
 * on that tree and on the wiring the component promises.
 *
 * The page is the recipe from the component page, the component is the real
 * one, and so are Datastar and idiomorph. The core's tree is compared with
 * what Chromium and Firefox give through AT-SPI in
 * `check-accessibility-tree.ts`.
 */

import { beforeAll, describe, expect, it, vi } from "vitest"
import { server } from "vitest/browser"
import page from "../../../../../documentation/src/content/docs/components/field.mdx?raw"
import coreUrl from "../../../../core/lotek-core.wasm?url"
import {
  type AccessibilityCore,
  type AxNode,
  accessibilityCore,
} from "../../../testing/accessibility"
import { attr } from "../../../testing/markup"
import {
  exploreSequences,
  exploreStates,
  type Model,
  unchecked,
} from "../../../testing/model"
import { htmlBlocks, tabItems } from "../../../testing/recipes"
import { renderedMarkup } from "../../../testing/rendered"
import {
  REPLACEMENTS,
  type Replacement,
  replace,
} from "../../../testing/update"
import labelCss from "../../css/label/label.css?inline"
import { computeFieldAttributes } from "./field-core"
import { defineLtField } from "./lt-field"

import "../../../tokens/tokens.css"
import "./field.css"

/** The form in the "Plain HTML" recipe, without its scripts. */
const RECIPE = (() => {
  const block = tabItems(page)
    .filter((t) => t.name === "Plain HTML")
    .flatMap((t) => htmlBlocks(t.code))
    .find((b) => b.includes("<lt-field"))
  if (!block) throw new Error("no recipe with <lt-field> on the page")
  return block.replace(/<script[\s\S]*?<\/script>/g, "")
})()

/** The recipe's form: what the server sends again, by its id. */
const FORM = RECIPE.match(/<form[\s\S]*?<\/form>/)?.[0]
if (!FORM) throw new Error("no <form> in the recipe")
const FORM_ID = FORM.match(/^<form[^>]*\sid="([^"]+)"/)?.[1]
if (!FORM_ID) throw new Error("the recipe's form has no id to update it by")

/** The recipe's field, as the server renders it before a submission. */
const FIELD = RECIPE.match(/<lt-field[\s\S]*?<\/lt-field>/)?.[0]
if (!FIELD) throw new Error("no <lt-field> in the recipe")

/** `text` with `from` replaced, which must be there: a recipe that changed would otherwise test nothing. */
function swap(text: string, from: string | RegExp, to: string): string {
  const out = text.replace(from, to)
  if (out === text)
    throw new Error(`the recipe has no ${String(from)} to replace`)
  return out
}

/** The label's text, the error text and the control's id, read from the recipe. */
const LABEL = FIELD.match(/<label[^>]*>([^<]+)<\/label>/)?.[1] ?? ""
const ERROR = FIELD.match(/<p class="lt-error-text"[^>]*>([^<]+)<\/p>/)?.[1]
const CONTROL_ID = FIELD.match(/<input[^>]*\sid="([^"]+)"/)?.[1]
if (!LABEL || !ERROR || !CONTROL_ID)
  throw new Error("the recipe's field has no label, error text or control id")

/**
 * The markers as the stylesheet gives them: the fallbacks in `label.css`,
 * which no token in the test overrides. The core reads them from
 * `::after`, so the name carries them.
 */
function marker(variable: string): string {
  const found = labelCss.match(
    new RegExp(`var\\(${variable},\\s*"([^"]*)"\\)`),
  )?.[1]
  if (found === undefined) throw new Error(`label.css has no ${variable}`)
  return found
}
const SYMBOL = marker("--lt-label-required-symbol")
const REQUIRED = marker("--lt-label-required-text")
const OPTIONAL = marker("--lt-label-optional-text")

const HELP = "The name the crew answers to. Never the real one."
const FORMAT = "Letters and digits only."
const CHANGED = "Enter a codename the crew answers to."

const shown = (field: string) =>
  swap(field, '<p class="lt-error-text" hidden>', '<p class="lt-error-text">')
const withHelp = (field: string) =>
  swap(field, /(<input[^>]*>)/, `$1<p class="lt-help-text">${HELP}</p>`)

// What `lt.field()` writes, on a server that runs JavaScript and still
// registers the component: the whole wiring, with its own ids.
const BUILT = computeFieldAttributes({
  id: CONTROL_ID,
  required: "symbol",
  help: true,
  error: true,
  invalid: true,
})

/**
 * What the server can send: the field, and what the screen reader must be
 * given once it has settled. `description` is the visible texts in the
 * order the component joins them: help, error, the server's own ids, then
 * `described-by`.
 */
type Version = {
  field: string
  name: string
  description: string
  invalid: boolean
  disabled: boolean
  /** The id the server wrote on the control, or "" for none. */
  controlId: string
}

const plain = {
  name: `${LABEL}${SYMBOL}`,
  description: "",
  invalid: false,
  disabled: false,
  controlId: CONTROL_ID,
}

const VERSIONS: Record<string, Version> = {
  valid: { ...plain, field: FIELD },
  invalid: {
    ...plain,
    field: shown(FIELD),
    description: ERROR,
    invalid: true,
  },
  help: { ...plain, field: withHelp(FIELD), description: HELP },
  // The server says invalid, and the error text stays hidden: invalid, and
  // nothing hidden is read as the description.
  server: {
    ...plain,
    field: swap(FIELD, /(<input[^>]*?)\s*\/>/, '$1 aria-invalid="true" />'),
    invalid: true,
  },
  // A new message in the same node: a morph changes only the text.
  changed: {
    ...plain,
    field: swap(shown(FIELD), `>${ERROR}<`, `>${CHANGED}<`),
    description: CHANGED,
    invalid: true,
  },
  builder: {
    ...plain,
    field: `<lt-field><label ${attr(BUILT.label)}>${LABEL}</label><input class="lt-input" ${attr(BUILT.control)} type="text" name="codename" required /><p class="lt-help-text" ${attr(BUILT.help)}>${HELP}</p><p class="lt-error-text" ${attr(BUILT.error)}>${ERROR}</p></lt-field>`,
    description: `${HELP} ${ERROR}`,
    invalid: true,
  },
  text: {
    ...plain,
    field: swap(FIELD, 'data-required="symbol"', 'data-required="text"'),
    name: `${LABEL}${REQUIRED}`,
  },
  optional: {
    ...plain,
    field: swap(
      swap(swap(FIELD, "<lt-field>", "<lt-field optional>"), / required\b/, ""),
      ' data-required="symbol"',
      "",
    ),
    name: `${LABEL}${OPTIONAL}`,
  },
  disabled: {
    ...plain,
    field: swap(FIELD, "<lt-field>", "<lt-field disabled>"),
    disabled: true,
  },
  // No id and no `for`: the label wraps the control, which HTML names by.
  wrapped: {
    ...plain,
    field: swap(
      FIELD,
      /<label([^>]*?) for="[^"]*"([^>]*)>([^<]*)<\/label>\s*(<input[^>]*?) id="[^"]*"([^>]*>)/,
      "<label$1$2>$3 $4$5</label>",
    ),
    controlId: "",
  },
  // An extra description named by the host.
  hosted: {
    ...plain,
    field: swap(
      swap(FIELD, "<lt-field>", '<lt-field described-by="name-format">'),
      /(<input[^>]*>)/,
      `$1<p id="name-format">${FORMAT}</p>`,
    ),
    description: FORMAT,
  },
  // The same, written by the server on the control, with a help text the
  // component wires in front of it.
  described: {
    ...plain,
    field: swap(
      withHelp(FIELD),
      /(<input[^>]*?)\s*\/>/,
      `$1 aria-describedby="name-format" /><p id="name-format">${FORMAT}</p>`,
    ),
    description: `${HELP} ${FORMAT}`,
  },
  // A second control: only the first is wired, and the component says so.
  // With a help text, or there would be no wiring to put on the wrong one.
  second: {
    ...plain,
    field: swap(
      withHelp(FIELD),
      /(<input[^>]*>)/,
      '$1<input class="lt-input" type="text" name="nickname" />',
    ),
    description: HELP,
  },
}

// The field is taken from the form, so it is there; `valid` is the form as it is.
const form = (version: string) =>
  (FORM as string).replace(FIELD, () => VERSIONS[version].field)

type Step =
  | { send: string; way: Replacement }
  | { user: "focus" | "type" | "blur" }

/*
 * The form is the region the server sends: the recipe gives it the id an
 * update finds it by, and the field has none. `innerHTML` on the form is
 * not a way of its own here: like `outerHTML` it makes a new field, with no
 * memory and no focus to keep.
 *
 * Every version goes by both morphers, and only two by `outerHTML`: a new
 * field is the version mounted afresh, and every one gave a state of its
 * own, since the nodes are new. The two are those where a fresh component
 * meets the server's word first: the server's `aria-invalid`, and the
 * whole wiring from `lt.field()`.
 */
const FRESH = new Set(["server", "builder"])

const STEPS: Step[] = [
  ...Object.keys(VERSIONS).flatMap((send) =>
    REPLACEMENTS.filter((way) => way !== "outerHTML" || FRESH.has(send)).map(
      (way) => ({ send, way }),
    ),
  ),
  { user: "focus" },
  { user: "type" },
  { user: "blur" },
]

/*
 * The state search, which runs in every engine, sends eight of the
 * versions. With all thirteen, and `valid` by `outerHTML` too, it took 1 min 28 s in Chromium, 4 min 6 s in
 * Firefox and 9 min 25 s in WebKit, the three running side by side. The
 * five left out (`changed`, `text`, `optional`, `hosted`, `described`) are
 * the label, the error text and `aria-describedby` again in another form,
 * and the search over sequences in Chromium sends them all.
 */
const EVERY_ENGINE = new Set([
  "valid",
  "invalid",
  "help",
  "server",
  "builder",
  "disabled",
  "wrapped",
  "second",
])
const STATE_STEPS = STEPS.filter(
  (s) => !("send" in s) || EVERY_ENGINE.has(s.send),
)

const TYPED = "Alex"

/** The first control in the field: the one the component wires. */
const control = () =>
  document.querySelector<HTMLInputElement>("lt-field input") ?? null

function apply(step: Step): void {
  if ("send" in step) {
    replace(step.way, FORM_ID as string, form(step.send))
    return
  }
  const c = control()
  if (!c) return
  if (step.user === "focus") c.focus()
  else if (step.user === "blur") c.blur()
  // The user only types into the field that has focus.
  else if (document.activeElement === c) {
    c.value = TYPED
    c.dispatchEvent(new Event("input", { bubbles: true }))
  }
}

const label = (step: Step) =>
  "send" in step ? `${step.send} by ${step.way}` : step.user

let core: AccessibilityCore

type Snapshot = {
  tree: AxNode[]
  control: HTMLInputElement | null
  value: string
  focused: boolean
  /** The control's attributes, as written, to see churn. */
  attributes: string
  help: Element | null
  error: Element | null
}

function snapshot(): Snapshot {
  const c = control()
  return {
    tree: core.tree(renderedMarkup()),
    control: c,
    value: c?.value ?? "",
    focused: c !== null && document.activeElement === c,
    attributes: c
      ? // In name order: the order of attributes means nothing in HTML.
        [...c.attributes]
          .map((a) => `${a.name}="${a.value}"`)
          .sort()
          .join(" ")
      : "",
    help: document.querySelector("lt-field .lt-help-text"),
    error: document.querySelector("lt-field .lt-error-text"),
  }
}

/** How often each invariant actually had something to check. */
const seen = {
  name: 0,
  description: 0,
  invalid: 0,
  disabled: 0,
  controlId: 0,
  ids: 0,
  references: 0,
  second: 0,
  kept: 0,
  value: 0,
  typed: 0,
  stable: 0,
}

/** Every id some version sends, on any element. */
const SENT_IDS = new Set(
  [FORM, ...Object.values(VERSIONS).map((v) => v.field)].flatMap((html) =>
    [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]),
  ),
)

function violations(
  before: Snapshot,
  after: Snapshot,
  step: Step,
  was: string,
  now: string,
): string[] {
  const problems: string[] = []
  const version = VERSIONS[now]
  const boxes = after.tree.filter((n) => n.role === "textbox")
  const box = boxes[0]
  if (!box) return ["no textbox in the tree"]

  // The field is named by its label, with the marker the stylesheet adds.
  seen.name++
  if (box.name !== version.name)
    problems.push(`the field is named "${box.name}", not "${version.name}"`)

  // The description is what the page shows, in order: a hidden error text
  // is never read.
  seen.description++
  if (box.description !== version.description)
    problems.push(
      `the field is described as "${box.description}", not "${version.description}"`,
    )

  /*
   * Invalid exactly when the error text shows or the server says so. The
   * browser can also say so: Firefox matches `:user-invalid` on the empty
   * required field once idiomorph has set its value and the user has left
   * it, and HTML-AAM exposes that as invalid. That is the browser's state,
   * which the component neither writes nor can prevent, so there the
   * component's part is checked on the `aria-invalid` it leaves.
   */
  seen.invalid++
  const said = after.control?.getAttribute("aria-invalid")
  const invalid = after.control?.matches(":user-invalid")
    ? said != null && said !== "false" && said !== ""
    : box.states.includes("invalid")
  /*
   * Also when the server sends the `aria-invalid="true"` the component had
   * already written: a morph leaves an attribute whose value is right, and
   * the component took it for its own echo and removed it, until it marked
   * what it writes (`WRITTEN` in `host-element.ts`).
   */
  if (invalid !== version.invalid)
    problems.push(
      version.invalid
        ? "the field is not invalid, though the server said so"
        : "the field is invalid, though the server sent a valid one",
    )

  // `disabled` on the host disables the control itself.
  seen.disabled++
  if (box.states.includes("disabled") !== version.disabled)
    problems.push(
      version.disabled
        ? "the field is not disabled, though the host is"
        : "the field is disabled, though nothing said so",
    )

  // The component never writes an id on the control: a morph would replace
  // a control with an id the server did not send, with the focus and the
  // text in it.
  seen.controlId++
  if ((after.control?.id ?? "") !== version.controlId)
    problems.push(
      `the control has the id "${after.control?.id}", not the server's "${version.controlId}"`,
    )

  // Every id is one a server sent, except on the help and error texts,
  // which hold nothing the user can lose; and no id is there twice.
  const ids = [...document.querySelectorAll("#lt-test-surface [id]")]
  seen.ids++
  for (const e of ids)
    if (
      !SENT_IDS.has(e.id) &&
      !e.matches("lt-field .lt-help-text, lt-field .lt-error-text")
    )
      problems.push(
        `a <${e.localName}> has the id "${e.id}", which no server sent`,
      )
  const all = ids.map((e) => e.id)
  const twice = all.filter((id, i) => all.indexOf(id) !== i)
  if (twice.length > 0) problems.push(`two elements have the id "${twice[0]}"`)

  // aria-describedby points only at elements that are there.
  const describedBy = after.control?.getAttribute("aria-describedby")
  if (describedBy) {
    seen.references++
    for (const id of describedBy.split(/\s+/))
      if (!document.getElementById(id))
        problems.push(`aria-describedby points at "${id}", which is not there`)
  }

  // Only the first control is wired; the second keeps what the server sent.
  if (boxes.length > 1) {
    seen.second++
    const other = document.querySelectorAll("lt-field input")[1]
    for (const name of ["aria-describedby", "aria-invalid", "id"])
      if (other?.hasAttribute(name))
        problems.push(`the second control got ${name}`)
  }

  if (!("send" in step)) {
    // A user action: the component never changes the value.
    seen.value++
    const expected =
      step.user === "type" && before.focused ? TYPED : before.value
    if (after.value !== expected)
      problems.push(`the field holds "${after.value}", not "${expected}"`)
    return problems
  }

  const morph = step.way !== "outerHTML"
  const sameControl =
    morph && VERSIONS[was].controlId === version.controlId && before.control
  if (sameControl) {
    /*
     * A morph keeps a control whose id the server sent both times, and
     * with it the focus: the component wrote nothing a morph recognises a
     * node by. `outerHTML` makes a new field, and the focus goes with the
     * old one; and a version that adds or drops the id is a different
     * node to both morphers, by their own rule.
     */
    seen.kept++
    if (after.control !== before.control)
      problems.push("the update replaced the control")
    // HTML: a disabled control is not focusable, and the browser takes the
    // focus from it, in some engines at once and in others at the next
    // rendering, so a disabled version keeps the node only.
    else if (before.focused && !after.focused && !version.disabled)
      problems.push("the update took focus from the field")
    /*
     * What the field holds after a morph is the morpher's, never the
     * component's: Datastar leaves the value; idiomorph with
     * `ignoreActiveValue` leaves it in the focused field and sets the
     * server's (none) in any other.
     */
    /*
     * Not into a disabled version by idiomorph: it sets the attributes on
     * an element before it asks whether that element has focus, and the
     * host comes before the control. `disabled` on the host makes the
     * component disable the control at once, Chromium takes the focus from
     * it at once, and idiomorph then sets the server's empty value. A
     * server that writes `disabled` on the control itself loses the text
     * the same way, before any component runs.
     */
    const disabling =
      step.way === "idiomorph" && version.disabled && !VERSIONS[was].disabled
    if (after.control === before.control && !disabling) {
      const kept = step.way === "Datastar" || before.focused
      const expected = kept ? before.value : ""
      if (kept && before.value) seen.typed++
      if (after.value !== expected)
        problems.push(
          `the field holds "${after.value}" after ${step.way}, not "${expected}"`,
        )
    }
  }

  /*
   * The same version sent again by a morph changes nothing: the same
   * control, the same attributes on it, and the same help and error text
   * nodes with the same ids. A morph removes the wiring the server did not
   * send and the component writes it back, so records in between are the
   * morpher's; what the screen reader reads after must be what it read
   * before.
   */
  if (morph && now === was && before.control) {
    seen.stable++
    if (after.control !== before.control)
      problems.push("the same field sent again replaced the control")
    else if (after.attributes !== before.attributes)
      problems.push(
        `the same field sent again changed the control from ${before.attributes} to ${after.attributes}`,
      )
    for (const [name, b, a] of [
      ["help text", before.help, after.help],
      ["error text", before.error, after.error],
    ] as const)
      if (b?.id !== a?.id)
        problems.push(`the same field sent again changed the id of the ${name}`)
  }
  return problems
}

/** The search's view of this component: the version shown is the context. */
const model: Model<Step, Snapshot, string> = {
  recipe: RECIPE,
  steps: STATE_STEPS,
  apply,
  label,
  snapshot,
  initial: "valid",
  next: (shown, step) => ("send" in step ? step.send : shown),
  contextKey: (shown) => shown,
  violations,
  seen,
}

describe("lt-field, every sequence of updates and user actions", () => {
  beforeAll(async () => {
    // The second control is warned about, as it should be; the warning has
    // its own test in `messages.browser.test.ts`, and here it is noise.
    vi.spyOn(console, "warn").mockImplementation(() => {})
    defineLtField()
    core = accessibilityCore(await (await fetch(coreUrl)).arrayBuffer())
  })

  it("keeps the name, the description, the state, the ids, the focus and the text in every state to depth 3", async () => {
    const run = await exploreStates(model, 3)
    expect(run.found.slice(0, 10)).toEqual([])
    // The search found more states than one step gives.
    expect(run.states).toBeGreaterThan(STATE_STEPS.length)
    expect(unchecked(seen)).toEqual([])
  }, 600_000)

  /*
   * Every sequence, without merging states: what the component remembers
   * and the page does not show (the ids it wrote, what it wrote on each
   * control and label) only shows on a path. In Chromium only, and only by
   * the morphers: `outerHTML` makes a new field, with no memory to carry.
   */
  it.runIf(server.browser === "chromium")(
    "keeps the same invariants on every sequence of morphs to depth 3",
    async () => {
      const steps = STEPS.filter((s) => !("way" in s) || s.way !== "outerHTML")
      const run = await exploreSequences(model, 3, steps)
      expect(run.found.slice(0, 10)).toEqual([])
      expect(run.ran).toBe(steps.length ** 3)
      expect(unchecked(seen)).toEqual([])
    },
    600_000,
  )
})
