/// <reference path="../../../types/css.d.ts" />
/// <reference path="../../../testing/vite-url.d.ts" />

/**
 * Every sequence of server updates and user actions on a suggestion field,
 * to a fixed depth, with the screen reader's view checked after each step.
 *
 * The scenario tests in `lt-suggestion.browser.test.ts` each follow one
 * path: a keystroke, a patch, then a look. This one does not choose: the
 * server can send any of the versions below, by any of the ways an update
 * arrives, and the user can move into the field, type, clear it, move the
 * highlight, choose with Enter or a click, close with Escape and leave, in
 * any order. After every step the page as the browser rendered it goes to
 * the core, which computes the accessibility tree from the specifications,
 * and the invariants are checked on that tree, on the wiring the component
 * promises, on what the list shows, on the count it announces, on the
 * choice and on the ids.
 *
 * Whether the list must be open after a step, and which option must be
 * highlighted, is computed from what the page promises, from the page as it
 * stood before the step: the user's open list and highlight survive a
 * morph, and under `server-controlled` the server's word decides. What the
 * component remembers of the user is part of the context, so the state
 * search keeps apart two paths that differ only there.
 *
 * The page is the recipe from the component page. The component is the real
 * one, and so are Datastar and idiomorph.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { server } from "vitest/browser"
import page from "../../../../../documentation/src/content/docs/components/suggestion.mdx?raw"
import coreUrl from "../../../../core/lotek-core.wasm?url"
import {
  type AccessibilityCore,
  type AxNode,
  accessibilityCore,
} from "../../../testing/accessibility"
import { attr } from "../../../testing/markup"
import {
  canonical,
  exploreSequences,
  exploreStates,
  type Model,
  unchecked,
} from "../../../testing/model"
import { htmlBlocks, tabItems } from "../../../testing/recipes"
import { renderedMarkup } from "../../../testing/rendered"
import { type Replacement, replace } from "../../../testing/update"
import { DEFAULT_TEXTS } from "../../default-texts"
import { defineLtSuggestion } from "./lt-suggestion"
import { suggestion } from "./suggestion"

import "../../../tokens/tokens.css"
import "./suggestion.css"

/** The suggestion field in the "Plain HTML" recipe, without its scripts. */
const RECIPE = (() => {
  const block = tabItems(page)
    .filter((t) => t.name === "Plain HTML")
    .flatMap((t) => htmlBlocks(t.code))
    .find((b) => b.includes("<lt-suggestion"))
  if (!block) throw new Error("no recipe with <lt-suggestion> on the page")
  return block.replace(/<script[\s\S]*?<\/script>/g, "")
})()

/** The recipe's host: what the server sends again, by its id. */
const HOST = RECIPE.match(/<lt-suggestion[\s\S]*?<\/lt-suggestion>/)?.[0]
if (!HOST) throw new Error("no <lt-suggestion> in the recipe")
const HOST_TAG = HOST.match(/^<lt-suggestion[^>]*>/)?.[0] ?? ""
const HOST_ID = HOST_TAG.match(/\sid="([^"]+)"/)?.[1]
if (!HOST_ID)
  throw new Error("the recipe's suggestion field has no id to update it by")

/** `text` with `from` replaced, which must be there: a recipe that changed would otherwise test nothing. */
function swap(text: string, from: string | RegExp, to: string): string {
  const out = text.replace(from, to)
  if (out === text)
    throw new Error(`the recipe has no ${String(from)} to replace`)
  return out
}

/** The recipe's parts and texts, read from it. */
const LABEL = HOST.match(/<label[^>]*>([^<]+)<\/label>/)?.[1] ?? ""
const INPUT_TAG = HOST.match(/<input[^>]*>/)?.[0] ?? ""
const CONTROL_ID = INPUT_TAG.match(/\sid="([^"]+)"/)?.[1]
const CONTROL_NAME = INPUT_TAG.match(/\sname="([^"]+)"/)?.[1]
const LIST = HOST.match(/<ul[\s\S]*?<\/ul>/)?.[0] ?? ""
const LIST_TAG = LIST.match(/^<ul[^>]*>/)?.[0] ?? ""
const LI = [...LIST.matchAll(/<li>([^<]+)<\/li>/g)].map((m) => m[1])
const EMPTY_TAG = HOST.match(/<p class="lt-suggestion__empty"[^>]*>/)?.[0]
const EMPTY = HOST.match(/<p class="lt-suggestion__empty"[^>]*>([^<]+)</)?.[1]
const STATUS_TAG = HOST.match(/<span[^>]*role="status"[^>]*><\/span>/)?.[0]
// The recipe must be what the versions below change: a bare field with an
// id, a bare list of plain `<li>`, a visible empty message and an empty
// status element, none of them with an id or a role but the status.
if (
  !LABEL ||
  !CONTROL_ID ||
  !CONTROL_NAME ||
  LI.length < 2 ||
  !EMPTY_TAG ||
  !EMPTY ||
  !STATUS_TAG ||
  /\s(role|aria-[a-z]+)=/.test(INPUT_TAG) ||
  /\s(id|role|hidden)[\s=>]/.test(LIST_TAG) ||
  /\shidden/.test(EMPTY_TAG)
)
  throw new Error(
    "the recipe is not a bare field with an id, a bare list, an empty message and a status element",
  )
const [FIRST, SECOND] = LI as [string, string]

const withHost = (html: string, extra: string) =>
  swap(html, HOST_TAG, HOST_TAG.replace(/>$/, ` ${extra}>`))
const withInput = (html: string, extra: string) =>
  swap(html, INPUT_TAG, INPUT_TAG.replace(/>$/, ` ${extra}>`))
/** The list with other options, and the server's own attributes on it when given. */
const withList = (html: string, items: string, extra = "") =>
  swap(
    html,
    LIST,
    `${extra ? LIST_TAG.replace(/>$/, ` ${extra}>`) : LIST_TAG}${items}</ul>`,
  )
const li = (text: string, extra = "") =>
  `<li${extra ? ` ${extra}` : ""}>${text}</li>`

/** A third option, which only a changed list has. Starts with the letter the user types. */
const THIRD = "Boltcutter"
/** What the user types: one letter, which the first option and the third contain, and the second not. */
const LETTER = "b"
if (
  !FIRST.toLowerCase().includes(LETTER) ||
  SECOND.toLowerCase().includes(LETTER)
)
  throw new Error(
    `the recipe's options no longer split on "${LETTER}": choose another letter`,
  )

