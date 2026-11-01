import {
  defineElement,
  derivedParts,
  HostElement,
  isServerControlled,
  markWritten,
  SERVER_CONTROLLED,
  setAttr,
  setFlag,
  stillMarked,
  uniqueId,
  WRITTEN,
  warnAboutCopiedMark,
  warnAboutMarkup,
} from "../../host-element.js"
export const LT_TABS_TAG = "lt-tabs" as const

/**
 * The parts the tabs look for, as selectors relative to the element. The
 * web component finds its parts with these, and the manifest describes them
 * for anyone writing the markup by hand, so the two cannot disagree.
 */
export const LT_TABS_PARTS = {
  /** The tab list: the one the server gave the role, or the class from `tabs.css`. */
  list: "[role='tablist'], .lt-tabs__list",
  /**
   * A tab is a link to a panel in the tab list. A link is the only tab
   * pattern that works without JavaScript: without the script the tab list is
   * a table of contents, and the links lead to the panels. If the server has
   * written the roles, only the links with `role="tab"` are tabs.
   */
  tab: "a[role='tab'][href^='#'], .lt-tabs__list a[href^='#']:not([role])",
  /** A panel: the role when it is there, otherwise the class without a role. */
  panel: "[role='tabpanel'], .lt-tabs__panel:not([role])",
} as const

const LIST_SELECTOR = LT_TABS_PARTS.list
const TAB_SELECTOR = LT_TABS_PARTS.tab
/** What the server has called a tab, including what is not a link. */
const ANY_TAB_SELECTOR = "[role='tab']"
/** The heading in a panel, which gives the panel its name. */
const HEADING_SELECTOR = ":scope > :is(h1, h2, h3, h4, h5, h6)"

/**
 * The id a tab points to, or `null` when it is not a link to a fragment.
 * `href="#"` on its own points to nothing.
 *
 * `href` is the truth, and `aria-controls` is written from it. The fragment
 * is looked up the way the browser does: as written, and otherwise decoded,
 * so both `#attachments` and `#s%C3%B8knaden` find their panel.
 */
function linkTarget(tab: Element): string | null {
  if (tab.localName !== "a") return null
  const href = tab.getAttribute("href") ?? ""
  if (!href.startsWith("#") || href.length < 2) return null
  return href.slice(1)
}

function decoded(fragment: string): string | null {
  try {
    const plain = decodeURIComponent(fragment)
    return plain === fragment ? null : plain
  } catch {
    return null
  }
}

/** Text as a name is computed: whitespace collapsed, and trimmed. */
function flat(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

/** Is the element hidden from assistive technology: `hidden`, `aria-hidden` or CSS? */
function hiddenFromAT(element: Element): boolean {
  if (element.getAttribute("aria-hidden") === "true") return true
  if (element.hasAttribute("hidden")) return true
  if (!(element instanceof HTMLElement) || !element.isConnected) return false
  const style = getComputedStyle(element)
  return style.display === "none" || style.visibility === "hidden"
}

/**
 * The text an element contributes to a name, as AccName 1.2 computes it from
 * step 2.
 *
 * `aria-labelledby` (2B), `aria-label` on something inside, `alt` on an
 * image, and the text, but not what is hidden from assistive technology.
 * `textContent` included hidden text, such as "Messages (3)", and gave an
 * empty name to a tab with only an icon and `aria-label`.
 *
 * - `includeHidden`: when a hidden element is pointed to directly with
 *   `aria-labelledby`, it is included anyway, with everything inside it (2A).
 * - `inReference`: the node is inside an `aria-labelledby` that is already
 *   being followed, and then another one is not followed (2B).
 *
 * Text from CSS, `::before` and `::after` (2F.ii), is not included. LO-TEK's
 * tabs do not use it, and reading `content` correctly is a lot of code for
 * something nobody needs (decided by the maintainer on 23 October).
 */
function textOf(
  node: Node,
  includeHidden = false,
  inReference = false,
): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ""
  if (!(node instanceof Element)) return ""
  if (!includeHidden && hiddenFromAT(node)) return ""
  if (!inReference) {
    const referenced = referencedText(node)
    if (referenced !== "") return ` ${referenced} `
  }
  const label = node.getAttribute("aria-label")
  if (label && flat(label) !== "") return ` ${label} `
  if (node.localName === "img") return ` ${node.getAttribute("alt") ?? ""} `
  let text = ""
  for (const child of node.childNodes)
    text += textOf(child, includeHidden, inReference)
  return text
}

/** The text from the elements `aria-labelledby` points to, or empty (AccName 2B). */
function referencedText(element: Element): string {
  const ids = element.getAttribute("aria-labelledby")
  if (!ids) return ""
  const root = element.getRootNode() as Document | ShadowRoot
  return flat(
    ids
      .split(/\s+/)
      .map((id) => (id === "" ? null : root.getElementById?.(id)))
      .filter((e): e is HTMLElement => Boolean(e))
      .map((e) => textOf(e, hiddenFromAT(e), true))
      .join(" "),
  )
}

/** The name of an element, as a screen reader computes it. */
function accessibleName(element: Element): string {
  const referenced = referencedText(element)
  if (referenced !== "") return referenced
  const label = element.getAttribute("aria-label")
  if (label && flat(label) !== "") return flat(label)
  let text = ""
  for (const child of element.childNodes) text += textOf(child)
  if (flat(text) !== "") return flat(text)
  return flat(element.getAttribute("title") ?? "")
}

/**
 * The name a panel gets when it points to the element with `aria-labelledby`.
 *
 * Not the same as the element's name: inside an `aria-labelledby`, the
 * element's `aria-labelledby` is not followed (AccName 2B), and a hidden
 * element is included (2A). A heading with `aria-labelledby` pointing to
 * "Attachments" and the text "Enclosures" gave the panel the name
 * "Enclosures", while the web component thought it was "Attachments".
 */
function nameAsReferenced(element: Element): string {
  return flat(textOf(element, hiddenFromAT(element), true))
}

/**
 * What the web component last wrote on a node, and what the server last said.
 *
 * `aria-selected` on the tabs and `hidden` on the panels are both read and
 * written. A naive read is the web component's echo of itself: bare markup
 * got `aria-selected="true"` on the first tab from the web component, and
 * when the server switched tab with a patch that only touched the panels,
 * the web component read its earlier selection back and hid the panel the
 * server had just shown. If something other than what the web component
 * wrote is there, the server has touched it, and it is the server's word. If
 * the same is there, what the server said last applies.
 */
