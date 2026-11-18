import type { ComponentDoc } from "./shared.js"

export const skeleton: ComponentDoc = {
  classes: {
    "lt-skeleton": { content: "none", tags: [{ tag: "div" }] },
  },
  anatomies: {
    skeleton: { holes: {}, nodes: [{ tag: "div", from: ["skeleton"] }] },
  },
}
