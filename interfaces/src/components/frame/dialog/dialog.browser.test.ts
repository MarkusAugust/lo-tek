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
import { userEvent } from "vitest/browser"
import {
  expectNoAccessibilityViolations,
  mount,
  waitForPaint,
} from "../../../testing/a11y"
import { attr } from "../../../testing/markup"
import { dialog } from "./dialog"
import { defineLtDialog } from "./lt-dialog"

import "../../../tokens/tokens.css"
import "./dialog.css"
import "../../css/button/button.css"

describe(".lt-dialog", () => {
  beforeEach(() => {
    mount(`
      <button class="lt-button" id="open-button" type="button">Cancel the job</button>
      <dialog class="lt-dialog" id="dialog" aria-labelledby="dialog-title">
        <h2 class="lt-dialog__title" id="dialog-title">Cancel job 222-0481?</h2>
        <div class="lt-dialog__body">
          <p>The crew keeps the advance. This cannot be undone.</p>
        </div>
        <div class="lt-dialog__footer">
          <button class="lt-button" data-variant="secondary" id="keep" type="button">Keep the job</button>
          <button class="lt-button" data-variant="danger" id="delete" type="button">Cancel the job</button>
        </div>
      </dialog>
    `)
  })

  afterEach(() => {
    const d = document.getElementById("dialog") as HTMLDialogElement | null
    if (d?.open) d.close()
  })

  it("moves focus into the dialog when it is opened with showModal", () => {
    const d = document.getElementById("dialog") as HTMLDialogElement
    d.showModal()

    expect(d.open).toBe(true)
    // showModal() moves focus itself. A <dialog open> in the markup does not,
    // and is therefore just a box on the page.
    expect(d.contains(document.activeElement)).toBe(true)
  })

  it("closes with Escape without us writing anything for it", async () => {
    const d = document.getElementById("dialog") as HTMLDialogElement
    d.showModal()

    // A `cancel` dispatched by hand does not trigger the browser's own
    // closing, and a test that did that and then called `close()` itself only
    // tested its own code. Here the key is pressed for real.
    await userEvent.keyboard("{Escape}")

    expect(d.open).toBe(false)
  })

  it("reports back what the user chose", () => {
    const d = document.getElementById("dialog") as HTMLDialogElement
    d.showModal()
    d.close("delete")

    expect(d.returnValue).toBe("delete")
  })

  it("sets the attributes from the builder function", () => {
    const box = dialog({ titleId: "dialog-title" })

    expect(box.dialog).toEqual({
      class: "lt-dialog",
      "aria-labelledby": "dialog-title",
    })
    // When the dialog is to be shown, `open` is in both places. On `<dialog>`
    // it is the fallback for those without JavaScript: without it the content
    // is hidden.
    expect(dialog({ titleId: "t", open: true }).dialog).toEqual({
      class: "lt-dialog",
      "aria-labelledby": "t",
      open: true,
    })
    expect(box.title).toEqual({
      class: "lt-dialog__title",
      id: "dialog-title",
    })
    expect(box.body).toEqual({ class: "lt-dialog__body" })
    expect(box.footer).toEqual({ class: "lt-dialog__footer" })
    expect(dialog.title).toBe("lt-dialog__title")
  })

  it("has no accessibility violations when open", async () => {
    const d = document.getElementById("dialog") as HTMLDialogElement
    d.showModal()

    await waitForPaint()
    await expectNoAccessibilityViolations()
  })
})

describe("the width of the dialog", () => {
  it("does not get wider than the box it is in", async () => {
    /*
     * The dialog worked out its width against the viewport. In a narrower
     * box, such as a panel or a preview, it stuck out.
     *
     * A `<dialog open>` is absolutely positioned by the browser, so `100%` is
     * relative to the nearest positioned parent. Hence `position: relative`
     * on the box here; without it the viewport applies, and that is right
     * for a dialog opened with `showModal()`.
     */
    mount(`
      <div id="narrow" style="width: 240px; position: relative">
        <dialog class="lt-dialog" id="in-box" open>
          <p>Content</p>
        </dialog>
      </div>

      <div id="narrow-surface" style="width: 240px">
        <div class="lt-dialog" id="as-box">
          <p>Content</p>
        </div>
      </div>
    `)

    await waitForPaint()

    for (const [boxId, dialogId] of [
      ["narrow", "in-box"],
      ["narrow-surface", "as-box"],
    ]) {
      const box = document.getElementById(boxId) as HTMLElement
      const dialog = document.getElementById(dialogId) as HTMLElement

      expect(
        dialog.getBoundingClientRect().width,
        dialogId,
      ).toBeLessThanOrEqual(box.getBoundingClientRect().width)
    }
  })
})

/**
 * The server can say the dialog is open, and the component makes the call.
 *
 * Without this, an app that only sends HTML could not open a dialog at all:
 * `showModal()` is a call, and `<dialog open>` is just a box on the page. This
 * was found in an app written in Kotlin with Datastar.
 */
/**
 * Closes the dialog and waits for the `close` event, not for a frame.
 *
 * The event is a queued task, and the component's listener runs in it. A
 * frame can come first, and then the test read the host before the component
 * had removed `open`. The listener here is added after the component's, so it
 * runs last.
 */
async function closeAndWait(d: HTMLDialogElement, value?: string) {
  const closed = new Promise((done) =>
    d.addEventListener("close", done, { once: true }),
  )
  d.close(value)
  await closed
  await waitForPaint()
}

