/**
 * Reads the builder functions in `lt` as TypeScript sees them: the name,
 * each option with its type, and the shape of the result.
 *
 * The options and their types are read by the TypeScript compiler from the
 * signatures in `src/lt.ts`, not from the source code as text, so an option
 * added to a component is included without anything having to be written
 * anywhere else.
 *
 * Both `generate-vocabulary.ts` and `generate-manifest.ts` read from here.
 * The vocabulary used to read the flags from `manifest.json` on disk, while
 * the manifest derived them again from the build cases and read the rest
 * from `classes.ts`. The two pointed at each other: a new flag reached the
 * manifest on the first build, but `classes.ts` only on the next, and
 * `check:vocabulary` failed the build in between. Now the flags are derived
 * in one place, from the builder function itself, and the manifest takes
 * them from `classes.ts` like everything else there.
 *
 * The program is built when `readBuilderFunctions()` is called, not when the
 * module loads, so it costs only whoever actually asks.
 */

import { fileURLToPath } from "node:url"
import ts from "typescript"
import { lt } from "../src/lt.js"

const PACKAGE = fileURLToPath(new URL("..", import.meta.url))

export type OptionType =
  | { kind: "values"; values: string[] }
  | { kind: "flag" }
  | { kind: "text" }
  | { kind: "number" }
  | { kind: "textList" }

export type Option = {
  name: string
  required: boolean
  type: OptionType
  /** The JSDoc of the option in the builder function's type, when it has one. */
  description?: string
  /**
   * The value that gives the same answer as leaving the option out, for an
   * option with a closed list. Set by `generate-manifest.ts`.
   */
  default?: string
}

export type ResultShape =
  | { kind: "attributes" }
  | { kind: "text" }
  | { kind: "values"; values: string[] }
  | { kind: "list"; of: ResultShape }
  | {
      kind: "group"
      fields: Record<string, ResultShape & { optional?: boolean }>
    }

export type BuilderFunction = {
  name: string
  /**
   * The comment on the builder function, without the code examples: what it
   * is for and what the template has to know. A link to a source file keeps
   * only its text, since the reader of the manifest has no source tree.
   */
  description: string
  /** The code examples in the comment, in TypeScript, when it has any. */
  example?: string
  options: Option[]
  returns: ResultShape
}

/*
 * The order of allowed values. TypeScript gives a union in the order the
 * types were created, not the order they are written in, so the order is
 * taken from the lists the builder functions themselves advertise
 * (`lt.button.variants` and the like) when one of them has exactly the same
 * values.
 */
const lists: string[][] = []
for (const value of Object.values(lt)) {
  if (Array.isArray(value)) lists.push([...value])
  if (typeof value !== "function") continue
  for (const own of Object.values(value))
    if (Array.isArray(own) && own.every((x) => typeof x === "string"))
      lists.push([...own])
}
function ordered(values: string[]): string[] {
  const set = [...values].sort().join("\u0000")
  return lists.find((l) => [...l].sort().join("\u0000") === set) ?? values
}

let cached: BuilderFunction[] | undefined

