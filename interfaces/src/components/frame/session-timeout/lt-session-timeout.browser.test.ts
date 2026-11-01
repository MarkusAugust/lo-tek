/// <reference path="../../../types/css.d.ts" />

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

import {
  expectNoAccessibilityViolations,
  mount,
  waitForPaint,
} from "../../../testing/a11y"
import { attr } from "../../../testing/markup"
import { morph } from "../../../testing/update"
import {
  defineLtSessionTimeout,
  extendSession,
  LtSessionTimeout,
  resetSession,
} from "./lt-session-timeout"
import { type SessionTimeoutOptions, sessionTimeout } from "./session-timeout"

import "../../../tokens/tokens.css"
import "./session-timeout.css"

/**
 * A short session: warning after 3 seconds, expired after 13.
 *
 * Every simulated second is one call to the timer, and in Firefox each of
 * them costs a round trip. With minutes in the test it took over a minute to
 * run. The numbers are chosen so the countdown passes 10 seconds, which is
 * the threshold the component announces.
 */
const SHORT = { warnAt: 3, expiresAt: 13 }

type Texts = {
  title: string
  before: string
  after: string
  stay: string
  leave: string
}

/**
 * Norwegian on purpose: the default page in these tests is `lang="nb"`, so
 * the announcement tests check `Intl` in a language other than the browser's.
 */
const NORWEGIAN: Texts = {
  title: "Du blir snart logget ut",
  before: "Vi logger deg ut om",
  after: "for å beskytte opplysningene dine.",
  stay: "Fortsett å være innlogget",
  leave: "Logg ut nå",
}

const ENGLISH: Texts = {
  title: "Your session is ending",
  before: "The Lattice logs you out in",
  after: "unless you answer.",
  stay: "Stay connected",
  leave: "Log out",
}

/** The warning as the renderer writes it, with the builder function. */
function warning(
  options: Partial<SessionTimeoutOptions> = SHORT,
  texts: Texts = NORWEGIAN,
): string {
  const session = sessionTimeout({ titleId: "session-title", ...options })
  return `
    <lt-session-timeout ${attr(session.host)}>
      <dialog ${attr(session.dialog)}>
        <h2 ${attr(session.title)}>${texts.title}</h2>
        <p ${attr(session.text)}>${texts.before} <span ${attr(session.count)}></span> ${texts.after}</p>
        <span ${attr(session.live)}></span>
        <form ${attr(session.actions)}>
          <button ${attr(session.extend)}>${texts.stay}</button>
          <button ${attr(session.logout)}>${texts.leave}</button>
        </form>
      </dialog>
    </lt-session-timeout>`
}

function dialog(): HTMLDialogElement {
  return document.querySelector("dialog") as HTMLDialogElement
}

function host(): LtSessionTimeout {
  return document.querySelector("lt-session-timeout") as LtSessionTimeout
}

function announced(): string {
  return dialog().querySelector("[role='status']")?.textContent ?? ""
}

/**
 * Moves the clock without waiting for it.
 *
 * Only the timer is awaited here, not a frame. The component does all its
 * work synchronously inside the interval, so a `requestAnimationFrame` would
 * only be something extra to wait for, and in Firefox it did not fire while
 * the dialog was opening. The test then hung without an error.
 */
async function advance(seconds: number) {
  await vi.advanceTimersByTimeAsync(seconds * 1000)
}

/**
 * Closes the dialog and waits for `close`.
 *
 * `close` is a queued task, and in Firefox the frame came before the event
 * one time in ten. The component's listener is on the host in the capture
 * phase, and so runs before this one, which is on the dialog.
 */
async function closeAndWait(action: () => void) {
  const closed = new Promise((r) =>
    dialog().addEventListener("close", r, { once: true }),
  )
  action()
  await closed
}

function button(value: string): HTMLButtonElement {
  return dialog().querySelector(`button[value="${value}"]`) as HTMLButtonElement
}

function listen(element: HTMLElement, names: string[]) {
  const events: string[] = []
  for (const n of names) element.addEventListener(n, () => events.push(n))
  return events
}

// requestAnimationFrame must be real. If we fake it too, waitForPaint
// hangs, because nothing moves the clock while it waits.
function fakeClock() {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
    ],
  })
}

