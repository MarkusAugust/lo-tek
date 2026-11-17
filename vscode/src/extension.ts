/**
 * The VS Code extension: the language server for the findings and fixes, and
 * completion and hover on top.
 *
 * The findings and quick fixes come from the language server, `lotek lsp`,
 * the same one Neovim and Helix use, written in Rust and run as a WASI module
 * (see `server.ts`). It reads the manifest the project actually has, also
 * with components taken over with `lotek takeover`. Here is the rest:
 *
 *   - inside `class="…"` the `lt-` classes are completed, and inside an
 *     attribute a class takes, like `data-variant` on `lt-button`, the values
 *     are. In languages other than HTML, where VS Code's own HTML service is
 *     not present, the `<lt-…>` elements, their attributes and their values
 *     are completed too;
 *   - hovering over an `lt-` class in a `class` attribute gives the
 *     component, the description and the link.
 *
 * The tag the cursor is in is read from a window backwards, not from the
 * whole document: completion is triggered on space and hyphen, and a large
 * file should not be copied on every keystroke.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { Manifest } from "@lo-tek/interfaces/diagnostics"
import * as vscode from "vscode"
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from "vscode-languageclient/node"

/** How far back to read for the tag the cursor is in. A tag is shorter. */
const WINDOW = 4000

/**
 * Where the tag that begins before `from` ends, or -1 when it is not closed.
 * `>` in a quoted value, and in `<?…?>` and `<%…%>`, does not end it.
 */
function tagEnd(text: string, from: number): number {
  let quote: string | null = null
  for (let i = from; i < text.length; i++) {
    const char = text[i]
    if (quote) {
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === "<" && (text[i + 1] === "?" || text[i + 1] === "%")) {
      const closer = text.indexOf(`${text[i + 1]}>`, i + 2)
      if (closer < 0) return -1
      i = closer + 1
    } else if (char === ">") return i
  }
  return -1
}