// What `lt.suggestion()` writes, on a server that runs JavaScript: the
// whole wiring, with the recipe's id, texts and classes.
const BUILT = suggestion({ id: CONTROL_ID, keys: ["first", "second"] })
const BUILDER = `${HOST_TAG}<label ${attr(BUILT.label)}>${LABEL}</label><input ${attr(BUILT.control)} name="${CONTROL_NAME}"><ul ${attr(BUILT.list)}>${LI.map((t, i) => `<li ${attr(BUILT.options[i])}>${t}</li>`).join("")}</ul><p ${attr(BUILT.empty)}>${EMPTY}</p><span ${attr(BUILT.status)}></span></lt-suggestion>`

const COUNTS = {
  "count-none": "Aucun résultat",
  "count-one": "{n} résultat",
  "count-other": "{n} résultats",
}

/** What the server can send. The host's attributes and the content are both in it. */
const VERSIONS: Record<string, string> = {
  // A bare field and a bare list: the component writes the rest.
  recipe: HOST,
  // The server answered a search the component cannot do (`spike`, the
  // alias for Needle) and sent only that match, with the empty message hidden.
  prefiltered: swap(
    withList(withHost(HOST, "prefiltered"), li(SECOND)),
    EMPTY_TAG,
    EMPTY_TAG.replace(/>$/, " hidden>"),
  ),
  // No options at all, and the empty message as the template writes it.
  empty: withList(HOST, ""),
  /*
   * The server decides: the list expanded and the second option
   * highlighted, both halves of the wiring, and the empty message hidden
   * since there are matches. The ids are the template's.
   */
  controlled: swap(
    withList(
      withInput(
        withHost(HOST, "server-controlled"),
        `role="combobox" aria-expanded="true" aria-controls="${CONTROL_ID}-list" aria-activedescendant="${CONTROL_ID}-option-second"`,
      ),
      li(FIRST, `id="${CONTROL_ID}-option-first"`) +
        li(SECOND, `id="${CONTROL_ID}-option-second" aria-selected="true"`),
      `id="${CONTROL_ID}-list"`,
    ),
    EMPTY_TAG,
    EMPTY_TAG.replace(/>$/, " hidden>"),
  ),
  builder: BUILDER,
  // The template writes the roles, and the component takes them as found.
  roles: withList(
    withInput(HOST, 'role="combobox"'),
    LI.map((t) => li(t, 'role="option"')).join(""),
    'role="listbox"',
  ),
  // The count in another language.
  counts: withHost(
    HOST,
    Object.entries(COUNTS)
      .map(([k, v]) => `${k}="${v}"`)
      .join(" "),
  ),
  // A code to submit: the hidden value field, and a code on each option.
  value: withList(
    swap(
      HOST,
      INPUT_TAG,
      `${INPUT_TAG}<input class="lt-suggestion__value" type="hidden" name="${CONTROL_NAME}-code">`,
    ),
    li(FIRST, 'data-value="first"') + li(SECOND, 'data-value="second"'),
  ),
  // The server sends back what was chosen: the text in the field and the
  // code in the value field.
  chosen: withList(
    swap(
      HOST,
      INPUT_TAG,
      `${INPUT_TAG.replace(/>$/, ` value="${SECOND}">`)}<input class="lt-suggestion__value" type="hidden" name="${CONTROL_NAME}-code" value="second">`,
    ),
    li(FIRST, 'data-value="first"') + li(SECOND, 'data-value="second"'),
  ),
  // Another list: a new option, which the arrow keys and a click skip.
  changed: withList(
    HOST,
    li(FIRST) + li(THIRD, 'aria-disabled="true"') + li(SECOND),
  ),
  // A field that accepts no input never opens the list.
  readonly: withInput(HOST, "readonly"),
}

/** What a version says, read from its markup once. */
type Info = {
  controlled: boolean
  prefiltered: boolean
  readonly: boolean
  /** The server's `aria-expanded` on the field. */
  expanded: boolean
  /** The option the server highlighted, by its text. */
  highlight: string | null
  /** The options, as the server sent them: text and code. */
  options: { label: string; value: string | null; disabled: boolean }[]
  /** The text the server wrote in the field, its `value` attribute. */
  text: string | null
  /** The server wrote `hidden` on the empty message. */
  emptyHidden: boolean
  /** Every id in the version. */
  ids: Set<string>
  /** What `innerHTML` on the list writes. */
  listInner: string
}

function info(html: string): Info {
  const t = document.createElement("template")
  t.innerHTML = html
  const host = t.content.querySelector("lt-suggestion") as Element
  const input = host.querySelector("input:not([type='hidden'])") as Element
  const list = host.querySelector("ul") as Element
  const options = [...list.querySelectorAll("li")]
  return {
    controlled: host.hasAttribute("server-controlled"),
    prefiltered: host.hasAttribute("prefiltered"),
    readonly: input.hasAttribute("readonly"),
    expanded: input.getAttribute("aria-expanded") === "true",
    highlight:
      options
        .find((o) => o.getAttribute("aria-selected") === "true")
        ?.textContent?.trim() ?? null,
    options: options.map((o) => ({
      label: (o.textContent ?? "").trim(),
      value: o.getAttribute("data-value"),
      disabled: o.getAttribute("aria-disabled") === "true",
    })),
    text: input.getAttribute("value"),
    emptyHidden:
      host.querySelector(".lt-suggestion__empty")?.hasAttribute("hidden") ??
      false,
    ids: new Set([...t.content.querySelectorAll("[id]")].map((e) => e.id)),
    listInner: list.innerHTML,
  }
}
const INFO = Object.fromEntries(
  Object.entries(VERSIONS).map(([name, html]) => [name, info(html)]),
)

type Way = Replacement | "innerHTML"
type Action =
  | "focus"
  | "type"
  | "clear"
  | "ArrowDown"
  | "ArrowUp"
  | "Enter"
  | "Escape"
  | "click option"
  | "blur"
type Step = { send: string; way: Way } | { user: Action }

/*
 * `innerHTML` on the list keeps the host, the field and the list node, and
 * replaces the options, as the Datastar recipe on the page does with its
 * list; it carries only the versions whose options differ from the
 * recipe's, and the recipe's own.
 */
