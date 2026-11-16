/**
 * The contracts on macOS: Safari driven by safaridriver over WebDriver, and
 * what it gives VoiceOver read through the AX API by `recorder.swift`. The
 * adapter behind the runner's port.
 *
 * Safari has to be the active app, since the AX focus follows the DOM focus
 * only there, so it comes to the front while the check runs. VoiceOver must
 * be off: Safari takes its use of the window as someone else's, and stops
 * the automation. Each setup step that is missing is a failure with its
 * name.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline"
import type { Action } from "./contract"
import {
  AX_CHANGES,
  AX_EVENTS,
  AX_LIVE,
  AX_ROLES,
  AX_STATES,
  type Politeness,
} from "./platform"
import {
  type Announcement,
  type BrowserHandle,
  type Focused,
  type PageHandle,
  type Platform,
  type PlatformNode,
  type Recorder,
  StepFailure,
} from "./runner"

export const AX: Platform = {
  name: "AX",
  roles: AX_ROLES,
  states: AX_STATES,
  changeEvent: (change) =>
    AX_CHANGES[change] ?? `no AX notification for ${change}`,
  isDocument: (role) => role === "AXWebArea",
}

/** A failure of the setup, before any contract runs: its name and what to do. */
export class SetupFailure extends Error {}

/* The recorder */

type AxNode = PlatformNode & {
  id: string
  live?: string
  unreadable?: unknown
}
type AxEvent = {
  kind: "event"
  type: string
  page: string
  node: AxNode
  text?: string
  priority?: number
  live?: boolean
  ms: number
}
type Answer = {
  kind: "focused"
  tag: string
  page: string
  node: AxNode | null
  ancestors: AxNode[]
  frontmost: string
}

/**
 * The recorder, compiled from `recorder.swift` once per source, Swift and
 * macOS: the binary is cached outside the repository.
 */
function compiled(): string {
  const source = join(import.meta.dir, "recorder.swift")
  const swiftc = Bun.spawnSync(["xcrun", "--find", "swiftc"])
  if (swiftc.exitCode !== 0)
    throw new SetupFailure(
      "no-swiftc: the recorder is Swift, and xcrun finds no swiftc. Install the command line tools with xcode-select --install",
    )
  // Through xcrun, which also gives it the SDK: the binary alone found no
  // standard library.
  const version = Bun.spawnSync([
    "xcrun",
    "swiftc",
    "--version",
  ]).stdout.toString()
  const macos = Bun.spawnSync(["sw_vers", "-productVersion"]).stdout.toString()
  const hash = new Bun.CryptoHasher("sha256")
    .update(readFileSync(source))
    .update(version)
    .update(macos)
    .digest("hex")
    .slice(0, 16)
  const dir = join(homedir(), "Library/Caches/lo-tek/ax-recorder", hash)
  const binary = join(dir, "recorder")
  if (existsSync(binary)) return binary
  mkdirSync(dir, { recursive: true })
  const build = Bun.spawnSync([
    "xcrun",
    "swiftc",
    "-O",
    "-swift-version",
    "5",
    source,
    "-o",
    binary,
  ])
  if (build.exitCode !== 0)
    throw new SetupFailure(
      `recorder-does-not-compile: swiftc ${source}:\n${build.stderr.toString()}`,
    )
  return binary
}

/** The barrier's element in the fixture. */
const BARRIER = "lotek-barrier"

/*
 * The barrier's text, taken out of an announcement. Safari announces a
 * change to one live region with the text of the others on the page, as
 * "Connection restored. lotek-sync-0-offline-second" after the barrier's
 * last marker (Safari 27.2, 2026-11-16): the marker is left out, and the
 * rest is the announcement.
 */
const withoutMarkers = (text: string) =>
  text
    .replace(/lotek-sync-\S+/g, "")
    .replace(/\blotek-barrier\b/g, "")
    .replace(/\s+/g, " ")
    .trim()

const politenessOf = (priority: number | undefined) =>
  (Object.keys(AX_LIVE) as Politeness[]).find((p) => AX_LIVE[p] === priority)

