/**
 * That the components write attributes through `setAttr`, not raw.
 *
 * The components observe the attributes they set themselves, so they can set
 * them back after a patch from the server. If one of them writes a value that
 * is already there, it counts as a change, the observer calls itself, writes
 * again, and the microtask queue never empties. The page freezes.
 *
 * That is why this check exists, and why it is a script and not a browser
 * test: when a component breaks the rule, a test run **hangs** instead of
 * failing. No stack trace, no assertion, just silence, and a run that has to
 * be killed by hand. A rule that can only be broken that way has to be
 * enforced in the source, and it has to fail in seconds.
 *
 * Six ways of writing trigger a mutation record without the value changing,
 * and five of them have been used in these components. Looking for
 * `setAttribute` is therefore not enough:
 *
 * | Write | Use instead |
 * | --- | --- |
 * | `el.setAttribute(n, v)` | `setAttr(el, n, v)` |
 * | `el.hidden = x`, `el.disabled = x` | `setFlag(el, "hidden", x)` |
 * | `el.tabIndex = n`, `el.id = s`, `el.htmlFor = s` | `setAttr(el, …)` |
 * | `el.textContent = s`, `el.innerText = s` | `setText(el, s)` |
 * | `el.classList.add(k)` | `addClass(el, k)` |
 * | `el.style.cssText = s` | `el.style.setProperty(…)` |
 *
 * `removeAttribute`, `toggleAttribute` and `style.setProperty` give no record
 * when nothing changes, and are safe.
 *
 * **The host is not an exception.** The previous version let `this.…` pass,
 * on the grounds that the host is only observed through `observedAttributes`.
 * That is not true: each of the components calls `observe(this, …)`, and an
 * observer on a node sees the node's own attributes and its own children.
 * `this.classList.add()` in `<lt-field>`, which has `class` in its filter,
 * would have hung a run just as well as a write on a child.
 *
 * The one thing allowed on the host is assigning a property the component
 * itself declares with `set`. `this.open = true` then calls the setter in the
 * same file, and that is what writes, through `setFlag`. The setter names are
 * read from the file rather than listed here, so a new setter does not have
 * to be remembered in two places.
 *
 * The check reads text, and it does not catch everything.
 * `Object.assign(el, { … })`, a `setAttribute` stored in a variable and
 * `replaceChildren()` slip past. None of them are in use, and a text check
 * that caught them would take as much correct code with it. What it catches
 * are the forms that actually appear in these files, and the ones closest to
 * hand next time.
 *
 * Only `frame/` is read. The standalone components create their own content
 * and do not observe it, so a write there cannot call any observer. The one
 * observer among them, on `<lt-connection-status>`, watches only the host's
 * own `role` and `aria-live`, and writes them only when both are missing,
 * which a write of its own cannot undo.
 *
 * **The second rule is the other half: what a component touches, it
 * watches.** Every attribute a file reads or writes (through `setAttr`,
 * `setFlag`, `addClass`, `ownership()`, `getAttribute`, `hasAttribute`, a
 * selector in a string, or a helper in `READS`) must be in the filter of an
 * observer that calls `sync()` or `wire()` on a whole tree, or in
 * `observedAttributes`, or in `UNOBSERVED` with the reason. Each component
 * kept its filter by hand, and the model tests found three that left out a
 * name: the term's `class`, the dialog's `aria-label` and the session
 * warning's role. The first run found four more, each fixed with a test:
 * `type` in field and suggestion, `role` in popover, `data-value` in
 * suggestion. It reads names written as text or as a constant; a name built
 * at run time slips past.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript"
import {
  READS,
  SERVER_CONTROLLED,
  WRITTEN,
} from "../src/components/host-element"

const ROOT = new URL("../src/components/frame", import.meta.url).pathname

function componentFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) return componentFiles(path)
    if (!entry.name.startsWith("lt-")) return []
    if (!entry.name.endsWith(".ts")) return []
    if (entry.name.includes(".test.")) return []
    return [path]
  })
}

/**
 * The ways of writing that give a mutation record even when the value is the
 * same.
 *
 * `(?<!\bthis)` is the exception for the host, and it has to sit on the
 * receiver itself. A check on whether the line contains `this.` was too
 * broad: `this.panel.setAttribute(...)` slipped past, and that is exactly how
 * a component would write it.
 */
