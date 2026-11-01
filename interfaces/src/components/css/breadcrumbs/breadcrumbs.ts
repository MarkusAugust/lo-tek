import { attributes } from "../shared.js"

export const BREADCRUMBS_CLASS = "lt-breadcrumbs" as const

export type BreadcrumbsAttributes = {
  class: typeof BREADCRUMBS_CLASS
}

/**
 * The attributes for a breadcrumb trail.
 *
 * The class goes on an `<ol>` inside a `<nav>` with a text that says what
 * the navigation is, for example `aria-label="You are here"`. The order
 * matters, so the list must be numbered even though the numbers are not
 * shown.
 *
 * The separator between the steps is added with CSS. Had it been in the
 * markup, screen readers would have read "slash" between every step.
 *
 * ```ts
 * <nav aria-label="You are here">
 *   <ol {...breadcrumbs()}>
 *     <li><a href="/">Home</a></li>
 *     <li><a href="/claims" aria-current="page">My claims</a></li>
 *   </ol>
 * </nav>
 * ```
 */
export const breadcrumbs = (): BreadcrumbsAttributes =>
  attributes({ class: BREADCRUMBS_CLASS })
