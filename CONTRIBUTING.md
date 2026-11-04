# How we work on LO-TEK

## Branches and pull requests

`master` must always be green. So all work goes through a branch and a pull request, small changes included.

```bash
git checkout master && git pull
git checkout -b what-you-are-working-on

# work and commit, then run what CI runs before you send anything off
git commit -am "Fix …"
bun run check
# and, when the change touches a frame component, host-element.ts or the
# search in interfaces/src/testing/model.ts:
bun run test:model

git push -u origin what-you-are-working-on
gh pr create --fill
```

The branch can be merged once CI is green. GitHub is set up to require it, so a red run disables the button.

## `bun run check`

Runs the steps in `.github/workflows/ci.yml`, in the same order and the same
way: every `run:` with bash and `-eo pipefail`, in the folder the step names.
`scripts/check.ts` reads the steps from the file, so a new check in CI runs locally
from day one. The jobs run one after another:

| Job | What it checks |
| --- | --- |
| `authors` | that no commit has an agent as author |
| `check` | the Node and Bun versions against every package's engines, lint, type checking of the code and the tests, the browser tests in Chromium, Firefox and WebKit, the build, the CLI and the language server in every host, the rendered page, the VS Code extension, that nothing is left ungenerated, the site built with Netlify's command, and axe against it |
| `core` | Rust formatting and clippy, the Rust tests, the WASI module, the core against the expected results, and the Kotlin tests |

Three things do not run locally, and are listed with the reason in `SKIPPED` in the script:
the Windows job, the upgrade of the global npm, and the browser
download. If a name there does not exist in `ci.yml`, the run stops,
so the list cannot linger after a step has been renamed. The steps with
`uses`, such as the caches and the Java setup, are skipped too: they give
the CI machine what your machine already has. Locally, the Java you
have installed is used. If `ci.yml` contains something the script does not understand, such as `env`,
`if` or `defaults`, it stops before it runs anything.

`ci-intellij.yml` runs after them when the branch touches one of the paths in its filter, as it would on the pull request, committed or not. It takes a couple of minutes, and needs the IDE in `intellij/.intellijPlatform`, which the first run downloads.

Node comes from `.node-version`, which every workflow and Netlify read. The check stops on another major version than the one there, and says so on another minor or patch: `scripts/check-engines.ts` holds the pinned version against the engines of every installed package, so the difference cannot hide a version they refuse. Bun is pinned in the workflows and as `BUN_VERSION` in `netlify.toml`, and the same script requires them to agree.

The step `Generated files are up to date` asks git whether the build changed anything, so run `check` after
the change is committed. Otherwise the step fails on your own changes.

