/**
 * That the composed page of the theme builder, `/theme-builder/page/`, is a
 * page a theme can be judged on.
 *
 * The component sheet shows the components one by one. This is the other
 * thing the builder frames: one real page, put together the way an
 * application's is, so a theme is seen as a whole. That only helps if the
 * page has on it what a theme decides the look of, and if it borrows nothing
 * a theme cannot reach.
 *
 * What every built page is already held to is not repeated here: `lotek
 * check` on the page as a page (`interfaces/scripts/check-rendered.ts`), axe
 * in both themes (`check-accessibility.ts`), a narrow screen
 * (`check-mobile.ts`) and a stylesheet for every class (`check-stylesheets.ts`).
 * This check holds what they do not:
 *
 * - it is a document of its own, and everything is in the document: a
 *   shadow root would hide markup from `lotek check`, which reads a page;
 * - the page skeleton, as the pattern page gives it: the skip link first,
 *   one `<main>` that takes focus, one `<h1>` in it, the landmarks, a name
 *   on every `<nav>`, and heading levels that do not skip;
 * - the things a theme matters most for are there, with the variants and
 *   the colours read from the manifest;
 * - every colour family is in use, in both themes, measured on the page:
 *   the tokens are read from the root element as the page has them, so the
 *   check holds whatever theme the page is given;
 * - the page writes no colour of its own.
 *
 * Run with: bun documentation/scripts/check-theme-page.ts
 * Requires `documentation/dist` to be built.
 */

import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { Glob } from "bun"
import { site } from "./site"
import { CONTRACT as contract } from "./theme-recipe"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const BUILT = `${ROOT}documentation/dist/theme-builder/page/index.html`
const SOURCES = `${ROOT}documentation/src/pages/theme-builder/`

const manifest = JSON.parse(
  readFileSync(`${ROOT}interfaces/manifest/manifest.json`, "utf8"),
) as {
  classes: Record<
    string,
    { attributes?: Record<string, { values?: string[]; default?: string }> }
  >
}

const problems: string[] = []

/** The values the manifest gives an attribute of a class, and its default. */
function values(className: string, attribute: string) {
  const found = manifest.classes[className]?.attributes?.[attribute]
  if (!found?.values?.length)
    problems.push(`the manifest gives ${className} no ${attribute}`)
  return { values: found?.values ?? [], byDefault: found?.default }
}
const variants = values("lt-button", "data-variant")
const alerts = values("lt-alert", "data-color")

/*
 * The tokens of each family, by name: one per role, and the two layers only
 * the neutral family has. The values are read in the page.
 */
const kebab = (role: string) =>
  role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
const tokens: Record<string, string[]> = Object.fromEntries(
  contract.families.map((family) => [
    family,
    [
      ...Object.keys(contract.roles),
      ...(family === "neutral" ? Object.keys(contract.layers) : []),
    ].map((role) => `--lt-color-${family}-${kebab(role)}`),
  ]),
)

/*
 * The one family that cannot be measured. A browser answers every question
 * about a visited link as if it were not visited, computed colour included,
 * so nobody can read a user's history off a page. The family is in use when
 * the page has a link in its text, which is held below, and no component
 * reads it for anything else.
 */
const NOT_MEASURABLE = ["visited"]
for (const family of NOT_MEASURABLE)
  if (!contract.families.includes(family))
    problems.push(`${family} is not a family in the colour contract`)

type Asked = {
  variants: string[]
  defaultVariant: string | undefined
  alerts: string[]
  tokens: Record<string, string[]>
}

