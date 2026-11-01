/**
 * Writes the rulebooks in `agent/`, one per environment.
 *
 * Each file is complete for its environment. An agent that reads about
 * `className` in a project with Go templates is an agent that writes
 * `className` in a Go template, and noise from a framework you do not use is
 * exactly what makes it guess. Duplication between the files costs nothing,
 * since all six are written from here.
 *
 * The order in each file follows the mistakes agents actually make, most
 * expensive first: a forgotten stylesheet, invented components and variants,
 * hard-coded colours, and botched registration of web components. The check
 * comes last, because it is the loop in which the agent corrects itself.
 *
 * Run with: bun run generate
 * `scripts/check-agent.ts` does the same in memory and fails if the files on
 * disk are out of date.
 */

import { writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  BUNDLED_SIZE,
  builderFunctions,
  CDN,
  cdnUrl,
  countBuilderFunctions,
  countCssComponents,
  countElements,
  cssTable,
  PACKAGE,
  reflow,
  spacingAndFont,
  tokenList,
  VERSION,
  webTable,
} from "./agent-parts.js"

/** The package name, which bundlers resolve. */
const PACKAGE_NAME = (component: string) => `@lo-tek/interfaces/${component}`

/** The stylesheet, as it is written where there is a build step. */
const STYLESHEET_PACKAGE = (component: string) =>
  `@lo-tek/interfaces/${component}.css`

/**
 * The stylesheet without a build step: the full URL.
 *
 * The column used to hold only the file name, and the reader had to guess the
 * path. `field.css` is under `frame/`, not under `css/`, so an agent that
 * generalised from the button example got a 404 on nine of the components.
 */
const STYLESHEET_URL = (component: string) => cdnUrl(`${component}.css`)

/**
 * The address without a bundler: a URL.
 *
 * A package name in a `<script type="module">` without a bundler or an import
 * map does not resolve in the browser, and the import fails silently. The
 * tracks without a build step therefore need the full URL.
 */
const URL_FOR = (_component: string, modulePath: string) =>
  `${CDN}/${modulePath}`

type Recipe = {
  /** The name the command takes, and the file name. */
  name: string
  title: string
  /** Who the file is for, and what is particular about the environment. */
  intro: string
  /** Item 1 of the short version: how the stylesheet gets in. */
  stylesheetRule: string
  /** Item 4 of the short version: registration and boolean attributes. */
  pointFour: string
  /** The first of the three rules, that is, where registration belongs. */
  registrationRule: string
  /** Section 1, with an example. */
  stylesheet: string
  /** The address the import should have in this environment. */
  address: (component: string, modulePath: string) => string
  /** The address the stylesheet should have in this environment. */
  stylesheetAddress: (component: string) => string
  /** Section 5: everything put together, as it is actually written here. */
  markup: string
  /** What only this environment has. Goes between the markup and the pitfalls. */
  extra?: string
  /** The command that checks the markup here. */
  check: string
  /** What the file check cannot see here, said after the command. */
  checkBlindSpot?: string
  /** Where the app answers while it is developed. */
  devUrl?: string
  /** Item 5, when the check is not the main safeguard in this environment. */
  pointFive?: string
  /** The rows of the pitfall table that apply here. */
  pitfalls: [string, string][]
}

const shortVersion = (recipe: Recipe) => `## Short version

1. ${recipe.stylesheetRule}
2. **Use only the classes and elements in the tables below.** \`lt-modal\`,
   \`lt-datepicker\` and \`data-variant="outlined"\` exist in other design
   systems, not in LO-TEK. If you are unsure whether something exists, it is
   listed here or it does not exist.
3. **No hard-coded colours or pixels.** \`var(--lt-color-…)\` and
   \`var(--lt-spacing-…)\`.
4. ${recipe.pointFour}
5. ${
  recipe.pointFive ??
  `**Run the check on what you have written:** \`${recipe.check}\`. It knows
   every class, every element, every attribute and every allowed value, prints
   \`file:line:column: error: message\`, or \`warning:\`, and exits with an error code if it finds
   anything.${recipe.checkBlindSpot ? ` ${recipe.checkBlindSpot}` : ""} With the app running, also check every page you have changed:
   \`npx @lo-tek/interfaces check ${recipe.devUrl ?? "http://localhost:8080"}/page\`. That also
   requires every \`for\` and \`aria-describedby\` to point to an id that
   exists, and every field to have a label. You are done when both answer
   "The markup matches LO-TEK".`
}`

const whatExists = (recipe: Recipe) => `## 2. What exists

${countCssComponents()} CSS components and ${countElements()} web components, and this is
the whole list. The classes are \`lt-\` + kebab-case. Variants are always
\`data-*\` attributes, never classes of their own: \`data-variant="secondary"\`,
not \`lt-button--secondary\`. The default variant has no attribute.

### CSS components (no JavaScript)

${cssTable(recipe.stylesheetAddress)}

There is also \`lt-theme-control\`, a class on a radio button that lets the
user choose a theme. It is in \`tokens.css\`, and is described under Tokens.`

const TOKENS = `## 3. Tokens

One layer. A colour is a cell in a matrix of **family**, that is, what it
means, and **role**, that is, what it does, and the name is
\`--lt-color-<family>-<role>\`. Every family has every role, so
\`--lt-color-danger-border\` and \`--lt-color-success-border\` both exist.
The roles are the same whatever the family: \`surface\` is a tinted surface,
\`fill\` a filled one, \`content\` the text on top of \`fill\`, \`border\` a
border, and \`text\` the family's colour as text. Border and text each have a
weaker and a stronger step next to them.

\`\`\`
${tokenList()}
\`\`\`

${spacingAndFont()}

\`disabled\` and \`neutral\` are not the same. \`disabled\` is for controls
that are turned off, and is exempt from the contrast requirement in WCAG
1.4.3. \`neutral\` is for subdued information the user actually has to read or
press, and holds 4.5:1. Never use the \`disabled\` colours to subdue
something that is meant to be read.`

/*
 * The example is written in the rulebook's own language.
 *
 * One shared HTML block would have taught the React agent to write `class=`,
 * and that is exactly the mistake `/react` exists to prevent.
 */
const themeExample = (recipe: Recipe) =>
  recipe.name === "react"
    ? `\`\`\`tsx
<div data-theme="light">
  <button {...lt.button()}>Save</button>
</div>
\`\`\``
    : `\`\`\`html
<div data-theme="light">
  <button class="lt-button">Save</button>
</div>
\`\`\``

const boundaryExample = (recipe: Recipe) =>
  recipe.name === "react"
    ? `\`\`\`tsx
<div data-lt-boundary data-theme="light">
  <button {...lt.button()}>Save</button>
</div>
\`\`\``
    : `\`\`\`html
<div data-lt-boundary data-theme="light">
  <button class="lt-button">Save</button>
</div>
\`\`\``

