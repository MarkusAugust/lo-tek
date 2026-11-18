import { type ComponentDoc, nameHole, row } from "./shared.js"

export const radio: ComponentDoc = {
  classes: {
    "lt-radio": { content: "none", tags: [{ tag: "input" }] },
    "lt-radio-row": row("input[type='radio']", "The radio button"),
  },
  anatomies: {
    radio: {
      holes: {
        legend: {
          description: "What the group asks.",
          content: "text",
          example: "Lease length",
        },
        name: {
          ...nameHole,
          description:
            "The name the form sends the picked value under, the same for every option.",
        },
        control: {
          description: "The id an option's label points at.",
          kind: "id",
          per: ["option"],
        },
        value: {
          description: "What an option sends.",
          kind: "value",
          per: ["option"],
          example: "1",
        },
        label: {
          description: "What an option says.",
          content: "text",
          per: ["option"],
          example: "One month",
        },
        checked: {
          description: "The option is picked.",
          kind: "flag",
          per: ["option"],
        },
        disabled: {
          description: "The option cannot be picked.",
          kind: "flag",
          per: ["option"],
        },
      },
      // One option is no choice.
      repeats: { option: { min: 2, description: "The options." } },
      nodes: [
        {
          tag: "fieldset",
          from: ["fieldset"],
          name: "group",
          description: "The group, and its state.",
          settings: ["state", "disabled"],
          children: [
            {
              tag: "legend",
              from: ["legend"],
              name: "legend",
              description: "The question.",
              settings: ["required", "optional"],
              children: [{ hole: "legend" }],
            },
            {
              tag: "div",
              from: ["radio.row"],
              repeat: "option",
              children: [
                {
                  tag: "input",
                  from: ["radio"],
                  attributes: {
                    id: { hole: "control" },
                    name: { hole: "name" },
                    value: { hole: "value" },
                    checked: { hole: "checked" },
                    disabled: { hole: "disabled" },
                  },
                },
                {
                  tag: "label",
                  from: ["label"],
                  attributes: { for: { hole: "control" } },
                  children: [{ hole: "label" }],
                },
              ],
            },
          ],
        },
      ],
    },
  },
}
