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
import schema from "../src/tokens/theme.schema.json"

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
  description?: string
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
  expect(refused.length).toBeGreaterThan(3)
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

test("the font, the corners and the border are text, and never a list", () => {
  expect(
    valid({
      typography: { fontFamily: '"Segoe UI", Arial, sans-serif' },
      shape: {
        buttonRadius: "999px",
        fieldRadius: "0",
        surfaceRadius: "calc(0.5rem + 2px)",
        buttonBorderWidth: "2px",
      },
    }),
  ).toBe(true)
  expect(valid({ typography: { fontFamily: ["Arial"] } })).toBe(false)
  for (const key of [
    "buttonRadius",
    "fieldRadius",
    "surfaceRadius",
    "buttonBorderWidth",
  ])
    expect([key, valid({ shape: { [key]: true } })]).toEqual([key, false])
})

/*
 * The keys of the schema and of `ThemeInput`, both ways, in the five places.
 * `$schema` belongs to the file and not to the object `buildTheme` takes.
 * What a value may be is not compared: the schema describes JSON and the
 * type describes what TypeScript code should write.
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

test("the keys are the keys of ThemeInput, which tsc has checked", () => {
  expect(sameKeys).toEqual([true, true, true, true, true])
})