function platformNode(node: AxNode): PlatformNode {
  return {
    role: node.role,
    name: node.name,
    // A description the recorder could not read is its own answer, so the
    // comparison says so instead of finding it empty.
    description:
      node.unreadable === undefined
        ? node.description
        : `<unreadable AXCustomContent: ${JSON.stringify(node.unreadable)}>`,
    states: node.states,
  }
}

export async function recorder(): Promise<
  Recorder & { versions: string; stop: () => void }
> {
  const child = Bun.spawn([compiled(), ...AX_EVENTS], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  })
  const events: AxEvent[] = []
  const answers: Answer[] = []
  let ready: { safari: string; macos: string; registered: string[] } | undefined
  // Once Safari has stopped the automation, or the recorder has gone, every
  // wait fails at once, with the reason.
  let gone: string | undefined
  let page = ""
  child.exited.then((code) => {
    gone ??= `the recorder exited with ${code}`
    for (const tick of waiting) tick()
  })
  const waiting = new Set<() => void>()
  const lines = createInterface({
    input: require("node:stream").Readable.fromWeb(child.stdout),
  })
  lines.on("line", (line: string) => {
    const message = JSON.parse(line)
    if (message.kind === "ready") ready = message
    else if (message.kind === "event") events.push(message)
    else if (message.kind === "focused") answers.push(message)
    else if (message.kind === "interrupted")
      gone ??= `interrupted: ${message.reason}`
    else if (message.kind === "error") gone ??= message.message
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
  try {
    await until(() => ready, "start", "the-recorder")
  } catch (error) {
    throw new SetupFailure((error as Error).message)
  }
  // A notification the observer did not take would look like one Safari
  // never sends, and be written down as Safari's deviation.
  const missing = AX_EVENTS.filter((e) => !ready?.registered.includes(e))
  if (missing.length > 0)
    throw new SetupFailure(
      `not-observed: AXObserverAddNotification refused ${missing.join(", ")}`,
    )
  // Only the page the run is on: Safari is one process for every window,
  // and the owner's own tabs post too.
  const own = (e: AxEvent) => e.page === page
  let asked = 0
  const ask = async (step: string) => {
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
    versions: `Safari ${ready?.safari}, macOS ${ready?.macos}`,
    cursor: () => events.length,
    focused: async (step): Promise<Focused> => {
      const answer = await ask(step)
      if (answer.frontmost !== "com.apple.Safari")
        throw new StepFailure(
          step,
          `safari-not-in-front: ${answer.frontmost || "another app"} is, and the AX focus follows the page only in the active app`,
        )
      if (answer.node && answer.page !== page)
        throw new StepFailure(
          step,
          `the focus is in another page, "${answer.page}", not "${page}"`,
        )
      return {
        node: answer.node && platformNode(answer.node),
        ancestors: answer.ancestors.map(platformNode),
      }
    },
    // The recorder asks the tree each time, so there is no last focus to forget.
    forget: () => {},
    // Only the barrier's own node: Safari puts the marker into other
    // regions' announcements too, and one of those is not the barrier.
    marker: (from, marker, step) =>
      until(
        () => {
          const i = events.findIndex(
            (e, k) =>
              k >= from &&
              own(e) &&
              e.type === "AXAnnouncementRequested" &&
              e.node.id === BARRIER &&
              (e.text ?? "").includes(marker),
          )
          return i >= 0 ? i : undefined
        },
        step,
        "the-barrier",
      ),
    /*
     * Safari posts AXLoadComplete for the group around the web area, which
     * is in no page, and the web area gets the document's title a moment
     * later, with no notification that says so. So after the load, the tree
     * is asked until the focused page has the title: until then the page is
     * not the one the step should act on.
     */
    loaded: async (from, title) => {
      page = title
      try {
        await until(
          () => events.find((e, i) => i >= from && e.type === "AXLoadComplete"),
          "load",
          "the-document-tree",
        )
        const deadline = Date.now() + 10_000
        while ((await ask("load")).page !== title) {
          if (Date.now() > deadline)
            throw new StepFailure(
              "load",
              "waited-in-vain-for-the-document-title",
            )
          await Bun.sleep(50)
        }
      } catch (error) {
        if (process.env.LOTEK_A11Y_DEBUG)
          for (const e of events.slice(from))
            console.error(
              `    load ${e.type} ${e.node.role} "${e.node.name}" (${e.page})`,
            )
        throw error
      }
    },
    announcements: (from, to): Announcement[] =>
      events
        .slice(from, to)
        .filter(
          (e) =>
            own(e) &&
            e.type === "AXAnnouncementRequested" &&
            e.live === true &&
            // The barrier's own announcement, with the others' text in it,
            // is the barrier, not a change of theirs.
            e.node.id !== BARRIER &&
            withoutMarkers(e.text ?? "") !== "",
        )
        .map((e) => {
          const text = withoutMarkers(e.text ?? "")
          const politeness = politenessOf(e.priority)
          return politeness
            ? { text, politeness }
            : // A priority the table does not know can match no contract.
              {
                text: `${text} [AXPriorityKey ${e.priority}]`,
                politeness: "polite" as const,
              }
        }),
    /*
     * A notification says that something changed, not which way. A state
     * must have turned on, as AT-SPI's detail1 says there, so the node as
     * the recorder read it with the notification must have it.
     */
    changed: (from, to, change, isFocused) => {
      const type = AX_CHANGES[change]
      if (type === null) return false
      const token = change === "description" ? null : AX_STATES[change]
      return events
        .slice(from, to)
        .some(
          (e) =>
            own(e) &&
            e.type === type &&
            (token === null || e.node.states.includes(token)) &&
            isFocused(platformNode(e.node)),
        )
    },
    describe: (from, end) =>
      events
        .slice(from)
        .map(
          (e, k) =>
            `${from + k === end ? ">>barrier " : ""}+${e.ms}ms ${e.type} ${e.node.role} "${e.node.name}" #${e.node.id} [${e.node.states.join(", ")}]${e.text ? ` ${JSON.stringify(e.text)}` : ""}${e.priority ? ` priority ${e.priority}` : ""} (${e.page})`,
        ),
    // A recorder that has gone has a closed pipe: stopping it must not
    // throw, or the WebDriver session is never closed.
    stop: () => {
      try {
        child.stdin.write("quit\n")
        child.stdin.flush()
        child.stdin.end()
      } catch {}
      setTimeout(() => child.kill(), 1000)
    },
  }
}

/* The browser */

/*
 * Tab is Option-Tab. Safari's Tab moves only between text fields and pop-up
 * menus, unless "Press Tab to highlight each item" is on in its settings,
 * and a keyboard user reaches buttons and links with Option-Tab, which is
 * what the contracts' Tab means.
 */
// WebDriver's codes for the keys that are not characters, from the table in
// the WebDriver spec, "Keyboard actions".
const key = (code: number) => String.fromCharCode(code)
const OPTION = key(0xe00a)
const KEYS: Record<string, string> = {
  Enter: key(0xe007),
  Tab: key(0xe004),
  Escape: key(0xe00c),
  ArrowRight: key(0xe014),
  ArrowLeft: key(0xe012),
  ArrowDown: key(0xe015),
  ArrowUp: key(0xe013),
  Space: " ",
  Home: key(0xe011),
  End: key(0xe010),
}

/** A free port on 127.0.0.1, for safaridriver. */
function freePort(): number {
  const server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: { data() {} },
  })
  const port = server.port
  server.stop(true)
  return port
}

