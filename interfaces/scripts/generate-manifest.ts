/**
 * Writes the manifest: what LO-TEK promises, as data every tool reads.
 *
 * Four files, all generated and checked in:
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
 *   - `manifest/anatomy-cases.json`: every anatomy rendered by
 *     `renderAnatomy()`, as created and with each change a design tool
 *     makes, with how the instance was made. A renderer in another
 *     language must give exactly the same, and make the same instances.
 *
 * The builder functions are not written by hand. The options and their
 * types are read by the TypeScript compiler from the signatures in
 * `src/lt.ts`, in `builder-functions.ts`, and the results come from calling
 * the functions. A new builder function, option or variant ends up in the
 * manifest on the next build. What the code cannot say is written once, in
 * `metadata.ts`: the parts, the content and the tags of a class, and which
 * part each set from a builder function fills (`BUILDER_PARTS`). The
 * generators stop when that table and the code disagree.
 *
 * `files()` gives the four files as a value, from an input that
 * `fromPackage()` reads from the package, and only the last lines here write
 * anything. `check-manifest.ts` calls the same function and compares in
 * memory, and the tests hand it a small input of their own.
 *
 * `bun run build` rewrites the files before it checks anything, so an
 * out-of-date file on disk does not stop the build; it is the CI step that
 * checks nothing is ungenerated that fails a change where the files have not
 * been regenerated and committed.
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
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import {
  type AnatomyInstance,
  canDrop,
  createdInstance,
  renderAnatomy,
  variantsOf,
  withItem,
} from "../src/anatomy/index.js"
import {
  aroundOf,
  holesOf,
  nodesOf,
  pathTo,
  tagsOf,
} from "../src/anatomy/walk.js"
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
import type {
  Anatomy,
  AnatomyForbidden,
  AnatomyNode,
  Classes,
  Elements,
  Manifest,
  ManifestClass,
  ManifestClassAttribute,
  Table,
  TableAttributes,
  Tables,
} from "../src/vocabulary/types.js"
import {
  type BuilderFunction as Base,
  type Option,
  readBuilderFunctions,
  setsOf,
} from "./builder-functions.js"
import { TRIAL_VALUES } from "./builder-sample.js"
import {
  BUILDER_ANATOMIES,
  BUILDER_PARTS,
  type BuilderPart,
  COMPONENTS,
} from "./metadata.js"

/** The package folder, which the paths from `files()` are relative to. */
export const ROOT = fileURLToPath(new URL("..", import.meta.url))
const SCHEMA_VERSION = 1

/**
 * A component folder: its files without the tests, sorted, and the text of
 * the TypeScript and the CSS among them.
 */
type ComponentFolder = {
  category: string
  name: string
  files: string[]
  sources: Record<string, string>
}

/**
 * Everything the manifest is written from. `fromPackage()` reads it from
 * the package, and is the only thing here that reads the disk; a test hands
 * in a small one.
 */
export type Input = {
  version: string
  /** The language of the texts the components write themselves. */
  textLanguage: string
  elements: Elements
  classes: Classes
  /** The builder functions as the TypeScript compiler reads them from `lt`. */
  builders: Base[]
  /**
   * The builder functions themselves, by name, to call. Each takes options
   * of its own type, so here they take ones nobody can make, and `buildCases()`
   * is the one place that hands them what the cases say.
   */
  lt: Record<string, (options: never) => unknown>
  /** `BUILDER_PARTS` in `metadata.ts`. */
  parts: Record<string, Record<string, BuilderPart | null>>
  /** `BUILDER_ANATOMIES` in `metadata.ts`. */
  anatomies: Record<string, Anatomy>
  tokens: {
    /** The tokens with a fixed value, by their CSS name. */
    css: Record<string, string>
    /** The colour tokens, by their CSS name. */
    colors: Record<string, string>
    breakpoints: Record<string, string>
    containers: Record<string, string>
    /** What each colour family, role and neutral layer is for. */
    families: Record<string, string>
    roles: Record<string, string>
    layers: Record<string, string>
  }
  /** The component folders, category by category and sorted by name in each. */
  components: ComponentFolder[]
  /** The components `metadata.ts` describes, by the name of their folder. */
  described: string[]
  /** The rulebooks in `agent/`, without `.md`, sorted. */
  agent: string[]
}

