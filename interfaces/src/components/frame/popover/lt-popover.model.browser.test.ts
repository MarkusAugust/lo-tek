/// <reference path="../../../types/css.d.ts" />
/// <reference path="../../../testing/vite-url.d.ts" />

/**
 * Every sequence of server updates and user actions on a popover, to a
 * fixed depth, with the screen reader's view checked after each step.
 *
 * The scenario tests in `lt-popover.browser.test.ts` each follow one path: a
 * click, a patch, then a look. This one does not choose: the server can send
 * any of the versions below, by any of the ways an update arrives, and the
 * user can click, press the keys the component promises, move the focus,
 * and the app can call the methods, in any order. After every step the page
 * as the browser rendered it goes to the core, which computes the
 * accessibility tree from the specifications, and the invariants are
 * checked on that tree, on the wiring the component promises, on the top
 * layer, on the focus, on the position and on the events.
 *
 * Whether the panel must be open after a step is computed from what the
 * page promises, from the page as it stood before the step: the user's open
 * survives a morph, `open` from the server opens it, and under
 * `server-controlled` the server's `open` decides. The component's memory of
 * what the user asked for is part of the context, so the state search keeps
 * two paths apart that differ only there.
 *
 * The page is the recipe from the component page, with a button outside the
 * popover to click and focus. The component is the real one, and so are
 * Datastar and idiomorph.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { server, userEvent } from "vitest/browser"
import page from "../../../../../documentation/src/content/docs/components/popover.mdx?raw"
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
  settle,
  unchecked,
} from "../../../testing/model"
import { htmlBlocks, tabItems } from "../../../testing/recipes"
import { renderedMarkup } from "../../../testing/rendered"
import { type Replacement, replace } from "../../../testing/update"
import { defineLtPopover, type LtPopover } from "./lt-popover"
import { popover } from "./popover"

import "../../../tokens/tokens.css"
import "./popover.css"
import "../../css/button/button.css"

/** The popover in the "Plain HTML" recipe, without its scripts. */
const RECIPE_BLOCK = (() => {
  const block = tabItems(page)
    .filter((t) => t.name === "Plain HTML")
    .flatMap((t) => htmlBlocks(t.code))
    .find((b) => b.includes("<lt-popover"))
  if (!block) throw new Error("no recipe with <lt-popover> on the page")
  return block.replace(/<script[\s\S]*?<\/script>/g, "")
})()

/** The recipe's host: what the server sends again, by its id. */
const HOST = RECIPE_BLOCK.match(/<lt-popover[\s\S]*?<\/lt-popover>/)?.[0]
if (!HOST) throw new Error("no <lt-popover> in the recipe")
const HOST_TAG = HOST.match(/^<lt-popover[^>]*>/)?.[0] ?? ""
const HOST_ID = HOST_TAG.match(/\sid="([^"]+)"/)?.[1]
if (!HOST_ID) throw new Error("the recipe's popover has no id to update it by")
const PLACEMENT = HOST_TAG.match(/\splacement="([^"]+)"/)?.[1]
if (!PLACEMENT) throw new Error("the recipe's popover has no placement")

/** `text` with `from` replaced, which must be there: a recipe that changed would otherwise test nothing. */
function swap(text: string, from: string | RegExp, to: string): string {
  const out = text.replace(from, to)
  if (out === text)
    throw new Error(`the recipe has no ${String(from)} to replace`)
  return out
}

/** The recipe's button, its panel and their texts, read from it. */
const TRIGGER_TAG = HOST.match(/<button[^>]*>/)?.[0] ?? ""
const TRIGGER_TEXT = HOST.match(/<button[^>]*>([^<]+)<\/button>/)?.[1] ?? ""
const PANEL_TAG = HOST.match(/<ul class="lt-popover"[^>]*>/)?.[0] ?? ""
const PANEL_ID = PANEL_TAG.match(/\sid="([^"]+)"/)?.[1]
const ITEMS = [
  ...(HOST.match(/<ul[\s\S]*<\/ul>/)?.[0] ?? "").matchAll(
    /<button[^>]*>([^<]+)<\/button>/g,
  ),
].map((m) => m[1])
// The recipe must be what the versions below change: a button with no
// wiring, and a panel with the class and an id but no `popover`.
if (
  !TRIGGER_TEXT ||
  !PANEL_ID ||
  ITEMS.length < 2 ||
  /aria-controls|aria-expanded/.test(TRIGGER_TAG) ||
  /\spopover/.test(PANEL_TAG)
)
  throw new Error("the recipe is not a bare button and a panel with an id")

