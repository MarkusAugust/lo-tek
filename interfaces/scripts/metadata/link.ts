import type { ComponentDoc } from "./shared.js"

export const link: ComponentDoc = {
  classes: {
    "lt-link": {
      content: "text",
      tags: [
        { tag: "a", requires: ["href"] },
        {
          tag: "a",
          attributes: {
            role: ["link"],
            tabindex: ["0"],
            "aria-disabled": ["true"],
          },
        },
      ],
    },
  },
  anatomies: {
    link: {
      holes: {
        href: {
          description: "Where the link goes.",
          kind: "url",
          example: "#",
        },
        text: {
          description: "What the link says.",
          content: "text",
          example: "the small print",
        },
      },
      options: { disabled: { choice: "state", alternative: "disabled" } },
      nodes: [
        {
          name: "state",
          description: "A link, or one that cannot be followed yet.",
          oneOf: {
            enabled: {
              tag: "a",
              from: ["link"],
              attributes: { href: { hole: "href" } },
              children: [{ hole: "text" }],
            },
            // A disabled link has no href: Enter would follow it.
            disabled: {
              tag: "a",
              from: ["link"],
              children: [{ hole: "text" }],
            },
          },
        },
      ],
    },
  },
}
