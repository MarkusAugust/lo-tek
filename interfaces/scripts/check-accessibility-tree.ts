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
import { join, normalize, resolve } from "node:path"
import { createInterface } from "node:readline"
import {
  type Browser,
  type BrowserType,
  chromium,
  firefox,
  type Page,
} from "playwright"
import { diagnosePage } from "../src/diagnostics/index"
import { type AxNode, accessibilityCore } from "../src/testing/accessibility"
import { renderedMarkup } from "../src/testing/rendered"
import {
  type Action,
  type Contract,
  deviationAt,
  type Expected,
  label,
  type Step,
} from "./accessibility/contract"
import { CONTRACTS } from "./accessibility/contracts"
import {
  ATSPI_LIVE,
  ATSPI_ROLES,
  ATSPI_STATES,
  ENGINE_NAMES,
  type Engine,
  KNOWN_DEVIATIONS,
  KNOWN_ROLE_DEVIATIONS,
  type Role,
  type State,
} from "./accessibility/platform"
import { CDN, dedent, htmlBlocks, stylesheetPath, tabItems } from "./recipes"

const PACKAGE = resolve(import.meta.dir, "..")
const ROOT = resolve(PACKAGE, "..")
const PAGES = join(ROOT, "documentation/src/content/docs/components")

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

/* The recipe */

/** The "Plain HTML" tab of a component page, as one page, from this package. */
function recipe(page: string): string {
  const mdx = readFileSync(join(PAGES, `${page}.mdx`), "utf8")
  const tabs = tabItems(mdx).filter((t) => t.name === "Plain HTML")
  if (tabs.length !== 1)
    throw new Error(`${page}.mdx has ${tabs.length} "Plain HTML" tabs, not one`)
  const blocks = htmlBlocks(tabs[0].code).map(dedent)
  if (blocks.length === 0)
    throw new Error(`${page}.mdx has no HTML in its "Plain HTML" tab`)
  const html = blocks.join("\n").replaceAll(CDN, "/pkg/")
  const external = html.match(
    /(?:src|href)="(https?:[^"]+)"|from\s+"(https?:[^"]+)"/,
  )
  if (external)
    throw new Error(
      `${page}.mdx: the recipe loads ${external[1] ?? external[2]}, which a check must not fetch`,
    )
  return html
}

/** An `<Example code={…}>` on a component page, with the stylesheets it lists. */
function example(page: string, index: number): string {
  const mdx = readFileSync(join(PAGES, `${page}.mdx`), "utf8")
  const examples = [...mdx.matchAll(/<Example([^>]*?)code=\{`([\s\S]*?)`\}/g)]
  const chosen = examples[index]
  if (!chosen)
    throw new Error(
      `${page}.mdx has ${examples.length} examples, not one at ${index}`,
    )
  const styles = [
    ...(chosen[1].match(/styles=\{\[([^\]]*)\]\}/)?.[1] ?? "").matchAll(
      /"([^"]+)"/g,
    ),
  ].map((m) => m[1])
  const links = ["tokens", ...styles]
    .map(
      (name) => `<link rel="stylesheet" href="/pkg/${stylesheetPath(name)}">`,
    )
    .join("\n")
  return `${links}\n${chosen[2].trim()}`
}

