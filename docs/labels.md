# The label cards of the 3D Office

The card above or below an agent (its project, chat name, what it does, what it just said), the balloon over its head and the signs of the rooms are DOM elements over the canvas
(`.of-l`, `public/js/ofis.js` `placeLabels`). They used to flicker while agents walked and while the view zoomed. This page says why, what the scene does now, and how it is checked.

## What was wrong

Measured on a scratch copy of the app with a fixed 30 fps clock (10 chats, 22 figures, 1680 x 913, zoom 25.4, seven scenes, about 1,900 frames), then confirmed on the unmodified
page in headless Chrome. The layout was `layoutLabels` (`public/js/ofis-label-layout.js`): stateless, decided from scratch on every scene frame.

| Cause | What it did | Measured (stateless layout) |
| --- | --- | --- |
| It decides again every frame, with exact-zero-overlap thresholds against things that move | one pixel of change in a neighbour picks another spot: a card jumps by a whole ring step (0.55 x its width, 0.75 x its height) in one frame | 789 one-frame jumps over 40 px (largest 617 px) while the agent moved 3 to 4 px |
| Show and hide have no debounce, no hysteresis and no fade | a card or balloon goes when the first free spot is over 70 px away or it touches a higher one, and comes back a frame later | 424 toggles, 138 blinks (hidden at most 0.5 s), 57 flashes (visible 5 frames or fewer) |
| It gets worse with the frame rate | a new decision every frame, so more frames mean more decisions | at 120 fps (inputs interpolated): 560 toggles, 206 blinks, 94 flashes, 1,088 jumps |
| A walker has no stable place | a queue of walkers one metre apart carries labels 85 to 170 px wide, there is never a free spot, and the seated labels give way to every walker that passes | 230 of 234 jumps of the walk scene belong to walking agents |
| The zoom changes every spot at once | the scale followed the zoom continuously, the limits (12, 19, 22) were hard thresholds | a 14 -> 60 -> 14 sweep: 80 to 84 toggles, 108 to 174 jumps |
| The home spot was never free | the card hung 3 px under the floor point, inside the agent's own click rectangle, so every card sat one ring lower | 99 percent of the tag-frames |
| Text drawn at fractions of a pixel and a scale that changes every frame | the text is rasterised again every frame (not measured on the real GPU) | 10 positions 0.1 px apart gave 10 different pictures |
| The chip was rebuilt every second | `innerHTML` every tick for a chat that waits, which restarts the chip's animation | one rebuild per second per waiting chat |

## What the scene does now

