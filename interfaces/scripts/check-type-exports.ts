/**
 * Checks that every type a builder function is written with can be imported.
 *
 * `dialog()` takes `color?: DialogColor`, and `DialogColor` was exported by
 * its own file but not by the package: a consumer who wanted to name the type
 * of a colour had to take it apart from `DialogOptions`. Nothing said so,
 * since the declaration files are valid either way.
 *
 * The rule is the simple one: a file the main entry point exports from
 * exports its types through it too. The constants are left out on purpose,
 * the class names and the lists of values are for the package's own use.
 *
 * Run by `bun run build`.
 */

import { fileURLToPath } from "node:url"
import ts from "typescript"

const root = fileURLToPath(new URL("../", import.meta.url)).replace(/\\/g, "/")
const entry = `${root}src/index.ts`

const config = ts.readConfigFile(`${root}tsconfig.json`, ts.sys.readFile)
const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
const program = ts.createProgram([entry], { ...options, noEmit: true })
const checker = program.getTypeChecker()

const source = program.getSourceFile(entry)
const index = source && checker.getSymbolAtLocation(source)
if (!index) {
  console.error(`Could not read ${entry} as a module.`)
  process.exit(1)
}

const target = (symbol: ts.Symbol) =>
  symbol.flags & ts.SymbolFlags.Alias
    ? checker.getAliasedSymbol(symbol)
    : symbol

const exported = new Set(checker.getExportsOfModule(index).map(target))

/** The files the entry point exports something from. */
const files = new Map<ts.Symbol, string>()
for (const symbol of exported) {
  for (const declaration of symbol.declarations ?? []) {
    const file = declaration.getSourceFile()
    const module = checker.getSymbolAtLocation(file)
    if (module) files.set(module, file.fileName.replace(root, ""))
  }
}

if (files.size < 30) {
  console.error(
    `Found only ${files.size} files behind src/index.ts. The check has stopped reading the entry point.`,
  )
  process.exit(1)
}

const errors: string[] = []
let types = 0
for (const [module, file] of files) {
  for (const name of checker.getExportsOfModule(module)) {
    const symbol = target(name)
    const onlyType =
      symbol.flags & ts.SymbolFlags.Type &&
      !(symbol.flags & ts.SymbolFlags.Value)
    if (!onlyType) continue
    types += 1
    if (!exported.has(symbol)) {
      errors.push(
        `${file} exports the type ${name.name}, and src/index.ts does not. Add it to the export from that file.`,
      )
    }
  }
}

if (errors.length > 0) {
  console.error(errors.sort().join("\n"))
  process.exit(1)
}

console.log(
  `type exports: ${types} types in ${files.size} files, all of them importable from the package`,
)
