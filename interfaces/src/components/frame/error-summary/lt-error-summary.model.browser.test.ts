/// <reference path="../../../types/css.d.ts" />
/// <reference path="../../../testing/vite-url.d.ts" />

/**
 * Every sequence of server updates and user actions, to a fixed depth, with
 * the screen reader's view checked after each step.
 *
 * The scenario tests next to this one were each written by someone who
 * thought of the case. This one does not choose: the server can send any of
 * the versions below, by any of the three ways an update arrives, and the
 * user can move into a field, in any order. After every step the page as the
 * browser rendered it goes to the core, which computes the accessibility
 * tree from the specifications, and the invariants are checked on that tree,
 * not on attributes.
 *
 * Nothing here is a second implementation: the page is the recipe from the
 * component page, the component is the real one, and so are Datastar and
 * idiomorph. The core's tree is compared with what Chromium and Firefox give
 * through AT-SPI on every contract step in `check-accessibility-tree.ts`.
 */

import { beforeAll, describe, expect, it } from "vitest"
import { server } from "vitest/browser"
import page from "../../../../../documentation/src/content/docs/components/error-summary.mdx?raw"
import coreUrl from "../../../../core/lotek-core.wasm?url"
import { mount } from "../../../testing/a11y"
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
  settle,
  unchecked,
} from "../../../testing/model"
import { htmlBlocks, tabItems } from "../../../testing/recipes"
import { renderedMarkup } from "../../../testing/rendered"
import {
  REPLACEMENTS,
  type Replacement,
  replace,
} from "../../../testing/update"
import { errorSummary } from "./error-summary"
import { defineLtErrorSummary } from "./lt-error-summary"

import "../../../tokens/tokens.css"
import "./error-summary.css"

/** The form in the "Plain HTML" recipe, without its scripts. */
const RECIPE = (() => {
  const block = tabItems(page)
    .filter((t) => t.name === "Plain HTML")
    .flatMap((t) => htmlBlocks(t.code))
    .find((b) => b.includes("<lt-error-summary"))
  if (!block) throw new Error("no recipe with <lt-error-summary> on the page")
  return block.replace(/<script[\s\S]*?<\/script>/g, "")
})()

/** The recipe's box: hidden and empty, as the server sends it before a submission. */
const BOX = RECIPE.match(/<lt-error-summary[\s\S]*?<\/lt-error-summary>/)?.[0]
if (!BOX) throw new Error("no <lt-error-summary> in the recipe")

const LINKS = `<li><a href="#fixer">Enter the fixer's address with an @</a></li>`

/** `text` with `from` replaced, which must be there: a recipe that changed would otherwise test nothing. */
function swap(text: string, from: string | RegExp, to: string): string {
  const out = text.replace(from, to)
  if (out === text)
    throw new Error(`the recipe has no ${String(from)} to replace`)
  return out
}

/** The recipe's box, shown, with a heading and the list filled in. */
const filled = (heading: string, extra = "") =>
  swap(
    swap(swap(BOX, " hidden", extra), /(<h2[^>]*>)<\/h2>/, `$1${heading}</h2>`),
    '<ul class="lt-list"></ul>',
    `<ul class="lt-list">${LINKS}</ul>`,
  )

// The default titleId, as an app writes it: the same id on every render.
const BUILT = errorSummary({ count: 1, id: "errors" })

/**
 * What the server can send: the markup, the heading it shows, and whether
 * the alert must have a name.
 */
const VERSIONS: Record<
  string,
  { html: string; heading: string | null; named: boolean }
> = {
  hidden: { html: BOX, heading: null, named: false },
  // Hidden, but still with the last errors: the box is only toggled.
  stale: {
    html: swap(
      filled("There are 2 problems"),
      "<lt-error-summary",
      "<lt-error-summary hidden",
    ),
    heading: null,
    named: false,
  },
  filled: {
    html: filled("There is 1 problem"),
    heading: "There is 1 problem",
    named: true,
  },
  builder: {
    html: `<lt-error-summary ${attr(BUILT.host)}><h2 ${attr(BUILT.title)}>There is 1 problem</h2><ul class="lt-list">${LINKS}</ul></lt-error-summary>`,
    heading: "There is 1 problem",
    named: true,
  },
  heading: {
    html: filled("Check the fixer's address"),
    heading: "Check the fixer's address",
    named: true,
  },
  // A server error by design: the box is named after an element that never
  // comes. No name is required; the component must not invent one.
  outside: {
    html: swap(
      filled("There is 1 problem"),
      'aria-labelledby="errors-title"',
      'aria-labelledby="later-title"',
    ),
    heading: "There is 1 problem",
    named: false,
  },
  // The template wrote the heading's id but no name: the component points
  // aria-labelledby at it, and follows it.
  unnamed: {
    html: swap(
      filled("There is 1 problem"),
      ' aria-labelledby="errors-title"',
      "",
    ),
    heading: "There is 1 problem",
    named: true,
  },
  // No id on the heading and no name: the component writes none, and says so.
  bare: {
    html: swap(
      swap(filled("There is 1 problem"), ' aria-labelledby="errors-title"', ""),
      ' id="errors-title"',
      "",
    ),
    heading: "There is 1 problem",
    named: false,
  },
  // Named by the server's aria-label alone.
  named: {
    html: swap(
      filled("There is 1 problem"),
      'aria-labelledby="errors-title"',
      'aria-label="Problems in the order"',
    ),
    heading: "There is 1 problem",
    named: true,
  },
}

