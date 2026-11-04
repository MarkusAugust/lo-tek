/// <reference path="../../../types/css.d.ts" />
/// <reference path="../../../testing/vite-url.d.ts" />

/**
 * Every sequence of server updates and user actions on a word with a
 * glossary entry, to a fixed depth, with the screen reader's view checked
 * after each step.
 *
 * The scenario tests in `lt-term.browser.test.ts` each follow one path. This
 * one does not choose: the server can send any of the versions below, by
 * any of the ways an update arrives, and the user can click, tap, hover,
 * press the keys the component promises and move the focus, in any order.
 * After every step the page as the browser rendered it goes to the core,
 * which computes the accessibility tree, and the invariants are checked on
 * that tree, on the wiring, on the top layer, on the focus, on the position,
 * on what the component leaves on the glossary, and on the page not
 * scrolling.
 *
 * Whether the card must be open after a step is computed from the page
 * before the step and from what the component remembers that the page does
 * not show: whether the card was pinned or opened by the mouse, and where
 * the mouse is. Both are in the context, so the state search keeps paths
 * apart that differ there.
 *
 * The hover delays are `setTimeout`, faked, and every step lets them run
 * out, so a path takes milliseconds. The page is the recipe from the
 * component page, in an article the server updates, under a button to click
 * and focus. The component is the real one, and so are Datastar and
 * idiomorph.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { page as browserPage, server, userEvent } from "vitest/browser"
import page from "../../../../../documentation/src/content/docs/components/term.mdx?raw"
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
import { defineLtTerm } from "./lt-term"
import { term, termWithState } from "./term"

import "../../../tokens/tokens.css"
import "./term.css"

/** The recipe from the "Plain HTML" tab, without its scripts and comments. */
const RECIPE_BLOCK = (() => {
  const block = tabItems(page)
    .filter((t) => t.name === "Plain HTML")
    .flatMap((t) => htmlBlocks(t.code))
    .find((b) => b.includes("<lt-term"))
  if (!block) throw new Error("no recipe with <lt-term> on the page")
  return block
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim()
})()

/** `text` with `from` replaced, which must be there: a recipe that changed would otherwise test nothing. */
function swap(text: string, from: string | RegExp, to: string): string {
  const out = text.replace(from, to)
  if (out === text)
    throw new Error(`the recipe has no ${String(from)} to replace`)
  return out
}

/** The recipe's word, its entry and their texts, read from it. */
const WORD_TAG = RECIPE_BLOCK.match(/<lt-term><a[^>]*>/)?.[0].slice(9) ?? ""
const WORD_TEXT = RECIPE_BLOCK.match(/<lt-term><a[^>]*>([^<]+)<\/a>/)?.[1]
const ENTRY_ID = WORD_TAG.match(/href="#([^"]+)"/)?.[1]
const ENTRY_TAG = `<div id="${ENTRY_ID}">`
const TERM_TEXT = RECIPE_BLOCK.match(/<dt>([^<]+)<\/dt>/)?.[1]
// The recipe must be what the versions below change: a bare link and an
// entry with the id and nothing else.
if (
  !WORD_TEXT ||
  !ENTRY_ID ||
  !TERM_TEXT ||
  !RECIPE_BLOCK.includes(ENTRY_TAG) ||
  /class=|aria-/.test(WORD_TAG)
)
  throw new Error("the recipe is not a bare link to an entry with an id")

/** What `lt.term()` writes, and with the state `/react` adds. */
const builder = (state: boolean) => {
  const sets = state ? termWithState({ id: ENTRY_ID }) : term({ id: ENTRY_ID })
  return swap(
    swap(RECIPE_BLOCK, WORD_TAG, `<a ${attr(sets.word)}>`),
    ENTRY_TAG,
    `<div ${attr(sets.entry)}>`,
  )
}

/** The article the server sends again, by its id. */
const ARTICLE_ID = "policy"
const article = (content: string) =>
  `<article id="${ARTICLE_ID}">${content}</article>`

