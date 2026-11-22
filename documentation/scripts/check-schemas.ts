/**
 * That the schemas are served at the addresses they name.
 *
 * Each schema says where it is with its `$id`, and that address is what an
 * editor fetches when a file names the schema in `$schema`, and what a
 * reader follows to see what the file may hold. An `$id` nobody serves is a
 * 404 for both, and nothing in the package notices: the file validates just
 * as well from `node_modules`.
 *
 * The path is read from the `$id` itself, so a schema that moves takes its
 * address with it, and the file on the site must be the package's, byte for
 * byte.
 *
 * Run with: bun documentation/scripts/check-schemas.ts
 * Requires `documentation/dist` to be built.
 */

import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const SITE = `${ROOT}documentation/dist`
/** Where the site is served. The schemas must name it, or they point elsewhere. */
const ORIGIN = "https://lo-tek.sobernetics.no"

const SCHEMAS = [
  "interfaces/src/tokens/theme.schema.json",
  "interfaces/manifest/manifest.schema.json",
]

const problems: string[] = []

if (!existsSync(`${SITE}/index.html`))
  problems.push("documentation/dist is not built. Run bun run build.")

for (const file of SCHEMAS) {
  const inThePackage = readFileSync(`${ROOT}${file}`)
  const id: unknown = JSON.parse(inThePackage.toString("utf8")).$id
  if (typeof id !== "string" || !URL.canParse(id)) {
    problems.push(`${file} has no $id that is an address: ${id}`)
    continue
  }
  const address = new URL(id)
  if (address.origin !== ORIGIN || address.search || address.hash) {
    problems.push(
      `${file} names ${id}, which is not a file on ${ORIGIN}, where the site is served`,
    )
    continue
  }
  let served: Buffer
  try {
    served = readFileSync(`${SITE}${decodeURIComponent(address.pathname)}`)
  } catch {
    problems.push(
      `${file} names ${id}, and the site has no ${address.pathname}: the address gives 404`,
    )
    continue
  }
  if (!served.equals(inThePackage))
    problems.push(
      `${address.pathname} on the site is not ${file}, byte for byte. Run bun run build.`,
    )
}

if (problems.length > 0) {
  console.error(
    `✗ The schemas are not served at the addresses they name:\n\n${problems.map((p) => `  ${p}`).join("\n")}\n`,
  )
  process.exit(1)
}

console.log(
  `✓ ${SCHEMAS.length} schemas are served at the addresses they name, the same as in the package.`,
)
