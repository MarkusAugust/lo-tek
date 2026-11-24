/**
 * Checks that every type a builder function is written with can be imported.
 *
 * `dialog()` takes `color?: DialogColor`, and `DialogColor` was exported by
 * its own file but not by the package: a consumer who wanted to name the type
 * of a colour had to take it apart from `DialogOptions`. Nothing said so,
 * since the declaration files are valid either way.
 *
 * The check starts from everything an entry point exports and follows every
 * type it is written with, through the types those are written with in turn.
 * Each one that is declared in `src` must be exported by the same entry
 * point, whether its own file exports it or not. Private members of a class
 * are skipped, and constants are not followed:
 * the class names and the lists of values are for the package's own use.
 *
 * Only the entry points with builder functions are read, `.` and `./react`.
 *
 * Run by `bun run build`.
 */

import { fileURLToPath } from "node:url"
import ts from "typescript"

const root = fileURLToPath(new URL("../", import.meta.url)).replace(/\\/g, "/")
/** The entry points with builder functions: the main one and the one for React. */
const ENTRIES = ["src/index.ts", "src/react.ts"]

const config = ts.readConfigFile(`${root}tsconfig.json`, ts.sys.readFile)
const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
const program = ts.createProgram(
  ENTRIES.map((entry) => `${root}${entry}`),
  { ...options, noEmit: true },
)
const checker = program.getTypeChecker()

const target = (symbol: ts.Symbol) =>
  symbol.flags & ts.SymbolFlags.Alias
    ? checker.getAliasedSymbol(symbol)
    : symbol

const NAMED = ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Interface

const errors: string[] = []
let followed = 0

for (const entry of ENTRIES) {
  const source = program.getSourceFile(`${root}${entry}`)
  const module = source && checker.getSymbolAtLocation(source)
  if (!module) {
    console.error(`Could not read ${entry} as a module.`)
    process.exit(1)
  }
  const exported = new Set(checker.getExportsOfModule(module).map(target))
  if (exported.size < 5) {
    console.error(
      `Found only ${exported.size} exports in ${entry}. The check has stopped reading the entry point.`,
    )
    process.exit(1)
  }

  const seen = new Set<ts.Symbol>()
  const missing = new Map<string, string>()

  /** Every named type in a declaration, and the ones those name in turn. */
  const follow = (node: ts.Node) => {
    if (ts.isBlock(node)) return
    // What a class keeps to itself is not something a consumer writes.
    if (
      ts.isClassElement(node) &&
      (node.name?.kind === ts.SyntaxKind.PrivateIdentifier ||
        (ts.getCombinedModifierFlags(node as ts.Declaration) &
          ts.ModifierFlags.Private) !==
          0)
    )
      return
    if (
      ts.isTypeReferenceNode(node) ||
      ts.isExpressionWithTypeArguments(node)
    ) {
      const name = ts.isTypeReferenceNode(node)
        ? node.typeName
        : node.expression
      const found = checker.getSymbolAtLocation(name)
      if (found) visit(target(found))
    }
    ts.forEachChild(node, follow)
  }

  const visit = (symbol: ts.Symbol) => {
    if (seen.has(symbol)) return
    seen.add(symbol)
    const declarations = (symbol.declarations ?? []).filter((declaration) => {
      const file = declaration.getSourceFile().fileName
      return file.startsWith(`${root}src/`) && !file.endsWith(".d.ts")
    })
    if (declarations.length === 0) return
    if (symbol.flags & NAMED) {
      followed += 1
      if (!exported.has(symbol)) {
        const file = declarations[0].getSourceFile().fileName.replace(root, "")
        missing.set(symbol.name, file)
      }
    }
    for (const declaration of declarations) follow(declaration)
  }

  for (const symbol of exported) visit(symbol)

  for (const [name, file] of missing) {
    errors.push(
      `${entry} is written with the type ${name} from ${file}, and does not export it.`,
    )
  }
}

if (errors.length > 0) {
  console.error(errors.sort().join("\n"))
  process.exit(1)
}

console.log(
  `type exports: followed ${followed} types from ${ENTRIES.join(" and ")}, all of them importable from where they are used`,
)
