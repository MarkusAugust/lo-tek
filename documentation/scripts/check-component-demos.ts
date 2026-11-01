/**
 * Checks that the live previews on the component pages work.
 *
 * `check-documentation.ts` reads the mdx files as text and checks that every
 * class and variable is mentioned. It says nothing about whether the example
 * works. When the API changed so that the server writes the markup, three
 * demos were left with `heading=`, `label=` and `<option>` children, and both
 * checks reported green while the published examples did nothing at all.
 *
 * This one does what the reader does, in the built site. All the previews
 * live in a shadow root, so the lookups go through the host element.
 *
 * Run with: bun run test:docs (build first)
 */

import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium, type Page } from "playwright"

const DIST = fileURLToPath(new URL("../dist/", import.meta.url))
const PORT = 4184

const MEDIA_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  json: "application/json",
  svg: "image/svg+xml",
  webp: "image/webp",
  png: "image/png",
  woff2: "font/woff2",
}

/*
 * The server binds 127.0.0.1, and the check connects to the same address.
 *
 * `Bun.serve` without a hostname binds the IPv4 wildcard, and a foreign
 * process on IPv6 loopback then takes the port without anything throwing: two
 * servers, same port number, no error message. `localhost` resolves IPv6
 * first on macOS, so the check talked to the other process. It happened: a
 * completely different website was on 4173, and the check read accessibility
 * violations on it. It could just as well have reported green without having
 * seen a single one of our pages.
 *
 * With the hostname set, a second binding to the same address throws, and
 * that is what we want: a port that is taken should stop the run, not
 * silently send it somewhere else. So never change this back to `localhost`.
 */
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  fetch(request) {
    const path = decodeURIComponent(new URL(request.url).pathname)
    const filePath = path.endsWith("/")
      ? join(DIST, path, "index.html")
      : join(DIST, path)
    const file = Bun.file(filePath)
    const extension = filePath.split(".").pop() ?? ""
    return file.exists().then((exists) =>
      exists
        ? new Response(file, {
            headers: {
              "content-type":
                MEDIA_TYPES[extension] ?? "application/octet-stream",
            },
          })
        : new Response("Not found", { status: 404 }),
    )
  },
})

const errors: string[] = []
let current = ""

function expect(claim: boolean, description: string): void {
  if (!claim) errors.push(`${current}: ${description}`)
}

const browser = await chromium.launch()
const context = await browser.newContext()
const page = await context.newPage()

page.on("pageerror", (e) => {
  errors.push(`${current}: script error "${e.message}"`)
})
page.on("console", (message) => {
  if (message.type() === "error") {
    errors.push(`${current}: console error "${message.text()}"`)
  }
  /*
   * Warnings count too.
   *
   * The components speak up with `console.warn` when the markup they got
   * does not hang together. If such a warning appeared on one of the
   * component pages, it would mean either that an example is wrong, or that
   * the warning fires on markup that is fine. Both must be caught, because a
   * warning that also appears on correct markup gets switched off, and then
   * it is worthless.
   *
   * This script only goes through the component pages. The rest of the
   * site, the pattern pages and the front page included, is covered by
   * `check-accessibility.ts`, which visits every single built page.
   */
  if (message.type() === "warning") {
    errors.push(`${current}: console warning "${message.text()}"`)
  }
})

/**
 * Opens a component page and checks what applies to every demo.
 *
 * Then that component's own test runs. The general part alone is not
 * enough: the tabs demo rendered buttons and panels just fine, it had only
 * stopped getting roles.
 */
async function on(
  component: string,
  hostId: string,
  tag: string,
  test: (page: Page, id: string) => Promise<void>,
) {
  current = component
  await page.goto(`http://127.0.0.1:${PORT}/components/${component}/`, {
    waitUntil: "networkidle",
  })

  const general = await page.evaluate(
    ([id, tag]) => ({
      hostExists: Boolean(document.getElementById(id)),
      hasShadowRoot: Boolean(document.getElementById(id)?.shadowRoot),
      registered: Boolean(customElements.get(tag)),
      hasContent:
        (document.getElementById(id)?.shadowRoot?.textContent ?? "").trim()
          .length > 0,
    }),
    [hostId, tag] as const,
  )

  expect(general.hostExists, `could not find the preview "${hostId}"`)
  expect(general.hasShadowRoot, "the preview has no shadow root")
  expect(general.registered, `the element <${tag}> is not registered`)
  expect(general.hasContent, "the preview is empty")

  if (general.hasShadowRoot) await test(page, hostId)
}