/*
 * The picker is written in the rulebook's own language, for the same reason
 * as themeExample.
 *
 * The class is on each radio button and not on the group: `:has()` looks for
 * the checked one, and it is the button that is checked.
 */
const pickerExample = (recipe: Recipe) => {
  const react = recipe.name === "react"
  const attr = react ? "className" : "class"
  const option = react
    ? "className={lt.toggleGroup.option}"
    : 'class="lt-toggle-group__option"'
  const line = (value: string, text: string, checked = false) =>
    `  <label ${option}>
    <input ${attr}="lt-theme-control" type="radio" name="theme"
           value="${value}"${checked ? (react ? " defaultChecked" : " checked") : ""} /> ${text}
  </label>`

  return `\`\`\`${react ? "tsx" : "html"}
<fieldset ${react ? "{...lt.toggleGroup()}" : 'class="lt-toggle-group"'}>
  <legend ${react ? "{...lt.srOnly()}" : 'class="lt-sr-only"'}>Theme</legend>
${line("auto", "Follow the system", true)}
${line("light", "Light")}
${line("dark", "Dark")}
</fieldset>
\`\`\`${
    react
      ? `

\`lt-theme-control\` has no builder function, so it is the one class written
as a string.`
      : ""
  }`
}

const THEME = (recipe: Recipe) => `### Light and dark

Without you doing anything, the colours follow the device's setting. A page
that wants to decide for itself sets \`data-theme="light"\` or
\`data-theme="dark"\` on \`<html>\`.

The attribute is a **theme boundary** and works on any element, not only on
the root. One theme can sit inside another, both ways.

This is what an embedded component should use. When you put LO-TEK into a
page you do not control, set the attribute on the component's own root
element:

${themeExample(recipe)}

The component is then light whatever the device is set to, and the host is
left alone.

**The host's CSS stops at the boundary.** The host often has rules without a
layer, such as \`button { background: none; border: none }\` or a normalize,
and they beat \`@layer lotek\`. In that case, set \`data-lt-boundary\` on the
same root element:

${boundaryExample(recipe)}

Below the root element the browser then ignores the host's CSS without a
layer, unless a rule of the host's wins on specificity as described below,
and LO-TEK's layer applies again. The rule is in \`lotek.css\` and in
\`${recipe.stylesheetAddress("boundary")}\`. Fonts and other
inherited properties still come from the host, and the \`--lt-*\` variables
work. Three things follow from it:

- Your own CSS inside the boundary must be in a layer after \`lotek\`. CSS
  without a layer disappears there in the same way as the host's.
- Elements without a LO-TEK class lose the host's CSS without a layer. A layer
  the host has declared before \`lotek\`, such as Tailwind's Preflight in
  \`base\`, still applies where LO-TEK sets nothing.
- The boundary has the specificity (0,2,0). A rule from the host with the
  same specificity wins if it is loaded after the boundary, and one with more
  always wins. So do \`!important\` and layers the host has declared after
  \`lotek\`.

LO-TEK sets \`color-scheme\` only where someone has chosen a theme: on
\`[data-theme="light"]\`, on \`[data-theme="dark"]\` and on the options of the
theme picker below. Bare \`:root\` never gets it. The property controls the
browser's own surfaces, that is, scrollbars, dropdowns and calendar panels,
and it is inherited. A child can opt out with \`color-scheme: normal\`, but
that is a counter-rule the host never asked to have to write: with the value
on the root, it applied to the whole document, including where the package is
only a guest. If the whole page should follow the system, write
\`color-scheme: light dark\` on \`<html>\` yourself, in the same way as you set
the layer order yourself.

### Letting the user choose a theme

\`lt-theme-control\` on a radio button makes \`value\` a theme choice. It is
plain CSS, without a line of JavaScript:

${pickerExample(recipe)}

The choice controls two things. LO-TEK's colours come from the tokens, and
the browser's **own** surfaces from \`color-scheme\`: \`light\` gives \`light\`,
\`dark\` gives \`dark\`, and \`auto\` gives \`light dark\`. \`light dark\` is not
a theme, but the statement that the page works in both, so the browser can
choose by the system.

"Follow the system" has no theme block, and that is on purpose: a value
without a block matches nothing, and then the media query applies again.

Do not write \`color-scheme\` yourself when the picker is in use. Such a rule
outside a layer beats \`@layer lotek\` and locks the browser's surfaces to
the system while the user has chosen something else.

\`light\` and \`dark\` win over \`data-theme\` on \`<html>\`, so the server can
send the stored choice while a click still takes effect before the response
is back. \`auto\` does not: it means "no override from me", so if the server
has written \`data-theme\`, the server's value stands. For "follow the system"
to work at once, whatever stores the choice must also remove the attribute.

Two things it does not do. It **stores nothing**: submit the group in a form
and store the choice in a cookie the server reads, or in \`localStorage\`. And
it must be in the **same tree as \`<html>\`**, since \`:has()\` does not see out
of its own tree; a control inside a shadow root does not set the theme on the
page.`

const webComponents = (recipe: Recipe) => `## 4. Web components

Three rules apply to all of them:

1. ${recipe.registrationRule} The import has no side effect on its own;
   it is the \`define\` call that registers the element.
2. **Boolean attributes are true as long as they are present.**
   \`hidden="false"\`, \`disabled="false"\` and \`open="false"\` turn it *on*.
   To turn any of them off, remove the attribute entirely.
3. **You write the markup, the component adds the behaviour.** \`<lt-field>\`
   does not create your label or your control. You write \`${recipe.name === "react" ? "htmlFor" : "for"}\` on the label
   and \`id\` on the control, or wrap the control in a \`<label>\`, so the field
   has a name without JavaScript too. The component wires the help text and
   the error text with \`aria-describedby\` and \`aria-invalid\`, and never
   writes an id on the control${
     recipe.name === "react"
       ? ", so the id is yours, from `useId()`"
       : ": an id the server did not send makes an update from the server replace the field, with the focus and what the user has typed"
}. The field is invalid when the error text is there without
   \`hidden\`.

${webTable(recipe.address, recipe.stylesheetAddress)}

None of them uses shadow DOM. The content is in plain DOM, so
\`querySelector\`, \`FormData\` and ordinary CSS work straight into it.`

const pitfalls = (rows: [string, string][]) => `## Known pitfalls

| Symptom | Cause |
| --- | --- |
${rows.map(([symptom, cause]) => `| ${symptom} | ${cause} |`).join("\n")}`

