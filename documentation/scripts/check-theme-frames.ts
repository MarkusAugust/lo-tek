/**
 * That the theme builder shows the theme it has built, on LO-TEK's own
 * components, light and dark side by side.
 *
 * `check-theme-builder.ts` holds that the theme the page offers is the
 * package's. This one holds that the same theme is what is seen: two
 * frames, one per appearance, each framing a page of the site and given the
 * very `theme.css` the generator writes. What can go wrong goes wrong
 * without a word: a frame that follows the reader's own setting and shows
 * dark twice, a theme that reaches one frame and not the other, a frame
 * that keeps the old theme when the page in it is switched, or a frame that
 * looks right because it shows LO-TEK's own colours.
 *
 * So the question is put to the framed documents themselves: which
 * appearance they have, which theme they hold, compared byte for byte with
 * what `buildTheme` in the package gives, run here, and what colour a
 * primary button in them is painted with, compared with the fill the theme
 * reports for that appearance. On the component sheet the button is in the
 * shadow root of its example, on the composed page in the document.
 *
 * Run with: bun documentation/scripts/check-theme-frames.ts
 * Requires `documentation/dist` to be built.
 */

import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import type { Frame } from "playwright"
import { site } from "./site"
import { BRANDS, FAMILIES } from "./theme-rest"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

if (!existsSync(`${ROOT}documentation/dist/theme-builder/index.html`)) {
  console.error(
    "✗ dist/theme-builder/index.html is not built. The site is built with bun run build.",
  )
  process.exit(1)
}

/** The theme as the package builds it, in this process. */
type Fill = { fill: string }
const { buildTheme } = (await import(
  `${ROOT}interfaces/dist/tokens/theme.js`
)) as {
  buildTheme(recipe: unknown): {
    css: string
    brands: { family: string; light: Fill; dark: Fill }[]
  }
}

const APPEARANCES = ["light", "dark"] as const
type Appearance = (typeof APPEARANCES)[number]
/** What can be framed, by the name of its choice on the page. */
const FRAMED = {
  Components: "/theme-builder/sheet/",
  Page: "/theme-builder/page/",
} as const
type Choice = keyof typeof FRAMED

/** The fill a theme reports for accent, as the browser writes a colour. */
function fill(recipe: unknown, appearance: Appearance): string {
  const accent = buildTheme(recipe).brands.find((b) => b.family === "accent")
  if (!accent) throw new Error("the theme reports nothing about accent")
  const [r, g, b] = [1, 3, 5].map((at) =>
    Number.parseInt(accent[appearance].fill.slice(at, at + 2), 16),
  )
  return `rgb(${r}, ${g}, ${b})`
}
/** LO-TEK's own, which a frame without a theme shows. */
const OWN = { accent: BRANDS.accent }

const s = await site({ pages: 1 })
const page = s.page

const expect = (claim: boolean, description: string) => {
  if (!claim) s.fail(description)
}

/** The document in the frame of an appearance, once it has loaded. */
async function framed(appearance: Appearance): Promise<Frame> {
  const handle = await page
    .locator(`iframe[data-appearance="${appearance}"]`)
    .elementHandle()
  const frame = await handle?.contentFrame()
  if (!frame) throw new Error(`the ${appearance} frame has no document`)
  await frame.waitForLoadState("load")
  return frame
}

/** Runs in a framed document. What it is, holds and shows. */
function state() {
  /** The styles that hold a theme: the generator's layer is in every one. */
  const themes = [...document.querySelectorAll("style")].filter((style) =>
    (style.textContent ?? "").includes("lotek-theme"),
  )
  type Marked = HTMLStyleElement & { seenByTheCheck?: boolean }
  const marked = themes.some((style) => (style as Marked).seenByTheCheck)
  for (const style of themes) (style as Marked).seenByTheCheck = true

  const trees = (top: ParentNode): ParentNode[] => [
    top,
    ...[...top.querySelectorAll("*")].flatMap((element) =>
      element.shadowRoot ? trees(element.shadowRoot) : [],
    ),
  ]
  const button = trees(document)
    .flatMap((tree) => [
      ...tree.querySelectorAll(
        "button.lt-button:not([data-variant]):not(:disabled)",
      ),
    ])
    .find((candidate) => candidate.getClientRects().length > 0)
  return {
    path: location.pathname,
    appearance: document.documentElement.getAttribute("data-theme"),
    themes: themes.map((style) => style.textContent ?? ""),
    /** Whether a theme element here was seen by an earlier look. */
    marked,
    button: button ? getComputedStyle(button).backgroundColor : null,
  }
}

/**
 * Waits until the frame of an appearance holds this theme and paints with
 * this fill, and files what it does not come to. A theme of `null` is none.
 */
async function holds(
  when: string,
  appearance: Appearance,
  path: string,
  css: string | null,
  colour: string,
): Promise<{ marked: boolean }> {
  let now = await (await framed(appearance)).evaluate(state)
  for (let attempt = 0; attempt < 50; attempt++) {
    const themed =
      css === null
        ? now.themes.length === 0
        : now.themes.length === 1 && now.themes[0] === css
    if (now.path === path && themed && now.button === colour) break
    await page.waitForTimeout(100)
    now = await (await framed(appearance)).evaluate(state)
  }
  const where = `${when}, the ${appearance} frame`
  expect(now.path === path, `${where} frames ${now.path}, not ${path}`)
  expect(
    now.appearance === appearance,
    `${where} has data-theme="${now.appearance}" on its <html>`,
  )
  if (css === null)
    expect(
      now.themes.length === 0,
      `${where} holds ${now.themes.length} themes where there is no recipe`,
    )
  else {
    expect(
      now.themes.length === 1,
      `${where} has ${now.themes.length} <style> with a theme, not one`,
    )
    expect(
      now.themes[0] === css,
      `${where} does not hold the theme the package builds${now.themes[0] ? `: it starts ${JSON.stringify(now.themes[0].slice(0, 120))}` : ""}`,
    )
  }
  expect(
    now.button === colour,
    `${where} paints a primary button ${now.button ?? "nowhere"}, and the theme says ${colour}`,
  )
  compared += 1
  return { marked: now.marked }
}