const roleToCss = (role: string) =>
  role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)

/** The input as the package has it. */
export function fromPackage(): Input {
  const ls = (folder: string) => readdirSync(join(ROOT, folder)).sort()
  return {
    version: JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))
      .version,
    textLanguage: DEFAULT_LANGUAGE,
    elements,
    classes,
    builders: readBuilderFunctions(),
    lt: lt as unknown as Input["lt"],
    parts: BUILDER_PARTS,
    anatomies: BUILDER_ANATOMIES,
    described: Object.keys(COMPONENTS),
    tokens: {
      css: cssTokens,
      colors: colorTokens,
      breakpoints: Breakpoints,
      containers: Containers,
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
    },
    components: ["css", "frame", "standalone"].flatMap((category) =>
      ls(`src/components/${category}`)
        .filter((name) =>
          statSync(join(ROOT, "src/components", category, name)).isDirectory(),
        )
        .map((name) => {
          const folder = `src/components/${category}/${name}`
          const files = ls(folder).filter((file) => !file.includes(".test."))
          return {
            category,
            name,
            files,
            sources: Object.fromEntries(
              files
                .filter((file) => file.endsWith(".ts") || file.endsWith(".css"))
                .map((file) => [
                  file,
                  readFileSync(join(ROOT, folder, file), "utf8"),
                ]),
            ),
          }
        }),
    ),
    /*
     * The files the command line reads from the package: the rulebooks for
     * `lotek agent` and, above, the source of each component for `lotek
     * takeover`, without the tests. It reads the list rather than the
     * folders, because a folder could not be read through Node's WASI on
     * Windows: `takeover` found no components there.
     */
    agent: ls("agent")
      .filter((file) => file.endsWith(".md"))
      .map((file) => file.slice(0, -3)),
  }
}

type BuilderFunction = Base & {
  anatomy?: Anatomy
  /** The page the builder function is documented on. */
  docs?: string
  parts?: Record<string, BuilderPart>
  table?: Tables
  classes?: Record<string, string>
}

/*
 * The cases. Each option is tried alone, and then all combinations when there
 * are few enough. When there are too many, a fixed sample is drawn with a
 * fixed seed, so the file is the same from build to build. The values of
 * each kind are `TRIAL_VALUES` in `builder-sample.ts`.
 */
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

/**
 * Runs it with `console.warn` silent. The builder functions and the
 * renderer warn in the console about use they do not like. That is part of
 * what they do in the browser, not of the result, and here it is noise.
 */
function silently<T>(run: () => T): T {
  const warn = console.warn
  console.warn = () => {}
  try {
    return run()
  } finally {
    console.warn = warn
  }
}

