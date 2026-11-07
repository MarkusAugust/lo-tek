/**
 * That the scripts in the "Plain HTML" recipes run as the reader pastes them.
 *
 * `check-recipes.ts` reads the pages as text, and the Kotlin comparison
 * requires the same scripts in both tabs, apart from the ones a server does
 * the job of (`SERVER_DOES_IT` in `RecipesTest`), but neither runs one. A recipe
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
import {
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
    blocks: blocks(recipePage(name), { tab: "Plain HTML", lang: "html" }),
  }
})

/**
 * The scripts in every "Plain HTML" tab, counted by plain string search
 * rather than through `recipes.json`, so a tab or a script the reading missed is one
 * the test reports as missing.
 */
function scriptsInPlainHtml(text: string): number {
  let count = 0
  for (let start = text.indexOf('label="Plain HTML"'); start >= 0; ) {
    const end = text.indexOf("</TabItem>", start)
    count +=
      text.slice(start, end < 0 ? undefined : end).split("<script").length - 1
    // On from the end of this tab, so an unclosed one is not counted twice.
    start = end < 0 ? -1 : text.indexOf('label="Plain HTML"', end)
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
        expect(
          unregistered(frame),
          "web components without a registration",
        ).toEqual([])
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
    const withoutRegistration = page.blocks.map((b) =>
      b.replace(
        /<script\b[^>]*>(?:(?!<\/script>)[\s\S])*defineLtConnectionStatus\(\)[\s\S]*?<\/script>/,
        "",
      ),
    )
    expect(withoutRegistration.join("")).not.toContain(
      "defineLtConnectionStatus()",
    )
    const frame = await mount(withoutRegistration)
    const view = frame.contentWindow as Saving
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      expect(view.customElements.get("lt-connection-status")).toBeUndefined()
      expect(
        typeof view.saveRoute,
        "the recipe lost saveRoute with the registration",
      ).toBe("function")
      view.fetch = answer(200)
      // A save that waits for the registration never settles here, so the
      // deadline only needs to be well past a resolved fetch.
      const saved = await Promise.race([
        view.saveRoute("body").then((r) => r?.status),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve("still waiting"), 2000)
        }),
      ])
      expect(saved).toBe(200)
    } finally {
      clearTimeout(timer)
      frame.remove()
    }
  })
})

/**
 * The forms that post to the server: the script stops a submission that
 * fails, and lets one that passes go to the server. A script that stopped
 * every submission, as these did before, is a page whose form never reaches
 * the server, and nothing else here submits them.
 */
describe("the forms that post to the server", () => {
  const forms = [
    {
      name: "error-summary",
      field: "fixer",
      failing: "nobody",
      passing: "fixer@relay.example",
    },
    { name: "field", field: "codename", failing: "", passing: "Kestrel" },
  ]
  for (const { name, field, failing, passing } of forms)
    it(`${name}: stops a failing submission and lets a valid one through`, async () => {
      const page = pages.find((p) => p.name === name)
      if (!page) throw new Error(`found no ${name} page`)
      const frame = await mount(page.blocks)
      const view = frame.contentWindow as Frame
      const doc = frame.contentDocument as Document
      try {
        const form = doc.querySelector("form")
        const input = doc.getElementById(field) as HTMLInputElement | null
        if (!form || !input)
          throw new Error(`the ${name} recipe has no form with #${field}`)
        expect(form.method, "the form posts").toBe("post")
        const stopped: boolean[] = []
        // Last on the way up, after the recipe's listener on the form, and
        // the frame stays where it is.
        view.addEventListener("submit", (event) => {
          stopped.push(event.defaultPrevented)
          event.preventDefault()
        })
        for (const value of [failing, passing, failing]) {
          input.value = value
          form.requestSubmit()
        }
        expect(stopped).toEqual([true, false, true])
        expect(view.problems).toEqual([])
      } finally {
        frame.remove()
      }
    })
})

/**
 * The toast recipe's restart, with `fetch` answered by the test: which
 * message each answer gives. A redirect is followed by `fetch` to a page that
 * is ok, as the log-in page is when the session has run out, and is no
 * restart.
 */
