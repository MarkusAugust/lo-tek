import type { LtSessionTimeout } from "../../src/components/frame/session-timeout/lt-session-timeout.js"
import {
  LT_SESSION_TIMEOUT_PARTS,
  LT_SESSION_TIMEOUT_TAG,
} from "../../src/components/frame/session-timeout/lt-session-timeout.js"
import { type ComponentDoc, element, number, parts } from "./shared.js"

export const sessionTimeout: ComponentDoc = {
  element: element<typeof LtSessionTimeout>(
    LT_SESSION_TIMEOUT_TAG,
    "session-timeout",
    'Warns before a signed-in session expires, and counts down. The renderer writes the dialog and the text inside the element: a `<dialog>` with `.lt-session-timeout__count` for the number, `[role=status]` for the announcement and the buttons in a `<form method="dialog">`. Dispatches `session-warn` when the dialog opens, `session-extend` when the user wants to continue, `session-logout` when the user logs out with a button that closes the dialog, `session-expired` when time is up, and `session-activity` at most once per `activity-interval` while the user is active, so the app can keep the server session alive.',
    {
      "warn-at": number("Seconds without activity before the warning appears."),
      "expires-at": number(
        "Seconds without activity before the session expires.",
      ),
      "activity-interval": number(
        "Seconds between each `session-activity` while the user is active. Default 60.",
      ),
    },
    {
      "session-warn": { description: "The warning opened." },
      "session-extend": {
        description:
          "The session continues: the user closed the warning with a button other than log out or with Escape, or the app called `extend()`.",
      },
      "session-logout": {
        description:
          'The user chose to log out with a button that closes the dialog. A Log out button with `formmethod="post"` submits to the server instead, and the event does not come.',
      },
      "session-expired": { description: "Time is up." },
      "session-activity": {
        description:
          "The user is active. Dispatched at most once per `activity-interval`, so the app can keep the server session alive.",
      },
    },
  ),
  parts: parts(LT_SESSION_TIMEOUT_PARTS, {
    dialog: {
      description: "The `<dialog>` element with the warning.",
      content: "free",
      unique: true,
      name: { after: "title" },
    },
    title: {
      description:
        "The heading in the dialog, which becomes its name when neither `aria-labelledby` nor `aria-label` is on `<dialog>`.",
      content: "text",
      optional: true,
    },
    text: {
      description:
        "The paragraph with the time remaining. The announcement is this paragraph with the number replaced.",
      content: "text",
      unique: true,
    },
    count: {
      description:
        "The number that counts down, inside the paragraph. The component fills it.",
      content: "none",
      unique: true,
    },
    status: {
      description:
        "The announcement. The element is left empty, and the component fills it.",
      content: "none",
    },
    button: {
      description:
        'The buttons in `<form method="dialog">`, which extend the session or log out.',
      content: "text",
      multiple: true,
    },
  }),
  classes: {
    "lt-session-timeout": {
      content: "parts",
      tags: [{ tag: "lt-session-timeout" }],
      parts: {
        dialog: {
          selector: ".lt-session-timeout__dialog",
          description:
            'The dialog with the warning, with `role="alertdialog"`.',
          content: "parts",
        },
        title: {
          selector: ".lt-session-timeout__title",
          description: "The heading in the dialog.",
          content: "text",
          optional: true,
        },
        text: {
          selector: ".lt-session-timeout__text",
          description: "The paragraph with the time remaining.",
          content: "text",
        },
        count: {
          selector: ".lt-session-timeout__count",
          description:
            "The number that counts down, inside the paragraph. The component fills it.",
          content: "none",
        },
        status: {
          selector: "[role='status']",
          description:
            "The announcement. Left empty, and the component fills it.",
          content: "none",
        },
        actions: {
          selector: ".lt-session-timeout__actions",
          description: 'The button row, a `<form method="dialog">`.',
          content: "parts",
        },
        button: {
          selector: ".lt-session-timeout__actions button",
          description: "The buttons that extend the session or log out.",
          content: "text",
          multiple: true,
        },
      },
    },
    "lt-session-timeout__dialog": {
      content: "parts",
      tags: [{ tag: "dialog" }],
      partOf: "lt-session-timeout",
      parts: {
        title: {
          selector: ".lt-session-timeout__title",
          description: "The heading.",
          content: "text",
          optional: true,
        },
        text: {
          selector: ".lt-session-timeout__text",
          description: "The paragraph with the time remaining.",
          content: "text",
        },
        count: {
          selector: ".lt-session-timeout__count",
          description: "The number that counts down, inside the paragraph.",
          content: "none",
        },
        status: {
          selector: "[role='status']",
          description: "The announcement, which the component fills.",
          content: "none",
        },
        actions: {
          selector: ".lt-session-timeout__actions",
          description: 'The button row, a `<form method="dialog">`.',
          content: "parts",
        },
      },
    },
    "lt-session-timeout__title": {
      content: "text",
      tags: [
        { tag: "h1" },
        { tag: "h2" },
        { tag: "h3" },
        { tag: "h4" },
        { tag: "h5" },
        { tag: "h6" },
      ],
      partOf: "lt-session-timeout",
    },
    "lt-session-timeout__text": {
      content: "text",
      partOf: "lt-session-timeout",
      tags: [{ tag: "p" }],
    },
    "lt-session-timeout__count": {
      content: "none",
      tags: [{ tag: "span" }],
      partOf: "lt-session-timeout",
    },
    "lt-session-timeout__actions": {
      content: "parts",
      tags: [{ tag: "form" }],
      partOf: "lt-session-timeout",
      parts: {
        button: {
          selector: "button",
          description: "The buttons that extend the session or log out.",
          content: "text",
          multiple: true,
        },
      },
    },
  },
  anatomies: {
    sessionTimeout: {
      page: "The session timeout is a dialog for the whole page.",
      holes: {
        "title-id": {
          description: "The id the dialog takes its name from.",
          kind: "id",
        },
        title: {
          description: "What the dialog says.",
          content: "text",
          example: "Your session is ending",
        },
        before: {
          description: "The text before the time left.",
          content: "text",
          example: "Your session ends in ",
        },
        after: {
          description: "The text after the time left.",
          content: "text",
          example: ".",
        },
        extend: {
          description: "What the button that keeps the session says.",
          content: "text",
          example: "Stay signed in",
        },
        logout: {
          description: "What the button that ends it says.",
          content: "text",
          example: "Sign out",
        },
      },
      options: {
        titleId: { hole: "title-id" },
        expiresAt: { tool: "The server says when the session ends." },
      },
      nodes: [
        {
          tag: "lt-session-timeout",
          from: ["sessionTimeout.host"],
          children: [
            {
              tag: "dialog",
              from: ["sessionTimeout.dialog"],
              children: [
                {
                  tag: "h2",
                  from: ["sessionTimeout.title"],
                  children: [{ hole: "title" }],
                },
                {
                  tag: "p",
                  from: ["sessionTimeout.text"],
                  children: [
                    { hole: "before" },
                    { tag: "span", from: ["sessionTimeout.count"] },
                    { hole: "after" },
                  ],
                },
                { tag: "span", from: ["sessionTimeout.live"] },
                {
                  tag: "form",
                  from: ["sessionTimeout.actions"],
                  children: [
                    {
                      tag: "button",
                      from: ["sessionTimeout.extend"],
                      children: [{ hole: "extend" }],
                    },
                    {
                      tag: "button",
                      from: ["sessionTimeout.logout"],
                      children: [{ hole: "logout" }],
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
    sessionTimeout: {
      host: null,
      dialog: { element: LT_SESSION_TIMEOUT_TAG, part: "dialog" },
      title: { element: LT_SESSION_TIMEOUT_TAG, part: "title" },
      text: { element: LT_SESSION_TIMEOUT_TAG, part: "text" },
      count: { element: LT_SESSION_TIMEOUT_TAG, part: "count" },
      live: { element: LT_SESSION_TIMEOUT_TAG, part: "status" },
      actions: null,
      extend: { element: LT_SESSION_TIMEOUT_TAG, part: "button" },
      logout: { element: LT_SESSION_TIMEOUT_TAG, part: "button" },
    },
  },
}
