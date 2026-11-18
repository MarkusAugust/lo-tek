import type { LtErrorSummary } from "../../src/components/frame/error-summary/lt-error-summary.js"
import {
  LT_ERROR_SUMMARY_PARTS,
  LT_ERROR_SUMMARY_TAG,
} from "../../src/components/frame/error-summary/lt-error-summary.js"
import { type ComponentDoc, element, flag, parts } from "./shared.js"

export const errorSummary: ComponentDoc = {
  element: element<typeof LtErrorSummary>(
    LT_ERROR_SUMMARY_TAG,
    "error-summary",
    "Error summary. Moves focus to the box when it appears, and to the control when a link in the list is followed.",
    {
      "data-autofocus": {
        description:
          "Whether focus moves to the box when it appears. On by default.",
        value: {
          values: [
            { name: "false", description: "Leave focus where it is." },
            {
              name: "true",
              description:
                'Move focus, the same as without the attribute. Anything other than "false" moves focus.',
            },
          ],
        },
      },
      hidden: flag(
        "The box is hidden. The server removes the attribute when the form fails, and the component then moves focus.",
      ),
    },
  ),
  name: { after: "title", id: true },
  parts: parts(LT_ERROR_SUMMARY_PARTS, {
    title: {
      description:
        "The heading in the box. The component gives it the title class.",
      content: "text",
    },
    link: {
      description:
        "A link to a field with an error, in a list item. `href` is `#` and the field's id.",
      content: "text",
      multiple: true,
    },
  }),
  classes: {
    "lt-error-summary": {
      content: "parts",
      tags: [{ tag: "lt-error-summary" }],
      parts: {
        title: {
          selector: ".lt-error-summary__title",
          description: "The heading, which says how many errors the form has.",
          content: "text",
        },
        list: {
          selector: "ul",
          description: "The list with one link per error.",
          content: "parts",
        },
        link: {
          selector: "li a[href^='#']",
          description:
            "The link to a field with an error, with the error message as text and the field's id after `#`.",
          content: "text",
          multiple: true,
        },
      },
    },
    "lt-error-summary__title": {
      content: "text",
      partOf: "lt-error-summary",
      tags: [
        { tag: "h1" },
        { tag: "h2" },
        { tag: "h3" },
        { tag: "h4" },
        { tag: "h5" },
        { tag: "h6" },
      ],
    },
  },
  anatomies: {
    errorSummary: {
      holes: {
        summary: { description: "The id of the box.", kind: "id" },
        title: {
          description: "What the box says above the errors.",
          content: "text",
          example: "There is a problem",
        },
        target: {
          description: "The field an error is about, as #id.",
          kind: "url",
          per: ["error"],
          example: "#",
        },
        message: {
          description: "The error.",
          content: "text",
          per: ["error"],
          example: "Enter an email address",
        },
      },
      options: {
        id: { hole: "summary" },
        count: { count: "error" },
        titleId: { tool: "Left out: made from the box's id." },
      },
      // Empty until the server has errors to show; then the box is hidden.
      repeats: {
        error: { min: 0, description: "The errors, each a link to its field." },
      },
      nodes: [
        {
          tag: "lt-error-summary",
          from: ["errorSummary.host"],
          children: [
            {
              tag: "h2",
              from: ["errorSummary.title"],
              children: [{ hole: "title" }],
            },
            {
              tag: "ul",
              from: ["list"],
              children: [
                {
                  tag: "li",
                  repeat: "error",
                  children: [
                    {
                      tag: "a",
                      attributes: { href: { hole: "target" } },
                      children: [{ hole: "message" }],
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
  builderParts: {
    errorSummary: {
      host: null,
      title: { element: LT_ERROR_SUMMARY_TAG, part: "title" },
    },
  },
}
