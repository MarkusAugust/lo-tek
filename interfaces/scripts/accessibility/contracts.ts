/**
 * The accessibility contracts, one per component: what a screen reader must
 * be given when someone uses the recipe from the component's page. See
 * `contract.ts` for the shape and the rule that the expected values come from
 * the component's promise and the specifications, never from a browser.
 */
import { DEFAULT_TEXTS } from "../../src/components/default-texts"
import type { Contract } from "./contract"

const dialog: Contract = {
  component: "dialog",
  steps: [
    {
      name: "focus-opener",
      do: [{ focus: "#open-confirm" }],
      focus: { role: "button", name: "Cancel the job" },
    },
    {
      // HTML: showModal() runs the dialog focusing steps, so the first
      // focusable element gets focus, and the dialog is modal.
      name: "open",
      do: [{ press: "Enter" }],
      focus: { role: "button", name: "Keep the job" },
      within: {
        role: "dialog",
        name: "Cancel job 222-0481?",
        states: ["modal"],
      },
    },
    {
      // HTML: closing a modal dialog returns focus to the element that had it
      // when it was opened.
      name: "close",
      do: [{ press: "Escape" }],
      focus: { role: "button", name: "Cancel the job" },
    },
  ],
  mutations: [
    {
      name: "the dialog without a name",
      replace: [' aria-labelledby="confirm-title"', ""],
      failsAt: "open",
      lotekCheck: "without-name",
    },
    {
      name: "focus sent away after the close",
      replace: [
        'dialog.addEventListener("close", () => {',
        'dialog.addEventListener("close", () => { requestAnimationFrame(() => document.activeElement.blur())',
      ],
      failsAt: "close",
    },
  ],
}

const field: Contract = {
  component: "field",
  steps: [
    {
      // AccName: the label's `::after` content is part of the name, so the
      // required marker " *" is read with it.
      name: "focus-field",
      do: [{ focus: "#codename" }],
      focus: {
        role: "textbox",
        name: "Codename *",
        states: ["required"],
        notStates: ["invalid"],
      },
    },
    {
      // The recipe shows the error text and keeps focus in the field; the
      // component wires the text as the description and sets aria-invalid.
      name: "submit-empty",
      do: [{ press: "Enter" }],
      focus: {
        role: "textbox",
        name: "Codename *",
        description: "Enter a codename.",
        states: ["required", "invalid"],
      },
      // The focus stays in the field, so only these events tell the screen
      // reader that the submit failed and why.
      changes: { states: ["invalid"], description: true },
    },
  ],
  mutations: [
    {
      // Not `for`: the component writes it when the field has an id and the
      // label does not wrap it. The text is the name, so that is the mutation.
      name: "the label without its text",
      replace: [">Codename</label>", "></label>"],
      failsAt: "focus-field",
      lotekCheck: "without-name",
    },
    {
      name: "the error text never shown",
      replace: ["error.hidden = !empty", "error.hidden = true"],
      failsAt: "submit-empty",
    },
  ],
}

const suggestion: Contract = {
  component: "suggestion",
  steps: [
    {
      name: "focus-field",
      do: [{ focus: "#breaker" }],
      focus: { role: "combobox", name: "Breaker" },
    },
    {
      // The count is announced when the list changes, and only when the
      // number does: "C" leaves one match, and "r" and "o" leave it at one.
      name: "type",
      do: [{ type: "Cro" }],
      focus: { role: "combobox", name: "Breaker", states: ["expanded"] },
      announce: { politeness: "polite", text: DEFAULT_TEXTS.suggestionOne },
    },
    {
      // aria-activedescendant: the option is focused for the screen reader
      // while DOM focus stays in the field.
      name: "arrow-to-option",
      do: [{ press: "ArrowDown" }],
      focus: { role: "option", name: "Crowbar", states: ["selected"] },
      within: { role: "listbox", name: "Breaker" },
      quiet: true,
    },
    {
      name: "choose",
      do: [{ press: "Enter" }],
      focus: { role: "combobox", name: "Breaker", notStates: ["expanded"] },
    },
  ],
  mutations: [
    {
      name: "no status element for the count",
      replace: ['<span class="lt-sr-only" role="status"></span>', ""],
      failsAt: "type",
    },
    {
      name: "the label without its text",
      replace: [">Breaker</label>", "></label>"],
      failsAt: "focus-field",
      lotekCheck: "without-name",
    },
  ],
}

