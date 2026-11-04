/**
 * Checks the command line tool, the way a consumer runs it.
 *
 * `bun run test` runs in the browser, and `tsc` reads only the types. Flags
 * that are not read, a file that is not written, or an error that exits with
 * code zero would therefore go straight through. Here the built file runs in
 * its own process, which is what a consumer actually gets.
 *
 * Run with: bun scripts/check-cli.ts, or as part of `bun run build`.
 */

import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { lightCells } from "../src/tokens/matrix-cells.js"

const packageDir = fileURLToPath(new URL("../", import.meta.url))

// The package for the executable, which has no host to set it. Explicit,
// since `Bun.spawn` does not inherit changes to `process.env`.
const ENVIRONMENT = {
  ...process.env,
  LOTEK_PACKAGE: process.env.LOTEK_PACKAGE ?? packageDir,
}
const cli = join(packageDir, "dist/cli.js")

/*
 * The command under test. The default is the built file, which a consumer
 * gets. `LOTEK_CLI` points to another one, like the executable from
 * `cli`, so the same assertions are tested against it. `LOTEK_COMPARE`
 * runs every run with both and requires the same answer byte for byte:
 * standard output, standard error and the exit code. Both can be a JSON
 * list, a command with arguments, like `["java", "-jar", "lotek.jar"]`.
 */
const command = (value: string): string[] =>
  value.startsWith("[") ? JSON.parse(value) : [value]
const COMMAND = process.env.LOTEK_CLI
  ? command(process.env.LOTEK_CLI)
  : ["node", cli]
const COMPARE = process.env.LOTEK_COMPARE
  ? command(process.env.LOTEK_COMPARE)
  : undefined
const differences: string[] = []

const COLOURS = [
  "--accent=#7c3aed",
  "--danger=#b3261e",
  "--success=#2b6940",
  "--warning=#8a5a00",
]

type Run = { code: number; out: string; err: string }

let runCount = 0

async function run(args: string[], folder?: string): Promise<Run> {
  runCount += 1

  const start = (command: string[], withArgs = args) =>
    Bun.spawn([...command, ...withArgs], {
      env: ENVIRONMENT,
      stdout: "pipe",
      stderr: "pipe",
      // `agent` reads package.json in the working directory. Without this
      // every run would see the package's own, and the detection would never
      // be tested.
      cwd: folder,
    })
  const answer = async (child: ReturnType<typeof start>) => {
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    return { code, out, err }
  }

  /*
   * `takeover` writes to the folder in `--out`. The other command gets its
   * own copy of the folder, as it was before the first one ran, and the path
   * is swapped back in the answer before it is compared.
   */
  const out =
    COMPARE && args[0] === "takeover"
      ? args.find((part) => part.startsWith("--out="))?.slice("--out=".length)
      : undefined
  const otherOut = out
    ? join(await mkdtemp(join(tmpdir(), "lotek-compare-")), "out")
    : undefined
  if (out && otherOut)
    await cp(out, otherOut, { recursive: true }).catch(() => {})

  const result = await answer(start(COMMAND))
  if (COMPARE) {
    const other = await answer(
      start(
        COMPARE,
        args.map((part) =>
          out && otherOut && part === `--out=${out}`
            ? `--out=${otherOut}`
            : part,
        ),
      ),
    )
    if (out && otherOut) {
      other.out = other.out.replaceAll(otherOut, out)
      other.err = other.err.replaceAll(otherOut, out)
      await rm(dirname(otherOut), { recursive: true, force: true })
    }
    /*
     * Two explanations come from the JavaScript engine itself, and cannot be
     * made equal: what is wrong in a JSON file, and why nobody answered on an
     * address ("fetch failed"). The rest of the message must be the same.
     */
    const same = (text: string) =>
      text
        .replace(/(is not valid JSON: ).*/g, "$1…")
        .replace(/(Could not reach \S+: ).*/g, "$1…")
    for (const part of ["code", "out", "err"] as const)
      if (same(String(result[part])) !== same(String(other[part])))
        differences.push(
          `${args.join(" ")} (${part})\n    ${JSON.stringify(result[part]).slice(0, 400)}\n    ${JSON.stringify(other[part]).slice(0, 400)}`,
        )
  }
  return result
}

const failures: string[] = []

function expect(claim: boolean, description: string): void {
  if (!claim) failures.push(description)
}

// Writes the theme to standard output when no file is given
{
  const { code, out } = await run(["theme", ...COLOURS])

  expect(code === 0, `theme with every colour exited with code ${code}`)
  expect(
    out.includes("--lt-color-accent-fill"),
    "the output is missing the colours from the matrix",
  )
  expect(
    out.includes('[data-theme="dark"]'),
    "the output is missing the dark theme",
  )
}

// Writes to a file when --out is given, and leaves standard output empty
{
  const folder = await mkdtemp(join(tmpdir(), "lotek-cli-"))
  const path = join(folder, "theme.css")

  const { code, out } = await run(["theme", ...COLOURS, `--out=${path}`])
  const content = await readFile(path, "utf8")

  expect(code === 0, `writing to a file exited with code ${code}`)
  expect(
    out.trim() === "",
    "standard output should be empty when the theme is written to a file",
  )
  expect(content.includes("@layer lotek"), "the file is missing the layer")

  await rm(folder, { recursive: true, force: true })
}

// Reads the colours from a JSON file
{
  const folder = await mkdtemp(join(tmpdir(), "lotek-cli-"))
  const path = join(folder, "lotek.theme.json")
  await writeFile(
    path,
    JSON.stringify({
      accent: "#0f766e",
      danger: "#9f1239",
      success: "#15803d",
      warning: "#a16207",
    }),
  )

  const { code, out } = await run(["theme", path])

  expect(code === 0, `reading from a file exited with code ${code}`)
  expect(
    out.includes("--lt-color-accent-fill"),
    "the output is missing the colours from the file",
  )

  await rm(folder, { recursive: true, force: true })
}

