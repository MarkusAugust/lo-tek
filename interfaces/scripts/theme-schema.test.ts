/**
 * That `theme.schema.json` tells the truth about the recipe file.
 *
 * The schema is what an editor completes and checks `lotek.theme.json`
 * with, and it is written by hand, so nothing but these tests holds it to
 * what the core does. That its keys are the ones the core knows is a test in
 * the core, `the_schema_of_the_recipe_has_the_keys_the_core_knows`, where
 * the core's own lists are. Here:
 *
 * - it is a valid schema, with a description wherever an editor shows one,
 *   and the package exports it;
 * - it agrees with the expected results in `core/theme/recipes.json`, which
 *   the core is held to in Bun and on the JVM;
 * - its keys are the keys of `ThemeInput`. That one is checked by `tsc`,
 *   with `bun run typecheck:scripts`, and not when the test runs.
 *
 * Run with: bun test ./scripts/, or as part of `bun run build`.
 */

import { expect, test } from "bun:test"
import Ajv2020 from "ajv/dist/2020.js"
import recipes from "../../core/theme/recipes.json"
import pkg from "../package.json"
import type {
  ThemeInput,
  ThemeShape,
  ThemeTypography,
} from "../src/tokens/theme.js"
import { buildTheme, checkRecipe } from "../src/tokens/theme.js"
import schema from "../src/tokens/theme.schema.json"
import { leaves as keys } from "../src/tokens/theme-keys.js"
import { files, ROOT } from "./generate-theme-schema"
import { outOfDate } from "./on-disk"
import {
  FOLLOWS,
  HAS_OWN_FONT,
  LEFT_OUT,
  SURFACE_CORNERS,
  unread,
} from "./theme-left-out"
import structure from "./theme-schema.structure.json"

// Strict, so a keyword the draft does not have stops the compilation
// rather than being ignored. Compiling also holds the schema to the
// meta-schema of the draft. A list of types is in the draft, and is how
// "text or a number" is written, so that one is allowed.
const validate = new Ajv2020({
  allErrors: true,
  strict: true,
  allowUnionTypes: true,
}).compile(schema)
const valid = (recipe: unknown) => validate(recipe) as boolean

type Described = {
  title?: string
  description?: string
  default?: unknown
  examples?: unknown[]
  properties?: Record<string, Described>
}

/** Every property in the schema, with the path to it. */
function properties(at: Described, path = ""): [string, Described][] {
  return Object.entries(at.properties ?? {}).flatMap(([name, property]) => [
    [`${path}${name}`, property] as [string, Described],
    ...properties(property, `${path}${name}.`),
  ])
}

test("it is a draft 2020-12 schema with the address it is published at", () => {
  expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema")
  expect(schema.$id).toBe("https://lo-tek.sobernetics.no/theme.schema.json")
  expect(schema.title.trim()).not.toBe("")
  expect(schema.description.trim()).not.toBe("")
})

test("every property has a description for the editor to show", () => {
  const all = properties(schema)
  // The nine families, three more at the top and sixteen below them. A walk
  // that found nothing would otherwise find nothing missing.
  expect(all.length).toBeGreaterThan(20)
  expect(
    all.filter(([, p]) => !p.description?.trim()).map(([path]) => path),
  ).toEqual([])
})

test("the package exports it, from where the colour contract is", () => {
  expect((pkg.exports as Record<string, unknown>)["./theme.schema.json"]).toBe(
    "./src/tokens/theme.schema.json",
  )
})

test("no key is required, and a recipe may name its schema", () => {
  expect(valid({})).toBe(true)
  expect(valid({ $schema: schema.$id, typography: {}, shape: {} })).toBe(true)
  expect(valid({ typography: { weights: {}, lineHeights: {} } })).toBe(true)
  // Only at the top: the core refuses it anywhere else.
  expect(valid({ shape: { $schema: schema.$id } })).toBe(false)
})

/*
 * The expected results fall in three groups. A recipe that gives a theme is
 * valid, and one the core refuses for an unknown key is not. The rest the
 * core refuses for something else, and the schema is free to see it or not:
 * the empty theme, a value that could break out of its CSS rule, and a
 * colour that is not a colour.
 */
const UNKNOWN_KEY = "Unknown key in the recipe: "
const cases = Object.entries(
  recipes as Record<string, { recipe: unknown; error?: string }>,
)

