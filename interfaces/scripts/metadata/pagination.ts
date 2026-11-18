import type { ComponentDoc } from "./shared.js"

export const pagination: ComponentDoc = {
  classes: {
    "lt-pagination": {
      content: "parts",
      tags: [{ tag: "ul" }],
      parts: {
        item: {
          selector: "li",
          description: "One list item per page, arrow and gap.",
          content: "parts",
          multiple: true,
        },
        link: {
          selector: "li > a, li > button",
          description:
            'The link or button to a page, with the page number as text and an `aria-label` that says what it is. The current one has `aria-current="page"`.',
          content: "text",
          multiple: true,
        },
        gap: {
          selector: ".lt-pagination__gap",
          description: "The gap where pages are left out.",
          content: "text",
          multiple: true,
          optional: true,
        },
      },
    },
    "lt-pagination__gap": {
      content: "text",
      partOf: "lt-pagination",
      tags: [{ tag: "span" }],
    },
  },
  anatomies: {
    pagination: {
      holes: {
        label: {
          description: "What the pages are, for screen readers.",
          kind: "text",
          example: "Pagination",
        },
        href: {
          description: "Where a page link goes.",
          kind: "url",
          per: ["page"],
          example: "#",
        },
        number: {
          description: "A page's number.",
          content: "text",
          per: ["page"],
          example: "1",
        },
        name: {
          description: "A page's name for screen readers.",
          kind: "text",
          per: ["page"],
          example: "Page 1",
        },
        previous: {
          description: "What the link to the previous page says.",
          content: "text",
          example: "Previous",
        },
        "previous-name": {
          description: "The previous page's name for screen readers.",
          kind: "text",
          example: "Previous page",
        },
        next: {
          description: "What the link to the next page says.",
          content: "text",
          example: "Next",
        },
        "next-name": {
          description: "The next page's name for screen readers.",
          kind: "text",
          example: "Next page",
        },
        gap: {
          description: "What stands for the pages left out.",
          content: "text",
          example: "…",
        },
        "previous-href": {
          description: "Where the previous page is.",
          kind: "url",
          example: "#",
        },
        "next-href": {
          description: "Where the next page is.",
          kind: "url",
          example: "#",
        },
      },
      repeats: {
        page: {
          min: 1,
          description: "The pages, the current one and the gaps.",
        },
      },
      nodes: [
        {
          tag: "nav",
          attributes: { "aria-label": { hole: "label" } },
          children: [
            {
              tag: "ul",
              from: ["pagination"],
              children: [
                {
                  tag: "li",
                  name: "previous",
                  description: "A link to the previous page.",
                  optional: true,
                  created: true,
                  children: [
                    {
                      tag: "a",
                      attributes: {
                        href: { hole: "previous-href" },
                        "aria-label": { hole: "previous-name" },
                      },
                      children: [{ hole: "previous" }],
                    },
                  ],
                },
                {
                  name: "page",
                  description: "A page, the page the reader is on, or a gap.",
                  repeat: "page",
                  oneOf: {
                    link: {
                      tag: "li",
                      children: [
                        {
                          tag: "a",
                          attributes: {
                            href: { hole: "href" },
                            "aria-label": { hole: "name" },
                          },
                          children: [{ hole: "number" }],
                        },
                      ],
                    },
                    current: {
                      tag: "li",
                      children: [
                        {
                          tag: "a",
                          attributes: {
                            href: { hole: "href" },
                            "aria-label": { hole: "name" },
                            "aria-current": "page",
                          },
                          children: [{ hole: "number" }],
                        },
                      ],
                    },
                    gap: {
                      tag: "li",
                      children: [
                        {
                          tag: "span",
                          from: ["pagination.gap"],
                          children: [{ hole: "gap" }],
                        },
                      ],
                    },
                  },
                },
                {
                  tag: "li",
                  name: "next",
                  description: "A link to the next page.",
                  optional: true,
                  created: true,
                  children: [
                    {
                      tag: "a",
                      attributes: {
                        href: { hole: "next-href" },
                        "aria-label": { hole: "next-name" },
                      },
                      children: [{ hole: "next" }],
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
