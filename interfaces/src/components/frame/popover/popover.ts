import { attributes, idOrFallback } from "../../css/shared.js"

export const POPOVER_CLASS = "lt-popover" as const

/** Which edge of the button the panel hangs from. `start` and `end` follow the reading direction. */
export const popoverPlacements = [
  "bottom-start",
  "bottom-end",
  "top-start",
  "top-end",
] as const
export type PopoverPlacement = (typeof popoverPlacements)[number]

export function isPopoverPlacement(value: unknown): value is PopoverPlacement {
  return (popoverPlacements as readonly unknown[]).includes(value)
}

export type PopoverOptions = {
  /** Id of the panel. Connects the button to the panel with `aria-controls`. */
  id: string
  /** The panel is open. Default: closed. */
  open?: boolean
  /** Which edge the panel hangs from. Default: `bottom-start`. */
  placement?: PopoverPlacement
}

export type PopoverAttributes = {
  host: {
    open?: true
    placement?: PopoverPlacement
  }
  trigger: {
    type: "button"
    "aria-expanded": "true" | "false"
    "aria-controls": string
  }
  panel: {
    class: typeof POPOVER_CLASS
    id: string
    popover: "manual"
  }
}

/**
 * The attributes for a popover.
 *
 * The server writes both the button and the panel, with the wiring between
 * them. `<lt-popover>` works out the position and closes on a click outside.
 *
 * ```ts
 * const box = lt.popover({ id: "help" })
 * ```
 * ```html
 * <lt-popover>
 *   <button {...box.trigger}>What is the late fee?</button>
 *   <div {...box.panel}>EB 100 a night past the return date. No exceptions.</div>
 * </lt-popover>
 * ```
 */
export const popover = Object.assign(
  ({
    id: givenId,
    open = false,
    placement = "bottom-start",
  }: PopoverOptions): PopoverAttributes => {
    // The fallback only matters to someone without a type check.
    const id = idOrFallback("lt.popover()", givenId)

    return {
      host: attributes({
        // `open` must be on the host, not only in the button's aria-expanded.
        // Without it the markup said the panel was open while the component
        // thought it was closed. No preserve list: if a patch removes the
        // attribute, the component puts it back, and `server-controlled` turns
        // off the repair when the server is to decide the state.
        open: open ? (true as const) : undefined,
        placement: placement === "bottom-start" ? undefined : placement,
      }),
      trigger: attributes({
        // A button without `type` submits the form it is in.
        type: "button" as const,
        "aria-expanded": (open ? "true" : "false") as "true" | "false",
        "aria-controls": id,
      }),
      panel: attributes({
        class: POPOVER_CLASS,
        id,
        // `manual` and not `auto`: the component closes the panel itself, so
        // the button can close it again without the browser closing it first.
        popover: "manual" as const,
      }),
    }
  },
  {
    // The guard hangs on the function, as elsewhere in `lt`. The list sits
    // next to it, as `popoverPlacements`, and not on the function: `placement`
    // controls where JavaScript puts the panel, not CSS, and the guard for
    // the classes requires every list on a builder function to do something
    // in the CSS.
    isPlacement: isPopoverPlacement,
  },
)
