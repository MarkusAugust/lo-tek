# Changes in LO-TEK for VS Code

The extension has its own version number. It does not follow the package,
since it only changes when an element or an attribute does.

## 0.13.0

The checker and the vocabulary from `@lo-tek/interfaces` 0.41.0.

- **`<lt-term>` and `lt-steps`.** Completion and hover for the term, a word
  that shows its entry from a glossary, with the classes `lt-term` and
  `lt-term__entry`, and for the step indicator `lt-steps`. A snippet for
  the term, from the recipe on its page.
- **`term-without-entry`, a finding on a whole page,** when a word in
  `<lt-term>` points at an id the page does not have, or at something that
  is not a glossary entry.
- **`untranslated-text` covers the step indicator's "Completed "** on a
  page in another language, when the stylesheets do not set
  `--lt-steps-done-text`.

## 0.12.0

- **The snippets leave the ids empty.** They filled in the id from the
  recipe, such as `codename`, so a snippet pasted twice on a page, or in a
  loop, gave two elements with the same id, which a morph matches wrongly.
  The id is still one tab stop, mirrored in `for` and `href`.
- **The descriptions say "with a builder function" where they said "with
  JavaScript".** The line between `lt.field()` and `<lt-field>` is whether
  the code that renders can call a builder function, and a Kotlin or Java
  server does that without JavaScript.

## 0.11.0

The checker from `@lo-tek/interfaces` 0.38.0.

- **One rule for a missing name, `without-name`, an error.** It replaces
  `icon-without-name`, `control-without-label`, `tab-list-without-name`
  and `field-without-label`; a `<!-- lotek-ignore-next -->` naming one of
  them has to name `without-name`. It covers every role WAI-ARIA requires a
  name for on LO-TEK's elements and classes and on every button and link,
  computes the name as the browser does, a `<title>` in an svg included,
  and says nothing where a binding, a template or another part of the page
  could give one.
- **`untranslated-text`, a warning,** when a LO-TEK component shows one of
  its own English default texts on a page whose nearest `lang` is another
  language.

## 0.10.1

- The snippets are one snippet file, `lotek.code-snippets`, with the
  twenty languages as the scope of every snippet, instead of twenty
  contributions with a language each. VS Code reported "Unknown language"
  in the extension's runtime status for every contributed language no
  installed extension registers, sixteen of the twenty on a machine with
  none of the template-language extensions. The snippets worked where the
  language existed; the marks were the only symptom. A scope is read when
  the snippet is offered and never validated, so the marks are gone, and
  nothing else changes: the same snippets, in the same languages, through
  VS Code's own snippet service. As before, the snippets apply in the
  twenty languages of the default list and do not follow a changed
  `lotek.languages`.

## 0.10.0

In step with the package's 0.37.0, the first under the `lt-` prefix. The
first version under this name. It takes over from the earlier extension,
and the history starts here.

- Completion of the `<lt-*>` elements, their attributes and the allowed
  values, and of the `lt-` classes inside `class="…"`, with the values a
  class takes, such as `data-variant` on `lt-button`.
- Hover over an `lt-` class, and in HTML files over an element or an
  attribute, with a link to the component page.
- Snippets with the markup from the component pages, with the id as a tab
  stop that `for` and `href` follow.
- Diagnostics and quick fixes from the language server, `lotek lsp`, which
  ships with the extension and needs nothing installed. It checks against
  the LO-TEK version the project has installed, or the manifest the Gradle
  plugin writes, so components taken over with `lotek takeover` are known.
- The same in the template languages: PHP, Razor, Astro, Svelte, Vue, Twig,
  Blade, Jinja, Django, Handlebars, ERB, Go templates, EJS, Liquid, Nunjucks
  and Edge, set with `lotek.languages`.