/** Runs in the page. What the page lacks, and the colours of each family that are in use. */
function read({ variants, defaultVariant, alerts, tokens }: Asked) {
  const lacks: string[] = []
  const all = <E extends Element = HTMLElement>(selector: string) => [
    ...document.querySelectorAll<E>(selector),
  ]
  const need = (claim: boolean, what: string) => {
    if (!claim) lacks.push(what)
  }

  // A document where everything is in the document.
  need(
    !all("*").some((element) => element.shadowRoot) &&
      all("template[shadowrootmode]").length === 0,
    "the page has a shadow root. Everything stands in the document, where lotek check reads it",
  )

  // The page skeleton.
  const main = all("main")
  need(main.length === 1, `the page has ${main.length} <main>, not one`)
  const focusable = all(
    'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])',
  )[0]
  need(
    focusable?.matches("a.lt-skip-link") === true &&
      main[0]?.id !== "" &&
      focusable.getAttribute("href") === `#${main[0]?.id}`,
    "the skip link is not the first thing that takes focus, or does not lead to <main>",
  )
  need(
    main[0]?.getAttribute("tabindex") === "-1",
    '<main> has no tabindex="-1", so the skip link moves the view and not focus',
  )
  const h1 = all("h1")
  need(
    h1.length === 1 && main[0]?.contains(h1[0]) === true,
    `the page has ${h1.length} <h1>, not one inside <main>`,
  )
  const outside = (tag: string) =>
    all(tag).some((e) => !e.closest("main, article, section, aside, nav"))
  need(outside("header"), "the page has no <header> of its own")
  need(outside("footer"), "the page has no <footer> of its own")
  const navs = all("nav").map(
    (nav) =>
      nav.getAttribute("aria-label") ??
      document.getElementById(nav.getAttribute("aria-labelledby") ?? "")
        ?.textContent ??
      "",
  )
  need(navs.length > 0, "the page has no <nav>")
  need(
    navs.every((name) => name.trim() !== "") &&
      new Set(navs).size === navs.length,
    `every <nav> needs a name of its own, and they are: ${navs.map((n) => `"${n}"`).join(", ")}`,
  )
  const levels = all("h1, h2, h3, h4, h5, h6").map((h) => Number(h.tagName[1]))
  need(
    levels.every((level, i) => level - (levels[i - 1] ?? 0) <= 1),
    `the heading levels skip: ${levels.join(", ")}`,
  )

  // What a theme matters most for.
  for (const variant of variants)
    need(
      all(`.lt-button[data-variant="${variant}"]`).length > 0,
      `no button with data-variant="${variant}"`,
    )
  if (defaultVariant)
    need(
      all(
        `.lt-button:not([data-variant]), .lt-button[data-variant="${defaultVariant}"]`,
      ).length > 0,
      `no button in the default variant, ${defaultVariant}`,
    )
  for (const colour of alerts)
    need(
      all(`.lt-alert[data-color="${colour}"]`).length > 0,
      `no alert with data-color="${colour}"`,
    )

  const invalid = all<HTMLInputElement>(
    "form :is(input, select, textarea)[aria-invalid='true']",
  ).filter((control) => control.id !== "")
  need(
    invalid.length > 0,
    "no form with a field that is invalid, with aria-invalid and an id",
  )
  need(
    invalid.some((control) =>
      (control.getAttribute("aria-describedby") ?? "")
        .split(/\s+/)
        .some((id) => {
          const text = id ? document.getElementById(id) : null
          return (
            text?.matches(".lt-error-text") === true &&
            (text.textContent ?? "").trim() !== ""
          )
        }),
    ),
    "the invalid field is not described by an error text with something in it",
  )
  need(
    invalid.some((control) =>
      all(`.lt-error-summary a[href="#${control.id}"]`).some(
        (link) => link.getClientRects().length > 0,
      ),
    ),
    "no error summary that can be seen links to the invalid field",
  )

  need(
    all<HTMLInputElement>("input.lt-checkbox").some((c) => c.checked),
    "no checkbox that is checked",
  )
  need(
    all<HTMLInputElement>("input.lt-radio").some((r) => r.checked),
    "no radio button that is checked",
  )
  need(
    all<HTMLInputElement>("input.lt-switch").some((s) => s.checked),
    "no switch that is on",
  )
  need(
    all<HTMLProgressElement>("progress.lt-progress").some(
      (p) => p.position > 0 && p.position < 1,
    ),
    "no progress bar that is part way",
  )
  need(
    all("table.lt-table").some(
      (table) =>
        table.querySelectorAll("thead th").length > 0 &&
        table.querySelectorAll("tbody tr").length >= 3,
    ),
    "no table with a header row and three rows of data",
  )
  need(
    all("p.lt-paragraph a.lt-link[href]").length > 0,
    "no body text with a link in it",
  )
  need(
    new Set(all(".lt-heading").map((h) => h.tagName)).size >= 2,
    "the headings are not on two levels",
  )

  /*
   * The colours in use: what every element is painted with. A border and an
   * outline count when they have a width, since their colour is the text
   * colour until something sets it.
   */
  const probe = document.createElement("span")
  document.body.append(probe)
  const resolved = (token: string) => {
    probe.style.color = ""
    probe.style.color = `var(${token})`
    return probe.style.color === "" ? "" : getComputedStyle(probe).color
  }
  const ofFamily = Object.fromEntries(
    Object.entries(tokens).map(([family, names]) => [
      family,
      names.map(resolved).filter((colour) => colour !== ""),
    ]),
  )
  probe.remove()
  const painted = new Set<string>()
  for (const element of all("body, body *")) {
    if (element.getClientRects().length === 0) continue
    const style = getComputedStyle(element)
    painted.add(style.color)
    painted.add(style.backgroundColor)
    for (const side of ["Top", "Right", "Bottom", "Left"] as const)
      if (Number.parseFloat(style[`border${side}Width`]) > 0)
        painted.add(style[`border${side}Color`])
    if (
      Number.parseFloat(style.outlineWidth) > 0 &&
      style.outlineStyle !== "none"
    )
      painted.add(style.outlineColor)
  }
  const families = Object.fromEntries(
    Object.entries(ofFamily).map(([family, colours]) => {
      // A colour two families share says nothing about which is in use.
      const own = colours.filter(
        (colour) =>
          !Object.entries(ofFamily).some(
            ([other, theirs]) => other !== family && theirs.includes(colour),
          ),
      )
      return [
        family,
        { tokens: own.length, used: own.filter((c) => painted.has(c)).length },
      ]
    }),
  )
  const canvas = getComputedStyle(document.documentElement)
    .getPropertyValue("--lt-color-neutral-canvas")
    .trim()
  return { lacks, families, canvas }
}