type Word = { written: string | null; server: string | null }

/**
 * Whether a morph from the server has been there since the web component
 * wrote the attribute: the mark it wrote is gone. Only a value that differed
 * from the server's word was marked (`markWritten`); one that did not has
 * no mark to lose, and its absence says nothing. Read as a sign of the
 * server, every unmarked tab in a row of three released a click under
 * `server-controlled` at once.
 */
function markGone(element: Element, name: string, word: Word): boolean {
  return word.written !== word.server && !stillMarked(element, name)
}

/**
 * Keyboard behaviour in a tab list, and the wiring when the markup comes
 * without it.
 *
 * The tabs are links to their panels, the way GOV.UK does it:
 *
 * ```html
 * <lt-tabs>
 *   <ul class="lt-tabs__list" aria-label="Parts of the claim">
 *     <li><a href="#claim">Claim</a></li>
 *     <li><a href="#attachments">Attachments</a></li>
 *   </ul>
 *   <section class="lt-tabs__panel" id="claim"><h2>Claim</h2>…</section>
 *   <section class="lt-tabs__panel" id="attachments"><h2>Attachments</h2>…</section>
 * </lt-tabs>
 * ```
 *
 * Without JavaScript this is a table of contents with all the panels one
 * after another, and the links work. What the template writes is an id on
 * the panels, and it needs the links anyway.
 *
 * The web component never writes an id on a tab or a panel. Datastar and
 * idiomorph recognise an element by its id, and an element with an id the
 * server did not send is replaced at the next update, along with the tab
 * selection and focus. The panels' ids come from the server, so they are
 * kept. What the web component fills in, it computes from the markup: the
 * roles, `aria-controls` from `href`, `role="presentation"` on the list
 * items, and the panel's name, which is the tab's. The heading in the panel
 * is the name when it says the same as the tab. Only the selected panel is a
 * tab stop.
 *
 * The panels that are not selected are hidden with `hidden="until-found"`, so
 * find in page and a link to something in a panel reach them, and the
 * browser fires `beforematch`, which the web component selects the tab from.
 * If the server wrote `hidden` itself, it is written back in the server's
 * form, across the whole tab list: `lt.tabs()` from
 * `@lo-tek/interfaces/react` gives `hidden=""`, because React cannot write
 * `until-found`. The address selects the tab when the page loads and when it
 * changes, and each selection is written to the address, unless it already
 * points to the selected panel or something in it. On load the server's
 * `aria-selected` comes before the address, and under `server-controlled`
 * the address never selects.
 *
 * What the server has written stays. Which tab is selected is read from
 * `aria-selected`, and when that is missing, from which panel is not hidden;
 * if nothing is said, it is the first. Before the web component is
 * registered, `tabs.css` shows only the panel the web component is going to
 * select: the first visible one, or the one the address points to, so the
 * content does not jump when the rest are hidden.
 *
 * What the web component then does is what the browser does not do by
 * itself: Tab skips past the whole tab list and into the panel, while the
 * arrow keys move between the tabs. With `activation="manual"` the arrow keys
 * only move focus, and Enter or Space selects.
 *
 * The tab selection belongs to the user, and the web component restores it
 * when a patch strips it. If the server needs to move the tab, as in
 * "continue to step 2", set `server-controlled` on the host, and then every
 * patch decides.
 */
export class LtTabs extends HostElement {
  /**
   * `server-controlled` and `activation`. Which tab is selected is in the
   * markup the server sent, as `aria-selected` on the tab and `hidden` on the
   * panels, and is read from there. A separate `selected` would have been a
   * parallel copy of the same thing.
   */
  static observedAttributes = [SERVER_CONTROLLED, "activation"] as const

  private observer?: MutationObserver
  /**
   * The panel the user's tab points to, remembered so a patch cannot take
   * the selection.
   *
   * Not the index and not the node. An index is not an identity: if the
   * server inserts a tab first in the list, the same index points to
   * something else. The node is not one either: the links have no id, so
   * Datastar and idiomorph match them by position, and the node the user
   * pressed became the inserted tab. The panel's id is the server's and
   * stays; a tab pointing to another panel is another tab.
   *
   * Remembered with the link, `chosenTab`.
   *
   * `undefined` means the user has not selected anything yet, and then the
   * server's markup applies.
   */
  private chosenTarget?: string
  /**
   * The link the user pressed, with `chosenTarget`. While it is in the tab
   * list and points to the same panel, it is the user's tab, also when
   * another tab points to that panel too. When a morph has turned it into
   * another tab, or dropped it while it kept other links, the tab that points
   * to the panel is found. When the links were replaced, none of the row is
   * left, as `innerHTML` does, and the selection is forgotten rather than
   * guessed; the address still has it, see `selectFromAddress`.
   */
  private chosenTab?: HTMLElement
  /** The tab list as it was when the user's tab was last found. */
  private chosenRow: HTMLElement[] = []
  /**
   * Roles the web component set itself. Tells a bare tab list, where every
   * link is a tab, from one where the server wrote the roles, where a link
   * without a role is something else, such as a help link.
   */
  private readonly roledByMe = new WeakSet<Element>()
  private selectedMemory = new WeakMap<Element, Word>()
  private hiddenMemory = new WeakMap<Element, Word>()
  /**
   * The form the server hides panels in, the last time it hid something:
   * `""` from `lt.tabs()`, `"until-found"` or something else. The web
   * component writes `hidden` in that form on every panel in the tab list,
   * including a panel the server never hid. Otherwise one panel got
   * `until-found` and the others `""` in the same tab list. If the server has
   * never hidden anything, it is `until-found`, so find in page reaches the
   * panel.
   */
  private hiddenForm = "until-found"
  /**
   * The id the web component gave the heading in a panel, per panel. A morph
   * strips the id from the heading and `aria-labelledby` from the panel,
   * since neither was in the server's HTML, and the panel must get the same
   * one back, so a screen reader does not follow a reference that changes
   * under it.
   */
  private readonly headingIds = new WeakMap<Element, string>()
  /** The name the web component wrote in `aria-label` on a panel without a heading. */
  private readonly labelByMe = new WeakMap<Element, string>()
  /**
   * The tab the user clicked under `server-controlled`, until the server
   * answers.
   *
   * It is not the user's selection in the sense of `chosenTarget`: it is never
   * restored against the server's word. It only lasts until someone else has
   * touched `aria-selected` or `hidden`, added a tab or a panel, removed the
   * tab, or removed `server-controlled`. Without it, `repair()` read the
   * server's old word from memory in the next microtask and undid the click,
   * so the tabs could not be switched, and a `data-attr:hidden` that wrote the
   * same as the web component had just written was never seen.
   */
  private pendingTab?: HTMLElement
  /**
   * The panel the browser is revealing after `beforematch`.
   *
   * The browser removes `hidden` itself after the event, and then moves on to
   * the ancestors, such as an outer panel or a closed `<details>`. But only as
   * long as the panel still has `hidden="until-found"` when the event is done.
   * When the search comes from the user, the browser runs the microtasks after
   * each listener, the observer included, and when the web component removed
   * `hidden` in that round, Chromium and WebKit stopped. The match in a tab
   * list inside a hidden panel stayed invisible. The panel is therefore not
   * touched until the next task, when the browser is done, see `revealed()`.
   */
  private revealing?: Element
  /**
   * Whether the tab list has loaded: whether the address or the server's
   * selection has been read. That happens the first time the tab list has
   * tabs and the address can be resolved, see `sync()`, not when the element
   * is connected. An `<lt-tabs>` the server fills in later otherwise always
   * got the first tab.
   */
  private started = false
  /**
   * The root `beforematch` is listened for on. The event bubbles, but is not
   * `composed`, so from a panel in a shadow root it never reaches the
   * document.
   */
  private root?: Document | ShadowRoot

