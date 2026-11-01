import { attributes } from "../shared.js"

export const TOGGLE_GROUP_CLASS = "lt-toggle-group" as const
/** The label around each option. */
export const TOGGLE_GROUP_OPTION_CLASS = "lt-toggle-group__option" as const

export type ToggleGroupAttributes = {
  class: typeof TOGGLE_GROUP_CLASS
}

/**
 * The attributes for a group where one option is selected at a time.
 *
 * The group is radio buttons in disguise. Each option is a `<label>` with an
 * `<input type="radio">` inside, visually shrunk away. You then keep the
 * arrow keys, `FormData` and the screen reader saying "2 of 3" without
 * writing any of it again.
 *
 * If the choices are actions rather than a setting, such as "bold, italic,
 * underline", buttons with `aria-pressed` belong there instead.
 *
 * ```ts
 * <fieldset {...toggleGroup()}>
 *   <legend class="lt-sr-only">View</legend>
 *   <label class={toggleGroup.option}>
 *     <input type="radio" name="view" value="dry" checked /> Dry
 *   </label>
 * </fieldset>
 * ```
 */
export const toggleGroup = Object.assign(
  (): ToggleGroupAttributes => attributes({ class: TOGGLE_GROUP_CLASS }),
  {
    /** The class on the label around each option. */
    option: TOGGLE_GROUP_OPTION_CLASS,
  },
)
