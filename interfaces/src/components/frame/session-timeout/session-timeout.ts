import { attributes, idOrFallback } from "../../css/shared.js"

export const SESSION_TIMEOUT_CLASS = "lt-session-timeout" as const
export const SESSION_TIMEOUT_DIALOG_CLASS =
  "lt-session-timeout__dialog" as const
export const SESSION_TIMEOUT_TITLE_CLASS = "lt-session-timeout__title" as const
export const SESSION_TIMEOUT_TEXT_CLASS = "lt-session-timeout__text" as const
export const SESSION_TIMEOUT_COUNT_CLASS = "lt-session-timeout__count" as const
export const SESSION_TIMEOUT_ACTIONS_CLASS =
  "lt-session-timeout__actions" as const

/** `value` on the button that extends the session. */
export const SESSION_EXTEND = "extend" as const
/** `value` on the button that logs out. */
export const SESSION_LOGOUT = "logout" as const

export type SessionTimeoutOptions = {
  /** Id of the heading. The dialog takes its name from it with `aria-labelledby`. */
  titleId: string
  /** Seconds without activity before the warning appears. Default: 25 minutes. */
  warnAt?: number
  /** Seconds without activity before the session expires. Default: 30 minutes. */
  expiresAt?: number
  /** Seconds between each `session-activity` while the user is active. Default: 60. */
  activityInterval?: number
}

export type SessionTimeoutAttributes = {
  host: {
    class: typeof SESSION_TIMEOUT_CLASS
    "warn-at"?: string
    "expires-at"?: string
    "activity-interval"?: string
    "data-ignore-morph": ""
  }
  dialog: {
    class: typeof SESSION_TIMEOUT_DIALOG_CLASS
    role: "alertdialog"
    "aria-labelledby": string
  }
  title: { class: typeof SESSION_TIMEOUT_TITLE_CLASS; id: string }
  /** The paragraph holding the number. The announcement is this paragraph, with the number spoken. */
  text: { class: typeof SESSION_TIMEOUT_TEXT_CLASS }
  /** The number. Empty in the markup, and the component fills it in. */
  count: { class: typeof SESSION_TIMEOUT_COUNT_CLASS; "aria-hidden": "true" }
  /** The screen reader announcement. Empty in the markup. */
  live: { class: "lt-sr-only"; role: "status" }
  /** The form around the buttons. `method="dialog"` closes the dialog without a script. */
  actions: { class: typeof SESSION_TIMEOUT_ACTIONS_CLASS; method: "dialog" }
  extend: { class: "lt-button"; value: typeof SESSION_EXTEND }
  logout: {
    class: "lt-button"
    "data-variant": "secondary"
    value: typeof SESSION_LOGOUT
  }
}

/**
 * The attributes for the warning that a signed-in session is about to expire.
 *
 * The renderer writes the dialog and all of the text, in its own language and
 * with its own translation tool. The component only keeps time: it opens and
 * closes the dialog, fills in the number and announces the countdown.
 *
 * The buttons are plain buttons in a `<form method="dialog">`. The browser
 * closes the dialog and sets `returnValue` to the button's `value`, and the
 * component reads it. `data-ignore-morph` asks Datastar's morph to leave the
 * warning alone. Without it the morph takes `open` and the number while the
 * dialog is in the top layer. The component puts `open` back, and the number
 * comes back on the next tick. With the attribute the number stays the whole
 * time.
 *
 * ```ts
 * const session = lt.sessionTimeout({ titleId: "session-title" })
 * ```
 * ```html
 * <lt-session-timeout {...session.host}>
 *   <dialog {...session.dialog}>
 *     <h2 {...session.title}>Your session is ending</h2>
 *     <p {...session.text}>
 *       Your session on the Lattice ends in <span {...session.count}></span>. Unsaved routes will be lost.
 *     </p>
 *     <span {...session.live}></span>
 *     <form {...session.actions}>
 *       <button {...session.extend}>Stay connected</button>
 *       <button {...session.logout}>Log out</button>
 *     </form>
 *   </dialog>
 * </lt-session-timeout>
 * ```
 */
export const sessionTimeout = Object.assign(
  ({
    titleId: givenId,
    warnAt = 25 * 60,
    expiresAt = 30 * 60,
    activityInterval = 60,
  }: SessionTimeoutOptions): SessionTimeoutAttributes => {
    // The fallback only matters to someone without a type check.
    const titleId = idOrFallback("lt.sessionTimeout()", givenId, "titleId")

    return {
      host: attributes({
        class: SESSION_TIMEOUT_CLASS,
        "warn-at": warnAt === 25 * 60 ? undefined : String(warnAt),
        "expires-at": expiresAt === 30 * 60 ? undefined : String(expiresAt),
        "activity-interval":
          activityInterval === 60 ? undefined : String(activityInterval),
        "data-ignore-morph": "" as const,
      }),
      dialog: attributes({
        class: SESSION_TIMEOUT_DIALOG_CLASS,
        // alertdialog and not dialog: the warning is an interruption the user did
        // not ask for, and then the screen reader should read all of the content
        // when it opens.
        role: "alertdialog" as const,
        "aria-labelledby": titleId,
      }),
      title: attributes({ class: SESSION_TIMEOUT_TITLE_CLASS, id: titleId }),
      text: attributes({ class: SESSION_TIMEOUT_TEXT_CLASS }),
      count: attributes({
        class: SESSION_TIMEOUT_COUNT_CLASS,
        "aria-hidden": "true" as const,
      }),
      live: attributes({
        class: "lt-sr-only" as const,
        role: "status" as const,
      }),
      actions: attributes({
        class: SESSION_TIMEOUT_ACTIONS_CLASS,
        method: "dialog" as const,
      }),
      extend: attributes({
        class: "lt-button" as const,
        value: SESSION_EXTEND,
      }),
      logout: attributes({
        class: "lt-button" as const,
        "data-variant": "secondary" as const,
        value: SESSION_LOGOUT,
      }),
    }
  },
  {
    /** The class on the `<dialog>` itself. */
    dialog: SESSION_TIMEOUT_DIALOG_CLASS,
    /** The class on the heading. */
    title: SESSION_TIMEOUT_TITLE_CLASS,
    /** The class on the paragraph holding the number. */
    text: SESSION_TIMEOUT_TEXT_CLASS,
    /** The class on the number the component fills in. */
    count: SESSION_TIMEOUT_COUNT_CLASS,
    /** The class on the form with the buttons. */
    actions: SESSION_TIMEOUT_ACTIONS_CLASS,
  },
)
