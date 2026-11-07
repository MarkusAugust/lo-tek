/**
 * That every "Datastar" recipe runs as the reader pastes it, with real
 * Datastar 1.0.4 and a stubbed server.
 *
 * `check-recipes.ts` reads the Datastar tabs as text, and holds them to the
 * order of the scripts, but nothing ran one. The load order was wrong on
 * eight of them, and only the connection status had a test that would have
 * seen it.
 *
 * Each tab runs in an iframe of its own, with the package pointed at the
 * source and Datastar at the vendored copy. `fetch` in the frame answers every
 * request with a 204, which patches nothing. The test then does what a reader
 * does: clicks every button and link, ticks every box, types in every field,
 * leaves it and submits every form, and a button of the test's own sends
 * a request from elsewhere on the page. Every `console.error`, `console.warn`,
 * uncaught error, rejected promise and failed load is a finding, and the
 * requests that went out must be the ones the tab's `@get`, `@post` and `@put`
 * name.
 */
import { describe, expect, it } from "vitest"
import {
  DATASTAR_CDN,
  type Frame,
  mount,
  STAY,
  type Staying,
  unregistered,
  wentTo,
} from "./testing/recipe-frame"
import { recipePage } from "./testing/recipe-pages"
import { blocks } from "./testing/recipes"

const PAGES = import.meta.glob<string>(
  "../../documentation/src/content/docs/components/*.mdx",
  { query: "?raw", import: "default", eager: true },
)

/*
 * The blocks come from `recipes.json`. The page text is read here only for
 * the count below, which must not go through the same reader.
 */
const pages = Object.entries(PAGES).map(([path, text]) => {
  const name = path.replace(/^.*\/(.+)\.mdx$/, "$1")
  return {
    name,
    text,
    blocks: blocks(recipePage(name), { tab: "Datastar", lang: "html" }),
  }
})

/**
 * The pages with a Datastar tab, counted by plain string search rather than
 * through `recipes.json`, so a tab the reading missed is one the test reports.
 */
const expected = pages
  .filter((p) => p.text.includes('label="Datastar"'))
  .map((p) => p.name)
  .sort()

const withDatastar = pages.filter((p) => p.blocks.length > 0)

/**
 * The server: every request is written down and answered with a 204, which
 * Datastar takes as done and patches nothing from. The probes are answered as
 * a gateway whose server is gone, and as a server that is back.
 */
const SERVER = `<script>
  window.requests = []
  // A real server answers in a later task. Answered in a microtask, a tab
  // that sends a request for every answer never yields, and the browser
  // freezes before any test can fail.
  const later = (response) =>
    new Promise((resolve) => setTimeout(() => resolve(response)))
  window.fetch = (input, init = {}) => {
    const url = new URL(String(input), location.href)
    requests.push((init.method ?? "GET") + " " + url.pathname)
    if (url.pathname === "/probe/gone")
      return later(new Response("", { status: 503 }))
    if (url.pathname === "/probe/back")
      return later(
        new Response("{}", { headers: { "content-type": "application/json" } }),
      )
    return later(new Response(null, { status: 204 }))
  }
</script>`

type Served = Frame & { requests: string[] }

/**
 * Requests from elsewhere on the page, one that fails and one that succeeds.
 * The connection status sends nothing itself, and its expression only runs
 * when another element sends something.
 */
const PROBE = `<button data-on:click="@post('/probe/gone')">Probe</button>
<button data-on:click="@post('/probe/back')">Probe</button>`

/** The requests the tab's actions name, as `METHOD /path`. */
function named(blocks: string[]): string[] {
  return [
    ...blocks.join("\n").matchAll(/@(get|post|put|patch|delete)\('([^'?]+)/g),
  ].map((m) => `${m[1].toUpperCase()} ${m[2]}`)
}

/**
 * Waits until no new request has gone out for 50 ms, and fails when requests
 * are still going out after two seconds: a tab that sends the same request
 * over and over must not pass as one that settled. The timers are the
 * test's, not the frame's.
 */
