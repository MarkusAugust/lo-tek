/// <reference path="../../../types/css.d.ts" />
/// <reference path="../../../testing/vite-url.d.ts" />

/**
 * Every sequence of server updates and user actions on a tab list, to a
 * fixed depth, with the screen reader's view checked after each step.
 *
 * The scenario tests next to this one each follow one path: a click, a
 * patch, then a look. This one does not choose: the server can send any of
 * the versions below, by any of the ways an update arrives, and the user can
 * click, press the keys the component promises, and move into the panel, in
 * any order. After every step the page as the browser rendered it goes to the
 * core, which computes the accessibility tree from the specifications, and
 * the invariants are checked on that tree, on the wiring the component
 * promises, on the focus and on the address.
 *
 * Which tab must be selected after a step is computed from what the page
 * promises, from the page as it stood before the step: the user's selection
 * survives a morph, the server's word decides when the user has chosen
 * nothing or under `server-controlled`, and on load the server's
 * `aria-selected` comes before the address. The address is read from the
 * page, not modelled: the engines refuse to write it after so many calls in
 * ten seconds (see `BUDGET`), and the component then reads the address as it
 * is.
 *
 * The page is the recipe from the component page, the component is the real
 * one, and so are Datastar and idiomorph. The core's tree is compared with
 * what Chromium and Firefox give through AT-SPI in
 * `check-accessibility-tree.ts`.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { server, userEvent } from "vitest/browser"
import page from "../../../../../documentation/src/content/docs/components/tabs.mdx?raw"
import coreUrl from "../../../../core/lotek-core.wasm?url"
import {
  type AccessibilityCore,
  type AxNode,
  accessibilityCore,
} from "../../../testing/accessibility"
import { setAddress } from "../../../testing/address"
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
import { defineLtTabs } from "./lt-tabs"
import { tabs, tabsWithState } from "./tabs"

import "../../../tokens/tokens.css"
import "./tabs.css"

/** The tab list in the "Plain HTML" recipe, without its scripts. */
const RECIPE = (() => {
  const block = tabItems(page)
    .filter((t) => t.name === "Plain HTML")
    .flatMap((t) => htmlBlocks(t.code))
    .find((b) => b.includes("<lt-tabs"))
  if (!block) throw new Error("no recipe with <lt-tabs> on the page")
  return block.replace(/<script[\s\S]*?<\/script>/g, "")
})()

/** The recipe's host: what the server sends again, by its id. */
const HOST = RECIPE.match(/<lt-tabs[\s\S]*?<\/lt-tabs>/)?.[0]
if (!HOST) throw new Error("no <lt-tabs> in the recipe")
const HOST_TAG = HOST.match(/^<lt-tabs[^>]*>/)?.[0] ?? ""
const HOST_ID = HOST_TAG.match(/\sid="([^"]+)"/)?.[1]
if (!HOST_ID) throw new Error("the recipe's tab list has no id to update it by")

/** `text` with `from` replaced, which must be there: a recipe that changed would otherwise test nothing. */
function swap(text: string, from: string | RegExp, to: string): string {
  const out = text.replace(from, to)
  if (out === text)
    throw new Error(`the recipe has no ${String(from)} to replace`)
  return out
}

/** The recipe's tabs, its row's name and its panels' content, read from it. */
const LINKS = [...HOST.matchAll(/<a href="#([^"]+)">([^<]+)<\/a>/g)]
const KEYS = LINKS.map((m) => m[1])
const NAMES = LINKS.map((m) => m[2])
const LABEL = HOST.match(/class="lt-tabs__list" aria-label="([^"]+)"/)?.[1]
const CONTENT = KEYS.map(
  (key) =>
    HOST.match(
      new RegExp(`id="${key}">\\s*<h2>[^<]*</h2>\\s*(<p>[\\s\\S]*?</p>)`),
    )?.[1],
)
if (KEYS.length !== 2 || !LABEL || CONTENT.some((c) => !c))
  throw new Error("the recipe has no two tabs with a label and content")
const [FIRST, SECOND] = KEYS

const withHost = (html: string, extra: string) =>
  swap(html, HOST_TAG, HOST_TAG.replace(/>$/, ` ${extra}>`))
const panelTag = (key: string) => `<section class="lt-tabs__panel" id="${key}">`
// The server selects the second tab by hiding the first, as the Datastar
// recipe does.
const hideFirst = (html: string) =>
  swap(
    html,
    panelTag(FIRST),
    panelTag(FIRST).replace(">", ' hidden="until-found">'),
  )

// What `lt.tabs()` writes, on a server that runs JavaScript: links, ids and
// classes, with a stem of its own, so the panels' ids differ from the recipe's.
const STEM = "file"
const BUILT = tabs({ id: STEM, keys: KEYS, label: LABEL })
const BUILDER = `${HOST_TAG}<ul ${attr(BUILT.list)}>${BUILT.tabs.map((t, i) => `<li><a ${attr(t)}>${NAMES[i]}</a></li>`).join("")}</ul>${BUILT.panels.map((p, i) => `<section ${attr(p)}><h2 ${attr(BUILT.headings[i])}>${NAMES[i]}</h2>${CONTENT[i]}</section>`).join("")}</lt-tabs>`

// The whole state, as the React entry writes it, with the second selected:
// roles, `aria-selected`, ids on the links, and `hidden=""`.
const FULL = tabsWithState({ id: STEM, keys: KEYS, label: LABEL, selected: 1 })
const REACT = `${HOST_TAG}<ul ${attr(FULL.list)}>${FULL.tabs.map((t, i) => `<li ${attr(FULL.item)}><a ${attr(t)}>${NAMES[i]}</a></li>`).join("")}</ul>${FULL.panels.map((p, i) => `<section ${attr(p)}><h2>${NAMES[i]}</h2>${CONTENT[i]}</section>`).join("")}</lt-tabs>`

