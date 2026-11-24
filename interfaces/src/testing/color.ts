import { colorTokens, darkColorTokens } from "../tokens/tokens.js"

/**
 * Token values as `rgb(r, g, b)`, the way `getComputedStyle` answers.
 *
 * A test that copies a token's hex value must be corrected every time the
 * contract moves a lightness, and then says nothing about whether the
 * component uses the right token. It reads the colour from here instead.
 */
const LIGHT = colorTokens
const DARK = { ...colorTokens, ...darkColorTokens }

/** The system colours point to a cell in the matrix, so the chain must be followed. */
function resolve(table: Record<string, string>, token: string): string {
  let value = table[token]
  let guard = 0
  while (value?.startsWith("var(") && guard++ < 10)
    value = table[value.slice(4, -1)]
  return value
}

export function color(
  token: string,
  appearance: "light" | "dark" = "light",
): string {
  const hex = resolve(appearance === "dark" ? DARK : LIGHT, token)
  if (!hex?.startsWith("#")) {
    throw new Error(`Unknown token, or not a hex colour: ${token}`)
  }
  const { r, g, b } = parseHex(hex)
  return `rgb(${r}, ${g}, ${b})`
}

/**
 * Reads `rgb(r, g, b)` or `rgba(r, g, b, a)` from `getComputedStyle`, so a
 * test can compute the contrast between the two colours it reads.
 */
export function rgb(value: string): {
  r: number
  g: number
  b: number
  a: number
} {
  const [r = 0, g = 0, b = 0, a = 1] = value.match(/[\d.]+/g)?.map(Number) ?? []
  return { r, g, b, a }
}

export type Rgb = { r: number; g: number; b: number }

/** Reads `#rrggbb` or `#rgb`. */
export function parseHex(hex: string): Rgb {
  const clean = hex.trim().replace(/^#/, "")
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((char) => char + char)
          .join("")
      : clean

  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`"${hex}" is not a valid hexadecimal colour`)
  }

  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  }
}

function toLinear(channel: number): number {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance({ r, g, b }: Rgb): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
}

/** The contrast ratio between two colours, as WCAG 2.1 computes it. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