describe("the restart in the toast recipe", () => {
  const page = pages.find((p) => p.name === "toast")
  if (!page) throw new Error("found no toast page")
  type Restarting = Omit<Frame, "fetch"> & { fetch: () => Promise<Response> }

  it("says the relay is back only for an answer that is ok and not redirected", async () => {
    const frame = await mount(page.blocks)
    const view = frame.contentWindow as Restarting
    const doc = frame.contentDocument as Document
    try {
      const restart = doc.getElementById("restart") as HTMLButtonElement | null
      if (!restart) throw new Error("the toast recipe has no #restart")
      const status = (code: number) => () =>
        Promise.resolve(new Response(null, { status: code }))
      const answers: [string, () => Promise<Response>][] = [
        ["none", () => Promise.reject(new TypeError("Failed to fetch"))],
        ["200", status(200)],
        [
          "200 after a redirect",
          () => {
            const answer = new Response(null, { status: 200 })
            Object.defineProperty(answer, "redirected", { value: true })
            return Promise.resolve(answer)
          },
        ],
        ["204", status(204)],
        ["403", status(403)],
        ["500", status(500)],
        ["502", status(502)],
        ["503", status(503)],
        ["504", status(504)],
      ]
      const messages = () => [...doc.querySelectorAll(".lt-toast__message")]
      const said: string[] = []
      for (const [name, answer] of answers) {
        const before = new Set(messages())
        view.fetch = answer
        restart.click()
        // The message comes once the answer has been read, a few microtasks on.
        let added: Element[] = []
        for (let i = 0; i < 20 && added.length === 0; i++) {
          await new Promise((resolve) => view.requestAnimationFrame(resolve))
          added = messages().filter((m) => !before.has(m))
        }
        said.push(
          `${name}: ${added.map((m) => m.querySelector("span")?.textContent).join(" | ") || "nothing"}`,
        )
      }
      expect(said).toEqual([
        "none: Relay 14 did not answer. Try again.",
        "200: Relay 14 is back",
        "200 after a redirect: Relay 14 refused the restart. Try again.",
        "204: Relay 14 is back",
        "403: Relay 14 refused the restart. Try again.",
        "500: Relay 14 refused the restart. Try again.",
        "502: Relay 14 did not answer. Try again.",
        "503: Relay 14 did not answer. Try again.",
        "504: Relay 14 did not answer. Try again.",
      ])
      expect(view.problems).toEqual([])
    } finally {
      frame.remove()
    }
  })
})

/**
 * The session timeout recipe's extension, with `fetch` answered by the test.
 * A session the server says is gone sends the user to log in, as an expired
 * one does; a server that does not answer leaves the user on the page, with
 * what is not saved, since the session may well still be there.
 */
describe("the extension in the session timeout recipe", () => {
  const page = pages.find((p) => p.name === "session-timeout")
  if (!page) throw new Error("found no session timeout page")
  type Extending = Omit<Staying, "fetch"> & { fetch: () => Promise<Response> }
  const status =
    (code: number, redirected = false) =>
    () => {
      const answer = new Response(null, { status: code })
      if (redirected)
        Object.defineProperty(answer, "redirected", { value: true })
      return Promise.resolve(answer)
    }
  const answers: [string, () => Promise<Response>][] = [
    ["none", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["204", status(204)],
    ["200 after a redirect", status(200, true)],
    ["401", status(401)],
    ["403", status(403)],
    ["503", status(503)],
  ]

  for (const [name, answer] of answers)
    it(`${name}: ${/none|204|503/.test(name) ? "stays on the page" : "goes to the log-in page"}`, async () => {
      const frame = await mount(page.blocks, STAY)
      try {
        const view = frame.contentWindow as Extending
        const session = frame.contentDocument?.querySelector(
          "lt-session-timeout",
        ) as (HTMLElement & { extend(): void }) | null
        if (!session)
          throw new Error("the session timeout recipe has no element")
        view.fetch = answer
        // What "Stay connected" and Escape do: the component sends
        // `session-extend`, and the recipe asks the server.
        session.extend()
        expect(await wentTo(view, 500)).toBe(
          /none|204|503/.test(name) ? "stayed" : "/log-in",
        )
        expect(view.problems).toEqual([])
      } finally {
        frame.remove()
      }
    })
})