type Step = { send: string; way: Replacement } | { focus: "fixer" }

const STEPS: Step[] = [
  ...Object.keys(VERSIONS).flatMap((send) =>
    REPLACEMENTS.map((way) => ({ send, way })),
  ),
  { focus: "fixer" },
]

function apply(step: Step): void {
  if ("focus" in step) document.getElementById(step.focus)?.focus()
  else replace(step.way, "errors", VERSIONS[step.send].html)
}

const label = (step: Step) =>
  "focus" in step ? "focus the fixer field" : `${step.send} by ${step.way}`

let core: AccessibilityCore

/** The screen reader's view of the page now, from the core. */
const tree = () => core.tree(renderedMarkup())

/** What a step is checked on: the tree, and the heading node and the name's wiring. */
type Snapshot = {
  tree: AxNode[]
  heading: Element | null
  text: string | null
  labelledBy: string | null
}

function snapshot(): Snapshot {
  const box = document.getElementById("errors")
  const heading = box?.querySelector("h2") ?? null
  return {
    tree: tree(),
    heading,
    text: heading?.textContent?.trim() ?? null,
    labelledBy: box?.getAttribute("aria-labelledby") ?? null,
  }
}

/** How often each invariant actually had something to check. */
const seen = {
  alert: 0,
  appeared: 0,
  server: 0,
  kept: 0,
  stable: 0,
  stale: 0,
}

/** The id the version's heading has, or "" for none. */
const headingId = (version: string) =>
  VERSIONS[version].html.match(/<h2[^>]*\sid="([^"]+)"/)?.[1] ?? ""

/**
 * The `aria-labelledby` the box has once it has settled in a version: the
 * server's, or the heading's id the component points at when the server
 * named it after nothing.
 */
function settledName(version: string): string | null {
  const html = VERSIONS[version].html
  const box = html.match(/<lt-error-summary[^>]*>/)?.[0] ?? ""
  const written = box.match(/\saria-labelledby="([^"]+)"/)?.[1]
  if (written) return written
  if (/\saria-label="/.test(box)) return null
  return headingId(version) || null
}

