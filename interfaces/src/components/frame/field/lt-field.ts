import { ERROR_TEXT_CLASS } from "../../css/error-text/error-text.js"
import { HELP_TEXT_CLASS } from "../../css/help-text/help-text.js"
import {
  addClass,
  defineElement,
  HostElement,
  ownership,
  setAttr,
  setFlag,
  uniqueId,
  WRITTEN,
  warnAboutCopiedMark,
  warnAboutMarkup,
  watcher,
} from "../../host-element.js"
import { computeFieldAttributes } from "./field-core.js"

export const LT_FIELD_TAG = "lt-field" as const

/**
 * The parts the field looks for, as selectors relative to the element. The
 * component finds its parts with these, and the manifest describes them for
 * whoever assembles the markup by hand, so the two cannot say different
 * things.
 */
export const LT_FIELD_PARTS = {
  label: "label",
  control: "input:not([type='hidden']), textarea, select",
  help: `.${HELP_TEXT_CLASS}`,
  error: `.${ERROR_TEXT_CLASS}`,
} as const

const CONTROL_SELECTOR = LT_FIELD_PARTS.control

type Marker = "none" | "symbol" | "text"

function readMarker(value: string | null | undefined): Marker | undefined {
  return value === "none" || value === "symbol" || value === "text"
    ? value
    : undefined
}

/**
 * The attributes `<lt-field>` observes. It computes most of them itself, and
 * sets them back if they disappear. `id` on the control, and `hidden` and
 * `style` on the error text, it only reads: they come from the template.
 *
 * The same list once lived in `FIELD_PRESERVED_ATTRIBUTES`, which the
 * template had to copy into `data-preserve-attr`. That list no longer
 * exists: the component sees that the attributes are gone and sets them
 * back.
 */
const DERIVED_ATTRIBUTES = [
  // A morph from the server removes the mark, and the component puts it
  // back: the same markup must give the same page.
  WRITTEN,
  "class",
  "for",
  "id",
  "aria-describedby",
  "aria-invalid",
  "aria-disabled",
  "data-state",
  "data-required",
  "data-optional",
  "disabled",
  "hidden",
  // `data-show` in Datastar hides the error text with `display: none`.
  "style",
]

/**
 * Connects label, control, help text and error text in plain DOM.
 *
 * The component is for markup from code that cannot call a builder function:
 * a Go template, a PHP file, a Razor view or handwritten HTML. When the code
 * can, in TypeScript wherever it runs, or in Kotlin or Java, `lt.field()` or
 * `Lt.field()` should write the attributes instead, and this element is not
 * needed.
 *
 * The component renders nothing. It used to insert a `<slot>` element into
 * plain DOM, and since the server did not know about it, Datastar's morph
 * removed it on every patch.
 *
 * The template writes what HTML requires for the field to work without
 * JavaScript: `for` on the label and `id` on the control, or the label
 * wrapping the control. The component writes the rest: the ids of the help
 * text and the error text, `aria-describedby`, `aria-invalid` and the
 * classes. If a morph removes them, the component sees it and sets them back.
 *
 * The component never writes an id on the control. Datastar and idiomorph
 * recognise a node by its id, and a control with an id the server did not
 * send is replaced on the next update, along with focus and what the user
 * has typed.
 *
 * The field is invalid when the error text is visible, that is when it has
 * no `hidden`, or when the server has written `aria-invalid` on the control.
 * There is no separate state on the host: a template renders the error text
 * when the field is invalid, and client code toggles `hidden`.
 */
export class LtField extends HostElement {
  static observedAttributes = ["disabled", "optional", "described-by"] as const