/*
 * The page's own CSS, read where it is written. In the built page it stands
 * together with LO-TEK's, where the tokens get their values, and nothing in
 * the file says which rule came from where.
 */
const NAMED =
  /\b(aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|dark[a-z]+|deeppink|deepskyblue|dimgr[ae]y|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gr[ae]y|green|greenyellow|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|light[a-z]+|lime|limegreen|linen|magenta|maroon|medium[a-z]+|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|pale[a-z]+|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategr[ae]y|snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen|canvas|canvastext|linktext|visitedtext|buttonface|buttontext|field|fieldtext|highlight|highlighttext|graytext|mark|marktext)\b/i
// The properties that take a colour. The border's radius, width and style
// do not, though they start the same way.
const PAINTS =
  /^(color|background|background-color|background-image|border|border-color|border-(top|right|bottom|left|block|inline)(-start|-end)?(-color)?|outline|outline-color|box-shadow|text-shadow|text-decoration|text-decoration-color|fill|stroke|caret-color|accent-color|column-rule|column-rule-color|scrollbar-color|filter|backdrop-filter)$/

/**
 * A value with LO-TEK's tokens taken out, from the inside: what is left of
 * `var(--lt-a, var(--lt-b))` is nothing, and of `var(--lt-a, #fff)` the
 * fallback, which is a colour the page wrote.
 */
function withoutTokens(value: string): string {
  let rest = value
  for (;;) {
    const next = rest.replace(
      /var\(\s*--lt-[a-z0-9-]+\s*(?:,([^()]*))?\)/gi,
      (_, fallback) => ` ${fallback ?? ""} `,
    )
    if (next === rest) return rest
    rest = next
  }
}

