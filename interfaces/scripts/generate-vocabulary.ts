/**
 * Writes the vocabulary and the editor files from `metadata.ts` and the
 * component pages.
 *
 * The files ship in the package, and none of them is written by hand. The
 * editors read them: the VS Code extension copies the first two when it is
 * built, and the IntelliJ plugin reads the classes from the project's
 * manifest, with the manifest in the Kotlin package as the fallback.
 *
 *   - `html-data.json`: VS Code's own format for tags and attributes. The
 *     HTML language service uses it for completion and hover.
 *   - `snippets.json`: one snippet per element, with the markup that shows
 *     the element on the component page. The code blocks there are already
 *     checked by `check-recipes.ts`, so the classes and elements in the
 *     snippet exist.
 *   - `interfaces/src/vocabulary/elements.ts`: the elements and the
 *     attributes, tag by tag, which the manifest is written from.
 *   - `interfaces/src/vocabulary/classes.ts`: every `lt-` class in the
 *     package's CSS, with the component it belongs to, and for each builder
 *     function in `lt` which attribute a variant, size, colour or state
 *     becomes. It is read by calling the functions, not by reading the source
 *     code, so it is what the package actually returns. `html-data` does not
 *     tell a number from a text, and has no room for it, so the diagnostics
 *     get their own file from the same source.
 *   - `interfaces/web-types.json`: the JetBrains format. It ships with the
 *     npm package, and WebStorm finds it in `node_modules` on its own.
 *
 * Run with: bun --filter @lo-tek/interfaces vocabulary
 * `check-vocabulary.ts` does the same in memory and fails if the files on
 * disk are out of date.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { lt } from "../src/index.js"
import type {
  Attribute,
  Classes,
  ClassInfo,
  CssText,
  Elements,
} from "../src/vocabulary/types.js"
import { flagsFor, readBuilderFunctions } from "./builder-functions.js"
import { isText, replaceableText, splitOutside } from "./css-text.js"
import {
  type AttributeDoc,
  type ClassDoc,
  classDocs,
  type ElementDoc,
  elements,
} from "./metadata"
import { dedent, htmlBlocks, kotlinBlocks } from "./recipes.js"

export const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const DOCS = "https://lo-tek.sobernetics.no/components/"
const PAGES = join(ROOT, "documentation/src/content/docs/components")

const docsUrl = (element: ElementDoc) => `${DOCS}${element.slug}/`

/*
 * VS Code: https://github.com/microsoft/vscode-html-languageservice
 *          /blob/main/docs/customData.md
 *
 * `valueSet: "v"` is the built-in set for boolean attributes, the same one
 * `hidden` and `disabled` use. The editor then suggests the attribute without `=""`.
 */
function htmlDataAttribute(name: string, doc: AttributeDoc) {
  const base = {
    name,
    description: { kind: "markdown", value: doc.description },
  }
  if (doc.value === "flag") return { ...base, valueSet: "v" }
  if (typeof doc.value === "object")
    return {
      ...base,
      values: doc.value.values.map((v) => ({
        name: v.name,
        description: { kind: "markdown", value: v.description },
      })),
    }
  return base
}

export function htmlData() {
  return {
    version: 1.1,
    tags: elements.map((element) => ({
      name: element.tag,
      description: { kind: "markdown", value: element.description },
      attributes: Object.entries(element.attributes).map(([name, doc]) =>
        htmlDataAttribute(name, doc),
      ),
      references: [{ name: "Documentation", url: docsUrl(element) }],
    })),
  }
}

/*
 * JetBrains: https://github.com/JetBrains/web-types
 *
 * The schema is written from the description there, and checked in IntelliJ
 * IDEA Ultimate 2026.2: completion of elements, attributes and values, and
 * documentation with a link, with no setup other than the package being in
 * `package.json`.
 */
function webTypesAttribute(name: string, doc: AttributeDoc) {
  const base = { name, description: doc.description }
  if (doc.value === "flag") return { ...base, value: { kind: "no-value" } }
  if (typeof doc.value === "object")
    return {
      ...base,
      value: { kind: "plain", type: "enum" },
      values: doc.value.values.map((v) => ({
        name: v.name,
        description: v.description,
      })),
    }
  return { ...base, value: { kind: "plain", type: doc.value } }
}

