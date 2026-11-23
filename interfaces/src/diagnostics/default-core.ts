/**
 * The core from the package itself, loaded the first time it is needed, with
 * the package's manifest and colour contract, which sit next to the module.
 *
 * Both the check (`@lo-tek/interfaces/diagnostics`) and the theme
 * (`@lo-tek/interfaces/theme` and `theme-check`) use the same instance.
 */

import { type Core, loadCore } from "./core.js"

/** The files in the package, seen from both `src/diagnostics/` and `dist/diagnostics/`. */
const MODULE = new URL("../../core/lotek-core.wasm", import.meta.url)
const MANIFEST = new URL("../../manifest/manifest.json", import.meta.url)
const CONTRACT = new URL(
  "../../src/tokens/color-contract.json",
  import.meta.url,
)

let core: Core | undefined

/*
 * Loaded the first time it is needed, not when the module is imported:
 * anyone who only wants the types, or `loadCore`, should not pay for it.
 *
 * `node:fs` is fetched with `process.getBuiltinModule` instead of an import,
 * so the file can be bundled for the browser without the bundler looking
 * for `fs`.
 */
export function defaultCore(): Core {
  if (core) return core
  const fs = globalThis.process?.getBuiltinModule?.("node:fs") as
    | typeof import("node:fs")
    | undefined
  if (!fs) {
    // `getBuiltinModule` arrived in Node 20.16 and 22.3, so Node 21 and 22.0
    // to 22.2 are excluded even though they are newer than 20.16. `engines`
    // in package.json says the same. A Node without it is still Node, and
    // should be told that the version is wrong, with both limits, so Node
    // 22.1 is not told it is older than 20.16.
    const node = globalThis.process?.versions?.node
    throw new Error(
      node
        ? `LO-TEK requires Node 20.16 or later in the 20 series, or Node 22.3 or later, and this is Node ${node}.`
        : "LO-TEK reads the core from the package, which requires Node, Bun or Deno. In the browser, load lotek-core.wasm yourself, pass it to loadCore, and give the core manifest.json with loadManifest and color-contract.json with loadContract.",
    )
  }
  let bytes: Uint8Array
  try {
    bytes = fs.readFileSync(MODULE)
  } catch {
    throw new Error(
      `Could not find the core at ${MODULE.pathname}. In the repository it is built with "bun run core" in interfaces/, which requires Rust.`,
    )
  }
  // The manifest is only needed by the check, and the colour contract only
  // by the theme. Each is read the first time a call needs it.
  const loaded = loadCore(bytes)
  let manifest = false
  let contract = false
  const withManifest = () => {
    if (!manifest) loaded.loadManifest(fs.readFileSync(MANIFEST, "utf8"))
    manifest = true
    return loaded
  }
  const withContract = () => {
    if (!contract) loaded.loadContract(fs.readFileSync(CONTRACT, "utf8"))
    contract = true
    return loaded
  }
  core = {
    ...loaded,
    diagnoseMarkup: (html) => withManifest().diagnoseMarkup(html),
    diagnosePage: (html) => withManifest().diagnosePage(html),
    diagnoseStyled: (html, css, page) =>
      withManifest().diagnoseStyled(html, css, page),
    version: () => withManifest().version(),
    buildTheme: (recipe) => withContract().buildTheme(recipe),
    checkRecipe: (recipe) => withContract().checkRecipe(recipe),
    inspectTheme: (css) => withContract().inspectTheme(css),
  }
  return core
}
