import { readdirSync } from "node:fs"
import mdx from "@astrojs/mdx"
import sitemap from "@astrojs/sitemap"
import startlight from "@astrojs/starlight"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "astro/config"
import remarkGfm from "remark-gfm"
import pkg from "../interfaces/package.json" with { type: "json" }
import { markdownPages } from "./src/plugins/markdown-pages.mjs"
import { rehypeTableScroll } from "./src/plugins/rehype-table-scroll.mjs"
import { remarkVersion } from "./src/plugins/remark-version.mjs"
import { metaAttributes, SHARE_IMAGE } from "./src/share-image.mjs"

/*
 * The sitemap only includes the HTML pages by itself. `llms.txt` and the
 * rulebooks are exactly what an agent looks for, so they are listed here. The
 * rulebooks are read from the folder, so a new one is included without anyone
 * remembering it.
 */
const BASE = pkg.homepage.replace(/\/$/, "")
const AGENT_FILES = [
  `${BASE}/llms.txt`,
  ...readdirSync(new URL("../interfaces/agent/", import.meta.url))
    .filter((file) => file.endsWith(".md"))
    .map((file) => `${BASE}/agent/${file}`),
]

// https://astro.build/config
export default defineConfig({
  /*
   * Astro 7 removes whitespace across line breaks by default, as JSX does,
   * and two inline elements on lines of their own touched. `true` is the
   * lossless compression Astro 6 had.
   */
  compressHTML: true,
  /*
   * The address is in `homepage` in the package, which `llms.txt` and
   * `robots.txt` also read. With `site` set, Starlight makes the sitemap
   * itself, and that is how search engines and agents find the pages.
   */
  site: pkg.homepage,
  /*
   * `markdown.remarkPlugins` is marked as deprecated in favour of
   * `markdown.processor`. That route does not work here: the pages are
   * `.mdx`, and the MDX pipeline reads `remarkPlugins` from here, while
   * `processor` only applies to `.md`. Tested by switching: every table came
   * out as raw text with pipes. It stays until MDX reads the processor.
   */
  markdown: {
    remarkPlugins: [remarkGfm, remarkVersion],
    rehypePlugins: [rehypeTableScroll],
  },
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [
    // Comes before Starlight, which then does not add its own.
    sitemap({ customPages: AGENT_FILES }),
    startlight({
      title: "LO-TEK",
      // The pointer to llms.txt on every page, for an agent that reads the page head.
      head: [
        {
          tag: "link",
          attrs: {
            rel: "alternate",
            type: "text/plain",
            href: "/llms.txt",
            title: "llms.txt",
          },
        },
        /*
         * The image a link gets when it is shared. Starlight writes the title,
         * description and `twitter:card` itself, but no image, and without one
         * X shows the link with no preview.
         */
        ...SHARE_IMAGE.map((tag) => ({
          tag: "meta",
          attrs: metaAttributes(tag),
        })),
      ],
      // The pointer to each page's Markdown version, which `markdownPages` writes.
      routeMiddleware: "./src/route-data.ts",
      defaultLocale: "root",
      locales: {
        root: { label: "English", lang: "en" },
      },
      components: {
        Head: "./src/components/Head.astro",
        SiteTitle: "./src/components/SiteTitle.astro",
        MarkdownContent: "./src/components/MarkdownContent.astro",
      },
      // The Expressive Code options are in `ec.config.mjs`. `<Code>` requires
      // them to be serialisable as JSON when they are here, and a plugin is not.
      /*
       * Three stylesheets, and that is not trimming for its own sake: the 42
       * component stylesheets that were here were loaded on every one of the 62
       * pages, and none of them was used by the plain DOM anywhere.
       *
       * The reason is `Preview.astro`. Every live example sits in a shadow
       * root, and the preview itself adds exactly the stylesheets the `styles`
       * list names, with `?inline`. A stylesheet in `customCss` therefore never
       * reached the examples it was meant for: they have their own copies.
       * Outside the previews only `.lt-preview` itself is in the plain DOM, and
       * that is the documentation's own class from `global.css`.
       *
       * `tokens.css` has to be global. The variables are set on `:root` and
       * inherited through the shadow boundary, so it is what gives the previews
       * their colours and spacing.
       *
       * `button.css` stays, and the reason is Vite rather than taste. Take it
       * out of here, and Vite stops writing the stylesheet at all:
       * `src/pages/demo/page-skeleton.astro` imports it itself, but with so few
       * importers it ended up in no chunk, and the demo page came out with
       * unstyled buttons. `scripts/check-stylesheets.ts` found it, and is the
       * reason that check exists.
       */
      customCss: [
        "./src/styles/global.css",
        "@lo-tek/interfaces/tokens.css",
        "@lo-tek/interfaces/button.css",
      ],
      sidebar: [
        {
          label: "Start here",
          items: [
            { label: "Introduction", slug: "introduction" },
            { label: "Getting started", slug: "getting-started" },
            { label: "Frameworks", slug: "frameworks" },
            { label: "Markup and behaviour", slug: "markup-and-behaviour" },
            { label: "Design tokens", slug: "design-tokens" },
            { label: "Customising", slug: "customising" },
            { label: "Tailwind", slug: "tailwind" },
            { label: "Accessibility", slug: "accessibility" },
            { label: "Translation", slug: "translation" },
            { label: "Your own theme", slug: "your-own-theme" },
            { label: "Type-safe use", slug: "type-safe-use" },
            { label: "Kotlin and Java", slug: "kotlin" },
            { label: "The editor", slug: "the-editor" },
            { label: "The command line", slug: "command-line" },
            { label: "Coding agents", slug: "coding-agents" },
            { label: "Licence and price", slug: "licence" },
            { label: "Roadmap", slug: "roadmap" },
            { label: "Changelog", link: "/changelog/" },
          ],
        },
        {
          label: "Patterns",
          items: [
            { label: "Form with validation", slug: "patterns/form" },
            { label: "List with filters", slug: "patterns/list" },
            { label: "Page skeleton", slug: "patterns/page-skeleton" },
            { label: "Confirming an action", slug: "patterns/confirmation" },
            { label: "A date in a form", slug: "patterns/date" },
            {
              label: "Letting the user choose a theme",
              slug: "patterns/theme",
            },
          ],
        },
        {
          label: "Components",
          items: [
            { label: "All components", slug: "components" },
            {
              label: "CSS components",
              items: [
                { label: "Accordion", slug: "components/accordion" },
                { label: "Alert", slug: "components/alert" },
                { label: "Avatar", slug: "components/avatar" },
                { label: "Badge", slug: "components/badge" },
                { label: "Breadcrumbs", slug: "components/breadcrumbs" },
                { label: "Button", slug: "components/button" },
                { label: "Card", slug: "components/card" },
                { label: "Checkbox", slug: "components/checkbox" },
                { label: "Divider", slug: "components/divider" },
                { label: "Error Text", slug: "components/error-text" },
                { label: "Fieldset", slug: "components/fieldset" },
                { label: "File Upload", slug: "components/file-upload" },
                { label: "Heading", slug: "components/heading" },
                { label: "Help Text", slug: "components/help-text" },
                { label: "Icon", slug: "components/icon" },
                { label: "Input", slug: "components/input" },
                { label: "Label", slug: "components/label" },
                { label: "Link", slug: "components/link" },
                { label: "List", slug: "components/list" },
                { label: "Pagination", slug: "components/pagination" },
                { label: "Paragraph", slug: "components/paragraph" },
                { label: "Progress", slug: "components/progress" },
                { label: "Radio", slug: "components/radio" },
                { label: "Search", slug: "components/search" },
                { label: "Select", slug: "components/select" },
                { label: "Skeleton", slug: "components/skeleton" },
                { label: "Skip Link", slug: "components/skip-link" },
                { label: "Spinner", slug: "components/spinner" },
                { label: "Sr Only", slug: "components/sr-only" },
                { label: "Switch", slug: "components/switch" },
                { label: "Table", slug: "components/table" },
                { label: "Tag", slug: "components/tag" },
                { label: "Textarea", slug: "components/textarea" },
                { label: "Toggle Group", slug: "components/toggle-group" },
                { label: "Tooltip", slug: "components/tooltip" },
              ],
            },
            {
              label: "Frame",
              items: [
                { label: "Dialog", slug: "components/dialog" },
                { label: "Error Summary", slug: "components/error-summary" },
                { label: "Field", slug: "components/field" },
                { label: "Popover", slug: "components/popover" },
                {
                  label: "Session Timeout",
                  slug: "components/session-timeout",
                },
                { label: "Suggestion", slug: "components/suggestion" },
                { label: "Tabs", slug: "components/tabs" },
                { label: "Term", slug: "components/term" },
              ],
            },
            {
              label: "Standalone",
              items: [
                {
                  label: "Connection Status",
                  slug: "components/connection-status",
                },
                { label: "Toast", slug: "components/toast" },
              ],
            },
          ],
        },
      ],
    }),
    // Starlight adds `mdx({ optimize: true })` when there is none. With
    // satteri the optimisation writes a <style> in the page as a literal
    // `set:html` attribute, and Expressive Code's styles were lost.
    mdx(),
    // After Starlight, so the pages it reads are finished.
    markdownPages(),
  ],
})
