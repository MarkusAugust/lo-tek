# LO-TEK Design System

LO-TEK is a framework-agnostic design system for the web. The components are CSS classes and web components, things the browser already understands. A design system tied to one framework has to be rewritten when the framework is replaced. The browser's own APIs are not replaced.

**If you want to use LO-TEK in an app, everything is in the [documentation](https://lo-tek.sobernetics.no/).** It covers installation, the component pages, tokens, customising, the Tailwind setup and examples for plain HTML, React, Astro and Datastar. This file is about working on LO-TEK, not about using it.

**Coding agents** find the rules at [lo-tek.sobernetics.no/llms.txt](https://lo-tek.sobernetics.no/llms.txt), with one rulebook per environment under [`/coding-agents/`](https://lo-tek.sobernetics.no/coding-agents/). The same rulebooks ship in the package, in `node_modules/@lo-tek/interfaces/agent/`.

## Status

LO-TEK is pre-1.0. A minor version can contain breaking changes, and they are listed under
"Breaking" in the [changelog](interfaces/CHANGELOG.md).

Contributions from others happen only by agreement with the maintainer.

### Planned

What is coming, and in what order, is on the
[roadmap](https://lo-tek.sobernetics.no/roadmap/). The page lives in
`documentation/src/content/docs/roadmap.mdx`, and it is the only place
the plans are written down, so the README and the documentation cannot disagree.

## The repository

A Bun monorepo with three workspaces, a Cargo workspace for the Rust code, and two Gradle projects alongside:

| Folder | Package | Contents |
| --- | --- | --- |
| `interfaces/` | `@lo-tek/interfaces` | tokens, CSS components, web components, the theme generator |
| `documentation/` | `@lo-tek/documentation` | Astro 6 + Starlight, the demos and the checks of them |
| `vscode/` | `interfaces` | the VS Code extension: completion, snippets and diagnostics |
| `core/` | `lotek-core`, a Cargo crate | the check and the theme generator in Rust, compiled to WebAssembly |
| `cli/` | `lotek`, a Cargo crate | the command line, `lotek` |
| `kotlin/` | not a bun workspace | LO-TEK for Kotlin and Java, built with Gradle |
| `intellij/` | not a bun workspace | the IntelliJ plugin, built with Gradle |

The components live under `interfaces/src/components/`, split into three categories by who creates the markup and whether a web component adds behaviour to it:

- `css/<component>/`: a class and `data-*` attributes, no JavaScript.
- `frame/<component>/`: a web component that wires together the elements you put in yourself, such as `<lt-field>`.
- `standalone/<component>/`: a web component that creates all its content itself, because there is nothing for the server to send, such as `<lt-connection-status>`.

No component uses shadow DOM. The category says who creates the nodes: the renderer, or the web component itself. How to add a new component is under [New component](#new-component), and the workflow is in [CONTRIBUTING.md](CONTRIBUTING.md).

## Local development

Prerequisites: Bun and Rust ([rustup](https://rustup.rs)). `bun run check` also needs Java 17 or later, see [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
bun install
bun run build   # must run once: the documentation reads from interfaces/dist
bun run dev     # the documentation site
```

The build also generates `tokens.css` from `tokens.ts`. If you change TypeScript or tokens in the package, run `bun run build` again.

```bash
bun run lint             # Biome, has the last word on formatting
bun run typecheck        # tsc -b
bun run typecheck:tests  # the tests, which tsc -b does not read
bun run test             # the browser tests in Chromium, Firefox and WebKit
bun run test:docs        # the checks against the built documentation
bun run check            # the steps in ci.yml, in the same order as CI
```

The browsers are installed with `bun --filter @lo-tek/interfaces browsers`.

## Workflow

`master` is protected and must always be green, so all work goes through a branch and a pull request. Run `bun run check` before you send anything off. The whole flow, including how a version is released, is in [CONTRIBUTING.md](CONTRIBUTING.md). Changes a consumer will notice go into [interfaces/CHANGELOG.md](interfaces/CHANGELOG.md) in the same pull request.

## New component

1. Create the folder under the right category, with the component, the stylesheet and a `*.browser.test.ts` next to them.
2. Add `exports` entries in `interfaces/package.json`, for both CSS and JS.
3. Add the builder function to `lt` in `interfaces/src/lt.ts`, and export from `interfaces/src/index.ts` what belongs there.
4. Declare the element and its properties in `interfaces/src/jsx/react.ts`.
5. Add the stylesheet to `STYLESHEETS` in `documentation/src/components/Preview.astro`, otherwise the styles are missing from the examples.
6. Write the component page under `documentation/src/content/docs/components/` and add it to the sidebar in `documentation/astro.config.mjs`.

The builder function comes along to `@lo-tek/interfaces/react` by itself: `interfaces/src/react.ts` goes over `lt` and gives every attribute set the React names. Only a builder function whose React result must differ, as `lt.tabs()` with the whole state, stands there by hand. Step 4 is not optional: a test reads `static observedAttributes` from the components and requires every attribute to be declared for JSX.

Eight checks keep this in place, and `bun run check` runs them:

| Check | What it requires |
| --- | --- |
| `package-css.browser.test.ts` | Everything except the boundary against a host page is in `@layer lotek`, nothing comes after the layer, every class has the `lt-` prefix in kebab-case, and every token a fallback points to exists |
| `lt.browser.test.ts` | Every builder function in `lt` returns a class and no `undefined` attributes |
| `check-exports.ts` | Everything `exports` promises ends up in the tarball, no test files do, and every map in the package points to a file that is included |
| `check-types.ts` | Every entry point to the web components types `querySelector` and `addEventListener` on its own, `/register` and `/react-jsx` included |
| `check-documentation.ts` | The component has a page that mentions each of its classes and each of its `--lt-` variables, as whole words |
| `check-test-files.ts` | The component folder has at least one `*.browser.test.ts` |
| `react.browser.test.ts` | Every builder function exists in `/react`, and none emits an attribute React spells differently |
| `check-writes.ts` | Every write in a frame component goes through `setAttr`, `setFlag` and `addClass` |

### Naming conventions

| Thing | Form | Example |
| --- | --- | --- |
| CSS class | `lt-` + kebab-case | `lt-session-timeout` |
| Web component | `lt-` + kebab-case | `<lt-session-timeout>` |
| Class | `Lt` + PascalCase | `LtSessionTimeout` |
| Registration function | `defineLt` + PascalCase | `defineLtSessionTimeout()` |
| Tag constant | `LT_` + SCREAMING_SNAKE | `LT_SESSION_TIMEOUT_TAG` |
| Variant | `data-variant` | `data-variant="secondary"` |
| State | `data-state` | `data-state="invalid"` |

### Two things that are easy to get wrong

**Always use tokens in CSS:** `var(--lt-color-…)`, `var(--lt-spacing-…)`. Hard-coded colours and pixel values do not belong in a component.

**Register web components in an exported `defineLt*` function**, which goes through `defineElement`. The consumer then decides when the element is registered, the package has no side effects on import, and the module can be loaded on a server without a DOM.

## Tokens

`tokens.css` is generated, and changes made directly in it are overwritten. The source is `interfaces/src/tokens/tokens.ts` for everything except colour. The colours have no value written down anywhere: the brand colours, the lightness per role and the promises are in `src/tokens/color-contract.json`, and the core in `core/` computes the colours from them. To move a colour, that is the file you edit:

```bash
bun --filter @lo-tek/interfaces generate
```

The colours are a matrix of **family**, what the colour means, and **role**, what it does. The name is `--lt-color-<family>-<role>`, such as `--lt-color-danger-fill`. Every family has every role, and the role sets the lightness, so the contrast can be guaranteed whatever the brand colour.

Note the difference between `disabled` and `neutral`. `disabled` is for controls that are switched off, and is exempt from the contrast requirement in WCAG 1.4.3. `neutral` is for muted information the user actually has to read or press, and must hold 4.5:1.

The theme generator builds a complete theme from a consumer's brand colours. It is written in Rust, in `core/src/theme/`, and reaches JavaScript through `@lo-tek/interfaces/theme`. The promises it has to keep are in `src/tokens/color-contract.json`, and the same promises check LO-TEK's own colours. The tests for the contract are in `core/src/theme/tests.rs`.

## Tests

Every component has a `*.browser.test.ts` next to it, which runs in Chromium, Firefox and WebKit through Playwright. That is not decoration: the whole premise is that we use the browser's own APIs, and those are exactly what differ between browsers.

Test what the component promises to the outside, meaning classes, attributes, `aria-*` wiring and events, not internal details.

Every component also has an accessibility test that runs axe against WCAG 2.1 level A and AA:

```ts
import {
	expectNoAccessibilityViolations,
	mount,
	waitForPaint,
} from "../../../testing/a11y"

it("has enough contrast in every variant", async () => {
	mount(`
		<span class="lt-my-component">Content</span>
		<span class="lt-my-component" data-variant="primary">Content</span>
	`)

	await waitForPaint()
	await expectNoAccessibilityViolations()
})
```

`mount` sets up a surface with the design system's page colours. That part is not decoration: axe computes contrast by searching upwards for a background colour, and if it finds none, it reports "incomplete" instead of giving an answer.

Write the markup the way the component will actually be used, with a label on the field and text in the badge. If you test markup nobody would write, you test nothing. Axe catches contrast, missing labels and wrong use of `aria-*`. It does not catch focus handling, so if the component moves focus, that needs its own test.

### The checks against the documentation

The component tests run against the components in isolation, and so do not catch errors that only appear once they are placed on a page. `bun run test:docs` runs against the built site: axe in both themes, that the documentation mentions what the code has, that the demos on the pattern pages still work, and that nothing ends up off screen on a phone.

## Licence and name

LO-TEK is released under MIT. It costs nothing, and every version that has been released stays MIT:
that permission cannot be withdrawn, not even by me. You can use it commercially,
modify it and ship it in a closed product. The only condition is that the copyright notice
comes with it.

The name LO-TEK and the mark are not part of that permission. You are free to fork the code, but
not to call the result LO-TEK or publish under that name.

Contributions: issues are always welcome. Pull requests are accepted after a conversation first, and the
contributor signs [CLA.md](CLA.md). The full picture is in the [documentation](https://lo-tek.sobernetics.no/licence/).

---

<a href="https://sobernetics.no">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/sobernetics-dark.svg">
    <img alt="Søbernetics" src=".github/sobernetics-light.svg" height="18">
  </picture>
</a>
