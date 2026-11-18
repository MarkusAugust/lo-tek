import type { ComponentDoc } from "./shared.js"

export const fieldset: ComponentDoc = {
  classes: {
    "lt-fieldset": {
      content: "free",
      tags: [{ tag: "fieldset" }],
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
    "lt-legend": {
      content: "text",
      partOf: "lt-fieldset",
      tags: [{ tag: "legend" }],
    },
  },
  anatomies: {
    fieldset: {
      holes: {
        legend: {
          description: "What the fields have in common.",
          content: "text",
          example: "Address",
        },
        content: {
          description: "The fields.",
          content: "free",
          only: {
            builders: [
              "field",
              "checkbox",
              "radio",
              "switch",
              "toggleGroup",
              "suggestion",
            ],
            why: "A fieldset groups fields under one legend.",
          },
        },
      },
      nodes: [
        {
          tag: "fieldset",
          from: ["fieldset"],
          children: [
            {
              tag: "legend",
              from: ["legend"],
              name: "legend",
              description: "What the fields have in common.",
              settings: ["required", "optional"],
              children: [{ hole: "legend" }],
            },
            { hole: "content" },
          ],
        },
      ],
    },
  },
}
