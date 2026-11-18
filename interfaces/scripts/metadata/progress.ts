import type { ComponentDoc } from "./shared.js"

export const progress: ComponentDoc = {
  classes: {
    "lt-progress": { content: "none", tags: [{ tag: "progress" }] },
  },
  anatomies: {
    progress: {
      holes: {
        label: {
          description: "What the bar measures.",
          kind: "text",
          example: "Upload",
        },
      },
      // A bar without a name says nothing to a screen reader.
      options: { label: { hole: "label" } },
      nodes: [{ tag: "progress", from: ["progress"] }],
    },
  },
}
