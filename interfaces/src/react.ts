import { accordion } from "./components/css/accordion/accordion.js"
import { alert } from "./components/css/alert/alert.js"
import { avatar } from "./components/css/avatar/avatar.js"
import { badge } from "./components/css/badge/badge.js"
import { breadcrumbs } from "./components/css/breadcrumbs/breadcrumbs.js"
import { button } from "./components/css/button/button.js"
import { card } from "./components/css/card/card.js"
import { checkbox } from "./components/css/checkbox/checkbox.js"
import { divider } from "./components/css/divider/divider.js"
import { errorText } from "./components/css/error-text/error-text.js"
import { fieldset, legend } from "./components/css/fieldset/fieldset.js"
import { fileUpload } from "./components/css/file-upload/file-upload.js"
import { heading } from "./components/css/heading/heading.js"
import { helpText } from "./components/css/help-text/help-text.js"
import { icon } from "./components/css/icon/icon.js"
import { input } from "./components/css/input/input.js"
import { label } from "./components/css/label/label.js"
import { link } from "./components/css/link/link.js"
import { list } from "./components/css/list/list.js"
import { pagination } from "./components/css/pagination/pagination.js"
import { paragraph } from "./components/css/paragraph/paragraph.js"
import { progress } from "./components/css/progress/progress.js"
import { radio } from "./components/css/radio/radio.js"
import { search } from "./components/css/search/search.js"
import { select } from "./components/css/select/select.js"
import {
  fieldStates,
  isFieldState,
  isRequiredMarker,
  managedNames,
  rememberManaged,
  requiredMarkers,
} from "./components/css/shared.js"
import { skeleton } from "./components/css/skeleton/skeleton.js"
import { skipLink } from "./components/css/skip-link/skip-link.js"
import { spinner } from "./components/css/spinner/spinner.js"
import { srOnly } from "./components/css/sr-only/sr-only.js"
import { switchControl } from "./components/css/switch/switch.js"
import { table, tableSort } from "./components/css/table/table.js"
import { tag } from "./components/css/tag/tag.js"
import { textarea } from "./components/css/textarea/textarea.js"
import { toggleGroup } from "./components/css/toggle-group/toggle-group.js"
import { tooltip } from "./components/css/tooltip/tooltip.js"
import { dialog } from "./components/frame/dialog/dialog.js"
import { errorSummary } from "./components/frame/error-summary/error-summary.js"
import {
  computeFieldAttributes,
  createFieldId,
  type FieldOptions,
} from "./components/frame/field/field-core.js"
import { popover } from "./components/frame/popover/popover.js"
import { sessionTimeout } from "./components/frame/session-timeout/session-timeout.js"
import { suggestion } from "./components/frame/suggestion/suggestion.js"
import {
  type TabsWithStateOptions,
  tabsWithState,
} from "./components/frame/tabs/tabs.js"
import { termWithState } from "./components/frame/term/term.js"
import { connectionStatus } from "./components/standalone/connection-status/connection-status.js"
import { toast } from "./components/standalone/toast/toast.js"
import { type Attributes, setAttributes as setHtmlAttributes } from "./dom.js"

// The types of the events, so `addEventListener` is typed also for someone
// who only imports this entry point. Without the line the import disappeared
// from the `.d.ts` file, and `HTMLElementEventMap` was never extended.
export type { LtEventMap } from "./components/events.js"

/**
 * The same API as `lt`, but with `className` and `htmlFor`.
 *
 * The rest of the system returns `class` and `for`, as the attributes are
 * actually named in HTML. React accepts them, and they end up correctly in
 * the DOM, but the development build writes "Invalid DOM property `class`.
 * Did you mean `className`?" to the console, once for each attribute name. It
 * is noise in every app that uses the components, and it teaches the reader
 * to ignore the console.
 *
 * ```ts
 * import { lt } from "@lo-tek/interfaces/react"
 *
 * <button {...lt.button({ variant: "secondary" })}>Save draft</button>
 * ```
 *
 * The call sites are identical to the rest of the system; only the import
 * path differs. This is a plain renaming of keys, so the package gets no
 * dependency on React from it.
 *
 * Astro and plain HTML take `class` and `for` as they are. There you use
 * `@lo-tek/interfaces` directly.
 */

/**
 * Gives the keys the names React expects, and the values the types React
 * expects.
 *
 * `tabindex` is not only a different name: in HTML the value is a string, and
 * in React `tabIndex` is a number. When we left the string, `lt.tabs()` came
 * out with `tabIndex: "0"`, and TypeScript rejected it in every React app. It
 * worked in the browser, since React converts the value itself, so the bug
 * only showed up as a type error for the consumer.
 */
export type ReactAttributes<T> = {
  [K in keyof T as K extends "class"
    ? "className"
    : K extends "for"
      ? "htmlFor"
      : K extends "tabindex"
        ? "tabIndex"
        : K extends "autocomplete"
          ? "autoComplete"
          : K]: K extends "tabindex" ? number : T[K]
}

