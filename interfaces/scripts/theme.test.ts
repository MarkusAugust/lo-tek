/**
 * That the theme says what it did with each brand colour, to the one who
 * calls `buildTheme` from `@lo-tek/interfaces/theme`.
 *
 * The rows are worked out in the core, and `core/scripts/check-core.ts` holds
 * the core to the expected results. What is tested here is the way out: that
 * the rows come through the entry point a consumer imports, with the names
 * the types give them, and that a recipe the core refuses is refused there.
 *
 * Run with: bun test ./scripts/, or as part of `bun run build`.
 */

import { expect, test } from "bun:test"
import {
  type Brand,
  type BrandFill,
  buildTheme,
  type ThemeInput,
} from "../src/tokens/theme.js"

test("a light brand colour comes back with what became of it", () => {
  const brands: Brand[] = buildTheme({ brand1: "#F7DF1E" }).brands
  expect(brands.length).toBe(1)
  const [brand] = brands
  expect(Object.keys(brand).sort()).toEqual([
    "dark",
    "family",
    "given",
    "light",
    "reasons",
    "summary",
  ])
  // What became of it, in the core's words: one line, and the reasons under
  // it. The types say text and a list of texts, and `tsc` holds them to it.
  const summary: string = brand.summary
  const reasons: string[] = brand.reasons
  expect(summary).toBe(
    "brand1: #f7df1e gives the fill #7a6d00 in the light theme and #a19100 in the dark theme.",
  )
  expect(reasons.length).toBe(3)
  expect(reasons[0]).toStartWith(
    "In the light theme #f7df1e cannot be the fill as it is: against the page it would have a contrast of 1.35:1, and 3.1:1 is required; ",
  )
  expect(reasons[2]).toBe(
    "In the dark theme the fill is less saturated than #f7df1e, with 74% of its chroma: a screen cannot show more at that lightness.",
  )
  expect(brand.family).toBe("brand1")
  expect(brand.given).toBe("#f7df1e")

  // The yellow is far too light to be the fill on a light page, and sRGB has
  // no room for its chroma at the lightness of the role.
  const light: BrandFill = brand.light
  expect(Object.keys(light).sort()).toEqual(["breaks", "chromaKept", "fill"])
  expect(light.fill).toBe("#7a6d00")
  expect(light.chromaKept).toBeCloseTo(0.608, 2)
  expect(light.breaks.map((b) => `${b.family}: ${b.promise}`)).toEqual([
    "brand1: fill on canvas",
    "brand1: fill on raised",
    "brand1: content on top of fill",
  ])
  expect(Object.keys(light.breaks[0]).sort()).toEqual([
    "family",
    "promise",
    "ratio",
    "required",
  ])
  expect(light.breaks[0].ratio).toBeCloseTo(1.35, 2)
  expect(light.breaks[0].required).toBe(3.1)

  const dark: BrandFill = brand.dark
  expect(dark.fill).toBe("#a19100")
  expect(dark.chromaKept).toBeCloseTo(0.745, 2)
  expect(dark.breaks).toEqual([])
})

test("the rows are the given families, in the order of the contract", () => {
  const { brands } = buildTheme({ danger: "#b91c1c", accent: "#7c3aed" })
  expect(brands.map((b) => b.family)).toEqual(["accent", "danger"])
})

test("a theme without colours has no rows, and still has the field", () => {
  expect(buildTheme({ shape: { buttonRadius: "1rem" } }).brands).toEqual([])
})

// The types refuse these, but a recipe read from a file has no types, and a
// typo that is dropped looks like a recipe that worked.
test("a key the recipe does not have is refused, and named", () => {
  expect(() => buildTheme({ acent: "#7c3aed" } as ThemeInput)).toThrow(
    new Error("Unknown key in the recipe: acent"),
  )
  expect(() =>
    buildTheme({
      accent: "#7c3aed",
      shape: { radius: "0" },
      typography: { weights: { blod: 700 } },
    } as ThemeInput),
  ).toThrow(
    new Error(
      "Unknown key in the recipe: typography.weights.blod, shape.radius",
    ),
  )
})

test("typography and shape without keys are not a theme", () => {
  expect(() => buildTheme({ typography: {}, shape: {} })).toThrow(
    new Error(
      "The theme is empty. Give either brand colours, or typography and shape.",
    ),
  )
})
