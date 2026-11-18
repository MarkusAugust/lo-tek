import type { ComponentDoc } from "./shared.js"

export const icon: ComponentDoc = {
  classes: {
    "lt-icon": { content: "none", tags: [{ tag: "svg" }] },
  },
  anatomies: {
    icon: {
      holes: {
        paths: {
          description: "The icon's paths, on a 24 by 24 grid.",
          content: "svg",
          example: '<path d="M12 5v14M5 12h14" />',
        },
      },
      nodes: [
        {
          tag: "svg",
          from: ["icon"],
          attributes: {
            viewBox: "0 0 24 24",
            fill: "none",
            stroke: "currentColor",
            "stroke-width": "2",
          },
          children: [{ hole: "paths" }],
        },
      ],
    },
  },
}
