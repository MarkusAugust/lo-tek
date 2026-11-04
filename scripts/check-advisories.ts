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
 *   `*.gradle.kts`, the plugins, the standard library the published code
 *   asks for, and the Kotlin a Gradle brings with `kotlin-dsl`, asked of
 *   OSV. Only what is declared: the transitive dependencies need a Gradle
 *   resolution, and are not covered, and neither is Gradle itself.
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

/**
 * The plugins that come with Gradle, applied as `` `name` `` without a
 * version. They have no artifact of their own to ask about. `kotlin-dsl` is
 * not among them: it brings the Kotlin Gradle plugin in the version the
 * Gradle that runs it embeds, which is asked about below.
 */
const GRADLE_CORE_PLUGINS = new Set([
  "war",
  "ear",
  "groovy",
  "scala",
  "eclipse",
  "checkstyle",
  "pmd",
  "codenarc",
  "java",
  "java-library",
  "java-platform",
  "java-gradle-plugin",
  "application",
  "maven-publish",
  "signing",
  "base",
  "distribution",
  "idea",
  "jacoco",
  "version-catalog",
])

/** Our own artifacts, built from this repository. */
const OWN_GROUP = "io.github.markusaugust:"

/** Advisories that are known and cannot be fixed yet, with the reason. */
const ACCEPTED: Record<string, string> = {
  "GHSA-g3hv-75wg-m249":
    "minimatch below 11.0.1. vscode-languageclient 9 (bundled in the extension) requires ^5, its newest version (11.0.0) ^10.2.6, and @vscode/vsce 4 ^10.2.6 too, so no version of either reaches 11.0.1. The extension matches only its own document selectors with it, never a pattern from the user, and vsce only our own files when the extension is packed",
}

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
  // The number of packages, so a report on nothing cannot look like a clean one.
  const lock = readFileSync(join(ROOT, "bun.lock"), "utf8")
  const packages =
    lock.slice(lock.indexOf('"packages"')).match(/^ {4}"[^"]+": \[/gm)
      ?.length ?? 0
  if (packages === 0) stop("Found no packages in bun.lock.")
  return { checked: `${packages} npm packages`, findings }
}

type Query = { package: { ecosystem: string; name: string }; version: string }

function crates(): Query[] {
  const lock = readFileSync(join(ROOT, "Cargo.lock"), "utf8")
  const blocks = lock.split("[[package]]").slice(1)
  // A crate without `source` is a member of the workspace. One from git or
  // another source OSV cannot be asked about by version.
  for (const block of blocks) {
    const source = block.match(/^source = "([^"]+)"/m)?.[1]
    if (source && !source.startsWith("registry+"))
      stop(
        `A crate in Cargo.lock comes from ${source}, which the check cannot ask about.`,
      )
  }
  return blocks
    .filter((block) => /^source = "registry\+/m.test(block))
    .map((block) => {
      const name = block.match(/^name = "([^"]+)"/m)?.[1]
      const version = block.match(/^version = "([^"]+)"/m)?.[1]
      if (!name || !version)
        stop(`A package in Cargo.lock has no name or version:\n${block}`)
      return { package: { ecosystem: "crates.io", name }, version }
    })
}

/**
 * The lines of every top-level `plugins { }` block in a build file, without
 * comments, found by counting braces, so a block on one line is read too.
 */