function fixture(contract: Contract, mutation: number | undefined): string {
  let html =
    contract.example === undefined
      ? recipe(contract.component)
      : example(contract.component, contract.example)
  for (const [from, to] of contract.variant?.replace ?? []) {
    const count = html.split(from).length - 1
    if (count !== 1)
      throw new Error(
        `${label(contract)}: the variant finds ${JSON.stringify(from)} ${count} times, not once`,
      )
    html = html.replace(from, to)
  }
  if (mutation !== undefined) {
    const [from, to] = contract.mutations[mutation].replace
    const count = html.split(from).length - 1
    if (count !== 1)
      throw new Error(
        `${label(contract)}: the mutation "${contract.mutations[mutation].name}" finds its text ${count} times, not once`,
      )
    html = html.replace(from, to)
  }
  // The barrier's marker, outside the recipe: text written here comes from the
  // document's own process, as the component's events do. A live region,
  // since Chromium only sends text changes for content a screen reader would
  // speak; the checks leave its own text out (`isBarrier`).
  const barrier =
    '<div id="lotek-barrier" aria-live="polite" style="position:absolute;left:-10000px">lotek-barrier</div>'
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${contract.component}</title></head><body>\n${html}\n${barrier}\n</body></html>`
}

/* The server: the fixtures and the package, on 127.0.0.1, on a free port the system picks */

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const url = new URL(request.url)
    // By the contract's place in the list: a component can have variants.
    const fixtureMatch = url.pathname.match(/^\/fixture\/(\d+)$/)
    if (fixtureMatch) {
      const contract = CONTRACTS[Number(fixtureMatch[1])]
      if (!contract) return new Response("no such contract", { status: 404 })
      const m = url.searchParams.get("mutation")
      return new Response(
        fixture(contract, m === null ? undefined : Number(m)),
        {
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      )
    }
    if (url.pathname.startsWith("/pkg/")) {
      const path = normalize(join(PACKAGE, url.pathname.slice("/pkg/".length)))
      if (!path.startsWith(PACKAGE) || !existsSync(path))
        return new Response("not found", { status: 404 })
      return new Response(Bun.file(path))
    }
    return new Response("not found", { status: 404 })
  },
})

/* The recorder */

type Node = {
  role: string
  name: string
  description: string
  states: string[]
  attributes: Record<string, string>
}
type Event = {
  kind: "event"
  type: string
  detail1: number
  text: string | null
  /** The inserted text was only embedded objects, read out to their text. */
  embedding?: boolean
  node: Node | null
  ancestors: Node[]
}
type Focused = {
  kind: "focused"
  tag: string
  node: Node | null
  ancestors: Node[]
}

class StepFailure extends Error {
  constructor(
    readonly step: string,
    message: string,
    /** A node the step names came out with an empty name. */
    readonly emptyName = false,
  ) {
    super(message)
  }
}

/** Whether the node has no name where the contract promises one. */
const emptied = (expected: Expected, node: Node | null) =>
  node !== null && node.name.trim() === "" && expected.name !== ""

function recorder() {
  const child = Bun.spawn(
    [
      "python3",
      join(PACKAGE, "scripts/accessibility/recorder.py"),
      // The states it listens for are the states the contracts can name.
      ...Object.values(ATSPI_STATES),
    ],
    {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
    },
  )
  const events: Event[] = []
  const answers: Focused[] = []
  let ready = false
  // A recorder that has exited sees nothing more: every wait fails at once.
  let gone: string | undefined
  child.exited.then((code) => {
    gone = `the recorder exited with ${code}`
    for (const tick of waiting) tick()
  })
  const waiting = new Set<() => void>()
  const lines = createInterface({
    input: require("node:stream").Readable.fromWeb(child.stdout),
  })
  lines.on("line", (line: string) => {
    const message = JSON.parse(line)
    if (message.kind === "ready") ready = true
    else if (message.kind === "event") events.push(message)
    else if (message.kind === "focused") answers.push(message)
    for (const w of [...waiting]) w()
  })
  const until = <T>(
    check: () => T | undefined,
    step: string,
    what: string,
    ms = 10_000,
  ) =>
    new Promise<T>((done, fail) => {
      const tick = () => {
        const hit = check()
        if (hit !== undefined) {
          waiting.delete(tick)
          clearTimeout(timer)
          done(hit)
        } else if (gone) {
          waiting.delete(tick)
          clearTimeout(timer)
          fail(new StepFailure(step, gone))
        }
      }
      const timer = setTimeout(() => {
        waiting.delete(tick)
        fail(new StepFailure(step, `waited-in-vain-for-${what}`))
      }, ms)
      waiting.add(tick)
      tick()
    })
  let asked = 0
  const focused = async (step: string) => {
    const tag = `q${++asked}`
    child.stdin.write(`focused ${tag}\n`)
    child.stdin.flush()
    return until(
      () => answers.find((a) => a.tag === tag),
      step,
      "the-focused-node",
    )
  }
  return {
    events,
    focused,
    // The node that last got focus belongs to the page that had it. Without
    // this, a page that never moved focus was answered with the previous
    // page's node.
    forget: () => {
      child.stdin.write("forget\n")
      child.stdin.flush()
    },
    until,
    started: () =>
      until(() => (ready ? true : undefined), "start", "the-recorder"),
    stop: () => {
      child.stdin.end()
      child.kill()
    },
  }
}

/* The checks */

/** The AT-SPI role names this engine gives for the role, the known deviation first. */
function rolesFor(engine: Engine, role: Expected["role"]) {
  const deviation = KNOWN_ROLE_DEVIATIONS.find(
    (d) => d.engine === engine && d.role === role,
  )
  const spec: string[] = [...ATSPI_ROLES[role]]
  return {
    accepted: deviation ? [deviation.atspi] : spec,
    spec,
    deviation,
  }
}

const roleMatches = (engine: Engine, expected: Expected, node: Node) => {
  const { accepted, spec } = rolesFor(engine, expected.role)
  return accepted.includes(node.role) || spec.includes(node.role)
}

/** A role that matches only the spec, while a known deviation says otherwise, means the deviation is gone. */
function roleProblem(
  engine: Engine,
  expected: Expected,
  node: Node,
): string | undefined {
  const { accepted, spec, deviation } = rolesFor(engine, expected.role)
  if (accepted.includes(node.role)) return undefined
  if (deviation && spec.includes(node.role))
    return `role "${node.role}" as Core-AAM says now: the known role deviation for ${engine} (${expected.role} as "${deviation.atspi}") is gone, remove it from platform.ts`
  return `role "${node.role}", not ${expected.role}`
}

function compare(
  engine: Engine,
  at: string,
  what: string,
  expected: Expected,
  node: Node | null,
): string[] {
  if (!node) return [`${what}: no node`]
  const problems: string[] = []
  const wrongRole = roleProblem(engine, expected, node)
  if (wrongRole) problems.push(wrongRole)
  const wrongName = KNOWN_DEVIATIONS.find(
    (d) => d.engine === engine && d.at === at && "name" in d,
  )
  const actual = node.name.trim()
  if (wrongName && "name" in wrongName) {
    if (actual === expected.name)
      problems.push(
        `name "${actual}" as AccName says now: the known deviation for ${engine} at ${at} is gone, remove it from platform.ts`,
      )
    else if (actual !== wrongName.name)
      problems.push(
        `name "${actual}", neither "${expected.name}" nor the known "${wrongName.name}"`,
      )
  } else if (actual !== expected.name)
    problems.push(`name "${actual}", not "${expected.name}"`)
  if (
    expected.description !== undefined &&
    node.description.trim() !== expected.description
  )
    problems.push(
      `description "${node.description.trim()}", not "${expected.description}"`,
    )
  const deviations = KNOWN_DEVIATIONS.filter(
    (d) => d.engine === engine && d.at === at,
  )
  const gone = (state: string) =>
    `${state} as the spec says now: the known deviation for ${engine} at ${at} is gone, remove it from platform.ts`
  for (const state of expected.states ?? []) {
    const has = node.states.includes(ATSPI_STATES[state])
    if (
      deviations.some((d) => "missingState" in d && d.missingState === state)
    ) {
      if (has) problems.push(gone(`has ${state}`))
    } else if (!has) problems.push(`not ${state} [${node.states.join(", ")}]`)
  }
  for (const state of expected.notStates ?? []) {
    const has = node.states.includes(ATSPI_STATES[state])
    if (deviations.some((d) => "extraState" in d && d.extraState === state)) {
      if (!has) problems.push(gone(`not ${state}`))
    } else if (has) problems.push(`${state}, which it must not be`)
  }
  return problems.map((p) => `${what} ${p}`)
}

const isBarrier = (event: Event) =>
  event.node?.attributes.id === "lotek-barrier" ||
  event.ancestors.some((a) => a.attributes.id === "lotek-barrier")

const liveness = (event: Event) => {
  if (isBarrier(event)) return undefined
  const live =
    event.node?.attributes["container-live"] ??
    event.ancestors.find((a) => a.attributes.live)?.attributes.live
  // aria-live="off" is a region that announces nothing.
  return live === "off" ? undefined : live
}

/**
 * What the run is waiting for right now. When a run outlives its deadline,
 * this is what it was stuck on, so a hang names its cause.
 */
let waitingFor = "nothing"
async function waiting<T>(what: string, promise: Promise<T>): Promise<T> {
  waitingFor = what
  const result = await promise
  waitingFor = `nothing, last ${what}`
  return result
}

/** Whether a browser process of the engine is still running here. */
function alive(engine: Engine): string {
  const ps = Bun.spawnSync(["ps", "-eo", "args"]).stdout.toString()
  // The binary Playwright installed, under /ms-playwright/<engine>-<build>/.
  // The session's bus has the runtime folder, with the engine's name, on its
  // command line, so the name alone matched that.
  const binary = `/ms-playwright/${engine}`
  return ps.split("\n").some((l) => l.includes(binary))
    ? `${engine} still runs`
    : `no ${engine} process left`
}

/**
 * The core's accessibility tree, from the core the package carries. The
 * model tests check invariants on it without a browser's platform layer;
 * this is where it is compared with the platform, so it is not a copy that
 * nothing checks.
 */
/** How many steps the core's focused node was actually compared on; it must be more than zero. */
let coreCompared = 0
const core = accessibilityCore(
  readFileSync(join(PACKAGE, "core/lotek-core.wasm")),
)

/** What the core says about a node, as a contract's expectation. */
function expectation(node: AxNode): Expected {
  const states = Object.keys(ATSPI_STATES) as State[]
  return {
    role: node.role as Role,
    name: node.name,
    description: node.description,
    states: states.filter((s) => node.states.includes(s)),
    notStates: states.filter((s) => !node.states.includes(s)),
  }
}

/**
 * The core's focused node, from the page as the browser rendered it, against
 * the node AT-SPI says has focus: role, name, description and every state
 * the platform table maps, with the same known deviations as the contracts.
 * A page the core refuses is a red step, never a skipped comparison.
 */
async function coreAgrees(
  engine: Engine,
  page: Page,
  rec: ReturnType<typeof recorder>,
  at: string,
  step: string,
): Promise<string[]> {
  const html = await waiting(
    `the rendered page at ${step}`,
    page.evaluate(renderedMarkup),
  )
  let tree: AxNode[]
  try {
    tree = core.tree(html)
  } catch (error) {
    return [`core: refused the page: ${(error as Error).message}`]
  }
  const platform = (await rec.focused(step)).node
  const mine = tree.find((n) => n.states.includes("focused"))
  if (!mine)
    return platform && !platform.role.startsWith("document")
      ? [
          `core: no focused node, AT-SPI has ${platform.role} "${platform.name}"`,
        ]
      : []
  if (!(mine.role in ATSPI_ROLES))
    return [`core: the role "${mine.role}" has no AT-SPI name in platform.ts`]
  coreCompared++
  return compare(engine, at, "core:", expectation(mine), platform)
}

async function act(page: Page, action: Action) {
  waitingFor = `the action ${JSON.stringify(action)}`
  if ("focus" in action) await page.focus(action.focus)
  else if ("press" in action) await page.keyboard.press(action.press)
  else if ("type" in action) await page.keyboard.type(action.type)
  else if ("click" in action) await page.click(action.click)
  else if ("clock" in action) await page.clock.runFor(action.clock)
  else if ("run" in action) await page.evaluate(action.run)
}

/*
 * What live regions announced in some events. One change to a region
 * arrives at several levels: Firefox reports a new message as a new child
 * for each element in it (the text, the close button "×") and as text
 * inserted in the region itself, "Relay 14 did not answer. Try again.×"; Chromium as
 * text inserted in the region itself, as an embedded object it reads out,
 * and as the button's own "×". So:
 *
 * - text inserted in the region itself (the node has `live`) is one change,
 *   each time, also when Chromium's second message holds the end of the
 *   first ("×Could not…×");
 * - an event further down whose text such a region event, with the same
 *   politeness, holds is that change seen from below, and is left out, one
 *   per text for each region event, the nearest;
 * - what remains, in a region that reports only further down, is counted
 *   once per text, except that two direct insertions of the same text stay
 *   two.
 */
function insertions(events: Event[]): Event[] {
  const live = events.filter(
    (e) =>
      (e.type.startsWith("object:text-changed:insert") ||
        e.type.startsWith("object:children-changed:add")) &&
      liveness(e) &&
      (e.text ?? "").trim() !== "",
  )
  const textOf = (e: Event) => e.text ?? ""
  const inRegion = (e: Event) =>
    e.type.startsWith("object:text-changed:insert") &&
    e.node?.attributes.live !== undefined
  const regional = live.filter(inRegion)
  const kindOf = (e: Event) =>
    e.type.startsWith("object:children-changed")
      ? "child"
      : e.embedding
        ? "embedded"
        : "direct"
  /*
   * Each regional insertion stands for one change, and takes at most one
   * event per text and kind from below (Chromium sends the bar's own text
   * and a new child of the region for one message): the nearest one in the
   * stream. A second direct "Saved" further down, from a second change or
   * another region, is left standing and counted.
   */
  const taken = new Map<Event, Set<string>>()
  const below = live.filter((e) => {
    if (inRegion(e)) return false
    const at = events.indexOf(e)
    const candidates = regional
      .filter(
        (r) =>
          liveness(r) === liveness(e) &&
          textOf(r).includes(textOf(e)) &&
          !taken.get(r)?.has(`${kindOf(e)}\n${textOf(e)}`),
      )
      .sort(
        (a, b) =>
          Math.abs(events.indexOf(a) - at) - Math.abs(events.indexOf(b) - at),
      )
    const owner = candidates[0]
    if (!owner) return true
    const texts = taken.get(owner) ?? new Set<string>()
    texts.add(`${kindOf(e)}\n${textOf(e)}`)
    taken.set(owner, texts)
    return false
  })
  // Below, the old rule: a text inside a longer one is the same change, an
  // embedding the same as a direct text, and direct repeats stay.
  const maximal = below.filter(
    (e) =>
      !below.some(
        (f) =>
          f !== e &&
          liveness(f) === liveness(e) &&
          textOf(f).length > textOf(e).length &&
          textOf(f).includes(textOf(e)),
      ),
  )
  const direct = new Set(
    maximal
      .filter((e) => !e.embedding)
      .map((e) => `${liveness(e)}\n${textOf(e)}`),
  )
  const seen = new Set<string>()
  const rest = maximal.filter((e) => {
    const key = `${liveness(e)}\n${textOf(e)}`
    if (!e.embedding && !e.type.startsWith("object:children-changed"))
      return true
    if (direct.has(key) || seen.has(key)) return false
    seen.add(key)
    return true
  })
  return [...regional, ...rest]
}

async function step(
  engine: Engine,
  page: Page,
  rec: ReturnType<typeof recorder>,
  contract: Contract,
  s: Step,
  n: number,
  clean: boolean,
  last: boolean,
  // Where the previous step's window ended: the windows lie edge to edge,
  // so an event between two steps belongs to the next one, not to none.
  from: number,
): Promise<number> {
  const at = deviationAt(contract, s.name)
  for (const action of s.do) {
    try {
      await act(page, action)
    } catch (error) {
      throw new StepFailure(
        s.name,
        `the action ${JSON.stringify(action)} failed: ${(error as Error).message.split("\n")[0]}`,
      )
    }
  }
  /*
   * The barrier. A script can move focus or write text a frame after the
   * action, and a screen reader speaks what comes last. So the page settles,
   * then writes a marker into an element of its own, and the step's events
   * are those that came before the marker arrived.
   *
   * Twice, not once. Chromium sends accessibility changes in batches, and
   * within a batch the order is not the DOM's: the marker came before the
   * component's own text, which had been written two frames earlier. The
   * second marker is written only once the first has arrived, so the batch
   * the first was in has been sent in full; everything the page did before
   * the first marker is in that batch or an earlier one, and D-Bus delivers
   * them in order. When the second arrives, the window is complete.
   *
   * The marker is text in the document, not the title: Firefox announces the
   * title from the browser window too, which is another process, and
   * Chromium does not announce it from the document at all. It is a live
   * region, since Chromium only sends text changes for content a screen
   * reader would speak, and the checks leave it out (`isBarrier`).
   */
  const writeMarker = (marker: string) =>
    page.evaluate(
      (m) =>
        new Promise<void>((done) => {
          const frame = () => new Promise((r) => requestAnimationFrame(r))
          ;(async () => {
            await frame()
            await frame()
            // Where the user is: inside the topmost modal dialog when one is
            // open, since everything outside it is inert and sends nothing.
            // Moved a frame before the text is written: Firefox folds a move
            // and a text change in the same frame into one insertion.
            const element = document.getElementById("lotek-barrier")
            if (element) {
              const modals = [...document.querySelectorAll("dialog")].filter(
                (d) => d.matches(":modal"),
              )
              const home = modals[modals.length - 1] ?? document.body
              if (element.parentElement !== home) {
                home.append(element)
                await frame()
                await frame()
              }
              element.textContent = m
            }
            done()
          })()
        }),
      marker,
    )
  const arrived = (marker: string) =>
    rec
      .until(
        () => {
          const i = rec.events.findIndex(
            (e, k) =>
              k >= from &&
              e.type.startsWith("object:text-changed:insert") &&
              (e.text ?? "").includes(marker),
          )
          return i >= 0 ? i : undefined
        },
        s.name,
        "the-barrier",
      )
      .catch((error) => {
        if (process.env.LOTEK_A11Y_DEBUG)
          for (const e of rec.events.slice(from))
            console.error(
              `    ${engine} ${at} ${e.type} ${e.node?.role} "${e.node?.name}" ${e.text ? JSON.stringify(e.text) : ""}`,
            )
        throw error
      })
  await waiting(
    `the page to write the first marker at ${s.name}`,
    writeMarker(`lotek-sync-${n}-${s.name}-first`),
  )
  await waiting(
    `AT-SPI to deliver the first marker at ${s.name}`,
    arrived(`lotek-sync-${n}-${s.name}-first`),
  )
  await waiting(
    `the page to write the second marker at ${s.name}`,
    writeMarker(`lotek-sync-${n}-${s.name}-second`),
  )
  const end = await waiting(
    `AT-SPI to deliver the second marker at ${s.name}`,
    arrived(`lotek-sync-${n}-${s.name}-second`),
  )
  const window = rec.events.slice(from, end)
  /*
   * The questions come after the second marker: Chromium can deliver the
   * first before the component's own events in the same batch, and the
   * recorder answers from those events. What a question causes lands in the
   * next step's window, which starts here, or in the last step's tail.
   */
  const problems: string[] = []
  let emptyName = false
  // Only on the recipe as written: a mutation is caught by the contract, never by a core that disagrees.
  if (clean) problems.push(...(await coreAgrees(engine, page, rec, at, s.name)))
  const now = s.focus || s.within ? await rec.focused(s.name) : undefined
  if (now) {
    if (s.focus) {
      problems.push(...compare(engine, at, "focus:", s.focus, now.node))
      emptyName ||= emptied(s.focus, now.node)
    }
    if (s.within) {
      const want = s.within
      const ancestor = now.ancestors.find((a) => roleMatches(engine, want, a))
      if (!ancestor)
        problems.push(
          `within: no ${want.role} above the focus [${now.ancestors.map((a) => a.role).join(" < ")}]`,
        )
      else {
        problems.push(
          ...compare(engine, at, `within ${want.role}:`, want, ancestor),
        )
        emptyName ||= emptied(want, ancestor)
      }
    }
  }
  if (s.changes) {
    const want = s.focus
    const onFocused = (e: Event) =>
      e.node !== null &&
      (!want ||
        (roleMatches(engine, want, e.node) && e.node.name.trim() === want.name))
    const types = [
      ...(s.changes.states ?? []).map(
        (state) => `object:state-changed:${ATSPI_STATES[state]}`,
      ),
      ...(s.changes.description
        ? ["object:property-change:accessible-description"]
        : []),
    ]
    for (const type of types) {
      // A state must turn on; a description change has no detail.
      const sent = window.some(
        (e) =>
          e.type === type &&
          (!type.startsWith("object:state-changed:") || e.detail1 === 1) &&
          onFocused(e),
      )
      const deviation = KNOWN_DEVIATIONS.find(
        (d) =>
          d.engine === engine &&
          d.at === at &&
          "missingEvent" in d &&
          d.missingEvent === type,
      )
      if (deviation && sent)
        problems.push(
          `changes: ${type} is sent now: the known deviation for ${engine} at ${at} is gone`,
        )
      else if (!deviation && !sent)
        problems.push(`changes: no ${type} for the focused node`)
    }
  }
  const inserted = insertions(window)
  if (s.announce) {
    const want = s.announce
    const texts = inserted
      .filter((e) => liveness(e) === ATSPI_LIVE[want.politeness])
      .map((e) => e.text ?? "")
    const times = texts.join("\n").split(want.text).length - 1
    if (times !== 1)
      problems.push(
        `announce: "${want.text}" ${times} times in ${want.politeness} regions, not once [${texts.map((t) => JSON.stringify(t)).join(", ")}]`,
      )
  }
  if (s.quiet && inserted.length > 0)
    problems.push(
      `quiet: text inserted in a live region [${inserted.map((e) => JSON.stringify(e.text)).join(", ")}]`,
    )
  // After the last step, a third marker: what arrives after the contract is
  // over is announced too, and nothing else checks it.
  if (last) {
    await waiting(
      `the page to write the last marker after ${s.name}`,
      writeMarker(`lotek-sync-${n}-${s.name}-after`),
    )
    const after = await waiting(
      `AT-SPI to deliver the last marker after ${s.name}`,
      arrived(`lotek-sync-${n}-${s.name}-after`),
    )
    const late = insertions(rec.events.slice(end + 1, after))
    if (late.length > 0)
      problems.push(
        `after the last step: text inserted in a live region [${late.map((e) => JSON.stringify(e.text)).join(", ")}]`,
      )
  }
  /*
   * LOTEK_A11Y_DEBUG=1 prints what AT-SPI sent during a failed step, and
   * what came after the barrier, a second later, to see whether anything
   * arrived out of order. LOTEK_A11Y_DEBUG=<step name> prints it for that
   * step also when it passes, to see why a mutation is not caught.
   */
  const debug = process.env.LOTEK_A11Y_DEBUG
  if (debug && (problems.length > 0 || debug === s.name)) {
    await new Promise((r) => setTimeout(r, 1000))
    for (const [k, e] of rec.events.slice(from).entries())
      console.error(
        `    ${engine} ${at} ${from + k === end ? ">>barrier " : ""}${e.type} ${e.node?.role} "${e.node?.name}" ${JSON.stringify(e.node?.attributes)} ${e.text ? JSON.stringify(e.text) : ""}`,
      )
  }
  if (problems.length > 0)
    throw new StepFailure(s.name, problems.join("; "), emptyName)
  return end + 1
}

type Outcome =
  | { ok: true; steps: number }
  | {
      ok: false
      steps: number
      at: string
      message: string
      emptyName?: boolean
    }

async function run(
  engine: Engine,
  browser: Browser,
  rec: ReturnType<typeof recorder>,
  contract: Contract,
  mutation?: number,
): Promise<Outcome> {
  let steps = 0
  rec.forget()
  let page: Page | undefined
  try {
    page = await waiting("a new page", browser.newPage())
    if (contract.clock) await page.clock.install()
    const loadFrom = rec.events.length
    const response = await page.goto(
      `http://127.0.0.1:${server.port}/fixture/${CONTRACTS.indexOf(contract)}${mutation === undefined ? "" : `?mutation=${mutation}`}`,
    )
    if (response?.status() !== 200)
      throw new StepFailure(
        "load",
        `the fixture answered ${response?.status()}`,
      )
    await page.waitForLoadState("load")
    /*
     * The page's load is not the tree's. Until the browser says the
     * document's accessibility tree is complete, it folds changes into the
     * tree it is building, and a live region is not a region yet: a
     * reportFailure() right after load came out as plain text in the
     * document, and was never announced. So the first step waits for the
     * browser's own word, through AT-SPI.
     */
    await rec.until(
      () =>
        rec.events.find(
          (e, k) =>
            k >= loadFrom &&
            e.type.startsWith("document:load-complete") &&
            e.node?.name === contract.component,
        ),
      "load",
      "the-document-tree",
    )
    let cursor = rec.events.length
    for (const [n, s] of contract.steps.entries()) {
      cursor = await step(
        engine,
        page,
        rec,
        contract,
        s,
        n,
        mutation === undefined,
        n === contract.steps.length - 1,
        cursor,
      )
      steps++
    }
    return { ok: true, steps }
  } catch (error) {
    if (error instanceof StepFailure)
      return {
        ok: false,
        steps,
        at: error.step,
        message: error.message,
        emptyName: error.emptyName,
      }
    // Anything else, such as a crashed page, is a red run of its own, not
    // the end of the report.
    return { ok: false, steps, at: "error", message: String(error) }
  } finally {
    // A page in a browser that has died never closes.
    if (page)
      await Promise.race([page.close().catch(() => {}), Bun.sleep(5000)])
  }
}