async function settled(view: Served): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const before = view.requests.length
    await new Promise((resolve) => setTimeout(resolve, 50))
    if (view.requests.length === before) return
  }
  throw new Error(
    `requests were still going out after two seconds: ${view.requests.slice(-3).join(", ")}`,
  )
}

/**
 * The session timeout's warning comes after `warn-at` seconds without
 * activity, 1500 in the recipe. At 0 it comes on the first tick, and the
 * buttons in it are there to press.
 */
function warnNow(block: string): string {
  return block.replace(/\bwarn-at="\d+"/g, 'warn-at="0"')
}

/** Waits until every session warning in the frame is open, or three seconds. */
async function warned(doc: Document): Promise<void> {
  const dialogs = [
    ...doc.querySelectorAll<HTMLDialogElement>("lt-session-timeout dialog"),
  ]
  for (let i = 0; i < 60 && dialogs.some((d) => !d.open); i++)
    await new Promise((resolve) => setTimeout(resolve, 50))
  expect(
    dialogs.every((d) => d.open),
    "the session warning never opened",
  ).toBe(true)
}

/** What a reader does on the page, in document order. */
async function use(frame: HTMLIFrameElement): Promise<void> {
  const view = frame.contentWindow as Served
  const doc = frame.contentDocument as Document
  const body = doc.body
  for (const input of body.querySelectorAll<HTMLInputElement>("input")) {
    input.focus()
    if (input.type === "checkbox" || input.type === "radio") input.click()
    else {
      input.value = "Kestrel"
      input.dispatchEvent(new Event("input", { bubbles: true }))
    }
    input.blur()
  }
  // Past the debounce on the suggestion field.
  await new Promise((resolve) => setTimeout(resolve, 400))
  for (const link of body.querySelectorAll<HTMLAnchorElement>("a[href^='#']"))
    link.click()
  for (const button of body.querySelectorAll<HTMLButtonElement>("button")) {
    // A button that submits to another page would take the frame with it.
    if (button.hasAttribute("formaction")) continue
    button.click()
  }
  // Only a form Datastar takes: any other is submitted to the server by the
  // browser, and the frame would go with it.
  for (const form of body.querySelectorAll<HTMLFormElement>("form"))
    if (
      form.isConnected &&
      [...form.attributes].some((a) => a.name.startsWith("data-on:submit"))
    )
      form.requestSubmit()
  await settled(view)
}

describe("the Datastar recipes", () => {
  it("finds every page with a Datastar tab", () => {
    expect(withDatastar.map((p) => p.name).sort()).toEqual(expected)
    expect(expected.length).toBeGreaterThan(0)
  })

  for (const page of withDatastar)
    it(`${page.name}: runs with Datastar without a word in the console, and sends what it names`, async () => {
      expect(
        page.blocks.join("").match(DATASTAR_CDN),
        "the tab does not load Datastar 1.0.4 from the CDN",
      ).not.toBeNull()
      const frame = await mount(
        [...page.blocks.map(warnNow), PROBE],
        SERVER + STAY,
      )
      const view = frame.contentWindow as Served & Staying
      try {
        // Datastar applies `data-*` from a MutationObserver after it loads.
        await settled(view)
        await warned(frame.contentDocument as Document)
        expect(
          unregistered(frame),
          "web components without a registration",
        ).toEqual([])
        await use(frame)
        // A page that has settled stays quiet. Past Datastar's retry interval
        // of a second, so a poll or a retried request that never ends is
        // seen, not only one faster than the 50 ms in \`settled()\`.
        const sent = view.requests.length
        await new Promise((resolve) => setTimeout(resolve, 1200))
        expect(
          view.requests.slice(sent),
          "requests after the page had settled",
        ).toEqual([])
        expect(view.left, "the page tried to navigate away").toBeNull()
        expect(view.problems).toEqual([])
        // The same request twice is no finding: the form's button and the
        // test both submit it. A tab that never stops sending fails in
        // `settled()`.
        expect([...new Set(view.requests)].sort()).toEqual(
          [
            ...new Set([
              ...named(page.blocks),
              "POST /probe/gone",
              "POST /probe/back",
            ]),
          ].sort(),
        )
      } finally {
        frame.remove()
      }
    })
})

