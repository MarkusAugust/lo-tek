/**
 * The VS Code extension: it starts the language server, and that is all.
 *
 * The findings, the quick fixes, completion and hover all come from the
 * language server, `lotek lsp`, the same one Neovim and Helix use, written
 * in Rust and run as a WASI module (see `server.ts`). It reads the manifest
 * the project actually has, also with components taken over with `lotek
 * takeover`, so what is suggested is what is checked:
 *
 *   - inside `class="…"` the `lt-` classes are completed, and inside an
 *     attribute a class takes, like `data-variant` on `lt-button`, the values
 *     are. In languages other than HTML, where VS Code's own HTML service is
 *     not present, the `<lt-…>` elements, their attributes and their values
 *     are completed too;
 *   - hovering over an `lt-` class in a `class` attribute gives the
 *     component, the description and the link.
 *
 * In HTML and Handlebars files the `<lt-…>` elements come from VS Code's HTML service, which
 * reads `html-data.json`, and the snippets from the snippet file. Both are
 * contributed in `package.json`.
 */

import * as vscode from "vscode"
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from "vscode-languageclient/node"

export function activate(context: vscode.ExtensionContext) {
  const languages = () =>
    vscode.workspace.getConfiguration("lotek").get<string[]>("languages") ?? [
      "html",
    ]
  /* The language server */

  let client: LanguageClient | undefined
  const serverOptions: ServerOptions = {
    module: vscode.Uri.joinPath(context.extensionUri, "dist", "server.js")
      .fsPath,
    transport: TransportKind.stdio,
  }
  /*
   * The restarts are queued. Otherwise two changes to the language list in
   * quick succession both waited for the same old client, and each started
   * its own server: the findings came twice, and one server was never stopped.
   */
  /*
   * A client that failed to start throws when it is stopped. Every later
   * restart then got stuck in `catch`, and the findings did not come back
   * until the window was reloaded.
   */
  const stopClient = async () => {
    const old = client
    client = undefined
    try {
      await old?.stop()
    } catch {
      // It was not running, so there is nothing to stop.
    }
  }
  let restarts: Promise<void> = Promise.resolve()
  const startClient = () => {
    restarts = restarts
      .then(async () => {
        await stopClient()
        client = new LanguageClient("lotek", "LO-TEK", serverOptions, {
          documentSelector: languages().flatMap((language) => [
            { scheme: "file", language },
            { scheme: "untitled", language },
          ]),
          // VS Code's HTML service completes the elements in HTML and
          // Handlebars files, from `html-data.json`, so the server leaves
          // them out there. The suite in `test/suite.cjs` asks VS Code, in
          // every language it registers, that each element comes once.
          //
          // The manifests are watched because the server asks for it, as it
          // does in Neovim and Helix, so there is no watcher here.
          initializationOptions: { htmlService: ["html", "handlebars"] },
        } satisfies LanguageClientOptions)
        await client.start()
      })
      .catch((error: unknown) => {
        void vscode.window.showErrorMessage(
          `LO-TEK could not start the language server: ${error instanceof Error ? error.message : String(error)}`,
        )
      })
    return restarts
  }

  /* When the language list changes, the server is started again with it. */

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("lotek.languages")) void startClient()
    }),
    {
      dispose() {
        void stopClient()
      },
    },
  )
  void startClient()
}

export function deactivate() {}
