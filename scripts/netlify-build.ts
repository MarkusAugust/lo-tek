/**
 * The site, built with the command Netlify runs.
 *
 * CI built the site with `bun run build`, and Netlify with its own command in
 * `netlify.toml`, on Node. Astro 7 stopped on Netlify's Node while every
 * check was green, because none of them ran that command. This step runs it
 * as written there, from the base directory, so the documentation checks
 * after it read the pages Netlify would publish.
 *
 * Run with: bun scripts/netlify-build.ts
 */

import { join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const { build } = Bun.TOML.parse(
  await Bun.file(join(ROOT, "netlify.toml")).text(),
) as { build?: { base?: string; command?: string } }

if (!build?.command) {
  console.error("✗ netlify.toml has no build command")
  process.exit(1)
}

const node = Bun.spawnSync(["node", "--version"]).stdout.toString().trim()
console.log(`Netlify's command on Node ${node}: ${build.command}`)
const result = Bun.spawnSync(
  ["bash", "--noprofile", "--norc", "-eo", "pipefail", "-c", build.command],
  {
    cwd: join(ROOT, build.base ?? "."),
    stdio: ["inherit", "inherit", "inherit"],
  },
)
process.exit(result.exitCode ?? 1)
