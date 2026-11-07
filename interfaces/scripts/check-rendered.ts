/**
 * Tests `diagnoseRendered` against a real browser: the page as Chromium has
 * rendered it, with the stylesheets it has loaded.
 *
 * The pages are served from one port and the stylesheet from another, like a
 * CDN, so both a stylesheet the CSSOM can read and one that has to be fetched
 * again are tested.
 *
 * The script that reads the page also exists in LO-TEK for Kotlin, as text,
 * since that package does not depend on Playwright. It runs here too, and has
 * to give the same answer.
 *
 * Finally every built page of the documentation goes through `diagnosePage`,
 * and every preview on it through `diagnoseMarkup`, and all of it has to give
 * zero findings. That is the guard against false findings: a rule that fires
 * on our own recipes fails the build here, before it reaches an editor. The
 * page in page mode and not markup mode: markup mode reads the code examples
 * in Expressive Code's `data-code` as markup, while `pageSource` in the core
 * blanks them. But `pageSource` also blanks `<template shadowrootmode>`,
 * where the previews are, so those are read on their own, as the markup they
 * are. The one class of the documentation's own, `lt-preview`, is exempt by
 * name.
 *
 * Run with: bun scripts/check-rendered.ts (after bun run build)
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import {
  diagnoseMarkup,
  diagnosePage,
  diagnoseRendered,
  READ_RENDERED_PAGE,
} from "../src/diagnostics/index.js"

const pkg = fileURLToPath(new URL("..", import.meta.url))
const lotekCss = readFileSync(join(pkg, "dist/lotek.css"), "utf8")

// Both bind 127.0.0.1, as the page checks do: without a hostname the URL is
// localhost, which macOS resolves to IPv6 first, where another process may
// answer on the same port.
const cdn = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: () =>
    new Response(lotekCss, {
      headers: {
        "content-type": "text/css",
        "access-control-allow-origin": "*",
      },
    }),
})

const page = (head: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Test</title>${head}</head><body>${body}</body></html>`

const buttons =
  '<button class="lt-button" type="button" data-variant="ghost">Save</button><div class="lt-card">Card</div>'

const pages: Record<string, string> = {
  "/with-stylesheet": page(
    '<link rel="stylesheet" href="/lotek.css">',
    buttons,
  ),
  "/without-stylesheet": page("", buttons),
  // From another origin, without crossorigin: the CSSOM cannot read it.
  "/from-cdn": page(
    `<link rel="stylesheet" href="${cdn.url}lotek.css">`,
    buttons,
  ),
  // A class set by a script, after the server sent the page.
  "/script": page(
    '<link rel="stylesheet" href="/lotek.css">',
    '<div id="x">Card</div><script>document.getElementById("x").className = "lt-not-a-class"</script>',
  ),
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname
    if (path === "/lotek.css")
      return new Response(lotekCss, {
        headers: { "content-type": "text/css" },
      })
    const html = pages[path]
    return html
      ? new Response(html, {
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      : new Response("Not found", { status: 404 })
  },
})

const errors: string[] = []
const expect = (claim: boolean, description: string) => {
  if (!claim) errors.push(description)
}

const browser = await chromium.launch()
try {
  const tab = await browser.newPage()
  const findings = async (path: string) => {
    await tab.goto(`${server.url}${path.slice(1)}`)
    return diagnoseRendered(tab)
  }

  const withSheet = await findings("/with-stylesheet")
  expect(
    withSheet.length === 0,
    `the page with the stylesheet gave findings: ${JSON.stringify(withSheet)}`,
  )

  const withoutSheet = await findings("/without-stylesheet")
  expect(
    withoutSheet.filter((f) => f.rule === "unstyled-class").length === 2,
    `the page without a stylesheet should have given two unstyled classes: ${JSON.stringify(withoutSheet.map((f) => f.message))}`,
  )

  const fromCdn = await findings("/from-cdn")
  expect(
    fromCdn.length === 0,
    `the stylesheet from another origin was not read: ${JSON.stringify(fromCdn.map((f) => f.message))}`,
  )

  const script = await findings("/script")
  expect(
    script.some(
      (f) => f.rule === "unknown-class" && f.message.includes("lt-not-a-class"),
    ),
    `the class the script set was not checked: ${JSON.stringify(script.map((f) => f.message))}`,
  )

  // The Kotlin version of the script gives the same as the TypeScript one.
  const kotlin = readFileSync(
    join(pkg, "../kotlin/src/main/kotlin/no/lotek/Lotek.kt"),
    "utf8",
  )
  const kotlinScript = /READ_RENDERED_PAGE: String = """([\s\S]*?)"""/
    .exec(kotlin)?.[1]
    // `${'$'}` is a dollar sign in a Kotlin string.
    ?.replaceAll("$" + "{'$'}", "$")
  expect(
    kotlinScript !== undefined,
    "could not find READ_RENDERED_PAGE in Lotek.kt",
  )
  expect(
    kotlinScript?.startsWith("async () => {") === true &&
      kotlinScript.endsWith("}") &&
      !/^\s*\/\//m.test(kotlinScript),
    "READ_RENDERED_PAGE in Lotek.kt must be just the function, with no whitespace or comments around it",
  )
  for (const path of ["/with-stylesheet", "/from-cdn"]) {
    await tab.goto(`${server.url}${path.slice(1)}`)
    const fromTs = await tab.evaluate(READ_RENDERED_PAGE)
    // Playwright for Java sends the text, and Playwright wraps it in
    // parentheses and calls it. A comment on the last line would then
    // swallow the parenthesis, so the text must be just the function.
    const fromKotlin = await tab.evaluate(`(${kotlinScript})()`)
    expect(
      JSON.stringify(fromTs) === JSON.stringify(fromKotlin),
      `the script in Lotek.kt reads ${path} differently from the one in TypeScript`,
    )
  }
} finally {
  await browser.close()
  server.stop()
  cdn.stop()
}

/*
 * The documentation gives zero findings in page mode.
 *
 * Count the pages last in the loop, and require the number to equal the
 * number of files and be greater than zero: a glob that found nothing must
 * not look like documentation without errors.
 */