const withHost = (html: string, extra: string) =>
  swap(html, HOST_TAG, HOST_TAG.replace(/>$/, ` ${extra}>`))

// What `lt.popover()` writes, on a server that runs JavaScript: the whole
// wiring, with the recipe's id, placement and classes.
const builder = (open: boolean) => {
  const box = popover({
    id: PANEL_ID,
    open,
    placement: PLACEMENT as "bottom-end",
  })
  // The builder's host can be the recipe's exactly, so it is not `swap`ed.
  const hostTag = `<lt-popover id="${HOST_ID}" ${attr(box.host)}>`
  return swap(
    swap(
      HOST.replace(HOST_TAG, hostTag),
      TRIGGER_TAG,
      `<button class="lt-button" data-variant="secondary" ${attr(box.trigger)}>`,
    ),
    PANEL_TAG,
    `<ul ${attr(box.panel)}>`,
  )
}

/** What the server can send. The host's attributes and the content are both in it. */
const VERSIONS: Record<string, string> = {
  // A bare button and a panel without `popover`: the component adds it.
  recipe: HOST,
  // The server opens the panel.
  open: withHost(HOST, "open"),
  controlled: withHost(HOST, "server-controlled"),
  controlledOpen: withHost(HOST, "server-controlled open"),
  // Another edge: no room above the button on this page, so it goes below.
  placement: swap(HOST, `placement="${PLACEMENT}"`, 'placement="top-start"'),
  builder: builder(false),
  builderOpen: builder(true),
  // A bare `popover` written by hand is `auto`: the browser closes it too.
  auto: swap(HOST, PANEL_TAG, PANEL_TAG.replace(/>$/, " popover>")),
  // The server wrote the wiring itself.
  controls: swap(
    HOST,
    TRIGGER_TAG,
    TRIGGER_TAG.replace(/>$/, ` aria-controls="${PANEL_ID}">`),
  ),
  // Another action in the panel: a morph adds a node.
  content: swap(
    HOST,
    /(\s*)<\/ul>/,
    '$1  <li><button class="lt-button" data-variant="ghost" type="button">Rent it out again</button></li>$1</ul>',
  ),
  // A panel without an id: the button cannot be wired, and the component
  // invents none.
  noId: swap(HOST, PANEL_TAG, PANEL_TAG.replace(` id="${PANEL_ID}"`, "")),
}

/** A button outside the popover, to click and to move the focus to. */
const OUTSIDE_ID = "elsewhere"
const RECIPE = `${RECIPE_BLOCK}<button id="${OUTSIDE_ID}" class="lt-button" type="button">Elsewhere</button>`

/** What a version says, read from its markup once. */
type Info = {
  open: boolean
  serverControlled: boolean
  /** The panel is `popover="auto"`, which the browser closes too. */
  auto: boolean
  panelId: string | null
  ids: Set<string>
  /** What `innerHTML` on the host writes. */
  inner: string
}

function info(html: string): Info {
  const t = document.createElement("template")
  t.innerHTML = html
  const host = t.content.querySelector("lt-popover") as Element
  const panel = host.querySelector(".lt-popover, [popover]")
  const popoverValue = panel?.getAttribute("popover")
  return {
    open: host.hasAttribute("open"),
    serverControlled: host.hasAttribute("server-controlled"),
    auto: popoverValue === "" || popoverValue === "auto",
    panelId: panel?.id || null,
    ids: new Set([...t.content.querySelectorAll("[id]")].map((e) => e.id)),
    inner: host.innerHTML,
  }
}
const INFO = Object.fromEntries(
  Object.entries(VERSIONS).map(([name, html]) => [name, info(html)]),
)

type Way = Replacement | "innerHTML"
type Action =
  | "click trigger"
  | "click outside"
  | "Enter"
  | "Space"
  | "Escape"
  | "Tab"
  | "focus trigger"
  | "focus item"
  | "focus outside"
  | "blur"
  | "show()"
  | "hide()"
  | "toggle()"
  | "open = false"
