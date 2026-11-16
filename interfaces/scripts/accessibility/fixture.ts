/**
 * The page a contract runs on, and the server that hands it out: the recipe
 * from the component's page, with the CDN addresses rewritten to this
 * package, so what a reader pastes is what is checked. The same for every
 * platform the contracts are read on.
 */
import { existsSync } from "node:fs"
import { join, normalize, resolve } from "node:path"
import { blocks, CDN, recipePage, stylesheetPath } from "../recipes"
import { type Contract, label } from "./contract"
import { CONTRACTS } from "./contracts"

export const PACKAGE = resolve(import.meta.dir, "../..")

/** The "Plain HTML" tab of a component page, as one page, from this package. */
function recipe(page: string): string {
  const entry = recipePage(page)
  const tabs = entry.tabs.filter((t) => t.label === "Plain HTML")
  if (tabs.length !== 1)
    throw new Error(`${page}.mdx has ${tabs.length} "Plain HTML" tabs, not one`)
  const html = blocks({ ...entry, tabs }, { tab: "Plain HTML", lang: "html" })
  if (html.length === 0)
    throw new Error(`${page}.mdx has no HTML in its "Plain HTML" tab`)
  const joined = html.join("\n").replaceAll(CDN, "/pkg/")
  const external = joined.match(
    /(?:src|href)="(https?:[^"]+)"|from\s+"(https?:[^"]+)"/,
  )
  if (external)
    throw new Error(
      `${page}.mdx: the recipe loads ${external[1] ?? external[2]}, which a check must not fetch`,
    )
  return joined
}

/** An `<Example>` on a component page, with the stylesheets its recipe needs. */
function example(page: string, index: number): string {
  const examples = recipePage(page).examples
  const chosen = examples[index]
  if (!chosen)
    throw new Error(
      `${page}.mdx has ${examples.length} examples, not one at ${index}`,
    )
  const links = chosen.setup.stylesheets
    .map(
      (name) =>
        `<link rel="stylesheet" href="/pkg/${stylesheetPath(name.replace(/\.css$/, ""))}">`,
    )
    .join("\n")
  return `${links}\n${chosen.code.trim()}`
}

export function fixture(
  contract: Contract,
  mutation: number | undefined,
): string {
  let html =
    contract.example === undefined
      ? recipe(contract.component)
      : example(contract.component, contract.example)
  for (const [from, to] of contract.variant?.replace ?? []) {
    const count = html.split(from).length - 1
    if (count !== 1)
      throw new Error(
        `${label(contract)}: the variant finds ${JSON.stringify(from)} ${count} times, not once`,
      )
    html = html.replace(from, to)
  }
  if (mutation !== undefined) {
    const [from, to] = contract.mutations[mutation].replace
    const count = html.split(from).length - 1
    if (count !== 1)
      throw new Error(
        `${label(contract)}: the mutation "${contract.mutations[mutation].name}" finds its text ${count} times, not once`,
      )
    html = html.replace(from, to)
  }
  // The barrier's marker, outside the recipe: text written here comes from the
  // document's own process, as the component's events do. A live region,
  // since Chromium only sends text changes for content a screen reader would
  // speak; the checks leave its own text out (`isBarrier`).
  const barrier =
    '<div id="lotek-barrier" aria-live="polite" style="position:absolute;left:-10000px">lotek-barrier</div>'
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${contract.component}</title></head><body>\n${html}\n${barrier}\n</body></html>`
}

/** The fixtures and the package, on 127.0.0.1, on a free port the system picks. */
export function serve() {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      // By the contract's place in the list: a component can have variants.
      const fixtureMatch = url.pathname.match(/^\/fixture\/(\d+)$/)
      if (fixtureMatch) {
        const contract = CONTRACTS[Number(fixtureMatch[1])]
        if (!contract) return new Response("no such contract", { status: 404 })
        const m = url.searchParams.get("mutation")
        return new Response(
          fixture(contract, m === null ? undefined : Number(m)),
          {
            headers: { "content-type": "text/html; charset=utf-8" },
          },
        )
      }
      if (url.pathname.startsWith("/pkg/")) {
        const path = normalize(
          join(PACKAGE, url.pathname.slice("/pkg/".length)),
        )
        if (!path.startsWith(PACKAGE) || !existsSync(path))
          return new Response("not found", { status: 404 })
        return new Response(Bun.file(path))
      }
      return new Response("not found", { status: 404 })
    },
  })
  return {
    stop: () => server.stop(),
    /** Where the contract's page is, with the mutation when there is one. */
    url: (contract: Contract, mutation?: number) =>
      `http://127.0.0.1:${server.port}/fixture/${CONTRACTS.indexOf(contract)}${mutation === undefined ? "" : `?mutation=${mutation}`}`,
  }
}
