import type { ComponentDoc } from "./shared.js"

export const tag: ComponentDoc = {
  classes: {
    "lt-tag": {
      content: "text",
      tags: [{ tag: "span" }, { tag: "button" }, { tag: "li" }],
    },
  },
  anatomies: {
    tag: {
      holes: {
        text: {
          description: "What the tag says.",
          content: "text",
          example: "cutter",
        },
        pressed: {
          description: "The tag is selected.",
          kind: "value",
          values: ["false", "true"],
          example: "false",
        },
      },
      options: { selectable: { choice: "kind", alternative: "selectable" } },
      nodes: [
        {
          name: "kind",
          description: "A label, or a filter the user turns on and off.",
          oneOf: {
            plain: {
              tag: ["span", "li"],
              from: ["tag"],
              name: "element",
              children: [{ hole: "text" }],
            },
            selectable: {
              tag: "button",
              from: ["tag"],
              attributes: {
                type: "button",
                "aria-pressed": { hole: "pressed" },
              },
              children: [{ hole: "text" }],
            },
          },
        },
      ],
    },
  },
}
