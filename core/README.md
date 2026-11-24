# The LO-TEK core

LO-TEK's check and theme generator in Rust, compiled to one WebAssembly module that every
host language runs: Node, Bun and the browser directly (`@lo-tek/interfaces/diagnostics`),
VS Code (`../vscode`), the JVM through Chicory (`../kotlin`), IntelliJ
(`../intellij`), and Go, .NET and Python through their own runtimes.

## Why

The check is the only thing that reads markup from a server template: Thymeleaf, JTE,
kotlinx.html, Go templates, Razor or a string. Written in TypeScript, it was
only available where there was a JavaScript engine. In Rust it is one small
module (around 350 kB) with no imports and no data, and the host only needs a
WebAssembly runtime.

It was written in TypeScript first. The Rust version was translated function by
function, and the two were run side by side, field by field, on over 4000 pages
without a single difference before the TypeScript version was deleted.

## The interface

No binding tools, so the same module works everywhere:

1. `alloc(length)` returns a region in the module's memory.
2. The host writes the HTML there as UTF-8.
3. `diagnose_markup_raw(pointer, length)` or `diagnose_page_raw(…)`, which
   answers 0 with the findings.
4. `result_ptr()` and `result_len()` point to the findings as JSON.

The core carries no data. The host gives it the vocabulary with
`load_manifest_raw` and the colour contract with `load_contract_raw`, from the package
it has. How each call answers is at the top of `src/lib.rs`.

Each finding has `start`, `end`, `line`, `column`, `severity`, `rule`, `link`,
`message` and sometimes `fix`. The positions are UTF-16 indices, as in
JavaScript and Kotlin: the whole core works on UTF-16 units, so no
position has to be converted. Line and column start at 1.

`complete_raw(pointer, length)` takes `{"text": "…", "offset": 12, "html": true}`
and answers with what there is to write at that position: classes, attribute
values, and the elements and their attributes when `html` is false.
`hover_raw(pointer, length)` takes `{"text": "…", "offset": 12}` and answers with
what there is to say about the class there, or `null`. Both answer 1 with
`{"error": …}` for input of another shape.

The loader for JavaScript is in `interfaces/src/diagnostics/core.ts`, and
the one for Kotlin in `../kotlin/src/main/kotlin/no/lotek/Lotek.kt`. Each is
around 40 lines.

## The theme

`src/theme/` builds a colour theme from brand colours and checks a theme written
as CSS. The colour contract, meaning the lightness per role, the requirements and the promises, is data in
`interfaces/src/tokens/color-contract.json`, which the host gives the core.
`build_theme_raw(pointer, length)` takes the recipe as JSON and answers 0 with the theme
or 1 with `{"error": …}`. `inspect_theme_raw(pointer, length)` takes the CSS and
answers with the findings and what was checked.

The CSS is read with `cssparser`, the tokenizer from Servo that Firefox uses, following
CSS Syntax Level 3. It is the core's only dependency.

## The vocabulary

The manifest is `interfaces/manifest/manifest.json`, which the package writes from
the code. The host gives it to the core, or another one, such as the one the project
has installed. Where each host finds it is in that host's loader. The manifest has a
`schemaVersion`, and the core rejects a manifest with a shape it does not understand,
with an explanation. It reads versions 1 and 2: version 2 added fields and took none
away, so a manifest or a fragment of either version is read, and one can be merged
onto the other.

## Suppression

A comment applies to the next tag:

```html
<!-- lotek-ignore-next -->
<!-- lotek-ignore-next unknown-class invalid-class-value -->
```

Without rule names every finding in the tag is suppressed, with rule names only those.
The rules are in `src/types.rs` (`RULES`).

## The tests

- `cargo test`: the unit tests in Rust.
- `scripts/check-core.ts`: the fixtures in `parity/` against the expected results next
  to them, field by field, and a requirement that together they trigger every rule in
  `RULES`. A fixture with a `.css` next to it is also checked with
  the stylesheet. The expected results for the first ten were written by the TypeScript version, the
  others by the core, and it is now an ordinary test: a changed answer is a changed
  expected result, and shows in the diff. `ParityTest` in `../kotlin` requires the same
  expected results from the JVM. In addition, all markup in the repository and 4000
  broken variants of the fixtures, with a fixed seed, are run against the requirements an answer has to
  meet: no exceptions, every finding within the text, the right line and column,
  and a rule that exists.
- `scripts/check-diagnostics.ts`: cases that each state how many
  findings they should give, what the message should mention, what the finding should cover and
  what the fix should do. Also time limits for large pages.
- `src/theme/tests.rs`: the contract and the checking of a theme, with twelve
  accent colours, from bright red and neon to almost black, against ten neutrals, from
  black and white to tinted grey, in both appearances: 240 combinations.
- `theme/`: recipes and themes with the answer next to them. The colours
  were written by the TypeScript version of the theme before it was deleted.
  `brands` and the recipes the core refuses were worked out with the colour
  functions in TypeScript and the numbers in the contract, not by the core,
  so a number with decimals is compared within 1e-6. `check-core.ts` requires
  the same answer, and that 2000 broken themes do not crash the core.
- `../kotlin`: the same expected results from the JVM.

## Running

```bash
bun core/scripts/build.ts         # the modules, to core/dist/
bun core/scripts/check-core.ts    # the expected results and the requirements
bun --filter @lo-tek/interfaces pack && (cd kotlin && ./gradlew test -Plotek.package=../interfaces)
```

Requires Rust. `rust-toolchain.toml` fetches the version and the targets
`wasm32-unknown-unknown` and `wasm32-wasip1` on the first call.

The core reads nothing outside `core/` when it is built. The package fetches
the modules with `bun --filter @lo-tek/interfaces core`, and the Kotlin package
gets them from the npm package, so the Gradle build needs neither Rust nor Bun.

## Performance

On a page of 68,000 characters:

| | per `diagnosePage` |
| --- | --- |
| The Rust module in Bun | 9.5 ms |
| The TypeScript version in Bun, before it was deleted | 18 ms |

On the JVM the module is compiled to bytecode when the jar is built, so the first call
takes around 0.2 seconds, and a new thread around 40 milliseconds.