/** The builder functions in `lt`, sorted by name. Read once per process. */
export function readBuilderFunctions(): BuilderFunction[] {
  if (cached) return cached

  const config = ts.getParsedCommandLineOfConfigFile(
    `${PACKAGE}tsconfig.json`,
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
  )
  if (!config) throw new Error("Could not find tsconfig.json")
  const program = ts.createProgram(config.fileNames, config.options)
  const checker = program.getTypeChecker()
  const source = program.getSourceFile(`${PACKAGE}src/lt.ts`)
  if (!source) throw new Error("Could not find src/lt.ts in the program")

  let ltName: ts.Identifier | undefined
  source.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) return
    for (const d of node.declarationList.declarations)
      if (ts.isIdentifier(d.name) && d.name.text === "lt") ltName = d.name
  })
  if (!ltName) throw new Error("Could not find `export const lt` in src/lt.ts")

  const show = (t: ts.Type) => checker.typeToString(t)
  const members = (t: ts.Type) =>
    (t.isUnion() ? t.types : [t]).filter(
      (d) => !(d.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)),
    )

  function optionType(t: ts.Type, where: string): OptionType {
    const d = members(t)
    if (d.every((x) => x.isStringLiteral()))
      return {
        kind: "values",
        values: ordered(d.map((x) => (x as ts.StringLiteralType).value)),
      }
    if (d.every((x) => x.flags & ts.TypeFlags.BooleanLike))
      return { kind: "flag" }
    if (d.length === 1 && d[0].flags & ts.TypeFlags.String)
      return { kind: "text" }
    if (d.length === 1 && d[0].flags & ts.TypeFlags.Number)
      return { kind: "number" }
    if (
      d.length === 1 &&
      checker.isArrayType(d[0]) &&
      checker.getTypeArguments(d[0] as ts.TypeReference)[0].flags &
        ts.TypeFlags.String
    )
      return { kind: "textList" }
    throw new Error(
      `${where} has a type the manifest does not know: ${show(t)}. Add it to optionType().`,
    )
  }

  /** Whether the type is an attribute set: every value is text, or `true` for a flag. */
  function isAttributeSet(t: ts.Type): boolean {
    const props = t.getProperties()
    return (
      props.length > 0 &&
      props.every((p) =>
        members(checker.getTypeOfSymbol(p)).every(
          (d) =>
            d.flags & ts.TypeFlags.StringLike ||
            (d.flags & ts.TypeFlags.BooleanLiteral && show(d) === "true"),
        ),
      )
    )
  }

  function resultShape(t: ts.Type, where: string): ResultShape {
    const d = members(t)
    if (d.length === 1 && checker.isArrayType(d[0]))
      return {
        kind: "list",
        of: resultShape(
          checker.getTypeArguments(d[0] as ts.TypeReference)[0],
          where,
        ),
      }
    if (d.every((x) => x.isStringLiteral()))
      return {
        kind: "values",
        values: ordered(d.map((x) => (x as ts.StringLiteralType).value)),
      }
    if (d.length === 1 && d[0].flags & ts.TypeFlags.String)
      return { kind: "text" }
    if (d.length === 1 && isAttributeSet(d[0])) return { kind: "attributes" }
    if (d.length === 1 && d[0].flags & ts.TypeFlags.Object) {
      const fields: Record<string, ResultShape & { optional?: boolean }> = {}
      for (const p of d[0].getProperties()) {
        const optional = (p.flags & ts.SymbolFlags.Optional) !== 0
        fields[p.name] = {
          ...resultShape(checker.getTypeOfSymbol(p), `${where}.${p.name}`),
          ...(optional ? { optional: true } : {}),
        }
      }
      return { kind: "group", fields }
    }
    throw new Error(
      `${where} returns a shape the manifest does not know: ${show(t)}`,
    )
  }

  /** The `/** … *\/` comment right before a node, as text without the stars. */
  function commentBefore(node: ts.Node | undefined): string {
    if (!node) return ""
    const file = node.getSourceFile()
    const ranges = (
      ts.getLeadingCommentRanges(file.text, node.getFullStart()) ?? []
    ).filter((r) => file.text.startsWith("/**", r.pos))
    const range = ranges[ranges.length - 1]
    if (!range) return ""
    return file.text
      .slice(range.pos + 3, range.end - 2)
      .split("\n")
      .map((line) => line.replace(/^\s*\* ?/, ""))
      .join("\n")
      .trim()
  }

  /** The statement a declaration stands in, which is where its comment is. */
  function statementOf(symbol: ts.Symbol | undefined): ts.Node | undefined {
    let node: ts.Node | undefined = symbol?.valueDeclaration
    while (
      node &&
      !ts.isVariableStatement(node) &&
      !ts.isFunctionDeclaration(node)
    )
      node = node.parent
    return node
  }

  /**
   * The comment on the function itself. The comment is read as text rather
   * than through the checker, which takes `@` in an example, like an address
   * with `@` in it, for a tag and cuts the comment there. A function listed
   * in `lt` has its comment where it is declared, also one listed under
   * another name, as `switch: switchControl`; a declaration without one, as
   * `computeFieldAttributes`, has it on the property in `lt`, and so does a
   * shorthand whose declaration has none.
   */
  function documentation(p: ts.Symbol): {
    description: string
    example?: string
  } {
    const property = p.valueDeclaration
    const resolve = (symbol: ts.Symbol | undefined) =>
      symbol && symbol.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(symbol)
        : symbol
    let text = ""
    if (property && ts.isShorthandPropertyAssignment(property))
      text =
        commentBefore(
          statementOf(
            resolve(checker.getShorthandAssignmentValueSymbol(property)),
          ),
        ) || commentBefore(property)
    else if (property && ts.isPropertyAssignment(property))
      text =
        commentBefore(
          statementOf(
            resolve(checker.getSymbolAtLocation(property.initializer)),
          ),
        ) || commentBefore(property)
    const code = [...text.matchAll(/```\w*\n([\s\S]*?)```/g)].map((m) =>
      m[1].trimEnd(),
    )
    const description = text
      .replace(/```[\s\S]*?```/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\.js\)/g, "$1")
      .split(/\n\s*\n/)
      // A paragraph is joined into one line, but a list keeps one line per
      // item.
      .map((paragraph) =>
        paragraph
          .trim()
          .replace(/\s*\n\s*(?!- )/g, " ")
          .replace(/\s*\n\s*(?=- )/g, "\n"),
      )
      // A paragraph that starts "In React" is advice for one environment, and
      // TypeScript shows it in the editor. The manifest is read by the others,
      // so it is left out there. Any other mention of React stops the build,
      // so a general rule is never dropped because it names React.
      .filter((paragraph) => {
        if (/^In React\b/.test(paragraph)) {
          // The whole paragraph goes, so it must be React advice and nothing
          // else: a general rule after it would go with it.
          if ((paragraph.match(/[.!?](\s|$)/g) ?? []).length > 1)
            throw new Error(
              `lt.${p.name}: the paragraph "${paragraph.slice(0, 60)}…" starts with "In React" and has more than one sentence. The manifest leaves it out whole, so put anything else in a paragraph of its own.`,
            )
          return false
        }
        if (/\bReact\b/.test(paragraph))
          throw new Error(
            `lt.${p.name}: a paragraph in the comment mentions React without starting with "In React": ${paragraph.slice(0, 80)}… The manifest leaves out only paragraphs that start that way.`,
          )
        return Boolean(paragraph)
      })
      .join("\n\n")
    if (!description)
      throw new Error(
        `lt.${p.name} has no comment. Write one on the function: the manifest, the Kotlin API and the editors show it.`,
      )
    return {
      description,
      ...(code.length ? { example: code.join("\n\n") } : {}),
    }
  }

  const builderFunctions: BuilderFunction[] = []
  for (const p of checker.getTypeAtLocation(ltName).getProperties()) {
    const signature = checker.getTypeOfSymbol(p).getCallSignatures()[0]
    // Lists like `lt.states` and guards like `lt.isState` are not builder
    // functions. `setAttributes` puts a set on a DOM element and has no
    // counterpart outside the browser.
    if (!signature || p.name.startsWith("is") || p.name === "setAttributes")
      continue
    const parameter = signature.getParameters()[0]
    const options: Option[] = []
    if (parameter) {
      const optionsType = checker.getNonNullableType(
        checker.getTypeOfSymbol(parameter),
      )
      for (const v of optionsType.getProperties()) {
        // Only the first paragraph: the rest is notes for whoever maintains
        // the type, with React advice and history, and does not belong in the contract.
        const description = ts
          .displayPartsToString(v.getDocumentationComment(checker))
          .trim()
          .split(/\n\s*\n/)[0]
          .replace(/\s*\n\s*/g, " ")
        // The first paragraph goes to every language, so it must not be
        // advice for React; that belongs in a later paragraph.
        if (/\bReact\b/.test(description))
          throw new Error(
            `lt.${p.name}({ ${v.name} }): the first paragraph of the comment mentions React. It is what every other language shows, so put the React advice in a paragraph after it.`,
          )
        options.push({
          name: v.name,
          required: (v.flags & ts.SymbolFlags.Optional) === 0,
          type: optionType(
            checker.getTypeOfSymbol(v),
            `lt.${p.name}({ ${v.name} })`,
          ),
          ...(description ? { description } : {}),
        })
      }
    }
    builderFunctions.push({
      name: p.name,
      ...documentation(p),
      options,
      returns: resultShape(signature.getReturnType(), `lt.${p.name}()`),
    })
  }
  builderFunctions.sort((a, b) => a.name.localeCompare(b.name))
  cached = builderFunctions
  return cached
}

