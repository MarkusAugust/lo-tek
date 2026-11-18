import { type ComponentDoc, nameHole, row } from "./shared.js"

export const checkbox: ComponentDoc = {
  classes: {
    "lt-checkbox": { content: "none", tags: [{ tag: "input" }] },
    "lt-checkbox-row": row("input[type='checkbox']", "The checkbox"),
  },
  anatomies: {
    checkbox: {
      holes: {
        control: { description: "The id the label points at.", kind: "id" },
        name: nameHole,
        label: {
          description: "What the box says yes to.",
          content: "text",
          example: "I accept the terms",
        },
        checked: { description: "The box is ticked.", kind: "flag" },
        disabled: { description: "The box cannot be changed.", kind: "flag" },
      },
      nodes: [
        {
          tag: "div",
          from: ["checkbox.row"],
          children: [
            {
              tag: "input",
              from: ["checkbox"],
              attributes: {
                id: { hole: "control" },
                name: { hole: "name" },
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
  },
}
