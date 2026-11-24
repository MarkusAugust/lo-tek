/**
 * That the theme builder says so, at the field, when the core refuses what
 * is in it, and keeps what it had built.
 *
 * Most of what is typed on the way to a value is not one: `#7c3a` on the
 * way to `#7c3aed`, a radius while its unit is half written. A builder that
 * went blank for each of them would flicker through every keystroke, and
 * one that said nothing would leave the reader looking at an old theme
 * without knowing it. So, while a value is refused:
 *
 * - its field is marked invalid, and an error text wired to it says what
 *   the core answers. The words are the core's own: `buildTheme` from the
 *   package is run here on a recipe with that one key, and its message is
 *   what the page must show;
 * - no other field is marked, and a family whose switch is off never is;
 * - the frames keep the last theme that was built, byte for byte;
 * - there is no `theme.css` to take away.
 *
 * And when the value is one the core takes, all of it is gone again.
 *
 * Run with: bun documentation/scripts/check-theme-refusals.ts
 * Requires `documentation/dist` to be built.
 */

import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { site } from "./site"
import { fieldOn, nested, ownOn, themesInFrames, untilOn } from "./theme-page"
import { FAMILIES } from "./theme-recipe"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

if (!existsSync(`${ROOT}documentation/dist/theme-builder/index.html`)) {
  console.error(
    "✗ dist/theme-builder/index.html is not built. The site is built with bun run build.",
  )
  process.exit(1)
}

const { buildTheme, checkRecipe } = (await import(
  `${ROOT}interfaces/dist/tokens/theme.js`
)) as {
  buildTheme(recipe: unknown): { css: string }
  checkRecipe(
    recipe: unknown,
  ): { path: string[]; kind: string; message: string }[]
}
if (typeof checkRecipe !== "function") {
  console.error(
    "✗ The package has no checkRecipe. Is interfaces/dist built from this commit?",
  )
  process.exit(1)
}

/** The recipe with one key in it, nested as the recipe nests it. */
function only(key: string, value: string): Record<string, unknown> {
  return key
    .split(".")
    .reduceRight<unknown>(
      (inner, part) => ({ [part]: inner }),
      value,
    ) as Record<string, unknown>
}

