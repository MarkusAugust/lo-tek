import {
  addClass,
  defineElement,
  HostElement,
  setAttr,
  warnAboutMarkup,
} from "../../host-element.js"
import {
  ERROR_SUMMARY_CLASS,
  ERROR_SUMMARY_TITLE_CLASS,
} from "./error-summary.js"
export const LT_ERROR_SUMMARY_TAG = "lt-error-summary" as const

/**
 * The parts the error summary looks for, as selectors relative to the
 * element. The component finds its parts with these, and the manifest
 * describes them for whoever assembles the markup by hand, so the two cannot
 * say different things.
 */
export const LT_ERROR_SUMMARY_PARTS = {
  title: "h1, h2, h3, h4, h5, h6",
  link: "li a[href^='#']",
} as const

/**
 * Takes the user from an error in the summary to the field that failed.
 *
 * The server writes the content: the heading and the list of links. When the
 * markup is written with JavaScript, `lt.errorSummary()` also writes the
 * class, `role="alert"` and `tabindex="-1"` on the box, and the component
 * leaves them alone. When the markup comes from a template without
 * JavaScript, the component fills in those three and the class on the
 * heading, and sets them back when a patch removes them. Either way, a box
 * without a name gets `aria-labelledby` pointing at its heading. The component
 * creates no nodes: it used to, and then the heading disappeared on the
 * first morph in Datastar and never came back.
 *
 * What is left are two things the browser does not do by itself:
 *
 * 1. Focus moves to the box when it becomes visible, so someone listening to
 *    the page learns that the submission stopped.
 * 2. Focus goes to the control itself when a link is followed. A plain anchor
 *    link only gives focus to a target that can take it; if it points to a
 *    label or a heading, `document.activeElement` becomes `<body>`, and the
 *    screen reader is not told where the user is. Tab continues from the
 *    target either way.
 *
 * ```html
 * <lt-error-summary>
 *   <h2>The form has two errors</h2>
 *   <ul class="lt-list">
 *     <li><a href="#fixer">Enter a valid address</a></li>
 *   </ul>
 * </lt-error-summary>
 * ```
 */

/** Decodes a fragment, and returns it untouched if it is not valid. */
function decodeFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment)
  } catch {
    return fragment
  }
}

export class LtErrorSummary extends HostElement {
  static observedAttributes = ["data-autofocus", "hidden"] as const

  private hasFocused = false
  /**
   * Whether the component has tried to move focus since the box last became
   * visible.
   *
   * The first attempt happens wherever focus is: a new submission has
   * failed, and that is the message. If it did not land, because the box was
   * in a hidden panel, the component tries again on the next change to the
   * list, but only when nobody is in a field. Without that distinction the
   * retry pulled focus out of the field the user was correcting, as soon as
   * live validation patched the list.
   */
  private focusAttempted = false
  /** Where focus was when `hidden` last changed, until the deferred round has run. */
  private focusBefore: Element | null | undefined
  private observer?: MutationObserver
  /**
   * The `aria-labelledby` the component wrote on the box, or null. Another
   * value there is the server's, and stays; the component's own follows the
   * heading, so a patch that replaces the heading does not leave the name
   * pointing at an id that is gone.
   */
  private labelledByWritten: string | null = null