describe("lt-dialog", () => {
  beforeAll(() => {
    defineLtDialog()
  })

  async function mountDialog(open: boolean) {
    const box = dialog({ titleId: "title", open })
    mount(`
      <lt-dialog ${attr(box.host)}>
        <dialog ${attr(box.dialog)}>
          <h2 ${attr(box.title)}>The decision has been registered</h2>
          <div ${attr(box.body)}><p>Job 222-0481 is open to crews.</p></div>
          <form method="dialog" ${attr(box.footer)}>
            <button class="lt-button" id="close" value="close">Close</button>
          </form>
        </dialog>
      </lt-dialog>
    `)
    await customElements.whenDefined("lt-dialog")
    await waitForPaint()
    return {
      host: document.querySelector("lt-dialog") as HTMLElement,
      d: document.querySelector("dialog") as HTMLDialogElement,
    }
  }

  afterEach(() => {
    const d = document.querySelector("dialog") as HTMLDialogElement | null
    if (d?.open) d.close()
  })

  it("opens as a modal when the server says it is open", async () => {
    const { d } = await mountDialog(true)

    expect(d.open).toBe(true)
    // `:modal` is the difference between `showModal()` and `show()`. Only the
    // first makes the rest of the page unreachable and closes on Escape. Both
    // move focus, so that alone does not tell them apart.
    expect(d.matches(":modal")).toBe(true)
    expect(d.contains(document.activeElement)).toBe(true)
  })

  it("leaves it closed when the server says nothing", async () => {
    const { d } = await mountDialog(false)

    expect(d.open).toBe(false)
  })

  it("opens and closes when the server flips the attribute", async () => {
    const { host, d } = await mountDialog(false)

    host.setAttribute("open", "")
    await waitForPaint()
    expect(d.open).toBe(true)

    host.removeAttribute("open")
    await waitForPaint()
    expect(d.open).toBe(false)
  })

  it("removes open from the host when the user closes", async () => {
    const { host, d } = await mountDialog(true)

    await closeAndWait(d)

    // The markup should say the same as the screen. Otherwise the next patch
    // would have opened the dialog again, since the host still said `open`.
    expect(host.hasAttribute("open")).toBe(false)
  })

  it("does not throw when the markup is built detached from the page", async () => {
    // A morpher builds the server's version in a detached tree to compare.
    // The element is upgraded there too, and `showModal()` throws on a dialog
    // that is not in the document.
    //
    // The error does not come out of `innerHTML`: an exception in a reaction
    // on a web component is reported to the window instead. That is why the
    // test listens for `error` rather than wrapping the call.
    const errors: string[] = []
    const listener = (event: ErrorEvent) => errors.push(event.message)
    window.addEventListener("error", listener)

    const box = dialog({ titleId: "t", open: true })
    const holder = document.createElement("div")
    holder.innerHTML = `
      <lt-dialog ${attr(box.host)}>
        <dialog ${attr(box.dialog)}>
          <h2 ${attr(box.title)}>Title</h2>
        </dialog>
      </lt-dialog>`

    await waitForPaint()
    window.removeEventListener("error", listener)

    expect(errors).toEqual([])
    // Two things must hold here. The component must not have called
    // `showModal()`, which is what `:modal` answers. And the server's own
    // `open` must stay, because it is the fallback for those without
    // JavaScript: without it the dialog is hidden, and the content is not
    // there.
    expect(holder.querySelector("dialog")?.matches(":modal")).toBe(false)
    expect(holder.querySelector("dialog")?.hasAttribute("open")).toBe(true)
  })

  it("writes open on the host as the server's word", () => {
    // `true` and not `""`: React 19 sets the property, and the empty string
    // is falsy, so the setter in the component removes the attribute again.
    expect(dialog({ titleId: "t", open: true }).host).toEqual({ open: true })
    expect(dialog({ titleId: "t" }).host).toEqual({})
  })

  it("does not ask the template to preserve anything", () => {
    // `showModal()` sets `open` on `<dialog>` itself, and a morph tears it
    // away again. Before, the template had to write
    // `data-preserve-attr="open"` to prevent that. Now the component puts the
    // attribute back, and if the list comes back here, someone has brought
    // back the contract the template had to copy out.
    expect("data-preserve-attr" in dialog({ titleId: "t" }).dialog).toBe(false)
    expect("data-preserve-attr" in dialog({ titleId: "t" }).host).toBe(false)
  })

  it("opens again when the server sends open again", async () => {
    const { host, d } = await mountDialog(true)

    await closeAndWait(d)
    expect(host.hasAttribute("open")).toBe(false)

    // This is what a morph does: the server's node still says `open`.
    host.setAttribute("open", "")
    await waitForPaint()

    expect(d.open, "the server could not open the dialog again").toBe(true)
  })

  it("reports when it opens and closes", async () => {
    const reports: boolean[] = []
    const { host, d } = await mountDialog(false)
    host.addEventListener("dialog-toggle", (event) => {
      reports.push(event.detail.open)
    })

    host.setAttribute("open", "")
    await waitForPaint()
    await closeAndWait(d)

    expect(reports).toEqual([true, false])
  })

  it("also opens when the template forgot open on the dialog itself", async () => {
    // Handwritten markup, and the documentation showed this for a long time:
    // the host says `open`, but `<dialog>` does not. The builder function
    // gives both now, so this case exists only in templates someone wrote by
    // hand.
    mount(`
      <lt-dialog open>
        <dialog class="lt-dialog" aria-labelledby="title">
          <h2 class="lt-dialog__title" id="title">Title</h2>
        </dialog>
      </lt-dialog>
    `)
    await customElements.whenDefined("lt-dialog")
    await waitForPaint()

    expect(document.querySelector("dialog")?.matches(":modal")).toBe(true)
  })

  it("closes even when the attribute on the dialog was removed first", async () => {
    /*
     * React now controls `open` on `<dialog>`, and updates children before
     * the parent. When the app closes the dialog, the attribute on `<dialog>`
     * is removed before the one on the host, and the component gets here
     * with `dialog.open` already false.
     *
     * Without the component looking at `:modal`, the dialog stayed in the top
     * layer, invisible, with the rest of the page inert: a page where nothing
     * could be clicked, and nothing visible explained why.
     */
    const { host, d } = await mountDialog(true)
    expect(d.matches(":modal")).toBe(true)

    d.removeAttribute("open")
    host.removeAttribute("open")
    await waitForPaint()

    expect(d.matches(":modal"), "the dialog is left in the top layer").toBe(
      false,
    )

    // And the page is usable again: a button outside can take focus.
    const button = document.createElement("button")
    document.body.append(button)
    button.focus()
    const gotFocus = document.activeElement === button
    button.remove()
    expect(gotFocus, "the rest of the page is still inert").toBe(true)
  })

  it("does not reopen a dialog the user closed before the script arrived", async () => {
    /*
     * The server writes `open` in both places, so the content is there
     * without JavaScript, and `<form method="dialog">` closes the box without
     * JavaScript too. When that happens before the component has run, there
     * is no listener, and the first `sync()` saw a host that said "open" and
     * a closed dialog. The dialog then popped up again right after the user
     * had closed it. On mobile it happened every time, because the window
     * there is long enough to fit a tap.
     *
     * The markup is built detached and closed there. `sync()` gives up on a
     * dialog that is not in the page, so no listener is attached, and that
     * is exactly the state a page is in before the script has loaded.
     */
    const box = dialog({ titleId: "title", open: true })
    const holder = document.createElement("div")
    holder.innerHTML = `
      <lt-dialog ${attr(box.host)}>
        <dialog ${attr(box.dialog)}>
          <h2 ${attr(box.title)}>Title</h2>
          <form method="dialog" ${attr(box.footer)}>
            <button class="lt-button" value="close">Close</button>
          </form>
        </dialog>
      </lt-dialog>`

    const d = holder.querySelector("dialog") as HTMLDialogElement
    expect(d.open, "the server did not send it open").toBe(true)

    // The user closes the box while it is just a box on the page.
    d.close("close")

    document.body.append(holder)
    await waitForPaint()

    expect(d.open, "the dialog popped up again").toBe(false)
    expect(
      holder.querySelector("lt-dialog")?.hasAttribute("open"),
      "the host still says it is open",
    ).toBe(false)

    holder.remove()
  })

  it("sends no close event when the server sends the dialog open", async () => {
    /*
     * The server writes `open` on `<dialog>`, and the component must remove
     * it before `showModal()`. If it does that with `close()`, the browser
     * sends a real `close` event, and it comes on every single load. An app
     * listening for `close` directly on `<dialog>`, as the complete example
     * in the documentation does, then got a phantom close before the user
     * had seen the dialog. `dialog-toggle` did not see it, because
     * `handleClose` stops on `:modal`.
     */
    const events: string[] = []
    // `close` does not bubble. A listener on the document in the bubbling
    // phase never sees it, and the test would have passed whatever the
    // component did.
    const listener = (e: Event) => {
      if ((e.target as HTMLElement)?.tagName === "DIALOG") events.push("close")
    }
    document.addEventListener("close", listener, true)

    const { d } = await mountDialog(true)
    document.removeEventListener("close", listener, true)

    expect(d.matches(":modal")).toBe(true)
    expect(events).toEqual([])
  })

  it("does not close itself when the server closes and opens in the same turn", async () => {
    const { host, d } = await mountDialog(true)
    const reports: boolean[] = []
    host.addEventListener("dialog-toggle", (event) => {
      reports.push(event.detail.open)
    })

    // The `close` event is queued, not synchronous. Without a guard it
    // arrived after the dialog had been opened again, and closed it again.
    host.removeAttribute("open")
    host.setAttribute("open", "")

    await waitForPaint()
    await waitForPaint()

    expect(d.matches(":modal"), "the dialog closed itself afterwards").toBe(
      true,
    )
    expect(host.hasAttribute("open")).toBe(true)
    expect(reports).toEqual([false, true])
  })

  it("controls only its own dialog, not one further down the tree", async () => {
    // Another component can have its own `<dialog>` inside this one. It comes
    // first in the document here, so a component that only asked for "the
    // first dialog" would have opened the wrong box.
    const box = dialog({ titleId: "title", open: true })
    mount(`
      <lt-dialog ${attr(box.host)}>
        <div class="some-card">
          <dialog id="foreign"><p>Something else entirely</p></dialog>
        </div>
        <dialog ${attr(box.dialog)} id="mine">
          <h2 ${attr(box.title)}>Title</h2>
        </dialog>
      </lt-dialog>
    `)
    await customElements.whenDefined("lt-dialog")
    await waitForPaint()

    expect((document.getElementById("mine") as HTMLDialogElement).open).toBe(
      true,
    )
    expect((document.getElementById("foreign") as HTMLDialogElement).open).toBe(
      false,
    )
  })

  it("says which button closed it", async () => {
    const { host, d } = await mountDialog(true)
    let answer: string | undefined
    host.addEventListener("dialog-toggle", (event) => {
      answer = event.detail.returnValue
    })

    await closeAndWait(d, "delete")

    expect(answer).toBe("delete")
  })

  it("does not report the previous button when the server closes a dialog it reopened", async () => {
    const { host, d } = await mountDialog(true)
    await closeAndWait(d, "delete")
    host.setAttribute("open", "")
    await waitForPaint()
    expect(d.matches(":modal")).toBe(true)

    const answers: Array<{ open: boolean; returnValue: string }> = []
    host.addEventListener("dialog-toggle", (event) => {
      answers.push(event.detail)
    })
    host.removeAttribute("open")
    await waitForPaint()

    // Before, "delete" came from the previous time, and an app that deleted
    // on that value deleted something the user never asked for.
    expect(answers).toEqual([{ open: false, returnValue: "" }])
  })

  it("is opened by the server also after the host has been moved", async () => {
    const { host, d } = await mountDialog(true)
    await closeAndWait(d, "close")

    // A morpher moves the host and sends it open again. Before, the component
    // saw the `returnValue` from the close, believed the user had closed the
    // dialog before the script arrived, and took `open` from the host.
    const other = document.createElement("div")
    document.body.append(other)
    host.remove()
    host.setAttribute("open", "")
    other.append(host)
    await waitForPaint()

    expect(d.matches(":modal")).toBe(true)
    expect(host.hasAttribute("open")).toBe(true)
  })

  it("keeps the button's value when open is written on the host before close has arrived", async () => {
    // A framework that writes the same `open` again right after the click.
    // Before, the component opened the dialog again and cleared the value,
    // and a listener on `close` read an empty value instead of "delete".
    const { host, d } = await mountDialog(true)
    const read: string[] = []
    d.addEventListener("close", () => read.push(d.returnValue))
    const closed = new Promise((done) =>
      d.addEventListener("close", done, { once: true }),
    )

    d.close("delete")
    host.setAttribute("open", "")
    await closed
    await waitForPaint()

    expect(read).toEqual(["delete"])
    expect(d.matches(":modal")).toBe(false)
    expect(host.hasAttribute("open")).toBe(false)
  })

  it("opens a dialog that is moved into a new host", async () => {
    // A dialog closed with a button, moved into a new host the server sends
    // open. Before, the new host believed the user had closed it before the
    // script arrived.
    const { d } = await mountDialog(true)
    await closeAndWait(d, "close")

    const fresh = document.createElement("lt-dialog")
    fresh.setAttribute("open", "")
    fresh.append(d)
    document.body.append(fresh)
    await waitForPaint()

    expect(d.matches(":modal")).toBe(true)
    expect(fresh.hasAttribute("open")).toBe(true)
  })

  it("reports nothing when the dialog is moved inside the host", async () => {
    // A patch that reorders the children takes the dialog out of the top
    // layer, and the component opens it again. Before, it reported
    // `open: true` for a dialog that had been open all along.
    const { host, d } = await mountDialog(true)
    const answers: boolean[] = []
    host.addEventListener("dialog-toggle", (event) => {
      answers.push(event.detail.open)
    })

    host.prepend(document.createElement("span"))
    host.append(d)
    await waitForPaint()

    expect(d.matches(":modal")).toBe(true)
    expect(answers).toEqual([])
  })

  it("reports nothing when an open dialog is moved", async () => {
    const { host, d } = await mountDialog(true)
    const answers: boolean[] = []
    host.addEventListener("dialog-toggle", (event) => {
      answers.push(event.detail.open)
    })

    const other = document.createElement("div")
    document.body.append(other)
    other.append(host)
    await waitForPaint()

    expect(d.matches(":modal")).toBe(true)
    expect(answers).toEqual([])
  })

  it("has no accessibility violations when open", async () => {
    await mountDialog(true)

    await expectNoAccessibilityViolations()
  })
})