function violations(
  before: Snapshot,
  after: Snapshot,
  step: Step,
  shownBefore: string,
  shown: string,
): string[] {
  const problems: string[] = []
  const alerts = after.tree.filter((n) => n.role === "alert")
  const version = VERSIONS[shown]
  const box = document.getElementById("errors")
  // The version the server sent decides whether there is an alert, not the
  // box's attributes, so a component that keeps the box hidden fails here.
  if (version.heading === null) {
    if (alerts.length > 0)
      problems.push("an alert after the server hid the box")
  } else if (alerts.length !== 1) {
    problems.push(`${alerts.length} alerts, not one`)
  } else {
    seen.alert++
    /*
     * The box takes focus, and without a name a screen reader says only
     * "alert". The name is what the box shows: the server's `aria-label`,
     * otherwise its heading. Not what the server sent: idiomorph with
     * `ignoreActiveValue` leaves the content of the element that has focus
     * as it was, and then the screen shows the old heading too. A version
     * the server did not name stays without a name: the component does not
     * invent one.
     */
    const shownName =
      box?.getAttribute("aria-label")?.trim() || after.text || ""
    /*
     * The heading is this version's only when it has the id the version
     * sent. idiomorph with `ignoreActiveValue` applies the attributes of the
     * focused box and leaves its content, so the box can point at a heading
     * id that an earlier version's heading does not have; the component
     * writes no id, by design, and no name is required then.
     */
    const ownHeading = (after.heading?.id ?? "") === headingId(shown)
    if (!ownHeading && !box?.getAttribute("aria-label")?.trim()) {
      // Named after the heading it shows, if that has an id: the earlier one.
      seen.stale++
      if (after.heading?.id && alerts[0].name !== shownName)
        problems.push(
          `the alert is named "${alerts[0].name}", but the box shows "${shownName}"`,
        )
    } else if (!version.named) {
      if (alerts[0].name !== "")
        problems.push(
          `the alert is named "${alerts[0].name}", though the server named it after nothing`,
        )
    } else if (alerts[0].name === "") problems.push("the alert has no name")
    else if (alerts[0].name !== shownName)
      problems.push(
        `the alert is named "${alerts[0].name}", but the box shows "${shownName}"`,
      )
  }
  // No two elements share an id.
  const ids = [...document.querySelectorAll("[id]")].map((e) => e.id)
  const twice = ids.filter((id, i) => ids.indexOf(id) !== i)
  if (twice.length > 0) problems.push(`two elements have the id "${twice[0]}"`)
  // The component writes no id: every id on the box's heading is one a
  // version sent.
  const sentIds = new Set(
    Object.values(VERSIONS).flatMap((v) =>
      [...v.html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]),
    ),
  )
  if (after.heading?.id && !sentIds.has(after.heading.id))
    problems.push(
      `the heading has the id "${after.heading.id}", which no server sent`,
    )
  // The server's wiring is the server's word.
  if ("send" in step && step.send === "builder") {
    seen.server++
    if (box?.getAttribute("aria-labelledby") !== "errors-title")
      problems.push(
        `aria-labelledby is "${box?.getAttribute("aria-labelledby")}", not the server's "errors-title"`,
      )
  }
  const hadAlert = before.tree.some((n) => n.role === "alert")
  if (!hadAlert && alerts.length === 1) {
    seen.appeared++
    // A box that appears takes focus, so the user hears the submission stopped.
    if (!alerts[0].states.includes("focused"))
      problems.push("the box appeared without taking focus")
    // And it shows what the server sent: the box took focus in the middle
    // of the update before, and idiomorph then left the old errors.
    if (after.text !== version.heading)
      problems.push(
        `the box appeared showing "${after.text}", not the server's "${version.heading}"`,
      )
  }
  /*
   * An update that keeps the box never takes focus from the field. A plain
   * `outerHTML` replaces it with a new box, which takes focus as a new
   * message: the component cannot tell that from a new submission, and the
   * page says to turn it off with `data-autofocus="false"` for live
   * validation.
   */
  const inField = (t: AxNode[]) =>
    t.some((n) => n.role === "textbox" && n.states.includes("focused"))
  if (
    "send" in step &&
    step.way !== "outerHTML" &&
    hadAlert &&
    inField(before.tree)
  ) {
    seen.kept++
    if (!inField(after.tree))
      problems.push("an update took focus from the field")
  }
  // The same box sent again by a morph keeps the heading and the name: an
  // id the server did not send made both morphers replace the heading.
  if (
    "send" in step &&
    step.way !== "outerHTML" &&
    step.send === shownBefore &&
    before.heading !== null &&
    // A box idiomorph left half updated is finished by the next update, as
    // it should be: only a box settled in the version must stay as it is.
    (before.heading.id ?? "") === headingId(shownBefore) &&
    before.labelledBy === settledName(shownBefore)
  ) {
    seen.stable++
    if (after.heading !== before.heading)
      problems.push("the same box sent again replaced the heading")
    if (after.labelledBy !== before.labelledBy)
      problems.push(
        `the same box sent again changed aria-labelledby from "${before.labelledBy}" to "${after.labelledBy}"`,
      )
  }
  return problems
}

/** The search's view of this component: the version shown is the context. */
const model: Model<Step, Snapshot, string> = {
  recipe: RECIPE,
  steps: STEPS,
  apply,
  label,
  snapshot,
  initial: "hidden",
  next: (shown, step) => ("send" in step ? step.send : shown),
  contextKey: (shown) => shown,
  violations: (before, after, step, was, now) =>
    violations(before, after, step, was, now),
  seen,
}

describe("lt-error-summary, every sequence of updates", () => {
  beforeAll(async () => {
    defineLtErrorSummary()
    core = accessibilityCore(await (await fetch(coreUrl)).arrayBuffer())
  })

  it("writes exactly the facts the core requires", async () => {
    mount(RECIPE)
    await settle()
    const written = new Set(
      [...renderedMarkup().matchAll(/\s(data-lt-ax-[a-z]+)=/g)].map(
        (m) => m[1],
      ),
    )
    // The state facts only appear where they hold.
    const always = core.facts.filter(
      (f) =>
        !/-(focused|checked|mixed|modal|disabled|value|selected|invalid)$/.test(
          f,
        ),
    )
    for (const fact of always) expect(written).toContain(fact)
    for (const fact of written) expect(core.facts).toContain(fact)
  })

  /*
   * A search over states, in every engine. In Chromium the search over
   * sequences below adds what this one merges: the component's memory.
   */
  it("keeps one named alert, the server's wiring and the user's focus, in every state to depth 3", async () => {
    const run = await exploreStates(model, 3)
    expect(run.found.slice(0, 10)).toEqual([])
    // The search found more states than one step gives.
    expect(run.states).toBeGreaterThan(STEPS.length)
    expect(unchecked(seen)).toEqual([])
  }, 600_000)

  /*
   * Every sequence, without merging states: the component's memory that is
   * not in the page (the name it wrote last) only shows on a path, and the
   * state search merges two paths that differ only there. Seen with the
   * mutation that drops the memory. In Chromium only, and only by the
   * morphers: `outerHTML` makes a new box, with no memory to carry.
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
