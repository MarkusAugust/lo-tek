/**
 * How `metadata.ts` puts the component files together.
 *
 * Run with: bun test ./scripts/, or as part of `bun run build`.
 */

import { expect, test } from "bun:test"
import { together } from "./metadata/shared"

test("the tables of the components become one, in the order of the components", () => {
  expect(
    together("classes", {
      card: { "lt-card": 1, "lt-card__title": 2 },
      badge: undefined,
      button: { "lt-button": 3 },
    }),
  ).toEqual({ "lt-card": 1, "lt-card__title": 2, "lt-button": 3 })
})

test("a name two components both describe stops the build, and names both", () => {
  expect(() =>
    together("classes", {
      card: { "lt-title": 1 },
      dialog: { "lt-title": 2 },
    }),
  ).toThrow("classes: lt-title is in both card.ts and dialog.ts.")
})
