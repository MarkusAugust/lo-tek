/**
 * That the Astro recipes pass `astro check` in a strict project.
 *
 * A reader who pastes an Astro tab into a project whose `tsconfig.json`
 * extends `astro/tsconfigs/strict` gets the type checker's errors on our
 * code: a property that does not exist on `window`, a parameter without a
 * type, an object that may be null. `astro build` does not check types, so
 * the recipe builds, the site builds, and nothing says so.
 *
 * This writes every code block for Astro in the documentation's pages to a
 * page of its own in a project made for the run, with that `tsconfig.json`
 * and nothing else, and runs `astro check` on it. Every error is reported
 * at the line of the `.mdx` it comes from.
 *
 * The project stands in this package's `node_modules/.cache`, which is not
 * in the tree, and is removed when the run is over. From there `astro`,
 * `@astrojs/check` and `@lo-tek/interfaces` resolve as they do for the
 * documentation itself: the last one is the workspace's own package, not a
 * published one, so its built types must be there (`bun run build` in
 * `interfaces`). Nothing is fetched.
 *
 * A block that is a fragment on purpose, and not something to paste as a
 * page, is named in `FRAGMENTS` with the reason. The list is held from
 * both sides: a fragment that is no longer on its page, or that has come
 * to pass the check, fails the run, so the list cannot hide a block it no
 * longer describes.
 */

import { spawnSync } from "node:child_process"
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = fileURLToPath(new URL("..", import.meta.url))
const DOCS = join(HERE, "src/content/docs")
const PROJECT = join(HERE, "node_modules/.cache/check-astro-tabs")

/**
 * The blocks that are not recipes, by their page and a line only they have.
 * Each is expected to fail the check, which is what makes it a fragment.
 */
const FRAGMENTS: Array<{ page: string; has: string; reason: string }> = [
  {
    page: "components/dialog.mdx",
    has: 'titleId: "delivered-title"',
    reason:
      "only what a colour changes in the recipe above it: the frontmatter has no import of `lt`, and the markup stops after the header",
  },
  {
    page: "patterns/theme.mdx",
    has: "<html ",
    reason:
      "the opening tag of `<html>` alone, to show the attributes on it; the element is never closed",
  },
]

type Block = {
  page: string
  /** The line of the opening fence in the page, counted from 1. */
  line: number
  code: string
  file: string
  fragment?: (typeof FRAGMENTS)[number]
}

function pages(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) return pages(path)
    return /\.mdx?$/.test(entry.name) ? [path] : []
  })
}