/**
 * The dialog must be in the right place also before it has become a real
 * modal.
 *
 * The server sends `<dialog open>` because the content is otherwise not there
 * without JavaScript. The browser then puts it in the normal flow, and only
 * when the component calls `showModal()` is it moved to the top layer and
 * centred. On a slow connection the jump between those two moments is clearly
 * visible, and it was reported from a phone: the dialog sat high up on the
 * page and landed in the middle half a second later.
 */
describe("the dialog before it is modal", () => {
  /*
   * The state is tested in a frame without scripts.
   *
   * The first version created the element in the test page itself, and it
   * could not be trusted: in a full run `<lt-dialog>` is already registered
   * by another test file, so the dialog became modal before the style was
   * read. A frame with only markup and stylesheets is exactly what the server
   * sends, and nothing else.
   */
  async function inFrameWithoutScript(
    markup: string,
    width = 800,
    height = 600,
  ): Promise<{
    dialog: HTMLDialogElement
    win: Window
    cleanUp: () => void
  }> {
    const tokens = (await import("../../../tokens/tokens.css?inline")).default
    const dialogStyles = (await import("./dialog.css?inline")).default

    const frame = document.createElement("iframe")
    frame.width = String(width)
    frame.height = String(height)
    frame.srcdoc = `<!doctype html><html><head><style>${tokens}\n${dialogStyles}</style></head><body>${markup}</body></html>`
    document.body.append(frame)

    await new Promise((ready) => {
      frame.addEventListener("load", ready, { once: true })
    })

    /*
     * Wait for the frame to have a size, not just for `load`.
     *
     * `100vmax` in the stylesheet is relative to the frame's own window, and
     * that is zero until it has been laid out. Locally it got there before
     * the test read the style, in CI it did not, and then the shadow was zero
     * pixels wide with nothing wrong in the rule.
     */
    await vi.waitFor(() => {
      if (!(frame.contentWindow?.innerWidth ?? 0))
        throw new Error("the frame is not laid out")
    })

    const doc = frame.contentDocument as Document
    return {
      dialog: doc.querySelector("dialog") as HTMLDialogElement,
      win: frame.contentWindow as Window,
      cleanUp: () => frame.remove(),
    }
  }

  it("sits in the middle of the window, with the surface behind painted", async () => {
    const {
      dialog: box,
      win,
      cleanUp,
    } = await inFrameWithoutScript(`
      <lt-dialog>
        <dialog class="lt-dialog" open>
          <h2 class="lt-dialog__title">Welcome</h2>
          <p>Content that is there without JavaScript.</p>
        </dialog>
      </lt-dialog>`)

    try {
      // No scripts in the frame, so the dialog is open without being modal.
      // That is exactly the state the server sends.
      expect(box.matches(":modal")).toBe(false)
      expect(box.open).toBe(true)

      const style = win.getComputedStyle(box)
      expect(style.position).toBe("fixed")

      /*
       * The shadow paints the surface behind, since `::backdrop` exists only
       * in the top layer.
       *
       * Two layers: the card's own shadow, and the surface. And the surface
       * must actually cover the frame, not just sit there as a thin edge.
       */
      const layers = style.boxShadow.split(/,(?![^(]*\))/)
      expect(layers).toHaveLength(2)

      const spread = Math.max(
        ...[...style.boxShadow.matchAll(/(\d+(?:\.\d+)?)px/g)].map((t) =>
          Number(t[1]),
        ),
      )
      expect(spread).toBeGreaterThanOrEqual(
        Math.max(win.innerWidth, win.innerHeight),
      )

      // And it sits in the middle of the frame, not at the top of the flow.
      const rect = box.getBoundingClientRect()
      expect(
        Math.abs(rect.top + rect.height / 2 - win.innerHeight / 2),
      ).toBeLessThan(4)
    } finally {
      cleanUp()
    }
  })

  /*
   * The real claim: no jump, neither vertical nor horizontal.
   *
   * The rule that gives the dialog the place of a modal before it is one has
   * been written three times, and each round moved the jump rather than
   * removing it. First it sat at the top of the flow and landed in the
   * middle. Then it was centred, and the browser's own maximum width clipped
   * it as it became modal. Then the maximum height came along, and it won on
   * specificity before the modal and stopped applying afterwards, so a tall
   * dialog jumped instead.
   *
   * The test reads the box in both states and requires it to stay still. It
   * runs with two kinds of content, since short content never reaches the
   * maximum sizes and then checks nothing.
   */
  for (const { name, content } of [
    {
      name: "with short content",
      content: "<p>Content that is there without JavaScript.</p>",
    },
    {
      name: "with content taller than the screen",
      content: `<div class="lt-dialog__body">${"<p>The terms apply from the date a crew takes the job.</p>".repeat(40)}</div>`,
    },
  ]) {
    it(`does not move when it becomes modal, ${name}`, async () => {
      const {
        dialog: box,
        win,
        cleanUp,
      } = await inFrameWithoutScript(
        `
        <lt-dialog>
          <dialog class="lt-dialog" open>
            <h2 class="lt-dialog__title">Welcome</h2>
            ${content}
          </dialog>
        </lt-dialog>`,
        390,
        700,
      )

      try {
        // If the dialog is already modal here, every claim below is true
        // without anything having been checked.
        expect(box.matches(":modal")).toBe(false)

        const before = box.getBoundingClientRect()

        /*
         * A frame so narrow that the browser's own maximum width for a modal
         * is less than the width the dialog would otherwise take. Without
         * that there is nothing to clip, and the test would pass with the bug
         * in place too. The maximum is worked out with the dialog's own font
         * size, since `2em` does that.
         */
        const em = Number.parseFloat(win.getComputedStyle(box).fontSize)
        expect(
          Math.abs(before.width - (win.innerWidth - 6 - 2 * em)),
        ).toBeLessThanOrEqual(1)

        box.close()
        box.showModal()
        expect(box.matches(":modal")).toBe(true)

        const after = box.getBoundingClientRect()

        // One pixel of slack for rounding, no more.
        expect(Math.abs(after.left - before.left)).toBeLessThanOrEqual(1)
        expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(1)
        expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(1)
        expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1)
      } finally {
        cleanUp()
      }
    })
  }

  it("lets the body scroll, not the dialog, in both states", async () => {
    /*
     * `.lt-dialog__body` had `overflow-y: auto` without being able to scroll:
     * the dialog was a block, so the body's height was set by its content and
     * never clipped. What scrolled was the dialog itself, and only when it
     * was modal, so the heading and the button row went out of view along
     * with the text.
     */
    const { dialog: box, cleanUp } = await inFrameWithoutScript(
      `
      <lt-dialog>
        <dialog class="lt-dialog" open>
          <h2 class="lt-dialog__title">Terms</h2>
          <div class="lt-dialog__body">${"<p>The terms apply from the date a crew takes the job.</p>".repeat(40)}</div>
          <div class="lt-dialog__footer">
            <button class="lt-button" type="button">Close</button>
          </div>
        </dialog>
      </lt-dialog>`,
      390,
      700,
    )

    const body = box.querySelector(".lt-dialog__body") as HTMLElement
    const footer = box.querySelector(".lt-dialog__footer") as HTMLElement

    const asExpected = () => {
      expect(body.scrollHeight).toBeGreaterThan(body.clientHeight + 1)
      // The dialog itself does not scroll, so the title and the buttons stay.
      expect(box.scrollHeight).toBeLessThanOrEqual(box.clientHeight + 1)
      const card = box.getBoundingClientRect()
      const row = footer.getBoundingClientRect()
      expect(row.top).toBeGreaterThanOrEqual(card.top - 1)
      expect(row.bottom).toBeLessThanOrEqual(card.bottom + 1)
    }

    try {
      // If the dialog is already modal here, the claims below are true
      // without anything having been checked.
      expect(box.matches(":modal")).toBe(false)
      asExpected()

      // And in the top layer, where the browser itself gives the dialog
      // `overflow: auto`.
      box.close()
      box.showModal()
      expect(box.matches(":modal")).toBe(true)
      asExpected()
    } finally {
      cleanUp()
    }
  })

  it("keeps a closed dialog hidden, also with a body", async () => {
    /*
     * The column gave the class a `display`, and an author rule beats the
     * browser's own stylesheet whatever the layer and specificity. Without
     * the hidden state being restored, a closed dialog stood as a card on top
     * of the content around it: from page load for everything that sends the
     * dialog closed, and after every close. That is the recommended use with
     * JavaScript.
     */
    const {
      dialog: box,
      win,
      cleanUp,
    } = await inFrameWithoutScript(`
      <lt-dialog>
        <dialog class="lt-dialog">
          <h2 class="lt-dialog__title">Cancel job 222-0481?</h2>
          <div class="lt-dialog__body">
            <p>The crew keeps the advance.</p>
          </div>
        </dialog>
      </lt-dialog>`)

    try {
      expect(box.open).toBe(false)
      expect(win.getComputedStyle(box).display).toBe("none")
      expect(box.getBoundingClientRect().height).toBe(0)

      // And it comes back when opened, as a column.
      box.showModal()
      expect(win.getComputedStyle(box).display).toBe("flex")

      // And disappears again after closing, which is where it got stuck.
      box.close()
      expect(win.getComputedStyle(box).display).toBe("none")
      expect(box.getBoundingClientRect().height).toBe(0)
    } finally {
      cleanUp()
    }
  })

  it("lets the dialog itself scroll when it has no body", async () => {
    /*
     * `overflow: auto` in the rule before the modal mirrors what the browser
     * gives a modal. Without it `overflow` is `visible` until `showModal()`,
     * and tall content that is not in `.lt-dialog__body` spills out of the
     * rounded card rather than scrolling. The box is the same size either
     * way, so the jump tests do not see it.
     */
    const {
      dialog: box,
      win,
      cleanUp,
    } = await inFrameWithoutScript(
      `
      <lt-dialog>
        <dialog class="lt-dialog" open>
          <h2 class="lt-dialog__title">Terms</h2>
          ${"<p>The terms apply from the date a crew takes the job.</p>".repeat(40)}
        </dialog>
      </lt-dialog>`,
      390,
      700,
    )

    try {
      expect(box.matches(":modal")).toBe(false)
      expect(win.getComputedStyle(box).overflow).toBe("auto")
      expect(box.scrollHeight).toBeGreaterThan(box.clientHeight + 1)
    } finally {
      cleanUp()
    }
  })

  it("does not hide a dialog shown as a popover", async () => {
    /*
     * A popover never sets `open`, so the rule that restores the hidden state
     * must have the same exception as the browser's own stylesheet. Without
     * it a `<dialog popover>` disappeared entirely, without a word.
     */
    const {
      dialog: box,
      win,
      cleanUp,
    } = await inFrameWithoutScript(`
      <dialog class="lt-dialog" popover id="help">
        <h2 class="lt-dialog__title">What does this mean?</h2>
        <div class="lt-dialog__body">
          <p>The order is placed, but no crew has taken it.</p>
        </div>
      </dialog>`)

    try {
      expect(win.getComputedStyle(box).display).toBe("none")

      box.showPopover()
      expect(box.matches(":popover-open")).toBe(true)
      expect(win.getComputedStyle(box).display).toBe("flex")
      expect(box.getBoundingClientRect().width).toBeGreaterThan(0)

      box.hidePopover()
      expect(win.getComputedStyle(box).display).toBe("none")
    } finally {
      cleanUp()
    }
  })

  it("leaves the dialog a block when it has no body", async () => {
    /*
     * The column is switched on by `:has(> .lt-dialog__body)`, and that
     * condition is deliberate. A dialog without a body should not change
     * appearance because the column arrived: a button directly in the dialog
     * should keep its width rather than become its own full-width row.
     */
    const {
      dialog: box,
      win,
      cleanUp,
    } = await inFrameWithoutScript(`
      <lt-dialog>
        <dialog class="lt-dialog" open>
          <h2 class="lt-dialog__title">Terms</h2>
          <p>The terms apply from the date a crew takes the job.</p>
          <button class="lt-button" type="button">Close</button>
        </dialog>
      </lt-dialog>`)

    try {
      expect(win.getComputedStyle(box).display).toBe("block")

      const button = box.querySelector(".lt-button") as HTMLElement
      const width = button.getBoundingClientRect().width
      expect(width).toBeGreaterThan(0)
      // Not stretched to full width the way a flex item would have been.
      expect(width).toBeLessThan(box.getBoundingClientRect().width / 2)
    } finally {
      cleanUp()
    }
  })

  it("leaves the dialog a block when the body is wrapped", async () => {
    /*
     * What the documentation promises in the table of classes: the body must
     * be a direct child. If it is wrapped, in a `<form>` for example, the
     * dialog is what scrolls, as before the column arrived. Then the heading
     * goes out of view, and that is why the condition is written out.
     */
    const {
      dialog: box,
      win,
      cleanUp,
    } = await inFrameWithoutScript(
      `
      <lt-dialog>
        <dialog class="lt-dialog" open>
          <form method="dialog">
            <h2 class="lt-dialog__title">Terms</h2>
            <div class="lt-dialog__body">${"<p>The terms apply from the date a crew takes the job.</p>".repeat(40)}</div>
          </form>
        </dialog>
      </lt-dialog>`,
      390,
      700,
    )

    try {
      expect(win.getComputedStyle(box).display).toBe("block")

      const body = box.querySelector(".lt-dialog__body") as HTMLElement
      expect(body.scrollHeight).toBeLessThanOrEqual(body.clientHeight + 1)
      expect(box.scrollHeight).toBeGreaterThan(box.clientHeight + 1)
    } finally {
      cleanUp()
    }
  })

  it("does not touch a dialog used without the component", async () => {
    // A `.lt-dialog` on its own, and deliberately not modal, should stay
    // where it is.
    const {
      dialog: box,
      win,
      cleanUp,
    } = await inFrameWithoutScript(
      `<dialog class="lt-dialog" open>Without a host</dialog>`,
    )

    try {
      expect(win.getComputedStyle(box).position).not.toBe("fixed")
    } finally {
      cleanUp()
    }
  })
})

