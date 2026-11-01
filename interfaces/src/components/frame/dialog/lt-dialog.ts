import {
  addClass,
  defineElement,
  HostElement,
  isServerControlled,
  SERVER_CONTROLLED,
  setAttr,
  setFlag,
  uniqueId,
  warnAboutMarkup,
} from "../../host-element.js"
import {
  DIALOG_BODY_CLASS,
  DIALOG_CLASS,
  DIALOG_TITLE_CLASS,
} from "./dialog.js"

export const LT_DIALOG_TAG = "lt-dialog" as const

/**
 * The parts the dialog finds, as selectors relative to the element. The
 * component finds the parts with these, and the manifest describes them for
 * whoever assembles the markup by hand, so the two cannot say different things.
 */
export const LT_DIALOG_PARTS = {
  dialog: ":scope > dialog",
  title: "h1, h2, h3, h4, h5, h6",
  body: `.${DIALOG_BODY_CLASS}`,
} as const

/**
 * A modal dialog a server can open.
 *
 * Opening a `<dialog>` is a call and not an attribute. `showModal()` moves
 * focus in, keeps focus inside the dialog, closes on Escape and makes the rest
 * of the page inert. `<dialog open>` does none of that: it is a box on the
 * page.
 *
 * A server that only sends HTML cannot call anything. Without this component
 * an app in Datastar, htmx or a Go template could not open a dialog at all
 * without writing a script of its own alongside. Here the server says instead
 * that the dialog is open, and the component makes the call.
 *
 * When the user closes the dialog, with Escape or with a button in a
 * `<form method="dialog">`, `open` is removed from the host again, so the
 * markup says the same as the screen. The component reports it with
 * `dialog-toggle`, which carries `open` and `returnValue`. A click on the
 * backdrop does not close it: neither does it on a plain `<dialog>`, and the
 * component adds nothing.
 *
 * `open` on the **host** comes from the server. If the server sends the
 * region again with `open` still set, the dialog opens again. `open` on the
 * `<dialog>` itself comes from the browser, set by `showModal()`, and the
 * component puts it back when a patch removes it. The template needs no
 * `data-preserve-attr`.
 *
 * Write `open` on the `<dialog>` itself too when the dialog should be shown.
 * Without JavaScript a `<dialog>` without `open` is hidden, and then the
 * content does not exist at all. `lt.dialog({ open: true })` gives both.
 *
 * `server-controlled` on the host turns off the repair of `open` on the
 * `<dialog>`. Then every patch decides whether the dialog is shown, also when
 * it is in the top layer.
 *
 * ```html
 * <lt-dialog open>
 *   <dialog class="lt-dialog" aria-labelledby="title" open>
 *     <h2 class="lt-dialog__title" id="title">The order is placed</h2>
 *     <div class="lt-dialog__body">Job 222-0481 is open to crews.</div>
 *     <form method="dialog" class="lt-dialog__footer">
 *       <button class="lt-button" value="close">Close</button>
 *     </form>
 *   </dialog>
 * </lt-dialog>
 * ```
 */
/**
 * The dialogs already checked for a close before upgrade.
 *
 * The check applies only the first time a dialog is seen, not every time a
 * host is connected. A morph that moves the host disconnects and reconnects
 * it, and then `returnValue` was left over from a close the user made long
 * ago. The component thought it had been closed before the script arrived,
 * and took `open` from the host the server had just opened. The set lives
 * outside the class, so the same applies to a dialog moved into a new host.
 */
const upgradeChecked = new WeakSet<HTMLDialogElement>()

export class LtDialog extends HostElement {
  static observedAttributes = ["open", SERVER_CONTROLLED] as const

  private observer?: MutationObserver
  /**
   * A separate observer for `open` on the `<dialog>` itself.
   *
   * It cannot be merged with the other one. When the user closes the dialog,
   * the browser removes the attribute first and sends `close` afterwards, and
   * an observer running all of `sync()` there would have seen a host still
   * saying "open" and a dialog that was not modal, and opened it again before
   * `close` was handled. This one does only one thing: it puts the attribute
   * back on a dialog that is still in the top layer.
   */
  private openObserver?: MutationObserver
  private dialogElement?: HTMLDialogElement
  /**
   * What the component last reported, so it reports only when the state
   * changes.
   *
   * A morph that moves the host or the dialog takes the dialog out of the top
   * layer, and the component opens it again. Before, it then reported
   * `open: true` for a dialog that had been open the whole time. The field
   * survives the host being disconnected and reconnected.
   */
  private lastNotified?: boolean

  /** Whether the dialog is open. Mirrors the `open` attribute. */
  get open(): boolean {
    return this.hasAttribute("open")
  }

