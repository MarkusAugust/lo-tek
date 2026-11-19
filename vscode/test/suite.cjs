/**
 * Run inside VS Code by `scripts/check-vscode.ts`: the extension is loaded,
 * and the language server must give findings and quick fixes in a real
 * document.
 */

const assert = require("node:assert")
const fs = require("node:fs")
const path = require("node:path")
const vscode = require("vscode")

/**
 * Where the failed assertion is written. The runner outside only reports
 * "Test run failed with code 1", and the extension host's console does not
 * reach it, so `check-vscode.ts` hands in a path in its own run folder and
 * reads it after a failure. Without the variable nothing is written.
 */
const FAILURE_FILE = process.env.LOTEK_SUITE_FAILURE

/**
 * The languages the snippets promise, written out: they are our own
 * contract, the list the README and the editor page name. The build reads
 * the default of `lotek.languages`, so comparing the snippet file with that
 * default alone would only check the build against its own input, and a
 * language taken out of the default would lose its snippets in silence.
 */
const PROMISED_LANGUAGES = [
  "html",
  "php",
  "razor",
  "aspnetcorerazor",
  "astro",
  "svelte",
  "vue",
  "twig",
  "blade",
  "jinja",
  "jinja-html",
  "django-html",
  "handlebars",
  "erb",
  "gotmpl",
  "go-template",
  "ejs",
  "liquid",
  "nunjucks",
  "edge",
]

/** Waits until the document's findings are what the test wants, or gives up. */
async function diagnosticsFor(uri, wanted) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const found = vscode.languages.getDiagnostics(uri)
    if (wanted(found)) return found
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(
    `Waited in vain for the findings: ${JSON.stringify(vscode.languages.getDiagnostics(uri))}`,
  )
}

exports.run = async () => {
  try {
    await suite()
  } catch (error) {
    if (FAILURE_FILE)
      fs.writeFileSync(
        FAILURE_FILE,
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      )
    throw error
  }
}

