/**
 * The type generator refuses what it cannot write. What the types it writes
 * accept and reject is in `manifest-types.fixture.ts`, where `tsc` is the
 * judge.
 *
 * Run with: bun test ./scripts/, or as part of `bun run build`.
 */

import { expect, test } from "bun:test"
import { manifestTypes } from "./generate-manifest-types"

test("a keyword the generator does not know stops it, with where it stands", () => {
  expect(() =>
    manifestTypes({
      type: "object",
      properties: { version: { type: "string", pattern: "^\\d+$" } },
    }),
  ).toThrow('version: the keyword "pattern"')
})

test("a schema that says nothing about the value stops it", () => {
  expect(() =>
    manifestTypes({
      type: "object",
      properties: { version: { description: "Any value at all." } },
    }),
  ).toThrow("version: neither a type, a const, an enum, a oneOf nor a $ref")
})

test("a reference to a definition that is not there stops it", () => {
  expect(() =>
    manifestTypes({
      type: "object",
      properties: { part: { $ref: "#/$defs/part" } },
    }),
  ).toThrow("part: #/$defs/part is not in $defs")
})
