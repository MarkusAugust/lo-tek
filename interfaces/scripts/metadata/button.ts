import type { ComponentDoc } from "./shared.js"

export const button: ComponentDoc = {
  classes: {
    "lt-button": {
      content: "text",
      tags: [
        { tag: "button" },
        { tag: "a", requires: ["href"] },
        {
          tag: "a",
          attributes: {
            role: ["link"],
            tabindex: ["0"],
            "aria-disabled": ["true"],
          },
        },
        { tag: "input", attributes: { type: ["submit", "button", "reset"] } },
      ],
    },
  },
  anatomies: {
    button: {
      holes: {
        label: {
          description: "What the button does.",
          content: "text",
          example: "Order the job",
        },
        disabled: {
          description: "The button cannot be pressed.",
          kind: "flag",
        },
      },
      nodes: [
        {
          tag: "button",
          from: ["button"],
          attributes: { disabled: { hole: "disabled" } },
          children: [{ hole: "label" }],
        },
      ],
    },
  },
}
