/**
 * `bun run advisories`: the security advisories against every dependency in
 * the repository, before a version goes out.
 *
 * `prepare-version` and `tag` run it before they write or tag anything, so
 * a release cannot start with a known advisory standing. It is not a step in
 * CI: the answer changes when an advisory is published, not when the code
 * does, and a pull request would go red for something it did not touch.
 *
 * Three sources, one per ecosystem:
 * - npm: `bun audit`, over the whole lockfile, devDependencies included.
 *   The tools that build and test the package run on this machine and in CI.
 * - Cargo: every crate from a registry in `Cargo.lock`, asked of OSV.
 * - Maven: every `group:artifact:version` written out in a tracked
 *   `*.gradle.kts`, asked of OSV. Only what is declared: the transitive
 *   dependencies need a Gradle resolution, and are not covered.
 *
 * An advisory that cannot be fixed yet goes in `ACCEPTED` with the reason.
 * An id there that is no longer reported stops the run, so the list cannot
 * rot.
 *
 * Run with: bun run advisories
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const OSV = "https://api.osv.dev/v1"

/**
 * The artifact behind each Gradle plugin id. A plugin is applied by id, and
 * OSV knows it by its Maven coordinate. An id missing here stops the run,
 * so a new plugin is never skipped without a word.
 */
const PLUGINS: Record<string, string> = {
  "org.jetbrains.intellij.platform":
    "org.jetbrains.intellij.platform:intellij-platform-gradle-plugin",
  "com.vanniktech.maven.publish": "com.vanniktech:gradle-maven-publish-plugin",
}

/** Our own artifacts, built from this repository. */
const OWN_GROUP = "io.github.markusaugust:"

/** Advisories that are known and cannot be fixed yet, with the reason. */
const ACCEPTED: Record<string, string> = {}

type Finding = { id: string; where: string; summary: string }

function stop(message: string): never {
  console.error(`✗ ${message}`)
  process.exit(1)
}

function npm(): { checked: string; findings: Finding[] } {
  const result = Bun.spawnSync(["bun", "audit", "--json"], { cwd: ROOT })
  const output = result.stdout.toString()
  // `bun audit` exits with 1 when it finds something, and with other codes
  // when it could not ask at all. Only valid JSON counts as an answer.
  if (result.exitCode !== 0 && result.exitCode !== 1)
    stop(
      `bun audit gave no answer (exit ${result.exitCode}):\n${result.stderr.toString()}${output}`,
    )
  let report: Record<
    string,
    {
      url: string
      title: string
      severity: string
      vulnerable_versions: string
    }[]
  >
  try {
    report = JSON.parse(output)
  } catch {
    stop(
      `bun audit gave no answer (exit ${result.exitCode}):\n${result.stderr.toString()}${output}`,
    )
  }
  if (
    typeof report !== "object" ||
    report === null ||
    Object.values(report).some((a) => !Array.isArray(a))
  )
    stop(`bun audit answered something other than a report:\n${output}`)
  const findings = Object.entries(report).flatMap(([name, advisories]) =>
    advisories.map((a) => ({
      id: a.url.split("/").pop() ?? a.url,
      where: `npm ${name} ${a.vulnerable_versions}`,
      summary: `${a.severity}: ${a.title}`,
    })),
  )
  return { checked: "the npm lockfile", findings }
}

type Query = { package: { ecosystem: string; name: string }; version: string }

function crates(): Query[] {
  const lock = readFileSync(join(ROOT, "Cargo.lock"), "utf8")
  return lock
    .split("[[package]]")
    .filter((block) => /^source = "registry\+/m.test(block))
    .map((block) => {
      const name = block.match(/^name = "([^"]+)"/m)?.[1]
      const version = block.match(/^version = "([^"]+)"/m)?.[1]
      if (!name || !version)
        stop(`A package in Cargo.lock has no name or version:\n${block}`)
      return { package: { ecosystem: "crates.io", name }, version }
    })
}

