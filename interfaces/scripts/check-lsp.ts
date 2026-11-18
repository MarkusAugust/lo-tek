/**
 * Tests the language server, `lotek lsp`, over real standard input and
 * output, the way an editor talks to it.
 *
 * The default is the built CLI in the package, run with Node. `LOTEK_CLI`
 * points at another one, like the executable from `cli` or
 * `["java", "-jar", "lotek.jar"]`, so the same assertions are tested against
 * every host. The VS Code extension is tested with
 * `["node", "vscode/dist/server.js"]`.
 *
 * Run with: bun scripts/check-lsp.ts
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const packageRoot = fileURLToPath(new URL("..", import.meta.url))

// The package for the executable, which has no host to set it.
// Explicit, since `Bun.spawn` does not inherit changes to `process.env`.
const ENVIRONMENT = {
  ...process.env,
  LOTEK_PACKAGE: process.env.LOTEK_PACKAGE ?? packageRoot,
}
const COMMAND: string[] = process.env.LOTEK_CLI
  ? process.env.LOTEK_CLI.startsWith("[")
    ? JSON.parse(process.env.LOTEK_CLI)
    : [process.env.LOTEK_CLI]
  : ["node", join(packageRoot, "dist/cli.js")]

type Message = {
  id?: number
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { code: number; message: string }
}

const failures: string[] = []
function expect(assertion: boolean, description: string): void {
  if (!assertion) failures.push(description)
}

/** One session with the server: send messages, and wait for what it answers. */
async function session(workingDirectory: string) {
  const child = Bun.spawn([...COMMAND, "lsp"], {
    env: ENVIRONMENT,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    cwd: workingDirectory,
  })
  const received: Message[] = []
  const pending: {
    matches: (m: Message) => boolean
    resolve: (m: Message) => void
  }[] = []

  // Reads the frames: the headers, an empty line and then `Content-Length` bytes of JSON.
  void (async () => {
    let buffer = new Uint8Array(0)
    const decoder = new TextDecoder()
    for await (const chunk of child.stdout) {
      const joined = new Uint8Array(buffer.length + chunk.length)
      joined.set(buffer)
      joined.set(chunk, buffer.length)
      buffer = joined
      for (;;) {
        const text = decoder.decode(buffer)
        const end = text.indexOf("\r\n\r\n")
        if (end < 0) break
        const length = Number(
          /Content-Length:\s*(\d+)/i.exec(text.slice(0, end))?.[1],
        )
        const start = new TextEncoder().encode(text.slice(0, end + 4)).length
        if (buffer.length < start + length) break
        const message = JSON.parse(
          decoder.decode(buffer.slice(start, start + length)),
        ) as Message
        buffer = buffer.slice(start + length)
        received.push(message)
        const hit = pending.findIndex((v) => v.matches(message))
        if (hit >= 0) pending.splice(hit, 1)[0].resolve(message)
      }
    }
  })()

  const send = (message: Record<string, unknown>) => {
    const text = JSON.stringify({ jsonrpc: "2.0", ...message })
    child.stdin.write(
      `Content-Length: ${new TextEncoder().encode(text).length}\r\n\r\n${text}`,
    )
    child.stdin.flush()
  }
  const waitFor = (matches: (m: Message) => boolean, what: string) =>
    new Promise<Message>((resolve, reject) => {
      const found = received.find(matches)
      if (found) return resolve(found)
      const timer = setTimeout(
        () => reject(new Error(`waited in vain for ${what}`)),
        20000,
      )
      pending.push({
        matches,
        resolve: (m) => {
          clearTimeout(timer)
          resolve(m)
        },
      })
    })
  const diagnostics = (uri: string, version: number) =>
    waitFor(
      (m) =>
        m.method === "textDocument/publishDiagnostics" &&
        m.params?.uri === uri &&
        received.filter((n) => n.params?.uri === uri).length >= version,
      `diagnostics number ${version} for ${uri}`,
    )
  return { child, send, waitFor, diagnostics, received }
}

