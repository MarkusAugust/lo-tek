/**
 * The packaged extension, `lotek.vsix`, carries the schema of the recipe
 * file, and it is the one in the npm package.
 *
 * `test/suite.cjs` runs the extension from this folder, so it sees `dist`
 * and not what `vsce` packs from it: a line in `.vscodeignore` or a build
 * step after the packing would leave the suite green and the published
 * extension pointing at a file it does not have. VS Code then says nothing,
 * and `lotek.theme.json` is simply not checked.
 *
 * Run with: bun run check, which builds, packs and then runs this.
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const extensionDir = fileURLToPath(new URL("..", import.meta.url))
const vsix = join(extensionDir, "lotek.vsix")
const inThePackage = readFileSync(
  join(extensionDir, "../interfaces/src/tokens/theme.schema.json"),
)

if (!existsSync(vsix)) {
  console.error(`✗ ${vsix} does not exist. Run bun run check first.`)
  process.exit(1)
}

/** One file from the archive, or nothing when it is not there. */
function packed(path: string): Buffer | undefined {
  const run = Bun.spawnSync(["unzip", "-p", vsix, path])
  return run.exitCode === 0 ? Buffer.from(run.stdout) : undefined
}

const errors: string[] = []

// The manifest the archive carries, not the one in this folder: it is what
// VS Code reads once the extension is installed.
const manifest = packed("extension/package.json")
const schemas: { fileMatch?: unknown; url?: string }[] = manifest
  ? (JSON.parse(manifest.toString("utf8")).contributes?.jsonValidation ?? [])
  : []
if (!manifest) errors.push("the archive has no extension/package.json")
else if (schemas.length !== 1)
  errors.push(
    `the manifest should contribute one schema, for the recipe, and has ${schemas.length}`,
  )

for (const { url } of schemas) {
  if (!url || /^[a-z]+:/i.test(url)) {
    errors.push(
      `the schema must be a file in the extension, so it is there without a network, not ${url}`,
    )
    continue
  }
  const carried = packed(`extension/${url.replace(/^\.\//, "")}`)
  if (!carried)
    errors.push(
      `contributes.jsonValidation points at ${url}, which is not in the archive`,
    )
  else if (!carried.equals(inThePackage))
    errors.push(
      `${url} in the archive is not interfaces/src/tokens/theme.schema.json, byte for byte`,
    )
}

if (errors.length > 0) {
  console.error(
    `✗ lotek.vsix does not carry the schema of the recipe:\n  ${errors.join("\n  ")}`,
  )
  process.exit(1)
}
console.log(
  "✓ lotek.vsix carries the schema of the recipe, the one in the npm package.",
)