  connectedCallback(): void {
    /*
     * The attributes are included, not just the children. A morph strips what
     * is not in the server's HTML, and the tab selection is exactly that:
     * something the user did after the page arrived. Every write compares
     * first, or the observer would trigger itself.
     */
    // One listener on the host, not one per tab. Capture phase, so a listener
    // on the tab list that stops the event does not take clicks and arrow
    // keys from the tabs.
    this.addEventListener("click", this.handleClick, true)
    this.addEventListener("keydown", this.handleKeydown, true)
    // Find in page, or a link to something in a panel hidden with
    // `until-found`. On the document, not on the host: a panel can be outside
    // `<lt-tabs>`, and then the event never reaches the host.
    document.addEventListener("beforematch", this.handleBeforematch, true)
    const root = this.getRootNode() as Document | ShadowRoot
    if (root !== document) {
      this.root = root
      root.addEventListener("beforematch", this.handleBeforematch, true)
    }
    window.addEventListener("hashchange", this.handleHashchange)
    this.observer = new MutationObserver((records) => {
      if (this.concerns(records)) this.sync()
    })
    this.observer.observe(this, {
      childList: true,
      subtree: true,
      attributes: true,
      // The panel's name is the tab's. idiomorph changes the text in a text
      // node, with nothing else the observer sees.
      characterData: true,
      // `disabled` is included because the web component reads it: if a patch
      // disables the selected tab, the tab stop moves to one that can take
      // focus. `alt`, `aria-hidden` and `title` change the name of a tab.
      attributeFilter: [
        // A morph from the server removes the mark, and the web component
        // puts it back: the same markup must give the same page.
        WRITTEN,
        "aria-selected",
        "tabindex",
        "hidden",
        "disabled",
        "aria-disabled",
        // The wiring the web component sets when the markup came without it,
        // and restores when a patch removes it.
        "role",
        "id",
        "href",
        "aria-controls",
        "aria-labelledby",
        "aria-label",
        "alt",
        "aria-hidden",
        "title",
      ],
    })
    this.sync()
  }

  attributeChangedCallback(name: string): void {
    // `server-controlled` switched on midway: the web component lets go, and
    // the next patch decides.
    if (name === SERVER_CONTROLLED && isServerControlled(this)) {
      this.choose(undefined)
      // What is there now is the starting point. Without this the tab list
      // jumped back to the tab the server last named, before the user chose
      // another. But as when the server answers a click: `aria-selected` the
      // web component wrote is not the server's. When everything counted as
      // the server's, it took precedence over `hidden`, and a server that
      // moves the tab with `hidden` alone was not heard.
      this.releasePending()
    }
  }

  disconnectedCallback(): void {
    this.observer?.disconnect()
    this.observer = undefined
    this.removeEventListener("click", this.handleClick, true)
    this.removeEventListener("keydown", this.handleKeydown, true)
    document.removeEventListener("beforematch", this.handleBeforematch, true)
    this.root?.removeEventListener("beforematch", this.handleBeforematch, true)
    this.root = undefined
    window.removeEventListener("hashchange", this.handleHashchange)
    // If the element is connected again, the address is read again.
    this.started = false
  }

  /**
   * The tabs that belong to this tab list, and only those.
   *
   * Tabs inside tabs are ordinary markup. Without the boundary an inner tab
   * list became part of the outer one: a click on an inner tab hid the outer
   * panel it was in, and both web components attached listeners to the same
   * tabs.
   */
  private get tabs(): HTMLElement[] {
    return derivedParts<HTMLElement>(
      this,
      TAB_SELECTOR,
      "tab",
      this.roledByMe,
    ).filter((tab) => linkTarget(tab) !== null)
  }

  /** Remembers the user's tab: the link, and the panel it points to. */
  private choose(tab: HTMLElement | undefined): void {
    this.chosenTab = tab
    this.chosenTarget = tab ? (linkTarget(tab) ?? undefined) : undefined
    this.chosenRow = tab ? this.tabs : []
  }

  /**
   * Where the user's tab is now, or -1: the link while it points to the same
   * panel; the tab that points to that panel when a morph has turned the
   * link into another tab, or dropped it and kept others (the morphers match
   * links without ids by position, and look ahead when one is removed);
   * none when the links were replaced, with nothing of the row left.
   */
  private chosenIndex(): number {
    const tabs = this.tabs
    const link = this.chosenTab
    if (!link || this.chosenTarget === undefined) return -1
    const at = tabs.indexOf(link)
    if (at >= 0 && linkTarget(link) === this.chosenTarget) {
      this.chosenRow = tabs
      return at
    }
    const morphed = at >= 0 || this.chosenRow.some((tab) => tabs.includes(tab))
    if (!morphed) return -1
    const moved = tabs.findIndex((tab) => linkTarget(tab) === this.chosenTarget)
    if (moved >= 0) {
      this.chosenTab = tabs[moved]
      this.chosenRow = tabs
    }
    return moved
  }

