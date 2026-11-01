import {
  addClass,
  defineElement,
  HostElement,
  languageOf,
  setAttr,
  setText,
  uniqueId,
  warnAboutMarkup,
  whenUpgraded,
} from "../../host-element.js"
import {
  SESSION_LOGOUT,
  SESSION_TIMEOUT_CLASS,
  SESSION_TIMEOUT_COUNT_CLASS,
  SESSION_TIMEOUT_DIALOG_CLASS,
  SESSION_TIMEOUT_TEXT_CLASS,
} from "./session-timeout.js"

export const LT_SESSION_TIMEOUT_TAG = "lt-session-timeout" as const

/**
 * The parts the warning finds, as selectors relative to the element. The
 * component finds the parts with these, and the manifest describes them for
 * whoever assembles the markup by hand, so the two cannot say different things.
 */
export const LT_SESSION_TIMEOUT_PARTS = {
  dialog: "dialog",
  title: "h1, h2, h3, h4, h5, h6",
  text: `.${SESSION_TIMEOUT_TEXT_CLASS}`,
  count: `.${SESSION_TIMEOUT_COUNT_CLASS}`,
  status: "[role='status']",
  button: 'form[method="dialog" i] button',
} as const

const DEFAULT_WARN_AT = 25 * 60
const DEFAULT_EXPIRES_AT = 30 * 60

/** The seconds to announce along the way. Every second would be unbearable. */
const ANNOUNCE_AT = new Set([120, 60, 30, 10])

/**
 * The activity that resets the clock.
 *
 * `scroll` is here even though it also fires when code scrolls. A screen
 * reader in browse mode sends no key presses to the page, only scrolling, and
 * so does dragging the scrollbar. Without `scroll`, someone reading a long
 * page was signed out in the middle of reading. That is worse than a page
 * that scrolls by itself keeping the session alive. `scroll` does not bubble,
 * so everything is listened for in the capture phase, and scrolling in a
 * panel counts too.
 */
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "scroll"] as const
const ACTIVITY_OPTIONS = { passive: true, capture: true } as const

/** Seconds between each `session-activity`. */
const DEFAULT_ACTIVITY_INTERVAL = 60

/**
 * The reasons the component itself closes the dialog with.
 *
 * They are compared exactly, and the names are chosen so they do not collide
 * with a `value` the renderer has given a button.
 * `reset()` used to close with "extend", and the close was then read as the
 * user pressing the button with that value.
 */
const CLOSED_BY_RESET = "lt-session-reset"
const CLOSED_BY_EXPIRY = "lt-session-expired"

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

/**
 * The duration as it is spoken, in the page's language.
 *
 * `Intl` knows the words and the inflection, so "2 minutter og 30 sekunder"
 * on a Norwegian page becomes "2 minutes and 30 seconds" on an English one
 * without anyone translating it.
 * Rounded off, the announcement said "2 minutes" while the number showed
 * 1:30, so the seconds are included.
 */
function spoken(seconds: number, lang: string | undefined): string {
  const unit = (value: number, name: "minute" | "second") =>
    new Intl.NumberFormat(lang, {
      style: "unit",
      unit: name,
      unitDisplay: "long",
    }).format(value)
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  const parts: string[] = []
  if (m > 0) parts.push(unit(m, "minute"))
  if (s > 0 || m === 0) parts.push(unit(s, "second"))
  return new Intl.ListFormat(lang, { type: "conjunction" }).format(parts)
}

/**
 * The text in a node, with the number replaced by the duration as it is
 * spoken.
 *
 * The text is read, not written: a copy of the paragraph with new text in it
 * would have been a write, and no write in `frame/` goes around the helpers.
 */
function readAloud(
  node: Node,
  count: Element | null,
  duration: string,
): string {
  if (node === count) return duration
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? ""
  return [...node.childNodes]
    .map((child) => readAloud(child, count, duration))
    .join("")
}

function isSeconds(raw: string | null): boolean {
  if (raw === null) return true
  const value = Number(raw)
  return raw.trim() !== "" && Number.isFinite(value) && value >= 0
}

