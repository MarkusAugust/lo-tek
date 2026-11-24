/**
 * The keys of a theme recipe, described once.
 *
 * A key is described to two readers who want different halves of it. An
 * editor wants one text, what the key is for and what holds when it is left
 * out, and the value to write when the key is completed. A form over the
 * recipe has the value in its field already, and wants only what the key is
 * for. So the parts are kept apart here, as `purpose`, `written` and
 * `leftOut`, and neither reader cuts a sentence out of the other's text:
 * `theme.schema.json` is written from this file by
 * `scripts/generate-theme-schema.ts`, and the theme builder of the
 * documentation reads this file itself.
 *
 * Which keys exist is the core's to say, and its tests hold the schema to
 * them. What a key is when it is left out is LO-TEK's own value, in
 * `tokens.css` and in the fallbacks of the component CSS, and a test holds
 * every `default` here to it.
 */

/** What a key takes: the types and patterns of the schema. */
export type Takes = "colour" | "text" | "textOrNumber" | "lengthOrZero"

/** A key that takes one value. */
export type Leaf = {
  /** What the key is for, and for a key of typography or shape how it is written. */
  purpose: string
  /**
   * How the value is written, where that is the same for many keys and too
   * long to say at each field of a form: the nine colours.
   */
  written?: string
  /** What holds when the key is left out, in a sentence that says so. */
  leftOut: string
  /** The value LO-TEK has when the key is left out, where it has one value. */
  default?: string | number
  takes: Takes
}

/** A key that holds other keys. */
export type Block = {
  description: string
  keys: Record<string, Leaf | Block>
}

const colour = (purpose: string): Leaf => ({
  purpose,
  written:
    "A hexadecimal colour, as #rgb or #rrggbb. The hue and chroma are yours, the lightness is the role's.",
  leftOut: "Left out, the family keeps LO-TEK's own colour.",
  takes: "colour",
})

/** A key whose value LO-TEK has when it is left out. */
const withDefault = (
  purpose: string,
  value: string | number,
  takes: Takes,
): Leaf => ({
  purpose,
  leftOut: `Left out, it is ${value}.`,
  default: value,
  takes,
})

export const THEME_KEYS: Record<string, Leaf | Block> = {
  accent: colour("Links, buttons and focus indication."),
  visited: colour("Visited links."),
  brand1: colour(
    "Surfaces, sections and categories. It means nothing in itself.",
  ),
  brand2: colour(
    "Surfaces, sections and categories. It means nothing in itself.",
  ),
  brand3: colour(
    "Surfaces, sections and categories. It means nothing in itself.",
  ),
  neutral: colour("The page, body text and borders. Almost without hue."),
  danger: colour("Errors, deletion and rejection."),
  warning: colour("Something that needs attention."),
  success: colour("Completed and approved."),
  typography: {
    description:
      "The font, the weights and the line heights. Left out, LO-TEK's own typography stays.",
    keys: {
      fontFamily: {
        purpose:
          "The font stack the whole theme uses, written as in CSS. It is set as a token and as a rule on :root.",
        leftOut:
          "Left out, LO-TEK has no font of its own and inherits the one of the page it is on.",
        takes: "text",
      },
      weights: {
        description: "The four font weights, as numbers or keywords.",
        keys: {
          regular: withDefault(
            "The words that mark a field as required or optional, on a label and a fieldset.",
            400,
            "textOrNumber",
          ),
          medium: withDefault("Buttons and error text.", 500, "textOrNumber"),
          semibold: withDefault(
            "Labels, titles of cards and dialogs, table headers and tabs.",
            600,
            "textOrNumber",
          ),
          bold: withDefault(
            "Headings, and the asterisk that marks a required field.",
            700,
            "textOrNumber",
          ),
        },
      },
      lineHeights: {
        description:
          "The four line heights, as numbers without a unit or as CSS values.",
        keys: {
          default: withDefault(
            "Controls: button, input, table.",
            1.5,
            "textOrNumber",
          ),
          heading: withDefault("Headings.", 1.2, "textOrNumber"),
          article: withDefault("Body text and lists.", 1.6, "textOrNumber"),
          compact: withDefault(
            "Small surfaces: help text, tooltip, card title.",
            1.4,
            "textOrNumber",
          ),
        },
      },
    },
  },
  shape: {
    description: "Corners and borders. Left out, LO-TEK's own shape stays.",
    keys: {
      buttonRadius: withDefault(
        "The corners of the button, the pagination and the skip link, as a CSS length, or the number 0.",
        "0.25rem",
        "lengthOrZero",
      ),
      fieldRadius: withDefault(
        "The corners of the input, the textarea and the select, as a CSS length, or the number 0.",
        "0.25rem",
        "lengthOrZero",
      ),
      surfaceRadius: {
        purpose:
          "The corners of the card, dialog, popover, alert, accordion, error summary, file upload, session timeout, suggestion list, toast, tooltip and the panel of a term, as a CSS length, or the number 0.",
        leftOut:
          "Left out, each surface keeps its own corner: 0.25rem, and 0.5rem on the card and the dialog.",
        takes: "lengthOrZero",
      },
      buttonBorderWidth: withDefault(
        "The border width of the button, as a CSS length, or the number 0.",
        "1px",
        "lengthOrZero",
      ),
      buttonFontWeight: {
        purpose: "The weight of the button text, as a number or a keyword.",
        leftOut: "Left out, it follows weights.medium.",
        takes: "textOrNumber",
      },
    },
  },
}

/** Whether a key holds other keys. */
export const isBlock = (key: Leaf | Block): key is Block => "keys" in key

/** A leaf with the path to it, as the segments of the path. */
export type LeafAt = Leaf & { path: string[] }

/** Every key that takes a value, in the order of the keys. */
export function leaves(
  keys: Record<string, Leaf | Block> = THEME_KEYS,
  at: string[] = [],
): LeafAt[] {
  return Object.entries(keys).flatMap(([name, key]) =>
    isBlock(key)
      ? leaves(key.keys, [...at, name])
      : [{ ...key, path: [...at, name] }],
  )
}
