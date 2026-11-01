import { DEFAULT_TEXTS } from "../../default-texts.js"
import { defineElement, HostElement, whenUpgraded } from "../../host-element.js"
import { TOAST_CLASS, TOAST_CLOSE_CLASS, TOAST_MESSAGE_CLASS } from "./toast.js"

export const LT_TOAST_TAG = "lt-toast" as const

export const toastColors = ["neutral", "success", "warning", "danger"] as const
export type ToastColor = (typeof toastColors)[number]

export function isToastColor(value: unknown): value is ToastColor {
  return (toastColors as readonly unknown[]).includes(value)
}

const DEFAULT_DURATION = 6000
const DEFAULT_LABEL = DEFAULT_TEXTS.toastRegion
const DEFAULT_CLOSE_LABEL = DEFAULT_TEXTS.toastClose

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
 * `data-ignore-morph`. Without it the Datastar morph tears the messages away
 * at the next patch, because the server's version of the region is empty.
 *
 * The container is a `role="status"` region, not `role="alert"`. A message
 * that appears in the corner should not interrupt what the screen reader is
 * doing; if the message is important enough to interrupt, it belongs in an
 * [Alert](../../css/alert/alert.js) in the page itself. The region has
 * `aria-atomic="false"`: `status` is atomic by default, and then the whole
 * stack was announced again for every new message.
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
  static observedAttributes = ["duration", "label", "close-label"] as const

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
   * Whether the component wrote `aria-label`. Before, `label` overwrote an
   * `aria-label` the author had set, and when `label` was removed, the old
   * one stayed.
   */
  private ownsLabel = false
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

  disconnectedCallback(): void {
    this.removeEventListener("focusin", this.rememberOrigin)
    this.removeEventListener("focusout", this.forgetOrigin)
    this.focusOrigin = null
  }

  connectedCallback(): void {
    this.addEventListener("focusin", this.rememberOrigin)
    this.addEventListener("focusout", this.forgetOrigin)
    // If the server wrote the region with lt.toast(), all of this is
    // already there. Here it is only set when missing, so a plain HTML page
    // without a builder function also gets a region the screen reader
    // understands.
    // The class carries the position. It is set here too, so a region
    // without a builder function, or registered under another name, ends up
    // in the corner.
    this.classList.add(TOAST_CLASS)
    if (!this.hasAttribute("role")) this.setAttribute("role", "status")
    if (!this.hasAttribute("aria-live")) {
      this.setAttribute("aria-live", "polite")
    }
    if (!this.hasAttribute("aria-atomic")) {
      this.setAttribute("aria-atomic", "false")
    }
    if (!this.hasAttribute("aria-label")) {
      this.ownsLabel = true
      this.setAttribute(
        "aria-label",
        this.getAttribute("label") ?? DEFAULT_LABEL,
      )
    }
  }

  attributeChangedCallback(name: string, _old: string, value: string): void {
    // `label` can be set after the element is in the DOM, for example by a
    // framework that fills in the attributes in a later step.
    if (name !== "label" || !this.ownsLabel) return
    this.setAttribute("aria-label", value || DEFAULT_LABEL)
  }

  /** Shows a message, and returns the element it was put in. */
  show(message: string, options: ShowOptions = {}): HTMLElement {
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
    close.addEventListener("click", () => this.dismiss(toast))
    toast.append(close)

    this.prepend(toast)

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
    if (!this.contains(toast)) return

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