/**
 * The element that has focus, whatever shadow root it is in.
 *
 * `document.activeElement` stops at the shadow host, and a shadow root's
 * `activeElement` is null when focus is outside it. The descent goes from
 * the document in through each open shadow root to the element itself.
 */
function deepActiveElement(): HTMLElement | null {
  let active = document.activeElement
  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement
  }
  return active instanceof HTMLElement ? active : null
}

/**
 * Warns before a signed-in session expires.
 *
 * This is the thing every large organisation builds itself and gets wrong.
 * Either no warning comes, and the user loses a half-filled form, or the
 * dialog steals focus in the middle of a sentence, or the screen reader
 * reads the countdown every second.
 *
 * The renderer writes the dialog and the text, so the warning is in the
 * language the app uses, with the translation tool the app already has. The
 * component keeps time: it counts activity, opens the dialog with
 * `showModal()`, fills in the number and announces the countdown. That is all
 * it writes, along with what a template may have forgotten: the class
 * `lt-session-timeout__dialog` on the dialog, `role="alertdialog"`, and the
 * name from the first heading, with an id on the heading when it lacks one.
 *
 * The parts are recognised by what must be there anyway: a `<dialog>` inside
 * the host, `.lt-session-timeout__count` for the number, `[role=status]` for
 * the announcement and the buttons in a `<form method="dialog">`. A button
 * with `value="logout"` logs out. Every other way of closing the dialog,
 * Escape and the button with `value="extend"` included, means "I am here",
 * and extends the session.
 *
 * ```html
 * <lt-session-timeout warn-at="1500" expires-at="1800" data-ignore-morph>
 *   <dialog class="lt-session-timeout__dialog" role="alertdialog" aria-labelledby="session">
 *     <h2 class="lt-session-timeout__title" id="session">Your session is ending</h2>
 *     <p class="lt-session-timeout__text">
 *       Your session on the Lattice ends in <span class="lt-session-timeout__count" aria-hidden="true"></span>. Unsaved routes will be lost.
 *     </p>
 *     <span class="lt-sr-only" role="status"></span>
 *     <form method="dialog" class="lt-session-timeout__actions">
 *       <button class="lt-button" value="extend">Stay connected</button>
 *       <button class="lt-button" data-variant="secondary" value="logout">Log out</button>
 *     </form>
 *   </dialog>
 * </lt-session-timeout>
 * ```
 *
 * ```ts
 * document.querySelector("lt-session-timeout")
 *   .addEventListener("session-extend", () => fetch("/extend", { method: "POST" }))
 * ```
 */
export class LtSessionTimeout extends HostElement {
  static observedAttributes = [
    "warn-at",
    "expires-at",
    "activity-interval",
  ] as const

  private ticker?: number
  private lastActivity = Date.now()
  /**
   * When the component last sent `session-activity`, and whether the user has
   * done anything since.
   *
   * The clock is reset by activity in the browser, but the server session does
   * not know about it. A user typing in a long form without a single call to
   * the server never got the warning, and the submission failed because the
   * server session had expired. The event lets the app keep the server session
   * alive. It is sent at the start of an interval, and at the end if the user
   * has done something since, so the server is never more than one interval
   * behind the clock here.
   */
  private lastActivityEvent = 0
  private activitySinceEvent = false
  /** The seconds left at the previous tick, so a threshold is not skipped. */
  private previousLeft?: number
  private previousFocus: HTMLElement | null = null
  /**
   * True from when the session expired, or the user chose to sign out, until
   * `extend()` or `reset()` is called.
   *
   * Without this the cycle started again by itself, and an app that did not
   * navigate away got a new dialog and a new `session-expired` every
   * `expires-at` seconds, for a session that was already gone.
   */
  private expired = false
  /** The id the component gave the heading, so the same one comes back. */
  private titleId?: string
  /**
   * The dialog the component opened, until `close` has arrived.
   *
   * `close` arrives in a later task than the click that closed the dialog.
   * When the clock ticked in between, `tick()` opened the dialog again and
   * cleared `returnValue`, and the queued event then read `""` and extended
   * the session: the user pressed "Log out", and the app got
   * `session-extend`.
   */
  private shownDialog?: HTMLDialogElement
  /** Watches for `open` disappearing from a dialog in the top layer. See `repairOpen()`. */
  private openObserver?: MutationObserver

