import type { ComponentDoc } from "./shared.js"

export const srOnly: ComponentDoc = {
  classes: {
    "lt-sr-only": { content: "text", tags: [{ tag: "*" }] },
  },
  anatomies: {
    srOnly: {
      holes: {
        text: {
          description: "What only a screen reader says.",
          content: "text",
          example: " the report from 4 March",
        },
      },
      nodes: [{ tag: "span", from: ["srOnly"], children: [{ hole: "text" }] }],
    },
  },
}
