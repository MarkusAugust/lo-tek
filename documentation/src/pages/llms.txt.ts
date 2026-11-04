/**
 * `llms.txt`: the entry point for an agent that only has web access.
 *
 * Following the format on llmstxt.org: one heading, one summary, and then
 * links with one line each. It is an index, not a rulebook. The rules in full
 * are in `/agent/<name>.md`, one complete file per environment.
 *
 * The four rules are still here, in short form. An agent that fetches only
 * this file and follows not a single link should still not have to guess at
 * what costs the most.
 *
 * Everything apart from the four rules is read from the content: the rulebooks
 * from the folder they are in, and the page list from the collection Starlight
 * builds. Then none of them can drift from what actually exists.
 */

import { getCollection } from "astro:content"
import type { APIRoute } from "astro"
import pkg from "../../../interfaces/package.json"
import { markdownAddress } from "../markdown-address"

const BASE = pkg.homepage.replace(/\/$/, "")

/*
 * The rulebooks are loaded with `import.meta.glob`, which Vite resolves at build
 * time. A path computed from `import.meta.url` points at the chunk after
 * bundling, not at the source.
 */
const BOOKS = import.meta.glob("../../../interfaces/agent/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>

/** The heading and first paragraph of a rulebook, as title and description. */
function readRulebook(path: string) {
  const name = path.replace(/^.*\/|\.md$/g, "")
  const text = BOOKS[path]
  const title = /^# (.+)$/m.exec(text)?.[1] ?? name
  const paragraph = text.split("\n\n")[1] ?? ""

  /*
   * The first sentence is enough on an index row, and the link list has to be
   * readable. The split happens after the full stop, not on it, so the
   * sentence keeps its own and does not get another one added.
   */
  const first = paragraph.replace(/\n/g, " ").split(/(?<=\.)\s/)[0]

  return {
    name,
    title,
    description: first.replace(/^The rulebook for /, ""),
  }
}

const RULEBOOKS = Object.keys(BOOKS).sort().map(readRulebook)

const RULES = `Four mistakes account for almost everything that goes wrong. They apply in every environment:

1. The stylesheet must be loaded. If it is missing, the components look
   unstyled, and the answer is to load it, never to write your own CSS to make
   them look right.
2. Only the classes and elements that exist, exist. \`lt-modal\`,
   \`lt-datepicker\` and \`data-variant="outlined"\` belong to other design
   systems. The full list is in every rulebook.
3. No hard-coded colours or pixels. \`var(--lt-color-…)\` and
   \`var(--lt-spacing-…)\`.
4. Web components are registered once with \`defineLt*()\`, and a boolean
   attribute is true as long as it is there: \`hidden="false"\` still hides
   the error text. The attribute has to be removed, not set to \`false\`.

Check the markup when you are done, and fix what it reports:

    npx @lo-tek/interfaces check <file>
    npx @lo-tek/interfaces check http://localhost:8080/page

On a JVM server without Node, \`assertLotek(html)\` from the Maven package
\`io.github.markusaugust:lo-tek-interfaces\` does the same in a test, and
\`java -jar lotek.jar check http://localhost:8080/page\` against the running
app.

It knows every class, every element, every attribute and every valid value,
writes \`file:line:column: error: message\`, or \`warning:\`, and exits with an error code when it finds something.
With an address it checks the page as the server sends it, and also requires
that every \`for\` and \`aria-describedby\` points at an id that exists, and
that every field has a label. You are done when both answer "The markup
matches LO-TEK". Everything about the commands: ${BASE}/command-line/`

type Row = { title: string; description: string; address: string }

function section(heading: string, rows: Row[]): string {
  if (rows.length === 0) return ""

  const lines = rows.map(
    ({ title, description, address }) =>
      `- [${title}](${address})${description ? `: ${description}` : ""}`,
  )

  return `## ${heading}\n\n${lines.join("\n")}`
}

export const GET: APIRoute = async () => {
  const pages = await getCollection("docs")

  const asRow = (
    id: string,
    data: { title: string; description?: string },
  ) => ({
    title: data.title,
    description: data.description ?? "",
    address: `${BASE}${markdownAddress(`/${id}/`)}`,
  })

  const guides: Row[] = []
  const patterns: Row[] = []
  const components: Row[] = []

  for (const page of pages.sort((a, b) => a.id.localeCompare(b.id))) {
    // The 404 page has no Markdown version (see `route-data.ts`), and nothing
    // an agent is looking for.
    if (page.id === "404") continue
    const row = asRow(page.id, page.data)
    if (page.id.startsWith("components/")) components.push(row)
    else if (page.id.startsWith("patterns/")) patterns.push(row)
    else guides.push(row)
  }

  const text = [
    "# LO-TEK",
    `> ${pkg.description} Version ${pkg.version}. The components are CSS classes and web components, things the browser already understands, so the same components work in plain HTML, in a Go template, with bundles, in React, in Astro, with Datastar and on a Kotlin or Java server, where the builder functions are \`Lt\` with enums.`,
    RULES,
    section(
      "Rulebooks for coding agents",
      RULEBOOKS.map(({ name, title, description }) => ({
        title,
        description,
        address: `${BASE}/agent/${name}.md`,
      })),
    ),
    `Each rulebook is complete for its environment. If the package is
installed, the same files are in
\`node_modules/@lo-tek/interfaces/agent/\`, and \`npx @lo-tek/interfaces agent\`,
or \`java -jar lotek.jar agent\` on the JVM, prints the one that fits this
project.`,
    section("Guides", guides),
    section("Patterns", patterns),
    section("Components", components),
  ]
    .filter(Boolean)
    .join("\n\n")

  return new Response(`${text}\n`, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  })
}
