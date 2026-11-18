import type { ComponentDoc } from "./shared.js"

export const breadcrumbs: ComponentDoc = {
  classes: {
    "lt-breadcrumbs": {
      content: "parts",
      tags: [{ tag: "ol" }],
      parts: {
        item: {
          selector: "li",
          description: "One step in the trail.",
          content: "parts",
          multiple: true,
        },
        link: {
          selector: "li > a",
          description:
            'The link to the step. The last one, the page the reader is on, has `aria-current="page"`.',
          content: "text",
          multiple: true,
        },
      },
    },
  },
  anatomies: {
    breadcrumbs: {
      holes: {
        label: {
          description: "What the trail is, for screen readers.",
          kind: "text",
          example: "You are here",
        },
        href: {
          description: "Where a step goes.",
          kind: "url",
          per: ["step"],
          example: "#",
        },
        text: {
          description: "A step's name.",
          content: "text",
          per: ["step"],
          example: "Home",
        },
        "current-href": {
          description: "The address of the page the reader is on.",
          kind: "url",
          example: "#",
        },
        current: {
          description: "The name of the page the reader is on.",
          content: "text",
          example: "This page",
        },
      },
      repeats: {
        step: {
          min: 1,
          description: "The steps before the page the reader is on.",
        },
      },
      nodes: [
        {
          tag: "nav",
          attributes: { "aria-label": { hole: "label" } },
          children: [
            {
              tag: "ol",
              from: ["breadcrumbs"],
              children: [
                {
                  tag: "li",
                  repeat: "step",
                  children: [
                    {
                      tag: "a",
                      attributes: { href: { hole: "href" } },
                      children: [{ hole: "text" }],
                    },
                  ],
                },
                {
                  tag: "li",
                  children: [
                    {
                      tag: "a",
                      attributes: {
                        href: { hole: "current-href" },
                        "aria-current": "page",
                      },
                      children: [{ hole: "current" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  },
}
