import type { LtDialog } from "../../src/components/frame/dialog/lt-dialog.js"
import {
  LT_DIALOG_PARTS,
  LT_DIALOG_TAG,
} from "../../src/components/frame/dialog/lt-dialog.js"
import { type ComponentDoc, element, flag, parts } from "./shared.js"

export const dialog: ComponentDoc = {
  element: element<typeof LtDialog>(
    LT_DIALOG_TAG,
    "dialog",
    'Makes a `<dialog class="lt-dialog">` the server sends open a real modal, with `showModal()`. The host around the dialog. Gives the dialog its name from the first heading outside `lt-dialog__body` when neither `aria-labelledby` nor `aria-label` is there.',
    {
      open: flag(
        "The dialog is open. For the server to show it, `open` must be on `<dialog>` too.",
      ),
      "server-controlled": flag(
        "When an update from the server removes `open` from `<dialog>` while the dialog is open, the component closes it and dispatches `dialog-toggle`, instead of putting `open` back.",
      ),
    },
    {
      "dialog-toggle": {
        description:
          "The dialog opened or closed. `returnValue` is the value of the button that closed it, or an empty string.",
        detail: { open: "boolean", returnValue: "string" },
      },
    },
  ),
  parts: parts(LT_DIALOG_PARTS, {
    dialog: {
      description: "The `<dialog>` element, as a direct child of the host.",
      content: "free",
      unique: true,
      name: { after: "title" },
    },
    title: {
      description:
        "The title: what `aria-labelledby` points to, otherwise the first heading outside the body. With `aria-label` on `<dialog>` it is not needed.",
      content: "text",
      optional: true,
    },
    body: {
      description:
        "The body, which scrolls when the dialog gets too tall. A heading here does not become the title.",
      content: "free",
      unique: true,
      optional: true,
    },
  }),
  classes: {
    "lt-dialog": {
      content: "free",
      tags: [{ tag: "dialog" }],
      parts: {
        header: {
          selector: ".lt-dialog__header",
          description:
            "The header, with the heading and the subtitle. `data-color` on the dialog colours it.",
          content: "parts",
          optional: true,
        },
        title: {
          selector: ".lt-dialog__title",
          description: "The heading, which `aria-labelledby` points to.",
          content: "text",
          optional: true,
        },
        subtitle: {
          selector: ".lt-dialog__subtitle",
          description: "The line below the heading, inside the header.",
          content: "text",
          optional: true,
        },
        body: {
          selector: ".lt-dialog__body",
          description:
            "The content, which scrolls when the dialog gets too tall. Must be a direct child.",
          content: "free",
          optional: true,
        },
        footer: {
          selector: ".lt-dialog__footer",
          description:
            'The row of buttons at the bottom, often a `<form method="dialog">`.',
          content: "free",
          optional: true,
        },
      },
    },
    "lt-dialog__header": {
      content: "parts",
      tags: [{ tag: "div" }],
      partOf: "lt-dialog",
      parts: {
        title: {
          selector: ".lt-dialog__title",
          description: "The heading.",
          content: "text",
        },
        subtitle: {
          selector: ".lt-dialog__subtitle",
          description: "The line below the heading.",
          content: "text",
          optional: true,
        },
      },
    },
    "lt-dialog__title": {
      content: "text",
      partOf: "lt-dialog",
      tags: [
        { tag: "h1" },
        { tag: "h2" },
        { tag: "h3" },
        { tag: "h4" },
        { tag: "h5" },
        { tag: "h6" },
      ],
    },
    "lt-dialog__subtitle": {
      content: "text",
      partOf: "lt-dialog",
      tags: [{ tag: "p" }],
    },
    "lt-dialog__body": {
      content: "free",
      partOf: "lt-dialog",
      tags: [{ tag: "div" }],
    },
    "lt-dialog__footer": {
      content: "free",
      partOf: "lt-dialog",
      tags: [{ tag: "form" }, { tag: "div" }],
    },
  },
  anatomies: {
    dialog: {
      page: "A dialog opens over the page, so it stands on the page, not in another component.",
      holes: {
        "title-id": {
          description: "The id the dialog takes its name from.",
          kind: "id",
        },
        title: {
          description: "What the dialog asks or says.",
          content: "text",
          example: "Cancel the job?",
        },
        subtitle: {
          description: "A line below the title.",
          content: "text",
          example: "Job 222-0481",
        },
        body: {
          description: "The content.",
          content: "free",
          example: "<p>This cannot be undone.</p>",
        },
        footer: {
          description: "The buttons at the bottom.",
          content: "free",
          only: {
            builders: ["button", "link"],
            why: "The bottom of a dialog holds the buttons that answer it.",
          },
        },
      },
      options: {
        titleId: { hole: "title-id" },
        open: {
          tool: "The server opens and closes the dialog, through <lt-dialog>.",
        },
      },
      nodes: [
        {
          tag: "lt-dialog",
          from: ["dialog.host"],
          name: "host",
          description: "Lets the server open the dialog.",
          wrapper: true,
          created: true,
          children: [
            {
              tag: "dialog",
              from: ["dialog.dialog"],
              children: [
                {
                  tag: "div",
                  from: ["dialog.header"],
                  name: "header",
                  description:
                    "A header that can carry a colour and a subtitle.",
                  wrapper: true,
                  children: [
                    {
                      tag: "h2",
                      from: ["dialog.title"],
                      children: [{ hole: "title" }],
                    },
                    {
                      tag: "p",
                      from: ["dialog.subtitle"],
                      name: "subtitle",
                      description: "A line below the title.",
                      optional: true,
                      requires: "header",
                      children: [{ hole: "subtitle" }],
                    },
                  ],
                },
                {
                  tag: "div",
                  from: ["dialog.body"],
                  name: "body",
                  description: "The content, which scrolls when it is long.",
                  optional: true,
                  created: true,
                  children: [{ hole: "body" }],
                },
                {
                  tag: "form",
                  from: ["dialog.footer"],
                  attributes: { method: "dialog" },
                  name: "footer",
                  description: "The row of buttons at the bottom.",
                  optional: true,
                  created: true,
                  children: [{ hole: "footer" }],
                },
              ],
            },
          ],
        },
      ],
    },
  },
  builderParts: {
    dialog: {
      host: null,
      dialog: { element: LT_DIALOG_TAG, part: "dialog" },
      header: null,
      title: { element: LT_DIALOG_TAG, part: "title" },
      subtitle: null,
      body: { element: LT_DIALOG_TAG, part: "body" },
      footer: null,
    },
  },
}
