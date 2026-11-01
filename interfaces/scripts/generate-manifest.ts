/**
 * Writes the manifest: what LO-TEK promises, as data every tool reads.
 *
 * Three files, all generated and checked in:
 *
 *   - `manifest/manifest.json`: the vocabulary (the elements and the classes,
 *     the same as `classes.ts` and `elements.ts`) and every builder function
 *     in `lt` with its options and the shape of its result. It is small, and
 *     every host hands it to the Rust core.
 *   - `manifest/build-cases.json`: every builder function called with many
 *     combinations of its options, with the result TypeScript gives. A port
 *     in another language must give exactly the same result for every case.
 *   - `manifest/files.json`: the rulebooks and the component files the
 *     command line reads from the package.
 *
 * Nothing here is written by hand. The options and their types are read by
 * the TypeScript compiler from the signatures in `src/lt.ts`, in
 * `builder-functions.ts`, and the results come from calling the functions. A
 * new builder function, option or variant ends up in the manifest on the
 * next build. `bun run build` rewrites the files before it checks anything,
 * so an out-of-date file on disk does not stop the build; it is the CI step
 * that checks nothing is ungenerated that fails a change where the files
 * have not been regenerated and committed.
 *
 * Run with: bun scripts/generate-manifest.ts, or as part of `generate`.
 */

import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { fileURLToPath } from "node:url"
import { DEFAULT_LANGUAGE } from "../src/components/default-texts.js"
import { lt } from "../src/lt.js"
import { FAMILIES, NEUTRAL_LAYERS, ROLES } from "../src/tokens/matrix-cells.js"
import {
  Breakpoints,
  Containers,
  colorTokens,
  cssTokens,
  FAMILY_DESCRIPTIONS,
  LAYER_DESCRIPTIONS,
  ROLE_DESCRIPTIONS,
} from "../src/tokens/tokens.js"
import { classes } from "../src/vocabulary/classes.js"
import { elements } from "../src/vocabulary/elements.js"
import {
  type BuilderFunction as Base,
  type Option,
  type OptionType,
  readBuilderFunctions,
  setsOf,
} from "./builder-functions.js"

const PACKAGE = fileURLToPath(new URL("..", import.meta.url))
const OUT = `${PACKAGE}manifest/`
const SCHEMA_VERSION = 1
const version: string = JSON.parse(
  readFileSync(`${PACKAGE}package.json`, "utf8"),
).version

type BuilderFunction = Base & {
  table?: Tables
  classes?: Record<string, string>
}

const builderFunctions: BuilderFunction[] = readBuilderFunctions()

/*
 * The cases. Each option is tried alone, and then all combinations when there
 * are few enough. When there are too many, a fixed sample is drawn with a
 * fixed seed, so the file is the same from build to build. The text values
 * include whitespace that JavaScript counts as whitespace and Java by default
 * does not, a no-break space and a BOM: without them, a port that splits on
 * ASCII whitespace alone would have passed.
 */
const TRIAL_VALUES: Record<OptionType["kind"], unknown[]> = {
  values: [],
  flag: [false, true],
  text: ["x", "a b", ""],
  number: [0, 1, 3],
  // `["x", "y"]` is the only valid one with several: without it, the tabs and
  // the options were never tried with more than one key.
  textList: [
    [],
    ["x"],
    ["x", "y"],
    ["x", "x"],
    ["  x   y "],
    ["x y"],
    ["﻿x"],
    [""],
  ],
}
const trialValues = (v: Option) => {
  const values =
    v.type.kind === "values" ? v.type.values : TRIAL_VALUES[v.type.kind]
  // An empty required id makes TypeScript create a random id and warn in the
  // console. The result then differs from run to run, and a typed language
  // stops it before it runs. It is not tried.
  if (v.required && v.type.kind === "text" && /^id$|Id$/.test(v.name))
    return values.filter((x) => x !== "")
  // Another required text, such as `label` in `tabs`, throws when empty, and
  // is also tried with only whitespace, as JavaScript counts it.
  if (v.required && v.type.kind === "text") return [...values, " \u00a0\ufeff"]
  if (v.required) return values
  return [undefined, ...values]
}

const MAX_COMBINATIONS = 512
const SAMPLE_SIZE = 256

type Case = {
  builder: string
  options: Record<string, unknown>
  expected?: unknown
  throws?: string
}

