/**
 * The contracts on Linux: Chromium and Firefox driven by Playwright, and
 * what they give a screen reader read through AT-SPI, the way Orca reads
 * it, by `recorder.py`. The adapter behind the runner's port.
 */
import { join } from "node:path"
import { createInterface } from "node:readline"
import { type BrowserType, chromium, firefox, type Page } from "playwright"
import { PACKAGE } from "./fixture"
import {
  ATSPI_LIVE,
  ATSPI_ROLES,
  ATSPI_STATES,
  type Engine,
  type Politeness,
} from "./platform"
import {
  type Announcement,
  type BrowserHandle,
  type Focused,
  type PageHandle,
  type Platform,
  type Recorder,
  StepFailure,
} from "./runner"

export const ATSPI: Platform = {
  name: "AT-SPI",
  roles: ATSPI_ROLES,
  states: ATSPI_STATES,
  changeEvent: (change) =>
    change === "description"
      ? "object:property-change:accessible-description"
      : `object:state-changed:${ATSPI_STATES[change]}`,
  // "document web", and "document frame" in Firefox.
  isDocument: (role) => role.startsWith("document"),
}

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
type Answer = Focused & { kind: "focused"; tag: string }

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

/*
 * What live regions announced in some events. One change to a region
 * arrives at several levels: Firefox reports a new message as a new child
 * for each element in it (the text, the close button "×") and as text
 * inserted in the region itself, "Relay 14 refused the restart. Try again.×"; Chromium as
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

const politenessOf = (live: string | undefined) =>
  (Object.keys(ATSPI_LIVE) as Politeness[]).find(
    (p) => ATSPI_LIVE[p] === live,
  ) as Politeness

export function recorder(): Recorder & {
  started: () => Promise<true>
  stop: () => void
} {
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
  const answers: Answer[] = []
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
  return {
    cursor: () => events.length,
    focused: async (step) => {
      const tag = `q${++asked}`
      child.stdin.write(`focused ${tag}\n`)
      child.stdin.flush()
      return until(
        () => answers.find((a) => a.tag === tag),
        step,
        "the-focused-node",
      )
    },
    // The node that last got focus belongs to the page that had it. Without
    // this, a page that never moved focus was answered with the previous
    // page's node.
    forget: () => {
      child.stdin.write("forget\n")
      child.stdin.flush()
    },
    marker: (from, marker, step) =>
      until(
        () => {
          const i = events.findIndex(
            (e, k) =>
              k >= from &&
              e.type.startsWith("object:text-changed:insert") &&
              (e.text ?? "").includes(marker),
          )
          return i >= 0 ? i : undefined
        },
        step,
        "the-barrier",
      ),
    loaded: async (from, title) => {
      await until(
        () =>
          events.find(
            (e, k) =>
              k >= from &&
              e.type.startsWith("document:load-complete") &&
              e.node?.name === title,
          ),
        "load",
        "the-document-tree",
      )
    },
    announcements: (from, to): Announcement[] =>
      insertions(events.slice(from, to)).map((e) => ({
        text: e.text ?? "",
        politeness: politenessOf(liveness(e)),
      })),
    changed: (from, to, change, isFocused) => {
      const type = ATSPI.changeEvent(change)
      // A state must turn on; a description change has no detail.
      return events
        .slice(from, to)
        .some(
          (e) =>
            e.type === type &&
            (!type.startsWith("object:state-changed:") || e.detail1 === 1) &&
            e.node !== null &&
            isFocused(e.node),
        )
    },
    describe: (from, end) =>
      events
        .slice(from)
        .map(
          (e, k) =>
            `${from + k === end ? ">>barrier " : ""}${e.type} ${e.node?.role} "${e.node?.name}" ${JSON.stringify(e.node?.attributes)} ${e.text ? JSON.stringify(e.text) : ""}`,
        ),
    started: () =>
      until(() => (ready ? true : undefined), "start", "the-recorder"),
    stop: () => {
      child.stdin.end()
      child.kill()
    },
  }
}

/** How each engine is started. Only the engines AT-SPI reads. */
const LAUNCH: Record<
  "chromium" | "firefox",
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
   * which is its own platform (`ax.ts`).
   */
}

export const ATSPI_ENGINES = Object.keys(LAUNCH) as Engine[]

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

function pageHandle(page: Page): PageHandle {
  return {
    goto: async (url) => {
      const response = await page.goto(url)
      await page.waitForLoadState("load")
      return response?.status()
    },
    act: async (action) => {
      if ("focus" in action) await page.focus(action.focus)
      else if ("press" in action) await page.keyboard.press(action.press)
      else if ("type" in action) await page.keyboard.type(action.type)
      else if ("click" in action) await page.click(action.click)
      else if ("clock" in action) await page.clock.runFor(action.clock)
      else if ("pause" in action) await Bun.sleep(action.pause)
      else if ("run" in action) await page.evaluate(action.run)
    },
    // Playwright's types unbox the argument; the runner passes plain values.
    evaluate: (fn, arg) => page.evaluate(fn as never, arg),
    close: () => page.close(),
  }
}

export async function launch(engine: Engine): Promise<BrowserHandle> {
  const [type, options] = LAUNCH[engine as keyof typeof LAUNCH]
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
  return {
    newPage: async ({ clock }) => {
      const page = await browser.newPage()
      if (clock) await page.clock.install()
      return pageHandle(page)
    },
    gone: new Promise((done) =>
      browser.once("disconnected", () =>
        done("the browser disconnected in the middle of the run"),
      ),
    ),
    alive: () => alive(engine),
    close: () => browser.close(),
  }
}