/** Every builder function called with the combinations of its options. */
function buildCases(
  builderFunctions: BuilderFunction[],
  lt: Input["lt"],
): Case[] {
  const cases: Case[] = []
  silently(() => {
    for (const b of builderFunctions) {
      const build = lt[b.name] as (options: unknown) => unknown
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
  })
  return cases
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
type Attributes = TableAttributes
type TableOption = Table["options"][string]

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

function tables(b: BuilderFunction, cases: Case[]): Tables | undefined {
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

/*
 * What HTML forbids inside an element, from the content models in the HTML
 * standard (documented): a form has "no form element descendants"
 * (4.10.3). `lotek check` reports the same, with the rule `invalid-nesting`
 * in the core, and `check-design-tool.ts` holds the two to each other.
 *
 * The core also reports interactive content in a link or a button (4.5.1,
 * 4.10.6). Whether a component is interactive there depends on its
 * attributes, as `href` and `tabindex`, which tags alone do not say, and no
 * hole that takes other elements stands in a link or a button. One that
 * does stops the build, so it is not answered wrongly.
 */
const FORBIDDEN: Record<string, AnatomyForbidden> = {
  form: {
    tags: ["form"],
    why: "A form cannot be inside another form: the browser drops the inner <form>.",
  },
}
const UNANSWERED = ["a", "button"]

/**
 * The anatomy with `forbids` on every hole that takes other elements, from
 * the tags around the hole. A node that can be several tags counts as all
 * of them.
 */
function withForbidden(
  builder: string,
  anatomy: Anatomy,
  anatomies: Input["anatomies"],
): Anatomy {
  const around = new Map<string, Set<string>>()
  for (const place of holesOf(anatomy))
    around.set(
      place.hole.hole,
      new Set([
        ...(around.get(place.hole.hole) ?? []),
        ...aroundOf(place).flatMap(tagsOf),
      ]),
    )
  const holes = Object.fromEntries(
    Object.entries(anatomy.holes).map(([name, hole]) => {
      if (hole.content !== "free") return [name, hole]
      const inside = UNANSWERED.find((tag) => around.get(name)?.has(tag))
      if (inside)
        throw new Error(
          `${builder}.${name} takes other elements inside <${inside}>, and the manifest cannot yet say what HTML forbids there.`,
        )
      for (const only of hole.only?.builders ?? [])
        if (!anatomies[only])
          throw new Error(
            `${builder}.${name} lets only ${only} in, and no builder function by that name has an anatomy.`,
          )
      const forbids = [...(around.get(name) ?? [])].flatMap((tag) =>
        FORBIDDEN[tag] ? [FORBIDDEN[tag]] : [],
      )
      return [name, forbids.length ? { ...hole, forbids } : hole]
    }),
  )
  return { ...anatomy, holes }
}

/**
 * Adds to each builder function what it alone does not say, in the order
 * the manifest writes it: the table, the classes, the defaults, the page,
 * the parts and the anatomy.
 */
function fillIn(
  builderFunctions: BuilderFunction[],
  cases: Case[],
  { lt, classes, elements, parts: builderParts, anatomies }: Input,
) {
  for (const b of builderFunctions) {
    const t = tables(b, cases)
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
    const strings = Object.entries(lt[b.name]).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    )
    // Every class is `lt-`, so a string constant on a builder function that is
    // not one is a mistake, and it stops here rather than vanishing from the
    // manifest without a word.
    for (const [key, value] of strings)
      if (!value.startsWith("lt-"))
        throw new Error(
          `lt.${b.name}.${key} is "${value}". A string constant on a builder function is a class, and every class starts with lt-.`,
        )
    const constants = strings.filter(([, value]) => !written.has(value))
    if (constants.length > 0) b.classes = Object.fromEntries(constants)
  }

  /*
   * The default of an option with a closed list: the value whose answer is the
   * same as the answer without the option, in the call with only what is
   * required. It is read from the answers, so it is what the function does,
   * and the comment on the option must say the same: a comment that names
   * another default, or none, stops the build. The comment is what TypeScript
   * shows, and the field is what the other languages generate theirs from.
   */
  for (const b of builderFunctions) {
    const own = cases.filter((t) => t.builder === b.name && t.expected)
    const required = b.options.filter((o) => o.required).map((o) => o.name)
    const base = own.find(
      (t) =>
        Object.keys(t.options).length === required.length &&
        required.every((name) => name in t.options),
    )
    for (const option of b.options) {
      if (option.type.kind !== "values" || option.required) continue
      const values = option.type.values
      const found = base
        ? values.filter((value) =>
            own.some(
              (t) =>
                equal(t.options, { ...base.options, [option.name]: value }) &&
                equal(t.expected, base.expected),
            ),
          )
        : []
      const written = option.description?.match(/Default: `([^`]+)`/)?.[1]
      const where = `lt.${b.name}({ ${option.name} })`
      if (found.length > 1)
        throw new Error(
          `${where}: ${found.join(" and ")} both give the same answer as no value. Only one of them can be the default.`,
        )
      const value = found[0]
      if (value !== undefined && written !== value)
        throw new Error(
          `${where}: the default is \`${value}\`, read from the answers, but the comment on the option ${written ? `says \`${written}\`` : "does not say so"}. End the comment with "Default: \`${value}\`."`,
        )
      if (value === undefined && written !== undefined)
        throw new Error(
          `${where}: the comment says the default is \`${written}\`, but no value gives the same answer as leaving the option out.`,
        )
      if (value !== undefined) option.default = value
    }
  }

  /*
   * The page each builder function is documented on: the element with the
   * same name, otherwise the class, otherwise the first class in its answer
   * that has a page. `lt.tableSort` is on the table's page that way.
   */
  const kebab = (name: string) =>
    name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
  const linkOf = (className: string): string | undefined =>
    classes[className]?.link
  for (const b of builderFunctions) {
    const name = `lt-${kebab(b.name)}`
    const answer = cases.find((t) => t.builder === b.name && t.expected)
    const fromAnswer = setsOf(answer?.expected)
      .flatMap(([, set]) => String(set.class ?? "").split(/\s+/))
      .map(linkOf)
      .find(Boolean)
    const link = elements[name]?.link ?? linkOf(name) ?? fromAnswer
    if (!link)
      throw new Error(
        `lt.${b.name} has no page: no element or class called ${name}, and no class in its answer with a link.`,
      )
    b.docs = link
  }

  /*
   * Which part of a frame component each set fills, from `BUILDER_PARTS` in
   * `metadata.ts`. Every set must be there, and every part must exist, so
   * the list cannot drift from the functions or from the components.
   */
  for (const b of builderFunctions) {
    if (b.returns.kind !== "group") {
      if (builderParts[b.name])
        throw new Error(
          `BUILDER_PARTS has lt.${b.name}, which returns one set. Take it out.`,
        )
      continue
    }
    const sets = Object.entries(b.returns.fields)
      .filter(
        ([, shape]) =>
          shape.kind === "attributes" ||
          (shape.kind === "list" && shape.of.kind === "attributes"),
      )
      .map(([field]) => field)
    const listed = builderParts[b.name] ?? {}
    const missing = sets.filter((field) => !(field in listed))
    const extra = Object.keys(listed).filter((field) => !sets.includes(field))
    if (missing.length || extra.length)
      throw new Error(
        `BUILDER_PARTS for lt.${b.name} must list exactly its sets, ${sets.join(", ")}.${missing.length ? ` Missing: ${missing.join(", ")}.` : ""}${extra.length ? ` Not a set: ${extra.join(", ")}.` : ""} Give each a part, or null when it fills none.`,
      )
    const parts: Record<string, BuilderPart> = {}
    for (const field of sets) {
      const target = listed[field]
      if (!target) continue
      const element = elements[target.element]
      if (!element?.parts?.[target.part])
        throw new Error(
          `BUILDER_PARTS says lt.${b.name}().${field} fills ${target.element}'s ${target.part}, and that part does not exist.`,
        )
      parts[field] = target
    }
    if (Object.keys(parts).length) b.parts = parts
  }

  /*
   * The anatomy each builder function belongs in, from `BUILDER_ANATOMIES` in
   * `metadata.ts`. A name there that is no builder function stops the build.
   */
  for (const name of Object.keys(anatomies))
    if (!builderFunctions.some((b) => b.name === name))
      throw new Error(
        `BUILDER_ANATOMIES has ${name}, and lt has no builder function by that name.`,
      )
  for (const b of builderFunctions)
    if (anatomies[b.name])
      b.anatomy = withForbidden(b.name, anatomies[b.name], anatomies)
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
function classEntriesOf(
  builderFunctions: BuilderFunction[],
  cases: Case[],
  classes: Classes,
) {
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
    attributes: Record<string, ManifestClassAttribute>,
  ): Record<string, ManifestClassAttribute> =>
    Object.fromEntries(
      Object.entries(attributes).map(([attribute, value]) => {
        const description = descriptions.get(`${className} ${attribute}`)
        return [attribute, description ? { ...value, description } : value]
      }),
    )

  return Object.fromEntries(
    Object.entries(classes).map(([name, info]): [string, ManifestClass] => [
      name,
      {
        ...info,
        attributes: withDescriptions(
          name,
          // The flags, such as `data-interactive` on `lt-card`, are in
          // `classes.ts` with an empty value list, since the editors read that
          // file. Here a flag has no values, see the schema. They are derived
          // from the builder function each time the vocabulary is written, see
          // `flagsFor` in builder-functions.ts, so a flag that is gone from the
          // function is gone here too.
          Object.fromEntries(
            Object.entries(info.attributes).map(
              ([attribute, value]): [string, ManifestClassAttribute] => [
                attribute,
                value.flag ? { flag: true } : value,
              ],
            ),
          ),
        ),
      },
    ]),
  )
}

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
function tokensOf({ tokens, components }: Input) {
  const componentNames = components.map((d) => d.name)
  /** The component a variable belongs to: the longest name it starts with. */
  const ownerOf = (variable: string, fallback: string) =>
    componentNames
      .filter((name) => variable.startsWith(`--lt-${name}-`))
      .sort((a, b) => b.length - a.length)[0] ?? fallback
  const TOKEN_KINDS = new Set(
    Object.keys({ ...tokens.css, ...tokens.colors }).map(
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
  for (const { sources } of components)
    for (const [file, text] of Object.entries(sources))
      if (file.endsWith(".ts"))
        for (const m of text.matchAll(
          /setProperty\(\s*["'](--lt-[a-z0-9-]+)["']/g,
        ))
          setByComponent.add(m[1])
  const componentVariables: Record<string, Record<string, string>> = {}
  for (const { name, sources } of components) {
    for (const [file, text] of Object.entries(sources)) {
      if (!file.endsWith(".css")) continue
      const css = text.replace(/\/\*[\s\S]*?\*\//g, "")
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
  return {
    spacing: Object.fromEntries(
      Object.entries(tokens.css).filter(([name]) =>
        name.startsWith("--lt-spacing-"),
      ),
    ),
    breakpoints: tokens.breakpoints,
    containers: tokens.containers,
    colors: {
      families: tokens.families,
      roles: tokens.roles,
      layers: tokens.layers,
      tokens: Object.keys(tokens.colors).filter((name) =>
        name.startsWith("--lt-color-"),
      ),
    },
    components: Object.fromEntries(
      Object.entries(componentVariables).sort(([a], [b]) => a.localeCompare(b)),
    ),
  }
}

/*
 * The anatomies as `renderAnatomy()` writes them, for a renderer in another
 * language to give exactly the same: every component as created, with an
 * item in each group that may have none, and with each change a design
 * tool makes from there. `change` says how the instance was made, so the
 * other language can make it too: a `variant` from `variantsOf()`, an item
 * inserted with `withItem()` first and last in each group, every `tag` a
 * node offers, every value of every `setting`, and `annotate`, where the
 * attributes are written with `{address}` for the element's address.
 * Repository only, as the build cases are.
 */
type AnatomyCase = {
  builder: string
  change: "variant" | "withItem" | "tag" | "setting" | "annotate"
  withItem?: { group: string; key: string; at: number }
  annotate?: Record<string, string>
  instance: AnatomyInstance
  expected: string
}
/** What a tool's annotate gives, with `{address}` for the address. */
const ANNOTATE = {
  "data-node": "{address}",
  id: "tool-{address}",
  class: "tool-node",
}
/**
 * Every node in an anatomy, the alternatives of each choice included, with
 * what makes it written: the alternatives chosen, the optional parts on and
 * the options on around it. `named` is the name its settings go under, the
 * choice's for an alternative without one, and `group` the innermost group
 * around it, which its settings are keyed by.
 */
type WrittenPlace = {
  node: AnatomyNode
  named?: string
  group?: string
  choices: Record<string, string>
  parts: Record<string, boolean>
  options: Record<string, boolean>
}
const placesOf = (anatomy: Anatomy): WrittenPlace[] =>
  [...nodesOf(anatomy)].map((place) => {
    const made: WrittenPlace = {
      node: place.node,
      named: place.node.name ?? place.choice?.name,
      choices: {},
      parts: {},
      options: {},
    }
    for (const { node, choice, alternative } of pathTo(place)) {
      // An alternative repeats with its choice.
      made.group = (choice ? choice.repeat : node.repeat) ?? made.group
      if (choice && alternative !== undefined)
        made.choices[choice.name] = alternative
      if (node.name && (node.optional || node.wrapper)) {
        made.parts[node.name] = true
        if (node.requires) made.parts[node.requires] = true
      }
      if (node.when) made.options[node.when] = true
    }
    return made
  })
/** The instance with what makes the node written, and nothing empty. */
const writing = (
  base: AnatomyInstance,
  place: WrittenPlace,
): AnatomyInstance => ({
  ...base,
  ...(Object.keys(place.choices).length ? { choices: place.choices } : {}),
  ...(Object.keys(place.parts).length ? { parts: place.parts } : {}),
  ...(Object.keys(place.options).length ? { options: place.options } : {}),
})
/** The anatomy cases of every builder function with an anatomy. */
function anatomyCasesOf(
  manifest: Manifest,
  builderFunctions: BuilderFunction[],
  lt: Input["lt"],
): AnatomyCase[] {
  const anatomyCases: AnatomyCase[] = []
  // With the builder functions of the input, as the build cases are.
  const render = (name: string, instance: AnatomyInstance) =>
    renderAnatomy(manifest, name, instance, lt)
  silently(() => {
    for (const b of builderFunctions) {
      if (!b.anatomy) continue
      let base = createdInstance(b.anatomy, "c1")
      for (const [group, { min }] of Object.entries(b.anatomy.repeats ?? {}))
        if (min === 0) base = withItem(b.anatomy, base, group, `${group}1`)
      const made: Omit<AnatomyCase, "builder" | "expected">[] = []
      for (const variant of variantsOf(b.anatomy))
        made.push({ change: "variant", instance: { ...base, ...variant } })
      for (const group of Object.keys(b.anatomy.repeats ?? {}))
        for (const at of [0, base.repeats?.[group]?.length ?? 0])
          made.push({
            change: "withItem",
            withItem: { group, key: "inserted", at },
            instance: withItem(b.anatomy, base, group, "inserted", at),
          })
      const places = placesOf(b.anatomy)
      // A tag case where the node is not written would test nothing, so
      // every tag must give other markup than the first.
      for (const place of places) {
        const { node } = place
        if (!node.name || typeof node.tag === "string") continue
        const as = (tag: string) => ({
          ...writing(base, place),
          tags: { [node.name as string]: tag },
        })
        const first = render(b.name, as(node.tag[0]))
        for (const tag of node.tag) {
          if (tag !== node.tag[0] && render(b.name, as(tag)) === first)
            throw new Error(
              `anatomy-cases: ${b.name} as <${tag}> writes what <${node.tag[0]}> does, so ${node.name} is not written.`,
            )
          made.push({ change: "tag", instance: as(tag) })
        }
      }
      // Per item when the node is in a group, as the renderer reads it.
      for (const place of places) {
        const { node, named, group } = place
        if (!named) continue
        for (const setting of node.settings ?? [])
          for (const source of node.from ?? []) {
            const option = builderFunctions
              .find((x) => x.name === source.split(".")[0])
              ?.options.find((o) => o.name === setting)
            if (!option) continue
            const values =
              option.type.kind === "values"
                ? option.type.values
                : option.type.kind === "flag"
                  ? [true]
                  : []
            for (const value of values) {
              const one = { [setting]: value }
              made.push({
                change: "setting",
                instance: {
                  ...writing(base, place),
                  settings: {
                    [named]: group
                      ? Object.fromEntries(
                          (base.repeats?.[group] ?? []).map((k) => [k, one]),
                        )
                      : one,
                  },
                },
              })
            }
          }
      }
      made.push({ change: "annotate", annotate: ANNOTATE, instance: base })
      for (const m of made)
        anatomyCases.push({
          builder: b.name,
          ...m,
          expected: render(b.name, {
            ...m.instance,
            ...(m.annotate
              ? {
                  annotate: (address: string) =>
                    Object.fromEntries(
                      Object.entries(ANNOTATE).map(([k, v]) => [
                        k,
                        v.replace("{address}", address),
                      ]),
                    ),
                }
              : {}),
          }),
        })
    }
  })
  return anatomyCases
}

/**
 * The elements with the ids each creates itself, by what the id begins
 * with. A component makes such an id with `uniqueId()` or `rememberedId()`
 * from `host-element.ts`, so they are read from the calls in the source
 * files of its folder and belong to the element of that folder. A call that
 * does not write its prefix out stops the build, and so does a helper used
 * any other way than called by its own name. An id made without the
 * helpers, or in a file outside the component folders, is not found.
 */
function elementsOf({ elements, components }: Input): Manifest["elements"] {
  const HELPERS = ["uniqueId", "rememberedId"]
  const ids: Record<string, Set<string>> = {}
  for (const { name, sources } of components)
    for (const [file, text] of Object.entries(sources)) {
      if (!file.endsWith(".ts")) continue
      const source = ts.createSourceFile(
        file,
        text,
        ts.ScriptTarget.Latest,
        true,
      )
      const visit = (node: ts.Node): void => {
        ts.forEachChild(node, visit)
        if (!ts.isIdentifier(node) || !HELPERS.includes(node.text)) return
        const { parent } = node
        if (ts.isImportSpecifier(parent)) {
          if (parent.propertyName !== node) return
          throw new Error(
            `${file} imports ${node.text} under another name, so the manifest cannot find the ids <lt-${name}> creates.`,
          )
        }
        if (!ts.isCallExpression(parent) || parent.expression !== node)
          throw new Error(
            `${file} uses ${node.text} other than by calling it by its own name, so the manifest cannot find the ids <lt-${name}> creates.`,
          )
        // The prefix is the last argument, written out.
        const last = parent.arguments[parent.arguments.length - 1]
        if (!last || !ts.isStringLiteralLike(last) || !last.text)
          throw new Error(
            `${file}: ${parent.getText(source).replace(/\s+/g, " ")} does not write its prefix out, so the manifest cannot say which ids <lt-${name}> creates.`,
          )
        if (!elements[`lt-${name}`])
          throw new Error(
            `${file} creates the id ${last.text}, and there is no <lt-${name}> to put it on.`,
          )
        ids[`lt-${name}`] ??= new Set()
        ids[`lt-${name}`].add(last.text)
      }
      visit(source)
    }
  return Object.fromEntries(
    Object.entries(elements).map(([tag, element]) => [
      tag,
      ids[tag] ? { ...element, generatedIds: [...ids[tag]].sort() } : element,
    ]),
  )
}

/*
 * What `canDrop()` answers for every component in every hole that takes
 * other elements, and in each of those again inside every hole the host
 * may stand in, so a path of two is answered too.
 */
function dropsOf(manifest: Manifest, builderFunctions: BuilderFunction[]) {
  const freeHoles = builderFunctions.flatMap((b) =>
    Object.entries(b.anatomy?.holes ?? {})
      .filter(([, hole]) => hole.content === "free")
      .map(([hole, declaration]) => ({ builder: b.name, hole, declaration })),
  )
  const paths = [
    ...freeHoles.map((h) => [{ builder: h.builder, hole: h.hole }]),
    ...freeHoles.flatMap((outer) =>
      freeHoles
        // Only a host that may itself stand in the outer hole.
        .filter(
          (inner) =>
            canDrop(manifest, inner.builder, [
              { builder: outer.builder, hole: outer.hole },
            ]).ok,
        )
        .map((inner) => [
          { builder: outer.builder, hole: outer.hole },
          { builder: inner.builder, hole: inner.hole },
        ]),
    ),
  ]
  return paths.flatMap((path) =>
    builderFunctions
      .filter((b) => b.anatomy)
      .map((b) => ({
        component: b.name,
        path,
        answer: canDrop(manifest, b.name, path),
      })),
  )
}

/** The four files, with what the last line of a run counts. */
function generated(input: Input) {
  const { version } = input
  // A copy, since the builder functions are filled in below and the input is
  // the caller's.
  // A component is described in a file by the name of its folder, so one
  // without the other is a folder nobody wrote about, or a file left behind.
  for (const { category, name } of input.components)
    if (!input.described.includes(name))
      throw new Error(
        `src/components/${category}/${name} has no file in scripts/metadata/. Write ${name}.ts there, and list it in metadata.ts.`,
      )
  for (const name of input.described)
    if (!input.components.some((folder) => folder.name === name))
      throw new Error(
        `scripts/metadata/ describes ${name}, and no folder in src/components/ has that name.`,
      )
  const builderFunctions: BuilderFunction[] = structuredClone(input.builders)
  const cases = buildCases(builderFunctions, input.lt)
  fillIn(builderFunctions, cases, input)
  const manifest: Manifest = {
    $schema: "./manifest.schema.json",
    schemaVersion: SCHEMA_VERSION,
    version,
    textLanguage: input.textLanguage,
    elements: elementsOf(input),
    classes: classEntriesOf(builderFunctions, cases, input.classes),
    builders: builderFunctions,
    tokens: tokensOf(input),
  }
  const list = {
    agent: input.agent,
    components: input.components.map(({ category, name, files }) => ({
      category,
      name,
      files,
    })),
  }
  const files: Record<string, string> = {
    "manifest/manifest.json": `${JSON.stringify(manifest, null, 2)}\n`,
    "manifest/build-cases.json": `${JSON.stringify({ version, cases })}\n`,
    "manifest/anatomy-cases.json": `${JSON.stringify({
      version,
      cases: anatomyCasesOf(manifest, builderFunctions, input.lt),
      drops: dropsOf(manifest, builderFunctions),
    })}\n`,
    "manifest/files.json": `${JSON.stringify(list, null, 2)}\n`,
  }
  return { files, manifest, cases }
}

/** The four files in `manifest/`, by their path in the package. */
export function files(input: Input = fromPackage()): Record<string, string> {
  return generated(input).files
}

if (import.meta.main) {
  const { files, manifest, cases } = generated(fromPackage())
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(ROOT, path)), { recursive: true })
    writeFileSync(join(ROOT, path), content)
  }
  console.log(
    `✓ The manifest: ${manifest.builders.length} builder functions, ${Object.keys(manifest.elements).length} elements, ${Object.keys(manifest.classes).length} classes, ${cases.length} build cases, ${Object.values(manifest.tokens.components).reduce((n, v) => n + Object.keys(v).length, 0)} component variables.`,
  )
}