  /** Seconds without activity before the warning appears. */
  get warnAt(): number {
    return this.readSeconds("warn-at", DEFAULT_WARN_AT)
  }

  set warnAt(value: number) {
    setAttr(this, "warn-at", String(value))
  }

  /** Seconds between each `session-activity` while the user is active. */
  get activityInterval(): number {
    return this.readSeconds("activity-interval", DEFAULT_ACTIVITY_INTERVAL)
  }

  set activityInterval(value: number) {
    setAttr(this, "activity-interval", String(value))
  }

  /** Seconds without activity before the session expires. */
  get expiresAt(): number {
    return this.readSeconds("expires-at", DEFAULT_EXPIRES_AT)
  }

  set expiresAt(value: number) {
    setAttr(this, "expires-at", String(value))
  }

  connectedCallback(): void {
    addClass(this, SESSION_TIMEOUT_CLASS)

    for (const name of ACTIVITY_EVENTS) {
      document.addEventListener(name, this.registerActivity, ACTIVITY_OPTIONS)
    }
    /*
     * `close` does not bubble, but it passes through the host in the capture
     * phase. So the close is caught even when the renderer has replaced the
     * dialog, without the component having to hold on to a particular node.
     */
    this.addEventListener("close", this.handleClose, true)
    this.openObserver = new MutationObserver(() => {
      this.repairOpen()
      /*
       * A morph of the open warning takes the role and the name the component
       * wrote, since the renderer did not send them, and the screen reader had
       * a modal dialog without a name until the warning closed. They are
       * written again while it shows. Such a morph also removes `open`, which
       * is enough to get here; the wiring's own attributes are watched for a
       * morph that leaves `open` alone.
       */
      const dialog = this.dialog
      if (dialog?.matches(":modal")) this.wire(dialog)
    })
    this.openObserver.observe(this, {
      subtree: true,
      attributes: true,
      attributeFilter: [
        "open",
        "role",
        "class",
        "id",
        "aria-labelledby",
        "aria-label",
      ],
    })
    this.ticker = window.setInterval(() => this.tick(), 1000)
    this.validate()

    /*
     * If the element is moved while the warning is showing, the browser takes
     * the dialog out of the top layer and leaves `open` in place. It was then a
     * box without a backdrop or a focus trap, and `tick()` never opened it
     * again, since it was already "open". `removeAttribute` and not `close()`:
     * a close is read as the user extending the session.
     */
    const dialog = this.dialog
    if (dialog?.open && !dialog.matches(":modal")) {
      dialog.removeAttribute("open")
      dialog.showModal()
    }
  }

  disconnectedCallback(): void {
    for (const name of ACTIVITY_EVENTS) {
      document.removeEventListener(
        name,
        this.registerActivity,
        ACTIVITY_OPTIONS,
      )
    }
    this.removeEventListener("close", this.handleClose, true)
    this.openObserver?.disconnect()
    this.openObserver = undefined
    if (this.ticker) window.clearInterval(this.ticker)
    this.ticker = undefined
  }

  attributeChangedCallback(): void {
    if (this.isConnected) this.validate()
  }

  /** The dialog the component controls: the first `<dialog>` inside the host. */
  private get dialog(): HTMLDialogElement | null {
    return this.querySelector(LT_SESSION_TIMEOUT_PARTS.dialog)
  }

  private readSeconds(name: string, fallback: number): number {
    const raw = this.getAttribute(name)
    return isSeconds(raw) && raw !== null ? Number(raw) : fallback
  }

