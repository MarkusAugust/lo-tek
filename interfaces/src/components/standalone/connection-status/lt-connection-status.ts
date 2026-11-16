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
     * The live region is the host when the markup made it one, as
     * `lt.connectionStatus()` does: then the region exists long before the
     * bar and its text arrive. A host without it is not made a region here.
     * Safari never takes in a `role` or `aria-live` set on a node that
     * already exists (measured in Safari 27.2), so VoiceOver said nothing
     * about the outage. Then the bar is the region instead, see `createBar`.
     *
     * A morph can take the region off the host while the bar shows. Then
     * the bar is made anew as the region. A region the host gets afterwards
     * is set on a node that already exists, so it does not count: the bar
     * stays the region.
     */
    this.hostIsRegion = this.hasRegionAttributes()
    // The host may have changed while it was out of the document.
    this.matchRegion()
    this.regionObserver = new MutationObserver(() => {
      if (!this.hasRegionAttributes()) this.hostIsRegion = false
      this.matchRegion()
    })
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
    if (this.bar?.dataset.state === "online") this.scheduleRemoval()
    else if (this.bar?.dataset.state === "offline" && !this.failing) {
      this.showOnline()
    }
  }

  private regionObserver?: MutationObserver

  /**
   * Whether the host was a region when it was connected, and still is. See
   * `connectedCallback`.
   */
  private hostIsRegion = false

  /**
   * Either is enough: a role the server wrote carries its own politeness
   * (`alert` is assertive), and `aria-live="off"` is the server's word too.
   */
  private hasRegionAttributes(): boolean {
    return this.hasAttribute("role") || this.hasAttribute("aria-live")
  }

  /**
   * The bar, as the region when the host is not one. The role is set before
   * the bar is in the document: that is the only way Safari takes it in.
   */
  private createBar(): HTMLElement {
    const bar = document.createElement("div")
    bar.className = CONNECTION_STATUS_BAR_CLASS
    if (!this.hostIsRegion) {
      bar.setAttribute("role", "status")
      bar.setAttribute("aria-live", "polite")
    }
    return bar
  }

  private matchRegion(): void {
    const old = this.bar
    if (!old || old.hasAttribute("role") !== this.hostIsRegion) return
    const state = old.dataset.state as "offline" | "online"
    const bar = this.createBar()
    bar.dataset.state = state
    old.replaceWith(bar)
    this.bar = bar
    this.write(bar, true, state)
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
   * or the bar (see `connectedCallback`). Either way the text is set two
   * frames later when the bar is new, so the bar and its text arrive as two
   * changes (see `write`).
   *
   * The bar is created only when it is needed, not on connection: when it
   * was in the DOM before React hydrated, React found an element it had not
   * rendered.
   */
  private ensureBar(): { bar: HTMLElement; fresh: boolean } {
    if (this.bar) return { bar: this.bar, fresh: false }

    const bar = this.createBar()
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
    // Two frames, not one: a callback for the first frame runs before
    // Firefox has made the bar's accessible object, and a region that
    // arrives with its text is never announced there. Measured through
    // AT-SPI: silent after one frame, announced after two.
    const afterTwoFrames = (write: () => void) =>
      requestAnimationFrame(() => requestAnimationFrame(write))
    afterTwoFrames(() => {
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

    this.scheduleRemoval()
  }

  private scheduleRemoval(): void {
    if (this.timer) window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => {
      this.bar?.remove()
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
