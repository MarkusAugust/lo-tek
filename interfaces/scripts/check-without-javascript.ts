/**
 * The tabs on a page without JavaScript, in Chromium, Firefox and WebKit.
 *
 * Vitest cannot test this: the tests themselves run as scripts in the page.
 * Here the markup is loaded in a Playwright context with
 * `javaScriptEnabled: false`, with the stylesheets as the only code, as a
 * reader without JavaScript gets it.
 *
 * The markup comes from two sources: a template written by hand, and
 * `lt.tabs()`. The Kotlin version, `Lt.tabs`, is covered by `ContractTest`,
 * which requires it to give the same as `lt.tabs()` for every case in
 * `manifest/build-cases.json`.
 *
 * The requirements are those in `krav-faner.md` (the investigation): A1 all
 * the panels are shown, A2 the tab list is a plain list of links that can
 * all be reached with Tab, A3 axe finds no violations, A8 none of the panels
 * becomes a landmark.
 *
 * Run with: bun run check:without-javascript
 */

import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { type Browser, chromium, firefox, type Page, webkit } from "playwright"
import { tabs } from "../src/components/frame/tabs/tabs.js"
import { attr } from "../src/testing/markup.js"

const SRC = fileURLToPath(new URL("../src/", import.meta.url))
const css = (
  await Promise.all(
    ["tokens/tokens.css", "components/frame/tabs/tabs.css"].map((file) =>
      Bun.file(`${SRC}${file}`).text(),
    ),
  )
).join("\n")
const axeSource = await Bun.file(
  createRequire(import.meta.url).resolve("axe-core/axe.min.js"),
).text()

const NAMES = ["Claim", "Attachments", "Messages"]
const KEYS = ["claim", "attachments", "messages"]

const HANDWRITTEN = `
  <lt-tabs>
    <ul class="lt-tabs__list" aria-label="Parts of the claim">
      ${NAMES.map((n, i) => `<li><a href="#${KEYS[i]}">${n}</a></li>`).join("")}
    </ul>
    ${NAMES.map((n, i) => `<section class="lt-tabs__panel" id="${KEYS[i]}"><h2>${n}</h2><p>The contents of ${n.toLowerCase()}.</p></section>`).join("")}
  </lt-tabs>`

const tabSet = tabs({ id: "file", keys: KEYS, label: "Parts of the claim" })
const fromBuilder = tabSet as unknown as {
  list: Record<string, unknown>
  item?: Record<string, unknown>
  tabs: Record<string, unknown>[]
  panels: Record<string, unknown>[]
  headings: Record<string, unknown>[]
}
const FROM_BUILDER = `
  <lt-tabs>
    <ul ${attr(fromBuilder.list)}>
      ${fromBuilder.tabs.map((t, i) => `<li ${attr(fromBuilder.item ?? {})}><a ${attr(t)}>${NAMES[i]}</a></li>`).join("")}
    </ul>
    ${fromBuilder.panels.map((p, i) => `<section ${attr(p)}><h2 ${attr(fromBuilder.headings[i])}>${NAMES[i]}</h2><p>The contents of ${NAMES[i].toLowerCase()}.</p></section>`).join("")}
  </lt-tabs>`

const SOURCES = { "written by hand": HANDWRITTEN, "lt.tabs()": FROM_BUILDER }