/** Switches both frames with the control on the page, found by what it is called. */
async function choose(choice: Choice) {
  const control = page
    .getByRole("tab", { name: choice, exact: true })
    .or(page.getByRole("radio", { name: choice, exact: true }))
  expect(
    (await control.count()) === 1,
    `${await control.count()} tabs or radio buttons are called "${choice}", not one`,
  )
  // A radio button of LO-TEK's toggle group is under its label, so it is
  // chosen with the keyboard, as it can be. A tab is pressed.
  if ((await control.getAttribute("type")) === "radio") {
    await control.focus()
    await page.keyboard.press("Space")
  } else await control.click()
}

let compared = 0

const code = await s.run(async () => {
  await s.open("/theme-builder/")

  // Two frames, each named for what it is, each a page of the site.
  for (const appearance of APPEARANCES) {
    const frame = page.locator(`iframe[data-appearance="${appearance}"]`)
    expect(
      (await frame.count()) === 1,
      `${await frame.count()} frames are marked data-appearance="${appearance}", not one`,
    )
    if ((await frame.count()) !== 1)
      throw new Error("the page does not have its two frames")
    const name =
      (await frame.getAttribute("title")) ??
      (await frame.getAttribute("aria-label")) ??
      ""
    expect(
      name.toLowerCase().includes(appearance),
      `the ${appearance} frame is called "${name}", which does not say which it is`,
    )
  }

  // From nothing, whatever the page remembers: every family LO-TEK's own.
  for (const family of FAMILIES)
    await page.locator(`input[role="switch"][name="own.${family}"]`).uncheck()
  const accent = page.locator('[name="accent"]')
  const scrolled = () => page.evaluate(() => window.scrollY)

  /*
   * Without a recipe: the sheet in both, each in its appearance whatever the
   * reader's machine asks for, and LO-TEK's own colours.
   */
  for (const setting of APPEARANCES) {
    await page.emulateMedia({ colorScheme: setting })
    for (const appearance of APPEARANCES)
      await holds(
        `with no recipe, on a machine set to ${setting}`,
        appearance,
        FRAMED.Components,
        null,
        fill(OWN, appearance),
      )
  }

  /*
   * A colour in the middle, then a light one, on the sheet and then on the
   * page. The light one is the case the builder is for: the fill is not the
   * colour that was typed.
   */
  await page.locator('input[role="switch"][name="own.accent"]').check()
  for (const choice of ["Components", "Page"] as const) {
    await choose(choice)
    let first = true
    for (const colour of ["#7c3aed", "#f7df1e"]) {
      const recipe = { accent: colour }
      const before = await scrolled()
      await accent.fill(colour)
      for (const appearance of APPEARANCES) {
        const { marked } = await holds(
          `${choice}, accent ${colour}`,
          appearance,
          FRAMED[choice],
          buildTheme(recipe).css,
          fill(recipe, appearance),
        )
        // The element that held the first theme holds the second: a theme
        // that is added beside the old one leaves the order to decide.
        if (!first)
          expect(
            marked,
            `${choice}, accent ${colour}, the ${appearance} frame holds the new theme in a new element, not in the one it had`,
          )
      }
      first = false
      // The frames took the theme, and the builder is where it was.
      expect(
        (await page.evaluate(() =>
          document.activeElement?.getAttribute("name"),
        )) === "accent",
        `${choice}, accent ${colour}: the field is no longer where the typing goes after the theme was applied`,
      )
      expect(
        (await scrolled()) === before,
        `${choice}, accent ${colour}: the builder scrolled when the theme was applied`,
      )
    }
  }

  // Back to the sheet, without the recipe being touched: the new document
  // has the theme the old one had.
  await choose("Components")
  for (const appearance of APPEARANCES)
    await holds(
      "back on the components, the recipe untouched",
      appearance,
      FRAMED.Components,
      buildTheme({ accent: "#f7df1e" }).css,
      fill({ accent: "#f7df1e" }, appearance),
    )

  // And without a recipe again, the theme is gone from the frames.
  await page.locator('input[role="switch"][name="own.accent"]').uncheck()
  for (const appearance of APPEARANCES)
    await holds(
      "with the recipe emptied",
      appearance,
      FRAMED.Components,
      null,
      fill(OWN, appearance),
    )
})

if (code !== 0) {
  console.error(
    "✗ The theme builder does not show the theme it builds in its two frames, or the check did not get to look.",
  )
  process.exit(code)
}

// The guard comes last: four looks without a recipe, eight with one on the
// two pages, and two each for the way back and the emptied recipe.
if (compared !== 16) {
  console.error(
    `✗ The check looked into a frame ${compared} times where it should have 16. It has not looked at everything.`,
  )
  process.exit(1)
}

console.log(
  `✓ The two frames of the theme builder have their appearance, hold the package's theme byte for byte and paint with its fill, on the components and on the page (${compared} looks).`,
)