/** What the core answers for a value alone, or nothing when it takes it. */
function refusal(key: string, value: string): string | null {
  try {
    buildTheme(only(key, value))
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/*
 * The values that are tried, each in the field it is typed into. Every one
 * must be refused by the core here, or the case tests nothing.
 */
const REFUSED: [string, string, string][] = [
  ["a colour that is not one yet", "accent", "#7c3a"],
  ["a colour that is no colour", "accent", "purple"],
  [
    "a radius that could break out of its rule",
    "shape.buttonRadius",
    "4px; } html { display: none",
  ],
  ["a font with an unclosed parenthesis", "typography.fontFamily", "Arial ("],
]
for (const [name, key, value] of REFUSED) {
  if (refusal(key, value) === null) {
    console.error(
      `✗ The core takes ${JSON.stringify(value)} for ${key}, so "${name}" is not a refused value. The check is older than the core.`,
    )
    process.exit(1)
  }
}

const s = await site({ pages: 1 })
const page = s.page
const expect = (claim: boolean, description: string) => {
  if (!claim) s.fail(description)
}

const field = fieldOn(page)
const own = ownOn(page)

/** Runs in the builder. The fields that are marked, and what each is told. */
function marks() {
  const collapsed = (text: string) => text.replace(/\s+/g, " ").trim()
  const marked: Record<string, string> = {}
  for (const control of document.querySelectorAll<HTMLElement>(
    "input[name], select[name], textarea[name]",
  )) {
    if (control.getAttribute("aria-invalid") !== "true") continue
    marked[control.getAttribute("name") ?? ""] = (
      control.getAttribute("aria-describedby") ?? ""
    )
      .split(/\s+/)
      .map((id) => (id ? document.getElementById(id) : null))
      // What is not rendered is not said.
      .filter((text) => text && text.getClientRects().length > 0)
      .map((text) => collapsed(text?.textContent ?? ""))
      .join(" ")
  }
  const link = document.querySelector<HTMLAnchorElement>(
    'a[download="theme.css"]',
  )
  return {
    marked,
    /** Whether there is a `theme.css` to follow. */
    offered:
      link !== null &&
      (link.getAttribute("href") ?? "") !== "" &&
      link.getClientRects().length > 0,
  }
}

const themes = () => themesInFrames(page)

const until = <T>(read: () => Promise<T>, done: (state: T) => boolean) =>
  untilOn(page, read, done)

const both = (css: string | null) => (held: string[][]) =>
  held.every((frame) =>
    css === null ? frame.length === 0 : frame.length === 1 && frame[0] === css,
  )

let cases = 0

const code = await s.run(async () => {
  await s.open("/theme-builder/")

  // From nothing, whatever the page remembers.
  for (const family of FAMILIES) await own(family).uncheck()
  for (const [, key] of REFUSED)
    if (!FAMILIES.includes(key)) await field(key).fill("")

  // An empty recipe is not a mistake.
  const atStart = await until(
    () => page.evaluate(marks),
    (state) => Object.keys(state.marked).length === 0,
  )
  expect(
    Object.keys(atStart.marked).length === 0,
    `with nothing chosen, fields are marked invalid: ${Object.keys(atStart.marked).join(", ")}`,
  )

  // Something that builds, so there is a last theme to keep.
  const built = { brand2: "#0f766e" }
  await own("brand2").check()
  await field("brand2").fill(built.brand2)
  const last = buildTheme(built).css
  expect(
    both(last)(await until(themes, both(last))),
    "the frames do not hold the theme of a recipe that builds, so there is nothing to keep",
  )

  for (const [name, key, value] of REFUSED) {
    const message = refusal(key, value) ?? ""
    if (FAMILIES.includes(key)) await own(key).check()
    await field(key).fill(value)

    const now = await until(
      () => page.evaluate(marks),
      (state) => key in state.marked && state.marked[key].includes(message),
    )
    expect(key in now.marked, `${name}: the field ${key} is not marked invalid`)
    expect(
      (now.marked[key] ?? "").includes(message.replace(/\s+/g, " ")),
      `${name}: the field ${key} is not told what the core answers. It is told ${JSON.stringify(now.marked[key] ?? "")}, and the core says ${JSON.stringify(message)}`,
    )
    const others = Object.keys(now.marked).filter((other) => other !== key)
    expect(
      others.length === 0,
      `${name}: other fields are marked too: ${others.join(", ")}`,
    )
    expect(
      !now.offered,
      `${name}: the page offers a theme.css while a value is refused`,
    )
    // Given the time a theme takes to arrive, the frames still hold the last.
    await page.waitForTimeout(300)
    expect(
      both(last)(await themes()),
      `${name}: the frames no longer hold the last theme that was built`,
    )

    // Corrected by taking the value out again: the field is as it was.
    if (FAMILIES.includes(key)) {
      // A family that is switched off is never marked, whatever its field holds.
      await own(key).uncheck()
    } else await field(key).fill("")
    const after = await until(
      () => page.evaluate(marks),
      (state) => Object.keys(state.marked).length === 0 && state.offered,
    )
    expect(
      Object.keys(after.marked).length === 0,
      `${name}: fields are still marked after the value is gone: ${Object.keys(after.marked).join(", ")}`,
    )
    expect(
      after.offered,
      `${name}: the page offers no theme.css after the value is gone`,
    )
    cases += 1
  }

  // On the way to a colour: refused, taken, refused, taken. `#7c3` is a
  // colour, the short form of `#77cc33`.
  await own("accent").check()
  for (const typed of ["#7c", "#7c3", "#7c3a", "#7c3aed"]) {
    await field("accent").fill(typed)
    const refused = refusal("accent", typed) !== null
    const now = await until(
      () => page.evaluate(marks),
      (state) =>
        "accent" in state.marked === refused && state.offered !== refused,
    )
    expect(
      "accent" in now.marked === refused,
      `typing ${typed}: the field is ${"accent" in now.marked ? "" : "not "}marked, and the core ${refused ? "refuses" : "takes"} it`,
    )
    if (!refused) {
      const css = buildTheme({ ...built, accent: typed }).css
      expect(
        both(css)(await until(themes, both(css))),
        `typing ${typed}: the frames do not get the theme of the value the core takes`,
      )
    }
    cases += 1
  }

  /*
   * Several things wrong at once: each field is told its own, and at the
   * same time. The core says what is wrong with a recipe in one answer,
   * `checkRecipe`, problem by problem, and the page shows the sentence of
   * each refused value under the field of its key. The expected texts are the package's, for the recipe
   * that is on the page.
   */
  const several: Record<string, string> = {
    accent: "purple",
    "typography.fontFamily": "Arial (",
    "shape.buttonRadius": "4px; } html { display: none",
    "typography.weights.bold": "a;b",
  }
  for (const [key, value] of Object.entries(several)) {
    if (FAMILIES.includes(key)) await own(key).check()
    await field(key).fill(value)
  }
  const recipe = { ...built, ...nested(several) }
  // The refused values of the recipe, by the name of the field each is
  // under: a field is named by the parts of its key's path, with dots.
  const problems = checkRecipe(recipe)
  expect(
    Array.isArray(problems) && problems.every((p) => p.kind === "refused"),
    `the package's checkRecipe answers ${JSON.stringify(problems).slice(0, 200)} for values that are refused`,
  )
  const wrong: Record<string, string> = Object.fromEntries(
    (Array.isArray(problems) ? problems : []).map((p) => [
      p.path.join("."),
      p.message,
    ]),
  )
  expect(
    JSON.stringify(Object.keys(wrong).sort()) ===
      JSON.stringify(Object.keys(several).sort()),
    `the package's checkRecipe finds ${Object.keys(wrong).join(", ") || "nothing"} wrong, and the check typed ${Object.keys(several).join(", ")}: the check is older than the core`,
  )
  const all = await until(
    () => page.evaluate(marks),
    (state) =>
      Object.entries(wrong).every(([key, message]) =>
        (state.marked[key] ?? "").includes(message.replace(/\s+/g, " ")),
      ) && Object.keys(state.marked).length === Object.keys(wrong).length,
  )
  for (const [key, message] of Object.entries(wrong))
    expect(
      (all.marked[key] ?? "").includes(message.replace(/\s+/g, " ")),
      `with several things wrong, ${key} is told ${JSON.stringify(all.marked[key] ?? "nothing")}, and the core says ${JSON.stringify(message)}`,
    )
  const strangers = Object.keys(all.marked).filter((key) => !(key in wrong))
  expect(
    strangers.length === 0,
    `with several things wrong, fields the core says nothing about are marked: ${strangers.join(", ")}`,
  )
  expect(
    !all.offered,
    "the page offers a theme.css while several values are refused",
  )
  // Put right one at a time, the others stay told.
  await field("typography.fontFamily").fill("")
  const fewer = await until(
    () => page.evaluate(marks),
    (state) => !("typography.fontFamily" in state.marked),
  )
  expect(
    JSON.stringify(Object.keys(fewer.marked).sort()) ===
      JSON.stringify(
        Object.keys(wrong)
          .filter((key) => key !== "typography.fontFamily")
          .sort(),
      ),
    `with one of four put right, the fields marked are ${Object.keys(fewer.marked).join(", ") || "none"}`,
  )
  cases += 1
})

if (code !== 0) {
  console.error(
    "✗ The theme builder does not say what the core refuses, or does not keep what it had, or the check did not get to look.",
  )
  process.exit(code)
}

// The guard comes last.
if (cases !== REFUSED.length + 5) {
  console.error(
    `✗ The check went through ${cases} cases where it has ${REFUSED.length + 5}. It has not looked at everything.`,
  )
  process.exit(1)
}

console.log(
  `✓ The theme builder marks the field the core refuses, in the core's words, keeps the last theme in both frames and offers nothing to download meanwhile (${cases} cases).`,
)
