import { attributes, createGuard, idOrFallback } from "../../css/shared.js"

export const DIALOG_CLASS = "lt-dialog" as const
export const DIALOG_HEADER_CLASS = "lt-dialog__header" as const
export const DIALOG_TITLE_CLASS = "lt-dialog__title" as const
export const DIALOG_SUBTITLE_CLASS = "lt-dialog__subtitle" as const
export const DIALOG_BODY_CLASS = "lt-dialog__body" as const
export const DIALOG_FOOTER_CLASS = "lt-dialog__footer" as const

/**
 * The colour of the header, and what it means.
 *
 * `neutral` is the default and gives no colour. The four status colours are
 * the same ones the alert uses, and `brand` is the brand colour, for a header
 * that says who is speaking rather than how it went.
 */
export const dialogColors = [
  "neutral",
  "brand",
  "info",
  "success",
  "warning",
  "danger",
] as const
export type DialogColor = (typeof dialogColors)[number]

export type DialogOptions = {
  /** Id of the heading. The dialog takes its name from it with `aria-labelledby`. */
  titleId: string
  /**
   * The dialog is open. Default: closed.
   *
   * This is the server telling `<lt-dialog>` to show it. If you control the
   * dialog from the browser yourself, with `showModal()`, leave it out: the
   * call throws `InvalidStateError` on a dialog that is already open.
   */
  open?: boolean
  /**
   * Colour of the header. Default: none.
   *
   * The colour applies to `header`, so the header must be in the markup for
   * it to show: `<div {...box.header}>` around the heading. Without a header
   * there is nothing to colour.
   */
  color?: DialogColor
}

export type DialogAttributes = {
  host: {
    open?: true
  }
  dialog: {
    class: typeof DIALOG_CLASS
    "aria-labelledby": string
    open?: true
    "data-color"?: Exclude<DialogColor, "neutral">
  }
  /** The header, holding the heading and an optional subtitle. Optional. */
  header: { class: typeof DIALOG_HEADER_CLASS }
  title: {
    class: typeof DIALOG_TITLE_CLASS
    id: string
  }
  /** A line below the heading, inside the header. Optional. */
  subtitle: { class: typeof DIALOG_SUBTITLE_CLASS }
  body: { class: typeof DIALOG_BODY_CLASS }
  footer: { class: typeof DIALOG_FOOTER_CLASS }
}

/**
 * The attributes for a dialog.
 *
 * Opening a dialog is a call, not an attribute: only `showModal()` moves
 * focus in, keeps focus inside the dialog, closes on Escape and makes the
 * rest of the page inert. A `<dialog open>` in the markup is a box on the page.
 *
 * That is a problem for a server that only sends HTML, since it cannot call
 * anything in the browser. So the server says the dialog is open, and
 * `<lt-dialog>` makes the call.
 *
 * The two `open`s are not the same, and it is worth keeping them apart:
 *
 * - `open` on the **host** is the server saying the dialog should be shown.
 *   It is not preserved. If it were, the server could never open the dialog
 *   again after the user had closed it once. If the server sends the region
 *   again with `open` still set, the dialog opens again. For a dismissal to
 *   last, the app must tell the server.
 * - `open` on the **`<dialog>`** is set by the browser itself when
 *   `showModal()` is called. It is not in the server's HTML, so a morph
 *   removes it, and the component puts it back. The server also writes it
 *   when it knows the dialog should be shown: without JavaScript a `<dialog>`
 *   without `open` is hidden, and its content does not exist for the reader.
 *   With the attribute it stands as a box on the page until the component
 *   turns it into a modal.
 *
 * ```ts
 * const box = lt.dialog({ titleId: "cancel-title", open: true })
 * ```
 * ```html
 * <lt-dialog {...box.host}>
 *   <dialog {...box.dialog}>
 *     <h2 {...box.title}>Cancel job 222-0481?</h2>
 *     <div {...box.body}>The crew keeps the advance. This cannot be undone.</div>
 *     <form method="dialog" {...box.footer}>
 *       <button class="lt-button" value="keep">Keep the job</button>
 *     </form>
 *   </dialog>
 * </lt-dialog>
 * ```
 */
export const dialog = Object.assign(
  ({
    titleId: givenId,
    open = false,
    color = "neutral",
  }: DialogOptions): DialogAttributes => {
    // The fallback only matters to someone without a type check.
    const titleId = idOrFallback("lt.dialog()", givenId, "titleId")

    return {
      host: attributes({
        open: open ? (true as const) : undefined,
      }),
      dialog: attributes({
        class: DIALOG_CLASS,
        "aria-labelledby": titleId,
        /*
         * `open` is in both places when the dialog should be shown, on
         * purpose.
         *
         * Without JavaScript a `<dialog>` without `open` is hidden, so the
         * content the server wanted to show did not exist for the reader. With
         * `open` it stands there as a box on the page, and the component turns
         * it into a real modal with `showModal()` once it gets to run.
         *
         * In React it is also the only thing that matches: the component sets
         * `open` on the `<dialog>` before React hydrates, and when it was not in
         * the server's HTML, React reported a mismatch on every single page load.
         */
        open: open ? (true as const) : undefined,
        "data-color": color === "neutral" ? undefined : color,
      }),
      header: attributes({ class: DIALOG_HEADER_CLASS }),
      title: attributes({ class: DIALOG_TITLE_CLASS, id: titleId }),
      subtitle: attributes({ class: DIALOG_SUBTITLE_CLASS }),
      body: attributes({ class: DIALOG_BODY_CLASS }),
      footer: attributes({ class: DIALOG_FOOTER_CLASS }),
    }
  },
  {
    /** The class on the `<dialog>` itself. */
    dialog: DIALOG_CLASS,
    /** The class on the header, which `color` can colour. */
    header: DIALOG_HEADER_CLASS,
    /** The class on the heading in the dialog. */
    title: DIALOG_TITLE_CLASS,
    /** The class on the subtitle in the header. */
    subtitle: DIALOG_SUBTITLE_CLASS,
    /** The class on the content, which scrolls when the dialog gets too tall. */
    body: DIALOG_BODY_CLASS,
    /** The class on the row of buttons at the bottom. */
    footer: DIALOG_FOOTER_CLASS,
    colors: dialogColors,
    isColor: createGuard(dialogColors),
  },
)