const CLOSING = `## When CSS is not enough

The components are customised with tokens and \`--lt-\` variables. If that is
not enough, \`npx @lo-tek/interfaces takeover <component>\` copies the source
code of one component into \`src/lotek/<component>/\`, so the code is yours to
change. The copy is TypeScript that imports from the package by name, so it
needs a build step. It is renamed from \`lt-\` to \`app-\`, and a
\`lotek-manifest.json\` next to it teaches the check the new names:
\`npx @lo-tek/interfaces check --manifest=src/lotek/<component>/lotek-manifest.json <files>\`.
A complete colour theme from your brand colours is made with
\`npx @lo-tek/interfaces theme\`.

All of this, with live examples: https://lo-tek.sobernetics.no/`

// The pitfalls, collected here because several environments share them.
const STYLES_MISSING: [string, string] = [
  "The styles are missing",
  "`tokens.css` is not loaded. The order between it and the component's stylesheet does not matter",
]
const BUNDLE_MISSING: [string, string] = [
  "The styles are missing",
  "The `<link>` to `lotek.css` is missing, or its address answers 404. With one stylesheet per component instead, `tokens.css` is not loaded",
]
const NO_DEFINE: [string, string] = [
  "An `<lt-toast>` or `<lt-connection-status>` shows nothing, an `<lt-session-timeout>` never warns, or another component does nothing",
  "The `define` function has not run. `<lt-toast>` and `<lt-connection-status>` create their content themselves and are empty without it, and `<lt-session-timeout>` does not count the time. The markup in the others comes from you and is there regardless, with two exceptions until they are registered. `<lt-tabs>` shows one panel: of those the server left without `hidden`, the one the URL points to, otherwise the first, and under `server-controlled` always the first. `<lt-suggestion>` hides the list",
]
const FOREIGN_TEXT: [string, string] = [
  "A component speaks English on a page in another language",
  "The text in the markup comes from you, and is written with the app's own translation setup. The few default texts the package has are replaced with `label` and `close-label` on `<lt-toast>`, `offline-text` and `online-text` on `<lt-connection-status>`, `count-none`, `count-one` and `count-other` on `<lt-suggestion>`, and `--lt-label-required-text`, `--lt-label-optional-text` and `--lt-label-required-symbol` in CSS. Numbers and durations follow the nearest `lang`, usually the one on `<html>`. See https://lo-tek.sobernetics.no/translation/",
]
const NEVER_INVALID: [string, string] = [
  "The error text never shows, and the field counts as valid",
  '`hidden="false"` is set on the error text, and it hides it all the same. The attribute must be removed, not set to `false`',
]
const SERVER_RENDERING: [string, string] = [
  "The component does nothing, and nothing says so",
  "The registration runs only on the server, where it does nothing. It must also run in the browser",
]
const TYPESCRIPT_IN_SCRIPT: [string, string] = [
  "`SyntaxError` in the browser",
  'TypeScript syntax in a `<script type="module">` without a build step',
]

const TOKENS_FIRST = `\`tokens.css\` defines all the variables, and all the other
stylesheets build on it. It must be loaded, and comes first out of habit: the
order between it and the others does not matter.`

const CHECK_IN_TESTS = `When the code produces the HTML as strings, there is no
file to check. Then check the page as the server sends it, as a whole page,
with the wiring included:

\`\`\`bash
npx @lo-tek/interfaces check http://localhost:8080/form
curl -s http://localhost:8080/form | npx @lo-tek/interfaces check --rendered
\`\`\`

In a test written in JavaScript, \`diagnosePage\` does the same:

\`\`\`js
import { diagnosePage } from "@lo-tek/interfaces/diagnostics"

const findings = diagnosePage(html)
// findings is empty when the page is correct
\`\`\``

