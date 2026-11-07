/**
 * Runs axe against the built documentation site, in both themes.
 *
 * The component tests in `interfaces` run against the components in
 * isolation. That is good, but it does not catch errors that only appear once
 * the components are placed on a page. The documentation for a design system
 * is a product in itself. Light grey body text on a white surface went
 * straight through precisely because nothing tested the built site.
 *
 * Run with: bun run test:docs (build first)
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { DIST, everyPage, readCount } from "./site"

const WCAG_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]

const axeSource = readFileSync(
  fileURLToPath(
    new URL("../node_modules/axe-core/axe.min.js", import.meta.url),
  ),
  "utf8",
)

// Pages where the Expressive Code script had not run after 20 seconds.
// Printed as evidence, but does not fail the check: the access is in the HTML.
const notRun: string[] = []

/** A violation as it is reported: the rule, why, and the elements. */
const violation = (v: {
  rule: string
  explanation: string
  elements: string[]
}) =>
  `${v.rule}\n    ${v.explanation}\n${v.elements.map((e) => `      ${e}`).join("\n")}`

/*
 * Every code block must have keyboard access in the HTML, before any script
 * runs.
 *
 * `ec-tabindex.mjs` sets `tabindex="0"` and `role="region"` on every `<pre>`
 * Expressive Code renders, and their script removes them where the block
 * fits. If the plugin disappears, the access comes back only from the
 * script, and the only time that failed was in CI, without anyone finding out
 * why. Counted over every built file, and requires the count to be greater
 * than zero.
 */
let codeBlocks = 0
const codeBlocksWithout: string[] = []
for (const file of new Bun.Glob("**/*.html").scanSync(DIST)) {
  const html = readFileSync(join(DIST, file), "utf8")
  for (const [tag] of html.matchAll(/<pre\b[^>]*\bdata-language\b[^>]*>/g)) {
    codeBlocks++
    if (!/\btabindex="0"/.test(tag) || !/\brole="region"/.test(tag)) {
      codeBlocksWithout.push(`${file}: ${tag.slice(0, 80)}`)
    }
  }
}

/*
 * Two tabs per theme, four in all, which is what the CI machine has in cores.
 * This check is CPU-bound as soon as it runs in parallel, since axe analyses
 * the whole DOM, so more tabs than cores gains nothing. That sets it apart
 * from `check-mobile.ts`, which only waits and therefore gets eight. The
 * pages of a theme share one context in `site.ts`, and with it the cache.
 *
 * Each page is checked in both themes, set the way the page itself would,
 * and a warning in the console fails it: the components speak up with
 * `console.warn` when the markup they got does not hang together, so a
 * warning on our own pages means either that an example is wrong or that
 * the warning fires on markup that is fine.
 */
