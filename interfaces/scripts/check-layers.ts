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
import { exportedSources } from "./exports"

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

/** The modules the web components build on, below them in the direction. */
const SHARED = new Set([
  "src/components/host-element.ts",
  "src/components/events.ts",
  "src/components/default-texts.ts",
])

/** React and the packages that come with it, in any form. */
const REACT =
  /^(?:react(?:-[a-z-]+)?|scheduler|preact|@types\/react(?:-[a-z-]+)?)(?:\/|$)/

/**
 * Node's own built-in modules, asked of Node. Bun's `isBuiltin` also says yes
 * to `ws`, `undici` and `bun:test`, which Node does not have.
 */
const NODE_BUILTINS = new Set<string>(
  JSON.parse(
    Bun.spawnSync([
      "node",
      "-p",
      "JSON.stringify(require('node:module').builtinModules)",
    ]).stdout.toString() || "[]",
  ),
)
if (NODE_BUILTINS.size === 0)
  throw new Error("node gave no built-in modules: is Node installed?")

/** The component folder a file is in, `src/components/frame/field/`, or `null`. */
function folderOf(file: string): string | null {
  return (
    file.match(/^src\/components\/(?:css|frame|standalone)\/[^/]+\//)?.[0] ??
    null
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
  return readLayers(files, exported).findings
}

/** The findings, and how many imports were read to find them. */
export function readLayers(
  files: Array<{ path: string; text: string }>,
  exported: Set<string>,
): { findings: Finding[]; imports: number } {
  const known = new Set(files.map((f) => f.path))
  const out: Finding[] = []
  let imports = 0
  for (const { path, text } of files)
    for (const i of importsOf(path, text, known)) {
      imports += 1
      const report = (rule: string) =>
        out.push({ path, line: i.line, text: i.text, rule })
      // The package depends on nothing, so a package name is checked as it
      // is written, before the erased imports are let through.
      if (REACT.test(i.from) && !path.startsWith("src/jsx/"))
        report("React is imported only in src/jsx/, also as a type")
      if (i.typeOnly) continue
      // Node's own answer, so "fs" is caught as well as "node:fs".
      if (
        (i.from.startsWith("node:") || NODE_BUILTINS.has(i.from)) &&
        path !== "src/wasi-host.ts"
      )
        report("a Node built-in is imported only in src/wasi-host.ts")
      if (!i.file) continue
      // `lotek takeover` copies a component folder and rewrites what it
      // takes from outside the folder to the entry point in exports, so a
      // file exports does not point at would be a path the consumer does not
      // have. The web component's own module is in exports too, for its
      // defineLt*, but what another component may share is its contract,
      // such as field-core.ts, never the class.
      const webComponent =
        /^src\/components\/(?:frame|standalone)\/.*\/lt-[^/]+\.ts$/.test(i.file)
      const cssReachesUp =
        path.startsWith("src/components/css/") &&
        (/^src\/components\/(?:frame|standalone)\//.test(i.file) ||
          SHARED.has(i.file))
      // The rules below name testing/, the entry points and a CSS component
      // reaching up more exactly.
      const folder = folderOf(path)
      if (
        folder &&
        !i.file.startsWith(folder) &&
        !i.file.startsWith("src/testing/") &&
        !ENTRY_POINTS.has(i.file) &&
        !cssReachesUp &&
        (/\/lt-[^/]+\.ts$/.test(i.file) || !exported.has(i.file))
      )
        report(
          "a component reaches outside its folder only to a file exports points at, never another web component (lt-*.ts)",
        )
      if (i.file.startsWith("src/testing/"))
        report("code that ships imports nothing from src/testing/")
      if (path.startsWith("src/components/") && ENTRY_POINTS.has(i.file))
        report(
          "a component imports no entry point: lt.ts, react.ts, index.ts or register.ts",
        )
      if (cssReachesUp)
        report(
          "a CSS component imports nothing from frame/, standalone/, host-element.ts, events.ts or default-texts.ts",
        )
      if (SHARED.has(path) && webComponent)
        report(
          "host-element.ts, events.ts and default-texts.ts load no web component (lt-*.ts)",
        )
    }
  return { findings: out, imports }
}

/**
 * The rules, fed known imports every time the check runs. Each case writes
 * out the finding it expects.
 */
export function selfTest(): string[] {
  const broken: string[] = []
  const expect = (name: string, actual: unknown, wanted: unknown) => {
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
      new Set(["src/components/host-element.ts"]),
    ),
    [
      {
        path: "src/components/frame/suggestion/lt-suggestion.ts",
        line: 2,
        text: 'import { LtField } from "../field/lt-field.js"',
        rule: "a component reaches outside its folder only to a file exports points at, never another web component (lt-*.ts)",
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
        rule: "a component reaches outside its folder only to a file exports points at, never another web component (lt-*.ts)",
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
        rule: "a Node built-in is imported only in src/wasi-host.ts",
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
      new Set([
        "src/components/frame/field/field-core.ts",
        "src/components/host-element.ts",
      ]),
    ),
    [
      {
        path: "src/components/css/input/input.ts",
        line: 1,
        text: 'import { setAttr } from "../../host-element.js"',
        rule: "a CSS component imports nothing from frame/, standalone/, host-element.ts, events.ts or default-texts.ts",
      },
      {
        path: "src/components/css/input/input.ts",
        line: 2,
        text: 'import { lt as field } from "../../frame/field/field-core.js"',
        rule: "a CSS component imports nothing from frame/, standalone/, host-element.ts, events.ts or default-texts.ts",
      },
    ],
  )

  const one = (
    path: string,
    text: string,
    others: string[],
    exported: string[] = [],
  ) =>
    checkLayers(
      [{ path, text }, ...others.map((o) => ({ path: o, text: "" }))],
      new Set(exported),
    ).map((f) => f.rule)
  expect(
    "a component reaches outside its folder only to a file exports points at, a CSS component too",
    ([] as Finding[]).concat(
      checkLayers(
        [
          {
            path: "src/components/frame/suggestion/suggestion.ts",
            text: 'import { x } from "../../css/label/internal.js"\n',
          },
          { path: "src/components/css/label/internal.ts", text: "" },
          {
            path: "src/components/css/search/search.ts",
            text: 'import { y } from "../input/helper.js"\n',
          },
          { path: "src/components/css/input/helper.ts", text: "" },
        ],
        new Set(),
      ),
    ),
    [
      {
        path: "src/components/frame/suggestion/suggestion.ts",
        line: 1,
        text: 'import { x } from "../../css/label/internal.js"',
        rule: "a component reaches outside its folder only to a file exports points at, never another web component (lt-*.ts)",
      },
      {
        path: "src/components/css/search/search.ts",
        line: 1,
        text: 'import { y } from "../input/helper.js"',
        rule: "a component reaches outside its folder only to a file exports points at, never another web component (lt-*.ts)",
      },
    ],
  )
  const BASE =
    "host-element.ts, events.ts and default-texts.ts load no web component (lt-*.ts)"
  expect(
    "the shared modules load no web component, and a CSS component loads none of them but css",
    [
      ...one(
        "src/components/host-element.ts",
        'import { LtField } from "./frame/field/lt-field.js"\n',
        ["src/components/frame/field/lt-field.ts"],
      ),
      ...one(
        "src/components/css/input/input.ts",
        'import { X } from "../../events.js"\n',
        ["src/components/events.ts"],
        ["src/components/events.ts"],
      ),
    ],
    [
      BASE,
      "a CSS component imports nothing from frame/, standalone/, host-element.ts, events.ts or default-texts.ts",
    ],
  )
  expect(
    "a Node built-in without node: and React's relatives are caught too",
    [
      ...one(
        "src/diagnostics/core.ts",
        'import { readFileSync } from "fs"\n',
        [],
      ),
      ...one("src/lt.ts", 'import { flushSync } from "react-dom"\n', []),
      ...one("src/lt.ts", 'import type { FC } from "@types/react"\n', []),
    ],
    [
      "a Node built-in is imported only in src/wasi-host.ts",
      "React is imported only in src/jsx/, also as a type",
      "React is imported only in src/jsx/, also as a type",
    ],
  )

  expect(
    "one import is one finding, under the rule that names it most exactly",
    one(
      "src/components/css/input/input.ts",
      'import { LtField } from "../../frame/field/lt-field.js"\n',
      ["src/components/frame/field/lt-field.ts"],
      ["src/components/frame/field/lt-field.ts"],
    ),
    [
      "a CSS component imports nothing from frame/, standalone/, host-element.ts, events.ts or default-texts.ts",
    ],
  )
  expect(
    "a shared module may use a component's contract, only not a web component",
    one(
      "src/components/events.ts",
      'import { computeFieldAttributes } from "./frame/field/field-core.js"\n',
      ["src/components/frame/field/field-core.ts"],
      ["src/components/frame/field/field-core.ts"],
    ),
    [],
  )
  expect(
    "a Node built-in is what Node calls one, not what Bun adds, and React's other packages count",
    [
      ...one("src/dom.ts", 'import "ws"\nimport "bun:test"\n', []),
      ...one("src/lt.ts", 'import "react-is"\n', []),
    ],
    ["React is imported only in src/jsx/, also as a type"],
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
  const exported = exportedSources()

  // The imports are counted where the rules read them, so a run that read
  // no file or no import cannot pass for one that read them all.
  const { findings, imports } = readLayers(files, exported)
  const known = new Set(files.map((f) => f.path))
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