`createLabelLayout` (`public/js/ofis-label-layout.js`) keeps a memory between frames; `layoutLabels` stays (its 8 tests are unchanged) for anything that wants a one-off layout.
`placeLabels` feeds it the clock of the frame (the loop's rAF timestamp) and applies the answer.

**The layout.** One instance per scene, `step(inputs, now)` once per scene frame. Time is the clock it is given, so 30, 60 and 120 fps decide alike to within one 30 fps frame
(`test/ofis-label-stable.test.mjs`, "frame-rate independence"); one step is capped at 100 ms, so a tab that was hidden resumes without a jump.

| Rule | Value |
| --- | --- |
| Home spot | just under the agent's own figure rectangle (`near.y + near.h + 2`), not the floor point |
| Cells | home and four rings of eight (`pixel/labels.js`), in lattice units of 0.55 x width and 0.75 x height, so they scale with the zoom |
| Stay | a label keeps its cell while nothing overlaps it by more than 1 px (`PAD_KEEP` -1); a new cell needs 3 px of clearance (`PAD_ENTER`) |
| Leave | an overlapped label leaves at once (`ESCAPE_MS` 0), for the nearest free cell |
| Go home | only after the home spot has been free for 1,000 ms (`RETURN_MS`), and never two moves within 350 ms |
| Move | the lattice coordinates ride `SPRING.glide` (0.4 s bounce 0, about 600 ms, no overshoot, the velocity is kept when the target changes); no label glides faster than 280 px a second (`MAX_SPEED`: 28 px in a 100 ms step, however slow the frame rate) |
| Order | rank (the chats that wait for you 120, other chiefs 100, sub-agents 10), then first sight; never the label's y, which changes as the agents walk |
| Show and hide | a verdict must hold for 90 ms to show and 400 ms to hide; shown at least 700 ms, hidden at least 500 ms (`SHOW_MS`, `HIDE_MS`, `MIN_SHOWN_MS`, `MIN_HIDDEN_MS`) |
| Reach | a sub-agent's card is shown within 70 px of its agent and stays until 94 px (`REACH_SLACK` 24) |
| Under the card | a label whose drawn rectangle touches the agent card, the shelf or the buttons is hidden in that very step, with no fade (`cut`) |
| A chief's label | never hidden for clutter: it takes the least bad cell, and when every cell is under the card the nearest spot of a 14 px grid that is clear of it (`freeSpot`), held until it is no longer valid; it goes home when home has been free for `RETURN_MS` |
| Forgotten | state of an id that has not been seen for 1,500 ms is dropped |
| Output | `Map id -> { x, y, shown, cut, moving }`; `layout.moving` is true while any label's spring has not settled |

**Walkers.** A walking chief's card is carried under its figure at every frame and holds no place: it takes part in no declutter, so the cards of the seated agents never move for
it (it is hidden only while it is under the card or the buttons). A walking sub-agent has no card until it sits (`animChar` sets `tag.off`: this is the one changed line of the walk
code). The speech balloon of a walker is carried the same way (`walking` on a fixed label in the layout, `walkingBal` in `placeLabels`): it follows the figure and holds no place, so a
walker that passes a room does not push the balloons or cards of the agents that sit there. The figure of a walker is not an obstacle for the other cards (`placeLabels` leaves its
rectangle out of `figures`). A card that was at another cell when its agent stood up glides back under it. Walking pace and gait are not touched.

**In the page.**

| What | How |
| --- | --- |
| Visibility | the inline `visibility` switches at once with the layout's `shown` (the QA and the click handling read it) |
| Fade | CSS only, so it takes the same time at any frame rate: `.of-l` is `opacity: 0` with `transition: opacity var(--m-fast) var(--ease-in), visibility 0s linear var(--m-fast)`; `.of-l.on` is opacity 1 with `var(--ease-out)`; `.of-l.cut` has no transition; none under prefers-reduced-motion; no click on a label that is fading out |
| Scale | `zoom / 38` in steps of 0.04 (0.76 to 1.0, with a hysteresis of 0.03 so a zoom that hovers on a step does not flip it); a chief's label is never below 0.9 |
| Place | the translate is rounded to whole device pixels (`Math.round(v * dpr) / dpr`) and written only when it changes |
| Zoom limits | a label is shown from its limit (12, 19, 22) and stays until the zoom is 6 percent beyond it |
| Clocks | the seconds of a chip are an element with `data-since`, kept by the page's ticker; `setLabel` compares the markup without them (`unticked`), so the chip is not rebuilt every second; the label is measured again |
| Reduced motion | the springs jump to their cell and there is no fade |

The frame loop is not changed by this: `placeLabels` runs in the same callback as the card, as before. `layout.moving` is what a frame pacer needs to keep drawing while a label
glides (read it with `__ofis.labelsMoving`).

## How it is checked

`test/ofis-label-stable.test.mjs` (the layout in numbers: home spot, a walker passing three seated labels, ping-pong, frame-rate independence, debounce, the spring, reach, the
card, the grid fallback, forgetting, reduced motion, `moving`, a seeded random walk of 12 agents and 40 labels at 8, 30 and 120 fps) and `test/office-labels.test.mjs` (`unticked`).

`tools/qa/office3d-labels-qa.mjs` (`npm run qa:3d-labels` once the script line is in `package.json`) runs the real page in headless Chrome. A read-only sampler (what a console script
on the user's own Chrome would do) reads the inline visibility and transform of every label and the screen place of its agent on every requestAnimationFrame. The headless page draws
about 8 frames a second (software GL), so what is counted is per scene frame, and the layout's step is capped at 100 ms: 40 px at 8 fps is 5 px at 60 fps.

| Check | What it reads | Passes when |
| --- | --- | --- |
| `3d-walk-labels` | the page opens with 10 chats and 12 sub-agents and everybody walks in, at dpr 1 and dpr 2; afterwards the labels of the settled scene | 0 jumps over 40 px beyond the agent, 0 flashes, at most 2 blinks; no visible label under the card or the buttons; at least 10 labels shown |
| `3d-labels-walkers` | the walker rule on the same records | no walking sub-agent has a card; a walking chief's card is shown in at least 90 percent of its readings; at least 60 percent of the seated sub-agents have a card |
| `3d-labels-zoom` | a zoom 14 -> 60 -> 14 in 6 s with people walking, again with everybody seated, and a zoom that shakes between 21.6 and 22.4 | walking: at most 60 toggles, 0 jumps; seated: at most 40 toggles, 0 jumps; shaking: at most 2 toggles (the band) |
| `3d-labels-fade` | computed styles: the transition, the class `on`, a label that goes (inline hidden at once, opacity between 0 and 1 a moment later, no clicks); the transforms at three zooms that are on no step; reduced motion | opacity 0.2 s, none under reduced motion; every scale in the steps and every translate in whole device pixels (dpr 2: halves) |
| `3d-labels-clock` | a chat that waits, three ticks, a MutationObserver on its label | the same chip element, no change in the label but the seconds, and the seconds count up |
| `3d-labels-passing` | the camera on the room next to the entrance (`lookAtRoom`), 5 s to settle, then a sub-agent walks in to its seat for about 24 s while the seated cards of that room are read | the walker is read in the view at least 20 times, and no seated card moves more than 4 px against its agent |

A toggle is counted only while the agent is inside the view by 180 px at the sides, 100 px at the top and 200 px at the bottom: a card that the edge of the view cuts off toggles by the
camera. The blinks and flashes in the zoom sweeps are reported, not gated, because the zoom itself decides some of the visibility there; in the two sweeps of a run all of them
(4 and 5) had the figure at the edge of the view. `--mutations` breaks one line at a time in a copy of the repo and every one must fail its check; `--verify-mutations` checks that
each line to break is there once.

| Mutation (13) | Fails |
| --- | --- |
| the stateless layout again | `3d-walk-labels` |
| a walking chief is an ordinary label that holds a place | `3d-labels-walkers` |
| a walking sub-agent keeps its card | `3d-labels-walkers` |
| the figure of a walker is an obstacle for the cards of the others | `3d-labels-passing` |
| the balloon of a walker holds a place like any other | `3d-labels-passing` |
| show and hide are not debounced | `3d-walk-labels` |
| a label jumps to its cell instead of gliding | `3d-walk-labels` |
| the zoom limits have no band | `3d-labels-zoom` |
| the fade is gone | `3d-labels-fade` |
| reduced motion keeps the fade | `3d-labels-fade` |
| a label is placed at fractions of a device pixel | `3d-labels-fade` |
| the scale of a label follows the zoom continuously | `3d-labels-fade` |
| a label is rebuilt when only its seconds change | `3d-labels-clock` |

The one-second wait before a label goes home (`RETURN_MS`) has no page mutation: a QA that counts moves cannot see it (the label would only stay away longer), so a unit test
holds it (`a label that gave way goes home only after the home spot has been free for RETURN_MS`).

Results of the last run (headless Chrome, software GL, load about 30): page-load walk at dpr 1: 3 toggles, 0 blinks, 0 flashes, 0 jumps (largest step 28.8 px beyond the agent);
at dpr 2: 0 toggles, 0 jumps (0.9 px). Zoom sweep with people walking: 8 to 10 toggles, 0 jumps; seated: 21 to 22 toggles, 0 jumps (largest step 28.3 px); shaking around the limit:
1 toggle. Walkers: 805 readings of walking sub-agents, 0 with a card; 557 of 564 readings of walking chiefs with a card, 542 of them under their figure. Passing: 1,069 readings of
seated cards, 0 moves over 4 px. The layout costs 0.015 ms a step.

## Not measured

Everything above is geometry, decisions and counts, proven in headless Chrome with software GL. Not measured: how the text looks on the real GPU (whether the whole-pixel place and the
steps of the scale stop the shimmer), the compositor's cost of the label layer (`will-change` is a decision for the real GPU), a label that changes size with a tool call in a live
session (the home spot is recomputed from the new size every frame, so the label grows around its agent; the fixture had static text), and how the carried card of a walker looks at
the walking speed the pace step asks for.
