/**
 * The built site, served and opened in a browser, for the checks that read
 * it: check-patterns and check-component-demos open the pages they need with
 * `site()`, check-accessibility and check-mobile go through every page with
 * `everyPage()`.
 *
 * Each of the four had its own server, its own port and its own way of
 * counting, and the eight mistakes in "A guard must claim that it did work"
 * in CLAUDE.md were all in that code: a page that answered 404 counted as
 * visited, the expected number came from the same glob as the queue, and a
 * run that read nothing could pass. Here it is written once.
 *
 * Run with: bun scripts/site.ts, which tests the module against a small site
 * of its own.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium, type Page } from "playwright"

/** The built site. */
export const DIST = fileURLToPath(new URL("../dist/", import.meta.url))

const MEDIA_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  json: "application/json",
  svg: "image/svg+xml",
  webp: "image/webp",
  png: "image/png",
  woff2: "font/woff2",
  xml: "application/xml",
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
}

/*
 * The server binds 127.0.0.1, on a port the system picks, and the browser
 * connects to the same address.
 *
 * `Bun.serve` without a hostname binds the IPv4 wildcard, and a foreign
 * process on IPv6 loopback then takes the port without anything throwing.
 * `localhost` resolves IPv6 first on macOS, so the check talked to the other
 * process: a completely different website was on 4173, and the check read
 * accessibility violations on it. It could just as well have reported green
 * without having seen a single one of our pages. Never change this back to
 * `localhost`. Port 0 also leaves no fixed number to collide or to land on
 * the Fetch standard's bad-ports list.
 */
function serve(dist: string) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = decodeURIComponent(new URL(request.url).pathname)
      const filePath = path.endsWith("/")
        ? join(dist, path, "index.html")
        : join(dist, path)
      const file = Bun.file(filePath)
      const extension = filePath.split(".").pop() ?? ""
      return file.exists().then((exists) =>
        exists
          ? new Response(file, {
              headers: {
                "content-type":
                  MEDIA_TYPES[extension] ?? "application/octet-stream",
              },
            })
          : new Response("Not found", { status: 404 }),
      )
    },
  })
}

/**
 * A quiet console on every page: a warning, an error or an uncaught error is
 * a finding, named after the page it came from. Our own components say so
 * in the console when markup is broken, so a warning on one of our pages is
 * a bug in that page.
 */
function listen(page: Page, findings: string[], where: () => string) {
  page.on("console", (message) => {
    const type = message.type()
    if (type === "warning" || type === "error")
      findings.push(
        `${where()}: console.${type === "warning" ? "warn" : "error"}: ${message.text()}`,
      )
  })
  page.on("pageerror", (error) =>
    findings.push(`${where()}: uncaught: ${error.message}`),
  )
}

export interface Site {
  /** The one page `open` navigates, for helpers that work on it. */
  page: Page
  /** Opens a path of the site, and records a finding if it does not answer 200. */
  open(path: string): Promise<Page>
  /** Records a finding of the script's own. */
  fail(message: string): void
  /** Writes the report, closes everything, and gives the exit code. */
  close(): Promise<number>
}

export async function site({
  dist = DIST,
}: {
  dist?: string
} = {}): Promise<Site> {
  const server = serve(dist)
  const browser = await chromium.launch()
  const page = await (await browser.newContext()).newPage()
  const findings: string[] = []
  const unanswered: string[] = []
  let opened = 0
  let current = "(no page yet)"
  listen(page, findings, () => current)
  return {
    page,
    async open(path) {
      current = path
      const response = await page.goto(
        `http://127.0.0.1:${server.port}${path}`,
        { waitUntil: "networkidle" },
      )
      if (response?.status() !== 200)
        unanswered.push(`${path} answered ${response?.status() ?? "nothing"}`)
      else opened += 1
      return page
    },
    fail(message) {
      findings.push(message)
    },
    async close() {
      await browser.close()
      server.stop(true)
      for (const f of findings) console.error(`  - ${f}`)
      for (const u of unanswered) console.error(`  - ${u}`)
      console.log(`Opened ${opened} pages of the site.`)
      // An incomplete run is told apart from findings: it says the check did
      // not see what it was meant to.
      if (unanswered.length > 0 || opened === 0) return 2
      return findings.length > 0 ? 1 : 0
    },
  }
}

