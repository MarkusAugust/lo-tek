/**
 * That every change in the theme builder is seen at once.
 *
 * The previews are there to give a direct impression of what a change does,
 * without scrolling around to look for it. So the goal is held from outside,
 * as a visitor meets it: the builder at its usual window size, the frames
 * at the top where they open, and then one change at a time, for each
 * choice of what is shown: the dark frame alone, both, the light one alone. Every key of
 * the recipe, set to a value far from where it rests, must change what is
 * painted in the part of each frame that is seen, and so must each palette
 * pressed after another. A key that changes nothing there is a key the
 * visitor sets blind, and is named.
 *
 * What is painted is compared as a picture of the frame, light and dark,
 * before and after. A picture that changes by itself would say yes to
 * everything, so the check first requires two pictures of the page at rest
 * to be the same.
 *
 * The top of the component sheet has a block for this, the theme at a
 * glance, with every role of every colour family. In the frames each of
 * them must be painted with the value the package's `buildTheme` gives that
 * token, in the light theme and the dark.
 *
 * Run with: bun documentation/scripts/check-theme-glance.ts
 * Requires `documentation/dist` to be built.
 */

import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { site } from "./site"
import {
  fieldOn,
  framesHold,
  nested,
  ownOn,
  readRoleNames,
  roleNameFaults,
  SHOWN,
  showAppearances,
} from "./theme-page"
import { BRANDS, CONTRACT, FAMILIES, KEYS } from "./theme-recipe"
import { SLIDERS, unread } from "./theme-rest"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

if (!existsSync(`${ROOT}documentation/dist/theme-builder/index.html`)) {
  console.error(
    "✗ dist/theme-builder/index.html is not built. The site is built with bun run build.",
  )
  process.exit(1)
}
if (unread.length > 0) {
  console.error(
    `✗ The check cannot read where LO-TEK rests:\n\n${unread.map((p) => `  ${p}`).join("\n")}\n`,
  )
  process.exit(1)
}

type Palettes = {
  palettes: {
    name: string
    colors: { family: string; color: string; kept: boolean }[]
  }[]
}
const { buildTheme, suggestPalettes } = (await import(
  `${ROOT}interfaces/dist/tokens/theme.js`
)) as {
  buildTheme(recipe: unknown): {
    css: string
    light: Record<string, string>
    dark: Record<string, string>
  }
  suggestPalettes(recipe: unknown): Palettes | null
}

const APPEARANCES = ["light", "dark"] as const
/** The roles the block at the top of the sheet shows of each family, as CSS writes them. */
const ROLES = [
  "surface",
  "border-subtle",
  "border",
  "border-strong",
  "fill",
  "text-subtle",
  "text",
  "text-strong",
]

/**
 * A value far from where the key rests: for a colour one that is nothing
 * like LO-TEK's own, for a number the end of its range furthest from where
 * it stands, and another kind of font.
 */
function farFrom(key: string): string {
  if (FAMILIES.includes(key))
    return key === "warning" || key === "brand3" ? "#1c7ed6" : "#e8590c"
  if (key === "typography.fontFamily") return "Georgia, serif"
  const slider = SLIDERS[key]
  if (!slider) throw new Error(`${key} has no value far from its rest`)
  const { min, max, rest, unit } = slider
  const far = Number.isNaN(rest) || rest - min <= max - rest ? max : min
  return `${far}${unit}`
}
const untried = KEYS.filter((key) => {
  try {
    return farFrom(key) === "" || farFrom(key) === (BRANDS[key] ?? "")
  } catch {
    return true
  }
})
if (KEYS.length < 20 || untried.length > 0) {
  console.error(
    `✗ The check has ${KEYS.length} keys and no value to try for ${untried.join(", ") || "none of them"}. It is older than the schema.`,
  )
  process.exit(1)
}

const s = await site({ pages: 1 })
const page = s.page
let points = 0
/** Which appearances the visitor has chosen to see, for the messages. */
let showing = ""
const expect = (claim: boolean, description: string) => {
  points += 1
  if (!claim)
    s.fail(showing === "" ? description : `${showing} shown: ${description}`)
}
const own = ownOn(page)
const field = fieldOn(page)
const frame = (appearance: string) =>
  page.locator(`iframe[data-appearance="${appearance}"]`)