  /** The server's word about an attribute, against what the web component last wrote. */
  private serverWord(
    memory: WeakMap<Element, Word>,
    element: Element,
    name: string,
  ): string | null {
    const now = element.getAttribute(name)
    const known = memory.get(element)
    if (!known) {
      warnAboutCopiedMark(this, element)
      return now
    }
    // The server's when the value is another, or when a morph from the
    // server has been there since the web component wrote it (`WRITTEN`).
    return now !== known.written || !stillMarked(element, name)
      ? now
      : known.server
  }

  /** Is there something on a tab or a panel other than what the web component wrote? */
  private touchedByOthers(): boolean {
    return this.tabs.some((tab) => {
      const selected = this.selectedMemory.get(tab)
      if (
        !selected ||
        tab.getAttribute("aria-selected") !== selected.written ||
        markGone(tab, "aria-selected", selected)
      ) {
        return true
      }
      const panel = this.panelFor(tab)
      if (!panel) return false
      const hidden = this.hiddenMemory.get(panel)
      return (
        !hidden ||
        panel.getAttribute("hidden") !== hidden.written ||
        markGone(panel, "hidden", hidden)
      )
    })
  }

  /**
   * Releases the click, and makes what is in the markup now the server's
   * word.
   *
   * The memory holds the server's word from before the click, and it is
   * stale: the server has answered. An attribute the server wrote the same as
   * the web component cannot be told from one it did not touch, so the old
   * words won, and the tab list jumped back to the tab from before the click
   * just as the server confirmed the new one.
   *
   * `hidden` on the panels is therefore read as it is. `aria-selected` is read
   * as it is when the server has touched at least one tab, that is, when the
   * server speaks through `aria-selected`. If it has not, the values are the
   * ones the web component wrote for the click, and then the panels say which
   * tab applies.
   */
  private releasePending(): void {
    this.pendingTab = undefined
    const tabs = this.tabs
    const serverSpoke = tabs.some((tab) => {
      const now = tab.getAttribute("aria-selected")
      const known = this.selectedMemory.get(tab)
      // A new, bare tab has said nothing. Had it counted, the click's
      // `aria-selected` was read as the server's, and a later move with
      // `hidden` alone was undone.
      return known
        ? now !== known.written || markGone(tab, "aria-selected", known)
        : now !== null
    })
    this.hiddenMemory = new WeakMap()
    if (serverSpoke) {
      this.selectedMemory = new WeakMap()
      return
    }
    for (const tab of tabs) {
      const written = tab.getAttribute("aria-selected")
      this.selectedMemory.set(tab, { written, server: null })
      markWritten(tab, "aria-selected", written !== null)
    }
  }

  private serverSelected(tab: Element): string | null {
    return this.serverWord(this.selectedMemory, tab, "aria-selected")
  }

  /** The server's word about `hidden` on the panel: the form, or `null` for visible. */
  private serverHidden(panel: Element): string | null {
    return this.serverWord(this.hiddenMemory, panel, "hidden")
  }

  /**
   * Can any of the changes concern the tab list?
   *
   * The observer sees the whole tree, and a suggestion field, a counter or an
   * inner tab list in a panel changes `aria-selected`, `hidden` and text on
   * every keystroke. Each of them gave a full round, with styles read for the
   * names. Only what is deep inside one of the tab list's panels is skipped,
   * and only when it is neither a heading in the panel, something
   * `aria-labelledby` points to, nor an id, which can make an element
   * something a tab points to. Everything else gives a round, as before.
   */
  private concerns(records: MutationRecord[]): boolean {
    let panels: HTMLElement[] | undefined
    let names: Set<string> | undefined
    for (const record of records) {
      if (record.type === "attributes" && record.attributeName === "id")
        return true
      const target =
        record.target instanceof Element
          ? record.target
          : record.target.parentElement
      if (!target) return true
      panels ??= this.tabs.flatMap((tab) => this.panelFor(tab) ?? [])
      const panel = panels.find((p) => p !== target && p.contains(target))
      if (!panel) return true
      const heading = target.closest("h1, h2, h3, h4, h5, h6")
      if (heading && heading.parentElement === panel) return true
      names ??= this.watchedIds(panels)
      if (this.within(target, names)) return true
      if (record.type === "childList") {
        for (const node of [...record.addedNodes, ...record.removedNodes])
          if (this.carries(node, names)) return true
      }
    }
    return false
  }

  /**
   * The ids `aria-labelledby` points to from the tabs, what is inside them,
   * and the panels. Before the tab list has loaded, also the id the address
   * points to: the tab list waits for that element, see `sync()`, and it can
   * arrive deep inside a panel.
   */
  private watchedIds(panels: HTMLElement[]): Set<string> {
    const ids = new Set<string>()
    if (!this.started) {
      const hash = location.hash.slice(1)
      if (hash !== "") ids.add(hash)
      const plain = decoded(hash)
      if (plain !== null) ids.add(plain)
    }
    const from = (element: Element) => {
      for (const id of (element.getAttribute("aria-labelledby") ?? "").split(
        /\s+/,
      ))
        if (id !== "") ids.add(id)
    }
    for (const tab of this.tabs) {
      from(tab)
      for (const inner of tab.querySelectorAll("[aria-labelledby]")) from(inner)
    }
    for (const panel of panels) from(panel)
    return ids
  }

  /** Is the element inside an element with one of the ids, or is it one itself? */
  private within(element: Element, ids: Set<string>): boolean {
    if (ids.size === 0) return false
    for (let e: Element | null = element; e; e = e.parentElement)
      if (e.id && ids.has(e.id)) return true
    return false
  }

  /** Does an added or removed node carry one of the ids, itself or inside it? */
  private carries(node: Node, ids: Set<string>): boolean {
    if (!(node instanceof Element) || ids.size === 0) return false
    if (node.id && ids.has(node.id)) return true
    for (const inner of node.querySelectorAll("[id]"))
      if (ids.has(inner.id)) return true
    return false
  }

