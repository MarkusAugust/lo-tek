import type { ComponentDoc } from "./shared.js"

export const spinner: ComponentDoc = {
  classes: {
    "lt-spinner": { content: "none", tags: [{ tag: "span" }] },
  },
  anatomies: {
    spinner: { holes: {}, nodes: [{ tag: "span", from: ["spinner"] }] },
  },
}
