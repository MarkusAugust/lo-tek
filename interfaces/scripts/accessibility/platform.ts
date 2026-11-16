/**
 * How the contracts' platform-neutral words become AT-SPI's.
 *
 * Documented: Core Accessibility API Mappings 1.2, the ATK/AT-SPI2 column of
 * the role, state and property tables, https://w3c.github.io/core-aam/
 * (read 2026-10-29). A role, state or attribute a contract uses must have a
 * row here, or the run stops: a contract cannot ask for something no table
 * says how to read.
 */

/** WAI-ARIA role to the names AT-SPI's `get_role_name()` gives. */
export const ATSPI_ROLES = {
  // ROLE_PUSH_BUTTON. at-spi2 has called it both "push button" and "button".
  button: ["push button", "button"],
  // ROLE_DIALOG
  dialog: ["dialog"],
  // ROLE_ALERT
  alertdialog: ["alert"],
  // ROLE_ENTRY
  textbox: ["entry"],
  // ROLE_COMBO_BOX
  combobox: ["combo box"],
  // ROLE_LIST_BOX; ROLE_MENU inside a combobox
  listbox: ["list box", "menu"],
  // ROLE_LIST_ITEM; ROLE_MENU_ITEM inside a combobox
  option: ["list item", "menu item"],
  // ROLE_PAGE_TAB
  tab: ["page tab"],
  // ROLE_PAGE_TAB_LIST
  tablist: ["page tab list"],
  // ROLE_SCROLL_PANE
  tabpanel: ["scroll pane"],
  // ROLE_CHECK_BOX
  checkbox: ["check box"],
  // ROLE_RADIO_BUTTON
  radio: ["radio button"],
  // ROLE_PANEL
  radiogroup: ["panel"],
  // ROLE_TOGGLE_BUTTON
  switch: ["toggle button"],
  // ROLE_STATUS_BAR
  status: ["status bar"],
  // ROLE_NOTIFICATION
  alert: ["notification"],
  // ROLE_LINK
  link: ["link"],
  // ROLE_PANEL
  group: ["panel"],
  // ROLE_HEADING
  heading: ["heading"],
  // ROLE_LIST
  list: ["list"],
  // ROLE_LIST_ITEM
  listitem: ["list item"],
  // ROLE_PROGRESS_BAR
  progressbar: ["progress bar"],
} as const

export type Role = keyof typeof ATSPI_ROLES

/**
 * WAI-ARIA states and properties to AT-SPI state names (`value_nick`).
 * aria-modal → STATE_MODAL, aria-expanded → STATE_EXPANDED, aria-selected →
 * STATE_SELECTED, aria-checked → STATE_CHECKED, aria-invalid →
 * STATE_INVALID_ENTRY, aria-required → STATE_REQUIRED, aria-busy →
 * STATE_BUSY, aria-pressed → STATE_PRESSED; focus → STATE_FOCUSED.
 */
export const ATSPI_STATES = {
  modal: "modal",
  expanded: "expanded",
  expandable: "expandable",
  selected: "selected",
  checked: "checked",
  invalid: "invalid-entry",
  required: "required",
  busy: "busy",
  pressed: "pressed",
  focused: "focused",
  // Core-AAM: aria-readonly → STATE_READ_ONLY, aria-checked="mixed" →
  // STATE_INDETERMINATE.
  readonly: "read-only",
  mixed: "indeterminate",
} as const

export type State = keyof typeof ATSPI_STATES

/**
 * States the core gives that the comparison with AT-SPI cannot check, and
 * why. Every state the core can give is in `ATSPI_STATES` or here
 * (`check-accessibility-sources.ts`).
 */
export const UNCOMPARED_STATES: Record<string, string> = {
  disabled:
    "AT-SPI has no disabled state: Core-AAM leaves out STATE_ENABLED and STATE_SENSITIVE, and the comparison checks states that are there",
}

/** aria-live to the object attribute on the region and inside it. */
export const ATSPI_LIVE = {
  polite: "polite",
  assertive: "assertive",
} as const

