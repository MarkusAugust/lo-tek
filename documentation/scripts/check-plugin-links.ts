/**
 * That the links to the IntelliJ plugin lead to the IntelliJ plugin.
 *
 * A link to JetBrains Marketplace is a number and a name,
 * `plugins.jetbrains.com/plugin/35516-lo-tek-interfaces`, and the number is
 * what decides where it leads. The documentation linked for a long time to
 * the plugin this one replaced: the page answered, the name looked right
 * enough, and the reader installed a plugin that stops at 0.4.0. Nothing in
 * the repository can tell the two numbers apart, so the Marketplace is
 * asked: the plugin with that number must have the id in `plugin.xml`.
 *
 * A wrong answer fails: another id, or no such plugin. No answer at all does
 * not: an outage at JetBrains must not stop a release of something else,
 * and the check then says on a line of its own that it has not looked.
 *
 * Run with: bun documentation/scripts/check-plugin-links.ts
 */

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { Glob } from "bun"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

/** The numbers of the plugins a text links to, each once, in order. */
export function pluginNumbers(text: string): string[] {
  return [
    ...new Set(
      [
        ...text.matchAll(/https?:\/\/plugins\.jetbrains\.com\/plugin\/(\d+)/g),
      ].map((match) => match[1]),
    ),
  ]
}

type Answer = { status: number; body: string }
type Verdict =
  | { kind: "right" }
  | { kind: "wrong"; why: string }
  | { kind: "silent"; why: string }

/**
 * What the Marketplace says about one number. `ask` is asked up to three
 * times while it gives no answer: it throws, or answers with something else
 * than the plugin or 404.
 */
export async function verdict(
  number: string,
  id: string,
  ask: (address: string) => Promise<Answer>,
  attempts = 3,
): Promise<Verdict> {
  const address = `https://plugins.jetbrains.com/api/plugins/${number}`
  let why = ""
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const { status, body } = await ask(address)
      if (status === 404)
        return { kind: "wrong", why: "the Marketplace has no such plugin" }
      if (status === 200) {
        const xmlId: unknown = JSON.parse(body).xmlId
        if (typeof xmlId !== "string") why = "the answer has no xmlId"
        else if (xmlId === id) return { kind: "right" }
        else
          return {
            kind: "wrong",
            why: `it is the plugin ${xmlId}, and ours is ${id}`,
          }
      } else why = `status ${status}`
    } catch (error) {
      why = error instanceof Error ? error.message : String(error)
    }
  }
  return { kind: "silent", why }
}

/*
 * The check checked first, with answers written here: a guard that passes
 * whatever it is told is worse than none, and the Marketplace cannot be
 * asked to be down.
 */
{
  const failed: string[] = []
  const expect = (what: string, got: unknown, wanted: unknown) => {
    if (JSON.stringify(got) !== JSON.stringify(wanted))
      failed.push(
        `${what}: got ${JSON.stringify(got)}, expected ${JSON.stringify(wanted)}`,
      )
  }
  const answering = (status: number, body: string) => async () => ({
    status,
    body,
  })

  expect(
    "the numbers in a text",
    pluginNumbers(
      "The [plugin](https://plugins.jetbrains.com/plugin/34764-lotek) and https://plugins.jetbrains.com/plugin/35516-lo-tek-interfaces, and [again](https://plugins.jetbrains.com/plugin/34764-lotek/versions). Not https://plugins.jetbrains.com/docs/intellij/ or https://plugins.jetbrains.com/plugin/.",
    ),
    ["34764", "35516"],
  )
  expect(
    "the plugin with our id",
    await verdict("35516", "no.lotek", answering(200, '{"xmlId":"no.lotek"}')),
    { kind: "right" },
  )
  expect(
    "the plugin this one replaced",
    await verdict(
      "34764",
      "no.lotek",
      answering(200, '{"xmlId":"no.fristil"}'),
    ),
    { kind: "wrong", why: "it is the plugin no.fristil, and ours is no.lotek" },
  )
  expect(
    "a number the Marketplace does not have",
    await verdict("1", "no.lotek", answering(404, "")),
    { kind: "wrong", why: "the Marketplace has no such plugin" },
  )
  let asked = 0
  expect(
    "a Marketplace that is down",
    await verdict("35516", "no.lotek", async () => {
      asked += 1
      return { status: 503, body: "" }
    }),
    { kind: "silent", why: "status 503" },
  )
  expect("the attempts before giving up", asked, 3)
  expect(
    "a network that is not there",
    await verdict("35516", "no.lotek", async () => {
      throw new Error("fetch failed")
    }),
    { kind: "silent", why: "fetch failed" },
  )
  let second = 0
  expect(
    "an answer on the second attempt",
    await verdict("35516", "no.lotek", async () =>
      second++ === 0
        ? { status: 502, body: "" }
        : { status: 200, body: '{"xmlId":"no.lotek"}' },
    ),
    { kind: "right" },
  )
  expect(
    "an answer that is not the plugin",
    (await verdict("35516", "no.lotek", answering(200, "<html>"))).kind,
    "silent",
  )

  if (failed.length > 0) {
    console.error(
      `✗ The check of the plugin links does not judge as it should:\n\n${failed.map((f) => `  ${f}`).join("\n")}\n`,
    )
    process.exit(1)
  }
}

