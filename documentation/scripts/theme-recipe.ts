/**
 * What the checks of the theme builder know about the recipe before they
 * open the page: the colour contract, and the keys of the schema.
 *
 * Two small files are read here and nothing else, so a check that only
 * needs the families does not read the stylesheets `theme-rest.ts` reads to
 * know where LO-TEK rests.
 */

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

type Schema = { properties?: Record<string, Schema> }
const schema = JSON.parse(
  readFileSync(`${ROOT}interfaces/src/tokens/theme.schema.json`, "utf8"),
) as Schema
const contract = JSON.parse(
  readFileSync(`${ROOT}interfaces/src/tokens/color-contract.json`, "utf8"),
) as {
  families: string[]
  brands: Record<string, string>
  roles: Record<string, unknown>
  layers: Record<string, unknown>
}
/** The colour contract, for the checks that read more of it than the families. */
export const CONTRACT = contract
/** The colour families, and LO-TEK's own colour for each. */
export const FAMILIES = contract.families
export const BRANDS = contract.brands

/** Every key of the recipe that takes a value, as a path with dots. */
function leaves(at: Schema, path = ""): string[] {
  return Object.entries(at.properties ?? {}).flatMap(([name, property]) =>
    path === "" && name === "$schema"
      ? []
      : property.properties
        ? leaves(property, `${path}${name}.`)
        : [`${path}${name}`],
  )
}
export const KEYS = leaves(schema)