  /**
   * Says so when markup and numbers do not add up, instead of staying quiet.
   *
   * `warn-at="1800" expires-at="1500"` gave `session-expired` without the
   * dialog ever being shown, and a negative number gave a dialog on the first
   * tick. The defaults are used when a number is not a number.
   */
  private validate(): void {
    warnAboutMarkup(
      this,
      "has a warn-at or expires-at that is not a number greater than " +
        "or equal to zero. The defaults are used instead.",
      () =>
        !isSeconds(this.getAttribute("warn-at")) ||
        !isSeconds(this.getAttribute("expires-at")),
    )
    warnAboutMarkup(
      this,
      "has a warn-at that is not less than expires-at, so the warning " +
        "never comes before the session expires.",
      () => this.warnAt >= this.expiresAt,
    )
    warnAboutMarkup(
      this,
      "has an activity-interval that is not a number greater than " +
        "zero. session-activity is sent at most once a second, or every " +
        "60 seconds if the value is not a number.",
      () => {
        const raw = this.getAttribute("activity-interval")
        return raw !== null && (!isSeconds(raw) || Number(raw) < 1)
      },
    )
    // An empty element is a region that has not been filled yet, and stays
    // quiet here. It is reported when the warning should have appeared. See
    // `openDialog()`.
    warnAboutMarkup(
      this,
      "found no <dialog>. The warning cannot be shown, and the " +
        "session expires without warning.",
      () => this.childElementCount > 0 && this.dialog === null,
    )
    this.validateParts()
  }

  /** The parts inside the dialog. Each of them makes the warning worse when missing. */
  private validateParts(): void {
    const dialog = this.dialog
    if (!dialog) return
    warnAboutMarkup(
      this,
      `found no .${SESSION_TIMEOUT_COUNT_CLASS} in the dialog. The user cannot see how much time is left.`,
      () => !this.dialog?.querySelector(LT_SESSION_TIMEOUT_PARTS.count),
    )
    warnAboutMarkup(
      this,
      "found no [role=status] in the dialog. The countdown is not " +
        "announced to screen reader users.",
      () => !this.dialog?.querySelector(LT_SESSION_TIMEOUT_PARTS.status),
    )
    warnAboutMarkup(
      this,
      'found no button in a <form method="dialog">. The user can only ' +
        "extend the session with Escape, and cannot log out from the " +
        "warning.",
      () => !this.dialog?.querySelector(LT_SESSION_TIMEOUT_PARTS.button),
    )
  }

  /**
   * Fills in what accessibility requires and a template may have forgotten:
   * the role, and the name from the first heading. Only what is missing: a
   * name from `aria-label` or `aria-labelledby` was written by the renderer,
   * and stays.
   */
  private wire(dialog: HTMLDialogElement): void {
    addClass(dialog, SESSION_TIMEOUT_DIALOG_CLASS)
    if (!dialog.hasAttribute("role")) setAttr(dialog, "role", "alertdialog")
    if (
      dialog.hasAttribute("aria-labelledby") ||
      dialog.hasAttribute("aria-label")
    ) {
      return
    }
    const title = dialog.querySelector(LT_SESSION_TIMEOUT_PARTS.title)
    if (!title) return
    if (!title.id) {
      this.titleId ??= uniqueId("lt-session-timeout-title")
      setAttr(title, "id", this.titleId)
    }
    setAttr(dialog, "aria-labelledby", title.id)
  }

  /**
   * Puts `open` back on a dialog that is still in the top layer.
   *
   * `showModal()` sets the attribute itself, and the renderer did not send
   * it. A morph without `data-ignore-morph` therefore removes it, and the
   * dialog stayed in the top layer, invisible, with the rest of the page
   * inert. The page was stuck. The number comes back on the next tick.
   *
   * The condition is `:modal` and not `open`: when the user closes the
   * dialog, it leaves the top layer, and then the missing attribute is real.
   * The same rule as in `<lt-dialog>`.
   */
  private repairOpen(): void {
    const dialog = this.dialog
    if (!dialog?.matches(":modal") || dialog.open) return
    setAttr(dialog, "open", "")
  }

  private registerActivity = (): void => {
    if (this.dialog?.open || this.expired) return
    this.lastActivity = Date.now()
    this.activitySinceEvent = true
    this.reportActivity()
  }

  /**
   * Sends `session-activity` when an interval has passed and the user was
   * active.
   *
   * Not while the warning is showing or after the session has expired: then
   * the app kept the server session alive while the clock here counted down
   * towards `session-expired`. The interval is at least one second, or every
   * scroll sent a call.
   */
  private reportActivity(): void {
    if (!this.activitySinceEvent || this.dialog?.open || this.expired) return
    const now = Date.now()
    // If the tab has been frozen past the expiry, the activity is stale. Then
    // `session-activity` and `session-expired` came in the same tick, and the
    // app kept alive a session the component was saying had expired.
    if (now - this.lastActivity >= this.expiresAt * 1000) {
      this.activitySinceEvent = false
      return
    }
    // Scrolling comes every frame. The cheap check first, the attribute after.
    const since = now - this.lastActivityEvent
    if (since < 1000) return
    if (since < Math.max(1, this.activityInterval) * 1000) return
    this.lastActivityEvent = now
    this.activitySinceEvent = false
    this.emit("session-activity")
  }

