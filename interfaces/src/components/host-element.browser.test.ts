/**
 * The shared memory of who wrote an attribute, as the web components use it.
 *
 * The question "is this the server's word or my own echo?" was answered in
 * seven ways across the components, and the model tests found bugs in five
 * classes there. `ownership()` answers it once. These cases are the rule
 * itself; whether a component uses it right is in the component's tests.
 */
import { describe, expect, it, vi } from "vitest"
import { ownership, WRITTEN, warnAboutMarkup, watcher } from "./host-element"

const node = (html: string) => {
  const holder = document.createElement("div")
  holder.innerHTML = html
  return holder.firstElementChild as HTMLElement
}

describe("ownership", () => {
  it("takes what stands on a node it never wrote as the server's word", () => {
    const own = ownership()
    const control = node(`<input aria-invalid="true">`)
    expect(own.knows(control, "aria-invalid")).toBe(false)
    expect(own.serverWord(control, "aria-invalid")).toBe("true")
  })

  it("does not take its own echo for the server's word", () => {
    const own = ownership()
    const control = node(`<input>`)
    own.write(control, "aria-invalid", "true", { server: null, mark: true })
    expect(control.getAttribute("aria-invalid")).toBe("true")
    expect(own.knows(control, "aria-invalid")).toBe(true)
    expect(own.serverWord(control, "aria-invalid")).toBe(null)
  })

  it("without the mark, a value that differs from its own is the server's, and its own is not", () => {
    const own = ownership()
    const entry = node(`<div></div>`)
    own.write(entry, "aria-details", "entry-1", { server: null })
    expect(entry.hasAttribute(WRITTEN)).toBe(false)
    expect(own.serverWord(entry, "aria-details")).toBe(null)
    entry.setAttribute("aria-details", "entry-2")
    expect(own.serverWord(entry, "aria-details")).toBe("entry-2")
  })

  it("takes the same value for the server's word once a morph has removed the mark", () => {
    const own = ownership()
    const control = node(`<input>`)
    own.write(control, "aria-invalid", "true", { server: null, mark: true })
    // A morph from the server sends aria-invalid="true" itself, and removes
    // the mark it never sends.
    control.removeAttribute(WRITTEN)
    expect(own.serverWord(control, "aria-invalid")).toBe("true")
  })

  it('compares a flag by presence, so disabled="disabled" is the same', () => {
    const own = ownership()
    const control = node(`<input>`)
    own.write(control, "disabled", "", {
      server: null,
      mark: true,
      flag: true,
    })
    control.setAttribute("disabled", "disabled")
    expect(own.serverWord(control, "disabled", { flag: true })).toBe(null)
  })

  it("marks nothing when it writes what the server said", () => {
    const own = ownership()
    const control = node(`<input aria-invalid="true">`)
    const records: MutationRecord[] = []
    const observer = new MutationObserver((r) => records.push(...r))
    observer.observe(control, { attributes: true })
    own.write(control, "aria-invalid", "true", { server: "true", mark: true })
    records.push(...observer.takeRecords())
    observer.disconnect()
    expect(control.hasAttribute(WRITTEN)).toBe(false)
    expect(records.map((r) => r.attributeName)).toEqual([])
    expect(own.written(control, "aria-invalid")).toBe("true")
  })

  it("can compare by presence and still write the value, as data-optional on a label", () => {
    const own = ownership()
    const label = node(`<label data-optional="true"></label>`)
    const server = own.serverWord(label, "data-optional", { presence: true })
    own.write(label, "data-optional", "", {
      server,
      mark: true,
      presence: true,
    })
    // Written with setAttr, so the value is the one the component computed,
    // and present on both sides, so nothing is marked.
    expect(label.getAttribute("data-optional")).toBe("")
    expect(label.hasAttribute(WRITTEN)).toBe(false)
  })

  it("remembers how an attribute is compared, so a read without the option still knows its own echo", () => {
    const own = ownership()
    const label = node(`<label></label>`)
    own.write(label, "data-optional", "true", {
      server: null,
      mark: true,
      presence: true,
    })
    expect(own.serverWord(label, "data-optional")).toBe(null)
  })

  it('takes the server\'s word for a flag in any form, so disabled="disabled" marks nothing', () => {
    const own = ownership()
    const control = node(`<input disabled="disabled">`)
    own.write(control, "disabled", "", {
      server: control.getAttribute("disabled"),
      mark: true,
      flag: true,
    })
    expect(control.hasAttribute(WRITTEN)).toBe(false)
    expect(own.serverWord(control, "disabled", { flag: true })).toBe("")
  })

  it("knows an attribute only once it has written that attribute", () => {
    const own = ownership()
    const control = node(`<input>`)
    own.write(control, "data-state", "invalid")
    expect(own.knows(control, "aria-invalid")).toBe(false)
    expect(own.knows(control, "data-state")).toBe(true)
  })

  it("keeps no server's word for a write that gave none, so a later read sees what stands there", () => {
    const own = ownership()
    const label = node(`<label></label>`)
    own.write(label, "for", "codename")
    label.setAttribute("for", "codename")
    expect(own.written(label, "for")).toBe("codename")
    expect(own.serverWord(label, "for")).toBe("codename")
  })

  it("marks only against a server's word, since the mark says the value differs from it", () => {
    const own = ownership()
    const control = node(`<input>`)
    own.write(control, "aria-invalid", "true", { mark: true })
    expect(control.hasAttribute(WRITTEN)).toBe(false)
  })
})

describe("watcher", () => {
  const flush = () => new Promise((r) => setTimeout(r, 0))

  it("watches the target it is started on, and stops with stop()", async () => {
    const seen: string[] = []
    const watch = watcher(
      (records) => seen.push(...records.map((r) => r.attributeName ?? "")),
      { attributes: true },
    )
    const target = node(`<div></div>`)
    watch.start(target)
    target.setAttribute("open", "")
    await flush()
    watch.stop()
    target.setAttribute("hidden", "")
    await flush()
    expect(seen).toEqual(["open"])
  })

  it("started on a new node, leaves the old one", async () => {
    const seen: string[] = []
    const watch = watcher(
      (records) => seen.push(...records.map((r) => (r.target as Element).id)),
      { attributes: true },
    )
    const first = node(`<dialog id="first"></dialog>`)
    const second = node(`<dialog id="second"></dialog>`)
    watch.start(first)
    watch.start(second)
    first.setAttribute("open", "")
    second.setAttribute("open", "")
    await flush()
    watch.stop()
    expect(seen).toEqual(["second"])
  })
})

describe("warnAboutMarkup", () => {
  const settled = () =>
    new Promise((r) =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => setTimeout(r, 20)),
      ),
    )

  it("is silent about an empty region when asked, and speaks about one with content", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const empty = document.createElement("lt-example-empty")
    const filled = document.createElement("lt-example-filled")
    filled.innerHTML = "<p>no control</p>"
    document.body.append(empty, filled)
    for (const host of [empty, filled])
      warnAboutMarkup(host, "found no control", () => true, {
        silentWhenEmpty: true,
      })
    await settled()
    const said = warn.mock.calls.map((c) => String(c[0]))
    warn.mockRestore()
    empty.remove()
    filled.remove()
    expect(said).toEqual(["lt-example-filled: found no control"])
  })
})
