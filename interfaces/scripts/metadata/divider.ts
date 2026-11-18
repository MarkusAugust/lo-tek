import type { ComponentDoc } from "./shared.js"

export const divider: ComponentDoc = {
  classes: {
    "lt-divider": { content: "none", tags: [{ tag: "hr" }] },
  },
  anatomies: {
    divider: { holes: {}, nodes: [{ tag: "hr", from: ["divider"] }] },
  },
}