  /**
   * The children and the derived attributes, watched while connected.
   * `style` is observed for `display: none` on the error text; a style write
   * elsewhere in the field, such as a popover positioning its panel, does not
   * concern the wiring.
   */
  private readonly watch = watcher(
    (records) => {
      const onlyForeignStyle = records.every(
        (r) =>
          r.type === "attributes" &&
          r.attributeName === "style" &&
          !(r.target as Element).matches?.(LT_FIELD_PARTS.error),
      )
      if (!onlyForeignStyle) this.sync()
    },
    {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: DERIVED_ATTRIBUTES,
      // A morph can change the text of the error text without replacing the node.
      characterData: true,
    },
  )
  /**
   * The ids the help text and the error text last had, whether they came
   * from the markup or from here, so a patch that removes them gets the same
   * one back and not a new one. `managedIds` is every id the component has
   * ever managed. Together with whether the id still points to an element,
   * that tells them apart from the ids the server put in `aria-describedby`.
   */
  private lastHelpId?: string
  private lastErrorId?: string
  private readonly managedIds = new Set<string>()
  /**
   * What the component wrote on the control and the label, and the server's
   * word it wrote against, per node. The memory has to survive the host
   * being disconnected and connected again, as when React moves a field,
   * and the control disappearing and coming back in a patch: a property
   * reset in `disconnectedCallback` made the component read its own
   * `aria-invalid="true"` as the server's word after a move, and the field
   * could never become valid again. The component both reads and writes
   * `data-required` and `data-optional` on the label too, and without the
   * memory `optional` and the required marker could not be turned off.
   */
  private readonly own = ownership()
  /**
   * Labels where the server wrote a `for` pointing to a different id than
   * the control's. The component rewrites it, but without JavaScript the
   * field had no label, so it must be reported, once. The memory is not
   * reset: after the rewrite the right value is there, and it cannot be told
   * apart from a server that corrected itself.
   */
  private readonly wrongFor = new WeakSet<Element>()
  /**
   * The control last time.
   *
   * Enough to see that a server update replaced it because the id changed:
   * Datastar and idiomorph recognise a node by its id, and a new id from the
   * server is a new node to them. That happens when the template builds the
   * id from something that changes between renders, such as a random number
   * or a counter.
   *
   * A reference, not just an entry in `memory`: the replacement is detected
   * by comparing it with the control that is there now, and what the old one
   * contained must be readable after it has left the tree. It keeps one
   * detached node alive until the next `sync()`, on purpose.
   */
  private lastControl?: HTMLElement

  /**
   * The properties mirror the attributes.
   *
   * The state lives in the attribute and not in a field on the class, so what
   * the server sent and what the component thinks are always the same.
   */
  get disabled(): boolean {
    return this.hasAttribute("disabled")
  }

  set disabled(value: boolean) {
    setFlag(this, "disabled", value)
  }

  get optional(): boolean {
    return this.hasAttribute("optional")
  }

  set optional(value: boolean) {
    setFlag(this, "optional", value)
  }

  get describedBy(): string | undefined {
    return this.getAttribute("described-by") ?? undefined
  }

  set describedBy(value: string | undefined) {
    setAttr(this, "described-by", value ?? null)
  }

  connectedCallback(): void {
    /*
     * `slotchange` does not fire in plain DOM, and the content is replaced
     * while the user fills in the form.
     *
     * The attributes are observed, not just the children. A morph removes
     * whatever is not in the server's HTML, and the wiring between label,
     * field and help text is exactly that: something the component computed,
     * not something the server sent. The template used to have to list the
     * attributes in `data-preserve-attr` for them to survive. Now the
     * component sees that they are gone, and sets them back.
     *
     * The list is limited to what the component derives itself. The other
     * components do the same with their state, each with its own list.
     *
     * Every write in `sync()` compares first. Without that the observer
     * would trigger itself forever.
     */
    this.watch.start(this)
    this.sync()
  }

  disconnectedCallback(): void {
    this.watch.stop()
  }

  attributeChangedCallback(): void {
    if (this.isConnected) this.sync()
  }