/** The frames that are shown with the choice the check is at. */
let seen: (typeof APPEARANCES)[number][] = []
/** A picture of what is seen of each frame that is shown. */
async function pictures(): Promise<Buffer[]> {
  // The pointer rests where the check last pressed, which may be over a
  // frame: what it points at there says so, and that is no change of theme.
  await page.mouse.move(0, 0)
  // What was just set has been painted, and nothing is half way there.
  await page.waitForTimeout(150)
  return Promise.all(
    seen.map((appearance) =>
      frame(appearance).screenshot({ animations: "disabled", caret: "hide" }),
    ),
  )
}
/**
 * Whether two pictures show the same. Not byte for byte: where a frame
 * stands at half a pixel, the edge of a border is drawn a shade lighter or
 * darker from one picture to the next, one level of 255 in a few pixels.
 * A change of the theme moves a pixel by far more than the four levels
 * that are let through here.
 */
function alike(before: Buffer, after: Buffer): Promise<boolean> {
  if (before.equals(after)) return Promise.resolve(true)
  return page.evaluate(
    async ([a, b]) => {
      const pixels = async (source: string) => {
        const image = new Image()
        image.src = `data:image/png;base64,${source}`
        await image.decode()
        const canvas = document.createElement("canvas")
        canvas.width = image.width
        canvas.height = image.height
        const context = canvas.getContext("2d")
        if (!context) throw new Error("no canvas to read a picture with")
        context.drawImage(image, 0, 0)
        return context.getImageData(0, 0, image.width, image.height)
      }
      const [p, q] = [await pixels(a), await pixels(b)]
      if (p.width !== q.width || p.height !== q.height) return false
      for (let i = 0; i < p.data.length; i++)
        if (Math.abs(p.data[i] - q.data[i]) > 4) return false
      return true
    },
    [before.toString("base64"), after.toString("base64")],
  )
}
/** The shown appearances in which two sets of pictures are the same. */
async function unchanged(before: Buffer[], after: Buffer[]) {
  const same = await Promise.all(
    seen.map((_, index) => alike(before[index], after[index])),
  )
  return seen.filter((_, index) => same[index])
}

/** Sets one key by hand, and waits for the frames to hold the theme it gives. */
async function set(key: string, value: string) {
  if (FAMILIES.includes(key)) await own(key).check()
  await field(key).fill(value)
}
async function rest(key: string) {
  if (FAMILIES.includes(key)) await own(key).uncheck()
  else await field(key).fill("")
}

const ACCENT = "#7c3aed"
const blind: string[] = []
const samePalette: string[] = []
let tried = 0
let pressed = 0
let roles = 0
let named = 0