function combinations(options: Option[]): Record<string, unknown>[] {
  const axes = options.map(trialValues)
  const base = Object.fromEntries(
    options.flatMap((v, i) => (v.required ? [[v.name, axes[i][0]]] : [])),
  )
  const out: Record<string, unknown>[] = [{ ...base }]
  options.forEach((v, i) => {
    for (const value of axes[i]) out.push({ ...base, [v.name]: value })
  })
  const count = axes.reduce((n, a) => n * a.length, 1)
  if (count <= MAX_COMBINATIONS) {
    let all: Record<string, unknown>[] = [{}]
    options.forEach((v, i) => {
      all = all.flatMap((partial) =>
        axes[i].map((value) => ({ ...partial, [v.name]: value })),
      )
    })
    out.push(...all)
  } else {
    let seed = 20261007
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31
      return seed % n
    }
    for (let n = 0; n < SAMPLE_SIZE; n++)
      out.push(
        Object.fromEntries(
          options.map((v, i) => [v.name, axes[i][random(axes[i].length)]]),
        ),
      )
  }
  // `undefined` means left out, and two cases that differ only there are the
  // same case.
  const unique = new Map<string, Record<string, unknown>>()
  for (const o of out) {
    const cleaned = Object.fromEntries(
      Object.entries(o).filter(([, x]) => x !== undefined),
    )
    unique.set(JSON.stringify(cleaned), cleaned)
  }
  return [...unique.values()]
}

