import { attributes } from "../../css/shared.js"

export const ERROR_SUMMARY_CLASS = "lt-error-summary" as const
export const ERROR_SUMMARY_TITLE_CLASS = "lt-error-summary__title" as const

export type ErrorSummaryOptions = {
  /** The number of errors the server found. When it is zero, the box is hidden. */
  count?: number
  /** The id of the box, so the form can move focus here after submission. */
  id?: string
  /**
   * The id of the heading. The box takes its name from it with
   * `aria-labelledby`. Default: the box's `id` with `-title`, so the markup
   * carries the wiring whenever the box has an id. An empty one counts as
   * none; one with whitespace throws.
   */
  titleId?: string
}

export type ErrorSummaryAttributes = {
  host: {
    class: typeof ERROR_SUMMARY_CLASS
    role: "alert"
    tabindex: "-1"
    id?: string
    hidden?: true
    "aria-labelledby"?: string
  }
  title: {
    class: typeof ERROR_SUMMARY_TITLE_CLASS
    id?: string
  }
}

/**
 * The attributes for an error summary.
 *
 * The server writes the whole box, including the heading and the list.
 * `<lt-error-summary>` only moves focus and handles clicks on the links. The
 * component used to create the heading itself, and then it disappeared on
 * every morph in Datastar.
 *
 * ```ts
 * const summary = lt.errorSummary({
 *   count: errors.length,
 *   id: "errors",
 *   titleId: "errors-title",
 * })
 * ```
 * ```html
 * <lt-error-summary {...summary.host}>
 *   <h2 {...summary.title}>You need to fix 2 errors</h2>
 *   <ul><li><a href="#fixer">The fixer's address is missing an @</a></li></ul>
 * </lt-error-summary>
 * ```
 */
export const errorSummary = ({
  count = 0,
  id,
  titleId: givenTitleId,
}: ErrorSummaryOptions = {}): ErrorSummaryAttributes => {
  /*
   * The heading's id is written here, by whoever renders, never by the web
   * component: Datastar and idiomorph replace an element whose id the server
   * did not send, so an id from the component gave the heading a new one on
   * every patch. An empty one names nothing.
   */
  const titleId = givenTitleId?.trim()
    ? givenTitleId
    : id?.trim()
      ? `${id}-title`
      : undefined
  // `aria-labelledby` splits on whitespace, so the box would point at two
  // ids, neither of them the heading's.
  if (titleId !== undefined && /\s/.test(titleId))
    throw new Error(
      `lt.errorSummary(): the titleId "${titleId}" contains whitespace. aria-labelledby splits on whitespace, so the box would point at ids that are not the heading's.`,
    )
  return {
    host: attributes({
      class: ERROR_SUMMARY_CLASS,
      role: "alert" as const,
      tabindex: "-1" as const,
      id,
      hidden: count === 0 ? (true as const) : undefined,
      "aria-labelledby": titleId,
    }),
    title: attributes({ class: ERROR_SUMMARY_TITLE_CLASS, id: titleId }),
  }
}