  /** The tab list the tabs are in, when it belongs to this web component. */
  private get list(): HTMLElement | null {
    // The first tab list that belongs to this web component, not the first in
    // the tree: when the panels with an inner tab list come before the outer
    // tab list, the inner one was first.
    for (const list of this.querySelectorAll<HTMLElement>(LIST_SELECTOR))
      if (list.closest(this.localName) === this) return list
    return null
  }

  /**
   * The panel a tab controls, through the id it points to.
   *
   * The panel can be outside the host. It is then not in what the web
   * component observes, so if a patch strips `hidden` from it, it does not
   * come back by itself. If the tab points to nothing, the answer is nothing,
   * and the web component warns. The order is not a fallback: two tabs could
   * then have got the same panel, and the two wrote opposite `hidden` on it in
   * every single round.
   */
  private panelFor(tab: HTMLElement): HTMLElement | null {
    const target = linkTarget(tab)
    return target === null ? null : this.byFragment(target)
  }

  /** The element a fragment points to, as written or decoded. */
  private byFragment(fragment: string): HTMLElement | null {
    const root = this.getRootNode() as Document | ShadowRoot
    const found = root.getElementById?.(fragment)
    if (found) return found
    // A fragment can be encoded, such as `#s%C3%B8knaden`.
    const plain = decoded(fragment)
    return plain === null ? null : (root.getElementById?.(plain) ?? null)
  }

  /**
   * A tab that cannot be selected, with either mouse or keyboard: disabled,
   * or hidden with `hidden`. A hidden tab cannot take focus, so when an arrow
   * key selected it, the tab stop was left on something Tab never reaches.
   */
  private isDisabled(tab: HTMLElement): boolean {
    return (
      tab.hasAttribute("disabled") ||
      tab.getAttribute("aria-disabled") === "true" ||
      tab.hasAttribute("hidden")
    )
  }

  /** The arrow keys only move focus, and Enter or Space selects. */
  private get manual(): boolean {
    return this.getAttribute("activation") === "manual"
  }

  /**
   * The index of the marked tab, or `-1` when none is.
   *
   * `selected` answers 0 in that case, because it is public API and a tab
   * list in practice always has a selected tab. But that lie cannot be used
   * internally: when it said 0 with nothing marked, `select(0)` returned at
   * once, and the tab list did not respond to a click at all.
   */
  private get markedIndex(): number {
    return this.tabs.findIndex(
      (tab) => tab.getAttribute("aria-selected") === "true",
    )
  }

  /** The index of the selected tab. */
  get selected(): number {
    const index = this.markedIndex
    return index < 0 ? 0 : index
  }

  set selected(index: number) {
    // React 19 writes the property when it exists, and the documentation
    // shows `tabs.selected` as API. A getter alone threw on assignment.
    this.select(index)
  }

  private sync(): void {
    /*
     * The first time the tab list has tabs, it has loaded. If the server has
     * said which tab is selected, that applies: the server cannot see the
     * address, and the React entry's `lt.tabs()` writes `aria-selected`.
     * When the web component selected from the address before React
     * hydrated, React reported a mismatch for every attribute it changed.
     * Otherwise the address selects. The server's word is read before the
     * web component writes anything.
     */
    // Loaded when the tab list has tabs and the address can be resolved: it
    // is empty, or the element it points to exists. When the tab list came
    // before the panels, or the content after the panel, the address
    // otherwise found nothing, and the first tab was selected over the one
    // the user asked for. Waiting for every tab to have a panel was not
    // enough: with one link pointing to nothing, the tab list never loaded.
    // If the address points to something that never comes, such as
    // `#/claim/1`, there is nothing to select either. The server's word is read
    // through the memory, so a new connection does not take the web
    // component's writes for the server's.
    const tabs = this.tabs
    const hash = location.hash.slice(1)
    const loading =
      !this.started &&
      tabs.length > 0 &&
      (hash === "" || this.byFragment(hash) !== null)
    const serverChose =
      loading && tabs.some((tab) => this.serverSelected(tab) === "true")
    this.wire()
    this.bind()
    this.repair()
    if (!loading) return
    this.started = true
    if (serverChose) this.alignAddress(this.markedIndex)
    else this.selectFromAddress()
  }

  /**
   * Fills in the wiring where the markup came without it.
   *
   * Only what is missing, with one exception: `aria-controls` is written from
   * `href`, since the two are the same information and `href` is the one that
   * works without JavaScript. Any other attribute the server has written is
   * the server's word, even when it says something other than the web
   * component would have said.
   */
  private wire(): void {
    const list = this.list
    if (list && !list.hasAttribute("role")) setAttr(list, "role", "tablist")
    // In a list each list item is only a wrapper around the tab. Without the
    // role a screen reader says "list, 2 items" before each tab.
    if (list && (list.localName === "ul" || list.localName === "ol")) {
      for (const item of list.children) {
        if (item.localName === "li" && !item.hasAttribute("role")) {
          setAttr(item, "role", "presentation")
        }
      }
    }

    /*
     * Each panel gets its name once, from the first tab that points to it.
     * When two tabs pointed to the same one, through a mistake in the markup,
     * each of them gave the panel its name in every round, and the observer
     * called itself forever.
     */
    const named = new Set<HTMLElement>()
    for (const tab of this.tabs) {
      if (!tab.hasAttribute("role")) {
        setAttr(tab, "role", "tab")
        this.roledByMe.add(tab)
      }
      const panel = this.panelFor(tab)
      setAttr(tab, "aria-controls", panel?.id ?? linkTarget(tab))
      if (!panel) continue

      if (!panel.hasAttribute("role")) {
        setAttr(panel, "role", "tabpanel")
        this.roledByMe.add(panel)
      }
      if (named.has(panel)) continue
      named.add(panel)
      this.name(panel, tab)
    }
  }

