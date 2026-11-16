/**
 * The accessibility contracts, checked against what AT-SPI gives a screen
 * reader, in Chromium and Firefox.
 *
 * A screen reader is a machine: what it says is a function of the platform's
 * accessibility tree and the events the browser sends through the platform
 * API. Those two are what this reads, the way Orca does, through AT-SPI on
 * Linux, with the expected values from the contracts in
 * `accessibility/contracts.ts`. No speech and no clock: every step waits for
 * the event it expects, with a deadline that fails with the step's name.
 *
 * Each contract runs on the recipe from its component page, the "Plain HTML"
 * tab, with the CDN addresses rewritten to this package: what a reader
 * pastes is what is checked. Each run checks the contract on the recipe as it
 * is, where every step must pass, and on every mutation the contract lists,
 * where the run must fail at exactly the step the mutation names. The
 * mutation tests are part of every run.
 *
 * On Linux it runs here, inside an accessibility session
 * (`accessibility/session.sh`). Elsewhere it runs itself in the Playwright
 * image CI uses, with podman or docker.
 *
 * Run with: bun run build, then bun interfaces/scripts/check-accessibility-tree.ts
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { diagnosePage } from "../src/diagnostics/index"
import { ATSPI, ATSPI_ENGINES, launch, recorder } from "./accessibility/atspi"
import { label } from "./accessibility/contract"
import { CONTRACTS } from "./accessibility/contracts"
import { fixture, serve } from "./accessibility/fixture"
import { ENGINE_NAMES } from "./accessibility/platform"
import {
  comparedWithCore,
  report as finish,
  runEngine,
  runsOf,
} from "./accessibility/runner"

const PACKAGE = resolve(import.meta.dir, "..")
const ROOT = resolve(PACKAGE, "..")

/* Where this runs */

function inContainer(): never {
  const engine = Bun.which("podman") ?? Bun.which("docker")
  if (!engine) {
    console.error(
      "✗ The accessibility tree is read through AT-SPI, which only Linux has. Outside Linux the check runs in the Playwright image, and needs podman or docker.",
    )
    process.exit(1)
  }
  const playwright = JSON.parse(
    readFileSync(join(PACKAGE, "package.json"), "utf8"),
  ).devDependencies.playwright.replace(/^\^/, "")
  const image = `mcr.microsoft.com/playwright:v${playwright}-noble`
  const platform = `linux/${process.arch === "arm64" ? "arm64" : "amd64"}`
  // The Bun that CI runs, not the one on this machine.
  const bun = readFileSync(
    join(PACKAGE, "../.github/workflows/ci.yml"),
    "utf8",
  ).match(/bun-version: (\S+)/)?.[1]
  if (!bun) throw new Error("ci.yml names no bun-version")
  const inside = [
    "set -eo pipefail",
    "cd /work",
    "bash interfaces/scripts/accessibility/install.sh",
    `npm install -g --silent bun@${bun} >/dev/null`,
    "bun interfaces/scripts/check-accessibility-tree.ts",
  ].join(" && ")
  console.log(
    `The accessibility tree, in ${image} (${platform}) with ${engine.split("/").pop()}`,
  )
  const run = Bun.spawnSync(
    [
      engine,
      "run",
      "--rm",
      "--platform",
      platform,
      "-e",
      `LOTEK_A11Y_DEBUG=${process.env.LOTEK_A11Y_DEBUG ?? ""}`,
      "-e",
      `LOTEK_A11Y_ONLY=${process.env.LOTEK_A11Y_ONLY ?? ""}`,
      "-e",
      `LOTEK_A11Y_ENGINE=${process.env.LOTEK_A11Y_ENGINE ?? ""}`,
      "-v",
      `${ROOT}:/work:ro`,
      image,
      "bash",
      "-c",
      inside,
    ],
    { stdout: "inherit", stderr: "inherit" },
  )
  process.exit(run.exitCode ?? 1)
}

