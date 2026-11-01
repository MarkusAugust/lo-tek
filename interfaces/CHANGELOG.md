# Changes in @lo-tek/interfaces

Version numbers follow [semantic versioning](https://semver.org/). The
public API is larger than the functions the package exports, so these count
as breaking changes and require a new major version:

- a class name, a `data-*` attribute or an allowed value that disappears or
  changes meaning,
- any other attribute a builder function writes, `aria-*` included, that
  disappears or changes meaning. What the builder functions write ends up in
  the consumer's markup, where it can be styled and tested against. What a
  web component sets in the browser is not API in the same way: it is
  behaviour, and is fixed as behaviour,
- a `part` name in a component with shadow DOM,
- a token name or an `--lt-*` variable,
- a function or a type in `lt`,
- an entry in `exports` in `package.json`.

New components, new optional attributes, new attributes a builder function
adds, and fixes that do not change markup come in a new minor version.
Before 1.0 a minor version can also contain breaking changes, and they are
listed under a heading of their own, "Breaking". Versions up to and
including 0.36.0 were written in Norwegian, and list them under "Brytende".

## Unreleased

### Added

- **The classes for the parts a template writes itself are in the manifest,
  and in Kotlin.** `lt.card.title` and `lt.toggleGroup.option` were string
  constants on the TypeScript functions alone, so a Kotlin template had to
  write `lt-card__title` as text. Every such constant is now `classes` on the
  builder function in `manifest.json`, and `Lt` has the same names:
  `Lt.card.title`, `Lt.toggleGroup.option` and the rest, each a set with the
  class, so it goes where every other answer goes.

### Fixed

- **A property set on a web component before its registration now reaches
  the attribute.** `dialog.open = true` from a script that ran before
  `defineLt()` became a plain property on the element. Once the element was
  upgraded, that property shadowed the setter: the attribute was never set,
  and no later write reached the setter either, `dialog.open = false`
  included. The components now write such a property through the setter in
  the microtask after the upgrade, and a write made in between wins. This is
  the same gap `whenUpgraded()` closes for the methods.

## 0.38.0 (2026-10-31)

### Breaking

- **One rule, `without-name`, replaces `icon-without-name`,
  `control-without-label`, `tab-list-without-name` and
  `field-without-label`.** A `<!-- lotek-ignore-next -->` naming one of the
  four names now has to name `without-name`. The rule is an error, also for
  a field, which was a warning.

### Added

- **`lotek check` reports every element a screen reader gets no name for**
  (`without-name`): the roles WAI-ARIA 1.2 says must have one, on LO-TEK's
  classes and elements and on every button and link, and what LO-TEK demands
  beyond that, from `name` on an element, a part or a class in the manifest:
  a tab list, a fieldset, a toggle group, a dialog in `<lt-dialog>` without a
  heading, an error summary without a heading with an id. The name is
  computed as the browsers compute it (AccName 1.2), by the same model the
  accessibility check compares with Chromium and Firefox, and a `<title>` in
  an svg counts (SVG-AAM). Where a binding, a template or another part of
  the page could give the name, the rule says nothing.
- **`lotek check` warns about LO-TEK's own English texts on a page in
  another language** (`untranslated-text`): `<lt-toast>`,
  `<lt-connection-status>` and the counts in `<lt-suggestion>` without the
  attribute that replaces the text, and, when the style sheets are given,
  " (required)" and " (optional)" on a label or legend without the CSS
  variable. The language is the nearest `lang`. The manifest has
  `textLanguage`, `texts` on the elements and classes, and `name`, which
  `Manifest` in LO-TEK for Kotlin reads as `textLanguage`, `texts` and
  `named`.

### Changed

- **`lt.errorSummary()` writes the heading's id and the box's
  `aria-labelledby`.** `titleId` is new, and defaults to the box's `id` with
  `-title`, so `lt.errorSummary({ id: "errors" })` names the box after
  `<h2 id="errors-title">`. As with every option of a builder function,
  `lt.setAttributes()` with a set that has no `aria-labelledby` removes one
  the element had. An empty `titleId` counts as none, and one with whitespace
  throws, in TypeScript and in Kotlin; so does an `id` with whitespace,
  which `lt.errorSummary({ id })` accepted before, since the default
  `titleId` is made from it.
- **`lt.connectionStatus()` writes `role="status"` and `aria-live="polite"`**
  on the host, the live region; `lt.setAttributes()` sets them over a role
  the element had.

### Fixed

- **`<lt-field>` keeps an `aria-invalid` the server writes, and `<lt-tabs>`
  an `aria-selected`, when the value is the one the component had
  written.** The components told the server's word from their own by the
  value, and a morph leaves an attribute whose value is already right, so
  the server's `aria-invalid="true"` was taken for the component's own and
  removed. They now mark what they write that differs from the server, in
  `data-lt-written`, which a morph from the server removes; markup that is
  already right, as React renders it, gets no mark. Found by the new model
  tests, which try every order of server updates and user actions.
- **`<lt-tabs>` keeps the user's tab when the server inserts a tab before
  it.** Datastar and idiomorph match links without ids by position, and the
  link the user pressed became the inserted tab. The component now finds
  the user's tab by the panel it points to when a morph has moved or
  dropped the link, and still forgets the selection when the links are
  replaced.
- **`<lt-popover>` puts focus back on the button whatever closes the panel
  with focus in it**: `hide()`, `toggle()`, a click on the button in Safari,
  which gives a clicked button no focus, and the server taking `open`.
  Escape alone did it before, and otherwise the focus was lost to the page.
  A patch that only takes `open` for a moment, while the component puts it
  back, no longer closes and reopens the panel, which took the focus from a
  button in it.
- **`show()` on a `<lt-popover>` the server opened is remembered**, as
  `open = true` is: the next patch without `open` closed the panel, since
  `show()` returned before the setter that remembers it. `hide()` the same.
- **`<lt-suggestion>` filters an open list an update changed under
  `server-controlled` too.** The attribute is about whether the list is open
  and what is highlighted, but the repair returned before the filter, so the
  list showed every option the server sent whatever the user had typed, and
  an emptied list kept its empty message hidden.
- **`<lt-suggestion>` announces a count only for a list that opens.**
  Focusing an empty field over a list with nothing to show announced "No
  matches" for a list that stayed closed. An update that removed
  `prefiltered` counted the options before the morph had replaced them, and
  an update that also locked the field announced the count for a list it
  closed.
- **`<lt-dialog>` names the dialog after its heading again when an update
  removes `aria-label`.** The component did not watch `aria-label`, and the
  dialog was left without a name until something else changed.
- **`<lt-dialog>` no longer reports a close for a dialog that never
  opened.** `dialog-toggle` with `open: false` came when the component
  closed a `<dialog open>` it had never shown.
- **`<lt-session-timeout>` keeps the warning's role and name through an
  update.** A morph of the open warning removed `role="alertdialog"` and
  `aria-labelledby`, which the component had written, and a screen reader
  had a modal dialog without a name until the warning closed.
- **`<lt-session-timeout>` goes on with a warning the renderer replaced
  while it showed**, as `innerHTML` does: focus goes back to where the user
  was, not to the page, and `session-warn` is not sent a second time.
- **`<lt-error-summary>` has a name when it takes focus.** The box moves
  focus to itself when a submission fails, and had no name, so a screen
  reader said only "alert". The template writes the heading's `id` and the
  box's `aria-labelledby`, as it writes `for` and `id` on a field, and the
  recipes on the page do. When the heading has an id and the box no name,
  the component points `aria-labelledby` at it, and follows a heading a
  patch has replaced; when the heading has no id, it says so in the console.
  It never writes an id itself: Datastar and idiomorph replace an element
  whose id the server did not send, so the heading would have got a new one
  on every patch. A blank `aria-label` or `aria-labelledby` counts as
  missing.
- **`<lt-error-summary>` takes focus after an update, not in the middle of
  it.** It moved focus as a morph removed `hidden`, before the morph had
  updated the content, and idiomorph with `ignoreActiveValue` then left the
  content of the focused box as it was: the box showed the previous errors.
  A script that moves focus elsewhere in the same turn keeps it there.
- **`<lt-error-summary>` lets go of focus when it is hidden**, also from a
  link inside it. In Firefox and WebKit the hidden box kept focus, so the
  next errors never reached it.
- **`<lt-connection-status>` is announced in Firefox.** The component made
  the bar a live region as it inserted it, and Firefox then sent no
  live-region text through the accessibility API, so "No connection" was
  never read out. The host is now the live region from the moment it is
  connected, with `role="status"` and `aria-live="polite"` when it has
  neither, and the bar is content inside it. A role the server wrote keeps
  its own politeness. A morph that takes both off gets them back.

The name, and the announcement in Firefox, were found by
`check-accessibility-tree.ts`, which reads what a screen reader is given
through AT-SPI in Chromium and Firefox, against an accessibility contract per
component; the contracts are shown on the component pages, under
"Accessibility". The focus fixes were found by
`lt-error-summary.model.browser.test.ts`, which sends every version of the box
by Datastar, idiomorph and `outerHTML` in every order and checks the
accessibility tree the core computes after each step, and by the code review
of the pull request.

## 0.37.0 (2026-10-26)

### Breaking

- **Fristil is now LO-TEK, and everything is in English.** The package, the
  prefix, the API, the command line, the check, the default texts, the
  documentation and its addresses all have new names. Nothing else about the
  architecture changes: the same markup, written with the new prefix, behaves
  as before. The old packages stay where they are. `@fristil/designsystem` is
  deprecated on npm with a pointer to `@lo-tek/interfaces`, and the last
  version of each old Maven artifact carries a relocation to the new one, so
  Maven and Gradle follow it and warn. Nothing is deleted. **How to update:**
  install `@lo-tek/interfaces`, then replace the names in the tables below.

  | Before | Now |
  |---|---|
  | `@fristil/designsystem` | `@lo-tek/interfaces` |
  | `fristil.sobernetics.no` | `lo-tek.sobernetics.no` (every old address redirects) |
  | `github.com/MarkusAugust/fristil` | `github.com/MarkusAugust/lo-tek` |
  | `fs-button`, `<fs-field>`, every `fs-` class and element | `lt-button`, `<lt-field>`, `lt-` |
  | `--fs-…`, every token and component variable | `--lt-…` |
  | `@layer fristil` | `@layer lotek` (`@layer theme, base, lotek, components, utilities;`) |
  | `fristil-tema` (the theme layer) | `lotek-theme` |
  | `data-fs-boundary` | `data-lt-boundary` |
  | `fs` (the builder object) | `lt` |
  | `defineFs()`, `defineFsField()` and the others | `defineLt()`, `defineLtField()` |
  | `FS_FIELD_TAG`, `FS_FIELD_PARTS` and the others | `LT_FIELD_TAG`, `LT_FIELD_PARTS` |
  | `FsField` and the other classes, `FsEventMap` | `LtField`, `LtEventMap` |
  | `dist/fristil.css` | `dist/lotek.css` (`@lo-tek/interfaces/lotek.css`) |
  | exports `./tema`, `./farge`, `./kontrakt`, `./matrise`, `./tema-sjekk` | `./theme`, `./color`, `./contract`, `./matrix`, `./theme-check` |
  | exports `./fargekontrakt.json`, `./kjerne.wasm` | `./color-contract.json`, `./core.wasm` |
  | source folders `ramme/`, `frittstaende/` (in `lotek takeover`) | `frame/`, `standalone/` |
  | the binary `fristil` | `lotek` |
  | `fristil.tema.json` | `lotek.theme.json` |
  | env `FRISTIL_PACKAGE` | `LOTEK_PACKAGE` |
  | the comment `fristil-ignore-next` | `lotek-ignore-next` |
  | Kotlin `no.fristil`, `Fs`, `Fristil`, `Tag.fs(…)` | `no.lotek`, `Lt`, `Lotek`, `Tag.lt(…)` |
  | Maven `io.github.markusaugust:fristil`, `fristil-kotlinx-html`, `fristil-kommandolinje`, `fristil-gradle-plugin` | `lo-tek-interfaces`, `lo-tek-kotlinx-html`, `lo-tek-cli`, `lo-tek-gradle-plugin` |
  | Gradle plugin `io.github.markusaugust.fristil`, tasks `fristilSjekk`, `fristilTema`, `fristilManifest` | `io.github.markusaugust.lo-tek`, `lotekCheck`, `lotekTheme`, `lotekManifest` |
  | WebJar `webjars/fristil/` | `webjars/lo-tek/` |
  | VS Code `Fristil.fristil-vscode` | `lo-tek.interfaces` ("LO-TEK for VS Code") |
  | IntelliJ `no.fristil` | `no.lotek` ("LO-TEK Interfaces") |
  | rulebook `agent/maler.md` | `agent/templates.md` |

- **The command line has English verbs, flags and recipe keys.** There are
  no Norwegian aliases.

  | Before | Now |
  |---|---|
  | `sjekk`, `sjekk-tema`, `overta`, `tema` | `check`, `check-theme`, `takeover`, `theme` |
  | `--rendret`, `--ut`, `--rammeverk`, `--overskriv=ja`, `--hjelp` | `--rendered`, `--out`, `--framework`, `--overwrite=yes`, `--help` |
  | `--aksent`, `--fare`, `--suksess`, `--advarsel`, `--noytral`, `--besokt`, `--merke1..3` | `--accent`, `--danger`, `--success`, `--warning`, `--neutral`, `--visited`, `--brand1..3` |
  | `--skrift`, `--knapp-hjorner`, `--felt-hjorner`, `--flate-hjorner`, `--knapp-ramme`, `--knapp-vekt` | `--font`, `--button-radius`, `--field-radius`, `--surface-radius`, `--button-border`, `--button-weight` |
  | recipe keys `aksent` … `merke3`, `typografi`, `form` | `accent` … `brand3`, `typography`, `shape` |

- **The check's rule ids are English.** A filter or a suppression on an id
  must use the new one.

  | Before | Now |
  |---|---|
  | `boolsk-med-verdi` | `boolean-with-value` |
  | `deaktivert-med-href` | `disabled-with-href` |
  | `del-flere-ganger` | `part-repeated` |
  | `fane-uten-lenke` | `tab-without-link` |
  | `fanelenke-uten-panel` | `tab-link-without-panel` |
  | `fanerad-uten-navn` | `tab-list-without-name` |
  | `feilmelding-motsier` | `error-text-contradicts` |
  | `felt-uten-kontroll` | `field-without-control` |
  | `felt-uten-ledetekst` | `field-without-label` |
  | `id-fra-komponenten` | `id-from-component` |
  | `ikke-tall` | `not-a-number` |
  | `ikon-uten-navn` | `icon-without-name` |
  | `kontroll-uten-kobling` | `control-without-wiring` |
  | `panel-uten-id` | `panel-without-id` |
  | `tekst-i-ledetekst` | `text-in-label` |
  | `tidsavbrudd-uten-dialog` | `timeout-without-dialog` |
  | `ugyldig-klasseverdi` | `invalid-class-value` |
  | `ugyldig-verdi` | `invalid-value` |
  | `ukjent-attributt` | `unknown-attribute` |
  | `ukjent-element` | `unknown-element` |
  | `ukjent-klasse` | `unknown-class` |
  | `ustylet-klasse` | `unstyled-class` |
  | `ustylet-verdi` | `unstyled-value` |
  | `utgatt-attributt` | `removed-attribute` |
  | `verdi-uten-felt` | `value-without-field` |
  | `duplikat-id` | `duplicate-id` |
  | `id-finnes-ikke` | `id-not-found` |
  | `for-peker-feil` | `for-points-nowhere` |
  | `oppsummering-peker-feil` | `summary-points-nowhere` |
  | `kontroll-uten-ledetekst` | `control-without-label` |
  | `tekst-ikke-koblet` | `text-not-wired` |

  Every message from the check, the components' console warnings and the
  errors the builder functions throw are in English too.

- **The default texts are English.** Each can still be replaced, as before.

  | Before | Now |
  |---|---|
  | «Varsler» | "Notifications" |
  | «Lukk melding» | "Close message" |
  | «Ingen forbindelse. Det du skriver blir ikke lagret.» | "No connection. What you type is not being saved." |
  | «Forbindelsen er tilbake.» | "Connection restored." |
  | «Ingen treff», «Ett treff», «{n} treff» | "No matches", "One match", "{n} matches" |
  | « (påkrevd)», « (valgfri)» | " (required)", " (optional)" |

  **How to update:** a Norwegian page that relied on the defaults sets them
  as the translation page shows.

- **The documentation is in English, at new addresses.** Every old address
  redirects to its new one, and `/components/…` is unchanged.

  | Before | Now |
  |---|---|
  | `/introduksjon/`, `/kom-i-gang/`, `/rammeverk/` | `/introduction/`, `/getting-started/`, `/frameworks/` |
  | `/markup-og-oppforsel/`, `/tilpasning/`, `/tilgjengelighet/` | `/markup-and-behaviour/`, `/customising/`, `/accessibility/` |
  | `/oversettelse/`, `/eget-tema/`, `/typesikker-bruk/` | `/translation/`, `/your-own-theme/`, `/type-safe-use/` |
  | `/editoren/`, `/kommandolinjen/`, `/kodeagenter/` | `/the-editor/`, `/command-line/`, `/coding-agents/` |
  | `/lisens/`, `/veikart/`, `/versjonslogg/` | `/licence/`, `/roadmap/`, `/changelog/` |
  | `/monster/skjema/`, `liste`, `sideskjelett`, `bekreftelse`, `dato`, `tema` | `/patterns/form/`, `list`, `page-skeleton`, `confirmation`, `date`, `theme` |

## 0.36.0 (2026-10-25)

### Brytende

- **Forslagslista står i det øverste laget.** Den var `position: absolute` i
  `<fs-suggestion>`, og en forelder med `overflow`, som kroppen i en dialog,
  klippet den. Nå er lista `popover="manual"`, og komponenten åpner og lukker
  vinduet etter `hidden`, som fortsatt er det som sier om lista er åpen.
  Komponenten legger den rett under feltet, like bred som det.
  `--fs-suggestion-layer` er tatt ut, siden det øverste laget ligger over alt
  uten `z-index`. **Slik oppdaterer du:** ta bort `--fs-suggestion-layer` fra
  egen CSS. `fs.suggestion()` skriver `popover` selv; skriver du markupen for
  hånd, gjør komponenten det.
- **En rettelse fra `diagnoseMarkup` er en liste av endringer.** `Fix` har
  `edits`, hver med `start`, `end` og `text`, i tekstens rekkefølge og uten
  overlapp, i stedet for ett `start`, `end` og `text`. Det samme i Kotlin,
  `Fix(title, edits, preferred)` med `Edit`. Grunnen er «Gi feltet id
  «epost»», som skriver `id` på feltet og `for` på ledeteksten under ett.
  **Slik oppdaterer du:** bruk `fix.edits` bakfra, så posisjonene i de
  første holder. Språkserveren og editorene gjør det alt.
- **Fanene i `<fs-tabs>` er lenker til panelene, ikke knapper.** Raden er en
  `<ul class="fs-tabs__list">` med `<li><a href="#panel">`, og hvert
  `.fs-tabs__panel` har den id-en lenken peker på. Uten JavaScript er raden
  en innholdsfortegnelse, og panelene står etter hverandre under den. Med
  JavaScript skriver komponenten rollene, `aria-selected`, `aria-controls` fra
  `href`, tabbestoppene og `hidden="until-found"` på panelene som ikke er
  valgt, så søk i siden og en lenke til noe inni et panel velger fanen.
  Lenkene har ingen id, og komponenten skriver aldri en, så en oppdatering fra
  serveren kjenner dem igjen og valget står. Hvert valg skrives i adressen,
  som `#sak-vedlegg`, uten ny historikkoppføring, og adressen velger fane når
  siden lastes. En `role="tab"` på noe som ikke er en lenke til et panel, er
  ikke lenger en fane, og komponenten sier fra i konsollen. **Slik oppdaterer
  du:** bytt `<div class="fs-tabs__list">` med knapper til en `<ul>` med
  lenker, gi hvert panel en id og la lenken peke på den.
- **`fs.tabs()` og `Fs.tabs` tar `keys` i stedet for `count`, og `selected`
  er borte.** Nøklene kommer fra dataene, én per fane, og gir panelene
  `${id}-${nøkkel}` og overskriftene `${id}-${nøkkel}-heading`. En nøkkel som
  er tom, har mellomrom eller står to ganger, kaster, likt i TypeScript og
  Kotlin. Den første fanen er utgangspunktet; et annet valg kommer fra
  adressen, fra `hidden="until-found"` på de andre panelene, eller fra appen
  gjennom `selected` og `select()` på elementet. **Slik oppdaterer du:**
  `fs.tabs({ id, count: 3, selected: 1, label })` blir
  `fs.tabs({ id, keys: ["soknaden", "vedlegg", "meldinger"], label })`.
- **`fs.tabs()` og `Fs.tabs` skriver bare lenker, id-er og klasser.** `list`
  har klassen og `aria-label`, `tabs` har `href`, `panels` har `id` og
  klassen, og det nye `headings` har `id` til overskriften i hvert panel.
  Ingen roller, `aria-*`, `tabindex` eller `hidden`: uten JavaScript skal
  raden være en liste med lenker, og en `<section>` med navn ville blitt et
  landemerke. Komponenten
  skriver resten når den registreres. **Slik oppdaterer du:** spre
  `faner.tabs[i]` på en `<a>` i en `<li>`, og `faner.headings[i]` på
  overskriften i panelet.
- **En tom `label` kaster i `fs.tabs()`, i React-inngangen og i `Fs.tabs`.**
  Raden må ha et navn som sier hva fanene velger mellom; uten det sier
  skjermleseren bare «faneliste». `label` sjekkes før `keys`, med samme
  melding i TypeScript og Kotlin. **Slik oppdaterer du:** gi raden et navn,
  som `label: "Deler av saken"`.
- **`fs.tabs()` i `@fristil/designsystem/react` gir hele tilstanden.** Den tar
  `selected` (standard 0) og skriver rollene, `aria-selected`, `aria-controls`,
  `tabIndex`, `hidden` og `aria-labelledby` fra panelet til lenken, som får id
  `${id}-${nøkkel}-tab`. `item` gir `role="presentation"` til hvert `<li>`.
  Da har komponenten ingenting å skrive når den registreres, og React
  hydrerer uten avvik. `hidden` er boolsk, fordi React 19 skriver
  `hidden="until-found"` som `hidden=""`; søk i siden åpner derfor ikke et
  skjult panel i en React-app. Har markupen `aria-selected` fra serveren,
  gjelder den når siden lastes, og adressen velger ingen fane. **Slik
  oppdaterer du:** importer `fs` fra `@fristil/designsystem/react` og spre
  `faner.item` på `<li>`.
- **`fs.suggestion()` og `Fs.suggestion` tar `keys` i stedet for `count`.**
  Alternativene får id fra nøkkelen, `${id}-option-${nøkkel}`, ikke fra
  plassen i lista, så en oppdatering fra serveren kjenner dem igjen. Antall
  nøkler avgjør om tommeldingen har `hidden`, som `count` gjorde. Nøklene
  sjekkes som i `fs.tabs()`. **Slik oppdaterer du:**
  `fs.suggestion({ id, count: kommuner.length })` blir
  `fs.suggestion({ id, keys: kommuner.map((k) => k.nr) })`.

### Nytt

- **Forslagslista har et navn**, fra ledeteksten. `fs.suggestion()` gir
  ledeteksten id `${id}-label` og lista `aria-labelledby` mot den. Kommer
  markupen uten, gjør komponenten det samme, og står ledeteksten rundt
  feltet, får lista teksten som `aria-label`, uten å skrive id på ledeteksten.
- **`fs.suggestion({ pending: true })` skriver `aria-busy="true"` på lista**,
  og stilarket skjuler «Ingen treff» mens det står.
- **Ti regler i kjernen om det malen må skrive selv**, for at komponentene
  skal virke uten JavaScript og overleve en oppdatering fra serveren, i
  `fristil sjekk`, språkserveren, VS Code og IntelliJ: `kontroll-uten-kobling`
  (ledeteksten har verken `for` mot feltet eller står rundt det, med rettelsen
  «Gi feltet id «navn»» fra feltets `name`), `panel-uten-id` i
  `<fs-popover>`, `fanelenke-uten-panel`, `fane-uten-lenke` (`role="tab"` på
  noe som ikke er en lenke), `fanerad-uten-navn` (med rettelse),
  `tekst-i-ledetekst` (hjelpetekst eller feilmelding inni `<label>`),
  `verdi-uten-felt` (`data-value` uten `.fs-suggestion__value`, og omvendt),
  `feilmelding-motsier` (`hidden` på feilmeldingen ved siden av
  `aria-invalid="true"`), `utgatt-attributt` (`invalid`, `required-marker` og
  `control-id` på `<fs-field>`, med rettelse og beskjed om hva som gjelder i
  stedet) og `id-fra-komponenten` (en id komponenten lagde selv, kopiert inn
  fra DevTools; bare i markupmodus). Reglene tier der malen avgjør markupen,
  også ved en bundet id som `:id`, `th:id` eller `asp-for`. Hver bygde side
  i dokumentasjonen gir null funn, også hver forhåndsvisning lest som markup,
  og en vaktpost i bygget krever det.
- **Manifestet sier hvilke deler som må ha id fra serveren**, `stableId` på
  delen, og hvilke attributter som er tatt ut av et element, `removed` med
  beskjeden. Begge er tillegg; `schemaVersion` er fortsatt 1.
- **`fs.progress({ valueText })`** skriver `aria-valuetext`, som skjermleseren
  leser i stedet for prosenten: «Steg 3 av 7» sier mer, og `max` leses sjelden
  opp.
- **Snippetene har id-en som tabbestopp**, og `for` og `href` følger med. Og
  `live-templates.xml` i pakken har de samme oppskriftene som live templates
  for IntelliJ, med id-en som variabel.

### Rettet

- **Hvert alternativ i forslagslista har `aria-selected` fra starten.**
  Komponenten skrev det først når lista ble lukket, så alternativene serveren
  sendte, sto uten fram til da, mens resten av lista hadde det.
- **`<fs-popover>` skriver aldri id på panelet.** Den lagde en når malen ikke
  hadde skrevet en, og Datastar og idiomorph byttet da ut panelet ved neste
  oppdatering, med fokus og det brukeren gjorde i det. Nå beholdes panelet.
  Uten id kan knappen ikke kobles til panelet med `aria-controls`, og
  komponenten sier fra i konsollen. Byttes panelet ut mens det står åpent
  fordi id-en fra serveren endret seg, sier komponenten også fra, som
  `<fs-field>` gjør. Oppskriften har id på panelet og merker ingen forskjell.
- **`server-controlled` satt etter et klikk lot ikke serveren flytte fanen
  med bare `hidden`.** `aria-selected` komponenten selv hadde skrevet, ble
  regnet som serverens ord. Nå gjør komponenten det samme som når serveren
  svarer på et klikk, og attributtet kan også fjernes igjen mens siden lever.
- **Søk i siden velger fanen også i faner i faner.** Komponenten venter til
  nettleseren er ferdig med å avdekke treffet før den skriver raden; før
  stoppet Chromium og WebKit før det ytre panelet.
- **Serverens `aria-selected` vinner over adressen når siden lastes.** En
  React-app rendrer på serveren uten å se fragmentet, og valgte komponenten
  fra adressen før React hydrerte, meldte React avvik. Peker adressen på en
  annen fane i raden, rettes den til den valgte.
- **`hidden` skrives tilbake i formen serveren brukte**, `hidden=""` eller
  `hidden="until-found"`, og i én form per rad.
- **Før registrering viser `tabs.css` panelet adressen peker på**, eller
  panelet med det inni, i stedet for alltid det første, så innholdet ikke
  hopper når komponenten registreres. Serverens `hidden` går foran, og under
  `server-controlled` vises det første. Regelen står bak
  `@media (scripting: enabled)`: uten JavaScript vises alle panelene.

## 0.35.0 (2026-10-22)

### Brytende

- **`<fs-field>` og `<fs-suggestion>` skriver aldri id på feltet.** Datastar
  og idiomorph kjenner igjen et element på id, og et felt med en id serveren
  ikke sendte, ble byttet ut ved neste oppdatering, med fokus og det brukeren
  hadde skrevet. Nå er det malen som skriver `for` på ledeteksten og `id` på
  feltet, som HTML uansett krever for at feltet skal ha et navn før skriptet
  har kjørt, eller som legger ledeteksten rundt feltet. Komponenten skriver
  `for` fra feltets id når ledeteksten ikke står rundt feltet. Et felt uten id
  med ledeteksten ved siden av gir en advarsel i konsollen. Hjelpeteksten,
  feilmeldingen, lista og alternativene får fortsatt id av komponenten når de
  mangler: byttes de ut, kobler komponenten dem på nytt, og det markerte
  alternativet gjenfinnes på teksten. **Slik oppdaterer du:** skriv `for` og
  `id` i malen, eller legg `<label>` rundt feltet.
- **`invalid`, `required-marker` og `control-id` er tatt ut av `<fs-field>`.**
  Feltet er ugyldig når feilmeldingen synes, altså har tekst og står uten
  `hidden` og uten `display: none` (som `data-show` i Datastar setter), eller
  når serveren har skrevet `aria-invalid` på feltet. Komponenten rører aldri
  `hidden` på feilmeldingen; før skjulte den en feilmelding serveren hadde
  rendret synlig, fordi verten manglet `invalid`. Påkrevd-merket står som
  `data-required` på ledeteksten, og vises da også uten JavaScript.
  `control-id` fikk komponenten til å skrive en id serveren ikke sendte.
  **Slik oppdaterer du:** `<fs-field invalid>` blir en synlig `.fs-error-text`
  (i Datastar `data-attr:hidden="!$ugyldig"` på feilmeldingen framfor
  `data-attr:invalid` på verten), `required-marker="x"` blir
  `data-required="x"` på `<label>`, og `control-id` blir `id` på feltet.
  Egenskapene `invalid`, `requiredMarker` og `controlId` er borte, og
  React-typene i `react-jsx` er oppdatert.
- **`<fs-suggestion>` viser alltid teksten i feltet.** Før skrev den
  `data-value` inn i det synlige feltet, så brukeren som valgte Bergen, så
  «4601», og skjemaet sendte koden under feltets `name`. Nå får et skjult
  `.fs-suggestion__value` koden når serveren har skrevet det, og
  `suggestion-select` har både `value` og `label`. Tilbakestilles skjemaet,
  følger koden teksten: serverens når teksten er serverens, ellers det
  valgte, ellers alternativet med den teksten, ellers ingen. **Slik
  oppdaterer du:**
  skal skjemaet sende koden, legg inn `<input class="fs-suggestion__value"
  type="hidden" name="…">`, eller les `evt.detail.value`.
- **`.fs-suggestion__field` er borte, og statuselementet har verken
  `aria-live` eller `data-ignore-morph`.** Feltet, lista, tommeldingen og
  statuselementet står rett i `<fs-suggestion>`, som selv gir lista plassen
  under feltet. `role="status"` gir `aria-live="polite"` av seg selv, og
  tømmer en oppdatering statuselementet, skriver komponenten antallet på
  nytt (ikke under `prefiltered`, der det nye antallet kommer rett etter),
  så Datastars `data-ignore-morph` trengs ikke, og det samme gjelder med
  htmx. Tommeldingen trenger ikke `hidden`: stilarket skjuler den sammen
  med lista. `fs.suggestion()` gir ikke lenger `field`. **Slik oppdaterer
  du:** ta bort `<div class="fs-suggestion__field">` og `{...forslag.field}`
  rundt feltet, og `aria-live`, `data-ignore-morph` og `hidden` på de to
  elementene.

### Lagt til

- **`<fs-tabs>` og `<fs-popover>` sier fra når en patch byttet ut
  elementene fordi serveren ikke skrev id.** Datastar og idiomorph morfer
  ikke et element med id inn i et uten: det gamle fjernes og serverens
  settes inn. Lager komponenten id-ene selv, som den gjør for bar markup,
  byttes fanene og panelet ut ved neste patch som sender området på nytt, og
  fanevalget og fokus er borte. Nå kommer det én advarsel i konsollen i det
  øyeblikket det skjer, med beskjed om å skrive id i malen. Sider som aldri
  patcher, eller patcher smalt, får ingen advarsel. Reprodusert mot Datastar
  v1.0.4 i `fs-tabs-morph.browser.test.ts`, som kjører den ekte bundlen.
- **`<fs-field>` og `<fs-suggestion>` sier fra når en oppdatering byttet ut
  feltet fordi id-en fra serveren endret seg** mellom to rendringer, som når
  malen lager id-en av et tilfeldig tall eller en teller, og det brukeren
  hadde skrevet, gikk tapt.
- **`<fs-field>` og `<fs-suggestion>` sier fra når `for` på ledeteksten
  pekte på en annen id enn feltets.** Komponenten skriver den om, men uten
  JavaScript hadde feltet da ingen ledetekst.
- **`fs.suggestion()` gir det skjulte feltet for koden som `value`**, og
  `.fs-suggestion__value` er en ny del i manifestet og i begge editorene.
  Komponenten sender `input` og `change` på feltet når den skriver eller
  tømmer koden, så `data-bind` i Datastar ser den; de bobler ikke, så en
  `data-on:input` på verten utløses ikke av dem.
- **`<fs-suggestion>` går til første og siste alternativ med PgUp og PgDn.**
  Home og End røres ikke; de flytter markøren i teksten.
- **`idOrFallback` sier også at en ny id per rendring bytter ut
  elementene** ved neste patch.

### Rettet

- **`<fs-suggestion>` mistet markeringen når serveren sendte lista på
  nytt.** Alternativene får id av komponenten, og en oppdatering bytter dem
  ut med nye id-er. Markeringen gjenfinnes nå på teksten.
- **`<fs-suggestion>` valgte bare på `mousedown`.** Hjelpemidler som
  aktiverer et element, sender `click`, og den valgte da ingenting. Nå skjer
  valget på `click`, og `mousedown` holder bare fokus i feltet.
- **`<fs-suggestion>` åpnet lista og endret verdien i et felt med
  `readonly`.** Nå åpner et felt med `readonly` eller `disabled` ikke lista.
- **Et alternativ med `aria-disabled="true"` kunne velges.** Nå vises det,
  men hoppes over av piltastene og kan ikke velges med mus.
- **Enter under en IME-komposisjon valgte det markerte alternativet.** Nå
  hører tastene til komposisjonen.
- **`<fs-popover>` lukket vinduet etter en patch fra en mal uten
  `popover`.** Morfingen tok `open` på verten og `popover` på panelet i
  samme omgang. Komponenten lukket panelet, gjenåpnet det i neste mikrotask,
  og først etterpå kom `toggle` med «closed» fra lukkingen, som en egen
  oppgave. Den ble tatt som brukerens lukking. Nå gjelder `toggle` bare når
  den stemmer med panelets faktiske tilstand.

### Endret

- **«Markup og oppførsel» sier hvilke id-er som overlever en oppdatering.**
  Felt og forslagsfelt får `for` og `id` fra malen, fanene og
  sprettoppvinduet trenger id fra serveren når hele området sendes på nytt,
  og id-er i en løkke lages av en nøkkel i dataene, aldri av indeksen eller en
  teller. Regelbøkene i `agent/` og sidene for felt, forslagsfelt og faner
  sier det samme. Før sto det at `outer` morfer og at malen ikke trenger gjøre
  noe, og det holdt bare for markup fra byggefunksjonene.

## 0.34.0 (2026-10-18)

### Brytende

- **`hidden` på `<fs-error-summary>` er et flagg i JSX-typene.** `hidden`
  kom fra `HTMLAttributes` som `boolean`, så `hidden={false}` kompilerte,
  mens React 18 skriver det som `hidden="false"` på en web component, som er
  sant: boksen ble aldri vist. Typen er nå `true | undefined`, som `open` på
  `<fs-dialog>`, slik regelboka for React sier om hvert boolske attributt på
  en web component. `fs.errorSummary().host` sendte alt `true` eller
  ingenting.
  Det er brytende for den som skrev `hidden={!harFeil}` eller
  `hidden={false}`: det kompilerte, og i React 19 virket det, siden React 19
  setter egenskapen `hidden` i stedet for attributtet. Skriv
  `hidden={harFeil ? undefined : true}`, eller bruk
  `fs.errorSummary({ count }).host`, som sender det riktig.
- **`fristil sjekk` meldte grønt for en tom fil og en tom side.** Bare tom
  standard inn ga feilkode. En tom fil, og en adresse som svarte 200 med tom
  HTML, ga «Markupen stemmer» og 0, så en CI-linje mot en side som rendret
  tomt ble grønn. Nå gir en adresse med tom side feilkode, og det gjør også
  filer som alle er tomme. Én tom fil blant flere, som en tom partial i et
  glob, er fortsatt ikke en feil.
  En CI-linje som var grønn mot en tom side, blir rød med denne versjonen.

### Lagt til

- **`setAttributes` og typen `ReactSet` fra `/react`.** `fs.setAttributes`
  derfra er den samme funksjonen, for sett med `className`, `htmlFor` og
  `tabIndex` som tall. Hovedinngangen eksporterer `rememberManaged`, som
  `/react` bruker for å gi et omdøpt sett de samme forvaltede navnene; den
  er ikke ment for apper.
- **Regelen `del-flere-ganger` i `fristil sjekk`, editoren og
  `diagnoseMarkup`.** En del med det nye feltet `unique` i manifestet som
  står mer enn én gang, gir en advarsel: et `<fs-field>` med to kontroller,
  to hjelpetekster i ett felt, en `fs-table` med to `<caption>`. `unique`
  står på delene der en til er en feil og ikke vanlig innhold, og leses av
  `Part` i Kotlin og `Part` i TypeScript. Regelen leser `parts` på
  elementene og klassene i manifestet, så en ny del med `unique` sjekkes
  uten en egen regel. Et treff inni en nøstet vert av samme slag hører til
  den, det som står i en `<template>` teller ikke, og står det malsyntaks i
  verten, sier regelen ingenting.
- **`tbody` i `fs-table` kan stå flere ganger** i manifestet, som HTML
  tillater.
- **`Fristil.manifest.builders` i Kotlin-pakken.** Hver byggefunksjon med
  valgene (`name`, `required`, `type` som `values`, `flag`, `text`,
  `number` eller `textList`, og `description`) og formen på svaret
  (`attributes`, `text`, `values`, `list` eller `group`). Tabellen
  generatoren bak `Fs` bruker er fortsatt utelatt. TypeScript-typen
  `Manifest` har fått `builders` med samme form.
- **`Fristil.buildTheme(oppskrift)` og `Fristil.inspectTheme(css)` i
  Kotlin-pakken.** Temaet kunne før bare bygges med `fristil tema` og
  Gradle-oppgaven `fristilTema`. Oppskriften er JSON-teksten `fristil tema`
  leser, med norske eller engelske nøkler, og svarene `Theme` og
  `ThemeReport` har de samme feltene som `CoreTheme` og `CoreThemeReport`
  i TypeScript. Fargekontrakten ligger nå i jar-en, som manifestet.
- **Manifestet har en `tokens`-seksjon.** Avstandsskalaen, brekkpunktene
  og containerbreddene fra `tokens.ts`, fargefamiliene, rollene og lagene
  med hva hver er til, hvert `--fs-color-*`-navn, og komponentvariablene
  per komponent med standardverdien stilarket faller tilbake på. Fargene
  står som akser og navn, ikke som verdier, siden et tema kan ha andre
  verdier enn Fristils egne. `ManifestTokens` i Kotlin leser det samme.
  `schemaVersion` er fortsatt 1, og `tokens` i Kotlin er `null` i et manifest
  fra før denne versjonen. Beskrivelsene av familiene, rollene og
  lagene eksporteres også fra `@fristil/designsystem/tokens`, som
  `FAMILY_DESCRIPTIONS`, `ROLE_DESCRIPTIONS` og `LAYER_DESCRIPTIONS`.
- **Manifestet sier hva hver klasse tar som innhold, og hvilke deler den
  består av.** Hver klasse i `classes` har `content`, med samme ord som
  delene til elementene: `text`, `free`, `parts` eller `none`. Klassene med
  en fast struktur, som `fs-table`, `fs-list` og `fs-toggle-group`, har
  `parts` med `selector`, `description`, `content`, `multiple` og
  `optional`, og en klasse som bare er en del av en annen komponents
  markup, som `fs-card__title`, peker på forelderen med `partOf`.
  `schemaVersion` er fortsatt 1. I Kotlin har `ManifestClass` fått
  `content`, `partOf` og `parts`, og `content` er `null` i et manifest fra
  før denne versjonen, så IntelliJ kan lese manifestet til en eldre pakke.

### Endret

- **Pakken sender med kildene kartene peker på.** `dist` har kildekart og
  deklarasjonskart, og de for `fs`, `/react`, `/register`, `/dom`,
  `/diagnostics` og kommandolinja pekte på fjorten filer i `src` som ikke var
  med i tarballen, så «gå til definisjon» og et stakkspor derfra landet i en
  fil som ikke fantes. `src/*.ts`, `src/diagnostics`, `src/jsx` og
  `src/vocabulary` følger nå med, som `src/components` alt gjorde, og
  byggesteget krever at hvert medsendt kart peker på en fil i pakken.
- **Regelboka for maler sier at Kotlin-pakken ligger på Maven Central.**
  `agent/maler.md` sa at `io.github.markusaugust:fristil` og Gradle-pluginen
  måtte bygges fra kildekoden. Begge ligger på Central fra 0.33.0, med samme
  versjon som npm-pakken, men ikke hver npm-versjon går dit. Regelboka ber
  derfor agenten bruke den nyeste versjonen som finnes på Central, og aldri
  skrive en den ikke har sett der.

### Rettet

- **`<fs-error-summary>` tar fokus også i React.** React gir fokus tilbake
  til elementet som hadde det før en commit, og boksen flyttet fokus inne i
  den samme commiten. Fokus endte derfor på innsendingsknappen i Chromium og
  Firefox, og på feltet i alle tre motorene når skjemaet ble sendt med Enter,
  både når boksen ble satt inn og når `hidden` ble tatt bort. Boksen tar nå
  fokus én gang til etter commiten, hvis det gikk tilbake dit det var. Har et skript flyttet fokus
  til noe annet, står det. En React-app som viser boksen mens brukeren står
  i et felt, for eksempel ved `blur`, merker at fokus nå flyttes dit, slik
  det alltid har gjort uten React.
- **Et merke, en etikett, en knapp eller en lenke i et kort strekkes ikke
  lenger til hele bredden.** `.fs-card` er en flekskolonne, så
  `<span class="fs-badge">Innvilget</span>` ble et bånd tvers over kortet,
  slik eksempelet på komponentsiden viste. Avsnitt, lister og bilder
  strekkes som før.
- **`fristil lsp` leter ikke over arbeidsområdet for en fil utenfor det.**
  Letingen etter manifestet stoppet ved rota av arbeidsområdet fila lå
  under, men for en fil utenfor det, som en kladdefil, og for hver fil når
  editoren ikke ga noe arbeidsområde, som Neovim uten treff på
  `root_markers`, fantes ingen rot å stoppe ved, så den gikk helt til rota
  av filsystemet og tok en pakke i hjemmemappa som prosjektets. Nå letes det
  ikke fra en slik fil: den sjekkes mot manifestet ved rota av
  arbeidsområdet, om det har et, ellers mot pakkens, slik Editoren-siden og
  IntelliJ-pluginen alt sa.
- **Tagnavnene er typet fra `/register` og `/react-jsx` alene.** Typesikker
  bruk-siden sa at hendelsestypene følger med hver inngang til
  web-komponentene, men `HTMLElementTagNameMap` ble bare utvidet i
  komponentfilene, og `/register` og `/react-jsx` tar dem ikke med i typene.
  Da var `document.querySelector("fs-dialog")` et `Element`, og lytteren på
  det fikk `Event` uten `detail`, så mønsteret på siden var en typefeil. Kartet
  over tagnavnene står nå i `events.ts`, som hver inngang alt tar med, så
  `querySelector("fs-dialog")` gir `FsDialog | null` fra alle tretten
  inngangene, også hver komponentinngang for de andre komponentene. Bygget
  kompilerer en fil per inngang, med bare den importen, så det ikke kan gli
  tilbake.
- **`fs.setAttributes` fra `/react` skriver `class` og `for`, og rydder.**
  Funksjonen var hovedinngangens, mens settene fra `/react` har `className`
  og `htmlFor`, så den skrev attributtene `classname` og `htmlfor`, og fant
  ikke byggefunksjonen bak det omdøpte settet: `aria-invalid` ble stående
  etter at feltet var rettet, uten advarsel. Nå oversettes navnene tilbake
  før de settes, `tabIndex` blir `tabindex`, og settet rydder det samme som
  fra hovedinngangen.
- **`engines` slipper ikke lenger inn Node 21 og 22.0–22.2.** Kjernen lastes
  med `process.getBuiltinModule`, som kom i Node 20.16 og 22.3, men
  `>=20.16` tok med versjonene mellom, og der sa feilmeldingen at Node 22.1
  var eldre enn 20.16. Kravet er nå `^20.16.0 || >=22.3.0`, og meldingen
  nevner begge grensene. Oppføringen under 0.32.0 som sier «20.16 eller
  nyere», gjelder med dette unntaket.
- **Regelboka for React og Kodeagenter-siden sa at `react-jsx` stopper en
  variant som ikke finnes.** `react-jsx` typer attributtene på
  web-komponentene, og ingen av dem har en variant. Det er
  `fs.button({ variant })` som gjør en ukjent variant til en kompileringsfeil,
  med eller uten `react-jsx`, og en håndskrevet `className` eller
  `data-variant` ser ingen av dem, og heller ikke `fristil sjekk`, som leser
  `class`, ikke `className`. Begge tekstene sier nå hva som fanger hva, og
  at det håndskrevne skal erstattes av byggefunksjonene.
- **`defineFs*` kaster ikke når klassen alt er registrert under et eget
  navn.** `defineFsToast("app-toast")` fulgt av `defineFs()` ga
  NotSupportedError på `fs-toast`, siden en konstruktør bare kan stå i
  registeret én gang, og `<fs-session-timeout>` og `<fs-connection-status>`
  ble aldri registrert. Nå registreres en underklasse under det andre navnet,
  så begge navnene virker og flere kall er ufarlige, slik dokumentasjonen
  sier. `tagName` er dessuten typet som `string`. Før var typen standardnavnet,
  så TypeScript avviste `defineFsToast("app-toast")` før det kom så langt.
- **`<fs-toast>` flytter fokus riktig også i en skyggerot.** Komponenten
  leste `document.activeElement`, som peker på skyggeverten når regionen
  står i en skyggerot, slik hver forhåndsvisning i dokumentasjonen gjør. Da
  så det ut som om ingen melding hadde fokus: lukket brukeren meldingen med
  Enter, falt fokus til `body` i stedet for til meldingen ved siden av eller
  dit det kom fra, og det samme skjedde ved `clear()`. Fokus leses nå fra
  komponentens egen rot. `<fs-session-timeout>` husker hvor fokus sto før
  varselet enten feltet står i siden eller i samme skyggerot som
  komponenten, så det får fokus tilbake også når nettleseren ikke setter det
  dit selv.
- **README sier hva et eget tagnavn gir.** Den lovet at du bestemmer «hva
  det skal hete», men stilarkene til `<fs-field>`, `<fs-tabs>`,
  `<fs-popover>`, `<fs-dialog>` og `<fs-suggestion>` er skrevet for
  `fs-*`-navnene, så en komponent under et annet navn mistet `display`-regelen
  på verten, og `<fs-dialog>` også plasseringen av en dialog som står åpen
  før den er modal. README sier nå at oppførselen følger med navnet, men
  ikke stilen, og hvilke fire komponenter som setter klassen sin selv.
- **`popover-toggle` er beskrevet slik den sendes.** Beskrivelsen i
  `events.ts` og `web-types.json` sa «Panelet åpnet eller lukket seg», men
  hendelsen kommer bare når brukeren åpner eller lukker panelet, og fra
  `show()`, `hide()` og `toggle()`. Settes `open` som egenskap eller
  attributt, som React 19 og Datastars `data-attr:open` gjør, kommer ingen
  hendelse, ellers hadde Datastar-oppskriften fått sitt eget signal i retur.
  Popover-siden skiller nå `meny.open = false` fra `hide()`.
- **Regelboka for maler lovet at `<fs-tabs>` husker fanevalget etter enhver
  patch.** Den nevnte `innerHTML`, htmx og Turbo, men valget er knyttet til
  selve knappen og overlever bare en morfing som beholder elementene, som
  Datastars `outer`, htmx med idiomorph og Turbo 8 med morfing. Bytter
  patchen ut nodene, følger komponenten markupen. Regelboka sier nå hvilke
  patcher som beholder valget, og at serveren ellers må skrive det selv
  eller bruke `server-controlled`.
- **Regelbøkene sa at markupen i en `ramme`-komponent står der uansett.**
  «Kom i gang» og «Rammeverk» ble rettet i 0.33.0, men ikke teksten i
  generatoren, så alle seks regelbøkene manglet unntaket: Tabs viser bare det
  første panelet og Suggestion skjuler lista til de er registrert.
- **React-oppskriften på Dialog-siden og mønsteret «Bekreft en handling»
  tømmer `returnValue` før `showModal()`.** «Ren HTML»- og Astro-fanene
  fikk tømmingen i 0.33.0, men React-fanen, mønstersiden og demoen åpnet
  dialogen med den gamle verdien stående. Ble dialogen åpnet igjen etter en
  «Slett» og lukket uten knapp, fikk `close`-lytteren «slett» på nytt og
  slettet igjen.
- **`fristil sjekk-tema` og `inspectTheme` hoppet over en nøstet blokk som
  begynner med et element og et kolon.** `html:not([data-theme="light"]) { … }`
  eller `body:has(…) { … }` inni en `@media`, et `@layer` eller en annen
  blokk ble lest som deklarasjonen `html`, og den slukte alt fram til neste
  semikolon, blokkene etter den med. Et tema med et brudd der fikk «Temaet
  holder hvert løfte». Nå leses blokka som en regel, slik nettleseren gjør.
- **`fristil sjekk-tema` og `inspectTheme` leste
  `@media not (prefers-color-scheme: dark)` som mørkt tema.** Blokka gjelder
  i lyst tema, og Fristils egne lyse verdier ga brudd. `not` snur nå
  mediespørringen, også skrevet med en medietype, som `not all and (…)` eller
  `not screen and (…)`, og blokka kontrolleres bare som lys. Med en annen
  medietype, som `not print and (…)`, gjelder blokka skjermen i både lyst og
  mørkt tema, og den kontrolleres som en blokk uten betingelse.
- **`fristil sjekk-tema` og `inspectTheme` meldte systemfargene som feil.**
  `--fs-color-disabled-surface`, `--fs-color-disabled-text` og
  `--fs-color-overlay` er ingen celle, men ble lest som familien `disabled`
  med roller som manglet, og som et token systemet ikke har. En overstyring
  skrevet på hver temagrense, slik dokumentasjonen ber om, ga feilkode, og
  det gjorde Fristils egen `tokens.css` også, med tolv problemer. Nå hopper
  sjekken over dem: de lover ingen kontrast.
- **Et tema uten farger fra `fristil tema` ga feilkode i `fristil sjekk-tema`.**
  Et tema med bare skrift og form fikk «Fant ingen --fs-color-*-verdier»,
  og `inspectTheme` meldte det som et problem, enda dokumentasjonen sier at
  et tema laget med `tema` holder kravene. Nå svarer sjekken at det ikke er
  noen kontrast å kontrollere, uten feilkode. En fil uten noen
  `--fs-*`-verdier gir fortsatt feilkode.
- **En `fs-progress` med `value` viste ikke fyllet i høykontrastmodus.**
  Den fylte delen leste `currentColor`, og modusen tvang bakgrunnen på
  pseudoelementet tilbake til `Canvas`, så stolpen så tom ut uansett hvor
  langt den hadde kommet. Fyllet tegnes nå i `Highlight` rett på
  `::-webkit-progress-value` og `::-moz-progress-bar`.
- **Klassen på et avsnitt i `fs-card` og `fs-alert` vinner over
  komponenten.** `.fs-card p` og `.fs-alert p` slo klassene på avsnittet på
  spesifisitet. I et kort virket ikke `--fs-paragraph-line-height`, en
  `fs-card__title` som var en `<p>` fikk artikkelens linjehøyde, og
  `fs-help-text` og `fs-error-text` mistet marginen i toppen, også i en
  melding. Reglene teller nå bare elementet, så et avsnitt uten klasse ser
  ut som før.
- **En besøkt `fs-link` skifter farge under musa.** `:hover` sto før
  `:visited` med samme spesifisitet, så besøktfargen vant og hover-fargen
  kom aldri. Rekkefølgen er snudd.
- **Ringen rundt `fs-avatar` vises over bildet.** Den var en `box-shadow`
  innover, og en slik skygge males under innholdet, så et bilde dekket den
  helt og ringen fantes bare med initialer. Den er nå en `outline` innover,
  også i `fs-avatar-stack`, der skyggen utenfor fortsatt skiller bildene, og
  hver avatar i stabelen males for seg, så ringen til den bak ikke skinner
  gjennom bildet til den foran.
  En slik `outline` slår nettleserens egen fokusmarkering, så en
  `fs-avatar` som er en knapp får `--fs-focus-ring` på `:focus-visible`, og
  i en stabel løftes den med fokus over naboene så fokusringen vises hel.
- **`--fs-skeleton-radius` virker på `data-variant="text"`.** Tekstlinjene
  hadde en fast radius og leste ikke variabelen. Standarden der er
  fortsatt `var(--fs-spacing-0-5)`, og tabellen på siden sier det.
- **Et langt valg i `fs-select` med `data-picker="styled"` ble ikke
  klippet.** Regelen som klipper det, treffer `<selectedcontent>`, og
  kommentaren sa at nettleseren lager elementet selv. Det gjør den ikke, så
  med markupen på siden ble et langt valg brutt over flere linjer, og feltet
  ble høyere. Komponentsiden sier nå at
  `<button><selectedcontent></selectedcontent></button>` må stå først i
  `<select>`-en for at valget skal klippes.
- **Siden om `fs-textarea` sa at `rows` virker som før.** Minstehøyden er
  litt under tre rader, så `rows="1"` og `rows="2"` gir det samme feltet.
  Siden sier nå hvor grensen går, og at `--fs-textarea-min-height: 0` lar
  `rows` bestemme alene.
- **`fristil tema oppskrift.json --ut tema.css` skrev ingen fil.** Uten
  likhetstegn ble `--ut` og `tema.css` lest som to filnavn etter
  oppskriften og ignorert. Temaet gikk til utdata, og kjøringen avsluttet
  med 0. På samme måte forsvant `--aksent #f00` bak fargen i fila. Nå stopper
  `tema` og ber om likhetstegn, slik `overta` og `agent` gjør, og mer enn én
  oppskriftsfil gir også feilkode. `overta` og `agent` stopper dessuten på et
  ukjent flagg med likhetstegn, som `--utt=src/ui` eller `--rammverk=react`,
  i stedet for å bruke standarden.
- **`fristil tema` leser oppskriften som `JSON.parse`.** Sto en nøkkel to
  ganger, vant den første, mens `JSON.parse` lar den siste vinne. Tall som
  `0700` og `1.` og et rått kontrolltegn i en streng ble godtatt, og en fil
  med svært dyp nesting stoppet den kjørbare fila med «stack overflow». Nå
  vinner den siste verdien, slike tall og strenger gir «er ikke gyldig
  JSON», og det gjør også mer enn 128 objekter og lister inni hverandre.
- **Tall i temaet og manifestet skrives som `String(tall)` i JavaScript.**
  `1e-7` ble `0.0000001` og `1e21` ble `1000000000000000000000`, og et
  uendelig tall ble `inf`. Nå får de eksponent, som `1e-7` og `1e+21`, og
  `Infinity` heter `Infinity`. I manifestet blir et uendelig tall `null`,
  som i `JSON.stringify`. Vanlige tall skrives som før.
- **Meldingen for `aria-controls` som peker på en id som ikke finnes, slutter
  ikke lenger med et mellomrom.** Det sto igjen etter «styrer.», i
  `fristil sjekk`, i editoren og som to mellomrom før regelnavnet i
  `assertFristil`.
- **En BOM først i en fil eller side gir ikke lenger en kolonne for mye.**
  `fristil sjekk` talte U+FEFF som et tegn på linje 1, så kolonnen var én
  mer enn editoren viser. For en adresse svarte `npx` riktig, fordi Node
  fjerner BOM-en, mens den kjørbare fila og `java -jar` ga én kolonne mer.
  Nå fjernes den for filer, standard inn og adresser i alle verter.
- **Språkserveren og `fristil sjekk` regner `\r` som linjeskift.** Bare
  `\n` delte linjer, så et dokument med `\r`-linjeskift ble én lang linje,
  og en editor som sender bufferen slik den er, som Neovim med
  `fileformat=mac`, fikk funnene og hurtigrettelsene på feil sted. Nå er
  `\n`, `\r\n` og `\r` alene linjeskift, som LSP krever. Linje og kolonne i
  `diagnosePage`, `assertFristil` og `fristil sjekk` følger samme regel.
  Hurtigrettelsen «Sett inn en ledetekst» gir også `<label>` sin egen linje
  med samme innrykk når linjeskiftene er `\r`.
- **Eksempelet på siden om Kotlin viste feil regelnavn.** Funnet for en
  `for` som peker på en id som ikke finnes, sto med `[for-peker-feil]`, men
  regelen heter `id-finnes-ikke`. `for-peker-feil` gjelder en `for` som
  peker på et element som ikke kan ha ledetekst. Den som kopierte navnet
  til `<!-- fristil-ignore-next … -->`, fikk funnet likevel.
- **Oppskriften for å bytte skilletegn i `fs-breadcrumbs` tok ikke med
  alternativteksten.** Siden viste `content: "›"`, og en regel utenfor laget
  slår stilarket, så den som fulgte rådet fikk tilbake feilen 0.33.0 rettet:
  skjermleseren sa «›» mellom hvert steg. Snutten har nå `content: "›" / ""`
  bak samme `@supports` som stilarket, og siden sier hvorfor. En test kjører
  snutten fra siden mot stilarket.
- **Oppskriften for å bytte pila i `fs-accordion` lot rotasjonen stå.** Siden
  sa at `content` og `border` var nok, men pseudoelementet har fast størrelse
  og `transform`, og vinkelen byttes når panelet er åpent, så et «+» sto på
  skrå og ble et «×» i åpen tilstand. Et synlig tegn uten alternativ tekst
  ble dessuten en del av navnet på knappen, det skjermleseren sier når
  `<summary>` får fokus. Snutten nullstiller nå begge og gir tegnet tom
  alternativ tekst.
- **JSDoc-eksempelet for `alert` spredte `alert.title`.** `alert.title` er
  klassenavnet, en streng, og `<p {...alert.title}>` gir tegnene som
  attributter og ikke klassen. Eksempelet skriver `class={alert.title}`,
  som accordion og card.
- **Fieldset-siden sa at en `<legend>` lenger ned ikke kobles til gruppen.**
  Nettleserne bruker den første `<legend>`-en som navn og tegnet ledetekst
  uansett hvor den står. Regelen om at den skal stå først gjelder fortsatt,
  men begrunnelsen er at HTML krever det, og at markupen ellers er ugyldig.
- **Select-siden sa at listen tegnes i siden fra Chromium 148.** Det eneste
  stilarket spør om, er `@supports (appearance: base-select)`, og den slår
  til i eldre Chromium også; 148 er versjonen Fristil er testet i. Tabellen
  sier nå hva som avgjør, og hvilke versjoner som er testet.
- **Skip Link-siden begrunnet `tabindex="-1"` med at neste Tab fortsatte i
  menyen.** Nettleseren fortsetter fra målet etter hoppet også uten
  attributtet. Det som mangler uten det, er fokuset og skjermleserens
  opplesning, og det sier siden og mønstersiden «Sideskjelett» nå. Error
  Summary-siden og JSDoc-en til `fs-error-summary` sa det samme om en vanlig
  ankerlenke, at neste tastetrykk fortsatte i oppsummeringen, og sier nå at
  nettleseren bare gir fokus til et mål som kan få det. Siden og
  stilarket sa også at fokus satt fra kode aldri regnes som synlig fokus.
  Det gjelder bare etter et museklikk, og det er det tilfellet `:focus` er
  valgt for.
- **Lagringseksempelet på Switch-siden rullet ikke tilbake ved et feilsvar,
  og tok fokuset fra bryteren.** `fetch` avviser bare ved nettverksfeil, så
  et 500-svar ble meldt som «Varsler er på.» med bryteren stående i ny
  stilling. Eksemplet slo dessuten av bryteren mens den lagret, og
  `disabled` tar fokuset fra en bryter som har det uten å gi det tilbake, så
  et nytt mellomromstrykk gjorde ingenting. «Ren HTML» og React sjekker nå
  `svar.ok` og sperrer et nytt trykk uten `disabled`, Datastar-fanen og
  eksemplet med `fs.setAttributes` slår ikke lenger av bryteren, og
  JSDoc-en til `disabled` i `switchControl` advarer mot bruken. Det korte
  eksemplet på Connection Status-siden og i JSDoc-en til
  `FsConnectionStatus` sjekker også `svar.ok`. En test kjører «Ren
  HTML»-eksemplet fra siden mot en server som svarer 500.
- **`fs-list` beholder punktene og tallene sammen med Tailwinds Preflight.**
  Standardvarianten sa ingenting om `list-style` og lente seg på nettleseren,
  mens Preflight setter `list-style: none` på hver `<ul>` og `<ol>`. Med
  oppsettet Tailwind-siden anbefaler, `@import "tailwindcss"` og `base` før
  `fristil`, mistet lista punktene og nummereringen, og det gjorde lista i
  `fs-error-summary` også. Klassen setter nå `list-style-type: revert`, som
  går tilbake til nettleserens eget stilark, så listene ser ut som uten
  Tailwind. Variantene `plain` og `divided` er fortsatt uten punkter. Vil du
  ha et annet punkt på alle `.fs-list`, sett det selv, i CSS uten lag eller
  i et lag etter `fristil`: en `list-style` på `ul` i et lag foran, som
  `base`, når ikke lenger fram til klassen. Testen bygger oppsettet med
  Tailwinds egen `preflight.css`, ikke en håndskrevet utgave med bare
  knappereglene.
- **Lagrekkefølgen for Tailwind tar med `fristil-tema`.** Et generert tema
  erklærer `@layer fristil, fristil-tema;`, og en `@layer`-setning flytter
  ikke lag som alt er erklært. Med den anbefalte linja
  `@layer theme, base, fristil, components, utilities;` havnet temaet derfor
  sist, etter `utilities`, og slo Tailwind-klassene og `@layer base` på de
  samme elementene, enda Tilpasning- og Eget tema-sidene sa at din egen CSS
  fortsatt vinner. Linja i dokumentasjonen og i kommentaren i `tailwind.css`
  er nå `@layer theme, base, fristil, fristil-tema, components, utilities;`,
  og Eget tema-siden sier at laget må stå der når Tailwind brukes, og at
  linja må stå i `<head>` når temaet lastes som en `<link>` før den
  bundlede CSS-en, for da har temaet alt erklært lagene sine. Temaet
  `fristil tema` skriver, er uendret.
- **Tailwind-siden og Design tokens-siden sa at skalaen følger med når du
  setter `--fs-spacing-1`.** `p-4` er `calc(var(--fs-spacing-1) * 4)`, men
  `--fs-spacing-4` og de andre trinnene er egne verdier, så eksempelet
  `--fs-spacing-1: 0.3rem` ga `p-4` 1,2rem mens komponentene sto på 1rem.
  Sidene og kommentaren i `tailwind.css` sier nå at trinnene må skrives om
  hver for seg, og eksempelet gjør det. Tabellen over skalaen oppgir også
  `px` som Tailwind-motstykket til `--fs-spacing-px`, der det sto «ingen».

## 0.33.0 (2026-10-12)

### Brytende

- **Kjernen bærer ingen data.** `fristil-kjerne.wasm` hadde manifestet og
  fargekontrakten bygget inn. Nå gir verten dem. For `diagnoseMarkup`, `diagnosePage`,
  `buildTheme` og `fristil` fra npm er ingenting endret: pakken gir
  kjernen sitt eget manifest og sin egen fargekontrakt. Den som laster
  kjernen selv, merker det:
  - `loadCore()` gir en kjerne uten noe. Kall `loadManifest()` før
    sjekken og `loadContract()` før temaet, ellers kaster de med en
    forklaring. `resetManifest()` er fjernet, siden det ikke finnes noe
    innebygd å gå tilbake til. `version().manifest` er `null` før et
    manifest er gitt.
  - En vert i et annet språk kaller `load_manifest_raw` og den nye
    `load_contract_raw` først. `diagnose_markup_raw`, `diagnose_page_raw`
    og `inspect_theme_raw` svarer nå 0, eller 1 med `{"error": …}`, som
    `build_theme_raw` og `diagnose_styled_raw` alt gjorde.
    `reset_manifest` er fjernet.
  - Kommandolinja leser manifestet, fargekontrakten, regelbøkene og
    komponentene fra `@fristil/designsystem`: fra mappa
    `FRISTIL_PACKAGE` peker på, eller fra `node_modules` i arbeidsmappa
    eller over den. npm-pakken og `fristil.jar` setter variabelen selv.
    `fristil.wasm` i wasmtime og den kjørbare fila fra `cargo install`
    trenger den, eller pakken installert, og stopper med en forklaring
    uten. `fristil agent` og `fristil overta` svarer dermed for versjonen
    prosjektet har installert.

  Modulen er 93 kB mindre.
- **En temagrense har nå en flate.** Et element med `data-theme="light"`
  eller `data-theme="dark"` får temaets bakgrunn og tekstfarge. Før fikk det
  mørke tokens, men beholdt sidens hvite bakgrunn, så brødteksten i en mørk
  seksjon på en lys side ble 1,23:1. Regelen har spesifisitet null i
  `@layer fristil`, så en komponent med `data-theme` på seg, og din egen stil
  uten lag eller i et senere lag, beholder sin egen bakgrunn. Stil i et lag
  foran `fristil` taper. `<html>` og `fs-toast` får ingenting. En innebygd
  komponent med `data-theme` på rotelementet står nå på temaets flate i
  stedet for å være gjennomsiktig over verten.
- **`--fs-focus-ring`, `--fs-color-disabled-surface` og
  `--fs-color-disabled-text` følger en temagrense.** De sto bare på `:root`,
  der en `var()` regnes ut én gang for hele siden, så en mørk seksjon på en
  lys side fikk den lyse fokusringen, 2,4:1 mot flaten. De deklareres nå i
  hver temablokk. Har du overstyrt en av dem på `:root`, gjelder ikke
  overstyringen lenger inne i et `data-theme`. Skriv den også på
  `[data-theme="light"]` og `[data-theme="dark"]`.
- **`fristil sjekk-tema` kontrollerer en blokk som ikke er bundet til lyst
  tema, som en bar `:root`, i mørkt tema også.** Fristils mørke blokk
  overstyrer bare tokenene den selv har, så en verdi som ingen mørk blokk
  tar, står også når systemet er i mørkt. Sjekken så den bare som lys:
  `--fs-color-neutral-text: #0d4e8c` på `:root` ga «holder hvert løfte», men
  har 2,22:1 i mørkt. Funnene merkes «i mørkt tema, ingen mørk blokk
  overstyrer». En blokk med `color-scheme: light`, en selektor med `light`
  som eget ord og `@media print` gjelder bare lyst og kontrolleres som før. Et tema som før var grønt kan nå gi funn, og da var
  det brutt i mørkt hele tiden.
- **`fristil sjekk` melder nye funn.**
  - Et flagg med en tekstmal i verdien, som `data-optional="{{ .Optional }}"`
    eller `open="<%= open %>"`. Malen skriver verdien som tekst, og et boolsk
    attributt er på uansett verdi, også «false» og en tom streng. Regelen er
    `boolsk-med-verdi`. Astro, Svelte, JSX, Razor og JTE tar selv bort et
    usant boolsk attributt, og meldes ikke. Står attributtet alt i en
    betingelse i malen, som `{{ if .Open }} open="{{ .Open }}" {{ end }}`,
    meldes det heller ikke.
  - En `fs-link` eller `fs-button` med både `aria-disabled="true"` og `href`.
    Stilen slår av musa, men Enter følger lenken. Regelen er ny:
    `deaktivert-med-href`.
- **`fs.link({ disabled: true })` gir `role="link"` og `tabindex="0"`.** En
  deaktivert lenke skal skrives uten `href`, ellers følger Enter den, og uten
  `href` er en `<a>` ingen lenke for skjermleseren og står ikke i
  tabrekkefølgen. De to gir begge tilbake, og `disabled: false` fjerner dem.
  `fs.link()` forvalter dermed `role` og `tabindex`: setter du en av dem
  selv på en lenke, som `role="menuitem"` i en meny, fjerner
  `fs.setAttributes(lenke, fs.link())` den. Sett den etter. Komponentsidene
  for Link og Button viste en deaktivert lenke med `href`, og det gjorde også
  rådet i byggefunksjonen. Har du fulgt det, ta bort `href` mens lenken er
  av.
- **`hidden` skjuler nå alle komponentene.** Forfatterstil slår nettleserens
  `[hidden] { display: none }`, så `<div class="fs-alert" hidden>` og 41 andre
  klasser, åtte av elementene og barn uten klasse, som `option` i en stylet
  `fs-select`, et ledd i `fs-breadcrumbs` og en rad i fillista, sto
  synlige. En regel i `@layer fristil` med `!important` skjuler dem nå,
  slik nettleseren selv gjør. Den kan ikke overstyres med en regel uten
  `!important`, og heller ikke med `!important` uten lag. `hidden="until-found"`
  får stå.
- **`.fs-tooltip__bubble` er `display: none` når den er skjult**, ikke
  `visibility: hidden`. En skjult boble tok plass og ga sidelengs rulling ved
  høyre kant. Teksten er fortsatt knappens beskrivelse gjennom
  `aria-describedby`.

### Lagt til

- **`.fs-icon` og `fs.icon()`, for et ikon fra appens eget sett.** Klassen
  går på en `<svg>` og gjør den like stor som teksten rundt. `fs.icon()` gir
  `aria-hidden="true"`, og `fs.icon({ label })` gir `role="img"` og
  `aria-label` for et ikon som betyr noe alene. Fristil sender ingen ikoner.
  Stilarket er `@fristil/designsystem/icon.css`.
- **Regelen `ikon-uten-navn`.** En `<button>` eller `<a href>` med bare et
  ikon i seg og ikke noe navn er en feil i `fristil sjekk`, i editorene og
  i `diagnoseMarkup`. Navnet kan komme fra tekst, også med `fs-sr-only`, fra
  `aria-label`, `aria-labelledby` eller `title`, eller fra `alt` på et bilde.
  Det som er skjult med `aria-hidden="true"` eller `hidden`, teller ikke.
  Står det noe på knappen eller et barn som ikke er vanlig HTML, som
  `:aria-label`, `v-bind`, `x-text` eller `{...props}`, kan navnet komme
  derfra, og regelen tier.
- **Typen `Manifest` fra `@fristil/designsystem/diagnostics`**, formen på
  `manifest.json` slik skjemaet beskriver den, for den som leser manifestet
  selv. Kotlin-pakken har det samme som `Fristil.manifest`, og leser et
  prosjekts eget manifest med `Manifest.parse`: elementene med attributter,
  deler og hendelser, og klassene med attributtene og de lovlige verdiene.
- **Delene og beskrivelsene står i manifestet.** Hvert element har nå
  `description` og `parts`: delene web-komponenten finner i markupen, med
  selektoren den leter med, hva delen skal inneholde, og om den kan stå
  flere ganger eller mangle. `<fs-field>` har ledetekst, kontroll,
  hjelpetekst og feilmelding, og `<fs-dialog>` har dialogen, tittelen og
  kroppen. Hvert attributt på et element og hvert valg i en
  byggefunksjon har `description`, og et attributt på en klasse har
  beskrivelsen til valget med samme navn. Et verktøy eller et
  annet språk kan dermed lese hva hvert element leter etter, uten å lese
  kildekoden.
  Feltene er nye og valgfrie i skjemaet, så `schemaVersion` er fortsatt 1.
  Fragmentet fra `fristil overta` gir klassene nye navn også i selektorene
  og beskrivelsene, så kopien beskrives med sine egne klasser.
  Selektorene eksporteres også, fra hovedinngangen og fra inngangen til
  hver av de sju web-komponentene som finner deler, som `FS_FIELD_PARTS`
  fra `@fristil/designsystem/field`.
- **`@fristil/designsystem/fargekontrakt.json`** i `exports`, så en side
  som laster kjernen i nettleseren kan gi den fargekontrakten med
  `loadContract()`, som den gir manifestet fra `./manifest.json`.
- **Hendelsene har typer i `addEventListener`.** `HTMLElementEventMap` og
  `DocumentEventMap` utvides med hver hendelse web-komponentene sender,
  med `detail` slik komponenten sender den: `dialog-toggle` gir
  `event.detail.open` som `boolean` og `returnValue` som `string`. Typene
  følger med hver inngang til web-komponentene, `/register`, `/react` og
  `/react-jsx` medregnet, så `as CustomEvent<…>` trengs ikke lenger. Typen
  står også som `FsEventMap` i hovedinngangen. Den genereres fra den samme metadataen
  som manifestet og `web-types.json`, og har ingen avhengighet av React.
- **`"./package.json"` i `exports`.** Et verktøy som leser pakkens versjon
  med `require.resolve("@fristil/designsystem/package.json")` eller
  `import … with { type: "json" }`, fikk `ERR_PACKAGE_PATH_NOT_EXPORTED`.
  Nå finner de den.
- **`--fs-progress-border`** styrer kanten rundt sporet i `fs-progress`.
- **`fs.popover()` skriver `type="button"` på knappen.** En knapp uten `type`
  sender skjemaet den står i.
- **`session-activity` og `activity-interval` på `fs-session-timeout`.**
  Klokka nullstilles av aktivitet i nettleseren, men serverøkten visste
  ikke om den. En bruker som skrev i et langt skjema uten et eneste kall til
  serveren, fikk aldri varselet, og innsendingen feilet fordi serverøkten
  var ute. Hendelsen kommer i starten av hvert intervall med aktivitet og på
  slutten hvis brukeren har gjort noe siden, høyst én gang per
  `activity-interval` sekunder (standard 60, minst 1), og aldri mens
  varselet står eller etter at økten er ute. `fs.sessionTimeout()` tar
  `activityInterval`. Komponentsiden viser også hvordan flere faner holder
  klokkene i takt.
- **`--fs-accordion-padding-inline`** gir overskriften og innholdet i
  `fs-accordion` samme luft til sidene. Før gjaldt `--fs-accordion-padding`
  bare overskriften.
- **Hendelsene står i manifestet, i `web-types.json` og i regelbøkene.**
  Elementene som sender hendelser, har nå `events` i manifestet, med feltene
  i `detail` og typen deres, som `dialog-toggle` med `open` og `returnValue`.
  `web-types.json` har dem som `js.events`, og regelbøkene har en kolonne for
  dem. Før sto de bare på komponentsidene, og noen ikke der heller.

- **`manifest` i `Fristil.diagnoseMarkup` og `Fristil.diagnosePage` i
  Kotlin.** Teksten i et `manifest.json`, som det `fristilManifest`
  skriver, gir sjekk mot komponentene prosjektet har overtatt. Uten valget
  gjelder manifestet i pakken, som før. Et manifest kjernen ikke kan lese,
  kaster `IllegalArgumentException` med grunnen.

### Endret

- **Pil opp og ned bytter ikke lenger fane i en vannrett `fs-tabs`.** De
  stjal siderullingen og avvek fra WAI-ARIA. De virker når raden har
  `aria-orientation="vertical"`.

### Rettet

- **`fs.setAttributes` virker på en `<svg>`.** Klassen ble satt med
  `className`, som er skrivebeskyttet på et svg-element, og kallet kastet
  «Cannot set property className». Den settes nå med `setAttribute`.
- **`<fs-field>` kobler bare sine egne deler.** Sto et felt inni et annet,
  som et søkefelt i et sprettoppvindu inni feltet, fant det ytre feltet det
  innerste feltets kontroll først og skrev `for`, `id` og
  `aria-describedby` på den. Nå ser hvert felt bare kontrollen, ledeteksten,
  hjelpeteksten og feilmeldingen som hører til det selv, slik de andre
  komponentene alt avgrenset delene sine. Et felt med mer enn én kontroll
  gir en advarsel i konsollen, siden bare den første får koblingen.
- **En overskrift i kroppen til `<fs-dialog>` blir ikke lenger tittel.**
  Uten `aria-labelledby` og `aria-label` tok komponenten den første
  overskriften i dialogen, også en som sto i `fs-dialog__body`, og ga den
  klassen `fs-dialog__title` og stilen som følger med. Nå er tittelen den
  første overskriften utenfor kroppen, og en dialog som står uten navn,
  gir en advarsel i konsollen i stedet for å låne innholdets overskrift.
- **En ubestemt `fs-progress` var en tom ramme i høykontrastmodus.** Stripen
  som sveiper over, er en gradient, og modusen fjerner gradienter. Den
  tegnes nå i `Highlight` på `Canvas` med `forced-color-adjust: none`, så
  brukerens systemfarger fortsatt gjelder.
- **Kotlin skriver tall i attributter slik JavaScript gjør.** `jsNumber` ga
  `1000000000000000000000` for `1e+21`, `0.0000001` for `1e-7` og den
  eksakte binærverdien for heltall over 2^53, som `123456789012345683968`
  for `123456789012345680000`, og byggefunksjonene i
  Kotlin kunne dermed skrive et annet attributt enn `fs` i TypeScript. Nå
  brukes de færreste sifrene som gir det samme tallet tilbake, og
  JavaScripts regler for når eksponent brukes. Etterprøvd mot JavaScript på
  224 614 tall uten avvik, hver toerpotens medregnet.
- **`fristilManifest` skriver bare `build/fristil/manifest.json` når
  `manifests` har fragmenter**, og sletter fila når det siste fragmentet er
  fjernet. Språkserveren foretrekker den fila framfor pakken i
  `node_modules`, så en kopi uten fragmenter ble stående med versjonen fra
  da den ble skrevet, også etter at pakken var oppgradert.
- **Fokusringen på det valgte alternativet i `fs-toggle-group` var 1,23:1.**
  Ringen står oppå den valgte flaten, og har nå `accent-content` som farge
  der.
- **Sporet i `fs-progress` var 1,12:1 mot siden.** Stolpen har nå en kant i
  `neutral-border`, så det synes hvor langt den går. Kanten er tegnet innover
  og tar ikke av høyden.
- **`fs-dialog` meldte forrige knapps verdi når dialogen ble lukket uten
  knapp.** Escape og `close()` uten argument lar `returnValue` stå fra forrige
  lukking. En dialog serveren åpnet på nytt og så lukket, sendte derfor
  `dialog-toggle` med for eksempel `returnValue: "slett"` fra gangen før, og en
  app som skiller «Avbryt» fra «Slett» på verdien kunne slette noe brukeren
  aldri ba om. Komponenten tømmer nå verdien hver gang den åpner dialogen.
  Skriver noe `open` på verten etter at brukeren har trykket en knapp, men før
  `close` er kommet, åpner komponenten heller ikke dialogen igjen. Før gjorde
  den det, og verdien ble borte for en lytter på `close`.
- **`fs-dialog` åpnet seg ikke igjen etter at verten var flyttet.** En morfer
  som flytter verten kobler den fra og til, og komponenten tok den gamle
  `returnValue` for en lukking brukeren gjorde før skriptet kom, og fjernet
  `open` serveren nettopp hadde satt. Den sjekken gjøres nå bare første gang
  en dialog sees, også når den flyttes inn i en ny vert.
- **`fs-dialog` meldte `open: true` for en dialog som var åpen hele tiden.**
  En morfer som flytter verten eller dialogen, tar dialogen ut av topplaget,
  og komponenten åpner den igjen. `dialog-toggle` kommer nå bare når
  tilstanden faktisk endrer seg.
- **`data-color="neutral"` på `fs-dialog` ga mer luft enn ingen farge.**
  Verdien er standardverdien og skal se ut som ingen verdi, men reglene for
  luften traff bare en dialog uten attributtet. Nå gjelder de alt som ikke er
  en av de fem fargene, også en tom verdi fra en mal.
- **Knappen i `fs-popover` sendte skjemaet den sto i.** Komponenten setter nå
  `type="button"` på en `<button>` uten `type`, eller med en tom eller ukjent
  verdi, også etter en patch som river det bort. En knapp som sier
  `type="submit"` selv, får stå. Eksemplene på komponentsiden og snippeten i editoren har det med.
- **Escape i `fs-popover` tok for mye.**
  - Et trykk i et annet felt flyttet fokus fra feltet til knappen. Nå lukkes
    vinduet, og fokus blir stående.
  - Et trykk i en modal dialog åpnet oppå vinduet lukket vinduet også. Nå
    lukker det bare dialogen.
  - Et trykk noe annet alt hadde brukt, som en forslagsliste i vinduet som
    lukket seg, lukket vinduet også. Nå står vinduet.
  - Med to vinduer inni hverandre lukkes nå det innerste først.
- **`fristil sjekk --css` fulgte ikke `@import` fra en pakke.**
  `@import "@fristil/designsystem/fristil.css"` er et navn i pakkens
  `exports`, og fila ligger i `dist/`. Sjekken lette etter den som en fil i
  `node_modules` under arbeidsmappa, fant ingenting og meldte hver klasse som
  ustylet. Nå slår den opp i `exports`, også mønstre som `./*` og en pakke
  importert ved navn alene, i nærmeste `node_modules` over stilarket. En
  relativ sti slås aldri opp som en pakke.
- **`fristil sjekk-tema` leste `dark` inne i `:not()`.**
  `.kort:not([data-theme="dark"])` ble kontrollert som et mørkt tema.
  `:root:not([data-theme="dark"])` gjelder også i systemets mørke modus, og
  kontrolleres nå mot begge temaer.
- **`fristil sjekk` meldte Bootstraps `fs-1` til `fs-6` som ukjente
  klasser.** En klasse som er `fs-` og bare sifre, er ikke Fristils.
- **`fristil sjekk` kjente ikke `writingsuggestions`, `autocorrect` og
  `headingoffset`.** De er globale attributter i HTML.
- **`fs-suggestion` nådde ikke et felt React styrer.** Valget ble satt rett på
  noden, React så ingen endring, `onChange` kom aldri, og ved neste rendring
  skrev React den gamle teksten tilbake. Komponenten bruker nå setteren fra
  elementets prototype.
- **`fs-session-timeout` kunne hoppe over en opplesning.** Et tikk som kom
  sent, kunne gå fra 61 til 59 sekunder, og «1 minutt» ble aldri lest opp.
  Opplesningen kommer nå når en terskel krysses.
- **`fs-toast` mistet fokus.** Ble den siste meldingen lukket, eller ble alle
  fjernet med `clear()`, mens en melding hadde fokus, falt fokus til `body`.
  Det går nå tilbake dit det kom fra. `label` skrev også over en
  `aria-label` forfatteren hadde satt, og når `label` ble fjernet, sto det
  gamle navnet igjen.
- **`fs-tabs` og `fs-error-summary` holdt fast faner og lenker en morfing
  hadde byttet ut.** Begge har nå én lytter på verten.
- **Dokumentasjonen lovet for mye.** «Kom i gang» og «Rammeverk» sa at
  markupen i en `ramme`-komponent vises uansett, men Tabs og Suggestion
  skjuler innhold til de er registrert. Datastar-oppskriften for Error
  Summary flyttet ikke fokus ved andre feilede innsending, og skjema-mønsteret
  skrev oppsummeringen med `role="alert"` på nytt ved hvert tastetrykk, så
  skjermleseren ble avbrutt. Toast og Connection Status sier nå at de er
  inerte mens en modal dialog står åpen.
- **Avslått vant ikke over en tilstand.** Et ugyldig eller vellykket felt
  som var slått av, så rødt eller grønt ut, ikke avslått. Det gjaldt input,
  select, textarea, filopplasting, avkryssingsboks og radioknapp.
- **Gjeldende side i `fs-pagination` ble uleselig under musa i høykontrast.**
  Hover-regelen slo høykontrastregelen, og bakgrunn og tekst fikk samme farge.
- **Skilletegnet i `fs-breadcrumbs` ble lest opp.** Generert innhold leses
  opp, så skjermleseren sa «skråstrek» mellom hvert steg. Det har nå en tom
  alternativ tekst der nettleseren støtter det.
- **Boblen i `fs-tooltip` forsvant før musa nådde den.** Gapet mellom knappen
  og boblen har nå en usynlig bro i knappens bredde mens boblen vises. Flytter
  du boblen under knappen, må broen også flyttes; snutten på komponentsiden
  har det med. Komponentsiden sier at boblen ikke kan
  lukkes med Escape, som WCAG 1.4.13 krever, og når Popover passer bedre.
- **Pila i `fs-accordion` pekte sidelengs i høyre-til-venstre**, og pila i
  `fs-select` sto 6 piksler fra kanten der i stedet for 12.
- **En overskrift i `summary` i `fs-accordion` fikk nettleserens marg og
  størrelse.** Dokumentasjonen viser `<summary><h3>`, og raden ble høyere og
  teksten større enn uten overskrift.
- **Flaggene på klassene manglet i editoren og i regelbøkene.**
  `data-interactive` på `fs-card`, `data-selectable` på `fs-tag`,
  `data-hoverable` på `fs-table` og `data-optional` på `fs-label` og
  `fs-legend` sto i manifestet, men ikke i forklaringen i VS Code eller i
  tabellene en kodeagent leser. Klasseattributtene til web components, som
  `data-color` på `.fs-dialog`, sto heller ikke i regelbøkene.
- **`fristil sjekk` ga feil på `<fs-error-summary data-autofocus="true">`.**
  Komponenten flytter fokus for alt annet enn `"false"`, og `"true"` er nå
  lovlig.
- **Editoren sa at `required-marker="text"` skriver «må fylles ut».** Den
  skriver «(påkrevd)».
- **Regelbøkene kalte `data-variant="outline"` oppfunnet.** Det er
  standardvarianten til `fs-card` og `fs-tag`. Eksempelet er nå `outlined`.
  `fs-theme-control` sto ikke i lista som kalles «hele lista».
- **Språkserveren fant bare pakken ved rota av arbeidsområdet.** I et
  monorepo ble en side i `apps/web` sjekket mot det innebygde manifestet,
  enda `apps/web/node_modules` hadde pakken. Den leter nå fra mappa til fila
  og oppover, men ikke over rota av arbeidsområdet.
- **Dokumentasjonen sa at feilmeldingene bare finnes i VS Code.** Pluginen
  for IntelliJ har dem, i filer og i HTML i en merket streng, og regelbøkene
  nevner nå den og Fristil for Kotlin.
  Kotlin-siden sa at hver tråd får sin egen instans av kjernen. Det er en
  pool.

## 0.32.1 (2026-10-09)

### Rettet

- **`fs-divider` var usynlig i flex og grid.** Nettleseren gir `<hr>`
  auto-marger til sidene, og i en flex-kolonne vinner de over
  `align-items: stretch`. Streken har ikke noe innhold å være bred av, så den
  ble 0 piksler bred og forsvant. Det gjaldt også eksempelet på
  komponentsiden og demosiden for sideskjelettet. Klassen nullstiller nå
  margene til sidene og strekker seg selv, så streken fyller bredden også i en
  flex- eller grid-forelder som sentrerer barna eller legger dem til start.
  Har du gjort streken smalere selv, står den nå til start; sett
  `margin-inline: auto` for å sentrere den.

### Endret

- **`fs-divider` med `data-variant="subtle"` er litt tydeligere.** Den brukte
  `--fs-color-neutral-surface`, som lå så nær lerretet at streken nesten
  forsvant. Nå bruker den `--fs-color-neutral-raised`, som ligger mellom
  flatefargen og `border-subtle` i både lyst og mørkt tema.

## 0.32.0 (2026-10-08)

### Brytende

- **Sjekken er Rust-kjernen.** `diagnoseMarkup` og `diagnosePage` i
  `@fristil/designsystem/diagnostics` kjører nå den samme
  WebAssembly-modulen som VS Code, IntelliJ og Fristil for Kotlin, i stedet for
  en egen utgave i TypeScript. Svarene er de samme: begge utgavene ble kjørt
  side om side på over 4000 sider uten ett avvik før TypeScript-utgaven ble
  slettet. Modulen følger pakken og lastes første gang en av funksjonene
  kalles, i Node, Bun og Deno.

  Disse forsvinner fra `@fristil/designsystem/diagnostics`:

  | Borte | I stedet |
  | --- | --- |
  | `diagnose(text, elements, classes)` | `diagnoseMarkup(text)`. Et eget ordforråd gis som manifest med `loadCore(modul).loadManifest(json)`. |
  | `checkReferences(text)` | `diagnosePage(text)`, som gir koblingsfunnene sammen med resten. Regelnavnet i `rule` skiller dem. |
  | `pageSource(text)` | Ingen. `diagnosePage` leser siden slik den gjorde. |
  | `elements`, `classes` | `@fristil/designsystem/manifest.json`, med elementene, klassene og de lovlige verdiene. |
  | `closest`, `tagEnd`, `withoutHidden` | Ingen. De var hjelpere for sjekken. |
  | typene `Attribute`, `Element`, `Elements`, `ClassAttribute`, `ClassInfo`, `Classes` | Skjemaet i `@fristil/designsystem/manifest.json` (`manifest.schema.json`). |

  `diagnosePage(text, elementer, klasser)` tar ikke lenger egne lister.

  Ingenting endres i `fs`, i komponentene eller i CSS-en.

- **Temaet er Rust-kjernen.** `buildTheme` i `@fristil/designsystem/tema` og
  `inspectTheme` og `checkTheme` i `@fristil/designsystem/tema-sjekk` kjører
  den samme WebAssembly-modulen som sjekken. Svarene er de samme: de to
  utgavene ble kjørt side om side på over 6000 oppskrifter og temaer, med
  ugyldige farger, farlige verdier og ødelagt CSS, uten ett avvik, heller ikke
  i kontrastforholdene. `buildTheme` laster modulen fra pakken i Node, Bun og
  Deno. I nettleseren lastes den med `loadCore` fra
  `@fristil/designsystem/diagnostics`, og modulen er
  `@fristil/designsystem/kjerne.wasm`.

  Fargekontrakten er data, i `src/tokens/fargekontrakt.json`, og regningen
  finnes bare i kjernen. Disse forsvinner:

  | Borte | I stedet |
  | --- | --- |
  | `buildMatrix(merker, utseende)` fra `matrise` | `buildTheme(merker)`, som gir `light`, `dark` og `violations`. Fristils egne farger er `lightCells` og `darkCells` i `matrise`. |
  | `buildFamily`, `promisesFor`, `checkPromises` og typen `Violation` fra `kontrakt` | `buildTheme` for et tema, `inspectTheme` for å kontrollere ett. `Violation` står i `tema`. |
  | `parseBlocks` og typen `ParsedBlock` fra `tema-sjekk` | `inspectTheme`, som leser blokkene. |
  | typene `Matrix` og `RoleCss` fra `matrise` | `MatrixToken` gir hvert navn. |

  `ROLES`, `NEUTRAL_LAYERS`, `REQUIREMENT`, `FAMILIES`, `FRISTIL_BRANDS`,
  `roleToCss` og `tokenName` er der som før, og `@fristil/designsystem/farge`
  er uendret.

- **Pakken krever Node 20.16 eller nyere** (`engines` i `package.json`), eller
  Bun eller Deno. Kjernen lastes med `process.getBuiltinModule`, som kom i
  Node 20.16 og 22.3. En eldre Node får beskjed om at versjonen er for
  gammel. Node 18 og 20 har ikke lenger støtte fra Node-prosjektet.
- **`fristil overta` gir kopien nytt navn.** `fs-button` blir `app-button` i
  klassene, taggene, `customElements.define` og selektorene, så kopien er
  din og kan stå ved siden av originalen. Variablene fra temaet, `--fs-*`,
  beholder navnet. Bytt til det nye navnet i markupen der kopien skal brukes.
  Kopier du har tatt fra før, røres ikke.

### Nytt

- **Kommandolinja uten Node.** Den samme kommandolinja kjører som
  `java -jar fristil.jar` (Java 17 eller nyere), i wasmtime som
  `fristil.wasm`, og som en kjørbar fil med
  `cargo install --git https://github.com/MarkusAugust/fristil fristil`.
  Jar-en og modulen ligger ved hver utgivelse på GitHub, med attestasjon av
  hvilken commit de ble bygd av, og svarer det samme som `npx`, byte for
  byte.
- **`fristil overta` skriver et fragment av manifestet** ved siden av kopien,
  `fristil-manifest.json`, og `fristil sjekk --manifest=<fil>` sjekker
  markupen for kopien mot det. Bare kopiens egne navn sjekkes, ikke resten av
  prosjektets klasser.
- **Sjekken ser stilarkene.** `fristil sjekk --css=<fil>`, og `css` som valg
  til `diagnoseMarkup` og `diagnosePage`, sier fra om en klasse ingen av
  stilarkene styler (`ustylet-klasse`) og om en verdi uten regel
  (`ustylet-verdi`). Stilarkene leses av en CSS-leser i kjernen, med
  nesting, `:is()`, `:where()`, `@layer` og `@import`. Pakkens egen kontroll
  av at CSS-en og manifestet sier det samme, bruker den også.
- **`diagnoseRendered(page)`** sjekker siden slik nettleseren har rendret
  den, med Playwright: DOM-en etter at web-komponentene og skriptene har
  kjørt, og stilarkene den faktisk lastet, også fra et CDN.
- **`fristil lsp`, språkserveren.** Funnene og hurtigrettelsene i hver editor
  som snakker LSP: Neovim, Helix, VS Code og andre, med UTF-16-posisjoner.
  Den sjekker mot manifestet i `build/fristil/` eller i `node_modules`, med
  det innebygde som reserve, og leser det på nytt når det endres. Den
  startes med `npx`, `java -jar`, wasmtime eller den kjørbare fila.
- **`fristil manifest`** skriver manifestet sjekken bruker, med fragmentene
  lagt til, for en editor eller et annet verktøy.
- **Gradle-pluginen `io.github.markusaugust.fristil`**, med `fristilSjekk`
  (kjøres av `check`), `fristilTema` og `fristilManifest`, som skriver
  `build/fristil/manifest.json`. Den kjører den samme kommandolinja i
  Gradle-prosessen.

- **Kommandolinja er skrevet i Rust.** `npx @fristil/designsystem` kjører den
  som en WASI-modul med Node sin egen `node:wasi`, og den samme koden kan
  bygges som en kjørbar fil. Kommandoene, flaggene, meldingene og feilkodene
  er de samme: alle 130 kjøringene i pakkens egen test av kommandolinja svarer
  likt, byte for byte. Én melding er ny: er en oppskrift til `fristil tema`
  ikke gyldig JSON, er forklaringen kjernens egen og ikke Nodes.

- **Funnene har regelnavn, linje og kolonne.** `rule` er navnet på regelen,
  som `ukjent-klasse`, og `line` og `column` er der funnet begynner, fra 1.
- **Et funn kan undertrykkes med en kommentar** over taggen:
  `<!-- fristil-ignore-next ukjent-klasse -->`. Uten regelnavn gjelder den
  alle reglene for den neste taggen. Det virker i `fristil sjekk`, i
  editorene og i testene.
- **`loadCore(modul)`** i `@fristil/designsystem/diagnostics` laster kjernen
  fra en modul du har selv, som i nettleseren eller i en utvidelse som pakker
  den med seg. Den gir også `loadManifest(json)`, `resetManifest()` og
  `version()`.
- **`@fristil/designsystem/manifest.json`** beskriver hele ordforrådet og
  hver byggefunksjon som data, med skjema. Det er det Fristil for Kotlin
  genereres fra, og det kjernen sjekker mot.
- **`data-color` på `fs-dialog` sjekkes.** Sjekken kjente ikke fargene
  `fs.dialog({ color })` gir, fordi ordlista bare leste byggefunksjoner som
  svarer med ett sett. `data-color="red"` sa derfor ingenting. Nå meldes en
  ukjent farge, med de fem lovlige og `neutral` som standard.
- **Flaggene på klassene står i manifestet:** `data-optional` på `fs-label`
  og `fs-legend`, `data-interactive` på `fs-card`, `data-selectable` på
  `fs-tag` og `data-hoverable` på `fs-table`. Sjekken sier fra om
  `data-optional="false"`, som slår flagget på, slik den gjør for boolske
  attributter på elementene.
- **Kommentarer i malspråkene hoppes over.** Markup i `{{-- --}}` i Blade,
  `@* *@` i Razor, `{{/* */}}` i Go, `{# #}` i Jinja, Twig og Nunjucks, og
  `<%-- --%>` i JSP ble sjekket som om den ble rendret, og en tagg i en
  kommentar ga funn.
- **`fristil sjekk-tema` og `inspectTheme` leser CSS med en ekte
  tokenizer**, den fra Servo som Firefox bruker. En klamme eller et semikolon
  i en streng, i `url(…)` eller i en kommentar delte en blokk eller en
  deklarasjon, og en farge kunne forsvinne fra kontrollen uten et ord. En
  blokk som ikke er lukket, leses nå til fila slutter, slik nettleseren gjør,
  i stedet for å hoppes over, og meldingen om klammene står fortsatt.
- **En stor side med mange funn sjekkes raskere.** Linja og kolonnen til hvert
  funn ble regnet fra starten av teksten. 6000 funn på en side med 3000 linjer
  tok en kvart sekund, og tar nå 25 millisekunder.

- **Hver side i dokumentasjonen finnes som Markdown.** `/components/button/`
  har sin på `/components/button.md`, og hver side lenker til sin med
  `<link rel="alternate" type="text/markdown">`. Lenkene i `/llms.txt` går dit.
  Filene lages av de bygde sidene, så «Ren HTML»-fanen med `<link>`-ene,
  importlinjene og versjonsnummeret står der slik siden viser dem, og fanene
  står etter hverandre.

## 0.31.0 (2026-10-06)

### Nytt

- **`fristil sjekk` sjekker hele sider.** En adresse, som
  `fristil sjekk http://localhost:8080/skjema`, hentes og sjekkes som en hel
  side, og `--rendret` gjør det samme for filer og standard inn. På en hel side
  kreves det i tillegg at hver id i `for`, `aria-describedby`,
  `aria-labelledby` og `aria-controls` finnes, at `for` peker på et felt, at
  ingen id står to ganger, at hvert felt med en `fs-`-klasse har en
  ledetekst, at hver synlige hjelpetekst og feilmelding som ikke er et
  statusfelt er koblet, og at hver
  lenke i `<fs-error-summary>` går til en id som finnes. En adresse som svarer
  med noe annet enn HTML, gir feilkode. Bar markup inni `<fs-field>` gir ingen
  funn. En mal sjekkes som før uten flagget, siden en id der kan stå i en
  annen fil.
- **`diagnosePage(html)` og `checkReferences(html)`** i
  `@fristil/designsystem/diagnostics` gir den samme sjekken til tester skrevet
  i JavaScript. **`pageSource(html)`** gir siden slik sjekken leser den, uten
  kommentarer, innholdet i `<script>`, `<style>`, `<textarea>` og
  `<template>`, og markup i attributtverdier, med posisjonene uendret.

## 0.30.0 (2026-10-05)

### Nytt

- **Kolonner som kan sorteres i `.fs-table`.** `.fs-table__sort` er knappen
  i overskriften, og `aria-sort` på `<th>` er tilstanden. Pila tegnes fra
  `aria-sort`, med begge pilene dempet når kolonnen ikke er sortert, og
  knappen fyller cellen, så overskriftsraden har samme høyde og innrykk som
  uten knapp. `fs.tableSort({ direction })` gir `header` og `button`, og
  `tableSortDirections` er de lovlige retningene. Sorteringen er appens.

## 0.29.0 (2026-10-05)

### Brytende

- **`<fs-session-timeout>` lager ikke lenger dialogen selv.** Den som
  rendrer skriver dialogen og teksten inne i elementet, på sitt eget språk,
  og komponenten tar tiden: den åpner og lukker dialogen, fyller inn tallet
  og leser opp nedtellingen. Før var tittelen, teksten og knappene norsk
  skrevet rett i koden, og kunne ikke oversettes. Komponenten finner delene
  på `<dialog>`, `.fs-session-timeout__count`, `[role=status]` og knappene i
  et `<form method="dialog">`, og setter `open` tilbake når en morfing tar
  det fra en dialog som står i topplaget, slik `<fs-dialog>` gjør. Uten det
  sto siden fast etter en patch fra Datastar uten `data-ignore-morph`. En
  knapp med `value="logout"` logger ut, og
  alt annet, Escape medregnet, forlenger. Hendelsene, `warn-at`,
  `expires-at`, `extend()` og `reset()` er de samme, men `session-logout`
  og `session-extend` fra en knapp kommer nå med `close`-hendelsen, altså
  litt etter klikket og ikke i det. Det du må gjøre: skriv
  dialogen inn i elementet, slik komponentsiden viser. Et tomt
  `<fs-session-timeout>` sier fra i konsollen i det varselet skulle kommet,
  og `fristil sjekk` melder det.
- **`fs.sessionTimeout()` gir ett attributtsett per del,** som
  `fs.dialog()`: `host`, `dialog`, `title`, `text`, `count`, `live`,
  `actions`, `extend` og `logout`. `titleId` er påkrevd, siden en id som
  lages av seg selv ikke overlever hydrering.
- **Komponenten ligger i `ramme/` og ikke i `frittstaende/`.** Navnene i
  `exports` er de samme, men stien til fila er ny. Det du må gjøre: lenker
  du rett til fila på en CDN, bytt `frittstaende/session-timeout` med
  `ramme/session-timeout` i adressen.

- **Skrifttokenene heter `--fs-font-size-*` og `--fs-font-weight-*`.** De
  fjorten navnene var de eneste uten `fs-`, og de står på `:root` i en side
  Fristil ikke alltid eier. Et annet designsystem på samme side deklarerte de
  samme navnene, og da avgjorde rekkefølgen på stilarkene hvilken verdi
  begge systemenes komponenter fikk. Ved 0.22.0 fikk de beholde navnene,
  siden de alt fulgte CSS-egenskapen de setter; det holder ikke når
  navnet deles med andre. Det gjelder de ni størrelsene, de fire vektene og
  `--font-family-base` fra temageneratoren, som nå heter
  `--fs-font-family-base`. Tailwind-klassene, som `text-fs-m`, heter det
  samme. Det finnes ingen aliaser, siden et alias fortsatt måtte stått på
  `:root` under det gamle navnet. Det du må gjøre: bytt `--font-size-` med
  `--fs-font-size-`, `--font-weight-` med `--fs-font-weight-` og
  `--font-family-base` med `--fs-font-family-base` i egen CSS, og lag
  temaet ditt på nytt med `fristil tema` hvis du har ett. Et tema laget med
  en eldre utgave setter skriften under de gamle navnene, og den delen av
  temaet virker ikke lenger uten at noe sier fra. Fargene virker som før.

### Nytt

- **`data-fs-boundary` er en grense mot vertssiden.** Bygges en komponent
  inn i en side du ikke eier, slår vertens CSS uten lag `@layer fristil`, og
  en `button { background: none }` tar bakgrunnen fra `.fs-button`. Under
  et element med attributtet ser nettleseren bort fra CSS uten lag, så
  Fristils lag gjelder igjen, mens skrift og annet som arves fortsatt kommer
  fra verten og `--fs-*`-variablene virker. Regelen ligger i `fristil.css`,
  og som `@fristil/designsystem/boundary.css`. Den har spesifisiteten (0,2,0),
  og egen CSS inne i grensen må ligge i et lag. Se «Vertens CSS stopper ved
  grensen» under Tilpasning.
- **`--fs-select-padding` og `--fs-select-width`.** Luften i nedtrekkslista
  kan settes som i feltet. I standardutseendet står plassen til pila fast,
  og `auto` gir et kompakt felt så bredt som innholdet.
- **`--fs-input-width`,** av samme grunn.
- **Boblen i `.fs-tooltip` har `box-sizing: border-box`,** så
  `--fs-tooltip-width` er hele boblen også i en side uten en CSS-reset.

- **`close-label` på `<fs-toast>`** er standard for hva lukkeknappen i hver
  melding heter for skjermleseren. `fs.toast({ closeLabel })` skriver det,
  og `closeLabel` i `show()` overstyrer det for én melding.
- **Antall treff i `<fs-suggestion>` kan oversettes,** med `count-none`,
  `count-one` og `count-other`, og `count-zero`, `count-two`, `count-few` og
  `count-many` for språk som har dem. `{n}` står for antallet, og
  `Intl.PluralRules` velger form etter `lang` på siden. Uten attributtene er
  teksten norsk som før.
- **Markeringen på `.fs-label` og `.fs-legend` leses fra variabler:**
  `--fs-label-required-symbol`, `--fs-label-required-text` og
  `--fs-label-optional-text`, med « *», « (påkrevd)» og « (valgfri)» som
  reserve.
- **Opplesningen av nedtellingen følger sidens språk.** Varigheten skrives
  med `Intl` etter `lang`, så den er «1 minutt og 30 sekunder» på en norsk
  side og «1 minute and 30 seconds» på en engelsk.
- **`@fristil/designsystem/default-texts`** har hver standardtekst pakken
  skriver inn i siden. En vaktpost i bygget feller en tekst som står rett i
  en komponent i stedet for der, en tekst i CSS som ikke leses fra en
  variabel, og en tekst som mangler i tabellen på siden om oversettelse.

## 0.28.0 (2026-10-04)

### Brytende

- **`.fs-toast` er nå klassen på regionen, og meldingen heter
  `.fs-toast__message`.** Regionen ble stylet med elementnavnet, så en
  `<fs-toast>` registrert under et annet navn mistet plasseringen i hjørnet.
  Komponenten setter klassen på seg selv, og `fs.toast().host` skriver den.
  Elementnavnet `fs-toast` har fortsatt de samme reglene, så en region uten
  klassen står der den sto.
  Det du må gjøre: har du egen CSS mot `.fs-toast`, eller en server som
  skriver meldinger rett inn i regionen, bytt til `.fs-toast__message`.
  `fs.toast().toast` heter `fs.toast().message`, og `TOAST_MESSAGE_CLASS` er
  ny ved siden av `TOAST_CLASS`. `--fs-toast-*`-variablene er de samme.
- **Varianten `default` på hjelpeteksten heter `strong`.** Standardverdien
  er `muted`, og overalt ellers betyr `default` «gir ikke attributt». Det du
  må gjøre: bytt `data-variant="default"` med `data-variant="strong"`, og
  `fs.helpText({ variant: "default" })` med `"strong"`.
- **`fs.suggestion()` leser ikke lenger `open` for tommeldingen.** Den
  skriver `hidden` på «Ingen treff» når det finnes treff, eller når `pending`
  er satt. At lista er lukket, tar stilarket seg av: `.fs-suggestion__empty`
  vises ikke etter en liste med `hidden`. Før måtte en app som filtrerer selv
  (`prefiltered`) sende `open`, en tilstand bare komponenten kjenner, så
  meldingen kunne aldri vises. Det du må gjøre: tommeldingen må stå etter
  lista, som søsken, og et asynkront søk sender `pending: true` mens svaret
  er underveis.
- **Forslagslista åpnes ikke når den er tom og feltet er tomt.** Fokus åpnet
  en liste uten alternativer, med `aria-expanded="true"` over ingenting. Et
  felt som venter på sitt første søk viser dermed ikke «Ingen treff» før
  brukeren har skrevet noe.

- **`fs.setAttributes` rydder bare det byggefunksjonen selv forvalter.**
  Før hadde den én felles liste, og `fs.setAttributes(knapp, fs.button())`
  fjernet `disabled`, `hidden`, `open`, `aria-describedby`, `multiple` og
  `accept` fra elementet, selv om knappefunksjonen aldri har skrevet noen av
  dem. En deaktivert knapp ble aktiv, og et åpent `<details>` lukket seg. Nå
  fjernes et attributt bare når settet kommer fra en byggefunksjon som
  skriver det: `fs.switch()` kan ta bort `disabled`, `fs.button()` rører det
  ikke. Regelen går begge veier: har byggefunksjonen et valg for et
  attributt, eier den det. `fs.spinner()` har `label`, så et kall uten
  `label` fjerner `role` og `aria-label`, også når du skrev dem for hånd.
  Det gjorde den ikke før. `id` og `for` fjernes aldri. Det du må gjøre:
  send valgene på nytt i hvert kall, og skal to sett på samme element, send
  dem hver for seg, `fs.setAttributes(felt, fs.input(), kobling.control)`,
  ikke spredd sammen i ett objekt. Et spredd objekt settes riktig, men rydder
  bare `data-*`, og funksjonen sier fra i konsollen første gang.

### Lagt til

- **`pending` i `fs.suggestion()`.** Holder «Ingen treff» skjult mens svaret
  på et søk er underveis.
- **Regelboka for bundlere forklarer `fs.setAttributes()`.** Ingen av
  regelbøkene nevnte funksjonen, så en kodeagent som skrev markup uten
  spredning fikk ikke vite om den, eller om at to sett sendes hver for seg.

### Rettet

- **En dialog styrt av React-tilstand lot seg ikke lukke i React 19.** React
  skriver `el.open = undefined` når en prop går fra `true` til borte, og
  setteren vekslet attributtet i stedet for å fjerne det. Dialogen åpnet seg
  igjen etter både knappen og Escape, og sprettoppvinduet ble stående åpent.
  Det samme gjaldt `invalid`, `disabled` og `optional` på `<fs-field>` og
  `prefiltered` på `<fs-suggestion>`.
- **Fanene lot seg ikke bytte under `server-controlled`.** Klikket ble angret
  i neste mikrotask, fordi komponenten leste serverens gamle valg fra minnet.
  Klikket står nå til noen andre rører `aria-selected` eller `hidden`, og da
  bestemmer serveren som før.
- **`optional` og `required-marker` på `<fs-field>` lot seg ikke slå av.**
  Komponenten leste sin egen `data-optional` og `data-required` tilbake fra
  ledeteksten. Markeringer serveren skrev der, står fortsatt.
- **`<fs-field>` fjernet en `data-state="invalid"` malen hadde skrevet.** Den
  fjerner nå bare den den selv satte.
- **Feiloppsummeringen tok fokus når en synlig liste ble tømt og fylt igjen.**
  Brukeren ble rykket ut av feltet han rettet. Fokus flyttes nå bare når
  boksen går fra skjult til synlig.
- **`<fs-connection-status>` ble hengende etter å ha vært ute av dokumentet.**
  Kvitteringen sto for godt, og linja sa offline etter at nettet var tilbake.
- **Økttidsvarselet sluttet å være modalt når elementet ble flyttet,** og
  opplesningen sa «2 minutter» med 1:30 igjen. Den sier nå «ett minutt og 30
  sekunder».
- **`fs.setAttributes` rydder de boolske valgene.** `data-interactive` på
  kortet, `data-hoverable` på tabellen, `data-selectable` på etiketten,
  `data-autofocus` på feiloppsummeringen og `placement` på sprettoppvinduet
  ble stående etter at valget var tatt bort.
- **`fristil tema --merke1`, `--merke2` og `--merke3` ble lest som
  filnavn.** Flaggleseren godtok ikke sifre.
- **`fristil overta button --ut src/ui` ignorerte flagget** og skrev til
  standardmappa. Den stopper nå og ber om likhetstegn, slik `agent` gjør.
- **Advarselen fra `fs.dialog()` uten id ba om `id`.** Valget heter
  `titleId`, og det står nå i meldingen.
- **Eksempellinja i `fristil --hjelp`** hadde en linjefortsettelse som ble
  til fem mellomrom midt i kommandoen.
- **En deaktivert knapp med variant så aktiv ut.** `secondary`, `ghost` og
  `danger` hadde samme bakgrunn, tekst og kant med og uten `disabled`, og
  fikk hoverfarge under musa. Regelen for deaktivert sto over variantene og
  tapte på rekkefølgen.
- **Musa tok bort feilrammen og rammen på en valgt** avkryssingsboks, radio
  og bryter. Hover var løftet over tilstandene med `:not(:disabled)`.
- **Hjelpeboblen sto en hel boblebredde til venstre i RTL.**
- **Søkefeltet mistet forstørrelsesglasset** når det var ugyldig, gyldig
  eller deaktivert og `input.css` ble lastet etter `search.css`. Tilstandene
  setter nå `background-color` og ikke kortformen.
- **«(valgfri)» hadde kontrast 4,37:1 i lyst tema.** Teksten brukte fargen
  for deaktivert tekst. Den bruker nå `--fs-color-neutral-text-subtle`.
- **«(påkrevd)» kunne komme ut som «pÃ¥krevd».** Tegnet sto rått i
  stilarket, og en side uten `<meta charset>` fra en tjener som ikke sender
  tegnsettet, leste det feil. Det står nå som en escape.
- **Markup med både `data-required` og `data-optional` viste «(valgfri)».**
  Byggefunksjonen velger påkrevd, og stilarket gjør nå det samme.
- **Regelbøkene for kodeagenter sa tre ting som ikke stemte.** At
  registrering på en server gir «customElements is not defined» (den gjør
  ingenting, uten et ord), at siden «ser tom ut» uten registrering (det gjelder
  bare de tre frittstående), og at `tokens.css` må lastes før komponentens
  stilark (rekkefølgen betyr ikke noe). React-boka viser nå `fs.field()` med
  `useId()` for et felt, ikke `<fs-field>`, som gir hydreringsfeil med
  server-rendring. Formatet fra `fristil sjekk` står med alvoret,
  `fil:linje:kolonne: feil: melding`.
- **Lenkene til dokumentasjonen peker på `fristil.sobernetics.no`.**
  `homepage` i pakken, regelbøkene, `web-types.json` og lenkene diagnostikken
  skriver ut brukte `fristil.netlify.app`.
- **Byttet en patch ut et panel i `<fs-tabs>`, sto fanen og pekte på en id
  som ikke fantes.** Det nye panelet fikk verken id, rolle eller `hidden`.
  Det får nå den samme id-en fanen alt peker på. `<fs-suggestion>` gjør det
  samme for feltet og lista: et nytt felt får id-en ledetekstens `for` peker
  på.
- **Fanene tok piltaster med Alt, Ctrl og Cmd.** Alt+venstrepil er «tilbake»
  i nettleseren, og ble stoppet.
- **Escape i et sprettoppvindu inne i en modal dialog lukket begge.**
  Tastetrykket stopper nå i vinduet.
- **Feiloppsummeringen meldte en prosentkodet lenke som brutt.**
  `href="#f%C3%B8dselsdato"` peker på `id="fødselsdato"`, og oppslaget
  dekoder nå fragmentet slik nettleseren gjør.
- **Økttidsvarselet frøs når `warn-at` ble hevet mens dialogen sto.**
- **Tilkoblingslinja viste den gamle teksten** når `offline-text` eller
  `online-text` ble byttet mens den sto.
- **Skillelinja og skjelettet var usynlige i høykontrastmodus.** Begge var
  bare en bakgrunn. Linja bruker nå en systemfarge, og skjelettet får en
  kant.
- **Et kort som er en `<button>` hadde nettleserens knappeskrift,** 13
  piksler. Kortet arver nå hele skriften.
- **`<span aria-disabled="true">` i sidenavigeringen hadde ikke boksen til
  lenkene,** så rekka hoppet når «Neste» ble byttet inn på siste side.

## 0.27.1 (2026-10-03)

### Rettet

- **Størrelsen på `fristil.css` i regelbøkene.** Tre av dem sa «rundt 75 kB,
  under 10 kB komprimert» om en fil på 90 kB og 11 kB. Tallet var hardkodet i
  generatoren; det regnes nå ut av de samme `exports`-oppføringene fila
  bygges av. `bygg:css` skrev også KiB merket som kB, og telte
  UTF-16-kodeenheter framfor byte.

## 0.27.0 (2026-10-02)

### Lagt til

- **`fs.progress()` og `progress.css`.** En framdriftsstolpe på et ekte
  `<progress>`, så rollen og opplesningen av tallet kommer fra nettleseren.
  `data-color` gir `success`, `warning` og `danger`, og uten `value` blir
  stolpen ubestemt. `max` har standardverdien 100 og skrives alltid ut: HTMLs
  egen standard er `1`, og en `<progress value="40">` uten `max` viser en full
  stolpe uten at noe sier fra.

## 0.26.1 (2026-10-02)

### Rettet

- **Beskrivelsene i klassekatalogen stemmer med komponentsidene.** `classes.ts`
  og `web-types.json` leser frontmatteren fra hver komponentside, og fire av dem
  sa «én klasse» om en komponent med to. Hoverboksen i VS Code og
  JetBrains-IDE-ene siterte tallet videre.

## 0.26.0 (2026-10-02)

### Lagt til

- **`.fs-theme-control` lar brukeren velge tema uten JavaScript.** Klassen står
  på en radioknapp, og `value` sier hvilket tema den velger: `auto`, `light`
  eller `dark`. Selektoren er en ekstra linje på de to temablokkene i
  `tokens.css`, og den samme linja i temaer `buildTheme()` skriver. «Følg
  systemet» har ingen temablokk, siden en verdi uten blokk nettopp skal falle
  tilbake på mediespørringen. `light` og `dark` vinner over `data-theme` på
  `<html>`, slik at serveren kan sende et lagret valg mens et klikk slår
  igjennom før svaret er tilbake. `auto` gjør det ikke: har serveren skrevet
  `data-theme`, står serverens verdi, og det som lagrer valget må også fjerne
  attributtet.
- **Hvert av de tre valgene setter `color-scheme` selv.** `light` gir `light`,
  `dark` gir `dark`, og `auto` gir `light dark` så lenge `<html>` ikke bærer
  `data-theme="light"` eller `data-theme="dark"`. Det siste er ikke et tema, men beskjeden til nettleseren om at siden
  fungerer i begge, så den kan tegne sine egne flater etter systemet.

  Bruker du velgeren, skal du ikke skrive `color-scheme` på `<html>` selv: en
  regel utenfor et lag slår `@layer fristil`, og nettleserens egne flater blir
  låst til systemet mens brukeren har valgt noe annet. For den som ikke bruker
  velgeren, er ingenting endret, og bar `:root` har fortsatt ingen
  `color-scheme`.

  Overstyrer du et token per tema, må dine egne `[data-theme]`-blokker ha
  velgerens selektor ved siden av. CSS kan ikke skrive et attributt, så
  velgeren setter ingen `data-theme`.

## 0.25.0 (2026-10-01)

### Rettet

- **Språkvask i regelbøkene og dokumentasjonen.** Et «de» som skulle vært
  «dem», og en forklaring og et eksempel som var lånt fra en konkret
  feilrapport framfor å stå på egne bein. Teksten beskriver nå mekanismen:
  en innebygd komponent i en vertsside.

## 0.24.0 (2026-10-01)

### Lagt til

- **JetBrains-IDE-ene foreslår nå `fs-`-klassene.** `web-types.json` hadde
  bare de ni web-komponentene, så du fikk forslag på `<fs-field>` men
  ingenting på `fs-button`, enda klassene er den eneste delen en
  CSS-komponent har. Nå står alle 72 under `contributions.css.classes`, med
  komponentnavn og lenke til dokumentasjonssiden.

  VS Code-utvidelsen har hatt dette hele tiden, i kode framfor i data, så
  dette retter en skjevhet mellom de to editorene. Lista bygges av
  `classesData()`, den samme funksjonen som skriver `classes.ts`, så editoren
  kan ikke foreslå en klasse diagnostikken avviser.

## 0.23.0 (2026-10-01)

### Brytende

- **`data-theme="light"` deklarerer nå alle de lyse tokenene, ikke bare
  `color-scheme`.** Før sto blokken med én linje mens `[data-theme="dark"]`
  hadde alle 90, så lyst tema virket bare på `<html>`: et barn kan ikke
  overstyre en variabel det arver uten å deklarere den på nytt. Nå er
  attributtet en temagrense begge veier, på et hvilket som helst element, og
  et tema kan ligge inne i et annet.

  **Overstyrer du en farge per tema, må du legge til en `[data-theme="light"]`-
  blokk.** En deklarasjon på elementet selv vinner over en verdi det arver,
  uansett hvilket lag arven kom fra, så uten blokken står Fristils egen farge
  inne i en lys temagrense mens din gjelder ellers på siden. Oppskriften i
  «Tilpasning» viser alle fire blokkene.

- **Temageneratoren skriver nå også `[data-theme="light"]`.** `buildTheme()`
  skrev `:root`, mediespørringen og `[data-theme="dark"]`, men ikke den lyse
  blokken, så et generert tema hadde nøyaktig den samme asymmetrien: inne i en
  lys temagrense sto Fristils egen farge, mens temaets farge gjaldt ellers på
  siden. Har du et generert tema, må fila skrives om igjen med
  `fristil tema` for å få blokken.

- **`color-scheme` settes ikke lenger på `:root`.** Den står bare på
  `[data-theme="light"]` og `[data-theme="dark"]`, altså der noen har valgt et
  tema. Egenskapen arves nedover, så en verdi på roten gjaldt hele dokumentet,
  også der pakken bare er en gjest: en komponent som lastet `fristil.css` inn
  i en vertsside ga hele verten mørke rullefelt og skjemakontroller i mørk
  modus, langt utenfor komponenten selv.

  **Vil du at nettleserens flater skal følge systemet på hele siden, skriver
  du `color-scheme: light dark` på `<html>` selv.** Det er den samme avtalen
  som for lagrekkefølgen.

### Rettet

- **Regelbøkene for kodeagenter og dokumentasjonen sa ulike ord om det samme.**
  Regelbøkene under `agent/` skrev «byggerne» og «egendefinert element» der
  dokumentasjonen skrev «byggefunksjon» og «web component». En agent som får
  begge i konteksten møtte to navn på én ting. `sjekk-ordbruk.ts` vokter nå
  begge ordene, og leser også `README.md` i pakken, som den ikke gjorde før.

## 0.22.0 (2026-09-29)

### Brytende

- **Fargene er en matrise, ikke to lag.** En farge er et punkt i en matrise av
  **familie** (`accent`, `visited`, `brand1-3`, `neutral`, `danger`, `warning`,
  `success`) og **rolle** (`surface`, `border-subtle`, `border`,
  `border-strong`, `fill`, `content`, `text-subtle`, `text`, `text-strong`).
  Navnet er `--fs-color-<familie>-<rolle>`.

  `--palette-*` og `--semantic-*` er borte. Det samme er `--size-*`, som nå
  heter `--fs-spacing-*`. Hvert fargenavn, hver avstand, hver linjeavstand,
  hvert ikon, skyggen og fokusringen heter nå `--fs-<slag>-<navn>`, som hos
  Tailwind, daisyUI og Digdir, og slaget i navnet er det som lar Tailwind-temaet
  bli generert framfor skrevet av for hånd. De tretten `--font-size-*` og
  `--font-weight-*` beholder navnene sine, siden de alt følger CSS-egenskapen
  de setter.

- **Kontrasten er garantert av konstruksjonen.** Kuløren er konsumentens,
  lysheten er rollens. Lyshetene er regnet fram mot et sveip rundt hele
  fargesirkelen på den høyeste metningen sRGB kan vise, så løftene holder
  uansett merkefarge. Justeringspasset som flyttet fargen din etterpå er borte,
  og det samme er metningstaket `maxChroma`: uten et pass å mate finnes det
  ingenting å dempe for.

- **Generatoren er 352 linjer mot 744.** `buildScale`, `buildNeutralScale`,
  `adjustForContrast`, `SCALE_STEPS`, `NEUTRAL_STEPS`, `MAX_CHROMA`,
  `CHROMA_FLOOR`, `CHROMA_CEILING` og typen `AdjustResult` er fjernet fra
  `@fristil/designsystem/farge`, som nå bare har fargeregningen. Fra
  `@fristil/designsystem/tema` er typen `ThemeAdjustment` og feltet
  `Theme.adjustments` borte.
  En familie du utelater arver Fristils egen framfor å felle kjøringen, så
  `fristil tema --aksent=#7c3aed` er nok. Flagget het `--interaktiv`, og heter
  nå `--aksent`, som familien. To navn på den samme fargen var nettopp det
  matrisen skulle bli kvitt.

- **To nye roller og ett nytt lag kom av migreringen.** `border-strong`, fordi koden brukte
  tre kantnivåer og matrisen hadde to: en feltramme som endrer seg ved hover,
  og en tabellstrek som er tydeligere enn en radskiller. `text-strong`, fordi
  brødtekst satt til `text` ble `#4a4d51` der den før var `#1a1a1a`, altså
  8,5:1 mot hvitt der den hadde 17,4:1. Kravet holdt, lesbarheten ikke.
  Brødteksten står nå på `text-strong`, `#27292b`, som er 14,6:1. Og `raised`,
  som er et lag den nøytrale familien har ved siden av rollene, siden tekst må
  holde mot et kort som ligger over et kort.

### Lagt til

- **`fristil sjekk-tema <fil…>`** kontrollerer et tema noen har skrevet selv,
  og sier hvilken celle som ryker og hvorfor. Den teller verdiene konsumenten
  selv skrev: både filtallet og løftetallet er de samme for én linje som for et
  helt tema, siden standardverdiene fyller hullene.

- **Tre nye inngangspunkter:** `./kontrakt` med rollene og løftene, `./matrise`
  som bygger et tokensett av merkefarger, og `./tema-sjekk`.

### Rettet

- **Gjeldende side i pagineringen forsvant under musa.**
  `.fs-pagination a:hover` slo `[aria-current="page"]` på spesifisitet, så
  sidetallet brukeren sto på fikk en lys flate mens teksten ble stående i
  `accent-content`: 1,09:1 i lyst tema og 1,25:1 i mørkt. Gjeldende side er nå
  unntatt fra regelen og har sin egen hover. Feilen har vært der siden
  pagineringen kom, og ingen test så den, fordi `:hover` ikke kan leses av
  `getComputedStyle`.

  `hover.browser.test.ts` fører nå musa over tolv av de fjorten hover-reglene
  som bytter bakgrunn, i begge temaer, og krever 4,5:1. De to siste ligger bak
  et pseudoelement og bak en `@supports` Firefox ikke har, og kontrolleres på
  tokenparet. Lista er bundet til stilarkene, så en ny slik regel uten et
  tilfelle feller testen, og hvert tilfelle påstår at flaten under musa er en
  annen enn flaten uten.

- **Siste steg i brødsmulestien ble blått under musa.** Samme årsak:
  `:hover` slo `[aria-current="page"]`. Gjeldende steg er ikke et sted å gå,
  og står nå urørt.

- **Tre steder i dokumentasjonen sto «byggefunksjon» der ordet var et verb,**
  som «generatoren byggefunksjon skalaene». Setningene ga ingen mening.

- **«Tilpasning» sa «fire veier» over en tabell med tre rader.**

- **«Eget tema» sa at skriften settes i `@layer fristil`.** Den står i
  `fristil-tema`.

## 0.21.0 (2026-09-28)

### Lagt til

- **Folketelling over attributter bare morferen leser.** `fs.browser.test.ts`
  kaller hver byggefunksjon og krever at `data-ignore-morph` kommer ut fra
  nøyaktig `connectionStatus`, `sessionTimeout`, `suggestion` og `toast`, og at
  `data-preserve-attr` ikke kommer ut fra noen. Vakten feller både et nytt
  sted attributtet dukker opp og et sted det forsvinner fra, siden begge
  endrer hva malen må skrive. Hjelperen i `morfing.browser.test.ts` hopper
  over attributter som står i en fredningsliste, slik den ekte løkka gjør. Står
  et navn der, fjerner løkka ingenting for nettopp det attributtet, og testen
  etterprøver ingenting. Noen av fixturene bygges av byggefunksjonene, og der
  feller folketellingen. Andre er skrevet for hånd, som en Go-mal ville gjort,
  og der feller en ny påstand i hjelperen om at lista er tom.

### Rettet

- **`<fs-field>` leter ikke lenger etter `data-role` på hjelpetekst og
  feilmelding.** Komponenten leste `[data-role='help']` og
  `[data-role='error']` ved siden av klassene `fs-help-text` og
  `fs-error-text`. Kroken sto bare i en `querySelector` i kilden, uten tester
  og uten omtale noe sted, så ingen kunne bygge på den med vilje. `data-role`
  er uprefikset og eies i praksis av andre, og en app som brukte det til noe
  annet inne i et felt fikk sitt eget avsnitt adoptert som feilmelding, uten at
  noe sa fra. Komponentsiden sier nå hva komponenten faktisk krever, og en test
  holder fjerningen på plass.

  Fjerningen er ingen brytende endring etter reglene øverst. Ingen
  byggefunksjon skrev attributtet og ingen komponent satte det, så ingenting i
  konsumentens markup endrer betydning: den virker som før, den blir bare ikke
  koblet.

- **Dokumentasjonen påsto mer enn den kunne vise.** «Holder markupen der,
  holder den overalt» var en påstand om alle morfere, mens vi kjører løkka til
  én. Kravet står nå slik det er: det en komponent har satt, skal overleve at
  attributter blir fjernet fra et element som består. Og `data-preserve-attr`
  og `data-ignore-morph` er beskrevet som morferens egne attributtnavn, siden
  et `data-*`-attributt bare betyr noe for koden som leser det.

- **«To komponenter eier sitt eget innhold» var tre.** `<fs-toast>` sto ikke i
  lista i «Markup og oppførsel», og at `fs.suggestion()` setter
  `data-ignore-morph` på statusområdet sto bare på komponentsiden, ikke der
  regelen forklares.

- **`overta` sa ingenting om tilgjengelighetsansvaret.** Siden om tilpasning
  sier nå at en overtatt og endret komponent ikke dekkes av en
  tilgjengelighetserklæring som viser til designsystemet.

## 0.20.0 (2026-09-28)

### Lagt til

- **`fristil agent` og regelbøkene i `agent/`.** Seks regelbøker skrevet for
  kodeagenter som Claude Code og GitHub Copilot, én per miljø: `html`, `maler`,
  `bundles`, `react`, `astro` og `datastar`. Hver er komplett for sitt miljø og
  nevner ingen andre, siden en agent som leser om `className` i et prosjekt med
  Go-maler er en agent som skriver `className` i en Go-mal. Vue, Svelte, Solid
  og Lit deler `bundles`, og `--rammeverk=svelte` peker dit.

  Hver fil har de fire feilene en agent gjør oftest øverst: glemt stilark,
  oppfunne komponenter og varianter, hardkodede farger og bommet registrering.
  Så følger alle komponentene med klasse, element, attributter og lovlige
  verdier, tokenlagene, de tre reglene for web components, og sjekken som
  retteløkke. Kommandoen leser miljøet av `package.json`, og `--rammeverk=<navn>`
  overstyrer.

  Kommandoen skriver aldri en fil. `AGENTS.md`, `CLAUDE.md` og
  `.github/copilot-instructions.md` er konsumentens egne, og et verktøy som
  skriver i dem må gjette stier, flette med innhold det ikke har skrevet, og
  holde en kopi i takt med pakken. Regelboka blir derfor stående i pakken, på
  `node_modules/@fristil/designsystem/agent/<navn>.md`, og følger versjonen.
  Mappa er med i tarballen.

  De samme filene ligger også på dokumentasjonssiden, på `/llms.txt` og
  `/agent/<navn>.md`. Den viktigste agenten har ingen `node_modules`: blir noen
  bedt om å lage et skjema med Fristil i en tom mappe, skrives markupen før
  `npm install` har kjørt.

  Filene genereres av `scripts/generate-agent.ts`, og `scripts/sjekk-agent.ts`
  feller hvis de er utdaterte, hvis en komponent mangler i en av dem, hvis et
  markupeksempel ikke tåler `diagnoseMarkup`, hvis en importsti ikke finnes i
  `exports`, hvis et tokennavn ikke finnes, eller hvis en `html`-blokk
  importerer et pakkenavn der nettleseren trenger en URL.

### Rettet

- **Versjonen i dokumentasjonens CDN-adresser kom fra 74 hardkodede steder.**
  `prepare-version` skrev dem om ved hver utgivelse, men et omskrivingssteg må
  finne den gamle versjonen for å bytte den, så en adresse som hadde glidd ble
  stående og pekte på en eldre pakke enn teksten rundt beskrev. Kilden har nå
  plassholderen `@fristil/designsystem@VERSJON`, og `remark-versjon.mjs` setter
  inn versjonen fra `package.json` når siden bygges. Omskrivingssteget er
  fjernet, og fire vaktposter passer på: tre på at kilden bruker plassholderen,
  og `sjekk-bygget-versjon.ts` på at den faktisk ble byttet ut i det bygde
  resultatet.

- **To kodeeksempler i dokumentasjonen importerte et pakkenavn i nettleseren.**
  Datastar-sporet på [Rammeverk](https://fristil.sobernetics.no/rammeverk/) og
  dialogen på
  [Bekreft en handling](https://fristil.sobernetics.no/monster/bekreftelse/) hadde
  `import … from "@fristil/designsystem/field"` i en `<script type="module">`.
  Ingen av sidene har et byggesteg, og en nettleser slår ikke opp et pakkenavn
  uten byggesteg eller importmap, så koden feilet stille for den som limte den
  inn. Begge bruker nå hele URL-en.

  Regelen fantes i `sjekk-oppskrifter.ts`, men den leser bare komponentsidene
  og velger regel ut fra navnet på fanen, så de to sto med feilen i flere
  runder. `sjekk-nettleserimport.ts` dekker nå alle sidene uavhengig av fane:
  en `html`-blokk er markup for nettleseren uansett hvor den står.

## 0.19.0 (2026-09-28)

### Lagt til

- **`maxChroma` i temageneratoren, og `--maks-metning` på kommandolinja.**
  Taket på metningen i de kulørte skalaene har stått fast på 0,16 i OKLCH. De
  fleste merkefarger ligger under det, men neon gjør ikke: `#39ff14` ligger på
  0,286 og mistet 44 prosent mot taket, `#ff2d6f` på 0,240 og mistet 33. Taket
  kan nå settes, i `buildTheme({ maxChroma })`, med `--maks-metning` på
  kommandolinja, eller som `maksMetning` i en oppskriftsfil. Standarden er den
  samme som før, så et tema som ikke oppgir noe kommer ut likt.

  Kontrastkravet berøres ikke. Taket styrer metning, mens kontrasten kommer av
  de faste lyshetene i skalaen og av passet som måler hvert par etterpå og
  flytter lysheten. Mer metning gir flere slike justeringer, ikke en svakere
  garanti, og et merke med hevet tak kjøres nå gjennom hele listen av par i
  `theme.browser.test.ts`. Den nøytrale skalaen har sitt eget, mye lavere tak,
  og er uendret.

  Oppskriftsfila sier nå fra om en ukjent toppnøkkel, slik dokumentasjonen
  alltid har lovet. En fil som har stått med en skrivefeil og virket, stopper
  derfor nå. `$schema` er fortsatt lovlig: editorer skriver den inn av seg selv,
  og den sier ingenting om temaet. En fil som er gyldig JSON, men ikke et
  objekt, får også en forklaring framfor et stakkspor fra Node.

  `buildTheme` avviser et tak utenfor 0,01 til 0,33. Et negativt tak speilet
  fargen og gjorde knallgrønt til magenta, `NaN` ga en feilmelding om en
  heksadesimal farge som aldri var oppgitt, og 0 ga et helt grått tema, alle
  tre i stillhet.

## 0.18.0 (2026-09-27)

### Lagt til

- **`fristil sjekk <fil…>` og `@fristil/designsystem/diagnostics`.** Sjekken
  editorutvidelsen kjører mens du skriver, elementer som ikke finnes,
  attributter elementet ikke har, verdier utenfor lista, klasser som
  `fs-buton` og `<fs-field>` uten kontroll, ligger nå i pakken.
  Kommandolinjen leser filer eller standard inn og skriver hvert funn som
  `fil:linje:kolonne: melding`, med feilkode ved funn. `diagnoseMarkup(html)`
  er den samme sjekken som funksjon, for en test i appen som kjører den over
  HTML-en serveren faktisk sender, der det ikke finnes noen malfil å sjekke.
  Editorutvidelsen importerer nå diagnostikken fra pakken, og listene den
  sjekker mot genereres inn i pakken som `elements.ts` og `classes.ts`.
- **`<fs-popover>`, `<fs-suggestion>` og `<fs-dialog>` kobler fra bar
  struktur,** som fanene og feiloppsummeringen. En knapp og et panel med
  klassen `fs-popover` er nok: komponenten setter `popover="manual"`, lager
  id-en og skriver `aria-controls` på knappen, ellers den første knappen
  utenfor panelet som ikke peker på noe annet. En `<label>`, et `<input>`,
  en `.fs-suggestion__list` med `<li>` og et statuselement er nok for
  forslagsfeltet: komponenten setter rollene, lager id-ene, skriver `for`
  og `aria-controls`, og holder lista lukket til brukeren rører feltet.
  Dialogen får klassen, og navnet sitt fra den første overskriften når den
  ikke alt har et fra `aria-labelledby` eller `aria-label`, med en id
  komponenten lager om den mangler; peker `aria-labelledby` på en overskrift,
  er det den som får tittelklassen. Bare det som mangler skrives,
  `suggestion.css` holder en bar liste skjult til komponenten er
  registrert, og advarslene sier hva som faktisk mangler.
  `derivedParts` og `uniqueId` i `/host-element` er hjelperne bak.
- **`<fs-tabs>` og `<fs-error-summary>` kobler fra bar struktur.** En
  `.fs-tabs__list` med knapper og ett `.fs-tabs__panel` per knapp er nok:
  komponenten setter rollene, lager id-ene, kobler `aria-controls` og
  `aria-labelledby`, og skjuler panelene som ikke er valgt. Valget leses fra
  `aria-selected`, ellers fra hvilket panel som ikke er `hidden`.
  Feiloppsummeringen får klassen, `role="alert"` og `tabindex="-1"`, og
  overskriften klassen sin. Det serveren har skrevet står, og det
  komponenten fylte inn settes tilbake etter en patch, med de samme id-ene.
  `tabs.css` viser bare det første synlige panelet til komponenten er
  registrert, så innholdet ikke hopper. Kotlin-malen i spilldemoen skrev sju
  attributter per fane for hånd. `fs.tabs()` og `fs.errorSummary()` er som
  før, for markup som lages med JavaScript.

  To ting endrer seg for markup som alt fantes. Under `server-controlled`
  setter fanene fortsatt ikke brukerens valg tilbake, men skriver nå ut det
  markupen sier: `aria-selected`, tabbestoppet og `hidden` i takt, så en
  patch som bare rørte panelene flytter også markeringen. Det komponenten
  selv skrev teller ikke som markupens svar. Og advarselen om manglende
  `tabindex` på feiloppsummeringen er borte, siden komponenten setter den.
- **`@fristil/designsystem/register`: `defineFs()` registrerer alle ni
  web-komponentene i ett kall,** også fra `dist/register.js` på en CDN.
  Spilldemoen sto med sju `defineFs*`-kall i en `useEffect`, altså etter
  første tegning, og den første meldingen fra hendelsesstrømmen kom i gapet:
  «reportSuccess is not a function». Dokumentasjonen sier nå: registrer ved
  import, aldri i en effekt.
- **De frittstående komponentene har funksjoner som venter på
  registreringen:** `showToast(element, tekst, valg)`,
  `reportFailure(element)`, `reportSuccess(element)`,
  `extendSession(element)` og `resetSession(element)`. De venter på
  `customElements.whenDefined` for elementets tagnavn og kaller så metoden,
  så et kall som kommer for tidlig blir gjort i stedet for å feile. Et
  element ingen registrerer gir en advarsel i konsollen etter tre sekunder.
  `whenUpgraded(element)` i `/host-element` er hjelperen bak dem.
- **`@fristil/designsystem/fristil.css`: alle stilarkene i én fil.** For den
  som lenker fra CDN eller `node_modules` uten byggesteg. De enkelte stilarkene
  henter delene sine med `@import`, som nettleseren først ser når fila er
  lastet, og på mobilnett sto feltene uten ramme til den andre runden kom;
  spilldemoen forhåndslastet fem filer for hånd for å komme rundt det. Fila
  bygges av CSS-oppføringene i `exports`, med `tokens.css` først, uten
  `@import` og uten kommentarer. Et byggesteg bruker de enkelte stilarkene som
  før. Tailwind-temaet er ikke med, siden det ikke er et stilark for en side.
- **Dialogen kan ha en farget topp.** `fs.dialog({ color })` gir `data-color`
  på dialogen og en ny `header`-del som pakker overskriften, med en valgfri
  `subtitle` under. Fargene er varslerens, `info`, `success`, `warning` og
  `danger`, og `brand` for merkefargen. Med toppen i markupen flyttes luften
  fra dialogen til delene, så båndet går helt ut i kantene; uten den står
  dialogen som før. To dialoger i spilldemoen skrev om padding på tre
  klasser for å få til dette, og det brakk ved en oppgradering.
  `fs.dialog.colors` og `fs.dialog.isColor` lister og sjekker verdiene.

## 0.17.0 (2026-09-27)

### Brytende

- **`idEllerReserve` heter `idOrFallback`.** Hjelperen i `@fristil/designsystem/shared`
  var den siste eksporterte identifikatoren på norsk, og identifikatorer i
  pakken skal være engelske. Ingen alias: pakken har ingen konsumenter ennå,
  og en brytende endring gjøres én gang. Parameteren `oppgittId` i
  byggefunksjonene heter `givenId`; den er intern.

## 0.16.0 (2026-09-27)

### Lagt til

- **`reset()` på `<fs-session-timeout>`** nullstiller klokka uten å sende
  `session-extend`, for en app som alt har forlenget økten selv, som når en
  autolagring gikk gjennom.
- **`--fs-toast-layer`** styrer `z-index` på varselregionen, med `60` som
  reserve.
- **`isToastColor`** eksporteres ved siden av `toastColors`.
- **`fs.popover()` tar `placement`.** `fs.popover.isPlacement` sjekker en
  verdi, også i `/react`, og `popoverPlacements` fra hovedinngangen lister
  dem, med typen `PopoverPlacement`. Før måtte attributtet skrives for hånd
  uten typesjekk.
- **`--fs-suggestion-layer`** styrer `z-index` på forslagslista, med `30`
  som reserve.

### Rettet

- **Escape i `<fs-session-timeout>` forlenger, og dialogen kommer ikke
  tilbake.** Komponenten lyttet ikke på `close`, så neste tikk så en lukket
  dialog etter varselgrensen og åpnet den igjen, ett sekund etter Escape,
  hver gang, med en ny `session-warn`. Escape regnes nå som «jeg er her» og
  gjør det samme som knappen.
- **Skjermleseren får vite hvor lenge det er igjen i det varselet åpnes.**
  Tallet i avsnittet er `aria-hidden`, og live-området ble fylt først ved
  neste terskel, så med standardverdiene hørte skjermleseren «Vi logger deg
  ut om  for å beskytte opplysningene dine», og første tall kom tre minutter
  senere.
- **`<fs-session-timeout>` står stille etter utløpet og etter «Logg ut nå»**
  til `extend()` eller `reset()` kalles. Før startet syklusen på nytt av seg
  selv, med ny dialog og ny `session-expired` hvert `expires-at`-sekund, og
  en app som brukte mer enn ett sekund på utloggingen fikk dialogen tilbake.
- **`warn-at` og `expires-at` sjekkes.** Et tall som ikke er et tall, eller
  et varsel som ikke kommer før utløpet, gir beskjed i konsollen framfor
  stillhet. `warnAt` og `expiresAt` har fått settere, rulling i en boks
  teller som aktivitet, og hver forekomst har sin egen overskrift-id.
- **Pausen i `<fs-toast>` holder til både musa og fokus har forlatt
  meldingen.** Den var to uavhengige par, og musa som gikk ut startet klokka
  igjen mens fokus sto i meldingen, som så forsvant under brukeren.
- **`dismiss()` flytter fokus til meldingen ved siden av** når meldingen som
  lukkes hadde fokus. Før falt fokus til `body`, og neste Tab startet øverst
  på siden.
- **Varselregionen er `aria-atomic="false"`**, både fra `fs.toast()` og fra
  komponenten. `status` er atomisk som standard, og hele stabelen ble lest
  opp på nytt for hver ny melding.
- **Regionen heter «Varsler» begge steder.** Komponenten sa «Meldinger» når
  attributtet manglet, `fs.toast()` sa «Varsler». Et tomt `duration` gir
  standardverdien framfor null, og en ukjent `color` gir ingen kant.
- **`<fs-connection-status>` melder `connection-lost` én gang per utfall.**
  Nettlesere fyrer gjerne flere `offline` på rad, og hver ga en ny hendelse
  og en ny opplesning av den samme linja. Linja settes nå inn tom og fylles
  i neste tegning, slik at live-området finnes før innholdet kommer.
  `offlineText` og `onlineText` har fått settere.
- **`<fs-suggestion>` lukker lista når fokus forlater komponenten.** Tab
  gikk videre til neste felt, og lista ble stående over det med
  `aria-expanded="true"` på et felt som ikke lenger hadde fokus. Lytteren på
  `document` er borte: et trykk i lista holder fokus i feltet, fokus på noe
  inne i komponenten lar lista stå, og alt utenfor lukker den. Dermed virker
  feltet også inne i en skyggerot, der klikket i
  feltet før ble regnet som et klikk utenfor og lukket lista i samme klikk
  som åpnet den.
- **«Ingen treff» følger lista.** Meldingen er søsken til lista og ble
  stående synlig under et lukket felt etter Escape. `fs.suggestion()` skriver
  den også skjult på et lukket felt uten alternativer, som er det anbefalte
  oppsettet for asynkront søk; før sto meldingen der alt ved sidelasting.
- **Markeringen ryddes i det alternativet filtreres bort**, også med
  `server-controlled`. Før pekte `aria-activedescendant` på et skjult
  alternativ, og skjermleseren leste det opp.
- **Alternativene kjennes igjen på `role="option"`**, ikke på klassen. En mal
  med egen styling fikk verken filtrering eller piltaster, uten et ord.
- **`<fs-suggestion>` sier fra når `[role="status"]` mangler.** Antall treff
  leses opp der, og uten elementet sto komponenten stille.
- **`fs.suggestion()` skriver `aria-selected` og `aria-activedescendant`
  under samme vilkår**, altså bare når lista er åpen. Før fikk en lukket
  liste det ene uten det andre.
- **Det markerte alternativet vises i høykontrastmodus**, med systemfargene.
- **`<fs-popover>` står på riktig side i `dir="rtl"`.** Posisjonen er
  fysisk, men stilarket brukte den som `inset-inline-start`, som er høyre
  kant i en side som leses fra høyre. `start` og `end` i `placement` følger
  nå leseretningen.
- **`top-start` og `top-end` klemmes inn i vinduet.** Et panel ved toppen av
  siden lå helt utenfor skjermen, uten å kunne rulles fram. Er det ikke
  plass på den siden plasseringen ber om, legges panelet på den andre.
- **Verten følger med når nettleseren selv lukker et `popover="auto"`.**
  Håndskrevet markup med bare `popover` er `auto`, og etter en lett
  avvisning sto verten med `open` og knappen med `aria-expanded="true"`
  over et lukket panel. Komponenten lytter nå på `toggle`.
- **Klikk utenfor et sprettoppvindu i en skyggerot** leser
  `composedPath()`, så et klikk i panelet ikke regnes som utenfor.
- **`<fs-dialog server-controlled>` lukker når patchen tar `open` fra en
  modal dialog.** Reparasjonen var slått av, men ingen kalte `close()`, og
  dialogen sto igjen i topplaget med `display: none` mens resten av siden
  var inert.
- **`<fs-tabs>` hopper over deaktiverte faner.** Piltastene, Home og End
  valgte en fane med `disabled`, `focus()` på en deaktivert knapp gjør
  ingenting, og raden sto uten en eneste fane som kunne få fokus.
  Tastaturbrukeren var låst ute. `select()` avviser dem også.
- **Faner i faner er hver sin rad.** Komponenten fant faner og paneler i hele
  undertreet, så et klikk på en indre fane skjulte det ytre panelet den sto i.
- **Panelet finnes gjennom `aria-controls`.** Koblingen står i markupen og
  leses derfra, med rekkefølgen som reserve bare for markup uten
  `aria-controls`. Panelene kan dermed stå i en annen rekkefølge enn fanene,
  og utenfor verten. Peker `aria-controls` på en id som ikke finnes, sier
  komponenten fra i konsollen. Peker to faner på det samme panelet, vises
  det når en av dem er valgt.
- **Tabbestoppet flyttes når en patch deaktiverer fanen brukeren valgte**,
  til den neste fanen som kan få fokus. Valget står. Har brukeren ikke valgt
  noe, er markupen serverens, og komponenten rører den ikke.
- **Venstre og høyre pil bytter retning i `dir="rtl"`.**
- **`selected` på `<fs-tabs>` kan settes.** Getteren sto uten setter, og
  `faner.selected = 1`, som dokumentasjonen viste, kastet.
- **`fs.tabs()` med negativt `count` gir en tom rad** framfor å kaste.
- **`<fs-error-summary>` prøver igjen når fokus ikke landet.** Sto boksen i et
  skjult panel eller en lukket dialog i det den kom, feilet `focus()` i
  stillhet mens flagget «har flyttet fokus» ble satt, og boksen fikk aldri
  fokus da forelderen ble synlig og lista byttet ut. Gjenforsøket skjer bare
  når ingen står i et felt, så live-validering som patcher lista ikke river
  fokus ut av feltet brukeren retter i.
- **En lenke til en `<label>` uten kontroll følger `for`** dit den peker,
  som til en gruppe.
- **`<fs-error-summary>` sier fra når `tabindex` mangler.** Uten det gjør
  `focus()` ingenting, og hele grunnen til komponenten forsvant i stillhet.
- **En lenke til en `<label>` som omslutter kontrollen** sender fokus til
  kontrollen, ikke til ledeteksten.
- **Rullingen til feltet følger sidens `scroll-behavior`** framfor å tvinge
  `smooth`, så `prefers-reduced-motion` gjelder av seg selv.
- **`<fs-field>` eier bare det den selv skrev.** Komponenten leser
  `aria-invalid`, `aria-describedby` og `disabled` fra kontrollen, fordi
  serveren kan ha skrevet feltet med `fs.field()`. Skillet mellom serverens
  ord og komponentens eget ekko fantes bare for `aria-invalid`, og de to
  andre hadde samme feil: `aria-describedby` pekte fortsatt på feilmeldingen
  etter at feltet var gyldig, og på en hjelpetekst en patch hadde fjernet, og
  `felt.disabled = false` slo ikke av et `disabled` komponenten selv hadde
  satt. Minnet er nå nøklet på kontrollen og overlever at feltet flyttes,
  slik React gjør ved en omstrukturering, og at kontrollen forsvinner og
  kommer tilbake i en patch. Id-er serveren selv la i `aria-describedby` blir
  med videre.
- **Ingen `aria-disabled` på kontrollen.** Komponenten skrev det ved siden av
  `disabled`, og strøk samtidig et `aria-disabled` konsumenten selv hadde
  skrevet. `computeFieldAttributes` er kontrakten, og den skriver det bare på
  ledeteksten; et ekte `disabled` er alt synlig for hjelpemidlene.
- **Serverens `aria-invalid` står ordrett når det er serveren som sier feltet
  er ugyldig.** `false` er gyldig og vanlig i håndskrevet HTML, og ble strøket
  ved hver patch. `grammar` og `spelling` betyr ugyldig, men ble lest som
  «ikke true» og strøket på samme måte. Tom streng leses som `false`, slik
  ARIA sier.
- **`requiredMarker` som egenskap betyr det samme som attributtet.** Setteren
  skriver `"none"` bokstavelig, siden `required-marker="none"` overstyrer en
  `data-required` serveren skrev på ledeteksten. Før fjernet setteren
  attributtet, og markeringen kom tilbake fra ledeteksten. Getteren leser nå
  markupen, ledeteksten medregnet, framfor bare sitt eget attributt.

## 0.15.0 (2026-09-26)

- **`web-types.json` følger med pakken.** Det er JetBrains sitt format for
  fullføring og forklaring i HTML, med de ni `<fs-*>`-elementene og
  attributtene deres. IDE-en finner den selv fra `node_modules`, gjennom
  feltet `web-types` i `package.json`. Etterprøvd i IntelliJ IDEA Ultimate 2026.2:
  fullføring av elementene, attributtene og verdiene, og forklaring med
  lenke. Fila genereres fra `editor/metadata.ts` i repoet, der
  VS Code-utvidelsen også lages.
- `observedAttributes` på komponentklassene er nå skrivebeskyttede tupler
  (`as const`) i stedet for `string[]`. Verdiene er de samme. En klasse som
  arver fra en komponent og skriver over `observedAttributes` med `string[]`
  får en typefeil, og må bruke `as const` den også.

## 0.14.0 (2026-09-24)

### Brytende

- **Verten heter `host` i alle byggefunksjonene.** Den delen serveren skriver,
  og komponenten fester seg på, het tre ting: `host` i `fs.dialog()` og
  `fs.popover()`, `region` i `fs.toast()` og `container` i `fs.errorSummary()`.
  Tre ord for den samme tingen, og to av dem sa ikke hva den var. De heter nå
  `host`, som er ordet arkitekturen bruker om den ellers.

  `fs.connectionStatus()` og `fs.sessionTimeout()` er urørt. De har bare én
  del, og returnerer attributtene flatt, slik `fs.button()` gjør. Nøkkelen
  finnes der verten selv bærer attributter. `fs.field()`, `fs.tabs()` og
  `fs.suggestion()` har mange deler og ingen `host`, fordi verten deres
  ikke har noe å bære.

  ```diff
  - <fs-toast {...varsler.region} />
  + <fs-toast {...varsler.host} />
  - <fs-error-summary {...feil.container}>
  + <fs-error-summary {...feil.host}>
  ```

### Lagt til

- **`setAttributes` tar `null`.** `document.querySelector()` gir
  `Element | null`, så hvert eneste kallsted i en `strict`-app måtte skrive en
  vakt eller et utropstegn rundt et oppslag som nesten alltid treffer. Den gjør
  nå ingenting på `null`, som `element?.classList`. Parameteren er utvidet, så
  ingen kallsteder brytes.

### Rettet

- **Panelet i `<fs-popover>` nullstiller lista.** Panelet er ofte en `<ul>`
  med handlinger, og `.fs-popover` hadde ingen `list-style`. Markupen i
  dokumentasjonen skrev `data-variant="plain"` for å bøte på det, men det
  attributtet finnes bare på `.fs-list` og traff ingen regel, så panelet sto
  med nettleserens kuler. Nullstillingen hører i pakken og ikke
  hos konsumenten.

- **`ref` virker på de egendefinerte elementene i JSX.** Typene bygget på
  `HTMLAttributes`, som ikke har `ref`; den ligger i `RefAttributes`. Derfor
  var `<fs-toast ref={kø} />` en typefeil, altså nøyaktig mønsteret
  dokumentasjonen anbefaler for å kalle `.show()` og `.hide()` fra React. Alle
  vertene bygger nå på en felles `Host`-type som har begge.

- **`warn-at` og `expires-at` godtar det byggefunksjonen sender.** De sto som
  `number` i JSX-typene, mens `fs.sessionTimeout()` sender strenger, slik
  HTML-attributter er. Det er den samme feilen som `tabIndex: "0"`, motsatt
  vei, og den viste seg bare i en ekte React-app.

- **`fs.connectionStatus()` og `fs.sessionTimeout()` reklamerte med en død
  klasse.** Begge sender ut `fs-connection-status` og `fs-session-timeout`,
  men stilarkene stylet bare elementnavnet, så klassen gjorde ingenting. Nå
  treffer regelen begge, og en konsument som setter klassen på noe annet enn
  elementet får den samme oppførselen.

## 0.13.0 (2026-09-24)

### Brytende

- **`.fs-dialog` er en kolonne når `.fs-dialog__body` er et direkte barn.**
  Det er rettelsen under, men den endrer hvordan innholdet legger seg for
  markup som alt finnes, og det er den strukturen dokumentasjonen viser. Marger
  mellom avsnitt slutter å falle sammen, og tekst og knapper som står rett i
  dialogen ved siden av kroppen blir egne rader i full bredde. En dialog uten
  `.fs-dialog__body` er urørt.

- **`display` kan ikke lenger settes alene på `.fs-dialog`.** En `<dialog>`
  uten `open` skjules av nettleserens eget stilark, og lagene sorterer bare
  innenfor ett opphav, så en hvilken som helst forfatterregel med `display`
  slår den skjulingen. Setter du din egen, må du ta med
  `dialog.fs-dialog:not([open]):not(:is(:popover-open)) { display: none }`,
  minst like spesifikk som din egen regel. Det står på komponentsiden og på
  siden om tilpasning. Dette er det eneste unntaket fra løftet om at en enkel
  selektor slår hva som helst i pakken.

### Rettet

- **Dialogen hopper heller ikke sidelengs.** 0.12.1 ga den plassen til en
  modal før den var det, og det loddrette hoppet var borte. Et vannrett kom i
  stedet: nettleserens eget stilark setter `max-width: calc(100% - 6px - 2em)`
  på `dialog:modal`, og det hadde vi ikke. På en skjerm som er 390 piksler
  bred gikk dialogen derfor fra 358 til 352 piksler i det `showModal()` kjørte,
  og flyttet seg tre piksler mot høyre.

  `.fs-dialog[open]:not(:modal)` inne i `<fs-dialog>` bruker nå `inset: 0` med
  `margin: auto`, det samme maksmålet på bredden og `overflow: auto`, altså de
  samme verdiene spesifikasjonen gir en modal, i logisk form. Maksmålet på
  høyden står med vilje bare på `.fs-dialog`, siden det er det strengeste av
  de to og dermed gjelder i begge tilstandene. Testen leser boksen før og
  etter `showModal()`, med to slags innhold, og krever at den står stille.

- **`.fs-dialog__body` ruller nå faktisk.** Klassen har hatt `overflow-y: auto`
  siden komponenten kom, uten at den kunne gjøre noe: dialogen var en blokk, så
  kroppens høyde var innholdsbestemt og ble aldri klippet. Det som rullet var
  dialogen selv, og bare når den var modal, så overskriften og knapperaden
  forsvant ut av syne sammen med teksten. `.fs-dialog:has(> .fs-dialog__body)`
  er nå en kolonne, og da krymper kroppen og ruller mens tittelen og knappene
  blir stående. Det er også det dokumentasjonen har sagt hele tiden.

  Regelen tar samtidig tilbake det den tok: en `<dialog>` uten `open` er skjult
  av nettleserens eget stilark, og en forfatterregel med `display` slår den
  uansett lag og spesifisitet. `dialog.fs-dialog:not([open]):not(:popover-open)`
  setter `display: none` igjen, ellers ville en lukket dialog stått som et kort
  oppå innholdet rundt, fra sidelasting og etter hver lukking. Unntaket for
  popover står der spesifikasjonens eget stilark har det, siden en popover
  aldri setter `open`.

  **Det gjør `display` til den ene egenskapen en konsument ikke kan sette fritt
  på `.fs-dialog`.** Gjør du det, må du ta den skjulte tilstanden tilbake selv.
  Det står nå på komponentsiden.

  Vilkåret i selektoren er en del av oppførselen, og står nå i tabellen over
  klassene. Kolonnen virker bare når kroppen er et direkte barn, og den endrer
  samtidig hvordan alt annet legger seg: marger mellom avsnitt slutter å falle
  sammen, og tekst og knapper som står rett i dialogen blir egne rader i full
  bredde. En dialog uten kropp er derfor urørt.

## 0.12.1 (2026-09-24)

### Rettet

- **Dialogen hopper ikke lenger på plass.** En dialog serveren vil vise sendes
  med `open`, ellers finnes ikke innholdet uten JavaScript, og nettleseren
  legger den da i den vanlige flyten. Først når komponenten kaller
  `showModal()` flyttes den til topplaget og midtstilles, og mellom de to
  øyeblikkene hopper den. På en treg forbindelse er hoppet godt synlig:
  testet i Chromium sto dialogen på topp 0 og landet på topp 128, og det ble
  meldt fra en telefon.

  `.fs-dialog[open]:not(:modal)` inne i `<fs-dialog>` plasseres nå som en
  modal allerede før den er det, med flaten bak malt av en skygge, siden
  `::backdrop` bare finnes i topplaget. Laget kan settes med
  `--fs-dialog-layer`, som er 40 i utgangspunktet.

  Regelen gjelder bare inne i verten. En `.fs-dialog` som brukes uten
  komponenten, og med vilje ikke er modal, står der den står.

## 0.12.0 (2026-09-24)

### Brytende

- **`ThemeInput` er en union.** Merkefargene kan utelates, men da skal ingen av
  dem stå: enten alle fire, eller ingen. Vilkåret står i typen og ikke bare som
  en feilmelding i kjøretid, så `buildTheme({ interactive, danger })` er en
  typefeil. En konsument som leste `input.interactive` fra en variabel av typen
  `ThemeInput`, må nå skille de to tilfellene. Meldingen i kjøretid står ved
  siden av, for oppskriften kan komme fra en JSON-fil eller et skript uten
  typer.

### Lagt til

- **Temageneratoren kan også sette skrift og form.** Den bygget fargene, og
  bare dem, og to systemer med den samme paletten ser fortsatt ulike ut når
  skriften og hjørnene er ulike. `buildTheme()` tar nå to valgfrie blokker,
  `typography` og `shape`. Seks av verdiene finnes også som flagg: `--skrift`,
  `--knapp-hjorner`, `--felt-hjorner`, `--flate-hjorner`, `--knapp-ramme` og
  `--knapp-vekt`. Vektene og linjeavstandene settes fra fil. Utelates begge
  blokkene, er temaet nøyaktig det det var før.

  Hjørnene er delt i tre framfor ett felles tall, fordi ett tall er feil:
  et annet norsk designsystem har helt runde knapper mens feltene har nesten
  rette hjørner, og med én verdi blir feltene kapsler. `buttonRadius` treffer knapp,
  paginering og hopplenke, `fieldRadius` felt, tekstområde og nedtrekksliste,
  og `surfaceRadius` de elleve flatene, meldingen og hjelpeboblen medregnet.
  Avkryssingsboksen, merket, etiketten, valggruppa, avataren og skjelettet
  står utenfor, fordi hjørnet der ikke er et stilvalg, men selve formen.

  Skriften skrives som en ekte regel på `:root` og ikke bare som et token.
  Fristil arver skrift med vilje, så et token alene ville ikke endret én
  eneste bokstav.

- **Den genererte fila ligger i sitt eget lag,** `fristil-tema`, erklært etter
  `fristil` med `@layer fristil, fristil-tema;`. Den lå i `@layer fristil`
  først, og da avgjorde rekkefølgen stilarkene ble lastet i. Den rekkefølgen
  har konsumenten ikke alltid i hånda: både Astro og TanStack Start legger sin
  bundlede CSS inn rett før `</head>`, altså etter en `<link>` appen selv har
  skrevet, og temaet tapte da mot pakkens egne verdier. Begge lagene ligger
  fortsatt foran usortert CSS, så konsumentens egne regler vinner som før.

- **Et tema kan la fargene stå.** Merkefargene er nå valgfrie, og utelates
  alle fire, lages et tema som bare setter skrift og form. Det er ikke en
  kuriositet: bruker organisasjonen allerede Fristils palett, er det nettopp
  skriften og hjørnene som skiller, og å kjøre fargene gjennom generatoren
  ville flyttet dem bort fra der de skal være. `#1362ae` kommer ut som
  `#1e6ab7`, siden skalaene regnes om i OKLCH fra merkefargen. Enten alle fire
  fargene, eller ingen: to farger kaster, siden resten av temaet da ville blitt
  bygget av standardfarger uten at noen ba om det. Se «Brytende» over for hva
  det gjorde med typen.

- **Verdier i et tema kan ikke bryte ut av regelen de skrives inn i.**
  Oppskriften er en JSON-fil som kan komme fra et annet repo eller fra et
  byggesteg, og `«4px; } html { display: none } :root { --x: 1` lukket både
  erklæringen og `:root`-blokka, og fikk en vilkårlig regel inn i
  `@layer fristil`. Tre veier til var åpne, og alle er etterprøvd i nettleser:
  `1px (` åpnet en parentes som slukte resten av stilarket, `Arial\` lot
  baksnabelen spise semikolonet, og `Arial</style><script>…` kjørte et skript i
  en side der CSS-en står inline. Verdier med `;`, `{`, `}`, `<`, `>`, `\`,
  `/*` eller styretegn avvises nå, parenteser og anførselstegn må gå opp, og
  meldingen navngir nøkkelen i oppskriften framfor variabelen vi skriver.

- **Et ukjent flagg eller en ukjent nøkkel stopper kjøringen** framfor å bli
  ignorert. `--knapp-hjørner` med ø er den naturlige norske stavemåten, mens
  flagget heter `hjorner`, og temaet kom før ut uten hjørnet og uten et ord.
  Det samme gjaldt en skrivefeil inne i oppskriftsfila, altså den som kan
  komme fra et annet repo.

- **Vekt og linjeavstand er tokens.** `--font-weight-regular`,
  `--font-weight-medium`, `--font-weight-semibold`, `--font-weight-bold`,
  `--semantic-line-height-default`, `--semantic-line-height-heading`,
  `--semantic-line-height-article` og `--semantic-line-height-compact`.
  Verdiene er nøyaktig dem komponentene hadde skrevet ut fra før, så
  ingenting ser annerledes ut.

- **Trettisju stilark leser nå vekt og linjeavstand fra tokenene** framfor å
  skrive tallet. Verdiene er de samme, så ingenting ser annerledes ut, men uten
  dette ville `typography.weights` og `typography.lineHeights` i et tema truffet
  tre komponenter og ikke resten. Knappen, overskriften og avsnittet leser dem
  gjennom sin egen komponentvariabel, de andre leser tokenet direkte: en egen
  variabel per komponent er verdt det der man vil kunne skille dem, og støy der
  man ikke vil.

- **Seks nye komponentvariabler** der form sto skrevet ut i stilarket:
  `--fs-button-border-width`, `--fs-button-font-weight`,
  `--fs-button-line-height`, `--fs-heading-font-weight`,
  `--fs-heading-line-height` og `--fs-paragraph-line-height`. Regelen er at
  form og størrelse leses fra en komponentvariabel med tokenverdien som
  reserve, og disse tre komponentene brøt den.

## 0.11.0 (2026-09-23)

### Brytende

- **`server-filtered` heter `prefiltered`.** Navnet var misvisende på to
  måter. Det handler ikke om servere: en React-app som rendrer bare treffene
  har filtrert like fullt, uten at noen server er involvert. Og det handler
  ikke om hvem som filtrerte, men om hva de filtrerte på. Ingen konsumenter
  ennå, så navnet er byttet framfor å dokumenteres rundt.

- **`id` er påkrevd i `fs.field()`, og i de andre byggerne som tar en.** Den var valgfri, og funksjonen laget en
  når den manglet. Det var en felle: id-en er tilfeldig, så to kjøringer gir
  to ulike, og rendres det samme feltet på en server og så i nettleseren,
  peker `for` og `aria-describedby` på noe annet enn det som står der. React
  melder avvik ved hydreringen, og advarselen sier selv at avviket ikke blir
  rettet opp. Det er sett i en ekte app.

  Å kaste når `document` ikke finnes ble vurdert og forkastet: det er å slutte
  fra miljøet til hva utvikleren mente. `document === undefined` betyr bare
  «dette er ikke en nettleser», og en Astro-side rendres på serveren og
  hydrerer ingenting, så der er en laget id helt i orden.

  Typen alene er heller ikke nok, for en konsument uten TypeScript ser ingen
  type, og ren HTML med `<script type="module">` er en førsteklasses måte å
  bruke Fristil på. Utelates id-en likevel, lager byggeren en og sier fra i
  konsollen, én gang, med navnet på byggeren i meldingen. Uten den reserven
  fikk en JavaScript-konsument `aria-describedby="undefined-help"` og verken
  `for` eller `id`, altså verre enn den ustabile id-en kravet skulle bli
  kvitt.

  Reserven gjelder `fs.field()`, `fs.suggestion()`, `fs.tabs()`,
  `fs.popover()` og `fs.dialog()`. Forslagsfeltet er grunnen til at den ikke
  kunne bo i feltet alene: uten id ble `list.id` og `options[n].id` til
  `undefined-list` og `undefined-option-0`, mens meldingen sa «fs.field()» og
  sendte utvikleren til feil sted.

  Den tomme strengen teller som ingen id. `fs.field({ id: "" })` ga `for=""`
  og `help.id="-help"`, altså det samme problemet uten at noe sa fra.

  I React kommer id-en fra `useId()`. Ellers er feltets eget navn som regel
  det opplagte valget. Vet du sikkert at markupen rendres én gang, kall
  `createFieldId()` selv. Den er nå også eksportert fra
  `@fristil/designsystem/react`, siden det er inngangen React-dokumentasjonen
  ber deg bruke.

  `<fs-field>` er upåvirket når komponenten er det eneste som kobler feltet:
  den lager id-er i nettleseren, etter at HTML-en står der. Bruker du React
  med server-rendring, skal du bruke `fs.field()`, så koblingen står ferdig i
  markupen serveren sendte.

- **`createFieldId` eksporteres også fra `@fristil/designsystem/react`.** Den
  lå bare i hovedinngangen og i `./field-core`, mens dokumentasjonen peker på
  den i en seksjon som ber leseren importere fra `/react`.

### Rettet

- **Forslagsfeltet sluttet å melde antall treff når noen andre filtrerte.**
  `filter()` returnerte med en gang, så en app med attributtet mistet
  opplesningen i `[role="status"]`. Det sto ikke noe sted, og den som ikke
  ser skjermen merket det.

  Beskjeden kommer nå av at lista har endret seg, og ikke av tastetrykket.
  Med `prefiltered` rendrer appen lista, og mellom tastetrykket og det nye
  svaret kan det gå et halvt sekund over nettverket. Bare en endring i
  antallet leses opp; det første antallet er utgangspunktet og ikke en nyhet.

  Tommeldingen er derimot en del av det lista viser, og den eier du med
  `prefiltered`. `fs.suggestion({ count })` skriver `hidden` på den når du
  har treff, så rendrer du feltet for hvert søk, er det gjort. Komponenten
  kan ikke se forskjell på «søket ga ingenting» og «svaret er ikke kommet
  ennå», og meldte derfor «Ingen treff» ved fokus på et tomt felt og i hvert
  opphold i et asynkront søk.

- **`prefiltered` kunne ikke settes fra React.** Getteren hadde ingen setter,
  og React 19 skriver egenskapen framfor attributtet når et egendefinert
  element har en med det navnet. Skrivingen kastet «Cannot set property»,
  attributtet landet aldri, og komponenten skjulte det React nettopp hadde
  rendret. Det gamle navnet `server-filtered` kunne ikke være et
  egenskapsnavn, så feilen kom med omdøpingen.

- **`prefiltered` gjorde ingenting før neste tastetrykk.** Attributtet sto i
  `observedAttributes`, men tilbakekallet svarte bare på `server-controlled`.
  Slås det av mens siden lever, filtrerer komponenten nå med en gang.

### Lagt til

- **`sjekk-dokumentasjon.ts` avviser et eksempel som kaller `fs.field()` uten
  `id`.** Ingenting annet i rekka leser kodeblokkene i dokumentasjonen, så et
  utdatert eksempel kunne stått grønt gjennom hele `bun run sjekk`. Den leser
  koden: i mdx kodegjerdene, i Astro frontmatteret og skriptene. I brødtekst
  teller bare et kall som har en argumentliste, siden `fs.field()` uten
  argumenter er navnet på en funksjon og står slik i dusinvis av setninger.
  Det skillet måtte til: `fs.suggestion({ count: treff.length })` sto i en
  setning under et eksempel og slapp gjennom.

## 0.10.0 (2026-09-23)

### Brytende

- **`data-preserve-attr` er borte fra hele pakken.** `fs.tabs()`,
  `fs.popover()`, `fs.suggestion()` og `fs.dialog()` skriver det ikke lenger,
  og typene deres har ikke feltet. Skriver du markupen for hånd, kan du slette
  attributtet.

  Lista krevde at malen skrev av navnene på hvert attributt komponenten kom
  til å røre, ni strenger fordelt på fire komponenter, uten at noen
  kompilator så på dem. Endret Fristil hva en komponent satte, gikk malen
  stille i stykker. Komponentene setter nå tilbake det brukeren gjorde, og
  ingen mal trenger å kjenne attributtene.

### Lagt til

- **`server-controlled` på verten gir serveren tilstanden tilbake.** Det
  fredningen ga, og som reparasjonen måtte erstatte, er at den som skrev
  markupen kunne bestemme hvem som eier tilstanden. «Gå videre til steg 2» er
  en ekte ting en server vil kunne gjøre. Står attributtet der, reparerer
  komponenten ingenting, og hver patch bestemmer. Ett attributt å huske i
  stedet for ni, og standardvalget er det som er riktig nesten alltid. Gjelder
  `<fs-tabs>`, `<fs-popover>`, `<fs-suggestion>` og `<fs-dialog>`, og er
  deklarert for JSX på alle fire.

- **`setAttr`, `setFlag`, `setText`, `addClass`, `SERVER_CONTROLLED` og
  `isServerControlled` er nye eksporter** fra
  `@fristil/designsystem/host-element`. De fire første skriver bare når noe
  faktisk endrer seg, og er de eneste lovlige veiene til et attributt, et
  boolsk flagg, tekst og en klasse i en komponent som observerer sine egne. En
  overtatt komponent bruker dem.

- **`scripts/sjekk-skriving.ts` håndhever den regelen.** Den kjører som del av
  `build`, både i pakken og i rota, og leser kilden, fordi regelen ikke lar seg
  etterprøve ved å kjøre noe: bryter en komponent den, kaller observatøren seg
  selv, mikrooppgavekøen tømmes aldri, og en testkjøring **henger** framfor å
  feile. Ingen stakksporing, ingen påstand, bare en kjøring som må drepes for
  hånd.

  Den ser etter seks skrivemåter, ikke bare `setAttribute`: `el.hidden = x`,
  `el.tabIndex = n`, `el.htmlFor = s`, `el.textContent = s`,
  `classList.add()` og `el.style.cssText = s`. Alle gir en mutasjonspost når
  ingenting endrer seg, og fem av dem var i bruk. Verten er ikke et unntak:
  komponentene observerer seg selv, så `this.classList.add()` henger en
  kjøring like godt som en skriving på et barn.

- **`sjekk:server` kjøres nå også fra rota.** Den sto bare i pakkens egen
  `build`, så den kjørte ved publisering og ikke i CI, mens `CLAUDE.md` sa at
  den var en vaktpost.

- **`stabilitet.browser.test.ts`** teller mutasjoner i hver av de fem
  komponentene etter at brukeren har gjort noe, og krever null. Den fanger en
  komponent som skriver litt for mye.

### Endret

- **Komponentene setter tilbake det brukeren gjorde.** `<fs-tabs>` setter
  fanevalget tilbake, `<fs-popover>` at vinduet er åpent og hvor det står,
  `<fs-suggestion>` om lista er utvidet og hva som er markert, og
  `<fs-dialog>` `open` på selve `<dialog>` når den fortsatt står i topplaget.
  Alle fire observerer nå de attributtene de selv setter, og hver skriving
  sammenligner først.

  Sprettoppvinduet reparerer én vei: har noen bedt om at vinduet er åpent,
  blir det stående, men sender serveren `open`, åpnes det, for det er noe
  serveren faktisk sa. En app lukker det med egenskapen, altså
  `meny.open = false`, `hide()` eller `toggle()`; et attributt fjernet utenfra
  er ikke til å skille fra en morfing, og der er `server-controlled` svaret.
  Dialogen skiller på samme måte mellom `open` på verten, som er serverens
  beskjed, og `open` på `<dialog>`, som nettleseren setter.

  Komponentene husker identiteter og ikke posisjoner. `<fs-tabs>` husker selve
  knappen brukeren valgte: en indeks er ingen identitet, og en id virker ikke
  i håndskrevet markup, som ofte ikke har noen. En attributtmorfing beholder
  nodene, så referansen overlever den. `<fs-suggestion>` husker både id-en og
  teksten på det markerte alternativet, siden id-ene fra `fs.suggestion()` er
  posisjonelle og en ny liste gjenbruker dem. Er det borte, glemmer
  komponenten det framfor å gjette, og fanene rydder opp etter seg slik at
  raden fortsatt svarer.

## 0.9.0 (2026-09-23)

### Brytende

- **`FIELD_PRESERVED_ATTRIBUTES` er fjernet.** Lista fantes for at en mal
  skulle kunne skrive av navnene på alt `<fs-field>` setter, inn i
  `data-preserve-attr`, slik at en morfing lot dem stå. Den er ikke lenger
  nødvendig: komponenten ser at attributtene er borte, og setter dem
  tilbake. Bruker du den i dag, kan du ta bort både lista og
  `data-preserve-attr` på feltet.

### Rettet

- **Sprettoppvinduet åpnet seg igjen når en patch både fjernet `open` og
  overlot tilstanden.** En morfing setter ett attributt om gangen, og `open`
  kommer før `server-controlled` i dokumentrekkefølgen, så komponenten
  reparerte mens serveren var midt i å si at den overtar. Reparasjonen venter
  nå til hele patchen har landet, og sjekker vilkåret på nytt der.

- **Forslagsfeltet satte ikke tilbake `aria-activedescendant` alene.** Rev en
  patch bare pekeren, mens markeringen sto igjen, så ingenting galt ut i
  markupen, men skjermleseren hadde mistet lesepunktet sitt. Begge sidene av
  koblingen sjekkes nå.

- **En fanerad sluttet å svare når en patch fjernet den valgte fanen.**
  `<fs-tabs>` glemte valget, men lot markupen stå i utakt: ingen fane markert,
  alle paneler skjult, og et klikk gjorde ingenting, fordi `select(0)`
  sammenlignet mot en `selected` som svarer 0 også når ingenting er markert.
  Komponenten velger nå den første fanen i det tilfellet, og melder fra med
  `tab-select`, siden det er komponentens eget valg og ikke brukerens. Sendte
  serveren med vilje en rad uten markering, blir den overkjørt, men bare når
  brukeren hadde valgt noe fra før.

- **Et felt kunne ikke bli gyldig igjen.** `<fs-field>` leser `aria-invalid`
  fra kontrollen, fordi serveren kan ha skrevet feltet med `fs.field()` og da
  står svaret allerede der. Uten et skille mellom serverens attributt og
  komponentens eget leste den tilbake sitt eget svar fra forrige runde, så
  `felt.invalid = false` fjernet flagget på verten mens den røde rammen og
  feilmeldingen ble stående.

  Komponenten noterer nå verdien den selv skrev, og hvilken kontroll den ble
  skrevet på. Står det noe annet der neste gang, har noen andre rørt
  attributtet, og det er serverens ord som gjelder. Avlesningen er dermed
  alltid utledet av en endring som faktisk har skjedd, så det samme
  dokumentet gir alltid det samme svaret. Skrev serveren `aria-invalid` selv,
  står det derfor: `felt.invalid = false` fjerner flagget på verten, men
  stryker ikke det serveren sa. Bruk den ene av de to kildene, ikke begge.

### Endret

- **`<fs-field>` kobler også en ledetekst som står utenfor elementet.** En
  `<label for>` som peker på kontrollen navngir feltet like godt som en inni,
  og komponenten skriver nå `fs-label`, `data-required` og `aria-disabled` på
  den. Bytter en patch ut kontrollen med en uten id, husker komponenten
  id-en, så ledetekstens `for` fortsetter å peke på et element som finnes.
  Én forskjell er verdt å vite: en ledetekst utenfor ligger ikke i det
  komponenten observerer, så river en patch klassen av den, kommer den ikke
  tilbake før neste gang feltet synkroniserer.

- **`<fs-field>` reparerer sin egen kobling.** Bevaringslista var en kontrakt
  vi ikke kunne kontrollere: en Go- eller Kotlin-mal måtte skrive av ni
  attributtnavn fra dokumentasjonen, og endret Fristil hva komponenten satte,
  gikk malen stille i stykker. Komponenten observerer nå de attributtene den
  selv utleder, og setter dem tilbake i det en patch river dem bort. Id-ene
  den har laget huskes, så en skjermleser midt i en opplesning ikke følger en
  peker som skifter under den.

  Skillet er mellom det komponenten har **regnet ut** og det brukeren har
  **gjort**. Det første kan regnes ut på nytt, og repareres. Det andre, som
  `open` på et sprettoppvindu eller hvilken fane som er valgt, finnes det
  ingen kilde til, og en reparasjon ville dessuten kjempet mot en server som
  med vilje endret noe. Det fredes fortsatt med `data-preserve-attr`, skrevet
  av byggefunksjonen.

### Lagt til

- **Komponentene sier fra når markupen de fikk ikke henger sammen.** Alle
  disse ga før stillhet, og feilen viste seg først når noen leste siden med
  skjermleser:

  - `<fs-field>` uten en kontroll, og uten en ledetekst. Feltet regnes som
    navngitt av en `<label>` inni, en `<label for>` utenfor, eller
    `aria-label` og `aria-labelledby` på kontrollen, som i et søkefelt med
    bare et ikon;
  - `<fs-tabs>` uten noe med `role="tab"`, og med færre paneler enn faner;
  - `<fs-dialog>` uten en `<dialog>` som direkte barn;
  - `<fs-suggestion>` uten en combobox, og uten en listboks;
  - `<fs-popover>` uten et panel, uten en id på panelet, og uten en knapp som
    peker på det;
  - `<fs-error-summary>` med punkter som ikke lenker til feltene, og med en
    lenke som peker på en id som ikke finnes. Den siste meldes når boksen
    synkroniserer, ikke først når noen klikker: en lenke som ikke fører noe
    sted er like ødelagt om ingen prøver den.

  Advarselen kommer én gang per element og melding, og først når siden har
  falt til ro. Det siste er grunnen til at den kan stoles på: HTML som
  strømmer fra en server leveres i pakker, og et brudd mellom ledeteksten og
  feltet er helt vanlig, så komponenten ser ofte halvferdig markup i det den
  kobles til.

- **`warnAboutMarkup` er en ny eksport** fra `@fristil/designsystem/host-element`.
  En overtatt komponent bruker den, så den må være tilgjengelig.

- **En vaktpost på at hver komponent kan overtas.** `sjekk-cli.ts` kjører
  `overta` på hver komponent verktøyet selv lister opp, og krever at ingen
  fil i kopien peker ut av mappa, og at hver `@fristil/…`-henvisning står i
  `exports`. Faren har stått skrevet ned lenge: en komponent som henter noe
  fra en ny mappe uten et inngangspunkt gir en kopi som peker i løse lufta,
  og feilen viser seg først når konsumenten bygger. Nå sier den fra her.

## 0.8.3 (2026-09-23)

### Rettet

- **`<fs-dialog>` åpnet igjen en dialog brukeren nettopp hadde lukket.**
  Serveren skriver `open` begge steder, så innholdet finnes uten JavaScript,
  og `<form method="dialog">` lukker boksen uten JavaScript også. Skjer det
  før komponenten har fått kjøre, finnes det ingen lytter, og første
  synkronisering så en vert som sa «åpen» og en lukket dialog. Da spratt
  dialogen opp igjen. På mobil skjedde det hver gang, fordi vinduet der er
  langt nok til å rekke et trykk.

  `returnValue` skiller de to tilfellene: nettleseren setter den til verdien
  på knappen som lukket dialogen, så en dialog som aldri har vært åpnet har
  den tom. En mal som bare skriver `open` på verten åpnes derfor som før.
  Funnet i spilldemoen, på 375 piksler.

  Det holder bare når knappen har en `value`. Lukkes dialogen med en knapp
  uten verdi, etterlater nettleseren ingenting å se etter. Det står nå på
  dialogsiden, og eksemplene der har alltid hatt en.

## 0.8.2 (2026-09-23)

### Rettet

- **`<fs-field>` mistet koblingen mellom ledetekst og felt ved første
  patch.** Bytter en morfing ut selve kontrollen, finnes det ingen node å
  frede, og den nye kommer uten id. Ledeteksten står igjen med sin `for`.
  Komponenten fant da ingen id, fant opp en ny, skrev den bare på
  kontrollen, og `for` pekte etter det på et element som ikke fantes. Feltet
  var altså uten ledetekst for en skjermleser, og det holdt seg til siden
  ble lastet på nytt.

  Id-en leses nå også fra ledetekstens `for`, og `for` skrives hver gang, ikke
  bare når den mangler: de to er den samme opplysningen og kan ikke få si
  hver sin ting. Funnet i spilldemoen, i appen som sender HTML-biter fra en
  Kotlin-server.

## 0.8.1 (2026-09-23)

### Endret

- **`fs.dialog({ open: true })` skriver `open` på `<dialog>` også.** Det sto
  bare på verten, og da var innholdet borte for den som ikke har
  JavaScript: en `<dialog>` uten `open` er skjult. Nå vises det, plassert
  over innholdet under seg slik nettleserens egen stil gjør det, og
  komponenten gjør den om til en ekte modal med `showModal()` når den får
  kjøre. I React var det dessuten det eneste som stemte: komponenten setter
  `open` før React hydrerer, og sto det ikke i serverens HTML, meldte React
  avvik ved hvert eneste oppslag. Funnet i demoappen i TanStack Start.

  `<fs-dialog>` tar attributtet bort med `removeAttribute` framfor `close()`
  før den kaller `showModal()`. `close()` sender en ekte `close`-hendelse, og
  den ville nå kommet ved hver eneste lasting av en åpen dialog. En app som
  lytter på `close` rett på `<dialog>` fikk altså en lukking før brukeren
  hadde sett dialogen. `dialog-toggle` så den ikke, siden komponenten
  stopper på `:modal`.

  Komponenten ser nå på `:modal` og ikke på `open` når den lukker.
  Byggefunksjonen sender `open` på `<dialog>`, så i React er det React som
  eier attributtet, og React oppdaterer barn før forelder: lukker appen
  dialogen, er attributtet borte før komponenten får vite det. `close()` gjør
  ingenting uten attributtet, så dialogen ble stående i topplaget, usynlig,
  med resten av siden inert.

  Styrer du dialogen selv fra nettleseren, skal du ikke sende `open` inn i
  `fs.dialog()`. `showModal()` kaster `InvalidStateError` på en dialog som alt
  står åpen, så en app som gjorde begge deler virket før og kaster nå. Det
  står i typen, i JSDoc-en og på siden.

  Har du JavaScript, ser du dessuten dialogen et øyeblikk som en boks der den
  står i flyten, før komponenten flytter den til midten som en modal. Før var
  det ingenting å se før modalen kom.

### Rettet

- **`fs.field()` sa ikke fra om at en id som lages av seg selv er
  tilfeldig.** Rendres feltet både på serveren og i nettleseren, blir det to
  ulike, og `for` og `aria-describedby` peker på noe annet enn det som står
  der. React melder avvik ved hydreringen. Det står nå i typen, på feltsiden
  og i React-fanen, med `useId()` som svaret.

## 0.8.0 (2026-09-23)

### Brytende

- **Boolske attributter på en vert er `true`, ikke `""`.** `fs.dialog().host`
  og `fs.popover().host` sendte ut `open: ""`. React 19 setter egenskaper
  framfor attributter på egendefinerte elementer, og `el.open = ""` er usant,
  så setteren i komponenten fjernet attributtet igjen: dialogen og panelet
  åpnet seg ikke, og om det skjedde kom an på om elementet var oppgradert
  ennå. `data-*` er noe annet og beholder den tomme strengen, for dem sender
  React videre som attributter i begge versjoner. `Flag` i `jsx/react.ts` er
  dermed `true | undefined` igjen, slik dokumentasjonen har sagt hele tiden.

- **Avslaget på fokus i feiloppsummeringen heter `data-autofocus="false"`.**
  Det het `autofocus="false"`. `autofocus` er en boolsk egenskap på
  `HTMLElement`, så React 19 satte `el.autofocus = "false"`, som er sant,
  mens attributtet aldri kom i markupen. Avslaget virket altså ikke i React
  19, og feilen var taus. Samme feilklasse som `open` over.

- **`ReactAttributes<T>` gir `number` for `tabIndex`.** Typen er eksportert,
  altså offentlig API, og den sa før `string`. Rettelsen under er grunnen:
  verdien var feil, og typen beskrev feilen. Kode som tok imot den gamle
  typen som en streng, for eksempel `const t: string = fs.tabs(...).tabs[0]
  .tabIndex`, kompilerer ikke lenger. Selve attributtet i DOM-en er uendret.

### Rettet

- **`tabIndex` kom ut som en streng fra React-inngangen.** `NAVN` døpte om
  `tabindex`, men lot verdien stå. I HTML er den en streng, i React er
  `tabIndex` et tall, så `fs.tabs()` ga `tabIndex: "0"` og TypeScript avviste
  den i enhver React-app. Den virket i nettleseren, siden React gjør om
  verdien selv, så feilen viste seg bare som en typefeil hos konsumenten.
  Funnet i en ekte React-app, ikke her.

- **`fs.fieldset` lovet en tilstand som ikke fantes.** `states` har alltid
  oppgitt `success`, men `fieldset.css` hadde bare en regel for `invalid`.
  Attributtet ble skrevet, og ingenting skjedde.

- **JSX-deklarasjonene godtok ikke det byggerne sender ut.** Et boolsk
  attributt er `""` fra byggeren, mens `Flag` i `jsx/react.ts` bare tillot
  `true` og `undefined`. `<fs-popover {...fs.popover({ open: true }).host}>`
  type-sjekket derfor ikke, altså to deler av det samme API-et som var
  uenige om det samme attributtet.

### Lagt til

- **En vaktpost på at hver lovlig verdi finnes i CSS-en.** `pakke-css.browser.test.ts`
  går gjennom listene byggerne reklamerer med, `variants`, `colors`, `sizes`,
  `states`, `pickers`, `markers` og `types`, kaller byggeren med hver av dem,
  og rendrer elementet to ganger, med og uten attributtet. Noe i den beregnede
  stilen må være forskjellig, pseudoelementene medregnet. Et tekstsøk ville
  passert på en tom regel og på en som blir overstyrt lenger nede.
  Farger regelen et barn framfor elementet selv, som feltsettet gjør med
  `.fs-legend`, kreves det i stedet at en regel som gjelder her erklærer noe.
  Uten det ville en tom blokk passert, og det var nettopp en tom blokk som
  slapp gjennom første utgave av prøven.

  Verdier som ikke sender ut noe attributt hoppes over: standardverdien, og
  verdier som ikke er ment å se annerledes ut. To egne prøver passer på at
  hoppelista ikke blir en bakdør. Den ene krever at opsjonsnavnet er et
  byggefunksjonen kjenner, siden feil navn ellers tar en hel liste ut av
  prøven i stillhet. Den andre krever at hver liste en byggefunksjon har,
  står i tabellen.

  Hvilke regler som gjelder hentes fra CSSOM, ikke fra teksten: en regel i en
  `@supports` motoren ikke har, eller i en `@media` som ikke slår til, gjør
  ingenting. Den stylede nedtrekkslista står i begge, og skal ikke endre noe
  i Firefox.

  `dom.browser.test.ts` sjekket at en verdi kan settes og fjernes, ikke at
  den betyr noe. Fieldset-feilen over hadde ligget der siden komponenten kom.

- **En vaktpost på at ingen byggefunksjon sender ut et navn React staver
  annerledes.** `react.browser.test.ts` kalte før ti byggefunksjoner for hånd
  og så bare etter `class` og `for`. Den går nå gjennom hver byggefunksjon i
  `/react`, med hver lovlige verdi funksjonen selv oppgir, og avviser hvert
  navn i Reacts egen tabell, også `readonly`, `maxlength` og `colspan`, som
  ingen byggefunksjon sender ut ennå. Den krever også at hver byggefunksjon i
  `fs` finnes i `/react`.

- **En vaktpost på at byggerne passer i JSX-deklarasjonene.**
  `src/jsx/typer.browser.test.ts` tilordner det byggerne sender ut til
  `JSX.IntrinsicElements`, og det er `typecheck:tests` som er prøven. Begge
  deler er offentlig API, og de kan gå fra hverandre uten at noe sier fra.

## 0.7.0 (2026-09-22)

### Brytende

- **`fs.dialog()` tar nå et valgobjekt og gir ett attributtsett per element.**
  Den ga før `{ class: "fs-dialog" }` til selve `<dialog>`. Nå heter kallet
  `fs.dialog({ titleId, open })` og gir `host`, `dialog`, `title`, `body` og
  `footer`, på samme form som `fs.popover()`. Klassenavnene ligger fortsatt på
  funksjonen: `fs.dialog.title` og de andre.

- **Dialogen har flyttet fra `css/` til `ramme/`,** siden den nå har en
  komponent. `@fristil/designsystem/dialog` peker derfor på `<fs-dialog>` og
  ikke lenger på byggefunksjonen; den hentes fra hovedinngangen, som for de
  andre sammensatte komponentene. `@fristil/designsystem/dialog.css` er
  uendret.

### Lagt til

- **`<fs-dialog>` lar en server åpne en dialog.** Å åpne en `<dialog>` er et
  kall og ikke et attributt: bare `showModal()` flytter fokus inn, holder
  fokus inne i dialogen, lukker på Escape og gjør resten av siden
  utilgjengelig. `<dialog open>` er bare en boks på siden. En app som skriver
  HTML på serveren, i Datastar, htmx, en Go-mal eller en Razor-visning, kunne
  derfor ikke åpne en dialog i det hele tatt uten å skrive sitt eget skript
  ved siden av. Nå sier serveren `open` på `<fs-dialog>`, og komponenten gjør
  kallet.

  Lukker brukeren dialogen, fjernes `open` fra verten igjen, så markupen sier
  det samme som skjermen. De to `open`-ene er ikke det samme: det på verten er
  serverens beskjed og er ikke fredet, for ellers kunne serveren aldri åpnet
  dialogen igjen etter første lukking. Det nettleseren setter på selve
  `<dialog>` når `showModal()` kalles, er derimot fredet, ellers river
  morfingen det bort og lukker dialogen i samme øyeblikk som den åpnet den.
  `morfing.browser.test.ts` kjører hele runden.

  Komponenten melder fra med hendelsen `dialog-toggle`, som bærer `open` og
  `returnValue`, altså hvilken knapp som lukket dialogen. Den er `composed`,
  så den kommer ut av en skyggerot.

  Komponenten gjør ingenting når den står løsrevet fra siden. En morfer
  bygger serverens utgave i et løsrevet tre før den sammenlignes, og et
  egendefinert element tas i bruk der også; uten den sperren kastet
  `showModal()` ved hver patch som rørte dialogen.

### Rettet

- **`color-scheme` i `tokens.css`.** Uten den tegner nettleseren sine egne
  flater lyst uansett hva tokenene sier: nedtrekkslista til en `<select>`,
  rullefelt og kalenderpanelet i et datofelt. En side i mørkt tema fikk da en
  hvit liste midt i seg. `:root` sier nå `light dark`, så systemvalget
  avgjør, og `data-theme` setter den til `light` eller `dark` slik at
  nettleserens flater følger med når appen tvinger fram et tema.

  Dette ble funnet i en demoapp, ikke i enhetstestene. Det er bare
  nettleserens eget utseende som røper det.

- **`<fs-field>` sier selv at det er en blokk.** Et egendefinert element er
  `display: inline` til noen sier noe annet, og feltet var det eneste som
  pakker inn andre elementer uten å si det. Barna er blokker, så det så
  riktig ut helt til noen ga elementet en avstand eller la det i et rutenett.
  `<fs-suggestion>` har alltid sagt det samme om seg selv.

## 0.6.1 (2026-09-22)

### Lagt til

- **`--semantic-focus-ring` samler fokusringen på ett sted.** Den sto skrevet
  ut med bredde og farge i tjue regler fordelt på atten stilark. Selektorene
  er forskjellige i hver komponent, og `outline-offset` skal være ulik, så det
  som faktisk gjentok seg var verdien. Nå skriver hver komponent
  `outline: var(--semantic-focus-ring)`, og en konsument som vil ha en annen
  fokusring endrer ett token framfor atten filer.

  De tre stedene som med vilje har en annen farge, feiloppsummeringen og
  hopplenken, skriver `outline-color` etter kortformen og arver bredden. Da
  følger også de med hvis bredden endres.

  En ny vaktpost i `pakke-css.browser.test.ts` avviser en `outline` med
  `solid` skrevet ut i et komponentstilark.

## 0.6.0 (2026-09-22)

### Brytende

- **`fs.popover()` sender ikke lenger ut `slot="trigger"`.** Attributtet var
  et levn fra den gangen komponenten hadde shadow DOM. Uten en skyggerot gjør
  `slot` ingenting i HTML, så det var en merkelapp som så ut som noe annet enn
  det var, og dokumentasjonen ba leseren skrive noe nettleseren ignorerte.

  `<fs-popover>` kjenner nå igjen delene på koblingen som må være der uansett:
  panelet er det som har `popover`, og knappen er den som peker på panelet med
  `aria-controls`. Begge deler skriver `fs.popover()` fra før, så markup laget
  med byggefunksjonen virker uendret, og et `slot`-attributt som blir stående
  fra en server som ikke er oppdatert, gjør ingen skade.

  Skriver du markupen for hånd, må knappen ha `aria-controls` med panelets
  `id`, og panelet må ha `popover`. Det er de samme to tingene
  tilgjengeligheten krever.

  Typen `PopoverAttributes` har mistet `slot` fra `trigger`.

## 0.5.3 (2026-09-22)

### Rettet

- **Pakken lar seg importere på en server.** `class X extends HTMLElement`
  blir evaluert i det modulen lastes, og `HTMLElement` finnes bare i
  nettleseren. Ni av inngangspunktene stoppet derfor med «HTMLElement is not
  defined» på en server uten DOM, hovedinngangen `@fristil/designsystem`
  inkludert. Det gjorde `import { fs } from "@fristil/designsystem"` umulig i
  en Node- eller Bun-server, altså nøyaktig den linja «Kom i gang» ber leseren
  skrive, i nettopp den situasjonen systemet er bygd for.

  Web-komponentene arver nå fra `HostElement` i det nye inngangspunktet
  `@fristil/designsystem/host-element`, som faller tilbake på en tom klasse
  når `HTMLElement` ikke finnes. `defineFs*` gjør ingenting når det ikke
  finnes noen `customElements` å registrere i, så et kall fra en modul som
  kjøres begge steder er trygt.

  Ingen nettlesertest kunne se dette, for der finnes `HTMLElement`. En ny
  vaktpost, `scripts/sjekk-server-import.ts`, kjører i Bun uten DOM og
  importerer hver JavaScript-oppføring i `exports` fra `dist`.

## 0.5.2 (2026-09-22)

### Lagt til

- **`<select>` kan tegne nedtrekkslista inne i siden.** `fs.select({ picker:
  "styled" })` gir `data-picker="styled"`, og da bruker feltet
  `appearance: base-select`: lista blir et vanlig element i siden i stedet for
  et vindu fra operativsystemet, og får Fristils farger, avstander og skygge.
  Elementet er fortsatt en helt vanlig `<select>`, så innsending, tastatur og
  skjermleser er uendret.

  Det må slås på, og det er med vilje. Chromium 148 og WebKit 26.4 har
  `appearance: base-select`; Firefox 150 har det ikke og viser nettleserens
  egen liste som før. Begge deler er testet i hver sin motor. I
  høykontrastmodus faller alle tre tilbake til nettleserens egen liste, siden
  systemfargene er de eneste som er garantert lesbare der.

  Nye variabler: `--fs-select-option-padding` og
  `--fs-select-viewport-margin`. `--fs-select-radius` gjelder nå også lista.

### Rettet

- **`FIELD_PRESERVED_ATTRIBUTES` dekker nå hjelpeteksten og feilmeldingen.**
  Skriver malen ingen id-er, lager `<fs-field>` dem selv, og
  `aria-describedby` på kontrollen peker på dem. `id` sto ikke i noen liste,
  så en morfing fjernet den, og koblingen pekte på noe som ikke fantes: verken
  hjelpeteksten eller feilmeldingen ble lest opp. Lista har nå en `help`-nøkkel,
  `error` har fått `id` og ledeteksten har fått `for`.

- **`<fs-error-summary>` tar fokus hver gang boksen vises på nytt.** Den tok
  det bare første gang. Mønsteret i en Datastar-app er at serveren sender
  boksen skjult og bare slår `hidden` av og på, mens lista står med de samme
  lenkene, og da nullstilte ingenting flagget. Andre gang det samme skjemaet
  feilet, ble brukeren stående i feltet uten å få vite hvorfor innsendingen
  ikke gikk gjennom. Flagget nullstilles nå når boksen skjules.

- **`<fs-suggestion>` leser hvilket alternativ som er markert fra markupen.**
  Komponenten holdt en egen teller ved siden av `aria-selected`. Satte
  serveren markeringen selv med `fs.suggestion({ activeIndex })`, hoppet
  første piltast til toppen av lista i stedet for til alternativet etter, og
  markeringen serveren nettopp sendte var borte.

- **Pil opp åpner lista, og går til det siste alternativet.** Den markerte før
  et alternativ uten å åpne lista, så `aria-activedescendant` pekte inn i noe
  feltet samtidig meldte som lukket, og skjermleseren leste opp et alternativ
  som ikke sto på skjermen. Uten noe markert fra før gikk den dessuten til det
  nest siste, ikke det siste.

- **`fs.suggestion().empty` bevarer `hidden` gjennom en oppdatering.**
  Komponenten skjuler «Ingen treff» når noe passer, men elementet hadde ingen
  `data-preserve-attr`, så teksten dukket opp igjen ved hver patch, også midt
  i en liste med treff. Byggefunksjonen sender nå `hidden` når serveren har
  noe å velge mellom, og navnet står i lista.

  Begge ble funnet av en ny vaktpost, `morfing.browser.test.ts`, som kjører
  Datastars egen attributtsynkronisering mot ekte markup etter at komponenten
  har gjort jobben sin. Den dekker felt, forslagsfelt, faner og
  sprettoppvindu.

- **`.fs-select` snur riktig i språk som skrives fra høyre mot venstre.**
  Feltet holdt av plass til pila si med en `padding` på fire verdier, altså
  over, høyre, under og venstre. De to fysiske sidene snur ikke med språket,
  så i RTL lå plassen på feil side og teksten la seg oppå pila. Plassen settes
  nå logisk, og pila, som er to gradienter og derfor ikke har noen logisk
  variant, speilvendes med `:dir(rtl)`. Nedtrekkslista var ikke dekket av
  retningstesten i det hele tatt, og er det nå. En ny vaktpost i
  `pakke-css.browser.test.ts` avviser fysiske kortformer med fire verdier i
  alle stilark.

- **`fs.setAttributes` fjerner nå `data-size` og `data-picker` igjen.** Den
  rydder bare i en lukket liste av attributtnavn, og de to sto utenfor. En
  avatar eller en overskrift som gikk tilbake til standardstørrelsen beholdt
  altså `data-size` fra forrige kall, og fikk aldri standardutseendet sitt
  igjen. En ny vaktpost kaller hver byggefunksjon med hver lovlige verdi den
  selv oppgir, regner et attributt som valgfritt når det ikke er med i kallet
  uten argumenter, og krever at hvert av dem lar seg fjerne.

## 0.5.1 (2026-09-21)

### Rettet

- **React-inngangen døper nå også om `autocomplete` til `autoComplete`.**
  `fs.suggestion()` sender det ut på kontrollen, og React advarte «Invalid DOM
  property `autocomplete`» i konsollen for hvert forslagsfelt. En ny vaktpost
  kaller hver byggefunksjon, teller opp hvert attributtnavn de sender ut, og
  krever at ingen av dem er et navn React staver annerledes uten at
  `react.ts` døper det om.

- **`<fs-session-timeout>` bygger dialogen sin først når den skal vises.** Den
  lagde den i `connectedCallback`, altså før React rakk å hydrere, og
  hydreringen feilet med «server rendered HTML didn't match the client». Nå
  gjør den det samme som `<fs-toast>` og `<fs-connection-status>`: ingenting
  står i DOM-en før det trengs.

### Endret

- **`fs.toast()` er dokumentert.** Byggefunksjonen fantes, men sto ikke på
  komponentsiden. Den gir tre attributtsett, og det er `region` du sprer på
  `<fs-toast>`, ikke hele objektet.


## 0.5.0 (2026-09-21)

### Brytende

- **Serveren skriver markupen, komponentene fester bare oppførsel.** Seks
  komponenter satte tidligere klasser, roller og tilgjengelighetskoblinger på
  elementer serveren hadde sendt. Det virker ikke i en app med server-rendret
  HTML: Datastars morfing fjerner hvert attributt som ikke står i HTML-en
  serveren nettopp sendte, og React kan kaste bort noder et egendefinert
  element har lagt inn i et tre React eier. Testet med ekte Datastar mistet et
  `<fs-field>` både `aria-describedby`, klassen på ledeteksten og den skjulte
  feilmeldingen etter én patch, og fikk dem ikke tilbake.

  Markupen skrives nå av nye byggere i `fs`: `fs.errorSummary()`,
  `fs.popover()`, `fs.tabs()`, `fs.suggestion()` og `fs.toast()`. Byggerne
  setter også `data-preserve-attr` for de attributtene komponenten endrer
  underveis, så du slipper å vite om det. Se «Server først» i dokumentasjonen.

- **`<fs-calendar>` og `<fs-date-field>` er fjernet.** Nettleserens eget panel
  i `<input type="date">` gjør jobben, og `fs.field()` sammen med
  `fs.input({ type: "date" })` gir et komplett datofelt. Mønstersiden «Dato i
  et skjema» viser oppsettet, med de to forskjellene vi har testet mellom nettleserne.
  `exports`-oppføringene `./calendar`, `./date-field` og `./date-field.css` er
  borte, og det samme er `--fs-calendar-*`- og `--fs-date-field-*`-variablene
  og alle `part`-navnene i kalenderen.

- **`<fs-suggestion>` er flyttet fra `frittstående` til `ramme`.** Den lagde
  tidligere hele feltet selv, så det fantes verken ledetekst eller
  inndatafelt før skriptet hadde kjørt, og ingenting ble med i innsendingen.
  Nå skriver serveren feltet og lista med `fs.suggestion()`.

- **`<fs-tabs>` har ingen `selected`- eller `label`-attributter lenger.**
  Hvilken fane som er valgt står i markupen serveren sendte. `<fs-error-summary>`
  har ikke lenger `heading`: overskriften skrives av serveren.

- **Ingen komponent bruker shadow DOM.** `::part()` er dermed ikke lenger en
  del av det offentlige API-et.

- **`<fs-field>` leser tilstanden fra markupen, ikke fra egne attributter.**
  Skrev serveren feltet med `fs.field()`, står `aria-invalid` og
  `data-required` allerede på elementene. Komponenten regnet tidligere ut sitt
  eget svar fra attributtene på verten, fant ingenting der, og fjernet det
  serveren nettopp hadde skrevet. De to halvdelene av API-et kranglet altså
  med hverandre når de ble brukt sammen. Den setter heller ikke lenger
  `aria-hidden` på feilmeldingen: `hidden` tar den allerede ut av
  tilgjengelighetstreet, og attributtet ga hydreringsfeil i React.

### Lagt til

- **`<fs-session-timeout>`** varsler før en innlogget økt går ut, med en
  nedtelling som leses opp ved terskler i stedet for hvert sekund, og fokus
  som går tilbake dit brukeren var.

- **`<fs-connection-status>`** sier fra når forbindelsen til serveren er
  borte. `navigator.onLine` sier bare at maskinen har et nettverk, så
  `reportFailure()` og `reportSuccess()` lar appen melde fra selv.

- **Siden «Server først»** forklarer hvorfor markupen kommer fra serveren, med
  testene bak, og hva det betyr i TanStack Start, React Server Components og
  Datastar.

- **Mønstersiden «Dato i et skjema»** viser hvordan du ber om en dato uten en
  datovelger fra oss, med de to forskjellene vi har testet mellom nettleserne:
  WebKit krever skilletegnene, og Chromium tar imot feil rekkefølge som
  gyldig.

- **`FIELD_PRESERVED_ATTRIBUTES`** er lista serveren skal skrive som
  `data-preserve-attr` når den ikke kan kalle `fs.field()` selv.

### Rettet

- **`<fs-toast duration="0">` lot ikke meldingene bli stående.** Attributtet
  ble lest som «ugyldig» og falt tilbake til seks sekunder, så bare
  `show(…, { duration: 0 })` virket.

- **`<fs-error-summary>` fikk ikke fokus når serveren bare tok bort `hidden`.**
  Komponenten så etter endringer i barna, ikke i attributtene, så en
  oppsummering som nettopp ble synlig ble stående uten fokus.

- **`<fs-error-summary>` finner nå feltet i sin egen rot.** Oppslaget gikk mot
  `document`, som ikke ser inn i en skyggerot, så lenken ble en vanlig
  ankerlenke uten fokusflytting når skjemaet lå inne i en annen komponent.

- **`FIELD_PRESERVED_ATTRIBUTES` dekker alle tre elementene.** Den dekket bare
  kontrollen, men komponenten legger også `fs-label` og markeringene på
  ledeteksten og skjuler feilmeldingen. Serveren må derfor skrive én liste per
  element, og konstanten har nå `label`, `control` og `error`.

- **`<fs-popover>` lot seg ikke åpne etter at den var flyttet i DOM-en.**
  Referansen til knappen ble stående, så lytteren ble aldri festet på nytt.

- **`fs.popover({ open: true })` sier det nå på verten.** Før satte den bare
  `aria-expanded` på knappen, så markupen meldte at panelet var åpent mens
  komponenten mente det var lukket.

- **`<fs-suggestion>` mistet musevalg etter at serveren sendte en ny liste.**
  Alternativene fikk bare lytteren sin når selve feltet var nytt.

### Endret

- **React-inngangen døper også om `tabindex` til `tabIndex`,** og dekker de nye
  sammensatte byggerne. `fs.errorSummary()`, `fs.popover()`, `fs.tabs()`,
  `fs.suggestion()` og `fs.toast()` finnes nå også i
  `@fristil/designsystem/react`, der hvert attributtsett er døpt om for seg.
  Pakken har fortsatt ingen avhengighet til React: dette er ren omdøping av
  tre objektnøkler.

- **`lit` er ikke lenger en avhengighet.** Etter omleggingen rendrer ingen
  komponent sitt eget innhold, så Lit ble brukt til nesten ingenting.
  Komponentene er vanlige `HTMLElement`-klasser, og pakken har nå ingen
  avhengigheter i det hele tatt.

## 0.4.0 (2026-09-21)

### Endret

- `lit` er en vanlig avhengighet, ikke en valgfri `peerDependency`. Du trenger
  bare `npm install @fristil/designsystem`, og ikke lenger vite at Lit finnes.
  Bygget ditt er upåvirket: ingenting registreres ved import alene, så Lit
  kommer først med når du kaller en `defineFs*`.

## 0.3.0 (2026-09-21)

### Rettet

- `sjekk-eksport.ts` leser svaret fra `npm pack --json` i begge formene npm
  bruker. npm 11 svarer med en liste, npm 12 med et objekt der pakkenavnet er
  nøkkelen, og arbeidsflyten som publiserer henter alltid nyeste npm. Utgivelsen
  stoppet derfor på «{} is not iterable», med en feil som pekte på vår egen kode
  framfor på npm. Skriptet sier nå fra med npm sin egen feilmelding når
  pakkingen feiler.

- `bin` peker på `dist/cli.js` uten `./` foran. npm rettet det selv ved
  publisering og advarte om at navnet var «invalid and removed», som leste som
  om kommandolinja forsvant. Den var med hele tiden.

## 0.2.0 (2026-09-21)

### Lagt til

- `fristil overta <komponent>` kopierer kildekoden til én komponent inn i
  prosjektet ditt, og skriver om henvisningene ut av mappa. Til bruk når
  tilpasning gjennom CSS ikke strekker til. Kopien er din, og oppdateringer av
  pakken rører den ikke.

- `fristil --hjelp` (og `--help`, `-h`, `help`) skriver ut hva kommandoen kan.
  Uten argumenter gjorde den før et forsøk på å lage et tema, og klaget over
  manglende farger uten å nevne at `overta` fantes.

- Pakken kan publiseres på npm. Den har lisens (MIT), en README som blir
  forsiden på npm, og feltene `repository`, `homepage`, `bugs` og `keywords`.
  `publishConfig` sier `public`, siden en pakke med navnerom ellers blir
  privat, og `prepublishOnly` bygger, så en publisering fra et rent klon ikke
  kan komme ut uten `dist`.

- `bun run sjekk:pakke` kjører [publint](https://publint.dev) mot pakken, som
  en del av bygget. Den leser `exports` slik nettlesere, byggverktøy og TypeScript
  faktisk gjør det.

### Rettet

- `types` står først i hver oppføring i `exports`. Betingelsene leses i
  rekkefølge, og `import` sto først, så TypeScript fant typene bare fordi
  `.d.ts`-fila lå ved siden av `.js`-fila. Stiene er de samme som før.

- Kommandolinja svarer med en forklaring i stedet for et stakkspor fra Node
  når kommandoen er ukjent, eller når temafila mangler eller ikke er JSON.

- Lista over valgte filer i `file-upload` brekker nå til flere linjer på smal
  skjerm. Raden var bredere enn en telefon når filnavnet var langt, og knappen
  «Fjern <filnavn>» ble klippet av.
- `<fs-error-summary>` oppdaterer overskriften når `heading` endrer seg. Den
  ble bare skrevet første gang, så en oppsummering som talte ned fra to feil
  til én ble stående på to.

## 0.1.0 (2026-09-21)

Første versjon.

### Lagt til

- **Tokens** for farge, størrelse, typografi, radius og skygge, med semantiske
  navn (`--semantic-*`) over en råskala. Lyst og mørkt tema, og en egen fil for
  Tailwind 4.
- **34 CSS-komponenter** som bare trenger en klasse og `data-*`-attributter:
  accordion, alert, avatar, badge, breadcrumbs, button, card, checkbox, dialog,
  divider, error-text, fieldset, file-upload, heading, help-text, input, label,
  link, list, pagination, paragraph, radio, search, select, skeleton,
  skip-link, spinner, sr-only, switch, table, tag, textarea, toggle-group og
  tooltip.
- **Fire rammekomponenter** som kobler sammen markupen du selv skriver:
  `<fs-field>`, `<fs-error-summary>`, `<fs-popover>` og `<fs-tabs>`.
- **Fire frittstående komponenter** som eier markupen og interaksjonen:
  `<fs-calendar>`, `<fs-date-field>`, `<fs-suggestion>` og `<fs-toast>`.
- **`fs`-API-et**: én funksjon per komponent som tar et valgobjekt og gir
  attributter tilbake, med lovlige verdier og vakt hengt på funksjonen. En egen
  inngang for React (`@fristil/designsystem/react`) med `className` og
  `htmlFor`, og JSX-deklarasjoner for de egendefinerte elementene.
- **`fristil`-kommandoen** som bygger et tema fra egne farger, sjekker
  kontrasten mot WCAG og skriver ut CSS-en.
- **Tilpasning utenfra**: all CSS ligger i `@layer fristil`, form og størrelse
  leses fra `--fs-*`-variabler med tokenverdien som reserve, og komponenten med
  shadow DOM eksponerer delene sine med `::part()`.