/**
 * The pages the site should have, from the sitemap Astro writes and the 404
 * page, which no sitemap lists. It is the number the run is held to, read
 * from somewhere other than the glob that fills the queue: a guard that
 * compares the queue with itself only checks itself.
 */
function expectedPages(dist: string): string[] {
  const sitemap = readFileSync(join(dist, "sitemap-0.xml"), "utf8")
  return [
    ...[...sitemap.matchAll(/<loc>https?:\/\/[^/]+(\/[^<]*)<\/loc>/g)]
      .map((m) => m[1])
      .filter((path) => path.endsWith("/")),
    "/404.html",
  ].sort()
}

/** Every HTML file in the site, as the path the browser asks for. */
function pagesIn(dist: string): string[] {
  return [...new Bun.Glob("**/*.html").scanSync(dist)]
    .map((file) =>
      file === "index.html"
        ? "/"
        : file.endsWith("/index.html")
          ? `/${file.slice(0, -"index.html".length)}`
          : `/${file}`,
    )
    .sort()
}

/**
 * Goes through every page of the site, `parallel` at a time, and gives the
 * exit code: 2 when the run did not see what it should, 1 for findings, 0
 * otherwise. The report is written before the code is given, so an
 * incomplete run still shows what it found.
 */
export async function everyPage({
  dist = DIST,
  parallel,
  themes,
  viewport,
  check,
}: {
  dist?: string
  /** Pages open at once, per theme. */
  parallel: number
  /** Each page is checked once per theme, set the way the page itself would. */
  themes?: Array<"light" | "dark">
  viewport?: { width: number; height: number }
  check: (
    page: Page,
    path: string,
    theme?: "light" | "dark",
  ) => Promise<string[]>
}): Promise<number> {
  const queue = pagesIn(dist)
  const expected = expectedPages(dist)
  const missing = expected.filter((p) => !queue.includes(p))
  const server = serve(dist)
  const browser = await chromium.launch()
  const findings: string[] = []
  const unanswered: string[] = []
  let checked = 0
  const runs = themes ?? [undefined]
  await Promise.all(
    runs.map(async (theme) => {
      const work = [...queue]
      /*
       * One context per theme, shared by its pages, not one per page. A
       * context has its own cache, and with one each the CSS and the scripts
       * were parsed again for every page: CPU time went from 64 to 202
       * seconds in check-accessibility. Starlight writes the theme to
       * `localStorage`, which a context shares, so a context never sees more
       * than one theme.
       */
      const context = await browser.newContext({ viewport, colorScheme: theme })
      await Promise.all(
        Array.from({ length: parallel }, async () => {
          const page = await context.newPage()
          let current = "(no page yet)"
          listen(page, findings, () => current)
          for (let path = work.shift(); path; path = work.shift()) {
            current = theme ? `${path} (${theme})` : path
            /*
             * The scheme is set BEFORE the navigation, so the page itself
             * works its way to the theme.
             *
             * Starlight sets `data-theme` itself, from `localStorage` and
             * otherwise from `prefers-color-scheme`, while the page loads.
             * Set only afterwards, the two raced: the link colour on
             * `/tailwind/` landed on the light value in half the loads, and
             * the accessibility check failed at random on contrast.
             */
            if (theme) await page.emulateMedia({ colorScheme: theme })
            /*
             * The status code must be read. `goto` does not throw on 404, and
             * a page that was not served would have counted as visited: axe
             * finds nothing on a line of plain text. The 404 page answers 404
             * by its nature.
             */
            const response = await page.goto(
              `http://127.0.0.1:${server.port}${path}`,
              { waitUntil: "networkidle" },
            )
            const wanted = path === "/404.html" ? [200, 404] : [200]
            if (!wanted.includes(response?.status() ?? 0)) {
              unanswered.push(
                `${current} answered ${response?.status() ?? "nothing"}`,
              )
              continue
            }
            if (theme) {
              /*
               * Transitions are switched off BEFORE the theme is set, not
               * after. A transition already running does not stop because
               * `transition` is set to `none`, it stays where it was, and axe
               * read the link colour on `/tailwind/` at nine different values
               * in forty loads. With the rule first, no transition starts.
               * Then `data-theme` is set as a safeguard.
               */
              await page.addStyleTag({
                content: `*, *::before, *::after {
                  transition: none !important;
                  animation: none !important;
                }`,
              })
              await page.evaluate(
                (t) => document.documentElement.setAttribute("data-theme", t),
                theme,
              )
            }
            for (const f of await check(page, path, theme))
              findings.push(`${current}: ${f}`)
            // Counted last, from what was checked.
            checked += 1
          }
        }),
      )
    }),
  )
  await browser.close()
  server.stop(true)

  // Sorted, since the pages finish in no fixed order, so two runs of the
  // same failure read the same.
  for (const f of findings.sort()) console.error(`  - ${f}`)
  for (const u of unanswered.sort()) console.error(`  - ${u}`)
  for (const m of missing)
    console.error(`  - ${m} is in the sitemap, but not in the site`)
  const views = expected.length * runs.length
  console.log(
    `Checked ${checked} page views, where the sitemap and the 404 page make ${expected.length} pages${themes ? ` in ${themes.length} themes` : ""}.`,
  )
  if (
    checked === 0 ||
    checked !== views ||
    missing.length > 0 ||
    unanswered.length > 0
  )
    return 2
  return findings.length > 0 ? 1 : 0
}