  connectedCallback(): void {
    // One listener on the host, not one per link. The set of links was only
    // emptied on disconnect, so every link a patch replaced stayed in
    // memory.
    this.addEventListener("click", this.handleLinkClick)
    // The errors come and go while the user corrects them, and `slotchange`
    // does not fire in plain DOM. The attributes are the ones the component
    // fills in itself, so a patch that removes them gets them back. Every
    // write compares first, or the observer would trigger itself.
    // An id only matters on the heading, which the name points at, and a
    // name only on the box. The same attributes on a link or a field inside
    // the box are not ours to follow.
    this.observer = new MutationObserver((records) => {
      const relevant = records.some((r) => {
        if (r.attributeName === "id")
          return (r.target as Element).matches(LT_ERROR_SUMMARY_PARTS.title)
        if (
          r.attributeName === "aria-label" ||
          r.attributeName === "aria-labelledby"
        )
          return r.target === this
        return true
      })
      if (relevant) this.sync()
    })
    this.observer.observe(this, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "class",
        "role",
        "tabindex",
        "aria-labelledby",
        "aria-label",
        "id",
      ],
    })
    this.sync()
  }

  attributeChangedCallback(): void {
    /*
     * The server can send the box hidden and later only remove `hidden` on
     * the same node. Without this, a summary that just became visible never
     * gets focus, and that is the whole reason the component exists.
     *
     * A microtask later, not now. A morph sets `hidden` in its attribute
     * pass, before it updates the children; focus moved then made the box
     * the focused element, and idiomorph with `ignoreActiveValue` leaves the
     * children of the focused element as they were, so the new errors never
     * arrived. Found by the code review of PR 240.
     */
    // Where focus was when the box was shown. React gives it back there
    // after the commit, and the box takes it anyway; a script that moves it
    // somewhere else in the same turn has decided, and the box leaves it.
    this.focusBefore ??= document.activeElement
    // Hidden: let go of focus now, in the morph's attribute pass, so the
    // morph still updates the content (see `sync()`).
    if (this.hidden) this.blurInside()
    queueMicrotask(() => {
      if (this.isConnected) this.sync()
      this.focusBefore = undefined
    })
  }

  /** Takes focus off the box, or off a link in it. */
  private blurInside(): void {
    const focused = (this.getRootNode() as Document | ShadowRoot).activeElement
    if (focused instanceof HTMLElement && this.contains(focused)) focused.blur()
  }

  disconnectedCallback(): void {
    this.observer?.disconnect()
    this.observer = undefined
    this.removeEventListener("click", this.handleLinkClick)
  }

  /**
   * Whether the box takes focus when it becomes visible. Default: yes.
   *
   * The attribute is called `data-autofocus` and not `autofocus`, even
   * though the latter reads better. `autofocus` is a boolean property on
   * `HTMLElement`, and React 19 sets properties rather than attributes on web
   * components. `autofocus="false"` then became `el.autofocus = "false"`,
   * which is true, while the attribute never reached the markup, and the
   * opt-out did not work. `data-*` is passed on as an attribute in every
   * React version.
   */
  private get shouldFocus(): boolean {
    return this.dataset.autofocus !== "false"
  }

  /**
   * Fills in what a template without JavaScript did not write. Only what is
   * missing: a role the server chose stays, and so does a `tabindex`.
   */
  private wire(): void {
    addClass(this, ERROR_SUMMARY_CLASS)
    if (!this.hasAttribute("role")) setAttr(this, "role", "alert")
    // Without `tabindex`, `focus()` does nothing, and the whole reason for
    // the component silently disappears.
    if (!this.hasAttribute("tabindex")) setAttr(this, "tabindex", "-1")

    const title = this.querySelector(LT_ERROR_SUMMARY_PARTS.title)
    if (title) addClass(title, ERROR_SUMMARY_TITLE_CLASS)

    /*
     * The box takes focus, so it needs a name: without one a screen reader
     * says only "alert" when the focus lands, and the heading is what says
     * how many errors there are. The template writes the heading's id and
     * the box's `aria-labelledby`, as it writes `for` and `id` on a field;
     * `lt.errorSummary({ id })` writes both. The component never writes an
     * id: Datastar and idiomorph replace an element whose id the server did
     * not send, so an id from the component gave the heading a new one on
     * every patch. When the heading has an id and the box no name, the
     * component points `aria-labelledby` at it, and follows a heading a
     * patch has replaced. A blank `aria-label` or `aria-labelledby` names
     * nothing, so it counts as missing.
     * `check-accessibility-tree.ts` checks the name a screen reader gets.
     */
    const labelledBy = this.getAttribute("aria-labelledby")?.trim() || null
    const label = this.getAttribute("aria-label")?.trim() || null
    const ours = labelledBy !== null && labelledBy === this.labelledByWritten
    if (labelledBy !== null && !ours) this.labelledByWritten = null
    if (title?.id && label === null && (labelledBy === null || ours)) {
      setAttr(this, "aria-labelledby", title.id)
      this.labelledByWritten = title.id
    } else if (ours) {
      // The heading is gone or lost its id, or the server named the box
      // with `aria-label`, which `aria-labelledby` would otherwise win over.
      this.removeAttribute("aria-labelledby")
      this.labelledByWritten = null
    }
    if (title && !title.id && label === null && labelledBy === null)
      warnAboutMarkup(
        this,
        "has a heading without an id and no name, so it takes focus as an alert a screen reader cannot name. Give the heading an id and the box aria-labelledby pointing at it, as lt.errorSummary({ id }) does.",
        () => {
          const now = this.querySelector(LT_ERROR_SUMMARY_PARTS.title)
          return (
            this.isConnected &&
            now !== null &&
            !now.id &&
            !this.getAttribute("aria-label")?.trim() &&
            !this.getAttribute("aria-labelledby")?.trim()
          )
        },
      )
  }

  private sync(): void {
    this.wire()

    const links = [
      ...this.querySelectorAll<HTMLAnchorElement>(LT_ERROR_SUMMARY_PARTS.link),
    ]

    // If the server hides the box again, that submission is over. Without
    // this reset the box only took focus the first time: the pattern in a
    // Datastar app is that the list keeps the same links throughout and only
    // `hidden` is toggled, so "have I moved focus here before" does not
    // answer whether this is a new submission. It comes before the return
    // for an empty list: React removes the items before it sets `hidden` on
    // the host, so the list is already empty in the round where the box is
    // hidden.
    if (this.hidden) {
      this.hasFocused = false
      this.focusAttempted = false
      /*
       * A hidden box gives up focus. HTML's focus fixup rule moves focus
       * off an element that is no longer rendered; Chromium does it at
       * once, Firefox and WebKit left it on the hidden box. idiomorph leaves
       * the content of the focused element as it was, so the next errors
       * the server sent never reached the box, which then showed an empty
       * heading and list. Found by the model test.
       */
      this.blurInside()
    }

    if (links.length === 0) {
      // The flags are not reset by an empty list, only by `hidden` above. A
      // visible list that is emptied and filled while the user corrects
      // would otherwise pull focus out of the field they were in.
      warnAboutMarkup(
        this,
        "found no links to the fields. Each item needs an <a " +
          'href="#id"> pointing to the control or its label, or the user ' +
          "cannot get from the error to the field.",
        // An empty box is not an error: the pattern is that the server leaves
        // it with `hidden` and fills it when the submission fails. A box with
        // items but no links to the fields is something else.
        () =>
          this.querySelector("li") !== null &&
          this.querySelector(LT_ERROR_SUMMARY_PARTS.link) === null,
      )
      return
    }

    for (const link of links) {
      /*
       * A link that leads nowhere, reported here and not only on a click.
       *
       * The check used to be only in the click handler, and then a box with a
       * link to a field that does not exist was completely silent until
       * someone actually followed it. An error summary is read by someone who
       * just failed with a form, and a link that does not work is exactly
       * what makes the box worthless. The id is in the message, and each link
       * has its own, so a box with two broken links reports both.
       */
      const id = link.getAttribute("href")?.slice(1)
      if (id) {
        warnAboutMarkup(
          this,
          `the link points to #${id}, but no element has that id. The link scrolls nowhere, and focus stays where it is.`,
          () => this.resolveTarget(id) === null,
        )
      }
    }

    if (this.hidden) return

    // If the box is visible now and we have not moved focus here yet, it is
    // this submission that failed. The flag is only set when focus actually
    // landed: if the box is in a hidden panel or a closed dialog, `focus()`
    // does nothing, and the next attempt is then allowed, as long as nobody
    // is in a field.
    if (this.shouldFocus && !this.hasFocused) {
      // `document.activeElement` and not the root's: if the box is in a
      // shadow root and the field in plain DOM, the root's `activeElement` is
      // null, and the user would have counted as "nobody". The document's
      // points to the shadow host when focus is in a shadow tree, and is
      // never null for a field on the page.
      const active = document.activeElement
      const nobodyTyping = !active || active === document.body
      if (this.focusAttempted && !nobodyTyping) return
      const movedByScript =
        this.focusBefore !== undefined &&
        active !== this.focusBefore &&
        !nobodyTyping
      if (movedByScript) return
      const root = this.getRootNode() as Document | ShadowRoot

      this.focusAttempted = true
      this.focus()
      this.hasFocused = root.activeElement === this
      if (
        this.hasFocused &&
        root === document &&
        active &&
        active !== document.body
      )
        this.reclaimFocusFrom(active)
    }
  }

  /**
   * Takes focus back once, if it went back to where it was.
   *
   * React gives focus back to the element that had it before a commit, right
   * after the DOM has changed. The box moves focus as `hidden` is removed or
   * as it is connected, that is inside the same commit, so focus ended up on
   * the submit button again in Chromium and Firefox, and on the field in all
   * three engines when the form was submitted with Enter. A microtask runs
   * after the commit. If focus is then on the same element as before, the
   * framework took it, and the box takes it again. If a script has moved
   * focus somewhere else, it stays.
   *
   * Only when the box is directly in the document. React does not enter a
   * shadow root when it restores focus, and there `document.activeElement`
   * is the shadow host both before and after, so the comparison would take
   * focus from a field in the same root. The condition is deliberately
   * coarse: a box portalled into a shadow root from a React app in plain DOM
   * does not take focus back.
   */
  private reclaimFocusFrom(previous: Element): void {
    queueMicrotask(() => {
      if (
        this.isConnected &&
        !this.hidden &&
        document.activeElement === previous
      )
        this.focus()
    })
  }

  /**
   * The element a link points to.
   *
   * The lookup goes to the root the component is in, not to `document`. If
   * the form is in a shadow root, as in a preview or inside another
   * component, `document.getElementById` finds nothing, and the link becomes
   * a plain anchor link without moving focus.
   */
  private resolveTarget(raw: string): HTMLElement | null {
    const root = this.getRootNode() as Document | ShadowRoot
    // A link to a field with non-ASCII characters in its id is often
    // percent-encoded, `#f%C3%B8dselsdato`. The browser decodes it when the
    // link is followed, so the lookup must do the same, or a working link is
    // reported.
    for (const id of new Set([raw, decodeFragment(raw)])) {
      const target = root.getElementById?.(id) ?? document.getElementById(id)
      if (target) return target
    }
    return null
  }

  private handleLinkClick = (event: Event): void => {
    const link = (event.target as Element | null)?.closest?.(
      LT_ERROR_SUMMARY_PARTS.link,
    )
    if (!link || !this.contains(link)) return
    const id = link.getAttribute("href")?.slice(1)
    if (!id) return

    // The guard stays for the race: the target may have disappeared in a
    // patch between the sync and the click. `sync()` has already reported a
    // link that never had a target.
    const target = this.resolveTarget(id)
    if (!target) return

    event.preventDefault()

    // If the link is to a label, focus goes to what the label belongs to,
    // whether it points with `for` or wraps the control. `control` covers
    // both for real controls; if `for` points to something else, such as a
    // group, the id is followed there.
    const focusable =
      target instanceof HTMLLabelElement
        ? (target.control ??
          (target.htmlFor ? this.resolveTarget(target.htmlFor) : null) ??
          target)
        : target

    // A target that cannot take focus, such as a heading, gets a `tabindex`
    // for this one jump. It is a write on markup that comes from the server,
    // and a patch may remove it again; by then the jump has happened.
    if (!focusable.hasAttribute("tabindex") && !isFocusable(focusable)) {
      setAttr(focusable, "tabindex", "-1")
    }

    focusable.focus()
    // Without `behavior`: the page's own `scroll-behavior` decides. The
    // browser does not turn off `smooth` by itself under
    // `prefers-reduced-motion`, so that is up to the page, and "Accessibility"
    // in the documentation says so.
    focusable.scrollIntoView({ block: "center" })
  }
}

function isFocusable(element: Element): boolean {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLButtonElement ||
    element instanceof HTMLAnchorElement
  )
}

export function defineLtErrorSummary(
  tagName: string = LT_ERROR_SUMMARY_TAG,
): void {
  defineElement(tagName, LtErrorSummary)
}