export function webTypes(version: string) {
  return {
    $schema:
      "https://raw.githubusercontent.com/JetBrains/web-types/master/schema/web-types.json",
    name: "@lo-tek/interfaces",
    version,
    "description-markup": "markdown",
    contributions: {
      html: {
        elements: elements.map((element) => ({
          name: element.tag,
          description: element.description,
          "doc-url": docsUrl(element),
          attributes: Object.entries(element.attributes).map(([name, doc]) =>
            webTypesAttribute(name, doc),
          ),
          // The events, so `addEventListener("dialog-toggle", …)` and
          // `@dialog-toggle` in a framework get completion.
          ...(Object.keys(element.events).length
            ? {
                js: {
                  events: Object.entries(element.events).map(([name, doc]) => ({
                    name,
                    description: doc.detail
                      ? `${doc.description}\n\n\`detail\`: \`{ ${Object.entries(
                          doc.detail,
                        )
                          .map(([k, t]) => `${k}: ${t}`)
                          .join(", ")} }\``
                      : doc.description,
                  })),
                },
              }
            : {}),
        })),
      },
      /*
       * The classes, so `class="lt-…"` gets completion in the JetBrains IDEs.
       *
       * Only the nine elements used to be here, so a developer got
       * suggestions for `<lt-field>` but nothing for `lt-button`, although the
       * classes are the largest part of the system and the only part a CSS
       * component has.
       *
       * The list is the same `classesData()` that writes `classes.ts`, that
       * is, the one the diagnostics fail on. The editor therefore cannot
       * suggest a class the check rejects, or reject one it suggests.
       */
      css: {
        classes: Object.entries(classesData()).map(([name, info]) => ({
          name,
          description: `**${info.title}**\n\n${info.description}`,
          "doc-url": info.link,
        })),
      },
    },
  }
}

/**
 * The markup that shows the element, from the component page.
 *
 * The first code block with HTML on the page that actually contains `<lt-…>`,
 * without stylesheets and without Datastar. Usually that is the "Plain HTML"
 * tab. On the dialog page it is not: there the "Plain HTML" recipe opens the
 * dialog with `showModal()` from script, without the web component, and a
 * snippet for `<lt-dialog>` without `<lt-dialog>` in it was the first review
 * finding.
 *
 * The snippet is the markup up to the first script: the stylesheets and the
 * registration belong in the page template, once for the whole app, not
 * where the cursor is.
 */
export function recipe(element: ElementDoc): string {
  const page = readFileSync(join(PAGES, `${element.slug}.mdx`), "utf8")
  const blocks = htmlBlocks(page)
  const markup = blocks.find(
    (b) =>
      b.includes(`<${element.tag}`) &&
      !b.includes('rel="stylesheet"') &&
      !b.includes("data-on"),
  )
  if (!markup)
    throw new Error(
      `${element.slug}.mdx has no HTML block with <${element.tag}> in it`,
    )

  // The comment right before the script can span several lines, but never
  // past its own `-->`: otherwise it would swallow the markup between two comments.
  const body = markup.split(
    /\n[ \t]*(?:<!--(?:(?!-->)[\s\S])*-->\n[ \t]*)?<script\b/,
  )[0]
  return dedent(body)
}

/*
 * A snippet body is a template language: `$1` is a tab stop and `\` is the
 * escape character. The markup should come out verbatim, so both are escaped.
 */
const escapeSnippet = (line: string) =>
  line.replace(/\\/g, "\\\\").replace(/\$/g, "\\$")

const escapeRegex = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * The ids in a recipe, in order, and everything that points to each of them.
 *
 * Since v6 the id is what the template writes itself: `for` on the label and
 * `id` on the field, `href` on the tab and `id` on the panel. In a snippet
 * each id becomes a tab stop, and the pointers mirror it, so it is typed once.
 */
function idsIn(body: string): string[] {
  return [...new Set([...body.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]))]
}

/**
 * The pointers to an id: `for`, `aria-labelledby`, `aria-controls` and
 * `href="#…"`. `write(name, value)` rewrites the attribute where the value is
 * the id.
 */
function mirror(
  body: string,
  id: string,
  write: (attribute: string, prefix: string) => string,
): string {
  const esc = escapeRegex(id)
  return body
    .replace(
      new RegExp(`\\b(for|aria-labelledby|aria-controls)="${esc}"`, "g"),
      (_, attribute: string) => write(attribute, ""),
    )
    .replace(new RegExp(`\\bhref="#${esc}"`, "g"), () => write("href", "#"))
}

/**
 * The snippet with tab stops: an empty `$1` where the id is, and the same
 * `$1` where it is pointed to.
 *
 * The id from the recipe is not filled in. It compiled and ran when the
 * snippet was pasted twice on a page, or in a loop, and two fields with the
 * same id are matched wrongly by a morph. An empty id is a mistake you see:
 * `lotek check` reports that the label is not wired to the field.
 */
function withTabstops(body: string): string {
  let out = body
  idsIn(body).forEach((id, i) => {
    const n = i + 1
    out = out.replace(
      new RegExp(`\\bid="${escapeRegex(id)}"`, "g"),
      () => `id="$${n}"`,
    )
    out = mirror(
      out,
      id,
      (attribute, prefix) => `${attribute}="${prefix}$${n}"`,
    )
  })
  return out
}

