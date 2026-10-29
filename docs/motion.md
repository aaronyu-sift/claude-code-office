# Motion rules of the Office

One set of rules for every animation on the page: cards, menus, tooltips, buttons, the camera and the things that appear in the scene. The numbers
live in two places that must agree: `public/js/motion.js` (for scripts and the canvas) and the `--m-*` and `--ease-*` variables at the top of
`public/app.css` (for CSS). A unit test (`test/motion.test.mjs`) and the QA check `21-motion` keep them honest.

## The rules

1. **Arrive slowly, leave quickly.** Something that appears takes `base` (300 ms) and decelerates (`ease-out`). Something that goes away takes `fast`
   (200 ms) and accelerates (`ease-in`). A leaving element is never on screen longer than an arriving one.
2. **A little travel, never a slide across the page.** An element fades in while it moves 14 px in from the side it belongs to: a card beside an agent
   comes out of the agent, the details card and the shelf card come from the right edge, a menu from its button. Nothing travels farther than 24 px.
3. **Only `opacity` and `translate` move.** Never animate `top`, `left`, `width`, `height` or `margin`: they re-layout the page and stutter. The individual
   `translate` property is used so the element's own `transform` (the card's position, which follows the agent) is not touched.
4. **Things that stay on screen and move use `ease-in-out`** (a card gliding from one agent to another, the camera): `inOut`, `base` to `slow` long.
5. **A click on the interface never moves the map.** Opening, switching or closing a card, folding the shelf or opening a menu changes nothing in the scene:
   no pan, no zoom, no re-fit. Only the visitor's own pan and zoom, the "fit" button and a change of the scene itself (a room appears) move the view.
6. **The map never jumps.** When the view must change by itself (a room is built, the window is resized), it eases with a critically damped spring
   (`damp`, lambda 3 to 6, about 0.35 s to get most of the way) and stops at once when the visitor takes the mouse. It never jumps in one frame.
7. **Hover and press feedback is quick:** `hover` (150 ms), colour, background and border only, `ease-out`.
8. **Small popovers (menu, tooltip) fade in over `fast` (200 ms); their exit may be instant.** A tooltip that lingers after the mouse has left feels wrong.
9. **Built things pop, they do not appear.** A new room, desk or prop rises from the ground (scale 0.6 to 1 with a small overshoot, `spring`, 450 to 700 ms)
   and its neighbours wait 40 ms each (at most 400 ms in all), so a new building reads as being built. (Planned with the new scene, see below.)
10. **Everything can be interrupted.** An enter during a leave wins and starts from where it is; an animation never blocks a click on what stays.
11. **Less motion on request.** With `prefers-reduced-motion: reduce` every slide and move becomes a 150 ms fade, and the camera snaps. Nothing that
    carries meaning (a "your turn" light, a state) depends on motion alone.
12. **One thing at a time.** Siblings are staggered by at most 40 ms and a whole choreography is over within 400 ms, except the camera and construction.

## Tokens

| Token | Value | Used for |
| --- | --- | --- |
| `--m-hover` / `DUR.hover` | 150 ms | hover, press, colour changes (Material 3 short3, Carbon moderate-01) |
| `--m-fast` / `DUR.fast` | 200 ms | leaving, menus, tooltips, small fades (Material 3 short4) |
| `--m-base` / `DUR.base` | 300 ms | cards and panels arriving, gliding (Material 3 medium2) |
| `--m-slow` / `DUR.slow` | 450 ms | large surfaces, bars that fill (Material 3 long1) |
| `--m-camera` / `DUR.camera` | 800 ms | the view easing to a new frame (Material 3 extra long, 700 to 1000) |
| `--ease-out` / `EASE.out` | `cubic-bezier(0.05, 0.7, 0.1, 1)` | arriving (Material 3 emphasized decelerate) |
| `--ease-in` / `EASE.in` | `cubic-bezier(0.3, 0, 1, 1)` | leaving (Material 3 accelerate) |
| `--ease-in-out` / `EASE.inOut` | `cubic-bezier(0.2, 0, 0, 1)` | staying and moving (Material 3 standard) |
| `--ease-spring` / `EASE.spring` | `cubic-bezier(0.34, 1.3, 0.64, 1)` | a small overshoot: built things (our own) |

## In the code

- `enter(el, { from })` and `leave(el, { to })` (Web Animations API) show and hide an element by rules 1 to 3 and 10; `setShown(el, on)` calls the right one
  only when the state changes; `comesFrom(side)` says which side a card beside an agent comes from.
- `ease(name)` returns the same curve as a function, for the canvas; `damp(a, b, lambda, dt)` is the frame-rate independent ease for the camera.
- CSS: `@keyframes m-pop` (menus and tooltips) and the `transition` lines use the variables; there is no other literal duration in `app.css`.

## What is done and what is waiting

Done: the tokens, the helpers, cards (the card beside an agent, the details card, the shelf card), menus and the hover transitions follow the rules.
Waiting for the new art style and assets (the 3D scene, plan item S17): the eased camera (rule 6), the construction animation (rule 9) and the eased
growth of a room. The pixel scene's camera still re-frames in one step when its first rooms appear.

## Sources

Checked on 2026-10-29 by a research pass (note with all links and what was not verified: `Agent Chat/pixel-scene/m7/motion-and-game-skills-research.md` on the Drive).

- Durations and easing curves: [Material 3 motion tokens, as published in the Material Components Android docs](https://github.com/material-components/material-components-android/blob/master/docs/theming/Motion.md)
  (short 50 to 200 ms, medium 250 to 400, long 450 to 600, extra long 700 to 1000; standard `cubic-bezier(0.2, 0, 0, 1)`, accelerate `(0.3, 0, 1, 1)`,
  emphasized decelerate `(0.05, 0.7, 0.1, 1)`). The official m3.material.io page returned only its title, so these numbers come from the Android doc.
- Cross-check: [IBM Carbon v10 motion](https://v10.carbondesignsystem.com/guidelines/motion/overview/) (fast-02 110 ms, moderate-01 150 ms, moderate-02 240 ms, slow-01 400 ms).
- Apple Human Interface Guidelines and Fluent 2: their motion pages carry no numbers, so nothing is taken from them.
- Camera: [`THREE.MathUtils.damp`](https://threejs.org/docs/pages/MathUtils.html) is first-order exponential smoothing with no overshoot, which is what `damp` here does; a true
  critically damped spring (Unity's SmoothDamp) is a small addition if the camera ever needs velocity continuity.
- Not from any source, our own choices: the 14 px travel, the spring overshoot for built things, the 40 ms stagger, the reduced-motion behaviour.
