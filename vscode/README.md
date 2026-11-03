# LO-TEK for VS Code

Completion, hover, snippets, diagnostics and quick fixes for
[LO-TEK](https://lo-tek.sobernetics.no/): the `<lt-*>` elements, the `lt-` classes
and their variants, in HTML and in template languages.

If you write JSX, or call `Lt` in Kotlin, you do not need the extension: there the
same comes from the types in `@lo-tek/interfaces/react-jsx` and from the enums. The
extension is for markup written where no builder function can be called, such as a
Go template, a Razor view or hand-written HTML, where no compiler looks at the
attributes.

## Getting started

1. **Install the extension.** Search for "LO-TEK" under Extensions in VS Code,
   or run `code --install-extension lo-tek.interfaces`.
2. **Install LO-TEK in the app.** The package has no dependencies:

   ```bash
   npm install @lo-tek/interfaces
   ```

   Include the tokens and the stylesheet for what you use, and register
   the web components you use, once for the whole app:

   ```js
   import "@lo-tek/interfaces/tokens.css"
   import "@lo-tek/interfaces/field.css"
   import { defineLtField } from "@lo-tek/interfaces/field"

   defineLtField()
   ```

   Without build tools the same files are fetched from a CDN. That, and the rest, is
   in [Getting started](https://lo-tek.sobernetics.no/getting-started/).
3. **Write the markup.** Open an HTML file, type `<lt-` and pick from the list, or
   type `lt-field` and press Tab for the markup from the component page. Hover
   over an element for the explanation, and look for red and yellow squiggles.

## What you get

- **Completion** of `<lt-field>`, `<lt-popover>` and the other elements, with
  their attributes and the allowed values. Inside `class="…"` the
  `lt-` classes are completed, and inside an attribute a class takes, such as `data-variant`
  on `lt-button`, the values the builder function knows are completed.
- **Hover** over an `lt-` class, and in HTML files
  also over an element or an attribute, with a link to the component page.
- **Snippets**: type `lt-popover`, choose the snippet at the top of the list, and
  the markup from the component page is there. The id is a tab stop: type it
  once, and the `for` on the label and the `href` on the tabs follow.
  The extension puts snippets at the top in HTML files, because otherwise Emmet is
  there: `lt-popover` is also an Emmet abbreviation, and Tab takes whatever is
  at the top.
- **Diagnostics**, as red and yellow squiggles with the component page as a link: an
  `<lt-…>` element that does not exist, an attribute the element does not have, a value
  outside the list, a number that is not a number, a boolean attribute with a value,
  such as `open="false"` on `<lt-popover>`, which means open, a class such as `lt-buton`, and `data-variant="ghots"` on a button. `<lt-field>` without a control or without a label gets the same message
  the component gives in the browser, with the same exceptions, and one limit: a
  `<label for>` outside the field has to be in the same file, because the extension sees one file
  at a time. Comments, scripts and stylesheets are not read, and where there is
  template syntax, Go, Jinja, PHP, ASP, JS templates or Razor, it stays away:
  a template is not complete, and the control can be in a partial. It also checks
  what the template has to write itself for the components to work without JavaScript
  and survive an update from the server: a label that neither has
  `for` pointing to the field nor wraps it, a panel in `<lt-popover>` without an id,
  a tab that points to a panel that does not exist, a tab list without a name,
  `role="tab"` on something that is not a link, help text inside `<label>`,
  `data-value` without `.lt-suggestion__value`, a hidden error text next to
  `aria-invalid="true"`, the removed attributes on `<lt-field>`, and an
  id the component created itself, copied in from DevTools. Where the id is bound,
  such as `:id`, `th:id` or `asp-for`, it stays silent.

- **Quick fixes** where there is one right answer: the light bulb changes
  `lt-buton` to `lt-button` and `onlinetext` to `online-text`, removes
  a boolean attribute with a value, such as `open="false"`, and the removed attributes, inserts a label in a
  field that lacks one, gives the tab list a name, and gives the field an id and the label
  `for` in one step, from the field's `name`.

What the extension does not do is validate HTML. One `</body>` too many is a
job for an HTML linter, and LO-TEK only reports on LO-TEK.

## Template languages

The diagnostics, quick fixes, classes and hover work in PHP, Razor,
Astro, Svelte, Vue, Twig, Blade, Jinja, Django, Handlebars, ERB, Go templates,
EJS, Liquid, Nunjucks and Edge, and in HTML. The list is the setting
`lotek.languages`, with VS Code's language ids, and can be changed. The
snippets apply in the twenty language ids of the default list, whatever the
setting says, since their languages are written into the snippet file when the extension is built. Outside
HTML the `<lt-…>` elements and their attributes are also completed by the extension
itself, since VS Code's own HTML service only runs in HTML files.

Files with an extension other than the one the language expects can be associated with it in
the settings, for example `"files.associations": { "*.gohtml": "html" }`.

## JetBrains

If you use IntelliJ IDEA Ultimate or WebStorm, you need no extension:
the npm package includes `web-types.json`, JetBrains' format, and
the IDE picks it up as soon as `@lo-tek/interfaces` is in
`package.json`. Checked in IntelliJ IDEA Ultimate 2026.2, with completion of the elements, attributes
and values, and hover with a link. The diagnostics and quick fixes
come with the plugin "LO-TEK Interfaces" from JetBrains Marketplace, which also gives
completion in HTML in a string marked with `@Language("HTML")`. See [JetBrains](https://lo-tek.sobernetics.no/the-editor/#jetbrains) in the documentation. Neovim, Helix
and other editors with LSP can use `lotek lsp`.

## How it is made

The completion, the snippets and the lists the diagnostics check against are generated from
the components and the component pages in the
[repository](https://github.com/MarkusAugust/lo-tek). The elements come from
`interfaces/scripts/metadata.ts`, the classes from the package's CSS, and what each class takes is read by
calling the builder functions in `lt`, so `data-variant="ghost"` is allowed because
`lt.button({ variant: "ghost" })` returns it. `bun run build` in the package writes
the files again before any check reads them, and CI fails a change where what the build wrote
is not committed. The diagnostics are
a pure function with no VS Code in it, and `core/scripts/check-diagnostics.ts` runs
it over every error type it is meant to catch. See `CONTRIBUTING.md` in the repository.
