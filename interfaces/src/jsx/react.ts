import type { HTMLAttributes, RefAttributes } from "react"

// The types of the events and tag names, so `querySelector("lt-dialog")` and
// `addEventListener` are typed also for someone who only imports this entry
// point. The file has no other import from the components, so without the
// line neither `HTMLElementEventMap` nor `HTMLElementTagNameMap` was extended.
export type { LtEventMap } from "../components/events.js"

/**
 * Types for the LO-TEK web components in JSX.
 *
 * Without them TypeScript does not know `<lt-field>` at all, and says
 * "Property 'lt-field' does not exist on type JSX.IntrinsicElements". And the
 * attributes are hyphenated strings without completion, so `described-by`
 * and `server-controlled` are exactly where a typo is easy to make and hard
 * to spot.
 *
 * Import once in the project, preferably from a `.d.ts` file so it does not
 * end up in the bundle:
 *
 * ```ts
 * // src/lotek.d.ts
 * import "@lo-tek/interfaces/react-jsx"
 * ```
 *
 * Astro does not need this: there `<lt-field>` is plain HTML, and no type
 * check looks at the element name.
 */

/**
 * Boolean attributes on web components.
 *
 * The type is `true | undefined`, not `boolean` and not `""`, and that is
 * deliberate. React treats web components differently between versions, and
 * only one pattern is right in both:
 *
 *     React 18 sets attributes          React 19 sets properties
 *     open=""          works             never open
 *     open={true}      works             works
 *     open={false}     ALWAYS open       works
 *     open={undefined} works             works
 *
 * React 18 stringifies to `open="false"`. The attribute then exists, and is
 * therefore true. React 19 sets the property to `""`, which is falsy, and
 * the setter in the component removes the attribute again.
 *
 * That is why the builder functions send `true` for a boolean attribute on a
 * host, not the empty string. `data-*` is different: React passes those on
 * as attributes in both versions, and there `""` is the canonical form.
 *
 * When you write it by hand, write `open={isOpen || undefined}`. The type
 * here makes the two other variants compile errors instead of something you
 * have to remember.
 */
type Flag = true | undefined

/**
 * The server decides the state in this element.
 *
 * The components set back what the user has done when a patch tears it away:
 * the selected tab, the open popover, the expanded suggestion list. With this
 * they do not, and each patch decides. Use it when the server should be able
 * to move the tab itself, as in "go on to step 2".
 */
type ServerControlled = {
  "server-controlled"?: Flag
}

/**
 * The base shape of a web component in JSX.
 *
 * `HTMLAttributes` alone has no `ref`. It is in `RefAttributes`, and without
 * it `<lt-toast ref={queue} />` was a type error, which is exactly the
 * pattern the documentation recommends for calling `.show()` and `.hide()`.
 * `key` comes the same way.
 */
type Host = HTMLAttributes<HTMLElement> & RefAttributes<HTMLElement>

type LtFieldAttributes = Host & {
  disabled?: Flag
  optional?: Flag
  "described-by"?: string
}

/**
 * `<lt-tabs>` has `server-controlled` and `activation`, and no `selected`.
 *
 * Which tab is selected is in the markup the server sent, as `aria-selected`
 * on the tab and `hidden` on the panels. The component reads it from there
 * instead of keeping a `selected` of its own, so the two can never disagree.
 */
type LtTabsAttributes = Host &
  ServerControlled & {
    /**
     * `manual`: the arrow keys only move focus, and Enter or Space selects.
     * Default: the arrow keys select straight away.
     */
    activation?: "manual" | "automatic"
  }

type LtErrorSummaryAttributes = Host & {
  /**
   * The box is hidden until there are errors to show.
   *
   * `HTMLAttributes` already has `hidden` as `boolean`, but on a web
   * component the rule for `open` applies: React 18 writes `hidden={false}`
   * as the attribute `hidden="false"`, and the box is then always hidden. So
   * the type is `Flag` here too, and `hidden={hasErrors ? undefined : true}`
   * is what compiles. `lt.errorSummary().host` sends it that way.
   */
  hidden?: Flag
  /**
   * Move focus here when the box appears. Default: on.
   * Set `"false"` to turn it off.
   */
  "data-autofocus"?: "false" | "true"
}

type LtSuggestionAttributes = Host & {
  /**
   * Someone else has already filtered, so the component should not.
   *
   * The component hides an option when its text does not contain what is in
   * the field. If you filter on something else, the two disagree, and then
   * your filter should win. A React app that renders only the matches of a
   * search that ignores diacritics is the most common case, alongside a
   * Datastar app where the server sends the list again.
   *
   * The number of matches is announced whoever did the filtering.
   */
  prefiltered?: Flag
  /** The announcement for zero matches, such as "No matches". */
  "count-none"?: string
  /** The announcement in the form `Intl.PluralRules` calls `zero`. `{n}` is the number. */
  "count-zero"?: string
  /** The announcement for one match, such as "{n} match". `{n}` is the number. */
  "count-one"?: string
  /** The announcement in the form `two`. `{n}` is the number. */
  "count-two"?: string
  /** The announcement in the form `few`. `{n}` is the number. */
  "count-few"?: string
  /** The announcement in the form `many`. `{n}` is the number. */
  "count-many"?: string
  /** The announcement for every other count, and the fallback. `{n}` is the number. */
  "count-other"?: string
} & ServerControlled

type LtDialogAttributes = Host &
  ServerControlled & {
    /** The dialog is open. The component calls `showModal()`. */
    open?: Flag
  }

type LtPopoverAttributes = Host &
  ServerControlled & {
    open?: Flag
    /** Which edge the panel hangs from. */
    placement?: "bottom-start" | "bottom-end" | "top-start" | "top-end"
  }

type LtTermAttributes = Host

type LtSessionTimeoutAttributes = Host & {
  /** Seconds without activity before the warning appears. */
  "warn-at"?: number | string
  /** Seconds without activity before the session expires. */
  "expires-at"?: number | string
  /** Seconds between each `session-activity` while the user is active. */
  "activity-interval"?: number | string
}

type LtConnectionStatusAttributes = Host & {
  /** The text when the connection is lost. */
  "offline-text"?: string
  /** The text when it comes back. */
  "online-text"?: string
}

type LtToastAttributes = Host & {
  /** Milliseconds before the messages disappear. */
  duration?: number
  /** Text that says what the region is. */
  label?: string
  /** The screen reader name of the close button in each message. */
  "close-label"?: string
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "lt-dialog": LtDialogAttributes
      "lt-error-summary": LtErrorSummaryAttributes
      "lt-field": LtFieldAttributes
      "lt-popover": LtPopoverAttributes
      "lt-suggestion": LtSuggestionAttributes
      "lt-tabs": LtTabsAttributes
      "lt-term": LtTermAttributes
      "lt-session-timeout": LtSessionTimeoutAttributes
      "lt-connection-status": LtConnectionStatusAttributes
      "lt-toast": LtToastAttributes
    }
  }
}

export type {
  LtConnectionStatusAttributes,
  LtDialogAttributes,
  LtErrorSummaryAttributes,
  LtFieldAttributes,
  LtPopoverAttributes,
  LtSessionTimeoutAttributes,
  LtSuggestionAttributes,
  LtTabsAttributes,
  LtTermAttributes,
  LtToastAttributes,
}
