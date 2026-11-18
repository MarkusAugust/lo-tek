import type { ComponentDoc } from "./shared.js"

export const accordion: ComponentDoc = {
  classes: {
    "lt-accordion": {
      content: "parts",
      tags: [{ tag: "details" }],
      parts: {
        summary: {
          selector: "summary",
          description:
            "The heading the user presses to open and close. An `<h2>` to `<h6>` inside gives it a level in the document.",
          content: "free",
        },
        content: {
          selector: ".lt-accordion__content",
          description: "The content shown when the panel is open.",
          content: "free",
        },
      },
    },
    "lt-accordion__content": {
      content: "free",
      partOf: "lt-accordion",
      tags: [{ tag: "div" }],
    },
  },
  anatomies: {
    accordion: {
      holes: {
        summary: {
          description: "What the panel is about.",
          content: "text",
          example: "How long does a claim take?",
        },
        content: {
          description: "What the panel shows when it is open.",
          content: "free",
          example: "<p>Three weeks.</p>",
        },
        open: { description: "The panel is open.", kind: "flag" },
        group: {
          description: "Panels with the same group close each other.",
          kind: "name",
          optional: true,
        },
      },
      nodes: [
        {
          tag: "details",
          from: ["accordion"],
          attributes: { open: { hole: "open" }, name: { hole: "group" } },
          children: [
            { tag: "summary", children: [{ hole: "summary" }] },
            {
              tag: "div",
              from: ["accordion.content"],
              children: [{ hole: "content" }],
            },
          ],
        },
      ],
    },
  },
}