const WAYS: Way[] = ["Datastar", "idiomorph", "outerHTML", "innerHTML"]
const SENDS: Step[] = Object.keys(VERSIONS).flatMap((send) =>
  WAYS.filter(
    (way) =>
      way !== "innerHTML" ||
      send === "recipe" ||
      (INFO[send].listInner !== INFO.recipe.listInner &&
        !INFO[send].controlled &&
        !INFO[send].prefiltered &&
        send !== "builder" &&
        send !== "roles"),
  ).map((way) => ({ send, way })),
)
const ACTIONS: Step[] = (
  [
    "focus",
    "type",
    "clear",
    "ArrowDown",
    "ArrowUp",
    "Enter",
    "Escape",
    "click option",
    "blur",
  ] as Action[]
).map((user) => ({ user }))
const STEPS: Step[] = [...SENDS, ...ACTIONS]

function label(step: Step): string {
  return "send" in step ? `${step.send} by ${step.way}` : step.user
}

const pick = (steps: Step[], names: string[]) => {
  const picked = steps.filter((s) => names.includes(label(s)))
  if (picked.length !== names.length)
    throw new Error(
      `no step called ${names.filter((n) => !steps.some((s) => label(s) === n)).join(", ")}`,
    )
  return picked
}

/*
 * Neither search can take every step to depth 3 in time. With all 47, the
 * state search took 49 s in Chromium alone, over 5010 states. The steps
 * are cut, not the invariants. The state search, in every engine, keeps
 * 28: every version by Datastar; idiomorph for the versions where it
 * differs from Datastar (the recipe, the server's state, and the two with a
 * value field, where the two morphers treat the text differently);
 * `outerHTML` for the two versions a fresh component meets with the
 * server's word first; `innerHTML` for a changed and an emptied list; and
 * every user action. The search over sequences, in Chromium, keeps 22:
 * every version by Datastar, the recipe by idiomorph, a changed list by
 * `innerHTML`, and every user action.
 */
const STATE_STEPS = pick(STEPS, [
  ...Object.keys(VERSIONS).map((v) => `${v} by Datastar`),
  ...["recipe", "controlled", "value", "chosen"].map(
    (v) => `${v} by idiomorph`,
  ),
  "controlled by outerHTML",
  "prefiltered by outerHTML",
  "changed by innerHTML",
  "empty by innerHTML",
  ...ACTIONS.map(label),
])
const SEQUENCE_STEPS = pick(STEPS, [
  ...Object.keys(VERSIONS).map((v) => `${v} by Datastar`),
  "recipe by idiomorph",
  "changed by innerHTML",
  ...ACTIONS.map(label),
])
/** What the sequences leave out, and the state search checks in every engine. */
const UNSEEN_IN_SEQUENCES: string[] = []

/** An option as the model knows it: by its text and code, as the component does. */
type Known = { label: string; value: string | null }
const same = (a: Known | null | undefined, b: Known | null | undefined) =>
  (a ?? null) === null
    ? (b ?? null) === null
    : b != null && a?.label === b.label && a?.value === b.value

/**
 * The context: which version the host and the field came from, which the
 * options came from, and what the component holds of the user: whether she
 * left the list open, and which option she highlighted. That memory is not
 * in the page, and it decides what a morph leads to.
 */
type Context = {
  host: string
  list: string
  /** The user's open: `undefined` when she has not said, or the server took over. */
  wants: boolean | undefined
  /** The user's highlight. */
  active: Known | null
  /** Nothing but updates since the version was sent: the page is as it left it. */
  fresh: boolean
}

const INITIAL: Context = {
  host: "recipe",
  list: "recipe",
  wants: undefined,
  active: null,
  fresh: true,
}

/** What the step must lead to, computed in `apply` from the page before it. */
type Expectation = {
  /** Whether the list is open after, or null when the page promises nothing exact. */
  open: boolean | null
  why: "user" | "server" | "controlled" | "memory" | null
  /** The highlighted option after, or undefined when not modelled. */
  highlight: Known | null | undefined
  /** The option the step must choose, or null for none. */
  chosen: Known | null
  /** What the field holds after an update, by the morpher's rule; null after a user step. */
  text: string | null
  /** The step is a keystroke or a focus: under `prefiltered` it announces nothing. */
  keystroke: boolean
  context: Context
}

let current: Context = INITIAL
let expectation: Expectation = {
  open: null,
  why: null,
  highlight: undefined,
  chosen: null,
  text: null,
  keystroke: false,
  context: INITIAL,
}

const host = () => document.getElementById(HOST_ID as string)
const controlOf = (h: Element | null) =>
  h?.querySelector<HTMLInputElement>("input:not([type='hidden'])") ?? null
const listOf = (h: Element | null) =>
  h?.querySelector<HTMLElement>(":scope > ul") ?? null
const optionsOf = (h: Element | null) => [
  ...(h?.querySelectorAll<HTMLElement>(":scope > ul > li") ?? []),
]
const valueFieldOf = (h: Element | null) =>
  h?.querySelector<HTMLInputElement>("input.lt-suggestion__value") ?? null
const known = (o: Element): Known => ({
  label: (o.textContent ?? "").trim(),
  value: o.getAttribute("data-value"),
})
const disabled = (o: { getAttribute(n: string): string | null }) =>
  o.getAttribute("aria-disabled") === "true"
/** The list is open: not `hidden`, and in the top layer. */
const isOpen = (list: HTMLElement | null) =>
  list !== null && !list.hidden && list.matches(":popover-open")
const matching = (text: string, query: string) =>
  query.trim() === "" ||
  text.trim().toLowerCase().includes(query.trim().toLowerCase())

/**
 * The options the list shows after the component has filtered for `query`:
 * the matching ones, or under `prefiltered` the ones the server shows.
 */
function filtered<T extends { label: string; hidden?: boolean }>(
  options: T[],
  query: string,
  prefiltered: boolean,
): T[] {
  return prefiltered
    ? options.filter((o) => !o.hidden)
    : options.filter((o) => matching(o.label, query))
}

/** The options of the page now, as the model reads them. */
const pageOptions = (h: Element | null) =>
  optionsOf(h).map((o) => ({
    ...known(o),
    hidden: Boolean(o.hidden),
    disabled: disabled(o),
    selected: o.getAttribute("aria-selected") === "true",
  }))

