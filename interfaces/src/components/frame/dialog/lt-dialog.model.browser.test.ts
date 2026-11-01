/// <reference path="../../../types/css.d.ts" />
/// <reference path="../../../testing/vite-url.d.ts" />

/**
 * Every sequence of server updates and user actions on a dialog the server
 * opens, to a fixed depth, with the screen reader's view checked after each
 * step.
 *
 * The scenario tests in `dialog.browser.test.ts` each follow one path: a
 * patch, a close, then a look. This one does not choose: the server can send
 * any of the versions below, by any of the ways an update arrives, and the
 * user can open the dialog from a button on the page, close it with Escape
 * or a button in the form, move within it, and the app can write the
 * property, in any order. After every step the page as the browser rendered
 * it goes to the core, which computes the accessibility tree from the
 * specifications, and the invariants are checked on that tree, on the top
 * layer, on the name, on the focus, on the events and on the ids.
 *
 * Whether the dialog must be modal after a step is computed from what the
 * page promises, from the page as it stood before the step: `open` on the
 * host is the server's word, so a morph that sends it opens the dialog again
 * also after the user closed it, and one without it closes the dialog; the
 * user's close takes `open` from the host. Where the focus must go when the
 * dialog closes is the browser's memory, not the page's, so the element that
 * had focus when the dialog opened is part of the context.
 *
 * The page is the Datastar recipe from the component page, with the button
 * that opens the dialog in the "Plain HTML" recipe next to it, standing in
 * for the button that asks the server to open it. The component is the real
 * one, and so are Datastar and idiomorph.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { server, userEvent } from "vitest/browser"
import page from "../../../../../documentation/src/content/docs/components/dialog.mdx?raw"
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
import {
  datastarPatch,
  type Replacement,
  replace,
} from "../../../testing/update"
import { DIALOG_BODY_CLASS, DIALOG_TITLE_CLASS, dialog } from "./dialog"
import { defineLtDialog, type LtDialog } from "./lt-dialog"

import "../../../tokens/tokens.css"
import "./dialog.css"
import "../../css/button/button.css"

/** `text` with `from` replaced, which must be there: a recipe that changed would otherwise test nothing. */
function swap(text: string, from: string | RegExp, to: string): string {
  const out = text.replace(from, to)
  if (out === text)
    throw new Error(`the recipe has no ${String(from)} to replace`)
  return out
}

const blocks = (tab: string) =>
  tabItems(page)
    .filter((t) => t.name === tab)
    .flatMap((t) => htmlBlocks(t.code))

/*
 * The region the Datastar recipe sends, without the requests on its buttons:
 * the server's answer to them is a version sent, which the steps below
 * already do, and a real `@post` would go to the test server.
 */
const HOST = swap(
  blocks("Datastar")
    .find((b) => b.includes("<lt-dialog"))
    ?.match(/<lt-dialog[\s\S]*?<\/lt-dialog>/)?.[0] ?? "",
  /\s+data-on:click="[^"]*"/g,
  "",
)
const HOST_TAG = HOST.match(/^<lt-dialog[^>]*>/)?.[0] ?? ""
const HOST_ID = HOST_TAG.match(/\sid="([^"]+)"/)?.[1]
if (!HOST_ID) throw new Error("the recipe's dialog has no id to update it by")
const DIALOG_TAG = HOST.match(/<dialog[^>]*>/)?.[0] ?? ""
const HEADING = HOST.match(/<h2>([^<]+)<\/h2>/)
const BODY = HOST.match(/<div class="lt-dialog__body">([\s\S]*?)<\/div>/)
const VALUES = [...HOST.matchAll(/<button[^>]*\svalue="([^"]+)"/g)].map(
  (m) => m[1],
)
// The recipe must be what the versions below change: a host and a dialog the
// server opens, a bare heading outside the body, and buttons with a value.
if (
  !/\sopen[\s>]/.test(HOST_TAG) ||
  !/\sopen[\s>]/.test(DIALOG_TAG) ||
  /aria-label/.test(DIALOG_TAG) ||
  !HEADING ||
  !BODY ||
  VALUES.length < 2
)
  throw new Error(
    "the recipe is not an open host and dialog with a bare heading, a body and buttons with values",
  )
const TITLE = HEADING[1]

/** The button on the page that opens the dialog, from the "Plain HTML" recipe. */
const OPENER = blocks("Plain HTML")
  .join("\n")
  .match(/<button[^>]*\sid="open-confirm"[\s\S]*?<\/button>/)?.[0]
if (!OPENER) throw new Error("the Plain HTML recipe has no opening button")
const OPENER_ID = "open-confirm"
const RECIPE = `${OPENER}\n${HOST}`