test("every recipe that gives a theme is valid", () => {
  const themes = cases.filter(([, c]) => c.error === undefined)
  expect(themes.length).toBeGreaterThan(4)
  expect(
    themes.filter(([, c]) => !valid(c.recipe)).map(([name]) => name),
  ).toEqual([])
})

test("every recipe the core refuses for an unknown key is invalid", () => {
  const refused = cases.filter(([, c]) => c.error?.startsWith(UNKNOWN_KEY))
  expect(refused.length).toBeGreaterThan(1)
  expect(
    refused.filter(([, c]) => valid(c.recipe)).map(([name]) => name),
  ).toEqual([])
})

test("a colour is three or six hexadecimal digits after a hash", () => {
  for (const colour of ["#7c3aed", "#7C3AED", "#f0a", "#FFF"])
    expect([colour, valid({ accent: colour })]).toEqual([colour, true])
  for (const colour of ["purple", "7c3aed", "#7c3aed00", "#ffff", "#ggg", ""])
    expect([colour, valid({ accent: colour })]).toEqual([colour, false])
  for (const colour of [12, true, null, ["#fff"]])
    expect([colour, valid({ danger: colour })]).toEqual([colour, false])
})

test("a weight and a line height are text or a number", () => {
  for (const value of [600, "600", "bold", 1.5]) {
    const recipe = {
      typography: { weights: { bold: value }, lineHeights: { article: value } },
      shape: { buttonFontWeight: value },
    }
    expect([value, valid(recipe)]).toEqual([value, true])
  }
  for (const value of [true, null, [600], {}]) {
    expect(valid({ typography: { weights: { bold: value } } })).toBe(false)
    expect(valid({ typography: { lineHeights: { article: value } } })).toBe(
      false,
    )
    expect(valid({ shape: { buttonFontWeight: value } })).toBe(false)
  }
})

test("the font is text, and never a list", () => {
  expect(
    valid({ typography: { fontFamily: '"Segoe UI", Arial, sans-serif' } }),
  ).toBe(true)
  expect(valid({ typography: { fontFamily: ["Arial"] } })).toBe(false)
})

/*
 * A corner and a border width are written into the CSS as they stand, and
 * `--lt-button-radius: 1;` is not a length: `0` is the only number CSS takes
 * without a unit. The schema is what tells the one who writes `4` before the
 * theme is built and the corners are simply not there.
 */
const LENGTHS = [
  "buttonRadius",
  "fieldRadius",
  "surfaceRadius",
  "buttonBorderWidth",
]

test("a corner and a border width are text, or the number 0", () => {
  for (const key of LENGTHS) {
    for (const value of ["999px", "0", "calc(0.5rem + 2px)", 0])
      expect([key, value, valid({ shape: { [key]: value } })]).toEqual([
        key,
        value,
        true,
      ])
    for (const value of [1, 4, 0.5, -1, true, null, ["4px"]])
      expect([key, value, valid({ shape: { [key]: value } })]).toEqual([
        key,
        value,
        false,
      ])
  }
})

/*
 * What a key is when it is left out is a fact about LO-TEK, and the schema
 * states it twice, for two readers: with `default`, which an editor writes
 * when it completes the key and the theme builder rests a field at, and in
 * the description, which is what an editor shows on hover, since it shows
 * no default. Both are held to what LO-TEK does, read from the tokens and
 * the component stylesheets in `theme-left-out.ts`, and to each other.
 */
/** The keys that take a value, with their part of the schema, by path. */
const leaves = properties(schema).filter(
  ([path, part]) => !part.properties && path !== "$schema",
)
/** A value of the schema as LO-TEK writes it in a stylesheet. */
const written = (value: unknown) => String(value)
/** The recipe with one key in it, nested as the recipe nests it. */
const only = (path: string, value: unknown) =>
  path
    .split(".")
    .reduceRight<unknown>((inner, part) => ({ [part]: inner }), value)

test("a default is what LO-TEK has when the key is left out, and every such key has one", () => {
  expect(unread).toEqual([])
  const defaults = Object.fromEntries(
    leaves
      .filter(([, part]) => "default" in part)
      .map(([path, part]) => [path, written(part.default)]),
  )
  expect(defaults).toEqual(LEFT_OUT)
  // A weight and a line height are numbers, as a recipe file writes them.
  for (const [path, part] of leaves)
    if (/^typography\.(weights|lineHeights)\./.test(path))
      expect([path, typeof part.default]).toEqual([path, "number"])
})