/** What a user action must do, from the page as it stands. */
function expectAction(ctx: Context, action: Action): Expectation {
  const h = host()
  const c = controlOf(h)
  const list = listOf(h)
  const open = isOpen(list)
  const prefiltered = h?.hasAttribute("prefiltered") ?? false
  const focused = c !== null && document.activeElement === c
  const locked = Boolean(c?.readOnly || c?.disabled)
  const options = pageOptions(h)
  const highlighted = options.find((o) => o.selected && !o.hidden) ?? null
  const value = c?.value ?? ""
  const unchanged: Expectation = {
    open,
    why: "user",
    highlight: open ? highlighted : null,
    chosen: null,
    text: null,
    keystroke: false,
    context: { ...ctx, fresh: false },
  }
  // The list opens only with something to show: options, or a search.
  const something = (query: string) => options.length > 0 || query.trim() !== ""
  /*
   * After a step that filters and opens: the highlight stays on an option
   * that is still shown, and is dropped from one the filtering hid.
   */
  const opened = (query: string): Expectation => {
    const show = something(query)
    const shown = filtered(options, query, prefiltered)
    const kept =
      show && highlighted && shown.some((o) => same(o, highlighted))
        ? highlighted
        : null
    return {
      open: show,
      why: "user",
      highlight: kept,
      chosen: null,
      text: null,
      keystroke: true,
      context: {
        ...ctx,
        wants: show,
        active: kept && same(kept, ctx.active) ? ctx.active : null,
        fresh: false,
      },
    }
  }
  const closed = (chosen: Known | null): Expectation => ({
    open: false,
    why: "user",
    highlight: null,
    chosen,
    text: null,
    keystroke: false,
    context: {
      ...ctx,
      wants: false,
      active: null,
      fresh: false,
    },
  })
  switch (action) {
    case "focus":
      // Only a field without focus gets a focus event, and a locked field
      // does not open.
      if (focused || locked || !c) return unchanged
      return opened(value)
    case "type":
    case "clear":
      // The user only types into the field that has focus and takes input,
      // and clears only a field with something in it.
      if (!focused || locked || (action === "clear" && value === ""))
        return unchanged
      return opened(action === "type" ? value + LETTER : "")
    case "ArrowDown":
    case "ArrowUp": {
      if (!focused || locked) return unchanged
      const after = open ? unchanged : opened(value)
      if (after.open === false) return after
      const shown = open
        ? options.filter((o) => !o.hidden)
        : filtered(options, value, prefiltered)
      const selectable = shown.filter((o) => !o.disabled)
      if (selectable.length === 0) return after
      const n = selectable.length
      const i = selectable.findIndex((o) => o.selected)
      const next =
        action === "ArrowDown"
          ? selectable[(i + 1) % n]
          : selectable[i < 0 ? n - 1 : (i - 1 + n) % n]
      return {
        ...after,
        open: true,
        highlight: next,
        context: {
          ...after.context,
          wants: open ? ctx.wants : true,
          active: { label: next.label, value: next.value },
        },
      }
    }
    case "Enter": {
      if (!focused || locked || !open) return unchanged
      const selectable = options.filter((o) => !o.hidden && !o.disabled)
      const chosen = selectable.find((o) => o.selected)
      return chosen ? closed(chosen) : unchanged
    }
    case "Escape":
      if (!focused || locked || !open) return unchanged
      return closed(null)
    case "click option": {
      // A user can only click an option that is shown: the last one.
      const shown = options.filter((o) => !o.hidden)
      const target = shown[shown.length - 1]
      if (!open || !target || locked || target.disabled) return unchanged
      return closed(target)
    }
    case "blur":
      if (!focused) return unchanged
      return closed(null)
  }
}

/** What an update must do, from the page as it stands and the version sent. */
function expectUpdate(ctx: Context, send: string, way: Way): Expectation {
  const v = INFO[send]
  const h = host()
  const c = controlOf(h)
  const focused = c !== null && document.activeElement === c
  const value = c?.value ?? ""
  const serverHighlight = (on: Info, open: boolean) =>
    open && on.highlight !== null
      ? (on.options.find((o) => o.label === on.highlight) ?? null)
      : null
  if (way === "outerHTML")
    // A new component and a new field, with no memory: the server's word.
    return {
      open: v.expanded,
      why: v.controlled ? "controlled" : "server",
      highlight: serverHighlight(v, v.expanded),
      chosen: null,
      text: v.text ?? "",
      keystroke: false,
      context: {
        host: send,
        list: send,
        wants: undefined,
        active: null,
        fresh: true,
      },
    }
  if (way === "innerHTML") {
    // The host, the field and the list node stay; the options are new.
    const hostInfo = INFO[ctx.host]
    const before = isOpen(listOf(h))
    if (hostInfo.controlled)
      // The server holds the state, and sent options without a highlight.
      return {
        open: before,
        why: "controlled",
        highlight: undefined,
        chosen: null,
        text: value,
        keystroke: false,
        context: { ...ctx, list: send, fresh: true },
      }
    const open =
      ctx.wants === undefined ? before : ctx.wants && !hostInfo.readonly
    const shown = filtered(v.options, value, hostInfo.prefiltered)
    const kept =
      open && ctx.active && shown.some((o) => same(o, ctx.active))
        ? ctx.active
        : null
    return {
      open,
      why: ctx.wants === undefined ? "server" : "memory",
      highlight: kept,
      chosen: null,
      text: value,
      keystroke: false,
      context: { ...ctx, list: send, active: kept, fresh: true },
    }
  }
  /*
   * A morph keeps the field: every version has the recipe's id on it. What
   * it holds after is the morpher's, never the component's, and read from
   * their source: Datastar leaves the value unless the server's `value`
   * attribute differs from the one on the field, and then sets it, with
   * focus or without; idiomorph with `ignoreActiveValue` leaves the focused
   * field alone, attribute and all, and sets the server's in any other.
   */
  const attribute = c?.getAttribute("value") ?? null
  const text =
    way === "Datastar"
      ? attribute !== v.text
        ? (v.text ?? "")
        : value
      : focused
        ? value
        : (v.text ?? "")
  // idiomorph left the focused field's `value` attribute as it was, so the
  // page is not yet the version as sent.
  const fresh = !(way === "idiomorph" && focused && attribute !== v.text)
  if (v.controlled) {
    const turnedOn = !INFO[ctx.host].controlled
    /*
     * The server's highlight stands on an option the filter keeps. The
     * component filters an open list under `server-controlled` too, and an
     * option that does not match what is in the field is hidden, and loses
     * the highlight with it: `aria-activedescendant` must not point at
     * something hidden.
     */
    const highlight = serverHighlight(v, v.expanded)
    return {
      open: v.expanded,
      why: "controlled",
      highlight:
        highlight && (v.prefiltered || matching(highlight.label, text))
          ? highlight
          : null,
      chosen: null,
      text,
      keystroke: false,
      context: {
        ...ctx,
        host: send,
        list: send,
        wants: turnedOn ? undefined : ctx.wants,
        active: turnedOn ? null : ctx.active,
        fresh,
      },
    }
  }
  // The user's open list survives, and so does her highlight, while the
  // option is still shown.
  const open = ctx.wants === true && !v.readonly
  const shown = filtered(v.options, text, v.prefiltered)
  const kept =
    open && ctx.active && shown.some((o) => same(o, ctx.active))
      ? ctx.active
      : null
  return {
    open,
    why: ctx.wants === undefined ? "server" : "memory",
    highlight: kept,
    chosen: null,
    text,
    keystroke: false,
    context: {
      ...ctx,
      host: send,
      list: send,
      wants: ctx.wants === true && v.readonly ? false : ctx.wants,
      active: kept,
      fresh,
    },
  }
}

