import { attributes, checkedKeys, idOrFallback } from "../../css/shared.js"
import {
  computeFieldAttributes,
  type FieldOptions,
} from "../field/field-core.js"

export const SUGGESTION_CLASS = "lt-suggestion" as const
export const SUGGESTION_LIST_CLASS = "lt-suggestion__list" as const
export const SUGGESTION_OPTION_CLASS = "lt-suggestion__option" as const
export const SUGGESTION_EMPTY_CLASS = "lt-suggestion__empty" as const
export const SUGGESTION_VALUE_CLASS = "lt-suggestion__value" as const
export const SUGGESTION_STATUS_CLASS = "lt-sr-only" as const

export type SuggestionOptions = Omit<FieldOptions, "id"> & {
  /**
   * Shared id stem. The control becomes `${id}`, the list `${id}-list`, and
   * the options `${id}-option-${key}`. Make it from a key in the data, never
   * from the loop index or a counter, so it is unique on the page and the
   * same on every render.
   */
  id: string
  /**
   * One key per option the server sends, taken from the data, such as a
   * record id. The key gives the option its id, so an update that sends the
   * list again recognises the options. An empty key, whitespace or two
   * identical keys throw. Default: no options.
   */
  keys?: string[]
  /** The option highlighted with the arrow keys. Default: none. */
  activeIndex?: number
  /** The list is open. Default: closed. */
  open?: boolean
  /**
   * The answer to the search has not arrived yet. The list gets `aria-busy`,
   * and the empty message stays hidden, so an asynchronous search does not
   * say "No matches" in the gap between the keystroke and the answer.
   */
  pending?: boolean
}

/**
 * The attributes for a field with a suggestion list.
 *
 * The server writes both the field and the list. The web component filters,
 * handles the arrow keys and keeps `aria-activedescendant` in sync. It
 * renders nothing: it used to create the whole field itself, and then there
 * was nothing to fill in before the script had run.
 *
 * No preserve list. The attributes that change while the user types are set
 * by the web component, and it sets them back when a patch strips them. If
 * something else has already filtered, set `prefiltered` on
 * `<lt-suggestion>`, and the web component leaves both the options and the
 * empty message alone. If the server should also decide whether the list is
 * expanded and which option is highlighted, set `server-controlled` as well.
 */
export const suggestion = ({
  id: givenId,
  keys: givenKeys = [],
  activeIndex = -1,
  open = false,
  pending = false,
  ...field
}: SuggestionOptions) => {
  // The fallback only matters for callers without a type check.
  const id = idOrFallback("lt.suggestion()", givenId)
  const keys = checkedKeys("lt.suggestion()", givenKeys)
  const count = keys.length
  const computed = computeFieldAttributes({ ...field, id })
  const listId = `${id}-list`
  const labelId = `${id}-label`
  const statusId = `${id}-status`
  const optionId = (index: number) => `${id}-option-${keys[index]}`
  // The highlight is written only when the list is open, both halves
  // together. The web component removes both as the list closes, and a
  // closed list with a highlighted option would point
  // `aria-activedescendant` into something hidden.
  const marked =
    open &&
    Number.isInteger(activeIndex) &&
    activeIndex >= 0 &&
    activeIndex < count

  return {
    // The label also names the list, through `aria-labelledby`.
    label: attributes({ ...computed.label, id: labelId }, computed.label),
    control: attributes(
      {
        ...computed.control,
        class: "lt-input" as const,
        type: "text" as const,
        role: "combobox" as const,
        autocomplete: "off" as const,
        "aria-expanded": (open ? "true" : "false") as "true" | "false",
        "aria-controls": listId,
        "aria-describedby": [computed.control["aria-describedby"], statusId]
          .filter(Boolean)
          .join(" "),
        "aria-autocomplete": "list" as const,
        "aria-activedescendant": marked ? optionId(activeIndex) : undefined,
      },
      computed.control,
    ),
    /**
     * The list. It sits in the top layer, `popover="manual"`, so a parent
     * with `overflow` does not clip it. `hidden` still says whether it is
     * open; the web component opens and closes the popover from that.
     */
    list: attributes({
      class: SUGGESTION_LIST_CLASS,
      id: listId,
      role: "listbox" as const,
      "aria-labelledby": labelId,
      popover: "manual" as const,
      hidden: open ? undefined : (true as const),
      "aria-busy": pending ? ("true" as const) : undefined,
    }),
    options: keys.map((_, index) =>
      attributes({
        class: SUGGESTION_OPTION_CLASS,
        id: optionId(index),
        role: "option" as const,
        "aria-selected": (marked && index === activeIndex ? "true" : "false") as
          | "true"
          | "false",
      }),
    ),
    /**
     * The text shown when nothing matches.
     *
     * It follows the list: visible only when the list is open and empty. The
     * stylesheet handles a closed list, with a rule that hides the empty
     * message after a list with `hidden`. The builder function therefore
     * only says whether there are matches, and whether the answer has
     * arrived (`pending`). It used to read `open`, and with `prefiltered` the
     * app controls the empty message without knowing whether the list is
     * open: that state belongs to the web component, so the message could
     * never be shown.
     */
    empty: attributes({
      class: SUGGESTION_EMPTY_CLASS,
      hidden: count === 0 && !pending ? undefined : (true as const),
    }),
    /**
     * The region that announces the number of matches to screen readers.
     *
     * The web component writes the text while the user types, so it is not
     * in the server's version. If an update empties the element, the web
     * component writes the text again. The element must still be in the
     * markup the server sends, or there is nothing to announce into before
     * the script has run. `role="status"` implies `aria-live="polite"`.
     */
    status: attributes({
      class: SUGGESTION_STATUS_CLASS,
      id: statusId,
      role: "status" as const,
    }),
    /**
     * The hidden field that receives the code of the option the user chose.
     *
     * The field shows the text, and without JavaScript the text is what is
     * submitted. With JavaScript the web component writes `data-value` from
     * the option here, or the text when the option has no `data-value`, and
     * empties it when the user changes the text. You write `name` yourself;
     * it belongs to your form.
     */
    value: attributes({
      class: SUGGESTION_VALUE_CLASS,
      type: "hidden" as const,
    }),
    help: computed.help,
    error: computed.error,
    state: computed.state,
  }
}
