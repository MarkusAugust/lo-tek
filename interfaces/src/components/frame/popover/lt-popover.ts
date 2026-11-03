import {
  addClass,
  defineElement,
  HostElement,
  isServerControlled,
  SERVER_CONTROLLED,
  setAttr,
  setFlag,
  warnAboutMarkup,
} from "../../host-element.js"
import {
  isPopoverPlacement,
  POPOVER_CLASS,
  type PopoverPlacement,
} from "./popover.js"

export const LT_POPOVER_TAG = "lt-popover" as const

/**
 * The parts the popover finds, as selectors relative to the element. The
 * component finds the parts with these, and the manifest describes them for
 * whoever assembles the markup by hand, so the two cannot say different things.
 */
export const LT_POPOVER_PARTS = {
  trigger: "button, [role='button']",
  panel: `[popover], .${POPOVER_CLASS}`,
} as const

/**
 * A panel that hangs below a button, and closes itself.
 *
 * The panel uses the browser's own `popover`, so it goes into the top layer
 * and lies above everything else without `z-index`. `lt.popover()` writes
 * `popover="manual"`, so Escape and clicks outside are handled by the
 * component: with `auto` the browser closed the panel before the button got
 * its click, and the button could not be used to close it again. Handwritten
 * markup with a bare `popover` is `auto`, and then the component follows along
 * when the browser closes it.
 *
 * What the top layer does not do is place the panel. `position-anchor` is not
 * yet in every browser, so the position is worked out here.
 *
 * When the markup is made with a builder function, `lt.popover()` writes the
 * wiring: `aria-controls` on the button, and the class, the id and `popover`
 * on the panel. When the markup comes from a template without one, the
 * template writes a button and a panel with the class `lt-popover` and an id:
 * the component sets `popover="manual"` and writes `aria-controls` on the
 * button from the id. Only what is missing, so what the server wrote stays.
 * The component sets `open` on the host, `aria-expanded` on the button and the
 * position on the panel, and puts back everything it has written when a patch
 * removes it. The template needs no `data-preserve-attr`.
 *
 * The component never writes an id on the panel. Datastar and idiomorph
 * recognise an element by its id, and a panel with an id the server did not
 * send was replaced on the next patch, along with focus and what the user had
 * done in it. Without an id the panel is kept, but the button cannot be
 * connected to it with `aria-controls`, and the component says so in the
 * console.
 *
 * The repair works one way: if someone has asked for the popover to be open,
 * it stays open through a patch. If the server sends `open`, it opens, since
 * that is something the server actually said.
 *
 * For the server to decide the state, set `server-controlled` on the host.
 * That is also the answer when the page controls `open` with an attribute from
 * outside, as with Datastar's `data-attr:open`: a removed attribute cannot be
 * told apart from a morph, while `menu.open = false` is a message the
 * component can see.
 *
 * ```html
 * <lt-popover placement="bottom-end">
 *   <button class="lt-button" aria-controls="menu" aria-expanded="false">Actions</button>
 *   <ul id="menu" class="lt-popover" popover="manual">…</ul>
 * </lt-popover>
 * ```
 */
export class LtPopover extends HostElement {
  static observedAttributes = ["open", "placement", SERVER_CONTROLLED] as const

  private panel?: HTMLElement
  private triggerElement?: HTMLElement
  private observer?: MutationObserver
  /**
   * What the component was last asked for, through the `open` property.
   *
   * `open` lives on the host, and a morph removes everything that is not in
   * the server's HTML. Without anything more, every single patch closed a
   * popover the user had just opened.
   *
   * A removed attribute looks the same whoever removed it, so the component
   * cannot tell a morph from an app. The distinction is instead **how** the app
   * says it: if it goes through the property, as in `menu.open = false`,
   * `hide()` or `toggle()`, that is a message, and it is followed. If something
   * sets the attribute directly, as Datastar's `data-attr:open` does, it cannot
   * be told apart from a morph, and then the page should say
   * `server-controlled` and let the server decide the state.
   */
  private wantsOpen = false

  /** Whether the panel is open. Mirrored, so CSS can match the state. */
  get open(): boolean {
    return this.hasAttribute("open")
  }

