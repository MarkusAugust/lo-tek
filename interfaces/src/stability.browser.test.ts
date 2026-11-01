import { beforeAll, describe, expect, it } from "vitest"
import { dialog } from "./components/frame/dialog/dialog"
import { defineLtDialog } from "./components/frame/dialog/lt-dialog"
import { defineLtField } from "./components/frame/field/lt-field"
import { defineLtPopover } from "./components/frame/popover/lt-popover"
import { popover } from "./components/frame/popover/popover"
import { defineLtSuggestion } from "./components/frame/suggestion/lt-suggestion"
import { suggestion } from "./components/frame/suggestion/suggestion"
import { defineLtTabs } from "./components/frame/tabs/lt-tabs"
import { tabs } from "./components/frame/tabs/tabs"
import { mount, waitForPaint } from "./testing/a11y"

/**
 * That a component does not write in a loop.
 *
 * The components observe the attributes they set themselves, so they can set
 * them back after a patch. If one of them writes a value that is already
 * there, it counts as a change, the observer calls itself, and it writes
 * again. The test run then hangs without an error message, and that is the
 * worst way to fail: no stack trace, no assertion, only silence.
 *
 * This test does what the user does, lets it settle, and then counts
 * mutations over a few paints. If the number is zero, the component has
 * stopped writing.
 *
 * It catches a component that writes a little too much, but not one that
 * writes in a loop: then the run hangs here too. The rule itself is therefore
 * enforced by `scripts/check-writes.ts`, which reads the source and fails in
 * seconds.
 */

const attr = (values: Record<string, unknown>) =>
  Object.entries(values)
    .map(([name, value]) => (value === true ? name : `${name}="${value}"`))
    .join(" ")

/** Counts mutations in a subtree over four paints. */
async function mutationsAfterSettling(root: Element): Promise<number> {
  await waitForPaint()
  await waitForPaint()

  let count = 0
  const observer = new MutationObserver((records) => {
    count += records.length
  })
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
  })

  for (let n = 0; n < 4; n += 1) await waitForPaint()
  observer.disconnect()
  return count
}

describe("the components settle", () => {
  beforeAll(() => {
    defineLtField()
    defineLtTabs()
    defineLtPopover()
    defineLtSuggestion()
    defineLtDialog()
  })

  it("the field, after the wiring is set", async () => {
    const surface = mount(`
      <lt-field>
        <label class="lt-label" for="settle-fixer" data-required="symbol">Fixer's address</label>
        <input class="lt-input" id="settle-fixer" type="email" />
        <p class="lt-help-text">The board writes to the fixer, never to the crew.</p>
        <p class="lt-error-text">Enter a valid address.</p>
      </lt-field>
    `)

    expect(await mutationsAfterSettling(surface)).toBe(0)
  })

  it("the tabs, after the user has chosen", async () => {
    const TABS = tabs({
      id: "file",
      keys: ["overview", "attachments"],
      label: "The claim",
    })
    const surface = mount(`
      <lt-tabs>
        <ul ${attr(TABS.list)}>
          <li><a ${attr(TABS.tabs[0])}>Overview</a></li>
          <li><a ${attr(TABS.tabs[1])}>Attachments</a></li>
        </ul>
        <section ${attr(TABS.panels[0])}><h2 ${attr(TABS.headings[0])}>Overview</h2>Summary</section>
        <section ${attr(TABS.panels[1])}><h2 ${attr(TABS.headings[1])}>Attachments</h2>Files</section>
      </lt-tabs>
    `)
    await waitForPaint()

    const links = [...surface.querySelectorAll("[role='tab']")] as HTMLElement[]
    links[1].click()

    expect(await mutationsAfterSettling(surface)).toBe(0)
  })

  it("the popover, after it is opened", async () => {
    const POPOVER = popover({ id: "menu" })
    const surface = mount(`
      <lt-popover ${attr(POPOVER.host)}>
        <button ${attr(POPOVER.trigger)} class="lt-button">Actions</button>
        <ul ${attr(POPOVER.panel)}><li>Archive</li></ul>
      </lt-popover>
    `)
    await waitForPaint()

    const host = surface.querySelector("lt-popover") as HTMLElement & {
      show(): void
    }
    host.show()

    expect(await mutationsAfterSettling(surface)).toBe(0)
  })

  it("the suggestion field, after the list is opened and an option highlighted", async () => {
    const SUGGESTION = suggestion({ id: "breaker", keys: ["a", "b"] })
    const surface = mount(`
      <lt-suggestion>
        <label ${attr(SUGGESTION.label)}>Breaker</label>
        <div>
          <input ${attr(SUGGESTION.control)} name="breaker" />
          <ul ${attr(SUGGESTION.list)}>
            <li ${attr(SUGGESTION.options[0])}>Crowbar</li>
            <li ${attr(SUGGESTION.options[1])}>Needle</li>
          </ul>
          <p ${attr(SUGGESTION.empty)}>No matches</p>
          <span ${attr(SUGGESTION.status)}></span>
        </div>
      </lt-suggestion>
    `)
    await waitForPaint()

    const control = surface.querySelector("input") as HTMLInputElement
    control.focus()
    control.dispatchEvent(new Event("input", { bubbles: true }))
    control.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    )

    expect(await mutationsAfterSettling(surface)).toBe(0)
  })

  it("the dialog, after it is opened", async () => {
    const BOX = dialog({ titleId: "title", open: true })
    const surface = mount(`
      <lt-dialog ${attr(BOX.host)}>
        <dialog ${attr(BOX.dialog)}>
          <h2 ${attr(BOX.title)}>The order is placed</h2>
          <div ${attr(BOX.body)}><p>Job 222-0481 is open to crews.</p></div>
          <form method="dialog" ${attr(BOX.footer)}>
            <button class="lt-button" value="close">Close</button>
          </form>
        </dialog>
      </lt-dialog>
    `)

    expect(await mutationsAfterSettling(surface)).toBe(0)

    const box = surface.querySelector("dialog") as HTMLDialogElement
    box.close("close")
  })
})