  set open(value: boolean) {
    setFlag(this, "open", value)
  }

  connectedCallback(): void {
    /*
     * The server can send the dialog into a region already on the page, and
     * then the `<dialog>` does not exist yet when the component connects. Only
     * a change among the host's direct children runs all of `sync()`: the
     * dialog is always a direct child, and the content inside it changes with
     * every patch without saying anything about which dialog is the
     * component's.
     *
     * `open` on the `<dialog>` itself is included. The browser sets it when
     * `showModal()` is called, and a morph removes it again, since the server
     * did not send it. Without this an open dialog disappeared as soon as
     * something in the region around it was patched, and the template had to
     * write `data-preserve-attr="open"` to prevent it.
     */
    /*
     * The attributes are included for the wiring the component fills in when
     * the markup came without it: the class, the heading's id and
     * `aria-labelledby`. But an attribute record runs only the wiring, not all
     * of `sync()`. `close()` removes `open` synchronously and queues the
     * `close` event as a separate task, and the observer runs before it. When
     * a click changed a class on the button in the same task as it closed the
     * dialog, `sync()` saw a host with `open` and a dialog that was not modal,
     * and opened it again before the close was handled. Every write compares
     * first, or the observer would trigger itself.
     */
    this.observer = new MutationObserver((records) => {
      const swapped = records.some(
        (record) => record.type === "childList" && record.target === this,
      )
      if (swapped) this.sync()
      else this.rewire()
    })
    this.observer.observe(this, {
      childList: true,
      subtree: true,
      attributes: true,
      // `aria-label` too: removed, the dialog is named after its title
      // again, and without it here the dialog was left without a name.
      attributeFilter: ["class", "id", "aria-labelledby", "aria-label"],
    })
    this.sync()
  }

  disconnectedCallback(): void {
    this.observer?.disconnect()
    this.observer = undefined
    this.openObserver?.disconnect()
    this.openObserver = undefined
    this.dialogElement?.removeEventListener("close", this.handleClose)
    this.dialogElement = undefined
  }

  attributeChangedCallback(): void {
    this.sync()
  }

  /**
   * The dialog the component controls.
   *
   * Only a direct child. A `<dialog>` further down the tree can belong to
   * something else, and must not be opened by this component.
   */
  private get dialog(): HTMLDialogElement | null {
    return this.querySelector(LT_DIALOG_PARTS.dialog)
  }

  /** The id the component gave the heading, so a patch gets the same one back. */
  private titleId?: string

  /** The wiring alone, for an attribute record. See the observer. */
  private rewire(): void {
    const dialog = this.dialog
    if (dialog?.isConnected) this.wire(dialog)
  }

  /**
   * The heading that is the dialog's title when the server did not point to
   * one.
   *
   * The first heading in this dialog that is not in the body. A heading in
   * `.lt-dialog__body` is a heading in the content, not the dialog's name: a
   * settings dialog in three sections got the first section's heading as its
   * title, with the class and the styling that come with it. A heading in a
   * nested dialog belongs to the nested one, and the body that counts is only
   * a body in this dialog: if this dialog is itself in the body of another,
   * the outer body is not its body.
   */
  private headingOf(dialog: HTMLDialogElement): HTMLElement | null {
    return (
      [...dialog.querySelectorAll<HTMLElement>(LT_DIALOG_PARTS.title)].find(
        (heading) => {
          if (heading.closest("dialog") !== dialog) return false
          const body = heading.closest(LT_DIALOG_PARTS.body)
          return body === null || !dialog.contains(body)
        },
      ) ?? null
    )
  }

  /**
   * Whether the dialog has no name: no reference, no `aria-label` and no
   * title. An empty `<dialog>` is a region the server has not filled yet, and
   * does not count.
   */
  private nameless(dialog: HTMLDialogElement): boolean {
    return (
      dialog.childElementCount > 0 &&
      !dialog.hasAttribute("aria-labelledby") &&
      !dialog.hasAttribute("aria-label") &&
      this.headingOf(dialog) === null
    )
  }

