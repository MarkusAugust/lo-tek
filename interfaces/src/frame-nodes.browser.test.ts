/**
 * No frame component adds or removes a node in the markup it is given.
 *
 * The markup comes from whoever renders it, and the web component adds the
 * behaviour: everything it writes, it computes from the markup and what the
 * user does, so it can write it again after every patch. A node of its own
 * would be torn away by the next morph, or replaced along with the focus.
 * Popover, suggestion and dialog had a test of this; the others had none.
 *
 * Each component is mounted from its recipe on the page, the "Plain HTML" and
 * the "Datastar" tab, as the reader pastes it, and watched from before it
 * connects. Then every attribute it added is taken away, as Datastar's morph
 * does with what the server did not send, and the component repairs. Neither
 * the connection nor the repair may add or remove a node.
 */
import { afterAll, describe, expect, it } from "vitest"
import { waitForPaint } from "./testing/a11y"
import { recipePage } from "./testing/recipe-pages"
import { blocks } from "./testing/recipes"

// The tests are left out in the pattern itself: an eager glob imports what
// it matches, and the model tests would then run inside this file.
const MODULES = import.meta.glob<Record<string, unknown>>(
  ["./components/frame/*/lt-*.ts", "!./components/frame/*/*.test.ts"],
  { eager: true },
)

/** Each frame component with its registration, read from its folder. */
const components = Object.entries(MODULES)
  .map(([path, module]) => {
    const name = path.replace(/^.*\/frame\/([^/]+)\/.*$/, "$1")
    const define = Object.entries(module).find(
      ([k, v]) => /^defineLt\w+$/.test(k) && typeof v === "function",
    )?.[1] as (() => void) | undefined
    return { name, define }
  })
  .filter(
    (c, i, all) => c.define && all.findIndex((o) => o.name === c.name) === i,
  )

/** The folders under `frame/`, counted from the files rather than the list above. */
const FOLDERS = new Set(
  Object.keys(
    import.meta.glob("./components/frame/*/*.css", { eager: false }),
  ).map((p) => p.replace(/^.*\/frame\/([^/]+)\/.*$/, "$1")),
)

/** The recipe without what does not stand in the region the server sends. */
function markupOf(name: string, tab: string): string {
  return blocks(recipePage(name), { tab, lang: "html" })
    .join("\n")
    .replace(/<script\b[\s\S]*?<\/script>/g, "")
    .replace(/<link\b[^>]*>/g, "")
}

/** Every element of a tree in document order, the root first. */
const elementsOf = (root: Element) => [root, ...root.querySelectorAll("*")]

/** The components a recipe was actually mounted for, counted last. */
const checked = new Set<string>()
/** Each component and tab mounted, as `field/Datastar`. */
const mounted = new Set<string>()
const TABS = ["Plain HTML", "Datastar"]
/**
 * The tabs that must be mounted: every one with an `lt-` element in it. A tab
 * where the element is misspelt, `<lt-feild>`, would otherwise be skipped as
 * a tab without the component, while the other tab kept it counted.
 */
const EXPECTED = components.flatMap(({ name }) =>
  TABS.filter((tab) => /<lt-[a-z]/.test(markupOf(name, tab))).map(
    (tab) => `${name}/${tab}`,
  ),
)

describe("no frame component adds or removes a node", () => {
  for (const { name, define } of components)
    for (const tab of TABS)
      it(`${name}, from the ${tab} recipe`, async (context) => {
        const markup = markupOf(name, tab)
        // The dialog's Plain HTML recipe opens it with showModal() and has no
        // <lt-dialog>; such a tab is skipped where the report shows it.
        if (!markup.includes(`<lt-${name}`)) return context.skip()

        const wrapper = document.createElement("div")
        wrapper.innerHTML = markup
        const sent = document.createElement("div")
        sent.innerHTML = markup

        const nodes: string[] = []
        const observer = new MutationObserver((records) => {
          for (const r of records)
            if (r.type === "childList")
              nodes.push(
                `${(r.target as Element).localName}: +${r.addedNodes.length} -${r.removedNodes.length}`,
              )
        })
        observer.observe(wrapper, { childList: true, subtree: true })

        define?.()
        document.body.append(wrapper)
        await waitForPaint()
        await waitForPaint()
        const connected = [...nodes]

        // The morph takes away what the server did not send.
        const server = elementsOf(sent)
        elementsOf(wrapper).forEach((element, i) => {
          for (const { name: attribute } of [...element.attributes])
            if (!server[i]?.hasAttribute(attribute))
              element.removeAttribute(attribute)
        })
        await waitForPaint()
        await waitForPaint()

        observer.disconnect()
        wrapper.remove()
        expect({ connected, repaired: nodes.slice(connected.length) }).toEqual({
          connected: [],
          repaired: [],
        })
        checked.add(name)
        mounted.add(`${name}/${tab}`)
      })

  afterAll(() => {
    // Every folder under frame/ was mounted from a recipe at least once.
    expect(components.map((c) => c.name).sort()).toEqual([...FOLDERS].sort())
    expect([...checked].sort()).toEqual([...FOLDERS].sort())
    expect([...mounted].sort()).toEqual([...EXPECTED].sort())
  })
})
