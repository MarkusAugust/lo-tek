import {
  addClass,
  defineElement,
  HostElement,
  ownership,
  place,
  setAttr,
  warnAboutMarkup,
  watcher,
} from "../../host-element.js"
import { TERM_CLASS, TERM_ENTRY_CLASS } from "./term.js"

export const LT_TERM_TAG = "lt-term" as const

/**
 * The parts the web component finds, as selectors relative to the element.
 * The entry is not among them: it is in the glossary, somewhere else on the
 * page, and is found by the id the link points to.
 */
export const LT_TERM_PARTS = {
  word: "a[href^='#']",
} as const

/** How long the mouse rests on the word before the card opens. */
const OPEN_DELAY = 300
/**
 * How long the card waits for the mouse after it leaves the word or the
 * card. The two are separate boxes, one of them in the top layer, so the
 * pointer leaves the one before it reaches the other.
 */
const CLOSE_DELAY = 200

/**
 * Which `<lt-term>` shows an entry right now. Several words can explain
 * themselves with the same entry, and the entry is one element, so only one
 * of them can have it open. The one that opens takes it from the other.
 */
const shownBy = new WeakMap<Element, LtTerm>()

/**
 * An entry is a `<div>` in a `<dl>` with a `<dt>` and a `<dd>`: the form HTML
 * allows for grouping a term with its description. A `<dt>` alone cannot be
 * the card, since the description is a sibling of it, not a child.
 */
function isEntry(element: Element): boolean {
  return (
    element.localName === "div" &&
    element.parentElement?.localName === "dl" &&
    element.querySelector(":scope > dt") !== null &&
    element.querySelector(":scope > dd") !== null
  )
}

/**
 * The ids the link's `href` can mean, as the browser tries them: the
 * fragment as written, then decoded. Empty when there is no fragment.
 */
function fragmentsOf(word: Element): string[] {
  const href = word.getAttribute("href") ?? ""
  if (!href.startsWith("#") || href.length < 2) return []
  const raw = href.slice(1)
  try {
    const decoded = decodeURIComponent(raw)
    return decoded === raw ? [raw] : [raw, decoded]
  } catch {
    return [raw]
  }
}

/**
 * The `aria-details` the component wrote, per link, shared by every term as
 * the link may be. A value that is still there is the component's to change
 * when `href` points elsewhere; any other value is the server's word, and
 * stays.
 */
const detailsOwn = ownership()

type Shown = "no" | "hover" | "pinned"

/**
 * A word in the text that shows its explanation from a glossary on the same
 * page, in a card by the word.
 *
 * The markup is a link to the entry, and that is all it is without
 * JavaScript: a click goes to the glossary. The web component makes the
 * entry itself the card. It sets `popover="manual"` on the entry while the
 * card is open, so the entry goes into the top layer by the word, and takes
 * it off again when it closes, so the entry is back in its place in the
 * glossary. Nothing is copied: the text is sent once, the links in it are
 * the real ones, and the component writes no id, since the server wrote the
 * one the link points to.
 *
 * The mouse opens the card after a short rest on the word, and the card stays
 * while the pointer is on the word or in the card. A click, a tap or Enter
 * opens it and pins it, so it stays until Escape, a click outside, another
 * click on the word, or the word scrolling out of view. A link clicked with a
 * modifier key is left to the browser.
 *
 * The component writes `aria-details` on the link when it is missing, and
 * `aria-expanded` from whether the card is open. It puts both back when a
 * patch removes them, and while the card is open it also puts back what it
 * set on the entry.
 *
 * ```html
 * <p>Datastar keeps <lt-term><a class="lt-term" href="#term-signal">signals</a></lt-term> in the browser.</p>
 * <dl>
 *   <div id="term-signal"><dt>Signal</dt><dd>A value Datastar keeps in the browser.</dd></div>
 * </dl>
 * ```
 */
export class LtTerm extends HostElement {
  static observedAttributes = [] as const