  /**
   * Fills in what a template without JavaScript did not write: the class on
   * the dialog, and the title. The title is what `aria-labelledby` points to
   * when the server wrote it, otherwise the first heading outside the body,
   * and only when the dialog does not already have a name from `aria-label`.
   * The class and the id are written only on the title: a heading in the body
   * of a dialog with `aria-label` is not the title, and must not be styled as
   * one.
   */
  private wire(dialog: HTMLDialogElement): void {
    addClass(dialog, DIALOG_CLASS)

    const named = dialog.getAttribute("aria-labelledby")
    if (named) {
      // The attribute can list several ids. The title is the first one that
      // is inside the dialog.
      const root = this.getRootNode() as Document | ShadowRoot
      const title = named
        .split(/\s+/)
        .map((id) => root.getElementById?.(id) ?? null)
        .find((element) => element !== null && dialog.contains(element))
      if (title) addClass(title, DIALOG_TITLE_CLASS)
      return
    }
    if (dialog.hasAttribute("aria-label")) return

    const title = this.headingOf(dialog)
    if (!title) {
      warnAboutMarkup(
        this,
        "the dialog has no name: it has no aria-labelledby, no " +
          "aria-label and no heading outside the body, so a screen reader " +
          'announces it as "dialog" without saying what it is about. Give ' +
          "it a heading, or aria-label on the <dialog>.",
        () => {
          const now = this.dialog
          return now !== null && this.nameless(now)
        },
      )
      return
    }
    addClass(title, DIALOG_TITLE_CLASS)
    if (!title.id) {
      this.titleId ??= uniqueId("lt-dialog-title")
      setAttr(title, "id", this.titleId)
    }
    setAttr(dialog, "aria-labelledby", title.id)
  }

  private notify(open: boolean, returnValue = ""): void {
    // A dialog starts closed: one that never opened reported a close.
    if (open === (this.lastNotified ?? false)) return
    this.lastNotified = open
    this.dispatchEvent(
      new CustomEvent("dialog-toggle", {
        bubbles: true,
        // Without `composed` the event stops at a shadow root, and a listener
        // outside never learns that the dialog was closed.
        composed: true,
        detail: { open, returnValue },
      }),
    )
  }

  /**
   * Puts `open` back on a dialog that is still in the top layer.
   *
   * `showModal()` sets the attribute itself, and the server did not send it,
   * so the morph removes it. The browser's own stylesheet then hides a
   * `<dialog>` without `open`, and the dialog disappeared for the user in the
   * middle of what she was doing. Before, the template had to write
   * `data-preserve-attr="open"` to prevent it.
   *
   * The condition is `:modal` and not `this.open`, and that is precise: when
   * the user closes the dialog, it leaves the top layer, and then the missing
   * attribute is real. Only a dialog that is still modal without saying so is
   * a dialog someone has taken the attribute from.
   */
  private repairOpen(): void {
    const dialog = this.dialogElement
    if (!dialog?.isConnected || !dialog.matches(":modal") || dialog.open) {
      return
    }

    // The attribute must come back either way: without it `close()` does
    // nothing, and the dialog stayed in the top layer, invisible, with the
    // rest of the page inert.
    setAttr(dialog, "open", "")
    if (!isServerControlled(this)) return

    /*
     * The server decides the state, and the patch took `open` from a modal
     * dialog. Then the message is that it should close, not be put back.
     * Without this the dialog stood with `:modal` and `display: none`, and
     * nothing on the page could be clicked. The host follows along here, so
     * `handleClose` has nothing left to do and the event comes once.
     */
    dialog.close()
    // The event comes whoever removed `open` from the host. If React has
    // already taken it, in its order with children before parent, this is
    // the one time anyone can report it: `sync()` and `handleClose` then see
    // a dialog that is already closed, and stay quiet.
    if (this.open) this.removeAttribute("open")
    this.notify(false, dialog.returnValue)
  }

  private handleClose = (): void => {
    // `close` is queued, not synchronous. If the server manages to close and
    // open again in the same task, this event no longer applies, and without
    // the guard the component closed the dialog it had just opened.
    if (this.dialog?.matches(":modal")) return

    // If the server closed it, the host is already in step, and `sync()` has
    // reported it.
    if (!this.open) return

    this.removeAttribute("open")
    this.notify(false, this.dialog?.returnValue ?? "")
  }

