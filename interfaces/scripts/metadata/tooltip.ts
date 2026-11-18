import type { ComponentDoc } from "./shared.js"

export const tooltip: ComponentDoc = {
  classes: {
    "lt-tooltip": {
      content: "parts",
      tags: [{ tag: "span" }],
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
    "lt-tooltip__bubble": {
      content: "text",
      partOf: "lt-tooltip",
      tags: [{ tag: "span" }],
    },
  },
  anatomies: {
    tooltip: {
      holes: {
        bubble: { description: "The id the button points at.", kind: "id" },
        label: {
          description: "What the button does.",
          content: "text",
          example: "Appraise",
        },
        tip: {
          description: "The hint.",
          content: "text",
          example: "All chrome is appraised at street value",
        },
      },
      nodes: [
        {
          tag: "span",
          from: ["tooltip"],
          children: [
            {
              tag: "button",
              from: ["button"],
              name: "button",
              settings: ["variant"],
              attributes: {
                type: "button",
                "aria-describedby": { hole: "bubble" },
              },
              children: [{ hole: "label" }],
            },
            {
              tag: "span",
              from: ["tooltip.bubble"],
              attributes: { role: "tooltip", id: { hole: "bubble" } },
              children: [{ hole: "tip" }],
            },
          ],
        },
      ],
    },
  },
}