export type Politeness = keyof typeof ATSPI_LIVE

/**
 * The engines the check runs in, and their names in prose. Not WebKit: see
 * `LAUNCH` in `accessibility/atspi.ts`.
 */
export const ENGINE_NAMES = {
  chromium: "Chromium",
  firefox: "Firefox",
} as const

export type Engine = keyof typeof ENGINE_NAMES

/**
 * Where a browser does not do what Core-AAM says, the contract requires what
 * it does instead, with the version it was seen in. When the browser starts
 * doing it right, the run goes red and says to remove the line.
 */
export type Deviation = {
  engine: Engine
  /** The contract and the step it applies to, from `deviationAt()`: "dialog:open". */
  at: string
  seen: string
} & (
  | /** A state the spec says must be there, and which this engine leaves out. */
  { missingState: State }
  /** A state the spec says must not be there, and which this engine adds. */
  | { extraState: State }
  /**
   * A change the spec says the engine must send an event for, and which it
   * does not: a state turning on, or the description.
   */
  | { missingChange: State | "description" }
  /** A name the engine computes differently from AccName. */
  | { name: string }
)

/**
 * Roles an engine maps differently from Core-AAM, everywhere. The contract
 * keeps the WAI-ARIA role; the run accepts the engine's name only for that
 * engine, and fails when the engine starts giving the right one.
 */
export type RoleDeviation = {
  engine: Engine
  role: Role
  /** What the engine's platform calls the role instead. */
  platformRole: string
  seen: string
}

export const KNOWN_ROLE_DEVIATIONS: RoleDeviation[] = [
  {
    engine: "firefox",
    role: "alert",
    platformRole: "alert",
    seen: "Firefox 150 (Playwright firefox-1522), 2026-10-29: role=alert is ROLE_ALERT, where Core-AAM maps it to ROLE_NOTIFICATION",
  },
  {
    engine: "firefox",
    role: "alertdialog",
    platformRole: "dialog",
    seen: "Firefox 150, 2026-10-29: role=alertdialog on <dialog> is ROLE_DIALOG, where Core-AAM maps alertdialog to ROLE_ALERT",
  },
]

export const KNOWN_DEVIATIONS: Deviation[] = [
  {
    engine: "firefox",
    at: "tabs (aria-labelledby inside aria-labelledby):select-the-second-tab",
    name: "Wrong",
    seen: 'Firefox 150, 2026-10-29: inside an aria-labelledby that is already being followed, Firefox follows another one, and the tab is named "Wrong" where AccName 1.2, step 2B, gives "Enclosures": "if the current node has an aria-labelledby attribute ... and the current node is not already part of an aria-labelledby traversal"',
  },
  {
    engine: "firefox",
    at: "dialog:open",
    missingState: "modal",
    seen: "Firefox 150 (Playwright firefox-1522), 2026-10-29: a <dialog> opened with showModal() has no STATE_MODAL, which Core-AAM maps from the modal dialog's implicit aria-modal",
  },
  {
    engine: "firefox",
    at: "field:focus-field",
    extraState: "invalid",
    seen: 'Firefox 150 (Playwright firefox-1522), 2026-10-29: an empty required input has STATE_INVALID_ENTRY before anyone has touched it, also in a form with novalidate. HTML-AAM, the required attribute: "If an element is required, user agents MUST NOT expose the element with an initial invalid state". A screen reader user in Firefox hears "invalid entry" on a field they have not filled in yet',
  },
  {
    engine: "firefox",
    at: "field:submit-empty",
    missingChange: "invalid",
    seen: "Firefox 150, 2026-10-29: follows from the deviation at field:focus-field. The field was already invalid-entry before the submit, so there is no change to send",
  },
  {
    engine: "firefox",
    at: "field:submit-empty",
    missingChange: "description",
    seen: "Firefox 150, 2026-10-29: when the component wires the error text with aria-describedby, Firefox has the new description when asked, but sends no description change event, which Core-AAM requires for aria-describedby. With the focus staying in the field, Orca says nothing about the error text until the focus moves",
  },
]