type Guarded =
  | (Outcome & { dead?: undefined })
  | { ok: false; steps: number; at: string; message: string; dead: true }

/** The longest a whole run may take: every step has its own deadline far below this. */
const RUN_DEADLINE = 120_000

/*
 * A run, or why it ended without an answer. Under Bun 1.3.14 Firefox died
 * in the middle of the tab variants, and Playwright waited for the dead
 * browser without a deadline: the step hung for hours, without a word,
 * locally and in CI. Now a browser that disconnects, or a run that outlives
 * its deadline, ends the run red, and the engine's remaining runs are not
 * started, so the count at the bottom says so too.
 */
async function guarded(
  engine: Engine,
  browser: Browser,
  start: () => Promise<Outcome>,
): Promise<Guarded> {
  let timer: Timer | undefined
  const gone = new Promise<Guarded>((done) => {
    browser.once("disconnected", () =>
      done({
        ok: false,
        steps: 0,
        at: "browser",
        message: "the browser disconnected in the middle of the run",
        dead: true,
      }),
    )
    timer = setTimeout(
      () =>
        done({
          ok: false,
          steps: 0,
          at: "browser",
          message: `waited-in-vain-for-the-run: no answer in ${RUN_DEADLINE / 1000} s, waiting for ${waitingFor}; ${alive(engine)}`,
          dead: true,
        }),
      RUN_DEADLINE,
    )
  })
  try {
    return await Promise.race([start(), gone])
  } finally {
    clearTimeout(timer)
  }
}