/** The `suggestion-select` events during a step. */
let events: Known[] = []
const onSelect = (e: Event) => {
  const d = (e as CustomEvent<{ label: string; value: string }>).detail
  events.push({ label: d.label, value: d.value })
}

/** A key, as the scenario tests press it: on the field, which has focus. */
const press = (c: HTMLInputElement, key: string) =>
  c.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  )

function apply(step: Step): void {
  events = []
  if ("send" in step) {
    expectation = expectUpdate(current, step.send, step.way)
    if (step.way === "innerHTML") {
      const list = listOf(host())
      if (list) list.innerHTML = INFO[step.send].listInner
    } else replace(step.way, HOST_ID as string, VERSIONS[step.send])
    return
  }
  expectation = expectAction(current, step.user)
  const h = host()
  const c = controlOf(h)
  if (!c) return
  const focused = document.activeElement === c
  switch (step.user) {
    case "focus":
      c.focus()
      break
    case "type":
      // As the scenario tests type: the value, then `input`. A user cannot
      // type into a readonly field, so the step does nothing there.
      if (focused && !c.readOnly) {
        c.value += LETTER
        c.dispatchEvent(new Event("input", { bubbles: true }))
      }
      break
    case "clear":
      if (focused && !c.readOnly && c.value !== "") {
        c.value = ""
        c.dispatchEvent(new Event("input", { bubbles: true }))
      }
      break
    case "click option": {
      // A user can only click what is shown. `click()` alone, as assistive
      // technology activates an element: the scenario tests show the
      // `mousedown` keeps the focus.
      const shown = optionsOf(h).filter((o) => !o.hidden)
      if (isOpen(listOf(h))) shown[shown.length - 1]?.click()
      break
    }
    case "blur":
      c.blur()
      break
    default:
      // The key goes to the focused element, and only the field listens.
      if (focused) press(c, step.user)
  }
}

let core: AccessibilityCore

type Snapshot = {
  tree: AxNode[]
  host: HTMLElement | null
  control: HTMLInputElement | null
  list: HTMLElement | null
  label: HTMLLabelElement | null
  open: boolean
  expanded: string | null
  descendant: string | null
  options: {
    node: HTMLElement
    label: string
    value: string | null
    hidden: boolean
    selected: boolean
    disabled: boolean
    id: string
  }[]
  empty: HTMLElement | null
  emptyShown: boolean
  status: string
  value: string
  code: string | null
  focused: boolean
  markup: string
  /** `prefiltered` on the host, read now: the node is live. */
  prefiltered: boolean
}

function snapshot(): Snapshot {
  const h = host()
  const c = controlOf(h)
  const list = listOf(h)
  const empty = h?.querySelector<HTMLElement>(".lt-suggestion__empty") ?? null
  return {
    tree: core.tree(renderedMarkup()),
    host: h,
    control: c,
    list,
    label: h?.querySelector("label") ?? null,
    open: isOpen(list),
    expanded: c?.getAttribute("aria-expanded") ?? null,
    descendant: c?.getAttribute("aria-activedescendant") ?? null,
    options: optionsOf(h).map((o) => ({
      node: o,
      ...known(o),
      hidden: Boolean(o.hidden),
      selected: o.getAttribute("aria-selected") === "true",
      disabled: disabled(o),
      id: o.id,
    })),
    empty,
    emptyShown: empty?.checkVisibility() ?? false,
    status: h?.querySelector("[role='status']")?.textContent ?? "",
    value: c?.value ?? "",
    code: valueFieldOf(h)?.value ?? null,
    focused: c !== null && document.activeElement === c,
    markup: canonical(h),
    prefiltered: h?.hasAttribute("prefiltered") ?? false,
  }
}

/** The count as the page says it is announced: `count-*` on the host, or the default texts. */
function countText(h: Element, hits: number): string {
  const lang = h.closest("[lang]")?.getAttribute("lang") || undefined
  const form = new Intl.PluralRules(lang).select(hits)
  const template =
    (hits === 0 ? h.getAttribute("count-none") : null) ??
    h.getAttribute(`count-${form}`) ??
    h.getAttribute("count-other")
  const number = new Intl.NumberFormat(lang).format(hits)
  const text =
    template ??
    (hits === 0
      ? DEFAULT_TEXTS.suggestionNone
      : hits === 1
        ? DEFAULT_TEXTS.suggestionOne
        : DEFAULT_TEXTS.suggestionOther)
  return text.replaceAll("{n}", number)
}

/** How often each invariant actually had something to check. */
const seen = {
  name: 0,
  expanded: 0,
  listName: 0,
  descendant: 0,
  user: 0,
  server: 0,
  controlled: 0,
  memory: 0,
  highlight: 0,
  shown: 0,
  prefilteredShown: 0,
  empty: 0,
  count: 0,
  quiet: 0,
  quietClosed: 0,
  choice: 0,
  code: 0,
  codeBack: 0,
  events: 0,
  escape: 0,
  kept: 0,
  typed: 0,
  ids: 0,
  untouched: 0,
  stable: 0,
}