describe("lt-dialog with server-controlled", () => {
  beforeAll(() => {
    defineLtDialog()
  })

  it("reports once also when React takes open from the child before the host", async () => {
    // React updates children before the parent. Then the host's `open` is
    // already gone when the component closes the dialog, and without a report
    // from here the app never learnt that it was closed.
    const box = dialog({ titleId: "sc2-title", open: true })
    mount(`
      <lt-dialog server-controlled ${attr(box.host)}>
        <dialog ${attr(box.dialog)}>
          <h2 ${attr(box.title)}>The decision has been registered</h2>
        </dialog>
      </lt-dialog>
    `)
    await customElements.whenDefined("lt-dialog")
    await waitForPaint()

    const host = document.querySelector("lt-dialog") as HTMLElement
    const d = document.querySelector("dialog") as HTMLDialogElement
    const reports: boolean[] = []
    host.addEventListener("dialog-toggle", (e) => reports.push(e.detail.open))

    d.removeAttribute("open")
    host.removeAttribute("open")
    await waitForPaint()
    await waitForPaint()

    expect(d.matches(":modal")).toBe(false)
    expect(reports).toEqual([false])
  })

  it("closes a modal dialog when the patch takes open from it", async () => {
    /*
     * The server decides the state, and sends the region again without
     * `open` on `<dialog>`. Repair was switched off, but nobody called
     * `close()`: the dialog was left with `:modal` and `display: none`, and
     * nothing on the page could be clicked. The documentation promises that
     * every patch decides, also when the dialog is in the top layer.
     */
    const box = dialog({ titleId: "sc-title", open: true })
    mount(`
      <lt-dialog server-controlled ${attr(box.host)}>
        <dialog ${attr(box.dialog)}>
          <h2 ${attr(box.title)}>The decision has been registered</h2>
          <form method="dialog" ${attr(box.footer)}>
            <button class="lt-button" value="close">Close</button>
          </form>
        </dialog>
      </lt-dialog>
      <button id="outside">Outside</button>
    `)
    await customElements.whenDefined("lt-dialog")
    await waitForPaint()

    const host = document.querySelector("lt-dialog") as HTMLElement
    const d = document.querySelector("dialog") as HTMLDialogElement
    const reports: boolean[] = []
    host.addEventListener("dialog-toggle", (e) => reports.push(e.detail.open))
    expect(d.matches(":modal")).toBe(true)

    d.removeAttribute("open")
    await waitForPaint()
    await waitForPaint()

    expect(d.matches(":modal"), "the dialog is left in the top layer").toBe(
      false,
    )
    expect(host.hasAttribute("open")).toBe(false)
    expect(reports).toEqual([false])

    const button = document.getElementById("outside") as HTMLElement
    button.focus()
    expect(document.activeElement, "the rest of the page is still inert").toBe(
      button,
    )
  })
})

