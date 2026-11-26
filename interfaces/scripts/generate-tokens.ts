import {
  colorTokens,
  cssTokens,
  darkColorTokens,
  darkTokens,
} from "../src/tokens/tokens"
import { elements } from "../src/vocabulary/elements"

const ELEMENTS = Object.keys(elements)

/*
 * Every `lt-` class the component stylesheets style, read from the
 * stylesheets themselves. Exact class selectors and not `[class*="lt-"]`: that
 * also matched an unrelated `lt-1`, and missed a class with a tab or a line
 * break in front.
 */
const CLASSES = new Set<string>()
for await (const file of new Bun.Glob("src/components/**/*.css").scan({
  cwd: `${import.meta.dir}/..`,
  absolute: true,
})) {
  const source = (await Bun.file(file).text()).replace(/\/\*[\s\S]*?\*\//g, "")
  for (const [, name] of source.matchAll(/\.(lt-[a-z0-9_-]+)/g))
    CLASSES.add(name)
}

/*
 * Children without a class of their own that get `display` from a component
 * rule. `hidden.browser.test.ts` looks for such rules in the stylesheets
 * itself, so a new child missing here fails there.
 */
const CHILDREN = [
  ".lt-accordion summary",
  ".lt-breadcrumbs li",
  ".lt-file-upload-list li",
  ".lt-pagination *",
  ".lt-select option",
  ".lt-tabs__list a",
  // The label `label.css` styles in a field that is not registered yet.
  "lt-field > label",
]

const sections: Record<string, string[]> = {}

/*
 * The colours come from the matrix, the rest from `tokens.ts`.
 *
 * The system's own colours are the contract applied to the system's own
 * hues, so there is no hand-written copy that can drift from the promises.
 */
const all: Record<string, string> = { ...cssTokens, ...colorTokens }

for (const key of Object.keys(all)) {
  // The colours are grouped by family, the rest by kind: `--lt-color-danger-*`
  // becomes "lt-color-danger", `--lt-spacing-4` becomes "lt-spacing".
  const parts = key.replace(/^--/, "").split("-")
  const section = parts
    .slice(0, key.startsWith("--lt-color-") ? 3 : 2)
    .join("-")

  if (!sections[section]) sections[section] = []
  sections[section].push(`  ${key}: ${all[key]};`)
}

/*
 * Everything goes in a cascade layer.
 *
 * Without it, a consumer who wants their own colours would have to beat our
 * specificity. The dark media query uses :root:not([data-theme="light"]),
 * that is, 0,2,0, and a plain :root in the consumer's CSS loses to it. The
 * override then worked in the light theme and with data-theme, but silently
 * broke for everyone with the operating system in dark mode. CSS without a
 * layer always beats CSS in a layer, whatever the specificity, so a plain
 * :root is now enough.
 */
/*
 * `color-scheme` is set only where someone has chosen a theme, never on bare
 * `:root`.
 *
 * The property controls the browser's own surfaces: the dropdown of a
 * `<select>`, scrollbars, the calendar panel of a date field and the default
 * colour of a page without a background of its own. It is therefore needed,
 * but it is inherited from `<html>` downwards. A child can opt out with
 * `color-scheme: normal`, but that is a counter-rule the host never asked to
 * have to write.
 *
 * On `:root`, LO-TEK took over the colour scheme of a document that is not
 * its own. A component that loads `lotek.css` into a host page gave the whole
 * host dark scrollbars and form controls in dark mode, far outside the
 * component itself, and the host had never asked for it.
 *
 * A page that wants the browser's surfaces to follow the system therefore
 * writes `color-scheme: light dark` on `<html>` itself. It is the same
 * arrangement as for the layer order: two lines the consumer writes.
 *
 * The exception is the theme picker below. Each of the three options sets
 * `color-scheme` itself, and then the consumer should not write it: a rule
 * outside a layer beats `@layer lotek`.
 */
const lines = [
  "/* Generated. Edit tokens.ts, not this file. */",
  "",
  "@layer lotek {",
  "  :root {",
]
for (const [index, [section, props]] of Object.entries(sections).entries()) {
  // A blank line between the groups, but not before the first: two in a row
  // would be flagged by biome every time the file is regenerated.
  if (index > 0) lines.push("")
  lines.push(`    /* ${section} */`)
  lines.push(...props.map((line) => `  ${line}`))
}
lines.push("  }")

const darkNames = Object.keys({ ...darkTokens, ...darkColorTokens })

const darkLines = darkNames.map(
  (name) => `      ${name}: ${{ ...darkTokens, ...darkColorTokens }[name]};`,
)

/*
 * The light values for exactly the tokens the dark theme overrides.
 *
 * Without this list, `[data-theme="light"]` had only `color-scheme`, while
 * `[data-theme="dark"]` had all 90. The two were not the same kind of rule:
 * the dark theme worked on any element, the light theme only on `<html>`,
 * because a child cannot override a variable it inherits without declaring it
 * again. A component with `data-theme="light"` on its own `<div>` therefore
 * got dark colours on a light host page.
 *
 * The list is built from the same keys, not from a hand-written copy, so the
 * two blocks cannot drift apart. A token without a light value would be an
 * error in `tokens.ts`, and stops the generation here.
 */
const lightLines = darkNames.map((name) => {
  const value = all[name]
  if (value === undefined)
    throw new Error(
      `${name} is overridden in the dark theme, but has no light value in tokens.ts.`,
    )
  return `      ${name}: ${value};`
})

/*
 * The tokens built from other tokens, such as the focus ring and the
 * disabled state.
 *
 * A `var()` in a custom property is computed where it is declared, and the
 * children inherit the finished value. With them only on `:root`, a section
 * with `data-theme="dark"` on a light page got the light focus ring, 2.4:1
 * against the dark surface, and a disabled button turned light grey.
 * Declared again in each theme block, the media query included so the blocks
 * stay alike, they are computed against the theme's colours, a generated
 * theme in the `lotek-theme` layer included.
 *
 * The cost is that an override on `:root` does not reach into a
 * `data-theme`: a declaration on the element itself beats a value it
 * inherits. The list is therefore written out, so a new alias like
 * `var(--lt-font-family-base)` does not end up here without someone deciding
 * it.
 */
const DERIVED = [
  "--lt-color-disabled-surface",
  "--lt-color-disabled-text",
  "--lt-focus-ring",
]
const derivedLines = DERIVED.map((name) => {
  if (all[name] === undefined)
    throw new Error(`${name} does not exist in tokens.ts.`)
  return `      ${name}: ${all[name]};`
})

/*
 * The dark theme is written twice, and that is on purpose.
 *
 * The media query makes the system setting apply without the consumer
 * writing anything. `:not([data-theme="light"])` lets an app force the light
 * theme on the whole document from a device set to dark.
 *
 * The attribute rules below are something else: they are theme boundaries,
 * and work on any element. Both declare all 90 tokens, so one theme can sit
 * inside another, both ways, and so an embedded component can lock its own
 * tree without touching the host.
 */
/*
 * `.lt-theme-control` lets the user choose a theme without a line of
 * JavaScript.
 *
 * The class is on a radio button, and `value` says which theme it selects.
 * The selector becomes an extra line on the theme blocks rather than a copy
 * of them, so the 90 tokens are in one place.
 *
 * "Follow the system" needs no theme block: a value without a block matches
 * nothing, and then `:root` and the media query apply again.
 *
 * It still needs `color-scheme`, which was found along the way. LO-TEK does
 * not set it on bare `:root`, since the package can be a guest on a page that
 * is not its own, so the advice has been for the consumer to write
 * `color-scheme: light dark` on `<html>` themselves. Done outside a layer,
 * that rule beats `@layer lotek`, and a chosen dark theme got light
 * scrollbars and form controls. Answering "put it in a layer before lotek" is
 * a trap: the layer order is already established by tokens.css, which loads
 * first, so a later `@layer` statement puts the layer behind. The control
 * therefore takes care of it itself, and whoever uses it does not need to
 * write `color-scheme` at all.
 *
 * The control wins over `data-theme` on the same element, since `:has()`
 * takes the specificity of its argument. That is on purpose: the server
 * sends the choice it has stored, and the click should take effect before
 * the response is back. The order is tested in all three engines in
 * `theme.browser.test.ts`, not worked out here.
 */
const control = (theme: string) =>
  `:root:has(.lt-theme-control[value="${theme}"]:checked)`

lines.push(
  "",
  "  @media (prefers-color-scheme: dark) {",
  '    :root:not([data-theme="light"]) {',
  ...darkLines,
  ...derivedLines,
  "    }",
  "  }",
  "",
  // When the app forces a theme, the browser's own surfaces must follow.
  // Otherwise an app set to the light theme on a dark device gets a black
  // dropdown under a white field.
  '  [data-theme="light"],',
  `  ${control("light")} {`,
  "    color-scheme: light;",
  "",
  ...lightLines.map((l) => l.slice(2)),
  ...derivedLines.map((l) => l.slice(2)),
  "  }",
  "",
  '  [data-theme="dark"],',
  `  ${control("dark")} {`,
  "    color-scheme: dark;",
  "",
  ...darkLines.map((l) => l.slice(2)),
  ...derivedLines.map((l) => l.slice(2)),
  "  }",
  "",
  /*
   * A theme boundary also gives the surface and the text. Without this, a
   * `<div data-theme="dark">` on a light page was transparent: the tokens
   * turned dark, but the background was still the page's white, and the
   * body text was 1.23:1. Only `light` and `dark`: other values have no theme
   * block. `:where` gives zero specificity, so a component with `data-theme`
   * on it keeps its own surface.
   *
   * The root gets nothing. The package can be a guest on a page that is not
   * its own, and a background on `<html>` stopped the page's own `body`
   * background from filling the window. `lt-toast` is a fixed column above
   * the page, and must not become a dark stripe behind the messages.
   */
  "  :where(",
  '    [data-theme="light"]:not(:root, lt-toast),',
  '    [data-theme="dark"]:not(:root, lt-toast)',
  "  ) {",
  "    background-color: var(--lt-color-neutral-canvas);",
  "    color: var(--lt-color-neutral-text);",
  "  }",
  "",
  /*
   * No tokens here: `auto` is meant to fall back on the media query. Only
   * the browser's own surfaces need to be told that both are fine.
   *
   * The condition matters. `auto` means "no override from me", so if the
   * server has written a theme, the server's value stands, both for the
   * tokens and for the surfaces. Without the condition, `auto` won on
   * `color-scheme` because `:has()` is more specific than the attribute,
   * while the tokens came from the attribute block: dark colours with light
   * scrollbars, exactly the mismatch the blocks above exist to prevent.
   *
   * It asks about the **value** and not whether the attribute exists. A
   * `data-theme` without a block, such as `auto` or a typo, lets the tokens
   * fall to `:root` and the media query. Had we asked only
   * `:not([data-theme])`, the `auto` rule would be blocked by such a value,
   * and `color-scheme` would be unset while the tokens followed the system:
   * the same mismatch, triggered from the other end.
   */
  // The line break is inside `:has(…)`. A line break between the parts
  // outside the parenthesis would become a descendant selector. The form is Biome's.
  '  :root:not([data-theme="light"]):not([data-theme="dark"]):has(',
  '    .lt-theme-control[value="auto"]:checked',
  "  ) {",
  "    color-scheme: light dark;",
  "  }",
  "",
  /*
   * `hidden` must hide, also a component that sets `display` itself.
   *
   * Author styles in any layer beat the browser's
   * `[hidden] { display: none }`, so `<div class="lt-alert" hidden>` stayed
   * visible. `!important` in the layer is what the browser itself does, and
   * beats all ordinary declarations whatever the specificity, variants like
   * `.lt-select[data-picker="styled"] option` included. It also beats the
   * consumer's own `!important` without a layer, so `hidden` cannot be
   * overridden here.
   *
   * The elements are listed separately, since a web component needs no
   * class, and the children in `CHILDREN` have none. `until-found` must not be
   * hidden completely: the browser searches in it.
   */
  "  :is(",
  ...[
    ...[...CLASSES].sort().map((name) => `.${name}`),
    ...ELEMENTS,
    ...CHILDREN,
  ].map(
    (selector, i, list) => `    ${selector}${i < list.length - 1 ? "," : ""}`,
  ),
  '  )[hidden]:not([hidden="until-found" i]) {',
  "    /* biome-ignore lint/complexity/noImportantStyles: `hidden` must win over the component's `display`, as the browser itself does */",
  "    display: none !important;",
  "  }",
  "}",
)

await Bun.write(
  new URL("../src/tokens/tokens.css", import.meta.url),
  `${lines.join("\n")}\n`,
)

console.log(
  `✓ tokens.css generated: ${Object.keys(all).length} values, ${darkLines.length} overridden in the dark theme`,
)
