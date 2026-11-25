import { DEFAULT_TEXTS } from "../../default-texts.js"
import {
  defineElement,
  HostElement,
  warnAboutMarkup,
  whenUpgraded,
} from "../../host-element.js"
import { TOAST_CLASS, TOAST_CLOSE_CLASS, TOAST_MESSAGE_CLASS } from "./toast.js"

export const LT_TOAST_TAG = "lt-toast" as const

export const toastColors = ["neutral", "success", "warning", "danger"] as const
export type ToastColor = (typeof toastColors)[number]

export function isToastColor(value: unknown): value is ToastColor {
  return (toastColors as readonly unknown[]).includes(value)
}

const DEFAULT_DURATION = 6000
const DEFAULT_CLOSE_LABEL = DEFAULT_TEXTS.toastClose

/**
 * The attributes that give the region a name, which leaves it silent in
 * Safari: VoiceOver said nothing about any message in a region named by any
 * of them (Safari 27.2, 2026-11-16).
 */
const NAMING = ["aria-label", "aria-labelledby", "title"] as const

export type ShowOptions = {
  /** What the message means. Default: `neutral`. */
  color?: ToastColor
  /** Milliseconds before the message disappears. `0` keeps it. */
  duration?: number
  /**
   * The screen reader name of the close button. Default: `close-label` on
   * the host, and otherwise "Close message".
   */
  closeLabel?: string
}

/**
 * The queue of short messages in the corner of the screen.
 *
 * This is one of the standalone components, and part of the package you call
 * instead of writing markup. The element is the container, not the message:
 * you put it in the app once and call `show()` when there is something to
 * report. The messages do not exist until an event on the client creates
 * them, so there is nothing for the server to render.
 *
 * The server writes the container with `lt.toast()`, which sets
 * `data-ignore-morph`. Without it the Datastar morph takes the messages out
 * at the next patch, because the server's version of the region is empty.
 * The component puts them back (see `restoreMessages`), but that is a
 * repair: a message put back may be announced again and has lost focus.
 *
 * The container is a `role="status"` region, not `role="alert"`. A message
 * that appears in the corner should not interrupt what the screen reader is
 * doing; if the message is important enough to interrupt, it belongs in an
 * [Alert](../../css/alert/alert.js) in the page itself. The region has
 * `aria-atomic="false"`: `status` is atomic by default, and then the whole
 * stack was announced again for every new message.
 *
 * The region has no name. Safari announces nothing put into a live region
 * with an accessible name, and until 0.45.0 the component named it
 * "Notifications", so VoiceOver in Safari said nothing about any message.
 * The component warns when the markup names it anyway.
 *
 * Messages that disappear by themselves are an accessibility trap: someone
 * who reads slowly or uses magnification does not have time to read them. So
 * the close button is always there, and the timer stops while the mouse or
 * focus is in the message.
 *
 * ```ts
 * document.querySelector("lt-toast").show("Relay 14 is back", {
 *   color: "success",
 * })
 * ```
 */
export class LtToast extends HostElement {
  // Both are read when a message is shown, so a change needs no callback.
  // The list is what the manifest documents.
  static observedAttributes = ["duration", "close-label"] as const

  /**
   * The screen reader name of the close button in each message shown.
   * `closeLabel` in `show()` overrides it for one message.
   */
  get closeLabel(): string {
    return this.getAttribute("close-label") || DEFAULT_CLOSE_LABEL
  }

  set closeLabel(value: string) {
    this.setAttribute("close-label", value)
  }

  /** Default lifetime in milliseconds. `0` keeps the messages. */
  get duration(): number {
    // `0` is a valid value and means the messages stay. Without the check
    // against null here they still disappeared after six seconds, and only
    // `show(..., { duration: 0 })` worked. An empty attribute is not null:
    // `Number("")` is 0, and `<lt-toast duration>` kept the messages.
    const raw = this.getAttribute("duration")
    if (raw === null || raw.trim() === "") return DEFAULT_DURATION
    const value = Number(raw)
    return Number.isFinite(value) && value >= 0 ? value : DEFAULT_DURATION
  }

  set duration(value: number) {
    this.setAttribute("duration", String(value))
  }

  /**
   * The element focus came from before it entered a message. If the last
   * message is removed while it has focus, focus goes back there. Before, it
   * fell to `body`, and the next Tab started at the top of the page. If
   * focus came from a screen reader or F6, the origin is not known, and focus
   * still falls.
   */
  private focusOrigin: HTMLElement | null = null

  private rememberOrigin = (event: FocusEvent): void => {
    const from = event.relatedTarget
    if (from instanceof HTMLElement && !this.contains(from)) {
      this.focusOrigin = from
    }
  }

  /**
   * Focus left the region for somewhere else. Then the origin is stale:
   * without this, focus later came back to an element the user left long
   * ago, and the page scrolled there. Not when `relatedTarget` is `null`,
   * because that is also what happens when the message with focus is
   * removed.
   */
  private forgetOrigin = (event: FocusEvent): void => {
    const to = event.relatedTarget
    if (to instanceof Node && !this.contains(to)) this.focusOrigin = null
  }

