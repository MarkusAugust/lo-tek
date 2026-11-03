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

/** The HTML blocks of the "Plain HTML" tab on a page, or none. */
function plainHtml(page: string): string[] {
  const tab = tabItems(page).find((t) => t.name === "Plain HTML")
  return tab ? htmlBlocks(tab.code) : []
}

const pages = Object.entries(PAGES).map(([path, text]) => ({
  name: path.replace(/^.*\/(.+)\.mdx$/, "$1"),
  text,
  blocks: plainHtml(text),
}))

/**
 * The pages with a script in the "Plain HTML" tab, found by plain string
 * search rather than by `tabItems`, so a tab that reader missed is a page
 * the test reports as missing.
 */
const expected = pages
  .filter((p) => {
    const start = p.text.indexOf('label="Plain HTML"')
    if (start < 0) return false
    const end = p.text.indexOf("</TabItem>", start)
    return p.text.slice(start, end < 0 ? undefined : end).includes("<script")
  })
  .map((p) => p.name)
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
    expect(withScripts.map((p) => p.name).sort()).toEqual(expected)
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
