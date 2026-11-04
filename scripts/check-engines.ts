/**
 * That every machine runs the Node and the Bun the packages ask for.
 *
 * Netlify built the site on Node 22.23.0 while Astro 7 stops below 22.23.4,
 * and @vscode/vsce 4 would have published the extension on whatever Node the
 * runner had. Both were green in `bun run check`, which ran on this machine's
 * Node. So the version has one source, `.node-version`, which Netlify reads
 * from the base directory and every `actions/setup-node` reads with
 * `node-version-file`, and the version there must satisfy `engines.node` of
 * every package installed. Bun has no such file on Netlify, so
 * every pin must name the one `ci.yml` pins first.
 *
 * Run with: bun scripts/check-engines.ts
 */

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const read = (path: string) => readFileSync(join(ROOT, path), "utf8")
const problems: string[] = []

const node = read(".node-version").trim()
const whole = /^\d+\.\d+\.\d+$/.test(node)
if (!whole)
  problems.push(
    `.node-version says "${node}": write a whole version, so every machine gets the same one`,
  )

const bun = read(".github/workflows/ci.yml").match(/bun-version: (\S+)/)?.[1]
if (!bun) problems.push("ci.yml pins no bun-version")

// Every pin names the same Node and Bun. A `node-version` written out next to
// the file would win over it in that workflow without a word.
const workflows = readdirSync(join(ROOT, ".github/workflows")).filter((file) =>
  file.endsWith(".yml"),
)
let nodes = 0
for (const file of workflows) {
  const text = read(`.github/workflows/${file}`)
  for (const [, version] of text.matchAll(/bun-version: (\S+)/g))
    if (version !== bun)
      problems.push(`${file} pins Bun ${version}, and ci.yml pins ${bun}`)
  for (const [, version] of text.matchAll(/node-version: (\S+)/g))
    problems.push(
      `${file} pins Node ${version}: use node-version-file: .node-version`,
    )
  const setups = text.match(/uses: actions\/setup-node@/g)?.length ?? 0
  const files = text.match(/node-version-file: \.node-version\n/g)?.length ?? 0
  if (setups !== files)
    problems.push(
      `${file} has ${setups} actions/setup-node, and ${files} of them read .node-version`,
    )
  nodes += setups
}
if (nodes === 0) problems.push("no workflow sets up Node from .node-version")

const netlify = read("netlify.toml")
if (/NODE_VERSION/.test(netlify))
  problems.push(
    "netlify.toml sets NODE_VERSION: Netlify reads .node-version, and the docs do not say which of the two wins",
  )
const netlifyBun = netlify.match(/BUN_VERSION = "([^"]+)"/)?.[1]
if (netlifyBun !== bun)
  problems.push(
    `netlify.toml builds with Bun ${netlifyBun ?? "from Netlify's image"}, and ci.yml pins ${bun}`,
  )

// The engines of every package installed, from bun's store, where the
// isolated linker puts each version once. A package deep in the tree runs on
// the same Node as the one that pulled it in.
const STORE = join(ROOT, "node_modules/.bun")
let checked = 0
for (const folder of existsSync(STORE) ? readdirSync(STORE) : []) {
  const name = folder.slice(0, folder.lastIndexOf("@")).replace("+", "/")
  const path = join(STORE, folder, "node_modules", name, "package.json")
  if (!name || !existsSync(path)) continue
  const { version, engines } = JSON.parse(readFileSync(path, "utf8")) as {
    version: string
    engines?: { node?: unknown; bun?: unknown }
  }
  if (
    whole &&
    typeof engines?.node === "string" &&
    !Bun.semver.satisfies(node, engines.node)
  )
    problems.push(
      `${name} ${version} requires Node ${engines.node}, and .node-version says ${node}`,
    )
  if (
    bun &&
    typeof engines?.bun === "string" &&
    !Bun.semver.satisfies(bun, engines.bun)
  )
    problems.push(
      `${name} ${version} requires Bun ${engines.bun}, and ci.yml pins ${bun}`,
    )
  checked += 1
}
if (checked === 0)
  problems.push(`found no installed packages in ${STORE}: run bun install`)

for (const problem of problems) console.error(`✗ ${problem}`)
console.log(
  `Checked ${checked} packages against Node ${node} and Bun ${bun}, and ${nodes} Node setups in ${workflows.length} workflows.`,
)
if (problems.length > 0) process.exit(1)
console.log("✓ Every machine runs the Node and the Bun the packages ask for.")
