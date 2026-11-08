import { managedNames, rememberManaged } from "./components/css/shared.js"
import { createFieldId } from "./components/frame/field/field-core.js"
import {
  type TabsWithStateOptions,
  tabsWithState,
} from "./components/frame/tabs/tabs.js"
import { termWithState } from "./components/frame/term/term.js"
import { type Attributes, setAttributes as setHtmlAttributes } from "./dom.js"
import { lt as html, type Lt } from "./lt.js"

// The types of the events, so `addEventListener` is typed also for someone
// who only imports this entry point. Without the line the import disappeared
// from the `.d.ts` file, and `HTMLElementEventMap` was never extended.
export type { LtEventMap } from "./components/events.js"

/**
 * The same API as `lt`, but with `className` and `htmlFor`.
 *
 * The rest of the system returns `class` and `for`, as the attributes are
 * actually named in HTML. React accepts them, and they end up correctly in
 * the DOM, but the development build writes "Invalid DOM property `class`.
 * Did you mean `className`?" to the console, once for each attribute name. It
 * is noise in every app that uses the components, and it teaches the reader
 * to ignore the console.
 *
 * ```ts
 * import { lt } from "@lo-tek/interfaces/react"
 *
 * <button {...lt.button({ variant: "secondary" })}>Save draft</button>
 * ```
 *
 * The call sites are identical to the rest of the system; only the import
 * path differs. This is a plain renaming of keys, so the package gets no
 * dependency on React from it.
 *
 * Astro and plain HTML take `class` and `for` as they are. There you use
 * `@lo-tek/interfaces` directly.
 */

/**
 * Gives the keys the names React expects, and the values the types React
 * expects.
 *
 * `tabindex` is not only a different name: in HTML the value is a string, and
 * in React `tabIndex` is a number. When we left the string, `lt.tabs()` came
 * out with `tabIndex: "0"`, and TypeScript rejected it in every React app. It
 * worked in the browser, since React converts the value itself, so the bug
 * only showed up as a type error for the consumer.
 */
export type ReactAttributes<T> = {
  [K in keyof T as K extends "class"
    ? "className"
    : K extends "for"
      ? "htmlFor"
      : K extends "tabindex"
        ? "tabIndex"
        : K extends "autocomplete"
          ? "autoComplete"
          : K]: K extends "tabindex" ? number : T[K]
}

/**
 * The attributes that have another name in React.
 *
 * `tabindex` came with the compound builder functions, and `autocomplete`
 * with the suggestion field. Without the renaming React warns about every
 * one of them.
 *
 * `aria-*` and `data-*`, on the other hand, stay as they are. React passes
 * them on unchanged, and renaming them would give invalid attributes.
 *
 * `react.browser.test.ts` calls every builder function here with every
 * allowed value it declares, collects all attribute names in the result,
 * including those in lists and nested levels, and rejects every name React
 * spells differently. The list there is React's and is longer than the four
 * we rename, so a builder function that one day outputs `readonly` or
 * `maxlength` stops there and not in a consumer's console.
 */
const REACT_NAMES: Record<string, string> = {
  class: "className",
  for: "htmlFor",
  tabindex: "tabIndex",
  autocomplete: "autoComplete",
}

export function toReactAttributes<T extends Record<string, unknown>>(
  attributes: T,
): ReactAttributes<T> {
  const result: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(attributes)) {
    // `tabindex` is a string in HTML and a number in React. Everything else
    // passes straight through: it is the names that differ, not the values.
    result[REACT_NAMES[name] ?? name] =
      name === "tabindex" ? Number(value) : value
  }
  // The new object manages the same as the old one, under the new names, so
  // `setAttributes` below can clean up as much as the main entry point.
  const names = managedNames(attributes)
  if (names)
    rememberManaged(
      result,
      names.map((name) => REACT_NAMES[name] ?? name),
    )
  return result as ReactAttributes<T>
}

/** The names back to HTML, for `setAttributes`. */
const HTML_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(REACT_NAMES).map(([html, react]) => [react, html]),
)

/**
 * A set as the builder functions here return it, with `className`,
 * `htmlFor` and `tabIndex` as a number.
 */
export type ReactSet = Record<string, string | number | boolean | undefined>

/**
 * Writes a set from this entry point back to the HTML names.
 *
 * `setAttribute` writes the name as given, and in an HTML document it becomes
 * lower case: `className` became the attribute `classname`, and `htmlFor`
 * became `htmlfor`. The new object manages the same as the set it came from,
 * so what is gone in the next call is cleaned up.
 */
function toHtmlAttributes(set: ReactSet): Attributes {
  const result: Attributes = {}
  for (const [name, value] of Object.entries(set)) {
    result[HTML_NAMES[name] ?? name] =
      typeof value === "number" ? String(value) : value
  }
  const names = managedNames(set)
  if (names)
    rememberManaged(
      result,
      names.map((name) => HTML_NAMES[name] ?? name),
    )
  return result
}

/**
 * Like `lt.setAttributes` in the main entry point, for the sets from here.
 *
 * A React app reaches the DOM through a `ref`, and then naturally uses `lt`
 * from this entry point. Passed straight to the main entry point's
 * `setAttributes`, `className` became the attribute `classname`, and the
 * cleanup did not find the builder function behind the set. Here the names
 * are translated back first.
 */
export function setAttributes(
  element: Element | null | undefined,
  ...sets: ReactSet[]
): void {
  setHtmlAttributes(element, ...sets.map((set) => toHtmlAttributes(set)))
}

