/**
 * Sets and pushes the tag that releases a version.
 *
 * The tag is the last step of a release, after `bun run prepare-version` and
 * after the version has been merged to master. It starts the workflow that
 * releases, and it should be set straight away: the documentation is
 * deployed when master changes, and then points at a version that does not
 * exist until the tag has run.
 *
 *   bun run tag                     shows what is tagged, and does nothing
 *   bun run tag package             v<version>: npm and GitHub Releases
 *   bun run tag extension           extension-v<version>: VS Code Marketplace
 *   bun run tag intellij            intellij-v<version>: JetBrains Marketplace
 *   bun run tag package extension   several at once
 *   --dry-run                        says what would happen, without tagging
 *
 * The script refuses when master has not been fetched, when the working tree
 * has changes, when the tag already exists, and when the version is missing
 * from the changelog. Without arguments it tags nothing: what goes out is
 * chosen every time.
 *
 * If the push failed after the tag was set, the tag is left locally. If it is
 * on the same commit, the script pushes it next time instead of setting it
 * again.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("../../", import.meta.url))

type Part = {
  /** The name in the command. */
  name: string
  /** What the tag releases. */
  releases: string
  prefix: string
  /**
   * Prefixes the same part was tagged with before. A version tagged with one
   * of them counts as released, so it is not released a second time under
   * the new prefix.
   */
  formerPrefixes?: string[]
  version: () => string
  /** The changelog the version must be in, if the part has one. */
  changelog?: { path: string; heading: (version: string) => RegExp }
}

const readJson = (path: string) =>
  JSON.parse(readFileSync(join(ROOT, path), "utf8")) as { version: string }

const PARTS: Part[] = [
  {
    name: "package",
    releases: "@lo-tek/interfaces on npm, and the CLI on GitHub Releases",
    prefix: "v",
    version: () => readJson("interfaces/package.json").version,
    changelog: {
      path: "interfaces/CHANGELOG.md",
      heading: (v) => new RegExp(`^## ${v.replaceAll(".", "\\.")} \\(`, "m"),
    },
  },
  {
    name: "extension",
    releases: "the VS Code extension on Marketplace",
    prefix: "extension-v",
    formerPrefixes: ["utvidelse-v"],
    version: () => readJson("vscode/package.json").version,
    changelog: {
      path: "vscode/CHANGELOG.md",
      heading: (v) => new RegExp(`^## ${v.replaceAll(".", "\\.")}$`, "m"),
    },
  },
  {
    name: "intellij",
    releases: "the IntelliJ plugin on JetBrains Marketplace",
    prefix: "intellij-v",
    version: () => {
      const match = /^pluginVersion=(.+)$/m.exec(
        readFileSync(join(ROOT, "intellij/gradle.properties"), "utf8"),
      )
      if (!match) stop("Found no pluginVersion in intellij/gradle.properties.")
      return match[1].trim()
    },
  },
]

function stop(message: string): never {
  console.error(`✗ ${message}`)
  process.exit(1)
}

function git(...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: ROOT })
  if (result.exitCode !== 0)
    stop(`git ${args.join(" ")} failed:\n${result.stderr.toString()}`)
  return result.stdout.toString().trim()
}

/** The commit a local tag points at, or `undefined` if it does not exist. */
function localTag(tag: string): string | undefined {
  const result = Bun.spawnSync(
    ["git", "rev-parse", "--quiet", "--verify", `refs/tags/${tag}^{commit}`],
    { cwd: ROOT },
  )
  return result.exitCode === 0 ? result.stdout.toString().trim() : undefined
}

const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const chosen = args.filter((a) => a !== "--dry-run")
const unknown = chosen.filter((a) => !PARTS.some((p) => p.name === a))
if (unknown.length > 0)
  stop(
    `Unknown part: ${unknown.join(", ")}. Choose from ${PARTS.map((p) => p.name).join(", ")}.`,
  )