function pageFor(markup: string, style = css): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Without JavaScript</title>
<style>${style}</style></head><body><main><h1>The claim</h1>${markup}</main></body></html>`
}

function markupFor(source: string): string {
  return SOURCES[source as keyof typeof SOURCES]
}

const failures: string[] = []

async function check(engine: string, page: Page, source: string) {
  const report = (requirement: string, text: string) =>
    failures.push(`${engine}, ${source}: ${requirement} ${text}`)

  // Without this, everything below could pass on a page where the scripts ran.
  const precondition = await page.evaluate(() => ({
    withoutScripts: matchMedia("(scripting: none)").matches,
    defined: customElements.get("lt-tabs") !== undefined,
  }))
  if (!precondition.withoutScripts || precondition.defined) {
    report(
      "precondition",
      "the page ran with JavaScript, so nothing has been tested.",
    )
    return
  }

  // A1: every panel is shown, with heading and content.
  const panels = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".lt-tabs__panel")].map((p) => ({
      id: p.id,
      visible: p.checkVisibility(),
      top: p.getBoundingClientRect().top,
      height: p.getBoundingClientRect().height,
      text: (p.querySelector("p") as HTMLElement).checkVisibility(),
    })),
  )
  if (panels.length !== NAMES.length)
    report("A1", `found ${panels.length} panels, expected ${NAMES.length}.`)
  for (const p of panels)
    if (!p.visible || p.height === 0 || !p.text)
      report("A1", `the panel "${p.id}" is not shown without JavaScript.`)
  // In order: every panel below the previous one, in the order of the links.
  const order = panels.map((p) => p.id.replace(/^file-/, "")).join(" ")
  if (order !== KEYS.join(" "))
    report(
      "A1",
      `the panels are in the order ${order}, expected ${KEYS.join(" ")}.`,
    )
  for (let i = 1; i < panels.length; i++)
    if (panels[i].top <= panels[i - 1].top)
      report(
        "A1",
        `the panel "${panels[i].id}" is not below "${panels[i - 1].id}".`,
      )

  // A2: a plain list of links, without the tab role and without anything
  // that takes the links out of the Tab order.
  const tabList = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        "lt-tabs [role], lt-tabs [aria-selected], lt-tabs [tabindex], lt-tabs [aria-controls]",
      ),
    ].map((e) => e.outerHTML.slice(0, 80)),
  )
  for (const e of tabList)
    report(
      "A2",
      `the markup says something it does not do without JavaScript: ${e}`,
    )

  // WebKit on macOS skips links on Tab, as Safari does. Alt+Tab is the key
  // that goes to links there.
  const key = engine === "webkit" ? "Alt+Tab" : "Tab"
  await page.evaluate(() =>
    (document.activeElement as HTMLElement | null)?.blur(),
  )
  const visited: string[] = []
  // As many presses as there are links. One more takes focus out of the page
  // and into the browser, and then it is no longer the page that answers.
  for (let i = 0; i < NAMES.length; i++) {
    await page.keyboard.press(key)
    const href = await page.evaluate(() =>
      document.activeElement?.closest(".lt-tabs__list")
        ? document.activeElement.getAttribute("href")
        : null,
    )
    if (href) visited.push(href)
  }
  const expected = KEYS.map((n) =>
    source === "lt.tabs()" ? `#file-${n}` : `#${n}`,
  )
  if (visited.join(" ") !== expected.join(" "))
    report(
      "A2",
      `Tab reached ${visited.join(", ") || "no links"}, expected ${expected.join(", ")}.`,
    )

  // A8: none of the panels becomes a landmark.
  const landmarks = await page.evaluate(() =>
    [...document.querySelectorAll(".lt-tabs__panel")]
      .filter(
        (p) =>
          p.hasAttribute("role") ||
          p.hasAttribute("aria-label") ||
          p.hasAttribute("aria-labelledby"),
      )
      .map((p) => p.id),
  )
  for (const id of landmarks)
    report(
      "A8",
      `the panel "${id}" has a name or a role, and becomes a landmark without JavaScript.`,
    )
}

/*
 * A3: axe, with contrast. `axe.run` waits on timers and promises, and they
 * do not run in a page without JavaScript. The page has no scripts, so the
 * only difference between the two contexts is the `scripting` media
 * feature. It is rewritten in the stylesheet, so axe sees the same style as
 * the reader without JavaScript.
 */
const cssWithoutScripts = css
  .replaceAll("(scripting: enabled)", "not all")
  .replaceAll("(scripting: none)", "all")
if (cssWithoutScripts === css || !css.includes("(scripting: enabled)"))
  throw new Error(
    "Did not find `scripting` in the stylesheet. Fix the rewrite above.",
  )

async function axe(engine: string, page: Page, source: string) {
  await page.setContent(pageFor(markupFor(source), cssWithoutScripts))
  await page.evaluate(axeSource)
  const violations = (await page.evaluate(async () => {
    const result = await (
      window as unknown as {
        axe: {
          run: (
            k: unknown,
            o: unknown,
          ) => Promise<{
            violations: { id: string; nodes: { target: string[] }[] }[]
          }>
        }
      }
    ).axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
      },
    })
    return result.violations.map(
      (v) => `${v.id} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`,
    )
  })) as string[]
  for (const v of violations)
    failures.push(`${engine}, ${source}: A3 axe: ${v}`)
}

for (const [engine, type] of Object.entries({ chromium, firefox, webkit })) {
  let browser: Browser | undefined
  try {
    browser = await type.launch()
    for (const [source, markup] of Object.entries(SOURCES)) {
      const context = await browser.newContext({ javaScriptEnabled: false })
      const page = await context.newPage()
      await page.setContent(pageFor(markup))
      await check(engine, page, source)
      await context.close()

      const withScripts = await browser.newContext()
      await axe(engine, await withScripts.newPage(), source)
      await withScripts.close()
    }
  } finally {
    await browser?.close()
  }
}

if (failures.length > 0) {
  console.error(`✗ The tabs without JavaScript, ${failures.length} failures:`)
  for (const f of failures) console.error(`  ${f}`)
  process.exit(1)
}
console.log(
  `✓ The tabs without JavaScript: ${Object.keys(SOURCES).length} sources in three engines, requirements A1, A2, A3 and A8.`,
)
