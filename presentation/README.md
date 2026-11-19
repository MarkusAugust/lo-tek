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

Thirty-six slides about what is required and why, not about how we got there.
An audience does not need to know what we tried first, only what applies and
what it is good for.

They are divided into seven chapters, one per requirement, and an eighth about
the pitfalls that are easy to fall into. Each chapter opens with a title slide
that states the requirement in one sentence. The title slide has an icon drawn
in the presentation's own colour palette: a glass surface with a light edge and
a highlight on top. The motif is close to the platform and not a desktop
metaphor, for example a browser window, a DOM tree or a package with a way
out. A separate slide before the chapters shows all eight, each with its icon.
At the end comes LO-TEK in use, with a form field and the demo game, and a
checklist the audience can apply to their own system.

The requirement and LO-TEK's solution are kept apart. At the bottom of a slide
there are up to three lines: what the requirement means for the product teams,
what it costs the design system team, and "In LO-TEK", which says how LO-TEK
solved it. Code that is LO-TEK's own API has a green LO-TEK mark above it. The
requirement should make sense without the example, and the example should be
easy to tell apart from the requirement.

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
