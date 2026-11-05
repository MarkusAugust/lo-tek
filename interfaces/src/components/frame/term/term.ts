import { attributes } from "../../css/shared.js"

export const TERM_CLASS = "lt-term" as const
export const TERM_ENTRY_CLASS = "lt-term__entry" as const

export type TermOptions = {
  /**
   * Id of the entry in the glossary: the `<div>` around the `<dt>` and
   * `<dd>`. The word links to it, and the web component shows the entry
   * itself as the card. Make it from the term, such as `term-signal`, so it
   * is the same on every render.
   */
  id: string
}

export type TermAttributes = {
  word: {
    class: typeof TERM_CLASS
    href: string
    "aria-details": string
  }
  entry: {
    class: typeof TERM_ENTRY_CLASS
    id: string
  }
}

/**
 * The attributes for a word in the text that is explained in a glossary on
 * the same page.
 *
 * Only what holds without JavaScript: the word is a link to the entry, and
 * `aria-details` says the entry explains it. `<lt-term>` around the link
 * opens the entry as a card by the word, and writes `aria-expanded`.
 *
 * ```ts
 * const signal = lt.term({ id: "term-signal" })
 * ```
 * ```html
 * <p>Datastar keeps <lt-term><a {...signal.word}>signals</a></lt-term> in the browser.</p>
 * <dl>
 *   <div {...signal.entry}><dt>Signal</dt><dd>A value Datastar keeps in the browser.</dd></div>
 * </dl>
 * ```
 */
export function term({ id }: TermOptions): TermAttributes {
  // A made-up id would point at nothing: the entry is in the glossary, and
  // only the template knows its id.
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error(
      "lt.term(): id is required. It is the id of the entry in the glossary, " +
        'such as "term-signal".',
    )
  }
  return {
    word: attributes({
      class: TERM_CLASS,
      href: `#${id}`,
      "aria-details": id,
    }),
    entry: attributes({
      class: TERM_ENTRY_CLASS,
      id,
    }),
  }
}

/**
 * `lt.term()` with the state `<lt-term>` writes, for `/react`.
 *
 * React reports a mismatch for every attribute a web component writes on an
 * element React has rendered. `aria-expanded="false"` is there from the
 * start, so the web component has nothing to write before React hydrates.
 */
export function termWithState(options: TermOptions): {
  word: TermAttributes["word"] & { "aria-expanded": "false" }
  entry: TermAttributes["entry"]
} {
  const built = term(options)
  return {
    word: attributes(
      { ...built.word, "aria-expanded": "false" as const },
      built.word,
    ),
    entry: built.entry,
  }
}
