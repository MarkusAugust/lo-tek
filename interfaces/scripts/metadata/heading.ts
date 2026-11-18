import type { ComponentDoc } from "./shared.js"

export const heading: ComponentDoc = {
  classes: {
    "lt-heading": {
      content: "text",
      tags: [
        { tag: "h1" },
        { tag: "h2" },
        { tag: "h3" },
        { tag: "h4" },
        { tag: "h5" },
        { tag: "h6" },
      ],
    },
  },
  anatomies: {
    heading: {
      holes: {
        text: {
          description: "The heading.",
          content: "text",
          example: "What we cover",
        },
      },
      nodes: [
        {
          // The level follows the page; the size is separate, in data-size.
          tag: ["h2", "h1", "h3", "h4", "h5", "h6"],
          from: ["heading"],
          name: "level",
          description: "The level in the page's outline.",
          children: [{ hole: "text" }],
        },
      ],
    },
  },
}