const closedHost = (html: string) =>
  swap(
    swap(html, HOST_TAG, HOST_TAG.replace(/\sopen(?=[\s>])/, "")),
    DIALOG_TAG,
    DIALOG_TAG.replace(/\sopen(?=[\s>])/, ""),
  )
const controlled = (html: string) =>
  swap(html, /^(<lt-dialog[^>]*)>/, "$1 server-controlled>")
const withDialog = (html: string, extra: string) =>
  swap(html, DIALOG_TAG, DIALOG_TAG.replace(/>$/, ` ${extra}>`))

/** The id the server writes on its title, in the versions that name one. */
const TITLE_ID = "confirm-title"
const LABEL = "Confirm the cancellation"
const BODY_HEADING = "Attachments"
const CHANGED_TITLE = "Cancel job 222-0481 before a crew takes it?"

// What `lt.dialog()` writes, on a server that runs JavaScript: the whole
// wiring, with the recipe's id, texts and buttons.
const builder = (open: boolean) => {
  const box = dialog({ titleId: TITLE_ID, open })
  const hostAttributes = attr(box.host)
  // The body and the footer have the builder's classes in the recipe already.
  if (
    !HOST.includes(`<div ${attr(box.body)}>`) ||
    !HOST.includes(`<form method="dialog" ${attr(box.footer)}>`)
  )
    throw new Error(
      "the recipe's body or footer is not what lt.dialog() writes",
    )
  // The builder's host can be the recipe's exactly, so it is not `swap`ed.
  const hostTag = `<lt-dialog id="${HOST_ID}"${hostAttributes ? ` ${hostAttributes}` : ""}>`
  return swap(
    swap(
      HOST.replace(HOST_TAG, hostTag),
      DIALOG_TAG,
      `<dialog ${attr(box.dialog)}>`,
    ),
    HEADING[0],
    `<h2 ${attr(box.title)}>${TITLE}</h2>`,
  )
}

/** What the server can send. The host's attributes and the content are both in it. */
const VERSIONS: Record<string, string> = {
  // The recipe: open on both, a bare heading the component names it from.
  open: HOST,
  closed: closedHost(HOST),
  controlledOpen: controlled(HOST),
  controlledClosed: controlled(closedHost(HOST)),
  // The whole wiring from the server: the component has nothing to write.
  builder: builder(false),
  builderOpen: builder(true),
  // The server's `aria-label` wins, and the heading is not the title.
  label: withDialog(HOST, `aria-label="${LABEL}"`),
  // The heading has the server's id: the component points at it and
  // invents none.
  headingId: swap(HOST, HEADING[0], `<h2 id="${TITLE_ID}">${TITLE}</h2>`),
  /*
   * No name at all: a heading in the body is the content's, and must not
   * become one. With the title above it, as any dialog writes it, the body's
   * heading comes second in the markup and is passed over anyway, so this is
   * the version where the rule decides.
   */
  nameless: swap(
    swap(HOST, HEADING[0], ""),
    BODY[0],
    `<div class="lt-dialog__body"><h3>${BODY_HEADING}</h3>${BODY[1]}</div>`,
  ),
  // The content changes while the dialog is open.
  content: swap(
    swap(HOST, HEADING[0], `<h2>${CHANGED_TITLE}</h2>`),
    BODY[1],
    "<p>The crew keeps the advance and the floor plans. This cannot be undone.</p>",
  ),
  // A template that writes `open` on the host only, as the documentation
  // once showed: every morph takes the browser's `open` from the dialog.
  hostOnly: swap(HOST, DIALOG_TAG, DIALOG_TAG.replace(/\sopen(?=[\s>])/, "")),
}

/** What a version says, read from its markup once. */
type Info = {
  open: boolean
  serverControlled: boolean
  /** The name the dialog must have once the component has run. */
  name: string
  /** How the dialog is named: the server's reference, its label, a heading, or nothing. */
  named: "labelledby" | "label" | "heading" | "none"
  ids: Set<string>
  /** What `innerHTML` on the host writes. */
  inner: string
}

function info(html: string): Info {
  const t = document.createElement("template")
  t.innerHTML = html
  const host = t.content.querySelector("lt-dialog") as Element
  const d = host.querySelector(":scope > dialog") as HTMLDialogElement
  const heading = [...d.querySelectorAll("h1, h2, h3, h4, h5, h6")].find(
    (h) => !h.closest(`.${DIALOG_BODY_CLASS}`),
  )
  const labelledby = d.getAttribute("aria-labelledby")
  const label = d.getAttribute("aria-label")
  const flatText = (e: Element | null | undefined) =>
    (e?.textContent ?? "").replace(/\s+/g, " ").trim()
  return {
    open: host.hasAttribute("open"),
    serverControlled: host.hasAttribute("server-controlled"),
    name: labelledby
      ? flatText(t.content.getElementById(labelledby))
      : label
        ? label
        : flatText(heading),
    named: labelledby
      ? "labelledby"
      : label
        ? "label"
        : heading
          ? "heading"
          : "none",
    ids: new Set([...t.content.querySelectorAll("[id]")].map((e) => e.id)),
    inner: host.innerHTML,
  }
}
const INFO = Object.fromEntries(
  Object.entries(VERSIONS).map(([name, html]) => [name, info(html)]),
)

