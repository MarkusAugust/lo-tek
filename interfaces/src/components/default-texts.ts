/**
 * Every text the package itself writes into the page when nobody has given
 * it another one.
 *
 * LO-TEK has almost no text: the renderer writes the text, in its own
 * language. What is left here are the defaults for text a component creates
 * itself, and each of them can be replaced. How is noted next to each one,
 * and the same is in the table on the documentation page about translation.
 *
 * The texts live here and not in the components, so there is one place to
 * read them. `scripts/check-texts.ts` fails the build on a user-facing text
 * that is in a component and not here, and requires each of them to be in
 * the table on the translation page.
 *
 * The texts in CSS, such as " (required)", cannot import anything. They are
 * read from an `--lt-` variable with the text as the fallback, and
 * `check-texts.ts` requires that.
 */
/**
 * The language the texts are in. `lotek check` warns about a component that
 * shows one of them on a page in another language, without the attribute or
 * CSS variable that replaces it.
 */
export const DEFAULT_LANGUAGE = "en"

export const DEFAULT_TEXTS = {
  /** The close button in each message. Replaced with `close-label`. */
  toastClose: "Close message",
  /** `<lt-connection-status>` when the connection is lost. Replaced with `offline-text`. */
  connectionOffline: "No connection. What you type is not being saved.",
  /** `<lt-connection-status>` when it comes back. Replaced with `online-text`. */
  connectionOnline: "Connection restored.",
  /** The match count in `<lt-suggestion>` with no matches. Replaced with `count-none`. */
  suggestionNone: "No matches",
  /** The match count with one match. Replaced with `count-one`. */
  suggestionOne: "One match",
  /** The match count otherwise. `{n}` is the number. Replaced with `count-other`. */
  suggestionOther: "{n} matches",
} as const
