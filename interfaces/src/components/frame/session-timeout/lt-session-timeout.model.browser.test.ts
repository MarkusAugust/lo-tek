/// <reference path="../../../types/css.d.ts" />
/// <reference path="../../../testing/vite-url.d.ts" />

/**
 * Every sequence of server updates, user actions and seconds passing on the
 * session warning, to a fixed depth, with the screen reader's view, the
 * events and the focus checked after each step.
 *
 * The scenario tests in `lt-session-timeout.browser.test.ts` each follow one
 * path: so many seconds, a key press, a look. This one does not choose: the
 * server can send any of the versions below, by any of the ways an update
 * arrives, the user can be active, answer the warning or press Escape, the
 * app can call `extend()` or `reset()`, and the clock can move to the
 * moments the promises name, in any order.
 *
 * What must happen is computed by a clock of the test's own, from what the
 * page and the doc comments promise: the warning opens at `warn-at` seconds
 * without activity and the session expires at `expires-at`; activity counts
 * only while the warning is closed and the session is not over; the warning
 * is announced as it opens and at 2 minutes, 1 minute, 30 and 10 seconds
 * left; `session-activity` comes at the start of an interval and at its end
 * when the user did something since, never while the warning shows; after
 * `session-expired` and `session-logout` nothing happens until `extend()` or
 * `reset()`. The component's own clock is not read: the test's clock says
 * what the component's must have done.
 *
 * The page is the "Plain HTML" recipe from the component page, in a region
 * the server updates, next to a field the user is filling in and a panel
 * that scrolls. The component is the real one, and so are Datastar and
 * idiomorph. Time is a fake clock (`setInterval` and `Date`), installed
 * before every replay, so a path of 1800 seconds takes milliseconds.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { server, userEvent } from "vitest/browser"
import page from "../../../../../documentation/src/content/docs/components/session-timeout.mdx?raw"
import coreUrl from "../../../../core/lotek-core.wasm?url"
import {
  type AccessibilityCore,
  type AxNode,
  accessibilityCore,
} from "../../../testing/accessibility"
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
import {
  datastarPatch,
  type Replacement,
  replace,
} from "../../../testing/update"
import {
  defineLtSessionTimeout,
  LT_SESSION_TIMEOUT_PARTS,
  type LtSessionTimeout,
} from "./lt-session-timeout"

import "../../../tokens/tokens.css"
import "./session-timeout.css"
import "../../css/button/button.css"

/** `text` with `from` replaced, which must be there: a recipe that changed would otherwise test nothing. */
function swap(text: string, from: string | RegExp, to: string): string {
  const out = text.replace(from, to)
  if (out === text)
    throw new Error(`the recipe has no ${String(from)} to replace`)
  return out
}

const HOST = (
  tabItems(page)
    .filter((t) => t.name === "Plain HTML")
    .flatMap((t) => htmlBlocks(t.code))
    .map((b) => b.match(/<lt-session-timeout[\s\S]*?<\/lt-session-timeout>/))
    .find((m) => m !== null)?.[0] ?? ""
).replace(/\n\s*/g, "\n")
const HOST_TAG = HOST.match(/^<lt-session-timeout[^>]*>/)?.[0] ?? ""
const DIALOG_TAG = HOST.match(/<dialog[^>]*>/)?.[0] ?? ""
const HEADING = HOST.match(/<h2[^>]*>([^<]+)<\/h2>/)
const TEXT = HOST.match(/<p class="lt-session-timeout__text">([\s\S]*?)<\/p>/)
const BUTTONS = [
  ...HOST.matchAll(/<button[^>]*\svalue="([^"]+)"[^>]*>([^<]+)</g),
]
const TITLE_ID = DIALOG_TAG.match(/\saria-labelledby="([^"]+)"/)?.[1]
const WARN_AT = Number(HOST_TAG.match(/\swarn-at="(\d+)"/)?.[1])
const EXPIRES_AT = Number(HOST_TAG.match(/\sexpires-at="(\d+)"/)?.[1])
// The recipe must be what the versions below change: a protected host with
// both numbers, a dialog named by its heading's id, a paragraph with the
// number in it, and the two buttons.
if (
  !/\sdata-ignore-morph[\s>]/.test(HOST_TAG) ||
  /activity-interval/.test(HOST_TAG) ||
  !WARN_AT ||
  !EXPIRES_AT ||
  !TITLE_ID ||
  !HEADING?.[0].includes(`id="${TITLE_ID}"`) ||
  !TEXT?.[1].includes("lt-session-timeout__count") ||
  BUTTONS.map((b) => b[1]).join() !== "extend,logout"
)
  throw new Error(
    "the recipe is not a protected host with warn-at and expires-at, a named dialog, a paragraph with the number and the two buttons",
  )

/**
 * The region the server updates. The host has no id in the recipe, and a
 * Datastar patch without a selector needs one, so the server patches the
 * element around it, as a page that sends its regions does.
 */
const REGION_ID = "session-region"
const region = (host: string) => `<div id="${REGION_ID}">${host}</div>`
const FIELD_ID = "route"
const PANEL_ID = "log"
/*
 * The form the user is filling in, which the warning must give the focus
 * back to, and a panel that scrolls, which counts as activity.
 */
const PAGE = `<label for="${FIELD_ID}">Route</label>
<input id="${FIELD_ID}">
<div id="${PANEL_ID}" style="overflow: auto; height: 2rem"><div style="height: 10rem"></div></div>`
/*
 * English, so the duration the component speaks with `Intl` is the one the
 * test writes out below whatever language the browser has.
 */
const RECIPE = `<div lang="en">${PAGE}\n${region(HOST)}</div>`

