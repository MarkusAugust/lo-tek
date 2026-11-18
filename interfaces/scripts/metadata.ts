/**
 * What an editor, the manifest and the rulebooks need to know about each
 * component that its source does not say: one sentence per element, per
 * attribute and per allowed value, the parts, the classes, and the markup
 * each builder function belongs in.
 *
 * It is written by hand, one file per component in `metadata/`, by the name
 * of the component's folder. Here the files are put together into the
 * tables the generators read: `generate-vocabulary.ts`, which writes
 * `html-data.json` (VS Code) and `web-types.json` (JetBrains) among others,
 * and `generate-manifest.ts`. `check-vocabulary.ts` holds the list to the
 * package: every element it registers is here.
 *
 * Nothing here is shipped in the package.
 */

import { DEFAULT_TEXTS } from "../src/components/default-texts.js"
import { LT_SUGGESTION_TAG } from "../src/components/frame/suggestion/lt-suggestion.js"
import { LT_CONNECTION_STATUS_TAG } from "../src/components/standalone/connection-status/lt-connection-status.js"
import { LT_TOAST_TAG } from "../src/components/standalone/toast/lt-toast.js"
import type { Anatomy, DefaultText } from "../src/vocabulary/types.js"
import { accordion } from "./metadata/accordion.js"
import { alert } from "./metadata/alert.js"
import { avatar } from "./metadata/avatar.js"
import { badge } from "./metadata/badge.js"
import { breadcrumbs } from "./metadata/breadcrumbs.js"
import { button } from "./metadata/button.js"
import { card } from "./metadata/card.js"
import { checkbox } from "./metadata/checkbox.js"
import { connectionStatus } from "./metadata/connection-status.js"
import { dialog } from "./metadata/dialog.js"
import { divider } from "./metadata/divider.js"
import { errorSummary } from "./metadata/error-summary.js"
import { errorText } from "./metadata/error-text.js"
import { field } from "./metadata/field.js"
import { fieldset } from "./metadata/fieldset.js"
import { fileUpload } from "./metadata/file-upload.js"
import { heading } from "./metadata/heading.js"
import { helpText } from "./metadata/help-text.js"
import { icon } from "./metadata/icon.js"
import { input } from "./metadata/input.js"
import { label } from "./metadata/label.js"
import { link } from "./metadata/link.js"
import { list } from "./metadata/list.js"
import { pagination } from "./metadata/pagination.js"
import { paragraph } from "./metadata/paragraph.js"
import { popover } from "./metadata/popover.js"
import { progress } from "./metadata/progress.js"
import { radio } from "./metadata/radio.js"
import { search } from "./metadata/search.js"
import { select } from "./metadata/select.js"
import { sessionTimeout } from "./metadata/session-timeout.js"
import type {
  BuilderPart,
  ClassDoc,
  ComponentDoc,
  ElementDoc,
} from "./metadata/shared.js"
import { skeleton } from "./metadata/skeleton.js"
import { skipLink } from "./metadata/skip-link.js"
import { spinner } from "./metadata/spinner.js"
import { srOnly } from "./metadata/sr-only.js"
import { steps } from "./metadata/steps.js"
import { suggestion } from "./metadata/suggestion.js"
import { switchComponent } from "./metadata/switch.js"
import { table } from "./metadata/table.js"
import { tabs } from "./metadata/tabs.js"
import { tag } from "./metadata/tag.js"
import { term } from "./metadata/term.js"
import { textarea } from "./metadata/textarea.js"
import { toast } from "./metadata/toast.js"
import { toggleGroup } from "./metadata/toggle-group.js"
import { tooltip } from "./metadata/tooltip.js"

export type * from "./metadata/shared.js"

/**
 * The components, by the name of their folder in `src/components/`. The
 * ones with an element come last, in the order the vocabulary lists the
 * elements.
 */