/** A version's host as the server sent it, attributes in name order. */
const sent = (name: string) => {
  const t = document.createElement("template")
  t.innerHTML = VERSIONS[name]
  return canonical(t.content.firstElementChild)
}
const SENT_BUILDER = sent("builder")

/** The markup without the position on the list: the one write an open list needs. */
const withoutPosition = (markup: string) =>
  markup.replace(/(<ul[^>]*?) style="[^"]*"/, "$1")

/**
 * The ids the component made, each replaced by the order it first appears
 * in: what they point at stays compared, and their random value does not.
 */
function withoutMadeIds(markup: string): string {
  const made = new Map<string, string>()
  return markup.replace(
    /lt-suggestion-(?:list|option|label)-[a-z0-9]+/g,
    (id) => {
      if (!made.has(id)) made.set(id, `made-${made.size}`)
      return made.get(id) as string
    },
  )
}

/** The first line where two markups differ, both ways. */
function difference(from: string, to: string): string {
  const a = from.split("\n")
  const b = to.split("\n")
  const i = a.findIndex((line, n) => line !== b[n])
  const at = i < 0 ? a.length : i
  return `${a[at]?.trim() ?? "(nothing)"} became ${b[at]?.trim() ?? "(nothing)"}`
}

/** Every id some version sends, on any element, and the page's own. */
const SENT_IDS = new Set([
  ...Object.values(INFO).flatMap((v) => [...v.ids]),
  "lt-test-surface",
])

const show = (k: Known | null | undefined) =>
  k ? `"${k.label}"${k.value !== null ? ` (${k.value})` : ""}` : "none"