describe("the dialog with a coloured header", () => {
  it("gives the header the colour and moves the spacing out into the parts", async () => {
    // Without this, two dialogs in the game demo overrode padding on three
    // classes to get a coloured band all the way to the edges.
    const box = dialog({ titleId: "colour-title", color: "success" })
    expect(box.dialog["data-color"]).toBe("success")
    expect(dialog({ titleId: "x" }).dialog["data-color"]).toBeUndefined()

    mount(`
      <dialog ${attr(box.dialog)} open>
        <div ${attr(box.header)}>
          <h2 ${attr(box.title)}>Full marks</h2>
          <p ${attr(box.subtitle)}>25 of 25 points</p>
        </div>
        <div ${attr(box.body)}><p>All four hit.</p></div>
        <form method="dialog" ${attr(box.footer)}><button class="lt-button" value="close">Close</button></form>
      </dialog>
    `)
    await waitForPaint()

    const d = document.querySelector("dialog") as HTMLElement
    const header = d.querySelector(".lt-dialog__header") as HTMLElement
    const body = d.querySelector(".lt-dialog__body") as HTMLElement
    const footer = d.querySelector(".lt-dialog__footer") as HTMLElement
    // A reference with the token set directly, so the colour is compared
    // fully resolved.
    const reference = document.createElement("div")
    reference.style.background = "var(--lt-color-success-surface)"
    document.body.append(reference)

    expect(getComputedStyle(d).paddingTop).toBe("0px")
    expect(getComputedStyle(header).paddingTop).not.toBe("0px")
    expect(getComputedStyle(body).paddingTop).not.toBe("0px")
    expect(getComputedStyle(footer).marginTop).toBe("0px")
    expect(getComputedStyle(header).backgroundColor).toBe(
      getComputedStyle(reference).backgroundColor,
    )
    expect(getComputedStyle(header).backgroundColor).not.toBe(
      getComputedStyle(body).backgroundColor,
    )
    reference.remove()
  })

  it("gives no stripe when the header has no colour", async () => {
    const box = dialog({ titleId: "neutral-title" })
    mount(`
      <dialog ${attr(box.dialog)} open>
        <div ${attr(box.header)}><h2 ${attr(box.title)}>Neutral</h2></div>
        <div ${attr(box.body)}><p>Text.</p></div>
      </dialog>
    `)
    await waitForPaint()

    const header = document.querySelector(".lt-dialog__header") as HTMLElement
    const body = document.querySelector(".lt-dialog__body") as HTMLElement
    const reference = document.createElement("div")
    reference.style.paddingTop = "var(--lt-spacing-2)"
    document.body.append(reference)

    // The header's bottom spacing is the heading's usual margin, and the body
    // adds nothing, so the distance down to the text is the same as without
    // a header.
    expect(getComputedStyle(header).paddingBottom).toBe(
      getComputedStyle(reference).paddingTop,
    )
    expect(getComputedStyle(body).paddingTop).toBe("0px")
    reference.remove()
  })

  it("gives neutral the same spacing as no colour", async () => {
    const box = dialog({ titleId: "plain-title" })
    const neutral = dialog({ titleId: "neutral-value-title" })
    mount(`
      <dialog ${attr(box.dialog)} id="plain" open>
        <div ${attr(box.header)}><h2 ${attr(box.title)}>Plain</h2></div>
        <div ${attr(box.body)}><p>Text.</p></div>
      </dialog>
      <dialog ${attr(neutral.dialog)} id="neutral" data-color="neutral" open>
        <div ${attr(neutral.header)}><h2 ${attr(neutral.title)}>Neutral</h2></div>
        <div ${attr(neutral.body)}><p>Text.</p></div>
      </dialog>
    `)
    await waitForPaint()

    // `neutral` is the default value, and the editor suggests it. Before, it
    // got 20 pixels under the heading instead of 8.
    const style = (id: string, part: string) =>
      getComputedStyle(document.querySelector(`#${id} ${part}`) as Element)
    expect(style("neutral", ".lt-dialog__header").paddingBottom).toBe(
      style("plain", ".lt-dialog__header").paddingBottom,
    )
    expect(style("neutral", ".lt-dialog__body").paddingTop).toBe("0px")
  })

  it("keeps the distance to the button row when an uncoloured header sits right above it", async () => {
    // A confirmation dialog with only a heading and buttons. With the bottom
    // spacing set to zero, the buttons sat right up against the heading.
    const withHeader = dialog({ titleId: "short-title" })
    mount(`
      <dialog ${attr(withHeader.dialog)} open id="with">
        <div ${attr(withHeader.header)}><h2 ${attr(withHeader.title)}>Cancel?</h2></div>
        <form method="dialog" ${attr(withHeader.footer)}><button class="lt-button" value="yes">Yes</button></form>
      </dialog>
      <dialog ${attr(dialog({ titleId: "short-title-2" }).dialog)} open id="without">
        <h2 class="lt-dialog__title" id="short-title-2">Cancel?</h2>
        <form method="dialog" class="lt-dialog__footer"><button class="lt-button" value="yes">Yes</button></form>
      </dialog>
    `)
    await waitForPaint()

    // To the button, not to the button row's box: the row's spacing is inside
    // the box with a header, and below the box as a margin without. What the
    // user sees is the button.
    const gap = (id: string) => {
      const d = document.getElementById(id) as HTMLElement
      const title = d.querySelector("h2") as HTMLElement
      const button = d.querySelector("button") as HTMLElement
      return (
        button.getBoundingClientRect().top -
        title.getBoundingClientRect().bottom
      )
    }
    expect(Math.round(gap("with"))).toBe(Math.round(gap("without")))
    expect(gap("with")).toBeGreaterThan(0)
  })

  it("stays as before without a header", async () => {
    const box = dialog({ titleId: "default-title" })
    mount(`
      <dialog ${attr(box.dialog)} open>
        <h2 ${attr(box.title)}>Default</h2>
        <div ${attr(box.body)}><p>Text.</p></div>
      </dialog>
    `)
    await waitForPaint()

    const d = document.querySelector("dialog") as HTMLElement
    expect(getComputedStyle(d).paddingTop).not.toBe("0px")
  })

  it("knows its colours", () => {
    expect(dialog.colors).toEqual([
      "neutral",
      "brand",
      "info",
      "success",
      "warning",
      "danger",
    ])
    expect(dialog.isColor("brand")).toBe(true)
    expect(dialog.isColor("purple")).toBe(false)
    expect(dialog.header).toBe("lt-dialog__header")
  })
})

