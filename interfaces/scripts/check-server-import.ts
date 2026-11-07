/**
 * Checks that every entry point can be imported on a server, without a DOM,
 * and that registration does nothing there.
 *
 * `HTMLElement` and `customElements` exist only in the browser, and a
 * `class X extends HTMLElement` is evaluated when the module loads. Nine of
 * the entry points therefore stopped with "HTMLElement is not defined" on a
 * server that only wanted `lt.button()`. The main entry point was one of
 * them, which is exactly the line "Getting started" tells the reader to write.
 *
 * No browser test could see it: `HTMLElement` exists there. This one runs in
 * Bun, without a DOM, as an SSR server does.
 *
 * Run by `bun run build`, after `dist` is built.
 */

const packageRoot = new URL("../", import.meta.url)

if (typeof globalThis.HTMLElement !== "undefined") {
  console.error(
    "This check must run without a DOM. HTMLElement exists here, so it proves nothing.",
  )
  process.exit(1)
}

const { javascriptExports } = await import("./exports")
const entryPoints = javascriptExports()

if (entryPoints.length < 20) {
  console.error(
    `Found only ${entryPoints.length} entry points to try. Check the format of exports.`,
  )
  process.exit(1)
}

const failures: string[] = []
const registrations: Array<[string, () => void]> = []

for (const [name, file] of entryPoints) {
  try {
    // The path is turned into a URL. `import()` with a bare file path is not
    // portable: on Windows, ESM reads `C:\…` as a `c:` scheme, and the check
    // would then have reported every single entry point as failing.
    const module = await import(new URL(file, packageRoot).href)

    for (const [exportName, value] of Object.entries(module)) {
      if (exportName.startsWith("defineLt") && typeof value === "function") {
        registrations.push([`${name} → ${exportName}`, value as () => void])
      }
    }
  } catch (error) {
    failures.push(`  ${name}: ${String(error).split("\n")[0]}`)
  }
}

if (failures.length > 0) {
  console.error(
    `These entry points cannot be imported on a server:\n\n${failures.join("\n")}\n`,
  )
  process.exit(1)
}

/*
 * Importing is not enough. `defineLt*` is called from files that in TanStack
 * Start run both on the server and in the browser, and on the server there
 * is no `customElements` to register in. Without this, the `customElements`
 * guard in `defineElement` could disappear without anything saying so.
 */
const registrationFailures: string[] = []

for (const [name, register] of registrations) {
  try {
    register()
  } catch (error) {
    registrationFailures.push(`  ${name}: ${String(error).split("\n")[0]}`)
  }
}

if (registrations.length < 8) {
  console.error(
    `Found only ${registrations.length} registration functions. Expected one per web component.`,
  )
  process.exit(1)
}

if (registrationFailures.length > 0) {
  console.error(
    `These registrations stop on a server:\n\n${registrationFailures.join("\n")}\n`,
  )
  process.exit(1)
}

/*
 * And every builder function runs here, with options, and touches nothing.
 *
 * A builder function gives attributes and never sets an event listener: the
 * behaviour belongs to the web components. Without a DOM, `document` and
 * `HTMLElement` do not exist, so a builder that reaches for them throws. Bun
 * has `addEventListener`, `EventTarget`, timers, `queueMicrotask`,
 * `setImmediate`, `process.nextTick` and `fetch` all the same, so they are made to throw while the functions run. Each function is
 * called once, with the options in `builder-sample.ts`, so a branch those
 * options do not take is not run here. The functions called are the builder
 * functions the manifest names, in both entry points, so `setAttributes`,
 * which writes to an element on purpose, and guards such as `lt.isState` are
 * not among them, and a builder missing from either entry point fails.
 */
const { SAMPLE } = await import("./builder-sample")
const named = (
  (await Bun.file(new URL("manifest/manifest.json", packageRoot)).json()) as {
    builders: Array<{ name: string }>
  }
).builders.map((b) => b.name)
const builderFailures: string[] = []
let builders = 0
/** Thrown by what is made to throw while the builder functions run. */
class BrowserWork extends Error {}
const refuse = (what: string) => () => {
  throw new BrowserWork(what)
}
const TRAPS: Array<[Record<string, unknown>, string, string]> = [
  [
    EventTarget.prototype as unknown as Record<string, unknown>,
    "addEventListener",
    "set an event listener",
  ],
  [
    globalThis as unknown as Record<string, unknown>,
    "addEventListener",
    "set an event listener",
  ],
  [
    globalThis as unknown as Record<string, unknown>,
    "setTimeout",
    "started a timer",
  ],
  [
    globalThis as unknown as Record<string, unknown>,
    "setInterval",
    "started a timer",
  ],
  [
    globalThis as unknown as Record<string, unknown>,
    "queueMicrotask",
    "queued a microtask",
  ],
  [
    globalThis as unknown as Record<string, unknown>,
    "setImmediate",
    "queued work",
  ],
  [process as unknown as Record<string, unknown>, "nextTick", "queued work"],
  [globalThis as unknown as Record<string, unknown>, "fetch", "made a request"],
]
const originals = TRAPS.map(([on, key]) => on[key])
const browserFailures: string[] = []
TRAPS.forEach(([on, key, what]) => {
  on[key] = refuse(what)
})
try {
  for (const entry of ["dist/index.js", "dist/react.js"]) {
    const { lt } = (await import(new URL(entry, packageRoot).href)) as {
      lt: Record<string, unknown>
    }
    for (const name of named) {
      const builder = lt[name]
      if (typeof builder !== "function") {
        builderFailures.push(`  lt.${name} is not a function in ${entry}`)
        continue
      }
      try {
        ;(builder as (options: unknown) => unknown)(SAMPLE)
      } catch (error) {
        // What the browser has and a server does not, or what was made to
        // throw, is behaviour. Anything else is the builder refusing the
        // options, which says SAMPLE lacks one, not that it reached for the
        // browser.
        const browser =
          error instanceof BrowserWork ||
          (error instanceof ReferenceError &&
            /\b(?:document|window|HTMLElement|customElements|navigator|location|requestAnimationFrame|MutationObserver)\b/.test(
              error.message,
            ))
        ;(browser ? browserFailures : builderFailures).push(
          `  lt.${name}() from ${entry}: ${String(error).split("\n")[0]}`,
        )
      }
      builders += 1
    }
  }
} finally {
  TRAPS.forEach(([on, key], i) => {
    on[key] = originals[i]
  })
}

if (named.length === 0 || builders !== 2 * named.length) {
  console.error(
    `Called ${builders} builder functions in the two entry points, where the manifest names ${named.length} for each.`,
  )
  process.exit(1)
}

if (browserFailures.length > 0)
  console.error(
    `These builder functions do what belongs to the browser:\n\n${browserFailures.join("\n")}\n\nA builder function gives attributes. Behaviour belongs in a web component.\n`,
  )
if (builderFailures.length > 0)
  console.error(
    `These builder functions could not be called with the options in builder-sample.ts:\n\n${builderFailures.join("\n")}\n\nGive SAMPLE the option they require, or export them under the name the manifest has.\n`,
  )
if (browserFailures.length > 0 || builderFailures.length > 0) process.exit(1)

console.log(
  `All ${entryPoints.length} entry points can be imported without a DOM, all ${registrations.length} registrations are silent there, and all ${builders} builder functions run there without touching the browser.`,
)
