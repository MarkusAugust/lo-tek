import { type ComponentDoc, nameHole } from "./shared.js"

export const search: ComponentDoc = {
  classes: {
    "lt-search": { content: "none", tags: [{ tag: "input" }] },
    "lt-search-row": {
      content: "parts",
      tags: [{ tag: "form" }],
      parts: {
        label: {
          selector: "label",
          description:
            "The label, wired with `for`. Often hidden with `lt-sr-only`.",
          content: "text",
        },
        control: {
          selector: "input[type='search']",
          description:
            "The search field, with the classes `lt-input lt-search`.",
          content: "none",
          unique: true,
        },
        button: {
          selector: "button",
          description: "The search button.",
          content: "text",
          optional: true,
        },
      },
    },
  },
  anatomies: {
    search: {
      holes: {
        control: { description: "The id the label points at.", kind: "id" },
        name: { ...nameHole, example: "q" },
        label: {
          description: "What is searched, for screen readers.",
          content: "text",
          example: "Search breakers",
        },
        placeholder: {
          description: "A hint in the empty field.",
          kind: "text",
          optional: true,
          example: "Search breakers",
        },
        button: {
          description: "What the button says.",
          content: "text",
          example: "Search",
        },
      },
      nodes: [
        {
          tag: "form",
          from: ["search.row"],
          attributes: { role: "search" },
          children: [
            // The button says what the field is for, so the label is for
            // screen readers.
            {
              tag: "label",
              from: ["label", "srOnly"],
              attributes: { for: { hole: "control" } },
              children: [{ hole: "label" }],
            },
            {
              tag: "input",
              from: ["search"],
              attributes: {
                id: { hole: "control" },
                name: { hole: "name" },
                placeholder: { hole: "placeholder" },
              },
            },
            {
              tag: "button",
              from: ["button"],
              attributes: { type: "submit" },
              children: [{ hole: "button" }],
            },
          ],
        },
      ],
    },
  },
}