export function snippets() {
  const out: Record<
    string,
    { prefix: string; body: string[]; description: string }
  > = {}
  for (const element of elements) {
    // The tab stops are inserted after escaping, or they would be escaped too.
    const body = recipe(element).split("\n").map(escapeSnippet).join("\n")
    out[element.tag] = {
      prefix: element.tag,
      body: withTabstops(body).split("\n"),
      description: element.description,
    }
  }
  return out
}

/**
 * The Kotlin recipe on a component page: the ```kotlin block in the kotlinx.html tab
 * with `fun FlowContent.…`, the same code `RecipesTest` in
 * `kotlin/kotlinx-html` compiles and compares with the HTML recipe. `null`
 * when the page has no kotlinx.html tab, as a `<TabItem>` or as a
 * `<Fragment slot="kotlin">` in an `<Example>`.
 */
function kotlinRecipe(slug: string): string | undefined {
  const blocks = kotlinBlocks(join(PAGES, `${slug}.mdx`))
  if (!blocks) return undefined
  const recipe = blocks.find((b) => b.includes("fun FlowContent."))
  if (!recipe)
    throw new Error(
      `${slug}.mdx has a kotlinx.html tab without a \`fun FlowContent.…\` block`,
    )
  return recipe
}

/**
 * Live templates for Kotlin in IntelliJ, one per web component with a kotlinx.html tab:
 * `ltfield` inserts the recipe from the field page, the function and the data
 * classes it uses, at the top level of a file.
 *
 * The imports cannot come along, so the names from LO-TEK are written in
 * full, `no.lotek.Lt` and `no.lotek.RequiredMarker.SYMBOL`, and the template
 * has `toShortenFQNames`, which shortens them and adds the imports. A value of
 * LO-TEK's is told from one of kotlinx.html's by its case: `ButtonVariant.GHOST`
 * against `ButtonType.submit`. That is a guess about every name written
 * `Name.CONSTANT`, so `KotlinLiveTemplateTest` inserts every template and
 * requires it to compile: `Int.MAX_VALUE` in a recipe would fail there. The
 * extensions `lt` and `ltField` and the tags of kotlinx.html cannot be written
 * in full, and need `import kotlinx.html.*` and `import no.lotek.html.*`, as
 * the description says.
 *
 * Every id the recipe gives, `id = "codename"` and `titleId = "…"`, becomes
 * an empty variable, mirrored where the same id stands again, as in the HTML
 * templates (`withTabstops`).
 */
export function kotlinLiveTemplates(): string {
  const templates: string[] = []
  for (const element of elements) {
    const recipe = kotlinRecipe(element.slug)
    if (recipe) templates.push(kotlinLiveTemplate(element.slug, recipe))
  }
  if (templates.length === 0)
    throw new Error(
      "No component page has a kotlinx.html tab, so there are no Kotlin live templates.",
    )
  return `<!-- Generated by interfaces/scripts/generate-vocabulary.ts. Do not edit. -->\n<templateSet group="LO-TEK Kotlin">\n${templates.join("\n")}\n</templateSet>\n`
}

/**
 * One Kotlin live template from the recipe on the page `slug`. Throws on an
 * id the template cannot make a variable of; `check-vocabulary.ts` feeds it
 * such recipes every time it runs.
 */
export function kotlinLiveTemplate(slug: string, recipe: string): string {
  const xml = (text: string) =>
    text
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "&#10;")
  let body = recipe
    .split("\n")
    .filter((line) => !line.startsWith("import "))
    .join("\n")
    .trim()
    .replace(/\$/g, "$$$$")
    .replace(/\bLt\./g, "no.lotek.Lt.")
    .replace(/\b([A-Z][A-Za-z]+)\.([A-Z][A-Z0-9_]*)\b/g, "no.lotek.$1.$2")
  const ids = [
    ...new Set(
      [...body.matchAll(/\b(?:id|titleId) = "([^"$]+)"/g)].map((m) => m[1]),
    ),
  ]
  // Checked on the recipe as it stands, before any id is a variable.
  for (const id of ids) {
    // The variable name is the id with `-` as `_`, so check-vocabulary can
    // tell which id it stands for. An id that stands inside a longer text,
    // `"#codename"` or `"codename-help"`, would keep the old id after the
    // user typed a new one, so the generator stops on both.
    if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(id))
      throw new Error(
        `${slug}.mdx: the Kotlin recipe has the id "${id}". A template variable is the id with - as _, so an id may have letters, digits and - only.`,
      )
    // A reference to the id inside a longer text: `#codename` anywhere,
    // also in a selector with spaces, or `codename-help` at the start, as
    // an id derived from it. Not `fixer@relay.example` or `given-name`,
    // which only contain the letters.
    const reference = new RegExp(
      `#${escapeRegex(id)}(?![\\w-])|^${escapeRegex(id)}-`,
    )
    const inside = [...body.matchAll(/"([^"\n]*)"/g)]
      .map((m) => m[1])
      // `"errors-title"` is an id of its own, with its own variable.
      .filter((text) => text !== id && !ids.includes(text))
      .find((text) => reference.test(text))
    if (inside)
      throw new Error(
        `${slug}.mdx: the Kotlin recipe has the id "${id}" inside the text "${inside}". Make it from the variable the builder function gives, or the text keeps the old id in the template.`,
      )
  }
  const variables = ids.map((id) => {
    const name = id.replace(/-/g, "_")
    // Every place the id stands as a text, not only `id = "…"`: the error
    // summary also compares `it.field == "fixer"`, and a field that got
    // another id would never be marked invalid. The field's `name` is often
    // the same text, and follows the id too, as the field page advises.
    body = body.replace(
      new RegExp(`"${escapeRegex(id)}"`, "g"),
      () => `"$${name}$"`,
    )
    return `    <variable name="${name}" expression="" defaultValue="" alwaysStopAt="true" />`
  })
  const key = `lt${slug.replace(/-/g, "")}`
  const description = `The Kotlin recipe from the ${slug} page, in kotlinx.html. Needs import kotlinx.html.* and no.lotek.html.*; the names from no.lotek are imported when it is inserted.`
  return [
    `  <template name="${key}" value="${xml(body)}" description="${xml(description)}" toReformat="true" toShortenFQNames="true">`,
    ...variables,
    "    <context>",
    '      <option name="KOTLIN_TOPLEVEL" value="true" />',
    "    </context>",
    "  </template>",
  ].join("\n")
}

