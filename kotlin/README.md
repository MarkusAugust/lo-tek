# LO-TEK for Kotlin

LO-TEK in Kotlin and Java, without Node and without npm: the builder functions,
the diagnostics, and the CSS and web components as a WebJar.

```kotlin
val field = Lt.field(id = "fixer", required = RequiredMarker.TEXT, error = true, invalid = invalid)

"""
<label ${field.label.toHtml()}>Fixer's address</label>
<input ${(Lt.input(type = InputType.EMAIL, state = field.state) + field.control).toHtml()}>
<p ${(Lt.errorText() + field.error).toHtml()}>Enter a valid address.</p>
"""
```

```kotlin
val html = client.post("/jobs") { setBody(invalidForm) }.bodyAsText()
assertEquals(emptyList(), Lotek.diagnosePage(html))
```

## The builder functions

`Lt` has the same builder functions and options as `lt` in TypeScript, with the
allowed values as `enum`s. Each returns an `Attributes`, a plain
`Map<String, String>` that can be given to any template engine, or written
out with `toHtml()`. The builder functions that return several sets, such as `Lt.dialog` and
`Lt.field`, return a data class with one field per set. The parts a template
writes itself have their classes on the builder function, as in TypeScript:
`Lt.card.title` and `Lt.toggleGroup.option` are sets with the class. A part
the answer already gives, such as the header of `Lt.dialog`, has no constant
here; the set in the answer is the way.

Most are generated from the manifest (`manifest/manifest.json` in the npm package)
when the package is built. The manifest describes each builder function as a table of
what each option adds, and `generate-manifest.ts` tests the table against
TypeScript for every combination of options before it is written. The six where the options
interact (`field`, `label`, `legend`, `suggestion`, `tabs` and
`errorSummary`) are written by hand in `Handwritten.kt`.

`ContractTest` runs all of them against every build case in
`../interfaces/manifest/build-cases.json`, which has the answer from TypeScript.
One difference in one attribute, and the test fails.

## The diagnostics

The diagnostics are written in Rust (`../core`) and compiled to WebAssembly.
Here the module is run by [Chicory](https://chicory.dev), a WebAssembly runtime in
pure Java. The module is turned into JVM bytecode when the package is built, so it runs
with the JIT and starts in a fraction of a second. The package has one dependency,
`chicory:runtime`, with no JNI and nothing to install.

It works the same for everything that produces HTML on the JVM: strings, kotlinx.html,
Thymeleaf, JTE, Ktor and Spring. The check reads the HTML that comes out, not
the source. A call borrows an instance from a pool and returns it afterwards, so
calls from several threads do not wait for each other. The pool keeps at most as many
idle instances as the machine has processors.

## The theme

`Lotek.buildTheme(recipe)` builds the colour theme from the JSON text of a
recipe, with Norwegian or English keys like `lotek theme`, and
`Lotek.inspectTheme(css)` checks a hand-written theme. The answers,
`Theme` and `ThemeReport`, have the same fields as `CoreTheme` and
`CoreThemeReport` in TypeScript. The colour contract is in the jar like
the manifest, and `ThemeParityTest` requires the same answer as the expected results in
`core/theme/` for every recipe and every theme.

## The manifest

`Lotek.manifest` is the manifest in the package, the same one the check runs against, with
types: the elements with attributes, parts and events; the classes with
attributes, allowed values, content and parts; the tokens with
the spacings, breakpoints, container widths, colour axes and
component variables; and the builder functions with their options and the shape of
the answer. `Manifest.parse` reads another one, such as
the one `lotekManifest` writes for a project that has taken over components.
The IntelliJ plugin gets the classes for completion from here.
`ManifestReaderTest` requires that nothing from the JSON is lost on the way.

## kotlinx.html

`kotlinx-html/` is a separate package, `lo-tek-kotlinx-html`, with the extension
`Tag.lt(…)`, which puts the attributes from the builder functions on a tag.
`LtTest` builds a job order page with it and requires `assertLotek` to pass,
with and without errors in the form.

## The WebJar

`lotek.css`, the stylesheet for each component and the JavaScript modules for
the browser are under `META-INF/resources/webjars/lo-tek/<version>/`, with
the same paths as in the npm package. `LotekWebJar` has the paths. The files are copied
from the npm package, and `WebJarTest` requires every import in every module to point to a
file in the WebJar.

## The CLI

`cli/` builds `lotek.jar`, the CLI as `java -jar`. It
runs the WASI module from the npm package (`core/lotek.wasm`) with Chicory,
compiled to bytecode at build time, and fetches URLs with Java's own
HTTP client. `lotek.jar` is released on GitHub Releases. The plain jar, without
the dependencies in it, is on Maven as `lo-tek-cli`, because
the Gradle plugin runs it.

```bash
cd kotlin && ./gradlew :cli:fatJar -Plotek.package=../interfaces
java -jar cli/build/libs/lotek.jar --help
```

## The Gradle plugin

`gradle-plugin/` is the plugin `io.github.markusaugust.lo-tek`, with
`lotekSjekk`, `lotekTema` and `lotekManifest`. It runs the CLI
from `cli/` in the Gradle process. `LotekPluginTest` runs it in a
small project with Gradle TestKit, also with the configuration cache.

## Running

```bash
bun --filter @lo-tek/interfaces pack
cd kotlin && ./gradlew test -Plotek.package=../interfaces
```

The build needs only Java. Everything the package consists of comes from the npm package
`@lo-tek/interfaces` with the version in `gradle.properties`: the core and
the CLI as WebAssembly, the manifest, the rulebooks and the files for
the WebJar. `io.github.markusaugust:lo-tek-interfaces` and `@lo-tek/interfaces` with
the same version are therefore built from the same files.

With nothing more, the version is fetched from npm, and the file is compared with the integrity
the registry states. Between two releases the code here is newer than what is
on npm, and then the tarball is packed from the repository and passed with `lotek.package`, as
the commands above and CI do. Packing needs Bun and Rust, but Gradle does
not. Against the npm release the tests give wrong answers: the expected results below are from the repository,
and the core from the previous release.

`lotek.package` is the tarball or the folder it is in, relative to `kotlin/`,
also when the build is included with `includeBuild`. If it is a folder,
`lo-tek-interfaces-<version>.tgz` is used. Pack again when the package has changed:
Gradle uses the tarball that is there, even an old one. The build stops if the tarball has a
different version from `gradle.properties`, and `bun run prepare-version` sets
both.

The expected results for the tests are not part of the npm package, and are read from the repository:
`../interfaces/manifest/build-cases.json` and `../core/parity/`.

`ParityTest` requires the findings on the JVM to be identical to the expected results in
`../core/parity/`, the same expected results `core/scripts/check-core.ts`
requires of the core in Bun. Together the fixtures trigger every rule the core has,
the stylesheet rules included, and the positions must point to the right text in a
Kotlin string, also with "æøå" and emoji in front. The script that reads the rendered
page, `READ_RENDERED_PAGE`, is tested by `interfaces/scripts/check-rendered.ts`
in a real browser.
