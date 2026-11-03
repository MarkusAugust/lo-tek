/**
 * What an editor needs to know about each `<lt-*>` element: one sentence per
 * element, per attribute and per allowed value.
 *
 * The text here is the source of both `html-data.json` (VS Code) and
 * `web-types.json` (JetBrains) in the package. It is written by hand, but
 * TypeScript keeps it in step with the components: each element writes its
 * attributes as a `Record` over `observedAttributes`, so an attribute added
 * to a component without a sentence here, or a sentence about an attribute
 * that is gone, stops the type check. `check-vocabulary.ts` does the rest:
 * that every element the package registers is in the list.
 *
 * The file is not shipped in the package. Only `generate-vocabulary.ts` reads it.
 */

import { DEFAULT_TEXTS } from "../src/components/default-texts.js"
import type { LtDialog } from "../src/components/frame/dialog/lt-dialog.js"
import {
  LT_DIALOG_PARTS,
  LT_DIALOG_TAG,
} from "../src/components/frame/dialog/lt-dialog.js"
import type { LtErrorSummary } from "../src/components/frame/error-summary/lt-error-summary.js"
import {
  LT_ERROR_SUMMARY_PARTS,
  LT_ERROR_SUMMARY_TAG,
} from "../src/components/frame/error-summary/lt-error-summary.js"
import type { LtField } from "../src/components/frame/field/lt-field.js"
import {
  LT_FIELD_PARTS,
  LT_FIELD_TAG,
} from "../src/components/frame/field/lt-field.js"
import type { LtPopover } from "../src/components/frame/popover/lt-popover.js"
import {
  LT_POPOVER_PARTS,
  LT_POPOVER_TAG,
} from "../src/components/frame/popover/lt-popover.js"
import type { LtSessionTimeout } from "../src/components/frame/session-timeout/lt-session-timeout.js"
import {
  LT_SESSION_TIMEOUT_PARTS,
  LT_SESSION_TIMEOUT_TAG,
} from "../src/components/frame/session-timeout/lt-session-timeout.js"
import type { LtSuggestion } from "../src/components/frame/suggestion/lt-suggestion.js"
import {
  LT_SUGGESTION_PARTS,
  LT_SUGGESTION_TAG,
} from "../src/components/frame/suggestion/lt-suggestion.js"
import type { LtTabs } from "../src/components/frame/tabs/lt-tabs.js"
import {
  LT_TABS_PARTS,
  LT_TABS_TAG,
} from "../src/components/frame/tabs/lt-tabs.js"
import type { LtConnectionStatus } from "../src/components/standalone/connection-status/lt-connection-status.js"
import { LT_CONNECTION_STATUS_TAG } from "../src/components/standalone/connection-status/lt-connection-status.js"
import type { LtToast } from "../src/components/standalone/toast/lt-toast.js"
import { LT_TOAST_TAG } from "../src/components/standalone/toast/lt-toast.js"
import type { DefaultText, Name } from "../src/vocabulary/types.js"

/** An allowed value, with what it means. */
export type ValueDoc = { name: string; description: string }

/**
 * What an attribute takes.
 *
 * `flag` is a boolean HTML attribute: it is either there or not. The other
 * three have a value, and `values` is a closed list the editor can suggest from.
 */
export type AttributeValue =
  | "flag"
  | "text"
  | "number"
  | { values: readonly ValueDoc[] }

export type AttributeDoc = { description: string; value: AttributeValue }

/** The type of one field in `detail`. */
export type DetailType = "boolean" | "string" | "number"

/**
 * An event the element dispatches, such as `dialog-toggle`. All of them bubble
 * and cross shadow boundaries (`bubbles: true, composed: true`). `detail` is
 * the fields in `event.detail`, or nothing when the event has none.
 */
export type EventDoc = {
  description: string
  detail?: Record<string, DetailType>
}

/**
 * What a part takes as content. `text` is text and phrasing content without
 * interactive elements, `free` is any content, `parts` is only the other
 * parts, and `none` is nothing you write yourself: a control, or an element
 * the component fills.
 */
export type PartContent = "text" | "free" | "parts" | "none"

/**
 * A part of the element, such as the control in `<lt-field>`. `selector` is
 * the one the component itself finds the part with, relative to the element.
 */
export type PartDoc = {
  selector: string
  description: string
  content: PartContent
  /** The part can appear more than once, like the tabs. Otherwise the first one counts. */
  multiple?: true
  /**
   * A second part of the same kind is an error, not ordinary content: a field
   * with two controls wires only the first. Without this flag the rest can be
   * content, like the buttons in the panel of `<lt-popover>`. `lotek check`
   * reports a part with `unique` that appears more than once.
   */
  unique?: true
  /** The element works without the part. */
  optional?: true
  /**
   * The part needs an id the server writes, because an update from the server
   * would otherwise replace it: the component never writes an id on what the
   * user touches. `lotek check` reports the part when the id is missing, and
   * for a control when the label neither has `for` pointing at it nor wraps it.
   */
  stableId?: true
  /** LO-TEK demands a name for the part. See `Name`. */
  name?: Name
}

/**
 * The parts of an element, with one description per selector the component
 * exports, no more and no fewer.
 */
function parts<P extends Record<string, string>>(
  selectors: P,
  docs: Record<keyof P, Omit<PartDoc, "selector">>,
): Record<string, PartDoc> {
  return Object.fromEntries(
    Object.entries(docs).map(([name, doc]) => [
      name,
      { selector: selectors[name], ...(doc as Omit<PartDoc, "selector">) },
    ]),
  )
}