/**
 * Live templates for IntelliJ, from the same recipes as the snippets.
 *
 * The format is IntelliJ's own: `$name$` is a variable, `$$` a dollar sign,
 * and the variable name must be an identifier, so `session-title` becomes
 * `session_title`. The plugin copies the file in as `liveTemplates/Lotek.xml`.
 */
export function liveTemplates(): string {
  const xml = (text: string) =>
    text
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "&#10;")
  const templates = elements.map((element) => {
    let body = recipe(element).replace(/\$/g, "$$$$")
    const variables = idsIn(body).map((id) => {
      const name = id.replace(/[^A-Za-z0-9_]/g, "_")
      body = body.replace(
        new RegExp(`\\bid="${escapeRegex(id)}"`, "g"),
        () => `id="$${name}$"`,
      )
      body = mirror(
        body,
        id,
        (attribute, prefix) => `${attribute}="${prefix}$${name}$"`,
      )
      // Empty, as in the snippets: see `withTabstops`.
      return `    <variable name="${name}" expression="" defaultValue="" alwaysStopAt="true" />`
    })
    return [
      `  <template name="${element.tag}" value="${xml(body)}" description="${xml(element.description)}" toReformat="false" toShortenFQNames="false">`,
      ...variables,
      "    <context>",
      '      <option name="HTML" value="true" />',
      "    </context>",
      "  </template>",
    ].join("\n")
  })
  return `<!-- Generated by interfaces/scripts/generate-vocabulary.ts. Do not edit. -->\n<templateSet group="LO-TEK">\n${templates.join("\n")}\n</templateSet>\n`
}

/*
 * The diagnostics: what each attribute takes, in the form `src/diagnostics.ts`
 * reads. The link is the component page, which becomes a link in the message.
 */
export function diagnosticsData(): Elements {
  const out: Elements = {}
  for (const element of elements) {
    const attributes: Record<string, Attribute> = {}
    for (const [name, doc] of Object.entries(element.attributes)) {
      attributes[name] = {
        ...(typeof doc.value === "object"
          ? { type: "values", values: doc.value.values.map((v) => v.name) }
          : { type: doc.value }),
        description: doc.description,
      }
    }
    out[element.tag] = {
      link: docsUrl(element),
      description: element.description,
      attributes,
      parts: element.parts,
      ...(element.name ? { name: element.name } : {}),
      ...(element.texts ? { texts: element.texts } : {}),
      ...(element.removed ? { removed: element.removed } : {}),
      ...(Object.keys(element.events).length
        ? {
            events: Object.fromEntries(
              Object.entries(element.events).map(([name, doc]) => [
                name,
                doc.detail ? { detail: doc.detail } : {},
              ]),
            ),
          }
        : {}),
    }
  }
  return out
}

/*
 * The classes. The list comes from the CSS files, one folder per component,
 * and the folder name is the path of the component page. Title and
 * description are the page's own frontmatter. The attributes come from the
 * builder functions in `lt`: each function with `variants`, `sizes`,
 * `colors`, `states`, `types` or `pickers` is called once per value, and the
 * attribute it writes out is what is recorded, with the value that gives no
 * attribute as the default.
 */
const COMPONENT_DIRS = ["css", "frame", "standalone"].map((d) =>
  join(ROOT, "interfaces/src/components", d),
)

