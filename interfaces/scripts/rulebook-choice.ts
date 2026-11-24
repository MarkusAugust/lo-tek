/**
 * Which rulebook a project gets: the one source of what `lotek agent` reads
 * from the manifest.
 *
 * The rulebooks themselves are written by `generate-agent.ts`. This says who
 * each one is for, and the command line holds no list of its own.
 */

/**
 * The dependency in `package.json` that decides the environment, in the
 * order it is read. Astro comes first, since an Astro app with React islands
 * has both, and `vite` last.
 */
const DEPENDENCIES: [dependency: string, rulebook: string][] = [
  ["astro", "astro"],
  ["react", "react"],
  ["vue", "bundles"],
  ["svelte", "bundles"],
  ["solid-js", "bundles"],
  ["lit", "bundles"],
  ["@starfederation/datastar-sdk", "datastar"],
  ["vite", "bundles"],
]

/**
 * Frameworks that share a rulebook, as `--framework` takes them: Vue, Svelte,
 * Solid and Lit do the same with the style sheets, the attribute names and
 * the registration.
 */
const ALIASES: Record<string, string> = {
  vue: "bundles",
  svelte: "bundles",
  solid: "bundles",
  "solid-js": "bundles",
  lit: "bundles",
  vite: "bundles",
}

export const RULEBOOKS = {
  dependencies: DEPENDENCIES.map(([dependency, rulebook]) => ({
    dependency,
    rulebook,
  })),
  aliases: ALIASES,
}
