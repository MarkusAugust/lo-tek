import type { ComponentDoc } from "./shared.js"

export const list: ComponentDoc = {
  classes: {
    "lt-list": {
      content: "parts",
      tags: [{ tag: "ul" }, { tag: "ol" }],
      parts: {
        item: {
          selector: "li",
          description: "One item in the list.",
          content: "free",
          multiple: true,
        },
      },
    },
  },
  anatomies: {
    list: {
      holes: {
        item: {
          description: "An item.",
          content: "free",
          per: ["item"],
          example: "Floor plans",
        },
      },
      repeats: { item: { min: 1, description: "The items." } },
      nodes: [
        {
          tag: ["ul", "ol"],
          from: ["list"],
          name: "list",
          description: "Unordered, or numbered when the order counts.",
          children: [
            { tag: "li", repeat: "item", children: [{ hole: "item" }] },
          ],
        },
      ],
    },
  },
}