function maven(): Query[] {
  const files = Bun.spawnSync(["git", "ls-files", "*.gradle.kts"], {
    cwd: ROOT,
  })
    .stdout.toString()
    .split("\n")
    .filter(Boolean)
  const coordinates = new Set<string>()
  for (const file of files) {
    const text = readFileSync(join(ROOT, file), "utf8")
    for (const [, coordinate] of text.matchAll(/"([\w.-]+:[\w.-]+:[^"]+)"/g)) {
      if (coordinate.startsWith("scm:") || coordinate.startsWith(OWN_GROUP))
        continue
      // A version from a variable cannot be read here, and would otherwise
      // be left out in silence.
      if (!/^[\w.-]+:[\w.-]+:[\w.-]+$/.test(coordinate))
        stop(`${file}: cannot read the version in "${coordinate}".`)
      coordinates.add(coordinate)
    }
    // The Kotlin plugin brings the standard library in the same version.
    for (const [, version] of text.matchAll(
      /\bkotlin\("[\w-]+"\) version "([^"]+)"/g,
    )) {
      coordinates.add(`org.jetbrains.kotlin:kotlin-gradle-plugin:${version}`)
      coordinates.add(`org.jetbrains.kotlin:kotlin-stdlib:${version}`)
    }
    for (const [, id, version] of text.matchAll(
      /\bid\("([^"]+)"\) version "([^"]+)"/g,
    )) {
      if (!(id in PLUGINS))
        stop(`${file}: the plugin ${id} is missing from PLUGINS.`)
      coordinates.add(`${PLUGINS[id]}:${version}`)
    }
  }
  return [...coordinates].map((coordinate) => {
    const [group, artifact, version] = coordinate.split(":")
    return {
      package: { ecosystem: "Maven", name: `${group}:${artifact}` },
      version,
    }
  })
}

async function osv(queries: Query[]): Promise<Finding[]> {
  const response = await fetch(`${OSV}/querybatch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ queries }),
  })
  if (!response.ok) stop(`OSV answered ${response.status}.`)
  const { results } = (await response.json()) as {
    results: { vulns?: { id: string }[]; next_page_token?: string }[]
  }
  if (results.length !== queries.length)
    stop(`OSV answered ${results.length} of ${queries.length} queries.`)
  // A result with more advisories than one page holds is cut, and the rest
  // would be missing from the report.
  const paged = results.findIndex((r) => r.next_page_token)
  if (paged !== -1)
    stop(`OSV paged the answer for ${queries[paged].package.name}.`)
  return Promise.all(
    results.flatMap((result, i) =>
      (result.vulns ?? []).map(async ({ id }) => {
        const answer = await fetch(`${OSV}/vulns/${id}`)
        if (!answer.ok) stop(`OSV answered ${answer.status} for ${id}.`)
        const { summary } = (await answer.json()) as { summary?: string }
        const { name, ecosystem } = queries[i].package
        return {
          id,
          where: `${ecosystem} ${name} ${queries[i].version}`,
          summary: summary ?? `https://osv.dev/vulnerability/${id}`,
        }
      }),
    ),
  )
}

const cargo = crates()
const gradle = maven()
// Zero is never an answer here: a format that changed under the parsing
// would otherwise look like a clean bill of health.
if (cargo.length === 0) stop("Found no crates from a registry in Cargo.lock.")
if (gradle.length === 0)
  stop("Found no Maven coordinates in the tracked *.gradle.kts files.")

const fromNpm = npm()
const findings = [...fromNpm.findings, ...(await osv([...cargo, ...gradle]))]

const reported = new Set(findings.map((f) => f.id))
const stale = Object.keys(ACCEPTED).filter((id) => !reported.has(id))
const open = findings.filter((f) => !(f.id in ACCEPTED))

for (const f of findings.filter((f) => f.id in ACCEPTED))
  console.log(`  accepted ${f.id} (${f.where}): ${ACCEPTED[f.id]}`)
for (const f of open) console.log(`✗ ${f.id} ${f.where}\n    ${f.summary}`)

console.log(
  `\nChecked ${fromNpm.checked}, ${cargo.length} crates and ${gradle.length} Maven coordinates: ${open.length} open advisories, ${findings.length - open.length} accepted.`,
)

if (stale.length > 0)
  stop(
    `No longer reported, remove from ACCEPTED in scripts/check-advisories.ts: ${stale.join(", ")}`,
  )
if (open.length > 0)
  stop(
    "Fix them before releasing: bun audit fix for npm, a new version in Cargo.lock or the build file otherwise.",
  )
console.log("✓ No open security advisories.")
