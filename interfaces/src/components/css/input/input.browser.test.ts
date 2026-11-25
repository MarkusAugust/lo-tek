/// <reference path="../../../types/css.d.ts" />
/// Without this, Vitest's `CDPSession` is an empty interface. The provider
/// fills it in, and here it is Playwright that gives us `send`.
/// <reference types="@vitest/browser-playwright" />

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { cdp, page, server, userEvent } from "vitest/browser"
import {
  expectNoAccessibilityViolations,
  mount,
  waitForPaint,
} from "../../../testing/a11y"
import { color } from "../../../testing/color"
import { findOverflow, mountIsolated } from "../../../testing/isolated"
import inputCss from "./input.css?inline"

import "../../../tokens/tokens.css"
import "./input.css"
import "../label/label.css"

function css(id: string) {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing element #${id}`)
  }

  return getComputedStyle(element)
}

describe("lt-input", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <input id="default" class="lt-input" />
      <input id="date" class="lt-input" type="date" data-variant="date" value="2079-05-31" />
      <input id="time" class="lt-input" type="time" data-variant="time" value="10:30" />
      <input id="datetime" class="lt-input" type="datetime-local" data-variant="datetime-local" value="2079-05-31T10:30" />
      <input id="invalid" class="lt-input" data-state="invalid" />
      <input id="success" class="lt-input" data-state="success" />
      <input id="disabled" class="lt-input" disabled />
    `
  })

  it("applies default styles", () => {
    const input = css("default")

    expect(input.backgroundColor).toBe(color("--lt-color-neutral-canvas"))
    expect(input.borderTopColor).toBe(color("--lt-color-disabled-text"))
    expect(input.color).toBe(color("--lt-color-neutral-text-strong"))
  })

  it("applies invalid styles", () => {
    const input = css("invalid")

    expect(input.backgroundColor).toBe(color("--lt-color-danger-surface"))
    expect(input.borderTopColor).toBe(color("--lt-color-danger-text"))
  })

  it("applies date variant styles", () => {
    const input = css("date")

    expect(input.fontVariantNumeric).toContain("tabular-nums")
    expect(input.backgroundImage).toContain("data:image")
  })

  it("applies time variant icon styles", () => {
    const input = css("time")

    expect(input.backgroundImage).toContain("data:image")
  })

  it("applies datetime-local variant icon styles", () => {
    const input = css("datetime")

    expect(input.backgroundImage).toContain("data:image")
  })

  it("applies success styles", () => {
    const input = css("success")

    expect(input.backgroundColor).toBe(color("--lt-color-success-surface"))
    expect(input.borderTopColor).toBe(color("--lt-color-success-text"))
  })

  it("applies disabled styles", () => {
    const input = css("disabled")

    expect(input.backgroundColor).toBe(color("--lt-color-disabled-surface"))
    expect(input.borderTopColor).toBe(color("--lt-color-disabled-surface"))
    expect(input.color).toBe(color("--lt-color-disabled-text"))
    // The cursor only shows if the pointer hits the element
    expect(input.pointerEvents).toBe("auto")
  })
})

describe("lt-input accessibility", () => {
  it("has enough contrast and a label in every state", async () => {
    mount(`
      <label class="lt-label" for="a11y-default">Fixer's address</label>
      <input class="lt-input" id="a11y-default" type="email" />

      <label class="lt-label" for="a11y-valid">Confirm the fixer's address</label>
      <input class="lt-input" id="a11y-valid" type="email" data-state="success" value="fixer@relay.example" />

      <label class="lt-label" for="a11y-invalid">Backup fixer</label>
      <input class="lt-input" id="a11y-invalid" type="email" data-state="invalid" aria-invalid="true" value="fixer@" />

      <label class="lt-label" for="a11y-date">Deliver by</label>
      <input class="lt-input" id="a11y-date" type="date" data-variant="date" value="2079-05-31" />
    `)

    await waitForPaint()
    await expectNoAccessibilityViolations()
  })
})

describe("lt-input without a CSS reset", () => {
  it("stays inside its box", () => {
    const { box } = mountIsolated(
      inputCss,
      `<input class="lt-input" type="email" value="fixer@relay.example" />`,
    )

    expect(findOverflow(box)).toEqual([])
  })
})

describe("lt-input disabled", () => {
  it("shows the not-allowed cursor, and is actually hit by the mouse", () => {
    mount(`<input class="lt-input" disabled value="Off" />`)

    const element = document.querySelector("input") as HTMLElement
    const rect = element.getBoundingClientRect()

    expect(getComputedStyle(element).cursor).toBe("not-allowed")

    // cursor has no effect if the pointer does not hit the element. All of
    // these had pointer-events: none, so the cursor was never shown.
    expect(
      document.elementFromPoint(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
      ),
    ).toBe(element)
  })
})

/** What is painted of an element, pixel by pixel. */
async function picture(element: HTMLElement): Promise<ImageData> {
  const image = new Image()
  image.src = `data:image/png;base64,${await page.screenshot({ element, save: false })}`
  await image.decode()
  const canvas = document.createElement("canvas")
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext("2d")
  if (context === null) throw new Error("Could not draw on the canvas")
  context.drawImage(image, 0, 0)
  return context.getImageData(0, 0, image.width, image.height)
}
/**
 * How many pixels two pictures of the same element differ in, by more than
 * the edge of a glyph does from one picture to the next: a tenth of the way
 * from black to white in some channel, which the pale mark on a chosen part
 * of a date is well over. `counts` says which pixels are looked at.
 */
function differing(
  a: ImageData,
  b: ImageData,
  counts: (x: number, y: number) => boolean = () => true,
): number {
  if (a.width !== b.width || a.height !== b.height) return a.width * a.height
  let count = 0
  for (let y = 0; y < a.height; y++)
    for (let x = 0; x < a.width; x++) {
      if (!counts(x, y)) continue
      const at = (y * a.width + x) * 4
      if (
        Math.abs(a.data[at] - b.data[at]) > 24 ||
        Math.abs(a.data[at + 1] - b.data[at + 1]) > 24 ||
        Math.abs(a.data[at + 2] - b.data[at + 2]) > 24
      )
        count += 1
    }
  return count
}
/** Enough pixels to be something a person sees: a ring or a mark, not a stray dot. */
const SEEN = 24
/**
 * The pixels of a picture of `frame` that are not on the edge of `field`:
 * inside the field, clear of its border, or outside it. A field that has
 * focus has a border of another colour, however focus came to it and
 * wherever in it focus is. That line alone is not what shows a person
 * using the keyboard where they are, so it is left out.
 */
function offTheEdge(image: ImageData, frame: HTMLElement, field: HTMLElement) {
  const [outer, inner] = [frame, field].map((e) => e.getBoundingClientRect())
  const scale = image.width / outer.width
  const edge = {
    left: (inner.left - outer.left) * scale,
    top: (inner.top - outer.top) * scale,
    right: (inner.right - outer.left) * scale,
    bottom: (inner.bottom - outer.top) * scale,
  }
  const band = 3 * scale
  return (x: number, y: number) => {
    const within = (grow: number) =>
      x >= edge.left - grow &&
      x < edge.right + grow &&
      y >= edge.top - grow &&
      y < edge.bottom + grow
    return within(-band) || !within(1)
  }
}
/**
 * The part of a field where its icon stands, as a picture of `frame` has
 * it: the last fifth, which is the right end, and the left end in a field
 * written from right to left.
 */
function iconPart(image: ImageData, direction = "ltr") {
  return (x: number) =>
    direction === "rtl" ? x < image.width * 0.22 : x >= image.width * 0.78
}
/** The other end of the field from its icon. */
function farPart(image: ImageData, direction = "ltr") {
  return iconPart(image, direction === "rtl" ? "ltr" : "rtl")
}

/** The fields the browser gives a picker of its own. */
const PICKED = [
  ["date", "2079-05-31"],
  ["time", "10:30"],
  ["datetime-local", "2079-05-31T10:30"],
] as const
/**
 * A field of one kind with room around it for a ring, between two plain
 * fields that stand far enough off for their own rings to stay out of its
 * picture.
 */
function pickedField(type: string, value: string, direction = "ltr") {
  mount(`
    <input id="first" class="lt-input" aria-label="Before" />
    <div id="frame" dir="${direction}" style="inline-size: max-content; padding: 12px; margin-block: 32px">
      <input id="field" class="lt-input" type="${type}" data-variant="${type}" value="${value}" aria-label="When" style="inline-size: 16rem" />
    </div>
    <input id="last" class="lt-input" aria-label="After" />
  `)
  return {
    first: document.getElementById("first") as HTMLInputElement,
    field: document.getElementById("field") as HTMLInputElement,
    frame: document.getElementById("frame") as HTMLElement,
  }
}

/*
 * A date, a time and a date with a time are fields with several stops for
 * the keyboard: one for each part of the value, and in one browser one more
 * after them, the button that opens the browser's picker. LO-TEK hides that
 * button's own picture and paints an icon of its own where it stands, so the
 * stop is there with nothing of the browser's to show it.
 *
 * At every stop something a person can see says where the keyboard is: what
 * is painted of the field then is not what is painted with focus elsewhere,
 * beyond the border every focused field has, and not what is painted at any
 * other stop. How many stops a field has is the browser's to say.
 */
describe("lt-input with a picker shows where the keyboard is at every stop", () => {
  for (const [type, value] of PICKED)
    it(`shows each stop of a ${type} field`, async () => {
      const { first, field, frame } = pickedField(type, value)
      // Focus elsewhere, come to by the keyboard.
      first.focus()
      await userEvent.keyboard("{Shift>}{Tab}{/Shift}")
      await userEvent.tab()
      first.focus()
      await waitForPaint()
      const elsewhere = await picture(frame)

      const stops: ImageData[] = []
      await userEvent.tab()
      while (document.activeElement === field && stops.length < 12) {
        await waitForPaint()
        stops.push(await picture(frame))
        await userEvent.tab()
      }
      expect(
        stops.length,
        "stops for the keyboard in the field",
      ).toBeGreaterThan(0)
      expect(document.activeElement?.id, "Tab goes on after the field").toBe(
        "last",
      )

      const unseen = stops.flatMap((stop, index) => {
        const faults: string[] = []
        const fromElsewhere = differing(
          stop,
          elsewhere,
          offTheEdge(stop, frame, field),
        )
        if (fromElsewhere < SEEN)
          faults.push(
            `stop ${index + 1} of ${stops.length} shows nothing but the border of a field that has focus (${fromElsewhere} pixels differ from the field with focus elsewhere, the border left out)`,
          )
        for (const [other, earlier] of stops.slice(0, index).entries()) {
          const fromOther = differing(stop, earlier)
          if (fromOther < SEEN)
            faults.push(
              `stop ${index + 1} of ${stops.length} looks like stop ${other + 1} (${fromOther} pixels differ)`,
            )
        }
        return faults
      })
      expect(unseen.join("; ")).toBe("")
    })
})

/*
 * Where the picker's stop shows. LO-TEK's icon is painted at the end of the
 * field, the left end when the field is written from right to left, and the
 * browser's button has to stand on it: there the ring goes round the icon,
 * and a press on the icon is a press on the button. The browser that has
 * the stop is the one asked.
 */
describe.skipIf(server.browser !== "chromium")(
  "lt-input with a picker shows the keyboard round its icon",
  () => {
    for (const direction of ["ltr", "rtl"])
      for (const [type, value] of PICKED)
        it(`shows the picker's stop at the icon of a ${type} field, ${direction}`, async () => {
          const { first, field, frame } = pickedField(type, value, direction)
          expect(field.matches(":dir(rtl)")).toBe(direction === "rtl")
          first.focus()
          await userEvent.keyboard("{Shift>}{Tab}{/Shift}")
          await userEvent.tab()
          first.focus()
          await waitForPaint()
          const elsewhere = await picture(frame)

          // The icon itself is at that end: taken away, that end changes
          // and the other does not.
          field.style.backgroundImage = "none"
          await waitForPaint()
          const bare = await picture(frame)
          field.style.backgroundImage = ""
          await waitForPaint()
          expect(
            [
              differing(elsewhere, bare, iconPart(bare, direction)) > SEEN,
              differing(elsewhere, bare, farPart(bare, direction)),
            ],
            "LO-TEK's icon at the icon's end, and pixels of it at the other",
          ).toEqual([true, 0])

          // To the last stop in the field: the button.
          let last = elsewhere
          let stops = 0
          await userEvent.tab()
          while (document.activeElement === field && stops < 12) {
            await waitForPaint()
            last = await picture(frame)
            stops += 1
            await userEvent.tab()
          }
          expect(stops, "stops in the field").toBeGreaterThan(1)

          const off = offTheEdge(last, frame, field)
          const at = (part: (x: number) => boolean) =>
            differing(last, elsewhere, (x, y) => part(x) && off(x, y))
          expect(
            {
              atTheIcon: at(iconPart(last, direction)) >= SEEN,
              atTheOtherEnd: at(farPart(last, direction)),
            },
            `where the picker's stop shows: ${at(iconPart(last, direction))} pixels at the icon's end`,
          ).toEqual({ atTheIcon: true, atTheOtherEnd: 0 })
        })
  },
)