const id = /<id>([^<]+)<\/id>/.exec(
  readFileSync(
    `${ROOT}intellij/src/main/resources/META-INF/plugin.xml`,
    "utf8",
  ),
)?.[1]
if (!id) {
  console.error("✗ Found no <id> in the IntelliJ plugin's plugin.xml.")
  process.exit(1)
}

/** The pages of the documentation and every README, not what is built or installed. */
const files = [
  ...[
    ...new Glob("**/*.{md,mdx,astro}").scanSync(`${ROOT}documentation/src`),
  ].map((rel) => `documentation/src/${rel}`),
  ...[...new Glob("**/README.md").scanSync(ROOT)].filter(
    (rel) => !/(^|\/)(node_modules|dist|build|target|\.[^/]+)\//.test(rel),
  ),
]

/** Number to the files that link to it. */
const links = new Map<string, string[]>()
for (const file of files) {
  for (const number of pluginNumbers(readFileSync(`${ROOT}${file}`, "utf8")))
    links.set(number, [...(links.get(number) ?? []), file])
}

// The documentation links to the plugin. If the check finds no link, it is
// the reading that has stopped working.
if (links.size === 0) {
  console.error(
    `✗ Found no link to plugins.jetbrains.com/plugin/ in ${files.length} files. The check has not looked at anything.`,
  )
  process.exit(1)
}

const ask = async (address: string) => {
  const response = await fetch(address, { signal: AbortSignal.timeout(10_000) })
  return { status: response.status, body: await response.text() }
}

const wrong: string[] = []
const silent: string[] = []
for (const [number, where] of links) {
  const answer = await verdict(number, id, ask)
  if (answer.kind === "wrong")
    wrong.push(
      `plugins.jetbrains.com/plugin/${number}: ${answer.why}. Linked from ${where.join(", ")}`,
    )
  if (answer.kind === "silent") silent.push(`${number} (${answer.why})`)
}

if (wrong.length > 0) {
  console.error(
    `✗ A link to the IntelliJ plugin leads somewhere else:\n\n${wrong.map((w) => `  ${w}`).join("\n")}\n`,
  )
  process.exit(1)
}

if (silent.length > 0)
  console.log(
    `! JetBrains Marketplace did not answer for ${silent.join(", ")}. The links to the IntelliJ plugin have NOT been checked.`,
  )
else
  console.log(
    `✓ The ${links.size === 1 ? "one plugin" : `${links.size} plugins`} the documentation and the READMEs link to on JetBrains Marketplace ${links.size === 1 ? "is" : "are"} ${id}.`,
  )