git("fetch", "--quiet", "--tags", "origin", "master")
const existing = new Set(
  git("ls-remote", "--tags", "origin")
    .split("\n")
    .map((line) => line.split("refs/tags/")[1])
    .filter(Boolean),
)

const status = PARTS.map((part) => {
  const version = part.version()
  const tag = `${part.prefix}${version}`
  // The tag on GitHub, under the current prefix or a former one.
  const taggedAs = [part.prefix, ...(part.formerPrefixes ?? [])]
    .map((prefix) => `${prefix}${version}`)
    .find((name) => existing.has(name))
  return { part, version, tag, taggedAs }
})

if (chosen.length === 0) {
  console.log("The versions on this commit, and whether they are tagged:\n")
  for (const { part, tag, taggedAs } of status)
    console.log(
      `  ${part.name.padEnd(10)} ${tag.padEnd(22)} ${taggedAs === undefined ? "not tagged" : taggedAs === tag ? "tagged" : `tagged as ${taggedAs}`}`,
    )
  console.log(
    "\nChoose what goes out, for example: bun run tag package extension",
  )
  process.exit(0)
}

// The tag goes on master as it is on GitHub, not on a local commit.
const here = git("rev-parse", "HEAD")
const master = git("rev-parse", "origin/master")
if (here !== master)
  stop(
    `You are on ${here.slice(0, 7)}, and master on GitHub is ${master.slice(0, 7)}.\n  Merge the version first, and run: git checkout master && git pull`,
  )
if (git("status", "--porcelain") !== "")
  stop("The working tree has changes. Commit or remove them before tagging.")

const selected = status.filter((s) => chosen.includes(s.part.name))
for (const { part, version, tag, taggedAs } of selected) {
  if (taggedAs !== undefined)
    stop(
      `${taggedAs} already exists. A version is released only once: set a new version for ${part.name}.`,
    )
  const local = localTag(tag)
  if (local !== undefined && local !== here)
    stop(
      `${tag} exists locally on ${local.slice(0, 7)}, but not on GitHub. Remove it with git tag -d ${tag} and run again.`,
    )
  if (part.changelog) {
    const changelog = readFileSync(join(ROOT, part.changelog.path), "utf8")
    if (!part.changelog.heading(version).test(changelog))
      stop(
        `${part.changelog.path} has no heading for ${version}. ${part.name === "package" ? "Run bun run prepare-version first." : "Write it before tagging."}`,
      )
  }
}

// Advisories can be published between the release branch and the merge, so
// the check runs again here, right before the tag starts the publishing.
if (
  Bun.spawnSync(["bun", join(ROOT, "scripts", "check-advisories.ts")], {
    stdio: ["inherit", "inherit", "inherit"],
  }).exitCode !== 0
)
  stop("Open security advisories, see above. Nothing has been tagged.")

for (const { part, tag } of selected) {
  if (dryRun) {
    console.log(`Would tag ${tag} on ${here.slice(0, 7)}: ${part.releases}.`)
    continue
  }
  // With `tag.gpgsign` the tag is signed and must have a message. Without
  // `-m` git opens an editor, and there is none when the script runs.
  if (localTag(tag) === undefined) git("tag", "-m", `Release ${tag}`, tag, here)
  git("push", "--quiet", "origin", tag)
  console.log(
    `Tagged ${tag} on ${here.slice(0, 7)}. Releasing ${part.releases}.`,
  )
}
if (!dryRun)
  console.log(
    "\nFollow along under Actions on GitHub. The workflows check for themselves that the tag and the version agree.",
  )

/*
 * The other parts have a version that is not tagged? The documentation
 * describes what the latest version of each does, so a release that only
 * tags the package lets the Editor page promise something Marketplace does
 * not have.
 */
const forgotten = status.filter(
  (s) => s.taggedAs === undefined && !selected.includes(s),
)
if (forgotten.length > 0)
  console.log(
    `\nNot tagged yet: ${forgotten.map((s) => `${s.tag} (bun run tag ${s.part.name})`).join(", ")}. If the version is on master, the tag should be set now.`,
  )
