/**
 * What a reviewer found by driving the theme builder in a browser, each
 * held so it stays found.
 *
 * The other checks of the builder hold what it was specified to do. These
 * are the things nobody specified, because nobody had met them: none shows
 * when the page is used with a mouse, on a good day.
 *
 * - The keyboard has a way past the two frames, which hold more than two
 *   hundred stops between the choice of what is framed and the recipe.
 * - A colour family is a group named for the family, with its switch, its
 *   picker, its field and the button that resets it, and nothing else, so
 *   the switch is tied to what it enables.
 * - The recipe and the command, which take focus so they can be scrolled,
 *   are regions with a name.
 * - A pasted recipe the core refuses for a value that is not text changes
 *   nothing and says why, rather than emptying the form without a word.
 * - "Copied." is said when the clipboard has taken the recipe, and not
 *   when it refused.
 * - The report has no row for a family that is no longer in the recipe.
 * - When the generator does not arrive, the page says so.
 *
 * And the reason the core refuses a square bracket that is not closed is put
 * on record, in the browser the reviewer saw it in.
 *
 * Run with: bun documentation/scripts/check-theme-review.ts
 * Requires `documentation/dist` to be built.
 */

import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { site } from "./site"
import {
  fieldOn,
  framesHold,
  framesHoldNow,
  ownOn,
  untilOn,
} from "./theme-page"
import { FAMILIES } from "./theme-recipe"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

if (!existsSync(`${ROOT}documentation/dist/theme-builder/index.html`)) {
  console.error(
    "✗ dist/theme-builder/index.html is not built. The site is built with bun run build.",
  )
  process.exit(1)
}

const { buildTheme } = (await import(
  `${ROOT}interfaces/dist/tokens/theme.js`
)) as {
  buildTheme(recipe: unknown): {
    css: string
    brands: { given: string; light: { fill: string }; dark: { fill: string } }[]
  }
}