const tabs: Contract = {
  component: "tabs",
  steps: [
    {
      // The component makes the links tabs and selects the first.
      name: "focus-first-tab",
      do: [{ focus: 'a[href="#claim"]' }],
      focus: { role: "tab", name: "Claim", states: ["selected"] },
      within: { role: "tablist", name: "Parts of the claim" },
    },
    {
      name: "arrow-to-second-tab",
      do: [{ press: "ArrowRight" }],
      focus: { role: "tab", name: "Attachments", states: ["selected"] },
      within: { role: "tablist", name: "Parts of the claim" },
    },
    {
      // Tab goes into the selected panel, which has its name from the heading
      // when the heading says the same as the tab.
      name: "into-the-panel",
      do: [{ press: "Tab" }],
      focus: { role: "tabpanel", name: "Attachments" },
    },
  ],
  mutations: [
    {
      name: "the tab list without a name",
      replace: [' aria-label="Parts of the claim"', ""],
      failsAt: "focus-first-tab",
      lotekCheck: "without-name",
    },
    {
      name: "the component not registered",
      replace: ["defineLtTabs()\n", "\n"],
      failsAt: "focus-first-tab",
    },
  ],
}

/*
 * The panel has the tab's name (B5, B6, D7). The component names the panel
 * from its heading when the heading's name is the same as the tab's, and
 * from the tab otherwise, so it has to compute both names the way a browser
 * does. Each variant replaces the second tab's content, its panel's heading
 * and what stands outside, and requires the tab and the panel to have the
 * same name in the browser's own tree. These moved here from
 * lt-tabs-requirements.browser.test.ts, which computed the names with axe's
 * copy of AccName.
 */
const TAB_NAMES: {
  what: string
  link: string
  heading: string
  outside?: string
  name: string
}[] = [
  {
    what: "text",
    link: "Attachments",
    heading: "<h2>Attachments</h2>",
    name: "Attachments",
  },
  {
    what: "without a heading",
    link: "Attachments",
    heading: "",
    name: "Attachments",
  },
  {
    what: "heading with different text",
    link: "Attachments",
    heading: "<h2>Enclosures</h2>",
    name: "Attachments",
  },
  {
    what: "hidden heading",
    link: "Attachments",
    heading: "<h2 hidden>Attachments</h2>",
    name: "Attachments",
  },
  {
    what: "heading with aria-label equal to the tab",
    link: "Attachments",
    heading: '<h2 aria-label="Attachments">Enclosures</h2>',
    name: "Attachments",
  },
  {
    what: "heading with aria-label different from the tab",
    link: "Attachments",
    heading: '<h2 aria-label="Something else">Attachments</h2>',
    name: "Attachments",
  },
  {
    // If the panel points to the heading, the heading's own aria-labelledby
    // is not followed, and the panel would be named "Enclosures".
    what: "heading with aria-labelledby",
    link: "Attachments",
    heading: '<h2 aria-labelledby="heading-name">Enclosures</h2>',
    outside: '<span id="heading-name">Attachments</span>',
    name: "Attachments",
  },
  {
    what: "text hidden with CSS",
    link: 'Attachments<span style="display: none"> (2)</span>',
    heading: "",
    name: "Attachments",
  },
  {
    what: "text with aria-hidden",
    link: 'Attachments<span aria-hidden="true"> (2)</span>',
    heading: "<h2>Attachments</h2>",
    name: "Attachments",
  },
  {
    what: "image with alt",
    link: '<img alt="Attachments" width="1" height="1">',
    heading: "<h2>Attachments</h2>",
    name: "Attachments",
  },
  {
    what: "aria-label on a child",
    link: '<span role="img" aria-label="Attachments">📎</span>',
    heading: "",
    name: "Attachments",
  },
  {
    // AccName 2B also applies to a child of the tab.
    what: "aria-labelledby on a child, pointing to a hidden element",
    link: '<svg role="img" aria-labelledby="icon-name" width="16" height="16"></svg>',
    heading: "",
    outside: '<span id="icon-name" hidden>Enclosures</span>',
    name: "Enclosures",
  },
  {
    what: "aria-labelledby on the tab, pointing to a hidden element",
    link: "Attachments",
    heading: "",
    outside: '<span id="tab-name" hidden>Enclosures</span>',
    name: "Enclosures",
  },
  {
    // Inside an aria-labelledby that is already being followed, another one
    // is not followed.
    what: "aria-labelledby inside aria-labelledby",
    link: "Attachments",
    heading: "",
    outside:
      '<span id="tab-name"><span role="img" aria-labelledby="deeper">Enclosures</span></span><span id="deeper">Wrong</span>',
    name: "Enclosures",
  },
]