const dist = join(pkg, "../documentation/dist")
const files = [...new Bun.Glob("**/*.html").scanSync({ cwd: dist })].sort()
const ownClass = (f: { rule: string; message: string }) =>
  f.rule === "unknown-class" && f.message.includes('"lt-preview"')
let pageCount = 0
let previewCount = 0
for (const file of files) {
  const html = readFileSync(join(dist, file), "utf8")
  for (const f of await diagnosePage(html))
    if (!ownClass(f))
      errors.push(`${file} ${f.line}:${f.column} ${f.rule}: ${f.message}`)
  for (const [, markup] of html.matchAll(
    /<template shadowrootmode="open">([\s\S]*?)<\/template>/g,
  )) {
    for (const f of await diagnoseMarkup(markup))
      if (!ownClass(f))
        errors.push(
          `${file} (preview) ${f.line}:${f.column} ${f.rule}: ${f.message}`,
        )
    previewCount += 1
  }
  pageCount += 1
}
expect(
  pageCount === files.length && pageCount > 0,
  `checked ${pageCount} pages of the documentation, expected ${files.length} and at least one`,
)
expect(
  previewCount > 0,
  "found no previews in the documentation, so the recipes were not read",
)

if (errors.length > 0) {
  console.error(
    `✗ diagnoseRendered:\n\n${errors.map((f) => `  ${f}`).join("\n")}\n`,
  )
  process.exit(1)
}
console.log(
  `diagnoseRendered checks the page as the browser rendered it, with the stylesheets, and ${pageCount} built pages of the documentation give zero findings, with ${previewCount} previews read as markup.`,
)
