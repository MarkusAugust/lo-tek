/**
 * `datastar.js`: Datastar, served by the site itself.
 *
 * The theme builder is written with Datastar. The file is the free bundle
 * in the version LO-TEK tests its components against, the one in
 * `interfaces/src/testing/datastar/`, byte for byte: `check-theme-builder.ts`
 * compares the two. It is not fetched from a network of someone else's, for
 * the reason the typefaces are not: that would tell another origin who is
 * reading, and the page would stop working when that origin did.
 */

import type { APIRoute } from "astro"
import bundle from "../../../interfaces/src/testing/datastar/datastar-v1.0.4.js?raw"

export const GET: APIRoute = () =>
  new Response(bundle, {
    headers: { "Content-Type": "text/javascript; charset=utf-8" },
  })