/**
 * Requires that something the demo created can actually be seen inside the
 * preview.
 *
 * We did not catch components that attach their content to the viewport
 * here before. `<lt-connection-status>` writes its bar with
 * `position: fixed` at the top, and in the documentation it landed at the
 * top of the window, behind the page's fixed header. The reader pressed the
 * button in the middle of the page and it looked as if nothing happened,
 * while this check reported green because the element existed in the DOM.
 */
async function visibleInBox(
  page: Page,
  id: string,
  selector: string,
): Promise<void> {
  const result = await page.evaluate(
    ([id, selector]) => {
      const host = document.getElementById(id)
      const el = host?.shadowRoot?.querySelector(selector)
      // The surface and not the host: that is the bordered box the reader
      // sees, and with `maxWidth` it is narrower than the host element. No
      // fallback to the host: if someone renames the class, the check should
      // say so rather than silently get more lenient.
      const surface = host?.shadowRoot?.querySelector(".surface")
      if (!host || !el || !surface)
        return {
          found: Boolean(el),
          visible: false,
          inside: false,
          surface: Boolean(surface),
        }

      const r = el.getBoundingClientRect()
      const b = surface.getBoundingClientRect()
      return {
        found: true,
        surface: true,
        visible: r.width > 0 && r.height > 0,
        inside:
          r.top >= b.top - 1 &&
          r.bottom <= b.bottom + 1 &&
          r.left >= b.left - 1 &&
          r.right <= b.right + 1,
      }
    },
    [id, selector] as const,
  )

  expect(result.found, `could not find "${selector}" in the preview`)
  expect(result.surface, "found no .surface in the preview to compare against")
  expect(result.visible, `"${selector}" has no extent`)
  expect(
    result.inside,
    `"${selector}" is outside the preview, so the reader does not see it where they pressed`,
  )
}

await on("tabs", "demo-tabs", "lt-tabs", async (page, id) => {
  const result = await page.evaluate((id) => {
    const root = document.getElementById(id)?.shadowRoot
    const tabs = [...(root?.querySelectorAll("[role='tab']") ?? [])]
    const panels = [...(root?.querySelectorAll("[role='tabpanel']") ?? [])]
    ;(tabs[1] as HTMLElement | undefined)?.click()
    return {
      count: tabs.length,
      selected: tabs[1]?.getAttribute("aria-selected"),
      visible: panels.filter((p) => !(p as HTMLElement).hidden).length,
      tabStops: tabs.filter((t) => (t as HTMLElement).tabIndex === 0).length,
    }
  }, id)

  expect(result.count >= 2, `found ${result.count} tabs`)
  expect(result.selected === "true", "a click does not select the tab")
  expect(
    result.visible === 1,
    `${result.visible} panels are visible, expected 1`,
  )
  expect(result.tabStops === 1, "more than one tab is a tab stop")
})

await on(
  "error-summary",
  "demo-error-summary",
  "lt-error-summary",
  async (page, id) => {
    const result = await page.evaluate((id) => {
      const root = document.getElementById(id)?.shadowRoot
      const box = root?.querySelector("lt-error-summary")
      ;(root?.querySelector("li a") as HTMLElement | undefined)?.click()
      return {
        hasClass: box?.classList.contains("lt-error-summary") ?? false,
        role: box?.getAttribute("role") ?? "",
        title: (
          root?.querySelector(".lt-error-summary__title")?.textContent ?? ""
        ).trim(),
        focus: (root?.activeElement as HTMLElement | null)?.id ?? "",
      }
    }, id)

    expect(result.hasClass, "the box lacks the class from the server")
    expect(result.role === "alert", "the box is not an alert")
    expect(result.title.length > 0, "the heading is empty")
    expect(
      result.focus === "demo-fixer",
      `a link gave focus to "${result.focus}", expected the field`,
    )
  },
)

await on("suggestion", "demo-suggestion", "lt-suggestion", async (page, id) => {
  const result = await page.evaluate((id) => {
    const root = document.getElementById(id)?.shadowRoot
    const field = root?.querySelector("input") as HTMLInputElement | null
    if (field) {
      field.value = "lo"
      field.dispatchEvent(new Event("input", { bubbles: true }))
    }
    const options = [...(root?.querySelectorAll("[role='option']") ?? [])]
    return {
      hasField: Boolean(field),
      name: field?.name ?? "",
      open: field?.getAttribute("aria-expanded") ?? "",
      matches: options.filter((o) => !(o as HTMLElement).hidden).length,
      all: options.length,
      status: (
        root?.querySelector("[role='status']")?.textContent ?? ""
      ).trim(),
    }
  }, id)

  // A real field with a name is the whole point: without it nothing is
  // included in the submission before the script has run.
  expect(result.hasField, "the demo has no input field")
  expect(result.name.length > 0, "the field lacks name and is not submitted")
  expect(result.all > 1, "the list has no options from the server")
  expect(result.open === "true", "the list does not open when the user types")
  expect(result.matches < result.all, "the filtering does not narrow the list")
  expect(
    result.status.length > 0,
    "the number of matches is not announced to screen readers",
  )
})

