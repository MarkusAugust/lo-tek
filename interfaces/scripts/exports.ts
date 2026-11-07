/**
 * The JavaScript entry points in `exports`, read one way for every script
 * that asks. An entry is a path, or an object whose `import` is the path;
 * the stylesheets and `package.json` are not JavaScript.
 */
import pkg from "../package.json"

/** Each JavaScript entry point by its name in `exports`, `./field`, with the file in the package. */
export function javascriptExports(): Array<[name: string, file: string]> {
  return Object.entries(pkg.exports as Record<string, unknown>)
    .filter(([name]) => !name.endsWith(".css") && name !== "./package.json")
    .map(([name, value]): [string, unknown] => [
      name,
      typeof value === "string"
        ? value
        : (value as { import?: unknown } | null)?.import,
    ])
    .filter((pair): pair is [string, string] => typeof pair[1] === "string")
}

/** The source in `src` of every JavaScript entry point built into `dist`. */
export function exportedSources(): Set<string> {
  return new Set(
    javascriptExports()
      .map(([, file]) => file)
      .filter((file) => file.startsWith("./dist/") && file.endsWith(".js"))
      .map((file) => `src/${file.slice("./dist/".length, -".js".length)}.ts`),
  )
}
