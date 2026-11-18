import type { ComponentDoc } from "./shared.js"

export const badge: ComponentDoc = {
  classes: {
    "lt-badge": { content: "text", tags: [{ tag: "span" }] },
  },
  anatomies: {
    badge: {
      holes: {
        label: {
          description: "What the badge says.",
          content: "text",
          example: "Paid",
        },
      },
      nodes: [{ tag: "span", from: ["badge"], children: [{ hole: "label" }] }],
    },
  },
}