/**
 * A count from the environment, such as how many pages are open at once.
 * `0` or `abc` gave `Array.from({ length: NaN })`, that is, no workers and a
 * green run that looked at nothing, so anything but a whole number above
 * zero stops the run.
 */
export function readCount(
  name: string,
  fallback: number,
  env: Record<string, string | undefined> = process.env,
): number {
  const value = env[name]
  if (value === undefined) return fallback
  if (!/^[1-9]\d*$/.test(value))
    throw new Error(`${name} is "${value}": write a whole number above zero`)
  return Number(value)
}

/**
 * The module, fed a site written for the purpose every time it runs. The
 * answers are written out.
 */
export async function selfTest(): Promise<string[]> {
  const { mkdirSync, mkdtempSync, writeFileSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const broken: string[] = []
  const expect = (name: string, actual: unknown, wanted: unknown) => {
    if (JSON.stringify(actual) !== JSON.stringify(wanted))
      broken.push(
        `${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(wanted)}`,
      )
  }
  const dist = mkdtempSync(join(tmpdir(), "lotek-site-"))
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>a</title>")
  const page = (name: string, body: string) => {
    mkdirSync(join(dist, name), { recursive: true })
    writeFileSync(
      join(dist, name, "index.html"),
      `<!doctype html><title>${name}</title>${body}`,
    )
  }
  page("warns", "<script>console.warn('the markup is broken')</script>")
  page("throws", "<script>throw new Error('the script is broken')</script>")

  {
    const s = await site({ dist })
    await s.open("/missing/")
    expect(
      "a page that does not answer 200 makes the run incomplete",
      await s.close(),
      2,
    )
  }

  {
    const s = await site({ dist })
    await s.open("/warns/")
    expect("a page that warns in the console is a finding", await s.close(), 1)
  }

  {
    const s = await site({ dist })
    await s.open("/throws/")
    expect("an uncaught error on a page is a finding", await s.close(), 1)
  }

  const refused = (value: string) => {
    try {
      readCount("LOTEK_SITE_TEST", 2, { LOTEK_SITE_TEST: value })
      return "read"
    } catch (error) {
      return String(error)
    }
  }
  expect(
    "a count from the environment is a whole number above zero, or the run stops",
    [
      readCount("LOTEK_SITE_TEST", 2, {}),
      readCount("LOTEK_SITE_TEST", 2, { LOTEK_SITE_TEST: "5" }),
      refused("0"),
      refused("-1"),
      refused("abc"),
      refused("2.5"),
    ],
    [
      2,
      5,
      'Error: LOTEK_SITE_TEST is "0": write a whole number above zero',
      'Error: LOTEK_SITE_TEST is "-1": write a whole number above zero',
      'Error: LOTEK_SITE_TEST is "abc": write a whole number above zero',
      'Error: LOTEK_SITE_TEST is "2.5": write a whole number above zero',
    ],
  )

  // A small site with a sitemap, as Astro writes it, and a 404 page.
  const small = (sitemap: string[], pages: Record<string, string>) => {
    const root = mkdtempSync(join(tmpdir(), "lotek-every-"))
    for (const [path, body] of Object.entries(pages)) {
      mkdirSync(join(root, path), { recursive: true })
      writeFileSync(
        join(root, path, path.endsWith(".html") ? "" : "index.html"),
        `<!doctype html><title>${path}</title>${body}`,
      )
    }
    writeFileSync(join(root, "404.html"), "<!doctype html><title>404</title>")
    writeFileSync(
      join(root, "sitemap-0.xml"),
      `<urlset>${sitemap.map((p) => `<url><loc>https://lo-tek.sobernetics.no${p}</loc></url>`).join("")}</urlset>`,
    )
    return root
  }
  const quiet = small(["/", "/a/"], { "": "", a: "" })
  expect(
    "a site where every page is checked and nothing is found",
    await everyPage({ dist: quiet, parallel: 1, check: async () => [] }),
    0,
  )
  expect(
    "a finding from the script's check",
    await everyPage({
      dist: quiet,
      parallel: 1,
      check: async (_page, path) => (path === "/a/" ? ["too wide"] : []),
    }),
    1,
  )
  expect(
    "a page the sitemap has and the site does not makes the run incomplete",
    await everyPage({
      dist: small(["/", "/a/", "/gone/"], { "": "", a: "" }),
      parallel: 1,
      check: async () => [],
    }),
    2,
  )

  // The page notes the scheme it had while it loaded, as Starlight does when
  // it picks the theme.
  const themed = small(["/"], {
    "": "<script>document.title = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'</script>",
  })
  const seen: string[] = []
  expect(
    "each theme is set before the navigation, and the page is checked once per theme",
    await everyPage({
      dist: themed,
      parallel: 1,
      themes: ["light", "dark"],
      check: async (page, path) => {
        if (path === "/")
          seen.push(
            `${await page.title()} ${await page.evaluate(() => document.documentElement.dataset.theme)}`,
          )
        return []
      },
    }),
    0,
  )
  const contexts = new Set<unknown>()
  await everyPage({
    dist: small(["/", "/a/", "/b/"], { "": "", a: "", b: "" }),
    parallel: 3,
    themes: ["light", "dark"],
    check: async (page) => {
      contexts.add(page.context())
      return []
    },
  })
  expect(
    "the pages of one theme share a context, and its cache: one context per page parsed the CSS again for every page",
    contexts.size,
    2,
  )
  expect("what each theme's check saw", seen.sort(), [
    "dark dark",
    "light light",
  ])

  return broken
}

if (import.meta.main) {
  const broken = await selfTest()
  if (broken.length > 0) {
    console.error(
      `site.ts answers wrong:\n${broken.map((b) => `  - ${b}`).join("\n")}`,
    )
    process.exit(1)
  }
  console.log("site.ts answers every case")
}
