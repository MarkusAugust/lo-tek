import { attributes } from "../../css/shared.js"

/**
 * The class on the host, that is, the region the messages are in.
 *
 * Until 0.28.0 this was the class on each message, and the region was styled
 * by its element name. Registered under another name, with
 * `defineLtToast("my-toast")`, it then lost its position.
 */
export const TOAST_CLASS = "lt-toast" as const
export const TOAST_MESSAGE_CLASS = "lt-toast__message" as const
export const TOAST_CLOSE_CLASS = "lt-toast__close" as const

export type ToastOptions = {
  /**
   * The screen reader name of the close button in each message. Default:
   * "Close message". `closeLabel` in `show()` overrides it for one message.
   */
  closeLabel?: string
}

export type ToastAttributes = {
  host: {
    class: typeof TOAST_CLASS
    role: "status"
    "aria-live": "polite"
    "aria-atomic": "false"
    "close-label"?: string
    "data-ignore-morph": ""
  }
  message: { class: typeof TOAST_MESSAGE_CLASS }
  close: { class: typeof TOAST_CLOSE_CLASS }
}

/**
 * The attributes for the toast region.
 *
 * The region is `role="status"` and not `role="alert"`. A message that comes
 * because something went well should not interrupt what the screen reader is
 * doing.
 *
 * The region has no name. Safari announces nothing put into a live region
 * with an accessible name, whether it comes from `aria-label`,
 * `aria-labelledby` or `title`, and a named region left VoiceOver silent
 * about every message (Safari 27.2, 2026-11-16, measured with
 * `check-accessibility-safari.ts` and by ear; not found documented).
 * WAI-ARIA does not require a name for `status`, and the name is never
 * spoken with a message.
 *
 * `data-ignore-morph` is not optional. `<lt-toast>` creates and removes its
 * message elements inside the region, and without the attribute the Datastar
 * morph tears them away at the next patch, because the server's version of
 * the region is empty. The attribute must be in the HTML the server sends:
 * the component cannot set it on itself, since the morph reads it from the
 * server's node.
 */
export const toast = ({ closeLabel }: ToastOptions = {}): ToastAttributes => ({
  host: attributes({
    class: TOAST_CLASS,
    role: "status" as const,
    "aria-live": "polite" as const,
    // `status` is atomic by default, and then the whole stack is announced
    // again for every message that is added.
    "aria-atomic": "false" as const,
    "close-label": closeLabel,
    "data-ignore-morph": "" as const,
  }),
  message: attributes({ class: TOAST_MESSAGE_CLASS }),
  close: attributes({ class: TOAST_CLOSE_CLASS }),
})