if (process.platform !== "linux") inContainer()

if (!existsSync(join(PACKAGE, "dist/register.js"))) {
  console.error(
    "✗ interfaces/dist is missing: run bun run build first. The recipes load the package from there.",
  )
  process.exit(1)
}

/* The run */

// LOTEK_A11Y_ENGINE=firefox runs one engine, while looking for a fault in it.
const engineFilter = process.env.LOTEK_A11Y_ENGINE
if (engineFilter && !ATSPI_ENGINES.includes(engineFilter as never)) {
  console.error(
    `✗ LOTEK_A11Y_ENGINE=${engineFilter} is not one of ${ATSPI_ENGINES.join(", ")}`,
  )
  process.exit(1)
}
// Inside a session: the one engine the session was started for.
const part = process.env.LOTEK_A11Y_PART
const ENGINES = ATSPI_ENGINES.filter(
  (engine) => !engineFilter || engine === engineFilter,
).filter((engine) => !part || engine === part)

const failures: string[] = []
// LOTEK_A11Y_ONLY=toast runs one contract, while working on it. Such a run
// says so at the bottom: it is not the check.
const only = process.env.LOTEK_A11Y_ONLY
const chosen = CONTRACTS.filter((c) => !only || c.component === only)
// Counted from every contract, not from the queue, unless a filter is set.
const expected = ENGINES.length * runsOf(only ? chosen : CONTRACTS)
let ran = 0
/** The longest a session per engine may take: the whole run, with room. */
const SESSION_DEADLINE = 15 * 60_000

/*
 * Each engine in a session of its own: its own D-Bus, AT-SPI bus, X server
 * and recorder, and the engines at the same time. In one shared session the
 * browser that ran second quit with exit status 0 a little after the first
 * had closed, now and then, whichever engine came first (seen 4 times out
 * of 4 with Firefox first, on 2026-10-30), while a session with one engine
 * never did. What sends the second browser away has not been found; one
 * session per engine leaves nothing of one browser for the other to meet.
 */