// `check-theme` checks a theme, and counts the consumer's own values
{
  const folder = await mkdtemp(join(tmpdir(), "lotek-theme-"))
  const good = join(folder, "good.css")

  // The matrix written out as a theme, checked against itself
  await writeFile(
    good,
    ":root {\n  color-scheme: light;\n" +
      Object.entries(lightCells)
        .map(([name, value]) => `  ${name}: ${value};`)
        .join("\n") +
      "\n}\n",
  )

  const clean = await run(["check-theme", good])
  expect(clean.code === 0, `a theme that holds exited with ${clean.code}`)
  expect(
    /\d+ values/.test(clean.out),
    `check-theme does not say how many values it read: ${clean.out.slice(0, 80)}`,
  )

  // A danger text that is too light fails, and says which cell
  const weak = join(folder, "weak.css")
  await writeFile(
    weak,
    ":root { color-scheme: light; --lt-color-danger-text: #ff9999; }",
  )
  const failed = await run(["check-theme", weak])
  expect(
    failed.code !== 0,
    "a danger text that is too light should give an error code",
  )
  expect(
    failed.err.includes("danger"),
    `the message does not name the family: ${failed.err.slice(0, 80)}`,
  )

  // A theme without colours from `theme` has no contrast to check, and that
  // is not a violation. A file without a theme still is.
  const colourless = join(folder, "colourless.css")
  const built = await run([
    "theme",
    "--font=Helvetica, Arial, sans-serif",
    "--button-radius=2.75rem",
    `--out=${colourless}`,
  ])
  expect(built.code === 0, `theme without colours exited with ${built.code}`)
  const withoutColours = await run(["check-theme", colourless])
  expect(
    withoutColours.code === 0,
    `a theme without colours exited with ${withoutColours.code}: ${withoutColours.err.slice(0, 120)}`,
  )
  const noTheme = join(folder, "no-theme.css")
  await writeFile(noTheme, "body { color: red }")
  const none = await run(["check-theme", noTheme])
  expect(none.code !== 0, "a file without a theme should give an error code")

  // An unknown flag stops the run instead of disappearing
  const flag = await run(["check-theme", good, "--something"])
  expect(flag.code !== 0, "an unknown flag should give an error code")

  // And without files it says what it wants
  const withoutFiles = await run(["check-theme"])
  expect(
    withoutFiles.code !== 0,
    "check-theme without files should give an error code",
  )

  await rm(folder, { recursive: true, force: true })
}

// A family that is left out inherits LO-TEK's own, rather than failing the run
{
  const { code, out } = await run(["theme", "--accent=#7c3aed"])

  expect(code === 0, `one brand colour alone exited with code ${code}`)
  expect(
    out.includes("--lt-color-danger-fill"),
    "a theme with only accent is missing the inherited families",
  )
}

/*
 * Font and shape, as flags and from a file.
 *
 * This is the only check that runs the flags the way a consumer does.
 * `buildTheme()` is tested in the browser, but it never sees a flag: if the
 * hyphen in the character class that reads them is reverted,
 * `--button-radius=2rem` is read as a file name again, and everything else
 * passes.
 */
{
  const { code, out } = await run([
    "theme",
    "--font=Helvetica, Arial, sans-serif",
    "--button-radius=2.75rem",
    "--field-radius=0.25rem",
    "--surface-radius=0.25rem",
    "--button-border=3px",
    "--button-weight=700",
  ])

  expect(code === 0, `theme without colours exited with code ${code}`)
  expect(
    out.includes("--lt-font-family-base: Helvetica, Arial, sans-serif;"),
    "the font is missing",
  )
  expect(
    out.includes("font-family: var(--lt-font-family-base);"),
    "the font was not set as a rule, only as a token",
  )
  expect(
    out.includes("--lt-button-radius: 2.75rem;"),
    "the button radius is missing",
  )
  expect(
    out.includes("--lt-textarea-radius: 0.25rem;"),
    "the text area radius is missing",
  )
  expect(
    out.includes("--lt-button-border-width: 3px;"),
    "the button border is missing",
  )
  expect(
    out.includes("--lt-button-font-weight: 700;"),
    "the button weight is missing",
  )
  expect(
    !out.includes("--palette-") && !out.includes("--semantic-"),
    "a theme without colours must not write colours",
  )
}

// Font and shape from a theme file, together with the colours
{
  const folder = await mkdtemp(join(tmpdir(), "lotek-theme-"))
  const path = join(folder, "lotek.theme.json")
  await writeFile(
    path,
    JSON.stringify({
      accent: "#7c3aed",
      danger: "#b3261e",
      success: "#2b6940",
      warning: "#8a5a00",
      typography: { fontFamily: "Georgia, serif" },
      shape: { buttonRadius: "1rem" },
    }),
  )

  const { code, out } = await run(["theme", path])

  expect(
    code === 0,
    `theme from a file with font and shape exited with code ${code}`,
  )
  expect(
    out.includes("--lt-font-family-base: Georgia, serif;"),
    "the font from the file is missing",
  )
  expect(
    out.includes("--lt-button-radius: 1rem;"),
    "the radius from the file is missing",
  )
  expect(
    out.includes("--lt-color-accent-fill"),
    "the colours from the file are missing",
  )

  await rm(folder, { recursive: true, force: true })
}

// The Norwegian keys are gone, and an unknown key names the English ones
{
  const folder = await mkdtemp(join(tmpdir(), "lotek-theme-"))
  const path = join(folder, "lotek.theme.json")
  await writeFile(
    path,
    JSON.stringify({ aksent: "#7c3aed", typography: { fontFamly: "Georgia" } }),
  )

  const { code, err } = await run(["theme", path])

  expect(code === 1, `a recipe with unknown keys gave code ${code}`)
  expect(
    err.includes("aksent") && err.includes("typography.fontFamly"),
    `the message does not name the unknown keys with their path: ${err.slice(0, 160)}`,
  )

  await rm(folder, { recursive: true, force: true })
}

// Says so when a flag does not exist, rather than ignoring it
{
  // A misspelt flag went quietly through once, and the theme came out
  // without the radius and without a word.
  const { code, err } = await run([
    "theme",
    "--font=Helvetica",
    "--button-radii=2rem",
  ])

  expect(code !== 0, "an unknown flag should give an error code")
  expect(
    err.includes("--button-radii"),
    "the error message does not say which flag",
  )
}

// Rejects a value that could break out of the CSS rule it is written into
{
  const { code, err } = await run([
    "theme",
    "--button-radius=4px; } html { display: none } :root { --x: 1",
  ])

  expect(code !== 0, "a value that closes the rule should give an error code")
  expect(
    err.includes("buttonRadius"),
    `the error message does not name the value: ${err.slice(0, 120)}`,
  )
  expect(
    !err.includes("Colours are written as hexadecimal"),
    "the error message points to the colours, and the error is not about colours",
  )
}