/** The declarations in a piece of CSS that write a colour of their own. */
function ownColours(css: string): string[] {
  const found: string[] = []
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "")
  for (const [, property, value] of bare.matchAll(
    /(?:^|[;{}])\s*([a-z-]+)\s*:\s*([^;{}]+)(?=[;}]|$)/gi,
  )) {
    const name = property.toLowerCase()
    if (name.startsWith("--") || !PAINTS.test(name)) {
      // Everywhere, a colour written out is a colour written out.
      if (
        /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(/i.test(
          value,
        )
      )
        found.push(`${property}: ${value.trim()}`)
      continue
    }
    const rest = withoutTokens(value)
    if (
      /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(/i.test(
        rest,
      ) ||
      /var\(/.test(rest) ||
      NAMED.test(rest)
    )
      found.push(`${property}: ${value.trim()}`)
  }
  return found
}

// The reading read first: it must find a colour that is written out, and
// leave alone what is not one.
{
  const wrong = ownColours(
    ".a { color: #fff; margin: 0 } .b { background: var(--lt-color-brand1-surface); border: 1px solid currentColor; outline: 2px solid transparent } .c { border-color: red } .d { color: var(--mine) } .e { background: rgb(0 0 0 / 0.5) } #main-content:target { color: inherit } /* color: blue */ .f { box-shadow: 0 0 0 1px var(--lt-color-neutral-border), 0 1px 2px hsl(0 0% 0% / 0.2) } .g { color: color-mix(in oklch, var(--lt-color-accent-fill), transparent) } .h { inline-size: 100% } .i { border-radius: var(--lt-card-radius, var(--lt-spacing-1)); border-inline-start: 2px solid var(--lt-color-brand2-border, var(--lt-color-neutral-border)); border-width: 1px } .j { color: var(--lt-color-accent-text, #fff) }",
  )
  const wanted = [
    "color: #fff",
    "border-color: red",
    "color: var(--mine)",
    "background: rgb(0 0 0 / 0.5)",
    "box-shadow: 0 0 0 1px var(--lt-color-neutral-border), 0 1px 2px hsl(0 0% 0% / 0.2)",
    "color: color-mix(in oklch, var(--lt-color-accent-fill), transparent)",
    "color: var(--lt-color-accent-text, #fff)",
  ]
  if (JSON.stringify(wrong) !== JSON.stringify(wanted))
    problems.push(
      `the reading of colours answers wrong: got ${JSON.stringify(wrong)}, expected ${JSON.stringify(wanted)}`,
    )
}

// Two patterns and not one with the folder in a brace group: Bun's `Glob`
// matches nothing at all when an alternative in braces has a slash in it,
// and the check then said the page had no source while it stood there.
const sources = ["page.{astro,css}", "page/**/*.{astro,css}"].flatMap(
  (pattern) => [...new Glob(pattern).scanSync(SOURCES)],
)
if (sources.length === 0)
  problems.push(
    "found no source of the page: src/pages/theme-builder/page.astro or page/index.astro",
  )
let styles = 0
for (const rel of sources) {
  const text = readFileSync(`${SOURCES}${rel}`, "utf8")
  const css = rel.endsWith(".css")
    ? [text]
    : [...text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1])
  const attributes = rel.endsWith(".css")
    ? []
    : [...text.matchAll(/\bstyle=(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/g)].map(
        (m) => m[1] ?? m[2] ?? m[3],
      )
  styles += css.length
  for (const written of [...css, ...attributes].flatMap(ownColours))
    problems.push(
      `${rel} writes a colour of its own, which no theme reaches: ${written}`,
    )
}

let code = 0
let measured = 0
if (!existsSync(BUILT)) {
  problems.push(
    "dist/theme-builder/page/index.html is not built. The page is src/pages/theme-builder/page.astro, and the site is built with bun run build.",
  )
} else {
  const html = readFileSync(BUILT, "utf8")
  if (!/^<!doctype html>/i.test(html.trimStart()))
    problems.push("the page does not start with a doctype")
  for (const mark of [
    "sl-markdown-content",
    "starlight__sidebar",
    "starlight-theme-select",
    "site-search",
    'content="Starlight',
  ])
    if (html.includes(mark))
      problems.push(
        `the page carries the documentation's chrome: ${mark} is in it`,
      )
  for (const [, written] of html.matchAll(/\sstyle="([^"]*)"/g))
    for (const colour of ownColours(written.replace(/&quot;/g, '"')))
      problems.push(
        `a style attribute on the built page writes a colour of its own: ${colour}`,
      )

  const asked: Asked = {
    variants: variants.values,
    defaultVariant: variants.byDefault,
    alerts: alerts.values,
    tokens,
  }
  const s = await site({ pages: 1 })
  code = await s.run(async () => {
    const canvases: string[] = []
    for (const theme of ["light", "dark"] as const) {
      // Set before the page is opened, so the page works its own way to
      // the theme, as it does for a reader whose machine is set to it.
      await s.page.emulateMedia({ colorScheme: theme })
      const page = await s.open("/theme-builder/page/")
      const result = await page.evaluate(read, asked)
      canvases.push(result.canvas)
      // The same page in both themes: what it lacks is said once.
      if (theme === "light") for (const lack of result.lacks) s.fail(lack)
      for (const [family, { tokens: count, used }] of Object.entries(
        result.families,
      )) {
        if (NOT_MEASURABLE.includes(family)) continue
        if (count === 0)
          s.fail(
            `${theme}: the page gives ${family} no colour of its own to look for. Does it load the tokens?`,
          )
        else if (used === 0)
          s.fail(
            `${theme}: nothing on the page is painted with a colour of the family ${family}`,
          )
        else measured += 1
      }
    }
    if (canvases[0] === "" || canvases[0] === canvases[1])
      s.fail(
        `the page has the same canvas, "${canvases[0]}", whether the machine asks for light or dark, so only one theme was looked at`,
      )
  })
}

if (problems.length > 0) {
  console.error(
    `✗ The composed page of the theme builder is not a page to judge a theme on:\n\n${problems.map((p) => `  ${p}`).join("\n")}\n`,
  )
  process.exit(1)
}
if (code !== 0) {
  console.error(
    "✗ The composed page of the theme builder lacks something a theme is judged on, or the check did not get to look.",
  )
  process.exit(code)
}

// The guard comes last: a run that measured nothing must not pass.
const expected = (contract.families.length - NOT_MEASURABLE.length) * 2
if (measured !== expected || styles === 0) {
  console.error(
    `✗ The check found ${measured} families in use where it should find ${expected}, and read ${styles} stylesheets of the page's own. It has not looked at everything.`,
  )
  process.exit(1)
}

console.log(
  `✓ The composed page is a page by the skeleton, has what a theme is judged on, uses ${contract.families.length - NOT_MEASURABLE.length} of the ${contract.families.length} colour families in both themes (${NOT_MEASURABLE.join(", ")} cannot be measured), and writes no colour of its own.`,
)