await on("popover", "demo-popover", "lt-popover", async (page, id) => {
  const result = await page.evaluate((id) => {
    const root = document.getElementById(id)?.shadowRoot
    // The parts are looked up the way the component itself does it: the
    // panel is the one with `popover`, and the button is the one that points
    // to the panel.
    const panel = root?.querySelector("[popover]") as HTMLElement | null
    const trigger = panel?.id
      ? (root?.querySelector(
          `[aria-controls="${panel.id}"]`,
        ) as HTMLElement | null)
      : null
    trigger?.click()
    return {
      open: trigger?.getAttribute("aria-expanded") ?? "",
      visible: panel?.matches(":popover-open") ?? false,
      wired: Boolean(trigger?.getAttribute("aria-controls")),
    }
  }, id)

  expect(result.wired, "the button is not wired to the panel")
  expect(result.open === "true", "a click does not open the panel")
  expect(result.visible, "the panel does not end up in the top layer")
})

await on("dialog", "demo-dialog", "lt-dialog", async (page, id) => {
  const result = await page.evaluate((id) => {
    const root = document.getElementById(id)?.shadowRoot
    const button = root?.querySelector("[data-open]") as HTMLElement | null
    const dialog = root?.querySelector("dialog") as HTMLDialogElement | null
    button?.click()
    return {
      // `:modal` and not `open`: a `<dialog open>` looks the same, but does
      // not trap focus and does not close on Escape.
      modal: dialog?.matches(":modal") ?? false,
      focusInside: dialog?.contains(root?.activeElement ?? null) ?? false,
    }
  }, id)

  expect(result.modal, "a click does not open the dialog as a modal")
  expect(result.focusInside, "focus does not end up inside the dialog")
})

await on("field", "demo-field", "lt-field", async (page, id) => {
  const result = await page.evaluate((id) => {
    const root = document.getElementById(id)?.shadowRoot
    const field = root?.querySelector("input") as HTMLInputElement | null
    const label = root?.querySelector("label") as HTMLLabelElement | null
    return {
      wired: Boolean(label?.htmlFor) && label?.htmlFor === field?.id,
      described: Boolean(field?.getAttribute("aria-describedby")),
      hasClass: label?.classList.contains("lt-label") ?? false,
    }
  }, id)

  expect(result.wired, "the label does not point to the field")
  expect(result.described, "the help text is not wired to the field")
  expect(result.hasClass, "the label lacks lt-label")
})

await on("toast", "demo-toast", "lt-toast", async (page, id) => {
  const result = await page.evaluate((id) => {
    const root = document.getElementById(id)?.shadowRoot
    ;(root?.getElementById("demo-toast-button") as HTMLElement | null)?.click()
    const region = root?.querySelector("lt-toast")
    return {
      role: region?.getAttribute("role") ?? "",
      messages: root?.querySelectorAll(".lt-toast__message").length ?? 0,
      closeButtons: root?.querySelectorAll(".lt-toast__close").length ?? 0,
    }
  }, id)

  expect(result.role === "status", "the region is not a status region")
  expect(result.messages === 1, `a click gave ${result.messages} messages`)
  expect(result.closeButtons === 1, "the message has no close button")
  await visibleInBox(page, id, ".lt-toast__message")
})

await on(
  "connection-status",
  "demo-connection",
  "lt-connection-status",
  async (page, id) => {
    await page.evaluate((id) => {
      const root = document.getElementById(id)?.shadowRoot
      ;(
        root?.getElementById("demo-connection-off") as HTMLElement | null
      )?.click()
    }, id)
    // The bar is inserted empty and filled on the next frame, so the live
    // region exists before the content arrives. Wait for the text, not the
    // clock.
    await page.waitForFunction(
      (id) =>
        (
          document
            .getElementById(id)
            ?.shadowRoot?.querySelector(".lt-connection-status__bar")
            ?.textContent ?? ""
        ).trim().length > 0,
      id,
      { timeout: 2000 },
    )
    const result = await page.evaluate((id) => {
      const root = document.getElementById(id)?.shadowRoot
      const bar = root?.querySelector(".lt-connection-status__bar")
      // The host is the live region, so it exists before the bar arrives.
      const host = bar?.closest("lt-connection-status")
      return {
        text: (bar?.textContent ?? "").trim(),
        state: (bar as HTMLElement | null)?.dataset.state ?? "",
        role: host?.getAttribute("role") ?? "",
      }
    }, id)

    expect(result.text.length > 0, "the bar says nothing")
    expect(
      result.state === "offline",
      "the bar does not report that the connection is down",
    )
    expect(result.role === "status", "the component is not a status region")
    await visibleInBox(page, id, ".lt-connection-status__bar")
  },
)