/**
 * The attributes that have another name in React.
 *
 * `tabindex` came with the compound builder functions, and `autocomplete`
 * with the suggestion field. Without the renaming React warns about every
 * one of them.
 *
 * `aria-*` and `data-*`, on the other hand, stay as they are. React passes
 * them on unchanged, and renaming them would give invalid attributes.
 *
 * `react.browser.test.ts` calls every builder function here with every
 * allowed value it declares, collects all attribute names in the result,
 * including those in lists and nested levels, and rejects every name React
 * spells differently. The list there is React's and is longer than the four
 * we rename, so a builder function that one day outputs `readonly` or
 * `maxlength` stops there and not in a consumer's console.
 */
const REACT_NAMES: Record<string, string> = {
  class: "className",
  for: "htmlFor",
  tabindex: "tabIndex",
  autocomplete: "autoComplete",
}

export function toReactAttributes<T extends Record<string, unknown>>(
  attributes: T,
): ReactAttributes<T> {
  const result: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(attributes)) {
    // `tabindex` is a string in HTML and a number in React. Everything else
    // passes straight through: it is the names that differ, not the values.
    result[REACT_NAMES[name] ?? name] =
      name === "tabindex" ? Number(value) : value
  }
  // The new object manages the same as the old one, under the new names, so
  // `setAttributes` below can clean up as much as the main entry point.
  const names = managedNames(attributes)
  if (names)
    rememberManaged(
      result,
      names.map((name) => REACT_NAMES[name] ?? name),
    )
  return result as ReactAttributes<T>
}

/** The names back to HTML, for `setAttributes`. */
const HTML_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(REACT_NAMES).map(([html, react]) => [react, html]),
)

/**
 * A set as the builder functions here return it, with `className`,
 * `htmlFor` and `tabIndex` as a number.
 */
export type ReactSet = Record<string, string | number | boolean | undefined>

/**
 * Writes a set from this entry point back to the HTML names.
 *
 * `setAttribute` writes the name as given, and in an HTML document it becomes
 * lower case: `className` became the attribute `classname`, and `htmlFor`
 * became `htmlfor`. The new object manages the same as the set it came from,
 * so what is gone in the next call is cleaned up.
 */
function toHtmlAttributes(set: ReactSet): Attributes {
  const result: Attributes = {}
  for (const [name, value] of Object.entries(set)) {
    result[HTML_NAMES[name] ?? name] =
      typeof value === "number" ? String(value) : value
  }
  const names = managedNames(set)
  if (names)
    rememberManaged(
      result,
      names.map((name) => HTML_NAMES[name] ?? name),
    )
  return result
}

/**
 * Like `lt.setAttributes` in the main entry point, for the sets from here.
 *
 * A React app reaches the DOM through a `ref`, and then naturally uses `lt`
 * from this entry point. Passed straight to the main entry point's
 * `setAttributes`, `className` became the attribute `classname`, and the
 * cleanup did not find the builder function behind the set. Here the names
 * are translated back first.
 */
export function setAttributes(
  element: Element | null | undefined,
  ...sets: ReactSet[]
): void {
  setHtmlAttributes(element, ...sets.map((set) => toHtmlAttributes(set)))
}

/**
 * Wraps a builder function so the return value gets the React names.
 *
 * The signature is written as an intersection type so TypeScript can infer
 * both the options type and the extra fields attached to the function, that
 * is `variants`, `isVariant` and the others, in one go.
 */
function forReact<Options, Result extends Record<string, unknown>, Extra>(
  fn: ((options?: Options) => Result) & Extra,
): ((options?: Options) => ReactAttributes<Result>) & Extra {
  const wrapped = (options?: Options) => toReactAttributes(fn(options))
  return Object.assign(wrapped, fn)
}

/**
 * Re-exported from the main entry point.
 *
 * `field.mdx` points to it in a section that tells the reader to import from
 * `@lo-tek/interfaces/react`, and without this a React consumer who follows
 * the advice gets "createFieldId is not exported". It is safe only when the
 * markup is rendered once; in a React component `useId()` is the answer,
 * also in an app without a server.
 */
export { createFieldId }