/*
 * `tokens.css` has classes that do not belong to a component.
 *
 * `.lt-theme-control` is the first: it switches the theme, so the selector
 * lives where the token values live rather than in a component folder.
 * Without this source, `diagnoseMarkup` reported that the class does not
 * exist in LO-TEK on correct markup, and neither VS Code, IntelliJ nor
 * `lotek check` suggested it.
 */
const TOKEN_CSS = join(ROOT, "interfaces/src/tokens/tokens.css")

const OPTION_LISTS: Record<string, string> = {
  variants: "variant",
  sizes: "size",
  colors: "color",
  states: "state",
  types: "type",
  pickers: "picker",
  // `lt.label({ required: "text" })`: the list is called markers, the option required.
  markers: "required",
}

const frontmatter = (slug: string, key: string) => {
  const page = readFileSync(join(PAGES, `${slug}.mdx`), "utf8")
  return page.match(new RegExp(`^${key}: (.*)$`, "m"))?.[1]?.trim() ?? ""
}

const TOKEN_PAGE = {
  component: "customising",
  // Read from the page, as for the components. Copied by hand it drifted from
  // the frontmatter without anything saying so, and the hover in VS Code and
  // JetBrains quoted a description that was nowhere in the documentation.
  title: frontmatter("../customising", "title"),
  description: frontmatter("../customising", "description"),
  link: "https://lo-tek.sobernetics.no/customising/",
}

/**
 * The texts a stylesheet shows that a variable replaces: `content:
 * var(--lt-…, "…")`, or a symbol with the variable as its alternative text,
 * read by `replaceableText()` as `check-texts.ts` reads them. A text without
 * a letter, like " *", is in no language, and is left out. Where the text is
 * shown is read from the rule's selector, in one of two forms:
 *
 *   - the last compound has the class, and the attribute if the text needs
 *     one: `.lt-label[data-required="text"]::after`. A `:not()` there gives
 *     `unless`;
 *   - the class is on the list, and the text on the children before the one
 *     with the attribute: `.lt-steps > li:has(~ [aria-current="step"])`,
 *     with anything after it. That is `siblingsBefore`.
 *
 * Any other selector stops the generator. The text would otherwise be left
 * out of the manifest, and `untranslated-text` could never report it.
 */
function textsInCss(
  css: string,
  file: string,
): { name: string; text: CssText }[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "")
  const out: { name: string; text: CssText }[] = []
  const rule = /([^{}]+)\{([^{}]*)\}/g
  const attributeIn = /\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'))?\]/
  const notIn = /:not\(((?:[^()]|\([^()]*\))*)\)/g
  const before = /:has\(\s*~\s*\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'))?\]\s*\)/
  for (const [, selectors, body] of clean.matchAll(rule)) {
    const value = /(?<![(\w-])content\s*:\s*([^;}]+)/.exec(body)?.[1].trim()
    const found = value === undefined ? undefined : replaceableText(value)
    if (!found || !isText(found.text)) continue
    for (const selector of splitOutside(selectors, /,/)) {
      const compounds = splitOutside(
        selector.replace(/\s*([>+~])\s*/g, " $1 "),
        /\s/,
      )
      const classIn = (compound: string) =>
        compound.replace(notIn, "").match(/\.(lt-[\w-]+)/)?.[1]
      const unlessIn = (compound: string) =>
        [...compound.matchAll(notIn)].flatMap(([, inside]) =>
          [...inside.matchAll(/\[([\w-]+)/g)].map((m) => m[1]),
        )
      const subject = compounds[compounds.length - 1] ?? ""
      let text: CssText | undefined
      let name = classIn(subject)
      if (name) {
        const attribute = subject.replace(notIn, "").match(attributeIn)
        const unless = unlessIn(subject)
        text = {
          variable: found.variable,
          text: found.text,
          ...(attribute ? { attribute: attribute[1] } : {}),
          ...((attribute?.[2] ?? attribute?.[3]) !== undefined
            ? { value: attribute?.[2] ?? attribute?.[3] }
            : {}),
          ...(unless.length > 0 ? { unless } : {}),
        }
      } else {
        const at = compounds.findIndex((compound) => classIn(compound))
        const child = compounds[at + 2] ?? ""
        const attribute = before.exec(child)
        const rest = compounds.slice(at + 1)
        name = at < 0 ? undefined : classIn(compounds[at])
        if (
          name &&
          compounds[at + 1] === ">" &&
          attribute &&
          rest.every((compound) => unlessIn(compound).length === 0)
        ) {
          const unless = unlessIn(compounds[at])
          text = {
            variable: found.variable,
            text: found.text,
            attribute: attribute[1],
            ...((attribute[2] ?? attribute[3]) !== undefined
              ? { value: attribute[2] ?? attribute[3] }
              : {}),
            ...(unless.length > 0 ? { unless } : {}),
            siblingsBefore: true,
          }
        }
      }
      if (!name || !text) {
        throw new Error(
          `${file}: the text "${found.text}" in \`${selector}\` is shown where the generator cannot tell. Put it on the element with the class, or on the children of a list before the one with an attribute, as in lt-steps.`,
        )
      }
      // The same text from two selectors in one rule, as the step's link and
      // the step itself, is one text.
      const key = JSON.stringify(text)
      if (!out.some((o) => o.name === name && JSON.stringify(o.text) === key))
        out.push({ name, text })
    }
  }
  return out
}

function classesInCss(css: string): string[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "")
  return [...new Set(clean.match(/\.lt-[\w-]+/g) ?? [])].map((c) => c.slice(1))
}

