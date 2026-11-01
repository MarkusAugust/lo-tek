/// <reference path="./types/css.d.ts" />

import preflightSource from "tailwindcss/preflight.css?inline"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import buttonSource from "./components/css/button/button.css?inline"
import listSource from "./components/css/list/list.css?inline"
import tokenSource from "./tokens/tokens.css?inline"

import "./tokens/tokens.css"
import "./components/css/button/button.css"
import "./components/css/input/input.css"

/**
 * A consumer is actually allowed to customise the system.
 *
 * This is a promise to the people who use the package, and it is easy to
 * break without noticing: if someone adds a more specific selector, or takes
 * a value out of a variable, the option disappears silently. The test keeps
 * the three ways open.
 */

/** Adds CSS as if it came from the consumer's own stylesheet. */
function apply(css: string): void {
  const style = document.createElement("style")
  style.dataset.consumer = ""
  style.textContent = css
  document.head.append(style)
}

describe("a consumer can customise the system", () => {
  beforeEach(() => {
    // The stylesheets end up in <head> and otherwise survive into the next test
    for (const style of document.querySelectorAll("style[data-consumer]")) {
      style.remove()
    }
    document.documentElement.removeAttribute("data-theme")
    document.body.innerHTML = `
      <button class="lt-button">Button</button>
      <input class="lt-input" />
    `
  })

  it("can set a component variable without any selector", () => {
    apply(":root { --lt-button-radius: 9999px; }")

    const button = document.querySelector(".lt-button") as HTMLElement
    expect(getComputedStyle(button).borderRadius).toBe("9999px")

    // The variable belongs to the component: input must not be affected
    const input = document.querySelector(".lt-input") as HTMLElement
    expect(getComputedStyle(input).borderRadius).not.toBe("9999px")
  })

  it("falls back to the token value when the variable is not set", () => {
    // The default must follow the --lt-spacing scale, not be baked in.
    // That is why @property is not used here: a registered initial-value
    // makes the var() fallback unreachable.
    apply(":root { --lt-spacing-1: 20px; }")

    const button = document.querySelector(".lt-button") as HTMLElement
    expect(getComputedStyle(button).borderRadius).toBe("20px")
  })

  it("can override a rule the system has not exposed, with low specificity", () => {
    document.body.innerHTML = '<button class="lt-button" disabled>Off</button>'

    // The system's rule is .lt-button:disabled, that is 0,2,0. The consumer's
    // is 0,1,0 and would lose without @layer, whatever the order. This is
    // exactly what the layer is for.
    apply(".lt-button { background: rgb(1, 2, 3); }")

    const button = document.querySelector(".lt-button") as HTMLElement
    expect(getComputedStyle(button).backgroundColor).toBe("rgb(1, 2, 3)")
  })

  it("can override a token, also in the dark theme via the system setting", () => {
    apply(":root { --lt-color-accent-fill: rgb(124, 58, 237); }")
    document.documentElement.setAttribute("data-theme", "dark")

    const button = document.querySelector(".lt-button") as HTMLElement
    expect(getComputedStyle(button).backgroundColor).toBe("rgb(124, 58, 237)")
  })
})

/**
 * LO-TEK and Tailwind can live in the same app without fighting.
 *
 * Layers count in the order they are first named, and the last layer wins
 * whatever the specificity. Tailwind's Preflight is in `base`, and resets,
 * among other things, the background on `button` and the markers on `ul` and
 * `ol`. If `base` ends up after `lotek`, our button colour disappears without
 * anything saying so.
 *
 * The order cannot be changed once a layer has been named, so each variant
 * is checked in its own document.
 */
async function withStylesheet(
  css: string,
  markup = '<button class="lt-button" id="button">Order the job</button>',
): Promise<Document> {
  const frame = document.createElement("iframe")
  frame.style.width = "400px"
  frame.style.height = "200px"
  document.body.append(frame)

  const doc = frame.contentDocument as Document
  doc.open()
  doc.write(`<!doctype html><html><head><style>${css}</style></head>
    <body>${markup}</body></html>`)
  doc.close()

  await new Promise((resolve) => requestAnimationFrame(resolve))
  return doc
}