  /**
   * The user closed the dialog, or the component did.
   *
   * The component's own closes have their own reasons, and do nothing here.
   * `value="logout"` logs out. Everything else, Escape and the button with
   * `value="extend"` included, is "I am here". That also applies to a button
   * with another value: otherwise the dialog closed, and the next tick opened
   * it again a second later.
   */
  private handleClose = (event: Event): void => {
    const dialog = event.target
    if (!(dialog instanceof HTMLDialogElement) || dialog !== this.dialog) return
    this.shownDialog = undefined

    const live = dialog.querySelector(LT_SESSION_TIMEOUT_PARTS.status)
    if (live) setText(live, "")
    this.previousFocus?.focus()
    this.previousFocus = null

    const reason = dialog.returnValue
    if (reason === CLOSED_BY_RESET || reason === CLOSED_BY_EXPIRY) return
    if (reason === SESSION_LOGOUT) {
      // As on expiry: the component stands still until `extend()` or
      // `reset()`. Otherwise the next tick saw a closed dialog after the warning
      // threshold and opened it again while the app was signing out.
      this.expired = true
      this.emit("session-logout")
      return
    }
    this.extend()
  }

  private tick(): void {
    if (this.expired) return
    // The end of an interval: the user was active, but no event has been sent
    // since the start.
    this.reportActivity()

    // A close is on its way. Wait for `close`, so it is read correctly. If the
    // dialog has been replaced in the meantime, it never comes, and then the
    // memory is released.
    const current = this.dialog
    /*
     * The renderer replaced the dialog while the warning showed, as
     * `innerHTML` does: still open when it went, so replaced, not closed.
     * Decided in the tick that opens the new one, below; kept in a field, it
     * outlived a `reset()` in between, and the next warning, minutes later,
     * sent no `session-warn`.
     */
    let continuing = false
    if (this.shownDialog && this.shownDialog !== current) {
      continuing = this.shownDialog.open
      this.shownDialog = undefined
    }
    if (this.shownDialog && !this.shownDialog.open) return

    const elapsed = Math.floor((Date.now() - this.lastActivity) / 1000)
    const left = this.expiresAt - elapsed
    const dialog = this.dialog

    if (left <= 0) {
      // The flag first, so the close is not read as an extension.
      this.expired = true
      this.closeDialog(CLOSED_BY_EXPIRY)
      this.emit("session-expired")
      return
    }

    // If the dialog is already open, the countdown continues even if `warn-at`
    // has been raised meanwhile. Otherwise the number froze, and the session
    // expired without further warnings.
    if (elapsed < this.warnAt && !dialog?.open) return

    if (!dialog?.open) {
      this.openDialog(left, continuing)
      return
    }
    /*
     * When a threshold is crossed, not only when it is hit exactly. A tick can
     * come late, or be throttled in a background tab, and when the clock jumped
     * from 61 to 59, "1 minute" was never announced.
     */
    const previous = this.previousLeft ?? left + 1
    this.previousLeft = left
    const crossed = [...ANNOUNCE_AT].some(
      (limit) => previous > limit && left <= limit,
    )
    this.show(dialog, left, crossed)
  }

