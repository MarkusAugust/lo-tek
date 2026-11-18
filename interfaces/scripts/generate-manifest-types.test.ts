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

test("fields beside a oneOf stop it, since the types would leave them out", () => {
  expect(() =>
    manifestTypes({
      type: "object",
      properties: {
        returns: {
          oneOf: [{ type: "string" }, { type: "boolean" }],
          properties: { optional: { type: "boolean" } },
        },
      },
    }),
  ).toThrow('returns: "properties" stands beside oneOf')
})

test("fields beside a $ref stop it too", () => {
  expect(() =>
    manifestTypes({
      type: "object",
      properties: {
        part: { $ref: "#/$defs/part", required: ["selector"] },
      },
      $defs: { part: { type: "object" } },
    }),
  ).toThrow('part: "required" stands beside $ref')
})

test("a name every object has is not a definition", () => {
  expect(() =>
    manifestTypes({
      type: "object",
      properties: { made: { $ref: "#/$defs/constructor" } },
    }),
  ).toThrow("made: #/$defs/constructor is not in $defs")
})

test("an object that takes no fields is typed as taking none", () => {
  const types = manifestTypes({
    type: "object",
    properties: {
      nothing: { type: "object", additionalProperties: false },
      anything: { type: "object" },
    },
  })
  expect(types).toContain("nothing?: Record<string, never>")
  expect(types).toContain("anything?: Record<string, unknown>")
})

test("no line of a comment starts with @, which would read as a tag", () => {
  // Every width the name of the package can land on is tried.
  for (let lead = 40; lead < 90; lead++) {
    const types = manifestTypes({
      type: "object",
      description: `${"a ".repeat(lead)}@lo-tek/interfaces the manifest was written from.`,
    })
    expect(types).not.toMatch(/^\s*\* @/m)
    expect(types.replace(/\s*\n\s*\*\s*/g, " ")).toContain(
      "a @lo-tek/interfaces the manifest",
    )
  }
})

test("how long a text must be is left to the schema, and the type is a text", () => {
  expect(
    manifestTypes({
      type: "object",
      properties: { version: { type: "string", minLength: 1 } },
    }),
  ).toContain("version?: string")
})