  /**
   * Whether focus is in the element. Read from the component's root node,
   * not from `document`: when the region is in a shadow root, as in every
   * preview in the documentation, `document.activeElement` points to the
   * shadow host. Then it looked as if no message had focus, and focus fell
   * to `body` instead of to the neighbouring message or where it came from.
   */
  private holdsFocus(element: Element): boolean {
    const root = this.getRootNode() as Document | ShadowRoot
    return element.contains(root.activeElement)
  }

  private restoreFocus(): void {
    const origin = this.focusOrigin
    this.focusOrigin = null
    // A restore, not a navigation: the page must not scroll.
    if (origin?.isConnected) origin.focus({ preventScroll: true })
  }

  /**
   * The messages `show()` made that are still live, in the order they stand
   * in the region: the newest first.
   */
  private own: HTMLElement[] = []

  private childObserver?: MutationObserver

  /**
   * Puts back the messages an update took out of the region.
   *
   * A morph that does not know `data-ignore-morph` removes what the server
   * did not send, and the messages are exactly that: the user lost a
   * message they had not read. Only `dismiss()`, `clear()` and the timer end
   * a message `show()` made, so one that is missing goes back where it
   * stood. A message someone else wrote into the region is theirs to take
   * away, and is left gone.
   */
  private restoreMessages(): void {
    // From the last to the first, so that a message finds the ones that
    // stood after it already back.
    for (let index = this.own.length - 1; index >= 0; index--) {
      const message = this.own[index]
      if (!message || message.parentNode === this) continue
      this.insertBefore(message, this.placeFor(message))
    }
    this.stood = [...this.children]
  }

  /**
   * What stood in the region the last time it was at rest, the component's
   * own messages and others alike. It is what says where a message that was
   * taken stood.
   */
  private stood: Element[] = []

  /**
   * The node a message that was taken goes back in front of: the nearest
   * one that stood after it and is still there, otherwise right after the
   * nearest one that stood before it. When nothing it stood among is left,
   * it goes first, where `show()` puts a message.
   */
  private placeFor(message: HTMLElement): Node | null {
    const at = this.stood.indexOf(message)
    if (at !== -1) {
      for (const after of this.stood.slice(at + 1)) {
        if (after.parentNode === this) return after
      }
      for (const before of this.stood.slice(0, at).reverse()) {
        if (before.parentNode === this) return before.nextSibling
      }
    }
    return this.firstChild
  }

