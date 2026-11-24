/**
 * What the checks of the theme builder share when they read its page.
 *
 * Each `check-theme-*.ts` drives the page for its own question. Two things
 * they all need are the same question to the same page: which theme the two
 * frames hold, and the recipe that a set of typed values makes.
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