const LABEL = "Your session is about to end"
/** What the server can send. The host's attributes and the content are both in it. */
const VERSIONS: Record<string, string> = {
  recipe: HOST,
  // Both numbers lowered: a session the server shortened.
  sooner: swap(
    HOST,
    /\swarn-at="\d+" expires-at="\d+"/,
    ' warn-at="1200" expires-at="1500"',
  ),
  // A shorter interval between the reports of activity.
  interval: swap(
    HOST,
    /\sdata-ignore-morph/,
    ' activity-interval="20" data-ignore-morph',
  ),
  // The server names the dialog with `aria-label`, and the heading stays.
  label: swap(
    HOST,
    DIALOG_TAG,
    DIALOG_TAG.replace(/aria-labelledby="[^"]+"/, `aria-label="${LABEL}"`),
  ),
  /*
   * A template that forgot the class, the role and the name: the component
   * fills them in, with an id of its own on the heading.
   */
  heading: swap(
    swap(HOST, DIALOG_TAG, "<dialog>"),
    HEADING[0],
    `<h2 class="lt-session-timeout__title">${HEADING[1]}</h2>`,
  ),
  // The texts changed, as when the server sends them in another wording.
  texts: swap(
    swap(
      swap(
        swap(HOST, HEADING[1], "Session ending"),
        /Unsaved routes will be lost\./,
        "Answer, or the Lattice logs you out.",
      ),
      BUTTONS[0][2],
      "Keep working",
    ),
    BUTTONS[1][2],
    "Log out now",
  ),
  // Without `data-ignore-morph`: every Datastar patch morphs the warning.
  unprotected: swap(HOST, /\s+data-ignore-morph/, ""),
}

/** What a version says, read from its markup once. */
type Info = {
  warnAt: number
  expiresAt: number
  interval: number
  /** `data-ignore-morph`: Datastar leaves the host alone when both sides have it. */
  protected: boolean
  /** The name the dialog must have once the component has run. */
  name: string
  /** What the component must write for the name: nothing, or the heading's id and the reference. */
  named: "labelledby" | "label" | "heading"
  ids: Set<string>
  /** The paragraph as the status must read it, with the duration in place of the number. */
  sentence(duration: string): string
  /** What `innerHTML` on the host writes. */
  inner: string
}

const flat = (text: string | null | undefined) =>
  (text ?? "").replace(/\s+/g, " ").trim()

function info(html: string): Info {
  const t = document.createElement("template")
  t.innerHTML = html
  const host = t.content.querySelector("lt-session-timeout") as Element
  const d = host.querySelector("dialog") as HTMLDialogElement
  const heading = d.querySelector(LT_SESSION_TIMEOUT_PARTS.title)
  const labelledby = d.getAttribute("aria-labelledby")
  const label = d.getAttribute("aria-label")
  const text = d
    .querySelector(LT_SESSION_TIMEOUT_PARTS.text)
    ?.cloneNode(true) as Element
  text.querySelector(LT_SESSION_TIMEOUT_PARTS.count)?.replaceWith("\u0000")
  const [beforeCount, afterCount] = (text.textContent ?? "").split("\u0000")
  const seconds = (name: string, fallback: number) =>
    Number(host.getAttribute(name) ?? fallback)
  return {
    warnAt: seconds("warn-at", 1500),
    expiresAt: seconds("expires-at", 1800),
    interval: seconds("activity-interval", 60),
    protected: host.hasAttribute("data-ignore-morph"),
    name: labelledby
      ? flat(t.content.getElementById(labelledby)?.textContent)
      : (label ?? flat(heading?.textContent)),
    named: labelledby ? "labelledby" : label ? "label" : "heading",
    ids: new Set([...t.content.querySelectorAll("[id]")].map((e) => e.id)),
    sentence: (duration) => flat(`${beforeCount}${duration}${afterCount}`),
    inner: host.innerHTML,
  }
}
const INFO = Object.fromEntries(
  Object.entries(VERSIONS).map(([name, html]) => [name, info(html)]),
)

/** The number as the dialog shows it. */
const clock = (s: number) =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
/**
 * The duration as an English page says it, written out here rather than with
 * `Intl`, so the test does not compute it the way the component does.
 */
function spoken(s: number): string {
  const m = Math.floor(s / 60)
  const r = s % 60
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
  if (m === 0) return unit(r, "second")
  if (r === 0) return unit(m, "minute")
  return `${unit(m, "minute")} and ${unit(r, "second")}`
}
/** The seconds left at which the page promises an announcement, besides the opening. */
const ANNOUNCE_AT = [120, 60, 30, 10]

type Way = Replacement | "innerHTML"
type Clock =
  | "to just before warn-at"
  | "to warn-at"
  | "1 second"
  | "to the next announcement"
  | "to expires-at"
type Action =
  | "press Shift"
  | "click field"
  | "scroll panel"
  | "Escape"
  | "click stay"
  | "click log out"
  | "extend()"
  | "reset()"
type Step = { send: string; way: Way } | { clock: Clock } | { user: Action }

