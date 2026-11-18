import type { ComponentDoc } from "./shared.js"

export const card: ComponentDoc = {
  classes: {
    "lt-card": {
      content: "free",
      tags: [
        { tag: "div" },
        { tag: "article" },
        { tag: "section" },
        { tag: "a", requires: ["href"] },
        { tag: "button" },
      ],
      parts: {
        title: {
          selector: ".lt-card__title",
          description: "The heading in the card.",
          content: "text",
          optional: true,
        },
      },
    },
    "lt-card__title": {
      content: "text",
      partOf: "lt-card",
      tags: [
        { tag: "h2" },
        { tag: "h3" },
        { tag: "h4" },
        { tag: "h5" },
        { tag: "h6" },
      ],
    },
  },
  anatomies: {
    card: {
      holes: {
        title: {
          description: "The card's heading.",
          content: "text",
          example: "Claim AV-2079-0481",
        },
        body: {
          description: "What the card holds.",
          content: "free",
          example: "<p>Claim denied.</p>",
        },
      },
      nodes: [
        {
          tag: ["div", "article", "section"],
          from: ["card"],
          name: "card",
          description: "A box, or a piece of its own in the page.",
          children: [
            {
              tag: ["h3", "h2", "h4", "h5", "h6"],
              from: ["card.title"],
              name: "title",
              description: "The heading, at the level the page needs.",
              optional: true,
              created: true,
              children: [{ hole: "title" }],
            },
            { hole: "body" },
          ],
        },
      ],
    },
  },
}