function violations(
  before: Snapshot,
  after: Snapshot,
  step: Step,
  was: Context,
  now: Context,
): string[] {
  const problems: string[] = []
  const e = expectation
  const { host: h, control, list } = after
  if (!h || !control || !list) return ["no field or list"]

  // The field is a combo box, named by its label.
  seen.name++
  const boxes = after.tree.filter((n) => n.role === "combobox")
  if (boxes.length !== 1 || boxes[0].name !== LABEL)
    problems.push(
      `the screen reader is given ${boxes.length} combo boxes, named ${boxes.map((b) => `"${b.name}"`).join(", ")}, not one named "${LABEL}"`,
    )

  /*
   * `aria-expanded` says whether the list is shown, and so does the tree:
   * the combo box is expanded, and the list box is in it, exactly when the
   * list is open.
   */
  seen.expanded++
  if (after.expanded !== String(after.open))
    problems.push(
      `aria-expanded is "${after.expanded}" on a list that is ${after.open ? "open" : "closed"}`,
    )
  if (boxes[0] && boxes[0].states.includes("expanded") !== after.open)
    problems.push(
      `the screen reader is told the field is ${after.open ? "collapsed" : "expanded"}`,
    )
  const listboxes = after.tree.filter((n) => n.role === "listbox")
  if (listboxes.length !== (after.open ? 1 : 0))
    problems.push(
      `the screen reader is given ${listboxes.length} list boxes over a list that is ${after.open ? "open" : "closed"}`,
    )

  // The list box is named by the label too.
  if (listboxes.length === 1) {
    seen.listName++
    if (listboxes[0].name !== LABEL)
      problems.push(
        `the list box is named "${listboxes[0].name}", not "${LABEL}"`,
      )
  }

  /*
   * `aria-activedescendant` points at an option that is there and shown, in
   * an open list, and that option is the selected one, in the markup and in
   * the tree; no other is. A closed list has no highlight.
   *
   * Under `server-controlled` the pointer is the server's word, and the
   * component does not put it back or take it away after an update. When the
   * server then sends new options without the field, as `innerHTML` on the
   * list does, the pointer it sent with the field points at an option that
   * is gone. That is the server's to send again; a screen reader finds no
   * element by the id and stays on the field, as the core does.
   */
  seen.descendant++
  const marked = after.options.filter((o) => o.selected)
  const stalePointer = INFO[now.host].controlled && now.list !== now.host
  if (after.descendant !== null) {
    const target = after.options.find((o) => o.id === after.descendant)
    if (!target && !stalePointer)
      problems.push(
        `aria-activedescendant points at "${after.descendant}", which is no option`,
      )
    else if (!target) {
      // The server's stale pointer, above.
    } else if (target.hidden || !after.open)
      problems.push(
        `aria-activedescendant points at "${target.label}", which is not shown`,
      )
    else if (!target.selected || marked.length !== 1)
      problems.push(
        `aria-activedescendant points at "${target.label}", but the selected options are [${marked.map((o) => o.label).join(", ")}]`,
      )
    else if (
      !after.tree.some(
        (n) =>
          n.role === "option" &&
          n.name === target.label &&
          n.states.includes("selected"),
      )
    )
      problems.push(
        `the screen reader is not told "${target.label}" is selected`,
      )
  } else if (marked.some((o) => !o.hidden) && after.open)
    problems.push(
      `"${marked[0].label}" is selected, but aria-activedescendant points at nothing`,
    )
  if (!after.open && marked.length > 0 && !INFO[now.host].controlled)
    problems.push(`a closed list has "${marked[0].label}" selected`)

  // The open state the promises say.
  if (e.open !== null && e.why !== null) {
    seen[e.why]++
    if (after.open !== e.open)
      problems.push(
        {
          user: `the list is ${after.open ? "open" : "closed"} after ${label(step)}`,
          server: `the list is ${after.open ? "open" : "closed"}, not ${e.open ? "open" : "closed"} as the server said`,
          controlled: `under server-controlled the list is ${after.open ? "open" : "closed"}, not the server's ${e.open ? "open" : "closed"}`,
          memory: `the list is ${after.open ? "open" : "closed"} after ${label(step)}, though the user left it ${e.open ? "open" : "closed"}`,
        }[e.why],
      )
  }

  // The highlight the promises say: the user's survives, and the server's
  // stands under `server-controlled`.
  if (e.highlight !== undefined && after.open === e.open) {
    seen.highlight++
    const got = after.options.find((o) => o.selected && !o.hidden) ?? null
    if (!same(got, e.highlight))
      problems.push(
        `${show(got)} is highlighted after ${label(step)}, not ${show(e.highlight)}`,
      )
  }

  /*
   * An open list shows exactly the options that contain what is in the
   * field; under `prefiltered`, exactly what the server sent.
   */
  const prefiltered = h.hasAttribute("prefiltered")
  const shown = after.options.filter((o) => !o.hidden)
  if (after.open) {
    if (prefiltered) {
      seen.prefilteredShown++
      const want = INFO[now.list].options
      if (shown.map((o) => o.label).join() !== want.map((o) => o.label).join())
        problems.push(
          `under prefiltered the list shows [${shown.map((o) => o.label).join(", ")}], not the server's [${want.map((o) => o.label).join(", ")}]`,
        )
    } else {
      seen.shown++
      const want = after.options.filter((o) => matching(o.label, after.value))
      if (shown.map((o) => o.label).join() !== want.map((o) => o.label).join())
        problems.push(
          `the list shows [${shown.map((o) => o.label).join(", ")}] for "${after.value}", not [${want.map((o) => o.label).join(", ")}]`,
        )
    }
  }

  /*
   * The empty message follows the list: shown when the list is open and
   * shows nothing. Under `prefiltered` it is the app's: the component
   * leaves `hidden` as the server sent it.
   */
  if (after.empty) {
    seen.empty++
    if (prefiltered) {
      if (
        !("user" in step) &&
        now.list === now.host &&
        after.empty.hidden !== INFO[now.host].emptyHidden
      )
        problems.push(
          `under prefiltered the empty message's hidden is ${after.empty.hidden}, not the server's`,
        )
    } else if (after.emptyShown !== (after.open && shown.length === 0))
      problems.push(
        `the empty message is ${after.emptyShown ? "shown" : "hidden"} over a list that is ${after.open ? "open" : "closed"} with ${shown.length} options shown`,
      )
  }

  /*
   * The status announces the count of an open list, in the host's words or
   * the default texts, once the list is done: after a keystroke or a focus
   * that filtered, after an update that changed an open list, and whenever
   * it says anything at all. A list the server opened says nothing until one
   * of those happens: that is no change to announce.
   */
  if (after.open && !prefiltered) {
    const filters = e.keystroke || ("send" in step && step.way !== "outerHTML")
    if (filters || after.status !== "") {
      seen.count++
      const want = countText(h, shown.length)
      if (after.status !== want)
        problems.push(`the status says "${after.status}", not "${want}"`)
    }
  }
  /*
   * A count is announced only over a list the user sees. The page: an empty
   * list under an empty field does not open, "so the message does not
   * appear before the user has typed something"; and an empty field must
   * not announce "No matches" already on focus (`announceFiltered`). Nor
   * may an update count a list half way through its morph, as the
   * `prefiltered` callback once did before the options were replaced.
   */
  if (!prefiltered && !after.open) {
    seen.quietClosed++
    if (after.status !== before.status && after.status !== "")
      problems.push(
        `the status says "${after.status}" over a list that stays closed after ${label(step)}`,
      )
  }
  if (prefiltered) {
    seen.quiet++
    if (e.keystroke && after.status !== before.status)
      problems.push(
        `under prefiltered ${label(step)} changed the status from "${before.status}" to "${after.status}"`,
      )
    else if (
      after.status !== before.status &&
      after.status !== "" &&
      after.status !== countText(h, shown.length)
    )
      problems.push(
        `under prefiltered the status says "${after.status}" over ${shown.length} options`,
      )
    if ("send" in step && step.way === "outerHTML" && after.status !== "")
      problems.push(
        `the first count is no news, but the status says "${after.status}"`,
      )
  }

  /*
   * A choice puts the option's text in the field and its code, or the text,
   * in the value field, and says so once with `suggestion-select`; nothing
   * else says it.
   */
  if (e.chosen) {
    seen.choice++
    const code = e.chosen.value ?? e.chosen.label
    if (after.value !== e.chosen.label)
      problems.push(
        `the field holds "${after.value}" after choosing "${e.chosen.label}"`,
      )
    if (after.code !== null && after.code !== code)
      problems.push(
        `the value field holds "${after.code}" after choosing ${show(e.chosen)}`,
      )
  }
  seen.events++
  const want = e.chosen
    ? [{ label: e.chosen.label, value: e.chosen.value ?? e.chosen.label }]
    : []
  if (
    events.map((x) => `${x.label}|${x.value}`).join() !==
    want.map((x) => `${x.label}|${x.value}`).join()
  )
    problems.push(
      `suggestion-select gave [${events.map(show).join(", ")}], not [${want.map(show).join(", ")}]`,
    )

  // The user changed the text after a choice: the code no longer applies.
  if (
    "user" in step &&
    (step.user === "type" || step.user === "clear") &&
    after.code !== null &&
    after.value !== before.value
  ) {
    seen.code++
    if (after.code !== "")
      problems.push(
        `the value field still holds "${after.code}" after the text changed to "${after.value}"`,
      )
  }
  /*
   * An update that empties the value field gets the code back, as long as
   * the text is still the chosen one.
   */
  if (
    "send" in step &&
    step.way !== "outerHTML" &&
    before.code &&
    after.code !== null &&
    after.control === before.control &&
    after.value === before.value
  ) {
    seen.codeBack++
    if (after.code !== before.code)
      problems.push(
        `the value field holds "${after.code}" after ${label(step)}, not the chosen "${before.code}"`,
      )
  }

  // Escape closes the list, and the focus stays in the field.
  if (
    "user" in step &&
    step.user === "Escape" &&
    before.open &&
    before.focused
  ) {
    seen.escape++
    if (after.open) problems.push("Escape did not close the list")
    if (!after.focused) problems.push("after Escape the focus left the field")
  }

  /*
   * A morph keeps the field, which has no id the server did not send, and
   * the focus in it; and what the user typed is what the morpher leaves
   * (`expectUpdate`), never something the component wrote. `innerHTML` on
   * the list does not touch the field at all.
   */
  if ("send" in step && step.way !== "outerHTML") {
    seen.kept++
    if (before.control !== control)
      problems.push("the update replaced the field")
    else if (before.focused && !after.focused)
      problems.push("the update took the focus from the field")
    if (e.text !== null) {
      if (before.value && e.text === before.value) seen.typed++
      if (after.value !== e.text)
        problems.push(
          `the field holds "${after.value}" after ${label(step)}, not "${e.text}"`,
        )
    }
  }

  /*
   * The component writes ids only on the list, the options and a label
   * next to the field; never on the field, which a morph would then
   * replace. And no id is there twice.
   */
  seen.ids++
  if (control.id !== CONTROL_ID)
    problems.push(
      `the field has the id "${control.id}", not the server's "${CONTROL_ID}"`,
    )
  for (const el of document.querySelectorAll("#lt-test-surface [id]"))
    if (
      !SENT_IDS.has(el.id) &&
      !(el === list || after.options.some((o) => o.node === el)) &&
      !(el === after.label && !after.label.contains(control))
    )
      problems.push(
        `a <${el.localName}> has the id "${el.id}", which no server sent`,
      )
  const all = [...document.querySelectorAll("#lt-test-surface [id]")].map(
    (el) => el.id,
  )
  const twice = all.filter((id, i) => all.indexOf(id) !== i)
  if (twice.length > 0) problems.push(`two elements have the id "${twice[0]}"`)

  /*
   * Markup that already says everything, as `lt.suggestion()` writes it, is
   * left exactly as sent while the list stays closed: the component has
   * nothing to write, and React hydrates without mismatches.
   */
  if (
    "send" in step &&
    step.send === "builder" &&
    step.way !== "innerHTML" &&
    !after.open &&
    after.value === "" &&
    after.status === ""
  ) {
    seen.untouched++
    if (after.markup !== SENT_BUILDER)
      problems.push(
        `the component wrote on markup that already said everything: ${difference(SENT_BUILDER, after.markup)}`,
      )
  }

  /*
   * The same version sent again by a morph, from a page it left as it was,
   * changes nothing: the same field, the same markup, the same state. The
   * position on a list means nothing once it is closed.
   *
   * Except the ids the component made. A list, an option or a label with an
   * id the server did not send is a different node to both morphers, so
   * they replace it, and the new node gets a new id. The page accepts that
   * for the list and the options ("If the server sends the whole list
   * again, they are replaced, and that costs nothing"), and a label next to
   * the field holds as little the user can lose. So those ids are compared
   * by where they point, not by their value.
   *
   * And the two writes that say nothing a screen reader or the eye can
   * tell: the count, which the morph empties and the component writes back
   * only over an open list it filters itself, since writing it again would
   * announce it again (the count has its own invariant above); and `hidden`
   * on the empty message under a closed list, which the stylesheet hides
   * after a hidden list either way.
   */
  if (
    "send" in step &&
    (step.way === "Datastar" || step.way === "idiomorph") &&
    was.host === step.send &&
    was.list === step.send &&
    was.fresh
  ) {
    seen.stable++
    const settled = (s: Snapshot) => {
      let m = withoutMadeIds(s.open ? s.markup : withoutPosition(s.markup))
      m = m.replace(/(<span[^>]*role="status"[^>]*>)[^<]*(<\/span>)/, "$1$2")
      if (!s.open)
        m = m.replace(/(<p class="lt-suggestion__empty") hidden=""/, "$1")
      return m
    }
    const [b, a] = [settled(before), settled(after)]
    if (a !== b)
      problems.push(
        `the same version sent again changed the markup: ${difference(b, a)}`,
      )
    if (after.open !== before.open)
      problems.push("the same version sent again opened or closed the list")
  }
  return problems
}