  private word?: HTMLAnchorElement
  /** The entry the link points to, from the last round, or `null`. */
  private target: HTMLElement | null = null
  /** The entry this component shows as the card right now. */
  private entry?: HTMLElement
  private shown: Shown = "no"
  /**
   * The link and the entry it points at. `class` too: the component sets
   * `lt-term` on a link without it, and a morph takes it again.
   */
  private readonly observe = watcher(() => this.sync(), {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["href", "class", "aria-details", "aria-expanded"],
  })
  /** Watches the entry while the card is open: a patch can strip what the component set on it. */
  private outside?: MutationObserver
  private visibility?: IntersectionObserver
  private openTimer?: ReturnType<typeof setTimeout>
  private closeTimer?: ReturnType<typeof setTimeout>
  /** What the component put on the entry, to take off again when it closes. */
  private addedPopover = false
  private addedClass = false

  /**
   * One observer per document or shadow root, shared by every `<lt-term>`
   * in it. The entry is in the glossary, outside the element, and a patch
   * there can give it its id, take it, or replace it: the word must then
   * say again whether it expands. An observer per word on the whole page
   * would be one per word in the text.
   */
  private static readonly roots = new WeakMap<
    Node,
    { observer: MutationObserver; terms: Set<LtTerm> }
  >()
  /** The root this element was registered with, to leave it again. */
  private watched?: Node

