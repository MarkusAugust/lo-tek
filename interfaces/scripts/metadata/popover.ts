import type { LtPopover } from "../../src/components/frame/popover/lt-popover.js"
import {
  LT_POPOVER_PARTS,
  LT_POPOVER_TAG,
} from "../../src/components/frame/popover/lt-popover.js"
import { type ComponentDoc, element, flag, parts } from "./shared.js"

export const popover: ComponentDoc = {
  element: element<typeof LtPopover>(
    LT_POPOVER_TAG,
    "popover",
    "A panel that hangs from a button and closes itself. A button and a panel with the class `lt-popover` and an id from the template; the component sets `popover` and `aria-controls` where the markup came without them, but never the id.",
    {
      open: flag(
        "The panel is open. The server can send the attribute to open the panel.",
      ),
      placement: {
        description: "Which edge of the button the panel hangs from.",
        value: {
          values: [
            {
              name: "bottom-start",
              description:
                "Below the button, along the start edge. The default.",
            },
            {
              name: "bottom-end",
              description: "Below the button, along the end edge.",
            },
            {
              name: "top-start",
              description: "Above the button, along the start edge.",
            },
            {
              name: "top-end",
              description: "Above the button, along the end edge.",
            },
          ],
        },
      },
      "server-controlled": flag(
        "The server decides whether the panel is open. The component does not put `open` back when an update from the server removes it.",
      ),
    },
    {
      "popover-toggle": {
        description:
          "The user opened or closed the panel, or `show()`, `hide()` or `toggle()` was called. Setting `open` as a property or attribute dispatches no event.",
        detail: { open: "boolean" },
      },
    },
  ),
  parts: parts(LT_POPOVER_PARTS, {
    trigger: {
      description:
        "The button that opens and closes the panel: the one with `aria-controls` pointing at the panel's id, otherwise the first button outside the panel.",
      content: "text",
    },
    panel: {
      description:
        "The panel that opens: the element with `popover`, or the class. It needs an id from the server, which `aria-controls` on the button points to. The component never creates one, and without it the button cannot be wired to the panel.",
      content: "free",
      stableId: true,
    },
  }),
  classes: {
    "lt-popover": { content: "free", tags: [{ tag: "ul" }, { tag: "div" }] },
  },
  anatomies: {
    popover: {
      holes: {
        panel: {
          description: "The id of the panel the button opens.",
          kind: "id",
        },
        label: {
          description: "What the button says.",
          content: "text",
          example: "Actions",
        },
        item: {
          description: "An item in the panel.",
          content: "free",
          per: ["item"],
          example:
            '<button class="lt-button" data-variant="ghost">Action</button>',
        },
      },
      options: {
        id: { hole: "panel" },
        open: { tool: "The server opens and closes the panel." },
      },
      repeats: { item: { min: 1, description: "The items in the panel." } },
      nodes: [
        {
          tag: "lt-popover",
          from: ["popover.host"],
          children: [
            {
              tag: "button",
              from: ["button", "popover.trigger"],
              name: "button",
              settings: ["variant"],
              children: [{ hole: "label" }],
            },
            {
              tag: "ul",
              from: ["popover.panel"],
              children: [
                { tag: "li", repeat: "item", children: [{ hole: "item" }] },
              ],
            },
          ],
        },
      ],
    },
  },
  builderParts: {
    popover: {
      host: null,
      trigger: { element: LT_POPOVER_TAG, part: "trigger" },
      panel: { element: LT_POPOVER_TAG, part: "panel" },
    },
  },
}
