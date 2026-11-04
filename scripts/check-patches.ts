/**
 * That every patch in `patchedDependencies` is applied to what is installed.
 *
 * Bun keys a patch by name and version. When the version in the key no
 * longer matches the installed package, `bun install` exits 0 without a
 * word and installs the package unpatched: the Starlight patch, which keeps
 * the previews inside `<Tabs>` from coming out empty, would be gone at the
 * next bump of the pin. So each patch must name a version a workspace has
 * installed, and every line the patch adds must be in the installed file.
 *
 * Run with: bun scripts/check-patches.ts
 */

import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const root = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  workspaces: string[]
  patchedDependencies?: Record<string, string>
}
const patches = Object.entries(root.patchedDependencies ?? {})
const problems: string[] = []
let checked = 0

for (const [key, file] of patches) {
  const at = key.lastIndexOf("@")
  const name = key.slice(0, at)
  const version = key.slice(at + 1)
  // The package as each workspace resolves it, under bun's isolated linker.
  const installed = [".", ...root.workspaces]
    .map((workspace) => {
      try {
        return Bun.resolveSync(`${name}/package.json`, join(ROOT, workspace))
      } catch {
        return undefined
      }
    })
    .filter((path): path is string => path !== undefined)
    .filter(
      (path) => JSON.parse(readFileSync(path, "utf8")).version === version,
    )
  if (installed.length === 0) {
    problems.push(
      `${key}: no workspace has ${name} ${version} installed, so bun installs it unpatched. Make the patch again for the version that is installed.`,
    )
    continue
  }
  // Every line the patch adds, by the file it adds it to.
  const added = new Map<string, string[]>()
  let target = ""
  for (const line of readFileSync(join(ROOT, file), "utf8").split("\n")) {
    if (line.startsWith("+++ ")) target = line.replace(/^\+\+\+ b\//, "")
    else if (line.startsWith("+") && line.slice(1).trim())
      added.set(target, [...(added.get(target) ?? []), line.slice(1)])
  }
  if (added.size === 0) problems.push(`${key}: ${file} adds nothing`)
  for (const path of installed) {
    for (const [inside, lines] of added) {
      const source = join(dirname(path), inside)
      const text = existsSync(source) ? readFileSync(source, "utf8") : ""
      const missing = lines.filter((line) => !text.includes(line))
      if (missing.length > 0)
        problems.push(
          `${key}: ${source} lacks ${missing.length} of the ${lines.length} lines the patch adds, first: ${missing[0].trim()}`,
        )
    }
  }
  checked += 1
}

for (const problem of problems) console.error(`✗ ${problem}`)
console.log(`Checked ${checked} of ${patches.length} patches.`)
if (problems.length > 0) process.exit(1)
console.log("✓ Every patch is applied to what is installed.")
