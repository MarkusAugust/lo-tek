/**
 * Registers all the web components in one call.
 *
 * Each component has its own `defineLt*`, and an app that only uses the field
 * can settle for `defineLtField()` and keep the rest out of its bundle. But
 * most apps use several, and a demo app had seven calls in a `useEffect`,
 * that is, after the first paint. Then the elements in the markup are plain
 * `HTMLElement`s when React paints them, and the first call to
 * `reportSuccess()` came before the effect. One call, at import, closes the
 * gap.
 *
 * Like the individual functions, it does nothing on a server, so it can sit
 * at the top of a module that runs in both places.
 */

import { defineLtDialog } from "./components/frame/dialog/lt-dialog.js"
import { defineLtErrorSummary } from "./components/frame/error-summary/lt-error-summary.js"
import { defineLtField } from "./components/frame/field/lt-field.js"
import { defineLtPopover } from "./components/frame/popover/lt-popover.js"
import { defineLtSessionTimeout } from "./components/frame/session-timeout/lt-session-timeout.js"
import { defineLtSuggestion } from "./components/frame/suggestion/lt-suggestion.js"
import { defineLtTabs } from "./components/frame/tabs/lt-tabs.js"
import { defineLtTerm } from "./components/frame/term/lt-term.js"
import { defineLtConnectionStatus } from "./components/standalone/connection-status/lt-connection-status.js"
import { defineLtToast } from "./components/standalone/toast/lt-toast.js"

// The types of the events and tag names, so `querySelector("lt-dialog")` and
// `addEventListener` are typed also for someone who only imports this entry
// point. Without the line the imports above disappeared from the `.d.ts`
// file, and neither `HTMLElementEventMap` nor `HTMLElementTagNameMap` was
// extended.
export type { LtEventMap } from "./components/events.js"

export function defineLt(): void {
  defineLtField()
  defineLtTabs()
  defineLtErrorSummary()
  defineLtPopover()
  defineLtSuggestion()
  defineLtDialog()
  defineLtToast()
  defineLtSessionTimeout()
  defineLtConnectionStatus()
  defineLtTerm()
}