/** The classes in what a builder function returns, also when the result is nested. */
function classesIn(value: unknown): string[] {
  if (!value || typeof value !== "object") return []
  const out: string[] = []
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (key === "class" && typeof v === "string") out.push(...v.split(/\s+/))
    else if (v && typeof v === "object") out.push(...classesIn(v))
  }
  return out
}

export function classesData(): Classes {
  /*
   * The classes from the CSS, before the content and the parts from
   * `classDocs` are added. The two are joined at the end, so a class missing
   * from the table can be reported by name rather than get content nobody
   * has written.
   */
  const found: Record<string, Omit<ClassInfo, keyof ClassDoc>> = {}
  for (const dir of COMPONENT_DIRS) {
    for (const slug of readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      // Sorted: Linux returns the folders in a different order from macOS, and
      // the file must be the same wherever it is generated.
      .sort()) {
      const files = readdirSync(join(dir, slug))
        .filter((f) => f.endsWith(".css"))
        .sort()
      const link = `${DOCS}${slug}/`
      const title = frontmatter(slug, "title")
      const description = frontmatter(slug, "description")
      for (const file of files) {
        const css = readFileSync(join(dir, slug, file), "utf8")
        for (const name of classesInCss(css))
          found[name] ??= {
            component: slug,
            title,
            description,
            link,
            attributes: {},
          }
        for (const { name, text } of textsInCss(css, file)) {
          const entry = found[name]
          if (entry) entry.texts = [...(entry.texts ?? []), text]
        }
      }
    }
  }

  for (const name of classesInCss(readFileSync(TOKEN_CSS, "utf8")))
    found[name] ??= { ...TOKEN_PAGE, attributes: {} }

  for (const builder of Object.values(lt as Record<string, unknown>)) {
    if (typeof builder !== "function") continue
    const build = builder as (options?: Record<string, unknown>) => unknown
    let base: unknown
    try {
      // An id, so the builder functions that would otherwise create a random
      // one do not warn. The dialog calls its own titleId, since the id is on
      // the heading. And a name, which the tabs require on the list.
      base = build({ id: "x", titleId: "x", keys: [], label: "x" })
    } catch {
      continue
    }
    /*
     * The sets the result consists of. A builder function like `button`
     * returns one, and `dialog` returns one per part, `host`, `dialog`,
     * `header` and so on. Each set is checked on its own, so `data-color`
     * ends up on `lt-dialog`, which is in the same set, and not on the heading.
     */
    const parts = (result: unknown): [string, Record<string, unknown>][] => {
      if (typeof result !== "object" || result === null) return []
      const entries = Object.entries(result as Record<string, unknown>)
      return entries.some(([, v]) => typeof v === "object" && v !== null)
        ? (entries.filter(
            ([, v]) => typeof v === "object" && v !== null && !Array.isArray(v),
          ) as [string, Record<string, unknown>][])
        : [["", result as Record<string, unknown>]]
    }
    const baseParts = new Map(parts(base))
    for (const [part, basePart] of baseParts) {
      const targets = [...new Set(classesIn(basePart))].filter((c) => found[c])
      if (!targets.length) continue
      for (const [list, option] of Object.entries(OPTION_LISTS)) {
        const values = (builder as unknown as Record<string, unknown>)[list]
        if (!Array.isArray(values)) continue
        // Every attribute a value becomes: `lt.input({ type: "date" })` gives
        // both `type` and `data-variant`. `type` is HTML's own, and the CSS does
        // not read it, so it is not recorded: `type="color"` is valid HTML on an lt-input.
        const emitted = new Map<string, string[]>()
        const silent: string[] = []
        for (const value of values as string[]) {
          const result =
            new Map(
              parts(
                build({ id: "x", titleId: "x", keys: [], [option]: value }),
              ),
            ).get(part) ?? {}
          const extra = Object.entries(result).filter(
            ([key, v]) =>
              typeof v === "string" &&
              key !== "class" &&
              key !== "type" &&
              basePart[key] !== v &&
              v === value,
          )
          if (!extra.length) {
            silent.push(value)
            continue
          }
          for (const [attribute] of extra) {
            emitted.set(attribute, [...(emitted.get(attribute) ?? []), value])
          }
        }
        for (const [attribute, list] of emitted)
          for (const target of targets)
            found[target].attributes[attribute] = {
              values: list,
              // The default is the one value that gives no attribute, such as
              // `primary` for `data-variant`. When several give nothing, as most
              // types on an input do, the absence does not mean one of them.
              ...(silent.length === 1 && emitted.size === 1
                ? { default: silent[0] }
                : {}),
            }
      }
    }
  }

  /*
   * The flags, such as `data-interactive` on `lt-card` and `data-optional` on
   * `lt-label`: a `data-*` attribute that appears when a boolean option is
   * turned on. Without this they were missing in the editor and in the
   * rulebooks, while `lotek check` knew them.
   *
   * They are read from the builder function itself, with the options
   * TypeScript sees in `src/lt.ts`, not from `manifest.json` on disk. Read
   * from there they were one round behind: `generate` writes this file before
   * the manifest, so a new flag reached the manifest on the first build but
   * arrived here only on the next, and `check:vocabulary` failed the build in
   * between.
   */
  const flags = new Map<string, Set<string>>()
  for (const builder of readBuilderFunctions()) {
    const build = (lt as Record<string, unknown>)[builder.name]
    if (typeof build !== "function") continue
    // If the builder function throws, generate must stop. A flag that quietly
    // vanished from classes.ts vanished from the editors and the diagnostics too.
    const flagged = flagsFor(
      builder,
      build as (options: Record<string, unknown>) => unknown,
      { id: "x", titleId: "x", keys: [], label: "x" },
      (name) => name in found,
    )
    for (const [name, attributes] of flagged)
      for (const attribute of attributes)
        flags.set(name, (flags.get(name) ?? new Set()).add(attribute))
  }
  for (const [name, attributes] of flags)
    for (const attribute of [...attributes].sort())
      found[name].attributes[attribute] ??= { values: [], flag: true }

  /*
   * The content and the parts, from the table in `metadata.ts`. Every class
   * in the CSS must be there, and no others: a new class without a row stops
   * the generator with its name, and a row for a class that is gone from the
   * CSS stops it too, or it would stay and promise something that does not
   * exist.
   */
  const missing = Object.keys(found).filter((name) => !(name in classDocs))
  const stale = Object.keys(classDocs).filter((name) => !(name in found))
  if (missing.length || stale.length)
    throw new Error(
      [
        missing.length &&
          `classDocs in metadata.ts is missing ${missing.join(", ")}.`,
        stale.length &&
          `classDocs in metadata.ts has classes that do not exist in the CSS: ${stale.join(", ")}.`,
      ]
        .filter(Boolean)
        .join(" "),
    )
  const out: Classes = {}
  for (const [name, info] of Object.entries(found)) {
    const { content, partOf, parts, name: named } = classDocs[name]
    out[name] = {
      component: info.component,
      title: info.title,
      description: info.description,
      link: info.link,
      content,
      ...(partOf ? { partOf } : {}),
      ...(parts ? { parts } : {}),
      ...(named ? { name: named } : {}),
      ...(info.texts ? { texts: info.texts } : {}),
      attributes: info.attributes,
    }
  }
  return out
}

