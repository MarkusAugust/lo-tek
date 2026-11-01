/**
 * That `texts` in the manifest says what the components do: each text shows
 * when nothing replaces it, and each attribute in `replacedBy` replaces it.
 * `lotek check` warns from that list (`untranslated-text`), so a list that
 * named an attribute the component ignores would silence a real warning.
 */
import { beforeAll, describe, expect, it } from "vitest"

import manifest from "../../manifest/manifest.json"
import { mount, waitForPaint } from "../testing/a11y"
import { DEFAULT_TEXTS } from "./default-texts"
import { defineLtSuggestion } from "./frame/suggestion/lt-suggestion"
import { defineLtConnectionStatus } from "./standalone/connection-status/lt-connection-status"
import { defineLtToast, type LtToast } from "./standalone/toast/lt-toast"
import { TOAST_CLOSE_CLASS } from "./standalone/toast/toast"

type Key = keyof typeof DEFAULT_TEXTS

/** The suggestion field, with three options to filter. */
const SUGGESTION = (attributes: string) => `
  <lt-suggestion ${attributes}>
    <label for="breaker">Breaker</label>
    <input id="breaker">
    <ul class="lt-suggestion__list"><li>Crowbar</li><li>Boltcutter</li><li>Needle</li></ul>
    <span role="status"></span>
  </lt-suggestion>`

/** The status text after typing. */
async function count(attributes: string, typed: string): Promise<string> {
  mount(SUGGESTION(attributes))
  await customElements.whenDefined("lt-suggestion")
  await waitForPaint()
  const input = document.querySelector("#breaker") as HTMLInputElement
  input.value = typed
  input.dispatchEvent(new Event("input", { bubbles: true }))
  await waitForPaint()
  return document.querySelector("[role='status']")?.textContent ?? ""
}

async function connection(attributes: string, back: boolean): Promise<string> {
  mount(`<lt-connection-status ${attributes}></lt-connection-status>`)
  const status = document.querySelector(
    "lt-connection-status",
  ) as HTMLElement & {
    reportFailure(): void
    reportSuccess(): void
  }
  status.reportFailure()
  await waitForPaint()
  if (back) {
    status.reportSuccess()
    await waitForPaint()
  }
  return document.querySelector(".lt-connection-status__bar")?.textContent ?? ""
}

/**
 * How each text is made to show, with the attributes given, and what then
 * shows. Every text has a row: the type requires it.
 */
const SHOWN: Record<Key, (attributes: string) => Promise<string>> = {
  toastRegion: async (attributes) => {
    mount(`<lt-toast ${attributes}></lt-toast>`)
    await waitForPaint()
    return document.querySelector("lt-toast")?.getAttribute("aria-label") ?? ""
  },
  toastClose: async (attributes) => {
    mount(`<lt-toast ${attributes}></lt-toast>`)
    const toast = document.querySelector("lt-toast") as LtToast
    toast.show("Saved")
    await waitForPaint()
    return (
      toast
        .querySelector(`.${TOAST_CLOSE_CLASS}`)
        ?.getAttribute("aria-label") ?? ""
    )
  },
  connectionOffline: (attributes) => connection(attributes, false),
  connectionOnline: (attributes) => connection(attributes, true),
  suggestionNone: (attributes) => count(attributes, "xyz"),
  suggestionOne: (attributes) => count(attributes, "nee"),
  suggestionOther: (attributes) => count(attributes, "b"),
}

/** The number each count shows, for `{n}`. */
const NUMBER: Partial<Record<Key, string>> = {
  suggestionNone: "0",
  suggestionOne: "1",
  suggestionOther: "2",
}

const places = Object.entries(manifest.elements).flatMap(([tag, element]) =>
  Object.entries(
    (
      element as {
        texts?: Record<string, { text: string; replacedBy: string[] }>
      }
    ).texts ?? {},
  ).map(([key, text]) => ({ tag, key: key as Key, ...text })),
)

describe("the default texts in the manifest", () => {
  beforeAll(() => {
    defineLtToast()
    defineLtConnectionStatus()
    defineLtSuggestion()
  })

  it("has every text, and only those", () => {
    expect(places.map((p) => p.key).sort()).toEqual(
      Object.keys(DEFAULT_TEXTS).sort(),
    )
  })

  for (const place of places) {
    const n = NUMBER[place.key] ?? ""
    it(`shows ${place.key} on <${place.tag}> when nothing replaces it`, async () => {
      expect(await SHOWN[place.key]("")).toBe(place.text.replaceAll("{n}", n))
    })
    for (const attribute of place.replacedBy)
      it(`replaces ${place.key} with ${attribute}`, async () => {
        // `{n}` is the number in a count, and text anywhere else.
        expect(await SHOWN[place.key](`${attribute}="Replaced {n}"`)).toBe(
          n ? `Replaced ${n}` : "Replaced {n}",
        )
      })
  }
})