const root = await mkdtemp(join(tmpdir(), "lotek-lsp-"))
try {
  const s = await session(root)
  s.send({
    id: 1,
    method: "initialize",
    params: {
      processId: null,
      rootUri: pathToFileURL(root).href,
      capabilities: {},
    },
  })
  const start = await s.waitFor((m) => m.id === 1, "the answer to initialize")
  const capabilities = (
    start.result as { capabilities: Record<string, unknown> }
  ).capabilities
  expect(
    capabilities.positionEncoding === "utf-16",
    "the server does not say the positions are UTF-16",
  )
  expect(
    capabilities.codeActionProvider !== undefined,
    "the server does not offer quick fixes",
  )
  s.send({ method: "initialized", params: {} })

  // A document with a typo, after characters that are two UTF-16 units each.
  const uri = pathToFileURL(join(root, "form.html")).href
  s.send({
    method: "textDocument/didOpen",
    params: {
      textDocument: {
        uri,
        languageId: "html",
        version: 1,
        text: '<p>🧾</p>\n<button class="lt-buton">Send</button>',
      },
    },
  })
  const first = (await s.diagnostics(uri, 1)).params as {
    diagnostics: {
      range: { start: { line: number; character: number } }
      code: string
      message: string
    }[]
  }
  expect(
    first.diagnostics.length === 1,
    `expected one finding, got ${first.diagnostics.length}`,
  )
  expect(
    first.diagnostics[0]?.code === "unknown-class",
    "the finding does not have the rule id as its code",
  )
  expect(
    first.diagnostics[0]?.range.start.line === 1 &&
      first.diagnostics[0]?.range.start.character === 15,
    `the finding is in the wrong place: ${JSON.stringify(first.diagnostics[0]?.range)}`,
  )

  s.send({
    id: 2,
    method: "textDocument/codeAction",
    params: {
      textDocument: { uri },
      range: {
        start: { line: 1, character: 17 },
        end: { line: 1, character: 17 },
      },
      context: { diagnostics: first.diagnostics },
    },
  })
  const fixes = (await s.waitFor((m) => m.id === 2, "the quick fixes"))
    .result as {
    title: string
    edit: { changes: Record<string, { newText: string }[]> }
  }[]
  expect(
    fixes[0]?.title === "Change to lt-button",
    `wrong fix: ${fixes[0]?.title}`,
  )
  expect(
    fixes[0]?.edit.changes[uri]?.[0]?.newText === "lt-button",
    "the fix does not change it to lt-button",
  )

  s.send({
    method: "textDocument/didChange",
    params: {
      textDocument: { uri, version: 2 },
      contentChanges: [{ text: '<button class="lt-button">Send</button>' }],
    },
  })
  const second = (await s.diagnostics(uri, 2)).params as {
    diagnostics: unknown[]
  }
  expect(
    second.diagnostics.length === 0,
    "the finding remained after it was fixed",
  )

  // A manifest in the workspace applies from the next check, without a restart.
  await mkdir(join(root, "build/lotek"), { recursive: true })
  const manifest = Bun.spawnSync(
    ["node", join(packageRoot, "dist/cli.js"), "manifest"],
    {
      cwd: root,
    },
  ).stdout.toString()
  const withCopy = JSON.parse(manifest)
  withCopy.classes["app-button"] = {
    component: "button",
    title: "Button",
    link: "",
    attributes: {},
  }
  await writeFile(
    join(root, "build/lotek/manifest.json"),
    JSON.stringify(withCopy),
  )
  s.send({
    method: "textDocument/didChange",
    params: {
      textDocument: { uri, version: 3 },
      contentChanges: [
        { text: '<button class="app-button app-button--x">Send</button>' },
      ],
    },
  })
  const third = (await s.diagnostics(uri, 3)).params as {
    diagnostics: { message: string }[]
  }
  expect(
    third.diagnostics.length === 1 &&
      third.diagnostics[0].message.includes("app-button--x"),
    `the manifest in build/lotek was not read: ${JSON.stringify(third.diagnostics)}`,
  )

  // Completion and hover read the same manifest as the check: the class the
  // project took over is suggested, and what is suggested is not underlined.
  s.send({
    id: 5,
    method: "textDocument/completion",
    params: { textDocument: { uri }, position: { line: 0, character: 15 } },
  })
  const suggested = (
    await s.waitFor((m) => m.id === 5, "the answer to completion")
  ).result as { label: string; textEdit: { newText: string } }[]
  expect(
    suggested.some((item) => item.label === "app-button") &&
      suggested.some((item) => item.label === "lt-button"),
    `completion does not suggest app-button and lt-button: ${suggested.length} suggestions`,
  )
  expect(
    suggested.every((item) => item.textEdit.newText === item.label),
    "a suggestion does not write its own label",
  )
  s.send({
    id: 6,
    method: "textDocument/hover",
    params: { textDocument: { uri }, position: { line: 0, character: 18 } },
  })
  const hovered = (await s.waitFor((m) => m.id === 6, "the answer to hover"))
    .result as { contents: { kind: string; value: string } } | null
  expect(
    hovered?.contents.kind === "markdown" &&
      hovered.contents.value.startsWith("**Button**"),
    `hover does not say what app-button is: ${JSON.stringify(hovered)}`,
  )

  s.send({
    id: 3,
    method: "textDocument/definition",
    params: { textDocument: { uri }, position: { line: 0, character: 0 } },
  })
  const unknown = await s.waitFor(
    (m) => m.id === 3,
    "the answer to a request the server does not support",
  )
  expect(
    unknown.error?.code === -32601,
    "an unknown request did not get the error code for an unknown method",
  )

  s.send({ id: 4, method: "shutdown" })
  await s.waitFor((m) => m.id === 4, "the answer to shutdown")
  s.send({ method: "exit" })
  const code = await Promise.race([
    s.child.exited,
    Bun.sleep(20000).then(() => "timeout"),
  ])
  expect(code === 0, `the server exited with ${code} after shutdown and exit`)
} catch (error) {
  failures.push(String(error))
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error(
    `✗ The language server (${COMMAND.join(" ")}):\n\n${failures.map((f) => `  ${f}`).join("\n")}\n`,
  )
  process.exit(1)
}
console.log(`The language server answers as it should (${COMMAND.join(" ")}).`)