const FORBIDDEN: { pattern: RegExp; use: string }[] = [
  { pattern: /\.setAttribute\(/, use: "setAttr()" },
  { pattern: /\.classList\.(add|remove|toggle)\(/, use: "addClass()" },
  { pattern: /\.(hidden|disabled|open|checked)\s*=[^=]/, use: "setFlag()" },
  { pattern: /\.(tabIndex|id|className|htmlFor)\s*=[^=]/, use: "setAttr()" },
  { pattern: /\.(textContent|innerText)\s*=[^=]/, use: "setText()" },
  { pattern: /\.style\.cssText\s*=[^=]/, use: "style.setProperty()" },
]

/**
 * The attributes a component file reads or writes that no observer calling
 * `sync()` or `wire()` watches, and the exemptions in `exempt` that name
 * nothing the file touches.
 *
 * A patch that changes such an attribute goes unseen, and what the component
 * computed from it stands wrong until something else happens to call it: the
 * term's `class` and the dialog's `aria-label` were both found that way by the
 * model tests, not by a rule.
 */
export function unobserved(source: string, exempt: string[] = []): string[] {
  const file = ts.createSourceFile(
    "lt-x.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  )
  const watching = new Set<string>()
  const observed = new Set<string>([WRITTEN])
  let everything = false
  const touched = new Map<string, "reads" | "writes">()
  const touch = (names: string[], kind: "reads" | "writes") => {
    for (const name of names)
      if (kind === "writes" || !touched.has(name)) touched.set(name, kind)
  }

  // The initializer of the declaration an identifier names: the nearest
  // `const` in the blocks around it, so two methods with a `name` each keep
  // their own.
  const declared = (id: ts.Identifier): ts.Expression | undefined => {
    for (
      let scope: ts.Node | undefined = id.parent;
      scope;
      scope = scope.parent
    ) {
      if (!("statements" in scope)) continue
      for (const statement of (scope as ts.Block).statements) {
        if (!ts.isVariableStatement(statement)) continue
        for (const d of statement.declarationList.declarations)
          if (
            ts.isIdentifier(d.name) &&
            d.name.text === id.text &&
            d.initializer
          )
            return d.initializer
      }
    }
    return undefined
  }
  const resolve = (node: ts.Node | undefined): string[] => {
    if (!node) return []
    if (
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isParenthesizedExpression(node)
    )
      return resolve(node.expression)
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      return [node.text]
    if (ts.isIdentifier(node)) {
      if (own(KNOWN, node.text)) return [KNOWN[node.text]]
      return resolve(declared(node))
    }
    if (ts.isArrayLiteralExpression(node))
      return node.elements.flatMap((e) =>
        resolve(ts.isSpreadElement(e) ? e.expression : e),
      )
    return []
  }
  // Whether a callback ends in `sync()` or `wire()`, also through a microtask.
  const syncs = (node: ts.Node | undefined): boolean => {
    let found = false
    const visit = (n: ts.Node) => {
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        SYNCS.has(n.expression.name.text)
      )
        found = true
      if (!found) ts.forEachChild(n, visit)
    }
    if (node) visit(node)
    return found
  }
  // Only an observer of a whole tree counts: one on a single node, like the
  // term's on the entry outside it, says nothing about the rest. The check
  // cannot see which node a name is read on, so it asks for the tree.
  const watchWith = (init: ts.Node | undefined) => {
    if (!init || !ts.isObjectLiteralExpression(init)) return
    const property = (name: string) =>
      init.properties.find(
        (p): p is ts.PropertyAssignment =>
          ts.isPropertyAssignment(p) && p.name.getText(file) === name,
      )
    const on = (name: string) =>
      property(name)?.initializer.kind === ts.SyntaxKind.TrueKeyword
    if (!on("subtree")) return
    const filter = property("attributeFilter")
    if (filter)
      for (const name of resolve(filter.initializer)) observed.add(name)
    else if (on("attributes")) everything = true
  }

  // First the observers, since `observe()` can come before the assignment in
  // the text.
  const collect = (node: ts.Node) => {
    if (
      ts.isNewExpression(node) &&
      node.expression.getText(file) === "MutationObserver" &&
      syncs(node.arguments?.[0])
    ) {
      const parent = node.parent
      if (ts.isBinaryExpression(parent)) watching.add(parent.left.getText(file))
      if (ts.isVariableDeclaration(parent))
        watching.add(parent.name.getText(file))
    }
    ts.forEachChild(node, collect)
  }
  collect(file)

  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyDeclaration(node) &&
      node.name.getText(file) === "observedAttributes"
    )
      for (const name of resolve(node.initializer)) observed.add(name)
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const [first, second] = node.arguments
      if (ts.isIdentifier(callee)) {
        const name = callee.text
        if (name === "watcher" && syncs(first)) watchWith(second)
        if (name === "setAttr" || name === "setFlag")
          touch(resolve(second), "writes")
        if (name === "addClass") touch(["class"], "writes")
        if (own(READS, name))
          touch([...READS[name as keyof typeof READS]], "reads")
      }
      if (ts.isPropertyAccessExpression(callee)) {
        const method = callee.name.text
        if (method === "getAttribute" || method === "hasAttribute")
          touch(resolve(first), "reads")
        if (method === "removeAttribute" || method === "toggleAttribute")
          touch(resolve(first), "writes")
        if (OWNERSHIP_WRITES.has(method) && node.arguments.length >= 2)
          touch(resolve(second), "writes")
        if (OWNERSHIP_READS.has(method) && node.arguments.length >= 2)
          touch(resolve(second), "reads")
        if (
          method === "observe" &&
          watching.has(callee.expression.getText(file))
        )
          watchWith(second)
      }
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      touch(
        [...node.text.matchAll(SELECTOR)].map((m) => m[1]),
        "reads",
      )
    ts.forEachChild(node, visit)
  }
  visit(file)

  const findings: string[] = []
  for (const [name, kind] of [...touched].sort(([a], [b]) =>
    a.localeCompare(b),
  ))
    if (!everything && !observed.has(name) && !exempt.includes(name))
      findings.push(
        `${kind} ${name}, which no observer that calls sync() watches`,
      )
  for (const name of exempt)
    if (!touched.has(name))
      findings.push(`exempts ${name}, which the file neither reads nor writes`)
    else if (everything || observed.has(name))
      findings.push(
        `exempts ${name}, which an observer that calls sync() watches`,
      )
  return findings
}

