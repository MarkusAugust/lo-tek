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

  // Completion is still the extension's own.
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
  assert.ok(
    text.includes('id="order-form"'),
    `the first tab stop should have been left untouched: ${text}`,
  )
  assert.ok(
    !text.includes('id="name"'),
    `the placeholder is still there: ${text}`,
  )
}