/*
 * `innerHTML` on the host keeps the host, its attributes and the
 * component's memory, and replaces the dialog; it carries only the versions
 * whose content differs from the recipe's, and the recipe.
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
const CLOCKS: Step[] = (
  [
    "to just before warn-at",
    "to warn-at",
    "1 second",
    "to the next announcement",
    "to expires-at",
  ] as Clock[]
).map((clock) => ({ clock }))
const ACTIONS: Step[] = (
  [
    "press Shift",
    "click field",
    "scroll panel",
    "Escape",
    "click stay",
    "click log out",
    "extend()",
    "reset()",
  ] as Action[]
).map((user) => ({ user }))
const STEPS: Step[] = [...SENDS, ...CLOCKS, ...ACTIONS]

function label(step: Step): string {
  if ("send" in step) return `${step.send} by ${step.way}`
  if ("clock" in step) return step.clock
  return step.user
}

const pick = (names: string[]) => {
  const picked = STEPS.filter((s) => names.includes(label(s)))
  if (picked.length !== names.length)
    throw new Error(
      `no step called ${names.filter((n) => !STEPS.some((s) => label(s) === n)).join(", ")}`,
    )
  return picked
}

/*
 * Neither search can take all the steps to depth 3 within the time a run may
 * take, so the steps are cut, not the invariants. Most Datastar patches land
 * on a protected host and change nothing, which the state search merges at
 * once, so they cost little; idiomorph and `outerHTML` are kept for the
 * versions that change what the component computes from (the numbers, the
 * name, the texts, the protection); `innerHTML` for the dialog replaced
 * under the host; and every clock step and action.
 */
const STATE_STEPS = pick([
  ...Object.keys(VERSIONS).map((v) => `${v} by Datastar`),
  ...["recipe", "sooner", "heading", "texts", "unprotected"].map(
    (v) => `${v} by idiomorph`,
  ),
  "recipe by outerHTML",
  "interval by outerHTML",
  "label by outerHTML",
  "texts by innerHTML",
  ...CLOCKS.map(label),
  ...ACTIONS.map(label),
])
const SEQUENCE_STEPS = pick([
  "heading by Datastar",
  "to just before warn-at",
  "unprotected by idiomorph",
  "heading by idiomorph",
  "texts by innerHTML",
  "recipe by outerHTML",
  "to warn-at",
  "1 second",
  "to the next announcement",
  "to expires-at",
  "press Shift",
  "Escape",
  "click stay",
  "click log out",
  "extend()",
])

type Phase = "quiet" | "open" | "stopped"

/**
 * The test's clock and what it remembers, which is the component's
 * promised behaviour, not its fields. Times are whole seconds from the
 * mount: every step moves the fake clock by whole seconds, so the
 * component's ticks and the activity always fall on the same grid.
 */
type Context = {
  /** The version whose attributes are on the host. */
  host: string
  /** The version the dialog's content came from, or null when a morph mixed two. */
  body: string | null
  /** Nothing but updates since the version was sent: the page is as it left it. */
  fresh: boolean
  /** Closed and counting, the warning showing, or the session over. */
  phase: Phase
  t: number
  /** When the clock was last reset: by activity, `extend()` or `reset()`, or the mount. */
  last: number
  /** When this host last sent `session-activity`, or null if never. */
  reported: number | null
  /** Activity since the last `session-activity`, not yet reported. */
  pending: boolean
  /** The seconds left at the previous tick of an open warning. */
  previousLeft: number | null
  /** What the number must show while the warning is open, or null: a morph emptied it until the next tick. */
  count: string | null
  /** What the status must say, or null when a morph mixed the paragraph from two versions. */
  status: string | null
  /** Where the focus goes back to when the warning closes. */
  returnTo: "field" | "body" | null
  /**
   * The warning was open when the server replaced its dialog: it opens again
   * at the next tick, and the focus still belongs where the user was before
   * the warning first came.
   */
  interrupted: boolean
  /** When this host's last `session-activity` was seen, by the fake clock, whatever the test's clock says. */
  seenActivity: number | null
  /** The id this host wrote on a heading, once it has written one. */
  titleId: string | null
}

const INITIAL: Context = {
  host: "recipe",
  body: "recipe",
  fresh: true,
  phase: "quiet",
  t: 0,
  last: 0,
  reported: null,
  pending: false,
  previousLeft: null,
  count: null,
  status: "",
  returnTo: null,
  interrupted: false,
  seenActivity: null,
  titleId: null,
}

/** What the step must lead to, computed in `apply` from the page before it. */
type Expectation = {
  context: Context
  events: string[]
  /** The sentences the status must be given during the step, in order; null where the paragraph is mixed. */
  announced: (string | null)[]
  /** Where the focus must be after a close in this step. */
  focus: "field" | "body" | null
  /** The step closed the warning with the dialog in place, so the focus is the component's to return. */
  closed: boolean
  /** The warning opened again on a replaced dialog, without a new `session-warn`. */
  continued: boolean
  /** The step crossed `warn-at` or `expires-at` exactly, for the counters. */
  crossed: { warn: boolean; expire: boolean }
}

let current: Context = INITIAL
let expectation: Expectation = {
  context: INITIAL,
  events: [],
  announced: [],
  focus: null,
  closed: false,
  continued: false,
  crossed: { warn: false, expire: false },
}

const regionEl = () => document.getElementById(REGION_ID)
const host = () =>
  regionEl()?.querySelector<LtSessionTimeout>("lt-session-timeout") ?? null
const dialogOf = (h: Element | null) =>
  h?.querySelector<HTMLDialogElement>("dialog") ?? null
const field = () => document.getElementById(FIELD_ID) as HTMLInputElement
const isModal = (d: Element | null) => d?.matches(":modal") ?? false
const where = (e: Element | null): Context["returnTo"] =>
  e === field() ? "field" : e === null || e === document.body ? "body" : null

