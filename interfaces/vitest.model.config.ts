import { defineConfig } from "vitest/config"
import base from "./vitest.config"

/**
 * The model tests, in all three browsers: every order of server updates and
 * user actions to a fixed depth, for each frame component
 * (`*.model.browser.test.ts`, on the search in `src/testing/model.ts`).
 *
 * Not in `bun run test` or `bun run check`. They search for bugs nobody has
 * thought of, rather than guard what is known, and took the check from nine
 * minutes to sixteen. CI runs them in the job "Model tests" when a pull
 * request changes what they read, and they are run by hand before such a
 * pull request: a frame component, `host-element.ts` or the search:
 *
 *     bun run test:model
 *
 * A bug they find gets a scenario test of its own next to the component,
 * which the ordinary run keeps.
 */
// Not `mergeConfig`: it joins the lists, and `include` would hold every test.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["src/**/*.model.browser.test.ts"],
    exclude: [],
  },
})
