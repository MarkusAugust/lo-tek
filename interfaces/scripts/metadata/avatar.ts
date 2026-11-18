import type { ComponentDoc } from "./shared.js"

export const avatar: ComponentDoc = {
  classes: {
    "lt-avatar": {
      content: "free",
      tags: [{ tag: "span" }, { tag: "button" }],
      parts: {
        image: {
          selector: "img",
          description:
            "The image, with the name in `alt`. Without an image the initials are text, and the element has `aria-hidden` when the name is next to it.",
          content: "none",
          optional: true,
        },
      },
    },
    "lt-avatar-stack": {
      content: "parts",
      tags: [{ tag: "ul" }],
      parts: {
        item: {
          selector: "li",
          description: "One list item per person.",
          content: "parts",
          multiple: true,
        },
        avatar: {
          selector: "li > .lt-avatar",
          description: "The avatar in each list item.",
          content: "free",
          multiple: true,
        },
      },
    },
  },
  anatomies: {
    avatar: {
      holes: {
        initials: {
          description: "The person's initials.",
          content: "text",
          example: "DP",
        },
        "person-initials": {
          description: "A person's initials in the stack.",
          content: "text",
          per: ["person"],
          example: "DP",
        },
        beside: {
          description:
            "The name is next to the picture, so the picture is hidden from screen readers.",
          kind: "flag",
        },
      },
      repeats: { person: { min: 1, description: "The people in a stack." } },
      nodes: [
        {
          name: "kind",
          description: "One person, or several overlapping.",
          oneOf: {
            single: {
              tag: "span",
              from: ["avatar"],
              attributes: { "aria-hidden": { hole: "beside", value: "true" } },
              children: [{ hole: "initials" }],
            },
            stack: {
              tag: "ul",
              from: ["avatar.stack"],
              children: [
                {
                  tag: "li",
                  repeat: "person",
                  children: [
                    {
                      tag: "span",
                      from: ["avatar"],
                      attributes: {
                        "aria-hidden": { hole: "beside", value: "true" },
                      },
                      children: [{ hole: "person-initials" }],
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
    },
  },
}
