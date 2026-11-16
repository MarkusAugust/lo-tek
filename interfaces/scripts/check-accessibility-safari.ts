/**
 * The accessibility contracts, checked against what Safari gives VoiceOver
 * through macOS's accessibility API (AX).
 *
 * The same contracts and the same runner as `check-accessibility-tree.ts`,
 * which reads Chromium and Firefox through AT-SPI in CI. Safari only runs on
 * macOS, and CI is Linux, so this runs on the machine that releases:
 * `prepare-version` runs it before it sets a version. Every mutation runs
 * too, and must fail at the step it names.
 *
 * It takes Safari to the front for a minute or two. Once per machine:
 *
 * - System Settings, Privacy & Security, Accessibility: allow the terminal
 *   you run it from, so it can read Safari's tree;
 * - Safari, Settings, Advanced: Show features for web developers, then
 *   Develop, Allow Remote Automation;
 * - `safaridriver --enable` in a terminal, with your password.
 *
 * VoiceOver must be off while it runs.
 *
 * Run with: bun run build, then bun interfaces/scripts/check-accessibility-safari.ts
 */
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { AX, launch, recorder, SetupFailure } from "./accessibility/ax"
import { CONTRACTS } from "./accessibility/contracts"
import { serve } from "./accessibility/fixture"
import { report, runEngine, runsOf } from "./accessibility/runner"

const PACKAGE = resolve(import.meta.dir, "..")

if (process.platform !== "darwin") {
  console.error(
    "✗ Safari's accessibility tree is read through macOS's AX API: run this on a Mac",
  )
  process.exit(1)
}
if (!existsSync(join(PACKAGE, "dist/register.js"))) {
  console.error(
    "✗ interfaces/dist is missing: run bun run build first. The recipes load the package from there.",
  )
  process.exit(1)
}

// LOTEK_A11Y_ONLY=toast runs one contract, while working on it. Such a run
// says so at the bottom: it is not the check.
const only = process.env.LOTEK_A11Y_ONLY
const chosen = CONTRACTS.filter((c) => !only || c.component === only)
const expected = runsOf(chosen, "safari")

const server = serve()
const failures: string[] = []
let ran = 0
let browser: Awaited<ReturnType<typeof launch>> | undefined
let rec: Awaited<ReturnType<typeof recorder>> | undefined
try {
  browser = await launch()
  rec = await recorder()
  console.log(`The accessibility tree, through AX, in ${rec.versions}`)
  const t0 = performance.now()
  const result = await runEngine(AX, "safari", browser, rec, server, chosen)
  ran = result.ran
  failures.push(...result.failures)
  console.log(`safari: ${Math.round(performance.now() - t0)} ms`)
} catch (error) {
  if (!(error instanceof SetupFailure)) throw error
  failures.push(error.message)
} finally {
  rec?.stop()
  await browser?.close()
  server.stop()
}

report({
  ran,
  expected,
  contracts: chosen.length,
  engines: 1,
  partial: only
    ? `Partial run (LOTEK_A11Y_ONLY=${only}): ${runsOf(CONTRACTS, "safari")} runs make the check`
    : undefined,
  failures,
})
