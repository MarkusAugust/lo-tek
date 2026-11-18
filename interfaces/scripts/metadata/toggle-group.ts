import { type ComponentDoc, nameHole } from "./shared.js"

export const toggleGroup: ComponentDoc = {
  classes: {
    "lt-toggle-group": {
      content: "parts",
      tags: [{ tag: "fieldset" }],
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
    "lt-toggle-group__option": {
      content: "free",
      partOf: "lt-toggle-group",
      tags: [{ tag: "label" }],
    },
  },
  anatomies: {
    toggleGroup: {
      holes: {
        legend: {
          description: "What the group chooses, for screen readers.",
          content: "text",
          example: "View",
        },
        name: {
          ...nameHole,
          description:
            "The name the form sends the picked value under, the same for every option.",
          example: "view",
        },
        value: {
          description: "What an option sends.",
          kind: "value",
          per: ["option"],
          example: "all",
        },
        label: {
          description: "What an option says.",
          content: "text",
          per: ["option"],
          example: "All",
        },
        checked: {
          description: "The option is picked.",
          kind: "flag",
          per: ["option"],
        },
      },
      repeats: { option: { min: 2, description: "The options." } },
      nodes: [
        {
          tag: "fieldset",
          from: ["toggleGroup"],
          children: [
            { tag: "legend", from: ["srOnly"], children: [{ hole: "legend" }] },
            {
              tag: "label",
              from: ["toggleGroup.option"],
              repeat: "option",
              children: [
                {
                  tag: "input",
                  attributes: {
                    type: "radio",
                    name: { hole: "name" },
                    value: { hole: "value" },
                    checked: { hole: "checked" },
                  },
                },
                { hole: "label" },
              ],
            },
          ],
        },
      ],
    },
  },
}