// Says so when the recipe sets nothing
{
  const { code, err } = await run(["theme"])

  expect(code !== 0, "an empty theme should give an error code")
  expect(
    err.includes("empty"),
    `the error message does not say the theme is empty: ${err.slice(0, 120)}`,
  )
}

// Says so in a readable way when a colour is not a colour
{
  const { code, err } = await run([
    "theme",
    "--accent=purple",
    "--danger=#b3261e",
    "--success=#2b6940",
    "--warning=#8a5a00",
  ])

  expect(code !== 0, "an invalid colour should give an error code")
  expect(
    err.includes("purple"),
    `the error message does not name the wrong value: ${err.slice(0, 120)}`,
  )
  expect(
    err.includes("Colours are written as hexadecimal"),
    `the error message has no hint about the colours: ${err.slice(0, 160)}`,
  )
  expect(
    !err.includes("at buildTheme"),
    "the error message shows a stack trace rather than saying what is wrong",
  )
}

/**
 * Every component can be taken over, and the copy does not point into thin
 * air.
 *
 * The rewrite swaps a relative path for the entry point in `exports`, but
 * only when the entry point exists. If it does not, the path stays as it is,
 * and the copy points to a folder that does not exist for the consumer. That
 * was written down as a risk for a long time, without anything checking it.
 *
 * Here every component the tool itself lists is taken over, and every
 * reference out of the folder is checked against `exports` in the package.
 */
{
  const exported = new Set(
    Object.keys(
      (
        JSON.parse(
          await readFile(join(packageDir, "package.json"), "utf8"),
        ) as {
          exports: Record<string, unknown>
        }
      ).exports,
    ),
  )

  const list = await run(["takeover"])
  const names = (list.err + list.out)
    .split("Components:")[1]
    ?.split("\n")[1]
    ?.split(",")
    .map((name) => name.trim())
    .filter(Boolean)

  expect(
    (names?.length ?? 0) > 10,
    `found only ${names?.length ?? 0} components to take over`,
  )

  const folder = await mkdtemp(join(tmpdir(), "lotek-takeover-"))

  for (const name of names ?? []) {
    const { code } = await run([
      "takeover",
      name,
      `--out=${join(folder, name)}`,
    ])
    expect(code === 0, `takeover ${name} exited with code ${code}`)

    const copyFolder = join(folder, name, name)
    const read = await run([
      "check",
      `--manifest=${join(copyFolder, "lotek-manifest.json")}`,
      join(copyFolder, `${(await readdir(copyFolder))[0]}`),
    ])
    expect(
      !read.err.includes("cannot be read as a manifest") &&
        !read.err.includes("Manifest not found"),
      `the fragment for ${name} could not be read: ${read.err.slice(0, 200)}`,
    )
    for (const file of await readdir(copyFolder)) {
      const content = await readFile(join(copyFolder, file), "utf8")

      for (const match of content.matchAll(
        /(?:from|@import)\s+["']([^"']+)["']/g,
      )) {
        const path = match[1] as string

        expect(
          !path.startsWith("../"),
          `${name}/${file} points out of the folder with "${path}", which does not exist for the consumer`,
        )

        if (!path.startsWith("@lo-tek/interfaces")) continue

        const subpath = `.${path.slice("@lo-tek/interfaces".length)}`
        expect(
          exported.has(subpath),
          `${name}/${file} points to "${path}", which is not in exports`,
        )
      }
    }
  }

  await rm(folder, { recursive: true, force: true })
}

// Takes over a component, and rewrites the references out of the folder
{
  const folder = await mkdtemp(join(tmpdir(), "lotek-cli-"))

  const { code, err } = await run([
    "takeover",
    "button",
    `--out=${join(folder, "ui")}`,
  ])

  const files = await readdir(join(folder, "ui/button"))
  const source = await readFile(join(folder, "ui/button/button.ts"), "utf8")

  expect(code === 0, `takeover button exited with code ${code}`)
  expect(
    files.includes("button.ts") && files.includes("button.css"),
    `the copy is missing files: ${files.join(", ")}`,
  )
  expect(
    !files.some((file) => file.includes(".test.")),
    "the tests came along in the copy",
  )
  expect(
    source.includes('from "@lo-tek/interfaces/shared"'),
    "the reference out of the folder was not rewritten",
  )
  expect(
    err.includes("is now yours"),
    "the output does not say the copy is the consumer's responsibility",
  )

  // The copy has a new name, and a fragment of the manifest with that name.
  expect(
    source.includes('"app-button"') && !source.includes('"lt-button"'),
    "the copy is still called lt-button",
  )
  const css = await readFile(join(folder, "ui/button/button.css"), "utf8")
  expect(
    css.includes(".app-button") && css.includes("var(--lt-"),
    "the style sheet did not get a new name, or lost the variables from the theme",
  )
  expect(
    files.includes("lotek-manifest.json"),
    "the fragment of the manifest was not written",
  )
  const fragment = `--manifest=${join(folder, "ui/button/lotek-manifest.json")}`
  const page = join(folder, "page.html")
  await writeFile(
    page,
    '<button class="app-button" data-variant="wrong">x</button>\n',
  )
  const withFragment = await run(["check", fragment, page])
  expect(
    withFragment.code !== 0 && withFragment.out.includes("data-variant"),
    "the check with the fragment did not see the mistake in the markup for the copy",
  )
  const withoutFragment = await run(["check", page])
  expect(
    withoutFragment.code === 0,
    "the check without the fragment should have left app-button alone",
  )
  const merged = await run(["manifest", fragment])
  expect(
    merged.code === 0 &&
      merged.out.includes('"app-button"') &&
      merged.out.includes('"lt-button"'),
    "manifest with the fragment does not have both the copy and LO-TEK's own classes",
  )
  const manifestFile = join(folder, "build/lotek/manifest.json")
  const written = await run(["manifest", fragment, `--out=${manifestFile}`])
  expect(
    written.code === 0 &&
      (await readFile(manifestFile, "utf8")) === `${merged.out}`,
    "manifest --out wrote something other than what is in standard output",
  )
  const wrongArgument = await run(["manifest", "form.html"])
  expect(
    wrongArgument.code !== 0 && wrongArgument.err.includes("form.html"),
    "manifest with a file instead of a flag was not reported",
  )
  const unknown = await run([
    "check",
    `--manifest=${join(folder, "does-not-exist.json")}`,
    page,
  ])
  expect(
    unknown.code !== 0 && unknown.err.includes("does-not-exist.json"),
    "a manifest that does not exist was not reported",
  )

  // The copy is not overwritten unless asked.
  await writeFile(join(folder, "ui/button/button.ts"), "// my own version\n")
  const again = await run(["takeover", "button", `--out=${join(folder, "ui")}`])
  const after = await readFile(join(folder, "ui/button/button.ts"), "utf8")

  expect(again.code !== 0, "a copy that already existed was overwritten")
  expect(
    after.startsWith("// my own version"),
    "the changes in the copy were lost",
  )

  const forced = await run([
    "takeover",
    "button",
    `--out=${join(folder, "ui")}`,
    "--overwrite=yes",
  ])
  const replaced = await readFile(join(folder, "ui/button/button.ts"), "utf8")

  expect(forced.code === 0, "--overwrite=yes did not work")
  expect(
    replaced.includes("BUTTON_CLASS"),
    "the copy was not replaced with --overwrite=yes",
  )

  await rm(folder, { recursive: true, force: true })
}

