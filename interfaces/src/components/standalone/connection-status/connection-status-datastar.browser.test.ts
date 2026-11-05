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

/** The `<lt-connection-status>` in the Datastar tab, as the reader pastes it. */
function recipe(): string {
  const text = Object.values(PAGE)[0]
  if (!text) throw new Error("found no connection-status page")
  const tab = tabItems(text).find((t) => t.name === "Datastar")
  const element = htmlBlocks(tab?.code ?? "")
    .join("\n")
    .match(/<lt-connection-status\b[\s\S]*?<\/lt-connection-status>/)?.[0]
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
  // Datastar applies `data-on` from its own MutationObserver.
  await new Promise((resolve) => setTimeout(resolve, 50))
  return () => (document.querySelector("button") as HTMLButtonElement).click()
}

function bar(): string | null {
  return (
    document
      .querySelector(".lt-connection-status__bar")
      ?.getAttribute("data-state") ?? null
  )
}

/** Clicks, and waits until Datastar has had every answer the stub gives. */
async function save(click: () => void, answers: number): Promise<void> {
  const calls = vi.mocked(window.fetch).mock.calls.length
  click()
  await vi.waitFor(
    () =>
      expect(vi.mocked(window.fetch).mock.calls.length).toBe(calls + answers),
    { timeout: 4000 },
  )
  await new Promise((resolve) => setTimeout(resolve, 50))
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
      await save(click, 1)
      expect(bar()).toBe("offline")
    })
  }

  it("says nothing when a server that is there refuses with 422", async () => {
    vi.spyOn(window, "fetch").mockResolvedValueOnce(answer(422))
    const click = await page()
    await save(click, 1)
    expect(bar()).toBeNull()
  })

  it("takes a 500 after an outage as the server being back", async () => {
    vi.spyOn(window, "fetch")
      .mockResolvedValueOnce(answer(503))
      .mockResolvedValueOnce(answer(500))
    const click = await page()
    await save(click, 1)
    expect(bar()).toBe("offline")
    await save(click, 1)
    expect(bar()).toBe("online")
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