test("a key with no one value has no default, and nothing an editor would complete it with", () => {
  const without = leaves
    .filter(([path, part]) => path.includes(".") && !("default" in part))
    .map(([path]) => path)
  expect(without.sort()).toEqual([
    "shape.buttonFontWeight",
    "shape.surfaceRadius",
    "typography.fontFamily",
  ])
  // An editor completes a key without a default with its first example,
  // and a value written into the file is the opposite of leaving it out.
  // A colour has neither: a family that is left out keeps LO-TEK's own.
  for (const [path, part] of leaves) {
    expect([path, "examples" in part]).toEqual([path, false])
    if (!path.includes("."))
      expect([path, "default" in part]).toEqual([path, false])
  }
})

/*
 * The schema is not written by hand. An editor shows one text for a key,
 * its `description`, on hover and in the list of keys it offers, and the
 * theme builder needs the first half of that text without the second: what
 * a key is for, without what holds when it is left out. One text cannot
 * serve both unless somebody cuts it at a full stop. So the two halves are
 * data in `src/tokens/theme-keys.ts`, the page reads them there, and the
 * schema is written from them by `generate-theme-schema.ts`.
 */
test("the schema on disk is what the generator writes from the source", () => {
  expect(outOfDate(ROOT, files())).toEqual([])
  expect(Object.keys(files())).toEqual(["src/tokens/theme.schema.json"])
  // And it says so, where it used to say it was written by hand.
  expect(schema.description).not.toMatch(/by hand/i)
  expect(schema.description).toContain("theme-keys.ts")
})

test("a key's description is what it is for, and then what holds when it is left out", () => {
  const source = keys()
  // The same keys, in the same order.
  expect(source.map((key) => key.path.join("."))).toEqual(
    leaves.map(([path]) => path),
  )
  for (const key of source) {
    const path = key.path.join(".")
    const part = leaves.find(([p]) => p === path)?.[1]
    expect([
      path,
      key.purpose.trim() !== "",
      /left out/i.test(key.leftOut),
    ]).toEqual([path, true, true])
    // The purpose is not about leaving out: the page shows it alone.
    expect([path, /left out/i.test(key.purpose)]).toEqual([path, false])
    // How the value is written is said between the two where it is the same
    // for many keys and too long for under each field: the page shows the
    // purpose alone, and an editor shows all of it.
    expect([path, part?.description]).toEqual([
      path,
      [key.purpose, key.written, key.leftOut]
        .filter((sentence) => sentence !== undefined)
        .join(" "),
    ])
    expect([path, /left out/i.test(key.written ?? "")]).toEqual([path, false])
    expect([path, (key.written ?? "x").trim() !== ""]).toEqual([path, true])
    expect([path, part?.default]).toEqual([path, key.default])
    // An editor completes a key with a title-less, example-less entry.
    expect([path, "title" in (part ?? {}), "examples" in (part ?? {})]).toEqual(
      [path, false, false],
    )
  }
})

test("generating changed what a key says, and nothing of what a recipe may be", () => {
  // What the schema validates is what it validated before it was
  // generated: the keys, the types, the patterns and what is closed. The
  // expectation is the schema of the release it came from, with everything
  // that only describes taken out.
  const strip = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(strip)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .filter(
                ([key]) =>
                  !["description", "title", "default", "examples"].includes(
                    key,
                  ),
              )
              .map(([key, inner]) => [key, strip(inner)]),
          )
        : value
  expect(strip(schema)).toEqual(structure)
})

test("the description states the default, so hover and completion cannot disagree", () => {
  // The value as a whole: not part of a longer number or word, so 700 is
  // not stated by 1700 or 700.5, and is by "700." at the end of a sentence.
  const stated = (text: string, value: string) =>
    new RegExp(
      `(?<![0-9a-z.])${value.replace(/[.]/g, "\\.")}(?![0-9a-z])(?!\\.[0-9])`,
      "i",
    ).test(text)
  for (const [path, part] of leaves) {
    if (!("default" in part)) continue
    expect([
      path,
      part.description,
      stated(part.description ?? "", written(part.default)),
    ]).toEqual([path, part.description, true])
  }
  // The helper itself: 700 is not stated by 1700 or 700.5, and is by "700.".
  expect([
    stated("it is 1700.", "700"),
    stated("it is 700.5", "700"),
    stated("Left out, it is 700.", "700"),
    stated("Left out, it is 1.5.", "1.5"),
  ]).toEqual([false, false, true, true])
})