/** The style an element in the document actually gets. */
function style(doc: Document, id: string): CSSStyleDeclaration {
  const element = doc.getElementById(id) as HTMLElement
  return (doc.defaultView as Window).getComputedStyle(element)
}

/**
 * Tailwind's own Preflight, in the layer `@import "tailwindcss"` puts it in.
 *
 * The test had a handwritten version with only the button rules, and so it
 * never saw that Preflight also sets `list-style: none` on every list, which
 * took the markers from `.lt-list`. The whole file, so what is reset is what
 * the consumer gets.
 */
const PREFLIGHT = `@layer base { ${preflightSource} }`

/** The order the documentation asks the consumer to put on the first line. */
const LAYER_LINE =
  "@layer theme, base, lotek, lotek-theme, components, utilities;"

/**
 * An excerpt of what `lotek theme` writes: a colour, the font and the shape,
 * in `:root` in the theme's own layer. The colour is there because tokens.css
 * sets it in `:root` in `lotek`; only a token that exists there can show that
 * the theme beats it. The theme only declares its own layer after `lotek`,
 * and cannot know which layers the app has declared already.
 */
const THEME = `
  @layer lotek, lotek-theme;
  @layer lotek-theme {
    :root {
      --lt-color-accent-fill: rgb(0, 100, 0);
      --lt-font-family-base: Georgia, serif;
      --lt-button-radius: 2.75rem;
    }
    :root {
      font-family: var(--lt-font-family-base);
    }
  }`

/**
 * What Tailwind makes of `p-4` with our theme: `--spacing` is
 * `--lt-spacing-1`, and `check-tailwind.ts` checks with a real Tailwind that
 * the class contains exactly this calculation.
 */
const P4 =
  "@layer utilities { .p-4 { padding: calc(var(--lt-spacing-1) * 4); } }"

