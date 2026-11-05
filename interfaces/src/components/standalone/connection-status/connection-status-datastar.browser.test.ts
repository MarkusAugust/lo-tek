/**
 * That the connection status in the page's Datastar recipe reports what the
 * page says it does, with real Datastar 1.0.4 and the markup taken from the
 * page. The expression in `data-on:datastar-fetch__document` reads the shape
 * of Datastar's event (`type`, and `argsRaw.status` on `error`), so the
 * answers go through Datastar's own fetch, with `fetch` stubbed: a change in
 * that shape fails here rather than leaving the bar silent.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { mount } from "../../../testing/a11y"
import { htmlBlocks, tabItems } from "../../../testing/recipes"
import { defineLtConnectionStatus } from "./lt-connection-status"

import "../../../testing/datastar/datastar-v1.0.4.js"

const PAGE = import.meta.glob<string>(
  "../../../../../documentation/src/content/docs/components/connection-status.mdx",
  { query: "?raw", import: "default", eager: true },
)

/** The HTML in the Datastar tab, as the reader pastes it. */
function datastarTab(): string {
  const text = Object.values(PAGE)[0]
  if (!text) throw new Error("found no connection-status page")
  const tab = tabItems(text).find((t) => t.name === "Datastar")
  return htmlBlocks(tab?.code ?? "").join("\n")
}

/** The `<lt-connection-status>` in the Datastar tab. */
function recipe(): string {
  const element = datastarTab().match(
    /<lt-connection-status\b[\s\S]*?<\/lt-connection-status>/,
  )?.[0]
  if (!element?.includes("data-on:datastar-fetch__document"))
    throw new Error(
      "the Datastar tab has no <lt-connection-status> with data-on:datastar-fetch__document",
    )
  return element
}

function answer(status: number): Response {
  return new Response(status === 200 ? "{}" : "", {
    status,
    headers: { "content-type": "application/json" },
  })
}

/** Mounts the recipe with a button that saves through Datastar. */
async function page(): Promise<() => void> {
  mount(
    `${recipe()}<button data-on:click="@post('/api/routes')">Save route</button>`,
  )
  await customElements.whenDefined("lt-connection-status")
  // Datastar applies `data-on` from a MutationObserver, whose callback runs as
  // a microtask, so it has run once the next task starts. A click before that
  // sends no request, and `save` fails on the count of requests.
  await new Promise((resolve) => setTimeout(resolve))
  return () => (document.querySelector("button") as HTMLButtonElement).click()
}

function bar(): string | null {
  return (
    document
      .querySelector(".lt-connection-status__bar")
      ?.getAttribute("data-state") ?? null
  )
}

/**
 * Clicks, and waits for Datastar's `finished`, which comes after the `error`
 * or the patch the expression reports from.
 */
async function save(click: () => void): Promise<void> {
  const finished = new Promise<void>((resolve) => {
    const done = (event: Event) => {
      if ((event as CustomEvent).detail?.type !== "finished") return
      document.removeEventListener("datastar-fetch", done)
      resolve()
    }
    document.addEventListener("datastar-fetch", done)
  })
  click()
  await finished
  expect(vi.mocked(window.fetch)).toHaveBeenCalled()
}

describe("the connection status in the Datastar recipe", () => {
  beforeAll(() => {
    defineLtConnectionStatus()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  for (const status of [502, 503, 504]) {
    it(`shows the bar when a gateway answers ${status}`, async () => {
      vi.spyOn(window, "fetch").mockResolvedValueOnce(answer(status))
      const click = await page()
      await save(click)
      expect(bar()).toBe("offline")
    })
  }

  it("says nothing when a server that is there refuses with 422", async () => {
    vi.spyOn(window, "fetch").mockResolvedValueOnce(answer(422))
    const click = await page()
    await save(click)
    expect(bar()).toBeNull()
  })

  it("takes a 500 after an outage as the server being back", async () => {
    vi.spyOn(window, "fetch")
      .mockResolvedValueOnce(answer(503))
      .mockResolvedValueOnce(answer(500))
    const click = await page()
    await save(click)
    expect(bar()).toBe("offline")
    await save(click)
    expect(bar()).toBe("online")
  })

  it("registers the web component before it loads Datastar", () => {
    // Module scripts run in the order they stand. With Datastar first, the
    // answer to a request at load reached an element without its methods, in
    // all three engines, and the outage was never shown.
    const tab = datastarTab()
    const registration = tab.indexOf("defineLtConnectionStatus()")
    const datastar = tab.indexOf("datastar.js")
    expect(registration).toBeGreaterThan(0)
    expect(datastar).toBeGreaterThan(registration)
  })

  it("shows the bar when a request gets no answer, and clears it when the retry is answered", async () => {
    vi.spyOn(window, "fetch")
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(answer(200))
    const click = await page()
    click()
    await vi.waitFor(() => expect(bar()).toBe("offline"))
    // Datastar retries after a second, and the patch from the answer is the sign.
    await vi.waitFor(() => expect(bar()).toBe("online"), { timeout: 4000 })
  })
})