const tabNames: Contract[] = TAB_NAMES.map((v) => {
  const linkAttribute = v.outside?.includes('id="tab-name"')
    ? ' aria-labelledby="tab-name"'
    : ""
  return {
    component: "tabs",
    variant: {
      name: v.what,
      replace: [
        [
          '<a href="#attachments">Attachments</a>',
          `<a href="#attachments"${linkAttribute}>${v.link}</a>`,
        ],
        ["<h2>Attachments</h2>", v.heading],
        [
          '<lt-tabs id="claim-tabs">',
          `${v.outside ?? ""}<lt-tabs id="claim-tabs">`,
        ],
      ],
    },
    steps: [
      {
        name: "select-the-second-tab",
        do: [{ focus: 'a[href="#claim"]' }, { press: "ArrowRight" }],
        focus: { role: "tab", name: v.name, states: ["selected"] },
      },
      {
        name: "into-its-panel",
        do: [{ press: "Tab" }],
        focus: { role: "tabpanel", name: v.name },
      },
    ],
    mutations: [],
  }
})

const errorSummary: Contract = {
  component: "error-summary",
  steps: [
    {
      name: "focus-field",
      do: [{ focus: "#fixer" }],
      focus: { role: "textbox", name: "Fixer's address" },
    },
    {
      // The component moves focus to the box as soon as hidden is removed.
      name: "submit-with-an-error",
      do: [{ press: "Enter" }],
      focus: { role: "alert", name: "The form has one error" },
    },
    {
      name: "tab-to-the-message",
      do: [{ press: "Tab" }],
      focus: { role: "link", name: "Enter the fixer's address with an @" },
    },
    {
      // The link moves focus to the field it names.
      name: "follow-the-message",
      do: [{ press: "Enter" }],
      focus: { role: "textbox", name: "Fixer's address" },
    },
  ],
  mutations: [
    {
      name: "the box never shown",
      replace: ["box.hidden = errors.length === 0", "box.hidden = true"],
      failsAt: "submit-with-an-error",
    },
    {
      name: "the component not registered",
      replace: ["defineLtErrorSummary()\n", "\n"],
      failsAt: "submit-with-an-error",
    },
  ],
}

const popover: Contract = {
  component: "popover",
  steps: [
    {
      name: "focus-trigger",
      do: [{ focus: "#menu > button" }],
      focus: {
        role: "button",
        name: "Actions",
        states: ["expandable"],
        notStates: ["expanded"],
      },
    },
    {
      // The focus stays on the button, so the expanded state change is what
      // tells the screen reader the menu opened.
      name: "open",
      do: [{ press: "Enter" }],
      focus: { role: "button", name: "Actions", states: ["expanded"] },
      changes: { states: ["expanded"] },
    },
    {
      name: "into-the-panel",
      do: [{ press: "Tab" }],
      focus: { role: "button", name: "Mark LDG-117 returned" },
    },
    {
      // Escape closes the panel and returns focus to the button.
      name: "escape",
      do: [{ press: "Escape" }],
      focus: { role: "button", name: "Actions", notStates: ["expanded"] },
    },
  ],
  mutations: [
    {
      name: "the panel not recognised",
      replace: ['<ul class="lt-popover" id="actions">', '<ul id="actions">'],
      failsAt: "focus-trigger",
    },
    {
      name: "the component not registered",
      replace: ["defineLtPopover()\n", "\n"],
      failsAt: "focus-trigger",
    },
  ],
}

