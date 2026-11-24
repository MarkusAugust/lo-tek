/**
 * What the checks of the theme builder share when they read its page.
 *
 * Each `check-theme-*.ts` drives the page for its own question. What several
 * of them need is the same question to the same page: which theme the two
 * frames hold, the recipe that a set of typed values makes and the values a
 * recipe is made of, the switch and the field of a key, and the wait for the
 * page to come to a state.
 */

import type { Page } from "playwright"

/** Paths and values as the recipe nests them: `shape.buttonRadius` under `shape`. */
export function nested(values: Record<string, string>) {
  const recipe: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(values)) {
    const parts = key.split(".")
    let at = recipe
    for (const part of parts.slice(0, -1)) {
      at[part] ??= {}
      at = at[part] as Record<string, unknown>
    }
    at[parts[parts.length - 1]] = value
  }
  return recipe
}

/** A recipe as paths and values as text, the way a form holds it. */
export function flat(recipe: unknown, path = ""): [string, string][] {
  return Object.entries(recipe as Record<string, unknown>).flatMap(
    ([name, value]) =>
      value !== null && typeof value === "object"
        ? flat(value, `${path}${name}.`)
        : [[`${path}${name}`, String(value)] as [string, string]],
  )
}

/**
 * The same recipe whether a weight is the number or the text: the form
 * gives text, the theme is the same for both, and which the page writes is
 * its own business.
 */
export const comparable = (recipe: unknown) =>
  JSON.stringify(flat(recipe).sort(([a], [b]) => (a < b ? -1 : 1)))

/** The switch that says a colour family has a colour of its own. */
export const ownOn = (page: Page) => (family: string) =>
  page.locator(`input[role="switch"][name="own.${family}"]`)

/** The control of a key, by the name the form gives it. */
export const fieldOn = (page: Page) => (name: string) =>
  page.locator(`[name="${name}"]`)

/** Waits up to five seconds for a state of the page, and gives the state it came to. */
export async function untilOn<T>(
  page: Page,
  read: () => Promise<T>,
  done: (state: T) => boolean,
): Promise<T> {
  let state = await read()
  for (let attempt = 0; attempt < 50 && !done(state); attempt++) {
    await page.waitForTimeout(100)
    state = await read()
  }
  return state
}

/**
 * The theme each frame holds, light then dark: the text of its styles with
 * the generator's layer in them. None when the frame has no theme.
 */
export function themesInFrames(page: Page): Promise<string[][]> {
  return Promise.all(
    ["light", "dark"].map(async (appearance) => {
      const handle = await page
        .locator(`iframe[data-appearance="${appearance}"]`)
        .elementHandle()
      const frame = await handle?.contentFrame()
      if (!frame) return ["(no document)"]
      return frame.evaluate(() =>
        [...document.querySelectorAll("style")]
          .map((style) => style.textContent ?? "")
          .filter((text) => text.includes("lotek-theme")),
      )
    }),
  )
}

/** Whether both frames hold this theme right now, or none when it is `null`: one read, no waiting. */
export async function framesHoldNow(
  page: Page,
  css: string | null,
): Promise<boolean> {
  return (await themesInFrames(page)).every((frame) =>
    css === null ? frame.length === 0 : frame.length === 1 && frame[0] === css,
  )
}

/** Waits until both frames hold this theme, or none when it is `null`, and says whether they came to. */
export async function framesHold(
  page: Page,
  css: string | null,
): Promise<boolean> {
  const holds = (held: string[][]) =>
    held.every((frame) =>
      css === null
        ? frame.length === 0
        : frame.length === 1 && frame[0] === css,
    )
  let held = await themesInFrames(page)
  for (let attempt = 0; attempt < 50 && !holds(held); attempt++) {
    await page.waitForTimeout(100)
    held = await themesInFrames(page)
  }
  return holds(held)
}