function pluginLines(text: string): string[] {
  const lines: string[] = []
  for (const start of text.matchAll(/^plugins\s*\{/gm)) {
    let depth = 0
    let end = start.index
    for (; end < text.length; end++) {
      if (text[end] === "{") depth++
      else if (text[end] === "}" && --depth === 0) break
    }
    const body = text.slice(start.index + start[0].length, end)
    lines.push(
      ...body
        .split(/\n|;/)
        .map((l) => l.replace(/\/\/.*$/, "").trim())
        .filter(Boolean),
    )
  }
  return lines
}

function maven(): Query[] {
  const files = Bun.spawnSync(["git", "ls-files", "*.gradle.kts"], {
    cwd: ROOT,
  })
    .stdout.toString()
    .split("\n")
    .filter(Boolean)
  const coordinates = new Set<string>()
  const versionless: { file: string; id: string; line: string }[] = []
  const versioned = new Set<string>()
  let kotlinDsl = false
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
    // The standard library the code asks for is `coreLibrariesVersion`
    // where it is set, and the plugin's own version otherwise.
    const core = [
      ...text.matchAll(/\bcoreLibrariesVersion\s*=\s*"([^"]+)"/g),
    ].map((m) => m[1])
    for (const version of core)
      coordinates.add(`org.jetbrains.kotlin:kotlin-stdlib:${version}`)
    for (const line of pluginLines(text)) {
      const builtIn =
        line.match(/^`([\w-]+)`$/)?.[1] ??
        line.match(/^([a-z][\w-]*)$/)?.[1] ??
        line.match(/^id\s*\(\s*"([\w-]+)"\s*\)$/)?.[1]
      if (builtIn === "kotlin-dsl") kotlinDsl = true
      else if (builtIn && GRADLE_CORE_PLUGINS.has(builtIn)) continue
      else {
        // One pattern for every other line, so a line it cannot read stops
        // the run instead of passing a looser test and being skipped.
        const m = line.match(
          /^(kotlin|id)\s*\(\s*"([^"]+)"\s*\)(?:\s+version\s+"([^"]+)")?(?:\s+apply\s+(?:true|false))?$/,
        )
        if (!m) stop(`${file}: cannot read the plugin \`${line}\`.`)
        const [, kind, name, version] = m
        const id = kind === "kotlin" ? `org.jetbrains.kotlin.${name}` : name
        if (!version) {
          versionless.push({ file, id, line })
          continue
        }
        versioned.add(id)
        if (kind === "kotlin") {
          coordinates.add(
            `org.jetbrains.kotlin:kotlin-gradle-plugin:${version}`,
          )
          if (core.length === 0)
            coordinates.add(`org.jetbrains.kotlin:kotlin-stdlib:${version}`)
        } else {
          if (!(id in PLUGINS))
            stop(`${file}: the plugin ${id} is missing from PLUGINS.`)
          coordinates.add(`${PLUGINS[id]}:${version}`)
        }
      }
    }
    // A plugin applied outside the block brings no version of its own.
    for (const [, id] of text.matchAll(
      /\b(?:apply\s*\(\s*plugin\s*=|pluginManager\.apply\s*\()\s*"([^"]+)"/g,
    ))
      versionless.push({ file, id, line: `apply(plugin = "${id}")` })
  }
  // A plugin without a version is one whose version is written in another
  // build file. Anything else would be skipped without a word.
  for (const { file, id, line } of versionless) {
    if (!versioned.has(id) && !GRADLE_CORE_PLUGINS.has(id))
      stop(`${file}: cannot read the version of the plugin \`${line}\`.`)
  }
  // `kotlin-dsl` brings the Kotlin Gradle plugin in the version the Gradle
  // that runs it embeds, so every Gradle in the repository is asked: a build
  // can be run by another one through `includeBuild`.
  if (kotlinDsl) {
    for (const properties of Bun.spawnSync(
      ["git", "ls-files", "*gradle-wrapper.properties"],
      { cwd: ROOT },
    )
      .stdout.toString()
      .split("\n")
      .filter(Boolean)) {
      const dir = join(ROOT, properties, "../../..")
      const result = Bun.spawnSync(["./gradlew", "--version", "--quiet"], {
        cwd: dir,
      })
      const kotlin = result.stdout.toString().match(/^Kotlin:\s+(\S+)/m)?.[1]
      if (result.exitCode !== 0 || !kotlin)
        stop(
          `./gradlew --version in ${dir} gave no Kotlin version:\n${result.stderr.toString()}`,
        )
      coordinates.add(`org.jetbrains.kotlin:kotlin-gradle-plugin:${kotlin}`)
      coordinates.add(`org.jetbrains.kotlin:kotlin-stdlib:${kotlin}`)
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
