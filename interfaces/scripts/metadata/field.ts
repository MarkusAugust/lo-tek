import type { LtField } from "../../src/components/frame/field/lt-field.js"
import {
  LT_FIELD_PARTS,
  LT_FIELD_TAG,
} from "../../src/components/frame/field/lt-field.js"
import {
  type ComponentDoc,
  element,
  flag,
  nameHole,
  parts,
  text,
} from "./shared.js"

export const field: ComponentDoc = {
  element: element<typeof LtField>(
    LT_FIELD_TAG,
    "field",
    "Wires label, field, help text and error text together: sets `aria-describedby` and `aria-invalid` on the control and an id on the help text and the error text. Never writes an id on the control: the template writes `for` and `id`, or wraps the field in the label. The field is invalid when the error text is there without `hidden`; a warning, an error text with the variant `warning`, is wired too and does not make it invalid. Exists for markup from code that cannot call a builder function. When it can, in TypeScript, Kotlin or Java, use `lt.field()` or `Lt.field()` instead.",
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
        'The field is invalid when an error text, a `.lt-error-text` without `data-variant="warning"`, is visible, or when the server has written `aria-invalid` on the control. In Datastar: `data-attr:hidden="!$invalid"` on the error text.',
      "required-marker":
        "The required marker is `data-required` on `<label>`, and then shows without JavaScript too.",
      "control-id":
        "Write `id` on the control and `for` on the label in the template. The component never writes an id on the control.",
    },
  ),
  parts: parts(LT_FIELD_PARTS, {
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
    warning: {
      description:
        'A warning: an error text with `data-variant="warning"`. It is read out with the control while it shows, and the field is not invalid because of it.',
      content: "text",
      unique: true,
      optional: true,
    },
  }),
  anatomies: {
    field: {
      holes: {
        control: { description: "The id the label points at.", kind: "id" },
        name: nameHole,
        label: {
          description: "What the field asks for.",
          content: "text",
          example: "Email",
        },
        help: {
          description: "Help to fill it in.",
          content: "text",
          example: "We never share it.",
        },
        error: {
          description: "What is wrong.",
          content: "text",
          example: "Enter an email address.",
        },
        warning: {
          description: "What to look at again. The field is not wrong.",
          content: "text",
          example: "This address has bounced before.",
        },
        "option-value": {
          description:
            "What an option sends. Without it, the option sends its text.",
          kind: "value",
          per: ["option"],
          optional: true,
        },
        "option-selected": {
          description: "The option is the one picked.",
          kind: "flag",
          per: ["option"],
        },
        "option-label": {
          description: "What an option says.",
          content: "text",
          per: ["option"],
          example: "Option",
        },
      },
      options: {
        id: { hole: "control" },
        helpId: {
          tool: "Left out: the id of the help text is made from the field's.",
        },
        errorId: {
          tool: "Left out: the id of the error text is made from the field's.",
        },
        warningId: {
          tool: "Left out: the id of the warning is made from the field's.",
        },
        describedBy: {
          tool: "Left out: the help and error texts are wired by the field.",
        },
      },
      repeats: { option: { min: 1, description: "The options in a select." } },
      nodes: [
        {
          // One root, so the field is one box in a layout.
          tag: "div",
          children: [
            {
              tag: "label",
              from: ["field.label"],
              children: [{ hole: "label" }],
            },
            {
              // The control gets type from its own builder function, and the
              // state from field.control: given to both, aria-invalid came twice.
              name: "control",
              description: "What the user writes or picks in.",
              oneOf: {
                input: {
                  tag: "input",
                  from: ["input", "field.control"],
                  settings: ["type"],
                  attributes: { name: { hole: "name" } },
                },
                file: {
                  tag: "input",
                  from: ["fileUpload", "field.control"],
                  settings: ["multiple", "accept"],
                  attributes: { name: { hole: "name" } },
                },
                textarea: {
                  tag: "textarea",
                  from: ["textarea", "field.control"],
                  attributes: { name: { hole: "name" } },
                },
                select: {
                  tag: "select",
                  from: ["select", "field.control"],
                  attributes: { name: { hole: "name" } },
                  children: [
                    {
                      tag: "option",
                      repeat: "option",
                      attributes: {
                        value: { hole: "option-value" },
                        selected: { hole: "option-selected" },
                      },
                      children: [{ hole: "option-label" }],
                    },
                  ],
                },
              },
            },
            {
              tag: "p",
              from: ["helpText", "field.help"],
              when: "help",
              children: [{ hole: "help" }],
            },
            {
              tag: "p",
              from: ["errorText", "field.error"],
              when: "error",
              children: [{ hole: "error" }],
            },
            {
              // A warning is an error text of the variant warning.
              tag: "p",
              from: ["errorText", "field.warning"],
              options: { errorText: { variant: "warning" } },
              when: "warning",
              children: [{ hole: "warning" }],
            },
          ],
        },
      ],
    },
  },
  builderParts: {
    field: {
      label: { element: LT_FIELD_TAG, part: "label" },
      control: { element: LT_FIELD_TAG, part: "control" },
      help: { element: LT_FIELD_TAG, part: "help" },
      error: { element: LT_FIELD_TAG, part: "error" },
      warning: { element: LT_FIELD_TAG, part: "warning" },
    },
  },
}