/** One second of the component's clock, as the promises describe it. */
function tick(c: Context, out: Expectation) {
  c.t++
  if (c.phase === "stopped") return
  const v = INFO[c.host]
  report(c, out)
  const idle = c.t - c.last
  const left = v.expiresAt - idle
  if (left <= 0) {
    if (c.phase === "open") close(c, out)
    c.phase = "stopped"
    out.events.push("session-expired")
    out.crossed.expire ||= idle === v.expiresAt
    return
  }
  // An open warning counts on even if `warn-at` was raised meanwhile.
  if (idle < v.warnAt && c.phase !== "open") return
  if (c.phase !== "open") {
    open(c, left, out)
    out.crossed.warn ||= idle === v.warnAt
    return
  }
  // A threshold crossed, not hit: a tick that comes late still announces.
  const previous = c.previousLeft ?? left + 1
  c.previousLeft = left
  c.count = clock(left)
  if (ANNOUNCE_AT.some((at) => previous > at && left <= at))
    announce(c, left, out)
}

function announce(c: Context, left: number, out: Expectation) {
  const sentence = c.body === null ? null : INFO[c.body].sentence(spoken(left))
  c.status = sentence
  out.announced.push(sentence)
}

function open(c: Context, left: number, out: Expectation) {
  c.phase = "open"
  c.previousLeft = left
  c.count = clock(left)
  // Activity before the warning is already in the clock, and none is
  // reported while it shows.
  c.pending = false
  announce(c, left, out)
  /*
   * A warning whose dialog the server replaced while it showed never
   * closed: the user has been warned the whole time, so the focus still
   * belongs where it was before, and no second `session-warn` is sent.
   */
  if (c.interrupted) out.continued = true
  else {
    c.returnTo = where(document.activeElement)
    out.events.push("session-warn")
  }
  c.interrupted = false
}

/** The warning closes: the status is emptied, and the focus goes back. */
function close(c: Context, out: Expectation) {
  c.phase = "quiet"
  c.status = ""
  out.focus = c.returnTo
  out.closed = true
  c.returnTo = null
}

/** `session-activity` at the start of an interval, and at its end if there was activity since. */
function report(c: Context, out: Expectation) {
  if (!c.pending || c.phase !== "quiet") return
  const v = INFO[c.host]
  // Activity older than the expiry is stale, as after a frozen tab.
  if (c.t - c.last >= v.expiresAt) {
    c.pending = false
    return
  }
  if (c.reported !== null && c.t - c.reported < Math.max(1, v.interval)) return
  c.reported = c.t
  c.pending = false
  out.events.push("session-activity")
}

function activity(c: Context, out: Expectation) {
  // While the warning shows, or after the session is over, activity is not
  // "I am here": a random click must not extend the session.
  if (c.phase !== "quiet") return
  c.last = c.t
  c.pending = true
  c.interrupted = false
  report(c, out)
}

/** `extend()` and `reset()`: the clock reset, the warning closed, the session started again. */
function restart(c: Context, out: Expectation) {
  if (c.phase === "open") close(c, out)
  c.phase = "quiet"
  c.last = c.t
  c.interrupted = false
}

/** How far a clock step moves, from where the test's clock stands. */
function seconds(c: Context, step: Clock): number {
  const v = INFO[c.host]
  const idle = c.t - c.last
  const left = v.expiresAt - idle
  switch (step) {
    case "1 second":
      return 1
    case "to just before warn-at":
      return c.phase === "quiet" ? Math.max(0, v.warnAt - 1 - idle) : 0
    case "to warn-at":
      return c.phase === "quiet" ? Math.max(0, v.warnAt - idle) : 0
    case "to the next announcement": {
      const at = ANNOUNCE_AT.find((a) => a < left)
      return c.phase === "open" && at !== undefined ? left - at : 0
    }
    case "to expires-at":
      return c.phase === "stopped" ? 0 : Math.max(0, left)
  }
}

function predict(c0: Context, step: Step): Expectation {
  const c: Context = { ...c0, fresh: false }
  const out: Expectation = {
    context: c,
    events: [],
    announced: [],
    focus: null,
    closed: false,
    continued: false,
    crossed: { warn: false, expire: false },
  }
  const d = dialogOf(host())
  const modal = isModal(d)
  if ("clock" in step) {
    const n = seconds(c0, step.clock)
    for (let i = 0; i < n; i++) tick(c, out)
    return out
  }
  if ("user" in step) {
    switch (step.user) {
      case "press Shift":
      case "scroll panel":
        activity(c, out)
        break
      case "click field":
        // Behind the modal warning the field is inert, and is not clicked.
        if (!modal) activity(c, out)
        break
      case "Escape":
        // The key press comes before the close, and does not count while
        // the warning shows. Escape is "I am here", as the button is.
        if (modal) {
          close(c, out)
          restart(c, out)
          out.events.push("session-extend")
        } else activity(c, out)
        break
      case "click stay":
        if (modal) {
          close(c, out)
          restart(c, out)
          out.events.push("session-extend")
        }
        break
      case "click log out":
        if (modal) {
          close(c, out)
          c.phase = "stopped"
          out.events.push("session-logout")
        }
        break
      case "extend()":
        restart(c, out)
        out.events.push("session-extend")
        break
      case "reset()":
        restart(c, out)
        break
    }
    return out
  }
  const v = INFO[step.send]
  const was = INFO[c0.host]
  c.fresh = true
  if (step.way === "Datastar" && was.protected && v.protected) {
    // Datastar leaves a host alone when both sides carry `data-ignore-morph`.
    return { ...out, context: { ...c0 } }
  }
  if (step.way === "outerHTML") {
    // A new component, with no memory and its clock from now. The old one
    // goes without a word.
    out.context = {
      ...INITIAL,
      host: step.send,
      body: step.send,
      t: c0.t,
      last: c0.t,
    }
    return out
  }
  if (step.way === "innerHTML") {
    // The host and its numbers stay; the dialog is new, closed and empty.
    c.body = step.send
    c.status = ""
    c.count = null
    if (c.phase === "open") {
      c.phase = "quiet"
      c.interrupted = true
    }
    return out
  }
  /*
   * A morph keeps the host, the component and the dialog node, and writes
   * the version's attributes and content: the number and the status come
   * back empty, as the server sent them, and the number returns at the next
   * tick. idiomorph leaves the children of the element with the focus as
   * they were; WebKit can give the dialog itself the focus, and then the
   * content stays the old version's under the new attributes.
   */
  const kept =
    step.way === "idiomorph" && document.activeElement === d && d !== null
  c.host = step.send
  c.body = kept ? (c0.body === step.send ? step.send : null) : step.send
  c.status = c.body === null ? null : ""
  if (c.phase === "open") c.count = null
  return out
}