  /**
   * Gives the panel a name, when the server has not given it one.
   *
   * The panel is named what the tab is named, as the APG does it. The APG
   * lets the panel point to the tab, but the tab has no id here, and the web
   * component writes none. If the heading in the panel says the same as the
   * tab, the heading is the name, and it can get an id from the web
   * component: it has no state the user can lose. Otherwise the name is the
   * tab's, as `aria-label`.
   *
   * An `aria-label` or `aria-labelledby` the server wrote is never changed,
   * even when the reference points to something that does not exist yet.
   * Until it arrives, the tab's name stands as `aria-label`: a reference
   * without a match is ignored when the name is computed, and then
   * `aria-label` applies.
   */
  private name(panel: HTMLElement, tab: HTMLElement): void {
    const ownLabel = this.labelByMe.get(panel)
    const label = panel.getAttribute("aria-label")
    if (label !== null && label !== ownLabel) return

    const tabName = accessibleName(tab)
    const named = panel.getAttribute("aria-labelledby")
    const remembered = this.headingIds.get(panel)
    if (named !== null && named !== remembered) {
      if (this.resolves(named)) this.dropOwnLabel(panel)
      else this.setOwnLabel(panel, tabName)
      return
    }

    // Without a name on the tab there is nothing to give the panel. An empty
    // `aria-label` would also have taken the name from the heading.
    if (tabName === "") {
      this.dropOwnLabel(panel)
      return
    }
    const heading = panel.querySelector<HTMLElement>(HEADING_SELECTOR)
    if (heading && nameAsReferenced(heading) === tabName) {
      this.dropOwnLabel(panel)
      // If the reference is the web component's, and the heading lost its id
      // in a morph, it gets the same one back.
      let id = heading.id
      if (!id) {
        id = remembered ?? uniqueId("lt-tabs-heading")
        setAttr(heading, "id", id)
      }
      this.headingIds.set(panel, id)
      setAttr(panel, "aria-labelledby", id)
      return
    }

    if (named !== null) {
      setAttr(panel, "aria-labelledby", null)
      this.headingIds.delete(panel)
    }
    this.setOwnLabel(panel, tabName)
  }

  /** Writes the tab's name as `aria-label`, and remembers that the web component wrote it. */
  private setOwnLabel(panel: HTMLElement, text: string): void {
    setAttr(panel, "aria-label", text)
    this.labelByMe.set(panel, text)
  }

  /** Removes the fallback, when a name that exists has taken over. */
  private dropOwnLabel(panel: HTMLElement): void {
    if (!this.labelByMe.has(panel)) return
    setAttr(panel, "aria-label", null)
    this.labelByMe.delete(panel)
  }

  /** Does at least one of the ids point to an element that exists? */
  private resolves(ids: string): boolean {
    const root = this.getRootNode() as Document | ShadowRoot
    return ids
      .split(/\s+/)
      .some((id) => id !== "" && (root.getElementById?.(id) ?? null) !== null)
  }

  /**
   * The tab the server says is selected, when the user has not selected
   * anything.
   *
   * The server's word, not what is there: what the web component wrote does
   * not count, see `Word`. `aria-selected` first. When that is missing, as in
   * markup written without JavaScript, `hidden` on the panels says the same:
   * the first panel the server shows belongs to the selected tab. If the
   * markup says nothing, or hides every panel, it is the first, which is what
   * a tab list starts on anyway.
   */
  private get derivedIndex(): number {
    const tabs = this.tabs
    const marked = tabs.findIndex((tab) => this.serverSelected(tab) === "true")
    if (marked >= 0) return marked

    const shown = tabs.findIndex((tab) => {
      const panel = this.panelFor(tab)
      return panel !== null && this.serverHidden(panel) === null
    })
    return shown < 0 ? 0 : shown
  }

  /**
   * Restores the user's selection after a patch.
   *
   * Without this the template had to write
   * `data-preserve-attr="aria-selected tabindex"` on every tab and `hidden` on
   * every panel, that is, list the attributes the web component was going to
   * touch. No compiler looked at that list.
   *
   * `apply()` is called whether or not the tabs look right, because a patch
   * may have touched only the panels. That is the narrow patch the
   * documentation itself recommends, and a check on `aria-selected` alone did
   * not see it: the tab said one thing and the screen another.
   */
  private repair(): void {
    if (this.pendingTab) {
      const index = this.tabs.indexOf(this.pendingTab)
      if (isServerControlled(this) && index >= 0 && !this.touchedByOthers()) {
        this.apply(index)
        return
      }
      this.releasePending()
    }

    if (this.chosenTarget === undefined || isServerControlled(this)) {
      /*
       * No user selection to restore, so the server's word decides, and it
       * is written out in full: `aria-selected`, the tab stop and `hidden` in
       * step. Bare structure without `aria-selected` thus gets the first tab
       * selected and the other panels hidden, and a patch that only touched
       * the panels also moves the selection. That applies under
       * `server-controlled` too: the web component does not restore the
       * user's selection there, but still writes out what the server's
       * markup says. If everything already matches, `apply()` writes nothing.
       */
      if (this.tabs.length > 0) {
        const index = this.derivedIndex
        this.apply(index)
        if (this.started) this.alignAddress(index)
      }
      return
    }

    const chosen = this.chosenTarget
    const index = this.chosenIndex()
    if (index < 0) {
      /*
       * The tab no longer exists. The server has sent something else, and
       * then the server's markup applies.
       *
       * With one exception: the markup must hang together afterwards. When
       * the patch removed the marked tab, the tab list is left without a
       * single `aria-selected="true"`, every panel is hidden, and a click
       * does nothing. The web component then selects what the server's
       * markup says, the same way as when the user had not selected
       * anything: `aria-selected`, then the first panel the server shows,
       * then the first tab.
       *
       * The selection is announced with an event, because it was made by the
       * web component and not by the user. Without the event an app that
       * loads the panel's content or writes the selection to the address
       * would never learn that it moved.
       */
      const lostPanel = chosen === undefined ? null : this.byFragment(chosen)
      this.choose(undefined)
      // The server marked a tab itself. Then that applies, and the panels and
      // the tab stop are written to match it, even when nothing else gave the
      // observer another round.
      if (this.markedIndex >= 0) {
        const marked = this.derivedIndex
        this.apply(marked)
        this.alignAddress(marked)
        return
      }
      if (this.tabs.length > 0) {
        // The address says which tab the user was on, and is the only thing
        // that survives the links being replaced. If it is the same panel as
        // before, the selection has not changed, only the links, and then
        // nothing is announced.
        const fromAddress = this.addressIndex
        const index = fromAddress >= 0 ? fromAddress : this.derivedIndex
        const tab = this.tabs[index]
        this.apply(index)
        if (this.panelFor(tab) === lostPanel) {
          this.choose(tab)
          return
        }
        if (fromAddress >= 0) this.choose(tab)
        this.showInAddress(index)
        this.notify(index)
      }
      return
    }

    this.apply(index)
  }