  /**
   * The label the field belongs with.
   *
   * Usually it is inside the element. If it is outside, with `for` pointing
   * to the control, the field is just as well named, and the component
   * connects it the same way. One difference is worth knowing: a label
   * outside is not in what the component observes, so if a patch removes its
   * class, the class does not come back by itself.
   */
  /**
   * Remembers whether the server wrote a `for` that was not the control's
   * id. What the component itself wrote last does not count.
   */
  private noteFor(label: Element, id: string): void {
    const current = label.getAttribute("for")
    if (current === null || current === id) return
    if (current !== this.own.written(label, "for")) this.wrongFor.add(label)
  }

  private resolveLabel(control: HTMLElement | null): HTMLLabelElement | null {
    const inside = this.ownPart<HTMLLabelElement>(LT_FIELD_PARTS.label)
    if (inside || !control?.id) return inside

    const root = this.getRootNode() as Document | ShadowRoot
    return (
      root.querySelector?.<HTMLLabelElement>(
        `label[for="${CSS.escape(control.id)}"]`,
      ) ?? null
    )
  }

  /**
   * The parts that belong to this field, and not to a field further down.
   *
   * A field can be inside another: a search field in a popover inside the
   * field, or an `<lt-field>` in an `<lt-field>`. `querySelector` over the
   * whole subtree then found the innermost field's control first, and the
   * outer field wrote its wiring on it. The scoping is the same as the one
   * `derivedParts()` in `host-element.ts` uses for the other components.
   */
  private ownParts<T extends Element>(selector: string): T[] {
    return [...this.querySelectorAll<T>(selector)].filter(
      (part) => part.closest(this.localName) === this,
    )
  }

  private ownPart<T extends Element>(selector: string): T | null {
    return this.ownParts<T>(selector)[0] ?? null
  }

  /**
   * Reports when an update replaced the control because the id from the
   * server changed.
   *
   * The message only comes when the user had something to lose: the old
   * control has left the tree, both had an id from the server, the ids
   * differ, and the old one contained something other than the new one. A
   * server that sends a different field on purpose usually also has a
   * different label or a different `name`; then it stays silent. The
   * comparison is with the new control, not with the old one's
   * `defaultValue`: a `<select>` always has a selected option without any
   * being `defaultSelected`, and a server that sends back the text the user
   * typed has lost nothing.
   */
  private warnAboutReplacedControl(
    lost: HTMLElement,
    control: HTMLElement,
  ): void {
    if (lost.isConnected || !lost.id || !control.id || lost.id === control.id)
      return
    if (lost.getAttribute("name") !== control.getAttribute("name")) return
    if (!this.differs(lost, control)) return

    warnAboutMarkup(
      this,
      "a server update replaced the control and lost what the user " +
        "had typed in it, because the control's id was different from " +
        "last time and the update did not recognise it. Build the id " +
        "from something that is the same every time, such as the field " +
        "name or a key in the data, not from a random number or a " +
        "counter.",
      // The replacement has happened and cannot undo itself, unless a new
      // update has already replaced the control again.
      () =>
        !lost.isConnected &&
        this.ownPart<HTMLElement>(CONTROL_SELECTOR) === control,
    )
  }

  /**
   * Did the old control contain something other than the new one?
   *
   * A checkbox and a radio button have the same `value` either way, so there
   * the checked state is what counts. A `<select>` is compared on the
   * selected options, since `value` is only the first of them.
   */
  private differs(lost: HTMLElement, control: HTMLElement): boolean {
    if (
      lost instanceof HTMLSelectElement &&
      control instanceof HTMLSelectElement
    ) {
      const chosen = (select: HTMLSelectElement) =>
        [...select.selectedOptions].map((o) => o.value).join("\n")
      return chosen(lost) !== chosen(control)
    }
    if (
      lost instanceof HTMLInputElement &&
      control instanceof HTMLInputElement &&
      (lost.type === "checkbox" || lost.type === "radio")
    ) {
      return lost.checked !== control.checked
    }
    return (
      (lost as HTMLInputElement).value !== (control as HTMLInputElement).value
    )
  }

