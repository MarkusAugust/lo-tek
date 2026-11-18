import type { LtTabs } from "../../src/components/frame/tabs/lt-tabs.js"
import {
  LT_TABS_PARTS,
  LT_TABS_TAG,
} from "../../src/components/frame/tabs/lt-tabs.js"
import { type ComponentDoc, element, flag, parts } from "./shared.js"

export const tabs: ComponentDoc = {
  element: element<typeof LtTabs>(
    LT_TABS_TAG,
    "tabs",
    'Tab list. The tabs are links to the panels in an `.lt-tabs__list`, so without JavaScript the list is a table of contents; `role="tab"` on anything other than a link is not a tab. The component adds keyboard and focus handling, sets roles and wiring, gives each panel its tab\'s name, makes only the selected panel a tab stop, and hides the rest with `hidden="until-found"`, so find in page and links into a panel reach them. Each selection is written to the URL. It never writes an id on a tab or a panel. When the page loads, the selected tab is the one with `aria-selected` from the server, otherwise the one the URL points to, otherwise the first one not hidden with `hidden`. Under `server-controlled` the URL never selects.',
    {
      "server-controlled": flag(
        "The server decides which tab is selected. The component does not put the user's selection back after an update from the server, and the URL selects no tab. A click and find in page select the tab until the server responds.",
      ),
      activation: {
        description:
          "What the arrow keys do. By default they select the tab at once.",
        value: {
          values: [
            {
              name: "manual",
              description:
                "The arrow keys only move focus, and Enter or Space selects. For when a panel's content takes time to load.",
            },
            {
              name: "automatic",
              description:
                "The arrow keys select the tab, the same as without the attribute.",
            },
          ],
        },
      },
    },
    {
      "tab-select": {
        description: "The user selected a tab. `index` counts from 0.",
        detail: { index: "number" },
      },
    },
  ),
  parts: parts(LT_TABS_PARTS, {
    list: {
      description:
        'The tab list, a `<ul>` where each `<li>` gets `role="presentation"`. It needs a name, such as `aria-label`. When the server has written `role="tab"` on the links, the list can also hold other links.',
      content: "free",
      unique: true,
      name: {},
    },
    tab: {
      description:
        'A tab: a link to its panel, `<a href="#attachments">`. The component writes `aria-controls` from `href`. `role="tab"` on something that is not a link is not a tab.',
      content: "text",
      multiple: true,
    },
    panel: {
      description:
        "The content of one tab, with the id the link points to. The panel has the same name as the tab: the heading at the top of the panel is the name when it says the same as the tab.",
      content: "free",
      multiple: true,
      // The component names the panel after its tab, a link
      // `without-name` holds.
      name: { component: true },
    },
  }),
  classes: {
    "lt-tabs__list": {
      content: "free",
      tags: [{ tag: "ul" }],
      parts: {
        tab: {
          selector: "a[role='tab'][href^='#'], a[href^='#']:not([role])",
          description:
            'A tab: a link to its panel, such as `<a href="#attachments">`. When the server has written `role="tab"`, only the links with the role are tabs, and the list can hold other links. `role="tab"` on something that is not a link is not a tab.',
          content: "text",
          multiple: true,
        },
      },
    },
    "lt-tabs__panel": {
      content: "free",
      tags: [{ tag: "section" }, { tag: "div" }],
    },
  },
  anatomies: {
    tabs: {
      holes: {
        tabs: { description: "The start of the panels' ids.", kind: "id" },
        label: {
          description: "What the tabs choose between.",
          content: "text",
          example: "Sections",
        },
        title: {
          description: "The tab's name, and its panel's heading.",
          content: "text",
          per: ["tab"],
          example: "Section",
        },
        panel: {
          description: "What the tab shows.",
          content: "free",
          per: ["tab"],
          example: "<p>Text.</p>",
        },
      },
      options: {
        id: { hole: "tabs" },
        keys: { repeat: "tab" },
        label: { hole: "label" },
      },
      // One tab is no choice.
      repeats: { tab: { min: 2, description: "The tabs." } },
      nodes: [
        {
          tag: "lt-tabs",
          children: [
            {
              tag: "ul",
              from: ["tabs.list"],
              children: [
                {
                  tag: "li",
                  repeat: "tab",
                  children: [
                    {
                      tag: "a",
                      from: ["tabs.tabs"],
                      children: [{ hole: "title" }],
                    },
                  ],
                },
              ],
            },
            {
              tag: "section",
              from: ["tabs.panels"],
              repeat: "tab",
              children: [
                {
                  // The level follows the page the tabs are on.
                  tag: ["h2", "h3", "h4", "h5", "h6"],
                  from: ["tabs.headings"],
                  name: "heading",
                  description:
                    "The panel's heading, at the level the page needs.",
                  children: [{ hole: "title" }],
                },
                { hole: "panel" },
              ],
            },
          ],
        },
      ],
    },
  },
  builderParts: {
    tabs: {
      list: { element: LT_TABS_TAG, part: "list" },
      tabs: { element: LT_TABS_TAG, part: "tab" },
      panels: { element: LT_TABS_TAG, part: "panel" },
      headings: null,
    },
  },
}