  private bind(): void {
    const tabs = this.tabs

    if (tabs.length === 0) {
      warnAboutMarkup(
        this,
        "found no tabs. The tab list needs a .lt-tabs__list with links " +
          'to the panels, such as <a href="#attachments">; without them a ' +
          'screen reader says "link" where it should say "tab, 2 of 3, ' +
          'selected", and the arrow keys do nothing.',
        // An empty `<lt-tabs>` is a region the server has not filled yet,
        // and that is not a mistake in the markup.
        () => this.childElementCount > 0 && this.tabs.length === 0,
      )
      return
    }

    // Without the numbers in the message. If it interpolates a number, every
    // round is a new message, and the warning comes again for every panel
    // that appears instead of once.
    warnAboutMarkup(
      this,
      "has tabs without a panel: a link points to an id that does not " +
        "exist. Write an id on each .lt-tabs__panel, the same one the " +
        "link points to, or the tabs without a panel can be selected " +
        "without anything being shown.",
      () => this.tabs.some((tab) => this.panelFor(tab) === null),
    )

    warnAboutMarkup(
      this,
      'has a tab without href: role="tab" is on something that is not ' +
        "a link to a panel. Tabs are links, such as <a " +
        'href="#attachments">, so they work without JavaScript, and the ' +
        "component leaves anything that is not a link alone.",
      () => this.nonLinkTabs().length > 0,
    )

    warnAboutMarkup(
      this,
      "has a tab list without a name. Write aria-label on " +
        '.lt-tabs__list, such as aria-label="Parts of the claim", or ' +
        "aria-labelledby pointing to a heading; without a name a screen " +
        'reader only says "tab list".',
      () => {
        const list = this.list
        if (!list || this.tabs.length === 0) return false
        const label = list.getAttribute("aria-label")
        const labelledby = list.getAttribute("aria-labelledby")
        return (
          (label === null || flat(label) === "") &&
          (labelledby === null || !this.resolves(labelledby))
        )
      },
    )
  }

  /** What the server has called a tab in the tab list, but is not a link to a panel. */
  private nonLinkTabs(): Element[] {
    const list = this.list
    if (!list) return []
    const tabs = new Set<Element>(this.tabs)
    return [...list.querySelectorAll(ANY_TAB_SELECTOR)].filter(
      (e) => e.closest(this.localName) === this && !tabs.has(e),
    )
  }

  /**
   * The tab in this tab list the event came from, or -1.
   *
   * `indexOf` and not just `closest`: a tab list inside a panel bubbles its
   * clicks up here too, and they do not belong to this tab list.
   */
  private tabIndexOf(event: Event): number {
    const target = event.target
    if (!(target instanceof Element)) return -1
    const tab = target.closest("[role='tab']")
    return tab ? this.tabs.indexOf(tab as HTMLElement) : -1
  }

