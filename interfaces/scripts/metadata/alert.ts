import type { ComponentDoc } from "./shared.js"

export const alert: ComponentDoc = {
  classes: {
    "lt-alert": {
      content: "free",
      tags: [{ tag: "div" }],
      parts: {
        title: {
          selector: ".lt-alert__title",
          description: "The heading in the message.",
          content: "text",
          optional: true,
        },
      },
    },
    "lt-alert__title": {
      content: "text",
      partOf: "lt-alert",
      tags: [{ tag: "p" }],
    },
  },
  anatomies: {
    alert: {
      holes: {
        title: {
          description: "The message's heading.",
          content: "text",
          example: "Sector 9 is dark",
        },
        message: {
          description: "The message.",
          content: "free",
          example: "<p>Crews are on the way.</p>",
        },
      },
      nodes: [
        {
          tag: "div",
          from: ["alert"],
          children: [
            {
              tag: "p",
              from: ["alert.title"],
              name: "title",
              description: "A heading in the message.",
              optional: true,
              children: [{ hole: "title" }],
            },
            { hole: "message" },
          ],
        },
      ],
    },
  },
}