const blocks: Block[] = []
for (const path of pages(DOCS)) {
  const page = relative(DOCS, path)
  const lines = readFileSync(path, "utf8").split("\n")
  for (let at = 0; at < lines.length; at++) {
    const open = /^(\s*)(`{3,})([a-z]+)\b/.exec(lines[at])
    if (!open) continue
    const [, indent, fence, name] = open
    let end = at + 1
    while (end < lines.length && lines[end].trim() !== fence) end += 1
    if (name === "astro") {
      // The block as the reader copies it: without the indentation of the
      // tab. One line of the block is one line of the page, so the line of
      // an error is the fence's line plus the line in the file.
      const code = lines
        .slice(at + 1, end)
        .map((line) =>
          line.startsWith(indent) ? line.slice(indent.length) : line,
        )
        .join("\n")
      blocks.push({
        page,
        line: at + 1,
        code,
        file: `${page.replace(/\.mdx?$/, "").replace(/[^a-z0-9]+/gi, "-")}-${at + 1}.astro`,
        fragment: FRAGMENTS.find(
          (fragment) => fragment.page === page && code.includes(fragment.has),
        ),
      })
    }
    at = end
  }
}

const findings: string[] = []

for (const fragment of FRAGMENTS) {
  const found = blocks.filter((block) => block.fragment === fragment)
  if (found.length !== 1)
    findings.push(
      `${fragment.page}: FRAGMENTS names a block with \`${fragment.has}\` in it, and the page has ${found.length} such Astro blocks. Correct the list in check-astro-tabs.ts.`,
    )
}

// A check that read no block has checked nothing.
if (blocks.length === 0)
  findings.push("found no code block for Astro in the documentation")

rmSync(PROJECT, { recursive: true, force: true })
mkdirSync(join(PROJECT, "src/pages"), { recursive: true })
let output = ""
let failed = false
try {
  writeFileSync(
    join(PROJECT, "package.json"),
    `${JSON.stringify({ name: "check-astro-tabs", type: "module", private: true })}\n`,
  )
  writeFileSync(
    join(PROJECT, "tsconfig.json"),
    `${JSON.stringify({ extends: "astro/tsconfigs/strict", include: [".astro/types.d.ts", "**/*"] })}\n`,
  )
  for (const block of blocks)
    writeFileSync(join(PROJECT, "src/pages", block.file), `${block.code}\n`)

  // With the runtime this script runs in, so no other one is needed.
  const run = spawnSync(
    process.execPath,
    [
      join(HERE, "node_modules/astro/bin/astro.mjs"),
      "check",
      "--root",
      PROJECT,
    ],
    {
      cwd: PROJECT,
      encoding: "utf8",
      env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1", NO_COLOR: "1" },
    },
  )
  // Without the colours of a terminal, should it write them all the same.
  const colours = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g")
  output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`.replace(colours, "")
  failed = run.status !== 0
  if (run.error)
    findings.push(`could not run astro check: ${run.error.message}`)
} finally {
  rmSync(PROJECT, { recursive: true, force: true })
}

/*
 * `astro check` writes an error as
 *
 *     src/pages/components-toast-141.astro:18:10 - error ts(2339): Property …
 *
 * with the lines of the code under it.
 */
const seen = new Map<Block, string[]>()
const ERROR =
  /^\s*(?:.*[\\/])?src[\\/]pages[\\/]([^\s:]+\.astro):(\d+):\d+ - error ([a-z-]+\(\d+\)|[a-z-]+): (.*)$/
for (const line of output.split("\n")) {
  const match = ERROR.exec(line)
  if (!match) continue
  const [, file, at, code, message] = match
  const block = blocks.find((each) => each.file === file)
  if (!block) {
    findings.push(
      `astro check reports ${file}, which is no block: ${line.trim()}`,
    )
    continue
  }
  const said = `${block.page}:${block.line + Number(at)}: ${code} ${message.trim()}`
  seen.set(block, [...(seen.get(block) ?? []), said])
}

const summary = /(\d+) errors?/.exec(
  output.split("\n").find((line) => /^\s*-\s*\d+ errors?/.test(line)) ?? "",
)
const total = [...seen.values()].reduce((sum, each) => sum + each.length, 0)

// The run must have said what it found, and all of it must have been read.
if (!summary)
  findings.push(
    `astro check did not say how many errors it found. It wrote:\n${output.trim()}`,
  )
else if (Number(summary[1]) !== total)
  findings.push(
    `astro check found ${summary[1]} errors, and ${total} of them were read from what it wrote:\n${output.trim()}`,
  )
else if (failed && total === 0)
  findings.push(`astro check failed without an error:\n${output.trim()}`)

const recipeErrors: string[] = []
for (const block of blocks) {
  const errors = seen.get(block) ?? []
  if (block.fragment) {
    if (errors.length === 0)
      findings.push(
        `${block.page}:${block.line}: the Astro block is in FRAGMENTS, and passes astro check. It is a recipe now: take it off the list in check-astro-tabs.ts.`,
      )
    continue
  }
  recipeErrors.push(...errors)
}
// In the order of the pages, and down each page.
findings.push(
  ...recipeErrors.sort((a, b) => {
    const [pageA, lineA] = a.split(":")
    const [pageB, lineB] = b.split(":")
    return pageA.localeCompare(pageB) || Number(lineA) - Number(lineB)
  }),
)

if (findings.length > 0) {
  console.error(
    `Found ${findings.length} problems in the Astro recipes under astro/tsconfigs/strict:\n${findings.map((f) => `  - ${f}`).join("\n")}`,
  )
  process.exit(1)
}
console.log(
  `The Astro recipes pass astro check under astro/tsconfigs/strict: ${blocks.length - FRAGMENTS.length} blocks, and ${FRAGMENTS.length} fragments that are held to fail it.`,
)
