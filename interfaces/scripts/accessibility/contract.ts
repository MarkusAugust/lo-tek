/**
 * The shape of an accessibility contract: what a screen reader must be given,
 * step by step, when someone uses a component's recipe from its page.
 *
 * The contract is ours, so it is written by hand. It never copies what a
 * browser answers: the expected names, roles and states come from the
 * component's promise and from the specifications (AccName, Core-AAM,
 * HTML-AAM). Where a browser differs, that is decided as our bug, a known
 * deviation (`platform.ts`), or a misreading, and written down.
 */
import type { Engine, Politeness, Role, State } from "./platform"

/** A node as a screen reader is given it. */
export type Expected = {
  role: Role
  /** The accessible name, compared after trimming. */
  name: string
  /** The accessible description, when the step promises one. */
  description?: string
  /** States that must be there. */
  states?: State[]
  /** States that must not be there. */
  notStates?: State[]
}

/** What the test does, in order, with Playwright, as a keyboard user would. */
export type Action =
  | { focus: string }
  | { press: string }
  | { type: string }
  | { click: string }
  /** Moves the page's fake clock, for components that wait. */
  | { clock: number }
  /**
   * Lets real time pass, in milliseconds: a change the browser has to take
   * in before the next action, as a page does between loading and the
   * first outage.
   */
  | { pause: number }
  /** Runs an expression in the page, for imperative calls like `showToast`. */
  | { run: string }

export type Step = {
  /** Unique within the contract; named in every failure. */
  name: string
  do: Action[]
  /** The node that has focus once the page has settled. */
  focus?: Expected
  /** The nearest ancestor of the focused node with this role. */
  within?: Expected
  /** Text that must be inserted into a live region exactly once. */
  announce?: { politeness: Politeness; text: string }
  /** No text may be inserted into any live region during the step. */
  quiet?: true
  /**
   * Changes the browser must send as events for the focused node. When the
   * focus stays where it is, as on a field that turns invalid, the events are
   * the only thing that makes a screen reader say anything. Core-AAM: user
   * agents MUST notify assistive technology of state changes, and send
   * `object:property-change:accessible-description` when the description
   * changes.
   */
  changes?: { states?: State[]; description?: true }
}

/**
 * A change to the recipe that must break the contract, at the named step.
 * This is the mutation test, and it runs every time.
 */
export type Mutation = {
  name: string
  /** Text in the recipe, which must occur exactly once, and what replaces it. */
  replace: [string, string]
  /** The step that must fail. */
  failsAt: string
  /**
   * Where an engine cannot show what `failsAt` checks, the step the mutation
   * fails at there instead, with the reason in a comment.
   */
  failsAtIn?: Partial<Record<Engine, string>>
  /**
   * What `lotek check` says about the mutated recipe, without a browser.
   * `"without-name"`: it reports a name the markup no longer gives. A
   * mutation that leaves a name empty in the browsers must have it, or
   * `not` with the reason the markup cannot show it, such as a component
   * that is never registered. The runner holds both sides: `lotek check`
   * reports exactly the mutations that say so, and nothing on the recipe.
   */
  lotekCheck?: "without-name" | { not: string }
  /**
   * The engines the mutation runs in, when not all: a cause only one of them
   * shows, such as a name on a live region, which only Safari stays silent
   * about.
   */
  engines?: Engine[]
}

export type Contract = {
  /**
   * The component folder, "dialog", "field", and the page whose "Plain HTML"
   * tab is the recipe.
   */
  component: string
  /**
   * The pages for the CSS components have no "Plain HTML" tab: their markup
   * is the `code` of an `<Example>`. This is its place on the page, from 0,
   * and the stylesheets are the ones the example lists in `styles`.
   */
  example?: number
  /**
   * A variant of the recipe: changes made before the run, each text found
   * exactly once, for the cases a page does not show but a promise covers,
   * like the tab names computed from hidden text or an image's alt.
   */
  variant?: { name: string; replace: [string, string][] }
  /** Set up the fake clock before the page loads. */
  clock?: true
  /** The engines the contract runs in, when not all, with the reason in a comment. */
  engines?: Engine[]
  steps: Step[]
  mutations: Mutation[]
}

/** "tabs", or "tabs (image with alt)" for a variant. */
export const label = (contract: Contract) =>
  contract.variant
    ? `${contract.component} (${contract.variant.name})`
    : contract.component

/** The key a known deviation names its step by: "dialog:open". */
export const deviationAt = (contract: Contract, step: string) =>
  `${label(contract)}:${step}`
