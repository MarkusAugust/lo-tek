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

/*
 * And every operation that reaches the core answers when it is the first
 * thing a process does.
 *
 * The core carries no data: the package gives it the manifest and the
 * colour contract, each the first time an operation needs it. An operation
 * that is not told it needs one works in every test, where another has run
 * before it in the same process, and fails for the one who calls only that
 * one: `checkRecipe` answered "The core has not been given a colour
 * contract" as the first call, with every check green. So each is called
 * here from the built package in a process of its own, with Node, as a
 * consumer runs it, and none can lean on another.
 *
 * The operations are read from the entry points and not from a list: a
 * function one of them exports has a call here, or is named as one that
 * does not reach the core, or the check stops.
 */
const FIRST_CALLS: Record<string, Record<string, string>> = {
  "./theme": {
    buildTheme: `const t = m.buildTheme({ accent: "#7c3aed" }); if (!t.css.includes("lotek-theme")) throw new Error("no theme")`,
    recipeValues: `const v = m.recipeValues({ accent: "#7c3aed" }); if (v.length !== 1 || v[0].text !== "#7c3aed") throw new Error("the colour was not given")`,
    recipeBrands: `const b = m.recipeBrands({ accent: "#7c3aed", danger: "purple" }); if (b.length !== 1 || b[0].family !== "accent") throw new Error("no row for the colour the core takes")`,
    checkRecipe: `const w = m.checkRecipe({ accent: "purple" }); if (w.length !== 1 || w[0].kind !== "refused") throw new Error("the refused colour was not found")`,
  },
  "./theme-check": {
    inspectTheme: `const r = m.inspectTheme(":root { --lt-color-accent-text: #ffffff; }"); if (r.blocks !== 1) throw new Error("no block read"); if (r.verdict.kind !== "broken") throw new Error("no verdict")`,
    checkTheme: `const p = m.checkTheme(":root { --lt-color-accent-text: #ffffff; }"); if (p.length === 0) throw new Error("no problem found")`,
  },
  "./diagnostics": {
    diagnoseMarkup: `const f = m.diagnoseMarkup('<button class="lt-buton">Send</button>'); if (f.length !== 1) throw new Error("findings: " + f.length)`,
    diagnosePage: `const f = m.diagnosePage('<!doctype html><html lang="en"><head><title>t</title></head><body><button class="lt-buton">Send</button></body></html>'); if (f.length === 0) throw new Error("no findings")`,
    "diagnoseMarkup, with stylesheets": `const f = m.diagnoseMarkup('<button class="lt-button">Send</button>', { css: [".x {}"] }); if (f.length === 0) throw new Error("no findings")`,
    diagnoseRendered: `const f = await m.diagnoseRendered({ evaluate: async () => ({ html: '<!doctype html><html lang="en"><head><title>t</title></head><body><button class="lt-buton">Send</button></body></html>', css: [] }) }); if (f.length === 0) throw new Error("no findings")`,
  },
}
/** Functions those entry points export that do not go through the package's own core. */
const NOT_THROUGH_THE_CORE: Record<string, string[]> = {
  // `loadCore` gives a core of the caller's own, which the caller gives its
  // data, and `READ_RENDERED_PAGE` runs in a browser.
  "./diagnostics": ["loadCore", "READ_RENDERED_PAGE"],
}

const firstCallFailures: string[] = []
let firstCalls = 0
for (const [name, calls] of Object.entries(FIRST_CALLS)) {
  const file = entryPoints.find(([entry]) => entry === name)?.[1]
  if (!file) {
    firstCallFailures.push(`  ${name}: the package has no such entry point`)
    continue
  }
  const address = new URL(file, packageRoot).href
  const exported = Object.entries(await import(address))
    .filter(([, value]) => typeof value === "function")
    .map(([exportName]) => exportName)
  for (const exportName of exported)
    if (
      !Object.keys(calls).some((call) => call.split(",")[0] === exportName) &&
      !(NOT_THROUGH_THE_CORE[name] ?? []).includes(exportName)
    )
      firstCallFailures.push(
        `  ${name} exports ${exportName}, and this check has no first call for it`,
      )
  for (const [call, script] of Object.entries(calls)) {
    const run = Bun.spawnSync(
      [
        "node",
        "--input-type=module",
        "-e",
        `const m = await import(${JSON.stringify(address)}); ${script}`,
      ],
      { stdout: "pipe", stderr: "pipe" },
    )
    firstCalls += 1
    if (run.exitCode !== 0)
      firstCallFailures.push(
        `  ${name}, ${call}: ${
          run.stderr
            .toString()
            .split("\n")
            .find((line) => /^\w*Error: /.test(line)) ??
          `exit code ${run.exitCode}`
        }`,
      )
  }
}
if (firstCalls < 8)
  firstCallFailures.push(`  only ${firstCalls} first calls were made`)
if (firstCallFailures.length > 0) {
  console.error(
    `These operations do not answer as the first thing a process does:\n\n${firstCallFailures.join("\n")}\n`,
  )
  process.exit(1)
}

console.log(
  `All ${entryPoints.length} entry points can be imported without a DOM, all ${registrations.length} registrations are silent there, all ${builders} builder functions run there without touching the browser, and all ${firstCalls} operations that reach the core answer as the first call of a process.`,
)