const THIRD = { key: "messages", name: "Messages" }
const ZEROTH = { key: "summary", name: "Summary" }
const panel = (t: { key: string; name: string }) =>
  `${panelTag(t.key)}<h2>${t.name}</h2><p>Nothing here yet.</p></section>`
const link = (t: { key: string; name: string }) =>
  `<li><a href="#${t.key}">${t.name}</a></li>`

const ADDED = swap(
  swap(HOST, /(\s*)<\/ul>/, `$1  ${link(THIRD)}$1</ul>`),
  "</lt-tabs>",
  `${panel(THIRD)}</lt-tabs>`,
)

const INSERTED = swap(
  swap(
    HOST,
    `<li><a href="#${FIRST}">`,
    `${link(ZEROTH)}<li><a href="#${FIRST}">`,
  ),
  panelTag(FIRST),
  `${panel(ZEROTH)}${panelTag(FIRST)}`,
)

/** What the server can send. The host's attributes and the content are both in it. */
const VERSIONS: Record<string, string> = {
  recipe: HOST,
  // The server selects the second tab with `aria-selected`.
  selected: swap(
    HOST,
    `<a href="#${SECOND}">`,
    `<a href="#${SECOND}" aria-selected="true">`,
  ),
  // The server selects the second tab by hiding the first panel.
  shown: hideFirst(HOST),
  added: ADDED,
  /*
   * Three tabs under `server-controlled`, with the whole selection from the
   * server: `aria-selected` on every tab and `hidden` on the panels. A click
   * on the second leaves the third tab and panel as the server said, so the
   * component marks nothing there; with two tabs everything changes. When
   * the missing mark was read as the server's touch, the click was released
   * at once and the click's own `aria-selected="true"` became the server's
   * word, so a later answer through `hidden` alone (the script step) was not
   * heard.
   */
  controlledThree: withHost(
    [SECOND, THIRD.key].reduce(
      (html, key) =>
        swap(
          swap(
            html,
            panelTag(key),
            panelTag(key).replace(">", ' hidden="until-found">'),
          ),
          `<a href="#${key}">`,
          `<a href="#${key}" aria-selected="false">`,
        ),
      swap(
        ADDED,
        `<a href="#${FIRST}">`,
        `<a href="#${FIRST}" aria-selected="true">`,
      ),
    ),
    "server-controlled",
  ),
  // A tab first in the row: the same index is another tab.
  inserted: INSERTED,
  // The same, with the server marking the new tab: the user's tab must still
  // win, and when a morph turned its link into another tab, only the panel
  // it pointed to tells the component which tab that was (the address would
  // have said it too, but loses to the server's `aria-selected`).
  insertedMarked: swap(
    INSERTED,
    `<a href="#${ZEROTH.key}">`,
    `<a href="#${ZEROTH.key}" aria-selected="true">`,
  ),
  removed: swap(
    swap(HOST, new RegExp(`\\s*<li><a href="#${SECOND}">[^<]*</a></li>`), ""),
    new RegExp(
      `\\s*<section class="lt-tabs__panel" id="${SECOND}">[\\s\\S]*?</section>`,
    ),
    "",
  ),
  // New text in the second panel: a morph changes only the text node.
  content: swap(
    HOST,
    CONTENT[1] as string,
    "<p>A fourth attachment arrived.</p>",
  ),
  hiddenTab: swap(
    HOST,
    `<a href="#${SECOND}">`,
    `<a href="#${SECOND}" hidden>`,
  ),
  controlled: withHost(HOST, "server-controlled"),
  // The server's answer to a click on the second tab, as in the Datastar recipe.
  controlledShown: hideFirst(withHost(HOST, "server-controlled")),
  manual: withHost(HOST, 'activation="manual"'),
  builder: BUILDER,
  react: REACT,
  // A template that wrote `aria-controls` by hand, and wrong: `href` is the
  // truth, and the one attribute the component writes over the server's.
  controls: swap(
    HOST,
    `<a href="#${SECOND}">`,
    `<a href="#${SECOND}" aria-controls="${FIRST}">`,
  ),
  // A heading that says something else than the tab: the panel is named by `aria-label`.
  heading: swap(HOST, `<h2>${NAMES[1]}</h2>`, "<h2>Enclosures</h2>"),
}

