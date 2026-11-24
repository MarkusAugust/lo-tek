/**
 * Writes `src/tokens/theme.schema.json`, the JSON Schema of a theme recipe,
 * from the keys described in `src/tokens/theme-keys.ts`.
 *
 * The schema is what an editor reads: VS Code and IntelliJ hold a
 * `lotek.theme.json` to it, show a key's `description` in the completion
 * list and on hover, and write its `default` when the key is completed. So
 * the description says both what the key is for and what holds when it is
 * left out, in that order, and `default` is there only where LO-TEK has one
 * value: an editor would write it into the file, and a value in the file is
 * the opposite of leaving the key out.
 *
 * Run with: bun scripts/generate-theme-schema.ts
 */

import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  type Block,
  isBlock,
  type Leaf,
  type Takes,
  THEME_KEYS,
} from "../src/tokens/theme-keys.js"

/** The package folder, which the paths of `files()` are relative to. */
export const ROOT = fileURLToPath(new URL("../", import.meta.url))

type Schema = Record<string, unknown>

/** What a schema requires of a value, for each thing a key can take. */
const TAKES: Record<Takes, Schema> = {
  colour: { type: "string", pattern: "^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$" },
  text: { type: "string" },
  textOrNumber: { type: ["string", "number"] },
  lengthOrZero: { anyOf: [{ type: "string" }, { type: "number", const: 0 }] },
}

const leaf = (key: Leaf): Schema => ({
  description: [key.purpose, key.written, key.leftOut]
    .filter(Boolean)
    .join(" "),
  ...TAKES[key.takes],
  ...(key.default === undefined ? {} : { default: key.default }),
})

const block = (key: Block): Schema => ({
  description: key.description,
  type: "object",
  additionalProperties: false,
  properties: properties(key.keys),
})

const properties = (keys: Record<string, Leaf | Block>): Schema =>
  Object.fromEntries(
    Object.entries(keys).map(([name, key]) => [
      name,
      isBlock(key) ? block(key) : leaf(key),
    ]),
  )

/** The schema, as the file has it. */
export function schema(): Schema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://lo-tek.sobernetics.no/theme.schema.json",
    title: "A LO-TEK theme recipe",
    description:
      "What `lotek theme` builds a theme from: a brand colour per family, and typography and shape. Everything is optional, and a family that is left out keeps LO-TEK's own hue. Written from src/tokens/theme-keys.ts by scripts/generate-theme-schema.ts. The core holds the keys, and its tests hold this file to them.",
    type: "object",
    additionalProperties: false,
    properties: {
      $schema: {
        description:
          "The address of this schema, for the editor. It says nothing about the theme.",
        type: "string",
      },
      ...properties(THEME_KEYS),
    },
  }
}

/** The files the generator writes, with the content they should have. */
export function files(): Record<string, string> {
  return {
    "src/tokens/theme.schema.json": `${JSON.stringify(schema(), null, 2)}\n`,
  }
}

if (import.meta.main) {
  for (const [path, content] of Object.entries(files())) {
    writeFileSync(join(ROOT, path), content)
  }
  console.log("✓ theme.schema.json, from the keys in theme-keys.ts")
}