  private sync(): void {
    const control = this.ownPart<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >(CONTROL_SELECTOR)
    const help = this.ownPart<HTMLElement>(LT_FIELD_PARTS.help)
    const error = this.ownPart<HTMLElement>(LT_FIELD_PARTS.error)

    if (!control) {
      warnAboutMarkup(
        this,
        "found no control to connect. Add an <input>, <textarea> or " +
          "<select>, or the label, help text and error text have no field " +
          "to be connected to.",
        () => this.ownParts(CONTROL_SELECTOR).length === 0,
        { silentWhenEmpty: true },
      )
      return
    }

    // The wiring applies to one control, and that is the first. Another
    // control in the same field has no label, help text or error text, and
    // that must be reported rather than left silently unconnected.
    warnAboutMarkup(
      this,
      "has more than one control, and only the first gets the label, " +
        "help text and error text connected to it. Give each control " +
        "its own <lt-field>, or put a group in a <fieldset> with a " +
        "<legend>.",
      () => this.ownParts(CONTROL_SELECTOR).length > 1,
    )

    // The label can be outside the element. The lookup has to happen after
    // the control is found, since it goes through the control's id.
    const label = this.resolveLabel(control)

    warnAboutMarkup(
      this,
      "<label> is not connected to the field: the field has no id, " +
        "and the label does not wrap it, so without JavaScript a screen " +
        "reader announces the field without a name. Write an id on the " +
        "field and the same value in for on the label, or wrap the " +
        "field in the <label>; the component does not write the id " +
        "itself, because an id the server did not send makes a server " +
        "update replace the field.",
      () => {
        const now = this.ownPart<HTMLElement>(CONTROL_SELECTOR)
        const labelNow = this.resolveLabel(now)
        return (
          now !== null &&
          labelNow !== null &&
          !now.id &&
          !labelNow.contains(now) &&
          !now.hasAttribute("aria-label") &&
          !now.hasAttribute("aria-labelledby")
        )
      },
    )

    // `for` wins over the label wrapping the field. If it points to another
    // id, the field has no label, with JavaScript too.
    warnAboutMarkup(
      this,
      "<label> wraps the field, but its for points to a different id " +
        "than the field's, and for wins, so a screen reader announces " +
        "the field without a name. Remove for, or give the field the " +
        "same id.",
      () => {
        const now = this.ownPart<HTMLElement>(CONTROL_SELECTOR)
        const labelNow = this.ownPart<HTMLLabelElement>(LT_FIELD_PARTS.label)
        if (!now || !labelNow?.contains(now)) return false
        const target = labelNow.getAttribute("for")
        return target !== null && target !== now.id
      },
    )

    warnAboutMarkup(
      this,
      "for on the label pointed to a different id than the field's. " +
        "The component rewrote it, but without JavaScript the field has " +
        "no label and a screen reader announces it without a name, so " +
        "write the field's id in for in the template.",
      () => {
        const now = this.ownPart<HTMLElement>(CONTROL_SELECTOR)
        const labelNow = this.resolveLabel(now)
        return now !== null && labelNow !== null && this.wrongFor.has(labelNow)
      },
    )

    warnAboutMarkup(
      this,
      "found no <label>, so the field has no label and a screen " +
        "reader announces it without a name. If the label is outside " +
        "<lt-field>, its for must point to the field's id.",
      /*
       * Three valid ways to give the field a name, and none of them should
       * give a warning: a `<label>` inside, a `<label for>` outside, or
       * `aria-label` and `aria-labelledby` on the control, as in a search
       * field with only an icon.
       */
      () => {
        const named = this.ownPart<HTMLElement>(CONTROL_SELECTOR)
        if (!named || this.resolveLabel(named)) return false
        // A <label> around the whole <lt-field> also gives the control a name.
        if (((named as HTMLInputElement).labels?.length ?? 0) > 0) return false
        return (
          !named.hasAttribute("aria-label") &&
          !named.hasAttribute("aria-labelledby")
        )
      },
    )

    /*
     * The ids the help text and the error text last had, remembered between
     * rounds.
     *
     * The markup is the source as long as it has them. If a morph removes
     * them, a new id would be created for every single patch, and a screen
     * reader in the middle of announcing would follow a reference that
     * changed under it. The memory is not a parallel copy of the state: if
     * the id is in the markup, that is the one that applies.
     */
    if (help) {
      if (help.id) this.lastHelpId = help.id
      else {
        this.lastHelpId ??= uniqueId("lt-field-help")
        setAttr(help, "id", this.lastHelpId)
      }
      this.managedIds.add(help.id)
    }
    if (error) {
      if (error.id) this.lastErrorId = error.id
      else {
        this.lastErrorId ??= uniqueId("lt-field-error")
        setAttr(error, "id", this.lastErrorId)
      }
      this.managedIds.add(error.id)
    }

    // The markers are also read from the markup. If the server wrote them
    // with `lt.field()`, they are on the label, and a component that only
    // looked at its own attributes would remove them again. In React that
    // gave a hydration error: the server sent `data-required="symbol"`, the
    // component removed it, and then React decided the HTML did not match.
    const serverLabel = {
      required: label ? this.own.serverWord(label, "data-required") : null,
      optional: label
        ? this.own.serverWord(label, "data-optional", { presence: true }) !==
          null
        : false,
    }
    const marker = readMarker(serverLabel.required)

    // The state is read from the markup, not just from an attribute on the
    // host. If the server wrote the field with `lt.field()`, the answer is
    // already on the control, and a component that computed its own would
    // remove it again. The two halves of the API then fought each other.
    // `ownership()` in host-element.ts tells the server's word apart from
    // what the component wrote: by the value and the node it wrote it on,
    // never by what the host said last, which gave two answers for the same
    // markup depending on what the host had been through.
    // A control the component has never written on holds only the server's
    // word, and a mark found there was copied into the template.
    if (!this.own.knows(control, "aria-invalid"))
      warnAboutCopiedMark(this, control)
    const server = {
      invalid: this.own.serverWord(control, "aria-invalid"),
      describedBy: this.own.serverWord(control, "aria-describedby"),
      disabled:
        this.own.serverWord(control, "disabled", { flag: true }) !== null,
    }

    // `aria-invalid` has four valid values, and both `grammar` and
    // `spelling` mean invalid. Absence, `false` and the empty string mean
    // valid; ARIA says the empty string is read as `false`, and assistive
    // technology does so, so the component cannot show a red border for it.
    const serverInvalid =
      server.invalid !== null &&
      server.invalid !== "false" &&
      server.invalid !== ""
    // A visible error text means the field is invalid. It is not the
    // component's to hide: the template renders it when the field is
    // invalid, and client code toggles `hidden`, or `display: none` as
    // `data-show` in Datastar does. An empty error text says nothing, such as
    // a container that `data-text` fills.
    const errorShown =
      error !== null &&
      !error.hasAttribute("hidden") &&
      (error.textContent ?? "").trim() !== "" &&
      // Last, since it forces a style computation.
      getComputedStyle(error).display !== "none"
    const invalid = serverInvalid || errorShown
    const disabled = this.hasAttribute("disabled") || server.disabled

    /*
     * The ids the server put in `aria-describedby`, apart from those the
     * component manages. `lt.field({ describedBy })` writes them straight on
     * the control, and they must be kept. The managed ones are removed here
     * and added again from the current state, or the error text's id stayed
     * after the error was gone.
     *
     * Managed means the current help text and error text, and an id the
     * component managed before that no longer points to anything. The latter
     * is for a script that removes the help text without touching the
     * control. Who an id belongs to is decided by the DOM and not by the
     * history alone: if the id still points to an element, as when the
     * server moves the help text out of the field and keeps the id, it is the
     * server's.
     */
    const root = this.getRootNode() as Document | ShadowRoot
    const managedNow = (id: string) =>
      id === help?.id ||
      id === error?.id ||
      (this.managedIds.has(id) && !root.getElementById?.(id))
    const serverExtras = (server.describedBy ?? "")
      .split(/\s+/)
      .filter((id) => id && !managedNow(id))

    const computed = computeFieldAttributes({
      // `computeFieldAttributes` requires an id. The control's id is used
      // when it exists; otherwise a stem that is never written, since the
      // component writes neither an id on the control nor `for` from it.
      id: control.id || "lt-field",
      help: Boolean(help),
      // Only a visible error text describes the field. If the server says
      // invalid while the message is hidden, the reference must not point to
      // something hidden.
      error: errorShown,
      helpId: help?.id,
      errorId: error?.id,
      required: marker === "symbol" || marker === "text" ? marker : undefined,
      optional: this.hasAttribute("optional") || serverLabel.optional,
      invalid,
      disabled,
      describedBy: [...serverExtras, this.getAttribute("described-by") ?? ""],
    })

    if (this.lastControl && this.lastControl !== control) {
      this.warnAboutReplacedControl(this.lastControl, control)
    }
    this.lastControl = control

    if (label) {
      addClass(label, computed.label.class)
      // `for` and `id` are the same piece of information, and the two must
      // not say different things. It is written from the control's id, never
      // the other way round, and not when the label wraps the control, where
      // the wiring is implicit.
      if (control.id && !label.contains(control)) {
        this.noteFor(label, control.id)
        this.own.write(label, "for", control.id)
      }
      this.own.write(
        label,
        "data-required",
        computed.label["data-required"] ?? null,
        { server: serverLabel.required, mark: true },
      )
      this.own.write(
        label,
        "data-optional",
        computed.label["data-optional"] ?? null,
        {
          server: serverLabel.optional ? "" : null,
          mark: true,
          presence: true,
        },
      )
      setAttr(label, "aria-disabled", computed.label["aria-disabled"])
    }

    // The server's word stays verbatim when it is the server that says the
    // field is invalid, `spelling` and `grammar` included. Otherwise the
    // component writes `true` when the host says so, and leaves a `false`
    // the server wrote: it is valid and common in handwritten HTML, and used
    // to be removed on every patch.
    const ariaInvalid = serverInvalid
      ? server.invalid
      : invalid
        ? "true"
        : server.invalid

    this.own.write(
      control,
      "aria-describedby",
      computed.control["aria-describedby"] ?? null,
      { server: server.describedBy, mark: true },
    )
    this.own.write(control, "aria-invalid", ariaInvalid, {
      server: server.invalid,
      mark: true,
    })
    // `setFlag` and not `setAttr`: a template may have written
    // `disabled="disabled"`, and it must stay as it is. `setAttr` would
    // normalise the value to the empty string, and since `disabled` is among
    // the attributes the component observes, the server and the component
    // would each write their own value on every patch. No `aria-disabled`
    // alongside it: a real `disabled` is already visible to assistive
    // technology, and `computeFieldAttributes` only writes it on the label.
    this.own.write(control, "disabled", disabled ? "" : null, {
      server: server.disabled ? "" : null,
      mark: true,
      flag: true,
    })

    // `data-state` is only set on the system's controls, and only when the
    // consumer has not set it. It is only removed when the component set it
    // and the field is no longer invalid. A `data-state` a template wrote by
    // hand stays as the template wrote it.
    const isSystemField =
      control.classList.contains("lt-input") ||
      control.classList.contains("lt-textarea") ||
      control.classList.contains("lt-select")

    const state = computed.control["data-state"]
    if (state && isSystemField && !control.hasAttribute("data-state")) {
      this.own.write(control, "data-state", state)
    } else if (
      !state &&
      this.own.written(control, "data-state") != null &&
      control.getAttribute("data-state") === "invalid"
    ) {
      this.own.write(control, "data-state", null)
    }
  }
}

export function defineLtField(tagName: string = LT_FIELD_TAG): void {
  defineElement(tagName, LtField)
}