describe("lt-session-timeout", () => {
  beforeAll(() => {
    defineLtSessionTimeout()
  })

  beforeEach(async () => {
    fakeClock()
    mount(`<div lang="nb">${warning()}</div>`)
    await customElements.whenDefined("lt-session-timeout")
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("asks the server to leave the dialog alone", () => {
    // Without this Datastar's morph removes `open` while the dialog is in the
    // top layer.
    expect(host().hasAttribute("data-ignore-morph")).toBe(true)
  })

  it("shows nothing before the warning is due", async () => {
    await advance(2)
    expect(dialog().open).toBe(false)
  })

  it("warns when it has been quiet long enough", async () => {
    await advance(4)

    expect(dialog().open).toBe(true)
    expect(dialog().matches(":modal")).toBe(true)
    expect(dialog().getAttribute("role")).toBe("alertdialog")
  })

  it("counts down towards the expiry", async () => {
    await advance(5)

    const count = dialog().querySelector(
      ".lt-session-timeout__count",
    ) as HTMLElement
    // 13 - 5 = 8 seconds left
    expect(count.textContent).toBe("0:08")
    // The number changes every second. If it is announced every time, the
    // dialog is unusable with a screen reader.
    expect(count.getAttribute("aria-hidden")).toBe("true")
  })

  it("announces the paragraph at a few thresholds, not every second", async () => {
    await advance(3)
    expect(announced()).toBe(
      "Vi logger deg ut om 10 sekunder for å beskytte opplysningene dine.",
    )

    await advance(1)
    // No new announcement one second later.
    expect(announced()).toBe(
      "Vi logger deg ut om 10 sekunder for å beskytte opplysningene dine.",
    )
  })

  it("extends when the user presses the button with value=extend", async () => {
    await advance(4)
    const events = listen(host(), ["session-extend"])

    await closeAndWait(() => button("extend").click())

    expect(dialog().open).toBe(false)
    expect(events).toEqual(["session-extend"])

    // And the clock is reset, so the warning does not come straight back.
    await advance(2)
    expect(dialog().open).toBe(false)
  })

  it("reports when the session has actually expired", async () => {
    const events = listen(host(), ["session-expired"])

    await advance(14)

    expect(events).toEqual(["session-expired"])
    expect(dialog().open).toBe(false)
  })

  it("has no accessibility violations with the warning open", async () => {
    await advance(4)
    expect(dialog().open).toBe(true)

    vi.useRealTimers()
    await waitForPaint()

    await expectNoAccessibilityViolations()
  })
})

describe("lt-session-timeout handles Escape, wrong numbers and an expiry", () => {
  beforeAll(() => {
    defineLtSessionTimeout()
  })

  beforeEach(() => {
    fakeClock()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  async function mountShort(markup = warning()) {
    mount(`<div lang="nb">${markup}</div>`)
    await customElements.whenDefined("lt-session-timeout")
    return host()
  }

  it("extends when the user closes with Escape, and does not open again", async () => {
    // Escape comes from the browser and closes without a return value.
    // Without a listener on `close` the next tick saw a closed dialog after
    // the warning threshold, and opened it again every second.
    const element = await mountShort()
    const events = listen(element, ["session-warn", "session-extend"])
    await advance(4)
    expect(dialog().open).toBe(true)

    await closeAndWait(() => dialog().close())

    expect(events).toEqual(["session-warn", "session-extend"])
    await advance(2)
    expect(dialog().open).toBe(false)
    expect(events).toEqual(["session-warn", "session-extend"])
  })

  it("also extends for a button with a value the component does not know", async () => {
    // Without this the dialog closed, and the next tick opened it again a
    // second later, so the user never got out.
    const element = await mountShort(
      warning().replace('value="extend"', 'value="ok"'),
    )
    const events = listen(element, ["session-extend"])
    await advance(4)

    await closeAndWait(() => button("ok").click())

    expect(events).toEqual(["session-extend"])
    await advance(2)
    expect(dialog().open).toBe(false)
  })

  it("announces the time left as the dialog opens", async () => {
    // The number in the paragraph is `aria-hidden`, so without this the screen
    // reader heard the paragraph without a number, and the first number came
    // only at the next threshold.
    await mountShort(warning({ warnAt: 3, expiresAt: 30 }))
    await advance(3)

    expect(dialog().open).toBe(true)
    expect(announced()).toBe(
      "Vi logger deg ut om 27 sekunder for å beskytte opplysningene dine.",
    )
  })

  it("reports numbers that do not add up", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await mountShort(warning({ warnAt: 10, expiresAt: 5 }))
    await waitForPaint()
    await waitForPaint()

    expect(
      warn.mock.calls.some((call) =>
        String(call[0]).includes("is not less than"),
      ),
    ).toBe(true)

    warn.mockClear()
    const element = await mountShort(
      warning().replace(/warn-at="\d+"/, 'warn-at="abc"'),
    )
    element.setAttribute("expires-at", "-3")
    await waitForPaint()
    await waitForPaint()

    expect(
      warn.mock.calls.some((call) => String(call[0]).includes("not a number")),
    ).toBe(true)
    expect(element.warnAt).toBe(25 * 60)
    expect(element.expiresAt).toBe(30 * 60)
  })

  it("stops after the expiry, until extend() is called", async () => {
    // An app that does not navigate away got a new dialog and a new
    // `session-expired` every `expires-at` seconds, for a session that was
    // already gone.
    const element = await mountShort()
    const events = listen(element, ["session-warn", "session-expired"])

    await advance(14)
    expect(events).toEqual(["session-warn", "session-expired"])

    await advance(14)
    expect(events).toEqual(["session-warn", "session-expired"])
    expect(dialog().open).toBe(false)

    element.extend()
    await advance(4)
    expect(dialog().open).toBe(true)
  })

  it("lets warnAt and expiresAt be set as properties", async () => {
    const element = await mountShort()
    element.warnAt = 5
    element.expiresAt = 9
    expect(element.getAttribute("warn-at")).toBe("5")
    expect(element.getAttribute("expires-at")).toBe("9")
    expect(element.warnAt).toBe(5)
  })

  it("counts scrolling in a box as activity", async () => {
    // `scroll` does not bubble. Listened for without capture, only scrolling
    // of the page itself counted, while the documentation promised
    // "scrolling". A screen reader in browse mode sends only scrolling, no
    // key presses.
    await mountShort(
      `${warning()}<div id="box" style="overflow: auto; height: 20px"><div style="height: 200px"></div></div>`,
    )

    await advance(2)
    ;(document.getElementById("box") as HTMLElement).dispatchEvent(
      new Event("scroll"),
    )
    await advance(2)
    expect(dialog().open).toBe(false)

    await advance(2)
    expect(dialog().open).toBe(true)
  })

  it("does not report activity after the tab has been frozen past the expiry", async () => {
    // Before, `session-activity` and `session-expired` came in the same tick.
    const element = await mountShort(
      warning({ warnAt: 100, expiresAt: 130, activityInterval: 20 }),
    )
    const events = listen(element, ["session-activity", "session-expired"])
    document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }))
    await advance(5)
    document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }))

    vi.setSystemTime(Date.now() + 200_000)
    await advance(1)

    expect(events).toEqual(["session-activity", "session-expired"])
  })

  it("sends at most one activity a second, also with activity-interval 0", async () => {
    const element = await mountShort(
      warning({ warnAt: 100, expiresAt: 130 }).replace(
        "<lt-session-timeout ",
        '<lt-session-timeout activity-interval="0" ',
      ),
    )
    const events = listen(element, ["session-activity"])
    for (let i = 0; i < 20; i++) {
      document.body.dispatchEvent(new Event("scroll"))
    }

    expect(events).toEqual(["session-activity"])
  })

  it("does not report activity while the warning is showing", async () => {
    // The activity at 1 second waited for the end of the interval, which came
    // after the warning opened at 3. Then the app kept the server session
    // alive while the user was being asked to respond.
    const element = await mountShort(
      warning({ warnAt: 3, expiresAt: 13, activityInterval: 5 }),
    )
    const events = listen(element, ["session-activity"])
    document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }))
    await advance(1)
    document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }))
    await advance(6)

    expect(dialog().open).toBe(true)
    expect(events).toEqual(["session-activity"])
  })

  it("reports activity at the start and the end of an interval", async () => {
    // The server session does not know about activity in the browser. Only
    // at the start, the server would have been up to a whole interval behind
    // the clock here, and signed out before the warning was done.
    const element = await mountShort(
      warning({ warnAt: 100, expiresAt: 130, activityInterval: 20 }),
    )
    const start = Date.now()
    const times: number[] = []
    element.addEventListener("session-activity", () =>
      times.push(Math.round((Date.now() - start) / 1000)),
    )

    for (let second = 0; second < 50; second += 10) {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true }),
      )
      await advance(10)
    }

    // Activity at 0, 10, 20, 30 and 40. One event at 0, then one for each
    // interval with activity: at 20 and 40, as the key press came, and no
    // more.
    expect(times).toEqual([0, 20, 40])
  })

  it("reports activity at the end of the interval, also without a new key press", async () => {
    const element = await mountShort(
      warning({ warnAt: 100, expiresAt: 130, activityInterval: 20 }),
    )
    const start = Date.now()
    const times: number[] = []
    element.addEventListener("session-activity", () =>
      times.push(Math.round((Date.now() - start) / 1000)),
    )

    document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }))
    await advance(5)
    document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }))
    await advance(30)

    // The last key press at 5 reaches the server at 20, not never.
    expect(times).toEqual([0, 20])
  })

  it("resets without reporting anything with reset()", async () => {
    const element = await mountShort()
    const events = listen(element, ["session-extend"])
    await advance(4)
    expect(dialog().open).toBe(true)

    await closeAndWait(() => element.reset())

    expect(dialog().open).toBe(false)
    expect(events).toEqual([])
    await advance(2)
    expect(dialog().open).toBe(false)
  })

  it("reports session-logout when the user signs out, without extending", async () => {
    const element = await mountShort()
    const events = listen(element, [
      "session-logout",
      "session-extend",
      "session-warn",
    ])
    await advance(4)

    await closeAndWait(() => button("logout").click())

    expect(dialog().open).toBe(false)
    expect(events).toEqual(["session-warn", "session-logout"])

    // And it does not come back while the app is signing out.
    await advance(3)
    expect(dialog().open).toBe(false)
    expect(events).toEqual(["session-warn", "session-logout"])
  })

  it("reports the sign-out even when the clock ticks before close arrives", async () => {
    // `close` arrives in a later task than the click. When the clock ticked
    // in between, the component opened the dialog again, and the queued event
    // was read as an extension: the app got `session-extend` and never
    // `session-logout`.
    const element = await mountShort()
    const events = listen(element, [
      "session-warn",
      "session-extend",
      "session-logout",
    ])
    await advance(4)

    const closed = new Promise((r) =>
      dialog().addEventListener("close", r, { once: true }),
    )
    button("logout").click()
    await advance(1)
    await closed
    await advance(2)

    expect(events).toEqual(["session-warn", "session-logout"])
    expect(dialog().open).toBe(false)
  })

  it("puts open back when a morph takes it while the warning is showing", async () => {
    // Datastar's morph without data-ignore-morph removes `open`, since the
    // renderer did not send it. The dialog stayed in the top layer,
    // invisible, and the rest of the page was inert. Checked with real
    // Datastar 1.0.4.
    await mountShort(warning().replace("data-ignore-morph", ""))
    await advance(4)
    expect(dialog().matches(":modal")).toBe(true)

    dialog().removeAttribute("open")
    await waitForPaint()

    expect(dialog().open).toBe(true)
    expect(dialog().matches(":modal")).toBe(true)
  })

  it("leaves open removed when the user has closed the dialog", async () => {
    // The condition is `:modal`. A closed dialog has left the top layer, and
    // must not be opened again by the repair.
    await mountShort()
    await advance(4)

    await closeAndWait(() => button("extend").click())
    await waitForPaint()

    expect(dialog().open).toBe(false)
  })

  it("fills in the role and the name on a bare dialog", async () => {
    // A template without the builder function may forget them. Accessibility
    // requires both, so the component sets them when they are missing, and
    // only then.
    await mountShort(`
      <lt-session-timeout warn-at="3" expires-at="13">
        <dialog>
          <h2>Du blir snart logget ut</h2>
          <p class="lt-session-timeout__text">Vi logger deg ut om
            <span class="lt-session-timeout__count" aria-hidden="true"></span>.</p>
          <span class="lt-sr-only" role="status"></span>
          <form method="dialog"><button value="extend">Fortsett</button></form>
        </dialog>
      </lt-session-timeout>`)
    await advance(4)

    expect(dialog().getAttribute("role")).toBe("alertdialog")
    const title = document.getElementById(
      dialog().getAttribute("aria-labelledby") ?? "",
    )
    expect(title?.textContent).toBe("Du blir snart logget ut")
  })

  it("leaves a name the renderer has written in place", async () => {
    await mountShort(
      warning().replace(
        'aria-labelledby="session-title"',
        'aria-label="Økten går ut"',
      ),
    )
    await advance(4)

    expect(dialog().getAttribute("aria-label")).toBe("Økten går ut")
    expect(dialog().hasAttribute("aria-labelledby")).toBe(false)
  })

  it("writes the role and the name again when a morph of the open warning takes them", async () => {
    // The renderer did not send them, so the morph removed them, and a
    // screen reader had a modal dialog without a name until it closed.
    const bare = `
      <lt-session-timeout id="session" warn-at="3" expires-at="13">
        <dialog>
          <h2>Du blir snart logget ut</h2>
          <p class="lt-session-timeout__text">Vi logger deg ut om
            <span class="lt-session-timeout__count" aria-hidden="true"></span>.</p>
          <span class="lt-sr-only" role="status"></span>
          <form method="dialog"><button value="extend">Fortsett</button></form>
        </dialog>
      </lt-session-timeout>`
    await mountShort(bare)
    await advance(4)
    expect(dialog().getAttribute("role")).toBe("alertdialog")

    morph(host(), bare)
    await waitForPaint()

    expect(dialog().getAttribute("role")).toBe("alertdialog")
    const title = document.getElementById(
      dialog().getAttribute("aria-labelledby") ?? "",
    )
    expect(title?.textContent).toBe("Du blir snart logget ut")
  })

  it("goes on with a warning the renderer replaced while it showed", async () => {
    /*
     * `innerHTML` on the host replaces the open dialog, and the next tick
     * shows the new one: the same warning, not a new one. It sent
     * `session-warn` again, and on close focus went to what had it when the
     * new dialog opened, not to the field the user was in.
     */
    mount(`<div lang="nb"><input id="field">${warning()}</div>`)
    await customElements.whenDefined("lt-session-timeout")
    const field = document.getElementById("field") as HTMLInputElement
    const events = listen(host(), ["session-warn"])
    field.focus()
    await advance(4)
    expect(dialog().open).toBe(true)

    const t = document.createElement("template")
    t.innerHTML = warning()
    host().innerHTML =
      t.content.querySelector("lt-session-timeout")?.innerHTML ?? ""
    await advance(1)
    expect(dialog().open).toBe(true)
    const closed = new Promise((r) =>
      dialog().addEventListener("close", r, { once: true }),
    )
    await advance(9)
    await closed

    expect(events).toEqual(["session-warn"])
    expect(document.activeElement).toBe(field)
  })
})

