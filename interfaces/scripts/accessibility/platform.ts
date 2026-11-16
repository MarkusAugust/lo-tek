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

/*
 * The same words on macOS, where Safari gives VoiceOver its tree through the
 * AX API, read by `recorder.swift`. Documented: Core-AAM 1.2, the "AX API"
 * column, and HTML-AAM (Editor's Drafts of 2 and 29 July 2026, read
 * 2026-11-16). A role is "AXRole/AXSubrole", or "AXRole" when Core-AAM gives
 * the subrole as <nil>.
 */
export const AX_ROLES: Record<Role, readonly string[]> = {
  button: ["AXButton"],
  dialog: ["AXGroup/AXApplicationDialog"],
  alertdialog: ["AXGroup/AXApplicationAlertDialog"],
  // aria-multiline false and true.
  textbox: ["AXTextField", "AXTextArea"],
  combobox: ["AXComboBox"],
  listbox: ["AXList"],
  option: ["AXStaticText"],
  tab: ["AXRadioButton/AXTabButton"],
  tablist: ["AXTabGroup"],
  tabpanel: ["AXGroup/AXTabPanel"],
  checkbox: ["AXCheckBox"],
  radio: ["AXRadioButton"],
  radiogroup: ["AXRadioGroup"],
  switch: ["AXCheckBox/AXSwitch"],
  status: ["AXGroup/AXApplicationStatus"],
  alert: ["AXGroup/AXApplicationAlert"],
  link: ["AXLink"],
  // HTML-AAM: a <fieldset> is the group role with the subrole AXFieldset.
  group: ["AXGroup/AXApplicationGroup", "AXGroup/AXFieldset"],
  heading: ["AXHeading"],
  list: ["AXList/AXContentList"],
  listitem: ["AXGroup"],
  progressbar: ["AXProgressIndicator"],
}

/**
 * The states, as the tokens `recorder.swift` writes for them. `null`: AX has
 * no way to show it, and the comparison leaves it out, counted in the
 * report, with the reason in `AX_UNCOMPARED`.
 *
 * aria-expanded → AXExpanded, aria-selected → AXSelected, aria-invalid →
 * AXInvalid, aria-required → AXRequired, aria-busy → AXElementBusy, focus →
 * AXFocused. aria-checked → AXValue 1, and "mixed" → 2; aria-pressed →
 * AXValue 1 on the AXCheckBox/AXToggle a pressed button is; aria-readonly →
 * AXUIElementIsAttributeSettable(AXValue) is NO. aria-modal="true": "No
 * specific property is set … Only the tree whose root is that modal
 * accessible object is exposed", which the recorder reads as the dialog
 * being the only child of every element up to the web area.
 */
export const AX_STATES: Record<State, string | null> = {
  modal: "background pruned",
  expanded: "AXExpanded",
  expandable: null,
  selected: "AXSelected",
  checked: "AXValue=1",
  invalid: "AXInvalid",
  required: "AXRequired",
  busy: "AXElementBusy",
  pressed: "AXValue=1 (AXToggle)",
  focused: "AXFocused",
  readonly: "AXValue not settable",
  mixed: "AXValue=2",
}

/** Why a state is not compared on AX. */
export const AX_UNCOMPARED: Partial<Record<State, string>> = {
  expandable:
    "Core-AAM maps an undefined aria-expanded to nothing, and Safari 27.2 gives AXExpanded NO on every element, a button or a text field without aria-expanded too (seen 2026-11-16), so whether a node can expand is not in the tree",
}

/**
 * The notification that carries a change, for the steps that require one.
 * Core-AAM 1.2, "State and Property Change Events", except where it says
 * otherwise. `null`: no notification is given for it.
 */
export const AX_CHANGES: Record<State | "description", string | null> = {
  invalid: "AXInvalidStatusChanged",
  required: "AXRequiredStatusChanged",
  busy: "AXElementBusyChanged",
  checked: "AXValueChanged",
  mixed: "AXValueChanged",
  pressed: "AXPressedStateChanged",
  readonly: "AXReadOnlyStatusChanged",
  selected: "AXSelectedChildrenChanged",
  focused: "AXFocusedUIElementChanged",
  description: "AXDescribedByChanged",
  // Core-AAM gives AXRowExpanded and AXRowCollapsed, which are for rows.
  // Undocumented for other elements: WebKit's own name.
  expanded: "AXExpandedChanged",
  modal: null,
  expandable: null,
}