export type ElementDoc = {
  tag: string
  /** The last segment of the component page's URL, such as `popover`. */
  slug: string
  description: string
  attributes: Record<string, AttributeDoc>
  events: Record<string, EventDoc>
  /** Empty for the elements that create all their content themselves. */
  parts: Record<string, PartDoc>
  /** LO-TEK demands a name for the element itself. */
  name?: Name
  /** The texts the element writes itself, from `TEXT_PLACES`. */
  texts?: Record<string, DefaultText>
  /**
   * Attributes removed from the element, with what applies instead.
   * `lotek check` reports them with the message, so a template from an older
   * version is told what to write.
   */
  removed?: Record<string, string>
}

/** A component's class, as the generator sees it. */
type Component = { observedAttributes: readonly string[] }

/** One sentence per attribute the component observes, no more and no fewer. */
type Attributes<T extends Component> = Record<
  T["observedAttributes"][number],
  AttributeDoc
>

function element<T extends Component>(
  tag: string,
  slug: string,
  description: string,
  attributes: Attributes<T>,
  events: Record<string, EventDoc> = {},
  removed?: Record<string, string>,
): ElementDoc {
  return {
    tag,
    slug,
    description,
    attributes,
    events,
    parts: PARTS[tag] ?? {},
    ...(NAMES[tag] ? { name: NAMES[tag] } : {}),
    ...textsOf(tag, Object.keys(attributes)),
    ...(removed ? { removed } : {}),
  }
}

/**
 * Where each text in `DEFAULT_TEXTS` is written, and the attributes that
 * replace it, any one of them. Every text has a row: the type requires it.
 * `default-texts.browser.test.ts` holds each row to the component: the text
 * shows without the attributes, and each attribute replaces it.
 *
 * The counts in `<lt-suggestion>` go through `Intl.PluralRules`: a form the
 * language does not have is never asked for, so only `count-none` and
 * `count-other` replace a text in every language.
 */
export const TEXT_PLACES: Record<
  keyof typeof DEFAULT_TEXTS,
  { element: string; replacedBy: readonly string[] }
> = {
  // `aria-label` on the host wins over `label`.
  toastRegion: { element: LT_TOAST_TAG, replacedBy: ["label", "aria-label"] },
  toastClose: { element: LT_TOAST_TAG, replacedBy: ["close-label"] },
  connectionOffline: {
    element: LT_CONNECTION_STATUS_TAG,
    replacedBy: ["offline-text"],
  },
  connectionOnline: {
    element: LT_CONNECTION_STATUS_TAG,
    replacedBy: ["online-text"],
  },
  suggestionNone: {
    element: LT_SUGGESTION_TAG,
    replacedBy: ["count-none", "count-other"],
  },
  suggestionOne: {
    element: LT_SUGGESTION_TAG,
    replacedBy: ["count-one", "count-other"],
  },
  suggestionOther: { element: LT_SUGGESTION_TAG, replacedBy: ["count-other"] },
}

/** The element's texts, for the manifest. Each attribute must be one it reads. */
function textsOf(
  tag: string,
  attributes: string[],
): { texts?: Record<string, DefaultText> } {
  const rows = Object.entries(TEXT_PLACES).filter(([, p]) => p.element === tag)
  if (rows.length === 0) return {}
  for (const [key, place] of rows)
    for (const attribute of place.replacedBy)
      if (attribute !== "aria-label" && !attributes.includes(attribute))
        throw new Error(
          `TEXT_PLACES.${key}: <${tag}> does not read ${attribute}`,
        )
  return {
    texts: Object.fromEntries(
      rows.map(([key, place]) => [
        key,
        {
          text: DEFAULT_TEXTS[key as keyof typeof DEFAULT_TEXTS],
          replacedBy: place.replacedBy,
        },
      ]),
    ),
  }
}

/** The names the elements demand for themselves, by tag. */
const NAMES: Record<string, Name> = {
  [LT_ERROR_SUMMARY_TAG]: { after: "title", id: true },
}

