# @lo-tek/interfaces

A framework-agnostic design system for the web: tokens, CSS components and web components. Everything is built on things the browser already understands, so the same components work in plain HTML, React, Astro and [Datastar](https://data-star.dev).

> LO-TEK is pre-1.0. A minor version can contain breaking changes, and they are listed under "Breaking" (in versions up to 0.36.0, "Brytende") in the [changelog](https://github.com/MarkusAugust/lo-tek/blob/master/interfaces/CHANGELOG.md).

The full documentation, with component pages, tokens, patterns and examples for four environments, is at **[lo-tek.sobernetics.no](https://lo-tek.sobernetics.no/)**.

**Coding agents** find the rules at [lo-tek.sobernetics.no/llms.txt](https://lo-tek.sobernetics.no/llms.txt), with one rulebook per environment, described under [Coding agents](https://lo-tek.sobernetics.no/coding-agents/). The same rulebooks ship in the package, in `node_modules/@lo-tek/interfaces/agent/`.

## Installation

```bash
npm install @lo-tek/interfaces
```

The package has no dependencies. The web components are plain `HTMLElement` classes, and nothing is registered on import alone, so you only pay for what you actually call.

## CSS components

A class and a few `data-*` attributes, no JavaScript. `tokens.css` defines the variables everything else builds on, so it has to be loaded. It comes first out of habit; the order makes no difference.

With a build step you import only the stylesheets you use, so a page with only buttons does not load CSS for a dialog:

```js
import "@lo-tek/interfaces/tokens.css"
import "@lo-tek/interfaces/button.css"
```

Without a build step you link the combined file, which has everything in it:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@lo-tek/interfaces/dist/lotek.css" />
```

The markup is the same whichever of the two you chose:

```html
<button class="lt-button">Order the job</button>
<button class="lt-button" data-variant="secondary">Save draft</button>
```

## The attributes as functions

`lt` gives the same classes and attributes with completion and type checking in the editor. Each component takes one object of options and returns the attributes:

```js
import { lt } from "@lo-tek/interfaces"

lt.button({ variant: "secondary" })
// { class: "lt-button", "data-variant": "secondary" }
```

In React you import from `@lo-tek/interfaces/react`, which gives `className` and `htmlFor` instead of the HTML names:

```jsx
import { lt } from "@lo-tek/interfaces/react"

<button {...lt.button({ variant: "secondary" })}>Save draft</button>
```

## Web components

Nothing is registered on import alone. You call `defineLt*` yourself, so you decide when the element exists:

```js
import { defineLtToast } from "@lo-tek/interfaces/toast"
import "@lo-tek/interfaces/tokens.css"
import "@lo-tek/interfaces/toast.css"

defineLtToast()
```

```html
<lt-toast class="lt-toast" role="status" aria-live="polite" aria-atomic="false"
          aria-label="Notifications" data-ignore-morph></lt-toast>
```

Every `defineLt*` also takes a tag name of your choice, such as `defineLtToast("app-toast")`, and repeated calls are harmless, also alongside `defineLt()`. The stylesheets are still written for the `lt-*` names: an `<lt-field>` registered as `<my-field>` still wires the label to the field, but the `display` rule on the element name does not follow, `<lt-tabs>` and `<lt-suggestion>` do not hide their content before registration, and `<lt-dialog>` no longer positions a dialog that is open before it is modal. The four that set their class themselves, `<lt-toast>`, `<lt-session-timeout>`, `<lt-connection-status>` and `<lt-error-summary>`, look the same under another name.

## The server writes the markup

LO-TEK is built for apps where the HTML comes from the server, whether that is TanStack Start, React Server Components or Datastar. No web component creates nodes in markup the server has sent, because the surrounding framework would tear them out again on the next update.

The builder functions in `lt` give the markup, the components give the behaviour, and the two do not overlap:

```js
import { lt } from "@lo-tek/interfaces"

lt.errorSummary({ count: 2, id: "errors" })
// { host:  { class: "lt-error-summary", role: "alert", tabindex: "-1", id: "errors",
//            "aria-labelledby": "errors-title" },
//   title: { class: "lt-error-summary__title", id: "errors-title" } }
```

`id` is required in `lt.field()`, `lt.suggestion()`, `lt.tabs()` and `lt.popover()`, and `titleId` in `lt.dialog()`. `lt.tabs()` and `lt.suggestion()` also take `keys`, one key from the data per tab or option, and `lt.tabs()` requires `label`, the name of the tab list. The reason is hydration: if the function creates the id itself, the server and the browser each create their own, and the wiring between the parts is broken until React has corrected it. In React it comes from `useId()`. In `lt.errorSummary()` both are optional: `id` names the box so that something else can point to it, and `titleId`, the heading's id that names the box, defaults to the `id` with `-title`. Without either, the heading has no id and the box no name, and the web component says so in the console.

The full reasoning, with the tests behind it, is on [Markup and behaviour](https://lo-tek.sobernetics.no/markup-and-behaviour/).

## Your own colour theme

The CLI creates a complete theme from your brand colours, with the contrast requirements computed in OKLCH:

```bash
npx @lo-tek/interfaces theme --accent=#7c3aed --danger=#b3261e \
  --success=#2b6940 --warning=#8a5a00 --neutral=#1a1a1a --out=theme.css
```

If customising through CSS is not enough, `takeover` copies the source code of one component into your project, with the imports rewritten:

```bash
npx @lo-tek/interfaces takeover button --out=src/ui
```

`npx @lo-tek/interfaces --help` shows the rest.

## Customising

The components are in `@layer lotek`, so your own rules win without `!important`. If you embed a component in a page you do not control, `data-lt-boundary` on the root element gives LO-TEK its styles back where the host's unlayered CSS would otherwise take them; see Customising in the documentation. Shape and size are read from `--lt-*` variables with the token value as fallback:

```css
.lt-button {
  --lt-button-padding: var(--lt-spacing-3) var(--lt-spacing-6);
}
```

Tailwind is optional. The theme is a plain CSS file, `@lo-tek/interfaces/tailwind.css`, so the package has no dependency on Tailwind and cannot conflict with your version.

## Licence

MIT
