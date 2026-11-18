/**
 * Writes the TypeScript types of the manifest from `manifest.schema.json`.
 *
 * The schema is where the shape of the manifest is written, by hand, since
 * it is what a reader in another language trusts. The types were written by
 * hand next to it, and nothing held the two to each other: the type lacked
 * `textLanguage` and `table`, and the generator cast the manifest it built
 * to the type. Now `src/vocabulary/manifest.ts` is written from the schema:
 * every definition in `$defs` becomes a type by the same name with a capital
 * letter, and the schema itself becomes `Manifest`. A `description` becomes
 * the comment on the type or the field.
 *
 * It knows the keywords the schema uses, and stops on any other, and on one
 * that stands beside the keyword that decides the type, so a constraint is
 * never silently left out of the types. What TypeScript cannot
 * say is left to the schema: `minItems`, `minimum`, `minLength`,
 * `minProperties`, `format`, and whether an object takes other fields than its own. A list
 * with as many `minItems` as `maxItems` is a tuple, and every list is
 * `readonly`.
 *
 * Run with: bun scripts/generate-manifest-types.ts, or as part of
 * `generate`. `check-manifest-schema.ts` does the same in memory and fails
 * if the file on disk is out of date.
 */

import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

export const ROOT = fileURLToPath(new URL("..", import.meta.url))

type Schema = { [keyword: string]: unknown }

/** The keywords that decide the type. */
const SHAPING = [
  "type",
  "const",
  "enum",
  "oneOf",
  "$ref",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "minItems",
  "maxItems",
]
/** The keywords that say something the types do not: read, and left to the schema. */
const SCHEMA_ONLY = [
  "$schema",
  "$id",
  "$defs",
  "title",
  "description",
  "format",
  "minimum",
  "minLength",
  "minProperties",
]
const KNOWN = new Set([...SHAPING, ...SCHEMA_ONLY])

const typeName = (definition: string) =>
  definition[0].toUpperCase() + definition.slice(1)

const WIDTH = 78

/**
 * A description as a comment, wrapped, with its paragraphs kept. A word that
 * starts with `@`, as the name of the package, never begins a line: there
 * TypeScript and the editors read it as a tag, and the text after it is cut
 * off. The word before it comes down with it.
 */
function comment(description: unknown, indent: string): string {
  if (typeof description !== "string") return ""
  const lines = description.split("\n").flatMap((paragraph) => {
    const out: string[] = []
    let line = ""
    for (const word of paragraph.split(" ")) {
      if (line && indent.length + 3 + line.length + 1 + word.length > WIDTH) {
        const before = word.startsWith("@") ? line.lastIndexOf(" ") : -1
        if (before > 0) {
          out.push(line.slice(0, before))
          line = `${line.slice(before + 1)} ${word}`
        } else {
          out.push(line)
          line = word
        }
      } else line = line ? `${line} ${word}` : word
    }
    if ([...out, line].some((written) => written.startsWith("@")))
      throw new Error(
        `A description has a line that starts with @, which a comment reads as a tag: "${paragraph.slice(0, 60)}"`,
      )
    return [...out, line]
  })
  // `*/` in a description would end the comment.
  const safe = lines.map((line) => line.replaceAll("*/", "*\\/"))
  return safe.length === 1 && indent.length + 7 + safe[0].length <= WIDTH
    ? `${indent}/** ${safe[0]} */\n`
    : `${indent}/**\n${safe.map((line) => `${indent} *${line ? ` ${line}` : ""}`).join("\n")}\n${indent} */\n`
}