/**
 * The component makes the ids of the list, the options and the label with
 * `Math.random`, and the state key holds the markup: with a new id on every
 * replay, no two paths ever met. Seeded afresh before every replay, the
 * same path gives the same ids.
 */
const realRandom = Math.random
let seed = 1
const seeded = () => {
  seed = (seed * 16807) % 2147483647
  return seed / 2147483647
}

const model: Model<Step, Snapshot, Context> = {
  recipe: RECIPE,
  steps: STATE_STEPS,
  apply,
  label,
  snapshot,
  initial: INITIAL,
  next: () => {
    current = expectation.context
    return current
  },
  /*
   * What the page does not show: whether the component holds the user's
   * open and her highlight, and the version the options came from, which
   * the empty message under `prefiltered` is checked against.
   */
  contextKey: (c) => `${c.wants}|${show(c.active)}|${c.list === c.host}`,
  violations,
  seen,
  reset: () => {
    current = INITIAL
    seed = 1
  },
}

describe("lt-suggestion, every sequence of updates and user actions", () => {
  beforeAll(async () => {
    // The versions warn where they should; the warnings have their own
    // tests in `messages.browser.test.ts`, and here they are noise.
    vi.spyOn(console, "warn").mockImplementation(() => {})
    Math.random = seeded
    defineLtSuggestion()
    core = accessibilityCore(await (await fetch(coreUrl)).arrayBuffer())
    document.addEventListener("suggestion-select", onSelect)
  })
  afterAll(() => {
    Math.random = realRandom
    document.removeEventListener("suggestion-select", onSelect)
  })

  // Each search counts for itself, so neither leans on the other's checks.
  const fresh = () => {
    for (const k of Object.keys(seen)) seen[k as keyof typeof seen] = 0
  }

  it("keeps the names, the open list, the highlight, the filter, the count, the choice and the ids in every state to depth 3", async () => {
    fresh()
    const run = await exploreStates(model, 3)
    expect(run.found.slice(0, 10)).toEqual([])
    // The search found more states than one step gives.
    expect(run.states).toBeGreaterThan(STATE_STEPS.length)
    expect(unchecked(seen)).toEqual([])
  }, 600_000)

  /*
   * Every sequence, without merging states. The state key holds what the
   * component remembers as the model computes it; where the component
   * remembers otherwise, two paths the key merges still differ, and only a
   * path shows it. In Chromium only.
   */
  it.runIf(server.browser === "chromium")(
    "keeps the same invariants on every sequence to depth 3",
    async () => {
      fresh()
      const run = await exploreSequences(model, 3, SEQUENCE_STEPS)
      expect(run.found.slice(0, 10)).toEqual([])
      expect(run.ran).toBe(SEQUENCE_STEPS.length ** 3)
      expect(unchecked(seen)).toEqual(UNSEEN_IN_SEQUENCES)
    },
    600_000,
  )
})
