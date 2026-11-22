/**
 * That a link to every page gets an image when it is shared.
 *
 * Starlight writes the title, description and `twitter:card` itself, but no
 * image, and the front page sits outside Starlight and got none of them. A
 * link to the front page was shared on X as plain text. The image now comes
 * from `head` in `astro.config.mjs` and from `index.astro`, and a new page
 * under `src/pages/` falls outside just as easily as the front page did.
 *
 * The pages under `demo/` are exempt. They are shown in an `<iframe>` on the
 * pattern pages and are examples the reader copies, so sharing tags do not
 * belong in them. So is the component sheet of the theme builder, which is
 * only ever shown in the builder's own `<iframe>`.
 *
 * Run with: bun documentation/scripts/check-share-card.ts
 * Requires `documentation/dist` to be built.
 */

import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { Glob } from "bun"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const DIST = `${ROOT}documentation/dist/`

const { homepage } = JSON.parse(
  readFileSync(`${ROOT}interfaces/package.json`, "utf8"),
) as { homepage: string }

// The expected value is built from the address in the package and the file in
// `dist`, not from the list the tags are written from. Otherwise the check
// only checks itself.
const IMAGE = "og.png"
const ADDRESS = `${homepage.replace(/\/$/, "")}/${IMAGE}`

const findings: string[] = []

// The image must exist, be a PNG and have the dimensions the tags state. X
// does not take SVG.
if (!existsSync(DIST + IMAGE)) {
  findings.push(`${IMAGE} does not exist in dist`)
} else {
  const png = readFileSync(DIST + IMAGE)
  const signature = png.subarray(0, 8).toString("hex")
  if (signature !== "89504e470d0a1a0a") {
    findings.push(`${IMAGE} is not a PNG`)
  } else {
    const width = png.readUInt32BE(16)
    const height = png.readUInt32BE(20)
    if (width !== 1200 || height !== 630)
      findings.push(`${IMAGE} is ${width} × ${height}, not 1200 × 630`)
  }
}

// Every `<meta>` with that name, so a tag that appears twice is seen. A later
// Starlight that writes its own `og:image` would otherwise have given two
// images without anything saying so.
function content(html: string, attribute: string, name: string) {
  const values: string[] = []
  for (const tag of html.matchAll(/<meta\b[^>]*>/g)) {
    if (!new RegExp(`\\s${attribute}="${name}"`).test(tag[0])) continue
    values.push(tag[0].match(/\bcontent="([^"]*)"/)?.[1] ?? "")
  }
  return values
}

// The description is not required: Starlight only writes it when the page
// has one in its frontmatter, and the card works without it. The 404 page
// has none.
const REQUIREMENTS: [string, string, (value: string) => boolean][] = [
  ["property", "og:title", (v) => v.length > 0],
  ["property", "og:image", (v) => v === ADDRESS],
  ["property", "og:image:width", (v) => v === "1200"],
  ["property", "og:image:height", (v) => v === "630"],
  ["property", "og:image:alt", (v) => v.length > 0],
  ["name", "twitter:card", (v) => v === "summary_large_image"],
  ["name", "twitter:image", (v) => v === ADDRESS],
]

/*
 * The expected count comes from the source, not from the glob over `dist`:
 * one page per document under `src/content/docs`, one per `.astro` page in
 * `src/pages` apart from the demos (the front page and the changelog), plus
 * the 404 page. If it only counted what the glob found, a page missing from
 * the build would never be missed.
 *
 * `404.mdx` is a document, but it becomes `404.html` rather than a page of
 * its own, so it is counted as the 404 page and not twice.
 */
const expected =
  [
    ...new Glob("**/*.{md,mdx}").scanSync(
      `${ROOT}documentation/src/content/docs`,
    ),
  ].filter((rel) => !/^404\.mdx?$/.test(rel)).length +
  [...new Glob("**/*.astro").scanSync(`${ROOT}documentation/src/pages`)].filter(
    (rel) => !framed(rel),
  ).length +
  1

/** A page that is only shown in an `<iframe>`, as a source file or as built. */
function framed(rel: string): boolean {
  return rel.startsWith("demo/") || rel.startsWith("theme-builder/sheet")
}

for (const page of ["index.html", "404.html"]) {
  if (!existsSync(DIST + page)) findings.push(`${page} does not exist in dist`)
}

let exempt = 0
let checked = 0

for (const rel of new Glob("**/*.html").scanSync(DIST)) {
  if (framed(rel)) {
    exempt += 1
    continue
  }

  const html = readFileSync(DIST + rel, "utf8")
  for (const [attribute, name, accepts] of REQUIREMENTS) {
    const values = content(html, attribute, name)
    if (values.length === 0) findings.push(`${rel} is missing ${name}`)
    else if (values.length > 1)
      findings.push(`${rel} has ${name} ${values.length} times`)
    else if (!accepts(values[0]))
      findings.push(`${rel} has ${name}="${values[0]}"`)
  }

  checked += 1
}

if (checked === 0 || checked !== expected) {
  findings.push(
    `The check looked at ${checked} pages, but the source has ${expected}. Is dist built?`,
  )
}

if (findings.length > 0) {
  console.error(
    `Shared links get no image:\n${findings.map((line) => `  - ${line}`).join("\n")}\n`,
  )
  process.exit(1)
}

console.log(
  `All ${checked} of ${expected} pages have the share image ${ADDRESS}, and ${exempt} framed pages are exempt.`,
)
