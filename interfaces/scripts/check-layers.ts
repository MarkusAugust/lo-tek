/**
 * That the modules in `src` import in one direction only.
 *
 * The rules in CLAUDE.md about which layer may know which were prose, and
 * nothing said so when an import crossed them. Each rule here is a question
 * about an import resolved to the file it loads, never about how the path is
 * written: `../field/field-core.js` and `../../frame/field/field-core.js` are
 * the same file, and a rule on the text would have seen two.
 *
 * Only what is loaded when the module runs counts. `import type` is erased,
 * and `events.ts` and `host-element.ts` name the web components' classes for
 * `LtEventMap` that way. The exception is React, which the package must not
 * depend on in any form outside `jsx/`.
 *
 * Run with: bun scripts/check-layers.ts, or as part of `bun run build`. When
 * a rule is red, move the code, never the rule: `.claude/rules/boundaries.md`
 * says where it belongs.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Glob } from "bun"
import ts from "typescript"
import pkg from "../package.json"

export interface Finding {
  /** The file, relative to the package, as `src/components/…`. */
  path: string
  line: number
  text: string
  rule: string
}

interface Import {
  /** The specifier as written. */
  from: string
  /** The file it loads, relative to the package, or `null` for a package. */
  file: string | null
  typeOnly: boolean
  line: number
  text: string
}

/**
 * Every import and re-export in a file, and every `import()`, with whether
 * it is erased. A relative path is resolved to the `.ts` file the `.js`
 * stands for, or to its `index.ts`.
 */
function importsOf(path: string, text: string, known: Set<string>): Import[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
  const out: Import[] = []
  const add = (node: ts.Node, specifier: ts.Expression, typeOnly: boolean) => {
    if (!ts.isStringLiteral(specifier)) return
    const from = specifier.text
    const { line } = source.getLineAndCharacterOfPosition(node.getStart())
    out.push({
      from,
      file: from.startsWith(".") ? resolve(path, from, known) : null,
      typeOnly,
      line: line + 1,
      text: text.split("\n")[line].trim(),
    })
  }
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node))
      add(
        node,
        node.moduleSpecifier,
        Boolean(node.importClause?.isTypeOnly) ||
          Boolean(
            node.importClause?.namedBindings &&
              ts.isNamedImports(node.importClause.namedBindings) &&
              node.importClause.namedBindings.elements.length > 0 &&
              node.importClause.namedBindings.elements.every(
                (e) => e.isTypeOnly,
              ) &&
              !node.importClause.name,
          ),
      )
    else if (ts.isExportDeclaration(node) && node.moduleSpecifier)
      add(node, node.moduleSpecifier, node.isTypeOnly)
    else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0]
    )
      add(node, node.arguments[0], false)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return out
}

/** A relative specifier from a file, as the `.ts` file it loads. */
function resolve(path: string, from: string, known: Set<string>): string {
  const parts = path.split("/").slice(0, -1)
  for (const part of from.split("/")) {
    if (part === "..") parts.pop()
    else if (part !== ".") parts.push(part)
  }
  const joined = parts.join("/")
  const candidates = [
    joined.replace(/\.js$/, ".ts"),
    joined,
    `${joined}.ts`,
    `${joined}/index.ts`,
  ]
  return candidates.find((c) => known.has(c)) ?? candidates[0]
}

/** The entry points, which import the components and never the reverse. */
const ENTRY_POINTS = new Set([
  "src/lt.ts",
  "src/react.ts",
  "src/index.ts",
  "src/register.ts",
])