/**
 * A builder function's result with the React names: every attribute set in
 * it, in an object or a list as deep as it goes. A set is an object whose
 * values are all plain values; anything else is gone through.
 */
export type ReactResult<R> = R extends readonly (infer Item)[]
  ? ReactResult<Item>[]
  : R extends object
    ? R[keyof R] extends string | number | boolean | null | undefined
      ? ReactAttributes<R>
      : { [K in keyof R]: ReactResult<R[K]> }
    : R

/**
 * The result with the React names. A set is recognised by what
 * `attributes()` notes on every set a builder function makes, not by its
 * shape, so a compound whose parts are all absent is not taken for one.
 */
function toReactResult(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toReactResult)
  if (!value || typeof value !== "object") return value
  if (managedNames(value))
    return toReactAttributes(value as Record<string, unknown>)
  return Object.fromEntries(
    Object.entries(value).map(([name, child]) => [name, toReactResult(child)]),
  )
}

/**
 * Wraps a builder function so the result gets the React names, and keeps
 * what hangs on the function: `variants`, `isVariant` and the others.
 */
function forReact<F extends (...args: never[]) => unknown>(
  fn: F,
): ForReactFn<F> {
  const wrapped = (...args: Parameters<F>) => toReactResult(fn(...args))
  return Object.assign(wrapped, fn) as unknown as ForReactFn<F>
}

/**
 * The type of a member of `lt` in `/react`. A guard, which answers
 * `value is T`, is the same function: no builder function answers a
 * boolean, and at run time `isGuard` tells it by its name. A builder function
 * takes the same options, named `options` as in the editor, and gives the
 * React result.
 */
type ForReactFn<F> = F extends (...args: never[]) => boolean
  ? F
  : F extends (...args: never[]) => infer R
    ? Parameters<F> extends []
      ? (() => ReactResult<R>) & { [K in keyof F]: F[K] }
      : ForReactOptions<F>
    : F

type ForReactOptions<F> = F extends (options?: infer O) => infer R
  ? ((options?: O) => ReactResult<R>) & { [K in keyof F]: F[K] }
  : F extends (options: infer O) => infer R
    ? ((options: O) => ReactResult<R>) & { [K in keyof F]: F[K] }
    : F

/**
 * A guard on `lt`, such as `isState`: it builds nothing, and passes through
 * as the same function. Named `is` and a capital letter, as every guard in
 * the package is.
 */
const isGuard = (name: string) => /^is[A-Z]/.test(name)

/**
 * What stands by hand in `lt` below: the two that give the whole state, and
 * `setAttributes`, which takes an element and builds nothing.
 */
const BY_HAND = ["tabs", "term", "setAttributes"] as const
type ByHand = (typeof BY_HAND)[number]

/**
 * Every member of `lt` but those by hand, with the React names. Mapped over
 * `keyof Lt`, and named on `lt` below, so the declaration file refers to it
 * and the documentation on each member in `lt.ts` comes along to the
 * consumer's editor.
 */
type ForReact = {
  [K in keyof Lt as K extends ByHand ? never : K]: ForReactFn<Lt[K]>
}

function everyBuilder(): ForReact {
  const result: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(html))
    if (!(BY_HAND as readonly string[]).includes(name))
      result[name] =
        typeof value === "function" && !isGuard(name)
          ? forReact(value as (...args: never[]) => unknown)
          : value
  return result as ForReact
}

/**
 * Re-exported from the main entry point.
 *
 * `field.mdx` points to it in a section that tells the reader to import from
 * `@lo-tek/interfaces/react`, and without this a React consumer who follows
 * the advice gets "createFieldId is not exported". It is safe only when the
 * markup is rendered once; in a React component `useId()` is the answer,
 * also in an app without a server.
 */
export { createFieldId }

/** The type of `lt` in `/react`. */
export type ReactLt = ForReact & {
  /**
   * The whole state, not just the links: React reports a mismatch for every
   * attribute the component writes on an element React has rendered. See
   * `tabsWithState`.
   */
  readonly tabs: (
    options: TabsWithStateOptions,
  ) => ReactResult<ReturnType<typeof tabsWithState>>
  /**
   * With `aria-expanded`, which `<lt-term>` writes: React reports a mismatch
   * for an attribute it did not render. See `termWithState`.
   */
  readonly term: (
    options: Parameters<typeof termWithState>[0],
  ) => ReactResult<ReturnType<typeof termWithState>>
  /** Like `lt.setAttributes` in the main entry, for the sets from here. */
  readonly setAttributes: typeof setAttributes
}

/**
 * Every builder function from the main entry, with the React names. A new
 * component comes along by itself; only the exceptions stand here.
 */
export const lt: ReactLt = {
  ...everyBuilder(),

  /**
   * The whole state, not just the links: React reports a mismatch for every
   * attribute the component writes on an element React has rendered. See
   * `tabsWithState`.
   */
  tabs: (options: TabsWithStateOptions) =>
    toReactResult(tabsWithState(options)) as ReactResult<
      ReturnType<typeof tabsWithState>
    >,

  /**
   * With `aria-expanded`, which `<lt-term>` writes: React reports a mismatch
   * for an attribute it did not render. See `termWithState`.
   */
  term: (options: Parameters<typeof termWithState>[0]) =>
    toReactResult(termWithState(options)) as ReactResult<
      ReturnType<typeof termWithState>
    >,

  setAttributes,
}