export function files(): Record<string, string> {
  const version: string = JSON.parse(
    readFileSync(join(ROOT, "interfaces/package.json"), "utf8"),
  ).version
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`
  /*
   * The vocabulary is written into the package as TypeScript modules, not as
   * JSON: Node requires `with { type: "json" }` to import JSON in ESM, and
   * `tsc` does not write the attribute. Biome skips the files, since
   * `JSON.stringify` does not add trailing commas.
   */
  const module = (name: string, type: string, value: unknown) =>
    `// Generated by interfaces/scripts/generate-vocabulary.ts. Do not edit.\n` +
    `import type { ${type} } from "./types.js"\n\n` +
    `export const ${name}: ${type} = ${JSON.stringify(value, null, 2)}\n`
  return {
    "interfaces/html-data.json": json(htmlData()),
    "interfaces/snippets.json": json(snippets()),
    "interfaces/src/vocabulary/elements.ts": module(
      "elements",
      "Elements",
      diagnosticsData(),
    ),
    "interfaces/src/vocabulary/classes.ts": module(
      "classes",
      "Classes",
      classesData(),
    ),
    "interfaces/web-types.json": json(webTypes(version)),
    "interfaces/live-templates.xml": liveTemplates(),
    "interfaces/live-templates-kotlin.xml": kotlinLiveTemplates(),
    "interfaces/src/components/events.ts": eventTypes(),
  }
}