if (!process.env.LOTEK_A11Y_SESSION) {
  const runs = ENGINES.map(async (engine) => {
    const dir = mkdtempSync(join(tmpdir(), `lotek-a11y-${engine}-`))
    const report = join(dir, "report.json")
    const runtime = join(dir, "runtime")
    mkdirSync(runtime, { mode: 0o700 })
    const child = Bun.spawn(
      [
        // A process group of its own: when the deadline runs out, the
        // session ends, recorder and X server, not only the
        // `dbus-run-session` at the top. The browsers have groups of their
        // own (Playwright launches them detached), and are ended by name.
        "setsid",
        "bash",
        join(PACKAGE, "scripts/accessibility/session.sh"),
        "bun",
        join(PACKAGE, "scripts/check-accessibility-tree.ts"),
      ],
      {
        env: {
          ...process.env,
          LOTEK_A11Y_PART: engine,
          LOTEK_A11Y_REPORT: report,
          // The AT-SPI bus's socket lives here, so two sessions need two.
          XDG_RUNTIME_DIR: runtime,
        },
        stdout: "inherit",
        stderr: "inherit",
      },
    )
    try {
      // A session that never ends would be the hang the run deadline removed.
      const ended = await Promise.race([
        child.exited.then(() => true),
        Bun.sleep(SESSION_DEADLINE).then(() => false),
      ])
      if (!ended) {
        try {
          process.kill(-child.pid, "SIGKILL")
        } catch {
          child.kill("SIGKILL")
        }
        Bun.spawnSync(["pkill", "-KILL", "-f", `/ms-playwright/${engine}`])
        await child.exited
        return {
          ran: 0,
          compared: 0,
          failures: [
            `${engine}: waited-in-vain-for-the-session: no end in ${SESSION_DEADLINE / 60_000} minutes`,
          ],
        }
      }
      if (!existsSync(report))
        return {
          ran: 0,
          compared: 0,
          failures: [
            `${engine}: the session ended without a report (exit ${child.exitCode})`,
          ],
        }
      const result = JSON.parse(readFileSync(report, "utf8")) as {
        ran: number
        compared: number
        failures: string[]
      }
      if (child.exitCode !== 0)
        result.failures.push(
          `${engine}: the session exited with ${child.exitCode}`,
        )
      if (result.compared === 0)
        result.failures.push(
          `${engine}: the core's tree was compared with AT-SPI on no step`,
        )
      return result
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  for (const result of await Promise.all(runs)) {
    ran += result.ran
    failures.push(...result.failures)
  }
  failures.push(...withoutBrowser())
  report()
}

/*
 * What `lotek check` says about each recipe, without a browser, from the
 * same core: nothing about names on the recipe as written, and
 * `without-name` on exactly the mutations whose `lotekCheck` says so. The
 * sessions hold the other side: a mutation that leaves a name empty in a
 * browser has to say what `lotek check` makes of it.
 */
function withoutBrowser(): string[] {
  const out: string[] = []
  const missing = (html: string) =>
    diagnosePage(html).filter((f) => f.rule === "without-name")
  for (const contract of chosen) {
    for (const f of missing(fixture(contract, undefined)))
      out.push(`lotek check, ${label(contract)}: ${f.message}`)
    for (const [m, mutation] of contract.mutations.entries()) {
      const found = missing(fixture(contract, m)).length > 0
      const says = mutation.lotekCheck === "without-name"
      if (found && !says)
        out.push(
          `lotek check, ${label(contract)}: the mutation "${mutation.name}" gives without-name, and does not say so. Write lotekCheck: "without-name".`,
        )
      if (!found && says)
        out.push(
          `lotek check, ${label(contract)}: the mutation "${mutation.name}" says lotekCheck: "without-name", and lotek check reports no missing name.`,
        )
    }
  }
  return out
}

/** The count and the failures, and the exit status. */
function report(): never {
  finish({
    ran,
    expected,
    contracts: chosen.length,
    engines: ENGINES.length,
    partial:
      only || engineFilter
        ? `Partial run (LOTEK_A11Y_ONLY=${only ?? ""}, LOTEK_A11Y_ENGINE=${engineFilter ?? ""}): ${runsOf(CONTRACTS) * ATSPI_ENGINES.length} runs make the check`
        : undefined,
    failures,
  })
}

/*
 * One recorder for the whole run, stopped only at the end. With one per
 * engine, the first engine's recorder was stopped while the next browser
 * ran, and Firefox then quit in the middle of the run with exit status 0,
 * now and then, and only after Chromium had run. The cause is not proven:
 * a pipe closed after its file descriptor had been reused fits all of it.
 */
const server = serve()
const rec = recorder()
await rec.started()
for (const engine of ENGINES) {
  const browser = await launch(engine)
  const t0 = performance.now()
  try {
    const result = await runEngine(ATSPI, engine, browser, rec, server, chosen)
    ran += result.ran
    failures.push(...result.failures)
  } finally {
    await Promise.race([browser.close().catch(() => {}), Bun.sleep(5000)])
  }
  console.log(`${engine}: ${Math.round(performance.now() - t0)} ms`)
}
server.stop()
rec.stop()

if (process.env.LOTEK_A11Y_DEBUG)
  for (const engine of Object.keys(ENGINE_NAMES))
    for (const file of [
      `/tmp/lotek-${engine}.exit`,
      `/tmp/lotek-${engine}.err`,
    ])
      if (existsSync(file))
        console.error(
          `${file}:\n${readFileSync(file, "utf8").split("\n").slice(-25).join("\n")}`,
        )
// A session reports to the conductor that started it, which counts.
const reportTo = process.env.LOTEK_A11Y_REPORT
if (reportTo) {
  await Bun.write(
    reportTo,
    JSON.stringify({ ran, compared: comparedWithCore(), failures }),
  )
  process.exit(0)
}
report()