/**
 * What a live region announces through, by politeness: the AXPriorityKey of
 * the AXAnnouncementRequested Safari posts with AXAnnouncementIsLiveRegionKey
 * and the text in AXAnnouncementKey. Undocumented: Core-AAM gives
 * AXLiveRegionChanged, which carries no text, and Safari 27.2 sent no such
 * notification in a run on 2026-11-16, but this one, which VoiceOver spoke.
 * 10 was seen for polite. 90 is NSAccessibilityPriorityHigh, which Apple
 * documents, for assertive, not yet seen from a live region.
 */
export const AX_LIVE: Record<Politeness, number> = {
  polite: 10,
  assertive: 90,
}

/**
 * The notifications the recorder observes, on its command line: the changes,
 * the announcements, the load, and the focus.
 */
export const AX_EVENTS = [
  ...new Set(Object.values(AX_CHANGES).filter((e): e is string => e !== null)),
  "AXAnnouncementRequested",
  "AXLiveRegionChanged",
  "AXLoadComplete",
  "AXCreated",
]

/**
 * The engines the checks run in, and their names in prose. Chromium and
 * Firefox through AT-SPI (`accessibility/atspi.ts`, where it says why not
 * WebKitGTK), Safari through AX (`accessibility/ax.ts`).
 */
export const ENGINE_NAMES = {
  chromium: "Chromium",
  firefox: "Firefox",
  safari: "Safari",
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
  /**
   * A name the engine computes differently from AccName: for the focused
   * node, or with `on: "within"` for the ancestor the step names.
   */
  | { name: string; on?: "within" }
)

/**
 * Roles an engine maps differently from Core-AAM, everywhere, or at the
 * steps it names. The contract keeps the WAI-ARIA role; the run accepts the
 * engine's name only for that engine, and fails when the engine starts
 * giving the right one.
 */
export type RoleDeviation = {
  engine: Engine
  role: Role
  /** What the engine's platform calls the role instead. */
  platformRole: string
  /**
   * The steps, as `deviationAt()` gives them, when the deviation belongs to
   * one element rather than the role: a <select> is a combobox, and so is a
   * text field with suggestions, and only the first deviates.
   */
  at?: string[]
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
  {
    engine: "safari",
    role: "tab",
    platformRole: "AXRadioButton",
    seen: "Safari 27.2 (macOS 27.2.1), 2026-11-16: role=tab is AXRadioButton without a subrole, where Core-AAM gives AXRadioButton with the subrole AXTabButton. Only its parent, the AXTabGroup, tells it from a radio button",
  },
  {
    engine: "safari",
    role: "combobox",
    platformRole: "AXPopUpButton",
    at: ["select:focus-field", "select:focus-invalid-field"],
    seen: "Safari 27.2 (macOS 27.2.1), 2026-11-16: a <select> shown as a drop-down is AXPopUpButton, where HTML-AAM maps it to the combobox role and the WAI-ARIA mapping, AXComboBox",
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
  {
    engine: "safari",
    at: "field:focus-field",
    extraState: "invalid",
    seen: 'Safari 27.2 (macOS 27.2.1), 2026-11-16: an empty required input is AXInvalid true before anyone has touched it, as in Firefox. HTML-AAM, the required attribute: "If an element is required, user agents MUST NOT expose the element with an initial invalid state"',
  },
  {
    engine: "safari",
    at: "field:submit-empty",
    missingChange: "description",
    seen: "Safari 27.2 (macOS 27.2.1), 2026-11-16: when the component wires the error text with aria-describedby, Safari has the new description in AXCustomContent when asked, but sends no AXDescribedByChanged, which Core-AAM gives for aria-describedby, only AXInvalidStatusChanged. Not checked by ear what VoiceOver says",
  },
  {
    engine: "safari",
    at: "tabs (aria-labelledby inside aria-labelledby):select-the-second-tab",
    name: "Attachments",
    seen: 'Safari 27.2 (macOS 27.2.1), 2026-11-16: inside an aria-labelledby that is already being followed, Safari follows another one, as Firefox does, and names the tab "Attachments" where AccName 1.2, step 2B, gives "Enclosures"',
  },
  {
    engine: "safari",
    at: "radio:focus-checked-option",
    name: "Lease length",
    on: "within",
    seen: 'Safari 27.2 (macOS 27.2.1), 2026-11-16: a <fieldset> takes its name from the legend without the required marker the stylesheet adds with ::after, "Lease length" where AccName 1.2, step 2F, includes CSS generated content and gives "Lease length *". A <label> with the same marker keeps it',
  },
  {
    engine: "safari",
    at: "radio:arrow-to-next-option",
    name: "Lease length",
    on: "within",
    seen: 'Safari 27.2 (macOS 27.2.1), 2026-11-16: a <fieldset> takes its name from the legend without the required marker the stylesheet adds with ::after, "Lease length" where AccName 1.2, step 2F, includes CSS generated content and gives "Lease length *". The same as at radio:focus-checked-option',
  },
]
