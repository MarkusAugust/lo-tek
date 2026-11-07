/**
 * Checks that the demos on the pattern pages actually work.
 *
 * The pattern pages touch many components at once, and therefore rot faster
 * than the component pages. A demo that has stopped working is worse than no
 * demo: the reader believes that is what the pattern looks like, and copies
 * something that does not do what it says.
 *
 * The check runs the same steps a user takes, in the built site.
 *
 * Run with: bun run test:docs (build first)
 */

import { site } from "./site"

const s = await site()
const page = s.page

const code = await s.run(async () => {
  function expect(claim: boolean, description: string): void {
    if (!claim) s.fail(description)
  }

  async function open(path: string) {
    await s.open(path)
  }

  /** Types into a field in the form demo, and leaves it afterwards. */
  async function typeInField(id: string, value: string) {
    await page.evaluate(
      ([id, value]) => {
        const root = document.getElementById("demo-form")?.shadowRoot
        const field = root?.getElementById(id) as HTMLInputElement
        field.focus()
        field.value = value
        field.dispatchEvent(new Event("input", { bubbles: true }))
        field.blur()
      },
      [id, value],
    )
  }

  function readForm() {
    return page.evaluate(() => {
      const root = document.getElementById("demo-form")?.shadowRoot
      return {
        links: root?.querySelectorAll("lt-error-summary li a").length ?? 0,
        marked: root?.querySelectorAll("[aria-invalid='true']").length ?? 0,
        heading:
          root?.querySelector(".lt-error-summary__title")?.textContent ?? "",
      }
    })
  }

  // The form: an empty form should give errors in every field and in the summary
  {
    await open("/patterns/form/")

    await page.evaluate(() => {
      const root = document.getElementById("demo-form")?.shadowRoot
      const button = root?.querySelector("button[type=submit]") as HTMLElement
      button.click()
    })
    await page.waitForTimeout(300)

    const result = await page.evaluate(() => {
      const root = document.getElementById("demo-form")?.shadowRoot
      return {
        links: root?.querySelectorAll("lt-error-summary li a").length ?? 0,
        marked: root?.querySelectorAll("[aria-invalid='true']").length ?? 0,
        heading:
          root?.querySelector(".lt-error-summary__title")?.textContent ?? "",
        pointsToError:
          root
            ?.getElementById("demo-fixer")
            ?.getAttribute("aria-describedby")
            ?.includes("demo-fixer-error") ?? false,
      }
    })

    expect(
      result.links === 2,
      `the summary has ${result.links} errors, expected 2`,
    )
    expect(
      result.marked === 2,
      `${result.marked} fields are marked, expected 2`,
    )
    expect(
      result.heading.includes("2"),
      `the heading does not say how many errors: "${result.heading}"`,
    )
    expect(
      result.pointsToError,
      "the field does not point to the error text with aria-describedby",
    )

    // If the user fixes one of two errors, the other should remain on its own.
    await typeInField("demo-fixer", "fixer@relay.example")
    await page.waitForTimeout(200)

    const afterFix = await readForm()

    expect(
      afterFix.links === 1,
      `the summary has ${afterFix.links} errors after one is fixed, expected 1`,
    )
    expect(
      afterFix.heading.includes("one"),
      `the heading does not count down: "${afterFix.heading}"`,
    )

    // An address without a top-level domain is accepted by the browser, but
    // not by the form.
    await typeInField("demo-fixer", "fixer@relay")
    await page.waitForTimeout(200)

    expect(
      (await readForm()).links === 2,
      '"fixer@relay" was accepted as an email address',
    )
  }

  // The form: an error should appear when the field is left, without a
  // submission first
  {
    await open("/patterns/form/")

    await typeInField("demo-fixer", "fixer")
    await page.waitForTimeout(200)

    const afterBlur = await readForm()

    expect(
      afterBlur.marked === 1,
      `${afterBlur.marked} fields are marked after one was left, expected 1`,
    )
    expect(
      afterBlur.links === 1,
      `the summary shows ${afterBlur.links} errors after blur, expected 1`,
    )
  }

  // The form: a date outside the year the field allows should say so, not
  // that the date does not exist
  {
    await open("/patterns/form/")

    await typeInField("demo-deliver-by", "2081-04-25")
    await page.waitForTimeout(200)

    const message = await page.evaluate(
      () =>
        document
          .getElementById("demo-form")
          ?.shadowRoot?.getElementById("demo-deliver-by-error")?.textContent ??
        "",
    )

    expect(
      message === "The board only takes jobs for 2079",
      `a date in 2081 gave "${message}"`,
    )
  }

  // The list: four states, and here matches and empty are checked
  {
    await open("/patterns/list/")
    await page.waitForTimeout(700)

    const initial = await page.evaluate(() => {
      const root = document.getElementById("demo-list")?.shadowRoot
      return {
        rows: root?.querySelectorAll("tbody tr").length ?? 0,
        status: root?.getElementById("demo-matches")?.textContent ?? "",
      }
    })

    expect(
      initial.rows === 4,
      `the list shows ${initial.rows} rows, expected 4`,
    )
    expect(
      initial.status.includes("4"),
      `the number of matches is not announced: "${initial.status}"`,
    )

    // Sorting: a click on "Floor" reverses the order, moves `aria-sort`
    // and leaves focus on the button, even though the table is redrawn.
    await page
      .locator("#demo-list .lt-table__sort", { hasText: "Floor" })
      .click()
    const sorted = await page.evaluate(() => {
      const root = document.getElementById("demo-list")?.shadowRoot
      return {
        first: root?.querySelector("tbody th")?.textContent?.trim() ?? "",
        sorted: [...(root?.querySelectorAll("th[aria-sort]") ?? [])].map(
          (th) => `${th.textContent?.trim()}=${th.getAttribute("aria-sort")}`,
        ),
        focus: root?.activeElement?.textContent?.trim() ?? "",
      }
    })

    expect(
      sorted.first === "Floor 9",
      `the first row after sorting is "${sorted.first}", expected Floor 9`,
    )
    expect(
      sorted.sorted.join() === "Floor=ascending",
      `aria-sort is on ${sorted.sorted.join() || "nothing"}, expected Floor=ascending`,
    )
    expect(
      sorted.focus === "Floor",
      `focus is on "${sorted.focus}" after sorting, expected the button`,
    )

    await page.evaluate(() => {
      const root = document.getElementById("demo-list")?.shadowRoot
      const field = root?.getElementById("demo-search") as HTMLInputElement
      field.value = "does not exist"
      field.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await page.waitForTimeout(1100)

    const empty = await page.evaluate(() => {
      const root = document.getElementById("demo-list")?.shadowRoot
      return {
        text: root?.getElementById("demo-result")?.textContent ?? "",
        status: root?.getElementById("demo-matches")?.textContent ?? "",
        hasReset: Boolean(root?.getElementById("demo-reset")),
      }
    })

    expect(
      empty.text.includes("does not exist"),
      "the empty state does not say what was searched for",
    )
    expect(empty.hasReset, "the empty state lacks a way forward")
    expect(
      empty.status.includes("No matches"),
      `an empty result is not announced: "${empty.status}"`,
    )
  }

  // The confirmation: the dialog takes focus, and the message comes afterwards
  {
    await open("/patterns/confirmation/")

    await page.evaluate(() => {
      const root = document.getElementById("demo-confirm")?.shadowRoot
      ;(root?.getElementById("demo-cancel") as HTMLElement).click()
    })
    await page.waitForTimeout(200)

    const opened = await page.evaluate(() => {
      const root = document.getElementById("demo-confirm")?.shadowRoot
      const dialog = root?.getElementById("demo-dialog") as HTMLDialogElement
      return {
        open: dialog.open,
        focusInside: dialog.contains(root?.activeElement ?? null),
      }
    })

    expect(opened.open, "the dialog did not open")
    expect(opened.focusInside, "focus did not end up inside the dialog")

    await page.evaluate(() => {
      const root = document.getElementById("demo-confirm")?.shadowRoot
      const dialog = root?.getElementById("demo-dialog") as HTMLDialogElement
      dialog.close("cancel")
    })
    await page.waitForTimeout(200)

    const message = await page.evaluate(() => {
      const root = document.getElementById("demo-confirm")?.shadowRoot
      return root?.querySelector(".lt-toast__message")?.textContent ?? ""
    })

    expect(
      message.includes("Job 222-0481 has been cancelled"),
      `the message did not come after the action: "${message}"`,
    )
  }

  // The theme picker: switches theme without JavaScript, and sets color-scheme
  {
    await open("/demo/theme/")

    /*
     * The click must go to the label and not to the input.
     *
     * In a toggle group the radio button lies hidden under the label, so a
     * click straight on it is rejected because the label takes the pointer.
     * The first version of this check waited thirty seconds and timed out for
     * exactly that reason.
     */
    const choose = async (value: string) => {
      await page.click(`label:has(input[value="${value}"])`)
      return page.evaluate(() => {
        const root = document.documentElement
        return {
          text: getComputedStyle(root)
            .getPropertyValue("--lt-color-neutral-text-strong")
            .trim(),
          scheme: getComputedStyle(root).colorScheme,
        }
      })
    }

    const controlCount = await page.evaluate(
      () => document.querySelectorAll("input.lt-theme-control").length,
    )
    expect(
      controlCount === 3,
      `found ${controlCount} theme controls, expected 3`,
    )

    const light = await choose("light")
    const dark = await choose("dark")
    const auto = await choose("auto")

    // An empty value would otherwise be "equal" for two choices without
    // anything switching.
    expect(light.text !== "", "found no token value, is tokens.css loaded?")
    expect(
      light.text !== dark.text,
      `light and dark gave the same text colour: ${light.text}`,
    )

    // The browser's own surfaces should follow the choice, and "follow the
    // system" should ask for both. Without this, scrollbars and selects were
    // left in the wrong theme.
    expect(light.scheme === "light", `light gave color-scheme ${light.scheme}`)
    expect(dark.scheme === "dark", `dark gave color-scheme ${dark.scheme}`)
    expect(
      auto.scheme === "light dark",
      `follow the system gave color-scheme ${auto.scheme}`,
    )
    // The page has no `data-theme`, so "follow the system" should give the
    // machine's own answer. Playwright runs light by default, and that is what
    // we claim; a `|| dark` here made the clause impossible to fail.
    expect(
      auto.text === light.text,
      `follow the system gave ${auto.text}, expected the machine's light ${light.text}`,
    )
  }

  // The page skeleton: the landmarks and the skip link
  {
    await open("/demo/page-skeleton/")

    const structure = await page.evaluate(() => ({
      skipLink: document.body.firstElementChild?.className ?? "",
      main: Boolean(document.querySelector("main#main-content[tabindex='-1']")),
      namedNavs: document.querySelectorAll("nav[aria-label]").length,
      h1: document.querySelectorAll("h1").length,
      landmarks: ["header", "main", "footer"].filter((t) =>
        document.querySelector(t),
      ).length,
    }))

    expect(
      structure.skipLink.includes("lt-skip-link"),
      "the skip link is not the first thing in body",
    )
    expect(structure.main, "the main content lacks id or tabindex")
    expect(
      structure.namedNavs === 2,
      `${structure.namedNavs} navigations have names, expected 2`,
    )
    expect(
      structure.h1 === 1,
      `the page has ${structure.h1} h1 elements, expected 1`,
    )
    expect(structure.landmarks === 3, "the page lacks a landmark")
  }
})

if (code === 0) console.log("The demos on the pattern pages do what they say.")
else console.error("\nThe pattern demos do not work as they should.")
process.exit(code)