/** What the server can send: the whole article. */
const VERSIONS: Record<string, string> = {
  recipe: article(RECIPE_BLOCK),
  builder: article(builder(false)),
  // With `aria-expanded="false"`, as `/react` writes it.
  state: article(builder(true)),
  // The explanation changed.
  text: article(
    swap(RECIPE_BLOCK, /<\/dd>/, " It is reviewed every year.</dd>"),
  ),
  // The term was renamed: the link and the entry both have a new id.
  renamed: article(
    RECIPE_BLOCK.replaceAll(`#${ENTRY_ID}"`, `#${ENTRY_ID}-2"`).replace(
      ENTRY_TAG,
      `<div id="${ENTRY_ID}-2">`,
    ),
  ),
  // The entry lost its id: the word is a plain link.
  noEntry: article(swap(RECIPE_BLOCK, ENTRY_TAG, "<div>")),
  // The id on the <dt>: not an entry, and the word is a plain link.
  dtId: article(
    swap(
      swap(RECIPE_BLOCK, ENTRY_TAG, "<div>"),
      `<dt>${TERM_TEXT}</dt>`,
      `<dt id="${ENTRY_ID}">${TERM_TEXT}</dt>`,
    ),
  ),
}

/** What a version says, read from its markup once. */
type Info = {
  /** The id of the entry the word points at, when it is an entry. */
  entry: string | null
  ids: Set<string>
  /** What `innerHTML` on the article writes. */
  inner: string
}

function info(html: string): Info {
  const t = document.createElement("template")
  t.innerHTML = html
  const word = t.content.querySelector("lt-term > a")
  const id = word?.getAttribute("href")?.slice(1) ?? ""
  const target = id ? t.content.getElementById(id) : null
  const isEntry =
    target?.localName === "div" &&
    target.parentElement?.localName === "dl" &&
    target.querySelector(":scope > dt") !== null &&
    target.querySelector(":scope > dd") !== null
  return {
    entry: isEntry ? id : null,
    ids: new Set([...t.content.querySelectorAll("[id]")].map((e) => e.id)),
    inner: (t.content.firstElementChild as Element).innerHTML,
  }
}
const INFO = Object.fromEntries(
  Object.entries(VERSIONS).map(([name, html]) => [name, info(html)]),
)

/** A button above the article, to click and to move the focus to. The card opens below the word, so it never covers it. */
const OUTSIDE_ID = "elsewhere"
const RECIPE = `<p><button id="${OUTSIDE_ID}" type="button">Elsewhere</button></p>${VERSIONS.recipe}`

type Way = Replacement | "innerHTML"
type Action =
  | "click word"
  | "tap word"
  | "click outside"
  | "click in card"
  | "hover word"
  | "hover card"
  | "hover outside"
  | "Enter"
  | "Escape"
  | "focus word"
  | "focus outside"
type Step = { send: string; way: Way } | { user: Action }

const WAYS: Way[] = ["Datastar", "idiomorph", "outerHTML", "innerHTML"]
const STEPS: Step[] = [
  ...Object.keys(VERSIONS).flatMap((send) =>
    WAYS.map((way) => ({ send, way })),
  ),
  ...(
    [
      "click word",
      "tap word",
      "click outside",
      "click in card",
      "hover word",
      "hover card",
      "hover outside",
      "Enter",
      "Escape",
      "focus word",
      "focus outside",
    ] as Action[]
  ).map((user) => ({ user })),
]