describe("lt-dialog wires from bare structure", () => {
  beforeAll(() => {
    defineLtDialog()
  })

  afterEach(() => {
    const d = document.querySelector("dialog") as HTMLDialogElement | null
    if (d?.open) d.close()
  })

  const BARE = `
    <lt-dialog>
      <dialog>
        <h2>Cancel job 222-0481?</h2>
        <div class="lt-dialog__body"><p>The crew keeps the advance.</p></div>
        <form method="dialog" class="lt-dialog__footer">
          <button class="lt-button" value="keep">Keep the job</button>
        </form>
      </dialog>
    </lt-dialog>`

  async function mountBare(markup = BARE) {
    mount(markup)
    await customElements.whenDefined("lt-dialog")
    await waitForPaint()
    return {
      d: document.querySelector("dialog") as HTMLDialogElement,
      title: document.querySelector("h2") as HTMLElement,
    }
  }

  it("gives the dialog its class and its name from the heading", async () => {
    const { d, title } = await mountBare()

    expect(d.classList.contains("lt-dialog")).toBe(true)
    expect(title.classList.contains("lt-dialog__title")).toBe(true)
    expect(title.id).not.toBe("")
    expect(d.getAttribute("aria-labelledby")).toBe(title.id)
  })

  it("leaves a name from aria-label, and does not touch the heading", async () => {
    // The heading is then not the title, and should get neither an id nor the
    // class that styles it as one.
    const { d, title } = await mountBare(
      BARE.replace("<dialog>", '<dialog aria-label="Cancel the job">'),
    )

    expect(d.hasAttribute("aria-labelledby")).toBe(false)
    expect(d.getAttribute("aria-label")).toBe("Cancel the job")
    expect(title.id).toBe("")
    expect(title.classList.contains("lt-dialog__title")).toBe(false)
  })

  it("gives the class to the heading the server pointed to", async () => {
    const { d } = await mountBare(
      BARE.replace("<dialog>", '<dialog aria-labelledby="own-title">').replace(
        "<h2>Cancel job 222-0481?</h2>",
        '<p id="own-title">Cancel job 222-0481?</p><h2>Attachments</h2>',
      ),
    )
    const own = document.getElementById("own-title") as HTMLElement
    const h2 = d.querySelector("h2") as HTMLElement

    expect(own.classList.contains("lt-dialog__title")).toBe(true)
    expect(h2.classList.contains("lt-dialog__title")).toBe(false)
    expect(h2.id).toBe("")
  })

  it("does not make a heading in the body the title", async () => {
    // The heading in the body belongs to the content. The title is the first
    // heading outside the body, also when it comes after the body.
    const { d } = await mountBare(
      BARE.replace("<h2>Cancel job 222-0481?</h2>", "")
        .replace(
          "<p>The crew keeps the advance.</p>",
          "<h3>The attachments</h3><p>The crew keeps the advance.</p>",
        )
        .replace(
          '<form method="dialog"',
          '<h2>Cancel job 222-0481?</h2><form method="dialog"',
        ),
    )
    const h3 = d.querySelector("h3") as HTMLElement
    const h2 = d.querySelector("h2") as HTMLElement

    expect(h3.classList.contains("lt-dialog__title")).toBe(false)
    expect(h3.id).toBe("")
    expect(h2.classList.contains("lt-dialog__title")).toBe(true)
    expect(d.getAttribute("aria-labelledby")).toBe(h2.id)
  })

  it("does not touch the heading in a nested dialog", async () => {
    // The nested dialog's heading comes first in document order, and is
    // still not the outer dialog's title. The heading after it is.
    const { d } = await mountBare(
      BARE.replace("<h2>Cancel job 222-0481?</h2>", "").replace(
        '<form method="dialog"',
        '<dialog id="inner"><h2>Are you sure?</h2></dialog>' +
          '<h2 id="outer">Cancel job 222-0481?</h2><form method="dialog"',
      ),
    )
    const inner = d.querySelector("#inner h2") as HTMLElement
    const outer = d.querySelector("#outer") as HTMLElement

    expect(inner.classList.contains("lt-dialog__title")).toBe(false)
    expect(outer.classList.contains("lt-dialog__title")).toBe(true)
    expect(d.getAttribute("aria-labelledby")).toBe("outer")
  })

  it("does not count a body outside its own dialog", async () => {
    // A confirmation in the body of a settings dialog: the inner dialog's
    // heading is in the outer dialog's body, but that body is not the inner
    // one's, so the heading is still its title.
    mount(`
      <dialog id="outer" aria-label="Settings">
        <div class="lt-dialog__body">
          <lt-dialog>
            <dialog id="inner">
              <h2 id="sure">Are you sure?</h2>
              <form method="dialog" class="lt-dialog__footer">
                <button class="lt-button" value="cancel">Cancel</button>
              </form>
            </dialog>
          </lt-dialog>
        </div>
      </dialog>
    `)
    await customElements.whenDefined("lt-dialog")
    await waitForPaint()
    const inner = document.getElementById("inner") as HTMLDialogElement
    const title = document.getElementById("sure") as HTMLElement

    expect(title.classList.contains("lt-dialog__title")).toBe(true)
    expect(inner.getAttribute("aria-labelledby")).toBe("sure")
  })

  it("does not reopen when a class changes in the same task as the close", async () => {
    /*
     * `close()` removes `open` synchronously and queues the `close` event,
     * and the observer runs before it. When the component saw a class record
     * and ran the whole of `sync()`, it found a host with `open` and a dialog
     * that was not modal, and opened it again. The user had to close twice.
     */
    const { d } = await mountBare(
      BARE.replace("<lt-dialog>", "<lt-dialog open>").replace(
        "<dialog>",
        "<dialog open>",
      ),
    )
    const host = document.querySelector("lt-dialog") as HTMLElement
    const button = d.querySelector("button") as HTMLButtonElement
    expect(d.matches(":modal")).toBe(true)

    const reported: boolean[] = []
    host.addEventListener("dialog-toggle", (e) => reported.push(e.detail.open))
    const closed = new Promise((r) =>
      d.addEventListener("close", r, { once: true }),
    )
    d.close("delete")
    button.classList.add("busy")
    await closed
    await waitForPaint()

    expect(d.open).toBe(false)
    expect(host.hasAttribute("open")).toBe(false)
    expect(reported).toEqual([false])
  })

  it("does not reopen when a node changes inside the dialog in the same task", async () => {
    // The same race as above, through another door: a `childList` record
    // inside the dialog, such as `button.textContent = "Deleting…"` or a patch
    // from an event stream, is not a swap of the dialog and must not run the
    // open-and-close logic.
    const { d } = await mountBare(
      BARE.replace("<lt-dialog>", "<lt-dialog open>").replace(
        "<dialog>",
        "<dialog open>",
      ),
    )
    const host = document.querySelector("lt-dialog") as HTMLElement
    const body = d.querySelector(".lt-dialog__body") as HTMLElement
    expect(d.matches(":modal")).toBe(true)

    const reported: boolean[] = []
    host.addEventListener("dialog-toggle", (e) => reported.push(e.detail.open))
    const closed = new Promise((r) =>
      d.addEventListener("close", r, { once: true }),
    )
    d.close("delete")
    body.append(document.createElement("p"))
    await closed
    await waitForPaint()

    expect(d.open).toBe(false)
    expect(host.hasAttribute("open")).toBe(false)
    expect(reported).toEqual([false])
  })

  it("puts the wiring back with the same id after a patch", async () => {
    const { d, title } = await mountBare()
    const id = title.id

    // The way a morph does it: everything not in the server's HTML is removed.
    d.removeAttribute("class")
    d.removeAttribute("aria-labelledby")
    title.removeAttribute("id")
    title.removeAttribute("class")
    await waitForPaint()

    expect(title.id).toBe(id)
    expect(d.getAttribute("aria-labelledby")).toBe(id)
    expect(d.classList.contains("lt-dialog")).toBe(true)
    expect(title.classList.contains("lt-dialog__title")).toBe(true)
  })

  it("writes nothing on markup from lt.dialog()", async () => {
    // The direct claim behind "what the server wrote stays": zero mutation
    // records from the component's first round.
    const box = dialog({ titleId: "title" })
    const wrapper = document.createElement("div")
    wrapper.innerHTML = `
      <lt-dialog ${attr(box.host)}>
        <dialog ${attr(box.dialog)}>
          <h2 ${attr(box.title)}>The decision has been registered</h2>
          <div ${attr(box.body)}><p>Job 222-0481 is open to crews.</p></div>
        </dialog>
      </lt-dialog>`
    const host = wrapper.querySelector("lt-dialog") as HTMLElement
    const records: MutationRecord[] = []
    const observer = new MutationObserver((r) => records.push(...r))
    observer.observe(host, {
      attributes: true,
      childList: true,
      subtree: true,
    })

    document.body.append(wrapper)
    await customElements.whenDefined("lt-dialog")
    await waitForPaint()

    expect(records.map((p) => `${p.type} ${p.attributeName}`)).toEqual([])
    observer.disconnect()
    wrapper.remove()
  })

  it("names the dialog after its heading when an update removes aria-label", async () => {
    // The component did not watch `aria-label`, and the dialog had no name
    // until something else changed.
    const { d, title } = await mountBare(
      BARE.replace("<lt-dialog>", "<lt-dialog open>").replace(
        "<dialog>",
        '<dialog class="lt-dialog" aria-label="Confirm" open>',
      ),
    )

    d.removeAttribute("aria-label")
    await waitForPaint()

    expect(title.id).not.toBe("")
    expect(d.getAttribute("aria-labelledby")).toBe(title.id)
  })

  it("reports no close for a dialog that never opened", async () => {
    // The component closes a `<dialog open>` the host does not hold open,
    // and that close came out as `dialog-toggle` with `open: false`.
    const reported: boolean[] = []
    const listener = new AbortController()
    document.addEventListener(
      "dialog-toggle",
      (e) => reported.push((e as CustomEvent<{ open: boolean }>).detail.open),
      { signal: listener.signal },
    )
    await mountBare(BARE.replace("<dialog>", '<dialog class="lt-dialog" open>'))
    listener.abort()

    expect(reported).toEqual([])
  })
})

describe("lt-dialog when React writes the property", () => {
  beforeAll(() => {
    defineLtDialog()
  })

  it("removes open when the property is set to undefined", async () => {
    /*
     * React 19 writes `el.open = undefined` when a prop goes from `true` to
     * absent. `toggleAttribute(name, undefined)` toggles, so a dialog the
     * user had closed got `open` back and opened again.
     */
    const box = dialog({ titleId: "title" })
    mount(
      `<lt-dialog><dialog ${attr(box.dialog)}><h2 ${attr(box.title)}>Cancel?</h2></dialog></lt-dialog>`,
    )
    await customElements.whenDefined("lt-dialog")
    const host = document.querySelector("lt-dialog") as HTMLElement & {
      open: boolean | undefined
    }

    host.open = undefined
    expect(host.hasAttribute("open"), "undefined on a closed one").toBe(false)

    host.open = true
    await waitForPaint()
    expect(host.hasAttribute("open")).toBe(true)

    host.open = undefined
    await waitForPaint()
    expect(host.hasAttribute("open"), "undefined on an open one").toBe(false)
    expect(document.querySelector("dialog")?.matches(":modal")).toBe(false)
  })
})