/** Every id some version sends, on any element, and the page's own. */
const SENT_IDS = new Set([
  ...Object.values(INFO).flatMap((v) => [...v.ids]),
  REGION_ID,
  FIELD_ID,
  PANEL_ID,
  "lt-test-surface",
])
/** The id the component wrote on a heading, if it wrote one. */
const writtenId = (h: Element | null): string | null =>
  [...(h?.querySelectorAll("[id]") ?? [])]
    .map((e) => e.id)
    .find((id) => !SENT_IDS.has(id)) ?? null

/** The events during a step, and the sentences the status was given. */
let events: { type: string; at: number }[] = []
let announced: string[] = []
const EVENTS = [
  "session-warn",
  "session-extend",
  "session-logout",
  "session-expired",
  "session-activity",
]
const onEvent = (e: Event) => events.push({ type: e.type, at: Date.now() })
/** Each text node put into a status is one announcement. */
const announcer = new MutationObserver((records) => {
  for (const r of records)
    if (
      r.target instanceof Element &&
      r.target.matches(LT_SESSION_TIMEOUT_PARTS.status)
    )
      for (const n of r.addedNodes)
        if (n.nodeType === Node.TEXT_NODE && flat(n.nodeValue) !== "")
          announced.push(flat(n.nodeValue))
})

/** Before the step: the page the expectation was computed from. */
let before: { host: Element | null; dialog: Element | null; modal: boolean } = {
  host: null,
  dialog: null,
  modal: false,
}

async function apply(step: Step): Promise<void> {
  announcer.takeRecords()
  events = []
  announced = []
  const h = host()
  const d = dialogOf(h)
  before = { host: h, dialog: d, modal: isModal(d) }
  expectation = predict(current, step)
  if ("send" in step) {
    if (step.way === "innerHTML") {
      if (h) h.innerHTML = INFO[step.send].inner
    } else if (step.way === "Datastar")
      datastarPatch(region(VERSIONS[step.send]))
    else replace(step.way, REGION_ID, region(VERSIONS[step.send]))
    return
  }
  if ("clock" in step) {
    vi.advanceTimersByTime(seconds(current, step.clock) * 1000)
    return
  }
  const modal = before.modal
  switch (step.user) {
    case "press Shift":
      await userEvent.keyboard("{Shift}")
      break
    case "click field":
      // Behind a modal dialog the field is inert, and Playwright would wait
      // for it in vain.
      if (!modal) await userEvent.click(field())
      break
    case "scroll panel": {
      // A real scroll, which the browser reports in the next frame; it does
      // not bubble, and the component listens in the capture phase.
      const panel = document.getElementById(PANEL_ID) as HTMLElement
      const scrolled = new Promise((r) =>
        panel.addEventListener("scroll", r, { once: true }),
      )
      panel.scrollTop = panel.scrollTop > 0 ? 0 : 40
      await scrolled
      break
    }
    case "Escape":
      await userEvent.keyboard("{Escape}")
      break
    case "click stay":
    case "click log out":
      // The buttons are shown only in an open warning. A modal dialog
      // without `open` is hidden, and Playwright would wait for its button
      // in vain; the invariants report that dialog.
      if (modal && d?.open)
        await userEvent.click(
          d?.querySelector(
            `button[value="${step.user === "click stay" ? "extend" : "logout"}"]`,
          ) as HTMLButtonElement,
        )
      break
    case "extend()":
      h?.extend()
      break
    case "reset()":
      h?.reset()
      break
  }
}

/** The context after the step, from the expectation and the page as it settled. */
function next(): Context {
  const ctx = { ...expectation.context }
  ctx.titleId ??= writtenId(host())
  for (const e of events)
    if (e.type === "session-activity") ctx.seenActivity = e.at
  current = ctx
  return ctx
}

let core: AccessibilityCore

type Snapshot = {
  tree: AxNode[]
  host: Element | null
  dialog: HTMLDialogElement | null
  modal: boolean
  dialogOpen: boolean
  heading: Element | null
  count: string | null
  status: string
  active: Element | null
  /** Whether the field could take the focus: it must not behind a modal dialog. */
  fieldReachable: boolean
  markup: string
}

function snapshot(): Snapshot {
  const h = host()
  const d = dialogOf(h)
  const modal = isModal(d)
  const active = document.activeElement
  /*
   * Inert is not in the markup or in any selector, so it is asked: a focus
   * call on an inert field does nothing. Only behind a modal dialog, and the
   * focus is put back if it moved.
   */
  let fieldReachable = true
  if (modal) {
    field().focus()
    fieldReachable = document.activeElement === field()
    if (fieldReachable) (active as HTMLElement | null)?.focus()
  }
  return {
    tree: core.tree(renderedMarkup()),
    host: h,
    dialog: d,
    modal,
    dialogOpen: d?.hasAttribute("open") ?? false,
    heading: d?.querySelector(LT_SESSION_TIMEOUT_PARTS.title) ?? null,
    count:
      d?.querySelector(LT_SESSION_TIMEOUT_PARTS.count)?.textContent ?? null,
    status: flat(
      d?.querySelector(LT_SESSION_TIMEOUT_PARTS.status)?.textContent,
    ),
    active,
    fieldReachable,
    markup: canonical(h),
  }
}