await on(
  "session-timeout",
  "demo-session",
  "lt-session-timeout",
  async (page, id) => {
    // The demo warns after five seconds. Here we wait for the dialog to
    // actually open, not for the clock: a fixed pause would fail at random,
    // and a gate that fails at random gets ignored.
    await page.waitForFunction(
      (id) =>
        (
          document
            .getElementById(id)
            ?.shadowRoot?.querySelector("dialog") as HTMLDialogElement | null
        )?.open === true,
      id,
      { timeout: 15000 },
    )

    const result = await page.evaluate((id) => {
      const root = document.getElementById(id)?.shadowRoot
      const dialog = root?.querySelector("dialog")
      return {
        role: dialog?.getAttribute("role") ?? "",
        countdown: (
          root?.querySelector(".lt-session-timeout__count")?.textContent ?? ""
        ).trim(),
        hiddenFromScreenReader:
          root
            ?.querySelector(".lt-session-timeout__count")
            ?.getAttribute("aria-hidden") ?? "",
        buttons: root?.querySelectorAll(".lt-session-timeout__actions button")
          .length,
      }
    }, id)

    expect(result.role === "alertdialog", "the dialog is not an alertdialog")
    expect(
      /^\d+:\d\d$/.test(result.countdown),
      "the countdown does not show a time",
    )
    expect(
      result.hiddenFromScreenReader === "true",
      "the number is read out every second",
    )
    expect(
      result.buttons === 2,
      `the dialog has ${result.buttons} buttons, expected 2`,
    )
  },
)

/*
 * The select is a CSS component, and has neither a shadow root nor a web
 * component to look up. It still has something that can stop working:
 * `data-picker="styled"` asks the browser to draw the list inside the page,
 * and it is drawn in the top layer, not inside the preview. Without this
 * test, a demo that opens without colours would have reported green.
 */
current = "select"
await page.goto(`http://127.0.0.1:${PORT}/components/select/`, {
  waitUntil: "networkidle",
})

const styled = await page.evaluate(async () => {
  const host = [...document.querySelectorAll("*")].find((element) =>
    element.shadowRoot?.querySelector('select[data-picker="styled"]'),
  )
  const field = host?.shadowRoot?.querySelector(
    'select[data-picker="styled"]',
  ) as HTMLSelectElement | undefined

  if (!field) return { exists: false }

  field.focus()
  field.showPicker()

  // Wait for the list to actually fade in, not for the clock. The transition
  // lasts 120 milliseconds, and a fixed pause would fail at random on a slow
  // run.
  for (let attempt = 0; attempt < 90; attempt++) {
    if (getComputedStyle(field, "::picker(select)").opacity === "1") break
    await new Promise((done) => requestAnimationFrame(done))
  }

  const list = getComputedStyle(field, "::picker(select)")
  const option = field.querySelector("option")

  return {
    exists: true,
    appearance: getComputedStyle(field).appearance,
    open: field.matches(":open"),
    surface: list.backgroundColor,
    height: Number.parseFloat(list.blockSize),
    optionPadding: option ? getComputedStyle(option).padding : "",
  }
})

expect(styled.exists, 'found no demo with data-picker="styled"')

// The rest only repeats "undefined" when the demo does not exist.
if (styled.exists) {
  expect(
    styled.appearance === "base-select",
    `the field is drawn as ${styled.appearance}`,
  )
  expect(styled.open === true, "the list did not open")
  expect(
    styled.surface === "rgb(255, 255, 255)",
    `the list has the surface ${styled.surface}`,
  )
  expect((styled.height ?? 0) > 40, `the list is ${styled.height} pixels high`)
  expect(
    styled.optionPadding === "8px 12px",
    `an option has ${styled.optionPadding}`,
  )
}

await browser.close()
server.stop()

if (errors.length > 0) {
  console.error(
    `The previews on the component pages do not work as they should:\n\n${errors
      .map((line) => `  ${line}`)
      .join("\n")}\n`,
  )
  process.exit(1)
}

console.log("The previews on the component pages do what they say.")