/** The parts of the frame components, by tag. */
const PARTS: Record<string, Record<string, PartDoc>> = {
  [LT_FIELD_TAG]: parts(LT_FIELD_PARTS, {
    label: {
      description:
        "The label. When it is outside the element, it is wired with `for` to the control's id.",
      content: "text",
    },
    control: {
      description:
        'The control the field wires: an `<input>`, `<textarea>` or `<select>` with its `<option>`s. `type="hidden"` does not count, and only the first one is wired. The template writes `for` on the label and `id` on the control, or wraps the control in the label.',
      content: "none",
      unique: true,
      stableId: true,
      // The component writes `for` on the label from the control's id.
      name: { after: "label" },
    },
    help: {
      description:
        "The help text, which is read out together with the control.",
      content: "text",
      unique: true,
      optional: true,
    },
    error: {
      description:
        "The error text, which is shown and read out when the field is invalid.",
      content: "text",
      unique: true,
      optional: true,
    },
  }),
  [LT_TABS_TAG]: parts(LT_TABS_PARTS, {
    list: {
      description:
        'The tab list, a `<ul>` where each `<li>` gets `role="presentation"`. It needs a name, such as `aria-label`. When the server has written `role="tab"` on the links, the list can also hold other links.',
      content: "free",
      unique: true,
      name: {},
    },
    tab: {
      description:
        'A tab: a link to its panel, `<a href="#attachments">`. The component writes `aria-controls` from `href`. `role="tab"` on something that is not a link is not a tab.',
      content: "text",
      multiple: true,
    },
    panel: {
      description:
        "The content of one tab, with the id the link points to. The panel has the same name as the tab: the heading at the top of the panel is the name when it says the same as the tab.",
      content: "free",
      multiple: true,
      // The component names the panel after its tab, a link
      // `without-name` holds.
      name: { component: true },
    },
  }),
  [LT_ERROR_SUMMARY_TAG]: parts(LT_ERROR_SUMMARY_PARTS, {
    title: {
      description:
        "The heading in the box. The component gives it the title class.",
      content: "text",
    },
    link: {
      description:
        "A link to a field with an error, in a list item. `href` is `#` and the field's id.",
      content: "text",
      multiple: true,
    },
  }),
  [LT_POPOVER_TAG]: parts(LT_POPOVER_PARTS, {
    trigger: {
      description:
        "The button that opens and closes the panel: the one with `aria-controls` pointing at the panel's id, otherwise the first button outside the panel.",
      content: "text",
    },
    panel: {
      description:
        "The panel that opens: the element with `popover`, or the class. It needs an id from the server, which `aria-controls` on the button points to. The component never creates one, and without it the button cannot be wired to the panel.",
      content: "free",
      stableId: true,
    },
  }),
  [LT_SUGGESTION_TAG]: parts(LT_SUGGESTION_PARTS, {
    control: {
      description:
        'The field the user types in: `role="combobox"`, otherwise the first `<input>`. The template writes `for` on the label and `id` on the field, or wraps the field in the label.',
      content: "none",
      unique: true,
      stableId: true,
      // The component writes `for` on the label from the field's id.
      name: { after: "label" },
    },
    list: {
      description:
        'The list of suggestions. It sits in the top layer when it is open, `popover="manual"`, and has the label as its name.',
      content: "parts",
      unique: true,
      // The component points the list's `aria-labelledby` at the label,
      // which `without-name` holds on the field.
      name: { component: true },
    },
    option: {
      description:
        'One suggestion in the list: `role="option"`, or an `<li>` without a role.',
      content: "text",
      multiple: true,
    },
    empty: {
      description: "The message shown when nothing matches.",
      content: "text",
      unique: true,
      optional: true,
    },
    status: {
      description:
        "The announcement of the number of matches. The element is left empty, and the component fills it.",
      content: "none",
    },
    value: {
      description:
        "A hidden `<input>` that gets the `data-value` of the option the user chose. Without it, only the text in the field is submitted.",
      content: "none",
      unique: true,
      optional: true,
    },
    label: {
      description:
        "The label. The component writes `for` on it from the field's id when it does not wrap the field, and names the list after it.",
      content: "text",
      optional: true,
    },
  }),
  [LT_DIALOG_TAG]: parts(LT_DIALOG_PARTS, {
    dialog: {
      description: "The `<dialog>` element, as a direct child of the host.",
      content: "free",
      unique: true,
      name: { after: "title" },
    },
    title: {
      description:
        "The title: what `aria-labelledby` points to, otherwise the first heading outside the body. With `aria-label` on `<dialog>` it is not needed.",
      content: "text",
      optional: true,
    },
    body: {
      description:
        "The body, which scrolls when the dialog gets too tall. A heading here does not become the title.",
      content: "free",
      unique: true,
      optional: true,
    },
  }),
  [LT_SESSION_TIMEOUT_TAG]: parts(LT_SESSION_TIMEOUT_PARTS, {
    dialog: {
      description: "The `<dialog>` element with the warning.",
      content: "free",
      unique: true,
      name: { after: "title" },
    },
    title: {
      description:
        "The heading in the dialog, which becomes its name when neither `aria-labelledby` nor `aria-label` is on `<dialog>`.",
      content: "text",
      optional: true,
    },
    text: {
      description:
        "The paragraph with the time remaining. The announcement is this paragraph with the number replaced.",
      content: "text",
      unique: true,
    },
    count: {
      description:
        "The number that counts down, inside the paragraph. The component fills it.",
      content: "none",
      unique: true,
    },
    status: {
      description:
        "The announcement. The element is left empty, and the component fills it.",
      content: "none",
    },
    button: {
      description:
        'The buttons in `<form method="dialog">`, which extend the session or log out.',
      content: "text",
      multiple: true,
    },
  }),
}

/** Where a set from a builder function goes: a part of a frame component. */
export type BuilderPart = { element: string; part: string }

/**
 * Which part of a frame component each set from a builder function fills:
 * `field.control` is the control in `<lt-field>`. The selector stays on the
 * part, so what a set may go on is said in one place, the same place the
 * component and `lotek check` read. `null` is a set that fills no part, such
 * as the host itself or a box only the stylesheet knows.
 *
 * Every set a builder function returns must be here, with a part that exists:
 * `generate-manifest.ts` stops otherwise, so a new set gets a decision rather
 * than a hole. The editors read it from `builders[].parts` in the manifest.
 */
export const BUILDER_PARTS: Record<
  string,
  Record<string, BuilderPart | null>
