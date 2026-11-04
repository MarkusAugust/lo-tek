/**
 * That the version was actually inserted into the built output.
 *
 * The addresses in the examples are written as `@lo-tek/interfaces@VERSION`
 * in the source, and `remark-version.mjs` replaces the placeholder when the
 * page is built. Two guards watched the source, and none watched the output.
 *
 * It is not a theoretical gap. `astro.config.mjs` itself says that
 * `markdown.remarkPlugins` is marked as deprecated, and that the MDX path is
 * the only thing keeping it alive. If the plugin stops running, every address
 * goes out with the word VERSION in it, the "Plain HTML" and Datastar track is
 * dead for the reader, and `bun run check` is green all the way.
 *
 * Run with: bun documentation/scripts/check-built-version.ts
 * Requires `documentation/dist` to be built.
 */

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { Glob } from "bun"
import { VERSION_PLACEHOLDER } from "../../interfaces/scripts/recipes"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

const { version } = JSON.parse(
  readFileSync(`${ROOT}interfaces/package.json`, "utf8"),
) as { version: string }

const PLACEHOLDER = VERSION_PLACEHOLDER
const WITH_VERSION = `@lo-tek/interfaces@${version}`

const findings: string[] = []

/*
 * The expected set comes from the source, not from the build.
 *
 * The first version counted every address in `dist` that had the version in
 * it, and came to 320. But 172 of them are written by `Example.astro` on
 * every single example page, and they never go through remark. So the number
 * could stay high and green even if every single placeholder vanished from
 * the source, and the guard claimed work it had not done.
 *
 * Now the addresses the placeholder appears in are collected, and each of
 * them must exist in the build with the version inserted. That also covers
 * the node types the plugin does not reach: if the placeholder is in a JSX
 * attribute like `code={…}`, it is not replaced, and then the address is
 * missing here.
 */
const inSource = new Set<string>()

for (const rel of new Glob("documentation/src/**/*.{mdx,md,astro}").scanSync(
  ROOT,
)) {
  const text = readFileSync(ROOT + rel, "utf8")

  for (const match of text.matchAll(
    /@lo-tek\/interfaces@VERSION(\/[^"'`\s)]+)/g,
  )) {
    inSource.add(match[1])
  }
}

let read = 0
const missing: string[] = []
const built: string[] = []

for (const rel of new Glob("documentation/dist/**/*.html").scanSync(ROOT)) {
  const text = readFileSync(ROOT + rel, "utf8")
  built.push(text)

  // Starlight escapes `@` in some contexts, so it is the word VERSION right
  // after the package name that is searched for, not the placeholder
  // character by character. The changelog is exempt by name: it is rendered
  // from CHANGELOG.md, which mentions the placeholder where it was
  // introduced, and has no CDN addresses.
  if (
    rel !== "documentation/dist/changelog/index.html" &&
    (text.includes(PLACEHOLDER) ||
      /interfaces[@-]?(?:&#\d+;)?VERSION/.test(text))
  )
    findings.push(`${rel} has a placeholder that was not replaced`)

  read += 1
}

for (const filePath of inSource) {
  if (!built.some((text) => text.includes(WITH_VERSION + filePath))) {
    missing.push(filePath)
  }
}

/*
 * The Maven coordinates and the WebJar path on the Kotlin page also have the
 * placeholder, and `remark-version.mjs` replaces them separately. The regex
 * above only sees the npm name, so without this the Gradle examples could go
 * out with the word VERSION in them while the check was green. Each of the
 * three forms is checked both ways: that it appears with the version in the
 * build, and that the placeholder is not left behind.
 *
 * The plugin line is read from the copy button's `data-code`, not from
 * `<pre>`. Expressive Code splits the code block into one span per token, so
 * in `<pre>` `version ` and `"0.33.0"` sit in separate `<span>`s, and a
 * search string with the quote right after the word can never match there,
 * neither with the version nor with the placeholder. In `data-code` the line
 * is in one piece. The first version searched for `version "VERSION"` in
 * `<pre>` and was dead. The quote is escaped in the attribute, as `&#x22;` up
 * to Expressive Code 0.42 and as `&quot;` from 0.44, so both are read as `"`
 * here rather than the guard depending on one of them.
 */
const MAVEN = [
  [
    "markusaugust:lo-tek-interfaces:VERSION",
    `markusaugust:lo-tek-interfaces:${version}`,
  ],
  ['version "VERSION"', `version "${version}"`],
  ["webjars/lo-tek/VERSION/", `webjars/lo-tek/${version}/`],
]
const unquoted = built.map((text) => text.replace(/&#x22;|&quot;/g, '"'))
for (const [leftOver, withVersion] of MAVEN) {
  if (!unquoted.some((text) => text.includes(withVersion))) {
    findings.push(
      `"${withVersion}" does not exist in the build. The Kotlin page should have it with the version inserted.`,
    )
  }
  if (unquoted.some((text) => text.includes(leftOver))) {
    findings.push(
      `"${leftOver}" is left in the build without the version having been inserted`,
    )
  }
}

if (read === 0 || inSource.size === 0) {
  findings.push(
    `The check looked at nothing: ${read} built pages and ${inSource.size} addresses with a placeholder in the source. Is dist built?`,
  )
}

for (const filePath of missing) {
  findings.push(
    `${WITH_VERSION}${filePath} does not exist in the build, but the placeholder is in the source.`,
  )
}

if (findings.length > 0) {
  console.error(
    `The version did not make it into the built output:\n${findings
      .map((line) => `  - ${line}`)
      .join("\n")}\n`,
  )
  process.exit(1)
}

console.log(
  `All ${inSource.size} addresses from the source appear in the build with ${version} in them, across ${read} pages, and no placeholder is left.`,
)
