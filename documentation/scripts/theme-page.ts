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

/** The choices of which appearances the builder shows, in the order they stand. */
export const SHOWN = ["dark", "both", "light"] as const
export type Shown = (typeof SHOWN)[number]

/**
 * Chooses which appearances the builder shows, as a visitor does: by the
 * option's label. The builder opens with the dark one alone, so a check
 * that needs the light frame, or both, asks for it first.
 */
export async function showAppearances(page: Page, which: Shown) {
  await page
    .locator(`label:has(input[name="appearances"][value="${which}"])`)
    .click()
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

/**
 * Runs in the component sheet. The names of the roles over the colour bars
 * of the theme at a glance, as a visitor without a pointer finds them: the
 * roles are those of the parts of the first bar, and a name is a piece of
 * shown text in the block that says one of them and is no part of a bar and
 * no tooltip.
 */
export function readRoleNames() {
  const collapsed = (text: string) => text.replace(/\s+/g, " ").trim()
  const block = document.querySelector<HTMLElement>("[data-glance]")
  const bars = [
    ...(block?.querySelectorAll<HTMLElement>("li[data-family]") ?? []),
  ]
  const parts = [
    ...(bars[0]?.querySelectorAll<HTMLElement>("[data-role]") ?? []),
  ]
  const box = (element: Element) => {
    const { left, right, top, bottom } = element.getBoundingClientRect()
    return { left, right, top, bottom }
  }
  /** The first colour behind an element that is not see-through: what it is read against. */
  const behind = (element: Element) => {
    for (let at: Element | null = element; at; at = at.parentElement) {
      const colour = getComputedStyle(at).backgroundColor
      if (!/rgba\(.*,\s*0\)$|transparent/.test(colour)) return colour
    }
    return getComputedStyle(document.documentElement).backgroundColor
  }
  const texts = [...(block?.querySelectorAll<HTMLElement>("*") ?? [])].filter(
    (element) =>
      element.children.length === 0 &&
      element.closest("[data-role], [role=tooltip], li[data-family]") ===
        null &&
      element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
  )
  return {
    window: { width: window.innerWidth, height: window.innerHeight },
    scheme: getComputedStyle(document.documentElement).colorScheme,
    roles: parts.map((part) => ({
      role: part.dataset.role ?? "",
      ...box(part),
    })),
    /** Where the bars begin and end, from the first to the last. */
    bars: {
      top: Math.min(...bars.map((bar) => box(bar).top)),
      bottom: Math.max(...bars.map((bar) => box(bar).bottom)),
    },
    names: texts
      .filter((element) =>
        parts.some(
          (part) => part.dataset.role === collapsed(element.innerText),
        ),
      )
      .map((element) => ({
        role: collapsed(element.innerText),
        ...box(element),
        cut:
          element.scrollWidth > element.clientWidth + 1 ||
          element.scrollHeight > element.clientHeight + 1,
        colour: getComputedStyle(element).color,
        behind: behind(element),
        size: Number.parseFloat(getComputedStyle(element).fontSize),
      })),
    /** Every part of every bar: its family, its role, and what a screen reader is told it is. */
    parts: bars.flatMap((bar) =>
      [...bar.querySelectorAll<HTMLElement>("[data-role]")].map((part) => ({
        family: bar.dataset.family ?? "",
        role: part.dataset.role ?? "",
        as: part.getAttribute("role") ?? "",
        name: collapsed(
          part.getAttribute("aria-label") ??
            (part.getAttribute("aria-labelledby") ?? "")
              .split(/\s+/)
              .map((id) => document.getElementById(id)?.textContent ?? "")
              .join(" "),
        ),
      })),
    ),
  }
}

/** The contrast between two colours as the browser writes them, as WCAG 2 computes it. */
export function contrast(a: string, b: string): number {
  const luminance = (colour: string) => {
    const [r, g, bl] = (colour.match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => {
      const c = Number(v) / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

/**
 * What is wrong with the names of the roles as `readRoleNames` found them:
 * each role named once, in the order of the parts, over its own part, whole,
 * clear of the other names and of the bars, readable against what is behind
 * it, and every part of every bar named for a screen reader by its family
 * and its role. Small text is held to 4.5 to 1, as WCAG asks of it.
 */
export function roleNameFaults(
  read: ReturnType<typeof readRoleNames>,
): string[] {
  const faults: string[] = []
  const roles = read.roles.map((part) => part.role)
  if (roles.length < 2) return ["the first bar has no parts with a data-role"]
  const named = read.names.map((name) => name.role)
  if (JSON.stringify(named) !== JSON.stringify(roles))
    faults.push(
      `the roles shown as text are ${named.join(", ") || "none"}, expected each once in the order of the parts: ${roles.join(", ")}`,
    )
  for (const name of read.names) {
    const part = read.roles.find((p) => p.role === name.role)
    const centre = (name.left + name.right) / 2
    if (part && (centre < part.left || centre > part.right))
      faults.push(
        `${name.role} is centred at ${Math.round(centre)}, and its part reaches from ${Math.round(part.left)} to ${Math.round(part.right)}`,
      )
    if (name.cut || name.left < 0 || name.right > read.window.width + 1)
      faults.push(`${name.role} is cut off`)
    if (name.bottom > read.bars.top + 1)
      faults.push(`${name.role} lies over the bars`)
    const ratio = contrast(name.colour, name.behind)
    if (!(ratio >= 4.5))
      faults.push(
        `${name.role} is ${name.colour} on ${name.behind}, a contrast of ${ratio.toFixed(2)} to 1 where 4.5 is asked of small text`,
      )
  }
  for (const [index, a] of read.names.entries())
    for (const b of read.names.slice(index + 1))
      if (
        a.left < b.right - 0.5 &&
        b.left < a.right - 0.5 &&
        a.top < b.bottom - 0.5 &&
        b.top < a.bottom - 0.5
      )
        faults.push(`${a.role} lies over ${b.role}`)
  const said = (text: string, word: string) =>
    text.toLowerCase().includes(word) ||
    text.toLowerCase().includes(word.replaceAll("-", " "))
  const unnamed = read.parts.filter(
    (part) =>
      part.as === "" ||
      part.as === "presentation" ||
      part.as === "none" ||
      !said(part.name, part.family) ||
      !said(part.name, part.role),
  )
  if (unnamed.length > 0 || read.parts.length < roles.length)
    faults.push(
      `${unnamed.length} of ${read.parts.length} parts are not named for a screen reader by family and role, the first ${unnamed[0]?.family} ${unnamed[0]?.role}: role "${unnamed[0]?.as}", named "${unnamed[0]?.name}"`,
    )
  return faults
}
