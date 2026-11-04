/**
 * Checks markup against LO-TEK, outside the browser.
 *
 * `diagnoseMarkup(html)` is the same check the editor extensions run while
 * you type, and that `lotek check` runs on the command line. It is here
 * because markup from a template, in Go, a Kotlin string or a Razor view, has
 * no compiler looking at the attributes. A test
 * in the app can then run it over the HTML the server actually sends:
 *
 * ```ts
 * import { diagnosePage } from "@lo-tek/interfaces/diagnostics"
 *
 * expect(diagnosePage(html)).toEqual([])
 * ```
 *
 * The check is the core, written in Rust and built to WebAssembly (see
 * `core.ts`). The module ships with the package, and is loaded the first
 * time one of the functions is called, in Node, Bun and Deno. In the
 * browser, or where the module is bundled some other way, `loadCore` loads
 * it.
 */

import type { Finding } from "./core.js"

export type { Manifest } from "../vocabulary/types.js"

import { defaultCore } from "./default-core.js"

export {
  type Core,
  type CoreStyles,
  type CoreTheme,
  type CoreThemeReport,
  type CoreVersion,
  type Finding,
  type Fix,
  loadCore,
  type Severity,
  type Violation,
} from "./core.js"

/** Options for the check. */
export type DiagnoseOptions = {
  /**
   * The stylesheets the page loads, as text. With them the check also
   * reports a class none of them styles, as when the component's stylesheet
   * is not loaded, and a value without a rule, such as a variant added to a
   * taken-over component without the CSS getting it.
   */
  css?: string[]
}

/** Every finding in the text: the vocabulary, for a template or a fragment of a page. */
export function diagnoseMarkup(
  text: string,
  options: DiagnoseOptions = {},
): Finding[] {
  return options.css
    ? defaultCore().diagnoseStyled(text, options.css, false)
    : defaultCore().diagnoseMarkup(text)
}

/**
 * Every finding on a whole page: what `diagnoseMarkup` finds, and also that
 * every `for`, `aria-describedby`, `aria-labelledby` and `aria-controls`
 * points to an id that exists, that no id appears twice, and that every
 * LO-TEK field and every help text and error text is wired.
 *
 * Use it on the HTML the server sends, not on a template: in a template split
 * into pieces, the id can be in another file.
 *
 * ```ts
 * const html = await (await fetch("http://localhost:8080/form")).text()
 * expect(diagnosePage(html)).toEqual([])
 * ```
 */
export function diagnosePage(
  text: string,
  options: DiagnoseOptions = {},
): Finding[] {
  return options.css
    ? defaultCore().diagnoseStyled(text, options.css, true)
    : defaultCore().diagnosePage(text)
}

/** What `diagnoseRendered` needs from a page: `evaluate`, as in Playwright. */
export type RenderedPage = {
  evaluate<T>(script: () => Promise<T>): Promise<T>
}

/**
 * Reads the rendered page in the browser: the DOM as it stands now, and the
 * text of every stylesheet, with what they import. A stylesheet from another
 * origin, such as a CDN, cannot be read through the CSSOM without
 * `crossorigin`, and is then fetched again with `fetch`.
 *
 * The function runs in the browser, and cannot use anything outside itself.
 */
export const READ_RENDERED_PAGE = async (): Promise<{
  html: string
  css: string[]
}> => {
  const sheets: CSSStyleSheet[] = [
    ...document.styleSheets,
    ...document.adoptedStyleSheets,
  ]
  const css: string[] = []
  const read = async (sheet: CSSStyleSheet): Promise<void> => {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      if (!sheet.href) return
      const answer = await fetch(sheet.href)
      if (!answer.ok)
        throw new Error(
          `The stylesheet ${sheet.href} could not be read, and answered ${answer.status} when it was fetched again.`,
        )
      css.push(await answer.text())
      return
    }
    for (const rule of rules)
      if (rule instanceof CSSImportRule && rule.styleSheet)
        await read(rule.styleSheet)
    css.push([...rules].map((rule) => rule.cssText).join("\n"))
  }
  for (const sheet of sheets) await read(sheet)
  const doctype = document.doctype ? `<!DOCTYPE ${document.doctype.name}>` : ""
  return { html: doctype + document.documentElement.outerHTML, css }
}

/**
 * Checks the page as the browser has rendered it, with the stylesheets it
 * has loaded: what `diagnosePage` finds, and what the stylesheets do not
 * style. Markup the web components have added, and a class JavaScript has
 * set, are included.
 *
 * ```ts
 * import { diagnoseRendered } from "@lo-tek/interfaces/diagnostics"
 *
 * await page.goto("http://localhost:8080/form")
 * expect(await diagnoseRendered(page)).toEqual([])
 * ```
 *
 * `page` is a Playwright page, or anything with `evaluate`.
 */
export async function diagnoseRendered(page: RenderedPage): Promise<Finding[]> {
  const { html, css } = await page.evaluate(READ_RENDERED_PAGE)
  return defaultCore().diagnoseStyled(html, css, true)
}
