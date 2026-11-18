import type { ComponentDoc } from "./shared.js"

export const steps: ComponentDoc = {
  classes: {
    "lt-steps": {
      content: "parts",
      tags: [{ tag: "ol" }],
      parts: {
        step: {
          selector: "li",
          description:
            'One step, with its name as text, or a link back to it. The step the user is on has `aria-current="step"`, and the steps before it are drawn as done.',
          content: "free",
          multiple: true,
        },
      },
    },
  },
  anatomies: {
    steps: {
      holes: {
        label: {
          description: "What the steps are, for screen readers.",
          kind: "text",
          example: "Order",
        },
        href: {
          description: "Where a done step goes.",
          kind: "url",
          per: ["step"],
          example: "#",
        },
        text: {
          description: "A step's name.",
          content: "text",
          per: ["step"],
          example: "Step",
        },
      },
      repeats: { step: { min: 2, description: "The steps." } },
      nodes: [
        {
          tag: "ol",
          from: ["steps"],
          attributes: { "aria-label": { hole: "label" } },
          children: [
            {
              name: "step",
              description: "Done, the current step, or still to come.",
              repeat: "step",
              oneOf: {
                todo: { tag: "li", children: [{ hole: "text" }] },
                done: {
                  tag: "li",
                  children: [
                    {
                      tag: "a",
                      attributes: { href: { hole: "href" } },
                      children: [{ hole: "text" }],
                    },
                  ],
                },
                current: {
                  tag: "li",
                  attributes: { "aria-current": "step" },
                  children: [{ hole: "text" }],
                },
              },
            },
          ],
        },
      ],
    },
  },
}