/**
 * The attributes a component reads without watching them, each with the
 * reason. Only a read that cannot go stale belongs here: one made when the
 * user acts, or one only a warning depends on. A read that decides which
 * part is which, or what state stands, is watched instead (type, role and
 * data-value were found that way, each with a test in the component).
 */
const UNOBSERVED: Record<
  string,
  Array<{ attribute: string; reason: string }>
> = {
  "error-summary/lt-error-summary.ts": [
    {
      attribute: "href",
      reason:
        "read when a link is followed, and for the warning about a link to nothing",
    },
  ],
  "field/lt-field.ts": [
    {
      attribute: "aria-label",
      reason: "read only for the warnings about a field without a name",
    },
    {
      attribute: "aria-labelledby",
      reason: "read only for the warnings about a field without a name",
    },
    {
      attribute: "name",
      reason:
        "read only for the warning about a control replaced with another id",
    },
  ],
  "session-timeout/lt-session-timeout.ts": [
    {
      attribute: "method",
      reason:
        "read only for the warning about a dialog without a button in a form",
    },
  ],
  "suggestion/lt-suggestion.ts": [
    {
      attribute: "name",
      reason:
        "read only for the warning about a field replaced with another id",
    },
  ],
  "term/lt-term.ts": [
    {
      attribute: "popover",
      reason:
        "written on the entry outside the element, which the observer `outside` watches",
    },
    {
      attribute: "style",
      reason:
        "written on the entry outside the element, which the observer `outside` watches",
    },
  ],
  "tabs/lt-tabs.ts": [
    {
      attribute: "aria-orientation",
      reason: "read when an arrow key is pressed",
    },
  ],
}

/** Whether `key` is the object's own, not one from `Object.prototype`, like `toString`. */
const own = (object: object, key: string): boolean =>
  Object.keys(object).includes(key)

/** The calls that end in what the observer is there to trigger. */
const SYNCS = new Set(["sync", "wire"])
/** The methods of `ownership()` that take the attribute as their second argument. */
const OWNERSHIP_WRITES = new Set(["write", "release", "forget"])
const OWNERSHIP_READS = new Set(["knows", "serverWord", "written", "lost"])
/** The constants from `host-element.ts` that name an attribute. */
const KNOWN: Record<string, string> = { SERVER_CONTROLLED, WRITTEN }
/** An attribute in a selector: `[role]`, `[role=tab]`, `[href^='#']`. */
const SELECTOR = /\[\s*([a-zA-Z][\w-]*)\s*(?:[~|^$*]?=|\])/g

/**
 * The rule, fed known components every time the check runs. The answers are
 * written out by hand.
 */