type Step = { send: string; way: Way } | { user: Action }

/*
 * `innerHTML` on the host keeps the host, its attributes and its memory, and
 * replaces the button and the panel; it carries only the versions whose
 * content differs from the recipe's.
 */
const WAYS: Way[] = ["Datastar", "idiomorph", "outerHTML", "innerHTML"]
const SENDS: Step[] = Object.keys(VERSIONS).flatMap((send) =>
  WAYS.filter(
    (way) =>
      way !== "innerHTML" ||
      send === "recipe" ||
      INFO[send].inner !== INFO.recipe.inner,
  ).map((way) => ({ send, way })),
)
const ACTIONS: Step[] = (
  [
    "click trigger",
    "click outside",
    "Enter",
    "Space",
    "Escape",
    "Tab",
    "focus trigger",
    "focus item",
    "focus outside",
    "blur",
    "show()",
    "hide()",
    "toggle()",
    "open = false",
  ] as Action[]
).map((user) => ({ user }))
const STEPS: Step[] = [...SENDS, ...ACTIONS]

const pick = (steps: Step[], names: string[]) => {
  const picked = steps.filter((s) => names.includes(label(s)))
  if (picked.length !== names.length)
    throw new Error(
      `no step called ${names.filter((n) => !steps.some((s) => label(s) === n)).join(", ")}`,
    )
  return picked
}

/*
 * Neither search can take every step to depth 3: with all 54, and the
 * version's name in the state key, the state search took 5 min 26 s in
 * Chromium alone, over 4072 states. The steps are cut, not the invariants.
 * The state search, in every engine, keeps 26: every version by Datastar
 * but `content`, which `innerHTML` carries instead; idiomorph for the versions that open, close
 * or hand the state to the server; `outerHTML` once, for a new component
 * that opens from the server; `innerHTML` once, for a panel replaced under
 * an open host; and every action where the engines differ (the real clicks,
 * the keys, the focus), with `show()` and `hide()`. The search over
 * sequences, in Chromium, keeps 15: the versions by Datastar that move the
 * state or the memory, the recipe by idiomorph, and every action that gives
 * the component a memory to keep or takes it, with `toggle()`, the property
 * and a focus on nothing for Escape.
 */
const STATE_STEPS = pick(STEPS, [
  ...[
    "recipe",
    "open",
    "controlled",
    "controlledOpen",
    "placement",
    "builder",
    "builderOpen",
    "auto",
    "controls",
    "noId",
  ].map((v) => `${v} by Datastar`),
  ...["recipe", "open", "controlledOpen"].map((v) => `${v} by idiomorph`),
  "open by outerHTML",
  "content by innerHTML",
  "click trigger",
  "click outside",
  "Enter",
  "Space",
  "Escape",
  "Tab",
  "focus trigger",
  "focus item",
  "focus outside",
  "show()",
  "hide()",
])
const SEQUENCE_STEPS = pick(STEPS, [
  ...[
    "recipe",
    "open",
    "controlled",
    "controlledOpen",
    "auto",
    "builderOpen",
  ].map((v) => `${v} by Datastar`),
  "recipe by idiomorph",
  "click trigger",
  "focus item",
  "Escape",
  "show()",
  "hide()",
  "toggle()",
  "open = false",
  "blur",
])
/** What the sequences leave out: `Tab` is the browser's, and the state search presses it in every engine. */
const UNSEEN_IN_SEQUENCES = ["tab"]

function label(step: Step): string {
  return "send" in step ? `${step.send} by ${step.way}` : step.user
}

/**
 * The context: which version the host and the content came from, and
 * whether the component holds that the user asked for the panel to be open.
 * That memory is not in the page, and it decides what a morph that takes
 * `open` leads to.
 */
type Context = {
  host: string
  body: string
  wants: boolean
  /** Nothing but updates since the version was sent: the page is as it left it. */
  fresh: boolean
}

const INITIAL: Context = {
  host: "recipe",
  body: "recipe",
  wants: false,
  fresh: true,
}

/**
 * What the step must lead to, computed in `apply` from the page before it.
 * `open` is null when the page promises nothing exact.
 */