test("where a key has no one value, the description says what LO-TEK does instead", () => {
  const description = (path: string) =>
    leaves.find(([p]) => p === path)?.[1].description ?? ""
  const words = (component: string) => component.replace(/-/g, " ")

  // The surfaces: every corner one of them has, and which surfaces have
  // another than most. A surface that changes its corner changes this.
  const corners = Object.entries(SURFACE_CORNERS).sort(
    ([, a], [, b]) => b.length - a.length,
  )
  expect(corners.length).toBeGreaterThan(1)
  for (const [value, surfaces] of corners) {
    expect([value, description("shape.surfaceRadius").includes(value)]).toEqual(
      [value, true],
    )
    if (surfaces !== corners[0][1])
      for (const surface of surfaces)
        expect([
          surface,
          description("shape.surfaceRadius").includes(words(surface)),
        ]).toEqual([surface, true])
  }
  // It does not state one of them as if it were the value of the key.
  expect(/left out, it is /i.test(description("shape.surfaceRadius"))).toBe(
    false,
  )

  // The weight of the button text follows another key, and the font is the
  // page's: LO-TEK sets none of its own.
  expect(Object.keys(FOLLOWS)).toEqual(["shape.buttonFontWeight"])
  expect(description("shape.buttonFontWeight")).toContain(
    FOLLOWS["shape.buttonFontWeight"],
  )
  expect(HAS_OWN_FONT).toBe(false)
  expect(description("typography.fontFamily")).toMatch(/inherit/i)
})

test("the core takes every default, alone and together", () => {
  const all: Record<string, unknown> = {}
  for (const [path, part] of leaves) {
    if (!("default" in part)) continue
    const value = part.default
    expect([path, checkRecipe(only(path, value))]).toEqual([path, []])
    expect([path, valid(only(path, value))]).toEqual([path, true])
    // Together: the recipe of every default.
    const parts = path.split(".")
    let at = all
    for (const part of parts.slice(0, -1)) {
      at[part] ??= {}
      at = at[part] as Record<string, unknown>
    }
    at[parts[parts.length - 1]] = value
  }
  expect(Object.keys(all).sort()).toEqual(["shape", "typography"])
  expect(buildTheme(all as never).css).toContain("--lt-font-weight-bold: 700;")
})

/*
 * The keys of the schema and of `ThemeInput`, both ways, in the five places.
 * `$schema` belongs to the file and not to the object `buildTheme` takes.
 * What a value may be is not compared, with one exception below: the schema
 * describes JSON and the type describes what TypeScript code should write.
 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Keys<S extends { properties: object }> = keyof S["properties"]
type Top = typeof schema
type Typography = Top["properties"]["typography"]
type Shape = Top["properties"]["shape"]

const sameKeys: [
  Same<Exclude<Keys<Top>, "$schema">, keyof ThemeInput>,
  Same<Keys<Typography>, keyof ThemeTypography>,
  Same<
    Keys<Typography["properties"]["weights"]>,
    keyof NonNullable<ThemeTypography["weights"]>
  >,
  Same<
    Keys<Typography["properties"]["lineHeights"]>,
    keyof NonNullable<ThemeTypography["lineHeights"]>
  >,
  Same<Keys<Shape>, keyof ThemeShape>,
] = [true, true, true, true, true]

// The exception: a length is text or `0` in the type too, so `tsc` stops
// `buttonRadius: 4` where the schema would have.
const lengths: [
  Same<NonNullable<ThemeShape["buttonRadius"]>, string | 0>,
  Same<NonNullable<ThemeShape["fieldRadius"]>, string | 0>,
  Same<NonNullable<ThemeShape["surfaceRadius"]>, string | 0>,
  Same<NonNullable<ThemeShape["buttonBorderWidth"]>, string | 0>,
] = [true, true, true, true]

test("a length is text or 0 in ThemeShape, which tsc has checked", () => {
  expect(lengths).toEqual([true, true, true, true])
})

test("the keys are the keys of ThemeInput, which tsc has checked", () => {
  expect(sameKeys).toEqual([true, true, true, true, true])
})