/* The run */

/** How each engine in `ENGINE_NAMES` is started. A new engine there does not type-check until it is here. */
const LAUNCH: Record<
  Engine,
  [BrowserType, Parameters<BrowserType["launch"]>[0]]
> = {
  chromium: [
    chromium,
    { headless: false, args: ["--force-renderer-accessibility"] },
  ],
  firefox: [
    firefox,
    { headless: false, env: { ...process.env, GNOME_ACCESSIBILITY: "1" } },
  ],
  /*
   * Not WebKit. Playwright's WebKit on Linux is WebKitGTK, which exposes
   * AT-SPI, with focus and names, but in a run on 2026-10-29 it sent no text
   * change for a live region at all, so neither the barrier nor an
   * announcement can be read from it. WebKit as Safari runs it is macOS AX,
   * which is its own platform.
   */
}
// LOTEK_A11Y_ENGINE=firefox runs one engine, while looking for a fault in it.
const engineFilter = process.env.LOTEK_A11Y_ENGINE
if (engineFilter && !(engineFilter in ENGINE_NAMES)) {
  console.error(
    `✗ LOTEK_A11Y_ENGINE=${engineFilter} is not one of ${Object.keys(ENGINE_NAMES).join(", ")}`,
  )
  process.exit(1)
}
// Inside a session: the one engine the session was started for.
const part = process.env.LOTEK_A11Y_PART
const ENGINES = (Object.keys(ENGINE_NAMES) as Engine[])
  .filter((engine) => !engineFilter || engine === engineFilter)
  .filter((engine) => !part || engine === part)
  .map((engine) => [engine, ...LAUNCH[engine]] as const)