// With the style sheets, the check also reports what they do not style
{
  const folder = await mkdtemp(join(tmpdir(), "lotek-css-"))
  const page = join(folder, "page.html")
  await writeFile(
    page,
    '<button class="lt-button" data-variant="ghost">x</button>\n<div class="lt-card">y</div>\n',
  )
  await writeFile(join(folder, "app.css"), '@import "button.css";\n')
  await writeFile(join(folder, "button.css"), ".lt-button { }\n")

  const whole = await run([
    "check",
    `--css=${join(packageDir, "dist/lotek.css")}`,
    page,
  ])
  expect(
    whole.code === 0,
    `with all of lotek.css the page should have been clean: ${whole.out}${whole.err}`,
  )

  const partial = await run(["check", `--css=${join(folder, "app.css")}`, page])
  expect(
    partial.code !== 0 &&
      partial.out.includes('data-variant="ghost"') &&
      partial.out.includes("lt-card"),
    `a style sheet that styles only the button should have given two findings: ${partial.out}`,
  )

  const gone = await run(["check", `--css=${join(folder, "gone.css")}`, page])
  expect(
    gone.code !== 0 && gone.err.includes("gone.css"),
    "a style sheet that does not exist was not reported",
  )
  await rm(folder, { recursive: true, force: true })
}

// `@import` from a package follows `exports`, as a bundler does
{
  /*
   * The path in `@import "@lo-tek/interfaces/lotek.css"` is a name in
   * `exports`, not a file in the package: the file is in `dist/`. The check
   * looked it up as a file, found nothing and reported every class as
   * unstyled. The packages are in a `node_modules` above the style sheet, and
   * the command runs from another folder, so the lookup goes from the style
   * sheet and not from the working directory.
   */
  const folder = await mkdtemp(join(tmpdir(), "lotek-css-"))
  const lotek = join(folder, "node_modules/@lo-tek/interfaces")
  await cp(join(packageDir, "dist/lotek.css"), join(lotek, "dist/lotek.css"))
  await writeFile(
    join(lotek, "package.json"),
    JSON.stringify({
      name: "@lo-tek/interfaces",
      exports: { "./lotek.css": "./dist/lotek.css" },
    }),
  )
  // A conditions object, which packages with both `style` and `default` use.
  // The file is lotek.css again, so the page is clean only if it is found.
  const theme = join(folder, "node_modules/theme")
  await cp(join(packageDir, "dist/lotek.css"), join(theme, "lib/theme.css"))
  await writeFile(
    join(theme, "package.json"),
    JSON.stringify({
      name: "theme",
      exports: { "./theme.css": { style: "./lib/theme.css" } },
    }),
  )
  const styles = join(folder, "src/styles")
  await mkdir(styles, { recursive: true })
  await writeFile(
    join(styles, "app.css"),
    '@import "@lo-tek/interfaces/lotek.css";\n',
  )
  await writeFile(join(styles, "theme.css"), '@import "theme/theme.css";\n')
  // A pattern in `exports`, and a package imported by name alone.
  const star = join(folder, "node_modules/star")
  await cp(join(packageDir, "dist/lotek.css"), join(star, "dist/all.css"))
  await writeFile(
    join(star, "package.json"),
    JSON.stringify({ name: "star", exports: { "./*": "./dist/*" } }),
  )
  await writeFile(join(styles, "star.css"), '@import "star/all.css";\n')
  const bare = join(folder, "node_modules/bare")
  await cp(join(packageDir, "dist/lotek.css"), join(bare, "all.css"))
  await writeFile(
    join(bare, "package.json"),
    JSON.stringify({ name: "bare", exports: { ".": "./all.css" } }),
  )
  await writeFile(join(styles, "bare.css"), '@import "bare";\n')
  const page = join(folder, "page.html")
  await writeFile(
    page,
    '<button class="lt-button" data-variant="ghost">x</button>\n<div class="lt-card">y</div>\n',
  )

  for (const sheet of ["app.css", "theme.css", "star.css", "bare.css"]) {
    for (const from of [folder, styles, tmpdir()]) {
      const answer = await run(
        ["check", `--css=${join(styles, sheet)}`, page],
        from,
      )
      expect(
        answer.code === 0,
        `@import from a package in ${sheet} was not followed, run from ${from}: ${answer.out}${answer.err}`,
      )
    }
  }

  // A relative path is a file, not a package. `../all.css` does not exist
  // next to the style sheet, and must not be found elsewhere in the project.
  await mkdir(join(folder, "src"), { recursive: true })
  await cp(join(packageDir, "dist/lotek.css"), join(folder, "all.css"))
  await writeFile(join(folder, "package.json"), "{}")
  await writeFile(join(styles, "relative.css"), '@import "../all.css";\n')
  const relative = await run([
    "check",
    `--css=${join(styles, "relative.css")}`,
    page,
  ])
  expect(
    relative.code !== 0,
    "a relative @import that does not exist was taken from elsewhere in the project",
  )
  await rm(folder, { recursive: true, force: true })
}