export function selfTest(): string[] {
  const broken: string[] = []
  const expect = (name: string, actual: string[], wanted: string[]) => {
    if (JSON.stringify(actual) !== JSON.stringify(wanted))
      broken.push(
        `${name}: found ${JSON.stringify(actual)}, expected ${JSON.stringify(wanted)}`,
      )
  }
  const component = (body: string) =>
    `class LtX extends HostElement {\n${body}\n}`
  const syncing = (filter: string) =>
    `private readonly watch = watcher(() => this.sync(), { attributes: true, subtree: true, attributeFilter: ${filter} })`

  expect(
    "a write the filter leaves out",
    unobserved(
      component(
        `${syncing(`["role"]`)}\nsync() { setAttr(this.box, "role", "x"); setAttr(this.box, "aria-label", "y") }`,
      ),
    ),
    ["writes aria-label, which no observer that calls sync() watches"],
  )
  expect(
    "addClass writes class, and setFlag and the memory of who wrote write too",
    unobserved(
      component(
        `${syncing(`[]`)}\nsync() { addClass(this.word, "lt-term"); setFlag(this.panel, "hidden", true); this.own.write(this.tab, "aria-selected", "true", { server: null, mark: true }) }`,
      ),
    ),
    [
      "writes aria-selected, which no observer that calls sync() watches",
      "writes class, which no observer that calls sync() watches",
      "writes hidden, which no observer that calls sync() watches",
    ],
  )
  expect(
    "a read through getAttribute or hasAttribute, and through a selector",
    unobserved(
      component(
        `${syncing(`["href"]`)}\nsync() { this.querySelector("a[href^='#'][role=tab]"); this.box.getAttribute("aria-controls"); this.hasAttribute("disabled") }`,
      ),
    ),
    [
      "reads aria-controls, which no observer that calls sync() watches",
      "reads disabled, which no observer that calls sync() watches",
      "reads role, which no observer that calls sync() watches",
    ],
  )
  expect(
    "a helper reads what READS says it reads",
    unobserved(
      component(
        `${syncing(`["aria-label"]`)}\nsync() { if (!hasName(this.dialog)) return }`,
      ),
    ),
    ["reads aria-labelledby, which no observer that calls sync() watches"],
  )
  expect(
    "observedAttributes counts as watched, and so does the mark watcher() adds",
    unobserved(
      component(
        `static observedAttributes = [SERVER_CONTROLLED, "activation"] as const\n${syncing(`[]`)}\nsync() { isServerControlled(this); this.getAttribute("activation"); stillMarked(this.tab, "x") }`,
      ),
    ),
    [],
  )
  expect(
    "an observer that does not call sync() watches for nothing here",
    unobserved(
      component(
        `${syncing(`[]`)}\nprivate readonly openWatch = watcher(() => restoreModalOpen(this.dialog), { attributes: true, attributeFilter: ["open"] })\nsync() { this.dialog.getAttribute("open") }`,
      ),
    ),
    ["reads open, which no observer that calls sync() watches"],
  )
  expect(
    "a MutationObserver that calls sync() counts by the filter it observes with",
    unobserved(
      component(
        `open() { this.outside = new MutationObserver(() => this.sync()); this.outside.observe(this, { attributes: true, subtree: true, attributeFilter: ["popover", "id"] }) }\nsync() { entry.getAttribute("popover"); entry.getAttribute("style") }`,
      ),
    ),
    ["reads style, which no observer that calls sync() watches"],
  )
  expect(
    "an observer on one node, without subtree, watches nothing for the rest of the element",
    unobserved(
      component(
        `${syncing(`["href"]`)}\nopen() { this.outside = new MutationObserver(() => this.sync()); this.outside.observe(entry, { attributes: true, attributeFilter: ["class"] }) }\nsync() { addClass(this.word, "lt-term") }`,
      ),
    ),
    ["writes class, which no observer that calls sync() watches"],
  )
  expect(
    "a function or a name that is also a member of Object is not a helper or a constant",
    unobserved(
      component(
        `${syncing(`[]`)}\nsync() { toString(this); this.box.getAttribute(constructor) }`,
      ),
    ),
    [],
  )
  expect(
    "a constant is the one in scope, not another of the same name elsewhere",
    unobserved(
      component(
        `${syncing(`["role"]`)}\nsync() { const name = "aria-label"; setAttr(this.box, name, "x") }\nwire() { const name = "role"; setAttr(this.box, name, "tab") }`,
      ),
    ),
    ["writes aria-label, which no observer that calls sync() watches"],
  )
  expect(
    "a name in a constant, and a filter spread from a list",
    unobserved(
      `const NAME = "aria-labelledby"\nconst DERIVED = ["id", NAME]\n${component(`${syncing(`[...DERIVED, "for"]`)}\nsync() { setAttr(this.label, "for", "x"); setAttr(this.list, NAME, "y"); this.box.getAttribute("id"); this.box.getAttribute(WRITTEN) }`)}`,
    ),
    [],
  )
  expect(
    "an observer without a filter watches every attribute",
    unobserved(
      component(
        `private readonly watch = watcher(() => this.sync(), { attributes: true, subtree: true })\nsync() { this.box.getAttribute("anything") }`,
      ),
    ),
    [],
  )
  expect(
    "a sync() reached through a microtask still counts",
    unobserved(
      component(
        `private readonly watch = watcher(() => queueMicrotask(() => this.sync()), { attributes: true, subtree: true, attributeFilter: ["role"] })\nsync() { this.box.getAttribute("role") }`,
      ),
    ),
    [],
  )
  expect(
    "an exemption takes a name out, and one that names nothing is a finding",
    unobserved(
      component(`${syncing(`[]`)}\nsync() { this.box.getAttribute("lang") }`),
      ["lang", "type"],
    ),
    ["exempts type, which the file neither reads nor writes"],
  )
  // The constants the rule resolves from host-element.ts.
  if (
    SERVER_CONTROLLED !== "server-controlled" ||
    WRITTEN !== "data-lt-written"
  )
    broken.push(
      "the constants from host-element.ts are not the ones the cases assume",
    )
  return broken
}

