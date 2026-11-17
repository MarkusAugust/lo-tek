/**
 * Checks that the files in `manifest/` are what `generate-manifest.ts` would
 * write now.
 *
 * The generator gives its files as a value, so they are compared here in
 * memory, byte for byte, and nothing is written. In the build, `generate`
 * has just written the files, so this finds nothing; run on its own, it
 * says whether the files on disk are out of date.
 *
 * Run with: bun scripts/check-manifest.ts, or as part of `bun run build`.
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { files, ROOT } from "./generate-manifest"

const findings: string[] = []
const generated = files()
for (const [path, content] of Object.entries(generated)) {
  const file = join(ROOT, path)
  if (!existsSync(file)) findings.push(`${path} is missing`)
  else if (readFileSync(file, "utf8") !== content)
    findings.push(`${path} is out of date`)
}

if (findings.length > 0) {
  console.error("✗ The manifest is not what the generator writes:\n")
  console.error(findings.map((f) => `  - ${f}`).join("\n"))
  console.error("\nRun bun scripts/generate-manifest.ts and commit the files.")
  process.exit(1)
}
console.log(
  `✓ The manifest: ${Object.keys(generated).length} files are what the generator writes.`,
)
