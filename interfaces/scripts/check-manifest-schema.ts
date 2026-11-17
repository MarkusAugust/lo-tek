/**
 * Checks that the manifest is what `manifest.schema.json` says it is, and
 * that the types in `src/vocabulary/manifest.ts` are the ones
 * `generate-manifest-types.ts` writes from the schema now.
 *
 * The schema is written by hand and the manifest is generated, so the two
 * drifted without anything saying so: `siblingsBefore` reached the manifest
 * while the schema forbade it. The schema is what a reader in another
 * language trusts, so it is checked on every build. The types are what the
 * generator of the manifest is compiled against, so the manifest it builds
 * is held to the schema twice: by `tsc`, and here.
 *
 * Run with: bun run check:manifest-schema, or as part of `bun run build`.
 */

import { join } from "node:path"
import { fileURLToPath } from "node:url"
import Ajv2020 from "ajv/dist/2020.js"
import { files } from "./generate-manifest-types"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const schema = await Bun.file(
  join(ROOT, "manifest/manifest.schema.json"),
).json()
const manifest = await Bun.file(join(ROOT, "manifest/manifest.json")).json()

// `uri` is the only format the schema uses, so it is defined here rather
// than pulling in a package of formats.
const validate = new Ajv2020({
  allErrors: true,
  formats: { uri: (value: string) => URL.canParse(value) },
}).compile(schema)
const problems = (value: unknown) =>
  validate(value)
    ? []
    : (validate.errors ?? []).map(
        (e) =>
          `${e.instancePath || "/"} ${e.message}${e.params && "additionalProperty" in e.params ? `: ${e.params.additionalProperty}` : ""}`,
      )

const errors = problems(manifest).map((p) => `manifest.json: ${p}`)

// In the build, `generate` has just written the types, so this finds
// nothing; run on its own, it says whether the file is out of date.
for (const [path, content] of Object.entries(files()))
  if ((await Bun.file(join(ROOT, path)).text()) !== content)
    errors.push(
      `${path} is not what the schema gives. Run bun scripts/generate-manifest-types.ts.`,
    )

/*
 * The guard itself: a field the schema does not describe must be stopped
 * wherever it lands. Without this, an object left open in the schema lets a
 * new field through, and the check above is green for the wrong reason.
 */
const withField = (place: string, at: (m: typeof manifest) => object) => {
  const copy = structuredClone(manifest)
  Object.assign(at(copy), { notInTheSchema: true })
  if (problems(copy).length === 0)
    errors.push(`A field that is not in the schema passes on ${place}.`)
}
withField("the manifest", (m) => m)
withField("an element", (m) => m.elements["lt-field"])
withField("a part of an element", (m) => m.elements["lt-field"].parts.control)
withField("a class", (m) => m.classes["lt-button"])
withField("a part of a class", (m) => m.classes["lt-accordion"].parts.summary)
withField(
  "a class attribute",
  (m) => m.classes["lt-button"].attributes["data-variant"],
)
withField("a builder function", (m) => m.builders[0])
withField("an option", (m) => m.builders[0].options[0])
withField("the tokens", (m) => m.tokens)

if (errors.length) {
  console.error(
    `✗ The manifest does not match manifest.schema.json:\n  ${errors.join("\n  ")}`,
  )
  process.exit(1)
}
console.log(
  "✓ The manifest matches manifest.schema.json, and the types are written from it.",
)