const toast: Contract = {
  component: "toast",
  steps: [
    {
      name: "focus-restart",
      do: [{ focus: "#restart" }],
      focus: { role: "button", name: "Restart relay 14" },
    },
    {
      // The recipe's restartRelay() is a placeholder that is not defined, so
      // the click takes the error path. A message never takes the focus.
      name: "restart-fails",
      do: [{ press: "Enter" }],
      focus: { role: "button", name: "Restart relay 14" },
      announce: {
        politeness: "polite",
        text: "Relay 14 did not answer. Try again.",
      },
    },
    {
      name: "show-success",
      do: [
        {
          run: 'document.getElementById("messages").show("Relay 14 is back", { color: "success" })',
        },
      ],
      focus: { role: "button", name: "Restart relay 14" },
      announce: {
        politeness: "polite",
        text: "Relay 14 is back",
      },
    },
  ],
  mutations: [
    {
      // The component only writes aria-live when it is missing, so the
      // server's "off" stands, and nothing is announced.
      name: "the region switched off",
      replace: ['aria-live="polite"', 'aria-live="off"'],
      failsAt: "restart-fails",
    },
    {
      // The count itself is under test: one change seen at several levels
      // is one announcement, and this must still be two.
      name: "the same message shown twice",
      replace: [
        'messages.show("Relay 14 did not answer. Try again.", { color: "danger", duration: 0 })',
        'messages.show("Relay 14 did not answer. Try again.", { color: "danger", duration: 0 }); messages.show("Relay 14 did not answer. Try again.", { color: "danger", duration: 0 })',
      ],
      failsAt: "restart-fails",
    },
    {
      // And two frames apart: the count is by event, not by text.
      name: "the same message shown again a frame later",
      replace: [
        'messages.show("Relay 14 did not answer. Try again.", { color: "danger", duration: 0 })',
        'messages.show("Relay 14 did not answer. Try again.", { color: "danger", duration: 0 }); requestAnimationFrame(() => requestAnimationFrame(() => messages.show("Relay 14 did not answer. Try again.", { color: "danger", duration: 0 })))',
      ],
      failsAt: "restart-fails",
    },
  ],
}

const sessionTimeout: Contract = {
  component: "session-timeout",
  clock: true,
  steps: [
    {
      // warn-at="1500": the dialog opens 25 minutes in, with the focus on its
      // first button.
      name: "warn",
      do: [{ clock: 1_500_000 }],
      focus: { role: "button", name: "Stay connected" },
      within: { role: "alertdialog", name: "Your session is ending" },
    },
    {
      // The countdown is announced at 2 minutes, 1 minute, 30 and 10 seconds,
      // as the paragraph with the number in words.
      name: "two-minutes-left",
      do: [{ clock: 180_000 }],
      focus: { role: "button", name: "Stay connected" },
      announce: {
        politeness: "polite",
        text: "Your session on the Lattice ends in 2 minutes. Unsaved routes will be lost.",
      },
    },
  ],
  mutations: [
    {
      name: "no status element for the countdown",
      replace: ['<span class="lt-sr-only" role="status"></span>', ""],
      failsAt: "two-minutes-left",
    },
  ],
}

const connectionStatus: Contract = {
  component: "connection-status",
  steps: [
    {
      name: "offline",
      do: [
        {
          run: 'document.querySelector("lt-connection-status").reportFailure()',
        },
      ],
      announce: { politeness: "polite", text: DEFAULT_TEXTS.connectionOffline },
    },
    {
      name: "online",
      do: [
        {
          run: 'document.querySelector("lt-connection-status").reportSuccess()',
        },
      ],
      announce: { politeness: "polite", text: DEFAULT_TEXTS.connectionOnline },
    },
  ],
  mutations: [
    {
      // The region switched off: the component keeps what the server wrote.
      name: "the region switched off",
      replace: [
        '<lt-connection-status class="lt-connection-status"',
        '<lt-connection-status class="lt-connection-status" aria-live="off"',
      ],
      failsAt: "offline",
    },
  ],
}

/**
 * The recipe writes the region itself, as `lt.connectionStatus()` does. This
 * variant takes it out, so the region comes only from the web component, the
 * way a template that leaves it out or a morph that tears it off gets it.
 */
const connectionStatusWithoutRegion: Contract = {
  ...connectionStatus,
  variant: {
    name: "the region from the web component",
    replace: [[' role="status" aria-live="polite"', ""]],
  },
  mutations: connectionStatus.mutations,
}