  set open(value: boolean) {
    // The message is noted here, and not in `show()` and `hide()`. Both go
    // through the setter, but so does `menu.open = false` from an app, and
    // without this the component set the attribute straight back again.
    //
    // No memory when the server decides the state. Without that guard the
    // popover popped open by itself the moment `server-controlled` was removed.
    this.wantsOpen = isServerControlled(this) ? false : value
    setFlag(this, "open", value)
  }

  /** Which edge the panel hangs from. Default: `bottom-start`. */
  get placement(): PopoverPlacement {
    const value = this.getAttribute("placement")
    return isPopoverPlacement(value) ? value : "bottom-start"
  }

  set placement(value: PopoverPlacement) {
    setAttr(this, "placement", value)
  }

  connectedCallback(): void {
    window.addEventListener("resize", this.reposition)
    window.addEventListener("scroll", this.reposition, true)
    /*
     * The attributes are included, not only the children. `aria-expanded` on the
     * button and the position on the panel are something the component works
     * out, so if a patch removes them, they must come back. Every write in
     * `sync()` compares first, or the observer would trigger itself.
     */
    this.observer = new MutationObserver((records) => {
      // `type` concerns only the button. A password field in the panel that
      // switches between `password` and `text` must not run all of `sync()`.
      const onlyOtherTypes = records.every(
        (record) =>
          record.attributeName === "type" &&
          record.target !== this.triggerElement,
      )
      if (!onlyOtherTypes) this.sync()
    })
    this.observer.observe(this, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "aria-expanded",
        "style",
        // The wiring the component fills in when the markup came without it.
        "popover",
        "id",
        "aria-controls",
        "class",
        // A patch from a template without `type` removes it, and then the
        // button submits the form again.
        "type",
      ],
    })
    this.sync()
  }

  disconnectedCallback(): void {
    window.removeEventListener("resize", this.reposition)
    window.removeEventListener("scroll", this.reposition, true)
    document.removeEventListener("click", this.handleOutsideClick, true)
    document.removeEventListener("keydown", this.handleKeydown)
    this.observer?.disconnect()
    this.observer = undefined
    this.triggerElement?.removeEventListener("click", this.handleTriggerClick)
    this.panel?.removeEventListener("toggle", this.handlePanelToggle)
    // The reference must be reset, or `sync()` sees that the button is the
    // same when the element is inserted again, and skips attaching the listener
    // again. Then the panel can no longer be opened.
    this.triggerElement = undefined
    this.panel = undefined
  }

  attributeChangedCallback(name: string): void {
    // `server-controlled` turned on midway: the component lets go, and the
    // next patch decides.
    if (name === SERVER_CONTROLLED && isServerControlled(this)) {
      this.wantsOpen = false
    }

    if (this.isConnected) this.sync()
  }

  private sync(): void {
    /*
     * Puts `open` back when a patch took it.
     *
     * One way only: if `open` is there, the popover is open, and then either the
     * user or the server has said so. If it is gone while the user opened it, the
     * morph took it, and then it comes back.
     */
    const repairing = this.wantsOpen && !this.open && !isServerControlled(this)
    if (repairing) {
      /*
       * Wait until the whole patch has landed before opening the popover again.
       *
       * A morph sets one attribute at a time, and `open` comes before
       * `server-controlled` in document order. When the component repaired at
       * once, it put `open` back while the server was in the middle of saying it
       * was taking over the state, and the popover stayed open afterwards.
       * `queueMicrotask` runs after the whole patch is done, and the condition is
       * checked again there.
       *
       * Until then the panel stays as it is: closing it while the repair waits
       * took the focus from a button in it to the trigger on every patch.
       * When the repair is called off, `sync()` closes the panel for real.
       */
      queueMicrotask(() => {
        if (!this.isConnected) return
        if (!isServerControlled(this) && this.wantsOpen && !this.open)
          setFlag(this, "open", true)
        else this.sync()
      })
    }

    // The parts are recognised by the wiring that must be there anyway: the
    // panel is the one with `popover`, and the button is the one pointing to the
    // panel with `aria-controls`. Before, the button had `slot="trigger"`, a
    // leftover from the time the component had shadow DOM. Without a shadow
    // root `slot` does nothing in HTML, so the attribute was a label that looked
    // like something it was not.
    const panel = this.findPanel()
    if (panel) {
      // Only what is missing. A template may have written `popover` without a
      // value, and that is `auto`; then the component follows along when the
      // browser closes it.
      addClass(panel, POPOVER_CLASS)
      if (!panel.hasAttribute("popover")) setAttr(panel, "popover", "manual")
      // Never an id on the panel: see the comment at the top. Without an id there
      // is nothing for `aria-controls` to point to.
      warnAboutMarkup(
        this,
        "the panel has no id, so the button cannot be connected to it " +
          "with aria-controls. Write an id on the panel in the template, " +
          'such as id="menu", and the same value in aria-controls on the ' +
          "button.",
        () => {
          const found = this.findPanel()
          return found !== null && !found.id
        },
      )
    }
    const trigger = panel ? this.findTrigger(panel) : null
    if (panel?.id && trigger && !trigger.hasAttribute("aria-controls")) {
      setAttr(trigger, "aria-controls", panel.id)
    }
    // A `<button>` without `type` is a submit button, and so is one with an
    // empty or unknown `type`, which a template can write. A help popover next
    // to a field sits inside the form, and a click to open it submitted the
    // form, or brought up the error summary, instead of showing the panel. A
    // button that says `submit` itself is left alone.
    if (
      trigger instanceof HTMLButtonElement &&
      trigger.type === "submit" &&
      trigger.getAttribute("type")?.toLowerCase() !== "submit"
    ) {
      setAttr(trigger, "type", "button")
    }

    if (!trigger || !panel) {
      /*
       * Two different faults, and a message for each, so the developer looks in
       * the right place. An empty element is a region the server has not filled
       * yet, and that is not a fault in the markup.
       */
      const isEmpty = () => this.childElementCount === 0

      if (!panel) {
        warnAboutMarkup(
          this,
          "found no panel: an element with popover or the class " +
            "lt-popover. Without one there is nothing to open or position.",
          () => !isEmpty() && this.findPanel() === null,
        )
      } else {
        warnAboutMarkup(
          this,
          "found no button: neither one with aria-controls pointing to " +
            "the panel nor a <button> outside the panel. Without it the " +
            "component does not know what opens the popover.",
          () => {
            const found = this.findPanel()
            return !isEmpty() && found !== null && !this.findTrigger(found)
          },
        )
      }

      /*
       * Let go of what we had. When a patch removed the panel, the component
       * otherwise held on to a detached node, and `reposition()` kept working out
       * the position of something that is not on the page.
       *
       * The listeners on `document` must go too. Without that they stayed in the
       * capture phase for as long as the markup was broken, and a click anywhere
       * on the page gave the app a `popover-toggle` it had not asked for.
       */
      this.triggerElement?.removeEventListener("click", this.handleTriggerClick)
      this.triggerElement = undefined
      this.panel?.removeEventListener("toggle", this.handlePanelToggle)
      this.panel = undefined
      document.removeEventListener("click", this.handleOutsideClick, true)
      document.removeEventListener("keydown", this.handleKeydown)
      return
    }

    if (this.triggerElement !== trigger) {
      this.triggerElement?.removeEventListener("click", this.handleTriggerClick)
      trigger.addEventListener("click", this.handleTriggerClick)
      this.triggerElement = trigger
    }
    if (this.panel !== panel) {
      if (this.panel) this.warnAboutReplacedPanel(this.panel, panel)
      /*
       * The state is in the markup as `:popover-open`, and is read from there.
       * When the browser closes a `popover="auto"` itself, because another one
       * opens or the user clicks outside, `toggle` reports it. Without the
       * listener the host kept `open` and the button `aria-expanded="true"` over a
       * closed panel, and the next click did nothing visible.
       */
      this.panel?.removeEventListener("toggle", this.handlePanelToggle)
      panel.addEventListener("toggle", this.handlePanelToggle)
      this.panel = panel
    }

    // Shown while a repair waits, so the button says the same as the panel.
    const shown = this.open || repairing

    // Written by the component, and set again if a patch took it.
    setAttr(trigger, "aria-expanded", String(shown))

    if (shown) {
      if (!panel.matches(":popover-open")) panel.showPopover()
      this.reposition()
      document.addEventListener("click", this.handleOutsideClick, true)
      document.addEventListener("keydown", this.handleKeydown)
    } else {
      if (panel.matches(":popover-open")) {
        /*
         * Focus in the panel goes back to the button, whatever closed it:
         * `hide()`, `toggle()`, the server taking `open`. Otherwise it stays
         * on a button that is no longer shown, and the next key press starts
         * at the top of the page. Escape did this alone before. Focus
         * elsewhere, such as a field the user clicked outside, stays.
         */
        const inside = panel.contains(document.activeElement)
        panel.hidePopover()
        if (inside) trigger.focus()
      }
      document.removeEventListener("click", this.handleOutsideClick, true)
      document.removeEventListener("keydown", this.handleKeydown)
    }
  }

  /**
   * Says so when a patch replaced the open panel because the id from the
   * server changed.
   *
   * Datastar and idiomorph recognise an element by its id, and a new id is a
   * new element to them. The component opens the new panel again, but focus,
   * and what the user typed in a field in it, are gone. It happens when the
   * template builds the id from something that changes between renders, such
   * as a random number or a counter.
   *
   * The message comes only when the popover was open and both panels had an id
   * from the server, with different values. A panel without an id is kept by
   * the morph, and a server that deliberately sends another panel while the
   * popover is closed has nothing to fix.
   */
  private warnAboutReplacedPanel(lost: HTMLElement, panel: HTMLElement): void {
    if (lost.isConnected || !this.wantsOpen) return
    if (!lost.id || !panel.id || lost.id === panel.id) return

    warnAboutMarkup(
      this,
      "a server update replaced the panel while it was open, because " +
        "the panel's id was different from last time and the update did " +
        "not recognise it. The panel is opened again, but focus and " +
        "what the user did in it are lost; build the id from something " +
        "that is the same every time, not from a random number or a " +
        "counter.",
      // The replacement has happened and cannot undo itself, unless a new
      // update has already replaced the panel again.
      () => !lost.isConnected && this.findPanel() === panel,
    )
  }

  /** The panel: the one with `popover`, otherwise the one with the class. */
  private findPanel(): HTMLElement | null {
    return this.querySelector<HTMLElement>(LT_POPOVER_PARTS.panel)
  }

  /**
   * The button: the one pointing to the panel with `aria-controls`, otherwise
   * the first button outside the panel that does not point to anything else. A
   * button with an `aria-controls` pointing elsewhere is not a fallback: then
   * the server has said something else, and that is not to be guessed around.
   */
  private findTrigger(panel: HTMLElement): HTMLElement | null {
    if (panel.id) {
      const pointing = this.querySelector<HTMLElement>(
        `[aria-controls="${CSS.escape(panel.id)}"]`,
      )
      if (pointing) return pointing
    }
    return (
      [...this.querySelectorAll<HTMLElement>(LT_POPOVER_PARTS.trigger)].find(
        (button) =>
          !panel.contains(button) && !button.hasAttribute("aria-controls"),
      ) ?? null
    )
  }

  private handleTriggerClick = (): void => {
    const closing = this.open
    this.toggle()
    // Safari gives a clicked button no focus: focus in the panel went to
    // `<body>` with the click, before the panel closed, and `sync()` did not
    // see it there. The other browsers have given the button focus already.
    if (closing && document.activeElement === document.body)
      this.triggerElement?.focus()
  }

  private handlePanelToggle = (event: Event): void => {
    const state = (event as ToggleEvent).newState
    /*
     * The event applies only when it matches the panel. `toggle` is delivered as
     * a separate task, after everything that happened in the same round, and can
     * describe a state that has already changed. A patch that takes `open` on
     * the host and `popover` on the panel in the same morph closes the panel
     * here in `sync()`, reopens it in the microtask afterwards, and only then
     * does "closed" arrive from the close. Before, it was taken as the user's,
     * and the popover the user had open stayed closed after a patch that said
     * nothing about it.
     *
     * The component's own `showPopover()` and `hidePopover()` also fire the
     * event, but then `open` already matches, and nothing happens.
     */
    const showing = (event.currentTarget as Element).matches(":popover-open")
    if (state === "closed" && this.open && !showing) this.hide()
    else if (state === "open" && !this.open && showing) this.show()
  }

  private handleOutsideClick = (event: Event): void => {
    // `composedPath()` and not `target`: when the component is in a shadow
    // root, `target` is retargeted to the shadow host, and a click in the panel
    // itself looked like a click outside.
    const target = event.composedPath()[0] as Node
    if (this.contains(target) || this.panel?.contains(target)) return
    this.hide()
  }

  private handleKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !this.open) return
    // Something else has already used the key press, such as a suggestion list
    // that closed. Without this one press closed both the list and the popover.
    if (event.defaultPrevented) return

    // `composedPath()` and not `contains`: a field in a shadow root in the
    // panel is not in the tree `contains` sees, and a press there closed nothing.
    const path = event.composedPath()
    for (const node of path) {
      if (node === this) break
      // An open popover inside this one is closer. It takes the press, and this
      // one closes on the next. The listeners are both on `document`, and the
      // outer one came first: before, it closed and left the inner one open.
      if (node instanceof LtPopover && node.open) return
      // A modal dialog opened on top of the popover is closed by its own press.
      if (
        node instanceof HTMLDialogElement &&
        node.matches(":modal") &&
        !node.contains(this)
      ) {
        return
      }
    }

    /*
     * Focus is moved back only when it was in the popover, or nowhere else: on
     * `body`, or on a dialog or a `<main tabindex="-1">` the popover is in. A
     * mouse click does not give the button focus in Safari, and inside a modal
     * dialog the dialog gets the focus. If focus was in another field, it stays
     * there. Before, it jumped to the button.
     */
    const target = path[0]
    const fromWindow =
      path.includes(this) || (target instanceof Node && target.contains(this))

    // Used here. Without this it also closed a modal dialog the popover was
    // in: one press took both, and the user lost the dialog.
    event.preventDefault()
    this.hide()
    // Without this focus is on a panel that no longer exists, and the next
    // key press starts at the top of the page.
    if (fromWindow) this.triggerElement?.focus()
  }

  /** Works out where the panel goes, against the button's place on screen. */
  private reposition = (): void => {
    if (!this.open || !this.panel || !this.triggerElement) return

    const anchor = this.triggerElement.getBoundingClientRect()
    const panel = this.panel.getBoundingClientRect()
    const space = 4

    const below = this.placement.startsWith("bottom")
    // `start` and `end` follow the reading direction: in a right-to-left
    // document `start` is the button's right edge. Without this the panel was on
    // the wrong side of the button in RTL. `:dir(rtl)` and not `direction` from
    // `getComputedStyle`: the stylesheet flips the value with `:dir(rtl)`, so
    // both read the HTML direction from `dir`. A page that sets
    // `direction: rtl` in CSS without `dir` is not flipped, neither here nor in
    // the stylesheet, as with the background icons.
    const rtl = this.panel.matches(":dir(rtl)")
    const alignRight = this.placement.endsWith("end") !== rtl

    let top = below ? anchor.bottom + space : anchor.top - panel.height - space
    let left = alignRight ? anchor.right - panel.width : anchor.left

    // The panel must not end up off screen. If it goes out at the side, it is
    // moved in. If there is no room on the side of the button the placement asks
    // for, it goes on the other side, and is then clamped into the viewport
    // either way. `top-*` lacked the last part, and a panel at the top of the
    // page lay entirely off screen, with no way to scroll it into view.
    left = Math.max(
      space,
      Math.min(left, window.innerWidth - panel.width - space),
    )
    if (below && top + panel.height > window.innerHeight) {
      top = anchor.top - panel.height - space
    } else if (!below && top < space) {
      top = anchor.bottom + space
    }
    top = Math.max(
      space,
      Math.min(top, window.innerHeight - panel.height - space),
    )

    this.panel.style.setProperty("--lt-popover-top", `${Math.round(top)}px`)
    this.panel.style.setProperty("--lt-popover-left", `${Math.round(left)}px`)
  }

  private emit(open: boolean): void {
    this.dispatchEvent(
      new CustomEvent("popover-toggle", {
        detail: { open },
        bubbles: true,
        composed: true,
      }),
    )
  }

  /**
   * Opens the panel. Through the setter also when it is open already, as
   * when the server sent `open`: the call is the app's message, and without
   * it the next patch without `open` closed the panel.
   */
  show(): void {
    const was = this.open
    this.open = true
    if (!was) this.emit(true)
  }

  /** Closes the panel. Through the setter also when it is closed, as `show()`. */
  hide(): void {
    const was = this.open
    this.open = false
    if (was) this.emit(false)
  }

  /** Opens or closes. */
  toggle(): void {
    if (this.open) this.hide()
    else this.show()
  }
}

export function defineLtPopover(tagName: string = LT_POPOVER_TAG): void {
  defineElement(tagName, LtPopover)
}
