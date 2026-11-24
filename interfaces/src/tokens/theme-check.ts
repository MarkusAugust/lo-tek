import { defaultCore } from "../diagnostics/default-core.js"

/**
 * Checks a theme a consumer has written by hand.
 *
 * The generator keeps the promises by construction. When someone writes in
 * values of their choosing, keeping the promises is up to them, and then we
 * owe them an answer about which cell breaks. Without this, "you can override
 * anything" is a trap.
 *
 * All that matters is which `--lt-color-*` is in which block, and whether the
 * block is light or dark, read from `color-scheme` or the selector. A value
 * that cannot be computed is reported as exactly that instead of being
 * skipped, and missing values are filled from LO-TEK's default theme, so
 * someone who has overridden a single cell gets it checked against the rest
 * of the system.
 *
 * The check is the core, written in Rust, the same one `lotek check-theme`
 * uses.
 */

import type { CoreThemeReport } from "../diagnostics/core.js"

export type ThemeReport = {
  problems: ThemeProblem[]
  /** Blocks that were actually read. */
  blocks: number
  /**
   * Values the consumer wrote, and that were understood.
   *
   * The promise count alone is no proof of work: the defaults fill the gaps,
   * so one line gives as many promises as a whole theme. This number counts
   * what the file actually contained.
   */
  declarations: number
  /** Promises that were actually checked. */
  promises: number
  /**
   * Other `--lt-*` tokens the file sets, without a contrast promise: the
   * font, the shape and the system colours.
   */
  others: number
  /**
   * What the check came to, as `lotek check-theme` says it. Decide on
   * `kind`, and show `message` as it is.
   */
  verdict: CoreThemeReport["verdict"]
}

export type ThemeProblem = {
  selector: string
  message: string
}

/** Reads a theme and checks every promise in every block. */
export function inspectTheme(css: string): ThemeReport {
  return defaultCore().inspectTheme(css)
}

/** Only the problems, for anyone who does not need the counts. */
export function checkTheme(css: string): ThemeProblem[] {
  return inspectTheme(css).problems
}