/**
 * The dialog in the Datastar recipe tells the server about every choice the
 * user makes, Escape included. The buttons post their own, and Escape is a
 * close request, which the browser reports with `cancel` on the `<dialog>`
 * and never for a close the server makes. Without it the server went on
 * believing the dialog was open.
 */
describe("the dialog in the Datastar recipe", () => {
  const page = withDatastar.find((p) => p.name === "dialog")
  if (!page) throw new Error("found no Datastar tab on the dialog page")

  it("tells the server the job is kept when the user presses Escape", async () => {
    const frame = await mount(page.blocks, SERVER)
    const view = frame.contentWindow as Served
    const doc = frame.contentDocument as Document
    try {
      await settled(view)
      const dialog = doc.querySelector<HTMLDialogElement>("#confirm dialog")
      if (!dialog) throw new Error("the dialog recipe has no #confirm dialog")
      expect(dialog.matches(":modal"), "the server's open dialog").toBe(true)
      // The close request Escape makes, without the key: a key pressed from
      // the test goes to the test's page, not the frame.
      dialog.requestClose()
      await settled(view)
      expect(dialog.open).toBe(false)
      expect(view.requests).toEqual(["POST /jobs/222-0481/keep"])
      expect(view.problems).toEqual([])
    } finally {
      frame.remove()
    }
  })

  it("tells the server nothing when the server closes the dialog", async () => {
    const frame = await mount(page.blocks, SERVER)
    const view = frame.contentWindow as Served
    const doc = frame.contentDocument as Document
    try {
      await settled(view)
      const host = doc.getElementById("confirm")
      const dialog = host?.querySelector("dialog")
      if (!host || !dialog) throw new Error("the dialog recipe has no #confirm")
      // A patch without `open`, as the server sends once the job is decided.
      host.removeAttribute("open")
      dialog.removeAttribute("open")
      await settled(view)
      expect(dialog.matches(":modal")).toBe(false)
      expect(view.requests).toEqual([])
      expect(view.problems).toEqual([])
    } finally {
      frame.remove()
    }
  })
})

/**
 * The session timeout's extension, answered as the Datastar tab says the
 * server answers a session that is already gone: a 200 with the script in the
 * tab's `js` block. Datastar runs it, and the user is taken to log in.
 */
describe("the extension in the session timeout's Datastar recipe", () => {
  const page = pages.find((p) => p.name === "session-timeout")
  const gone = page
    ? blocks(recipePage(page.name), { tab: "Datastar", lang: "js" })[0]?.trim()
    : undefined
  if (!page || !gone)
    throw new Error("the session timeout's Datastar tab has no js answer")

  it("goes to the log-in page when the server answers that the session is gone", async () => {
    const server = `<script>
      window.requests = []
      window.fetch = (input, init = {}) => {
        requests.push((init.method ?? "GET") + " " + new URL(String(input), location.href).pathname)
        return Promise.resolve(new Response(${JSON.stringify(gone)}, {
          headers: { "content-type": "text/javascript" },
        }))
      }
    </script>`
    const frame = await mount(page.blocks.map(warnNow), server + STAY)
    try {
      const view = frame.contentWindow as Served & Staying
      await settled(view)
      expect(view.problems).toEqual([])
      const session = frame.contentDocument?.querySelector(
        "lt-session-timeout",
      ) as (HTMLElement & { extend(): void }) | null
      session?.extend()
      expect(view.requests).toContain("POST /api/extend-session")
      expect(await wentTo(view, 2000)).toBe("/log-in")
      expect(view.problems).toEqual([])
    } finally {
      frame.remove()
    }
  })
})