/** The version the opening button asks for: the one shown, open. */
const OPENED: Record<string, string> = Object.fromEntries(
  Object.keys(VERSIONS).map((name) => [
    name,
    INFO[name].open
      ? name
      : ({
          closed: "open",
          controlledClosed: "controlledOpen",
          builder: "builderOpen",
        }[name] ?? "open"),
  ]),
)

type Way = Replacement | "innerHTML"
type Action =
  | "click opener"
  | "focus opener"
  | "Escape"
  | "click keep"
  | "Enter"
  | "Tab"
  | "open = true"
  | "open = false"
type Step = { send: string; way: Way } | { user: Action }

/*
 * `innerHTML` on the host keeps the host, its attributes and its memory, and
 * replaces the dialog; it carries only the versions whose content differs
 * from the recipe's.
 */
const WAYS: Way[] = ["Datastar", "idiomorph", "outerHTML", "innerHTML"]
const SENDS: Step[] = Object.keys(VERSIONS).flatMap((send) =>
  WAYS.filter(
    (way) =>
      way !== "innerHTML" ||
      send === "open" ||
      INFO[send].inner !== INFO.open.inner,
  ).map((way) => ({ send, way })),
)
/*
 * `showModal()` and `close()` on the `<dialog>` are left out: the page says
 * to pick either them or `open` on the host, and inside `<lt-dialog>` it is
 * the host that opens the dialog. A `showModal()` of the app's own is not
 * seen by the component, which the page states, and promises nothing more.
 */
