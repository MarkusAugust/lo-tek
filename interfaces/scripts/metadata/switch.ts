import { type ComponentDoc, nameHole, row } from "./shared.js"

export const switchComponent: ComponentDoc = {
  classes: {
    "lt-switch": { content: "none", tags: [{ tag: "input" }] },
    "lt-switch-row": row("input[role='switch']", "The switch"),
  },
  anatomies: {
    switch: {
      holes: {
        control: { description: "The id the label points at.", kind: "id" },
        name: nameHole,
        label: {
          description: "What the switch turns on.",
          content: "text",
          example: "Auto-renew",
        },
        checked: { description: "The switch is on.", kind: "flag" },
        disabled: {
          description: "The switch cannot be changed.",
          kind: "flag",
        },
      },
      nodes: [
        {
          tag: "div",
          from: ["switch.row"],
          children: [
            {
              tag: "input",
              from: ["switch"],
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
