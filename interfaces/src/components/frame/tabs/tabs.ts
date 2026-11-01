import { attributes, checkedKeys, idOrFallback } from "../../css/shared.js"

export const TABS_LIST_CLASS = "lt-tabs__list" as const
export const TABS_PANEL_CLASS = "lt-tabs__panel" as const

export type TabsOptions = {
  /**
   * The shared id stem. The panels become `${id}-${key}`, and the headings in
   * them `${id}-${key}-heading`.
   */
  id: string
  /**
   * One key per tab, from the data, such as `["claim", "attachments"]`.
   * The key gives the panel its id, and the link points to it. An index is
   * not a key: if the server inserts a tab first, the same index points to
   * another panel. An empty key, whitespace and two identical keys throw.
   */
  keys: string[]
  /**
   * What the tabs choose between. Becomes `aria-label` on the tab list, which
   * must have a name. Empty, or only whitespace, throws.
   */
  label: string
}

export type TabsAttributes = {
  /** The tab list, a `<ul>`. */
  list: { class: typeof TABS_LIST_CLASS; "aria-label": string }
  /** Each tab, a link to its panel. */
  tabs: Array<{ href: string }>
  /** Each panel, with the id the link points to. */
  panels: Array<{ id: string; class: typeof TABS_PANEL_CLASS }>
  /** The heading in each panel. */
  headings: Array<{ id: string }>
}

/** What both versions share: the keys checked, and the ids made from them. */
function prepare(
  builder: string,
  options: { id: string; keys: string[]; label: string },
) {
  // The fallback only matters to callers without a type check.
  const id = idOrFallback(builder, options.id)
  // The stem becomes part of every id, and `aria-controls` splits on
  // whitespace: `"a b"` gave `aria-controls="a b-x"`, which is two ids. The
  // keys throw on the same thing.
  if (/\s/.test(id)) {
    throw new Error(
      `${builder}: the id "${id}" contains whitespace. It becomes part of every id, and an id cannot contain whitespace.`,
    )
  }
  // Before the keys, as in Kotlin, so the two throw with the same message.
  if (typeof options.label !== "string" || options.label.trim() === "") {
    throw new Error(
      `${builder}: label is missing or empty. The tab list needs a name that says what the tabs choose between, otherwise the screen reader says only "tab list".`,
    )
  }
  const keys = checkedKeys(builder, options.keys)
  return { id, keys, panelId: (key: string) => `${id}-${key}` }
}

/**
 * The attributes for a tab list where the tabs are links to the panels.
 *
 * Only links, ids and classes. Without JavaScript the tab list is then a
 * plain list of links, and the panels follow one another: a table of
 * contents that works for everyone. The roles, which tab is selected and
 * which panels are hidden are written by `<lt-tabs>`. Had they been here, the
 * markup without JavaScript would have said "tab" about a link that does not
 * behave like one, and hidden the panels.
 *
 * The first tab is selected when the page loads. Another one comes from the
 * address, such as `#file-attachments`, or from `selected` and `select()` on
 * `<lt-tabs>`.
 *
 * A React app uses `lt.tabs()` from `@lo-tek/interfaces/react`, which gives
 * the whole state, so React hydrates without mismatches.
 *
 * ```ts
 * const tabs = lt.tabs({ id: "file", keys: ["claim", "attachments"], label: "Parts of the claim" })
 * ```
 */
export const tabs = (options: TabsOptions): TabsAttributes => {
  const { id, keys, panelId } = prepare("lt.tabs()", options)
  return {
    list: attributes({ class: TABS_LIST_CLASS, "aria-label": options.label }),
    tabs: keys.map((key) => attributes({ href: `#${panelId(key)}` })),
    panels: keys.map((key) =>
      attributes({ id: panelId(key), class: TABS_PANEL_CLASS }),
    ),
    headings: keys.map((key) => attributes({ id: `${id}-${key}-heading` })),
  }
}

export type TabsWithStateOptions = TabsOptions & {
  /** The index of the selected tab. Default: 0. */
  selected?: number
}

export type TabsWithStateAttributes = {
  list: {
    class: typeof TABS_LIST_CLASS
    role: "tablist"
    "aria-label": string
  }
  item: { role: "presentation" }
  tabs: Array<{
    id: string
    href: string
    role: "tab"
    "aria-selected": "true" | "false"
    "aria-controls": string
    tabindex: "0" | "-1"
  }>
  panels: Array<{
    id: string
    class: typeof TABS_PANEL_CLASS
    role: "tabpanel"
    "aria-labelledby": string
    tabindex?: "0"
    hidden?: true
  }>
}

/**
 * The whole state, as `<lt-tabs>` would have written it. For React.
 *
 * React compares the attributes on the elements it renders with what is in
 * the page, and reports a mismatch for every attribute it did not render
 * itself. When the web component wrote the roles and the selection before
 * React hydrated, that gave one mismatch per element. Here everything is
 * there from the start, so the web component has nothing to write.
 *
 * The links get their id from the server, and each panel points to its link,
 * as the APG does. An id the server writes is stable; it is an id the web
 * component creates itself that makes an update replace the element.
 *
 * `hidden` is boolean: React 19 writes `hidden="until-found"` as
 * `hidden=""`. Find in page therefore does not open a hidden panel in a React
 * app.
 */
export const tabsWithState = (
  options: TabsWithStateOptions,
): TabsWithStateAttributes => {
  const { id, keys, panelId } = prepare("lt.tabs()", options)
  // If `selected` is out of range, it is corrected here. Otherwise the markup
  // would say something other than what the user sees.
  // A number that is not an integer, such as `NaN` or 1.5, gave no selected
  // tab, every panel hidden and no tab stop.
  const selected = Number.isInteger(options.selected)
    ? (options.selected as number)
    : 0
  const valid = Math.min(Math.max(selected, 0), Math.max(keys.length - 1, 0))
  const tabId = (key: string) => `${id}-${key}-tab`
  return {
    list: attributes({
      class: TABS_LIST_CLASS,
      role: "tablist" as const,
      "aria-label": options.label,
    }),
    item: attributes({ role: "presentation" as const }),
    tabs: keys.map((key, index) =>
      attributes({
        id: tabId(key),
        href: `#${panelId(key)}`,
        role: "tab" as const,
        "aria-selected": (index === valid ? "true" : "false") as
          | "true"
          | "false",
        "aria-controls": panelId(key),
        // Roving tabindex: only the selected tab is a tab stop.
        tabindex: (index === valid ? "0" : "-1") as "0" | "-1",
      }),
    ),
    panels: keys.map((key, index) =>
      attributes({
        id: panelId(key),
        class: TABS_PANEL_CLASS,
        role: "tabpanel" as const,
        "aria-labelledby": tabId(key),
        // Only the selected panel is a tab stop. A hidden panel that can take
        // focus is an invisible stop for the keyboard.
        tabindex: index === valid ? ("0" as const) : undefined,
        hidden: index === valid ? undefined : (true as const),
      }),
    ),
  }
}
