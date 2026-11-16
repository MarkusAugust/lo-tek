/**
 * That every fact `check-accessibility-tree.ts` builds on has one source.
 *
 * The tree check runs in a container for nearly two minutes, and much of
 * what it relies on is data copied between files: the texts a component
 * announces, the states the recorder listens for, the packages the container
 * installs, the Bun it runs, the step a known deviation applies to. A copy
 * that drifts does not fail there, it switches part of the check off: a
 * deviation for a step that does not exist is never consulted, and a state
 * the recorder does not listen for is "no event". This script reads the
 * sources and the places that must refer to them, without a browser.
 *
 * Run with: bun interfaces/scripts/check-accessibility-sources.ts
 */
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { DEFAULT_TEXTS } from "../src/components/default-texts"
import { accessibilityCore } from "../src/testing/accessibility"
import { deviationAt } from "./accessibility/contract"
import { CONTRACTS } from "./accessibility/contracts"
import {
  ATSPI_ROLES,
  ATSPI_STATES,
  KNOWN_DEVIATIONS,
  UNCOMPARED_STATES,
} from "./accessibility/platform"

const ROOT = resolve(import.meta.dir, "../..")
const read = (path: string) => readFileSync(join(ROOT, path), "utf8")
const problems: string[] = []
let checked = 0

/* Every known deviation names a step, by the key the run looks it up with. */
const steps = new Set(
  CONTRACTS.flatMap((c) => c.steps.map((s) => deviationAt(c, s.name))),
)
for (const d of KNOWN_DEVIATIONS) {
  if (!steps.has(d.at))
    problems.push(
      `platform.ts: the known deviation for ${d.engine} at "${d.at}" names no step in any contract, so it is never consulted`,
    )
  checked++
}

/* The texts a contract expects come from default-texts.ts, never as a copy. */
const contracts = read("interfaces/scripts/accessibility/contracts.ts")
for (const [key, text] of Object.entries(DEFAULT_TEXTS)) {
  if (contracts.includes(JSON.stringify(text)))
    problems.push(
      `contracts.ts writes ${JSON.stringify(text)} out: use DEFAULT_TEXTS.${key}`,
    )
  checked++
}

/* The recorder listens for the states in ATSPI_STATES, which the conductor passes it. */
const recorder = read("interfaces/scripts/accessibility/recorder.py")
const registered = recorder.match(/^for event_type in \(\n([\s\S]*?)^\):/m)?.[1]
if (registered === undefined)
  problems.push("recorder.py: the list of events it registers was not found")
const listed = registered?.match(/"object:state-changed:[a-z-]+"/g) ?? []
if (listed.length > 0)
  problems.push(
    `recorder.py lists ${listed.join(", ")} itself: the states come from ATSPI_STATES on the command line`,
  )
checked++

/*
 * Every role the platform table maps is a role the core's accessibility
 * tree knows: `platform.ts` says what AT-SPI calls a role, the core which
 * roles there are. A role only in the table would never be compared.
 */
const core = accessibilityCore(
  readFileSync(join(ROOT, "interfaces/core/lotek-core.wasm")),
)
for (const role of Object.keys(ATSPI_ROLES)) {
  if (!core.roles.includes(role))
    problems.push(
      `platform.ts maps the role "${role}", which the core's accessibility tree does not know`,
    )
  checked++
}

/* Every state the core gives is compared with AT-SPI, or says why it cannot be. */
for (const state of core.states) {
  if (!(state in ATSPI_STATES) && !(state in UNCOMPARED_STATES))
    problems.push(
      `the core gives the state "${state}", which platform.ts neither maps to AT-SPI nor lists in UNCOMPARED_STATES`,
    )
  checked++
}

/* The AT-SPI packages are listed in install.sh only. */
const install = read("interfaces/scripts/accessibility/install.sh")
const packages = ["at-spi2-core", "dbus-x11", "python3-gi", "gir1.2-atspi-2.0"]
for (const name of packages) {
  if (!install.includes(name))
    problems.push(`install.sh does not install ${name}`)
  for (const other of [
    ".github/workflows/ci.yml",
    "interfaces/scripts/check-accessibility-tree.ts",
    "interfaces/scripts/accessibility/atspi.ts",
  ])
    if (read(other).includes(name))
      problems.push(`${other} names ${name}: the list is in install.sh`)
  checked++
}

/*
 * The conductor runs the Bun that CI pins, read as the first `bun-version`
 * in ci.yml. That is only the Bun CI runs if every job pins the same one.
 */
const pins = new Set(
  [...read(".github/workflows/ci.yml").matchAll(/bun-version: (\S+)/g)].map(
    (m) => m[1],
  ),
)
if (pins.size !== 1)
  problems.push(
    `ci.yml pins ${pins.size === 0 ? "no Bun" : [...pins].join(" and ")}: the tree check runs the first, so they must be one`,
  )
checked++

/*
 * The Playwright image CI runs in is the version in package.json: the tree
 * check runs its own container from package.json, so a tag that drifted
 * would make the two check different browsers.
 */
const playwright = (
  JSON.parse(read("interfaces/package.json")) as {
    devDependencies: Record<string, string>
  }
).devDependencies.playwright.replace(/^\^/, "")
const images = [
  ...read(".github/workflows/ci.yml").matchAll(
    /mcr\.microsoft\.com\/playwright:v([0-9.]+)-/g,
  ),
].map((m) => m[1])
if (images.length === 0 || images.some((v) => v !== playwright))
  problems.push(
    `ci.yml runs the Playwright image ${images.join(", ") || "nowhere"}, and package.json has playwright ${playwright}`,
  )
checked++

console.log(`${checked} sources checked`)
for (const p of problems) console.error(`✗ ${p}`)
if (checked === 0) {
  console.error("✗ checked nothing")
  process.exit(1)
}
process.exit(problems.length > 0 ? 1 : 0)
