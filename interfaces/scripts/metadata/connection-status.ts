import type { LtConnectionStatus } from "../../src/components/standalone/connection-status/lt-connection-status.js"
import { LT_CONNECTION_STATUS_TAG } from "../../src/components/standalone/connection-status/lt-connection-status.js"
import { type ComponentDoc, element, text } from "./shared.js"

export const connectionStatus: ComponentDoc = {
  element: element<typeof LtConnectionStatus>(
    LT_CONNECTION_STATUS_TAG,
    "connection-status",
    "Tells the user when the connection to the server is lost. The app reports with `reportFailure()` and `reportSuccess()`.",
    {
      "offline-text": text("The text when the connection is lost."),
      "online-text": text("The text when it comes back."),
    },
    {
      "connection-lost": { description: "The connection is lost." },
      "connection-restored": { description: "The connection is back." },
    },
  ),
  classes: {
    // The classes the components set on the nodes they create themselves have
    // content but no parent: nobody writes them in markup, so no part matches them.
    "lt-connection-status": {
      content: "none",
      tags: [{ tag: "lt-connection-status" }],
    },
    "lt-connection-status__bar": { content: "text", tags: [{ tag: "div" }] },
  },
  anatomies: {
    connectionStatus: {
      page: "The connection status speaks for the whole page, from one place.",
      holes: {},
      nodes: [{ tag: "lt-connection-status", from: ["connectionStatus"] }],
    },
  },
}
