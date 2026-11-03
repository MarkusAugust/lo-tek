/**
 * That the scripts in the "Plain HTML" recipes run as the reader pastes them.
 *
 * `check-recipes.ts` reads the pages as text, and the Kotlin comparison
 * requires the same scripts in both tabs, but neither runs one. A recipe
 * whose script throws, warns, loads a module that does not exist or takes
 * over every form on the page passed them all: the connection status once
 * called `preventDefault()` on every `submit`, and then a `<form
 * method="dialog">` anywhere on the page no longer closed its dialog.
 *
 * Each recipe runs in an iframe of its own, with the addresses on the CDN
 * pointed at the source, and the dialog recipe next to it. Every
 * `console.error`, `console.warn`, uncaught error, rejected promise and
 * failed load is a finding, and the dialog must still open and close with the
 * button the reader presses.
 */
import { describe, expect, it } from "vitest"
import { CDN, htmlBlocks, tabItems } from "./testing/recipes"

const PAGES = import.meta.glob<string>(
  "../../documentation/src/content/docs/components/*.mdx",
  { query: "?raw", import: "default", eager: true },
)

/** The HTML blocks of every "Plain HTML" tab on a page, or none. */
function plainHtml(page: string): string[] {
  return tabItems(page)
    .filter((t) => t.name === "Plain HTML")
    .flatMap((t) => htmlBlocks(t.code))
}

const pages = Object.entries(PAGES).map(([path, text]) => ({
  name: path.replace(/^.*\/(.+)\.mdx$/, "$1"),
  text,
  blocks: plainHtml(text),
}))

/**
 * The scripts in every "Plain HTML" tab, counted by plain string search
 * rather than by `tabItems`, so a tab or a script that reader missed is one
 * the test reports as missing.
 */
function scriptsInPlainHtml(text: string): number {
  let count = 0
  for (let start = text.indexOf('label="Plain HTML"'); start >= 0; ) {
    const end = text.indexOf("</TabItem>", start)
    count +=
      text.slice(start, end < 0 ? undefined : end).split("<script").length - 1
    start = text.indexOf('label="Plain HTML"', start + 1)
  }
  return count
}
const expected = pages
  .filter((p) => scriptsInPlainHtml(p.text) > 0)
  .map((p) => `${p.name}: ${scriptsInPlainHtml(p.text)}`)
  .sort()

const withScripts = pages.filter((p) =>
  p.blocks.some((b) => b.includes("<script")),
)

const dialogPage = pages.find((p) => p.name === "dialog")
if (!dialogPage) throw new Error("found no dialog page")
const DIALOG = dialogPage.blocks.find((b) => b.includes('id="confirm"'))
if (!DIALOG)
  throw new Error(
    'the dialog page has no Plain HTML recipe with id="confirm" to put next to the others',
  )

/** The package on the CDN, as the source the dev server builds. */
function local(block: string): string {
  const cdn = CDN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return (
    block
      // The stylesheets do nothing for the scripts, and are left out.
      .replace(/<link\b[^>]*>/g, "")
      .replace(new RegExp(`${cdn}dist/([^"']+)\\.js`, "g"), "/src/$1.ts")
  )
}

/** Writes down everything that goes wrong in the frame, before any recipe runs. */
const WATCH = `<script>
  window.problems = []
  for (const level of ["error", "warn"]) {
    const original = console[level]
    console[level] = (...args) => {
      problems.push(level + ": " + args.map(String).join(" "))
      original.apply(console, args)
    }
  }
  addEventListener("error", (event) => {
    const target = event.target
    problems.push(
      target instanceof HTMLScriptElement || target instanceof HTMLLinkElement
        ? "failed to load " + (target.src || target.href || "an inline script")
        : "error: " + event.message,
    )
  }, true)
  addEventListener("unhandledrejection", (event) => {
    problems.push("rejection: " + event.reason)
  })
</script>`

type Frame = Window & { problems: string[] }

/** The recipe in a frame of its own, once its scripts have run and the page has settled. */
async function mount(blocks: string[]): Promise<HTMLIFrameElement> {
  const frame = document.createElement("iframe")
  frame.srcdoc = `<!doctype html><html lang="en"><head>${WATCH}</head><body>${blocks.map(local).join("\n")}</body></html>`
  const loaded = new Promise((resolve) =>
    frame.addEventListener("load", resolve, { once: true }),
  )
  document.body.append(frame)
  await loaded
  // The module scripts have run by `load`. The components report broken markup
  // two frames after `DOMContentLoaded` (`whenSettled`), so four frames here.
  const view = frame.contentWindow as Window
  for (let i = 0; i < 4; i++)
    await new Promise((resolve) => view.requestAnimationFrame(resolve))
  return frame
}