/** The sets a result consists of: one for `button`, one per part for `dialog`. */
export function setsOf(result: unknown): [string, Record<string, unknown>][] {
  if (typeof result !== "object" || result === null) return []
  const values = Object.entries(result as Record<string, unknown>)
  return values.some(([, v]) => typeof v === "object" && v !== null)
    ? (values.filter(
        ([, v]) => typeof v === "object" && v !== null && !Array.isArray(v),
      ) as [string, Record<string, unknown>][])
    : [["", result as Record<string, unknown>]]
}

/**
 * The flags a builder function gives: `data-interactive` on `lt-card` when
 * `interactive` is on, `data-optional` on `lt-label` when `optional` is on.
 * A flag is on when it is present, and the stylesheet only asks whether it
 * exists, so it has no list of values.
 *
 * It is read by calling the function: when a `data-*` attribute is a flag in
 * the result with the boolean option on, but not without, it belongs to the
 * classes in the same set. `base` is the options the call needs in order to
 * work, such as an id. Only classes in `known` are counted, so a name that
 * is not in the CSS does not get an entry by itself.
 */
export function flagsFor(
  b: BuilderFunction,
  build: (options: Record<string, unknown>) => unknown,
  base: Record<string, unknown>,
  known: (className: string) => boolean,
): Map<string, Set<string>> {
  const flags = new Map<string, Set<string>>()
  const without = new Map(setsOf(build(base)))
  for (const option of b.options) {
    if (option.type.kind !== "flag") continue
    for (const [name, set] of setsOf(build({ ...base, [option.name]: true }))) {
      const classNames = String(set.class ?? "")
        .split(/\s+/)
        .filter(known)
      for (const [attribute, value] of Object.entries(set))
        if (
          attribute.startsWith("data-") &&
          (value === true || value === "") &&
          without.get(name)?.[attribute] === undefined
        )
          for (const className of classNames)
            flags.set(
              className,
              (flags.get(className) ?? new Set()).add(attribute),
            )
    }
  }
  return flags
}
