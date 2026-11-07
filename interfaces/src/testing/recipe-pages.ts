/**
 * The recipes for the browser tests. The file is read as text and parsed,
 * the way the tests read the pages before, so the type check of the tests
 * needs no JSON modules.
 */
import text from "../../../documentation/generated/recipes.json?raw"
import { findPage, type RecipePage } from "./recipes"

export const RECIPE_PAGES: RecipePage[] = JSON.parse(text).pages

/** A page by the name of its component, `dialog`, or by its whole path. */
export const recipePage = (name: string) => findPage(RECIPE_PAGES, name)