const failures: string[] = []
// LOTEK_A11Y_ONLY=toast runs one contract, while working on it. Such a run
// says so at the bottom: it is not the check.
const only = process.env.LOTEK_A11Y_ONLY
const chosen = CONTRACTS.filter((c) => !only || c.component === only)
const runsOf = (contracts: Contract[]) =>
  ENGINES.length * contracts.reduce((n, c) => n + 1 + c.mutations.length, 0)
// Counted from every contract, not from the queue, unless a filter is set.
const expected = runsOf(only ? chosen : CONTRACTS)
const allEngines = Object.keys(ENGINE_NAMES).length
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
  const runs = ENGINES.map(async ([engine]) => {
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
  console.log(
    `\n${ran} runs of ${expected} expected, ${chosen.length} contracts in ${ENGINES.length} engines`,
  )
  if (only || engineFilter)
    console.log(
      `Partial run (LOTEK_A11Y_ONLY=${only ?? ""}, LOTEK_A11Y_ENGINE=${engineFilter ?? ""}): ${(runsOf(CONTRACTS) / ENGINES.length) * allEngines} runs make the check`,
    )
  for (const f of failures) console.error(`✗ ${f}`)
  if (ran !== expected || ran === 0) {
    console.error(`✗ ran ${ran} of ${expected}`)
    process.exit(1)
  }
  process.exit(failures.length > 0 ? 1 : 0)
}

/*
 * One recorder for the whole run, stopped only at the end. With one per
 * engine, the first engine's recorder was stopped while the next browser
 * ran, and Firefox then quit in the middle of the run with exit status 0,
 * now and then, and only after Chromium had run. The cause is not proven:
 * a pipe closed after its file descriptor had been reused fits all of it.
 */
const rec = recorder()
await rec.started()
for (const [engine, type, options] of ENGINES) {
  // LOTEK_A11Y_DEBUG=1 also runs the browser through a wrapper that notes
  // its exit status and output, to see why a browser goes away.
  let wrapper: string | undefined
  if (process.env.LOTEK_A11Y_DEBUG) {
    wrapper = `/tmp/lotek-${engine}-wrapper.sh`
    await Bun.write(
      wrapper,
      `#!/bin/sh\n"${type.executablePath()}" "$@" 2>>/tmp/lotek-${engine}.err\necho "${engine} exited with $? at $(date +%T)" >> /tmp/lotek-${engine}.exit\n`,
    )
    Bun.spawnSync(["chmod", "+x", wrapper])
  }
  const browser = await type.launch({
    ...options,
    ...(wrapper ? { executablePath: wrapper } : {}),
    ...(process.env.LOTEK_A11Y_DEBUG
      ? {
          logger: {
            isEnabled: (name: string) => name === "browser",
            log: (_: string, __: string, message: string | Error) =>
              console.error(`    [${engine}] ${String(message).slice(0, 300)}`),
          },
        }
      : {}),
  })
  const t0 = performance.now()
  try {
    runs: for (const contract of chosen) {
      const clean = await guarded(engine, browser, () =>
        run(engine, browser, rec, contract),
      )
      if (!clean.ok)
        failures.push(
          `${engine} ${label(contract)}: ${clean.at}: ${clean.message}`,
        )
      if (clean.dead) break
      for (const [m, mutation] of contract.mutations.entries()) {
        const broken = await guarded(engine, browser, () =>
          run(engine, browser, rec, contract, m),
        )
        if (broken.dead) {
          failures.push(
            `${engine} ${label(contract)}, the mutation "${mutation.name}": ${broken.message}`,
          )
          break runs
        }
        if (broken.ok)
          failures.push(
            `${engine} ${label(contract)}: the mutation "${mutation.name}" passed every step, so nothing guards it`,
          )
        else if (broken.at !== mutation.failsAt)
          failures.push(
            `${engine} ${label(contract)}: the mutation "${mutation.name}" failed at ${broken.at}, not ${mutation.failsAt}: ${broken.message}`,
          )
        if (!broken.ok && broken.emptyName && mutation.lotekCheck === undefined)
          failures.push(
            `${engine} ${label(contract)}: the mutation "${mutation.name}" leaves a name empty, and says nothing about lotek check. Write lotekCheck: "without-name" when the markup shows it, or { not: why } when it cannot.`,
          )
        ran++
      }
      ran++
      console.log(
        `  ${engine} ${label(contract)}: ${clean.ok ? `${clean.steps} steps` : "red"}, ${contract.mutations.length} mutations`,
      )
    }
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
    JSON.stringify({ ran, compared: coreCompared, failures }),
  )
  process.exit(0)
}
report()
