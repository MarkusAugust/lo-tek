/**
 * The contracts, run against what one platform gives a screen reader. What a
 * step means, how its window of events is closed, how a node is compared
 * with the contract and the known deviations, the core's model, and the
 * mutation tests are here, once. The platform is behind the port below: an
 * adapter drives the browser (`PageHandle`) and reads the platform's
 * accessibility tree and events (`Recorder`), and says what the platform
 * calls the roles and states (`Platform`).
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { type AxNode, accessibilityCore } from "../../src/testing/accessibility"
import { renderedMarkup } from "../../src/testing/rendered"
import {
  type Action,
  type Contract,
  deviationAt,
  type Expected,
  label,
  type Step,
} from "./contract"
import { PACKAGE, type serve } from "./fixture"
import {
  type Engine,
  KNOWN_DEVIATIONS,
  KNOWN_ROLE_DEVIATIONS,
  type Politeness,
  type Role,
  type State,
} from "./platform"

/* The port */

/** A node as the platform gives it, in the platform's own role and state names. */
export type PlatformNode = {
  role: string
  name: string
  description: string
  states: string[]
}

export type Focused = { node: PlatformNode | null; ancestors: PlatformNode[] }

/** Text a live region gave a screen reader, once per change. */
export type Announcement = { text: string; politeness: Politeness }

/** A change a contract step can require an event for. */
export type Change = State | "description"

/** What a platform calls the contracts' words. */
export type Platform = {
  /** "AT-SPI", in messages. */
  name: string
  roles: Record<Role, readonly string[]>
  states: Record<State, string>
  /** The event that carries the change, in messages. */
  changeEvent: (change: Change) => string
}

/**
 * The platform's events, as one stream for the whole run. Positions in it
 * are the indexes the methods take: a step's window is from one position to
 * another.
 */
export interface Recorder {
  /** How many events have arrived: the position the next one gets. */
  cursor(): number
  /** The focused node and its ancestors, asked after everything so far. */
  focused(step: string): Promise<Focused>
  /** The node that last got focus belongs to the page that had it. */
  forget(): void
  /** Waits for the event that carries the marker, after `from`; its position. */
  marker(from: number, marker: string, step: string): Promise<number>
  /** Waits until the browser says the tree of the document titled `title` is complete. */
  loaded(from: number, title: string): Promise<void>
  /** What live regions announced from `from` up to `to`, the barrier left out. */
  announcements(from: number, to: number): Announcement[]
  /** Whether the change was sent from `from` up to `to` for a node `isFocused` accepts. */
  changed(
    from: number,
    to: number,
    change: Change,
    isFocused: (node: PlatformNode) => boolean,
  ): boolean
  /** The events from `from`, one line each, `end` marked, for LOTEK_A11Y_DEBUG. */
  describe(from: number, end?: number): string[]
}

export interface PageHandle {
  /** Loads the page; the HTTP status. */
  goto(url: string): Promise<number | undefined>
  act(action: Action): Promise<void>
  evaluate<R, A>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R>
  close(): Promise<void>
}

export interface BrowserHandle {
  /** A new page; with `clock`, the fake clock is installed before it loads. */
  newPage(options: { clock: boolean }): Promise<PageHandle>
  /** Resolves when the browser goes away in the middle of the run. */
  gone: Promise<string>
  /** Whether a process of it still runs, for a hung run's message. */
  alive(): string
  close(): Promise<void>
}

/* The steps */