const FORCE = [
  "com.apple.Accessibility",
  "ShouldForceWebKitAccessibilityEnabled",
]

/** The Safari processes that run now: the pid, and whether safaridriver started it. */
function safaris(): { pid: number; automation: boolean }[] {
  const ps = Bun.spawnSync(["ps", "-axo", "pid=,args="]).stdout.toString()
  return ps
    .split("\n")
    .filter((line) => /\/Safari\.app\/Contents\/MacOS\/Safari( |$)/.test(line))
    .map((line) => ({
      pid: Number.parseInt(line, 10),
      automation: line.includes("--automation"),
    }))
}

async function quitSafari(): Promise<void> {
  for (const { pid } of safaris()) process.kill(pid)
  for (let i = 0; safaris().length > 0; i++) {
    if (i > 100)
      throw new SetupFailure(
        "safari-will-not-quit: Safari still runs after 10 s",
      )
    await Bun.sleep(100)
  }
}

/**
 * Makes Safari answer as it answers VoiceOver, for as long as the check runs.
 *
 * WebKit has two ways to answer an accessibility client: from the main
 * thread, or from a copy of the tree on a thread of its own (isolated tree
 * mode). Only VoiceOver gets the second (`clientSupportsIsolatedTree` in
 * WebKit's AXObjectCacheMac.mm), and the two differ: measured in Safari 27.2,
 * an option reached with `aria-activedescendant` is selected in one and not
 * in the other. So a Safari that has never met VoiceOver fails contracts that
 * hold for a VoiceOver user.
 *
 * The user default below, undocumented and read in the same WebKit file,
 * gives every client the second way. A web process reads it once, when it
 * starts, and never goes back, so Safari is started anew with it set and
 * quit again when it is taken off. A Safari the user opened is not ours to
 * quit: then the check refuses.
 *
 * Returns what puts the machine back.
 */