if (import.meta.main) {
  const broken = selfTest()
  if (broken.length > 0) {
    console.error(
      `The rule for the observers answers wrong:\n${broken.map((b) => `  - ${b}`).join("\n")}`,
    )
    process.exit(1)
  }
  const findings: string[] = []

  for (const file of componentFiles(ROOT)) {
    const content = readFileSync(file, "utf8")
    // The properties the file itself declares. `this.open = x` then goes
    // through the setter.
    const setters = [...content.matchAll(/^\s*set ([a-zA-Z]+)\(/gm)].map(
      (match) => match[1],
    )

    const lines = content.split("\n")
    lines.forEach((line, i) => {
      const trimmed = line.trim()
      // Comments are not code. Both `//` and the lines inside a `/** … */`.
      if (trimmed.startsWith("*") || trimmed.startsWith("/*")) return
      const code = line.split("//")[0]

      // A `set` accessor declares a property, it does not write.
      if (/^\s*(set|get) /.test(code)) return
      if (setters.some((name) => code.includes(`this.${name} =`))) return

      for (const { pattern, use } of FORBIDDEN) {
        if (!pattern.test(code)) continue
        findings.push(
          `${file.replace(`${ROOT}/`, "")}:${i + 1}  ${trimmed}   → ${use}`,
        )
        break
      }
    })
  }

  // The observers: every attribute a file reads or writes is one an
  // observer that calls `sync()` watches, or is in UNOBSERVED with a reason.
  const unwatched: string[] = []
  let read = 0
  for (const file of componentFiles(ROOT)) {
    const name = file.replace(`${ROOT}/`, "")
    const exempt = (UNOBSERVED[name] ?? []).map((e) => e.attribute)
    for (const f of unobserved(readFileSync(file, "utf8"), exempt))
      unwatched.push(`${name}  ${f}`)
    read += 1
  }
  const files = new Set(
    componentFiles(ROOT).map((f) => f.replace(`${ROOT}/`, "")),
  )
  for (const name of Object.keys(UNOBSERVED))
    if (!files.has(name))
      unwatched.push(`${name}  is in UNOBSERVED, and no such file exists`)

  if (findings.length > 0) {
    console.error(
      `\n✗ ${findings.length} raw writes. Use the helpers in host-element.ts, which\n` +
        "  compare first. Without them the observer calls itself, and the run hangs.\n",
    )
    for (const f of findings) console.error(`  ${f}`)
  }
  if (unwatched.length > 0) {
    console.error(
      `\n✗ ${unwatched.length} attributes no observer that calls sync() watches. A patch that\n` +
        "  changes one goes unseen. Add it to the filter, or to UNOBSERVED with the reason.\n",
    )
    for (const f of unwatched) console.error(`  ${f}`)
  }
  if (read === 0) console.error("✗ Read no component files.")
  if (findings.length > 0 || unwatched.length > 0 || read === 0) process.exit(1)

  console.log(
    `The ${read} components write through the helpers that compare first, and watch what they read and write.`,
  )
}