> = {
  dialog: {
    host: null,
    dialog: { element: LT_DIALOG_TAG, part: "dialog" },
    header: null,
    title: { element: LT_DIALOG_TAG, part: "title" },
    subtitle: null,
    body: { element: LT_DIALOG_TAG, part: "body" },
    footer: null,
  },
  errorSummary: {
    host: null,
    title: { element: LT_ERROR_SUMMARY_TAG, part: "title" },
  },
  field: {
    label: { element: LT_FIELD_TAG, part: "label" },
    control: { element: LT_FIELD_TAG, part: "control" },
    help: { element: LT_FIELD_TAG, part: "help" },
    error: { element: LT_FIELD_TAG, part: "error" },
  },
  popover: {
    host: null,
    trigger: { element: LT_POPOVER_TAG, part: "trigger" },
    panel: { element: LT_POPOVER_TAG, part: "panel" },
  },
  sessionTimeout: {
    host: null,
    dialog: { element: LT_SESSION_TIMEOUT_TAG, part: "dialog" },
    title: { element: LT_SESSION_TIMEOUT_TAG, part: "title" },
    text: { element: LT_SESSION_TIMEOUT_TAG, part: "text" },
    count: { element: LT_SESSION_TIMEOUT_TAG, part: "count" },
    live: { element: LT_SESSION_TIMEOUT_TAG, part: "status" },
    actions: null,
    extend: { element: LT_SESSION_TIMEOUT_TAG, part: "button" },
    logout: { element: LT_SESSION_TIMEOUT_TAG, part: "button" },
  },
  suggestion: {
    label: { element: LT_SUGGESTION_TAG, part: "label" },
    control: { element: LT_SUGGESTION_TAG, part: "control" },
    list: { element: LT_SUGGESTION_TAG, part: "list" },
    options: { element: LT_SUGGESTION_TAG, part: "option" },
    empty: { element: LT_SUGGESTION_TAG, part: "empty" },
    status: { element: LT_SUGGESTION_TAG, part: "status" },
    value: { element: LT_SUGGESTION_TAG, part: "value" },
    // The help text and the error text of a suggestion field are those of
    // the field around it, which `<lt-suggestion>` does not read.
    help: null,
    error: null,
  },
  tableSort: { header: null, button: null },
  tabs: {
    list: { element: LT_TABS_TAG, part: "list" },
    tabs: { element: LT_TABS_TAG, part: "tab" },
    panels: { element: LT_TABS_TAG, part: "panel" },
    headings: null,
  },
  toast: { host: null, message: null, close: null },
}

const flag = (description: string): AttributeDoc => ({
  description,
  value: "flag",
})
const text = (description: string): AttributeDoc => ({
  description,
  value: "text",
})
const number = (description: string): AttributeDoc => ({
  description,
  value: "number",
})

/**
 * The same attribute on four components, with the same sentence.
 *
 * What the attribute turns off is the component putting the *user's* state
 * back after a morph: selected tab, open panel, open list, modal dialog. The
 * rest of the wiring, such as `aria-expanded` on the button, is set regardless.
 */

