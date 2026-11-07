/**
 * The small part of Vite's types the tests need.
 *
 * `vite/client` would bring the whole set, and with two versions of Vite in
 * the dependency tree they collide with each other. Only `import.meta.glob`
 * is here, which is what `package-css.browser.test.ts` uses to read the
 * stylesheets as text.
 */
interface ImportMeta {
  glob<T = unknown>(
    pattern: string | string[],
    options?: { query?: string; import?: string; eager?: boolean },
  ): Record<string, T>
}