async function suite() {
  const document = await vscode.workspace.openTextDocument({
    language: "html",
    content: '<p>🧾</p>\n<button class="lt-buton">Send</button>\n',
  })
  await vscode.window.showTextDocument(document)

  const found = await diagnosticsFor(document.uri, (d) => d.length > 0)
  assert.strictEqual(found.length, 1, "one finding")
  assert.strictEqual(found[0].source, "LO-TEK")
  assert.strictEqual(found[0].range.start.line, 1)
  assert.strictEqual(found[0].range.start.character, 15)
  assert.strictEqual(
    typeof found[0].code === "object" ? found[0].code.value : found[0].code,
    "unknown-class",
  )

  const actions = await vscode.commands.executeCommand(
    "vscode.executeCodeActionProvider",
    document.uri,
    found[0].range,
  )
  const fix = actions.find((a) => a.title === "Change to lt-button")
  assert.ok(fix, `no fix among ${actions.map((a) => a.title).join(", ")}`)
  await vscode.workspace.applyEdit(fix.edit)
  assert.ok(
    document.getText().includes('class="lt-button"'),
    "the fix was not applied",
  )
  await diagnosticsFor(document.uri, (d) => d.length === 0)

  // Two changes to the language list in quick succession give one server, not
  // two: the finding must come once.
  const config = vscode.workspace.getConfiguration("lotek")
  const languages = config.get("languages")
  await Promise.all([
    config.update("languages", [...languages, "plaintext"], true),
    config.update("languages", languages, true),
  ])
  const second = await vscode.workspace.openTextDocument({
    language: "html",
    content: '<button class="lt-buton">Send</button>\n',
  })
  await new Promise((resolve) => setTimeout(resolve, 3000))
  const once = await diagnosticsFor(second.uri, (d) => d.length > 0)
  assert.strictEqual(
    once.filter((d) => d.source === "LO-TEK").length,
    1,
    `the finding came ${once.length} times after two restarts`,
  )

  // Completion comes from the language server, like the findings.
  const edit = new vscode.WorkspaceEdit()
  edit.insert(document.uri, new vscode.Position(2, 0), '<b class="lt-')
  await vscode.workspace.applyEdit(edit)
  const list = await vscode.commands.executeCommand(
    "vscode.executeCompletionItemProvider",
    document.uri,
    new vscode.Position(2, 13),
  )
  assert.ok(
    list.items.some((item) => (item.label.label ?? item.label) === "lt-button"),
    "lt-button is not among the suggestions",
  )
  // From the server, and not VS Code's own suggestions of the words in the
  // document, which has `lt-button` in it already: only the server knows
  // what the class is.
  const fromServer = list.items.find(
    (item) => (item.label.label ?? item.label) === "lt-button",
  )
  assert.strictEqual(
    fromServer.detail,
    "Button",
    "the suggestion of lt-button does not say it is the button",
  )
  // Each class is suggested once: the extension has no provider of its own
  // beside the server's.
  assert.strictEqual(
    list.items.filter(
      (item) => (item.label.label ?? item.label) === "lt-button",
    ).length,
    1,
    "lt-button is suggested more than once",
  )

  // Hover comes from the server too.
  const hoverEdit = new vscode.WorkspaceEdit()
  hoverEdit.insert(document.uri, new vscode.Position(2, 13), 'button">')
  await vscode.workspace.applyEdit(hoverEdit)
  const hovers = await vscode.commands.executeCommand(
    "vscode.executeHoverProvider",
    document.uri,
    new vscode.Position(2, 15),
  )
  assert.ok(
    hovers.some((hover) =>
      hover.contents.some((content) =>
        (content.value ?? content).startsWith("**Button**"),
      ),
    ),
    "hovering over lt-button does not say it is the button",
  )

  /*
   * The snippets are one global snippet file, contributed without a
   * `language`, with a `scope` per snippet. A contribution with a
   * `language` no extension registers is an error in the extension's
   * runtime status, "Unknown language in contributes.interfaces.language",
   * which no API reports; and a contribution without one is an error unless
   * the path ends with `.code-snippets`. So the manifest is checked here:
   * user extensions are disabled in the test, so a `language` must be one
   * VS Code registers on its own.
   */
  const extension = vscode.extensions.getExtension("lo-tek.interfaces")
  assert.ok(extension, "did not find the extension")
  const contributed = extension.packageJSON.contributes.snippets
  assert.ok(contributed.length > 0, "the manifest contributes no snippets")
  // The fixture extension registers `blade` for the snippet test below. It
  // is not one VS Code ships with, so it does not count here, or a manifest
  // entry for blade would pass the check in the test and fail for users.
  const fixture = vscode.extensions.getExtension("lo-tek-test.lotek-test-blade")
  assert.ok(fixture, "the fixture extension that registers blade is not loaded")
  const fromFixture = fixture.packageJSON.contributes.languages.map((l) => l.id)
  const registered = (await vscode.languages.getLanguages()).filter(
    (l) => !fromFixture.includes(l),
  )
  for (const entry of contributed) {
    // VS Code reads an empty or blank language as none, so the same here.
    if (!entry.language?.trim()) {
      assert.ok(
        entry.path.endsWith(".code-snippets"),
        `a snippet contribution without a language must be a .code-snippets file, not ${entry.path}`,
      )
    } else {
      assert.ok(
        registered.includes(entry.language),
        `contributes.snippets names a language VS Code does not register on its own, which gives "Unknown language" in the runtime status: ${entry.language}. Put it in the scope of the .code-snippets file instead.`,
      )
    }
  }

  // Every snippet applies in exactly the promised languages, and the default
  // of `lotek.languages` is the same list, so the checks, the classes and
  // the snippets cover the same files.
  const snippets = JSON.parse(
    fs.readFileSync(
      path.join(extension.extensionPath, "dist/lotek.code-snippets"),
      "utf8",
    ),
  )
  const names = Object.keys(snippets)
  assert.ok(names.length > 0, "the snippet file is empty")
  const promised = [...PROMISED_LANGUAGES].sort()
  assert.deepStrictEqual(
    [
      ...extension.packageJSON.contributes.configuration.properties[
        "lotek.languages"
      ].default,
    ].sort(),
    promised,
    "the default of lotek.languages is not the promised languages",
  )
  for (const name of names) {
    const scope = (snippets[name].scope ?? "")
      .split(",")
      .map((l) => l.trim())
      .filter((l) => l !== "")
    assert.deepStrictEqual(
      [...scope].sort(),
      promised,
      `the snippet ${name} has the scope "${scope.join(",")}", not the promised languages`,
    )
  }

  // The scope is honoured: the snippet is offered exactly once in html and
  // php, which VS Code registers itself, and in blade, which the test's
  // fixture extension registers, as a template language extension would; and
  // not in plain text, which is registered but not in the scope. Neither the
  // extension's completion provider nor its language server gives items of
  // kind Snippet, so an item of that kind named lt-field comes from VS Code's
  // snippet service. What is tested is the completion. The "Insert Snippet"
  // picker and `editor.tabCompletion` read the same service, but they are not
  // tested: an earlier version inserted the snippet by name through the
  // picker's command, and it depended on editor focus and failed at random.
  const snippetKind = vscode.CompletionItemKind.Snippet
  const snippetItems = async (language, content) => {
    const doc = await vscode.workspace.openTextDocument({ language, content })
    const list = await vscode.commands.executeCommand(
      "vscode.executeCompletionItemProvider",
      doc.uri,
      doc.positionAt(content.length),
    )
    return list.items.filter(
      (item) =>
        item.kind === snippetKind &&
        (item.label.label ?? item.label) === "lt-field",
    )
  }
  for (const language of ["html", "php", "blade"]) {
    const offered = await snippetItems(language, "lt-fi")
    assert.strictEqual(
      offered.length,
      1,
      `the snippet came ${offered.length} times in ${language}`,
    )
  }
  const outside = await snippetItems("plaintext", "lt-fi")
  assert.strictEqual(outside.length, 0, "no snippet outside the scope")

  // The elements are suggested once in every language, beside the snippet
  // of the same name. In HTML and
  // Handlebars VS Code's own HTML service gives them, from `html-data.json`,
  // and the server must leave them out; in PHP only the server knows them.
  const elementItems = async (language) => {
    const doc = await vscode.workspace.openTextDocument({
      language,
      content: "<lt-",
    })
    await vscode.window.showTextDocument(doc)
    const labelOf = (item) => item.label.label ?? item.label
    const ask = async () =>
      (
        await vscode.commands.executeCommand(
          "vscode.executeCompletionItemProvider",
          doc.uri,
          doc.positionAt(4),
        )
      ).items.filter((item) => item.kind !== snippetKind)
    const dialogs = (items) =>
      items.filter((item) => labelOf(item) === "lt-dialog")
    // The HTML service starts when the first such document is opened, and
    // the server may answer before it. Where the service answers, `<div>` in
    // the list shows that it has; elsewhere the question is put again after
    // a while, in case a second source is slow.
    const service = ["html", "handlebars"].includes(language)
    for (let attempt = 0; attempt < 120; attempt++) {
      const items = await ask()
      const answered = items.some((item) => labelOf(item) === "div")
      if (dialogs(items).length > 0 && (answered || !service)) {
        if (service) return dialogs(items)
        await new Promise((resolve) => setTimeout(resolve, 1500))
        return dialogs(await ask())
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    return []
  }
  // Every promised language VS Code registers on its own, so a language its
  // HTML service takes on later is caught here. The fixture's blade is in.
  const known = await vscode.languages.getLanguages()
  const asked = PROMISED_LANGUAGES.filter((l) => known.includes(l))
  for (const language of ["html", "handlebars", "php", "razor", "blade"])
    assert.ok(asked.includes(language), `VS Code does not register ${language}`)
  // Handlebars first, while the HTML service has not started, so the wait
  // above is what the answer rests on.
  for (const language of [
    "handlebars",
    ...asked.filter((l) => l !== "handlebars"),
  ]) {
    const offered = await elementItems(language)
    assert.strictEqual(
      offered.length,
      1,
      `<lt-dialog> was suggested ${offered.length} times in ${language}`,
    )
  }

  // A manifest that appears in the workspace applies to a document that is
  // already open, without a keystroke in it, and so does its going away. The
  // server asks VS Code to watch the manifests; the extension has no watcher
  // of its own.
  const folder = vscode.workspace.workspaceFolders?.[0]
  assert.ok(folder, "the test was started without a workspace folder")
  const page = vscode.Uri.joinPath(folder.uri, "page.html")
  fs.writeFileSync(page.fsPath, '<div class="lt-claim">Claim</div>\n')
  await vscode.window.showTextDocument(
    await vscode.workspace.openTextDocument(page),
  )
  await diagnosticsFor(page, (d) => d.length === 1)
  // The folders are made one at a time, with a wait after each. On Linux
  // VS Code watches a new folder only after it has seen it come, and folders
  // made inside each other in one go are not all watched: what happens in
  // the innermost is then not reported. Found by running this in VS Code
  // 1.94 and 1.147 on Linux with one processor; macOS watches the whole tree.
  const makeFolder = async (relative) => {
    let here = folder.uri.fsPath
    for (const part of relative.split("/")) {
      here = path.join(here, part)
      if (fs.existsSync(here)) continue
      fs.mkdirSync(here)
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    return here
  }
  const built = await makeFolder("build/lotek")
  const takenOver = fs
    .readFileSync(
      path.join(extension.extensionPath, "dist/manifest/manifest.json"),
      "utf8",
    )
    .replace('"lt-card": {', '"lt-claim": {')
  fs.writeFileSync(path.join(built, "manifest.json"), takenOver)
  await diagnosticsFor(page, (d) => d.length === 0)
  fs.rmSync(path.join(built, "manifest.json"))
  await diagnosticsFor(page, (d) => d.length === 1)
  // A whole folder at once, as `gradle clean` and a fresh `npm install` do:
  // then there is one event for the folder and none for the file in it.
  fs.writeFileSync(path.join(built, "manifest.json"), takenOver)
  await diagnosticsFor(page, (d) => d.length === 0)
  fs.rmSync(path.join(folder.uri.fsPath, "build"), { recursive: true })
  await diagnosticsFor(page, (d) => d.length === 1)
  // The installed package, written over where it is. VS Code before 1.94
  // left `node_modules/*/**` out of what it watches (`files.watcherExclude`),
  // and saw none of this; it is why 1.94 is the oldest the extension takes.
  const installed = await makeFolder("node_modules/@lo-tek/interfaces/manifest")
  fs.writeFileSync(path.join(installed, "manifest.json"), takenOver)
  await diagnosticsFor(page, (d) => d.length === 0)
  fs.writeFileSync(
    path.join(installed, "manifest.json"),
    takenOver.replace('"lt-claim": {', '"lt-card": {'),
  )
  await diagnosticsFor(page, (d) => d.length === 1)
  // The package put in again, as an upgrade with `npm install` does: the
  // folder goes and comes back with another manifest in it. Folder by
  // folder here too, which `npm install` is not.
  fs.rmSync(path.join(folder.uri.fsPath, "node_modules/@lo-tek/interfaces"), {
    recursive: true,
  })
  await makeFolder("node_modules/@lo-tek/interfaces/manifest")
  fs.writeFileSync(path.join(installed, "manifest.json"), takenOver)
  await diagnosticsFor(page, (d) => d.length === 0)

  // The snippet for the field: the id is typed once, and `for` follows.
  const third = await vscode.workspace.openTextDocument({
    language: "html",
    content: "",
  })
  const editor = await vscode.window.showTextDocument(third)
  await editor.insertSnippet(
    new vscode.SnippetString(snippets["lt-field"].body.join("\n")),
  )
  // The first tab stop is the form's id, the second the field's, mirrored in `for`.
  await vscode.commands.executeCommand("jumpToNextSnippetPlaceholder")
  await vscode.commands.executeCommand("type", { text: "codename" })
  const text = third.getText()
  assert.ok(
    text.includes('id="codename"') && text.includes('for="codename"'),
    `id and for do not follow each other in the snippet: ${text}`,
  )
  // The ids are empty tab stops: a filled-in one gave two equal ids when the
  // snippet was pasted twice on a page.
  assert.ok(
    text.includes('<form id=""'),
    `the first tab stop should have been left empty: ${text}`,
  )
  assert.ok(
    !text.includes('id="name"'),
    `the placeholder is still there: ${text}`,
  )
}