type Expectation = {
  open: boolean | null
  why: "user" | "server" | "controlled" | "serverOpens" | "app" | null
  /** The `popover-toggle` details the step must send, or null when not modelled. */
  events: boolean[] | null
  /** The element that must have focus after the step, when the step decides it. */
  focus: Element | null
  context: Context
}

let current: Context = INITIAL
let expectation: Expectation = {
  open: null,
  why: null,
  events: null,
  focus: null,
  context: INITIAL,
}

const host = () =>
  document.getElementById(HOST_ID as string) as LtPopover | null
/** The button: the first one outside the panel. */
const triggerOf = (h: Element | null) =>
  h?.querySelector<HTMLButtonElement>(":scope > button") ?? null
const panelOf = (h: Element | null) =>
  h?.querySelector<HTMLElement>(":scope > ul") ?? null
const outside = () => document.getElementById(OUTSIDE_ID) as HTMLElement

/** What a user action or a call from the app must do, from the page as it stands. */
function expectAction(ctx: Context, action: Action): Expectation {
  const h = host()
  const trigger = triggerOf(h)
  const panel = panelOf(h)
  const open = panel?.matches(":popover-open") ?? false
  const controlled = INFO[ctx.host].serverControlled
  const auto = INFO[ctx.body].auto
  const active = document.activeElement
  const onTrigger = active === trigger
  const unchanged: Expectation = {
    open,
    why: "user",
    events: [],
    focus: null,
    context: { ...ctx, fresh: false },
  }
  // The user, or the app through the methods, changes the state: one event,
  // and the component remembers it, unless the server decides the state.
  const to = (
    next: boolean,
    why: Expectation["why"],
    events: boolean,
  ): Expectation => ({
    open: next,
    why,
    events: next === open || !events ? [] : [next],
    focus: null,
    context: {
      ...ctx,
      wants: controlled ? false : next,
      fresh: false,
    },
  })
  switch (action) {
    case "click trigger":
      /*
       * A real click on an `auto` panel's button while it is open: the
       * browser closes the panel on the press, before the click, and the
       * click opens it again. That is why `lt.popover()` writes `manual`;
       * the page promises only that the component follows along.
       */
      if (auto && open)
        return { ...unchanged, open: null, why: null, events: null }
      return to(!open, "user", true)
    case "Enter":
    case "Space":
      // The key activates the focused button: the trigger toggles, a button
      // outside is a click outside, and one in the panel is a click inside.
      if (onTrigger) return to(!open, "user", true)
      if (active === outside() && open) return to(false, "user", true)
      return unchanged
    case "click outside":
      return open ? to(false, "user", true) : unchanged
    case "Escape": {
      if (!open) return unchanged
      // Focus goes back to the button when it was in the popover or nowhere.
      const fromWindow =
        (h?.contains(active) ?? false) ||
        active === document.body ||
        active === null
      return {
        ...to(false, "user", true),
        focus: fromWindow ? trigger : active,
      }
    }
    case "Tab":
      // Into the panel, in the order of the markup.
      if (onTrigger && open)
        return {
          ...unchanged,
          focus: panel?.querySelector("button") ?? null,
        }
      return unchanged
    case "focus trigger":
    case "focus item":
    case "focus outside":
    case "blur":
      // No promise closes the panel when the focus leaves it.
      return { ...unchanged, focus: null }
    case "show()":
      // Also on a panel the server opened: the call is the app's word, and
      // a patch without `open` keeps it open.
      return to(true, "app", true)
    case "hide()":
      return to(false, "app", true)
    case "toggle()":
      return to(!open, "app", true)
    case "open = false":
      // The property is a message too, but sends no event.
      return to(false, "app", false)
  }
}

