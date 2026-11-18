import type { ComponentDoc } from "./shared.js"

export const paragraph: ComponentDoc = {
  classes: {
    "lt-paragraph": { content: "text", tags: [{ tag: "p" }] },
  },
  anatomies: {
    paragraph: {
      holes: {
        text: {
          description: "The paragraph.",
          content: "text",
          example: "A claim must be filed within 30 days.",
        },
      },
      nodes: [{ tag: "p", from: ["paragraph"], children: [{ hole: "text" }] }],
    },
  },
}