/* The form controls. Their markup is the first example on each page. */

const input: Contract = {
  component: "input",
  example: 0,
  steps: [
    {
      name: "focus-field",
      do: [{ focus: "#fixer" }],
      focus: {
        role: "textbox",
        name: "Fixer's address",
        notStates: ["invalid"],
      },
    },
    {
      name: "focus-invalid-field",
      do: [{ focus: "#backup" }],
      focus: { role: "textbox", name: "Backup fixer", states: ["invalid"] },
    },
  ],
  mutations: [
    {
      name: "the label not pointing at the field",
      replace: [' for="fixer"', ""],
      failsAt: "focus-field",
    },
    // No "invalid only in colour" here: type="email" with the value "fixer@"
    // is invalid to the browser itself, so a screen reader is told so
    // without aria-invalid. The mutation is on the textarea, where only
    // aria-invalid says it.
  ],
}

const textarea: Contract = {
  component: "textarea",
  example: 0,
  steps: [
    {
      name: "focus-field",
      do: [{ focus: "#objective" }],
      focus: { role: "textbox", name: "Objective", notStates: ["invalid"] },
    },
    {
      name: "focus-invalid-field",
      do: [{ focus: "#terms" }],
      focus: { role: "textbox", name: "Terms", states: ["invalid"] },
    },
  ],
  mutations: [
    {
      name: "the label not pointing at the field",
      replace: [' for="objective"', ""],
      failsAt: "focus-field",
    },
    {
      // data-state="invalid" only colours the field; aria-invalid is what a
      // screen reader is given.
      name: "invalid only in colour",
      replace: [
        'data-state="invalid" aria-invalid="true">Too short',
        'data-state="invalid">Too short',
      ],
      failsAt: "focus-invalid-field",
    },
  ],
}

const select: Contract = {
  component: "select",
  example: 0,
  steps: [
    {
      // HTML-AAM: a <select> without multiple and with a size of one or less
      // is a combobox.
      name: "focus-field",
      do: [{ focus: "#building" }],
      focus: { role: "combobox", name: "Building", notStates: ["invalid"] },
    },
    {
      name: "focus-invalid-field",
      do: [{ focus: "#floor" }],
      focus: { role: "combobox", name: "Floor", states: ["invalid"] },
    },
  ],
  mutations: [
    {
      name: "the label not pointing at the field",
      replace: [' for="building"', ""],
      failsAt: "focus-field",
      lotekCheck: "without-name",
    },
  ],
}

const checkbox: Contract = {
  component: "checkbox",
  example: 0,
  steps: [
    {
      name: "focus-box",
      do: [{ focus: "#seasonal" }],
      focus: {
        role: "checkbox",
        name: "I accept that floors below 12 are seasonal.",
        notStates: ["checked"],
      },
    },
    {
      // The focus stays on the box, so the state change is what is heard.
      name: "check-it",
      do: [{ press: "Space" }],
      focus: {
        role: "checkbox",
        name: "I accept that floors below 12 are seasonal.",
        states: ["checked"],
      },
      changes: { states: ["checked"] },
    },
    {
      name: "focus-invalid-box",
      do: [{ focus: "#confirm" }],
      focus: {
        role: "checkbox",
        name: "I confirm that I have read the lease",
        states: ["invalid"],
      },
    },
  ],
  mutations: [
    {
      name: "the label not pointing at the box",
      replace: [' for="seasonal"', ""],
      failsAt: "focus-box",
      lotekCheck: "without-name",
    },
  ],
}

const radio: Contract = {
  component: "radio",
  example: 0,
  steps: [
    {
      // HTML-AAM: fieldset is a group, named by its legend, and the legend's
      // required marker is part of the name, as on a label.
      name: "focus-checked-option",
      do: [{ focus: "#lease-1" }],
      focus: {
        role: "radio",
        name: "One month",
        states: ["checked"],
      },
      within: {
        role: "group",
        name: "Lease length *",
      },
    },
    {
      // The arrow moves the focus and the choice together, past nothing
      // disabled here.
      name: "arrow-to-next-option",
      do: [{ press: "ArrowDown" }],
      focus: {
        role: "radio",
        name: "Six months",
        states: ["checked"],
      },
      within: {
        role: "group",
        name: "Lease length *",
      },
    },
  ],
  mutations: [
    {
      name: "the group without a legend",
      replace: [
        '<legend class="lt-legend" data-required="symbol">Lease length</legend>',
        "",
      ],
      failsAt: "focus-checked-option",
      lotekCheck: "without-name",
    },
  ],
}

