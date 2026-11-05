import { attributes } from "../shared.js"

export const STEPS_CLASS = "lt-steps" as const

export type StepsAttributes = {
  class: typeof STEPS_CLASS
}

/**
 * The attributes for a step indicator, which shows where the user is in a
 * task over several pages, like an order.
 *
 * The class goes on an `<ol>` with one `<li>` per step, and the step the
 * user is on has `aria-current="step"`. The steps before it are drawn as
 * done, with a check the screen reader reads as "Completed", so the markup
 * only says where the user is. A done step can be a link back to it.
 *
 * ```ts
 * <ol {...steps()} aria-label="Order">
 *   <li><a href="/order/site">Site</a></li>
 *   <li aria-current="step">Walls</li>
 *   <li>Payment</li>
 * </ol>
 * ```
 */
export const steps = (): StepsAttributes => attributes({ class: STEPS_CLASS })
