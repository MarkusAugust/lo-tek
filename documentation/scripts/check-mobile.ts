/**
 * Checks that no page scrolls sideways on a mobile screen.
 *
 * The site was built for large screens first: the heading broke mid-word,
 * the menu at the top stuck out, and the cards on the front page were wider
 * than the phone. It is easy to reintroduce, since nothing tells you in an
 * ordinary development window.
 *
 * The first check is the one the user notices: can the page actually be
 * dragged sideways? `scrollWidth` alone is misleading, because a code block
 * clipped by `overflow: hidden` counts there without anything being
 * scrollable.
 *
 * The second is content that sticks out of the screen without making the
 * page draggable, because something further out clips it. It does not show
 * as a scrollbar, but the text is gone. The "Remove <file name>" button in
 * the file upload was exactly this. The previews live in shadow roots, so
 * the check has to go into them to see it.
 *
 * Run with: bun run test:docs (build first)
 */

import { everyPage, readCount } from "./site"

/** iPhone SE, the narrowest screen worth taking into account. */
const WIDTH = 375

/*
 * The pages are split across several tabs, because the check waits rather
 * than computes.
 *
 * With one tab the 59 pages took 32 seconds, and only 5 seconds of that was
 * CPU time: 19 per cent of one core. The rest was waiting for
 * `networkidle`. That is why it scales past the core count, and why the
 * number is eight and not four: 32 s with one tab, 8.7 with four, 5.0 with
 * eight, 4.3 with twelve. After eight there is little left to gain.
 */
const code = await everyPage({
  parallel: readCount("PAGES_IN_PARALLEL", 8),
  viewport: { width: WIDTH, height: 800 },
  async check(page) {
    const result = await page.evaluate((width) => {
      /*
       * `behavior: "instant"`, or we always read 0.
       *
       * Starlight sets `scroll-behavior: smooth` on `<html>`, so a plain
       * `scrollTo` is animated and `window.scrollX` on the next line is
       * still 0. This check was therefore dead on every single page, and it
       * is the only one of the two that covers `body` itself and
       * pseudo-elements, since `collect(document.body)` only collects
       * descendants. A page with a wide `body::after` could be dragged 375
       * pixels sideways and reported green.
       */
      window.scrollTo({ left: width, behavior: "instant" })
      const scrolled = window.scrollX
      window.scrollTo({ left: 0, behavior: "instant" })

      // Every element, including those inside a shadow root.
      const all: HTMLElement[] = []
      const collect = (root: ParentNode) => {
        for (const element of root.querySelectorAll<HTMLElement>("*")) {
          all.push(element)
          if (element.shadowRoot) collect(element.shadowRoot)
        }
      }
      collect(document.body)

      // What sticks out and is not inside something that can scroll on its
      // own. A code block and a wide table have their own scrollbar, and are
      // therefore fine. `hidden` and `clip` do not count: they clip without
      // giving any way to the content, and are exactly the bug we are
      // looking for.
      const outside: string[] = []
      for (const element of all) {
        const box = element.getBoundingClientRect()
        if (box.width === 0 || box.right <= width + 1) continue

        let parent = element.parentElement
        let ownScroll = false
        while (parent) {
          const overflow = getComputedStyle(parent).overflowX
          if (overflow === "auto" || overflow === "scroll") {
            ownScroll = true
            break
          }
          parent = parent.parentElement
        }
        if (ownScroll) continue

        const className = (element.className || "").toString().split(" ")[0]
        const text = (element.textContent ?? "").trim().slice(0, 30)
        outside.push(
          `${element.tagName.toLowerCase()}${className ? `.${className}` : ""} is ${Math.round(box.width)} pixels wide${text ? ` ("${text}")` : ""}`,
        )
      }

      return {
        scrolled,
        culprit: [...new Set(outside)].slice(0, 3).join("; "),
      }
    }, WIDTH)

    if (result.scrolled === 0 && result.culprit === "") return []
    return [
      `${result.scrolled > 0 ? `the page can be dragged ${result.scrolled} pixels sideways. ` : ""}${result.culprit || "could not find which element"}`,
    ]
  },
})
if (code === 0) console.log(`Everything stays within ${WIDTH} pixels.`)
else if (code === 1)
  console.error(`\nContent stands outside the screen at ${WIDTH} pixels.`)
process.exit(code)
