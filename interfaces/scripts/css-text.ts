/**
 * Reading the texts in the stylesheets, for `check-texts.ts` and the
 * generator of the vocabulary. One reader, so the check that a text can be
 * replaced and the manifest that says where it is shown read the same
 * value the same way.
 */

/** A CSS string with the escapes unpacked: `\\e5 ` becomes "å". */
export function unescapeCss(value: string): string {
  return value.replace(/\\([0-9a-f]+) ?/gi, (_t, code: string) =>
    String.fromCodePoint(Number.parseInt(code, 16)),
  )
}

/**
 * Splits where `separator` matches outside parentheses, brackets and
 * strings, so `li:has(~ [x="a b"]) > a` keeps the `:has()` whole.
 */
export function splitOutside(text: string, separator: RegExp): string[] {
  const out = [""]
  let depth = 0
  let quote: string | undefined
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = undefined
    } else if (char === '"' || char === "'") quote = char
    else if (char === "(" || char === "[") depth++
    else if (char === ")" || char === "]") depth--
    else if (depth === 0 && separator.test(char)) {
      out.push("")
      continue
    }
    out[out.length - 1] += char
  }
  return out.map((part) => part.trim()).filter((part) => part !== "")
}

/** The strings in a CSS value, with the escapes unpacked. */
export function stringsIn(value: string): string[] {
  return [...value.matchAll(/(["'])((?:(?!\1).)*)\1/g)].map((s) =>
    unescapeCss(s[2]),
  )
}

/** A string with a letter in it is text, also when escaped; "/" and "✓" are not. */
export const isText = (value: string) => /\p{L}/u.test(value)

/**
 * The text a `content` value shows that a variable can replace: one
 * `var(--lt-…, "text")`, alone or as the alternative text after a symbol,
 * `"\2713" / var(--lt-…, "text")`. `undefined` for any other form, among
 * them a symbol with a letter in it, which is text that cannot be replaced.
 */
export function replaceableText(
  value: string,
): { variable: string; text: string } | undefined {
  const symbol = /^(["'])((?:(?!\1).)*)\1\s*\/\s*(var\(.*\))$/.exec(value)
  if (symbol && isText(unescapeCss(symbol[2]))) return undefined
  const match =
    /^var\((--lt-[a-z0-9-]+)\s*,\s*(["'])((?:(?!\2).)*)\2\s*\)$/.exec(
      symbol ? symbol[3] : value,
    )
  return match ? { variable: match[1], text: unescapeCss(match[3]) } : undefined
}

/**
 * A selector as its compounds and the combinators between them, read
 * outside parentheses, brackets and strings: `.lt-steps > li:has(~ [x])`
 * is `[".lt-steps", ">", "li:has(~ [x])"]`, and `[class~="a"]` stays whole.
 * A descendant combinator is `" "`.
 */
export function compoundsOf(selector: string): string[] {
  const out: string[] = []
  let current = ""
  let depth = 0
  let quote: string | undefined
  let combinator: string | undefined
  let escaped = false
  const end = () => {
    if (current === "") return
    if (combinator !== undefined && out.length > 0) out.push(combinator)
    out.push(current)
    current = ""
    combinator = undefined
  }
  for (const char of selector.trim()) {
    // A backslash takes the character after it as it is, in a string and
    // in a name: `[x="a\"b"]`, `.lt-a\>b`.
    if (escaped || char === "\\") {
      escaped = !escaped
      current += char
      continue
    }
    if (quote) {
      if (char === quote) quote = undefined
    } else if (char === '"' || char === "'") quote = char
    else if (char === "(" || char === "[") depth++
    else if (char === ")" || char === "]") depth--
    else if (depth === 0 && /[\s>+~]/.test(char)) {
      // The compound before it is done. A `>` wins over the spaces round it.
      end()
      if (/\s/.test(char)) combinator ??= " "
      else combinator = char
      continue
    }
    current += char
  }
  end()
  return out
}