const RECIPES: Recipe[] = [
  {
    name: "html",
    stylesheetAddress: STYLESHEET_URL,
    title: "LO-TEK in plain HTML",
    intro: `The rulebook for LO-TEK in a project without a build step:
hand-written HTML, where the browser loads the files directly. If you use a
bundler, React, Astro or Datastar, or the server produces the markup, another
file in this folder applies.`,
    stylesheetRule: `**One \`<link>\` to \`lotek.css\`, before everything else.**
   Without it, the components look unstyled. The answer is then to add the
   link, never to write your own CSS to make them look right.`,
    pointFour: `**Web components are registered once with \`defineLt*()\`** in a
   \`<script type="module">\`, and a boolean attribute is true as long as it is
   there: \`hidden="false"\` still hides the error text.`,
    registrationRule: `**\`defineLt*()\` runs once** in a
   \`<script type="module">\` on the page, not once per component. The
   elements can come before it in the markup and are upgraded when it runs;
   only a method call such as \`show()\` has to wait for it.`,
    address: URL_FOR,
    check: "npx @lo-tek/interfaces check page.html",
    stylesheet: `## 1. The stylesheet

One file with everything, the simplest and fastest option without a bundler:

\`\`\`html
<link rel="stylesheet" href="${cdnUrl("lotek.css")}">
\`\`\`

Or from \`node_modules\`, if you serve the folder:

\`\`\`html
<link rel="stylesheet" href="/node_modules/@lo-tek/interfaces/dist/lotek.css">
\`\`\`

\`lotek.css\` is ${BUNDLED_SIZE}, and has all the components. Choose it.
The alternative is one stylesheet per component, and then ${TOKENS_FIRST}

\`\`\`html
<link rel="stylesheet" href="${cdnUrl("tokens.css")}">
<link rel="stylesheet" href="${cdnUrl("button.css")}">
\`\`\`

Some of them, such as \`field.css\` and \`suggestion.css\`, fetch the
stylesheets they build on with \`@import\`, which the browser only sees once
the file has loaded. \`dist/lotek.css\` has everything
flattened, without \`@import\`, and is therefore faster when you link.`,
    markup: `## 5. A whole form

\`\`\`html
<link rel="stylesheet" href="${cdnUrl("lotek.css")}">

<form id="job-order" novalidate>
  <lt-field>
    <label class="lt-label" for="codename" data-required="symbol">Codename</label>
    <input class="lt-input" id="codename" type="text" name="codename" required />
    <p class="lt-error-text" hidden>Enter a codename.</p>
  </lt-field>

  <button class="lt-button" type="submit">Order the job</button>
</form>

<script type="module">
  import { defineLtField } from
    "${cdnUrl("field")}"

  defineLtField()
</script>
\`\`\`

The field becomes invalid when the error text shows, not by switching a class:

\`\`\`js
const codename = document.getElementById("codename")
const error = codename.closest("lt-field").querySelector(".lt-error-text")

error.hidden = codename.value.trim() !== ""
\`\`\`

TypeScript does not belong in a \`<script type="module">\`. The browser runs
the tag as plain JavaScript, and \`event as CustomEvent<…>\` gives a
\`SyntaxError\` that stops the whole script.`,
    extra: `## 6. Check what you have written

\`\`\`bash
npx @lo-tek/interfaces check page.html
\`\`\`

Several files are given as several arguments, or as a pattern such as
\`pages/*.html\` without quotes: the shell expands it, and the command expands
nothing itself. One finding gives an error code, so it can run in CI. It catches an element that does not exist,
an attribute the element does not have, a value outside the list,
\`lt-buton\`, \`data-variant="secundary"\`, and \`<lt-field>\` without a
control or a label.

${CHECK_IN_TESTS}`,
    pitfalls: [
      BUNDLE_MISSING,
      NO_DEFINE,
      FOREIGN_TEXT,
      NEVER_INVALID,
      TYPESCRIPT_IN_SCRIPT,
    ],
  },
  {
    name: "templates",
    stylesheetAddress: STYLESHEET_URL,
    title: "LO-TEK in templates and server-written HTML",
    intro: `The rulebook for LO-TEK where the server produces the markup:
Go templates, Razor, PHP, Blade, Twig, Jinja, Django, ERB, Liquid, Handlebars,
Nunjucks and Edge, and HTML built as strings in Kotlin, Java, C# or Python.

This is the environment LO-TEK is made for. The components are CSS classes
and web components, that is, things the browser understands directly, so a
Go template gets the same components as a React app without taking in any
JavaScript framework.

It is also the environment with the smallest safety net. No compiler looks at
the attributes in a template, and no type stops \`data-variant="outlined"\`.
That is why item 5 applies more strictly here than anywhere else: the check is
the only thing that reads your markup.`,
    stylesheetRule: `**One \`<link>\` to \`lotek.css\` in the page template,** once
   for the whole app. Without it, the components look unstyled. The answer is
   then to add the link, never to write your own CSS to make them look right.`,
    pointFour: `**Web components are registered once with \`defineLt*()\`** in
   the page template, and a boolean attribute is true as long as it is there.
   In a template that means a condition around the whole attribute,
   \`{{if .Locked}}disabled{{end}}\`, not \`disabled="{{.Locked}}"\`.`,
    registrationRule: `**\`defineLt*()\` runs once** in the page template, not
   once per component.`,
    address: URL_FOR,
    check: "npx @lo-tek/interfaces check templates/*.html",
    stylesheet: `## 1. The stylesheet

One link in the page template, with all the components:

\`\`\`html
<link rel="stylesheet" href="${cdnUrl("lotek.css")}">
\`\`\`

Or from your own server, if you copy the file into your static assets.
\`lotek.css\` is ${BUNDLED_SIZE}, has everything flattened without
\`@import\`, and is the fastest option when you link.

If you want only the stylesheets the pages actually use, ${TOKENS_FIRST}
After that, one stylesheet per component, from the tables below. Without a
bundler that means more round trips, and one forgotten link is enough for
something to look unstyled. For a template, one file is nearly always the
right choice.`,
    markup: `## 5. A field in a template

\`\`\`html
<lt-field>
  <label class="lt-label" for="codename" data-required="symbol">Codename</label>
  <input class="lt-input" id="codename" type="text" name="codename" value="{{.Codename}}" required />
  {{if .Error}}<p class="lt-error-text">{{.Error}}</p>{{end}}
</lt-field>
\`\`\`

The error text is rendered only when the field is invalid, and that is
enough: the component counts the field as invalid when the error text is
visible. \`value\` is always written, so what the user typed is still there
when the server sends the form back.

In a loop the id comes from a key in the data, never from the index or a
counter:

\`\`\`html
{{range .Targets}}
<lt-field>
  <label for="note-{{.Code}}">{{.Name}}</label>
  <input class="lt-input" id="note-{{.Code}}" name="note-{{.Code}}" value="{{.Note}}" />
</lt-field>
{{end}}
\`\`\`

The registration, once in the page template:

\`\`\`html
<script type="module">
  import { defineLtField } from
    "${cdnUrl("field")}"

  defineLtField()
</script>
\`\`\``,
    extra: `## 6. When the server sends new HTML

If you patch the page as it runs, with htmx, Turbo, Datastar or your own
\`innerHTML\` update, the question is what decides the state. By default the
web component does: \`<lt-tabs>\` remembers the tab the user selected, and puts
it back when a patch tears the selection away. The template needs nothing
for that.

This assumes the patch keeps the elements and only changes the attributes,
as a morph does: Datastar's \`outer\` and \`inner\`, htmx with the idiomorph
extension and Turbo 8 with morphing. The selection is tied to the link
itself. If the patch replaces the nodes, as \`innerHTML\`, htmx's ordinary
\`innerHTML\` and \`outerHTML\` swaps, Datastar's \`replace\` and Turbo without
morphing do, the tab is a different one. The component then selects the tab
the server marked with \`aria-selected="true"\`, otherwise the one the URL
points to, otherwise the one whose panel the server left without \`hidden\`,
otherwise the first. If the server wants to decide, it marks the tab and
writes \`hidden="until-found"\` on the other panels, or decides the state
alone with \`server-controlled\`.

A morph keeps an element only when the id matches: Datastar and idiomorph do
not morph an element with an id into one without, they replace it. The
components therefore never write an id on what the user touches: the field in
\`<lt-field>\` and \`<lt-suggestion>\`, and the tabs in \`<lt-tabs>\`. Write
\`for\` on the label and \`id\` on the field, or wrap the field in the label.
The tabs are links without an id, and the panels have the id the link points
to, the same on every render. The panel in \`<lt-popover>\` needs an id in the
same way, for \`aria-controls\` on the button; the component creates none. The
list and the options in \`<lt-suggestion>\` can be replaced; the component
wires them again and finds the highlighted option again by its text.
\`<lt-field>\` and \`<lt-suggestion>\` warn in the console when a patch
replaces the field with one that has another id, the same \`name\` and another
value, and \`<lt-popover>\` when a patch replaces the open panel with one that
has another id. \`<lt-tabs>\` repairs the selection without a word.

If the server should be able to move the state, as in "go on to step 2", say
so with \`server-controlled\`. Then every patch decides, and the component
stops putting the user's choice back:

\`\`\`html
<lt-tabs server-controlled>
  <ul class="lt-tabs__list" aria-label="Parts of the claim">
    <li><a href="#claim">Claim</a></li>
    <li><a href="#attachments">Attachments</a></li>
  </ul>
  <section class="lt-tabs__panel" id="claim">…</section>
  <section class="lt-tabs__panel" id="attachments" hidden="until-found">…</section>
</lt-tabs>
\`\`\`

The attribute exists on \`<lt-tabs>\`, \`<lt-popover>\`, \`<lt-dialog>\` and
\`<lt-suggestion>\`. Without it the server and the component would fight over
the same state. Note that the state is always in the markup the server sent:
\`aria-selected\` on the tab and \`hidden\` on the panel in \`<lt-tabs>\`,
\`open\` on \`<lt-popover>\` and \`<lt-dialog>\`, and \`hidden\` on the list and
\`aria-expanded\` on the field in \`<lt-suggestion>\`.

## 7. The check is the only thing that reads your markup

\`\`\`bash
npx @lo-tek/interfaces check templates/*.html
\`\`\`

One finding gives an error code, so it belongs in CI next to the tests. It
catches \`lt-buton\`, \`data-variant="secundary"\`, \`<lt-modal>\` and
\`<lt-field>\` without a control or a label.

It is made for templates. Comments, \`<script>\` and \`<style>\` are skipped,
and \`<?…?>\` and \`<%…%>\` inside a tag do not end it early. These are
tested and give no false findings:

\`\`\`html
<button class="lt-button {{.Extra}}">Send</button>
<button class="lt-button" data-variant="{{.Variant}}">Send</button>
<span class="lt-badge" data-color="{% if x %}danger{% endif %}">1</span>
<button class="lt-button" data-variant="<?= $variant ?>">Send</button>
<button class="lt-button" data-variant="@variant">Send</button>
<button class="lt-button" data-variant="<%= variant %>">Send</button>
\`\`\`

${CHECK_IN_TESTS}

The check is also in the editor as you type. The VS Code extension
"LO-TEK for VS Code" gives completion, explanations, error messages and quick fixes in sixteen
template languages. WebStorm and IntelliJ IDEA Ultimate read
\`web-types.json\` from the package without any extension, and the plugin
"LO-TEK Interfaces" from JetBrains Marketplace adds the error messages and completion in
HTML in a string marked with \`@Language("HTML")\` or \`// language=HTML\`.

On the JVM without Node there is LO-TEK for Kotlin
(https://lo-tek.sobernetics.no/kotlin/). \`lotek.jar\` is the command line as
\`java -jar lotek.jar check\`, and is attached to every release on GitHub:
https://github.com/MarkusAugust/lo-tek/releases/latest. The Maven package
\`io.github.markusaugust:lo-tek-interfaces\` with \`assertLotek(html)\` and the
Gradle plugin \`io.github.markusaugust.lo-tek\` are on Maven Central, with the
same version as the npm package. Not every npm version is on Maven: use the
newest one there, and never write a \`version\` you have not seen on Central.`,
    pitfalls: [
      BUNDLE_MISSING,
      NO_DEFINE,
      FOREIGN_TEXT,
      NEVER_INVALID,
      SERVER_RENDERING,
      TYPESCRIPT_IN_SCRIPT,
    ],
  },
  {
    name: "bundles",
    stylesheetAddress: STYLESHEET_PACKAGE,
    title: "LO-TEK with a bundler",
    intro: `The rulebook for LO-TEK in a project with a build step, where
the markup is ordinary HTML: Vue, Svelte, Solid, Lit, and plain TypeScript
with Vite, Rollup, esbuild or webpack.

What these have in common are the three things that matter here: the
stylesheets are imported in the entry module, the attributes have their HTML
names, and \`defineLt*()\` runs at the top of \`main.ts\`. If you write React,
the attribute names differ and \`react.md\` applies instead. If you write
Astro, the stylesheets are imported in the frontmatter and \`astro.md\`
applies.`,
    stylesheetRule: `**Import the stylesheets in the entry module**, \`tokens.css\`
   first. Without them, the components look unstyled. The answer is then to
   add the import, never to write your own CSS to make them look right.`,
    pointFour: `**\`defineLt*()\` runs at the top of \`main.ts\`,** not in a
   lifecycle hook, and a boolean attribute is true as long as it is there.
   Check that what ends up in the DOM is not \`hidden="false"\`: the attribute
   must be removed, not set to \`false\`.`,
    registrationRule: `**\`defineLt*()\` runs once** at the top of the entry
   module, before the app is mounted.`,
    address: PACKAGE_NAME,
    check: "npx @lo-tek/interfaces check src/components/*.vue",
    stylesheet: `## 1. The stylesheets

${TOKENS_FIRST} After that, one per component you use, so a page with only
buttons does not load CSS for a dialog:

\`\`\`ts
// main.ts, at the top
import "@lo-tek/interfaces/tokens.css"
import "@lo-tek/interfaces/button.css"
import "@lo-tek/interfaces/field.css"
\`\`\`

The name of each stylesheet is in the tables below. The package has no
dependencies, and nothing is registered by import alone, so a page that only
uses the CSS components takes no JavaScript from the package.

If you need everything in one file, there is
\`@lo-tek/interfaces/lotek.css\`, but with a bundler it is rarely right: you
then load CSS for components the page does not use.`,
    markup: `## 5. Registration and markup

\`\`\`ts
// main.ts, at the top, not in a lifecycle hook
import "@lo-tek/interfaces/tokens.css"
import "@lo-tek/interfaces/field.css"
import { defineLtField } from "@lo-tek/interfaces/field"

defineLtField()
\`\`\`

The call is in the module, not in \`mounted\`, \`onMount\` or an effect. A hook
runs after the first paint, so the elements in the markup are plain
\`HTMLElement\`s when the framework renders them, and a call to \`show()\` or
\`reportFailure()\` before the hook fails with "is not a function". A property
set before the registration, such as \`open\`, is written through the setter
once the element is upgraded.

The markup is ordinary HTML, in whatever template your framework uses:

\`\`\`html
<lt-field>
  <label class="lt-label" for="codename" data-required="symbol">Codename</label>
  <input class="lt-input" id="codename" type="text" name="codename" required />
  <p class="lt-error-text" hidden>Enter a codename.</p>
</lt-field>

<button class="lt-button" type="submit">Order the job</button>
\`\`\`

\`class\` and \`for\`, not \`className\` and \`htmlFor\`. It is React that
rewrites the attribute names, and that does not apply here.`,
    extra: `## 6. Typed builder functions

If the project has TypeScript, the classes can come from \`lt\` instead of
being written as strings. A variant that does not exist then becomes a
compile error:

\`\`\`ts
import { lt } from "@lo-tek/interfaces"

lt.button({ variant: "secondary" })
// { class: "lt-button", "data-variant": "secondary" }
\`\`\`

The builder functions return an object with HTML attribute names, which is
spread in where the template language supports spreading, or read out field
by field. The ${countBuilderFunctions()} builder functions:

${builderFunctions()}

Where the template language cannot spread an object, \`lt.setAttributes()\`
sets the attributes on an element in plain DOM:

\`\`\`ts
const field = document.querySelector<HTMLInputElement>("#fixer")
const wiring = lt.field({ id: "fixer", error: true, invalid: true })

lt.setAttributes(field, lt.input({ type: "email" }), wiring.control)
\`\`\`

Call it again to change state. Three rules:

- **When the builder function has an option for an attribute, a call without
  the option removes the attribute.** So pass the options again every time.
  \`lt.spinner()\` without \`label\` removes \`role\` and \`aria-label\`.
- **What the builder function has no option for stays.** \`lt.button()\`
  does not touch \`disabled\` or \`type\`. \`id\` and \`for\` are never removed.
- **Two sets on the same element are passed separately**, as above. If they
  are spread together into one object, \`{ ...lt.input(), ...wiring.control }\`,
  the attributes are set, but only \`data-*\` is cleaned up on the next call.

## 7. Check the markup

\`\`\`bash
npx @lo-tek/interfaces check src/components/*.vue
\`\`\`

The check reads files as text, so it works on \`.vue\`, \`.svelte\`, \`.html\`
and whatever your templates happen to live in. One finding gives an error
code, so it belongs in CI. It catches \`lt-buton\`,
\`data-variant="secundary"\`, \`<lt-modal>\` and \`<lt-field>\` without a
control or a label, that is, everything the types do not see, because your
markup is a string to the compiler.

${CHECK_IN_TESTS}`,
    pitfalls: [
      STYLES_MISSING,
      NO_DEFINE,
      FOREIGN_TEXT,
      NEVER_INVALID,
      SERVER_RENDERING,
    ],
  },
  {
    name: "react",
    stylesheetAddress: STYLESHEET_PACKAGE,
    title: "LO-TEK in React",
    intro: `The rulebook for LO-TEK in a React app.

React differs from all the other environments in one thing, and it matters
enough to have its own file: React rewrites the attribute names. \`class\` is
\`className\` and \`for\` is \`htmlFor\`, and if you use the builder functions
from the main entry, React prints "Invalid DOM property" in the console, once
for each attribute name. That is why the package has a React entry of its own.`,
    stylesheetRule: `**Import the stylesheets in \`main.tsx\`**, \`tokens.css\`
   first. Without them, the components look unstyled. The answer is then to
   add the import, never to write your own CSS to make them look right.`,
    pointFour: `**\`defineLt*()\` runs at the top of \`main.tsx\`,** not in a
   \`useEffect\`, and a boolean attribute on a web component is set as
   \`open={isOpen || undefined}\`. The two other ways of writing it are each
   wrong in one of the React versions.`,
    registrationRule: `**\`defineLt*()\` runs once** at the top of the module,
   before \`createRoot\`, not in a \`useEffect\`.`,
    address: PACKAGE_NAME,
    check: "npx @lo-tek/interfaces check src/*.tsx",
    pointFive: `**The types are your check.** \`lt.button({ variant })\` from
   \`@lo-tek/interfaces/react\` turns a variant that does not exist into a
   compile error, and \`@lo-tek/interfaces/react-jsx\`, imported once in a
   \`.d.ts\` file, does the same for attribute names without a hyphen on the
   web components. Run \`tsc\`. TypeScript never flags an unknown attribute
   with a hyphen, such as \`close-labl\`, and most of LO-TEK's attributes have
   one, so also run \`npx @lo-tek/interfaces check src/*.tsx\`: it reads the
   attributes on the web components in the file. A hand-written \`className\`
   or \`data-variant\` is seen by none of them, since the check reads
   \`class\`, not \`className\`, so use the builder functions.`,
    stylesheet: `## 1. The stylesheets

${TOKENS_FIRST} After that, one per component you use:

\`\`\`tsx
// main.tsx, at the top
import "@lo-tek/interfaces/tokens.css"
import "@lo-tek/interfaces/field.css"
import "@lo-tek/interfaces/button.css"
\`\`\`

The name of each stylesheet is in the tables below.`,
    markup: `## 5. Registration, types and use

\`\`\`tsx
// main.tsx, runs once when the app starts
import "@lo-tek/interfaces/tokens.css"
import "@lo-tek/interfaces/field.css"
import "@lo-tek/interfaces/button.css"
import { defineLt } from "@lo-tek/interfaces/register"

defineLt()
\`\`\`

The call is at the top of the module, not in a \`useEffect\`. An effect runs
after the first paint, so the elements are plain \`HTMLElement\`s when React
renders them, and a call to \`show()\` or \`reportFailure()\` before the effect
fails with "is not a function". A property set before the registration, such
as \`open\`, is written through the setter once the element is upgraded. The
function does nothing on a server, so it
can sit in a root module that runs in both places. If you use only one
component, it has its own function, such as \`defineLtTabs()\` in
\`@lo-tek/interfaces/tabs\`.

\`\`\`ts
// src/lotek.d.ts, gives the web components types in JSX
import "@lo-tek/interfaces/react-jsx"
\`\`\`

A field is written with \`lt.field()\`. The wiring is then in the markup React
renders itself, on the server as in the browser. \`<lt-field>\` writes the
wiring on the elements before React hydrates, and with server rendering React
reports mismatches on the label, the field and the error text. Without a
server it works, but \`lt.field()\` is the way in both.

\`\`\`tsx
// JobOrder.tsx
import { lt } from "@lo-tek/interfaces/react"
import { useId, useState } from "react"

export function JobOrder() {
  const [codename, setCodename] = useState("")
  const [touched, setTouched] = useState(false)

  const invalid = touched && codename.trim() === ""
  const field = lt.field({
    id: useId(),
    required: "symbol",
    error: true,
    invalid,
  })

  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <label {...field.label}>Codename</label>
      <input
        {...lt.input({ type: "text" })}
        {...field.control}
        name="codename"
        required
        value={codename}
        onChange={(e) => setCodename(e.target.value)}
        onBlur={() => setTouched(true)}
      />
      <p {...lt.errorText()} {...field.error}>Enter a codename.</p>

      <button {...lt.button()} type="submit">Order the job</button>
    </form>
  )
}
\`\`\`

The id comes from \`useId()\`, so the server and the browser create the same
one.

\`lt\` is imported from \`@lo-tek/interfaces/react\`, never from the main
entry: the React entry gives \`className\` and \`htmlFor\`, the main entry
gives \`class\` and \`for\`. The ${countBuilderFunctions()} builder functions
are in both:

${builderFunctions()}`,
    extra: `## 6. Only \`open={isOpen || undefined}\` works

This applies to every boolean attribute on a web component, such as \`open\`
on \`<lt-dialog>\` and \`<lt-popover>\`. React treats web components
differently between versions, and only this pattern is right in both:

| How it is written | React 18 (sets attribute) | React 19 (sets property) |
| --- | --- | --- |
| \`open=""\` | works | never open |
| \`open={isOpen}\` | always open | works |
| \`open={isOpen \\|\\| undefined}\` | works | works |

React 18 stringifies \`false\` to the attribute \`open="false"\`. The
attribute is then present, and so it is true. React 19 sets the property to
\`""\`, and the component reads the empty string as false.

If you import \`@lo-tek/interfaces/react-jsx\`, the first two forms become
compile errors.

The builder functions pass \`true\` or nothing, so
\`{...lt.dialog({ titleId, open: isOpen }).host}\` is already right.

## 7. The types

Without \`@lo-tek/interfaces/react-jsx\` TypeScript does not know
\`<lt-field>\` at all, and you get \`Property 'lt-field' does not exist on type
'JSX.IntrinsicElements'\`. With it you get autocompletion and errors on the
attributes:

\`\`\`tsx
<lt-field describedBy="terms" />         // error: the attribute is described-by
<lt-toast closeLabel="Close" />          // error: the attribute is close-label
<lt-connection-status offline="Down" />  // error: unknown attribute
\`\`\`

The types work by the package extending React's \`JSX.IntrinsicElements\`. If
the project has two installations of \`@types/react\`, which easily happens in
a monorepo, the package extends one while your code uses the other, and the
elements stay unknown. Run \`npm ls @types/react\` if something looks odd.`,
    pitfalls: [
      STYLES_MISSING,
      NO_DEFINE,
      FOREIGN_TEXT,
      NEVER_INVALID,
      SERVER_RENDERING,
      [
        '"Invalid DOM property `class`"',
        "`lt` is imported from the main entry. Use `@lo-tek/interfaces/react`",
      ],
      [
        "`Property 'lt-field' does not exist`",
        "`@lo-tek/interfaces/react-jsx` is not imported in a `.d.ts` file",
      ],
    ],
  },
  {
    name: "astro",
    stylesheetAddress: STYLESHEET_PACKAGE,
    title: "LO-TEK in Astro",
    intro: `The rulebook for LO-TEK in an Astro project.

An \`.astro\` file is HTML with frontmatter above it. The stylesheets are
imported there, and the builder functions are used directly in the template,
since Astro supports spreading like JSX. What is particular is that all of
this runs at build time: out comes plain HTML, and \`lt\` is gone once the
page is built. The only JavaScript the browser gets from the package is the
registration of the web components you use, in a \`<script>\`.`,
    stylesheetRule: `**Import the stylesheets in the frontmatter**, \`tokens.css\`
   first. Without them, the components look unstyled. The answer is then to
   add the import, never to write your own CSS to make them look right.`,
    pointFour: `**\`defineLt*()\` belongs in a \`<script>\` in the template, never
   in the frontmatter:** the frontmatter runs at build time, or on the server
   when a page is rendered on demand, and \`customElements\` exists in
   neither. And a boolean attribute is true as long
   as it is there.`,
    registrationRule: `**\`defineLt*()\` runs once** in a \`<script>\` in the
   template. Astro bundles \`<script>\` tags and runs them on the client.`,
    address: PACKAGE_NAME,
    check: "npx @lo-tek/interfaces check src/pages/*.astro",
    checkBlindSpot: `It reads the file as text, so it does not see what a
   spread such as \`{...lt.button()}\` writes; the check on the running page
   below does.`,
    devUrl: "http://localhost:4321",
    stylesheet: `## 1. The stylesheets

${TOKENS_FIRST} The imports go in the frontmatter:

\`\`\`astro
---
import "@lo-tek/interfaces/tokens.css"
import "@lo-tek/interfaces/button.css"
import "@lo-tek/interfaces/badge.css"
---
\`\`\`

The name of each stylesheet is in the tables below. If you have a layout
component, \`tokens.css\` belongs there, once for the whole page.`,
    markup: `## 5. The builder functions in the template

\`\`\`astro
---
import { lt } from "@lo-tek/interfaces"
import "@lo-tek/interfaces/tokens.css"
import "@lo-tek/interfaces/button.css"
import "@lo-tek/interfaces/badge.css"
---

<button {...lt.button({ variant: "secondary" })}>Save draft</button>
<span {...lt.badge({ color: "success" })}>Approved</span>
\`\`\`

Runs at build time. Out comes plain HTML:

\`\`\`html
<button class="lt-button" data-variant="secondary">Save draft</button>
<span class="lt-badge" data-color="success">Approved</span>
\`\`\`

\`lt\` is imported from the main entry, which gives \`class\` and \`for\`. The
${countBuilderFunctions()} builder functions:

${builderFunctions()}`,
    extra: `## 6. Fields without JavaScript

\`lt.field()\` works out the wiring between label, control, help text and
error text in the frontmatter, so that too becomes static HTML:

\`\`\`astro
---
import { lt } from "@lo-tek/interfaces"
import "@lo-tek/interfaces/tokens.css"
import "@lo-tek/interfaces/field.css"

const fixer = lt.field({ id: "fixer", required: "symbol", help: true, error: true })
---

<label {...fixer.label}>Fixer's address</label>
<input {...lt.input({ type: "email" })} {...fixer.control} name="fixer" required />
<p {...lt.helpText()} {...fixer.help}>The board writes to the fixer, never to the crew.</p>
<p {...lt.errorText()} {...fixer.error}>Enter a valid address.</p>
\`\`\`

No \`<lt-field>\`, no runtime.

## 7. Web components in Astro

If the field should be able to become invalid while the user is in it, the
component has to be registered. It wires the error text to the field when it
shows:

\`\`\`astro
---
import "@lo-tek/interfaces/tokens.css"
import "@lo-tek/interfaces/field.css"
---

<lt-field>
  <label class="lt-label" for="codename" data-required="symbol">Codename</label>
  <input class="lt-input" id="codename" type="text" name="codename" required />
  <p class="lt-error-text" hidden>Enter a codename.</p>
</lt-field>

<script>
  import { defineLtField } from "@lo-tek/interfaces/field"
  defineLtField()
</script>
\`\`\`

\`customElements\` exists only in the browser, so the registration cannot be
in the frontmatter. A \`<script>\` in the template is all it takes: the
components are ordinary web components, and need neither an Astro
integration nor a \`client:\` directive.`,
    pitfalls: [
      STYLES_MISSING,
      NO_DEFINE,
      FOREIGN_TEXT,
      NEVER_INVALID,
      [
        "The component does nothing, and nothing says so",
        "The registration is in the frontmatter, which never runs in the browser. It belongs in a `<script>` in the template",
      ],
    ],
  },
  {
    name: "datastar",
    stylesheetAddress: STYLESHEET_URL,
    title: "LO-TEK with Datastar",
    intro: `The rulebook for LO-TEK together with
[Datastar](https://data-star.dev), which adds reactivity to ordinary HTML with
\`data-*\` attributes. One script, no build step, the same premise as LO-TEK.

That means two things for this file: the addresses are URLs, since a browser
without a bundler does not resolve a package name, and the state is
controlled with attributes, which is exactly what the \`frame\` components
expect.`,
    stylesheetRule: `**One \`<link>\` to \`lotek.css\`, before everything else.**
   Without it, the components look unstyled. The answer is then to add the
   link, never to write your own CSS to make them look right.`,
    pointFour: `**\`defineLt*()\` runs once in a \`<script type="module">\` with
   the full URL,** and the state is set with \`data-attr:\`, which adds and
   removes the attribute. \`hidden="false"\` would hide the error text all
   the same.`,
    registrationRule: `**\`defineLt*()\` runs once** in a
   \`<script type="module">\` in the page template.`,
    address: URL_FOR,
    check: "npx @lo-tek/interfaces check page.html",
    stylesheet: `## 1. The stylesheet and Datastar

\`\`\`html
<link rel="stylesheet" href="${cdnUrl("lotek.css")}">
<script
  type="module"
  src="https://cdn.jsdelivr.net/gh/starfederation/datastar@v1.0.4/bundles/datastar.js"
></script>
\`\`\`

\`lotek.css\` is ${BUNDLED_SIZE}, and has all the components. If you want
only what you use, ${TOKENS_FIRST}`,
    markup: `## 5. A form with Datastar

\`\`\`html
<form
  data-signals="{codename: '', touched: false}"
  data-computed:invalid="$touched && $codename.trim() === ''"
>
  <lt-field>
    <label class="lt-label" for="codename" data-required="symbol">Codename</label>
    <input
      class="lt-input"
      id="codename"
      type="text"
      name="codename"
      data-bind:codename
      data-on:blur="$touched = true"
    />
    <p class="lt-error-text" hidden data-attr:hidden="!$invalid">Enter a codename.</p>
  </lt-field>

  <button class="lt-button" type="submit">Order the job</button>
</form>

<script type="module">
  import { defineLtField } from
    "${cdnUrl("field")}"

  defineLtField()
</script>
\`\`\`

\`data-signals\` creates the state, \`data-computed:invalid\` derives the
validation from it, \`data-bind:codename\` binds the field both ways, and
\`data-on:blur\` records that the user has left it.

\`data-attr:hidden\` on the error text is the link to the component: it sets
\`hidden\` when the field is valid and removes it when it is invalid, and
\`<lt-field>\` counts the field as invalid when the error text is visible.
None of the React pitfalls exist here. Datastar works directly on the
attributes.`,
    extra: `## 6. HTML from the server

Datastar can let the server send HTML as the page runs, over Server-Sent
Events. A web component upgrades itself when it is inserted into the
document, as long as \`defineLtField()\` has run once. The server can
therefore send this as plain HTML:

\`\`\`html
<lt-field>
  <label class="lt-label" for="fixer" data-required="text">Fixer's address</label>
  <input class="lt-input" id="fixer" type="email" value="fixer@" />
  <p class="lt-help-text">The board writes to the fixer, never to the crew.</p>
  <p class="lt-error-text">Enter a valid address.</p>
</lt-field>
\`\`\`

The component then gives the help text and the error text ids, adds \`aria-invalid\` because the error text is visible, and builds
\`aria-describedby\`, without any JavaScript being sent for this particular
field. That is the point of the \`frame\` components living in plain DOM: the
markup is the data, and the accessibility is wired where it lands.

If the server patches a component that holds state, the question is what
decides it. By default the web component does: \`<lt-tabs>\` remembers the
tab the user selected, and puts it back after a patch. \`outer\` and \`inner\`
morph, so the links are kept and the selection with them. \`replace\`
replaces the nodes, and then the component selects the tab the server marked
with \`aria-selected="true"\`, otherwise the one the URL points to, otherwise
the one whose panel the server left without \`hidden\`, otherwise the first.
And a morph keeps an element only when the ids match: an element with an id
the server did not send is replaced. The components therefore never write an id on what the user
touches. The tabs are links without an id, and the panels have the id the
link points to, the same on every render, as \`lt.tabs()\` writes it. The
panel in \`<lt-popover>\` needs an id in the same way; the component creates
none. The control in \`<lt-field>\` and the field in \`<lt-suggestion>\` never
get an id from the component: the template writes \`for\` and \`id\`, which
HTML requires for the field to have a name without JavaScript, or the label
wraps the field and no id is needed. \`<lt-field>\` and \`<lt-suggestion>\`
warn in the console when a patch replaces the field with one that has another
id, the same \`name\` and another value, and \`<lt-popover>\` when a patch
replaces the open panel with one that has another id. \`<lt-tabs>\` repairs
the selection without a word. If the server
should be able to move the tab, say so with \`server-controlled\`:

\`\`\`html
<lt-tabs server-controlled data-on:tab-select="$tab = evt.detail.index">
  <ul class="lt-tabs__list" aria-label="Parts of the claim">
    <li><a href="#claim">Claim</a></li>
    <li><a href="#attachments">Attachments</a></li>
  </ul>
  <section class="lt-tabs__panel" id="claim">…</section>
  <section class="lt-tabs__panel" id="attachments" hidden="until-found">…</section>
</lt-tabs>
\`\`\`

The attribute exists on \`<lt-tabs>\`, \`<lt-popover>\`, \`<lt-dialog>\` and
\`<lt-suggestion>\`. Without it the server and the component would fight over
the same state.

\`lt\` can be used on the server or in a build step. Datastar does not need it
in the browser.`,
    pitfalls: [
      BUNDLE_MISSING,
      NO_DEFINE,
      FOREIGN_TEXT,
      NEVER_INVALID,
      TYPESCRIPT_IN_SCRIPT,
    ],
  },
]

