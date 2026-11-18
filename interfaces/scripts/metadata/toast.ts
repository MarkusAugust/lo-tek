import type { LtToast } from "../../src/components/standalone/toast/lt-toast.js"
import { LT_TOAST_TAG } from "../../src/components/standalone/toast/lt-toast.js"
import { type ComponentDoc, element, number, text } from "./shared.js"

/** Why the toast region takes no name, for each attribute that would give it one. */
const TOAST_UNNAMED =
  "The region has no name since 0.45.0: Safari announces nothing put into a named live region, so VoiceOver said nothing about the messages."

export const toast: ComponentDoc = {
  element: element<typeof LtToast>(
    LT_TOAST_TAG,
    "toast",
    "A queue of short messages in the corner of the screen. The messages are created from script with `show(text, { color, duration })`.",
    {
      duration: number(
        "Milliseconds before a message disappears. The default is 6000, and 0 keeps the messages.",
      ),
      "close-label": text(
        'What the close button in each message is called for screen readers. The default is "Close message".',
      ),
    },
    {
      "toast-dismiss": {
        description:
          "A message was closed, by the user, because its time ran out, or with `dismiss()`. `clear()` dispatches none.",
      },
    },
    {
      label: `${TOAST_UNNAMED} Take \`label\` away, and \`aria-label\` with it.`,
      "aria-label": `${TOAST_UNNAMED} Take \`aria-label\` away.`,
      "aria-labelledby": `${TOAST_UNNAMED} Take \`aria-labelledby\` away.`,
      title: `${TOAST_UNNAMED} Take \`title\` away.`,
    },
  ),
  classes: {
    "lt-toast": { content: "none", tags: [{ tag: "lt-toast" }] },
    "lt-toast__message": { content: "free", tags: [{ tag: "div" }] },
    "lt-toast__close": { content: "text", tags: [{ tag: "button" }] },
  },
  anatomies: {
    toast: {
      page: "A toast speaks for the whole page, from one place.",
      holes: {},
      nodes: [{ tag: "lt-toast", from: ["toast.host"] }],
    },
  },
  builderParts: {
    toast: { host: null, message: null, close: null },
  },
}