const ACTIONS: Step[] = (
  [
    "click opener",
    "focus opener",
    "Escape",
    "click keep",
    "Enter",
    "Tab",
    "open = true",
    "open = false",
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
 * Neither search can take all 51 steps to depth 3 within the time a run may
 * take, so the steps are cut, not the invariants. The state search, in every
 * engine, keeps every version by Datastar but `builder`, which
 * differs from `closed` only in markup a closed dialog does not show; idiomorph
 * for the versions that open, close, name or hand the state to the server;
 * `outerHTML` for a new component that opens and one that does not;
 * `innerHTML` for a dialog replaced under an open host and under a closed
 * one; and every action. The search over sequences, in Chromium, keeps the
 * steps that give the component a memory or take it: the versions by
 * Datastar that open, close, name from a heading and hand the state to the
 * server, and the actions that open and close.
 */
const STATE_STEPS = pick(STEPS, [
  ...[
    "open",
    "closed",
    "controlledOpen",
    "controlledClosed",
    "builderOpen",
    "label",
    "headingId",
    "nameless",
    "content",
    "hostOnly",
  ].map((v) => `${v} by Datastar`),
  ...["open", "closed", "builderOpen", "label"].map((v) => `${v} by idiomorph`),
  "open by outerHTML",
  "closed by outerHTML",
  "content by innerHTML",
  "closed by innerHTML",
  "click opener",
  "focus opener",
  "Escape",
  "click keep",
  "Enter",
  "Tab",
  "open = true",
  "open = false",
])
const SEQUENCE_STEPS = pick(STEPS, [
  ...[
    "open",
    "closed",
    "controlledOpen",
    "builderOpen",
    "nameless",
    "content",
  ].map((v) => `${v} by Datastar`),
  "content by innerHTML",
  "click opener",
  "Escape",
  "click keep",
  "open = false",
])
/** What the sequences leave out: Tab is the browser's, and the state search presses it in every engine. */
const UNSEEN_IN_SEQUENCES = ["tab"]

/**
 * The context: which version the host and the content came from, and where
 * the browser returns the focus when the dialog closes. That is the
 * element that had focus when `showModal()` was called, which the page does
 * not show, so the state search keeps two paths apart that differ there.
 */
type Context = {
  host: string
  /**
   * The version the dialog's content came from, or null when idiomorph left
   * the dialog's attributes from one version over the content of another:
   * no version then says what its name must be.
   */
  body: string | null
  /** Nothing but updates since the version was sent: the page is as it left it. */
  fresh: boolean
  /**
   * Where the focus goes back to on a close, or null where nothing is
   * promised. When nothing had focus as the dialog opened, as when the
   * server sends it open, there is nothing to go back to: Chromium leaves
   * `activeElement` on the hidden button until the next rendering update,
   * and the page promises a return only to the button that opened it.
   */
  returnTo: "opener" | null
  /** The id this host wrote on a heading, once it has written one. */
  titleId: string | null
  /**
   * A morph replaced the focused button in the open dialog, and the focus
   * is on `<body>` since: nothing is promised about it until the dialog
   * closes or the focus comes back.
   */
  dropped: boolean
}

const INITIAL: Context = {
  host: "open",
  body: "open",
  fresh: true,
  returnTo: null,
  titleId: null,
  dropped: false,
}

/**
 * What the step must lead to, computed in `apply` from the page before it.
 * `modal` is null when the page promises nothing exact.
 */
type Expectation = {
  modal: boolean | null
  why: "user" | "server" | "app" | "opener" | null
  /** The `returnValue` a close in this step must report. */
  returnValue: string
  /** The element that must have focus after the step, when the step decides it. */
  focus: Element | null
  context: Context
}

let current: Context = INITIAL
let expectation: Expectation = {
  modal: null,
  why: null,
  returnValue: "",
  focus: null,
  context: INITIAL,
}
/** The page just before the step, for what the context remembers. */
let before: { modal: boolean; dialog: Element | null; focus: Element | null } =
  { modal: false, dialog: null, focus: null }
/** The element with focus when the opening button's click reached the app. */
let focusAtClick: Element | null = null

const host = () => document.getElementById(HOST_ID as string) as LtDialog | null
const dialogOf = (h: Element | null) =>
  h?.querySelector<HTMLDialogElement>(":scope > dialog") ?? null
const opener = () => document.getElementById(OPENER_ID) as HTMLButtonElement
const buttonsOf = (d: Element | null) => [
  ...(d?.querySelectorAll<HTMLButtonElement>("button") ?? []),
]
const isModal = (d: Element | null) => d?.matches(":modal") ?? false

/** What a user action or a call from the app must do, from the page as it stands. */
function expectAction(ctx: Context, action: Action): Expectation {
  const d = dialogOf(host())
  const modal = isModal(d)
  const active = document.activeElement
  const buttons = buttonsOf(d)
  const unchanged: Expectation = {
    modal,
    why: "user",
    returnValue: "",
    focus: null,
    context: { ...ctx, fresh: false },
  }
  const closes = (returnValue: string, why: Expectation["why"]) =>
    modal
      ? { ...unchanged, modal: false, why, returnValue }
      : { ...unchanged, why }
  // The button asks the server, and the server sends the dialog open.
  const opens: Expectation = {
    ...unchanged,
    modal: true,
    why: "opener",
    context: {
      ...ctx,
      host: OPENED[ctx.body ?? ctx.host],
      body: OPENED[ctx.body ?? ctx.host],
      fresh: false,
    },
  }
  switch (action) {
    case "click opener":
      // Behind a modal dialog the button is inert, and a click cannot reach it.
      return modal ? unchanged : opens
    case "focus opener":
      return unchanged
    case "Escape":
      return closes("", "user")
    case "click keep":
      return closes(VALUES[0], "user")
    case "Enter":
      // The key activates the focused button: one in the form closes the
      // dialog with its value, and the opening button opens it.
      if (modal && active instanceof HTMLButtonElement && d?.contains(active))
        return closes(active.value, "user")
      if (!modal && active === opener()) return opens
      return unchanged
    case "Tab": {
      // From a button in the form to the next one, in the order of the markup.
      const at = buttons.indexOf(active as HTMLButtonElement)
      if (modal && at >= 0 && at < buttons.length - 1)
        return { ...unchanged, focus: buttons[at + 1] }
      return unchanged
    }
    case "open = true":
      return { ...unchanged, modal: true, why: "app" }
    case "open = false":
      return closes("", "app")
  }
}

/** What an update must do, from the page as it stands and the version sent. */
function expectUpdate(ctx: Context, send: string, way: Way): Expectation {
  const v = INFO[send]
  const base = {
    why: "server" as const,
    returnValue: "",
    focus: null,
  }
  if (way === "innerHTML")
    // The host and its `open` stay, and decide for the new dialog.
    return {
      ...base,
      modal: host()?.hasAttribute("open") ?? false,
      context: { ...ctx, body: send, fresh: true },
    }
  /*
   * idiomorph, with the typed text kept, morphs the attributes of the
   * element that has the focus but leaves its children as they were. WebKit
   * gives the dialog itself the focus when a button in it is clicked, and
   * leaves it there once the dialog has closed, so the content stays the
   * old version's under the new version's attributes.
   */
  const kept =
    way === "idiomorph" && document.activeElement === dialogOf(host())
  /*
   * `open` on the host is the server's word, under `server-controlled` or
   * not: sent again it opens a dialog the user closed, and left out it
   * closes one that is open. `outerHTML` is a new component with no memory.
   */
  return {
    ...base,
    modal: v.open,
    context: {
      ...ctx,
      host: send,
      body: kept ? (ctx.body === send ? send : null) : send,
      fresh: true,
      titleId: way === "outerHTML" ? null : ctx.titleId,
    },
  }
}

/** The `dialog-toggle` events during a step. */
type Toggle = { open: boolean; returnValue: string }
let events: Toggle[] = []
const onToggle = (e: Event) =>
  events.push({ ...(e as CustomEvent<Toggle>).detail })
const show = (t: Toggle[]) =>
  `[${t.map((e) => `${e.open}${e.open ? "" : ` "${e.returnValue}"`}`).join(", ")}]`

/** The opening button's click: the server's answer, sent at once. */
const onOpenerClick = () => {
  focusAtClick = document.activeElement
  datastarPatch(VERSIONS[OPENED[current.body ?? current.host]])
}

/** Tab, as a keyboard user presses it; WebKit on macOS moves to buttons with Alt+Tab. */
async function pressTab() {
  if (server.browser === "webkit") await userEvent.keyboard("{Alt>}{Tab}{/Alt}")
  else await userEvent.tab()
}

async function apply(step: Step): Promise<void> {
  events = []
  focusAtClick = null
  mover.takeRecords()
  removed.length = 0
  const h = host()
  const d = dialogOf(h)
  before = { modal: isModal(d), dialog: d, focus: document.activeElement }
  if ("send" in step) {
    expectation = expectUpdate(current, step.send, step.way)
    if (step.way === "innerHTML") {
      if (h) h.innerHTML = INFO[step.send].inner
    } else replace(step.way, HOST_ID as string, VERSIONS[step.send])
    return
  }
  expectation = expectAction(current, step.user)
  const modal = isModal(d)
  switch (step.user) {
    // A real click, so the browser's own rules decide what it reaches and
    // where the focus goes. Behind a modal dialog the button is inert, and
    // Playwright would wait for it in vain.
    case "click opener":
      if (!modal) await userEvent.click(opener())
      break
    case "focus opener":
      // Inert behind a modal dialog: the call does nothing there, which the
      // inert check also relies on.
      opener().focus()
      break
    case "click keep":
      // The button is shown only in an open dialog.
      if (modal) await userEvent.click(buttonsOf(d)[0])
      break
    case "Tab":
      // Only within the form: from the last button Tab leaves the page for
      // the browser's own controls.
      if (expectation.focus) await pressTab()
      break
    case "Escape":
      await userEvent.keyboard("{Escape}")
      break
    case "Enter":
      await userEvent.keyboard("{Enter}")
      break
    case "open = true":
      if (h) h.open = true
      break
    case "open = false":
      if (h) h.open = false
      break
  }
}

/** Where the focus is, as the context names it. */
const where = (e: Element | null): Context["returnTo"] =>
  e === opener() ? "opener" : null

/** The context after the step, from the expectation and the page as it settled. */
function next(): Context {
  const ctx = { ...expectation.context }
  const d = dialogOf(host())
  const modal = isModal(d)
  if (!modal) ctx.returnTo = null
  else if (!before.modal)
    // The browser remembers the element with focus when `showModal()` ran:
    // for the opening button, the one when its click reached the app.
    ctx.returnTo = where(focusAtClick ?? before.focus)
  else if (before.dialog !== d)
    // A new dialog under the same host: the browser's memory went with the
    // old one, and the page promises nothing about the focus.
    ctx.returnTo = null
  ctx.titleId ??= writtenId(d)
  ctx.dropped =
    modal &&
    !(d?.contains(document.activeElement) ?? false) &&
    (replacedButtons(d) ||
      (current.dropped && before.modal && before.dialog === d))
  current = ctx
  return ctx
}

/** Every id some version sends, on any element, and the page's own. */
const SENT_IDS = new Set([
  ...Object.values(INFO).flatMap((v) => [...v.ids]),
  OPENER_ID,
  "lt-test-surface",
])

/** The id the component wrote on the dialog's heading, if it wrote one. */
const writtenId = (d: Element | null): string | null =>
  [...(d?.querySelectorAll("[id]") ?? [])]
    .map((e) => e.id)
    .find((id) => !SENT_IDS.has(id)) ?? null

let core: AccessibilityCore

type Snapshot = {
  tree: AxNode[]
  host: LtDialog | null
  dialog: HTMLDialogElement | null
  /** `:modal`: the dialog is in the top layer, with the page behind it inert. */
  modal: boolean
  hostOpen: boolean
  dialogOpen: boolean
  /** The first heading outside the body, and the headings in the body. */
  heading: HTMLElement | null
  bodyHeadings: HTMLElement[]
  active: Element | null
  /** Whether the opening button could take the focus: it must not behind a modal dialog. */
  openerReachable: boolean
  markup: string
}

function snapshot(): Snapshot {
  const h = host()
  const d = dialogOf(h)
  const modal = isModal(d)
  const headings = [
    ...(d?.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6") ?? []),
  ]
  const active = document.activeElement
  /*
   * Inert is not in the markup or in any selector, so it is asked: a focus
   * call on an inert button does nothing. Only behind a modal dialog, where
   * nothing may move, and the focus is put back if it did.
   */
  let openerReachable = true
  if (modal) {
    opener().focus()
    openerReachable = document.activeElement === opener()
    if (openerReachable) (active as HTMLElement | null)?.focus()
  }
  return {
    tree: core.tree(renderedMarkup()),
    host: h,
    dialog: d,
    modal,
    hostOpen: h?.hasAttribute("open") ?? false,
    dialogOpen: d?.hasAttribute("open") ?? false,
    heading: headings.find((e) => !e.closest(`.${DIALOG_BODY_CLASS}`)) ?? null,
    bodyHeadings: headings.filter((e) => e.closest(`.${DIALOG_BODY_CLASS}`)),
    active,
    openerReachable,
    markup: canonical(h),
  }
}

/** How often each invariant actually had something to check. */
const seen = {
  modal: 0,
  inert: 0,
  user: 0,
  app: 0,
  server: 0,
  opener: 0,
  name: 0,
  title: 0,
  bodyHeading: 0,
  focusInside: 0,
  opened: 0,
  returned: 0,
  tab: 0,
  kept: 0,
  events: 0,
  returnValue: 0,
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
const UNTOUCHED = ["builder", "builderOpen", "label", "nameless"]
const SENT = Object.fromEntries(UNTOUCHED.map((v) => [v, sent(v)]))

/** Text as a name is computed. */
const flat = (text: string | null) => (text ?? "").replace(/\s+/g, " ").trim()
const what = (e: Element | null) =>
  e === null
    ? "nothing"
    : e === document.body
      ? "<body>"
      : `<${e.localName}> "${flat(e.textContent)}"`

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
   * Modal exactly when the host says open: the dialog is in the top layer,
   * the core's tree has it as a modal dialog, and `open` on the `<dialog>`
   * says the same. A `<dialog open>` that is not modal is a box on the page,
   * without a focus trap and without Escape, and must never be left
   * standing. A closed dialog is not in the tree at all.
   *
   * The core computes no inertness, so that the page behind is out of the
   * screen reader's reach is read from the browser instead: the opening
   * button cannot take the focus.
   */
  seen.modal++
  if (after.hostOpen !== after.modal)
    problems.push(
      `the host says ${after.hostOpen ? "open" : "closed"} over a dialog that is ${after.modal ? "modal" : "not modal"}`,
    )
  if (after.dialogOpen !== after.modal)
    problems.push(
      after.dialogOpen
        ? "the dialog has open without being modal: a box on the page"
        : "the dialog is modal without open, so it is hidden over an inert page",
    )
  const dialogs = after.tree.filter((n) => n.role === "dialog")
  if (after.modal) {
    if (dialogs.length !== 1 || !dialogs[0].states.includes("modal"))
      problems.push(
        `the screen reader is given ${dialogs.length} dialogs, ${dialogs.filter((n) => n.states.includes("modal")).length} of them modal, for a modal dialog`,
      )
    seen.inert++
    if (after.openerReachable)
      problems.push("the page behind the modal dialog is not inert")
  } else if (dialogs.length > 0)
    problems.push(
      `the screen reader is given a dialog ${dialogs[0].states.includes("modal") ? "as modal" : "as a box"} that is closed`,
    )

  // The state the promises say.
  if (e.modal !== null && e.why !== null) {
    seen[e.why]++
    if (after.modal !== e.modal)
      problems.push(
        {
          user: `the dialog is ${after.modal ? "open" : "closed"} after ${label(step)}`,
          app: `the dialog is ${after.modal ? "open" : "closed"} after ${label(step)}, the app's word`,
          server: `the dialog is ${after.modal ? "open" : "closed"}, not ${e.modal ? "open" : "closed"} as the server said`,
          opener: "the opening button was pressed, and the dialog did not open",
        }[e.why],
      )
  }

  /*
   * The name the page promises: the server's `aria-labelledby` or
   * `aria-label` when it wrote one, otherwise the first heading outside the
   * body, and never a heading in the body. Read where the screen reader
   * reads it, on an open dialog.
   */
  const v = now.body === null ? null : INFO[now.body]
  if (v && after.modal && dialogs.length === 1) {
    seen.name++
    if (dialogs[0].name !== v.name)
      problems.push(`the dialog is named "${dialogs[0].name}", not "${v.name}"`)
  }
  // The title: the class and the reference on the heading that names it,
  // and on nothing else.
  if (v) seen.title++
  const titled = [...d.querySelectorAll(`.${DIALOG_TITLE_CLASS}`)]
  const labelledby = d.getAttribute("aria-labelledby")
  if (!v) {
    // A mix of two versions: nothing is promised about the name.
  } else if (v.named === "labelledby" || v.named === "heading") {
    if (titled.length !== 1 || titled[0] !== after.heading)
      problems.push(
        `the title class is on ${titled.length} elements, not on the heading outside the body`,
      )
    if (!after.heading?.id || labelledby !== after.heading.id)
      problems.push(
        `aria-labelledby is "${labelledby}", not the heading's id "${after.heading?.id}"`,
      )
  } else {
    if (titled.length > 0)
      problems.push(
        `the title class is on ${what(titled[0])} in a dialog ${v.named === "label" ? "the server named with aria-label" : "without a name"}`,
      )
    if (labelledby !== null)
      problems.push(
        `the component wrote aria-labelledby="${labelledby}" on a dialog ${v.named === "label" ? "the server named with aria-label" : "without a heading"}`,
      )
  }
  if (after.bodyHeadings.length > 0) {
    seen.bodyHeading++
    for (const b of after.bodyHeadings)
      if (b.classList.contains(DIALOG_TITLE_CLASS) || b.id)
        problems.push(`the heading in the body got ${b.outerHTML}`)
  }

  /*
   * The focus: inside the dialog whenever it is modal, which `showModal()`
   * does on open and keeps while it is open, also through a morph; and on
   * a close of the same dialog, back on the element that had it when it
   * opened, as the browser does. When the dialog that closes is not the one
   * that opened, the server replaced it, and the browser's memory went with
   * it: nothing is promised then.
   *
   * Nor when the morph replaced the dialog's buttons, as Datastar's does
   * to insert a heading above them: the focused node is gone, a morpher's
   * limit and not the component's, which writes nothing on that markup.
   */
  const moved = replacedButtons(d)
  if (after.modal && !now.dropped) {
    seen.focusInside++
    if (!d.contains(after.active))
      problems.push(
        `the dialog is modal with the focus on ${what(after.active)}, outside it`,
      )
    if (!before.modal) seen.opened++
  }
  if (
    before.modal &&
    !after.modal &&
    before.dialog === d &&
    was.returnTo !== null
  ) {
    seen.returned++
    const want = opener()
    const got = after.active ?? document.body
    if (got !== want)
      problems.push(
        `the dialog closed with the focus on ${what(got)}, not back on ${what(want)}`,
      )
  }
  if (e.focus) {
    seen.tab++
    if (after.active !== e.focus)
      problems.push(
        `the focus is on ${what(after.active)}, not ${what(e.focus)} after ${label(step)}`,
      )
  }

  /*
   * A morph keeps the dialog, which has no id the server did not send, and
   * the element with the focus keeps it while the dialog is open: the
   * moment the morph takes `open` and the component puts it back must not
   * show.
   */
  if ("send" in step && (step.way === "Datastar" || step.way === "idiomorph")) {
    seen.kept++
    if (before.dialog !== d) problems.push("the update replaced the dialog")
    const focused = before.active
    if (
      before.modal &&
      after.modal &&
      !moved &&
      focused &&
      before.dialog?.contains(focused) &&
      focused.isConnected &&
      after.active !== focused
    )
      problems.push(
        `the update took the focus from ${what(focused)} to ${what(after.active)}`,
      )
  }

  /*
   * `dialog-toggle` once per open and once per close, with the value of the
   * button that closed it, and nothing when the dialog stays as it was. A
   * new host from `outerHTML` has reported nothing, and reports once that
   * it opened.
   */
  seen.events++
  const want: Toggle[] =
    before.host !== after.host
      ? after.modal
        ? [{ open: true, returnValue: "" }]
        : []
      : before.modal !== after.modal
        ? [
            {
              open: after.modal,
              returnValue: after.modal ? "" : e.returnValue,
            },
          ]
        : []
  if (show(events) !== show(want))
    problems.push(`dialog-toggle gave ${show(events)}, not ${show(want)}`)
  if (want.some((t) => !t.open && t.returnValue !== "")) seen.returnValue++

  /*
   * The only id the component writes is the title's, and the host keeps
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
  const written = writtenId(d)
  if (written !== null && was.titleId !== null && before.host === after.host) {
    seen.titleId++
    if (written !== was.titleId)
      problems.push(
        `the title's id went from "${was.titleId}" to "${written}" on the same host`,
      )
  }

  /*
   * Markup that already says everything, as `lt.dialog()` writes it or with
   * the server's own `aria-label`, is left exactly as sent: the component
   * has nothing to write, and React hydrates without mismatches.
   */
  if (
    "send" in step &&
    UNTOUCHED.includes(step.send) &&
    now.host === step.send &&
    now.body === step.send &&
    after.modal === INFO[step.send].open
  ) {
    seen.untouched++
    if (after.markup !== SENT[step.send])
      problems.push(
        `the component wrote on markup that already said everything: ${after.markup}`,
      )
  }

  /*
   * The same version sent again by a morph changes nothing: the same
   * markup, the same state, and no event, from a page the version left as
   * it was.
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
      problems.push("the same version sent again opened or closed the dialog")
  }
  return problems
}

/**
 * Waits for the component, and for a close the browser has queued.
 *
 * `close` is a task of its own, and in Firefox it can come after a message
 * posted later; the component removes `open` from the host only there. So
 * a dialog that lost `open` is waited for until its `close` has come, it is
 * open again (the component put the attribute back), or it is gone.
 */
const pending = new Set<HTMLDialogElement>()
const watcher = new MutationObserver((records) => {
  for (const r of records)
    if (r.target instanceof HTMLDialogElement && !r.target.open)
      pending.add(r.target)
})
const onClose = (e: Event) => pending.delete(e.target as HTMLDialogElement)

/**
 * The nodes taken out of a dialog during a step, by the parent they were
 * taken from. When Datastar's morph inserts a heading at the top of the
 * dialog, it replaces the body and the form below it with new nodes, so the
 * focused button is gone, whatever the component does. Reset in `apply`.
 */
const removed: { node: Node; from: Node }[] = []
const replacedButtons = (d: Element | null) =>
  d !== null &&
  removed.some(
    ({ node, from }) =>
      d.contains(from) &&
      node instanceof Element &&
      (node.matches("button") || node.querySelector("button") !== null),
  )
const mover = new MutationObserver((records) => {
  for (const r of records)
    for (const node of r.removedNodes) removed.push({ node, from: r.target })
})
async function settleDialog(): Promise<void> {
  await settle()
  await settle()
  for (let round = 0; round < 10; round++) {
    for (const d of pending) if (d.open || !d.isConnected) pending.delete(d)
    if (pending.size === 0) return
    await settle()
  }
  pending.clear()
}

/**
 * The component makes the title's id with `Math.random`, and the state key
 * holds the markup: with a new id on every replay, no two paths ever met.
 * Seeded afresh before every replay, the same path gives the same ids.
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
  next,
  /*
   * What the page does not show: where the browser returns the focus, and
   * the id the host remembers for its title. The versions differ in what
   * the page shows, so the version's name is left out, and two versions
   * that give the same page are continued once.
   */
  contextKey: (c) => `${c.returnTo}|${c.titleId}`,
  violations,
  seen,
  settle: settleDialog,
  reset: () => {
    current = INITIAL
    seed = 1
    pending.clear()
  },
}

describe("lt-dialog, every sequence of updates and user actions", () => {
  beforeAll(async () => {
    // The nameless version is warned about, as it should be; the warning
    // has its own test in `messages.browser.test.ts`, and here it is noise.
    vi.spyOn(console, "warn").mockImplementation(() => {})
    Math.random = seeded
    defineLtDialog()
    core = accessibilityCore(await (await fetch(coreUrl)).arrayBuffer())
    document.addEventListener("dialog-toggle", onToggle)
    document.addEventListener("close", onClose, true)
    document.addEventListener("click", (e) => {
      if ((e.target as Element | null)?.closest?.(`#${OPENER_ID}`))
        onOpenerClick()
    })
    mover.observe(document.body, { subtree: true, childList: true })
    watcher.observe(document.body, {
      subtree: true,
      attributeFilter: ["open"],
    })
  })
  afterAll(() => {
    Math.random = realRandom
    watcher.disconnect()
    mover.disconnect()
    document.removeEventListener("dialog-toggle", onToggle)
    document.removeEventListener("close", onClose, true)
  })

  // Each search counts for itself, so neither leans on the other's checks.
  const fresh = () => {
    for (const k of Object.keys(seen)) seen[k as keyof typeof seen] = 0
  }

  it("keeps the dialog modal, named, focused, reported and its ids in every state to depth 3", async () => {
    fresh()
    const run = await exploreStates(model, 3)
    expect(run.found.slice(0, 10)).toEqual([])
    // The search found more states than one step gives.
    expect(run.states).toBeGreaterThan(STATE_STEPS.length)
    /*
     * WebKit gives a clicked button no focus, so the opening button has the
     * focus only after a focus step on a closed dialog, and the close it
     * would return to is a fourth step: the return is checked in Chromium
     * and Firefox.
     */
    expect(unchecked(seen)).toEqual(
      server.browser === "webkit" ? ["returned"] : [],
    )
  }, 600_000)

  /*
   * Every sequence, without merging states. The state key holds what the
   * browser and the component remember as the model computes it; where the
   * component remembers otherwise (what it reported last, the id it made),
   * two paths the key merges still differ, and only a path shows it. In
   * Chromium only.
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