describe("the scripts in the Plain HTML recipes", () => {
  it("finds every page with a script", () => {
    const counted = withScripts.map(
      (p) => `${p.name}: ${p.blocks.join("").split("<script").length - 1}`,
    )
    expect(counted.sort()).toEqual(expected)
    expect(expected.length).toBeGreaterThan(0)
  })

  for (const page of withScripts)
    it(`${page.name}: runs without a word in the console, and leaves the dialog working`, async () => {
      const blocks =
        page.name === "dialog" ? page.blocks : [...page.blocks, DIALOG]
      const frame = await mount(blocks)
      const view = frame.contentWindow as Frame
      const doc = frame.contentDocument as Document
      try {
        const dialog = doc.getElementById("confirm") as HTMLDialogElement
        const opener = doc.getElementById("open-confirm") as HTMLButtonElement
        opener.click()
        expect(dialog.open, "the button did not open the dialog").toBe(true)
        const closed = new Promise((resolve) =>
          dialog.addEventListener("close", resolve, { once: true }),
        )
        const keep = dialog.querySelector<HTMLButtonElement>(
          'form[method="dialog"] button[value="keep"]',
        )
        if (!keep)
          throw new Error("the dialog recipe has no button that keeps the job")
        keep.click()
        // A form that something took over never closes the dialog, and the
        // wait must end with that said, not with the test's timeout.
        await Promise.race([
          closed,
          new Promise((resolve) => setTimeout(resolve, 2000)),
        ])
        expect(dialog.open, "the form did not close the dialog").toBe(false)
        expect(dialog.returnValue).toBe("keep")
        expect(view.problems).toEqual([])
        // The rewritten imports ran: every web component on the page is registered.
        const unregistered = [...doc.querySelectorAll("*")]
          .filter((el) => el.localName.startsWith("lt-"))
          .filter((el) => !view.customElements.get(el.localName))
          .map((el) => el.localName)
        expect(unregistered, "web components without a registration").toEqual(
          [],
        )
      } finally {
        frame.remove()
      }
    })
})

/**
 * The connection status recipe's `saveRoute`, with `fetch` answered by the
 * test: what the bar says for each answer, and that the save never waits for
 * the report, which waits for the registration.
 */
describe("saveRoute in the connection status recipe", () => {
  const page = pages.find((p) => p.name === "connection-status")
  if (!page) throw new Error("found no connection status page")
  /** What the recipe calls: `fetch(url, init)`, answered by the test. */
  type Answer = (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>
  type Saving = Omit<Frame, "fetch"> & {
    saveRoute: (body: unknown) => Promise<Response | undefined>
    fetch: Answer
  }
  const answer =
    (status: number | "none"): Answer =>
    () =>
      status === "none"
        ? Promise.reject(new TypeError("Failed to fetch"))
        : Promise.resolve(new Response(null, { status }))

  it("says offline for no answer and for a gateway's 502, 503 and 504, and online for any other", async () => {
    const frame = await mount(page.blocks)
    const view = frame.contentWindow as Saving
    const doc = frame.contentDocument as Document
    try {
      const said: string[] = []
      for (const status of [
        "none",
        200,
        503,
        400,
        502,
        201,
        504,
        500,
      ] as const) {
        view.fetch = answer(status)
        const response = await view.saveRoute("body")
        expect(response?.status, `the answer ${status}`).toBe(
          status === "none" ? undefined : status,
        )
        await new Promise((resolve) => view.requestAnimationFrame(resolve))
        said.push(
          `${status}: ${doc.querySelector<HTMLElement>(".lt-connection-status__bar")?.dataset.state}`,
        )
      }
      expect(said).toEqual([
        "none: offline",
        "200: online",
        "503: offline",
        "400: online",
        "502: offline",
        "201: online",
        "504: offline",
        "500: online",
      ])
      expect(view.problems).toEqual([])
    } finally {
      frame.remove()
    }
  })

  it("returns the answer before the component is registered", async () => {
    // The recipe without the script that registers the component.
    const unregistered = page.blocks.map((b) =>
      b.replace(
        /<script\b[^>]*>(?:(?!<\/script>)[\s\S])*defineLtConnectionStatus\(\)[\s\S]*?<\/script>/,
        "",
      ),
    )
    expect(unregistered.join("")).not.toContain("defineLtConnectionStatus()")
    const frame = await mount(unregistered)
    const view = frame.contentWindow as Saving
    try {
      expect(view.customElements.get("lt-connection-status")).toBeUndefined()
      view.fetch = answer(200)
      const saved = await Promise.race([
        view.saveRoute("body").then((r) => r?.status),
        new Promise((resolve) =>
          setTimeout(() => resolve("still waiting"), 500),
        ),
      ])
      expect(saved).toBe(200)
    } finally {
      frame.remove()
    }
  })
})