export const elements: readonly ElementDoc[] = [
  element<typeof LtField>(
    LT_FIELD_TAG,
    "field",
    "Wires label, field, help text and error text together: sets `aria-describedby` and `aria-invalid` on the control and an id on the help text and the error text. Never writes an id on the control: the template writes `for` and `id`, or wraps the field in the label. The field is invalid when the error text is there without `hidden`. Exists for markup from code that cannot call a builder function. When it can, in TypeScript, Kotlin or Java, use `lt.field()` or `Lt.field()` instead.",
    {
      disabled: flag("The control is disabled."),
      optional: flag("The field is optional, and the label says so."),
      "described-by": text(
        "Extra ids to include in `aria-describedby`, separated by spaces.",
      ),
    },
    {},
    {
      invalid:
        'The field is invalid when the error text, `.lt-error-text`, is visible, or when the server has written `aria-invalid` on the control. In Datastar: `data-attr:hidden="!$invalid"` on the error text.',
      "required-marker":
        "The required marker is `data-required` on `<label>`, and then shows without JavaScript too.",
      "control-id":
        "Write `id` on the control and `for` on the label in the template. The component never writes an id on the control.",
    },
  ),

  element<typeof LtTabs>(
    LT_TABS_TAG,
    "tabs",
    'Tab list. The tabs are links to the panels in an `.lt-tabs__list`, so without JavaScript the list is a table of contents; `role="tab"` on anything other than a link is not a tab. The component adds keyboard and focus handling, sets roles and wiring, gives each panel its tab\'s name, makes only the selected panel a tab stop, and hides the rest with `hidden="until-found"`, so find in page and links into a panel reach them. Each selection is written to the URL. It never writes an id on a tab or a panel. When the page loads, the selected tab is the one with `aria-selected` from the server, otherwise the one the URL points to, otherwise the first one not hidden with `hidden`. Under `server-controlled` the URL never selects.',
    {
      "server-controlled": flag(
        "The server decides which tab is selected. The component does not put the user's selection back after an update from the server, and the URL selects no tab. A click and find in page select the tab until the server responds.",
      ),
      activation: {
        description:
          "What the arrow keys do. By default they select the tab at once.",
        value: {
          values: [
            {
              name: "manual",
              description:
                "The arrow keys only move focus, and Enter or Space selects. For when a panel's content takes time to load.",
            },
            {
              name: "automatic",
              description:
                "The arrow keys select the tab, the same as without the attribute.",
            },
          ],
        },
      },
    },
    {
      "tab-select": {
        description: "The user selected a tab. `index` counts from 0.",
        detail: { index: "number" },
      },
    },
  ),

  element<typeof LtErrorSummary>(
    LT_ERROR_SUMMARY_TAG,
    "error-summary",
    "Error summary. Moves focus to the box when it appears, and to the control when a link in the list is followed.",
    {
      "data-autofocus": {
        description:
          "Whether focus moves to the box when it appears. On by default.",
        value: {
          values: [
            { name: "false", description: "Leave focus where it is." },
            {
              name: "true",
              description:
                'Move focus, the same as without the attribute. Anything other than "false" moves focus.',
            },
          ],
        },
      },
      hidden: flag(
        "The box is hidden. The server removes the attribute when the form fails, and the component then moves focus.",
      ),
    },
  ),

  element<typeof LtPopover>(
    LT_POPOVER_TAG,
    "popover",
    "A panel that hangs from a button and closes itself. A button and a panel with the class `lt-popover` and an id from the template; the component sets `popover` and `aria-controls` where the markup came without them, but never the id.",
    {
      open: flag(
        "The panel is open. The server can send the attribute to open the panel.",
      ),
      placement: {
        description: "Which edge of the button the panel hangs from.",
        value: {
          values: [
            {
              name: "bottom-start",
              description:
                "Below the button, along the start edge. The default.",
            },
            {
              name: "bottom-end",
              description: "Below the button, along the end edge.",
            },
            {
              name: "top-start",
              description: "Above the button, along the start edge.",
            },
            {
              name: "top-end",
              description: "Above the button, along the end edge.",
            },
          ],
        },
      },
      "server-controlled": flag(
        "The server decides whether the panel is open. The component does not put `open` back when an update from the server removes it.",
      ),
    },
    {
      "popover-toggle": {
        description:
          "The user opened or closed the panel, or `show()`, `hide()` or `toggle()` was called. Setting `open` as a property or attribute dispatches no event.",
        detail: { open: "boolean" },
      },
    },
  ),

  element<typeof LtSuggestion>(
    LT_SUGGESTION_TAG,
    "suggestion",
    "Field with a suggestion list. A `<label for>`, an `<input id>`, an `.lt-suggestion__list` with `<li>` items and a `[role=status]` are enough; the component sets the roles and the wiring where the markup came without them, and gives the list and the options ids. The field never gets an id from the component. Filters as the user types, moves the highlight with the arrow keys and announces the number of matches.",
    {
      prefiltered: flag(
        'The app has already filtered the list, so the component leaves it as it is. Needed when the app\'s filter is something other than "the text contains the search term".',
      ),
      "count-none": text(
        'The announcement for no matches. The default is "No matches".',
      ),
      "count-zero": text(
        "The announcement in the plural form `zero`, for languages that have it. `{n}` is the number.",
      ),
      "count-one": text("The announcement for one match. `{n}` is the number."),
      "count-two": text(
        "The announcement in the plural form `two`, for languages that have it. `{n}` is the number.",
      ),
      "count-few": text(
        "The announcement in the plural form `few`, for languages that have it. `{n}` is the number.",
      ),
      "count-many": text(
        "The announcement in the plural form `many`, for languages that have it. `{n}` is the number.",
      ),
      "count-other": text(
        "The announcement for every other count, and the fallback when a form is missing. `{n}` is the number.",
      ),
      "server-controlled": flag(
        "The server decides whether the list is expanded and which option is highlighted. The component does not put them back after an update from the server.",
      ),
    },
    {
      "suggestion-select": {
        description:
          "The user chose a suggestion. `label` is the text, `value` the code from `data-value`, or the text when the option has none. The field also gets `input` and `change`, as if the user had typed it.",
        detail: { value: "string", label: "string" },
      },
    },
  ),

  element<typeof LtDialog>(
    LT_DIALOG_TAG,
    "dialog",
    'Makes a `<dialog class="lt-dialog">` modal with `showModal()`, for servers that cannot call it themselves. The host around the dialog. Gives the dialog its name from the first heading outside `lt-dialog__body` when neither `aria-labelledby` nor `aria-label` is there.',
    {
      open: flag(
        "The dialog is open. For the server to show it, `open` must be on `<dialog>` too.",
      ),
      "server-controlled": flag(
        "When an update from the server removes `open` from `<dialog>` while the dialog is open, the component closes it and dispatches `dialog-toggle`, instead of putting `open` back.",
      ),
    },
    {
      "dialog-toggle": {
        description:
          "The dialog opened or closed. `returnValue` is the value of the button that closed it, or an empty string.",
        detail: { open: "boolean", returnValue: "string" },
      },
    },
  ),

  element<typeof LtToast>(
    LT_TOAST_TAG,
    "toast",
    "A queue of short messages in the corner of the screen. The messages are created from script with `show(text, { color, duration })`.",
    {
      duration: number(
        "Milliseconds before a message disappears. The default is 6000, and 0 keeps the messages.",
      ),
      label: text("Text that tells screen readers what the region is for."),
      "close-label": text(
        'What the close button in each message is called for screen readers. The default is "Close message".',
      ),
    },
    {
      "toast-dismiss": {
        description:
          "A message was closed, by the user, because its time ran out, or with `dismiss()`. `clear()` dispatches none.",
      },
    },
  ),

  element<typeof LtSessionTimeout>(
    LT_SESSION_TIMEOUT_TAG,
    "session-timeout",
    'Warns before a signed-in session expires, and counts down. The renderer writes the dialog and the text inside the element: a `<dialog>` with `.lt-session-timeout__count` for the number, `[role=status]` for the announcement and the buttons in a `<form method="dialog">`. Dispatches `session-warn` when the dialog opens, `session-extend` when the user wants to continue, `session-logout` when the user logs out, `session-expired` when time is up, and `session-activity` at most once per `activity-interval` while the user is active, so the app can keep the server session alive.',
    {
      "warn-at": number("Seconds without activity before the warning appears."),
      "expires-at": number(
        "Seconds without activity before the session expires.",
      ),
      "activity-interval": number(
        "Seconds between each `session-activity` while the user is active. Default 60.",
      ),
    },
    {
      "session-warn": { description: "The warning opened." },
      "session-extend": {
        description:
          "The session continues: the user closed the warning with a button other than log out or with Escape, or the app called `extend()`.",
      },
      "session-logout": { description: "The user chose to log out." },
      "session-expired": { description: "Time is up." },
      "session-activity": {
        description:
          "The user is active. Dispatched at most once per `activity-interval`, so the app can keep the server session alive.",
      },
    },
  ),

  element<typeof LtConnectionStatus>(
    LT_CONNECTION_STATUS_TAG,
    "connection-status",
    "Tells the user when the connection to the server is lost. The app reports with `reportFailure()` and `reportSuccess()`.",
    {
      "offline-text": text("The text when the connection is lost."),
      "online-text": text("The text when it comes back."),
    },
    {
      "connection-lost": { description: "The connection is lost." },
      "connection-restored": { description: "The connection is back." },
    },
  ),
]