describe("lt-session-timeout does not touch the markup from the builder function", () => {
  beforeAll(() => {
    defineLtSessionTimeout()
  })

  beforeEach(() => {
    fakeClock()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("gives no mutation records before the warning", async () => {
    // The direct claim behind "what the renderer wrote stays": markup from
    // the builder function already has everything the component would fill
    // in.
    const surface = mount(`<div id="surface" lang="nb"></div>`)
    const container = surface.querySelector("#surface") as HTMLElement
    const records: MutationRecord[] = []
    const observer = new MutationObserver((p) => records.push(...p))
    observer.observe(container, {
      subtree: true,
      attributes: true,
      characterData: true,
      childList: true,
    })

    container.innerHTML = warning()
    await customElements.whenDefined("lt-session-timeout")
    await advance(2)
    records.push(...observer.takeRecords())
    observer.disconnect()

    const fromComponent = records.filter((p) => p.target !== container)
    expect(fromComponent).toEqual([])
  })
})

/*
 * A tag name registered late. `lt-session-timeout` has already taken the
 * constructor, so `defineLtSessionTimeout("lt-session-timeout-sen")`
 * registers a subclass of it.
 */
describe("extendSession() and resetSession() wait for the registration", () => {
  it("sends session-extend only once the element is upgraded", async () => {
    mount(
      `<lt-session-timeout-sen class="lt-session-timeout" warn-at="3" expires-at="13"></lt-session-timeout-sen>`,
    )
    const element = document.querySelector("lt-session-timeout-sen") as Element
    const extended: Event[] = []
    element.addEventListener("session-extend", (e) => extended.push(e))

    let done = false
    const promise = extendSession(element).then(() => {
      done = true
    })
    await waitForPaint()
    expect(done).toBe(false)
    expect(extended).toHaveLength(0)

    defineLtSessionTimeout("lt-session-timeout-sen")

    await promise
    expect(extended).toHaveLength(1)

    // `reset()` sends nothing, so the call must be seen on the method itself.
    const resetSpy = vi.spyOn(LtSessionTimeout.prototype, "reset")
    await resetSession(element)
    expect(resetSpy).toHaveBeenCalledTimes(1)
    expect(extended).toHaveLength(1)
    resetSpy.mockRestore()
  })
})

describe("lt-session-timeout: a threshold that is skipped", () => {
  beforeAll(() => {
    defineLtSessionTimeout()
  })

  beforeEach(() => {
    fakeClock()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("announces when the clock jumps past a threshold", async () => {
    // A tick that comes late, or is throttled in a background tab, can jump
    // from 61 to 59. Before, the announcement required exactly 60.
    mount(`<div lang="nb">${warning({ warnAt: 1, expiresAt: 70 })}</div>`)
    await customElements.whenDefined("lt-session-timeout")
    await advance(9)
    expect(dialog().open).toBe(true)

    vi.setSystemTime(Date.now() + 1000)
    await advance(1)

    expect(
      dialog().querySelector(".lt-session-timeout__count")?.textContent,
    ).toBe("0:59")
    expect(announced()).toContain("59 sekunder")
  })
})

describe("lt-session-timeout: announcements in the page language, and moving", () => {
  beforeAll(() => {
    defineLtSessionTimeout()
  })

  beforeEach(() => {
    fakeClock()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("announces the same as the number shows when it is not whole minutes", async () => {
    // Rounded off, the announcement said "2 minutter" while the number
    // showed 1:30.
    mount(`<div lang="nb">${warning({ warnAt: 1, expiresAt: 91 })}</div>`)
    await customElements.whenDefined("lt-session-timeout")
    await advance(1)

    expect(announced()).toBe(
      "Vi logger deg ut om 1 minutt og 30 sekunder for å beskytte opplysningene dine.",
    )
  })

  it("announces in English on an English page, without anyone translating the time", async () => {
    mount(
      `<div lang="en">${warning({ warnAt: 1, expiresAt: 91 }, ENGLISH)}</div>`,
    )
    await customElements.whenDefined("lt-session-timeout")
    await advance(1)

    expect(announced()).toBe(
      "The Lattice logs you out in 1 minute and 30 seconds unless you answer.",
    )
  })

  it("announces in the browser's language when lang is not a language code", async () => {
    // `Intl` throws on an invalid code. Then the browser's language is better
    // than no announcement.
    mount(`<div lang="!!">${warning({ warnAt: 1, expiresAt: 91 })}</div>`)
    await customElements.whenDefined("lt-session-timeout")
    await advance(1)

    expect(announced()).toMatch(/1.*30/)
  })

  it("finds lang outside a shadow root", async () => {
    // `closest()` stops at the shadow root. Every preview in the
    // documentation is in one, and without this the demo announced in the
    // browser's language on a Norwegian page.
    // Norwegian and not English: the browser the tests run in has English as
    // its language, and then English would have passed without the fix too.
    const surface = mount(`<div lang="nb"><div id="host"></div></div>`)
    const root = (surface.querySelector("#host") as HTMLElement).attachShadow({
      mode: "open",
    })
    root.innerHTML = warning({ warnAt: 1, expiresAt: 91 })
    await customElements.whenDefined("lt-session-timeout")
    await advance(1)

    expect(root.querySelector("[role='status']")?.textContent).toBe(
      "Vi logger deg ut om 1 minutt og 30 sekunder for å beskytte opplysningene dine.",
    )
  })

  it("announces the time alone when the number is outside the paragraph", async () => {
    // Otherwise the paragraph was read without a number, and the number on
    // screen is `aria-hidden`, so the screen reader never heard how much time
    // was left.
    mount(`
      <div lang="nb">
        <lt-session-timeout warn-at="1" expires-at="91">
          <dialog>
            <h2>Ut om <span class="lt-session-timeout__count" aria-hidden="true"></span></h2>
            <p class="lt-session-timeout__text">Lagre det du holder på med.</p>
            <span class="lt-sr-only" role="status"></span>
            <form method="dialog"><button value="extend">Fortsett</button></form>
          </dialog>
        </lt-session-timeout>
      </div>`)
    await customElements.whenDefined("lt-session-timeout")
    await advance(1)

    expect(announced()).toBe("1 minutt og 30 sekunder")
  })

  /**
   * The component in a shadow root, as a shell with shadow DOM or a preview
   * places it. The field the user was in can be in the page or in the same
   * shadow root, and both must get focus back.
   *
   * The browser itself restores focus inside `close()`, before the `close`
   * event the component listens for. So focus is moved away again after
   * `close()`, so that it is the component's memory that shows when the
   * event arrives. If the memory is empty, or points to the shadow host,
   * focus stays on the button.
   */
  async function rememberedFocus(
    root: ShadowRoot,
    field: HTMLInputElement,
    other: HTMLButtonElement,
  ) {
    field.focus()
    await advance(1)
    const warningDialog = root.querySelector("dialog") as HTMLDialogElement
    expect(warningDialog.open).toBe(true)
    const closed = new Promise((r) =>
      warningDialog.addEventListener("close", r, { once: true }),
    )
    warningDialog.close("extend")
    other.focus()
    await closed
    const fieldRoot = field.getRootNode() as Document | ShadowRoot
    return fieldRoot.activeElement
  }

  it("gives focus back to a field in the page when the component is in a shadow root", async () => {
    // The component's root has no `activeElement` when focus is outside it,
    // so read from there the component remembered nothing.
    const surface = mount(
      `<div lang="nb"><input id="field"><button id="other">Other</button><div id="host"></div></div>`,
    )
    const root = (surface.querySelector("#host") as HTMLElement).attachShadow({
      mode: "open",
    })
    root.innerHTML = warning({ warnAt: 1, expiresAt: 91 })
    await customElements.whenDefined("lt-session-timeout")
    const field = surface.querySelector("#field") as HTMLInputElement
    const other = surface.querySelector("#other") as HTMLButtonElement

    expect(await rememberedFocus(root, field, other)).toBe(field)
  })

  it("gives focus back to a field in the same shadow root", async () => {
    // `document.activeElement` is the shadow host here, and `focus()` on it
    // did nothing.
    const surface = mount(
      `<div lang="nb"><button id="other">Other</button><div id="host"></div></div>`,
    )
    const root = (surface.querySelector("#host") as HTMLElement).attachShadow({
      mode: "open",
    })
    root.innerHTML = `<input id="field">${warning({ warnAt: 1, expiresAt: 91 })}`
    await customElements.whenDefined("lt-session-timeout")
    const field = root.querySelector("#field") as HTMLInputElement
    const other = surface.querySelector("#other") as HTMLButtonElement

    expect(await rememberedFocus(root, field, other)).toBe(field)
  })

  it("is still modal after the element has been moved while the warning is showing", async () => {
    const surface = mount(`${warning()}<div id="other"></div>`)
    await customElements.whenDefined("lt-session-timeout")
    await advance(3)
    expect(dialog().matches(":modal")).toBe(true)

    surface.querySelector("#other")?.append(host())

    expect(dialog().open).toBe(true)
    expect(dialog().matches(":modal")).toBe(true)
  })
})

describe("lt-session-timeout when warn-at is raised while the warning is showing", () => {
  beforeAll(() => {
    defineLtSessionTimeout()
  })

  beforeEach(() => {
    fakeClock()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("lets the countdown continue", async () => {
    mount(warning())
    await customElements.whenDefined("lt-session-timeout")
    await advance(4)
    const count = () => dialog().textContent?.match(/\d+:\d+/)?.[0]
    const before = count()

    host().setAttribute("warn-at", "12")
    await advance(3)

    expect(dialog().open).toBe(true)
    expect(count(), "the number froze").not.toBe(before)
  })
})