export const COMPONENTS: Record<string, ComponentDoc> = {
  accordion,
  alert,
  avatar,
  badge,
  breadcrumbs,
  button,
  card,
  checkbox,
  divider,
  "error-text": errorText,
  fieldset,
  "file-upload": fileUpload,
  heading,
  "help-text": helpText,
  icon,
  input,
  label,
  link,
  list,
  pagination,
  paragraph,
  progress,
  radio,
  search,
  select,
  skeleton,
  "skip-link": skipLink,
  spinner,
  "sr-only": srOnly,
  steps,
  switch: switchComponent,
  table,
  tag,
  textarea,
  "toggle-group": toggleGroup,
  tooltip,
  field,
  tabs,
  "error-summary": errorSummary,
  popover,
  term,
  suggestion,
  dialog,
  toast,
  "session-timeout": sessionTimeout,
  "connection-status": connectionStatus,
}

/**
 * Where each text in `DEFAULT_TEXTS` is written, and the attributes that
 * replace it, any one of them. Every text has a row: the type requires it.
 * `default-texts.browser.test.ts` holds each row to the component: the text
 * shows without the attributes, and each attribute replaces it.
 *
 * The counts in `<lt-suggestion>` go through `Intl.PluralRules`: a form the
 * language does not have is never asked for, so only `count-none` and
 * `count-other` replace a text in every language.
 */
export const TEXT_PLACES: Record<
  keyof typeof DEFAULT_TEXTS,
  { element: string; replacedBy: readonly string[] }
> = {
  toastClose: { element: LT_TOAST_TAG, replacedBy: ["close-label"] },
  connectionOffline: {
    element: LT_CONNECTION_STATUS_TAG,
    replacedBy: ["offline-text"],
  },
  connectionOnline: {
    element: LT_CONNECTION_STATUS_TAG,
    replacedBy: ["online-text"],
  },
  suggestionNone: {
    element: LT_SUGGESTION_TAG,
    replacedBy: ["count-none", "count-other"],
  },
  suggestionOne: {
    element: LT_SUGGESTION_TAG,
    replacedBy: ["count-one", "count-other"],
  },
  suggestionOther: { element: LT_SUGGESTION_TAG, replacedBy: ["count-other"] },
}

/** The element's texts, for the manifest. Each attribute must be one it reads. */
function textsOf(
  tag: string,
  attributes: string[],
): { texts?: Record<string, DefaultText> } {
  const rows = Object.entries(TEXT_PLACES).filter(([, p]) => p.element === tag)
  if (rows.length === 0) return {}
  for (const [key, place] of rows)
    for (const attribute of place.replacedBy)
      if (!attributes.includes(attribute))
        throw new Error(
          `TEXT_PLACES.${key}: <${tag}> does not read ${attribute}`,
        )
  return {
    texts: Object.fromEntries(
      rows.map(([key, place]) => [
        key,
        {
          text: DEFAULT_TEXTS[key as keyof typeof DEFAULT_TEXTS],
          replacedBy: place.replacedBy,
        },
      ]),
    ),
  }
}

const all = Object.values(COMPONENTS)

export const elements: readonly ElementDoc[] = all.flatMap(
  ({ element, parts, name }) =>
    element
      ? [
          {
            ...element,
            parts: parts ?? {},
            ...(name ? { name } : {}),
            ...textsOf(element.tag, Object.keys(element.attributes)),
          },
        ]
      : [],
)

/** The class from `tokens.css`, which belongs to no component. */
const TOKEN_CLASSES: Record<string, ClassDoc> = {
  "lt-theme-control": {
    content: "none",
    tags: [{ tag: "input", attributes: { type: ["radio"] } }],
  },
}

export const classDocs: Record<string, ClassDoc> = Object.assign(
  {},
  ...all.map((component) => component.classes),
  TOKEN_CLASSES,
)

export const BUILDER_ANATOMIES: Record<string, Anatomy> = Object.assign(
  {},
  ...all.map((component) => component.anatomies),
)

export const BUILDER_PARTS: Record<
  string,
  Record<string, BuilderPart | null>
> = Object.assign({}, ...all.map((component) => component.builderParts))
