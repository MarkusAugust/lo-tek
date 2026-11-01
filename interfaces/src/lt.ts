import { accordion } from "./components/css/accordion/accordion.js"
import { alert } from "./components/css/alert/alert.js"
import { avatar } from "./components/css/avatar/avatar.js"
import { badge } from "./components/css/badge/badge.js"
import { breadcrumbs } from "./components/css/breadcrumbs/breadcrumbs.js"
import { button } from "./components/css/button/button.js"
import { card } from "./components/css/card/card.js"
import { checkbox } from "./components/css/checkbox/checkbox.js"
import { divider } from "./components/css/divider/divider.js"
import { errorText } from "./components/css/error-text/error-text.js"
import { fieldset, legend } from "./components/css/fieldset/fieldset.js"
import { fileUpload } from "./components/css/file-upload/file-upload.js"
import { heading } from "./components/css/heading/heading.js"
import { helpText } from "./components/css/help-text/help-text.js"
import { icon } from "./components/css/icon/icon.js"
import { input } from "./components/css/input/input.js"
import { label } from "./components/css/label/label.js"
import { link } from "./components/css/link/link.js"
import { list } from "./components/css/list/list.js"
import { pagination } from "./components/css/pagination/pagination.js"
import { paragraph } from "./components/css/paragraph/paragraph.js"
import { progress } from "./components/css/progress/progress.js"
import { radio } from "./components/css/radio/radio.js"
import { search } from "./components/css/search/search.js"
import { select } from "./components/css/select/select.js"
import {
  fieldStates,
  isFieldState,
  isRequiredMarker,
  requiredMarkers,
} from "./components/css/shared.js"
import { skeleton } from "./components/css/skeleton/skeleton.js"
import { skipLink } from "./components/css/skip-link/skip-link.js"
import { spinner } from "./components/css/spinner/spinner.js"
import { srOnly } from "./components/css/sr-only/sr-only.js"
import { switchControl } from "./components/css/switch/switch.js"
import { table, tableSort } from "./components/css/table/table.js"
import { tag } from "./components/css/tag/tag.js"
import { textarea } from "./components/css/textarea/textarea.js"
import { toggleGroup } from "./components/css/toggle-group/toggle-group.js"
import { tooltip } from "./components/css/tooltip/tooltip.js"
import { dialog } from "./components/frame/dialog/dialog.js"
import { errorSummary } from "./components/frame/error-summary/error-summary.js"
import { computeFieldAttributes } from "./components/frame/field/field-core.js"
import { popover } from "./components/frame/popover/popover.js"
import { sessionTimeout } from "./components/frame/session-timeout/session-timeout.js"
import { suggestion } from "./components/frame/suggestion/suggestion.js"
import { tabs } from "./components/frame/tabs/tabs.js"
import { connectionStatus } from "./components/standalone/connection-status/connection-status.js"
import { toast } from "./components/standalone/toast/toast.js"
import { setAttributes } from "./dom.js"

/**
 * The whole component API in one place.
 *
 * Each component is a function that takes an object of options and returns
 * the attributes you spread onto the element:
 *
 * ```ts
 * import { lt } from "@lo-tek/interfaces"
 *
 * <button {...lt.button({ variant: "secondary" })}>Save draft</button>
 * <input {...lt.input({ type: "email", state: "invalid" })} />
 * <span {...lt.badge({ color: "success" })}>Approved</span>
 * ```
 *
 * The shape is the same for all of them, so you learn it once. Type `lt.` in
 * the editor to see what exists; type `lt.button.` to see the allowed
 * variants and the guard that validates values from outside.
 *
 * The return values are plain objects. That is why the same API works in
 * React, Astro, Datastar and plain HTML.
 */
export const lt = {
  accordion,
  alert,
  avatar,
  badge,
  breadcrumbs,
  button,
  card,
  checkbox,
  /**
   * The bar that says the connection to the server is lost. The server
   * cannot report that itself, so `<lt-connection-status>` creates the
   * content.
   */
  connectionStatus,
  dialog,
  divider,
  errorText,
  /**
   * The error summary above a form. The server writes the whole box, heading
   * included, and `<lt-error-summary>` only moves focus.
   */
  errorSummary,
  /**
   * Connects the label, field, help text and error text.
   *
   * ```ts
   * const field = lt.field({ id: "fixer", required: "text", help: true, error: true, invalid })
   *
   * <label {...field.label}>Fixer's address</label>
   * <input {...lt.input({ type: "email", state: field.state })} {...field.control} />
   * <p {...lt.helpText()} {...field.help}>The board writes to the fixer, never to the crew.</p>
   * <p {...lt.errorText()} {...field.error}>Enter a valid address.</p>
   * ```
   *
   * The same calculation `<lt-field>` does, but as data, for markup created
   * with JavaScript. Then no web component is needed.
   */
  field: computeFieldAttributes,
  /** A group of controls that belong together. Its label is `lt.legend`. */
  fieldset,
  heading,
  fileUpload,
  helpText,
  icon,
  input,
  label,
  legend,
  link,
  list,
  pagination,
  paragraph,
  /**
   * The button and panel of a popover. `<lt-popover>` calculates the
   * position, the server writes the wiring.
   */
  popover,
  radio,
  search,
  select,
  /**
   * The warning that a signed-in session is about to expire. The countdown
   * runs on the client's clock, so `<lt-session-timeout>` is responsible for
   * the content.
   */
  sessionTimeout,
  skeleton,
  skipLink,
  progress,
  spinner,
  /** Text only screen readers get. Requires `sr-only.css`. */
  srOnly,
  /**
   * The field and the suggestion list. `<lt-suggestion>` handles the
   * keyboard and the filtering, the server writes the markup.
   */
  suggestion,
  /** On and off. Named `switchControl` when you import it directly. */
  switch: switchControl,
  /**
   * A tab list with panels. The server writes the links, ids and classes;
   * `<lt-tabs>` adds the roles, the selection and the arrow keys.
   */
  tabs,
  /**
   * The toast region. Sets `data-ignore-morph`, because `<lt-toast>` creates
   * and removes its messages inside it.
   */
  toast,
  toggleGroup,
  tooltip,
  table,
  /**
   * The header and button in a sortable column. `aria-sort` on the `<th>` is
   * the state, and the arrow is drawn from it. The sorting is up to the app.
   */
  tableSort,
  tag,
  textarea,

  /**
   * Applies an attribute set to an element in the plain DOM.
   *
   * In JSX you spread the object. Without JSX this function does the job,
   * and cleans up what the builder function manages from the previous state.
   * Several sets are passed separately:
   * `lt.setAttributes(field, lt.input(), wiring.control)`.
   */
  setAttributes,

  /** The validation states shared by input, textarea and select. */
  states: fieldStates,
  isState: isFieldState,
  /** The ways a required field can be marked. */
  markers: requiredMarkers,
  isMarker: isRequiredMarker,
} as const

export type Lt = typeof lt