const toggleGroup: Contract = {
  component: "toggle-group",
  example: 0,
  steps: [
    {
      // The legend is visually hidden, and still the group's name.
      name: "focus-checked-option",
      do: [{ focus: 'input[value="dry"]' }],
      focus: { role: "radio", name: "Dry", states: ["checked"] },
      within: { role: "group", name: "View" },
    },
    {
      name: "arrow-to-next-option",
      do: [{ press: "ArrowRight" }],
      focus: { role: "radio", name: "Seasonal", states: ["checked"] },
      within: { role: "group", name: "View" },
    },
  ],
  mutations: [
    {
      name: "the legend removed",
      replace: ['<legend class="lt-sr-only">View</legend>', ""],
      failsAt: "focus-checked-option",
      lotekCheck: "without-name",
    },
  ],
}

const switchControl: Contract = {
  component: "switch",
  steps: [
    {
      name: "focus-switch",
      do: [{ focus: "#auto-renew" }],
      focus: {
        role: "switch",
        name: "Auto-renew",
        notStates: ["checked"],
      },
    },
    {
      // The recipe saves with fetch, which answers 404 here, so it takes the
      // error path: the switch goes back, and the status says why.
      name: "turn-on-and-fail",
      do: [{ press: "Space" }],
      focus: {
        role: "switch",
        name: "Auto-renew",
        notStates: ["checked"],
      },
      announce: { politeness: "polite", text: "Could not save. Try again." },
    },
  ],
  mutations: [
    {
      name: "no status element",
      replace: [
        '<p class="lt-help-text" id="auto-renew-status" role="status"></p>',
        '<p class="lt-help-text" id="auto-renew-status"></p>',
      ],
      failsAt: "turn-on-and-fail",
    },
    {
      name: "the switch left on after the failure",
      replace: ["toggle.checked = !on", "toggle.checked = on"],
      failsAt: "turn-on-and-fail",
    },
  ],
}

/*
 * The icon page: a button with text next to the icon, and one with only the
 * icon and aria-label. The variant names the icon with a `<title>` in the
 * svg instead (SVG-AAM), which the core reads too.
 */
const icon: Contract = {
  component: "icon",
  example: 0,
  steps: [
    {
      name: "focus-text-button",
      do: [{ focus: "button:nth-of-type(1)" }],
      focus: { role: "button", name: "New ticket" },
    },
    {
      name: "focus-icon-button",
      do: [{ focus: "button:nth-of-type(2)" }],
      focus: { role: "button", name: "Delete ticket #0331" },
    },
  ],
  mutations: [
    {
      name: "the icon button without aria-label",
      replace: [' aria-label="Delete ticket #0331"', ""],
      failsAt: "focus-icon-button",
      lotekCheck: "without-name",
    },
  ],
}

const iconWithTitle: Contract = {
  ...icon,
  variant: {
    name: "a title in the svg",
    replace: [
      [
        ' aria-label="Delete ticket #0331">\n  <svg class="lt-icon" aria-hidden="true"',
        '>\n  <svg class="lt-icon"',
      ],
      [
        '<path d="M4 7h16',
        '<title>Delete ticket #0331</title><path d="M4 7h16',
      ],
    ],
  },
  mutations: [
    {
      name: "the title taken out",
      replace: ["<title>Delete ticket #0331</title>", ""],
      failsAt: "focus-icon-button",
      lotekCheck: "without-name",
    },
  ],
}

export const CONTRACTS: Contract[] = [
  dialog,
  field,
  suggestion,
  tabs,
  ...tabNames,
  errorSummary,
  popover,
  toast,
  sessionTimeout,
  connectionStatus,
  connectionStatusWithoutRegion,
  input,
  textarea,
  select,
  checkbox,
  radio,
  toggleGroup,
  switchControl,
  icon,
  iconWithTitle,
]
