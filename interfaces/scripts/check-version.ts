/**
 * Checks that the changelog follows the package, and that `engines` is true.
 *
 * A changelog that does not match is worse than none: whoever reads it
 * believes it is up to date. The check is therefore part of the build, not
 * something to remember.
 *
 * Run with: bun run check:version
 */

import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { englishDate, MONTHS } from "./english-date.js"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const pkg = await Bun.file(join(ROOT, "package.json")).json()
const changelog = await Bun.file(join(ROOT, "CHANGELOG.md")).text()
const deck = await Bun.file(
  join(ROOT, "../presentation/design-system-architecture.html"),
).text()

const errors: string[] = []

const headings = [...changelog.matchAll(/^## (.+)$/gm)].map((m) => m[1])

if (headings[0] !== "Unreleased") {
  errors.push(
    'The first heading in CHANGELOG.md must be "Unreleased", so there is a place to write changes that are not released yet.',
  )
}

const released = headings
  .slice(1)
  .map((text) => text.match(/^(\d+\.\d+\.\d+)/)?.[1])

if (released.some((version) => version === undefined)) {
  errors.push(
    'Every heading below "Unreleased" must start with a version number, for example "## 0.2.0 (2026-09-21)".',
  )
}

if (!released.includes(pkg.version)) {
  errors.push(
    `The version in package.json is ${pkg.version}, but CHANGELOG.md has no heading for it. Run bun run prepare-version ${pkg.version}, or add "## ${pkg.version} (${new Date().toISOString().slice(0, 10)})" below "Unreleased".`,
  )
}

// The versions must be listed newest first.
const sorted = [...released].sort((a, b) =>
  (b ?? "").localeCompare(a ?? "", undefined, { numeric: true }),
)
if (released.join() !== sorted.join()) {
  errors.push("The versions in CHANGELOG.md must be listed newest first.")
}

// The file must be in the package, or nobody sees it on npm.
if (!(pkg.files as string[]).includes("CHANGELOG.md")) {
  errors.push(
    'CHANGELOG.md must be listed in "files" in package.json to be published.',
  )
}

/*
 * The badge in the presentation carries the version, and nothing kept it in
 * step. It said 0.15.0 while the package was at 0.19.0, four versions
 * behind. It stood on the title slide then, and is the last line of the last
 * slide now.
 *
 * `prepare-version` writes it now. But a rewrite step has to find the old
 * value to replace it, and that is exactly what fails silently, as it did for
 * the CDN addresses in the documentation. Hence this check.
 */
const inDeck = /Design system architecture · LO-TEK ([^\s·]+) · ([^<]+)/.exec(
  deck,
)

/*
 * The date has a source of truth: the day the version was released, which is
 * in the changelog heading. Without this, someone could set the version by
 * hand and leave the date, and the badge would be half wrong.
 */
const releaseDate = new RegExp(
  `^## ${pkg.version.replace(/\./g, "\\.")} \\((\\d{4}-\\d{2}-\\d{2})\\)`,
  "m",
).exec(changelog)?.[1]

if (!inDeck) {
  errors.push(
    "Found no version badge in presentation/design-system-architecture.html. Is it still there, with the same name?",
  )
} else {
  if (inDeck[1] !== pkg.version) {
    errors.push(
      `The presentation says ${inDeck[1]}, while the package is ${pkg.version}. Run bun run prepare-version, or fix the badge by hand.`,
    )
  }

  /*
   * Without a date in the heading, the date check would be skipped, and the
   * badge could say anything. A condition that switches a check off is more
   * dangerous than a missing check, so it fails instead. The check above
   * only requires the heading to start with a version number, so "## 0.19.0"
   * without a date passes it.
   */
  if (!releaseDate) {
    errors.push(
      `The heading for ${pkg.version} in CHANGELOG.md has no date of the form "## ${pkg.version} (2026-09-28)", so the date in the presentation cannot be checked.`,
    )
  } else if (inDeck[2].trim() !== englishDate(releaseDate)) {
    errors.push(
      `The presentation is dated "${inDeck[2].trim()}", while ${pkg.version} was released on ${englishDate(releaseDate)}.`,
    )
  }
}

/*
 * The numbers in the dependency graph must say when they were checked.
 *
 * They were read from `package-lock.json` on a particular day, and they age:
 * a graph without a date reads as a claim about the present. The date cannot
 * be derived from anything in the repository, so the guard can only require
 * that it is there, and that it is a date. That is enough to keep it from
 * disappearing silently.
 */
const checked = new RegExp(
  `class="[^"]*\\bdeps-checked\\b[^"]*"\\s*>\\s*Checked (\\d{1,2} (?:${MONTHS.join("|")}) \\d{4})`,
).exec(deck)

if (!checked) {
  errors.push(
    'The dependency graph in the presentation does not say when the numbers were checked. It must have "Checked <day> <Month> <year>", for example "Checked 12 October 2026", in an element with the class deps-checked.',
  )
}

// The Kotlin package is built from the npm package with its own version
// number, so a number that lags behind gives a Maven release of the previous
// version.
const kotlinVersion = /^version=(.+)$/m.exec(
  await Bun.file(join(ROOT, "../kotlin/gradle.properties")).text(),
)?.[1]
if (kotlinVersion !== pkg.version) {
  errors.push(
    `kotlin/gradle.properties has version=${kotlinVersion ?? "(missing)"}, while package.json has ${pkg.version}. They must be the same.`,
  )
}

/*
 * The version of every workspace is also in `bun.lock`, and `bun install`
 * does not rewrite it when only the version has changed. `prepare-version`
 * does it for the package, but the extension got 0.8.0 in `package.json`
 * while the lockfile still said 0.7.0. The requirement therefore applies to
 * every workspace that has a version. `documentation` has none, and is
 * skipped.
 */
const rootPackage = await Bun.file(join(ROOT, "../package.json")).json()
const lock = await Bun.file(join(ROOT, "../bun.lock")).text()
let workspaces = 0
for (const dir of rootPackage.workspaces as string[]) {
  const ws = await Bun.file(join(ROOT, "..", dir, "package.json")).json()
  if (ws.version === undefined) continue
  const inLock = new RegExp(
    `"${dir}": \\{\\s*"name": "${ws.name}",\\s*"version": "([^"]+)"`,
  ).exec(lock)?.[1]
  if (inLock !== ws.version)
    errors.push(
      `bun.lock has ${ws.name} ${inLock ?? "without a version"}, while ${dir}/package.json has ${ws.version}. Fix the version in bun.lock.`,
    )
  workspaces += 1
}
if (workspaces === 0)
  errors.push("Found no workspace with a version to check against bun.lock.")

/*
 * The core is loaded with `process.getBuiltinModule`, which arrived in Node
 * 20.16 and 22.3. The versions are not in one line: Node 21 and 22.0 to 22.2
 * are newer than 20.16 and still lack it. `>=20.16` let them in, and whoever
 * ran Node 22.1 was told the version was older than 20.16. The range
 * therefore needs two bounds, and it is checked with versions on each side of
 * them.
 */
const engine = pkg.engines?.node as string | undefined
if (!engine) {
  errors.push("package.json is missing engines.node.")
} else {
  const mustPass = ["20.16.0", "20.19.5", "22.3.0", "22.22.0", "24.0.0"]
  const mustFail = [
    "18.20.0",
    "20.15.1",
    "21.0.0",
    "21.7.3",
    "22.0.0",
    "22.2.0",
  ]
  for (const version of mustPass)
    if (!Bun.semver.satisfies(version, engine))
      errors.push(
        `engines.node is "${engine}", and does not let in Node ${version}, which has process.getBuiltinModule.`,
      )
  for (const version of mustFail)
    if (Bun.semver.satisfies(version, engine))
      errors.push(
        `engines.node is "${engine}", and lets in Node ${version}, which lacks process.getBuiltinModule.`,
      )
}

/*
 * The presentation's favicon is LO-TEK's mark, inline as a data address so
 * the presentation stays one file. It is a copy of the documentation's
 * favicon.svg, and the two are held equal here, comments and spacing apart,
 * so a change to the mark cannot leave the presentation with the old one.
 */
const markOnly = (svg: string) =>
  svg
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/>\s+</g, "><")
    .replace(/\s+/g, " ")
    .trim()
const icon =
  /<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml,([^"]+)">/.exec(
    deck,
  )
const favicon = await Bun.file(
  join(ROOT, "../documentation/public/favicon.svg"),
).text()
if (!icon) {
  errors.push(
    "Found no inline SVG favicon in presentation/design-system-architecture.html. Is it still there, with the same markup?",
  )
} else if (
  markOnly(decodeURIComponent(icon[1]).replaceAll("'", '"')) !==
  markOnly(favicon)
) {
  errors.push(
    "The presentation's favicon is not the mark in documentation/public/favicon.svg. Copy the file into the data address again.",
  )
}

if (errors.length > 0) {
  console.error(
    `The changelog does not match:\n\n${errors.map((e) => `  ${e}`).join("\n")}\n`,
  )
  process.exit(1)
}

console.log(
  `The changelog matches: ${pkg.version} is described, "Unreleased" is at the top, the presentation says ${inDeck?.[1]} dated ${inDeck?.[2].trim()}, the dependency graph is ${checked?.[1]}, and engines "${engine}" keeps out Node without getBuiltinModule.`,
)