// The brand colours have a digit in the flag name, and were read as file names
{
  const without = await run(["theme", "--accent=#7c3aed"])
  const withBrand = await run(["theme", "--accent=#7c3aed", "--brand1=#aa3366"])

  expect(withBrand.code === 0, `--brand1 exited with code ${withBrand.code}`)
  expect(
    withBrand.out.includes("--lt-color-brand1-fill") &&
      withBrand.out !== without.out,
    "--brand1 did not change the theme",
  )
}

// A flag without an equals sign stops, rather than writing to the default folder
{
  const folder = await mkdtemp(join(tmpdir(), "lotek-takeover-"))
  const { code, err } = await run([
    "takeover",
    "button",
    "--out",
    join(folder, "ui"),
  ])

  expect(
    code !== 0,
    "takeover with --out without an equals sign should give an error code",
  )
  expect(
    err.includes("--out") && err.includes("="),
    "the error message does not say that --out has no value",
  )
  await rm(folder, { recursive: true, force: true })
}

// The same goes for theme after a recipe file. `--out theme.css` was read as
// two more file names, the theme went to standard output and no file was
// written, and `--accent #f00` quietly disappeared behind the colour in the
// file.
{
  const folder = await mkdtemp(join(tmpdir(), "lotek-theme-"))
  const recipe = join(folder, "recipe.json")
  await writeFile(recipe, JSON.stringify({ accent: "#7c3aed" }))
  const theme = join(folder, "theme.css")

  for (const [flag, value] of [
    ["--out", theme],
    ["--accent", "#ff0000"],
  ] as const) {
    const { code, out, err } = await run(["theme", recipe, flag, value])
    expect(
      code === 1,
      `theme with ${flag} without an equals sign should give an error code, gave ${code}`,
    )
    expect(
      out === "",
      `theme with ${flag} without an equals sign wrote a theme anyway`,
    )
    expect(
      err.includes(`"${flag}" has no value`),
      `the error message does not say that ${flag} has no value: ${err}`,
    )
  }
  expect(
    !(await readFile(theme).then(
      () => true,
      () => false,
    )),
    "theme wrote a file even though --out had no equals sign",
  )

  const two = await run(["theme", recipe, recipe])
  expect(two.code === 1, `theme with two recipes should give an error code`)
  expect(
    two.err.includes("one recipe"),
    `theme with two recipes did not say what was wrong: ${two.err}`,
  )
  await rm(folder, { recursive: true, force: true })
}

// An unknown flag with an equals sign also stops takeover and agent.
// `--outt=` put the copy quietly in the default folder, and `--framwork=`
// gave the templates rulebook.
{
  const folder = await mkdtemp(join(tmpdir(), "lotek-takeover-"))
  const takeover = await run(["takeover", "button", "--outt=src/ui"], folder)
  expect(takeover.code === 1, `takeover with --outt should give an error code`)
  expect(
    takeover.err.includes("Unknown flag: --outt"),
    `takeover with --outt did not say the flag is unknown: ${takeover.err}`,
  )
  expect(
    (await readdir(folder)).length === 0,
    "takeover with an unknown flag wrote a copy anyway",
  )

  const agent = await run(["agent", "--framwork=react"], folder)
  expect(agent.code === 1, `agent with --framwork should give an error code`)
  expect(
    agent.out === "" && agent.err.includes("Unknown flag: --framwork"),
    `agent with --framwork did not say the flag is unknown: ${agent.err}`,
  )
  await rm(folder, { recursive: true, force: true })
}

// Says which components exist when the name is unknown
{
  const { code, err } = await run(["takeover", "buton"])

  expect(code !== 0, "an unknown component name should give an error code")
  expect(
    err.includes("buton") && err.includes("button"),
    "the error message does not list the components that exist",
  )
}

// Prints the help without arguments, and when someone asks for it
for (const args of [[], ["--help"], ["-h"], ["help"]]) {
  const { code, out } = await run(args)

  expect(
    code === 0,
    `"${args[0] ?? "without arguments"}" exited with code ${code}`,
  )
  expect(
    out.includes("takeover") && out.includes("theme"),
    `the help does not mention both commands: ${out.slice(0, 80)}`,
  )
}

// The old Norwegian verbs and help flags are gone, not kept as aliases
for (const old of [
  "sjekk",
  "sjekk-tema",
  "overta",
  "tema",
  "hjelp",
  "--hjelp",
]) {
  const { code } = await run([old])
  expect(code === 1, `"${old}" should be an unknown command, gave code ${code}`)
}

// Says so about an unknown command instead of reading it as a file name
{
  const { code, err } = await run(["build"])

  expect(code !== 0, "an unknown command should give an error code")
  expect(
    err.includes("build") && !err.includes("ENOENT"),
    `the error message is a stack trace instead of an explanation: ${err.slice(0, 80)}`,
  )
}

// Says so about a theme file that does not exist, or is not JSON
{
  const gone = await run(["theme", "does-not-exist.json"])

  expect(
    gone.code !== 0,
    "a theme file that does not exist should give an error code",
  )
  expect(
    gone.err.includes("does-not-exist.json") && !gone.err.includes("ENOENT"),
    `the error message is a stack trace: ${gone.err.slice(0, 80)}`,
  )

  const folder = await mkdtemp(join(tmpdir(), "lotek-cli-"))
  const path = join(folder, "invalid.json")
  await writeFile(path, "{not json")

  const invalid = await run(["theme", path])

  expect(invalid.code !== 0, "invalid JSON should give an error code")
  expect(
    invalid.err.includes("JSON"),
    `the error message does not say the file is not JSON: ${invalid.err.slice(0, 80)}`,
  )

  // The file is read as `JSON.parse` reads it, as the TypeScript version did:
  // numbers and strings that are not JSON are rejected, at a lower level too.
  for (const [name, text] of [
    ["a leading zero", '{"typography":{"weights":{"bold":0700}}}'],
    ["a trailing point", '{"typography":{"lineHeights":{"default":1.}}}'],
    ["a control character", '{"accent":"#7c3aed\u0001"}'],
    ["deep nesting", `{"shape":${"[".repeat(100_000)}`],
  ]) {
    await writeFile(path, text)
    const answer = await run(["theme", path])
    expect(
      answer.code === 1 && answer.err.includes("is not valid JSON"),
      `a recipe with ${name} should have been invalid JSON, gave ${answer.code}: ${answer.err.slice(0, 120)}`,
    )
  }

  // When a key appears twice, the last one wins, as in `JSON.parse`.
  await writeFile(path, '{"accent":"#ff0000","accent":"#0000ff"}')
  const twice = await run(["theme", path])
  const blue = await run(["theme", "--accent=#0000ff"])
  expect(
    twice.code === 0 && twice.out === blue.out,
    "a key that appears twice in the recipe did not get the last value",
  )

  await rm(folder, { recursive: true, force: true })
}