/** How often each invariant actually had something to check. */
const seen = {
  modal: 0,
  inert: 0,
  warnAt: 0,
  notYet: 0,
  name: 0,
  count: 0,
  announced: 0,
  quiet: 0,
  status: 0,
  warn: 0,
  extend: 0,
  logout: 0,
  expired: 0,
  activity: 0,
  interval: 0,
  escape: 0,
  continued: 0,
  stay: 0,
  focusInside: 0,
  returned: 0,
  openThroughUpdate: 0,
  ignored: 0,
  ids: 0,
  titleId: 0,
  untouched: 0,
  stable: 0,
}

/** A version's host as the server sent it, attributes in name order. */
const sent = (name: string) => {
  const t = document.createElement("template")
  t.innerHTML = VERSIONS[name]
  return canonical(t.content.firstElementChild)
}
/** The versions that already say everything: the component has nothing to write on them. */
const UNTOUCHED = Object.keys(VERSIONS).filter((v) => v !== "heading")
const SENT = Object.fromEntries(UNTOUCHED.map((v) => [v, sent(v)]))

const what = (e: Element | null) =>
  e === null
    ? "nothing"
    : e === document.body
      ? "<body>"
      : `<${e.localName}${e.id ? `#${e.id}` : ""}> "${flat(e.textContent)}"`
const list = (a: (string | null)[]) =>
  `[${a.map((s) => (s === null ? "?" : `"${s}"`)).join(", ")}]`