  private handleClick = (event: MouseEvent): void => {
    const index = this.tabIndexOf(event)
    if (index < 0) return
    const tab = this.tabs[index]
    // With a modifier the browser opens the link somewhere else, and that is
    // the user's choice, not a tab selection.
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      return
    }
    // Without this the page jumped to the panel.
    event.preventDefault()
    if (this.isDisabled(tab)) return
    this.select(index)
  }

  /** Find in page or a link revealed a hidden panel. */
  private handleBeforematch = (event: Event): void => {
    // Also under `server-controlled`, like a click: the selection stands until
    // the server answers, and `tab-select` tells the app. Otherwise the web
    // component hid the match again in the next round.
    const panel = event.target
    const index = this.tabs.findIndex((tab) => this.panelFor(tab) === panel)
    if (index < 0 || !(panel instanceof Element)) return
    // The browser removes `hidden` on the panel itself, see `revealing`.
    this.revealing = panel
    try {
      this.select(index)
    } finally {
      // After an event from a script, the browser reveals nothing.
      if (event.isTrusted) setTimeout(() => this.revealed(panel), 0)
      else this.revealing = undefined
    }
  }

  /**
   * Releases the panel after `beforematch`, in the task after the browser has
   * finished revealing, and writes the tab list.
   *
   * Usually the browser has removed `hidden` by then. It has not when the
   * panel was taken out of the document during the event, and without this
   * round the panel stayed hidden even though the tab was selected.
   */
  private revealed(panel: Element): void {
    if (this.revealing !== panel) return
    this.revealing = undefined
    if (this.isConnected) this.sync()
  }

  private handleHashchange = (): void => {
    this.selectFromAddress()
  }

  /**
   * The index of the tab the address points to, or -1: the panel itself, such
   * as `#attachments`, or something inside it, such as a heading in the panel.
   */
  private get addressIndex(): number {
    const hash = location.hash.slice(1)
    if (!hash) return -1
    const target = this.byFragment(hash)
    if (!target) return -1
    return this.tabs.findIndex((tab) => {
      const panel = this.panelFor(tab)
      return panel !== null && (panel === target || panel.contains(target))
    })
  }

  /**
   * Corrects the address when it points to another tab in the tab list than
   * the selected one, as when the server has moved the selection. An address
   * to something outside the tab list stays.
   */
  private alignAddress(index: number): void {
    const pointsAt = this.addressIndex
    if (pointsAt >= 0 && pointsAt !== index) this.showInAddress(index)
  }

  /**
   * Writes the tab to the address, so it can be shared, and so the selection
   * survives the server replacing the links.
   *
   * If the address already points to the selected panel or something in it,
   * it stays: a link into the content must not be lost. `replaceState`, so
   * the selection does not become an entry in the history.
   */
  private showInAddress(index: number): void {
    const tab = this.tabs[index]
    const panel = tab ? this.panelFor(tab) : null
    if (!tab || !panel) return
    if (this.addressIndex === index) return
    // Resolved against the page's address, not against `<base>`: with
    // `<base href="/">`, which Angular has, the path was replaced silently,
    // and with a `<base>` to another origin `replaceState` threw.
    const url = new URL(tab.getAttribute("href") ?? "", location.href).href
    try {
      history.replaceState(history.state, "", url)
    } catch {
      // Safari throws after a hundred calls in ten seconds. The address is an
      // extra, so the selection applies anyway.
    }
  }

  /**
   * Selects the tab the address points to.
   *
   * On load, on `hashchange`, and when the server replaces the links without
   * saying which one is selected: the selection is then still in the
   * address. Not under `server-controlled`, where the server decides.
   */
  private selectFromAddress(): void {
    if (isServerControlled(this)) return
    const index = this.addressIndex
    if (index >= 0) this.select(index)
  }

  private handleKeydown = (event: KeyboardEvent): void => {
    // Every keystroke in a field in a panel comes here. The cheap checks first.
    if (!(event.target instanceof Element)) return
    if (!event.target.closest("[role='tab']")) return
    const tabs = this.tabs
    const current = this.tabIndexOf(event)
    if (current < 0) return
    // Alt+Left is "back" in the browser, and Cmd+arrow moves through the
    // history on macOS. With a modifier the key is not for the tabs.
    if (event.altKey || event.ctrlKey || event.metaKey) return

    // Space selects with manual activation. A link does nothing on Space by
    // itself, and Enter sends a click, which `handleClick` handles.
    if (this.manual && event.key === " ") {
      event.preventDefault()
      this.select(current)
      return
    }

    // On a page read from right to left the next tab is to the left. Without
    // this the right arrow moved focus visually backwards.
    const rtl = getComputedStyle(this).direction === "rtl"
    // Up and down arrows stole page scrolling in a horizontal tab list and
    // departed from WAI-ARIA. They apply only when the tab list says it is
    // vertical.
    const vertical =
      tabs[current]
        .closest("[role='tablist']")
        ?.getAttribute("aria-orientation") === "vertical"
    const steps: Record<string, number> = vertical
      ? { ArrowDown: 1, ArrowUp: -1 }
      : { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }

    let next: number | undefined

    if (event.key in steps) {
      next = this.nextEnabled(current, steps[event.key])
    } else if (event.key === "Home") {
      next = this.nextEnabled(-1, 1)
    } else if (event.key === "End") {
      next = this.nextEnabled(tabs.length, -1)
    }

    if (next === undefined) return

    event.preventDefault()
    if (!this.manual) this.select(next)
    tabs[next].focus()
  }

  /**
   * The next tab that can be selected, in one direction, wrapping round if
   * needed.
   *
   * A tab that cannot be selected is skipped. When a hidden tab was selected,
   * it got the tab stop, and Tab never reached the tab list. The keyboard
   * user was locked out.
   */
  private nextEnabled(from: number, step: number): number | undefined {
    const tabs = this.tabs
    for (let i = 1; i <= tabs.length; i++) {
      const index = (from + step * i + tabs.length * i) % tabs.length
      if (!this.isDisabled(tabs[index])) return index
    }
    return undefined
  }

  /** Selects a tab and fires the event. */
  select(index: number): void {
    const tabs = this.tabs
    if (index < 0 || index >= tabs.length) return
    if (this.isDisabled(tabs[index])) return
    // `markedIndex` and not `selected`: the latter answers 0 also when nothing
    // is marked, and then the first tab could never be selected.
    if (index === this.markedIndex) return

    // No memory when the server decides the selection. Without this a
    // selection made while the attribute was there would be restored the
    // moment someone removed it again.
    if (!isServerControlled(this)) this.choose(tabs[index])
    this.apply(index)
    if (isServerControlled(this)) this.pendingTab = tabs[index]
    this.showInAddress(index)
    this.notify(index)
  }

  /** Announces which tab is selected now. */
  private notify(index: number): void {
    this.dispatchEvent(
      new CustomEvent("tab-select", {
        detail: { index },
        bubbles: true,
        composed: true,
      }),
    )
  }

  /**
   * Writes the selection out into the markup.
   *
   * Every write compares first. The web component observes the same
   * attributes it sets, so a write without a comparison would trigger the
   * observer, which would write again, forever.
   */
  private apply(index: number): void {
    const tabs = this.tabs
    /*
     * The tab stop is the selected tab, unless a patch has disabled or hidden
     * it. Then the next tab that can be selected gets it, or Tab skips past
     * the whole tab list.
     */
    const stop = this.isDisabled(tabs[index])
      ? (this.nextEnabled(index, 1) ?? index)
      : index
    /*
     * A panel is visible when any tab pointing to it is selected, and is
     * written once. When two tabs point to the same one, through a mistake in
     * the markup, they would otherwise write opposite `hidden` on it in every
     * round, and the page would freeze.
     */
    const panels = new Map<HTMLElement, boolean>()

    tabs.forEach((tab, i) => {
      const chosen = i === index
      // The server's word is noted before the write, or the write was read as
      // the server's in the next round.
      const server = this.serverSelected(tab)
      setAttr(tab, "aria-selected", String(chosen))
      this.selectedMemory.set(tab, { written: String(chosen), server })
      markWritten(tab, "aria-selected", String(chosen) !== server)
      setAttr(tab, "tabindex", i === stop ? "0" : "-1")

      const panel = this.panelFor(tab)
      if (panel) panels.set(panel, (panels.get(panel) ?? false) || chosen)
    })

    // The form is read from a panel the server hides before anything is
    // written, or a panel to be hidden first in the tab list was written in a
    // different form from the ones the server hides.
    for (const panel of panels.keys()) {
      const form = this.serverHidden(panel)
      if (form !== null) {
        this.hiddenForm = form
        break
      }
    }

    for (const [panel, shown] of panels) {
      const server = this.serverHidden(panel)
      const written = shown ? null : this.hiddenForm
      if (panel !== this.revealing) {
        if (written === null) setFlag(panel, "hidden", false)
        else setAttr(panel, "hidden", written)
        this.hiddenMemory.set(panel, { written, server })
        markWritten(panel, "hidden", written !== server)
      }
      /*
       * Only the selected panel is a tab stop, so Tab from the tab list goes
       * straight into the content that was just shown. A panel with
       * `hidden="until-found"` keeps its box, so with `tabindex="0"` it was
       * an invisible stop for the keyboard. Another value the server wrote,
       * such as `-1`, stays.
       */
      const tabindex = panel.getAttribute("tabindex")
      if (shown && tabindex === null) setAttr(panel, "tabindex", "0")
      else if (!shown && tabindex === "0") setAttr(panel, "tabindex", null)
    }
  }
}

export function defineLtTabs(tagName: string = LT_TABS_TAG): void {
  defineElement(tagName, LtTabs)
}