export function activate(context: vscode.ExtensionContext) {
  // The vocabulary for completion and hover is the manifest the extension was
  // built from, which the build puts in `dist/manifest/`. The language server,
  // on the other hand, checks against the project's manifest when it has one,
  // and against this one only as a fallback. If the project has an older
  // package installed, completion can therefore suggest a class the server
  // underlines, and a component taken over with `lotek takeover` is not
  // suggested. Completion from the server is on the roadmap.
  const { classes, elements }: Manifest = JSON.parse(
    readFileSync(
      join(context.extensionPath, "dist/manifest/manifest.json"),
      "utf8",
    ),
  )
  const classNames = Object.keys(classes)
  const elementNames = Object.keys(elements)

  const languages = () =>
    vscode.workspace.getConfiguration("lotek").get<string[]>("languages") ?? [
      "html",
    ]
  const selector = (): vscode.DocumentSelector =>
    languages().map((language) => ({ language }))

  /* The language server */

  let client: LanguageClient | undefined
  const serverOptions: ServerOptions = {
    module: vscode.Uri.joinPath(context.extensionUri, "dist", "server.js")
      .fsPath,
    transport: TransportKind.stdio,
  }
  // A new build or an upgrade of the package changes the manifest. One
  // watcher for the whole lifetime, not one per restart.
  const manifests = vscode.workspace.createFileSystemWatcher(
    "**/{build/lotek/manifest.json,node_modules/@lo-tek/interfaces/manifest/manifest.json}",
  )
  context.subscriptions.push(manifests)

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
          synchronize: { fileEvents: manifests },
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

  /* The tag the cursor is in */

  type Tag = {
    /** From `<` to the cursor. */
    before: string
    /** From the cursor to `>`, empty when the tag is not closed within the window. */
    after: string
  }

  /** The quote the text ends inside, if any. */
  const openQuote = (text: string) => {
    let quote: string | null = null
    for (const char of text) {
      if (quote) {
        if (char === quote) quote = null
      } else if (char === '"' || char === "'") quote = char
    }
    return quote
  }

  const tagAt = (
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Tag | undefined => {
    const offset = document.offsetAt(position)
    const before = document.getText(
      new vscode.Range(
        document.positionAt(Math.max(0, offset - WINDOW)),
        position,
      ),
    )
    const start = before.lastIndexOf("<")
    if (start < 0) return undefined
    const head = before.slice(start)
    // A `>` inside a value, like `x-show="n > 0"`, does not end the tag.
    if (tagEnd(head, 1) >= 0) return undefined
    const rest = document.getText(
      new vscode.Range(position, document.positionAt(offset + WINDOW)),
    )
    // If the cursor is inside a value, that value is closed first; otherwise
    // the parity flips and a `"` in a later tag is read as an opening.
    const quote = openQuote(head)
    const from = quote ? rest.indexOf(quote) : -1
    const end = quote && from < 0 ? -1 : tagEnd(rest, quote ? from + 1 : 0)
    return { before: head, after: end < 0 ? "" : rest.slice(0, end) }
  }

  /** The classes in the tag, before and after the cursor. `class` takes precedence over `:class`. */
  const classesIn = (tag: Tag) => {
    const text = tag.before + tag.after
    const hit =
      text.match(/(?:^|\s)class\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i) ??
      text.match(/(?:^|\s):class\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i)
    return (
      hit
        ?.slice(1)
        .find((v) => v !== undefined)
        ?.split(/\s+/) ?? []
    )
  }

  /** Whether the cursor is inside the value of `class`. */
  const inClassValue = (tag: Tag) =>
    /(?:^|\s):?class\s*=\s*(?:"[^"]*|'[^']*|[^\s"'>]*)$/i.test(tag.before)

  /* Completion */

  const markdown = (text: string) => {
    const md = new vscode.MarkdownString(text)
    md.isTrusted = false
    return md
  }
  const classDocumentation = (name: string) => {
    const info = classes[name]
    const takes = Object.entries(info.attributes)
      .map(([attribute, a]) =>
        "flag" in a
          ? `\`${attribute}\`: flag, takes effect by being present`
          : `\`${attribute}\`: ${a.values.join(", ")}` +
            (a.default ? ` (${a.default} without the attribute)` : ""),
      )
      .join("  \n")
    return markdown(
      `**${info.title}** · ${info.description}\n\n${takes ? `${takes}\n\n` : ""}[Documentation](${info.link})`,
    )
  }

  const completions: vscode.CompletionItemProvider = {
    provideCompletionItems(document, position) {
      const tag = tagAt(document, position)
      if (!tag) return undefined
      const items: vscode.CompletionItem[] = []
      const wordRange =
        document.getWordRangeAtPosition(position, /[A-Za-z0-9_-]+/) ??
        new vscode.Range(position, position)
      const item = (
        label: string,
        kind: vscode.CompletionItemKind,
        detail?: string,
        documentation?: vscode.MarkdownString,
      ) => {
        const it = new vscode.CompletionItem(label, kind)
        it.detail = detail
        it.documentation = documentation
        it.range = wordRange
        items.push(it)
      }

      // The classes, inside class="…".
      if (inClassValue(tag)) {
        for (const name of classNames)
          item(
            name,
            vscode.CompletionItemKind.Value,
            classes[name].title,
            classDocumentation(name),
          )
        return items
      }

      const isHtml = document.languageId === "html"
      const element = /^<(lt-[a-z0-9-]+)(?=[\s/])/i
        .exec(tag.before)?.[1]
        .toLowerCase()

      // The values of an attribute: one a class on the tag takes, or one an
      // <lt-…> element takes outside HTML.
      const inValue = /([A-Za-z][\w:-]*)\s*=\s*["']?[^"'>]*$/.exec(tag.before)
      if (inValue) {
        const attribute = inValue[1].toLowerCase()
        for (const name of classesIn(tag)) {
          const takes = classes[name]?.attributes[attribute]
          // A flag has no values to suggest.
          if (!takes || "flag" in takes) continue
          for (const value of takes.values)
            item(
              value,
              vscode.CompletionItemKind.EnumMember,
              `${attribute} on ${classes[name].title}`,
            )
          if (takes.default)
            item(
              takes.default,
              vscode.CompletionItemKind.EnumMember,
              `default: the same as no ${attribute}`,
            )
        }
        if (!isHtml && element && elements[element]) {
          const takes = elements[element].attributes[attribute]
          if (takes?.type === "values")
            for (const value of takes.values)
              item(
                value,
                vscode.CompletionItemKind.EnumMember,
                `${attribute} on <${element}>`,
              )
        }
        return items.length ? items : undefined
      }

      // Outside HTML there is no HTML service, so the elements and their
      // attributes are completed here.
      if (isHtml) return undefined
      if (/^<lt-[a-z0-9-]*$/i.test(tag.before)) {
        for (const name of elementNames)
          item(
            name,
            vscode.CompletionItemKind.Class,
            undefined,
            markdown(`[Documentation](${elements[name].link})`),
          )
        return items
      }
      // Attribute names: the cursor is in the tag, outside quotes.
      if (
        element &&
        elements[element] &&
        /^<[^"'>]*(?:"[^"]*"[^"'>]*|'[^']*'[^"'>]*)*$/.test(tag.before)
      ) {
        for (const [name, a] of Object.entries(elements[element].attributes))
          item(
            name,
            vscode.CompletionItemKind.Property,
            a.type === "values" ? a.values.join(" | ") : a.type,
          )
        return items
      }
      return undefined
    },
  }

  /* Hover */

  const hover: vscode.HoverProvider = {
    provideHover(document, position) {
      const range = document.getWordRangeAtPosition(
        position,
        /lt-[A-Za-z0-9_-]+/,
      )
      if (!range) return undefined
      const word = document.getText(range)
      if (!classes[word]) return undefined
      // Only in a class attribute: "use lt-button here" in running text is text.
      const tag = tagAt(document, range.start)
      if (!tag || !inClassValue(tag)) return undefined
      return new vscode.Hover(classDocumentation(word), range)
    },
  }

  /* Registration. When the language list changes, everything is registered again. */

  const providers: vscode.Disposable[] = []
  const register = () => {
    for (const p of providers) p.dispose()
    providers.length = 0
    providers.push(
      vscode.languages.registerCompletionItemProvider(
        selector(),
        completions,
        '"',
        "'",
        " ",
        "-",
        "<",
        "=",
      ),
      vscode.languages.registerHoverProvider(selector(), hover),
    )
    void startClient()
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("lotek.languages")) register()
    }),
    {
      dispose() {
        for (const p of providers) p.dispose()
        void stopClient()
      },
    },
  )
  register()
}

export function deactivate() {}