/** The files the generator writes, with the content they should have. */
export function files(): Record<string, string> {
  const out: Record<string, string> = {}

  for (const recipe of RECIPES) {
    out[`agent/${recipe.name}.md`] = assemble(recipe)
  }

  return out
}

function assemble(recipe: Recipe): string {
  return reflow(
    `${[
      `# ${recipe.title}`,
      recipe.intro,
      `This is @lo-tek/interfaces ${VERSION}. The file is generated by the package and follows its version, so it can never say anything other than the code next to it.`,
      shortVersion(recipe),
      recipe.stylesheet,
      whatExists(recipe),
      TOKENS,
      THEME(recipe),
      webComponents(recipe),
      recipe.markup,
      ...(recipe.extra ? [recipe.extra] : []),
      pitfalls(recipe.pitfalls),
      CLOSING,
    ].join("\n\n")}\n`,
  )
}

/** The names the command knows, read from the recipes. */
export const NAMES = RECIPES.map((recipe) => recipe.name)

if (import.meta.main) {
  const written = files()
  for (const [path, content] of Object.entries(written)) {
    writeFileSync(join(PACKAGE, path), content)
  }
  console.log(
    `✓ ${Object.keys(written).length} rulebooks: ${NAMES.join(", ")} (${countCssComponents()} CSS components, ${countElements()} elements, ${builderFunctions().split(", ").length} builder functions)`,
  )
}
