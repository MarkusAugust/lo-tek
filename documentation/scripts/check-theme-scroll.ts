/**
 * That the two frames of the theme builder scroll together.
 *
 * The frames show the same page in the two appearances, to be compared.
 * Scrolled apart they show two different parts of it, and the comparison is
 * between a table in the light and a form in the dark. So scrolling the page
 * in one frame scrolls the other to the same place, from either side, for
 * the components and for the page, and still after the frames are switched
 * to the other, which gives them two new documents.
 *
 * The place is held as the share of what can be scrolled, so two frames
 * that are not to the pixel equally tall are still at the same place. And
 * the following must end: each frame follows the other, so one scroll that
 * is answered by a scroll that is answered again never comes to rest. After
 * one scroll both stand still, and nothing in them scrolls any more.
 *
 * Run with: bun documentation/scripts/check-theme-scroll.ts
 * Requires `documentation/dist` to be built.
 */

import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import type { Frame } from "playwright"
import { site } from "./site"
import { showAppearances } from "./theme-page"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

if (!existsSync(`${ROOT}documentation/dist/theme-builder/index.html`)) {
  console.error(
    "✗ dist/theme-builder/index.html is not built. The site is built with bun run build.",
  )
  process.exit(1)
}

const APPEARANCES = ["light", "dark"] as const
type Appearance = (typeof APPEARANCES)[number]
const FRAMED = {
  Components: "/theme-builder/sheet/",
  Page: "/theme-builder/page/",
} as const
type Choice = keyof typeof FRAMED

const s = await site({ pages: 1 })
const page = s.page
const expect = (claim: boolean, description: string) => {
  if (!claim) s.fail(description)
}

/** The document in the frame of an appearance, once it frames this page. */
async function framed(appearance: Appearance, path: string): Promise<Frame> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const handle = await page
      .locator(`iframe[data-appearance="${appearance}"]`)
      .elementHandle()
    const frame = await handle?.contentFrame()
    if (frame && new URL(frame.url()).pathname === path) {
      await frame.waitForLoadState("load")
      return frame
    }
    await page.waitForTimeout(100)
  }
  throw new Error(`the ${appearance} frame does not frame ${path}`)
}

/** Runs in a frame. Where it is scrolled to, and how far it can be. */
const place = () => {
  const room = document.documentElement.scrollHeight - window.innerHeight
  return {
    y: window.scrollY,
    room,
    share: room > 0 ? window.scrollY / room : 0,
  }
}
/** Runs in a frame. Counts its scrolls from now on. */
const count = () => {
  const counted = window as Window & { scrollsSeen?: number }
  if (counted.scrollsSeen === undefined)
    window.addEventListener("scroll", () => {
      counted.scrollsSeen = (counted.scrollsSeen ?? 0) + 1
    })
  counted.scrollsSeen = 0
}
const counted = () =>
  (window as Window & { scrollsSeen?: number }).scrollsSeen ?? 0

/** The frames switched with the control on the page, found by what it is called. */
async function choose(choice: Choice) {
  const control = page
    .getByRole("tab", { name: choice, exact: true })
    .or(page.getByRole("radio", { name: choice, exact: true }))
  if ((await control.getAttribute("type")) === "radio") {
    await control.focus()
    await page.keyboard.press("Space")
  } else await control.click()
}

let followed = 0

/** Scrolls one frame, and holds that the other follows and both come to rest. */
async function follows(
  when: string,
  from: Appearance,
  share: number,
  path: string,
) {
  const other: Appearance = from === "light" ? "dark" : "light"
  const leader = await framed(from, path)
  const follower = await framed(other, path)
  // A page that is still being laid out moves under a scroll on its own:
  // the components open and the fonts arrive. The heights are waited for.
  let room = -1
  for (let attempt = 0; attempt < 30; attempt++) {
    const rooms =
      (await leader.evaluate(place)).room +
      (await follower.evaluate(place)).room
    if (rooms === room) break
    room = rooms
    await page.waitForTimeout(300)
  }
  room = (await leader.evaluate(place)).room
  expect(
    room > 200 && (await follower.evaluate(place)).room > 200,
    `${when}: the framed page is not taller than its frame, so there is nothing to scroll`,
  )
  if (room <= 200) return
  const target = Math.round(room * share)
  await leader.evaluate((y) => window.scrollTo(0, y), target)

  // The follower gets there.
  let there = await follower.evaluate(place)
  for (let attempt = 0; attempt < 30; attempt++) {
    if (Math.abs(there.share - share) < 0.01) break
    await page.waitForTimeout(100)
    there = await follower.evaluate(place)
  }
  expect(
    Math.abs(there.share - share) < 0.01,
    `${when}: the ${from} frame was scrolled to ${Math.round(share * 100)}% and the ${other} frame is at ${Math.round(there.share * 100)}%`,
  )

  // And both come to rest: where they stand, and no scroll after that.
  await page.waitForTimeout(300)
  await leader.evaluate(count)
  await follower.evaluate(count)
  const before = [await leader.evaluate(place), await follower.evaluate(place)]
  await page.waitForTimeout(700)
  const after = [await leader.evaluate(place), await follower.evaluate(place)]
  const scrolls =
    (await leader.evaluate(counted)) + (await follower.evaluate(counted))
  expect(
    scrolls === 0 && before[0].y === after[0].y && before[1].y === after[1].y,
    `${when}: the frames do not come to rest after one scroll: ${scrolls} more scrolls, and they moved from ${before[0].y} and ${before[1].y} to ${after[0].y} and ${after[1].y}`,
  )
  expect(
    Math.abs(after[0].y - target) <= 2,
    `${when}: the ${from} frame, which was scrolled to ${target}, was moved to ${after[0].y} by the other`,
  )
  followed += 1
}

const code = await s.run(async () => {
  await s.open("/theme-builder/")
  // The builder opens with the dark frame alone, and this is about both.
  await showAppearances(page, "both")
  for (const appearance of APPEARANCES)
    expect(
      (await page
        .locator(`iframe[data-appearance="${appearance}"]`)
        .count()) === 1,
      `the page has no ${appearance} frame`,
    )

  // The components, the page, and the components again: the last are two
  // new documents, which must follow each other as the first two did.
  for (const [choice, again] of [
    ["Components", ""],
    ["Page", ""],
    ["Components", " again"],
  ] as const) {
    await choose(choice)
    const path = FRAMED[choice]
    await follows(`${choice}${again}, from light`, "light", 0.5, path)
    await follows(`${choice}${again}, from dark`, "dark", 0.2, path)
    await follows(`${choice}${again}, to the end`, "light", 1, path)
    await follows(`${choice}${again}, back to the top`, "dark", 0, path)
  }
})

if (code !== 0) {
  console.error(
    "✗ The two frames of the theme builder do not scroll together, or the check did not get to look.",
  )
  process.exit(code)
}

// The guard comes last: four scrolls for each of three sets of documents.
if (followed !== 12) {
  console.error(
    `✗ The check held ${followed} scrolls where it has 12. It has not looked at everything.`,
  )
  process.exit(1)
}

console.log(
  `✓ The two frames of the theme builder scroll together, from either side, on the components and on the page, and come to rest (${followed} scrolls).`,
)
