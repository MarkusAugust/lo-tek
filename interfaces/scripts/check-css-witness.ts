/**
 * Checks that the stylesheets bear witness to the same thing as the manifest.
 *
 * The manifest is the source: it is written from the builder functions, and
 * it is what the core checks against and Kotlin is generated from. The CSS
 * is a witness. If the two say different things, one of them is wrong, and
 * that must come out:
 *
 *   1. Every allowed value in the manifest, except the default, has a
 *      selector like `.lt-button[data-variant="ghost"]`. A value without a
 *      selector does nothing visible. That can be right, as for a value only
 *      scripts read, and then it is listed in `UNSTYLED` with the reason.
 *   2. Every value a selector uses on an `lt-` class is in the manifest. A
 *      selector on a value no builder function gives is either a value
 *      missing from the API, or an internal value the component sets itself.
 *      The latter is listed in `INTERNAL` with the reason.
 *
 * The stylesheets are read by the core's CSS reader (`core/src/styles.rs`),
 * the same one `lotek check --css` uses, so the witness and the check see
 * the same thing.
 *
 * Run with: bun scripts/check-css-witness.ts, or as part of `bun run build`.
 */

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { defaultCore } from "../src/diagnostics/default-core.js"
import type { Manifest } from "../src/vocabulary/types.js"

const PACKAGE = fileURLToPath(new URL("..", import.meta.url))

const manifest: Manifest = JSON.parse(
  readFileSync(join(PACKAGE, "manifest/manifest.json"), "utf8"),
)

/**
 * Allowed values without a selector of their own, with the reason. The key
 * is `class[attribute="value"]`.
 */
const UNSTYLED: Record<string, string> = {
  'lt-search[data-state="invalid"]':
    "lt.search() always sets lt-input as well, and the state is styled there.",
  'lt-search[data-state="success"]':
    "lt.search() always sets lt-input as well, and the state is styled there.",
}

/**
 * Values the stylesheets use that are not in the manifest, with the reason.
 * The key is `class[attribute="value"]`, or `class[attribute]` when the
 * selector only asks whether the attribute exists.
 */
const INTERNAL: Record<string, string> = {
  'lt-connection-status__bar[data-state="online"]':
    "<lt-connection-status> sets it itself in the browser when the connection is back. The server writes only the bar.",
  'lt-toast__message[data-color="success"]':
    "<lt-toast> creates the messages itself, with the colour from show(). The server writes only the region.",
  'lt-toast__message[data-color="warning"]':
    "<lt-toast> creates the messages itself, with the colour from show(). The server writes only the region.",
  'lt-toast__message[data-color="danger"]':
    "<lt-toast> creates the messages itself, with the colour from show(). The server writes only the region.",
}

const key = (className: string, attribute: string, value?: string) =>
  value === undefined
    ? `${className}[${attribute}]`
    : `${className}[${attribute}="${value}"]`

function* stylesheets(folder: string): Generator<string> {
  for (const name of readdirSync(folder)) {
    const path = join(folder, name)
    if (statSync(path).isDirectory()) yield* stylesheets(path)
    else if (name.endsWith(".css")) yield path
  }
}

/** Every `class[attribute]` and `class[attribute="value"]` the stylesheets use. */
const witnessed = new Map<string, string>()
const core = defaultCore()
for (const path of [
  ...stylesheets(join(PACKAGE, "src/components")),
  ...stylesheets(join(PACKAGE, "src/tokens")),
]) {
  const file = path.slice(PACKAGE.length)
  for (const { class: className, attribute, value } of core.inspectStyles(
    readFileSync(path, "utf8"),
  ).attributes) {
    if (className.startsWith("lt-") && attribute.startsWith("data-"))
      witnessed.set(key(className, attribute, value), file)
  }
}

const mismatches: string[] = []
const used = new Set<string>()

// 1. Every allowed value has a selector. A selector that only asks whether
// the attribute exists, like `.lt-label[data-required]`, witnesses for all
// the values, and is the only thing a flag can have.
let valueCount = 0
for (const [className, { attributes }] of Object.entries(manifest.classes)) {
  for (const [attribute, allowed] of Object.entries(attributes)) {
    const flag = "flag" in allowed
    const values = flag ? [] : allowed.values
    const defaultValue = flag ? undefined : allowed.default
    const bare = witnessed.has(key(className, attribute))
    for (const value of flag ? [undefined] : values) {
      // A flag has no default: without this, it was skipped as one.
      if (!flag && value === defaultValue) continue
      valueCount += 1
      const k = key(className, attribute, value)
      if (bare || witnessed.has(k)) continue
      if (k in UNSTYLED) used.add(k)
      else
        mismatches.push(
          `${k} is ${flag ? "a flag" : "an allowed value"} without a selector. Style it, or list it in UNSTYLED with the reason.`,
        )
    }
  }
}

// 2. Every value a selector uses is in the manifest.
for (const [k, file] of witnessed) {
  const [, className, attribute, value] =
    k.match(/^(lt-[^[]+)\[([^=\]]+)(?:="(.*)")?\]$/) ?? []
  const allowed = manifest.classes[className]?.attributes[attribute]
  const known =
    allowed !== undefined &&
    (value === undefined ||
      ("values" in allowed &&
        (allowed.values.includes(value) || value === allowed.default)))
  if (known) continue
  if (k in INTERNAL) used.add(k)
  else
    mismatches.push(
      `${file} styles ${k}, which is not in the manifest. Add the value to the builder function, or list it in INTERNAL with the reason.`,
    )
}

// An exception that is no longer needed must go, or it hides the next fault.
for (const k of [...Object.keys(UNSTYLED), ...Object.keys(INTERNAL)])
  if (!used.has(k))
    mismatches.push(
      `${k} is listed as an exception, but is no longer needed. Remove it.`,
    )

if (mismatches.length > 0) {
  console.error(
    `The CSS and the manifest disagree on ${mismatches.length} things:\n`,
  )
  for (const m of mismatches) console.error(`  ${m}`)
  process.exit(1)
}
console.log(
  `The CSS bears witness to the same thing as the manifest: ${valueCount} allowed values and ${witnessed.size} selectors, with ${Object.keys(UNSTYLED).length + Object.keys(INTERNAL).length} justified exceptions.`,
)
