import type { LtSuggestion } from "../../src/components/frame/suggestion/lt-suggestion.js"
import {
  LT_SUGGESTION_PARTS,
  LT_SUGGESTION_TAG,
} from "../../src/components/frame/suggestion/lt-suggestion.js"
import {
  type ComponentDoc,
  element,
  flag,
  nameHole,
  parts,
  text,
} from "./shared.js"

export const suggestion: ComponentDoc = {
  element: element<typeof LtSuggestion>(
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
  parts: parts(LT_SUGGESTION_PARTS, {
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
  classes: {
    "lt-suggestion__list": {
      content: "parts",
      tags: [{ tag: "ul" }],
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
    "lt-suggestion__option": {
      content: "text",
      partOf: "lt-suggestion__list",
      tags: [{ tag: "li" }],
    },
    "lt-suggestion__empty": { content: "text", tags: [{ tag: "p" }] },
    "lt-suggestion__value": { content: "none", tags: [{ tag: "input" }] },
  },
  anatomies: {
    suggestion: {
      holes: {
        control: { description: "The id of the field.", kind: "id" },
        name: nameHole,
        label: {
          description: "What the field asks for.",
          content: "text",
          example: "Breaker",
        },
        option: {
          description: "A suggestion.",
          content: "text",
          per: ["option"],
          example: "Crowbar",
        },
        empty: {
          description: "What the list says when nothing matches.",
          content: "text",
          example: "No matches",
        },
        help: {
          description: "Help to fill it in.",
          content: "text",
          example: "Start typing a name.",
        },
        error: {
          description: "What is wrong.",
          content: "text",
          example: "Choose a breaker from the list.",
        },
      },
      options: {
        id: { hole: "control" },
        keys: { repeat: "option" },
        activeIndex: { tool: "The component moves the active option." },
        open: { tool: "The component opens and closes the list." },
        pending: { tool: "The server says while it is fetching." },
        helpId: { tool: "Left out: made from the field's id." },
        errorId: { tool: "Left out: made from the field's id." },
        describedBy: {
          tool: "Left out: the help and error texts are wired by the component.",
        },
      },
      repeats: {
        option: { min: 0, description: "The suggestions the server sends." },
      },
      nodes: [
        {
          tag: "lt-suggestion",
          children: [
            {
              tag: "label",
              from: ["suggestion.label"],
              children: [{ hole: "label" }],
            },
            {
              tag: "input",
              from: ["suggestion.control"],
              attributes: { name: { hole: "name" } },
            },
            {
              tag: "ul",
              from: ["suggestion.list"],
              children: [
                {
                  tag: "li",
                  from: ["suggestion.options"],
                  repeat: "option",
                  children: [{ hole: "option" }],
                },
              ],
            },
            {
              tag: "p",
              from: ["suggestion.empty"],
              children: [{ hole: "empty" }],
            },
            { tag: "span", from: ["suggestion.status"] },
            {
              tag: "p",
              from: ["helpText", "suggestion.help"],
              when: "help",
              children: [{ hole: "help" }],
            },
            {
              tag: "p",
              from: ["errorText", "suggestion.error"],
              when: "error",
              children: [{ hole: "error" }],
            },
          ],
        },
      ],
    },
  },
  builderParts: {
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
  },
}