/**
 * What each class takes as content, and the parts it consists of.
 *
 * The elements above say what the web components look for. The classes said
 * nothing: the manifest did not know that `lt-button` takes text, that
 * `lt-list` consists of `<li>`, or that `lt-table` has `<thead>` and `<tbody>`
 * with an `lt-table__sort` in a `<th>`. A tool that assembles markup from the
 * classes had to keep that in a list of its own.
 *
 * `content` uses the same vocabulary as the parts. `parts` is on the classes
 * with a fixed structure, and the selectors are relative to the element with
 * the class, as for the elements. A class that is only a part of another
 * component's markup, such as `lt-card__title` and `lt-table__sort`, points to
 * its parent with `partOf` instead of having parts of its own, and the parent
 * has a part that matches it.
 *
 * The table is kept in step with the package by `generate-vocabulary.ts`,
 * which stops on a class in the CSS that is missing here and on an entry
 * without a class, and by `check-vocabulary.ts`, which requires every
 * selector to match the markup on the component page, and `partOf` to point
 * to a class with a part that matches this one.
 */
export type ClassDoc = {
  content: PartContent
  parts?: Record<string, PartDoc>
  /** The class this one is a part of. */
  partOf?: string
  /** LO-TEK demands a name for the element with the class. */
  name?: Name
}

/** A row in a form: the control and the label side by side. */
const row = (control: string, what: string): ClassDoc => ({
  content: "parts",
  parts: {
    control: {
      selector: control,
      description: `${what}, with its class.`,
      content: "none",
      unique: true,
    },
    label: {
      selector: "label",
      description: "The label, wired to the control with `for`.",
      content: "text",
    },
  },
})