  private sync(): void {
    const dialog = this.dialog

    // `showModal()` throws "The element is not in a Document" if the dialog
    // is not on the page. That is not theoretical: a morph builds the
    // server's version in a detached tree before comparing, and a web
    // component is used there too. Without this line the component threw on
    // every single patch that touched the dialog. If it is detached now,
    // `sync()` runs again anyway when it is connected.
    if (!dialog?.isConnected) {
      // Let go of a dialog that is gone. Otherwise the observer and the
      // listener stayed attached to a detached node for as long as the host
      // lived.
      if (!dialog) {
        this.openObserver?.disconnect()
        this.openObserver = undefined
        this.dialogElement?.removeEventListener("close", this.handleClose)
        this.dialogElement = undefined
      }

      warnAboutMarkup(
        this,
        "found no <dialog> as a direct child. Without it nothing can " +
          "open as a modal, and the content stays on the page as a plain " +
          "box.",
        // If the component is detached, a morph is building the server's
        // version in a separate tree, and there is nothing to report. An
        // empty element is a region the server has not filled yet.
        () => this.childElementCount > 0 && this.dialog === null,
      )
      return
    }

    this.wire(dialog)

    const first = dialog !== this.dialogElement
    if (first) {
      this.dialogElement?.removeEventListener("close", this.handleClose)
      this.dialogElement = dialog
      dialog.addEventListener("close", this.handleClose)

      this.openObserver?.disconnect()
      this.openObserver = new MutationObserver(() => this.repairOpen())
      this.openObserver.observe(dialog, { attributeFilter: ["open"] })
    }

    this.repairOpen()

    /*
     * Did the user close the dialog before the component got to run?
     *
     * The server writes `open` in both places, so the content exists without
     * JavaScript, and `<form method="dialog">` closes the box without
     * JavaScript too. If that happens before the script has loaded, there is
     * no listener, and the first `sync()` would see a host saying "open" and a
     * dialog that is closed, and open it again. So the dialog popped up again
     * right after the user had closed it, and on mobile the window was large
     * enough for it to happen every time.
     *
     * `returnValue` tells the two cases apart. The browser sets it to the
     * value of the button that closed the dialog, so a dialog that has never
     * been open has it empty. A template that only wrote `open` on the host,
     * as the documentation showed for a long time, also has it empty, and is
     * opened as before.
     *
     * This works only when the button has a `value`. If the dialog is closed
     * with a button without a value, or with `close()` without an argument,
     * the browser leaves nothing to look for, and the dialog opens again as it
     * did before. That is why every `<form method="dialog">` in the
     * documentation has a `value`, and it is worth keeping.
     */
    if (!upgradeChecked.has(dialog)) {
      upgradeChecked.add(dialog)
      if (this.open && !dialog.open && dialog.returnValue !== "") {
        this.removeAttribute("open")
        return
      }
    }

    // `:modal` and not `open`. The two are not the same: a `<dialog open>`
    // in the markup, and a dialog that was moved in the DOM while it was
    // open, have `open` without being modal. Then it is a box on the page,
    // without a focus trap and without Escape, which is exactly what the
    // component exists to prevent.
    const modal = dialog.matches(":modal")

    /*
     * The user has just closed the dialog with a button, and `close` has not
     * arrived yet. The browser removes `open` at once and sends the event in a
     * later task, and the host still says "open" until `handleClose` gets to
     * run. When something wrote `open` on the host in the meantime, such as a
     * framework setting the same value again, the component opened the dialog
     * again and cleared `returnValue`, and a listener on `close` read an empty
     * value instead of "cancel". `returnValue` is cleared every time the
     * dialog opens, so a value here comes from a button in this round.
     */
    if (
      this.open &&
      !modal &&
      this.lastNotified === true &&
      dialog.returnValue !== ""
    ) {
      return
    }

    if (this.open && !modal) {
      /*
       * `showModal()` throws `InvalidStateError` when `open` is already there
       * without the dialog being modal. So the attribute must go first.
       *
       * But not with `close()`. It sends a real `close` event, and since the
       * server now writes `open` on the `<dialog>` itself, that event would
       * have come on every single load of a dialog that is open. An app
       * listening for `close` directly on the `<dialog>`, as the complete
       * example in the documentation does, then got a phantom close before the
       * user had seen the dialog. `removeAttribute` makes room without the
       * event.
       */
      dialog.removeAttribute("open")
      /*
       * Escape and `close()` without an argument leave the previous
       * `returnValue` in place. A dialog the server opened again then
       * reported "cancel" from last time when it was closed from the server,
       * and the app that tells "Keep the job" from "Cancel the job" by the
       * value cancelled something the user never asked for.
       */
      dialog.returnValue = ""
      dialog.showModal()
      this.notify(true)
    } else if (!this.open && (modal || dialog.open)) {
      /*
       * `modal` and not only `dialog.open`: the attribute can be gone while
       * the dialog is still in the top layer.
       *
       * React is the reason. The server writes `open` on the `<dialog>`, so
       * React manages the attribute, and React updates children before the
       * parent. When the app closes the dialog, React first removes `open`
       * from the `<dialog>` and then from `<lt-dialog>`. So we get here with
       * `dialog.open` already false.
       *
       * `close()` does nothing without the attribute, so without this the
       * dialog stayed in the top layer, invisible, with the rest of the page
       * inert. The user was left with a page where nothing could be clicked,
       * and nothing visible to explain why.
       */
      setAttr(dialog, "open", "")
      dialog.close()
      this.notify(false, dialog.returnValue)
    }
  }
}

export function defineLtDialog(tagName: string = LT_DIALOG_TAG): void {
  defineElement(tagName, LtDialog)
}