/**
 * The types of the events the web components dispatch, for `addEventListener`.
 *
 * `LtEventMap` has each event as a `CustomEvent` with `detail` as the
 * metadata describes it, and `HTMLElementEventMap` is extended with it. That
 * is TypeScript's own DOM type, so the same applies in plain TypeScript, in a
 * script in Astro or Datastar, and in React through a `ref`. Nothing here
 * imports React.
 *
 * When two elements dispatch an event with the same name, `detail` must be
 * the same, or only one of them could get a type. The generator then stops.
 *
 * The file also extends `HTMLElementTagNameMap`, so `querySelector("lt-dialog")`
 * gives `LtDialog` and not `Element`. The map used to be in each `lt-*.ts`,
 * but an entry like `/register` imports them only in the code, and in the
 * `.d.ts` file the import disappears. Then `querySelector("lt-dialog")` was
 * an `Element`, and `addEventListener` on it gave `Event` without `detail`,
 * while the page promised the opposite. Every entry to the web components
 * brings this file along, through `host-element.ts` or a re-export of its
 * own, so the map comes with all of them.
 */
function eventTypes(): string {
  const seen = new Map<string, { type: string; tag: string }>()
  const lines: string[] = []
  const hosts = hostClasses()
  for (const element of elements) {
    for (const [name, doc] of Object.entries(element.events)) {
      const fields = Object.entries(doc.detail ?? {})
      const type =
        fields.length === 0
          ? "CustomEvent<null>"
          : `CustomEvent<{ ${fields.map(([field, kind]) => `${field}: ${kind}`).join("; ")} }>`
      const earlier = seen.get(name)
      if (earlier && earlier.type !== type)
        throw new Error(
          `${name} has a different detail on <${earlier.tag}> and <${element.tag}>: ${earlier.type} and ${type}`,
        )
      if (earlier) continue
      seen.set(name, { type, tag: element.tag })
      lines.push(
        `  /** \`<${element.tag}>\`: ${doc.description.replaceAll("*/", "* /")} */`,
        `  "${name}": ${type}`,
      )
    }
  }
  const imports = elements
    .map((element) => {
      const host = hosts.get(element.tag)
      if (!host)
        throw new Error(
          `Found no class for <${element.tag}> under src/components`,
        )
      return host
    })
    .sort((a, b) => a.module.localeCompare(b.module))
  const tags = elements
    .map((element) => `    "${element.tag}": ${hosts.get(element.tag)?.name}`)
    .sort()
  return `// Generated by interfaces/scripts/generate-vocabulary.ts from metadata.ts. Do not edit.

${imports.map((host) => `import type { ${host.name} } from "./${host.module}.js"`).join("\n")}

/**
 * The events the web components dispatch, with \`detail\` as the component
 * sends it. All of them bubble, and come out of a shadow root.
 * \`HTMLElementEventMap\` and \`DocumentEventMap\` are extended with them, so
 * \`addEventListener("dialog-toggle", …)\` gives \`event.detail.open\` as
 * \`boolean\` on any element and on \`document\`.
 *
 * \`HTMLElementTagNameMap\` is extended with the elements, so
 * \`querySelector("lt-dialog")\` gives \`LtDialog | null\`. The map is here,
 * and not in each component, because every entry to the web components
 * brings this file along: from \`/register\` alone,
 * \`querySelector("lt-dialog")\` was otherwise an \`Element\`, and the listener
 * on it got \`Event\` without \`detail\`.
 */
export interface LtEventMap {
${lines.join("\n")}
}

declare global {
  interface HTMLElementEventMap extends LtEventMap {}
  interface DocumentEventMap extends LtEventMap {}
  interface HTMLElementTagNameMap {
${tags.join("\n")}
  }
}
`
}

/**
 * The class behind each element, read from the source.
 *
 * The file has the same name as the tag, such as `frame/dialog/lt-dialog.ts`
 * for `<lt-dialog>`, and the class is `export class LtDialog`. The name is
 * read from there, not from a list here, so an element that changes folder or
 * name stops the generator instead of producing a map that points wrong.
 */
function hostClasses(): Map<string, { name: string; module: string }> {
  const components = join(ROOT, "interfaces/src/components")
  const hosts = new Map<string, { name: string; module: string }>()
  for (const element of elements) {
    const file = [...new Bun.Glob(`**/${element.tag}.ts`).scanSync(components)]
    if (file.length !== 1)
      throw new Error(
        `Expected one file ${element.tag}.ts under src/components, found ${file.length}`,
      )
    const module = (file[0] as string).replace(/\.ts$/, "")
    const source = readFileSync(join(components, file[0] as string), "utf8")
    const name = /^export class (Lt\w+) extends /m.exec(source)?.[1]
    if (!name)
      throw new Error(`Found no "export class Lt… extends" in ${file[0]}`)
    hosts.set(element.tag, { name, module })
  }
  return hosts
}

if (import.meta.main) {
  for (const [path, content] of Object.entries(files())) {
    writeFileSync(join(ROOT, path), content)
    console.log(`Wrote ${path}`)
  }
}