describe("lt-input with a picker paints one icon", () => {
  afterEach(() => {
    document.documentElement.style.colorScheme = ""
    document.getElementById("only-ours")?.remove()
  })

  for (const scheme of ["light", "dark"])
    for (const [type, value] of PICKED)
      it(`paints its own icon and not the browser's in a ${type} field, ${scheme}`, async () => {
        document.documentElement.style.colorScheme = scheme
        const { field, frame } = pickedField(type, value)
        await waitForPaint()
        const shown = await picture(frame)

        // With the browser's own button taken away altogether, the field
        // looks the same: the button's picture was not there to see.
        const rule = document.createElement("style")
        rule.id = "only-ours"
        rule.textContent =
          "#field::-webkit-calendar-picker-indicator { display: none !important }"
        document.head.append(rule)
        await waitForPaint()
        const oursOnly = await picture(frame)
        expect(
          differing(shown, oursOnly, iconPart(shown)),
          "pixels the browser's own button paints in the icon's place",
        ).toBe(0)

        // And with LO-TEK's icon taken away it does not: the icon was.
        field.style.backgroundImage = "none"
        await waitForPaint()
        expect(
          differing(shown, await picture(frame), iconPart(shown)),
          "pixels LO-TEK's icon paints",
        ).toBeGreaterThan(SEEN)
      })
})