  private static watch(term: LtTerm): void {
    const root = term.getRootNode()
    let entry = LtTerm.roots.get(root)
    if (!entry) {
      const terms = new Set<LtTerm>()
      const observer = new MutationObserver((records) => {
        // Text alone, such as a countdown or a filtered list, cannot make
        // or take an entry: only an element or an id can.
        const elements = (nodes: NodeList) =>
          [...nodes].some((n) => n.nodeType === Node.ELEMENT_NODE)
        const matters = records.some(
          (r) =>
            r.type === "attributes" ||
            elements(r.addedNodes) ||
            elements(r.removedNodes),
        )
        if (matters) for (const t of terms) t.sync()
      })
      // Only nodes and ids: everything the component writes is something
      // else, so its own writes never call it.
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["id"],
      })
      entry = { observer, terms }
      LtTerm.roots.set(root, entry)
    }
    entry.terms.add(term)
    term.watched = root
  }

  private static unwatch(term: LtTerm): void {
    if (!term.watched) return
    const entry = LtTerm.roots.get(term.watched)
    entry?.terms.delete(term)
    if (entry && entry.terms.size === 0) {
      entry.observer.disconnect()
      LtTerm.roots.delete(term.watched)
    }
    term.watched = undefined
  }

  connectedCallback(): void {
    this.observe.start(this)
    LtTerm.watch(this)
    this.sync()
  }

  disconnectedCallback(): void {
    this.close()
    this.observe.stop()
    LtTerm.unwatch(this)
    this.detachWord()
  }

  /**
   * Whether the card is open, by the mouse or pinned. A method and not a
   * getter: React 19 sets a property with the same name as an attribute,
   * and a getter without a setter throws.
   */
  private isOpen(): boolean {
    return this.shown !== "no"
  }

  private root(): Document | ShadowRoot {
    return this.getRootNode() as Document | ShadowRoot
  }

  /** The link that belongs to this element, not to an `<lt-term>` inside it. */
  private findWord(): HTMLAnchorElement | null {
    return (
      [...this.querySelectorAll<HTMLAnchorElement>(LT_TERM_PARTS.word)].find(
        (word) => word.closest(this.localName) === this,
      ) ?? null
    )
  }

  private findTarget(word: Element): HTMLElement | null {
    const root = this.root()
    for (const id of fragmentsOf(word)) {
      const found = root.getElementById?.(id)
      if (found) return found
    }
    return null
  }

  private sync(): void {
    const word = this.findWord()
    if (!word) {
      warnAboutMarkup(
        this,
        'found no link: an <a> with an href to the glossary entry, such as href="#term-signal". Without it there is no word to explain.',
        () => this.findWord() === null,
        { silentWhenEmpty: true },
      )
      this.close()
      this.detachWord()
      return
    }
    if (this.word !== word) {
      this.detachWord()
      word.addEventListener("click", this.handleClick)
      word.addEventListener("pointerenter", this.handlePointerEnter)
      word.addEventListener("pointerleave", this.handlePointerLeave)
      this.word = word
      // An open card follows the new link out of view, not the removed one,
      // which counts as out of view at once.
      if (this.visibility) {
        this.visibility.disconnect()
        this.visibility.observe(word)
      }
    }
    addClass(word, TERM_CLASS)

    const found = this.findTarget(word)
    const entry = found && isEntry(found) ? found : null
    this.target = entry

    if (!found) {
      warnAboutMarkup(
        this,
        "the link points to an id the page does not have. The word stays a plain link; give the glossary entry the id in href.",
        () => {
          const now = this.findWord()
          return now !== null && this.findTarget(now) === null
        },
      )
    } else if (!entry) {
      warnAboutMarkup(
        this,
        "the link points to something that is not a glossary entry: a <div> in a <dl> with a <dt> and a <dd>. The word stays a plain link; put the id on the <div>.",
        () => {
          const now = this.findWord()
          const target = now ? this.findTarget(now) : null
          return target !== null && !isEntry(target)
        },
      )
    }

    // `aria-details` the server wrote is its word, also when it points
    // elsewhere. What the component wrote follows the entry, and goes with it.
    const details = word.getAttribute("aria-details")
    if (
      details === null ||
      details === detailsOwn.written(word, "aria-details")
    ) {
      if (entry) detailsOwn.write(word, "aria-details", entry.id)
      else detailsOwn.release(word, "aria-details")
    }

    if (!entry) {
      // Not an entry, so nothing expands. The link still goes where it points.
      setAttr(word, "aria-expanded", null)
      if (this.entry) this.close()
      return
    }

    setAttr(word, "aria-expanded", String(this.isOpen()))

    if (!this.isOpen()) return
    if (this.entry !== entry) {
      // A patch replaced the entry while it was open. The new one is the
      // card now; the old one is gone, and took the top layer with it.
      if (this.entry) this.release(this.entry)
      this.display(entry)
    } else {
      // The same entry, perhaps stripped of what the component set on it.
      this.display(entry)
    }
  }

  private detachWord(): void {
    this.word?.removeEventListener("click", this.handleClick)
    this.word?.removeEventListener("pointerenter", this.handlePointerEnter)
    this.word?.removeEventListener("pointerleave", this.handlePointerLeave)
    this.word = undefined
  }

  /** Opens the card, by the mouse or pinned. */
  private show(mode: Exclude<Shown, "no">): void {
    this.clearTimers()
    const entry = this.target
    if (!entry || !this.word) return
    const other = shownBy.get(entry)
    if (other && other !== this) other.close()
    this.shown = mode
    this.display(entry)
    setAttr(this.word, "aria-expanded", "true")
  }

  /** Puts the entry in the top layer by the word, and keeps it there. */
  private display(entry: HTMLElement): void {
    if (this.entry !== entry) {
      this.entry = entry
      this.addedPopover = false
      this.addedClass = false
      entry.addEventListener("pointerenter", this.handleCardEnter)
      entry.addEventListener("pointerleave", this.handleCardLeave)
    }
    shownBy.set(entry, this)

    if (!entry.hasAttribute("popover")) {
      setAttr(entry, "popover", "manual")
      this.addedPopover = true
    }
    if (!entry.classList.contains(TERM_ENTRY_CLASS)) {
      addClass(entry, TERM_ENTRY_CLASS)
      this.addedClass = true
    }
    if (!entry.matches(":popover-open")) entry.showPopover()
    this.reposition()

    if (!this.outside) {
      this.outside = new MutationObserver(() => this.sync())
      document.addEventListener("click", this.handleOutsideClick, true)
      // In the capture phase: a card in an open popover is closer than the
      // popover, and closes first. The popover leaves a used press alone.
      document.addEventListener("keydown", this.handleKeydown, true)
      window.addEventListener("resize", this.reposition)
      window.addEventListener("scroll", this.reposition, true)
      this.visibility = new IntersectionObserver((records) => {
        // Out of view: the reader has moved on. Scrolling alone does not
        // close the card, so a reader who scrolls a little keeps it.
        if (records.some((record) => !record.isIntersecting)) this.close()
      })
      if (this.word) this.visibility.observe(this.word)
    }
    // Observed again for every entry, which may be a new node. A replaced
    // entry is seen by the observer on the root.
    this.outside.observe(entry, {
      attributes: true,
      attributeFilter: ["popover", "class", "style", "id"],
    })
  }

  /** Takes the entry out of the top layer and back to its place in the glossary. */
  private release(entry: HTMLElement): void {
    entry.removeEventListener("pointerenter", this.handleCardEnter)
    entry.removeEventListener("pointerleave", this.handleCardLeave)
    if (shownBy.get(entry) === this) shownBy.delete(entry)
    if (entry.matches(":popover-open")) entry.hidePopover()
    if (this.addedPopover) setAttr(entry, "popover", null)
    if (this.addedClass && entry.classList.contains(TERM_ENTRY_CLASS)) {
      const rest = [...entry.classList]
        .filter((name) => name !== TERM_ENTRY_CLASS)
        .join(" ")
      setAttr(entry, "class", rest === "" ? null : rest)
    }
    entry.style.removeProperty("--lt-term-top")
    entry.style.removeProperty("--lt-term-left")
    if (entry.getAttribute("style") === "") setAttr(entry, "style", null)
    this.addedPopover = false
    this.addedClass = false
  }

  /** Closes the card, and moves focus to the word if it was in the card. */
  private close(): void {
    this.clearTimers()
    const entry = this.entry
    const hadFocus = entry?.contains(this.root().activeElement ?? null) ?? false
    this.shown = "no"
    this.entry = undefined
    this.outside?.disconnect()
    this.outside = undefined
    this.visibility?.disconnect()
    this.visibility = undefined
    document.removeEventListener("click", this.handleOutsideClick, true)
    document.removeEventListener("keydown", this.handleKeydown, true)
    window.removeEventListener("resize", this.reposition)
    window.removeEventListener("scroll", this.reposition, true)
    if (entry) this.release(entry)
    if (this.word && this.target) setAttr(this.word, "aria-expanded", "false")
    if (hadFocus) this.word?.focus({ preventScroll: true })
  }

  private clearTimers(): void {
    clearTimeout(this.openTimer)
    clearTimeout(this.closeTimer)
    this.openTimer = undefined
    this.closeTimer = undefined
  }

  private closeSoon(): void {
    clearTimeout(this.closeTimer)
    this.closeTimer = setTimeout(() => {
      if (this.shown === "hover") this.close()
    }, CLOSE_DELAY)
  }

  private handleClick = (event: MouseEvent): void => {
    if (event.defaultPrevented || event.button !== 0) return
    // A new tab, a new window, a download: the reader wants the link.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (!this.target) return
    // Not a jump to the glossary, and the address stays as it is.
    event.preventDefault()
    if (this.shown === "pinned") this.close()
    else this.show("pinned")
  }

  /*
   * Only the mouse. A tap gives `pointerenter` with `pointerType` "touch"
   * before the click, and opening on it would have the click close the card
   * again, or pin one the reader never saw being opened by hover.
   */
  private handlePointerEnter = (event: PointerEvent): void => {
    if (event.pointerType !== "mouse") return
    clearTimeout(this.closeTimer)
    if (this.shown !== "no" || !this.target) return
    clearTimeout(this.openTimer)
    this.openTimer = setTimeout(() => {
      if (this.shown === "no") this.show("hover")
    }, OPEN_DELAY)
  }

  private handlePointerLeave = (event: PointerEvent): void => {
    if (event.pointerType !== "mouse") return
    clearTimeout(this.openTimer)
    if (this.shown === "hover") this.closeSoon()
  }

  // The pointer in the card keeps it, so the reader can select text and
  // follow the links in it.
  private handleCardEnter = (event: PointerEvent): void => {
    if (event.pointerType === "mouse") clearTimeout(this.closeTimer)
  }

  private handleCardLeave = (event: PointerEvent): void => {
    if (event.pointerType === "mouse" && this.shown === "hover")
      this.closeSoon()
  }

  private handleOutsideClick = (event: Event): void => {
    // `composedPath()` and not `target`, which is retargeted to the shadow
    // host when the component is in a shadow root.
    const target = event.composedPath()[0]
    if (!(target instanceof Node)) return
    if (this.word?.contains(target) || this.entry?.contains(target)) return
    this.close()
  }

  private handleKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !this.isOpen() || event.defaultPrevented)
      return
    // A modal dialog opened over the card closes on its own press.
    for (const node of event.composedPath()) {
      if (node === this) break
      if (
        node instanceof HTMLDialogElement &&
        node.matches(":modal") &&
        !node.contains(this)
      ) {
        return
      }
    }
    event.preventDefault()
    // From the path and not `activeElement`, which a shadow root answers
    // with null when the focus is outside it. Back to the word when the
    // focus was on it, in the card, or nowhere: on `<body>`, or on a dialog
    // or a `<main>` the word is in. From a field elsewhere it stays.
    const target = event.composedPath()[0]
    const back =
      target instanceof Node &&
      (target === this.word ||
        (this.entry?.contains(target) ?? false) ||
        target.contains(this))
    this.close()
    // Focus goes back to the word, without scrolling the page to it.
    if (back) this.word?.focus({ preventScroll: true })
  }

  /**
   * Under the word, or over it when there is no room. A word that wraps
   * over two lines has two boxes, and the card goes under the last.
   *
   * On a narrow screen the stylesheet makes the card a sheet across the
   * window, and says so with `--lt-term-sheet`, which is the stylesheet's
   * to set and not the page's. The sheet goes at the bottom, unless it
   * would cover the word: then at the top.
   */
  private reposition = (): void => {
    const entry = this.entry
    const word = this.word
    if (!entry || !word) return
    const boxes = word.getClientRects()
    const anchor = boxes[boxes.length - 1] ?? word.getBoundingClientRect()
    const card = entry.getBoundingClientRect()
    const style = getComputedStyle(entry)

    let top: number
    let left: number
    if (style.getPropertyValue("--lt-term-sheet").trim() === "1") {
      // At the bottom when the word is clear of it, otherwise at the top
      // when the word is clear of that. A word in the middle under a tall
      // sheet is covered either way, and the sheet goes on the side away
      // from it.
      const bottom = document.documentElement.clientHeight - card.height
      if (anchor.bottom <= bottom) top = bottom
      else if (anchor.top >= card.height) top = 0
      else
        top =
          anchor.top + anchor.height / 2 >
          document.documentElement.clientHeight / 2
            ? 0
            : bottom
      left = 0
    } else {
      // The space under the word is `--lt-term-gap`, which the stylesheet
      // puts in `scroll-margin-block-start`: there the browser has worked
      // it out in pixels, whatever unit the page gave it.
      const gap = Number.parseFloat(style.scrollMarginBlockStart) || 0
      const rtl = word.matches(":dir(rtl)")
      ;({ top, left } = place(anchor, card, true, rtl, gap))
    }
    top = Math.round(top)
    if (entry.style.getPropertyValue("--lt-term-top") !== `${top}px`)
      entry.style.setProperty("--lt-term-top", `${top}px`)
    if (entry.style.getPropertyValue("--lt-term-left") !== `${left}px`)
      entry.style.setProperty("--lt-term-left", `${left}px`)
  }
}

export function defineLtTerm(tagName: string = LT_TERM_TAG): void {
  defineElement(tagName, LtTerm)
}
