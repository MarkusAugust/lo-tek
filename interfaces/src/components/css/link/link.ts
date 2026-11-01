import { attributes } from "../shared.js"

export const LINK_CLASS = "lt-link" as const

export type LinkOptions = {
  /**
   * The link cannot be clicked yet. Gives `aria-disabled`, `role="link"` and
   * `tabindex="0"`, so screen readers still find it as a link and can say
   * so. Remove `href` as well: otherwise Enter follows it.
   */
  disabled?: boolean
}

export type LinkAttributes = {
  class: typeof LINK_CLASS
  role?: "link"
  tabindex?: "0"
  "aria-disabled"?: "true"
}

/**
 * The attributes for a link.
 *
 * ```ts
 * <a {...link()} href="/small-print">Read the small print</a>
 * <a {...link({ disabled: true })}>See annual statement</a>
 * ```
 *
 * An `<a>` without `href` is no link to a screen reader and is not in the
 * tab order. `role` and `tabindex` give it both back while it is disabled.
 */
export const link = ({ disabled = false }: LinkOptions = {}): LinkAttributes =>
  attributes({
    class: LINK_CLASS,
    role: disabled ? ("link" as const) : undefined,
    tabindex: disabled ? ("0" as const) : undefined,
    "aria-disabled": disabled ? ("true" as const) : undefined,
  })