describe("together with Tailwind", () => {
  afterEach(() => {
    // The frames must go. If they stay, focus can end up in them, and the
    // tests that check focus further down the suite check the wrong document.
    for (const frame of document.querySelectorAll("iframe")) frame.remove()
  })

  it("keeps the button colour when lotek comes after base", async () => {
    const doc = await withStylesheet(`
      ${LAYER_LINE}
      ${tokenSource}
      ${buttonSource}
      ${PREFLIGHT}
    `)

    expect(style(doc, "button").backgroundColor).not.toBe("rgba(0, 0, 0, 0)")
  })

  it("loses the button colour without the order, which is why the line is in the documentation", async () => {
    const doc = await withStylesheet(`
      ${tokenSource}
      ${buttonSource}
      ${PREFLIGHT}
    `)

    // `base` is named after `lotek` here, and so wins.
    expect(style(doc, "button").backgroundColor).toBe("rgba(0, 0, 0, 0)")
  })

  it("keeps the bullets and numbers in the list when Preflight is in base", async () => {
    // Preflight sets `list-style: none` on every list. The default variant
    // said nothing about the markers and relied on the browser, so Preflight
    // won even though `base` came before `lotek`, and the list lost its
    // bullets and numbering. The variants without markers must still have none.
    const doc = await withStylesheet(
      `
      ${LAYER_LINE}
      ${tokenSource}
      ${listSource}
      ${PREFLIGHT}
    `,
      `<ul class="lt-list" id="bullets"><li>Floor plans</li></ul>
       <ol class="lt-list" id="numbers"><li>State the objective</li></ol>
       <ul class="lt-list" data-variant="plain" id="plain"><li>Ordered</li></ul>`,
    )

    expect(style(doc, "bullets").listStyleType).toBe("disc")
    expect(style(doc, "numbers").listStyleType).toBe("decimal")
    expect(style(doc, "plain").listStyleType).toBe("none")
  })

  it("lets a Tailwind utility beat the component's own value", async () => {
    const doc = await withStylesheet(`
      ${LAYER_LINE}
      ${tokenSource}
      ${buttonSource}
      @layer utilities { .p-6 { padding: 1.5rem; } }
    `)

    const button = doc.getElementById("button") as HTMLElement
    button.classList.add("p-6")

    expect(style(doc, "button").padding).toBe("24px")
  })

  it("lets the component beat the utility class when lotek comes after utilities, which is why the line is in the documentation", async () => {
    const doc = await withStylesheet(`
      @layer utilities { .p-6 { padding: 1.5rem; } }
      ${tokenSource}
      ${buttonSource}
    `)

    const button = doc.getElementById("button") as HTMLElement
    button.classList.add("p-6")

    // `utilities` is named before `lotek` here, so the component's own
    // padding wins, and the class does nothing.
    expect(style(doc, "button").padding).toBe("8px 16px")
  })

  it("lets a generated theme win over tokens.css, and a utility win over the theme", async () => {
    const doc = await withStylesheet(`
      ${LAYER_LINE}
      ${tokenSource}
      ${buttonSource}
      ${THEME}
      @layer utilities { .font-mono { font-family: monospace; } }
    `)
    doc.documentElement.classList.add("font-mono")

    // The theme comes after `lotek` and beats the colour tokens.css sets in
    // `:root`. The shape is no test of that: tokens.css sets no
    // `--lt-button-radius`, so it would have won whatever the order.
    expect(style(doc, "button").backgroundColor).toBe("rgb(0, 100, 0)")
    // `lotek-theme` comes before `utilities`, so the class beats the theme's rule.
    expect(
      doc.defaultView?.getComputedStyle(doc.documentElement).fontFamily,
    ).toBe("monospace")
  })

  it("lets the theme beat the utility classes when the theme layer is missing from the line, which is why it is there", async () => {
    const doc = await withStylesheet(`
      @layer theme, base, lotek, components, utilities;
      ${tokenSource}
      ${buttonSource}
      ${THEME}
      @layer utilities { .font-mono { font-family: monospace; } }
    `)
    doc.documentElement.classList.add("font-mono")

    // The theme's `@layer lotek, lotek-theme;` only creates layers that do
    // not exist, so `lotek-theme` ends up last, after `utilities`.
    expect(
      doc.defaultView?.getComputedStyle(doc.documentElement).fontFamily,
    ).toBe("Georgia, serif")
  })

  it("gives p-4 the same spacing as --lt-spacing-4 when the whole scale is rewritten", async () => {
    const markup = `
      <div class="p-4" id="class"></div>
      <div style="padding: var(--lt-spacing-4)" id="step"></div>
      <button class="lt-button" id="button">Order the job</button>`

    // The whole scale, as the documentation shows it: every step is
    // rewritten, because the steps are values of their own and are not
    // computed from the unit.
    const whole = await withStylesheet(
      `
      ${LAYER_LINE}
      ${tokenSource}
      ${buttonSource}
      ${P4}
      :root {
        --lt-spacing-0-5: 0.15rem;
        --lt-spacing-1: 0.3rem;
        --lt-spacing-2: 0.6rem;
        --lt-spacing-3: 0.9rem;
        --lt-spacing-4: 1.2rem;
        --lt-spacing-5: 1.5rem;
        --lt-spacing-6: 1.8rem;
        --lt-spacing-7: 2.1rem;
        --lt-spacing-8: 2.4rem;
        --lt-spacing-10: 3rem;
        --lt-spacing-12: 3.6rem;
        --lt-spacing-16: 4.8rem;
      }
    `,
      markup,
    )
    // The numbers, not the strings: WebKit computes `calc(0.3rem * 4)` in
    // single precision and answers "19.200001px" where the others answer
    // "19.2px".
    const padding = (doc: Document, id: string, ...expected: number[]) => {
      const numbers = style(doc, id).padding.split(" ").map(Number.parseFloat)
      expect(numbers).toHaveLength(expected.length)
      for (const [i, value] of numbers.entries()) {
        expect(value).toBeCloseTo(expected[i], 3)
      }
    }
    padding(whole, "class", 19.2)
    padding(whole, "step", 19.2)
    padding(whole, "button", 9.6, 19.2)

    // If only the unit is rewritten, the classes follow, but not the steps,
    // and so not the components. That is why the documentation asks for the
    // whole scale.
    const onlyUnit = await withStylesheet(
      `
      ${LAYER_LINE}
      ${tokenSource}
      ${buttonSource}
      ${P4}
      :root { --lt-spacing-1: 0.3rem; }
    `,
      markup,
    )
    padding(onlyUnit, "class", 19.2)
    padding(onlyUnit, "step", 16)
    padding(onlyUnit, "button", 8, 16)
  })
})
