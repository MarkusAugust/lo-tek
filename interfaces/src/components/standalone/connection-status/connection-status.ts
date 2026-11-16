import { attributes } from "../../css/shared.js"

export const CONNECTION_STATUS_CLASS = "lt-connection-status" as const
export const CONNECTION_STATUS_BAR_CLASS = "lt-connection-status__bar" as const

export type ConnectionStatusOptions = {
  /** The text when the connection is lost. */
  offlineText?: string
  /** The text when it comes back. Shown for a short while. */
  onlineText?: string
}

export type ConnectionStatusAttributes = {
  class: typeof CONNECTION_STATUS_CLASS
  role: "status"
  "aria-live": "polite"
  "offline-text"?: string
  "online-text"?: string
  "data-ignore-morph": ""
}

/**
 * The attributes for the bar that says the connection is lost.
 *
 * By definition the server cannot tell you it is unreachable. When it is
 * down, nothing comes from it to render. So the component creates all the
 * content itself, and `data-ignore-morph` stops a later patch from tearing
 * it away the moment the connection is back. The host is the live region,
 * `role="status"` with `aria-live="polite"`, so the region exists before the
 * bar and its text arrive. It has to be in the markup: Safari ignores a role
 * set on an element that is already on the page.
 *
 * ```ts
 * <lt-connection-status {...lt.connectionStatus()} />
 * ```
 */
export const connectionStatus = ({
  offlineText,
  onlineText,
}: ConnectionStatusOptions = {}): ConnectionStatusAttributes =>
  attributes({
    class: CONNECTION_STATUS_CLASS,
    role: "status" as const,
    "aria-live": "polite" as const,
    "offline-text": offlineText,
    "online-text": onlineText,
    "data-ignore-morph": "" as const,
  })
