# Presentation on design system architecture

The presentation is about the architecture a design system without a framework
needs: where the markup comes from, what the web component adds, and what it
costs. LO-TEK is the example that shows it works, not the subject.

The whole presentation is one document. No dependencies, no build step, no
server. Open the file in a browser, or see it at
[designsystemarkitektur.sobernetics.no](https://designsystemarkitektur.sobernetics.no/),
which builds from master on every push. The Netlify project behind it is called
`designsystemarkitetktur`, typo included, and
`designsystemarkitetktur.netlify.app` serves the same page. `netlify.toml` here
says how: the file is copied to `index.html`, and that is all.

```bash
open presentation/design-system-architecture.html
```

## One file, with git as the history

For a long time the folder had one file per edition, from `v3` to `v8`. Now
there is only `design-system-architecture.html`, and the older editions are in
the folder's git history.

## What it says

Thirty-one slides about what it takes to build a design system that does
not depend on a framework. The point is that this is not trivial: many things
have to hold at the same time. LO-TEK is the proof that it can be done, not
the subject. It is read alone, in a browser, at the reader's own pace, and is
not given as a talk, so a slide may hold more text than a projected one could.

The second slide states the premise, a mixed portfolio and a design system
meant to outlive the apps around it, and what a component has to survive at
once under it. Then comes one slide with the five requirements and the two
recommendations, and each of the seven has a chapter. A chapter with several
slides opens with a title slide that states it in one sentence and gives the
question a reader can try their own design system against; a chapter with one
slide has the icon, the sentence and the question on that slide. The icons
are drawn in the presentation's own colour palette: a glass surface with a
light edge and a highlight on top, with a motif close to the platform and not
a desktop metaphor, for example a browser window, a DOM tree or a package
with a way out. After the chapters come the demo game in its three versions,
the pitfalls that were found there, one slide with what a consumer writes
beside what the design system team has to keep running, and the checklist.

The slide titles are claims, so the argument can be followed from the titles
alone. One thing has one name throughout: whoever renders, the wiring, a
re-render, the consumer, the design system.

The requirement and LO-TEK's solution are kept apart. At the bottom of a slide
there are up to three lines: what it costs the design system team, which comes
first because that is where the difficulty is, what it means for the
consumers, and "In LO-TEK", which says how LO-TEK solved it. Code that is
LO-TEK's own API has a green LO-TEK mark above it, and it is there as proof
that the thing can be done, not as instructions for using LO-TEK. The
requirement should make sense without the example, and the example should be
easy to tell apart from the requirement.

Where a slide says what the platform or another library does, it says where
that was read and when, in a line of sources at the bottom. The other routes,
a React-based design system and web components with shadow DOM, are given
what they can do today before the slide says what still stands in the way.

Behind the slides is a world drawn with WebGL and no library: a floor of
light lines that fades into the dark, and particles in the air. The camera
glides one step forward for every slide and turns where a new part begins,
where a ring of light pulses out from the floor. The card falls back into the
fog and the next comes forward out of it, with the View Transitions API, and
within a part the line above the heading stays where it is. A line along the
top shows the parts and how far the reader has come. On a narrow screen, with
reduced motion, without WebGL 2, or on a machine that draws fewer than about
30 frames a second, there is no world and no movement, and the slides change
as before. A key pressed during a transition ends it at once.

The contents, opened with the button by the counter or with M, lists every
slide with its number and heading, grouped by part, and goes to the one
chosen.

A slide does not scroll. Where its text is taller than the window, the content
is zoomed down until it fits, to no less than 80 %, and on 1280 × 720 every
slide fits at 84 % or more. On a phone the slides are plain text on the page,
which scrolls as a page does.

One slide says what one button costs an app, measured on 19 November 2026 for
five design systems. For each, an app that already has React 19 and
TypeScript gets the documented install for one button. What the browser has to
load is the button built with esbuild and gzipped, with the smallest CSS each
design system's own documentation gives for it: Skatteetaten's design tokens
and the CSS the button imports, Aksel's fonts, tokens and baseline with the
button, loader and typography, Digdir's `index.css` and theme, and LO-TEK's
`tokens.css` and `button.css`. The graph is the packages in `package-lock.json` that the app then
has to keep in step; optional peer dependencies are left out, since npm does
not install them. The app's `package.json` has no `"type": "commonjs"`: with
it, esbuild did not tree-shake `lt`, and the builder functions measured 27.8 kB
instead of 5.5 kB.

The version and the date stand on the last line of the last slide.
`prepare-version` writes them there and `check-version.ts` reads them.

Code panels appear where the code **is** the point, and nowhere else. The two
lines from Datastar that remove an attribute the server did not send are the
whole reason for the contract, and they say more than a paragraph about them.
Where a panel would only show that code exists, it is left out.

No web font. The typeface is `Helvetica, Arial, sans-serif`, the stack another
Norwegian design system specifies for screen. A presentation must not be able
to fail because of the network access in the meeting room. LO-TEK's logo on
the title slide has its name drawn as outlines for the same reason.

The palette is LO-TEK's own tokens, copied with the same values. The colours of
the surface, the text and the borders are chosen for a dark slide and belong to
the presentation only.

## Two slides that show instead of claim

The dependency graph and the morph are the two slides with a script of their
own, and in both the content is computed, not typed in. The graph is drawn
from a dataset read out of `package-lock.json`, with a date. The morph runs
Datastar's own loop on two real elements, and the line with what the screen
reader says is worked out from the element in the page. On a narrow screen the
graph shows its table and the morph its code, since neither says anything at
375 pixels.

## How to move through it

Arrow keys, `PageUp` and `PageDown`, Space or Enter. `Home` and `End` go to the
first and the last. The address gets an anchor, for example `#slide-6`, so a
link points at one particular slide; the older form `#lysbilde-6` still works.
There are also two buttons that appear when the mouse pointer is over the
slide.

## On a small screen

From 860 pixels and down the card disappears completely: no frame, no shadow,
no scaling. The slide becomes plain text straight on the background, at full
font size, and the page scrolls like an ordinary page. The buttons for moving
between slides are fixed at the bottom, since a phone has no arrow keys.

Tested in Chromium at 1440×900, 1280×800, 820 and 375 pixels wide: none of the
thirty-six slides can be dragged sideways, and none of them scrolls inside the
card.

The graph is the tightest slide and cannot take one more line. A separate block
with the date the numbers were checked made it scroll 15 pixels at 1280, so the
date stayed inside the paragraph below the graph instead of above it.