function violations(
  before: Snapshot,
  after: Snapshot,
  step: Step,
  was: Context,
  now: Context,
): string[] {
  const problems: string[] = []
  const e = expectation
  const d = after.dialog
  if (!after.host || !d) return ["no host or dialog"]

  /*
   * Modal exactly when the promises say the warning shows, and `open` says
   * the same: a `<dialog open>` that is not modal is a box on the page
   * without a focus trap, and a modal one without `open` is hidden over an
   * inert page. The page behind is inert: the field cannot take the focus.
   */
  seen.modal++
  const shows = now.phase === "open"
  if (after.modal !== shows)
    problems.push(
      `the warning is ${after.modal ? "showing" : "not showing"}, but the clock says ${now.phase}`,
    )
  if (after.dialogOpen !== after.modal)
    problems.push(
      after.dialogOpen
        ? "the dialog has open without being modal: a box on the page"
        : "the dialog is modal without open, so it is hidden over an inert page",
    )
  if (after.modal) {
    seen.inert++
    if (after.fieldReachable)
      problems.push("the page behind the warning is not inert")
  }
  // Exactly at warn-at, not a second before.
  if (e.crossed.warn) seen.warnAt++
  if ("clock" in step && step.clock === "to just before warn-at" && !shows)
    seen.notYet++

  /*
   * The warning is a modal alertdialog with the name the page promises: the
   * server's `aria-labelledby` or `aria-label`, otherwise the first heading,
   * which the component names it from. Read where the screen reader reads it.
   */
  const dialogs = after.tree.filter(
    (n) => n.role === "alertdialog" || n.role === "dialog",
  )
  if (after.modal) {
    seen.name++
    if (
      dialogs.length !== 1 ||
      dialogs[0].role !== "alertdialog" ||
      !dialogs[0].states.includes("modal")
    )
      problems.push(
        `the screen reader is given ${dialogs.map((n) => `${n.states.includes("modal") ? "a modal" : "a"} ${n.role}`).join(", ") || "nothing"}, not one modal alertdialog`,
      )
    else if (now.body !== null && dialogs[0].name !== INFO[now.body].name)
      problems.push(
        `the warning is named "${dialogs[0].name}", not "${INFO[now.body].name}"`,
      )
  }

  /*
   * The number while the warning shows: the time left, every second. A
   * morph that sent it empty leaves it empty until the next tick, which the
   * page says.
   */
  if (after.modal && now.count !== null) {
    seen.count++
    if (after.count !== now.count)
      problems.push(`the number shows "${after.count}", not "${now.count}"`)
  }

  /*
   * The announcements: the paragraph with the duration spoken, as the
   * warning opens and at 2 minutes, 1 minute, 30 and 10 seconds left, and
   * at no other moment. The status says the last one until the warning
   * closes, which empties it.
   */
  if (e.announced.length > 0) seen.announced++
  if (
    "clock" in step &&
    after.modal &&
    before.modal &&
    e.announced.length === 0
  )
    seen.quiet++
  if (
    announced.length !== e.announced.length ||
    e.announced.some((s, i) => s !== null && s !== announced[i])
  )
    problems.push(
      `the status was given ${list(announced)}, not ${list(e.announced)}`,
    )
  if (now.status !== null) {
    seen.status++
    if (after.status !== now.status)
      problems.push(`the status says "${after.status}", not "${now.status}"`)
  }

  /*
   * The events, each once at its moment and nothing else: `session-warn` as
   * the warning opens, `session-extend` for Escape, the stay button and
   * `extend()`, `session-logout` for the log-out button, `session-expired`
   * at expires-at, `session-activity` as the clock above computes it.
   */
  const types = events.map((x) => x.type)
  if (types.join() !== e.events.join())
    problems.push(
      `the events were [${types.join(", ")}], not [${e.events.join(", ")}]`,
    )
  for (const name of e.events) {
    const k = {
      "session-warn": "warn",
      "session-extend": "extend",
      "session-logout": "logout",
      "session-expired": "expired",
      "session-activity": "activity",
    }[name] as keyof typeof seen
    seen[k]++
  }
  if (e.continued) seen.continued++
  if ("user" in step && before.modal) {
    if (step.user === "Escape") seen.escape++
    if (step.user === "click stay") seen.stay++
  }
  /*
   * At most one `session-activity` per activity-interval from the same
   * host, counted from what was seen, whatever the clock above says.
   */
  let previous = before.host === after.host ? was.seenActivity : null
  for (const { type, at } of events)
    if (type === "session-activity") {
      const interval = INFO[now.host].interval
      if (previous !== null) {
        seen.interval++
        if (at - previous < interval * 1000)
          problems.push(
            `session-activity came ${(at - previous) / 1000} seconds after the last, within the interval of ${interval}`,
          )
      }
      previous = at
    }

  /*
   * The focus: inside the warning whenever it shows, and when it closes
   * with the dialog in place, back where the user was when it first opened.
   */
  if (after.modal) {
    seen.focusInside++
    if (!d.contains(after.active))
      problems.push(
        `the warning shows with the focus on ${what(after.active)}, outside it`,
      )
  }
  /*
   * Only to the field: when nothing had the focus as the warning opened,
   * there is nothing to go back to, and Chromium leaves `activeElement` on
   * the hidden button until the next rendering update.
   */
  if (e.closed && before.dialog === d && e.focus === "field") {
    seen.returned++
    const got = after.active ?? document.body
    if (got !== field())
      problems.push(
        `the warning closed with the focus on ${what(got)}, not back on ${what(field())}`,
      )
  }

  /*
   * An update while the warning shows does not close it, and the countdown
   * goes on from where it was: the number above is the clock's, which an
   * update does not move. Not for `outerHTML`, which is a new component, or
   * `innerHTML`, which removes the dialog the warning was.
   */
  if (
    "send" in step &&
    before.modal &&
    (step.way === "Datastar" || step.way === "idiomorph")
  ) {
    seen.openThroughUpdate++
    if (!after.modal) problems.push("the update closed the warning")
    if (before.dialog !== d) problems.push("the update replaced the dialog")
  }
  /*
   * A Datastar patch on a protected host, with the protection sent again,
   * leaves the warning exactly as it was: the number stays the whole time.
   */
  if (
    "send" in step &&
    step.way === "Datastar" &&
    INFO[was.host].protected &&
    INFO[step.send].protected
  ) {
    seen.ignored++
    if (after.markup !== before.markup)
      problems.push(
        `a patch the page asked Datastar to ignore changed the warning from ${before.markup} to ${after.markup}`,
      )
  }

  /*
   * The only id the component writes is the heading's, and the host keeps
   * the one it wrote: a screen reader following `aria-labelledby` must not
   * have the reference change under it. No id is there twice.
   */
  seen.ids++
  for (const el of document.querySelectorAll("#lt-test-surface [id]"))
    if (!SENT_IDS.has(el.id) && el !== after.heading)
      problems.push(`${what(el)} has the id "${el.id}", which no server sent`)
  const all = [...document.querySelectorAll("#lt-test-surface [id]")].map(
    (el) => el.id,
  )
  const twice = all.filter((id, i) => all.indexOf(id) !== i)
  if (twice.length > 0) problems.push(`two elements have the id "${twice[0]}"`)
  const written = writtenId(after.host)
  if (written !== null && was.titleId !== null && before.host === after.host) {
    seen.titleId++
    if (written !== was.titleId)
      problems.push(
        `the heading's id went from "${was.titleId}" to "${written}" on the same host`,
      )
  }

  /*
   * Markup that already says everything is left exactly as sent while the
   * warning is closed: the component has nothing to write on it.
   */
  if (
    "send" in step &&
    UNTOUCHED.includes(step.send) &&
    now.host === step.send &&
    now.body === step.send &&
    !after.modal &&
    !(step.way === "Datastar" && INFO[was.host].protected)
  ) {
    seen.untouched++
    if (after.markup !== SENT[step.send])
      problems.push(
        `the component wrote on markup that already said everything: ${after.markup}`,
      )
  }

  /*
   * The same version sent again by a morph changes nothing, from a page the
   * version left as it was: the same markup, the same state, no event.
   */
  if (
    "send" in step &&
    (step.way === "Datastar" || step.way === "idiomorph") &&
    was.host === step.send &&
    was.body === step.send &&
    was.fresh
  ) {
    seen.stable++
    if (after.markup !== before.markup)
      problems.push(
        `the same version sent again changed the markup from ${before.markup} to ${after.markup}`,
      )
    if (after.modal !== before.modal)
      problems.push("the same version sent again opened or closed the warning")
  }
  return problems
}

/**
 * Waits for the component, and for a close the browser has queued.
 *
 * `close` is a task of its own, after the click or the key that closed the
 * dialog, and the component answers it there. So a dialog that lost `open`
 * is waited for until its `close` has come, it is open again (the
 * component put the attribute back after a morph), or it is gone.
 */