export const lt = {
  accordion: forReact(accordion),
  alert: forReact(alert),
  avatar: forReact(avatar),
  badge: forReact(badge),
  breadcrumbs: forReact(breadcrumbs),
  button: forReact(button),
  card: forReact(card),
  checkbox: forReact(checkbox),
  divider: forReact(divider),
  errorText: forReact(errorText),
  fieldset: forReact(fieldset),
  heading: forReact(heading),
  fileUpload: forReact(fileUpload),
  helpText: forReact(helpText),
  icon: forReact(icon),
  input: forReact(input),
  label: forReact(label),
  legend: forReact(legend),
  link: forReact(link),
  list: forReact(list),
  pagination: forReact(pagination),
  paragraph: forReact(paragraph),
  radio: forReact(radio),
  search: forReact(search),
  select: forReact(select),
  skeleton: forReact(skeleton),
  skipLink: forReact(skipLink),
  progress: forReact(progress),
  spinner: forReact(spinner),
  srOnly: forReact(srOnly),
  switch: forReact(switchControl),
  toggleGroup: forReact(toggleGroup),
  tooltip: forReact(tooltip),
  table: forReact(table),
  tableSort: Object.assign(
    (options?: Parameters<typeof tableSort>[0]) => {
      const built = tableSort(options)
      return {
        header: built.header,
        button: toReactAttributes(built.button),
      }
    },
    { isDirection: tableSort.isDirection },
  ),
  tag: forReact(tag),
  textarea: forReact(textarea),

  /**
   * Wires a whole field, with `className` and `htmlFor` on the label.
   *
   * `control`, `help` and `error` have no keys that need renaming, and are
   * therefore the same in both entry points.
   */
  field: (options: FieldOptions) => {
    const field = computeFieldAttributes(options)
    return { ...field, label: toReactAttributes(field.label) }
  },

  /**
   * The compound builder functions return one attribute set per element,
   * and each set must be renamed on its own. `host` has `tabindex`, and the
   * panels in `lt.tabs()` have both `tabindex` and `class`.
   */
  errorSummary: (options: Parameters<typeof errorSummary>[0] = {}) => {
    const built = errorSummary(options)
    return {
      host: toReactAttributes(built.host),
      title: toReactAttributes(built.title),
    }
  },

  dialog: Object.assign(
    (options: Parameters<typeof dialog>[0]) => {
      const built = dialog(options)
      return {
        host: built.host,
        dialog: toReactAttributes(built.dialog),
        header: toReactAttributes(built.header),
        title: toReactAttributes(built.title),
        subtitle: toReactAttributes(built.subtitle),
        body: toReactAttributes(built.body),
        footer: toReactAttributes(built.footer),
      }
    },
    {
      dialog: dialog.dialog,
      header: dialog.header,
      title: dialog.title,
      subtitle: dialog.subtitle,
      body: dialog.body,
      footer: dialog.footer,
      colors: dialog.colors,
      isColor: dialog.isColor,
    },
  ),

  popover: Object.assign(
    (options: Parameters<typeof popover>[0]) => {
      const built = popover(options)
      return {
        host: built.host,
        trigger: toReactAttributes(built.trigger),
        panel: toReactAttributes(built.panel),
      }
    },
    { isPlacement: popover.isPlacement },
  ),

  /**
   * The whole state, not just the links: React reports a mismatch for every
   * attribute the component writes on an element React has rendered. See
   * `tabsWithState`.
   */
  tabs: (options: TabsWithStateOptions) => {
    const built = tabsWithState(options)
    return {
      list: toReactAttributes(built.list),
      item: toReactAttributes(built.item),
      tabs: built.tabs.map(toReactAttributes),
      panels: built.panels.map(toReactAttributes),
    }
  },

  /**
   * With `aria-expanded`, which `<lt-term>` writes: React reports a mismatch
   * for an attribute it did not render. See `termWithState`.
   */
  term: (options: Parameters<typeof termWithState>[0]) => {
    const built = termWithState(options)
    return {
      word: toReactAttributes(built.word),
      entry: toReactAttributes(built.entry),
    }
  },

  suggestion: (options: Parameters<typeof suggestion>[0]) => {
    const built = suggestion(options)
    return {
      ...built,
      label: toReactAttributes(built.label),
      control: toReactAttributes(built.control),
      list: toReactAttributes(built.list),
      options: built.options.map(toReactAttributes),
      empty: toReactAttributes(built.empty),
      status: toReactAttributes(built.status),
      value: toReactAttributes(built.value),
    }
  },

  toast: (options: Parameters<typeof toast>[0] = {}) => {
    const built = toast(options)
    return {
      host: toReactAttributes(built.host),
      message: toReactAttributes(built.message),
      close: toReactAttributes(built.close),
    }
  },

  sessionTimeout: Object.assign(
    (options: Parameters<typeof sessionTimeout>[0]) => {
      const built = sessionTimeout(options)
      return {
        host: toReactAttributes(built.host),
        dialog: toReactAttributes(built.dialog),
        title: toReactAttributes(built.title),
        text: toReactAttributes(built.text),
        count: toReactAttributes(built.count),
        live: toReactAttributes(built.live),
        actions: toReactAttributes(built.actions),
        extend: toReactAttributes(built.extend),
        logout: toReactAttributes(built.logout),
      }
    },
    {
      dialog: sessionTimeout.dialog,
      title: sessionTimeout.title,
      text: sessionTimeout.text,
      count: sessionTimeout.count,
      actions: sessionTimeout.actions,
    },
  ),
  connectionStatus: forReact(connectionStatus),

  setAttributes,

  states: fieldStates,
  isState: isFieldState,
  markers: requiredMarkers,
  isMarker: isRequiredMarker,
} as const