const code = await everyPage({
  parallel: readCount("TABS_PER_THEME", 2),
  themes: ["light", "dark"],
  async check(page, path, theme) {
    const waitedInVain = await page.evaluate(async () => {
      const components = [...document.querySelectorAll("*")].filter(
        (el): el is HTMLElement & { updateComplete: Promise<unknown> } =>
          "updateComplete" in el,
      )
      await Promise.all(components.map((el) => el.updateComplete))

      /*
       * The code blocks get keyboard access from a script, not from the
       * markup. Expressive Code sets `tabindex` on the blocks that can
       * scroll, and does so after the page has been painted. If axe ran
       * before that, it reported "Scrollable region must have keyboard
       * access" on a block that got access a moment later, and the check
       * failed at random.
       *
       * The fonts must also be loaded: the width of the glyphs decides
       * whether the block can scroll at all.
       */
      await document.fonts.ready

      // The tables in the Markdown get theirs the same way, from the script
      // in `MarkdownContent.astro`, one frame after the fonts have changed
      // their width. Without them here, axe once saw a table on
      // `/changelog/` in that frame.
      const without = () =>
        [...document.querySelectorAll("pre, .table-scroll")].filter(
          (block) =>
            block.scrollWidth > block.clientWidth &&
            !block.hasAttribute("tabindex"),
        )

      /*
       * The deadline is generous, and a timeout is a named failure, not
       * silence. It was three seconds and ran out without a word when the
       * machine was busy, so axe saw the blocks before the script had reached
       * them, and reported nine violations of "Scrollable region must have
       * keyboard access" that were gone on the next run. A condition that
       * switches off a wait is the same as a condition that switches off a
       * check.
       */
      /*
       * A visible block that fits but still has `tabindex` from the HTML
       * means the Expressive Code script has not run yet. That is no fault
       * for the reader, but it is what went wrong in CI once, and then the
       * report should say what was loaded.
       */
      const notCleaned = () =>
        [
          ...document.querySelectorAll(".expressive-code pre, .table-scroll"),
        ].filter(
          (block) =>
            block.getClientRects().length > 0 &&
            block.scrollWidth <= block.clientWidth &&
            block.hasAttribute("tabindex"),
        )

      const deadline = Date.now() + 20_000
      while (
        (without().length > 0 || notCleaned().length > 0) &&
        Date.now() < deadline
      ) {
        await new Promise((r) => setTimeout(r, 50))
      }
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r(null))),
      )

      let script: string | null = null
      if (notCleaned().length > 0) {
        const loaded = performance
          .getEntriesByType("resource")
          .filter((e) => /\/_astro\/ec\.[^/]*\.js$/.test(e.name))
          // A request that answered 404 also has an entry here, so the
          // status code must be included. `responseStatus` exists in Chromium.
          .map((e) => {
            const t = e as PerformanceResourceTiming & {
              responseStatus?: number
            }
            return `${e.name.split("/").pop()} answered ${t.responseStatus ?? "unknown"} after ${Math.round(t.responseEnd)} ms`
          })
        const idle = await Promise.race([
          new Promise<string>((r) => {
            const start = performance.now()
            requestIdleCallback(() =>
              r(`ran after ${Math.round(performance.now() - start)} ms`),
            )
          }),
          new Promise<string>((r) =>
            setTimeout(() => r("did not run within 1 s"), 1000),
          ),
        ])
        script =
          `${notCleaned().length} blocks that fit still have tabindex. ` +
          `The script: ${loaded.length > 0 ? loaded.join(", ") : "not loaded"}. ` +
          `requestIdleCallback ${idle}. The page is ${document.visibilityState}.`
      }

      return {
        without: without().map((block) => block.outerHTML.slice(0, 160)),
        script,
      }
    })
    if (waitedInVain.script !== null)
      notRun.push(`${path} [${theme}]: ${waitedInVain.script}`)
    // A violation with its own name, not a throw: then it appears in the
    // report with the rest, and the guard at the bottom decides the outcome
    // as usual.
    const found: string[] = []
    if (waitedInVain.without.length > 0)
      found.push(
        violation({
          rule: "waited-in-vain-for-tabindex",
          explanation:
            "Scrollable <pre> without tabindex after 20 seconds. Either the " +
            "Expressive Code script did not run, or the block lacks keyboard access for good.",
          elements: waitedInVain.without,
        }),
      )
    await page.addScriptTag({ content: axeSource })

    const findings = await page.evaluate(async (rules) => {
      // biome-ignore lint/suspicious/noExplicitAny: axe is injected into the page context
      const result = await (window as any).axe.run(document, {
        runOnly: { type: "tag", values: rules },
        resultTypes: ["violations"],
      })
      // biome-ignore lint/suspicious/noExplicitAny: axe's own result type
      return result.violations.map((v: any) => ({
        rule: v.id,
        explanation: v.help,
        // biome-ignore lint/suspicious/noExplicitAny: axe's own node type
        elements: v.nodes.map((n: any) => n.html.slice(0, 160)),
      }))
    }, WCAG_AA)

    for (const f of findings) found.push(violation(f))
    return found
  },
})

if (codeBlocksWithout.length === 0 && codeBlocks > 0) {
  console.log(
    `All ${codeBlocks} code blocks have tabindex and role in the HTML.`,
  )
} else if (codeBlocks === 0) {
  console.log(
    "\n✗ Found no code blocks in the built documentation. Does Expressive Code still render <pre data-language>?",
  )
} else {
  console.log(
    `\n✗ ${codeBlocksWithout.length} of ${codeBlocks} code blocks lack tabindex or role in the HTML. Is ec-tabindex.mjs included in ec.config.mjs?`,
  )
  for (const k of codeBlocksWithout.slice(0, 10)) console.log(`  ${k}`)
}

for (const k of notRun) {
  console.log(`\nThe Expressive Code script had not run: ${k}`)
}

if (code === 0) console.log("✓ No accessibility violations.")
// The code blocks decide too, but never over a run that did not see
// everything: that is 2 whatever else was found.
process.exit(
  code === 2
    ? 2
    : code === 1 || codeBlocks === 0 || codeBlocksWithout.length > 0
      ? 1
      : 0,
)