const pending = new Set<HTMLDialogElement>()
/** Wakes the wait in `settleWarning()` when a close comes or `open` changes. */
let wake: (() => void) | undefined
const watcher = new MutationObserver((records) => {
  for (const r of records)
    if (r.target instanceof HTMLDialogElement && !r.target.open)
      pending.add(r.target)
  wake?.()
})
const onClose = (e: Event) => {
  pending.delete(e.target as HTMLDialogElement)
  wake?.()
}
/** The user is in the form when the page starts: the focus is in the field. */
let mounted = false
async function settleWarning(): Promise<void> {
  if (mounted) {
    mounted = false
    field().focus()
  }
  await settle()
  await settle()
  /*
   * A close from the clock, inside `advanceTimersByTime`, came after more
   * than ten posted messages in Chromium, so the wait is for the `close`
   * itself, or for `open` coming back. The cap is generous: fifty real
   * timers of a millisecond came to 50 to 250 ms, and on a loaded machine a
   * late close was reported as a broken invariant. Only a close that never
   * comes is the invariants' to report.
   */
  const deadline = performance.now() + 2000
  for (;;) {
    for (const d of pending) if (d.open || !d.isConnected) pending.delete(d)
    const left = deadline - performance.now()
    if (pending.size === 0 || left <= 0) break
    let timer: ReturnType<typeof setTimeout> | undefined
    await new Promise<void>((r) => {
      // In a task of its own: `onClose` is on the document, and runs before
      // the component's listener on the host, which empties the status.
      wake = () => setTimeout(r)
      timer = setTimeout(r, left)
    })
    clearTimeout(timer)
    wake = undefined
  }
  pending.clear()
}

/**
 * The component makes the heading's id with `Math.random`, and the state
 * key holds the markup: with a new id on every replay, no two paths ever
 * met. Seeded afresh before every replay, the same path gives the same ids.
 */
const realRandom = Math.random
let seed = 1
const seeded = () => {
  seed = (seed * 16807) % 2147483647
  return seed / 2147483647
}

/*
 * The heading's id is lost to a morph and written again only when the
 * warning opens the next time, which is five steps from the recipe: a
 * template without the id, the warning, Escape, the template again, the
 * warning. Neither search above reaches it, so these three steps go to
 * depth 5, in Chromium; a new id on every opening passed both searches.
 */
const DEEP_STEPS = pick(["heading by idiomorph", "to warn-at", "Escape"])

/** A fixed start, so every replay sees the same times. */
const START = Date.UTC(2079, 0, 1, 9)

const model: Model<Step, Snapshot, Context> = {
  recipe: RECIPE,
  steps: STATE_STEPS,
  apply,
  label,
  snapshot,
  initial: INITIAL,
  next,
  /*
   * What the page does not show: where the test's clock stands against the
   * thresholds, what is waiting to be reported, where the focus goes back,
   * and the id the host remembers.
   */
  contextKey: (c) =>
    [
      c.host,
      c.body,
      c.phase,
      c.t - c.last,
      c.reported === null ? "never" : Math.min(c.t - c.reported, 60),
      c.seenActivity === null
        ? "never"
        : Math.min(START / 1000 + c.t - c.seenActivity / 1000, 60),
      c.pending,
      c.previousLeft,
      c.count === null,
      c.status === null,
      c.returnTo,
      c.interrupted,
      c.titleId,
    ].join("|"),
  violations,
  seen,
  settle: settleWarning,
  reset: () => {
    // The old page goes while its clock is still the one its timers were
    // made with, then the clock starts again from the same moment.
    document.body.replaceChildren()
    vi.useRealTimers()
    vi.useFakeTimers({
      toFake: ["setInterval", "clearInterval", "Date"],
      now: START,
    })
    current = INITIAL
    seed = 1
    mounted = true
    pending.clear()
  },
}

describe("lt-session-timeout, every sequence of updates, actions and seconds", () => {
  beforeAll(async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    Math.random = seeded
    defineLtSessionTimeout()
    core = accessibilityCore(await (await fetch(coreUrl)).arrayBuffer())
    for (const name of EVENTS) document.addEventListener(name, onEvent)
    document.addEventListener("close", onClose, true)
    announcer.observe(document.body, { subtree: true, childList: true })
    watcher.observe(document.body, {
      subtree: true,
      attributeFilter: ["open"],
    })
  })
  afterAll(() => {
    Math.random = realRandom
    vi.useRealTimers()
    vi.restoreAllMocks()
    watcher.disconnect()
    announcer.disconnect()
    for (const name of EVENTS) document.removeEventListener(name, onEvent)
    document.removeEventListener("close", onClose, true)
  })

  // Each search counts for itself, so neither leans on the other's checks.
  const fresh = () => {
    for (const k of Object.keys(seen)) seen[k as keyof typeof seen] = 0
  }

  it("keeps the warning timed, named, announced, reported and focused in every state to depth 3", async () => {
    fresh()
    const run = await exploreStates(model, 3)
    expect(run.found.slice(0, 10)).toEqual([])
    expect(run.states).toBeGreaterThan(STATE_STEPS.length)
    expect(unchecked(seen)).toEqual([])
  }, 600_000)

  it.runIf(server.browser === "chromium")(
    "keeps the same invariants on every sequence to depth 3",
    async () => {
      fresh()
      const run = await exploreSequences(model, 3, SEQUENCE_STEPS)
      expect(run.found.slice(0, 10)).toEqual([])
      expect(run.ran).toBe(SEQUENCE_STEPS.length ** 3)
      expect(unchecked(seen)).toEqual([])
    },
    600_000,
  )

  it.runIf(server.browser === "chromium")(
    "keeps the heading's id through a re-render and a second warning",
    async () => {
      fresh()
      const run = await exploreSequences(model, 5, DEEP_STEPS)
      expect(run.found.slice(0, 10)).toEqual([])
      expect(run.ran).toBe(DEEP_STEPS.length ** 5)
      expect(seen.titleId).toBeGreaterThan(0)
    },
    600_000,
  )
})
