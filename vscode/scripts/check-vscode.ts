/**
 * The extension in a real VS Code: downloads VS Code, starts it with the
 * extension, and runs `test/suite.cjs` inside it. That tests the connection
 * to the language server, which no other test sees.
 *
 * Needs a network and a display, so in CI it runs under `xvfb-run`.
 *
 * Run with: bun run build && xvfb-run -a bun scripts/check-vscode.ts
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { downloadAndUnzipVSCode, runTests } from "@vscode/test-electron"

const extensionDir = fileURLToPath(new URL("..", import.meta.url))
/*
 * The lowest version the extension promises to work on, `engines.vscode`, or
 * `LOTEK_VSCODE` when it is set. The weekly workflow `vscode-stable.yml`
 * sets it to `stable`, since the snippets rely on undocumented behaviour (see
 * `build-snippets.ts`) that a new VS Code could change without a word.
 */
const VERSION =
  // `||` and not `??`: a variable that is set but empty means the default.
  process.env.LOTEK_VSCODE ||
  (
    JSON.parse(readFileSync(join(extensionDir, "package.json"), "utf8")) as {
      engines: { vscode: string }
    }
  ).engines.vscode.replace(/^\^/, "")
console.log(`VS Code ${VERSION}`)

/*
 * The executable, resolved here rather than by the runner. On macOS VS Code
 * 1.143 renamed it in the app from `MacOS/Electron` to `MacOS/Code`, and
 * @vscode/test-electron 2.5.2 only knows the old name, so `stable` failed to
 * start with "ENOENT … MacOS/Electron" and exit -2. The path the runner gives
 * is kept when it exists, so the older versions and the other platforms are
 * untouched. When it does not, the name is read from the app's own
 * `Info.plist`, `CFBundleExecutable`, which is what macOS itself starts, so
 * Insiders and a later rename are covered too.
 */
function executableOf(downloaded: string): string {
  if (existsSync(downloaded) || process.platform !== "darwin") return downloaded
  const plist = join(dirname(downloaded), "..", "Info.plist")
  const name = existsSync(plist)
    ? /<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/.exec(
        readFileSync(plist, "utf8"),
      )?.[1]
    : undefined
  return name ? join(dirname(downloaded), name) : downloaded
}

/*
 * A folder of this run's own, for the user data and the suite's report.
 *
 * The user data stays out of the checkout: VS Code puts a Unix socket in it,
 * and a socket path longer than 103 characters, which a worktree under
 * .claude/worktrees/ gives, made the second run fail at startup with "Exit
 * code: 1" and no word about why. And it is per run, not a fixed path: VS
 * Code runs one instance per user data folder, so a second run against the
 * same folder would hand its arguments to the first and exit 0 without
 * having run the suite, and the settings the suite writes would persist.
 */
// `/tmp` and not `tmpdir()` outside Windows: on macOS `tmpdir()` is a
// `/var/folders/…` path, which left the socket path a few characters from the
// limit, and a longer version string would have pushed it over.
const runDir = mkdtempSync(
  join(process.platform === "win32" ? tmpdir() : "/tmp", "lotek-vscode-"),
)
const failureFile = join(runDir, "suite-failure.txt")
// The workspace the suite builds a manifest in.
const workspace = join(runDir, "workspace")
mkdirSync(workspace)
// Removed on every way out. On Ctrl-C the runner stops VS Code first, with
// its own listener, so no listener for the signal is added here; and VS
// Code may still be writing, so a folder that cannot be removed is left.
process.on("exit", () => {
  try {
    rmSync(runDir, { recursive: true, force: true })
  } catch {
    // Left for the next run of the temp folder's own cleanup.
  }
})

try {
  // Inside the `try`, so a failed download ends in the line below that says
  // what failed, and not in an unhandled rejection.
  const executable = executableOf(await downloadAndUnzipVSCode(VERSION))
  await runTests({
    vscodeExecutablePath: executable,
    // The extension, and a second one that only registers the language id
    // `blade`, so the suite can check the snippets in a template language
    // VS Code does not ship with. `--disable-extensions` leaves development
    // extensions loaded.
    extensionDevelopmentPath: [
      extensionDir,
      fileURLToPath(new URL("../test/fixture-blade", import.meta.url)),
    ],
    extensionTestsPath: fileURLToPath(
      new URL("../test/suite.cjs", import.meta.url),
    ),
    // The suite writes the assertion that failed here, since the runner only
    // says "Test run failed with code 1".
    extensionTestsEnv: { LOTEK_SUITE_FAILURE: failureFile },
    launchArgs: [
      workspace,
      "--disable-extensions",
      "--disable-workspace-trust",
      "--user-data-dir",
      join(runDir, "user-data"),
      // `--no-sandbox`, which CI needs because the container runs as root,
      // is passed by `runTests` itself, unconditionally, in every run.
    ],
  })
  console.log("The extension gives findings and fixes in VS Code.")
  // `runTests` leaves something behind that fails after VS Code has closed,
  // and Bun then exits with an error code. The answer has already been given.
  process.exit(0)
} catch (error) {
  console.error(`✗ The extension in VS Code: ${error}`)
  if (existsSync(failureFile)) console.error(readFileSync(failureFile, "utf8"))
  process.exit(1)
}