/** What an update must do, from the page as it stands and the version sent. */
function expectUpdate(ctx: Context, send: string, way: Way): Expectation {
  const v = INFO[send]
  if (way === "outerHTML")
    // A new component, with no memory: the server's word.
    return {
      open: v.open,
      why: v.serverControlled ? "controlled" : "server",
      events: [],
      focus: null,
      context: {
        host: send,
        body: send,
        wants: false,
        fresh: true,
      },
    }
  if (way === "innerHTML") {
    // The host and its attributes stay; the new panel is opened if the host is.
    const open = host()?.hasAttribute("open") ?? false
    return {
      open,
      why: INFO[ctx.host].serverControlled
        ? "controlled"
        : ctx.wants
          ? "user"
          : "server",
      events: [],
      focus: null,
      context: { ...ctx, body: send, fresh: true },
    }
  }
  if (v.serverControlled)
    return {
      open: v.open,
      why: "controlled",
      events: [],
      focus: null,
      context: {
        host: send,
        body: send,
        wants: false,
        fresh: true,
      },
    }
  return {
    open: v.open || ctx.wants,
    why: v.open ? "serverOpens" : ctx.wants ? "user" : "server",
    events: [],
    focus: null,
    context: { ...ctx, host: send, body: send, fresh: true },
  }
}

/** The `popover-toggle` events during a step. */
let events: boolean[] = []
const onToggle = (e: Event) =>
  events.push((e as CustomEvent<{ open: boolean }>).detail.open)

/** Tab, as a keyboard user presses it; WebKit on macOS moves to buttons with Alt+Tab. */
async function pressTab() {
  if (server.browser === "webkit") await userEvent.keyboard("{Alt>}{Tab}{/Alt}")
  else await userEvent.tab()
}

const KEYS_PRESSED: Partial<Record<Action, string>> = {
  Enter: "{Enter}",
  Space: " ",
  Escape: "{Escape}",
}

async function apply(step: Step): Promise<void> {
  events = []
  if ("send" in step) {
    expectation = expectUpdate(current, step.send, step.way)
    if (step.way === "innerHTML") {
      const h = host()
      if (h) h.innerHTML = INFO[step.send].inner
    } else replace(step.way, HOST_ID as string, VERSIONS[step.send])
    return
  }
  expectation = expectAction(current, step.user)
  const h = host()
  const trigger = triggerOf(h)
  const panel = panelOf(h)
  switch (step.user) {
    // Real clicks: the browser's light dismiss of an `auto` panel listens
    // to the pointer, not to `click()`.
    case "click trigger":
      if (trigger) await userEvent.click(trigger)
      break
    case "click outside":
      await userEvent.click(outside())
      break
    case "Tab":
      // Only from the button: from the panel, Tab leaves the page.
      if (document.activeElement === trigger) await pressTab()
      break
    case "focus trigger":
      trigger?.focus()
      break
    case "focus item":
      // A user can only move into a panel that is shown.
      if (panel?.matches(":popover-open"))
        panel.querySelector("button")?.focus()
      break
    case "focus outside":
      outside().focus()
      break
    case "blur":
      ;(document.activeElement as HTMLElement | null)?.blur()
      break
    case "show()":
      h?.show()
      break
    case "hide()":
      h?.hide()
      break
    case "toggle()":
      h?.toggle()
      break
    case "open = false":
      if (h) h.open = false
      break
    default:
      // Real keys, so Enter and Space activate the button as the browser does.
      await userEvent.keyboard(KEYS_PRESSED[step.user] as string)
  }
}

let core: AccessibilityCore

type Snapshot = {
  tree: AxNode[]
  host: LtPopover | null
  trigger: HTMLButtonElement | null
  panel: HTMLElement | null
  /** `:popover-open`: the panel is in the top layer. */
  shown: boolean
  open: boolean
  expanded: string | null
  controls: string | null
  active: Element | null
  markup: string
  /** The boxes, read now, for the position. */
  triggerBox: DOMRect | null
  panelBox: DOMRect | null
  placement: string
  /** The trigger's text, read now: the node is live. */
  text: string
}

function snapshot(): Snapshot {
  const h = host()
  const trigger = triggerOf(h)
  const panel = panelOf(h)
  const shown = panel?.matches(":popover-open") ?? false
  return {
    tree: core.tree(renderedMarkup()),
    host: h,
    trigger,
    panel,
    shown,
    open: h?.hasAttribute("open") ?? false,
    expanded: trigger?.getAttribute("aria-expanded") ?? null,
    controls: trigger?.getAttribute("aria-controls") ?? null,
    active: document.activeElement,
    markup: canonical(h),
    triggerBox: trigger?.getBoundingClientRect() ?? null,
    panelBox: shown ? (panel?.getBoundingClientRect() ?? null) : null,
    placement: h?.getAttribute("placement") ?? "bottom-start",
    text: trigger?.textContent ?? "",
  }
}