Besides Bun it needs: Rust, since the check in the package is built from
`core/`; Java 17 or later, for the jar and the Kotlin tests; and network access the first
time, when VS Code is downloaded. On Linux without a display, meaning with neither `DISPLAY` nor
`WAYLAND_DISPLAY` set, you also need `xvfb-run`; if the machine has a display, VS Code
runs on it. The accessibility tree check reads AT-SPI, which only Linux has: on
macOS it runs in the Playwright image and needs podman or docker; on Linux,
install what `interfaces/scripts/accessibility/install.sh` lists, once.
Install [rustup](https://rustup.rs), and `rust-toolchain.toml` fetches
the right version and the targets on the first call.

The whole run takes about six minutes on a Mac with an M-series chip. Most of the time goes to
the browser tests, axe against the documentation, the language server and the jar. While
you work, `bun --filter @lo-tek/interfaces test:browser --project chromium`
is enough. `bun run test -- --project chromium` does not work: `bun run` appends
the arguments to the end of the script text, and `test` is two commands in a
row, so the flags end up on the last one.

## `bun run test:model`

The model tests, one `*.model.browser.test.ts` per frame component, try
every order of server updates and user actions to depth 3, in all three
browsers, and check the accessibility tree and the component's promises
after each step (`interfaces/src/testing/model.ts`). They are not in
`bun run check` or CI: they search for bugs nobody has thought of, rather
than guard what is known, and took the check from nine minutes to sixteen.
Run them before a pull request that touches a frame component,
`interfaces/src/components/host-element.ts` or the search; they took nine minutes on an M-series Mac
that was busy with other work. A bug they find gets a scenario test of its own in the
component's ordinary test file, which CI keeps.

The browsers are installed once:

```bash
bun --filter @lo-tek/interfaces browsers
```

Use that form, not `bunx playwright install`, which can fetch a different version from the one vitest uses, and not `bun --filter <package> run <script>` either, which gives "No packages matched the filter". The script name goes without `run`.

If Playwright's browsers cannot be downloaded, offline or behind a firewall,
`bun --filter @lo-tek/interfaces test:chromium` runs the tests in a Chrome
or Chromium already installed on the machine. The path is read from `CHROMIUM`, otherwise
the usual locations are tried. Chromium only: Firefox and WebKit have to be
Playwright's own builds.

## Generated files

The files in the two tables below are written by a script, and a change made directly in them is overwritten on the next run. `bun --filter @lo-tek/interfaces generate` writes all of them, in the order below, and `bun run build` runs `generate` right after the core, before any check reads the files.

| File | Source |
| --- | --- |
| `interfaces/src/tokens/matrix-cells.ts` | `src/tokens/color-contract.json` and the brand colours, computed by the core in `scripts/generate-matrix.ts` |
| `interfaces/src/tokens/tokens.css` | `src/tokens/tokens.ts` and the colour matrix |
| `interfaces/src/tailwind/tailwind.css` | the same tokens |
| the vocabulary, table below | `scripts/generate-vocabulary.ts` |
| `interfaces/agent/*.md`, the rulebooks for coding agents | `scripts/generate-agent.ts` and `agent-parts.ts` |
| `interfaces/manifest/manifest.json`, `build-cases.json` and `files.json` | `scripts/generate-manifest.ts`, from `src/lt.ts`, the vocabulary and the folders. `files.json` is the rulebooks and component files the CLI reads |

The vocabulary also has its own command, `bun --filter @lo-tek/interfaces vocabulary`, which writes only these, all in the package. The editors read them: the VS Code extension copies the first two when it is built, and the IntelliJ plugin reads the classes from the project's manifest, with the manifest in the Kotlin package as a fallback.

| File | What it is |
| --- | --- |
| `interfaces/html-data.json` | VS Code's format for tags and attributes |
| `interfaces/snippets.json` | one snippet per element |
| `interfaces/src/vocabulary/elements.ts` | the elements and attributes the manifest is written from |
| `interfaces/src/vocabulary/classes.ts` | every `lt-` class, read by calling the builder functions |
| `interfaces/web-types.json` | JetBrains' format, ships with the npm package |
| `interfaces/src/components/events.ts` | the types of the events and the tag names, which extend `HTMLElementEventMap` and `HTMLElementTagNameMap` |

All six come from `interfaces/scripts/metadata.ts`, the CSS and the "Plain HTML" tabs on the component pages, through `scripts/generate-vocabulary.ts`. They are described in more detail under [The editor extension](#the-editor-extension).

In the rulebooks the prose is in the generator, while the lists and numbers are read from the package: the classes, the elements, the builder functions and the token names are fetched from where they actually live, so a rulebook cannot promise something that does not exist. `check-agent.ts` checks both.

The build does not stop on an outdated file: `generate` writes them again before any check reads them, so `check:vocabulary` and `check:agent` always compare against what was just written. If you forget to regenerate, or to commit what was generated, CI tells you: the step `Generated files are up to date` runs `git status --porcelain` after the build and fails if the build changed a tracked file.

## Changelog and releases

`interfaces/CHANGELOG.md` is written as you go, not at release time. If you change something a consumer will notice, add the line under the heading `Unreleased` in the same pull request as the change. `bun run build` stops if the version in `package.json` has no heading in the changelog.

When a version is to be released:

```bash
bun run prepare-version 0.4.0
git checkout -b release-0.4.0 && git commit -am "Version 0.4.0"
bun run check
git push -u origin release-0.4.0 && gh pr create --fill
```

The commit comes before `check`, not after: `Generated files are up to date` asks git whether the build changed anything, and `prepare-version` has just written fourteen tracked files, so run before the commit, `check` stops on them several minutes into the run.

`prepare-version` renames the heading `Unreleased` to the number and the date, adds a new empty one above it, and sets the same number in `interfaces/package.json`, `bun.lock`, `web-types.json`, `kotlin/gradle.properties` and the presentation. Finally it runs `generate-agent.ts` and `generate-manifest.ts`, so `interfaces/agent/*.md` and `interfaces/manifest/*.json`, which also contain the version, carry the new number in the same commit. It refuses to set a version that is not higher than the current one, and to release an empty `Unreleased`, and all the checks come before it writes anything, so an aborted attempt leaves no half-written files.

Both `prepare-version` and `tag` start with `bun run advisories`, and stop if it finds anything. It asks `bun audit` about the whole npm lockfile, devDependencies included, and OSV about every crate in `Cargo.lock`, every Maven coordinate and Gradle plugin written out in a `*.gradle.kts`, the standard library in `coreLibrariesVersion`, and the Kotlin each Gradle in the repository embeds, which `kotlin-dsl` brings (read with `./gradlew --version`). A version it cannot read, a plugin id missing from `PLUGINS`, a plugin without a version that is neither a Gradle core plugin nor versioned in another build file, or a crate from git stops the run. Transitive Maven dependencies and Gradle itself are not covered. Fix what it reports before releasing: `bun audit fix` for npm, a new version in `Cargo.lock` or the build file otherwise. An advisory that cannot be fixed yet goes in `ACCEPTED` in `scripts/check-advisories.ts`, with the reason. It is not a step in CI, because the answer changes when an advisory is published, not when the code does. Run it yourself before a pull request is merged, since a merge to master deploys the documentation.

The tag is set only once the version is on master:

```bash
git checkout master && git pull
bun run tag package
```

`bun run tag` without arguments shows the versions on the commit and which of them are tagged. With `package` (the npm package), `extension` (the VS Code extension) or `intellij`, several at once if you like, it sets the tags and pushes them. It refuses when you are not on master as it is on GitHub, when the working tree has changes, when the tag already exists, and when the version is missing from the changelog. `--dry-run` shows what would happen. The extension's tags are called `extension-v<version>`; up to 0.9.0 they were `utvidelse-v<version>`, and the script counts a version tagged that way as released.

**Tag as soon as the branch is merged.** The documentation is deployed by
Netlify the moment master changes, and the recipes there point to
`cdn.jsdelivr.net/npm/@lo-tek/interfaces@<version>`, the version
`package.json` states. It does not exist on npm until the tag has run
`publish.yml`. If you wait with the tag, the "Plain HTML" and Datastar recipes
on twelve pages point to a package that is not there yet. Both builds take a couple of
minutes, so if you tag straight away, the window is closed in practice.

The order cannot be swapped. If you tag before the version is on master, the checks in `publish.yml` stop the run: the tag must say the same as `package.json`, and the commit it is on must be on master. The tag then has to be removed with `git push origin :refs/tags/v0.4.0` and `git tag -d v0.4.0` before you can set it again. `git push` on its own sends no tags, so the last step cannot be skipped.

The tag starts `.github/workflows/publish.yml`, which builds the package and publishes it to npm. The workflow has no secrets in it: it asks npm for a short-lived credential through GitHub's OIDC, and that only works as long as the package has a publisher registered under Settings on npmjs.com (GitHub Actions, `MarkusAugust`, `lotek`, `publish.yml`). npm also signs an attestation that shows which commit the version came from.

The very first release cannot be done this way, because a publisher can only be linked to a package that already exists. It is done from the machine, with `npm login` first:

```bash
cd interfaces && npm publish --access public
```

A version can never be published again or overwritten, and `npm unpublish` is closed after 72 hours. To take a version out of circulation, use `npm deprecate`.

Once the npm package is out, the same workflow runs one more job, built from the published tarball: `lotek.wasm` and `lotek.jar` are attached to the release on GitHub.

The Kotlin package goes to Maven Central as `io.github.markusaugust:lo-tek-interfaces`, `lo-tek-kotlinx-html`, `lo-tek-cli` and `lo-tek-gradle-plugin`, but not by itself. Central has a monthly cap on the number of releases and files for a free organisation, and every run there counts, so the Maven job only runs when you start the workflow by hand on the tag and ask for it:

```bash
gh workflow run publish.yml --ref v0.34.0 -f maven=true
```

Do it when a change concerns the Kotlin consumers, not for every tag. The Maven version can skip npm versions: every Maven version is built from the npm package with the same number, so 0.34.3 on Central is the same LO-TEK as 0.34.3 on npm, even when 0.34.1 and 0.34.2 never went there. The version in `kotlin/gradle.properties` is set by `prepare-version`. Central requires a namespace verified on central.sonatype.com, a user token and a GPG key, and the secrets are listed in the comment above the job in `publish.yml`. If they are missing, nothing is published to Central, and the run gets a warning. A version on Central can never be replaced either.

The major number goes up when a class name, a `data-*` attribute, a `part` name, a token name, an `--lt-*` variable, a function in `lt` or an entry in `exports` disappears or changes meaning. The rules are at the top of the changelog, and they are what a user of the package relies on.

## The editor extension

`vscode/` is the VS Code extension. `package.json` points to
`dist/html-data.json`, which the build copies from the package, and to
`dist/lotek.code-snippets`, which `scripts/build-snippets.ts` writes from the
package's `snippets.json` with the default of `lotek.languages` as the scope
of every snippet, read when the extension is built, so a changed setting does
not reach the snippets; together they give completion and snippets without code.
It also points to `dist/extension.js`, which connects the check to the editor
with squiggles, light bulbs, completion and hover. The check is the Rust core in `core/`,
built to WebAssembly. The same module is in the package, as
`@lo-tek/interfaces/diagnostics` and `lotek check`, and the extension has a
copy in `dist/`. The core carries no data: every host gives it the manifest from
the package, and the extension has a copy of it in `dist/manifest/` as a fallback.
The manifest is written from
`interfaces/src/vocabulary/elements.ts` and `classes.ts`. `classes.ts` is read
from the package's CSS and from the builder functions in `lt`, called once per variant, so
a new variant is included once `lt` returns it. The files are generated from
`interfaces/scripts/metadata.ts`, the CSS and the "Plain HTML" tabs on the component pages,
together with `interfaces/web-types.json` for JetBrains. If you change an
attribute on a component, the type check stops until `metadata.ts` has a
sentence about it. `bun run build` writes the files again before any check reads
them, and does not fail on an outdated file; if you forget to commit what the build wrote,
the step `Generated files are up to date` in CI does. The files can also be written on their own:

```bash
bun --filter @lo-tek/interfaces vocabulary
```

The core has no VS Code in it, and `core/scripts/check-diagnostics.ts`
runs it over every error type it is meant to catch, with the snippets as clean
cases. If you add a rule in `core/src/`, add the case that fails it, and check
that it actually fails by switching the rule off. See `core/README.md`. `bun --filter ./vscode
check` builds `dist/extension.js` and packs `lotek.vsix`.

The extension has its own version number in `vscode/package.json` and its own
changelog in `vscode/CHANGELOG.md`, and is released with its own tag:

```bash
bun run tag extension
```

The tag starts `.github/workflows/publish-extension.yml`. Marketplace has
no OIDC, so the workflow needs the secret `VSCE_PAT`: a personal
token from Azure DevOps with the scope "Marketplace: Manage", created by whoever
controls the publisher `lo-tek` on marketplace.visualstudio.com. The publisher has to
be created there before the first release.

The IntelliJ plugin has its number in `intellij/gradle.properties` and
`changeNotes` in `build.gradle.kts`, and is released with `bun run tag intellij`. See
`intellij/README.md`.

**The extension and the plugin are also tagged as soon as the branch is merged,**
for the same reason as the package: the editors page in the documentation describes what
the latest version of each does, and is deployed the moment master changes. If
the version in `vscode/package.json` or `pluginVersion` has no tag, the
page promises something Marketplace does not have. `bun run tag` without arguments shows what
is untagged, and `bun run tag` with one part reminds you of the others.

## The documentation

The text is in British English. Headings use sentence case, and examples show
how the component is actually used, with import, registration and realistic values.

Live examples go through `Preview.astro`, which puts the content in a
shadow root. Without the isolation the documentation site's own CSS hits
the example, and you no longer see what a consumer gets.

## Names in the code

Functions, variables, types and constants are named in English, local
variables included, and never mixed within one name. Comments are in English.
`check-identifiers.ts` fails a Norwegian name in the code that ships;
test files, `src/testing/`, `src/types/` and the scripts in `scripts/` are exempt.

A check must not ask the source about the source. The expected value, the count or
the content, has to come from somewhere other than the queue the check walks through, otherwise
the guard only checks itself. `check-agent.ts` therefore reads the folder on
disk, and `check-vocabulary.ts` reads `exports` in the package, not the metadata.

## Commit messages

In English, in the imperative, without a prefix: "Fix focus in the error summary", not "fix: …". The body explains why, not what the diff already shows.

## Author

Commits are always made in the maintainer's name, `MASK <m.a.sobergklyver@gmail.com>`, also when a coding agent wrote the code. An agent must never appear as author or committer, and the message must not have lines that give it credit: no `Co-Authored-By: Claude …`, no `Claude-Session: …` and no "Generated with Claude Code". The same applies to the description of a PR, and the rule takes precedence over whatever a tool otherwise asks for.

Check the identity before the first commit, especially in a new environment such as a cloud session:

```bash
git config user.name "MASK"
git config user.email "m.a.sobergklyver@gmail.com"
```

The CI job **Authors** (`authors`, `bun run check:authors`) goes through the whole history and fails on both. Branches get descriptive names, not `claude/…`.

## When CI is red on master

It should not happen, but if it does: create a branch with the fix, open a PR, and let CI confirm that it works before you merge. Do not push straight to master for a quick fix. An error in the workflow itself only shows up in a run, and you only get a run through a PR or a push to master.
