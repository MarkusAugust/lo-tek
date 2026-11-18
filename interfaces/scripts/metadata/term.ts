import type { LtTerm } from "../../src/components/frame/term/lt-term.js"
import {
  LT_TERM_PARTS,
  LT_TERM_TAG,
} from "../../src/components/frame/term/lt-term.js"
import { type ComponentDoc, element, parts } from "./shared.js"

export const term: ComponentDoc = {
  element: element<typeof LtTerm>(
    LT_TERM_TAG,
    "term",
    "A word in the text that shows its glossary entry in a card by the word. A link to the entry's id is enough; the component sets the class, `aria-details` and `aria-expanded` on the link, and shows the entry itself in the top layer while the card is open. Without JavaScript the word is a link to the glossary.",
    {},
  ),
  parts: parts(LT_TERM_PARTS, {
    word: {
      description:
        'The word: a link to the glossary entry, such as `<a href="#term-signal">`. The entry is a `<div>` with that id in a `<dl>`, with a `<dt>` and a `<dd>`, anywhere on the page.',
      content: "text",
      unique: true,
    },
  }),
  classes: {
    "lt-term": { content: "text", tags: [{ tag: "a", requires: ["href"] }] },
    "lt-term__entry": {
      content: "parts",
      tags: [{ tag: "div" }],
      parts: {
        term: {
          selector: "dt",
          description: "The term, as it stands in the glossary.",
          content: "text",
          unique: true,
        },
        description: {
          selector: "dd",
          description: "The explanation. It can hold links and code.",
          content: "free",
        },
      },
    },
  },
  anatomies: {
    term: {
      holes: {
        entry: {
          description: "The id the word in the text points at.",
          kind: "id",
          per: ["entry"],
        },
        word: {
          description: "The word.",
          content: "text",
          per: ["entry"],
          example: "Act of God",
        },
        meaning: {
          description: "What the word means.",
          content: "text",
          per: ["entry"],
          example: "A cause the policy does not cover.",
        },
      },
      options: { id: { tool: "Each entry calls lt.term() with its own id." } },
      repeats: {
        entry: { min: 1, description: "The words the glossary explains." },
      },
      nodes: [
        {
          // The glossary. A word in running text that points at an entry
          // needs a text hole that takes elements, which is beyond this.
          tag: "dl",
          children: [
            {
              tag: "div",
              from: ["term.entry"],
              options: { term: { id: { hole: "entry" } } },
              repeat: "entry",
              children: [
                { tag: "dt", children: [{ hole: "word" }] },
                { tag: "dd", children: [{ hole: "meaning" }] },
              ],
            },
          ],
        },
      ],
    },
  },
  builderParts: {
    term: {
      word: { element: LT_TERM_TAG, part: "word" },
      // The entry is in the glossary, outside the element.
      entry: null,
    },
  },
}
