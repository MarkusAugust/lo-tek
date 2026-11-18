import type { AnatomyChoice } from "../../src/vocabulary/types.js"
import type { ComponentDoc } from "./shared.js"

/**
 * A column heading in a table: plain, sorted by a button, or sorted by a
 * link the server answers on the next page load. `hole` is the text.
 */
const columnHeading = (
  name: string,
  hole: string,
  sort: string,
  repeat?: string,
): AnatomyChoice => ({
  name,
  description: "How the column is sorted, if at all.",
  ...(repeat ? { repeat } : {}),
  oneOf: {
    plain: { tag: "th", attributes: { scope: "col" }, children: [{ hole }] },
    sortable: {
      tag: "th",
      from: ["tableSort.header"],
      settings: ["direction"],
      attributes: { scope: "col" },
      children: [
        { tag: "button", from: ["tableSort.button"], children: [{ hole }] },
      ],
    },
    link: {
      tag: "th",
      from: ["tableSort.header"],
      options: { tableSort: { link: true } },
      settings: ["direction"],
      attributes: { scope: "col" },
      children: [
        {
          tag: "a",
          from: ["tableSort.button"],
          attributes: { href: { hole: sort } },
          children: [{ hole }],
        },
      ],
    },
  },
})

export const table: ComponentDoc = {
  classes: {
    "lt-table": {
      content: "parts",
      tags: [{ tag: "table" }],
      parts: {
        caption: {
          selector: "> caption",
          description: "The name of the table.",
          content: "text",
          unique: true,
          optional: true,
        },
        head: {
          selector: "> thead",
          description: 'The header row, with a `<th scope="col">` per column.',
          content: "free",
          unique: true,
        },
        body: {
          selector: "tbody",
          description:
            'The rows, in one or more groups. A `<th scope="row">` first in the row gives the row a name.',
          content: "free",
          multiple: true,
        },
        sort: {
          selector: "th > .lt-table__sort",
          description:
            "The button in a sortable header. `aria-sort` on the cell says which way.",
          content: "text",
          multiple: true,
          optional: true,
        },
      },
    },
    "lt-table__sort": {
      content: "text",
      partOf: "lt-table",
      tags: [{ tag: "button" }, { tag: "a", requires: ["href"] }],
    },
    "lt-table-scroll": {
      content: "parts",
      tags: [{ tag: "div" }],
      parts: {
        table: {
          selector: ".lt-table",
          description: "The table that can be scrolled sideways.",
          content: "free",
        },
      },
    },
  },
  anatomies: {
    table: {
      holes: {
        region: {
          description: "The name of the box that scrolls.",
          kind: "text",
          example: "Table",
        },
        caption: {
          description: "The table's name.",
          content: "text",
          example: "Table",
        },
        "row-heading": {
          description: "The heading over the rows' names.",
          content: "text",
          example: "Name",
        },
        heading: {
          description: "A column's heading.",
          content: "text",
          per: ["column"],
          example: "Column",
        },
        "row-sort": {
          description: "The address that sorts by the rows' names.",
          kind: "url",
          example: "?sort=name",
        },
        sort: {
          description: "The address that sorts by the column.",
          kind: "url",
          per: ["column"],
          example: "?sort=column",
        },
        "row-name": {
          description: "A row's name.",
          content: "text",
          per: ["row"],
          example: "Row",
        },
        cell: {
          description: "A cell.",
          content: "text",
          per: ["row", "column"],
          example: "Value",
        },
      },
      repeats: {
        column: { min: 1, description: "The columns after the rows' names." },
        row: { min: 1, description: "The rows." },
      },
      nodes: [
        {
          tag: "div",
          from: ["table.scroll"],
          name: "scroll",
          description: "A box that lets a wide table scroll.",
          wrapper: true,
          // Not optional once the box is there: without tabindex no keyboard
          // reaches what is beyond the edge, and the region needs a name.
          attributes: {
            tabindex: "0",
            role: "region",
            "aria-label": { hole: "region" },
          },
          children: [
            {
              tag: "table",
              from: ["table"],
              children: [
                // The table's name. lotek check reports a table without one.
                { tag: "caption", children: [{ hole: "caption" }] },
                {
                  tag: "thead",
                  children: [
                    {
                      tag: "tr",
                      children: [
                        columnHeading("row-heading", "row-heading", "row-sort"),
                        columnHeading("heading", "heading", "sort", "column"),
                      ],
                    },
                  ],
                },
                {
                  tag: "tbody",
                  children: [
                    {
                      tag: "tr",
                      repeat: "row",
                      children: [
                        {
                          tag: "th",
                          attributes: { scope: "row" },
                          children: [{ hole: "row-name" }],
                        },
                        {
                          tag: "td",
                          repeat: "column",
                          children: [{ hole: "cell" }],
                        },
                      ],
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
    tableSort: { header: null, button: null },
  },
}
