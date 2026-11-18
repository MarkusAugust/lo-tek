import type { ComponentDoc } from "./shared.js"

export const skipLink: ComponentDoc = {
  classes: {
    "lt-skip-link": {
      content: "text",
      tags: [{ tag: "a", requires: ["href"] }],
    },
  },
  anatomies: {
    skipLink: {
      page: "A skip link is the first thing on the page, so the keyboard reaches it first.",
      holes: {
        target: {
          description: "Where the main content starts, as #id.",
          kind: "url",
          example: "#main",
        },
        text: {
          description: "What the link says.",
          content: "text",
          example: "Skip to main content",
        },
      },
      nodes: [
        {
          tag: "a",
          from: ["skipLink"],
          attributes: { href: { hole: "target" } },
          children: [{ hole: "text" }],
        },
      ],
    },
  },
}