/** The types of the manifest, as the text of a TypeScript file. */
export function manifestTypes(schema: Schema): string {
  const definitions = (schema.$defs ?? {}) as Record<string, Schema>

  /**
   * The keyword that decides the type stands with only the ones that belong
   * to it. Another one beside it, as `properties` next to a `oneOf`, would
   * be left out of the type without a word.
   */
  const alone = (
    node: Schema,
    at: string,
    what: string,
    companions: string[],
  ) => {
    for (const keyword of Object.keys(node))
      if (SHAPING.includes(keyword) && ![what, ...companions].includes(keyword))
        throw new Error(
          `${at}: "${keyword}" stands beside ${what}, and the types would leave it out. Write it inside, or as a definition of its own.`,
        )
  }

  const typeOf = (node: Schema, at: string, indent: string): string => {
    for (const keyword of Object.keys(node))
      if (!KNOWN.has(keyword))
        throw new Error(
          `${at}: the keyword "${keyword}" is not one generate-manifest-types.ts knows. Teach it what the keyword means for the type, or that it is left to the schema.`,
        )
    if (typeof node.$ref === "string") {
      alone(node, at, "$ref", [])
      const definition = node.$ref.replace("#/$defs/", "")
      // Its own, so `constructor` is not found on every object.
      if (!Object.keys(definitions).includes(definition))
        throw new Error(`${at}: ${node.$ref} is not in $defs`)
      return typeName(definition)
    }
    if ("const" in node) {
      alone(node, at, "const", [])
      return JSON.stringify(node.const)
    }
    if (Array.isArray(node.enum)) {
      alone(node, at, "enum", [])
      return node.enum.map((value) => JSON.stringify(value)).join(" | ")
    }
    if (Array.isArray(node.oneOf)) {
      alone(node, at, "oneOf", [])
      return node.oneOf
        .map((alternative, i) =>
          typeOf(alternative, `${at}, oneOf ${i}`, indent),
        )
        .join(" | ")
    }
    if (Array.isArray(node.type)) {
      alone(node, at, "type", [])
      return node.type.map((type) => typeOf({ type }, at, indent)).join(" | ")
    }
    switch (node.type) {
      case "string":
      case "boolean":
      case "null":
        alone(node, at, "type", [])
        return node.type
      case "integer":
      case "number":
        alone(node, at, "type", [])
        return "number"
      case "array": {
        alone(node, at, "type", ["items", "minItems", "maxItems"])
        if (!node.items) throw new Error(`${at}: a list without items`)
        const item = typeOf(node.items as Schema, `${at}, items`, indent)
        if (node.minItems !== undefined && node.minItems === node.maxItems)
          return `readonly [${Array(node.minItems).fill(item).join(", ")}]`
        if (node.maxItems !== undefined)
          throw new Error(
            `${at}: maxItems without the same minItems is not a tuple, and the types cannot say it`,
          )
        return `readonly ${item.includes(" ") ? `(${item})` : item}[]`
      }
      case "object": {
        alone(node, at, "type", [
          "properties",
          "required",
          "additionalProperties",
        ])
        const others = node.additionalProperties
        if (!node.properties) {
          if (node.required)
            throw new Error(`${at}: required without properties`)
          if (others === false) return "Record<string, never>"
          return others && typeof others === "object"
            ? `Record<string, ${typeOf(others as Schema, `${at}, each`, indent)}>`
            : "Record<string, unknown>"
        }
        if (others && typeof others === "object")
          throw new Error(
            `${at}: both properties and a schema for the other fields, which the types cannot say`,
          )
        const required = new Set((node.required as string[] | undefined) ?? [])
        const inner = `${indent}  `
        const fields = Object.entries(
          node.properties as Record<string, Schema>,
        ).map(([name, property]) => {
          const key = /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
            ? name
            : JSON.stringify(name)
          return `${comment(property.description, inner)}${inner}${key}${required.has(name) ? "" : "?"}: ${typeOf(property, `${at ? `${at}.` : ""}${name}`, inner)}`
        })
        for (const name of required)
          if (!(name in (node.properties as object)))
            throw new Error(`${at}: ${name} is required and has no schema`)
        return `{\n${fields.join("\n")}\n${indent}}`
      }
    }
    throw new Error(
      `${at}: neither a type, a const, an enum, a oneOf nor a $ref`,
    )
  }

  const types = [
    ...Object.entries(definitions).map(
      ([definition, node]) =>
        `${comment(node.description, "")}export type ${typeName(definition)} = ${typeOf(node, `$defs.${definition}`, "")}`,
    ),
    `${comment(schema.description, "")}export type Manifest = ${typeOf(schema, "", "")}`,
  ]
  return `// Generated by interfaces/scripts/generate-manifest-types.ts from manifest/manifest.schema.json. Do not edit.\n\n${types.join("\n\n")}\n`
}

/** The file with the types, by its path in the package. */
export function files(): Record<string, string> {
  const schema = JSON.parse(
    readFileSync(join(ROOT, "manifest/manifest.schema.json"), "utf8"),
  )
  return { "src/vocabulary/manifest.ts": manifestTypes(schema) }
}

if (import.meta.main) {
  for (const [path, content] of Object.entries(files())) {
    writeFileSync(join(ROOT, path), content)
    console.log(`Wrote ${path}`)
  }
}