function label(step: Step): string {
  return "send" in step ? `${step.send} by ${step.way}` : step.user
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
 * The state search, in every engine: every version by Datastar, the ones
 * that keep or lose the entry by idiomorph, a new article by `outerHTML`
 * and by `innerHTML` once each, and every action. The sequences, in
 * Chromium, keep what moves the memory: the pointer, the pin, and the
 * updates that keep the card or take it.
 */
const STATE_STEPS = pick([
  ...Object.keys(VERSIONS).map((v) => `${v} by Datastar`),
  ...["recipe", "text", "noEntry"].map((v) => `${v} by idiomorph`),
  "renamed by outerHTML",
  "text by innerHTML",
  "click word",
  "tap word",
  "click outside",
  "click in card",
  "hover word",
  "hover card",
  "hover outside",
  "Enter",
  "Escape",
  "focus word",
  "focus outside",
])
const SEQUENCE_STEPS = pick([
  "recipe by Datastar",
  "text by idiomorph",
  "noEntry by Datastar",
  "renamed by Datastar",
  "click word",
  "tap word",
  "hover word",
  "hover card",
  "hover outside",
  "Escape",
  "focus word",
])
/** What the sequences leave out, and the state search checks in every engine. */
const UNSEEN_IN_SEQUENCES = ["replaced", "untouched"]

/** Where the mouse is, as the component's listeners see it. `unknown` after a node was replaced under it. */
type Pointer = "word" | "card" | "elsewhere" | "unknown"
type Mode = "no" | "hover" | "pinned"

/**
 * The context: which version the article came from, and what the component
 * remembers that the page does not show: how the card was opened, and
 * where the mouse is. `mode` is null when the page promises nothing exact.
 */
type Context = {
  version: string
  mode: Mode | null
  pointer: Pointer
  /** Nothing but updates since the version was sent: the page is as it left it. */
  fresh: boolean
}

const INITIAL: Context = {
  version: "recipe",
  mode: "no",
  pointer: "elsewhere",
  fresh: true,
}

type Expectation = {
  /** The element that must have focus after the step, when the step decides it. */
  focus: Element | null
  context: Context
}

let current: Context = INITIAL
let expectation: Expectation = { focus: null, context: INITIAL }

const articleOf = () => document.getElementById(ARTICLE_ID)
const wordOf = () =>
  articleOf()?.querySelector<HTMLAnchorElement>("lt-term > a") ?? null
const outside = () => document.getElementById(OUTSIDE_ID) as HTMLElement
/** The element the word points at, entry or not. */
const targetOf = () => {
  const id = wordOf()?.getAttribute("href")?.slice(1)
  return id ? document.getElementById(id) : null
}
const openEntries = () =>
  [
    ...document.querySelectorAll<HTMLElement>("#lt-test-surface [popover]"),
  ].filter((e) => e.matches(":popover-open"))

/**
 * The mode after the mouse moves to `to`, with the delays run out. Into the
 * word from elsewhere opens a closed card; leaving the word and the card
 * closes one the mouse opened; a pinned card stays.
 */
function moved(mode: Mode, from: Pointer, to: Pointer, entry: boolean): Mode {
  if (mode === "pinned") return mode
  if (mode === "hover") return to === "word" || to === "card" ? mode : "no"
  if (to === "word" && from !== "word" && entry) return "hover"
  return mode
}

/** What a user action must do, from the page as it stands. */
function expectAction(ctx: Context, action: Action): Expectation {
  const word = wordOf()
  const entry = INFO[ctx.version].entry !== null
  const open = openEntries().length > 0
  const active = document.activeElement
  const keep = (context: Partial<Context>): Expectation => ({
    focus: null,
    context: { ...ctx, fresh: false, ...context },
  })
  // What the component remembers, or what the page shows when the test has
  // lost track.
  const mode: Mode | null = ctx.mode ?? (open ? null : "no")
  // A click on the word unpins a pinned card and pins any other; a word
  // without an entry is a plain link. A mouse that opened the card is on
  // the word, so the click pins that one.
  const clicked: Mode | null = !entry
    ? "no"
    : mode === "pinned"
      ? "no"
      : mode === null
        ? null
        : "pinned"
  switch (action) {
    case "click word":
      return keep({ mode: clicked, pointer: "word" })
    case "tap word":
      return keep({ mode: clicked })
    case "click outside":
      return keep({ mode: "no", pointer: "elsewhere" })
    case "click in card": {
      // Inside an open card it stays; a closed card is only the glossary,
      // so the mouse is elsewhere as far as the word is concerned.
      if (!open)
        return keep({
          mode:
            mode === null ? null : moved(mode, ctx.pointer, "elsewhere", entry),
          pointer: "elsewhere",
        })
      return keep({ pointer: "card" })
    }
    case "hover word":
      return keep({
        mode: mode === null ? null : moved(mode, ctx.pointer, "word", entry),
        pointer: "word",
      })
    case "hover card": {
      const to: Pointer = open ? "card" : "elsewhere"
      return keep({
        mode: mode === null ? null : moved(mode, ctx.pointer, to, entry),
        pointer: to,
      })
    }
    case "hover outside":
      return keep({
        mode:
          mode === null ? null : moved(mode, ctx.pointer, "elsewhere", entry),
        pointer: "elsewhere",
      })
    case "Enter":
      // The key follows the focused link, which the component turns into
      // the toggle; on the button outside it is a click outside.
      if (active === word && word) return keep({ mode: clicked })
      if (active === outside()) return keep({ mode: "no" })
      return keep({})
    case "Escape": {
      if (!open) return keep({})
      // Focus goes back to the word when it was on the word, nowhere or in
      // the card; from the button outside it stays there.
      const back =
        active === word ||
        active === document.body ||
        active === null ||
        (openEntries()[0]?.contains(active) ?? false)
      return { ...keep({ mode: "no" }), focus: back ? word : active }
    }
    case "focus word":
    case "focus outside":
      // No promise closes or opens the card when the focus moves.
      return keep({})
  }
}

/** What an update must do, from the page as it stands and the version sent. */
function expectUpdate(ctx: Context, send: string, way: Way): Expectation {
  const v = INFO[send]
  if (way === "outerHTML" || way === "innerHTML") {
    // A new component, closed. Under a mouse that stays where it was, a new
    // word or card may or may not get the pointer, so the mouse is unknown
    // until it moves again.
    const under = ctx.pointer === "word" || ctx.pointer === "card"
    return {
      focus: null,
      context: {
        version: send,
        mode: under ? null : "no",
        pointer: under ? "unknown" : ctx.pointer,
        fresh: true,
      },
    }
  }
  // A morph keeps the component and the word: the card stays while the
  // word still points at an entry. A card held by the mouse over the card
  // goes unknown when the entry is a new node, which the mouse never entered.
  const entryReplaced = v.entry !== INFO[ctx.version].entry
  let mode = ctx.mode
  let pointer = ctx.pointer
  if (v.entry === null) mode = "no"
  if (entryReplaced && pointer === "card") {
    pointer = "unknown"
    if (mode === "hover") mode = null
  }
  return {
    focus: null,
    context: { version: send, mode, pointer, fresh: true },
  }
}

async function apply(step: Step): Promise<void> {
  followed = null
  if ("send" in step) {
    expectation = expectUpdate(current, step.send, step.way)
    if (step.way === "innerHTML") {
      const a = articleOf()
      if (a) a.innerHTML = INFO[step.send].inner
    } else replace(step.way, ARTICLE_ID, VERSIONS[step.send])
    return
  }
  expectation = expectAction(current, step.user)
  const word = wordOf()
  switch (step.user) {
    case "click word":
      if (word) await userEvent.click(word)
      break
    case "tap word":
      // A finger: `pointerType` "touch", and the tap's click.
      word?.dispatchEvent(
        new PointerEvent("pointerenter", { pointerType: "touch" }),
      )
      word?.click()
      break
    case "click outside":
      await userEvent.click(outside())
      break
    case "click in card": {
      const card = openEntries()[0] ?? targetOf()
      const dt = card?.querySelector("dt")
      if (dt) await userEvent.click(dt)
      else await userEvent.click(outside())
      break
    }
    case "hover word":
      if (word) await userEvent.hover(word)
      break
    case "hover card": {
      const card = openEntries()[0] ?? targetOf()
      await userEvent.hover(card?.querySelector("dt") ?? outside())
      break
    }
    case "hover outside":
      await userEvent.hover(outside())
      break
    case "Enter":
      await userEvent.keyboard("{Enter}")
      break
    case "Escape":
      await userEvent.keyboard("{Escape}")
      break
    case "focus word":
      word?.focus()
      break
    case "focus outside":
      outside().focus()
      break
  }
}

/**
 * Whether the last click on the word was left to the browser. The test
 * stops the navigation itself, after the component: a plain link would
 * otherwise take the page to the glossary.
 */
let followed: boolean | null = null
const onClick = (event: Event) => {
  const link = (event.target as Element | null)?.closest?.("lt-term > a")
  if (!link) return
  followed = !event.defaultPrevented
  event.preventDefault()
}

let core: AccessibilityCore

type Snapshot = {
  tree: AxNode[]
  word: HTMLAnchorElement | null
  target: HTMLElement | null
  open: HTMLElement[]
  expanded: string | null
  active: Element | null
  scroll: number
  address: string
  markup: string
  wordBox: DOMRect | null
  cardBox: DOMRect | null
  gap: number
}

function snapshot(): Snapshot {
  const word = wordOf()
  const open = openEntries()
  const boxes = word?.getClientRects()
  return {
    tree: core.tree(renderedMarkup()),
    word,
    target: targetOf(),
    open,
    expanded: word?.getAttribute("aria-expanded") ?? null,
    active: document.activeElement,
    scroll: window.scrollY,
    address: location.href,
    markup: canonical(articleOf()),
    wordBox: boxes && boxes.length > 0 ? boxes[boxes.length - 1] : null,
    cardBox: open[0]?.getBoundingClientRect() ?? null,
    gap: open[0]
      ? Number.parseFloat(getComputedStyle(open[0]).scrollMarginBlockStart)
      : 0,
  }
}

/** How often each invariant actually had something to check. */
const seen = {
  word: 0,
  expanded: 0,
  one: 0,
  state: 0,
  pinned: 0,
  escape: 0,
  link: 0,
  scroll: 0,
  ids: 0,
  position: 0,
  released: 0,
  kept: 0,
  replaced: 0,
  untouched: 0,
  stable: 0,
}

/** Every id some version sends, and the page's own. */
const SENT_IDS = new Set([
  ...Object.values(INFO).flatMap((v) => [...v.ids]),
  OUTSIDE_ID,
  "lt-test-surface",
])

/** A version as the server sent it, attributes in name order. */
const sent = (name: string) => {
  const t = document.createElement("template")
  t.innerHTML = VERSIONS[name]
  return canonical(t.content.firstElementChild)
}
const SENT_STATE = sent("state")

/** The markup without the position on the entry: what an open card adds. */
const withoutPosition = (markup: string) => markup.replace(/ style="[^"]*"/, "")

/** Where the open card must be: under the word by the gap, inside the window. */
function expectedPosition(word: DOMRect, card: DOMRect, gap: number) {
  const edge = 4
  let top = word.bottom + gap
  let left = word.left
  // The viewport without a classic scrollbar, as the card is clamped.
  const innerWidth = document.documentElement.clientWidth
  const innerHeight = document.documentElement.clientHeight
  left = Math.max(edge, Math.min(left, innerWidth - card.width - edge))
  if (top + card.height > innerHeight) top = word.top - card.height - gap
  top = Math.max(edge, Math.min(top, innerHeight - card.height - edge))
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
  const { word } = after
  if (!word) return ["no word"]
  const shown = after.open.length > 0
  const hasEntry = INFO[now.version].entry !== null

  // The word is a link, named by its text, and says it expands when it
  // points at an entry.
  seen.word++
  const links = after.tree.filter(
    (n) => n.role === "link" && n.name === WORD_TEXT,
  )
  if (links.length !== 1)
    problems.push(
      `the screen reader is given ${links.length} links named "${WORD_TEXT}"`,
    )
  else if (links[0].states.includes("expandable") !== hasEntry)
    problems.push(
      `the link is ${hasEntry ? "not " : ""}expandable, with ${hasEntry ? "an" : "no"} entry`,
    )

  // `aria-expanded` and the tree say whether the card is open.
  seen.expanded++
  const want = hasEntry ? String(shown) : null
  if (after.expanded !== want)
    problems.push(
      `aria-expanded is "${after.expanded}", not "${want}", on a card that is ${shown ? "open" : "closed"}`,
    )
  if (links[0] && links[0].states.includes("expanded") !== shown)
    problems.push(
      `the screen reader is told the link is ${shown ? "collapsed" : "expanded"}`,
    )

  // One card at most, and it is the entry the word points at.
  seen.one++
  if (after.open.length > 1)
    problems.push(`${after.open.length} entries are open`)
  if (shown && after.open[0] !== after.target)
    problems.push(
      `the open card is #${after.open[0].id}, not the entry the word points at`,
    )
  if (shown && !hasEntry)
    problems.push("a card is open for a word that points at no entry")

  // The open state the promises say.
  if (now.mode !== null) {
    seen.state++
    if (shown !== (now.mode !== "no"))
      problems.push(
        `the card is ${shown ? "open" : "closed"} after ${label(step)}, not ${now.mode === "no" ? "closed" : `open (${now.mode})`}`,
      )
    // A pinned card stays when the mouse leaves.
    if (
      was.mode === "pinned" &&
      now.mode === "pinned" &&
      "user" in step &&
      step.user.startsWith("hover")
    ) {
      seen.pinned++
      if (!shown) problems.push(`the pinned card closed on ${label(step)}`)
    }
  }

  // Escape closes the card and gives the focus back to the word.
  if ("user" in step && step.user === "Escape" && before.open.length > 0) {
    seen.escape++
    if (shown) problems.push("Escape did not close the card")
    if (after.active !== expectation.focus)
      problems.push(
        `after Escape the focus is on <${after.active?.localName}>, not <${expectation.focus?.localName}>`,
      )
  }

  // A click on a word with an entry opens the card and does not follow
  // the link; on a word without one, the link is the link.
  if (followed !== null) {
    seen.link++
    const hasEntryBefore = INFO[was.version].entry !== null
    if (followed === hasEntryBefore)
      problems.push(
        followed
          ? `${label(step)} followed the link to the entry rather than open the card`
          : `${label(step)} did not follow a link that points at no entry`,
      )
  }

  // Nothing scrolls, and the address stays.
  seen.scroll++
  if (after.scroll !== before.scroll)
    problems.push(`the page scrolled from ${before.scroll} to ${after.scroll}`)
  if (after.address !== before.address)
    problems.push(`the address changed to ${after.address}`)

  // The component writes no id, and no id is there twice.
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

  // The card hangs under the word, by the gap, inside the window.
  if (shown && after.cardBox && after.wordBox) {
    seen.position++
    const at = expectedPosition(after.wordBox, after.cardBox, after.gap)
    if (
      Math.abs(after.cardBox.top - at.top) > 1 ||
      Math.abs(after.cardBox.left - at.left) > 1
    )
      problems.push(
        `the card is at ${Math.round(after.cardBox.left)},${Math.round(after.cardBox.top)}, not at ${at.left},${at.top}`,
      )
  }

  // Closed, the glossary is as the server sent it: the component took off
  // `popover`, the class and the position it put on the entry.
  if (!shown) {
    seen.released++
    for (const el of document.querySelectorAll("#lt-test-surface dl *")) {
      if (el.hasAttribute("popover"))
        problems.push(`<${el.localName}> in the glossary kept popover`)
      if (el.hasAttribute("style"))
        problems.push(`<${el.localName}> in the glossary kept a style`)
    }
    if (
      (now.version === "recipe" || now.version === "text") &&
      document.querySelector("#lt-test-surface dl .lt-term__entry")
    )
      problems.push("the entry kept the class the component put on it")
  }

  // A morph keeps the word, and the focus on it.
  if ("send" in step && (step.way === "Datastar" || step.way === "idiomorph")) {
    seen.kept++
    if (before.word !== word) problems.push("the update replaced the word")
    if (before.active === before.word && after.active !== word)
      problems.push("the update took the focus from the word")
  }

  // A new article is a new component: closed.
  if (
    "send" in step &&
    (step.way === "outerHTML" || step.way === "innerHTML")
  ) {
    seen.replaced++
    if (before.word === word)
      problems.push("the replaced article kept its word")
  }

  // Markup that already says everything, as `/react` writes it, is left
  // exactly as sent while the card is closed.
  if (
    "send" in step &&
    step.send === "state" &&
    (step.way === "Datastar" || step.way === "idiomorph") &&
    !shown
  ) {
    seen.untouched++
    if (after.markup !== SENT_STATE)
      problems.push(
        `the component wrote on markup that already said everything: ${after.markup}`,
      )
  }

  // The same version sent again by a morph changes nothing.
  if (
    "send" in step &&
    (step.way === "Datastar" || step.way === "idiomorph") &&
    was.version === step.send &&
    was.fresh
  ) {
    seen.stable++
    if (withoutPosition(after.markup) !== withoutPosition(before.markup))
      problems.push(
        `the same version sent again changed the markup from ${before.markup} to ${after.markup}`,
      )
    if (shown !== before.open.length > 0)
      problems.push("the same version sent again opened or closed the card")
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
  // What the page does not show: how the card was opened and where the
  // mouse is. The version is in the page.
  contextKey: (c) => `${c.mode}|${c.pointer}|${c.version}`,
  violations,
  seen,
  // The hover delays run out, and what the component does after them.
  settle: async () => {
    await settle()
    vi.advanceTimersByTime(1000)
    await settle()
    await settle()
  },
  reset: async () => {
    // The old page goes while its clock is the one its timers were made
    // with. The mouse is parked in a corner, away from where the word and
    // the card will be, so the new page starts with it elsewhere.
    document.body.innerHTML =
      '<div id="lt-park" style="position: fixed; inset-block-end: 0; inset-inline-end: 0; inline-size: 8px; block-size: 8px"></div>'
    vi.useRealTimers()
    await userEvent.hover(document.getElementById("lt-park") as HTMLElement)
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    current = INITIAL
  },
}

describe("lt-term, every sequence of updates and user actions", () => {
  beforeAll(async () => {
    // The versions without an entry are warned about, as they should be;
    // the warnings have their own test, and here they are noise.
    vi.spyOn(console, "warn").mockImplementation(() => {})
    // Wider than `sm`, where the card hangs by the word. The sheet on a
    // narrow screen has its own tests.
    await browserPage.viewport(1280, 720)
    defineLtTerm()
    core = accessibilityCore(await (await fetch(coreUrl)).arrayBuffer())
    document.addEventListener("click", onClick)
  })
  afterAll(async () => {
    document.removeEventListener("click", onClick)
    vi.useRealTimers()
    await browserPage.viewport(414, 896)
  })

  // Each search counts for itself, so neither leans on the other's checks.
  const fresh = () => {
    for (const k of Object.keys(seen)) seen[k as keyof typeof seen] = 0
  }

  it("keeps the word's state, the card, the focus, the position, the glossary and the ids in every state to depth 3", async () => {
    fresh()
    const run = await exploreStates(model, 3)
    expect(run.found.slice(0, 10)).toEqual([])
    expect(run.states).toBeGreaterThan(STATE_STEPS.length)
    expect(unchecked(seen)).toEqual([])
  }, 900_000)

  // Every sequence, without merging states: what the component remembers
  // (the pin, the pointer) only shows on a path. In Chromium only.
  it.runIf(server.browser === "chromium")(
    "keeps the same invariants on every sequence to depth 3",
    async () => {
      fresh()
      const run = await exploreSequences(model, 3, SEQUENCE_STEPS)
      expect(run.found.slice(0, 10)).toEqual([])
      expect(run.ran).toBe(SEQUENCE_STEPS.length ** 3)
      expect(unchecked(seen)).toEqual(UNSEEN_IN_SEQUENCES)
    },
    900_000,
  )
})
