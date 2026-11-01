import { defineElement, HostElement, whenUpgraded } from "../../host-element.js"
import {
  CONNECTION_STATUS_BAR_CLASS,
  CONNECTION_STATUS_CLASS,
} from "./connection-status.js"

export const LT_CONNECTION_STATUS_TAG = "lt-connection-status" as const

import { DEFAULT_TEXTS } from "../../default-texts.js"

const DEFAULT_OFFLINE = DEFAULT_TEXTS.connectionOffline
const DEFAULT_ONLINE = DEFAULT_TEXTS.connectionOnline

/** How long "back online" stays visible. */
const RECEIPT_MS = 4000

/**
 * Tells the user when the connection to the server is lost.
 *
 * By definition the server cannot tell you this. When it is unreachable,
 * nothing comes from it. So this is a standalone component that creates all
 * of its content itself.
 *
 * It is not decoration in an app that fetches content from the server as it
 * goes. A page that loses its stream looks perfectly normal but is frozen,
 * and a user filling in a form over a dead connection loses everything.
 *
 * `navigator.onLine` only says whether the machine has a network, not whether
 * the server answers. That is why `reportFailure()` and `reportSuccess()`
 * exist: the app calls them when a request fails or succeeds.
 *
 * ```ts
 * const status = document.querySelector("lt-connection-status")
 * try {
 *   const response = await fetch("/api/routes", { method: "POST", body })
 *   if (!response.ok) throw new Error(response.statusText)
 *   status.reportSuccess()
 * } catch {
 *   status.reportFailure()
 * }
 * ```
 */
export class LtConnectionStatus extends HostElement {
  static observedAttributes = ["offline-text", "online-text"] as const

  private bar?: HTMLElement
  private timer?: number
  /** True when the app has reported a failed request, regardless of navigator. */
  private failing = false

  get offlineText(): string {
    return this.getAttribute("offline-text") ?? DEFAULT_OFFLINE
  }

  set offlineText(value: string) {
    this.setAttribute("offline-text", value)
  }

  get onlineText(): string {
    return this.getAttribute("online-text") ?? DEFAULT_ONLINE
  }

  set onlineText(value: string) {
    this.setAttribute("online-text", value)
  }

  attributeChangedCallback(): void {
    // If the text changes while the bar is showing, as when the language
    // changes, the bar says the new one. `textContent` is only written when
    // the text differs.
    const bar = this.bar
    if (!bar || bar.textContent === "") return
    const text =
      bar.dataset.state === "offline" ? this.offlineText : this.onlineText
    if (bar.textContent !== text) bar.textContent = text
  }

  connectedCallback(): void {
    this.classList.add(CONNECTION_STATUS_CLASS)
    /*
     * The host is the live region, from the moment it is connected, so the
     * region exists long before the bar and its text arrive. Only what is
     * missing: a role or politeness the server wrote stays. When the bar was
     * the region, it was inserted together with its text, and Firefox sent
     * no live-region text through AT-SPI at all, so "No connection" was
     * never announced. `check-accessibility-tree.ts` checks it.
     */
    this.markRegion()
    // A morph without `data-ignore-morph` takes both off, and then the next
    // outage is never announced. Writing only what is missing keeps the
    // observer from triggering itself.
    this.regionObserver = new MutationObserver(() => this.markRegion())
    this.regionObserver.observe(this, {
      attributes: true,
      attributeFilter: ["role", "aria-live"],
    })
    window.addEventListener("offline", this.handleOffline)
    window.addEventListener("online", this.handleOnline)
    if (!navigator.onLine) {
      this.showOffline()
      return
    }
    /*
     * The element may have been out of the document, and then both the
     * events and the timer are lost. If the receipt was showing, it stayed
     * for good, and if the bar said "offline" while the network came back,
     * it kept saying so until the next time the network dropped. `failing`
     * is the app's word and not the network's, so it stays.
     */
    if (this.bar?.dataset.state === "online") this.scheduleRemoval(this.bar)
    else if (this.bar?.dataset.state === "offline" && !this.failing) {
      this.showOnline()
    }
  }

  private regionObserver?: MutationObserver

  /**
   * The region, as a pair and only when both are missing. A role the server
   * wrote carries its own politeness (`alert` is assertive), and an
   * `aria-live` added next to it would override that.
   */
  private markRegion(): void {
    if (this.hasAttribute("role") || this.hasAttribute("aria-live")) return
    this.setAttribute("role", "status")
    this.setAttribute("aria-live", "polite")
  }