/** A tab's identity: its fragment, without the builder's stem. */
const keyOf = (href: string | null) =>
  (href ?? "").replace(/^#/, "").replace(new RegExp(`^${STEM}-`), "")

/** What a version says, read from its markup once. */
type Info = {
  keys: string[]
  /** The tabs the user cannot select: `hidden` on the link. */
  disabled: Set<string>
  /** The tab the server says is selected: `aria-selected`, then the first panel it shows, then the first. */
  derived: string
  ariaSelected: string | null
  /** The panel id per key, and every id the version sends. */
  panelIds: Map<string, string>
  ids: Set<string>
  /** The form the version hides a panel in, or null when it hides none. */
  form: string | null
  serverControlled: boolean
  manual: boolean
  /** The ids on the links: a morph keeps a link only when the id is the same or the old had none. */
  linkIds: string[]
  names: string[]
  /** What `innerHTML` on the host writes. */
  inner: string
}

function info(html: string): Info {
  const t = document.createElement("template")
  t.innerHTML = html
  const host = t.content.querySelector("lt-tabs") as Element
  const links = [...host.querySelectorAll(".lt-tabs__list a")]
  const keys = links.map((a) => keyOf(a.getAttribute("href")))
  const panelIds = new Map(
    links.map((a) => [
      keyOf(a.getAttribute("href")),
      (a.getAttribute("href") ?? "").slice(1),
    ]),
  )
  const panelOf = (key: string) =>
    t.content.getElementById(panelIds.get(key) ?? "")
  const marked = links.find((a) => a.getAttribute("aria-selected") === "true")
  const ariaSelected = marked ? keyOf(marked.getAttribute("href")) : null
  const firstShown = keys.find((k) => !panelOf(k)?.hasAttribute("hidden"))
  const hiddenPanel = keys.map(panelOf).find((p) => p?.hasAttribute("hidden"))
  return {
    keys,
    disabled: new Set(
      links
        .filter((a) => a.hasAttribute("hidden"))
        .map((a) => keyOf(a.getAttribute("href"))),
    ),
    derived: ariaSelected ?? firstShown ?? keys[0],
    ariaSelected,
    panelIds,
    ids: new Set([...t.content.querySelectorAll("[id]")].map((e) => e.id)),
    form: hiddenPanel?.getAttribute("hidden") ?? null,
    serverControlled: host.hasAttribute("server-controlled"),
    manual: host.getAttribute("activation") === "manual",
    linkIds: links.map((a) => a.id),
    names: links.map((a) => a.textContent ?? ""),
    inner: host.innerHTML,
  }
}
const INFO = Object.fromEntries(
  Object.entries(VERSIONS).map(([name, html]) => [name, info(html)]),
)

type Way = Replacement | "innerHTML"
type Action =
  | `click ${string}`
  | "focus"
  | "ArrowRight"
  | "ArrowLeft"
  | "Home"
  | "End"
  | "Enter"
  | "Space"
  | "Tab"
  /*
   * Not the user: the server answering through a signal, as
   * `data-attr:hidden` in Datastar does, which writes `hidden` on the panels
   * without a morph. It shows the first panel and hides the rest, and leaves
   * `aria-selected` alone.
   */
  | "first panel by script"
type Step = { send: string; way: Way } | { user: Action }

/*
 * `innerHTML` on the host keeps the host and its memory and replaces the
 * links, as the documentation says it does; only the content differs between
 * the versions it carries, so the host's own versions (`controlled`,
 * `controlledShown`, `controlledThree`, `manual`) go by the other ways only.
 */
const HOST_ONLY = new Set([
  "controlled",
  "controlledShown",
  "controlledThree",
  "manual",
])
const WAYS: Way[] = ["Datastar", "idiomorph", "outerHTML", "innerHTML"]
const SENDS: Step[] = Object.keys(VERSIONS).flatMap((send) =>
  WAYS.filter((way) => way !== "innerHTML" || !HOST_ONLY.has(send)).map(
    (way) => ({ send, way }),
  ),
)
const ACTIONS: Step[] = (
  [
    `click ${FIRST}`,
    `click ${SECOND}`,
    "focus",
    "ArrowRight",
    "ArrowLeft",
    "Home",
    "End",
    "Enter",
    "Space",
    "Tab",
    "first panel by script",
  ] as Action[]
).map((user) => ({ user }))
const STEPS: Step[] = [...SENDS, ...ACTIONS]

const pick = (steps: Step[], names: string[]) =>
  steps.filter((s) => names.includes(label(s)))

/*
 * Neither search can take every step to depth 3: with all 63 the state
 * search took 3 min 12 s in Chromium alone. The state search, in every
 * engine, keeps 31: every action where the engines differ (the keys, the
 * focus, the address), every version by Datastar but `builder` and
 * `content`, which change only markup and text, and `controlled`, which
 * `controlledThree` covers with a third tab, and the other ways for the
 * versions that move the selection or load it (`innerHTML` only for `react`,
 * whose links have ids); in a row of two tabs
 * ArrowLeft and Home go where ArrowRight and a click go. The search over
 * sequences, in Chromium, keeps 29: every version by Datastar, the five that
 * move the selection by idiomorph too, and the actions that give the
 * component a memory to keep. Measured with the three engines side by side,
 * at a load average of about 8: the state search 19 s in Chromium, 64 s in
 * WebKit and 85 s in Firefox, and the sequences 84 s in Chromium.
 */
const STATE_STEPS = pick(STEPS, [
  ...[
    "recipe",
    "selected",
    "shown",
    "inserted",
    "insertedMarked",
    "removed",
    "added",
    "hiddenTab",
    "controlledThree",
    "controlledShown",
    "manual",
    "react",
    "controls",
    "heading",
  ].map((v) => `${v} by Datastar`),
  ...["recipe", "selected", "shown", "controlledShown"].map(
    (v) => `${v} by idiomorph`,
  ),
  ...["recipe", "selected", "react"].map((v) => `${v} by outerHTML`),
  "react by innerHTML",
  `click ${FIRST}`,
  `click ${SECOND}`,
  "focus",
  "ArrowRight",
  "End",
  "Enter",
  "Space",
  "Tab",
  "first panel by script",
])
const SEQUENCE_STEPS = pick(STEPS, [
  ...Object.keys(VERSIONS).map((v) => `${v} by Datastar`),
  ...["recipe", "selected", "shown", "controlledShown", "react"].map(
    (v) => `${v} by idiomorph`,
  ),
  `click ${FIRST}`,
  `click ${SECOND}`,
  "focus",
  "ArrowLeft",
  "Home",
  "Enter",
  "first panel by script",
])

function label(step: Step): string {
  return "send" in step ? `${step.send} by ${step.way}` : step.user
}

/**
 * The context: which version the host and the content came from, and what
 * the user did that the page does not show.
 *
 * - `choice`: the panel the user's tab points to, the fragment in its
 *   `href`; the link itself is the one that points there now, see
 *   `expectUpdate`. `null` when the user has chosen nothing the component
 *   holds, and `"?"` when the page does not say whether it holds one (a load
 *   from the address that selected the tab the markup already selected).
 * - `pending`: a click under `server-controlled`, which stands until the
 *   server answers.
 * - `started`: the row has loaded, that is, the address could be resolved.
 *   Until then the component waits, and the update that resolves it is a
 *   load.
 */
type Context = {
  host: string
  body: string
  choice: string | null
  pending: boolean
  started: boolean
  /** The server changed the page by script since the last version: it is not that version any more. */
  scripted: boolean
}

const INITIAL: Context = {
  host: "recipe",
  body: "recipe",
  choice: null,
  pending: false,
  started: true,
  scripted: false,
}

/**
 * What the step must lead to, computed in `apply` from the page before it:
 * the tab selected, or null when the page promises nothing exact, and
 * which promise says so.
 */
type Expectation = {
  selected: string | null
  why: "user" | "server" | "load" | "action" | "pending" | null
  /** The user changed the selection: the address follows, and one `tab-select`. */
  changed: { key: string; index: number } | null
  /** No `tab-select` may come: the server moved the selection, or nothing did. */
  silent: boolean
  /** The element that must have focus after the step, when the step decides it. */
  focus: Element | null
  /** What can only be told once the update is done, such as whether it kept a link. */
  finish?: () => Omit<Expectation, "changed" | "focus" | "finish">
  context: Context
}

let current: Context = INITIAL
let expectation: Expectation = {
  selected: null,
  why: null,
  changed: null,
  silent: false,
  focus: null,
  context: INITIAL,
}

const host = () => document.getElementById(HOST_ID as string)
/** The links in this row, hidden ones included. */
const rowLinks = () => [
  ...(host()?.querySelectorAll<HTMLAnchorElement>(".lt-tabs__list a") ?? []),
]
const panelFor = (a: Element) =>
  document.getElementById((a.getAttribute("href") ?? "").slice(1))
const unusable = (a: Element) =>
  a.hasAttribute("hidden") || a.getAttribute("aria-disabled") === "true"

/** The next tab that can be selected, wrapping round, as the page's key table says. */
function nextEnabled(links: Element[], from: number, step: number) {
  for (let i = 1; i <= links.length; i++) {
    const index = (from + step * i + links.length * i) % links.length
    if (!unusable(links[index])) return index
  }
  return undefined
}

/** The tab the address points to in a version; with `any`, also one the user cannot select. */
function addressTab(v: Info, hash: string, any: boolean): string | null {
  if (hash === "") return null
  for (const key of v.keys)
    if (v.panelIds.get(key) === hash && (any || !v.disabled.has(key)))
      return key
  return null
}

/** What a user action must do, from the page as it stands. */
function expectAction(ctx: Context, action: Action): Expectation {
  const links = rowLinks()
  const before = links.findIndex(
    (a) => a.getAttribute("aria-selected") === "true",
  )
  const was = before >= 0 ? keyOf(links[before].getAttribute("href")) : null
  const focused = links.indexOf(document.activeElement as HTMLAnchorElement)
  const manual = INFO[ctx.host].manual
  const controlled = INFO[ctx.host].serverControlled
  let target: number | undefined
  let focus: Element | null = null
  if (action.startsWith("click ")) {
    const i = links.findIndex(
      (a) => keyOf(a.getAttribute("href")) === action.slice(6),
    )
    if (i >= 0 && !unusable(links[i])) target = i
  } else if (action === "focus") {
    focus = links.find((a) => a.getAttribute("tabindex") === "0") ?? null
  } else if (focused >= 0) {
    let next: number | undefined
    if (action === "ArrowRight") next = nextEnabled(links, focused, 1)
    else if (action === "ArrowLeft") next = nextEnabled(links, focused, -1)
    else if (action === "Home") next = nextEnabled(links, -1, 1)
    else if (action === "End") next = nextEnabled(links, links.length, -1)
    if (next !== undefined) {
      focus = links[next]
      if (!manual) target = next
    }
    // Enter activates the link, which is a click; Space selects only under
    // manual activation.
    if (action === "Enter") target = focused
    if (action === "Space" && manual) target = focused
    /*
     * Tab from the selected tab goes into its panel. From another tab, as
     * when the server moved the selection or a click in WebKit did not move
     * focus, the browser goes to the next tab stop in the document, which is
     * the selected tab when it comes later: the roving tab stop of the APG,
     * and nothing the component decides.
     */
    if (action === "Tab" && focused === before) focus = panelFor(links[before])
  }
  const key =
    target === undefined ? null : keyOf(links[target].getAttribute("href"))
  const changes = key !== null && key !== was
  const fragment =
    target === undefined
      ? null
      : (links[target].getAttribute("href") ?? "").slice(1)
  return {
    selected: changes ? key : was,
    why: changes && controlled ? "pending" : "action",
    changed: changes ? { key, index: target as number } : null,
    silent: !changes,
    focus,
    context: {
      ...ctx,
      choice: changes && !controlled ? fragment : ctx.choice,
      pending: changes && controlled ? true : ctx.pending,
    },
  }
}

/**
 * What the server's script showing the first panel must do. It is the
 * server's word: under `server-controlled` it answers a waiting click, and
 * the panels as they now stand decide, since the click's `aria-selected` is
 * not the server's; otherwise the server's `aria-selected` still comes
 * first. Without `server-controlled` the user's tab is put back.
 */
function expectScript(ctx: Context): Expectation {
  const v = INFO[ctx.body]
  const controlled = INFO[ctx.host].serverControlled
  const first = v.keys[0]
  const base = { changed: null, focus: null }
  if (controlled || ctx.choice === null)
    return {
      ...base,
      selected: controlled && ctx.pending ? first : (v.ariaSelected ?? first),
      why: "server",
      silent: true,
      context: { ...ctx, pending: false, scripted: true },
    }
  if (ctx.choice === "?")
    return {
      ...base,
      selected: null,
      why: null,
      silent: false,
      context: { ...ctx, scripted: true },
    }
  return {
    ...base,
    selected: pointingTo(v, ctx.choice),
    why: "user",
    silent: true,
    context: { ...ctx, scripted: true },
  }
}

/** The key of the tab in a version that points to the panel, if one does. */
const pointingTo = (v: Info, fragment: string) =>
  v.keys.find((k) => v.panelIds.get(k) === fragment) ?? null

/** What an update must do, from the page as it stands and the version sent. */
function expectUpdate(ctx: Context, send: string, way: Way): Expectation {
  const v = INFO[send]
  const hostVersion = way === "innerHTML" ? ctx.host : send
  const controlled = INFO[hostVersion].serverControlled
  const hash = location.hash.slice(1)
  // A load selects from the address through `select()`, which refuses a
  // tab the user cannot select; a lost choice is put back from it as it is.
  const address = controlled ? null : addressTab(v, hash, false)
  const recovered = controlled ? null : addressTab(v, hash, true)
  const resolves = hash === "" || v.ids.has(hash)
  const base = { changed: null, focus: null }
  const next = {
    ...ctx,
    host: hostVersion,
    body: send,
    pending: false,
    scripted: false,
  }
  const fragmentOf = (key: string | null) =>
    key === null ? null : (v.panelIds.get(key) ?? null)

  if (way === "outerHTML") {
    // A new component: a load. The server's `aria-selected` first, then the
    // address, then the server's other word.
    if (!resolves)
      return {
        ...base,
        selected: v.derived,
        why: "server",
        silent: true,
        context: { ...next, choice: null, started: false },
      }
    const selected = v.ariaSelected ?? address ?? v.derived
    return {
      ...base,
      selected,
      why: "load",
      silent: false,
      context: {
        ...next,
        started: true,
        choice:
          v.ariaSelected === null && address !== null
            ? address !== v.derived
              ? fragmentOf(address)
              : "?"
            : null,
      },
    }
  }

  /*
   * The same host, memory and all. The user's tab is the link, the panel it
   * pointed to and the row it stood in: the link while it still points
   * there; the tab that points there now when a morph kept the link or any
   * other link of the row (it matches links without ids by position, and can
   * turn the user's link into another tab or drop it); forgotten when none
   * of the row is left, as when new links replace them all. Which of these
   * only shows once the update is done, so the row is taken now and looked
   * at after.
   */
  const user = ctx.choice
  const row = rowLinks()
  const silent = !ctx.pending && (controlled || user === null)
  const expectation: Expectation = {
    ...base,
    selected: null,
    why: null,
    silent,
    context: next,
  }
  expectation.finish = () => {
    let selected: string | null = null
    let why: Expectation["why"] = "server"
    let choice: string | null = null
    if (controlled || user === null || ctx.pending) selected = v.derived
    else if (user === "?") {
      choice = "?"
      why = null
    } else {
      why = "user"
      const now = rowLinks()
      const kept = row.some((a) => now.includes(a))
      if (kept && pointingTo(v, user) !== null) {
        selected = pointingTo(v, user)
        choice = user
      } else {
        // The row is gone, or no tab points to the user's panel any more:
        // the server's `aria-selected` applies, then the address, then the
        // server's other word, which keeps the choice when it is the same
        // panel.
        selected = v.ariaSelected ?? recovered ?? v.derived
        choice =
          v.ariaSelected !== null
            ? null
            : (fragmentOf(recovered) ??
              (fragmentOf(v.derived) === user ? user : null))
      }
    }
    let started = ctx.started
    let quiet = silent
    if (!ctx.started && hash !== "" && v.ids.has(hash)) {
      // This update resolves the address: it is the load.
      started = true
      quiet = false
      if (v.ariaSelected === null && address !== null) {
        choice = address !== selected ? fragmentOf(address) : "?"
        selected = address
      }
      why = "load"
    }
    return {
      selected,
      why,
      silent: quiet,
      context: { ...next, choice, started },
    }
  }
  return expectation
}

/**
 * The component makes the headings' ids with `Math.random`, and the state
 * key holds the markup: with a new id on every replay, no two paths ever
 * met. Seeded afresh before every replay, the same path gives the same ids.
 */
const realRandom = Math.random
let seed = 1
const seeded = () => {
  seed = (seed * 16807) % 2147483647
  return seed / 2147483647
}

/** Set when the address was refused during the replay; the address is then not the component's. */
let throttled = false
const realReplaceState = history.replaceState

/*
 * The engines refuse the address after so many calls in ten seconds:
 * WebKit after a hundred `replaceState`, Firefox after two hundred calls to
 * `location` and `history` together. A search makes thousands, so which
 * replay met the limit depended on how fast the machine was, and then the
 * address could not be cleared between replays either. So in those two
 * engines every call from the component is refused here, the way the engine
 * refuses it, and the same path always ends in the same state: the page says
 * the tab is selected anyway, which the search then checks, and the address
 * stays empty. Chromium has no limit, and there the address is written and
 * checked.
 */
const ADDRESS_WRITTEN = server.browser === "chromium"

function limitedReplaceState(
  this: History,
  ...args: Parameters<History["replaceState"]>
): void {
  if (!ADDRESS_WRITTEN) {
    throttled = true
    throw new DOMException("Too many calls", "SecurityError")
  }
  try {
    realReplaceState.apply(this, args)
  } catch (error) {
    throttled = true
    throw error
  }
}

/**
 * Clears the address before a replay, where the component wrote one:
 * `replaceState` past the refusal above, and `location.hash` through
 * `setAddress` should that fail. The page is cleared first, so no component
 * sees the change.
 */
async function clearAddress(): Promise<void> {
  if (location.hash === "") return
  document.body.innerHTML = ""
  try {
    realReplaceState.call(
      history,
      history.state,
      "",
      location.pathname + location.search,
    )
  } catch {
    // Refused: `location.hash` below.
  }
  if (location.hash !== "") await setAddress("")
}

/** The `tab-select` events during a step. */
let events: number[] = []
const onSelect = (e: Event) =>
  events.push((e as CustomEvent<{ index: number }>).detail.index)

/** Tab, as a keyboard user presses it; WebKit on macOS moves to links with Alt+Tab. */
async function pressTab() {
  if (server.browser === "webkit") await userEvent.keyboard("{Alt>}{Tab}{/Alt}")
  else await userEvent.tab()
}

const KEYS_PRESSED: Partial<Record<Action, string>> = {
  ArrowRight: "{ArrowRight}",
  ArrowLeft: "{ArrowLeft}",
  Home: "{Home}",
  End: "{End}",
  Enter: "{Enter}",
  Space: " ",
}

async function apply(step: Step): Promise<void> {
  events = []
  if ("send" in step) {
    expectation = expectUpdate(current, step.send, step.way)
    const html = VERSIONS[step.send]
    if (step.way === "innerHTML") {
      const h = host()
      if (h) h.innerHTML = INFO[step.send].inner
    } else replace(step.way, HOST_ID as string, html)
    return
  }
  if (step.user === "first panel by script") {
    expectation = expectScript(current)
    const form = INFO[current.body].form ?? "until-found"
    rowLinks().forEach((a, i) => {
      const panel = panelFor(a)
      if (i === 0) panel?.removeAttribute("hidden")
      else panel?.setAttribute("hidden", form)
    })
    return
  }
  expectation = expectAction(current, step.user)
  const links = rowLinks()
  const onTab = links.includes(document.activeElement as HTMLAnchorElement)
  if (step.user.startsWith("click ")) {
    // A user cannot click what is not rendered.
    const a = links.find(
      (l) => keyOf(l.getAttribute("href")) === step.user.slice(6),
    )
    if (a && !a.hasAttribute("hidden")) a.click()
  } else if (step.user === "focus") {
    // Tab into the row lands on the tab stop.
    links.find((a) => a.getAttribute("tabindex") === "0")?.focus()
  } else if (step.user === "Tab") {
    // Only from a tab: from the panel, Tab leaves the page.
    if (onTab) await pressTab()
  } else if (onTab) {
    // Real keys, so Enter activates the link as the browser does.
    await userEvent.keyboard(KEYS_PRESSED[step.user] as string)
  }
}

let core: AccessibilityCore

type Snapshot = {
  tree: AxNode[]
  links: HTMLAnchorElement[]
  panels: (HTMLElement | null)[]
  selected: string[]
  active: Element | null
  hash: string
  markup: string
  /** The links' text, read now: the nodes are live. */
  texts: string[]
}

function snapshot(): Snapshot {
  const links = rowLinks()
  return {
    tree: core.tree(renderedMarkup()),
    links,
    panels: links.map(panelFor),
    selected: links
      .filter((a) => a.getAttribute("aria-selected") === "true")
      .map((a) => keyOf(a.getAttribute("href"))),
    active: document.activeElement,
    hash: location.hash.slice(1),
    markup: canonical(host()),
    texts: links.map((a) => a.textContent ?? ""),
  }
}

/** How often each invariant actually had something to check. */
const seen = {
  one: 0,
  shown: 0,
  form: 0,
  tablist: 0,
  tabNames: 0,
  panelNames: 0,
  roles: 0,
  tabStop: 0,
  controls: 0,
  ids: 0,
  user: 0,
  server: 0,
  load: 0,
  action: 0,
  pending: 0,
  address: 0,
  events: 0,
  focus: 0,
  kept: 0,
  stable: 0,
  untouched: 0,
}

/** React's markup with the whole state, as the server sent it. */
const SENT_REACT = (() => {
  const t = document.createElement("template")
  t.innerHTML = REACT
  return canonical(t.content.firstElementChild)
})()

/** Every id some version sends, on any element. */
const SENT_IDS = new Set(Object.values(INFO).flatMap((v) => [...v.ids]))

/** Text as a name is computed. */
const flat = (text: string | null) => (text ?? "").replace(/\s+/g, " ").trim()

function violations(
  before: Snapshot,
  after: Snapshot,
  step: Step,
  was: Context,
  now: Context,
): string[] {
  const problems: string[] = []
  const e = expectation
  const links = after.links
  if (links.length === 0) return ["no tabs in the row"]

  // Exactly one tab is selected, and exactly its panel is shown: the others
  // are hidden, so find in page still reaches them.
  seen.one++
  if (after.selected.length !== 1)
    return [`${after.selected.length} tabs are selected, not one`]
  const selectedIndex = links.findIndex(
    (a) => a.getAttribute("aria-selected") === "true",
  )
  const selectedLink = links[selectedIndex]
  const shownPanel = after.panels[selectedIndex]
  seen.shown++
  after.panels.forEach((p, i) => {
    if (!p)
      problems.push(`the tab "${flat(links[i].textContent)}" has no panel`)
    else if ((p === shownPanel) === p.hasAttribute("hidden"))
      problems.push(
        p === shownPanel
          ? `the selected panel "${p.id}" is hidden`
          : `the panel "${p.id}" is shown, though its tab is not selected`,
      )
  })
  const headings = after.tree
    .filter((n) => n.role === "heading")
    .map((n) => n.name)
  const shownHeading = flat(
    shownPanel?.querySelector(":scope > h2")?.textContent ?? null,
  )
  if (headings.join("|") !== shownHeading)
    problems.push(
      `the screen reader is given the headings "${headings.join("|")}", not only the selected panel's "${shownHeading}"`,
    )

  // The hidden panels are hidden in one form, the server's when it sent one.
  const forms = new Set(
    after.panels
      .filter((p) => p?.hasAttribute("hidden"))
      .map((p) => p?.getAttribute("hidden")),
  )
  if (forms.size > 0) {
    seen.form++
    const sent = INFO[now.body].form
    if (forms.size > 1)
      problems.push(`the panels are hidden in ${forms.size} forms`)
    else if (sent !== null && !forms.has(sent))
      problems.push(
        `the panels are hidden with "${[...forms][0]}", not the server's "${sent}"`,
      )
  }

  // The row is a named tab list, and nothing is announced as a list.
  seen.tablist++
  const lists = after.tree.filter((n) => n.role === "tablist")
  if (lists.length !== 1 || lists[0].name !== LABEL)
    problems.push(
      `the tab lists are ${JSON.stringify(lists.map((n) => n.name))}, not one named "${LABEL}"`,
    )
  seen.roles++
  const roles = new Set(after.tree.map((n) => n.role))
  for (const role of roles)
    if (!["tablist", "tab", "tabpanel", "heading", "paragraph"].includes(role))
      problems.push(`the screen reader is given a "${role}" in the row`)
  if (!after.tree.some((n) => n.role === "tabpanel" && n.id === shownPanel?.id))
    problems.push(`the selected panel "${shownPanel?.id}" is not a tabpanel`)

  // Each tab is named by its text, and the selected one is selected in the tree.
  seen.tabNames++
  const visible = links.filter((a) => !a.hasAttribute("hidden"))
  const treeTabs = after.tree.filter((n) => n.role === "tab")
  const names = visible.map((a) => flat(a.textContent))
  if (treeTabs.map((n) => n.name).join("|") !== names.join("|"))
    problems.push(
      `the tabs are named ${JSON.stringify(treeTabs.map((n) => n.name))}, not ${JSON.stringify(names)}`,
    )
  const treeSelected = treeTabs.filter((n) => n.states.includes("selected"))
  /*
   * A tab the server hides while the user has it selected stays selected,
   * as a disabled one does, and the tab stop moves on: the page promises
   * the tab stop, not a move of the selection. A hidden tab is not in the
   * tree, so then none is selected there.
   */
  const expectedInTree = selectedLink.hasAttribute("hidden") ? 0 : 1
  if (treeSelected.length !== expectedInTree)
    problems.push(`${treeSelected.length} tabs are selected in the tree`)

  // Each panel is named after its tab.
  seen.panelNames++
  for (const node of after.tree.filter((n) => n.role === "tabpanel")) {
    const i = after.panels.findIndex((p) => p?.id === node.id)
    if (i < 0) continue
    const name = flat(links[i].textContent)
    if (node.name !== name)
      problems.push(
        `the panel "${node.id}" is named "${node.name}", not "${name}"`,
      )
  }

  // Only the selected tab is a tab stop, or the next usable one when it is
  // not usable; only the selected panel is.
  seen.tabStop++
  const stop = unusable(selectedLink)
    ? (nextEnabled(links, selectedIndex, 1) ?? selectedIndex)
    : selectedIndex
  links.forEach((a, i) => {
    const want = i === stop ? "0" : "-1"
    if (a.getAttribute("tabindex") !== want)
      problems.push(
        `the tab "${flat(a.textContent)}" has tabindex "${a.getAttribute("tabindex")}", not "${want}"`,
      )
  })
  after.panels.forEach((p) => {
    if (p && (p.getAttribute("tabindex") === "0") !== (p === shownPanel))
      problems.push(
        `the panel "${p.id}" ${p === shownPanel ? "is not" : "is"} a tab stop`,
      )
  })

  // `aria-controls` is `href`, and points at the panel.
  seen.controls++
  for (const a of links) {
    const target = (a.getAttribute("href") ?? "").slice(1)
    if (
      a.getAttribute("aria-controls") !== target ||
      !document.getElementById(target)
    )
      problems.push(
        `the tab "${flat(a.textContent)}" controls "${a.getAttribute("aria-controls")}", not its panel "${target}"`,
      )
  }

  /*
   * The component writes no id, except on the heading in a panel, which
   * holds nothing the user can lose (the page and `CLAUDE.md` say so): an id
   * on a link or a panel the server did not send makes a morph replace it,
   * with the selection and the focus. And no id is there twice.
   */
  seen.ids++
  const ids = [...(host()?.querySelectorAll("[id]") ?? [])]
  for (const el of ids)
    if (
      !SENT_IDS.has(el.id) &&
      !el.matches(".lt-tabs__panel > :is(h1, h2, h3, h4, h5, h6)")
    )
      problems.push(
        `a <${el.localName}> has the id "${el.id}", which no server sent`,
      )
  const all = [...document.querySelectorAll("#lt-test-surface [id]")].map(
    (el) => el.id,
  )
  const twice = all.filter((id, i) => all.indexOf(id) !== i)
  if (twice.length > 0) problems.push(`two elements have the id "${twice[0]}"`)

  // The tab the promises say.
  const selected = after.selected[0]
  if (e.selected !== null && e.why !== null) {
    seen[e.why]++
    if (selected !== e.selected)
      problems.push(
        {
          user: `the user's "${was.choice}" was lost: "${selected}" is selected, not "${e.selected}"`,
          server: `"${selected}" is selected, not the server's "${e.selected}"`,
          load: `on load "${selected}" is selected, not "${e.selected}"`,
          action: `"${selected}" is selected after ${label(step)}, not "${e.selected}"`,
          pending: `the click on "${e.selected}" did not stand until the server answered`,
        }[e.why],
      )
  }

  /*
   * Markup that already says everything, as `lt.tabs()` from the React
   * entry writes it, is left exactly as sent when the selection is the
   * server's: the component has nothing to write, and React hydrates without
   * mismatches (A9). Not after idiomorph left a focused link's old text.
   */
  if (
    "send" in step &&
    step.send === "react" &&
    // `innerHTML` keeps the host another version sent.
    now.host === "react" &&
    selected === INFO.react.ariaSelected &&
    after.texts.join("|") === INFO.react.names.join("|")
  ) {
    seen.untouched++
    if (after.markup !== SENT_REACT)
      problems.push(
        "the component wrote on markup that already said everything",
      )
  }

  // The address follows every selection the user makes, and never points
  // at another panel in the row than the selected one. Where the engine
  // refused to write it, it stays as it was, by no other road, and the
  // selection holds anyway (the checks above).
  seen.address++
  if (throttled) {
    if (after.hash !== before.hash)
      problems.push(
        `the address went from "#${before.hash}" to "#${after.hash}", though writing it was refused`,
      )
  } else {
    const target = after.hash
    if (
      e.changed &&
      target !== (selectedLink.getAttribute("href") ?? "").slice(1)
    )
      problems.push(
        `the address is "#${target}" after the user selected "${selected}"`,
      )
    const pointsAt = after.panels.findIndex(
      (p) =>
        p !== null &&
        target !== "" &&
        (p.id === target || p.querySelector(`[id="${target}"]`)),
    )
    if (pointsAt >= 0 && pointsAt !== selectedIndex)
      problems.push(
        `the address "#${target}" points at a panel that is not selected`,
      )
  }

  // `tab-select` comes once when the user changes the selection, and not
  // when the server moves it or nothing changes.
  if (e.changed || e.silent) {
    seen.events++
    const want = e.changed ? [e.changed.index] : []
    if (events.join() !== want.join())
      problems.push(`tab-select gave [${events.join()}], not [${want.join()}]`)
  }

  // Focus where the keys put it.
  if (e.focus) {
    seen.focus++
    if (after.active !== e.focus)
      problems.push(
        `the focus is on <${after.active?.localName}>, not where ${label(step)} puts it`,
      )
  }

  if (!("send" in step) || step.way === "outerHTML" || step.way === "innerHTML")
    return problems

  /*
   * A morph keeps the links when they have no id, or the same, and the
   * keys are the same: the component writes nothing a morph recognises a
   * node by. The tab with focus keeps it, unless the server hid it.
   */
  const old = INFO[was.body]
  const neu = INFO[now.body]
  if (
    old.keys.join() === neu.keys.join() &&
    old.linkIds.every((id, i) => id === "" || id === neu.linkIds[i])
  ) {
    seen.kept++
    before.links.forEach((a, i) => {
      if (links[i] !== a)
        problems.push(`the update replaced the tab "${flat(a.textContent)}"`)
    })
    const focused = before.links.find((a) => a === before.active)
    if (focused && links.includes(focused) && !focused.hasAttribute("hidden")) {
      seen.focus++
      if (after.active !== focused)
        problems.push(
          `the update took focus from the tab "${flat(focused.textContent)}"`,
        )
    }
  }

  /*
   * The same version sent again by a morph changes nothing: the same links
   * and panels, the same markup, the same selection. Not while a click under
   * `server-controlled` waits for the server's answer: the answer is that.
   * And only from a page the morph finished: idiomorph with
   * `ignoreActiveValue` leaves the text of the link that has focus, and the
   * next update writes the server's.
   */
  const finished = before.texts.join("|") === INFO[was.body].names.join("|")
  if (
    now.host === was.host &&
    now.body === was.body &&
    !was.pending &&
    !was.scripted &&
    finished
  ) {
    seen.stable++
    if (after.markup !== before.markup)
      problems.push("the same version sent again changed the markup")
    if (before.panels.some((p, i) => p !== after.panels[i]))
      problems.push("the same version sent again replaced a panel")
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
  // What `apply` computed from the page before the step, finished now.
  next: () => {
    if (expectation.finish)
      expectation = {
        ...expectation,
        ...expectation.finish(),
        finish: undefined,
      }
    current = expectation.context
    return current
  },
  // The address is part of the state: the component reads it.
  contextKey: (c) =>
    `${c.host} ${c.body} ${c.choice} ${c.pending} ${c.started} ${c.scripted} #${location.hash.slice(1)}`,
  violations,
  seen,
  reset: async () => {
    current = INITIAL
    throttled = false
    seed = 1
    await clearAddress()
  },
}

describe("lt-tabs, every sequence of updates and user actions", () => {
  beforeAll(async () => {
    defineLtTabs()
    Math.random = seeded
    core = accessibilityCore(await (await fetch(coreUrl)).arrayBuffer())
    document.addEventListener("tab-select", onSelect)
    history.replaceState = limitedReplaceState
  })
  afterAll(() => {
    history.replaceState = realReplaceState
    Math.random = realRandom
    document.removeEventListener("tab-select", onSelect)
  })

  // Each search counts for itself, so neither leans on the other's checks.
  const fresh = () => {
    for (const k of Object.keys(seen)) seen[k as keyof typeof seen] = 0
  }

  it("keeps one selected tab, its panel, the names, the tab stops, the ids, the focus and the address in every state to depth 3", async () => {
    fresh()
    const run = await exploreStates(model, 3)
    expect(run.found.slice(0, 10)).toEqual([])
    // The search found more states than one step gives.
    expect(run.states).toBeGreaterThan(STATE_STEPS.length)
    expect(unchecked(seen)).toEqual([])
  }, 600_000)

  /*
   * Every sequence, without merging states: what the component remembers
   * and the page does not show (the user's panel, the server's word
   * next to its own, the form it hides in, the ids it gave the headings, a
   * click waiting for the server) only shows on a path. In Chromium only,
   * and only by the morphers: `outerHTML` makes a new component, and
   * `innerHTML` new links, with no memory to carry.
   */
  it.runIf(server.browser === "chromium")(
    "keeps the same invariants on every sequence of morphs to depth 3",
    async () => {
      fresh()
      const run = await exploreSequences(model, 3, SEQUENCE_STEPS)
      expect(run.found.slice(0, 10)).toEqual([])
      expect(run.ran).toBe(SEQUENCE_STEPS.length ** 3)
      // A load is a new component, which only `outerHTML` makes.
      expect(unchecked(seen)).toEqual(["load"])
    },
    600_000,
  )
})