/** The component folder a file is in, `frame/field`, or `null`. */
function componentOf(file: string): string | null {
  return (
    file.match(/^src\/components\/((?:frame|standalone)\/[^/]+)\//)?.[1] ?? null
  )
}

/**
 * What is wrong with the imports of the files. `exported` is every file in
 * `src` that `exports` in `package.json` points at, by its `.ts` path.
 */
export function checkLayers(
  files: Array<{ path: string; text: string }>,
  exported: Set<string>,
): Finding[] {
  const known = new Set(files.map((f) => f.path))
  const out: Finding[] = []
  for (const { path, text } of files)
    for (const i of importsOf(path, text, known)) {
      const report = (rule: string) =>
        out.push({ path, line: i.line, text: i.text, rule })
      // The package depends on nothing, so a package name is checked as it
      // is written, before the erased imports are let through.
      if (
        (i.from === "react" || i.from.startsWith("react/")) &&
        !path.startsWith("src/jsx/")
      )
        report("React is imported only in src/jsx/, also as a type")
      if (i.typeOnly) continue
      if (i.from.startsWith("node:") && path !== "src/wasi-host.ts")
        report("node: is imported only in src/wasi-host.ts")
      if (!i.file) continue
      const mine = componentOf(path)
      const theirs = componentOf(i.file)
      // The web component's own module is in exports too, for its
      // defineLt*, but what another component may share is its contract,
      // such as field-core.ts, never the class.
      const elementModule = /\/lt-[^/]+\.ts$/.test(i.file)
      if (
        mine &&
        theirs &&
        mine !== theirs &&
        (elementModule || !exported.has(i.file))
      )
        report(
          "a component uses another only through a file exports points at, never its web component (lt-*.ts)",
        )
      if (i.file.startsWith("src/testing/"))
        report("code that ships imports nothing from src/testing/")
      if (path.startsWith("src/components/") && ENTRY_POINTS.has(i.file))
        report(
          "a component imports no entry point: lt.ts, react.ts, index.ts or register.ts",
        )
      if (
        path.startsWith("src/components/css/") &&
        (componentOf(i.file) || i.file === "src/components/host-element.ts")
      )
        report(
          "a CSS component imports nothing from frame/, standalone/ or host-element.ts",
        )
    }
  return out
}

/**
 * The rules, fed known imports every time the check runs. Each case writes
 * out the finding it expects.
 */
export function selfTest(): string[] {
  const broken: string[] = []
  const expect = (name: string, actual: Finding[], wanted: Finding[]) => {
    if (JSON.stringify(actual) !== JSON.stringify(wanted))
      broken.push(
        `${name}: found ${JSON.stringify(actual)}, expected ${JSON.stringify(wanted)}`,
      )
  }

  expect(
    "a frame component that imports another web component's class",
    checkLayers(
      [
        {
          path: "src/components/frame/suggestion/lt-suggestion.ts",
          text: 'import { HostElement } from "../../host-element.js"\nimport { LtField } from "../field/lt-field.js"\n',
        },
        { path: "src/components/frame/field/lt-field.ts", text: "" },
        { path: "src/components/host-element.ts", text: "" },
      ],
      new Set(),
    ),
    [
      {
        path: "src/components/frame/suggestion/lt-suggestion.ts",
        line: 2,
        text: 'import { LtField } from "../field/lt-field.js"',
        rule: "a component uses another only through a file exports points at, never its web component (lt-*.ts)",
      },
    ],
  )

  expect(
    "the web component's own module is no way in, even though exports points at it",
    checkLayers(
      [
        {
          path: "src/components/standalone/toast/lt-toast.ts",
          text: 'void import("../../frame/dialog/lt-dialog.js")\n',
        },
        { path: "src/components/frame/dialog/lt-dialog.ts", text: "" },
      ],
      new Set(["src/components/frame/dialog/lt-dialog.ts"]),
    ),
    [
      {
        path: "src/components/standalone/toast/lt-toast.ts",
        line: 1,
        text: 'void import("../../frame/dialog/lt-dialog.js")',
        rule: "a component uses another only through a file exports points at, never its web component (lt-*.ts)",
      },
    ],
  )
  expect(
    "the same through a file exports points at, or as a type, is allowed",
    checkLayers(
      [
        {
          path: "src/components/frame/suggestion/suggestion.ts",
          text: 'import { computeFieldAttributes } from "../field/field-core.js"\nimport type { LtField } from "../field/lt-field.js"\n',
        },
        { path: "src/components/frame/field/field-core.ts", text: "" },
        { path: "src/components/frame/field/lt-field.ts", text: "" },
      ],
      new Set(["src/components/frame/field/field-core.ts"]),
    ),
    [],
  )
  expect(
    "code that ships imports nothing from testing/",
    checkLayers(
      [
        {
          path: "src/components/frame/dialog/lt-dialog.ts",
          text: 'import { mount } from "../../../testing/a11y.js"\n',
        },
        { path: "src/testing/a11y.ts", text: "" },
      ],
      new Set(),
    ),
    [
      {
        path: "src/components/frame/dialog/lt-dialog.ts",
        line: 1,
        text: 'import { mount } from "../../../testing/a11y.js"',
        rule: "code that ships imports nothing from src/testing/",
      },
    ],
  )

  expect(
    "React only in jsx/, also as a type, and node: only in the WASI host",
    checkLayers(
      [
        {
          path: "src/jsx/react.ts",
          text: 'import type { HTMLAttributes } from "react"\n',
        },
        {
          path: "src/lt.ts",
          text: 'import type { ReactNode } from "react"\n',
        },
        {
          path: "src/wasi-host.ts",
          text: 'import { readFileSync } from "node:fs"\n',
        },
        {
          path: "src/diagnostics/core.ts",
          text: 'import { readFileSync } from "node:fs"\n',
        },
      ],
      new Set(),
    ),
    [
      {
        path: "src/lt.ts",
        line: 1,
        text: 'import type { ReactNode } from "react"',
        rule: "React is imported only in src/jsx/, also as a type",
      },
      {
        path: "src/diagnostics/core.ts",
        line: 1,
        text: 'import { readFileSync } from "node:fs"',
        rule: "node: is imported only in src/wasi-host.ts",
      },
    ],
  )

  expect(
    "a component never imports an entry point",
    checkLayers(
      [
        {
          path: "src/components/css/button/button.ts",
          text: 'import { lt } from "../../../lt.js"\n',
        },
        { path: "src/lt.ts", text: "" },
      ],
      new Set(),
    ),
    [
      {
        path: "src/components/css/button/button.ts",
        line: 1,
        text: 'import { lt } from "../../../lt.js"',
        rule: "a component imports no entry point: lt.ts, react.ts, index.ts or register.ts",
      },
    ],
  )
  expect(
    "a CSS component uses no web component and no host element",
    checkLayers(
      [
        {
          path: "src/components/css/input/input.ts",
          text: 'import { setAttr } from "../../host-element.js"\nimport { lt as field } from "../../frame/field/field-core.js"\n',
        },
        { path: "src/components/host-element.ts", text: "" },
        { path: "src/components/frame/field/field-core.ts", text: "" },
      ],
      new Set(["src/components/frame/field/field-core.ts"]),
    ),
    [
      {
        path: "src/components/css/input/input.ts",
        line: 1,
        text: 'import { setAttr } from "../../host-element.js"',
        rule: "a CSS component imports nothing from frame/, standalone/ or host-element.ts",
      },
      {
        path: "src/components/css/input/input.ts",
        line: 2,
        text: 'import { lt as field } from "../../frame/field/field-core.js"',
        rule: "a CSS component imports nothing from frame/, standalone/ or host-element.ts",
      },
    ],
  )

  return broken
}

if (import.meta.main) {
  const broken = selfTest()
  if (broken.length > 0) {
    console.error(
      `The rules for the layers answer wrong:\n${broken.map((b) => `  - ${b}`).join("\n")}`,
    )
    process.exit(1)
  }

  const PACKAGE = join(import.meta.dirname, "..")
  // The code that ships: not the tests, not src/testing/, and not the
  // declarations in src/types/, which load nothing.
  const files = [...new Glob("src/**/*.ts").scanSync(PACKAGE)]
    .filter(
      (p) =>
        !p.endsWith(".test.ts") &&
        !p.endsWith(".d.ts") &&
        !p.startsWith("src/testing/"),
    )
    .sort()
    .map((path) => ({ path, text: readFileSync(join(PACKAGE, path), "utf8") }))

  // Every file `exports` points at, as the source it is built from.
  const exported = new Set<string>()
  for (const target of Object.values(pkg.exports as Record<string, unknown>)) {
    const js =
      typeof target === "string"
        ? target
        : (target as { import?: string } | null)?.import
    if (js?.startsWith("./dist/") && js.endsWith(".js"))
      exported.add(`src/${js.slice("./dist/".length, -".js".length)}.ts`)
  }

  const findings = checkLayers(files, exported)
  const known = new Set(files.map((f) => f.path))
  // Counted from what was read, last: a run that read no file or no import
  // cannot pass for one that read them all.
  const imports = files.reduce(
    (n, f) => n + importsOf(f.path, f.text, known).length,
    0,
  )
  const missing = [...exported].filter((e) => !known.has(e))

  for (const rule of new Set(findings.map((f) => f.rule))) {
    console.error(`\n${rule}:`)
    for (const f of findings.filter((f) => f.rule === rule))
      console.error(`  ${f.path}:${f.line}: ${f.text}`)
  }
  if (missing.length > 0)
    console.error(
      `\nexports points at files that are not in src: ${missing.join(", ")}`,
    )
  console.log(
    `Read ${imports} imports in ${files.length} files, and ${exported.size} files exports points at.`,
  )
  if (
    findings.length > 0 ||
    missing.length > 0 ||
    files.length === 0 ||
    imports === 0
  ) {
    console.error(
      "\nMove the code, not the rule: .claude/rules/boundaries.md says where it belongs.",
    )
    process.exit(1)
  }
  console.log("Every import goes the way the layers allow.")
}
