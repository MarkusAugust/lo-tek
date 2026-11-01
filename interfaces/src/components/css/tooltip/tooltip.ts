import { attributes } from "../shared.js"

export const TOOLTIP_CLASS = "lt-tooltip" as const
/** The bubble with the text. */
export const TOOLTIP_BUBBLE_CLASS = "lt-tooltip__bubble" as const

export type TooltipAttributes = {
  class: typeof TOOLTIP_CLASS
}

/**
 * The attributes for the wrapper around a trigger and a tooltip bubble.
 *
 * The bubble shows on hover and on focus. The focus part is not optional: a
 * bubble that only comes with the mouse does not exist for keyboard users.
 *
 * The text in the bubble must be connected to the trigger with
 * `aria-describedby`. Without it the bubble is just something that appears
 * on screen, and is never announced.
 *
 * Use it for something extra, never for something the user must have. On a
 * touch screen there is neither hover nor focus before something is tapped.
 *
 * ```ts
 * <span {...tooltip()}>
 *   <button aria-describedby="hint">Appraise</button>
 *   <span class={tooltip.bubble} role="tooltip" id="hint">At street value</span>
 * </span>
 * ```
 */
export const tooltip = Object.assign(
  (): TooltipAttributes => attributes({ class: TOOLTIP_CLASS }),
  {
    /** The class on the bubble with the text. */
    bubble: TOOLTIP_BUBBLE_CLASS,
  },
)