/** How often each invariant actually had something to check. */
const seen = {
  trigger: 0,
  expanded: 0,
  controls: 0,
  user: 0,
  app: 0,
  server: 0,
  serverOpens: 0,
  controlled: 0,
  escape: 0,
  tab: 0,
  focusInside: 0,
  kept: 0,
  events: 0,
  ids: 0,
  position: 0,
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
const SENT_BUILDER_OPEN = sent("builderOpen")

/** The markup without the position on the panel: the one write an open panel needs. */
const withoutPosition = (markup: string) =>
  markup.replace(/(<ul[^>]*?) style="[^"]*"/, "$1")

/** Every id some version sends, on any element, and the page's own. */
const SENT_IDS = new Set([
  ...Object.values(INFO).flatMap((v) => [...v.ids]),
  OUTSIDE_ID,
  "lt-test-surface",
])

/** Text as a name is computed. */
const flat = (text: string | null) => (text ?? "").replace(/\s+/g, " ").trim()

/** Where the panel must be, as the page describes the placement. */
function expectedPosition(
  placement: string,
  anchor: DOMRect,
  panel: DOMRect,
): { top: number; left: number } {
  const space = 4
  const below = placement.startsWith("bottom")
  // The page is left to right: `start` is the button's left edge.
  const end = placement.endsWith("end")
  let top = below ? anchor.bottom + space : anchor.top - panel.height - space
  let left = end ? anchor.right - panel.width : anchor.left
  // Pushed into the window rather than switching edge, and to the other
  // side when there is no room on the one asked for.
  left = Math.max(space, Math.min(left, innerWidth - panel.width - space))
  if (below && top + panel.height > innerHeight)
    top = anchor.top - panel.height - space
  else if (!below && top < space) top = anchor.bottom + space
  top = Math.max(space, Math.min(top, innerHeight - panel.height - space))
  return { top: Math.round(top), left: Math.round(left) }
}

function violations(
  before: Snapshot,
  after: Snapshot,
  step: Step,
  was: Context,
  now: Context,
): string[] {
  const problems: string[] = []
  const e = expectation
  const { trigger, panel } = after
  if (!after.host || !trigger || !panel) return ["no button or panel"]

  // The button is a button, named by its text, and expandable.
  seen.trigger++
  const name = flat(after.text)
  const buttons = after.tree.filter(
    (n) => n.role === "button" && n.name === name,
  )
  if (buttons.length !== 1)
    problems.push(
      `the screen reader is given ${buttons.length} buttons named "${name}"`,
    )
  else if (!buttons[0].states.includes("expandable"))
    problems.push(`the button "${name}" is not expandable`)

  /*
   * `aria-expanded` says whether the panel is in the top layer, and so do
   * `open` on the host and the tree; the panel's actions are in the tree
   * exactly when it is open.
   */
  seen.expanded++
  if (after.expanded !== String(after.shown))
    problems.push(
      `aria-expanded is "${after.expanded}" on a panel that is ${after.shown ? "open" : "closed"}`,
    )
  if (after.open !== after.shown)
    problems.push(
      `the host says ${after.open ? "open" : "closed"} over a panel that is ${after.shown ? "open" : "closed"}`,
    )
  if (buttons[0] && buttons[0].states.includes("expanded") !== after.shown)
    problems.push(
      `the screen reader is told the button is ${after.shown ? "collapsed" : "expanded"}`,
    )
  const items = after.tree.filter(
    (n) => n.role === "button" && ITEMS.includes(n.name),
  )
  if (items.length > 0 !== after.shown)
    problems.push(
      `the screen reader is given ${items.length} of the panel's actions on a panel that is ${after.shown ? "open" : "closed"}`,
    )

  // `aria-controls` points at the panel, when it has an id to point at; the
  // component never invents one.
  seen.controls++
  if (panel.id) {
    if (
      after.controls !== panel.id ||
      document.getElementById(panel.id) !== panel
    )
      problems.push(
        `the button controls "${after.controls}", not the panel "${panel.id}"`,
      )
  } else if (after.controls !== null)
    problems.push(
      `the button controls "${after.controls}", but the panel has no id`,
    )

  // The open state the promises say.
  if (e.open !== null && e.why !== null) {
    seen[e.why]++
    if (after.shown !== e.open)
      problems.push(
        {
          user: `the panel is ${after.shown ? "open" : "closed"} after ${label(step)}, though the user left it ${e.open ? "open" : "closed"}`,
          app: `the panel is ${after.shown ? "open" : "closed"} after ${label(step)}`,
          server: `the panel is ${after.shown ? "open" : "closed"}, not ${e.open ? "open" : "closed"} as the server said`,
          serverOpens: "the server sent open, and the panel did not open",
          controlled: `under server-controlled the panel is ${after.shown ? "open" : "closed"}, not the server's ${e.open ? "open" : "closed"}`,
        }[e.why],
      )
  }

  // Escape closes the panel and gives the focus back to the button, when
  // it was in the popover or nowhere; from another field it stays there.
  if ("user" in step && step.user === "Escape" && before.shown) {
    seen.escape++
    if (after.shown) problems.push("Escape did not close the panel")
    if (after.active !== e.focus)
      problems.push(
        `after Escape the focus is on <${after.active?.localName}>, not <${e.focus?.localName}>`,
      )
  } else if (e.focus) {
    // Tab from the button goes into the open panel.
    seen.tab++
    if (after.active !== e.focus)
      problems.push(
        `the focus is on <${after.active?.localName}>, not where ${label(step)} puts it`,
      )
  }

  /*
   * The panel closed with the focus in it: the focus is not lost to
   * `<body>`, where the next Tab starts at the top of the page. Not after
   * a click elsewhere, which puts the focus where the user clicked, and on
   * `<body>` in WebKit, as any click on something that takes no focus.
   * And only when the panel is the same node: a panel replaced by
   * `outerHTML` or `innerHTML` takes the focus with it, whatever the
   * component does.
   *
   * Lost is also the focus left on a node in the closed panel: Chromium
   * moves it to `<body>` only at the next rendering update, so
   * `activeElement` can still name the hidden button when the step is read.
   */
  if (
    before.shown &&
    !after.shown &&
    before.panel === panel &&
    before.active !== null &&
    before.panel?.contains(before.active) &&
    !("user" in step && step.user === "click outside")
  ) {
    seen.focusInside++
    const lost =
      after.active === null ||
      after.active === document.body ||
      !after.active.isConnected ||
      !after.active.checkVisibility()
    if (lost)
      problems.push(
        "the panel closed with the focus in it, and the focus was lost to <body>",
      )
  }

  /*
   * A morph keeps the button and the panel, which have no id the server did
   * not send, and the element with the focus keeps it while it is shown.
   */
  if ("send" in step && (step.way === "Datastar" || step.way === "idiomorph")) {
    const old = INFO[was.body].panelId
    const neu = INFO[now.body].panelId
    if (old === null || old === neu) {
      seen.kept++
      if (before.panel !== panel) problems.push("the update replaced the panel")
      if (before.trigger !== trigger)
        problems.push("the update replaced the button")
      const focused = before.active
      if (
        focused &&
        focused !== document.body &&
        before.host?.contains(focused) &&
        focused.isConnected &&
        (focused === trigger || after.shown) &&
        after.active !== focused
      )
        problems.push(
          `the update took the focus from <${focused.localName}> "${flat(focused.textContent)}"`,
        )
    }
  }

  // `popover-toggle` once per change the user or a method makes, and never
  // for the server or the property.
  if (e.events !== null) {
    seen.events++
    if (events.join() !== e.events.join())
      problems.push(
        `popover-toggle gave [${events.join()}], not [${e.events.join()}]`,
      )
  }

  /*
   * The component writes no id: an id on the panel the server did not send
   * makes a morph replace it, with the focus. And no id is there twice.
   */
  seen.ids++
  for (const el of document.querySelectorAll("#lt-test-surface [id]"))
    if (!SENT_IDS.has(el.id))
      problems.push(
        `a <${el.localName}> has the id "${el.id}", which no server sent`,
      )
  const all = [...document.querySelectorAll("#lt-test-surface [id]")].map(
    (el) => el.id,
  )
  const twice = all.filter((id, i) => all.indexOf(id) !== i)
  if (twice.length > 0) problems.push(`two elements have the id "${twice[0]}"`)

  // The open panel hangs from the edge the placement names, moved into the
  // window where there is no room.
  if (after.shown && after.panelBox && after.triggerBox) {
    seen.position++
    const want = expectedPosition(
      after.placement,
      after.triggerBox,
      after.panelBox,
    )
    if (
      Math.abs(after.panelBox.top - want.top) > 1 ||
      Math.abs(after.panelBox.left - want.left) > 1
    )
      problems.push(
        `the panel is at ${Math.round(after.panelBox.left)},${Math.round(after.panelBox.top)}, not at ${want.left},${want.top} for ${after.placement}`,
      )
  }

  /*
   * Markup that already says everything, as `lt.popover()` writes it, is
   * left exactly as sent: the component has nothing to write, and React
   * hydrates without mismatches. An open panel needs its position, and
   * that is all.
   */
  if (
    "send" in step &&
    (step.send === "builder" || step.send === "builderOpen") &&
    now.host === step.send &&
    now.body === step.send &&
    after.shown === INFO[step.send].open
  ) {
    seen.untouched++
    const want = after.shown ? SENT_BUILDER_OPEN : SENT_BUILDER
    const got = after.shown ? withoutPosition(after.markup) : after.markup
    if (got !== want)
      problems.push(
        `the component wrote on markup that already said everything: ${got}`,
      )
  }

  /*
   * The same version sent again by a morph changes nothing: the same nodes,
   * the same markup, the same state. The position a closed panel was left
   * with means nothing, and a morph may take it.
   */
  if (
    "send" in step &&
    (step.way === "Datastar" || step.way === "idiomorph") &&
    was.host === step.send &&
    was.body === step.send &&
    was.fresh
  ) {
    seen.stable++
    const settled = (s: Snapshot) =>
      s.shown ? s.markup : withoutPosition(s.markup)
    if (settled(after) !== settled(before))
      problems.push(
        `the same version sent again changed the markup from ${settled(before)} to ${settled(after)}`,
      )
    if (after.shown !== before.shown)
      problems.push("the same version sent again opened or closed the panel")
  }
  return problems
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
   * open. The versions differ in what the page shows (`server-controlled`,
   * `popover`, the id), so the version's name is left out, and two versions
   * that give the same page are continued once.
   */
  contextKey: (c) => `${c.wants}`,
  violations,
  seen,
  // The toggle event is a task of its own, after the step's.
  settle: async () => {
    await settle()
    await settle()
  },
  reset: () => {
    current = INITIAL
  },
}

describe("lt-popover, every sequence of updates and user actions", () => {
  beforeAll(async () => {
    // The panel without an id is warned about, as it should be; the warning
    // has its own test in `messages.browser.test.ts`, and here it is noise.
    vi.spyOn(console, "warn").mockImplementation(() => {})
    defineLtPopover()
    core = accessibilityCore(await (await fetch(coreUrl)).arrayBuffer())
    document.addEventListener("popover-toggle", onToggle)
  })
  afterAll(() => {
    document.removeEventListener("popover-toggle", onToggle)
  })

  // Each search counts for itself, so neither leans on the other's checks.
  const fresh = () => {
    for (const k of Object.keys(seen)) seen[k as keyof typeof seen] = 0
  }

  it("keeps the button's state, the wiring, the focus, the position, the events and the ids in every state to depth 3", async () => {
    fresh()
    const run = await exploreStates(model, 3)
    expect(run.found.slice(0, 10)).toEqual([])
    // The search found more states than one step gives.
    expect(run.states).toBeGreaterThan(STATE_STEPS.length)
    expect(unchecked(seen)).toEqual([])
  }, 600_000)

  /*
   * Every sequence, without merging states. The state key holds what the
   * component remembers (that the user asked for the panel open) as the
   * model computes it; where the component remembers otherwise, two paths
   * the key merges still differ, and only a path shows it. In Chromium
   * only, and only by the morphers: `outerHTML` makes a new component, with
   * no memory to carry.
   */
  it.runIf(server.browser === "chromium")(
    "keeps the same invariants on every sequence of morphs to depth 3",
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