/** What the core answers for a recipe, or nothing when it takes it. */
function refusal(recipe: unknown): string | null {
  try {
    buildTheme(recipe)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/*
 * Pasted recipes with something that is not text where a value belongs,
 * which the core refuses. The check asks the core, so a value the core
 * comes to take is a case that says so rather than one that passes.
 */
const NOT_TEXT: unknown[] = [
  { accent: true },
  { brand1: ["#fff"] },
  { danger: { fill: "#b91c1c" } },
  // Also where the value is in a block.
  { typography: { weights: { bold: true } } },
  { typography: { fontFamily: ["x"] } },
]
for (const recipe of NOT_TEXT)
  if (refusal(recipe) === null) {
    console.error(
      `✗ The core takes ${JSON.stringify(recipe)}, so it is not a refused recipe. The check is older than the core.`,
    )
    process.exit(1)
  }

const s = await site({ pages: 1 })
const page = s.page
const expect = (claim: boolean, description: string) => {
  if (!claim) s.fail(description)
}
await page.context().grantPermissions(["clipboard-read", "clipboard-write"])

const own = ownOn(page)
const field = fieldOn(page)
const button = (name: string) => page.getByRole("button", { name, exact: true })
const area = page
  .getByRole("textbox", { name: /recipe/i })
  .and(page.locator("textarea"))

/** Runs in the builder. What the checks below ask about. */
function read(families: string[]) {
  const collapsed = (text: string) => text.replace(/\s+/g, " ").trim()
  const control = (name: string) =>
    document.querySelector<HTMLInputElement>(`[name="${name}"]`)
  const named = (element: Element | null) =>
    collapsed(
      element?.getAttribute("aria-label") ??
        (element?.getAttribute("aria-labelledby") ?? "")
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" "),
    )
  const textarea = document.querySelector("textarea")
  return {
    form: Object.fromEntries(
      families.map((family) => [
        family,
        `${control(`own.${family}`)?.checked ? "on" : "off"} ${control(family)?.value ?? "(no field)"}`,
      ]),
    ),
    rows: [
      ...document.querySelectorAll<HTMLElement>(
        // The rows of the report: the suggestions under the accent have a
        // place for each family too, and are another matter.
        "[data-family]:not(details[data-palettes] *)",
      ),
    ]
      .filter((row) => row.getClientRects().length > 0)
      .map((row) => row.dataset.family ?? ""),
    /** What each row that can be seen says, and what each picker shows. */
    said: Object.fromEntries(
      [
        ...document.querySelectorAll<HTMLElement>(
          // The rows of the report: the suggestions under the accent have a
          // place for each family too, and are another matter.
          "[data-family]:not(details[data-palettes] *)",
        ),
      ]
        .filter((row) => row.getClientRects().length > 0)
        .map((row) => [
          row.dataset.family ?? "",
          collapsed(row.textContent ?? "").toLowerCase(),
        ]),
    ),
    pickers: Object.fromEntries(
      families.map((family) => [
        family,
        control(family)
          ?.closest('fieldset, [role="group"]')
          ?.querySelector<HTMLInputElement>('input[type="color"]')
          ?.value.toLowerCase() ?? "",
      ]),
    ),
    told: (textarea?.getAttribute("aria-describedby") ?? "")
      .split(/\s+/)
      .map((id) => (id ? document.getElementById(id) : null))
      .filter((text) => text && text.getClientRects().length > 0)
      .map((text) => collapsed(text?.textContent ?? ""))
      .join(" "),
    statuses: [...document.querySelectorAll('[role="status"], [role="alert"]')]
      .filter((status) => status.getClientRects().length > 0)
      .map((status) => collapsed(status.textContent ?? ""))
      .filter((text) => text !== ""),
    recipe: document.querySelector("[data-recipe]")?.textContent ?? "",
    /** The blocks of code that take focus: their role and their name. */
    blocks: [...document.querySelectorAll("pre[tabindex]")].map((pre) => ({
      role: pre.getAttribute("role") ?? "",
      name: named(pre),
      text: collapsed(pre.textContent ?? "").slice(0, 40),
    })),
    /** The group each family's field is in, and the controls in it. */
    groups: Object.fromEntries(
      families.map((family) => {
        const group = control(family)?.closest('fieldset, [role="group"]')
        const name =
          named(group ?? null) ||
          collapsed(group?.querySelector("legend")?.textContent ?? "")
        return [
          family,
          {
            name,
            controls: [
              ...(group?.querySelectorAll("input, select, textarea, button") ??
                []),
            ]
              // The suggestions stand in the accent's group and have
              // buttons of their own, held by `check-theme-palettes.ts`.
              .filter((c) => c.closest("details[data-palettes]") === null)
              .map((c) =>
                // A button is told by what it is called, and of that the
                // first word: the rest names the family.
                c.tagName === "BUTTON"
                  ? `button "${collapsed(c.getAttribute("aria-label") ?? c.textContent ?? "").split(" ")[0]}"`
                  : (c.getAttribute("name") ??
                    `${c.tagName.toLowerCase()}[type=${c.getAttribute("type")}]`),
              ),
          },
        ]
      }),
    ),
  }
}
const now = () => page.evaluate(read, FAMILIES)
type State = Awaited<ReturnType<typeof now>>
const until = (done: (state: State) => boolean): Promise<State> =>
  untilOn(page, now, done)
const paste = async (recipe: unknown) => {
  await area.fill(JSON.stringify(recipe))
  await button("Use this recipe").click()
}

let points = 0

const code = await s.run(async () => {
  await s.open("/theme-builder/")
  const start = await now()

  /*
   * The groups: a family is one thing with three controls, and a screen
   * reader that lands on the field is told which family it is in.
   */
  for (const family of FAMILIES) {
    const group = start.groups[family]
    expect(
      new RegExp(`\\b${family}\\b`, "i").test(group.name),
      `the controls of ${family} are in no group named for the family: the nearest is called "${group.name}"`,
    )
    expect(
      JSON.stringify([...group.controls].sort()) ===
        JSON.stringify(
          [
            family,
            "input[type=color]",
            `own.${family}`,
            'button "Reset"',
          ].sort(),
        ),
      `the group of ${family} holds ${group.controls.join(", ") || "nothing"}, not its switch, its picker, its field and the button that resets it`,
    )
  }
  points += 1

  /*
   * The blocks of code: regions with a name that says which is which.
   * That they have a role at all is held by `check-accessibility.ts`, for
   * these as for every code block of the documentation.
   */
  expect(
    start.blocks.length === 3,
    `the page has ${start.blocks.length} blocks of code that take focus, not the recipe, the command and the loading of the theme`,
  )
  for (const [what, wanted] of [
    ["recipe", /recipe/i],
    ["command", /command/i],
    ["loading of the theme", /\bloads?\b|\buses?\b|\busing\b|\bloading\b/i],
  ] as const)
    expect(
      start.blocks.some((b) => b.role === "region" && wanted.test(b.name)),
      `no block of code is a region named for the ${what}: ${start.blocks.map((b) => `${b.role || "no role"} "${b.name}"`).join(", ")}`,
    )
  points += 1

  /*
   * Past the frames by keyboard. From the choice of what is framed, the next
   * stop is a link that says it leads past them, and from where it leads
   * "Copy the recipe" is a few stops away, not two hundred.
   */
  await own("accent").check()
  await field("accent").fill("#7c3aed")
  await until((state) => state.rows.includes("accent"))
  await page.locator('input[type="radio"][name="view"]:checked').focus()
  await page.keyboard.press("Tab")
  const link = await page.evaluate(() => {
    const active = document.activeElement
    const frame = document.querySelector("iframe")
    return {
      tag: active?.tagName ?? "",
      href: active?.getAttribute("href") ?? "",
      name: (active?.getAttribute("aria-label") ?? active?.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim(),
      before:
        active && frame
          ? Boolean(
              active.compareDocumentPosition(frame) &
                Node.DOCUMENT_POSITION_FOLLOWING,
            )
          : false,
    }
  })
  expect(
    link.tag === "A" && link.href.startsWith("#") && link.before,
    `the stop after the choice of what is framed is ${link.tag.toLowerCase() || "nothing"} "${link.name}", not a link before the frames that leads past them`,
  )
  expect(
    /skip|past/i.test(link.name),
    `the link before the frames is called "${link.name}", which does not say it leads past them`,
  )
  let stops = 0
  if (link.tag === "A" && link.href.startsWith("#")) {
    await page.keyboard.press("Enter")
    const onCopy = () =>
      page.evaluate(
        () =>
          (document.activeElement?.textContent ?? "")
            .replace(/\s+/g, " ")
            .trim() === "Copy the recipe",
      )
    while (stops < 6 && !(await onCopy())) {
      await page.keyboard.press("Tab")
      stops += 1
    }
    expect(
      await onCopy(),
      `"Copy the recipe" is not reached within six stops after the link past the frames is followed`,
    )
  }
  points += 1

  /*
   * A paste the core refuses for a value that is not text: nothing changes,
   * and the paste field holds the core's answer.
   */
  const before = (await now()).form
  for (const recipe of NOT_TEXT) {
    const message = refusal(recipe) ?? ""
    await paste(recipe)
    const after = await until((state) => state.told.includes(message))
    expect(
      JSON.stringify(after.form) === JSON.stringify(before),
      `pasting ${JSON.stringify(recipe)} changed the form: ${JSON.stringify(after.form)}`,
    )
    expect(
      after.told.includes(message),
      `pasting ${JSON.stringify(recipe)}: the paste field is told ${JSON.stringify(after.told)}, and the core says ${JSON.stringify(message)}`,
    )
    // Whatever the value is, the reader is told what one must be.
    expect(
      /text or a number/i.test(after.told),
      `pasting ${JSON.stringify(recipe)}: the paste field does not say that a value must be text or a number: ${JSON.stringify(after.told)}`,
    )
    points += 1
  }
  // `null` is a value that is not given, and the recipe is taken.
  await paste({ accent: null, danger: "#b91c1c" })
  const withNull = await until((state) => state.form.danger === "on #b91c1c")
  expect(
    withNull.form.danger === "on #b91c1c" &&
      withNull.form.accent.startsWith("off"),
    `a recipe with a colour that is null is not taken with that colour not given: accent is ${withNull.form.accent}, danger ${withNull.form.danger}`,
  )
  points += 1

  /*
   * "Copied." is true. A clipboard that is slow is not yet a copy, and one
   * that refuses is none.
   */
  const replaceClipboard = (how: "slow" | "refuses") =>
    page.evaluate((how) => {
      Object.defineProperty(navigator.clipboard, "writeText", {
        configurable: true,
        value: () =>
          new Promise<void>((resolve, reject) =>
            how === "slow"
              ? setTimeout(resolve, 800)
              : reject(
                  new DOMException(
                    "Write permission denied.",
                    "NotAllowedError",
                  ),
                ),
          ),
      })
    }, how)
  const saysCopied = (state: State) =>
    state.statuses.some((status) => /^copied/i.test(status))
  await replaceClipboard("slow")
  await button("Copy the recipe").click()
  await page.waitForTimeout(250)
  expect(
    !saysCopied(await now()),
    "the page says the recipe is copied before the clipboard has taken it",
  )
  expect(
    saysCopied(await until(saysCopied)),
    "the page does not say the recipe is copied once the clipboard has taken it",
  )
  // Another recipe, so the status is about this copy and not the last one.
  await field("danger").fill("#9f1239")
  await until((state) => state.recipe.includes("#9f1239") && !saysCopied(state))
  await replaceClipboard("refuses")
  await button("Copy the recipe").click()
  const refused = await until((state) =>
    state.statuses.some((status) => /not|cannot/i.test(status)),
  )
  expect(
    !saysCopied(refused),
    "the page says the recipe is copied when the clipboard refused it",
  )
  expect(
    refused.statuses.some((status) => /not|cannot/i.test(status)),
    `the page does not say the recipe could not be copied: ${refused.statuses.join(" | ") || "it says nothing"}`,
  )
  // An error left uncaught in the page is a finding of the run itself.
  points += 1

  /*
   * The report has no row for a family that is out of the recipe. The
   * reviewer's steps, and then the other side: a family that is still in
   * the recipe keeps its row while another value is refused.
   */
  await button("Start again").click()
  await until((state) => state.rows.length === 0)
  await own("accent").check()
  await field("accent").fill("#ff0000")
  await own("danger").check()
  await field("danger").fill("bad")
  await until((state) => state.rows.includes("danger"))
  await own("accent").uncheck()
  await paste({ brand1: "zzz" })
  const left = await until(
    (state) => state.form.brand1 === "on zzz" && state.rows.length === 0,
  )
  expect(
    left.form.brand1 === "on zzz" && left.form.danger.startsWith("off"),
    `the reviewer's steps did not end with only brand1 given: ${JSON.stringify(left.form)}`,
  )
  expect(
    left.rows.length === 0,
    `the report still has rows for families that are off: ${left.rows.join(", ")}`,
  )
  await button("Start again").click()
  await own("accent").check()
  await field("accent").fill("#7c3aed")
  await until((state) => state.rows.includes("accent"))
  await own("danger").check()
  await field("danger").fill("purple")
  await page.waitForTimeout(500)
  const kept = await now()
  expect(
    JSON.stringify(kept.rows) === '["accent"]',
    `while another value is refused, the report has the rows ${kept.rows.join(", ") || "none"}, not the one family that is still in the recipe and was built`,
  )

  /*
   * And the row of a family is the row of what its field holds now. With
   * accent and danger both refused and accent then put right, the row and
   * the picker of accent showed the colour it had before, under a field
   * with another one in it, until danger was put right too. A family whose
   * own value the core takes has the row of that value, whatever else in
   * the recipe is refused; one whose value is refused has none. The frames
   * are another matter: they show a whole theme, and so the last that built.
   */
  await button("Start again").click()
  await own("accent").check()
  await field("accent").fill("#7c3aed")
  await own("danger").check()
  await field("danger").fill("#b3261e")
  const whole = buildTheme({ accent: "#7c3aed", danger: "#b3261e" }).css
  await framesHold(page, whole)
  await field("accent").fill("purple")
  await field("danger").fill("#b3261")
  await until((state) => state.rows.length === 0)
  await field("accent").fill("#00ff00")
  const [green] = buildTheme({ accent: "#00ff00" }).brands
  const fresh = await until(
    (state) =>
      (state.said.accent ?? "").includes(green.light.fill) &&
      state.pickers.accent === "#00ff00",
  )
  for (const hex of [green.given, green.light.fill, green.dark.fill])
    expect(
      (fresh.said.accent ?? "").includes(hex),
      `with danger refused and accent #00ff00, the row of accent does not say ${hex}: "${(fresh.said.accent ?? "there is no row").slice(0, 120)}"`,
    )
  expect(
    !(fresh.said.accent ?? "").includes("#7c3aed"),
    "with danger refused and accent #00ff00, the row of accent still shows the colour it had before",
  )
  expect(
    fresh.pickers.accent === "#00ff00",
    `with danger refused and accent #00ff00, the picker of accent shows ${fresh.pickers.accent}`,
  )
  expect(
    !fresh.rows.includes("danger"),
    "a family whose own value is refused has a row",
  )
  // Read once, now: a theme that was dropped and came back would pass a wait.
  expect(
    await framesHoldNow(page, whole),
    "while a value is refused, the frames do not hold the last theme that built as a whole",
  )
  points += 1

  /*
   * The generator does not arrive. Another browser context, so the failed
   * request, which the browser itself reports as an error, is not read as a
   * finding of the page: what the page throws is still counted.
   */
  const origin = new URL(page.url()).origin
  const browser = page.context().browser()
  if (!browser) throw new Error("the page has no browser")
  const context = await browser.newContext()
  try {
    const without = await context.newPage()
    const thrown: string[] = []
    without.on("pageerror", (error) => thrown.push(error.message))
    let refusedRequests = 0
    await without.route("**/*.wasm", (route) => {
      refusedRequests += 1
      return route.fulfill({ status: 503, body: "" })
    })
    await without.goto(`${origin}/theme-builder/`, { waitUntil: "networkidle" })
    let said: string[] = []
    for (let attempt = 0; attempt < 50; attempt++) {
      said = await without.evaluate(() =>
        [...document.querySelectorAll('[role="alert"], [role="status"]')]
          .filter((e) => e.getClientRects().length > 0)
          .map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim()),
      )
      if (said.some((text) => /could not be loaded/i.test(text))) break
      await without.waitForTimeout(100)
    }
    expect(
      refusedRequests > 0,
      "the page asked for no .wasm file, so the check did not make the generator fail",
    )
    expect(
      said.some(
        (text) => /could not be loaded/i.test(text) && /command/i.test(text),
      ),
      `without the generator the page does not say that it could not be loaded and that the command line builds the same theme: ${said.filter(Boolean).join(" | ") || "it says nothing"}`,
    )
    expect(
      thrown.length === 0,
      `without the generator the page throws: ${thrown.join(" | ")}`,
    )

    /*
     * In a wide window the message does not take a place in the layout: it,
     * the heading and the introduction are above the recipe and the
     * preview, and those two are beside each other, as when the generator
     * loads. The same is read on the page that has it, to compare with.
     */
    const laidOut = () => {
      const top = (element: Element | null | undefined) =>
        element ? Math.round(element.getBoundingClientRect().top) : Number.NaN
      const h1 = document.querySelector("h1")
      const recipe = document.querySelector('[name="own.accent"]')
      const preview = document.querySelector("iframe")
      const alert = [
        ...document.querySelectorAll('[role="alert"], [role="status"]'),
      ].find(
        (e) =>
          e.getClientRects().length > 0 &&
          /could not be loaded/i.test(e.textContent ?? ""),
      )
      return {
        alert: top(alert),
        h1: top(h1),
        // The introduction: the paragraph after the heading.
        intro: top(h1?.parentElement?.querySelector("p")),
        recipe: top(recipe),
        preview: top(preview),
        beside:
          (recipe?.getBoundingClientRect().right ?? 0) <=
            (preview?.getBoundingClientRect().left ?? 0) ||
          (preview?.getBoundingClientRect().right ?? 0) <=
            (recipe?.getBoundingClientRect().left ?? 0),
      }
    }
    await without.setViewportSize({ width: 1400, height: 900 })
    await without.waitForTimeout(300)
    const lacking = await without.evaluate(laidOut)
    for (const [what, at] of [
      ["the message", lacking.alert],
      ["the heading", lacking.h1],
      ["the introduction", lacking.intro],
    ] as const)
      expect(
        at < lacking.recipe && at < lacking.preview,
        `without the generator, in a wide window, ${what} is at ${at} and not above the recipe (${lacking.recipe}) and the preview (${lacking.preview})`,
      )
    expect(
      lacking.beside,
      "without the generator, in a wide window, the recipe is not beside the preview",
    )
    await page.setViewportSize({ width: 1400, height: 900 })
    await page.waitForTimeout(300)
    const whole = await page.evaluate(laidOut)
    expect(
      whole.beside && whole.h1 < whole.recipe && whole.h1 < whole.preview,
      "with the generator, in a wide window, the recipe is not beside the preview under the heading, so there is nothing to compare with",
    )

    /*
     * On record: why the core refuses `[`. The theme of the nearest recipe
     * the core takes, with the bracket written in where the core would have
     * written it. The declaration after the font is there without the
     * bracket and gone with it.
     */
    const neighbour = buildTheme({
      typography: { fontFamily: "Inter" },
      shape: { buttonRadius: "20px" },
    }).css
    const broken = neighbour.replace(
      "--lt-font-family-base: Inter;",
      "--lt-font-family-base: Inter [;",
    )
    const radius = async (css: string) => {
      const sheet = await context.newPage()
      await sheet.setContent(`<!doctype html><style>${css}</style>`)
      const value = await sheet.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--lt-button-radius")
          .trim(),
      )
      await sheet.close()
      return value
    }
    expect(broken !== neighbour, "the theme has no font declaration to break")
    expect(
      (await radius(neighbour)) === "20px",
      `the theme the core takes does not set the radius in a browser: "${await radius(neighbour)}"`,
    )
    expect(
      (await radius(broken)) === "",
      `a "[" that is not closed no longer swallows the declaration after it: the radius is "${await radius(broken)}". The reason the core refuses it is gone`,
    )
    points += 1
  } finally {
    await context.close()
  }
})

if (code !== 0) {
  console.error(
    "✗ What the reviewer found on the theme builder is there again, or the check did not get to look.",
  )
  process.exit(code)
}

// The guard comes last. Seven points of its own, and one for each pasted
// recipe that is not text: the groups, the blocks, the keyboard, the null,
// the copy, the report and the generator.
const POINTS = 7 + NOT_TEXT.length
if (points !== POINTS) {
  console.error(
    `✗ The check went through ${points} points where it has ${POINTS}. It has not looked at everything.`,
  )
  process.exit(1)
}

console.log(
  `✓ The theme builder has a way past its frames for the keyboard, groups and names for what it shows, says what a paste or the clipboard refused, reports only what is in the recipe, and says so when the generator is missing (${points} points).`,
)
