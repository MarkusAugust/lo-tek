/**
 * The values the scripts call the builder functions with, in one place.
 */

import type { OptionType } from "./builder-functions.js"

/**
 * Options every builder function accepts: the ones some of them require.
 * `lt.tabs()` throws without `keys`, `lt.sessionTimeout()` without
 * `titleId`, and one that would otherwise make a random id warns without
 * `id`. `page-setup.ts` and `check-server-import.ts` call every builder
 * function with them, and `generate-vocabulary.ts` does to read its classes.
 *
 * So a change here can change `classes.ts`, the editor files and the
 * manifest: the classes, the flags and the input types are what the
 * functions answer to exactly these. `check:vocabulary` and `check:manifest`
 * show it as files out of date.
 */
export const SAMPLE = {
  id: "x",
  titleId: "t",
  count: 1,
  keys: ["a"],
  label: "L",
}

/**
 * The values each kind of option is tried with in `build-cases.json`. The
 * text values include whitespace that JavaScript counts as whitespace and
 * Java by default does not, a no-break space and a BOM: without them, a port
 * that splits on ASCII whitespace alone would have passed.
 */
export const TRIAL_VALUES: Record<OptionType["kind"], unknown[]> = {
  values: [],
  flag: [false, true],
  text: ["x", "a b", ""],
  number: [0, 1, 3],
  // `["x", "y"]` is the only valid one with several: without it, the tabs and
  // the options were never tried with more than one key.
  textList: [
    [],
    ["x"],
    ["x", "y"],
    ["x", "x"],
    ["  x   y "],
    ["x y"],
    ["﻿x"],
    [""],
  ],
}