  /**
   * One listener for every close button in the region, not one per
   * message. A message the server patched in, or one that came back with
   * the page from the history, was not made by `show()` here, and its close
   * button did nothing.
   */
  private closeFromClick = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) return
    const close = event.target.closest(`.${TOAST_CLOSE_CLASS}`)
    const message = close?.closest<HTMLElement>(`.${TOAST_MESSAGE_CLASS}`)
    if (message && this.contains(message)) this.dismiss(message)
  }

  disconnectedCallback(): void {
    this.removeEventListener("focusin", this.rememberOrigin)
    this.removeEventListener("focusout", this.forgetOrigin)
    this.removeEventListener("click", this.closeFromClick)
    this.childObserver?.disconnect()
    this.childObserver = undefined
    this.focusOrigin = null
  }

  connectedCallback(): void {
    this.addEventListener("focusin", this.rememberOrigin)
    this.addEventListener("focusout", this.forgetOrigin)
    this.addEventListener("click", this.closeFromClick)
    // The region may have been emptied while it was out of the document.
    this.restoreMessages()
    this.childObserver?.disconnect()
    this.childObserver = new MutationObserver(() => this.restoreMessages())
    this.childObserver.observe(this, { childList: true })
    // If the server wrote the region with lt.toast(), all of this is
    // already there. Here it is only set when missing, so a plain HTML page
    // without a builder function also gets a region the screen reader
    // understands.
    // The class carries the position. It is set here too, so a region
    // without a builder function, or registered under another name, ends up
    // in the corner.
    this.classList.add(TOAST_CLASS)
    const late = ["role", "aria-live", "aria-atomic"].some(
      (name) => !this.hasAttribute(name),
    )
    if (!this.hasAttribute("role")) this.setAttribute("role", "status")
    if (!this.hasAttribute("aria-live")) {
      this.setAttribute("aria-live", "polite")
    }
    if (!this.hasAttribute("aria-atomic")) {
      this.setAttribute("aria-atomic", "false")
    }
    this.warnIfNamed()
    /*
     * Safari does not take in a `role` or `aria-live` set on a node that
     * already exists until something else in the tree changes (measured in
     * Safari 27.2): the messages were shown, and VoiceOver said nothing. A node that is inserted with them is taken in,
     * so the region is put back where it stands. It connects once more,
     * finds all three, and stops here.
     *
     * The cost is the server's to avoid by writing the role, as `lt.toast()`
     * does: a message that had focus loses it, and a framework that acts on
     * insertion, as Datastar does with `data-init`, acts once more.
     */
    if (late) this.parentNode?.insertBefore(this, this.nextSibling)
  }

  /*
   * A warning, never a removal: the name is the markup's, and taking it
   * away would fight the framework or morph that wrote it. On connect, and
   * again on each message, for a name a framework sets later.
   */
  private warnIfNamed(): void {
    if (this.named())
      warnAboutMarkup(
        this,
        `the region has a name (${NAMING.filter((a) => this.hasAttribute(a)).join(", ")}), ` +
          "and Safari announces nothing put into a named live region, so VoiceOver " +
          "says nothing about the messages. Take the name away: a status " +
          "region needs none.",
        () => this.named(),
      )
  }

  private named(): boolean {
    return NAMING.some((name) => this.hasAttribute(name))
  }

  /** Shows a message, and returns the element it was put in. */
  show(message: string, options: ShowOptions = {}): HTMLElement {
    this.warnIfNamed()
    const {
      color = "neutral",
      duration = this.duration,
      closeLabel = this.closeLabel,
    } = options

    const toast = document.createElement("div")
    toast.className = TOAST_MESSAGE_CLASS
    // An unknown colour gives no border, instead of a `data-color` without a rule.
    if (isToastColor(color) && color !== "neutral") toast.dataset.color = color

    const text = document.createElement("span")
    text.textContent = message
    toast.append(text)

    const close = document.createElement("button")
    close.type = "button"
    close.className = TOAST_CLOSE_CLASS
    close.setAttribute("aria-label", closeLabel)
    close.textContent = "×"
    toast.append(close)

    // Anything an update took in this same turn goes back first, so the
    // new message is placed among all of them.
    this.restoreMessages()
    this.own.unshift(toast)
    this.prepend(toast)
    // Now, not when the observer comes round: an update can take the
    // message in the same turn.
    this.stood = [...this.children]

    if (duration > 0) {
      let timer = window.setTimeout(() => this.dismiss(toast), duration)

      /*
       * The timer stops while the user reads or is on the way to the close
       * button, and only runs when neither the mouse nor focus is in the
       * message. The pause used to be two independent pairs, and the mouse
       * leaving restarted the clock while focus was in the message: it
       * disappeared from under the user's fingers.
       */
      const holds = new Set<"pointer" | "focus">()
      const pause = (reason: "pointer" | "focus") => {
        holds.add(reason)
        window.clearTimeout(timer)
      }
      const resume = (reason: "pointer" | "focus") => {
        holds.delete(reason)
        if (holds.size > 0) return
        window.clearTimeout(timer)
        timer = window.setTimeout(() => this.dismiss(toast), duration)
      }

      toast.addEventListener("mouseenter", () => pause("pointer"))
      toast.addEventListener("mouseleave", () => resume("pointer"))
      toast.addEventListener("focusin", () => pause("focus"))
      toast.addEventListener("focusout", (event) => {
        // Within the message, from the text to the button: still paused.
        const next = event.relatedTarget
        if (next instanceof Node && toast.contains(next)) return
        resume("focus")
      })
    }

    return toast
  }

  /** Removes a message. */
  dismiss(toast: HTMLElement): void {
    // A message of the component's own is live until this runs, also when
    // an update has just taken it out of the region: the app asked for it
    // to go, and it must not be put back.
    const index = this.own.indexOf(toast)
    if (index === -1 && !this.contains(toast)) return
    if (index !== -1) this.own.splice(index, 1)

    /*
     * If focus was in the message, as on the close button after Enter, it
     * would otherwise fall to `body`, and the next Tab starts at the top of
     * the page. The neighbouring message is the nearest place to continue
     * from: the one below, otherwise the one above.
     */
    const hadFocus = this.holdsFocus(toast)
    const neighbour = toast.nextElementSibling ?? toast.previousElementSibling
    toast.remove()
    if (hadFocus) {
      const next = neighbour?.querySelector<HTMLElement>(
        `.${TOAST_CLOSE_CLASS}`,
      )
      if (next) next.focus()
      else this.restoreFocus()
    }

    this.dispatchEvent(
      new CustomEvent("toast-dismiss", { bubbles: true, composed: true }),
    )
  }

  /** Removes all the messages. */
  clear(): void {
    if (this.holdsFocus(this)) this.restoreFocus()
    this.own = []
    for (const toast of this.querySelectorAll(`.${TOAST_MESSAGE_CLASS}`)) {
      toast.remove()
    }
  }
}

export function defineLtToast(tagName: string = LT_TOAST_TAG): void {
  defineElement(tagName, LtToast)
}

/**
 * `element.show()`, but waits for `defineLtToast()` to have run first.
 *
 * See `whenUpgraded` for why: a call before the registration hit a plain
 * `HTMLElement` without `show`.
 */
export async function showToast(
  element: Element,
  message: string,
  options: ShowOptions = {},
): Promise<HTMLElement> {
  const toast = await whenUpgraded<LtToast>(element)
  return toast.show(message, options)
}