export class StepFailure extends Error {
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
const emptied = (expected: Expected, node: PlatformNode | null) =>
  node !== null && node.name.trim() === "" && expected.name !== ""

/** The role names this engine gives for the role, the known deviation first. */
function rolesFor(platform: Platform, engine: Engine, role: Expected["role"]) {
  const deviation = KNOWN_ROLE_DEVIATIONS.find(
    (d) => d.engine === engine && d.role === role,
  )
  const spec: string[] = [...platform.roles[role]]
  return {
    accepted: deviation ? [deviation.platformRole] : spec,
    spec,
    deviation,
  }
}

const roleMatches = (
  platform: Platform,
  engine: Engine,
  expected: Expected,
  node: PlatformNode,
) => {
  const { accepted, spec } = rolesFor(platform, engine, expected.role)
  return accepted.includes(node.role) || spec.includes(node.role)
}

/** A role that matches only the spec, while a known deviation says otherwise, means the deviation is gone. */
function roleProblem(
  platform: Platform,
  engine: Engine,
  expected: Expected,
  node: PlatformNode,
): string | undefined {
  const { accepted, spec, deviation } = rolesFor(
    platform,
    engine,
    expected.role,
  )
  if (accepted.includes(node.role)) return undefined
  if (deviation && spec.includes(node.role))
    return `role "${node.role}" as Core-AAM says now: the known role deviation for ${engine} (${expected.role} as "${deviation.platformRole}") is gone, remove it from platform.ts`
  return `role "${node.role}", not ${expected.role}`
}

function compare(
  platform: Platform,
  engine: Engine,
  at: string,
  what: string,
  expected: Expected,
  node: PlatformNode | null,
): string[] {
  if (!node) return [`${what}: no node`]
  const problems: string[] = []
  const wrongRole = roleProblem(platform, engine, expected, node)
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
    const has = node.states.includes(platform.states[state])
    if (
      deviations.some((d) => "missingState" in d && d.missingState === state)
    ) {
      if (has) problems.push(gone(`has ${state}`))
    } else if (!has) problems.push(`not ${state} [${node.states.join(", ")}]`)
  }
  for (const state of expected.notStates ?? []) {
    const has = node.states.includes(platform.states[state])
    if (deviations.some((d) => "extraState" in d && d.extraState === state)) {
      if (!has) problems.push(gone(`not ${state}`))
    } else if (has) problems.push(`${state}, which it must not be`)
  }
  return problems.map((p) => `${what} ${p}`)
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

/**
 * The core's accessibility tree, from the core the package carries. The
 * model tests check invariants on it without a browser's platform layer;
 * this is where it is compared with the platform, so it is not a copy that
 * nothing checks.
 */
/** How many steps the core's focused node was actually compared on; it must be more than zero. */
let coreCompared = 0
export const comparedWithCore = () => coreCompared
const core = accessibilityCore(
  readFileSync(join(PACKAGE, "core/lotek-core.wasm")),
)

/** What the core says about a node, as a contract's expectation. */
function expectation(platform: Platform, node: AxNode): Expected {
  const states = Object.keys(platform.states) as State[]
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
 * the node the platform says has focus: role, name, description and every
 * state the platform table maps, with the same known deviations as the
 * contracts. A page the core refuses is a red step, never a skipped
 * comparison.
 */
async function coreAgrees(
  platform: Platform,
  engine: Engine,
  page: PageHandle,
  rec: Recorder,
  at: string,
  step: string,
): Promise<string[]> {
  const html = await waiting(
    `the rendered page at ${step}`,
    page.evaluate(renderedMarkup, undefined),
  )
  let tree: AxNode[]
  try {
    tree = core.tree(html)
  } catch (error) {
    return [`core: refused the page: ${(error as Error).message}`]
  }
  const focused = (await rec.focused(step)).node
  const mine = tree.find((n) => n.states.includes("focused"))
  if (!mine)
    return focused && !focused.role.startsWith("document")
      ? [
          `core: no focused node, ${platform.name} has ${focused.role} "${focused.name}"`,
        ]
      : []
  if (!(mine.role in platform.roles))
    return [
      `core: the role "${mine.role}" has no ${platform.name} name in platform.ts`,
    ]
  coreCompared++
  return compare(
    platform,
    engine,
    at,
    "core:",
    expectation(platform, mine),
    focused,
  )
}

async function act(page: PageHandle, action: Action) {
  waitingFor = `the action ${JSON.stringify(action)}`
  await page.act(action)
}

type Run = {
  platform: Platform
  engine: Engine
  page: PageHandle
  rec: Recorder
}

async function step(
  { platform, engine, page, rec }: Run,
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
    rec.marker(from, marker, s.name).catch((error) => {
      if (process.env.LOTEK_A11Y_DEBUG)
        for (const line of rec.describe(from))
          console.error(`    ${engine} ${at} ${line}`)
      throw error
    })
  await waiting(
    `the page to write the first marker at ${s.name}`,
    writeMarker(`lotek-sync-${n}-${s.name}-first`),
  )
  await waiting(
    `${platform.name} to deliver the first marker at ${s.name}`,
    arrived(`lotek-sync-${n}-${s.name}-first`),
  )
  await waiting(
    `the page to write the second marker at ${s.name}`,
    writeMarker(`lotek-sync-${n}-${s.name}-second`),
  )
  const end = await waiting(
    `${platform.name} to deliver the second marker at ${s.name}`,
    arrived(`lotek-sync-${n}-${s.name}-second`),
  )
  /*
   * The questions come after the second marker: Chromium can deliver the
   * first before the component's own events in the same batch, and the
   * recorder answers from those events. What a question causes lands in the
   * next step's window, which starts here, or in the last step's tail.
   */
  const problems: string[] = []
  let emptyName = false
  // Only on the recipe as written: a mutation is caught by the contract, never by a core that disagrees.
  if (clean)
    problems.push(
      ...(await coreAgrees(platform, engine, page, rec, at, s.name)),
    )
  const now = s.focus || s.within ? await rec.focused(s.name) : undefined
  if (now) {
    if (s.focus) {
      problems.push(
        ...compare(platform, engine, at, "focus:", s.focus, now.node),
      )
      emptyName ||= emptied(s.focus, now.node)
    }
    if (s.within) {
      const want = s.within
      const ancestor = now.ancestors.find((a) =>
        roleMatches(platform, engine, want, a),
      )
      if (!ancestor)
        problems.push(
          `within: no ${want.role} above the focus [${now.ancestors.map((a) => a.role).join(" < ")}]`,
        )
      else {
        problems.push(
          ...compare(
            platform,
            engine,
            at,
            `within ${want.role}:`,
            want,
            ancestor,
          ),
        )
        emptyName ||= emptied(want, ancestor)
      }
    }
  }
  if (s.changes) {
    const want = s.focus
    const isFocused = (node: PlatformNode) =>
      !want ||
      (roleMatches(platform, engine, want, node) &&
        node.name.trim() === want.name)
    const changes: Change[] = [
      ...(s.changes.states ?? []),
      ...(s.changes.description ? ["description" as const] : []),
    ]
    for (const change of changes) {
      const sent = rec.changed(from, end, change, isFocused)
      const event = platform.changeEvent(change)
      const deviation = KNOWN_DEVIATIONS.find(
        (d) =>
          d.engine === engine &&
          d.at === at &&
          "missingChange" in d &&
          d.missingChange === change,
      )
      if (deviation && sent)
        problems.push(
          `changes: ${event} is sent now: the known deviation for ${engine} at ${at} is gone`,
        )
      else if (!deviation && !sent)
        problems.push(`changes: no ${event} for the focused node`)
    }
  }
  const announced = rec.announcements(from, end)
  if (s.announce) {
    const want = s.announce
    const texts = announced
      .filter((a) => a.politeness === want.politeness)
      .map((a) => a.text)
    const times = texts.join("\n").split(want.text).length - 1
    if (times !== 1)
      problems.push(
        `announce: "${want.text}" ${times} times in ${want.politeness} regions, not once [${texts.map((t) => JSON.stringify(t)).join(", ")}]`,
      )
  }
  if (s.quiet && announced.length > 0)
    problems.push(
      `quiet: text inserted in a live region [${announced.map((a) => JSON.stringify(a.text)).join(", ")}]`,
    )
  // After the last step, a third marker: what arrives after the contract is
  // over is announced too, and nothing else checks it.
  if (last) {
    await waiting(
      `the page to write the last marker after ${s.name}`,
      writeMarker(`lotek-sync-${n}-${s.name}-after`),
    )
    const after = await waiting(
      `${platform.name} to deliver the last marker after ${s.name}`,
      arrived(`lotek-sync-${n}-${s.name}-after`),
    )
    const late = rec.announcements(end + 1, after)
    if (late.length > 0)
      problems.push(
        `after the last step: text inserted in a live region [${late.map((a) => JSON.stringify(a.text)).join(", ")}]`,
      )
  }
  /*
   * LOTEK_A11Y_DEBUG=1 prints what the platform sent during a failed step,
   * and what came after the barrier, a second later, to see whether anything
   * arrived out of order. LOTEK_A11Y_DEBUG=<step name> prints it for that
   * step also when it passes, to see why a mutation is not caught.
   */
  const debug = process.env.LOTEK_A11Y_DEBUG
  if (debug && (problems.length > 0 || debug === s.name)) {
    await new Promise((r) => setTimeout(r, 1000))
    for (const line of rec.describe(from, end))
      console.error(`    ${engine} ${at} ${line}`)
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
  platform: Platform,
  engine: Engine,
  browser: BrowserHandle,
  rec: Recorder,
  server: ReturnType<typeof serve>,
  contract: Contract,
  mutation?: number,
): Promise<Outcome> {
  let steps = 0
  rec.forget()
  let page: PageHandle | undefined
  try {
    page = await waiting(
      "a new page",
      browser.newPage({ clock: contract.clock === true }),
    )
    const loadFrom = rec.cursor()
    const status = await page.goto(server.url(contract, mutation))
    if (status !== 200)
      throw new StepFailure("load", `the fixture answered ${status}`)
    /*
     * The page's load is not the tree's. Until the browser says the
     * document's accessibility tree is complete, it folds changes into the
     * tree it is building, and a live region is not a region yet: a
     * reportFailure() right after load came out as plain text in the
     * document, and was never announced. So the first step waits for the
     * browser's own word, through the platform.
     */
    await rec.loaded(loadFrom, contract.component)
    let cursor = rec.cursor()
    for (const [n, s] of contract.steps.entries()) {
      cursor = await step(
        { platform, engine, page, rec },
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
  browser: BrowserHandle,
  start: () => Promise<Outcome>,
): Promise<Guarded> {
  let timer: Timer | undefined
  const gone = new Promise<Guarded>((done) => {
    browser.gone.then((message) =>
      done({ ok: false, steps: 0, at: "browser", message, dead: true }),
    )
    timer = setTimeout(
      () =>
        done({
          ok: false,
          steps: 0,
          at: "browser",
          message: `waited-in-vain-for-the-run: no answer in ${RUN_DEADLINE / 1000} s, waiting for ${waitingFor}; ${browser.alive()}`,
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

/**
 * Every chosen contract in one engine: the recipe as written, where every
 * step must pass, and each of its mutations, which must fail at exactly the
 * step it names. The runs and the failures, for the count at the bottom.
 */
export async function runEngine(
  platform: Platform,
  engine: Engine,
  browser: BrowserHandle,
  rec: Recorder,
  server: ReturnType<typeof serve>,
  contracts: Contract[],
): Promise<{ ran: number; failures: string[] }> {
  const failures: string[] = []
  let ran = 0
  runs: for (const contract of contracts) {
    const clean = await guarded(browser, () =>
      run(platform, engine, browser, rec, server, contract),
    )
    if (!clean.ok)
      failures.push(
        `${engine} ${label(contract)}: ${clean.at}: ${clean.message}`,
      )
    if (clean.dead) break
    for (const [m, mutation] of contract.mutations.entries()) {
      const broken = await guarded(browser, () =>
        run(platform, engine, browser, rec, server, contract, m),
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
  return { ran, failures }
}

/** The runs a set of contracts makes in one engine: each recipe and each of its mutations. */
export const runsOf = (contracts: Contract[]) =>
  contracts.reduce((n, c) => n + 1 + c.mutations.length, 0)

/** The count and the failures, and the exit status. */
export function report(options: {
  ran: number
  expected: number
  contracts: number
  engines: number
  partial?: string
  failures: string[]
}): never {
  const { ran, expected, failures } = options
  console.log(
    `\n${ran} runs of ${expected} expected, ${options.contracts} contracts in ${options.engines} engines`,
  )
  if (options.partial) console.log(options.partial)
  for (const f of failures) console.error(`✗ ${f}`)
  if (ran !== expected || ran === 0) {
    console.error(`✗ ran ${ran} of ${expected}`)
    process.exit(1)
  }
  process.exit(failures.length > 0 ? 1 : 0)
}