/*
 * In high contrast LO-TEK's icon is taken away and the browser's own button
 * is shown, since an image with a fixed colour cannot follow the user's
 * colours. The button then shows its own ring when the keyboard is on it.
 * The mode can only be turned on in Chromium from here, which is also the
 * browser that has the stop.
 */
describe.skipIf(server.browser !== "chromium")(
  "lt-input with a picker in high contrast mode",
  () => {
    afterEach(async () => {
      await cdp().send("Emulation.setEmulatedMedia", { features: [] })
    })

    for (const [type, value] of PICKED)
      it(`shows the keyboard on the browser's own button of a ${type} field`, async () => {
        await cdp().send("Emulation.setEmulatedMedia", {
          features: [{ name: "forced-colors", value: "active" }],
        })
        const { first, field, frame } = pickedField(type, value)
        expect(getComputedStyle(field).backgroundImage).toBe("none")
        first.focus()
        await userEvent.keyboard("{Shift>}{Tab}{/Shift}")
        await userEvent.tab()
        first.focus()
        await waitForPaint()
        const elsewhere = await picture(frame)

        // To the last stop in the field: the button.
        let last = elsewhere
        await userEvent.tab()
        while (document.activeElement === field) {
          await waitForPaint()
          last = await picture(frame)
          await userEvent.tab()
        }

        expect(
          differing(last, elsewhere, iconPart(last)),
          "pixels that show the keyboard at the button",
        ).toBeGreaterThan(SEEN)
      })
  },
)
