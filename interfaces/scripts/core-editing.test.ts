/**
 * `complete` and `hover` at the edges of the port: a core that has not been
 * given a manifest, input the export cannot read, and the answer that is
 * nothing.
 *
 * What the two answer for a template is in `core/editing/cases.json`, which
 * `core/scripts/check-core.ts` and Kotlin are held to. Here it is the
 * packaged module a host loads, asked as a host asks it: through `loadCore`,
 * and through the exports themselves where `loadCore` gives no way to send
 * what is wrong.
 *
 * Run with: bun test ./scripts/, or as part of `bun run build`.
 */

import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { instantiate } from "../src/diagnostics/core.js"
import {
  type Core,
  type Hover,
  loadCore,
  type Suggestion,
  type SuggestionKind,
} from "../src/diagnostics/index.js"

const PACKAGE = fileURLToPath(new URL("..", import.meta.url))
const MODULE = readFileSync(`${PACKAGE}core/lotek-core.wasm`)
const MANIFEST = readFileSync(`${PACKAGE}manifest/manifest.json`, "utf8")
const NO_MANIFEST =
  "The core has not been given a manifest. Give it manifest.json from the package with load_manifest_raw first."

/** The two exports, as the port has them. */
type Raw = {
  complete_raw(pointer: number, length: number): number
  hover_raw(pointer: number, length: number): number
  load_manifest_raw(pointer: number, length: number): number
}
/** A core of its own, asked through its exports: the status, and what it answered. */
function raw(manifest: boolean) {
  const { e, write, read } = instantiate(MODULE)
  const exports = e as unknown as Raw
  if (manifest) expect(exports.load_manifest_raw(...write(MANIFEST))).toBe(0)
  return (name: "complete_raw" | "hover_raw", input: string) => {
    expect(typeof exports[name]).toBe("function")
    const status = exports[name](...write(input))
    return { status, answer: read<unknown>() }
  }
}

test("the first call on a core of its own answers", () => {
  const completing = loadCore(MODULE)
  completing.loadManifest(MANIFEST)
  const suggestions: Suggestion[] = completing.complete(
    '<hr class="lt-divider" data-variant="">',
    37,
    true,
  )
  expect(suggestions.map((s) => s.label)).toEqual([
    "subtle",
    "strong",
    "default",
  ])
  const kind: SuggestionKind = suggestions[0].kind
  expect(kind).toBe("value")

  const hovering = loadCore(MODULE)
  hovering.loadManifest(MANIFEST)
  const hover: Hover | null = hovering.hover('<hr class="lt-divider">', 14)
  expect(hover?.start).toBe(11)
  expect(hover?.end).toBe(21)
  expect(hover?.text).toStartWith("**Divider**")
})

test("without a manifest both say that the core has none", () => {
  expect(() => loadCore(MODULE).complete('<p class="">', 10, true)).toThrow(
    NO_MANIFEST,
  )
  expect(() => loadCore(MODULE).hover('<p class="lt-button">', 12)).toThrow(
    NO_MANIFEST,
  )
  const ask = raw(false)
  for (const [name, input] of [
    [
      "complete_raw",
      '{"text": "<p class=\\"\\">", "offset": 10, "html": true}',
    ],
    ["hover_raw", '{"text": "<p class=\\"lt-button\\">", "offset": 12}'],
  ] as const)
    expect(ask(name, input)).toEqual({
      status: 1,
      answer: { error: NO_MANIFEST },
    })
})

test("input that is not what the export takes is refused with an explanation", () => {
  const ask = raw(true)
  for (const name of ["complete_raw", "hover_raw"] as const)
    for (const input of [
      "not json",
      "",
      '"<p>"',
      "[]",
      '{"offset": 3}',
      '{"text": "<p>"}',
      '{"text": 3, "offset": 0}',
      '{"text": "<p>", "offset": "0"}',
    ]) {
      const { status, answer } = ask(name, input)
      expect({ name, input, status }).toEqual({ name, input, status: 1 })
      const { error } = answer as { error?: unknown }
      expect(typeof error === "string" && error.length > 0).toBe(true)
    }
})

test("an answer with nothing in it is a list without suggestions, and null from hover", () => {
  const ask = raw(true)
  expect(
    ask("complete_raw", '{"text": "<p>lt-</p>", "offset": 6, "html": false}'),
  ).toEqual({ status: 0, answer: [] })
  expect(ask("hover_raw", '{"text": "<p>lt-button</p>", "offset": 6}')).toEqual(
    { status: 0, answer: null },
  )
  expect(loadCore(MODULE).hover).toBeFunction()
  const core = loadCore(MODULE)
  core.loadManifest(MANIFEST)
  expect(core.hover("<p>lt-button</p>", 6)).toBeNull()
  expect(core.complete("<p>lt-</p>", 6, false)).toEqual([])
})

test("what the exports answer is what the port's types say", () => {
  const ask = raw(true)
  // A field with nothing in it is left out, so the keys are the fields
  // that say something.
  expect(
    ask(
      "complete_raw",
      '{"text": "<lt-popover placement=\\"\\">", "offset": 23, "html": false}',
    ),
  ).toEqual({
    status: 0,
    answer: ["bottom-start", "bottom-end", "top-start", "top-end"].map(
      (label) => ({
        label,
        kind: "value",
        detail: "placement on <lt-popover>",
        start: 23,
        end: 23,
      }),
    ),
  })
  const element = ask(
    "complete_raw",
    '{"text": "<lt-po", "offset": 6, "html": false}',
  ).answer as Record<string, unknown>[]
  expect(element.find((s) => s.label === "lt-popover")).toEqual({
    label: "lt-popover",
    kind: "element",
    documentation:
      "[Documentation](https://lo-tek.sobernetics.no/components/popover/)",
    start: 1,
    end: 6,
  })
  expect(
    ask("hover_raw", '{"text": "<hr class=\\"lt-divider\\">", "offset": 14}'),
  ).toEqual({
    status: 0,
    answer: {
      text: "**Divider** · A line between parts of the content. A CSS component with one class and no JavaScript.\n\n`data-variant`: subtle, strong (default without the attribute)\n\n[Documentation](https://lo-tek.sobernetics.no/components/divider/)",
      start: 11,
      end: 21,
    },
  })
})

/*
 * For `tsc`, in `typecheck:scripts`: a host that has its own `Core`, like a
 * test double or a core in a worker, has the two operations or does not
 * compile.
 */
const complete: Core["complete"] = (
  _text: string,
  _offset: number,
  _html: boolean,
): Suggestion[] => []
const hover: Core["hover"] = (_text: string, _offset: number): Hover | null =>
  null
const kinds: Record<SuggestionKind, true> = {
  class: true,
  value: true,
  element: true,
  attribute: true,
}
const whole: Suggestion = {
  label: "lt-button",
  kind: "class",
  detail: "Button",
  documentation: "**Button**",
  start: 0,
  end: 0,
}
const least: Suggestion = { label: "open", kind: "attribute", start: 0, end: 0 }
type Without = Omit<Core, "complete" | "hover">
// @ts-expect-error a core without `complete` and `hover` is not a `Core`
const lacking: Core = {} as Without
test("the types of the port are the ones the entry point exports", () => {
  expect(
    [complete, hover, kinds, whole, least, lacking].every(
      (value) => value !== undefined,
    ),
  ).toBe(true)
})