const cases: Case[] = []
// The builder functions warn in the console about use they do not like. That
// is part of what they do in the browser, not of the result, and here it is noise.
const warn = console.warn
console.warn = () => {}
try {
  for (const b of builderFunctions) {
    const build = (lt as unknown as Record<string, (o: unknown) => unknown>)[
      b.name
    ]
    for (const options of combinations(b.options)) {
      try {
        cases.push({ builder: b.name, options, expected: build(options) })
      } catch (error) {
        cases.push({
          builder: b.name,
          options,
          throws: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }
} finally {
  console.warn = warn
}

/*
 * The table: a builder function where each option adds fixed attributes,
 * independent of the other options, can be described as a base set and what
 * each option contributes. Another language can then build it from the
 * manifest alone, without anyone writing it by hand.
 *
 * The table is derived from the results, not from the code, and it is only
 * included when it gives exactly what TypeScript returned for every single
 * case. A builder function where the options interact, such as `label`, where
 * `optional` does not apply when `required` is set, gets no table and is
 * written by hand.
 *
 * The values are text. A boolean attribute that is on is the empty string,
 * and `null` means the option removes an attribute the base set has. A value
 * that is exactly `{name}` is the value of the option with that name, as in
 * `{ "aria-labelledby": "{titleId}" }` in `dialog`. A builder function that
 * returns several sets, such as `dialog` and `popover`, gets one table per set.
 */
type Attributes = Record<string, string | null>
type TableOption = {
  cases: Record<string, Attributes>
  template?: Attributes
  empty?: Attributes
}
type Table = { base: Attributes; options: Record<string, TableOption> }
type Tables =
  | { kind: "attributes"; table: Table }
  | { kind: "group"; fields: Record<string, Table> }

const asText = (values: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(values).map(([k, v]) => [k, v === true ? "" : String(v)]),
  )

function difference(
  base: Record<string, string>,
  result: Record<string, string>,
): Attributes {
  const d: Attributes = {}
  for (const k of new Set([...Object.keys(base), ...Object.keys(result)]))
    if (result[k] !== base[k]) d[k] = result[k] ?? null
  return d
}

const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b)
// The order of the attributes does not matter for the result.
const sorted = (x: Record<string, string>) =>
  Object.fromEntries(Object.entries(x).sort(([a], [c]) => (a < c ? -1 : 1)))

/** Replaces values that are exactly the value of a required option with `{name}`. */
function withPlaceholders(
  a: Attributes,
  required: [string, string][],
): Attributes {
  return Object.fromEntries(
    Object.entries(a).map(([k, x]) => {
      const match = required.find(([, value]) => value === x)
      return [k, match ? `{${match[0]}}` : x]
    }),
  )
}

/** The table for one set, where `pick` picks the set out of the result. */
function tableFor(
  b: BuilderFunction,
  own: Case[],
  baseOptions: Record<string, unknown>,
  pick: (result: unknown) => Record<string, unknown>,
): Table | undefined {
  const required = Object.entries(baseOptions).map(
    ([k, v]) => [k, String(v)] as [string, string],
  )
  const baseCase = own.find((t) => equal(t.options, baseOptions))
  if (!baseCase) return undefined
  const base = asText(pick(baseCase.expected))

  const options: Record<string, TableOption> = {}
  for (const v of b.options) {
    if (v.required) continue
    const single = own.filter(
      (t) =>
        Object.keys(t.options).length === required.length + 1 &&
        v.name in t.options &&
        required.every(([k]) => equal(t.options[k], baseOptions[k])),
    )
    const entry: TableOption = { cases: {} }
    for (const t of single) {
      const value = t.options[v.name]
      const d = withPlaceholders(
        difference(base, asText(pick(t.expected))),
        required,
      )
      if (v.type.kind === "values" || v.type.kind === "flag") {
        entry.cases[String(value)] = d
        continue
      }
      if (v.type.kind === "textList") return undefined
      // Text and numbers: where the value is, the placeholder goes.
      const s = String(value)
      if (s === "") {
        entry.empty = d
        continue
      }
      const template = Object.fromEntries(
        Object.entries(d).map(([k, x]) => [k, x === s ? `{${v.name}}` : x]),
      )
      if (entry.template && !equal(entry.template, template)) return undefined
      entry.template = template
    }
    options[v.name] = entry
  }

  const table: Table = { base: withPlaceholders(base, required), options }
  for (const t of own) {
    const expected = sorted(asText(pick(t.expected)))
    if (!equal(apply(table, b, t.options), expected)) return undefined
  }
  return table
}

function tables(b: BuilderFunction): Tables | undefined {
  const own = cases.filter((t) => t.builder === b.name)
  if (own.length === 0 || own.some((t) => t.throws)) return undefined
  // The base is the required options with their first trial value, and no others.
  const baseOptions = Object.fromEntries(
    b.options.filter((v) => v.required).map((v) => [v.name, trialValues(v)[0]]),
  )
  if (b.returns.kind === "attributes") {
    const table = tableFor(
      b,
      own,
      baseOptions,
      (result) => result as Record<string, unknown>,
    )
    return table && { kind: "attributes", table }
  }
  if (b.returns.kind !== "group") return undefined
  const fields: Record<string, Table> = {}
  for (const [name, field] of Object.entries(b.returns.fields)) {
    if (field.kind !== "attributes" || field.optional) return undefined
    const table = tableFor(
      b,
      own,
      baseOptions,
      (result) => (result as Record<string, Record<string, unknown>>)[name],
    )
    if (!table) return undefined
    fields[name] = table
  }
  return { kind: "group", fields }
}

/** The result the table gives for the options. Used to check it. */
function apply(
  t: Table,
  b: BuilderFunction,
  options: Record<string, unknown>,
): Record<string, string> {
  const fill = (a: Attributes): Attributes =>
    Object.fromEntries(
      Object.entries(a).map(([k, x]) => {
        const name = x?.match(/^\{(\w+)\}$/)?.[1]
        return [
          k,
          name !== undefined && name in options ? String(options[name]) : x,
        ]
      }),
    )
  const result: Attributes = fill(t.base)
  for (const v of b.options) {
    if (v.required || !(v.name in options)) continue
    const value = options[v.name]
    const tv = t.options[v.name]
    const contribution =
      v.type.kind === "values" || v.type.kind === "flag"
        ? tv.cases[String(value)]
        : String(value) === "" && tv.empty
          ? tv.empty
          : tv.template
    if (!contribution) return { "\u0000": "missing" }
    Object.assign(result, fill(contribution))
  }
  const out: Record<string, string> = {}
  for (const [k, x] of Object.entries(result)) if (x !== null) out[k] = x
  return sorted(out)
}

for (const b of builderFunctions) {
  const t = tables(b)
  if (t) b.table = t
}

/*
 * The classes a builder function carries for the parts the template writes
 * itself: `lt.card.title`, `lt.toggleGroup.option`. In TypeScript they are
 * string constants hung on the function, and another language could not
 * reach them, so a Kotlin template wrote `lt-card__title` as text. A
 * constant whose class a set of the function's own answer writes, as
 * `lt.dialog.title`, is left out: there the set is the way.
 */
for (const b of builderFunctions) {
  const written = new Set(
    cases
      .filter((t) => t.builder === b.name && t.expected)
      .flatMap((t) => setsOf(t.expected))
      .flatMap(([, set]) => String(set.class ?? "").split(/\s+/)),
  )
  const constants = Object.entries(
    lt[b.name as keyof typeof lt] as unknown as Record<string, unknown>,
  ).filter(
    (entry): entry is [string, string] =>
      typeof entry[1] === "string" &&
      entry[1].startsWith("lt-") &&
      !written.has(entry[1]),
  )
  if (constants.length > 0) b.classes = Object.fromEntries(constants)
}

/*
 * The description of a class attribute is the description of the option with
 * the same name, `variant` for `data-variant`, and the class is found as for
 * the flags above: a case with the option against the same case without it.
 * An option with a different name can also change the attribute, as `type`
 * does with `data-variant` in `lt.input()`, but then it describes something
 * else. When several builder functions write the same attribute, the first
 * in alphabetical order wins.
 */
const descriptions = new Map<string, string>()
for (const builder of builderFunctions) {
  const own = cases.filter((t) => t.builder === builder.name && t.expected)
  for (const option of builder.options) {
    if (!option.description) continue
    const attribute = `data-${option.name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`
    for (const withOption of own.filter(
      (t) => t.options[option.name] !== undefined,
    )) {
      const { [option.name]: _, ...withoutOption } = withOption.options
      const base = own.find((t) => equal(t.options, withoutOption))
      if (!base) continue
      const before = new Map(setsOf(base.expected))
      for (const [setName, set] of setsOf(withOption.expected)) {
        if (equal(set[attribute], before.get(setName)?.[attribute])) continue
        const classNames = String(set.class ?? "")
          .split(/\s+/)
          .filter((c) => classes[c])
        for (const className of classNames)
          if (!descriptions.has(`${className} ${attribute}`))
            descriptions.set(`${className} ${attribute}`, option.description)
      }
    }
  }
}
const withDescriptions = (
  className: string,
  attributes: Record<string, object>,
) =>
  Object.fromEntries(
    Object.entries(attributes).map(([attribute, value]) => {
      const description = descriptions.get(`${className} ${attribute}`)
      return [attribute, description ? { ...value, description } : value]
    }),
  )

const classEntries = Object.fromEntries(
  Object.entries(classes).map(([name, info]) => [
    name,
    {
      ...info,
      attributes: withDescriptions(
        name,
        // The flags, such as `data-interactive` on `lt-card`, are in
        // `classes.ts` with an empty value list, since the editors read that
        // file. Here a flag has no values, see `types.ts`. They are derived
        // from the builder function each time the vocabulary is written, see
        // `flagsFor` in builder-functions.ts, so a flag that is gone from the
        // function is gone here too.
        Object.fromEntries(
          Object.entries(info.attributes).map(([attribute, value]) => [
            attribute,
            value.flag ? { flag: true } : value,
          ]),
        ),
      ),
    },
  ]),
)

/*
 * The tokens: what a stylesheet outside the package can build on without
 * inventing values of its own. The spacing scale, the breakpoints and the
 * container widths are read from `tokens.ts`, where the breakpoints and the
 * widths otherwise exist only in TypeScript. The colours are listed as axes
 * with what they are for, not as hex: the hue is the consumer's, and a theme
 * can have other values than LO-TEK's own.
 *
 * The component variables are read from the stylesheets. A variable is the
 * first argument of `var(--lt-<component>-…, <fallback>)`, and the fallback is
 * the default the consumer overrides. When the same variable appears with two
 * fallbacks, such as `--lt-list-gap` in a shared list, the first one in the
 * stylesheet applies. Each belongs to the component its name starts with,
 * not to the stylesheet it is read in: `fieldset.css` reads
 * `--lt-label-required-symbol`, and it belongs to the label.
 */
const roleToCss = (role: string) =>
  role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
const COMPONENT_DIRS = ["css", "frame", "standalone"].flatMap((category) =>
  readdirSync(`${PACKAGE}src/components/${category}`)
    .filter((name) =>
      statSync(`${PACKAGE}src/components/${category}/${name}`).isDirectory(),
    )
    .sort()
    .map((name) => ({
      name,
      path: `${PACKAGE}src/components/${category}/${name}`,
    })),
)
const componentNames = COMPONENT_DIRS.map((d) => d.name)
/** The component a variable belongs to: the longest name it starts with. */
const ownerOf = (variable: string, fallback: string) =>
  componentNames
    .filter((name) => variable.startsWith(`--lt-${name}-`))
    .sort((a, b) => b.length - a.length)[0] ?? fallback
const TOKEN_KINDS = new Set(
  Object.keys({ ...cssTokens, ...colorTokens }).map(
    (name) => name.split("-")[3],
  ),
)
/*
 * The variables a web component writes itself, such as `--lt-popover-top`,
 * are not something the consumer overrides: the inline style beats a
 * stylesheet. They are read with a fallback in the CSS like all the others,
 * and are recognised by `setProperty` in the component's own source.
 */
const setByComponent = new Set<string>()
for (const { path } of COMPONENT_DIRS)
  for (const file of readdirSync(path).filter(
    (f) => f.endsWith(".ts") && !f.includes(".test."),
  ))
    for (const m of readFileSync(`${path}/${file}`, "utf8").matchAll(
      /setProperty\(\s*["'](--lt-[a-z0-9-]+)["']/g,
    ))
      setByComponent.add(m[1])
const componentVariables: Record<string, Record<string, string>> = {}
for (const { name, path } of COMPONENT_DIRS) {
  for (const file of readdirSync(path)
    .filter((f) => f.endsWith(".css"))
    .sort()) {
    const css = readFileSync(`${path}/${file}`, "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    )
    const pattern = /var\(\s*(--lt-[a-z0-9-]+)\s*,/g
    for (let m = pattern.exec(css); m; m = pattern.exec(css)) {
      // The fallback runs to the parenthesis that closes `var(`, also when it
      // has `calc()` or another `var()` in it.
      let depth = 1
      let i = pattern.lastIndex
      for (; i < css.length && depth > 0; i++) {
        if (css[i] === "(") depth++
        else if (css[i] === ")") depth--
      }
      const variable = m[1]
      // A token belongs on the token side, not here. Today no component reads
      // a token with a fallback, but if one did, it would look like a
      // component variable without this.
      if (TOKEN_KINDS.has(variable.split("-")[3])) continue
      if (setByComponent.has(variable)) continue
      const fallback = css
        .slice(pattern.lastIndex, i - 1)
        .trim()
        .replace(/\s+/g, " ")
      const owner = ownerOf(variable, name)
      componentVariables[owner] ??= {}
      componentVariables[owner][variable] ??= fallback
    }
  }
}
const tokens = {
  spacing: Object.fromEntries(
    Object.entries(cssTokens).filter(([name]) =>
      name.startsWith("--lt-spacing-"),
    ),
  ),
  breakpoints: Breakpoints,
  containers: Containers,
  colors: {
    families: Object.fromEntries(
      FAMILIES.map((family) => [family, FAMILY_DESCRIPTIONS[family]]),
    ),
    roles: Object.fromEntries(
      (Object.keys(ROLES) as (keyof typeof ROLES)[]).map((role) => [
        roleToCss(role),
        ROLE_DESCRIPTIONS[role],
      ]),
    ),
    layers: Object.fromEntries(
      (Object.keys(NEUTRAL_LAYERS) as (keyof typeof NEUTRAL_LAYERS)[]).map(
        (layer) => [layer, LAYER_DESCRIPTIONS[layer]],
      ),
    ),
    tokens: Object.keys(colorTokens).filter((name) =>
      name.startsWith("--lt-color-"),
    ),
  },
  components: Object.fromEntries(
    Object.entries(componentVariables).sort(([a], [b]) => a.localeCompare(b)),
  ),
}

const manifest = {
  $schema: "./manifest.schema.json",
  schemaVersion: SCHEMA_VERSION,
  version: version,
  textLanguage: DEFAULT_LANGUAGE,
  elements,
  classes: classEntries,
  builders: builderFunctions,
  tokens,
}

mkdirSync(OUT, { recursive: true })
writeFileSync(`${OUT}manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`)
writeFileSync(
  `${OUT}build-cases.json`,
  `${JSON.stringify({ version: version, cases: cases })}\n`,
)

/*
 * The files the command line reads from the package: the rulebooks for
 * `lotek agent` and the source of each component for `lotek takeover`,
 * without the tests. It reads the list rather than the folders, because a
 * folder could not be read through Node's WASI on Windows: `takeover` found
 * no components there.
 */
const ls = (folder: string) => readdirSync(`${PACKAGE}${folder}`).sort()
const files = {
  agent: ls("agent")
    .filter((file) => file.endsWith(".md"))
    .map((file) => file.slice(0, -3)),
  components: ["css", "frame", "standalone"].flatMap((category) =>
    ls(`src/components/${category}`)
      .filter((name) =>
        statSync(`${PACKAGE}src/components/${category}/${name}`).isDirectory(),
      )
      .map((name) => ({
        category: category,
        name: name,
        files: ls(`src/components/${category}/${name}`).filter(
          (file) => !file.includes(".test."),
        ),
      })),
  ),
}
writeFileSync(`${OUT}files.json`, `${JSON.stringify(files, null, 2)}\n`)

console.log(
  `✓ The manifest: ${builderFunctions.length} builder functions, ${Object.keys(elements).length} elements, ${Object.keys(classes).length} classes, ${cases.length} build cases, ${Object.values(componentVariables).reduce((n, v) => n + Object.keys(v).length, 0)} component variables.`,
)