export const classDocs: Record<string, ClassDoc> = {
  "lt-accordion": {
    content: "parts",
    parts: {
      summary: {
        selector: "summary",
        description:
          "The heading the user presses to open and close. An `<h2>` to `<h6>` inside gives it a level in the document.",
        content: "free",
      },
      content: {
        selector: ".lt-accordion__content",
        description: "The content shown when the panel is open.",
        content: "free",
      },
    },
  },
  "lt-accordion__content": { content: "free", partOf: "lt-accordion" },
  "lt-alert": {
    content: "free",
    parts: {
      title: {
        selector: ".lt-alert__title",
        description: "The heading in the message.",
        content: "text",
        optional: true,
      },
    },
  },
  "lt-alert__title": { content: "text", partOf: "lt-alert" },
  "lt-avatar": {
    content: "free",
    parts: {
      image: {
        selector: "img",
        description:
          "The image, with the name in `alt`. Without an image the initials are text, and the element has `aria-hidden` when the name is next to it.",
        content: "none",
        optional: true,
      },
    },
  },
  "lt-avatar-stack": {
    content: "parts",
    parts: {
      item: {
        selector: "li",
        description: "One list item per person.",
        content: "parts",
        multiple: true,
      },
      avatar: {
        selector: "li > .lt-avatar",
        description: "The avatar in each list item.",
        content: "free",
        multiple: true,
      },
    },
  },
  "lt-badge": { content: "text" },
  "lt-breadcrumbs": {
    content: "parts",
    parts: {
      item: {
        selector: "li",
        description: "One step in the trail.",
        content: "parts",
        multiple: true,
      },
      link: {
        selector: "li > a",
        description:
          'The link to the step. The last one, the page the reader is on, has `aria-current="page"`.',
        content: "text",
        multiple: true,
      },
    },
  },
  "lt-button": { content: "text" },
  "lt-card": {
    content: "free",
    parts: {
      title: {
        selector: ".lt-card__title",
        description: "The heading in the card.",
        content: "text",
        optional: true,
      },
    },
  },
  "lt-card__title": { content: "text", partOf: "lt-card" },
  "lt-checkbox": { content: "none" },
  "lt-checkbox-row": row("input[type='checkbox']", "The checkbox"),
  "lt-divider": { content: "none" },
  "lt-error-text": { content: "text" },
  "lt-fieldset": {
    content: "free",
    // The legend names the group; WAI-ARIA demands no name for a group.
    name: {},
    parts: {
      legend: {
        selector: "> .lt-legend",
        description: "The label of the group, a `<legend>` with the class.",
        content: "text",
        unique: true,
      },
      help: {
        selector: ".lt-help-text",
        description:
          "The help text of the group, wired with `aria-describedby` on the fieldset.",
        content: "text",
        optional: true,
      },
      error: {
        selector: ".lt-error-text",
        description:
          "The error text of the group, wired with `aria-describedby` on the fieldset.",
        content: "text",
        optional: true,
      },
    },
  },
  "lt-legend": { content: "text", partOf: "lt-fieldset" },
  "lt-file-upload": { content: "none" },
  "lt-file-upload-list": {
    content: "parts",
    parts: {
      item: {
        selector: "li",
        description: "One chosen file, with its name.",
        content: "free",
        multiple: true,
      },
      remove: {
        selector: "li > button",
        description:
          "The button that removes the file, with the file name in its text.",
        content: "text",
        multiple: true,
        optional: true,
      },
    },
  },
  "lt-heading": { content: "text" },
  "lt-help-text": { content: "text" },
  "lt-icon": { content: "none" },
  "lt-input": { content: "none" },
  "lt-label": { content: "text" },
  "lt-link": { content: "text" },
  "lt-list": {
    content: "parts",
    parts: {
      item: {
        selector: "li",
        description: "One item in the list.",
        content: "free",
        multiple: true,
      },
    },
  },
  "lt-pagination": {
    content: "parts",
    parts: {
      item: {
        selector: "li",
        description: "One list item per page, arrow and gap.",
        content: "parts",
        multiple: true,
      },
      link: {
        selector: "li > a, li > button",
        description:
          'The link or button to a page, with the page number as text and an `aria-label` that says what it is. The current one has `aria-current="page"`.',
        content: "text",
        multiple: true,
      },
      gap: {
        selector: ".lt-pagination__gap",
        description: "The gap where pages are left out.",
        content: "text",
        multiple: true,
        optional: true,
      },
    },
  },
  "lt-pagination__gap": { content: "text", partOf: "lt-pagination" },
  "lt-paragraph": { content: "text" },
  "lt-progress": { content: "none" },
  "lt-radio": { content: "none" },
  "lt-radio-row": row("input[type='radio']", "The radio button"),
  "lt-search": { content: "none" },
  "lt-search-row": {
    content: "parts",
    parts: {
      label: {
        selector: "label",
        description:
          "The label, wired with `for`. Often hidden with `lt-sr-only`.",
        content: "text",
      },
      control: {
        selector: "input[type='search']",
        description: "The search field, with the classes `lt-input lt-search`.",
        content: "none",
        unique: true,
      },
      button: {
        selector: "button",
        description: "The search button.",
        content: "text",
        optional: true,
      },
    },
  },
  "lt-select": { content: "none" },
  "lt-skeleton": { content: "none" },
  "lt-skip-link": { content: "text" },
  "lt-spinner": { content: "none" },
  "lt-sr-only": { content: "text" },
  "lt-switch": { content: "none" },
  "lt-switch-row": row("input[role='switch']", "The switch"),
  "lt-table": {
    content: "parts",
    parts: {
      caption: {
        selector: "> caption",
        description: "The name of the table.",
        content: "text",
        unique: true,
        optional: true,
      },
      head: {
        selector: "> thead",
        description: 'The header row, with a `<th scope="col">` per column.',
        content: "free",
        unique: true,
      },
      body: {
        selector: "tbody",
        description:
          'The rows, in one or more groups. A `<th scope="row">` first in the row gives the row a name.',
        content: "free",
        multiple: true,
      },
      sort: {
        selector: "th > .lt-table__sort",
        description:
          "The button in a sortable header. `aria-sort` on the cell says which way.",
        content: "text",
        multiple: true,
        optional: true,
      },
    },
  },
  "lt-table__sort": { content: "text", partOf: "lt-table" },
  "lt-table-scroll": {
    content: "parts",
    parts: {
      table: {
        selector: ".lt-table",
        description: "The table that can be scrolled sideways.",
        content: "free",
      },
    },
  },
  "lt-tag": { content: "text" },
  "lt-textarea": { content: "none" },
  "lt-toggle-group": {
    content: "parts",
    name: {},
    parts: {
      legend: {
        selector: "> legend",
        description:
          "What the options choose between. Can be hidden with `lt-sr-only`, but must be there.",
        content: "text",
        unique: true,
      },
      option: {
        selector: ".lt-toggle-group__option",
        description:
          "One option: a `<label>` with the radio button and the text.",
        content: "free",
        multiple: true,
      },
      radio: {
        selector: ".lt-toggle-group__option > input[type='radio']",
        description: "The radio button in each option, with the same `name`.",
        content: "none",
        multiple: true,
      },
    },
  },
  "lt-toggle-group__option": { content: "free", partOf: "lt-toggle-group" },
  "lt-tooltip": {
    content: "parts",
    parts: {
      trigger: {
        selector: "[aria-describedby]",
        description:
          "The element the bubble describes, with `aria-describedby` pointing at the bubble's id.",
        content: "text",
      },
      bubble: {
        selector: ".lt-tooltip__bubble",
        description: 'The bubble, with `role="tooltip"` and the id.',
        content: "text",
      },
    },
  },
  "lt-tooltip__bubble": { content: "text", partOf: "lt-tooltip" },

  "lt-dialog": {
    content: "free",
    parts: {
      header: {
        selector: ".lt-dialog__header",
        description:
          "The header, with the heading and the subtitle. `data-color` on the dialog colours it.",
        content: "parts",
        optional: true,
      },
      title: {
        selector: ".lt-dialog__title",
        description: "The heading, which `aria-labelledby` points to.",
        content: "text",
        optional: true,
      },
      subtitle: {
        selector: ".lt-dialog__subtitle",
        description: "The line below the heading, inside the header.",
        content: "text",
        optional: true,
      },
      body: {
        selector: ".lt-dialog__body",
        description:
          "The content, which scrolls when the dialog gets too tall. Must be a direct child.",
        content: "free",
        optional: true,
      },
      footer: {
        selector: ".lt-dialog__footer",
        description:
          'The row of buttons at the bottom, often a `<form method="dialog">`.',
        content: "free",
        optional: true,
      },
    },
  },
  "lt-dialog__header": {
    content: "parts",
    partOf: "lt-dialog",
    parts: {
      title: {
        selector: ".lt-dialog__title",
        description: "The heading.",
        content: "text",
      },
      subtitle: {
        selector: ".lt-dialog__subtitle",
        description: "The line below the heading.",
        content: "text",
        optional: true,
      },
    },
  },
  "lt-dialog__title": { content: "text", partOf: "lt-dialog" },
  "lt-dialog__subtitle": { content: "text", partOf: "lt-dialog" },
  "lt-dialog__body": { content: "free", partOf: "lt-dialog" },
  "lt-dialog__footer": { content: "free", partOf: "lt-dialog" },
  "lt-error-summary": {
    content: "parts",
    parts: {
      title: {
        selector: ".lt-error-summary__title",
        description: "The heading, which says how many errors the form has.",
        content: "text",
      },
      list: {
        selector: "ul",
        description: "The list with one link per error.",
        content: "parts",
      },
      link: {
        selector: "li a[href^='#']",
        description:
          "The link to a field with an error, with the error message as text and the field's id after `#`.",
        content: "text",
        multiple: true,
      },
    },
  },
  "lt-error-summary__title": { content: "text", partOf: "lt-error-summary" },
  "lt-popover": { content: "free" },
  "lt-session-timeout": {
    content: "parts",
    parts: {
      dialog: {
        selector: ".lt-session-timeout__dialog",
        description: 'The dialog with the warning, with `role="alertdialog"`.',
        content: "parts",
      },
      title: {
        selector: ".lt-session-timeout__title",
        description: "The heading in the dialog.",
        content: "text",
        optional: true,
      },
      text: {
        selector: ".lt-session-timeout__text",
        description: "The paragraph with the time remaining.",
        content: "text",
      },
      count: {
        selector: ".lt-session-timeout__count",
        description:
          "The number that counts down, inside the paragraph. The component fills it.",
        content: "none",
      },
      status: {
        selector: "[role='status']",
        description:
          "The announcement. Left empty, and the component fills it.",
        content: "none",
      },
      actions: {
        selector: ".lt-session-timeout__actions",
        description: 'The button row, a `<form method="dialog">`.',
        content: "parts",
      },
      button: {
        selector: ".lt-session-timeout__actions button",
        description: "The buttons that extend the session or log out.",
        content: "text",
        multiple: true,
      },
    },
  },
  "lt-session-timeout__dialog": {
    content: "parts",
    partOf: "lt-session-timeout",
    parts: {
      title: {
        selector: ".lt-session-timeout__title",
        description: "The heading.",
        content: "text",
        optional: true,
      },
      text: {
        selector: ".lt-session-timeout__text",
        description: "The paragraph with the time remaining.",
        content: "text",
      },
      count: {
        selector: ".lt-session-timeout__count",
        description: "The number that counts down, inside the paragraph.",
        content: "none",
      },
      status: {
        selector: "[role='status']",
        description: "The announcement, which the component fills.",
        content: "none",
      },
      actions: {
        selector: ".lt-session-timeout__actions",
        description: 'The button row, a `<form method="dialog">`.',
        content: "parts",
      },
    },
  },
  "lt-session-timeout__title": {
    content: "text",
    partOf: "lt-session-timeout",
  },
  "lt-session-timeout__text": { content: "text", partOf: "lt-session-timeout" },
  "lt-session-timeout__count": {
    content: "none",
    partOf: "lt-session-timeout",
  },
  "lt-session-timeout__actions": {
    content: "parts",
    partOf: "lt-session-timeout",
    parts: {
      button: {
        selector: "button",
        description: "The buttons that extend the session or log out.",
        content: "text",
        multiple: true,
      },
    },
  },
  "lt-suggestion__list": {
    content: "parts",
    parts: {
      option: {
        selector: "[role='option'], .lt-suggestion__option, > li:not([role])",
        description:
          "One suggestion: the role or the class when they are there, otherwise an `<li>` without a role, which the component gives the class and the role. The list can be empty until the server fills it.",
        content: "text",
        multiple: true,
        optional: true,
      },
    },
  },
  "lt-suggestion__option": { content: "text", partOf: "lt-suggestion__list" },
  "lt-suggestion__empty": { content: "text" },
  "lt-suggestion__value": { content: "none" },
  "lt-tabs__list": {
    content: "free",
    parts: {
      tab: {
        selector: "a[role='tab'][href^='#'], a[href^='#']:not([role])",
        description:
          'A tab: a link to its panel, such as `<a href="#attachments">`. When the server has written `role="tab"`, only the links with the role are tabs, and the list can hold other links. `role="tab"` on something that is not a link is not a tab.',
        content: "text",
        multiple: true,
      },
    },
  },
  "lt-tabs__panel": { content: "free" },

  // The classes the components set on the nodes they create themselves have
  // content but no parent: nobody writes them in markup, so no part matches them.
  "lt-connection-status": { content: "none" },
  "lt-connection-status__bar": { content: "text" },
  "lt-toast": { content: "none" },
  "lt-toast__message": { content: "free" },
  "lt-toast__close": { content: "text" },
  "lt-theme-control": { content: "none" },
}
