import type { ComponentDoc } from "./shared.js"

export const fileUpload: ComponentDoc = {
  classes: {
    "lt-file-upload": { content: "none", tags: [{ tag: "input" }] },
    "lt-file-upload-list": {
      content: "parts",
      tags: [{ tag: "ul" }],
      parts: {
        item: {
          selector: "li",
          description: "One chosen file, with its name.",
          content: "free",
          multiple: true,
        },
        remove: {
          selector: "li > button",
          description:
            "The button that removes the file, with the file name in its text.",
          content: "text",
          multiple: true,
          optional: true,
        },
      },
    },
  },
}
