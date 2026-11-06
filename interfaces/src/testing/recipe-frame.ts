/**
 * A recipe from a component page in an iframe of its own, as the reader
 * pastes it: the addresses on the CDN pointed at the source, and everything
 * that goes wrong in the frame written down before any recipe runs.
 *
 * `recipe-scripts.browser.test.ts` runs the "Plain HTML" tabs in it and
 * `datastar-recipes.browser.test.ts` the "Datastar" tabs, so the two read
 * the console the same way.
 */
import { CDN } from "./recipes"

/** The vendored Datastar, served by the dev server. */
const DATASTAR_SOURCE = "/src/testing/datastar/datastar-v1.0.4.js"

/** Datastar on the CDN, as the Datastar tabs load it. */
export const DATASTAR_CDN =
  /https:\/\/cdn\.jsdelivr\.net\/gh\/starfederation\/datastar@v1\.0\.4\/bundles\/datastar\.js/g

/** The package on the CDN as the source the dev server builds, and Datastar as the vendored copy. */
export function local(block: string): string {
  const cdn = CDN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return (
    block
      // The stylesheets do nothing for the scripts, and are left out.
      .replace(/<link\b[^>]*>/g, "")
      .replace(new RegExp(`${cdn}dist/([^"']+)\\.js`, "g"), "/src/$1.ts")
      .replace(DATASTAR_CDN, DATASTAR_SOURCE)
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

export type Frame = Window & { problems: string[] }

/**
 * Notes where the page tries to go in `left`, and stays. A frame that
 * navigates is lost to the test: Firefox gives no `load` for the new page,
 * and reading the frame after it throws a `SecurityError`.
 */
export const STAY = `<script>
  window.left = null
  navigation.addEventListener("navigate", (event) => {
    // A link to a fragment, and the address the tabs write with
    // \`replaceState\`, stay on the page.
    if (event.destination.sameDocument) return
    left = new URL(event.destination.url).pathname
    event.preventDefault()
  })
</script>`

export type Staying = Frame & { left: string | null }

/** Where the frame tried to go within `ms`, or "stayed". */
export async function wentTo(view: Staying, ms: number): Promise<string> {
  for (let waited = 0; waited < ms && view.left === null; waited += 20)
    await new Promise((resolve) => setTimeout(resolve, 20))
  return view.left ?? "stayed"
}

/**
 * The recipe in a frame of its own, once its scripts have run and the page
 * has settled. `head` goes in after the watch, before any recipe.
 */
export async function mount(
  blocks: string[],
  head = "",
): Promise<HTMLIFrameElement> {
  const frame = document.createElement("iframe")
  frame.srcdoc = `<!doctype html><html lang="en"><head>${WATCH}${head}</head><body>${blocks.map(local).join("\n")}</body></html>`
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

/** The `<lt-*>` elements in the frame that have no registration. */
export function unregistered(frame: HTMLIFrameElement): string[] {
  const view = frame.contentWindow as Window
  const doc = frame.contentDocument as Document
  return [...doc.querySelectorAll("*")]
    .filter((el) => el.localName.startsWith("lt-"))
    .filter((el) => !view.customElements.get(el.localName))
    .map((el) => el.localName)
}