  /** Writes the number, and the announcement when `announce` is true. */
  private show(
    dialog: HTMLDialogElement,
    left: number,
    announce: boolean,
  ): void {
    const count = dialog.querySelector(LT_SESSION_TIMEOUT_PARTS.count)
    if (count) setText(count, clock(left))
    if (!announce) return

    const live = dialog.querySelector(LT_SESSION_TIMEOUT_PARTS.status)
    if (!live) return
    const duration = spoken(left, languageOf(this))
    /*
     * The announcement is the paragraph, with the number spoken. That way it is
     * in the language the renderer wrote, without a separate text for the
     * screen reader. Without a paragraph holding the number, the duration is
     * read on its own.
     */
    const text = dialog.querySelector(LT_SESSION_TIMEOUT_PARTS.text)
    // If the number is outside the paragraph, the paragraph would be read without a number.
    if (!text || !count || !text.contains(count)) {
      setText(live, duration)
      return
    }
    const sentence = readAloud(text, count, duration)
    setText(live, sentence.replace(/\s+/g, " ").trim())
  }

  private openDialog(left: number, continuing = false): void {
    const dialog = this.dialog
    if (!dialog) {
      // By now the page has long since settled, so an empty element is not a
      // region waiting for content. It is a warning that will never come. If the
      // element has content without a dialog, `validate()` has already said so.
      warnAboutMarkup(
        this,
        "was about to show the warning, but found no <dialog>. Whoever " +
          "renders the page must write the dialog and its text, or the " +
          "user gets no warning before the session expires.",
        () => this.dialog === null && this.childElementCount === 0,
      )
      return
    }
    if (dialog.open) return

    this.wire(dialog)
    // The dialog may have arrived after connecting, with HTML streaming in.
    // Then `validate()` never saw it.
    this.validateParts()
    // Focus must go back to where the user was. Without this the next key
    // press starts at the top of the page, in the middle of a form. Taken from
    // the document down through the shadow roots, not from one root: `document`
    // points to the shadow host when the field is in a shadow tree, and the
    // component's root is null when the component is in a shadow root and the
    // field is in the page, as `<lt-error-summary>` also warns about. The field
    // can be on either side of the shadow boundary from the component, so only
    // the descent finds it.
    /*
     * A warning that was showing when the renderer replaced the dialog, as
     * `innerHTML` does, never closed: the user is still being warned. Focus
     * goes back to where it was before that warning, not to `<body>`, where
     * it is now, and `session-warn` has been sent already.
     */
    if (!continuing) this.previousFocus = deepActiveElement()
    /*
     * The text must be in place before the dialog opens, since `alertdialog` is
     * announced as it appears. The number in the paragraph is `aria-hidden`, so
     * without the announcement here the screen reader heard the paragraph
     * without a number, and the first number came only at the next threshold,
     * minutes later.
     */
    this.show(dialog, left, true)
    this.previousLeft = left
    // Activity before the warning is already counted in the clock here. Sent
    // while the warning is showing, it kept the server session alive while the
    // user was being asked to respond.
    this.activitySinceEvent = false
    dialog.returnValue = ""
    dialog.showModal()
    this.shownDialog = dialog
    if (!continuing) this.emit("session-warn")
  }

  private closeDialog(reason: string): void {
    const dialog = this.dialog
    if (!dialog?.open) return
    dialog.close(reason)
  }

  private emit(name: string): void {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true }))
  }

  /**
   * Extends the session, closes the warning and sends `session-extend`.
   *
   * If the app listens for `session-extend` to ask the server to extend, it
   * should call `reset()` when the answer comes, not this. Otherwise the
   * answer sends a new `session-extend`, which sends a new call.
   */
  extend(): void {
    this.reset()
    this.emit("session-extend")
  }

  /**
   * Resets the clock without sending `session-extend`.
   *
   * For an app that has already extended the session itself, such as when an
   * autosave went through. `extend()` would have asked the server a second
   * time.
   */
  reset(): void {
    this.lastActivity = Date.now()
    this.expired = false
    this.closeDialog(CLOSED_BY_RESET)
  }
}

export function defineLtSessionTimeout(
  tagName: string = LT_SESSION_TIMEOUT_TAG,
): void {
  defineElement(tagName, LtSessionTimeout)
}

/** `element.extend()`, but waits for the registration first. See `whenUpgraded`. */
export async function extendSession(element: Element): Promise<void> {
  const session = await whenUpgraded<LtSessionTimeout>(element)
  session.extend()
}

/** `element.reset()`, but waits for the registration first. See `whenUpgraded`. */
export async function resetSession(element: Element): Promise<void> {
  const session = await whenUpgraded<LtSessionTimeout>(element)
  session.reset()
}