  disconnectedCallback(): void {
    this.regionObserver?.disconnect()
    this.regionObserver = undefined
    window.removeEventListener("offline", this.handleOffline)
    window.removeEventListener("online", this.handleOnline)
    if (this.timer) window.clearTimeout(this.timer)
    this.timer = undefined
  }

  /**
   * The bar, created empty first and filled afterwards.
   *
   * A live region must exist before its content arrives, or assistive
   * technology does not announce the first change. The region is the host
   * (see `connectedCallback`), so the bar is content inside a region that is
   * already there; the text is still set in the next frame when the bar is
   * new, so the bar and its text arrive as two changes.
   *
   * The bar is created only when it is needed, not on connection: when it
   * was in the DOM before React hydrated, React found an element it had not
   * rendered.
   */
  private ensureBar(): { bar: HTMLElement; fresh: boolean } {
    if (this.bar) return { bar: this.bar, fresh: false }

    const bar = document.createElement("div")
    bar.className = CONNECTION_STATUS_BAR_CLASS
    this.append(bar)
    this.bar = bar
    return { bar, fresh: true }
  }

  private write(
    bar: HTMLElement,
    fresh: boolean,
    state: "offline" | "online",
  ): void {
    // The text is read when it is written, not when it is scheduled. If
    // `offline-text` changed in the frame between, the bar wrote the old one.
    const text = () =>
      state === "offline" ? this.offlineText : this.onlineText
    if (!fresh || typeof requestAnimationFrame === "undefined") {
      bar.textContent = text()
      return
    }
    requestAnimationFrame(() => {
      // The guard is the state, not the bar: if `reportSuccess()` came in
      // the same frame, the bar already says "online", and the offline text
      // must not be written over the receipt.
      if (this.bar === bar && bar.dataset.state === state) {
        bar.textContent = text()
      }
    })
  }

  private showOffline(): void {
    // Browsers often fire several `offline` events in a row, and the app
    // can report a failure on top of a network that is already gone. If the
    // bar already says "offline", there is nothing new to write or report:
    // each write was announced again, and each report gave the app a new
    // `connection-lost`.
    if (this.bar?.dataset.state === "offline") return

    if (this.timer) window.clearTimeout(this.timer)
    const { bar, fresh } = this.ensureBar()
    bar.dataset.state = "offline"
    this.write(bar, fresh, "offline")
    this.emit("connection-lost")
  }

  private showOnline(): void {
    if (!this.bar || this.bar.dataset.state === "online") return
    const bar = this.bar
    bar.dataset.state = "online"
    this.write(bar, false, "online")
    this.emit("connection-restored")

    this.scheduleRemoval(bar)
  }

  private scheduleRemoval(bar: HTMLElement): void {
    if (this.timer) window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => {
      bar.remove()
      this.bar = undefined
      this.timer = undefined
    }, RECEIPT_MS)
  }

  private handleOffline = (): void => {
    this.showOffline()
  }

  private handleOnline = (): void => {
    if (this.failing) return
    this.showOnline()
  }

  private emit(name: string): void {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true }))
  }

  /** Reports that a request to the server failed. */
  reportFailure(): void {
    if (this.failing) return
    this.failing = true
    this.showOffline()
  }

  /** Reports that a request to the server succeeded again. */
  reportSuccess(): void {
    if (!this.failing) return
    this.failing = false
    this.showOnline()
  }
}

export function defineLtConnectionStatus(
  tagName: string = LT_CONNECTION_STATUS_TAG,
): void {
  defineElement(tagName, LtConnectionStatus)
}

/**
 * `element.reportFailure()`, but waits for the registration first.
 *
 * This is where the gap showed up in production: the first message from the
 * event stream came before `defineLtConnectionStatus()`, and the app got
 * "reportSuccess is not a function". See `whenUpgraded`.
 */
export async function reportFailure(element: Element): Promise<void> {
  const status = await whenUpgraded<LtConnectionStatus>(element)
  status.reportFailure()
}

/** `element.reportSuccess()`, but waits for the registration first. */
export async function reportSuccess(element: Element): Promise<void> {
  const status = await whenUpgraded<LtConnectionStatus>(element)
  status.reportSuccess()
}