const code = await s.run(async () => {
  await s.open("/theme-builder/")

  // The same for each choice of what is shown: the dark frame alone, as the
  // page opens, both, and the light one alone. A frame alone has the width
  // of both, so what is seen of it is not what is seen of it beside the other.
  for (const choice of SHOWN) {
    await showAppearances(page, choice)
    seen = APPEARANCES.filter((a) => choice === "both" || choice === a)
    showing = choice
    // The place in the sheet follows from one choice to the next, and this
    // is about what is seen where the page opens.
    for (const appearance of APPEARANCES)
      await (await frame(appearance).elementHandle())
        ?.contentFrame()
        .then((content) => content?.evaluate(() => window.scrollTo(0, 0)))

    // As a visitor meets it: the frames that are shown, with the components,
    // at the top.
    const at = await Promise.all(
      seen.map(async (appearance) => {
        const handle = await frame(appearance).elementHandle()
        const content = await handle?.contentFrame()
        const box = await handle?.boundingBox()
        return {
          appearance,
          url: content?.url() ?? "",
          scrolled: content
            ? await content.evaluate(() => window.scrollY)
            : Number.NaN,
          seen:
            box !== null &&
            box !== undefined &&
            box.width > 100 &&
            box.height > 100,
        }
      }),
    )
    expect(
      at.every(
        (f) =>
          f.url.includes("/theme-builder/sheet/") && f.scrolled === 0 && f.seen,
      ),
      `the frames do not open on the component sheet, at its top, where they are seen: ${JSON.stringify(at)}`,
    )
    expect(
      await framesHold(page, null),
      "the frames hold a theme with nothing set",
    )

    // A picture that moves by itself would be told from nothing.
    const atRest = await pictures()
    await page.waitForTimeout(700)
    const still = await pictures()
    const steady = await unchanged(atRest, still)
    expect(
      steady.length === seen.length,
      `what is seen of the frames changes while nothing is set, in ${seen.filter((a) => !steady.includes(a)).join(" and ")}: the check cannot tell a change from that`,
    )
    if (steady.length !== seen.length) continue

    // Every key, one at a time, from rest.
    for (const key of KEYS) {
      const value = farFrom(key)
      await set(key, value)
      const built = buildTheme(nested({ [key]: value })).css
      const held = await framesHold(page, built)
      expect(
        held,
        `${key} set to ${value}: the frames do not hold the theme it gives`,
      )
      if (held) {
        const after = await pictures()
        const same = await unchanged(atRest, after)
        expect(
          same.length === 0,
          `${key} set to ${value} changes nothing that is seen in the ${same.join(" and the ")} frame`,
        )
        if (same.length > 0)
          blind.push(`${key} (${showing}: ${same.join(", ")})`)
        tried += 1
      }
      await rest(key)
      expect(
        await framesHold(page, null),
        `${key} put back to rest: the frames still hold a theme`,
      )
    }
    // And the page at rest is what it was: nothing above leaked into the next.
    expect(
      (await unchanged(atRest, await pictures())).length === seen.length,
      "after every key was set and put back, what is seen of the frames is not what it was at rest",
    )

    // Each palette pressed after another changes what is seen.
    await set("accent", ACCENT)
    expect(
      await framesHold(page, buildTheme({ accent: ACCENT }).css),
      "with an accent, the frames do not hold its theme",
    )
    const answer = suggestPalettes({ accent: ACCENT })
    expect(
      answer !== null && answer.palettes.length >= 5,
      "the package suggests fewer than five palettes for the accent",
    )
    let before = await pictures()
    let last = "the accent alone"
    for (const palette of answer?.palettes ?? []) {
      const filled = Object.fromEntries(
        palette.colors.filter((c) => !c.kept).map((c) => [c.family, c.color]),
      )
      await page
        .locator("[data-palettes] button[data-palette]")
        .filter({ hasText: new RegExp(`^\\s*${palette.name}`) })
        .click()
      const held = await framesHold(
        page,
        buildTheme({ accent: ACCENT, ...filled }).css,
      )
      expect(
        held,
        `${palette.name} pressed: the frames do not hold the theme of the accent and the palette`,
      )
      if (!held) continue
      const after = await pictures()
      const same = await unchanged(before, after)
      expect(
        same.length === 0,
        `${palette.name} pressed after ${last} changes nothing that is seen in the ${same.join(" and the ")} frame`,
      )
      if (same.length > 0)
        samePalette.push(
          `${palette.name} after ${last} (${showing}: ${same.join(", ")})`,
        )
      before = after
      last = palette.name
      pressed += 1
    }

    // Back to rest for the next choice.
    await page.locator("[data-palettes] button[data-palette-default]").click()
    await rest("accent")
    expect(
      await framesHold(page, null),
      "after the palettes were tried and put away, the frames still hold a theme",
    )
  }
  showing = ""
  await showAppearances(page, "both")
  seen = [...APPEARANCES]

  // The block at the top: every role of every family, painted with the
  // value the package gives that token for the recipe on the page.
  const recipe = {
    accent: ACCENT,
    neutral: "#5c4a1e",
    danger: "#c2185b",
    brand2: "#0d7a5f",
  }
  await page.locator("[data-palettes] button[data-palette-default]").click()
  for (const [family, colour] of Object.entries(recipe))
    await set(family, colour)
  const theme = buildTheme(recipe)
  expect(
    await framesHold(page, theme.css),
    "with four colours set, the frames do not hold their theme",
  )
  const painted = (hex: string) =>
    `rgb(${[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(", ")})`
  for (const appearance of APPEARANCES) {
    const content = await (
      await frame(appearance).elementHandle()
    )?.contentFrame()
    const shown = content
      ? await content.evaluate(() =>
          [
            ...document.querySelectorAll<HTMLElement>(
              "[data-glance] li[data-family]",
            ),
          ].map((ramp) => ({
            family: ramp.dataset.family ?? "",
            roles: [...ramp.querySelectorAll<HTMLElement>("[data-role]")].map(
              (role) => ({
                role: role.dataset.role ?? "",
                paint: getComputedStyle(role).backgroundColor,
                seen:
                  role.getBoundingClientRect().width >= 4 &&
                  role.getBoundingClientRect().height >= 4 &&
                  role.getBoundingClientRect().bottom <= window.innerHeight,
              }),
            ),
          })),
        )
      : []
    expect(
      JSON.stringify(shown.map((ramp) => ramp.family)) ===
        JSON.stringify(CONTRACT.families),
      `the ${appearance} frame: the block at the top has the families ${shown.map((ramp) => ramp.family).join(", ") || "none"}, expected the contract's in order`,
    )
    const wrong: string[] = []
    for (const ramp of shown) {
      if (
        JSON.stringify(ramp.roles.map((role) => role.role)) !==
        JSON.stringify(ROLES)
      )
        wrong.push(
          `${ramp.family} has the roles ${ramp.roles.map((role) => role.role).join(", ")}`,
        )
      for (const role of ramp.roles) {
        const token = `--lt-color-${ramp.family}-${role.role}`
        const value = theme[appearance][token]
        if (value === undefined) wrong.push(`the package has no ${token}`)
        else if (role.paint !== painted(value))
          wrong.push(
            `${token} is painted ${role.paint}, and the theme has ${value}`,
          )
        else if (!role.seen)
          wrong.push(`${token} is not within what is seen of the frame`)
        roles += 1
      }
    }
    expect(
      wrong.length === 0,
      `the ${appearance} frame: ${wrong.slice(0, 6).join("; ")}${wrong.length > 6 ? `, and ${wrong.length - 6} more` : ""}`,
    )
    // The names of the roles stand over the bars, for one who has no
    // pointer to ask each part with. Here beside the other frame, where
    // there is least room for them.
    const names = content ? await content.evaluate(readRoleNames) : null
    const faults = names ? roleNameFaults(names) : ["the frame has no document"]
    expect(
      faults.length === 0,
      `the ${appearance} frame, ${names?.window.width} pixels wide: ${faults.slice(0, 5).join("; ")}`,
    )
    named += names?.names.length ?? 0
  }
})

if (blind.length > 0)
  console.error(
    `\nKeys that change nothing a visitor sees without scrolling: ${blind.join("; ")}\n`,
  )
if (samePalette.length > 0)
  console.error(
    `\nPalettes that change nothing a visitor sees without scrolling: ${samePalette.join("; ")}\n`,
  )
if (code !== 0) process.exit(code)
const expected = CONTRACT.families.length * ROLES.length * APPEARANCES.length
if (
  tried !== KEYS.length * SHOWN.length ||
  pressed < 5 * SHOWN.length ||
  roles !== expected ||
  named !== ROLES.length * APPEARANCES.length ||
  points < 180
) {
  console.error(
    `✗ The check tried ${tried} of ${KEYS.length * SHOWN.length} keys, pressed ${pressed} palettes and read ${roles} of ${expected} roles. It has not looked at what it should.`,
  )
  process.exit(1)
}
console.log(
  `✓ Each of the ${KEYS.length} keys of the recipe and each of the five palettes changes what is seen of every shown frame of the theme builder without scrolling, with the dark frame alone, both and the light one alone, and the ${roles} roles at the top of the sheet are painted as the package builds them.`,
)