// `check`: files that match give 0, one finding gives 1 with file, line and column
{
  const folder = await mkdtemp(join(tmpdir(), "lotek-cli-"))
  const right = join(folder, "right.html")
  const wrong = join(folder, "wrong.html")
  await writeFile(
    right,
    `<lt-field id="f"><label for="name">Name</label><input class="lt-input" name="name" id="name"></lt-field>\n`,
  )
  await writeFile(
    wrong,
    `<p>Hello</p>\n<button class="lt-buton">Save</button>\n<lt-dialog-header>Title</lt-dialog-header>\n`,
  )

  const clean = await run(["check", right])
  expect(
    clean.code === 0,
    `check of right markup exited with code ${clean.code}`,
  )
  expect(
    clean.out.includes("The markup matches LO-TEK in 1 file."),
    `check does not say the markup matches: ${clean.out}`,
  )

  const found = await run(["check", wrong, right])
  expect(found.code === 1, `check with findings exited with code ${found.code}`)
  expect(
    found.out.includes(`${wrong}:2:`) && found.out.includes("lt-buton"),
    `the finding is not given with file and line: ${found.out.slice(0, 160)}`,
  )
  expect(
    found.out.includes(`${wrong}:3:`) && found.out.includes("lt-dialog-header"),
    "the element that does not exist was not reported on line 3",
  )
  expect(
    /: (warning|error): /.test(found.out),
    `the findings have no severity label: ${found.out.slice(0, 160)}`,
  )
  expect(
    found.err.includes("2 findings in 2 files."),
    `the summary does not count the findings and files: ${found.err}`,
  )
  expect(!found.out.includes("right.html:"), "the right file got a finding")

  // From standard input, the way a test in an app sends the HTML the server makes
  const child = Bun.spawn([...COMMAND, "check"], {
    env: ENVIRONMENT,
    stdin: new Blob([`<lt-popover placemnet="top-start"></lt-popover>`]),
    stdout: "pipe",
    stderr: "pipe",
  })
  runCount += 1
  const [stdinOut, stdinCode] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
  ])
  expect(
    stdinCode === 1,
    `check from standard input exited with code ${stdinCode}`,
  )
  expect(
    stdinOut.includes("stdin:1:") && stdinOut.includes("placement"),
    `the finding from standard input is missing: ${stdinOut.slice(0, 120)}`,
  )

  const gone = await run([
    "check",
    join(folder, "does-not-exist.html"),
    join(folder, "nor-this.html"),
  ])
  expect(
    gone.code === 1,
    "a file that does not exist should give an error code",
  )
  expect(
    gone.err.includes("File not found") &&
      gone.err.includes("does-not-exist.html") &&
      gone.err.includes("nor-this.html"),
    "both missing files should have been named",
  )

  // Empty standard input is not markup that matches: a glob without matches
  // or a test that forgot to send anything must not pass.
  const empty = Bun.spawn([...COMMAND, "check"], {
    env: ENVIRONMENT,
    stdin: new Blob([""]),
    stdout: "pipe",
    stderr: "pipe",
  })
  runCount += 1
  const [emptyErr, emptyCode] = await Promise.all([
    new Response(empty.stderr).text(),
    empty.exited,
  ])
  expect(emptyCode === 1, `empty standard input exited with code ${emptyCode}`)
  expect(
    emptyErr.includes("standard input was empty"),
    "the error message does not say the input was empty",
  )

  // The same goes for files: if every file is empty, there is nothing to
  // check. One empty file among several, like an empty partial in a glob,
  // is not an error.
  const emptyFolder = await mkdtemp(join(tmpdir(), "lotek-empty-"))
  const emptyFile = join(emptyFolder, "empty.html")
  const blankFile = join(emptyFolder, "blank.html")
  const fullFile = join(emptyFolder, "full.html")
  await writeFile(emptyFile, "")
  await writeFile(blankFile, " \n\t\n")
  await writeFile(fullFile, '<button class="lt-button">Save</button>')
  for (const files of [[emptyFile], [blankFile], [emptyFile, blankFile]]) {
    const { code, err } = await run(["check", ...files])
    expect(
      code === 1,
      `check of only empty files exited with code ${code}: ${files.join(" ")}`,
    )
    expect(
      err.includes("No markup to check"),
      `check of only empty files did not say there was nothing to check: ${err}`,
    )
  }
  const mixed = await run(["check", emptyFile, fullFile])
  expect(
    mixed.code === 0,
    `one empty file among several gave code ${mixed.code}: ${mixed.err}`,
  )

  // A leading BOM does not count as a column, as the editor shows the line.
  // That goes for a file, standard input and a page the host has fetched.
  const bomFile = join(emptyFolder, "bom.html")
  const bomPage = '﻿<span class="lt-buton">x</span>\n'
  await writeFile(bomFile, bomPage)
  const bom = await run(["check", bomFile])
  expect(
    bom.out.includes(`${bomFile}:1:14:`),
    `a file with a BOM got the wrong column: ${bom.out}`,
  )
  const bomIn = Bun.spawn([...COMMAND, "check"], {
    env: ENVIRONMENT,
    stdin: new Blob([bomPage]),
    stdout: "pipe",
    stderr: "pipe",
  })
  runCount += 1
  const [bomInOut] = await Promise.all([
    new Response(bomIn.stdout).text(),
    bomIn.exited,
  ])
  expect(
    bomInOut.includes("stdin:1:14:"),
    `standard input with a BOM got the wrong column: ${bomInOut}`,
  )
  const fetchedFile = join(emptyFolder, "fetched.txt")
  await writeFile(
    fetchedFile,
    `http://localhost:1/bom\n200\ntext/html\n${bomPage}`,
  )
  const fetched = await run(["check", `--fetched=${fetchedFile}`])
  expect(
    fetched.out.includes("http://localhost:1/bom:1:14:"),
    `a fetched page with a BOM got the wrong column: ${fetched.out}`,
  )
  await writeFile(fetchedFile, "http://localhost:1/bom\n200\ntext/html\n﻿")
  const onlyBom = await run(["check", `--fetched=${fetchedFile}`])
  expect(
    onlyBom.code === 1 && onlyBom.err.includes("answered with an empty page"),
    `a fetched page with only a BOM was not reported as empty: ${onlyBom.err}`,
  )
  await rm(emptyFolder, { recursive: true, force: true })

  // A pipe where the writer takes its time, like `curl … | lotek check`. A
  // synchronous read of fd 0 threw EAGAIN here after `process.stdin` had been
  // touched, since the stream then puts the pipe in non-blocking mode. The
  // chunks are split in the middle of `ü`: read as a `Buffer`, each half
  // became a replacement character, and the finding quoted "lt-b��tton". The
  // first chunk is written before the pause, so the child must read twice
  // however busy the machine is.
  const bytes = new TextEncoder().encode(
    `<button class="lt-bütton">Save</button>`,
  )
  const cut = bytes.indexOf(0xc3) + 1
  // Without a ü to split, the first chunk is empty, and the case passes
  // silently.
  expect(cut > 0, "the text in the slow pipe has no ü to split")
  const slow = Bun.spawn([...COMMAND, "check"], {
    env: ENVIRONMENT,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  runCount += 1
  slow.stdin.write(bytes.slice(0, cut))
  await Bun.sleep(300)
  slow.stdin.write(bytes.slice(cut))
  slow.stdin.end()
  const [slowOut, slowErr, slowCode] = await Promise.all([
    new Response(slow.stdout).text(),
    new Response(slow.stderr).text(),
    slow.exited,
  ])
  expect(
    slowCode === 1 &&
      slowOut.includes("stdin:1:") &&
      slowOut.includes("lt-bütton"),
    `a slow pipe did not give the finding with the whole text: code ${slowCode}, ${(slowOut + slowErr).slice(0, 120)}`,
  )
  expect(!slowErr.includes("EAGAIN"), "reading standard input threw EAGAIN")

  await rm(folder, { recursive: true, force: true })
}

// `agent`: the rulebook to standard output, the message to standard error,
// and no file written
{
  const folder = await mkdtemp(join(tmpdir(), "lotek-agent-"))
  const rulebook = (name: string) =>
    readFile(join(packageDir, `agent/${name}.md`), "utf8")

  // Without package.json the markup comes from the server, and the
  // templates rulebook is the right one.
  const templates = await run(["agent"], folder)

  expect(
    templates.code === 0,
    `agent without package.json exited with code ${templates.code}`,
  )
  expect(
    templates.out === (await rulebook("templates")),
    `agent without package.json did not give the templates rulebook: ${templates.out.slice(0, 60)}`,
  )
  expect(
    templates.err.includes("templates") &&
      templates.err.includes("no package.json"),
    `the reason for the choice is not in standard error: ${templates.err.slice(0, 80)}`,
  )
  // The whole point of the message going to standard error: standard output
  // can be piped cleanly.
  expect(
    !templates.out.includes("no package.json in this folder"),
    "the message about the choice ended up in standard output, which then cannot be piped cleanly",
  )
  // The command must not have touched the folder it ran in.
  expect(
    (await readdir(folder)).length === 0,
    "agent wrote a file in the working directory; it must never write anything",
  )

  // The dependencies decide, and the outcomes are different rulebooks.
  const detected: [Record<string, string>, string][] = [
    [{ react: "19.0.0" }, "react"],
    [{ vue: "3.5.0" }, "bundles"],
    [{ astro: "6.0.0" }, "astro"],
    // A package.json means a build step, and then the style sheets are
    // imported.
    [{ typescript: "6.0.0" }, "bundles"],
  ]

  for (const [dependencies, name] of detected) {
    await writeFile(
      join(folder, "package.json"),
      JSON.stringify({ dependencies }),
    )
    const answer = await run(["agent"], folder)

    expect(answer.code === 0, `agent with ${name} gave code ${answer.code}`)
    expect(
      answer.out === (await rulebook(name)),
      `${Object.keys(dependencies)[0]} did not give the ${name} rulebook: ${answer.out.slice(0, 50)}`,
    )
  }

  // An Astro app with React islands has both, and Astro decides the style
  // sheets.
  await writeFile(
    join(folder, "package.json"),
    JSON.stringify({ dependencies: { astro: "6.0.0", react: "19.0.0" } }),
  )
  const both = await run(["agent"], folder)

  expect(
    both.out === (await rulebook("astro")),
    "astro lost to react, but it decides how the style sheets come in",
  )

  // A JVM build file means the markup comes from Kotlin or Java. A
  // framework in package.json still decides, since it renders the markup,
  // but `vite` and a package.json that names nothing do not: a Kotlin server
  // often has one for its assets.
  const jvm: [string, Record<string, string> | null, string][] = [
    ["build.gradle.kts", null, "kotlin"],
    ["build.gradle", null, "kotlin"],
    ["pom.xml", null, "kotlin"],
    // A Gradle build with several modules, with only the settings file at
    // its root.
    ["settings.gradle.kts", null, "kotlin"],
    ["settings.gradle", null, "kotlin"],
    ["build.gradle.kts", { vite: "8.0.0" }, "kotlin"],
    ["build.gradle.kts", { typescript: "6.0.0" }, "kotlin"],
    ["build.gradle.kts", { react: "19.0.0" }, "react"],
  ]

  for (const [file, dependencies, name] of jvm) {
    const project = await mkdtemp(join(tmpdir(), "lotek-agent-jvm-"))
    await writeFile(join(project, file), "")
    if (dependencies)
      await writeFile(
        join(project, "package.json"),
        JSON.stringify({ dependencies }),
      )
    const answer = await run(["agent"], project)
    const what = `${file}${dependencies ? ` with ${Object.keys(dependencies)[0]}` : ""}`

    expect(answer.code === 0, `agent with ${what} gave code ${answer.code}`)
    expect(
      answer.out === (await rulebook(name)),
      `${what} did not give the ${name} rulebook: ${answer.out.slice(0, 50)}`,
    )
    if (name === "kotlin")
      expect(
        answer.err.includes(file),
        `the message does not name ${file} as the reason: ${answer.err.slice(0, 80)}`,
      )
    await rm(project, { recursive: true, force: true })
  }

  // Vue, Svelte, Solid and Lit share a rulebook, and whoever writes their
  // framework's name should not have to know. The alias is still visible in
  // the message.
  const svelte = await run(["agent", "--framework=svelte"], folder)

  expect(svelte.code === 0, `--framework=svelte gave code ${svelte.code}`)
  expect(
    svelte.out === (await rulebook("bundles")),
    "svelte did not point to the bundles rulebook",
  )
  expect(
    svelte.err.includes("bundles") && svelte.err.includes("svelte"),
    `the message does not show that svelte became an alias: ${svelte.err.slice(0, 80)}`,
  )

  const unknown = await run(["agent", "--framework=kohana"], folder)

  expect(unknown.code === 1, `an unknown name gave code ${unknown.code}`)
  expect(
    unknown.err.includes("kohana") && unknown.err.includes("bundles"),
    `an unknown name did not get the list of choices: ${unknown.err.slice(0, 80)}`,
  )

  // The flag beats the detection: astro and react are still in package.json
  // here.
  const html = await run(["agent", "--framework=html"], folder)

  expect(html.code === 0, `--framework=html exited with code ${html.code}`)
  expect(
    html.out === (await rulebook("html")),
    "--framework=html did not override the detection",
  )
  // The rulebook must be the rulebook, not an empty file that looks right.
  for (const part of ["lotek.css", "data-variant", "defineLtField"]) {
    expect(html.out.includes(part), `the rulebook does not mention ${part}`)
  }

  // The markup in the rulebooks must pass LO-TEK's own check. An agent
  // instruction with an example the check would reject is worse than no
  // instruction.
  // Every rulebook the package ships, read from the list the command itself
  // reads. A hand-written list here left a new rulebook unchecked.
  const books: string[] = JSON.parse(
    await readFile(join(packageDir, "manifest/files.json"), "utf8"),
  ).agent.map((name: string) => name.replace(/\.md$/, ""))
  expect(books.length > 0, "manifest/files.json lists no rulebooks")

  for (const framework of books) {
    const book = await run(["agent", `--framework=${framework}`], folder)
    const blocks = [...book.out.matchAll(/```html\n([\s\S]*?)```/g)]

    for (const [number, block] of blocks.entries()) {
      const attempt = Bun.spawn([...COMMAND, "check"], {
        env: ENVIRONMENT,
        stdin: new Blob([block[1]]),
        stdout: "pipe",
        stderr: "pipe",
      })
      runCount += 1
      const [out, code] = await Promise.all([
        new Response(attempt.stdout).text(),
        attempt.exited,
      ])

      expect(
        code === 0,
        `example ${number + 1} in the ${framework} rulebook does not match LO-TEK: ${out.slice(0, 120)}`,
      )
    }
  }

  await rm(folder, { recursive: true, force: true })
}

// An address is fetched and checked as a whole page
{
  const page =
    '<!doctype html><html lang="en"><body><label for="nowhere">Name</label><button class="lt-buton">Save</button></body></html>'
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname
      const html = { "content-type": "text/html; charset=utf-8" }
      if (path === "/page") return new Response(page, { headers: html })
      if (path === "/onwards")
        return new Response(null, {
          status: 302,
          headers: { location: "/page" },
        })
      if (path === "/chunks")
        return new Response(
          new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder()
              controller.enqueue(encoder.encode(page.slice(0, 40)))
              controller.enqueue(encoder.encode(page.slice(40)))
              controller.close()
            },
          }),
          { headers: html },
        )
      if (path === "/json") return Response.json({ ok: true })
      if (path === "/empty") return new Response("", { headers: html })
      if (path === "/bom")
        return new Response(
          new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(page)]),
          { headers: html },
        )
      return new Response("<p>Not found</p>", { status: 404, headers: html })
    },
  })
  const root = `http://localhost:${server.port}`

  for (const path of ["/page", "/onwards", "/chunks", "/bom"]) {
    const { code, out } = await run(["check", `${root}${path}`])
    expect(
      code === 1,
      `${path} should give an error code for the findings, gave ${code}`,
    )
    expect(
      out.includes(`${root}${path}:1:`) && out.includes("lt-buton"),
      `${path}: the class that does not exist was not reported with the address: ${out.slice(0, 160)}`,
    )
    expect(
      out.includes("nowhere"),
      `${path}: the page was not checked as a whole page, the for wiring is missing: ${out.slice(0, 200)}`,
    )
  }

  // A leading BOM does not add a column: the findings are the same as without.
  const withoutBom = await run(["check", `${root}/page`])
  const withBom = await run(["check", `${root}/bom`])
  expect(
    withBom.out.replaceAll("/bom", "/page") === withoutBom.out,
    `a page with a BOM gave other positions than without: ${withBom.out.slice(0, 200)}`,
  )

  const json = await run(["check", `${root}/json`])
  expect(
    json.code === 1,
    "an address that answers JSON should give an error code",
  )
  expect(json.err.includes("not HTML"), `JSON was not rejected: ${json.err}`)

  // A page that rendered empty must not pass without having checked anything.
  const empty = await run(["check", `${root}/empty`])
  expect(
    empty.code === 1,
    `an empty page should give an error code, gave ${empty.code}`,
  )
  expect(
    empty.err.includes(`${root}/empty answered with an empty page.`),
    `an empty page was not reported: ${empty.err}`,
  )

  const gone = await run(["check", `${root}/gone`])
  expect(gone.code === 1, "a 404 should give an error code")
  expect(gone.err.includes("answered 404"), `404 was not reported: ${gone.err}`)

  server.stop(true)
  const nobody = await run(["check", root])
  expect(
    nobody.code === 1,
    "an address where nobody answers should give an error code",
  )
  expect(
    nobody.err.includes(`Could not reach ${root}`),
    `an address where nobody answers was not reported: ${nobody.err}`,
  )
}

if (differences.length > 0) {
  console.error(
    `${differences.length} runs answered differently from ${COMPARE}:\n\n${differences.map((d) => `  ${d}`).join("\n\n")}\n`,
  )
  process.exit(1)
}

if (failures.length > 0) {
  console.error(
    `The command line tool does not behave as promised:\n\n${failures
      .map((line) => `  ${line}`)
      .join("\n")}\n`,
  )
  process.exit(1)
}

console.log(`The command line tool answers as it should on ${runCount} runs.`)
