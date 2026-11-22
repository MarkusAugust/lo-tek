/**
 * `manifest.schema.json`: the schema at the address its own `$id` names.
 *
 * The schema says it is at `https://lo-tek.sobernetics.no/manifest.schema.json`,
 * and an editor that follows a `$schema` with that address fetches it from
 * here. The file is the one in the npm package, byte for byte:
 * `check-schemas.ts` compares the two.
 */

import type { APIRoute } from "astro"
import schema from "../../../interfaces/manifest/manifest.schema.json?raw"

export const GET: APIRoute = () =>
  new Response(schema, {
    headers: { "Content-Type": "application/schema+json; charset=utf-8" },
  })