export async function asVoiceOverGetsIt(): Promise<() => Promise<void>> {
  if (safaris().some((s) => !s.automation))
    throw new SetupFailure(
      "safari-is-open: the check starts Safari itself, with a setting Safari only reads when it starts. Quit Safari and run again",
    )
  await quitSafari()
  const already =
    Bun.spawnSync(["defaults", "read", ...FORCE])
      .stdout.toString()
      .trim() === "1"
  if (!already) {
    const write = Bun.spawnSync([
      "defaults",
      "write",
      ...FORCE,
      "-bool",
      "true",
    ])
    if (write.exitCode !== 0)
      throw new SetupFailure(
        `no-forced-tree: defaults write ${FORCE.join(" ")} failed: ${write.stderr.toString().trim()}`,
      )
  }
  let restored = false
  const restore = async () => {
    if (restored) return
    restored = true
    if (!already) Bun.spawnSync(["defaults", "delete", ...FORCE])
    await quitSafari().catch(() => {})
  }
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => restore().finally(() => process.exit(130)))
  return restore
}

export async function launch(): Promise<BrowserHandle> {
  if (!Bun.which("safaridriver"))
    throw new SetupFailure(
      "no-safaridriver: safaridriver comes with Safari, and is not on the PATH",
    )
  const port = freePort()
  const driver = Bun.spawn(["safaridriver", "-p", String(port)], {
    stdout: "ignore",
    stderr: "pipe",
  })
  const base = `http://127.0.0.1:${port}`
  for (let i = 0; ; i++) {
    try {
      await fetch(`${base}/status`)
      break
    } catch {
      if (i > 100) {
        driver.kill()
        throw new SetupFailure(
          `safaridriver-does-not-answer: started on port ${port}, and gave no status in 10 s. Run safaridriver --enable once, with your password`,
        )
      }
      await Bun.sleep(100)
    }
  }
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const json = (await response.json()) as {
      value: { error?: string; message?: string } & Record<string, unknown>
    }
    if (!response.ok)
      throw new Error(
        `${json.value.error}: ${json.value.message ?? JSON.stringify(json.value)}`,
      )
    return json.value as never
  }
  let session: string
  try {
    session = (
      (await call("POST", "/session", {
        capabilities: { alwaysMatch: { browserName: "safari" } },
      })) as { sessionId: string }
    ).sessionId
  } catch (error) {
    driver.kill()
    const message = (error as Error).message
    throw new SetupFailure(
      /timed out|remote automation|Allow Remote Automation/i.test(message)
        ? `safari-will-not-be-driven: ${message}. Turn on Develop > Allow Remote Automation in Safari (Settings > Advanced > Show features for web developers first), run safaridriver --enable once, quit Safari, and run again`
        : `no-session: safaridriver could not start a session: ${message}`,
    )
  }
  const S = `/session/${session}`
  Bun.spawnSync(["osascript", "-e", 'tell application "Safari" to activate'])
  await Bun.sleep(500)

  const execute = <R>(script: string, args: unknown[] = []) =>
    call("POST", `${S}/execute/sync`, { script, args }) as Promise<R>
  const keys = (values: string[]) =>
    call("POST", `${S}/actions`, {
      actions: [
        {
          type: "key",
          id: "keyboard",
          actions: values.flatMap((value) =>
            value === KEYS.Tab
              ? [
                  { type: "keyDown", value: OPTION },
                  { type: "keyDown", value },
                  { type: "keyUp", value },
                  { type: "keyUp", value: OPTION },
                ]
              : [
                  { type: "keyDown", value },
                  { type: "keyUp", value },
                ],
          ),
        },
      ],
    })

  const act = async (action: Action, clock: boolean) => {
    if ("focus" in action) {
      const found = await execute<boolean>(
        "const e = document.querySelector(arguments[0]); if (!e) return false; e.focus(); return true",
        [action.focus],
      )
      if (!found) throw new Error(`no element ${action.focus}`)
    } else if ("press" in action) {
      const key =
        KEYS[action.press] ??
        (action.press.length === 1 ? action.press : undefined)
      if (key === undefined)
        throw new Error(
          `the key ${action.press} has no WebDriver code in ax.ts`,
        )
      await keys([key])
    } else if ("type" in action) await keys([...action.type])
    else if ("click" in action) {
      const found = (await call("POST", `${S}/element`, {
        using: "css selector",
        value: action.click,
      })) as Record<string, string>
      await call("POST", `${S}/element/${Object.values(found)[0]}/click`, {})
    } else if ("clock" in action) {
      if (!clock)
        throw new Error(
          "the page has no fake clock: the contract needs clock: true",
        )
      /*
       * In steps of 10 s. WebDriver times a script with the page's own
       * setTimeout, which the fake clock has replaced, so one call that moved
       * the clock past the script timeout ended itself with "timeout": 100 s
       * failed at once, 10 s did not (Safari 27.2, 2026-11-16).
       */
      for (let left = action.clock; left > 0; left -= 10_000)
        await execute("window.__lotekClock.runFor(arguments[0])", [
          Math.min(left, 10_000),
        ])
    } else if ("pause" in action) await Bun.sleep(action.pause)
    else if ("run" in action)
      // An expression, as Playwright's page.evaluate(string) takes it. What it
      // returns is left in the page: a returned element is not serialisable.
      await execute("(0, eval)(arguments[0]); return null", [action.run])
  }

  const gone = new Promise<string>((done) => {
    driver.exited.then((code) => done(`safaridriver exited with ${code}`))
  })

  return {
    newPage: async ({ clock }): Promise<PageHandle> => ({
      goto: async (url) => {
        const full = clock
          ? `${url}${url.includes("?") ? "&" : "?"}clock=fake`
          : url
        // WebDriver does not say what the server answered, so it is asked first.
        const status = (await fetch(full)).status
        await call("POST", `${S}/url`, { url: full })
        return status
      },
      act: (action) => act(action, clock),
      evaluate: (fn, arg) =>
        execute(`return (${fn.toString()})(arguments[0])`, [arg ?? null]),
      // The next page loads in the same window; a blank page keeps this one's
      // notifications from coming after it.
      close: async () => {
        await call("POST", `${S}/url`, { url: "about:blank" })
      },
    }),
    gone,
    alive: () =>
      driver.exitCode === null
        ? "safaridriver still runs"
        : "no safaridriver left",
    close: async () => {
      await call("DELETE", S).catch(() => {})
      driver.kill()
    },
  }
}
