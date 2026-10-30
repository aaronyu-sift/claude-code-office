# Motion rules of the Office

The rules differ by kind of object and agree within a kind. A card that a click opens, the camera, a lamp that flickers and a day that turns into night are different things
and move differently: what moves because of a click or a change in the scene moves on a spring, what only changes colour or opacity eases, and what never stops follows the
clock. Inside one kind every instance uses the same motion, so the whole page feels like one material.

The numbers live in two places that must agree: `public/js/motion.js` (for scripts and the canvas) and the `--m-*`, `--ease-*`, `--spring-*` and `--loop-*` variables at the
top of `public/app.css`. The spring variables are generated from `motion.js` (`node tools/motion/gen-springs.mjs --write`); `test/motion.test.mjs` fails when they drift and the
QA check `21-motion` measures the real animations in Chrome (`3d-motion` in `tools/qa/office3d-ui-qa.mjs` does the same for the card, the details card and the shelf of the 3D scene).

## The kinds

| Kind | In the Office | Motion | Numbers |
| --- | --- | --- | --- |
| Surface | the card beside an agent, the details card, the shelf card | spring for travel and scale, eased fade; leaves quicker, back the way it came | enter 0.45 s bounce 0 (666 ms), leave 0.25 s bounce 0 (396 ms); 20 px, from 94 percent; fade 200 ms |
| Small control | the Open menu, the tooltip, the switch knob | spring with a hint of bounce, eased fade | 0.3 s bounce 0.15 (454 ms); fade 200 ms |
| Feedback | hover, press, focus: colour, background, border | short ease-out, never moves anything | 150 ms |
| Data change | a bar that fills | ease, longer | 450 ms |
| Mounted sign | the board on a room's back wall (pixel scene) | eased fade of opacity, nothing moves (in with ease-out, out with ease-in); none under reduced motion, where the page's rule removes every CSS transition | fade 200 ms |
| Page | the Settings view when its tab is chosen | eased fade of opacity on arrival, nothing moves (no travel, no scale: a page is not a card that comes from somewhere); 150 ms under reduced motion, as for every kind; no leave animation, the page it replaces is hidden at once like every view | fade 200 ms |
| Camera and view | pan, zoom, fit, a change of frame | direct while the visitor drags, a spring when the view changes by itself, carrying velocity | follow 0.6 s bounce 0 (858 ms) |
| Built thing | a new room, desk or prop | spring that rises from the ground and bounces once, neighbours 40 ms apart | build 0.5 s bounce 0.3 (804 ms), scale 0.6 to 1 |
| Walker | an agent walking in the 3D office: in from the building entrance to its seat (a desk, a lounge chair, a sofa, a bench or a stool of the room's arrangement), back out to the entrance when its job ends, always on the furniture-clear route of that seat and never across a table, a chair or a prop, also when a walk is turned round or re-routed half way | constant speed (`WALK` 2.2 units a second times the figure's pace) along the path with a short speed-up and slow-down over the first and last 0.7 units, walk cycle and step bounce paced by the speed; a seated person stands up for 0.35 s, on the spot where it sits and with no jump to a stand point, before walking out and a person who turns round holds still for 0.3 s; a walk that has to change (a job that ends before the seat, a person wanted again or at another seat, a rebuild that moves the entrance) goes back along the old route to the last point it shares with the new one instead of cutting across the room (a chat back in another office is led out of the old one by its door, then along the hall's lane to the new door, or out to the entrance and in at the other one); a queue that comes in on a page load, a scene switch or a rebuild leaves the entrance 0.35 s apart and is sped up (pace at most 3) when more than four are queued, so that all are seated within about 10 s (a hurried queue is released within 4 s, but never closer than 0.25 s apart, so a crowd of 40 takes longer than 10 s: figures that leave together walk through each other; `?arrive=calm` keeps the normal pace and the full stagger), while a chat that starts later and every walk out are at the normal pace; one entrance clock serves every queue, so sub-agents that arrive over several polls leave 0.35 s after the one before, and no figure is faster than the ones that left before it (nobody catches up and walks through another); the camera never follows it; none of it eases or springs, the speed is the cue | no feet sliding, no teleport (a step is never longer than speed times pace times the frame's step), nobody appears or vanishes inside a room; with reduced motion the figure walks at the same pace without the bounce of the step |
| Indicator | the working dot, the thinking dots, the waiting balloon and lamp, the light beam | looping sine of the clock, two tempos, never more than 3 flashes a second | slow 2400 ms (a state that continues), quick 1200 ms (it wants a look) |
| Ambient scenery | candles, street lights, monitor glow, steam, drifting leaves, snow, fireflies | follows the clock, never a spring, never started by a click; each instance has its own phase and they do not share a period on purpose; a flicker is stepped random (8 to 10 steps a second) or a plain sine | small amplitude: under 8 percent brightness, under 6 px |
| Room light (3D scene) | a lamp, a candle, string bulbs, a wall light and a screen in an office, and the pane of its windows | the ambient scenery rule: a candle is stepped random (9 steps a second), every other source a sine with a period of its own (2.3 to 4.2 s) and a phase of its own per source; none with reduced motion, where the light stays steady; how bright it is follows the night at the cycle's constant rate (`CYCLE.turn`), never a spring | candle plus or minus 7 percent, a lamp 2.5 percent, a bulb or an LED 3.5 percent; a lamp is dim and has no glow by day, a candle is out |
| Lounge (3D scene) | the message wall, the strip of light under it and the people around it in the hub | a new post is feedback: its row fades in with `EASE.out` over `DUR.slow` (450 ms) and the rest of the wall does not move; the strip's pulse is ambient: it follows the clock on `LOOP.slow` and only its level follows the posts of the last minute; a person who arrives or leaves is a built thing on `SPRING.build` (the pop), someone who posted in the last 20 seconds holds the talking pose (an arm gesture on the clock, like the typing and thinking poses); the wall is painted again only when the model changes, never per frame; a board that stops answering dims its rows (opacity, a state and not a motion: no transition); with reduced motion the text still changes, but there is no fade, no pop, the people hold a still pose (the clock is frozen for them) and the strip stays at a steady level | fade 450 ms, pop 804 ms, pulse 2400 ms, 0.6 to 1 of its level, never more than 3 flashes a second |
| Room switch (3D scene) | the lights of an office coming on when a chat takes it and going off when it leaves: its lamps, candles, bulbs, glows, pools and the warm light of its windows at night | the feedback kind: a short ease of one number from 0 to 1, ease-out arriving (`EASE.out`) and ease-in leaving (`EASE.in`), nothing moves; the first time an office is seen it is at its state at once, and with reduced motion it is a step | 200 ms (`DUR.fast`), `createSwitches` in `ofis-light.js`, called through `lightsFor` in `ofis.js` |
| Cycle | day and night, seasons, weather | follows the clock, linear, no easing; a change made by hand moves the light at a constant rate, never in a step | slow: `CYCLE.turn` 4000 ms for a full change of the light |

Why each choice: a click has no momentum, so a surface that it opens does not overshoot; the same goes for the camera, which would make the whole map wobble. A small control may
hint at a bounce because its distance is tiny and the bounce says "I am responding". A built thing is a small celebration and may bounce. Colour and opacity have no mass, so they
never overshoot. Indicators and scenery are not pushed by anything, so a spring would be the wrong model: they run on the clock, and an indicator's tempo says how urgent it is.

## Rules that hold for every kind

1. **Bounce follows the trigger and the size.** A surface or the camera never overshoots; a small control may hint (up to bounce 0.15); a built thing may bounce (0.3). Never above
   0.4: Apple warns that more feels exaggerated in a UI.
2. **A spring is given as a duration and a bounce**, as in SwiftUI's `Spring(duration:bounce:)`. The duration is the time of one natural period and sets the stiffness,
   `(2 pi / duration)^2`; the bounce sets the damping, 0 for critically damped. The visible length of a move (its settling time) is computed, not chosen. Larger things get longer springs.
3. **Opacity and colour only ease** (`ease-out` arriving, `ease-in` leaving): a background's alpha must not bounce above 100 percent.
4. **Things come out of what they belong to.** An arriving card travels 20 px in from the side of its agent and grows from 94 percent around its tail (the point that touches the
   agent). The details card and the shelf card come in from the right edge, a menu from its button. Leaving retraces the way in. Nothing travels farther than 24 px.
5. **Only `opacity`, `translate` and `scale` move.** Never `top`, `left`, `width`, `height` or `margin`: they re-layout the page. The individual `translate` and `scale` properties
   leave the element's own `transform` (the card's position, which follows the agent) alone.
6. **A click on the interface never moves the map.** Opening, switching or closing a card, folding the shelf or opening a menu changes nothing in the scene: no pan, no zoom, no re-fit.
7. **The map never jumps.** When the view must change by itself (a room is built, the window is resized), it follows the `follow` spring, retargeted each time the frame changes so it
   carries its velocity, and it stops at once when the visitor takes the mouse.
8. **Everything can be interrupted.** An enter during a leave wins and continues from where the element is (opacity, travel and scale); an animation never blocks a click on what stays;
   an element that is leaving takes no clicks.
9. **One thing at a time.** Siblings are staggered by at most 40 ms and a choreography is over within about 400 ms of visible motion, except the camera and construction.
10. **Less motion on request.** With `prefers-reduced-motion: reduce` there is no travel, no scale and no spring: what is left is a 150 ms fade, the camera snaps, and indicators and
    scenery stop. This follows Apple (fades instead of x, y and z transitions, tighter springs) and WCAG (a change of colour or opacity is not motion).
11. **Meaning never depends on motion alone.** A "your turn" lamp is also a colour and a shape; an indicator never flashes more than three times a second (WCAG 2.3.1).

## Tokens

| Token | Value | Used for |
| --- | --- | --- |
| `--m-hover` / `DUR.hover` | 150 ms | hover, press, colour changes; the fade in reduced motion (Material 3 short3, Carbon moderate-01) |
| `--m-fast` / `DUR.fast` | 200 ms | every fade in and out (Material 3 short4) |
| `--m-slow` / `DUR.slow` | 450 ms | a bar that fills (Material 3 long1) |
| `--ease-out` / `EASE.out` | `cubic-bezier(0.05, 0.7, 0.1, 1)` | a fade that arrives (Material 3 emphasized decelerate) |
| `--ease-in` / `EASE.in` | `cubic-bezier(0.3, 0, 1, 1)` | a fade that leaves (Material 3 accelerate) |
| `--ease-in-out` / `EASE.inOut` | `cubic-bezier(0.2, 0, 0, 1)` | a change that stays on screen (Material 3 standard) |
| `--spring-enter`, `--spring-enter-ms` | 0.45 s, bounce 0: 666 ms | a surface arriving |
| `--spring-leave`, `--spring-leave-ms` | 0.25 s, bounce 0: 396 ms | a surface leaving |
| `--spring-glide`, `--spring-glide-ms` | 0.4 s, bounce 0: 600 ms | a card moving to another agent |
| `--spring-pop`, `--spring-pop-ms` | 0.3 s, bounce 0.15: 454 ms | menu, tooltip, switch knob |
| `--spring-build`, `--spring-build-ms` | 0.5 s, bounce 0.3: 804 ms | something built or placed (Apple's `.bouncy`) |
| `--spring-follow`, `--spring-follow-ms` | 0.6 s, bounce 0: 858 ms | the camera |
| `--loop-slow` / `LOOP.slow` | 2400 ms | an indicator for a state that continues (working dot, light beam) |
| `--loop-quick` / `LOOP.quick` | 1200 ms | an indicator that wants a look (waiting balloon and lamp, thinking dots) |
| `CYCLE.turn` (script only) | 4000 ms | the time a full change of the light (0 to 1) takes in the 3D scene: day to night, clear to rain; the real clock moves it a little every minute |

The spring easings are CSS `linear()` functions through 48 points of the real spring's step response, so CSS and the Web Animations API move exactly like the physics; the
millisecond value is the time the spring needs to settle to within 0.3 percent.

## In the code

- `enter(el, { from })` and `leave(el, { to })` (Web Animations API) show and hide a surface or a control by rules 1 to 5 and 8; `setShown(el, on)` calls the right one only when the
  state changes; `comesFrom(side)` says which side a card beside an agent comes from.
- `Spring` is a value that moves toward a target on a spring and keeps its velocity when the target changes (the camera, a follower); `springState`, `settleTime` and `springLinear` are
  the closed-form motion and the CSS easing made from it. Stepping is exact at any frame rate.
- `wave(t, period, phase)` is the sine of an indicator's loop; `LOOP` holds the two periods. CSS loops use `--loop-slow` and `--loop-quick`; a loop with a period of its own fails
  the unit test and the QA check.

## Where the current animations sit

- Surface, small control, feedback, data change: done (cards, menus, tooltip, switch knob, hover transitions).
- Page: done for the Settings view (`public/js/settings-tab.js`: a Web Animations fade of `.st` with `DUR.fast` and `EASE.out`, `DUR.hover` under reduced motion). The sample board of the project setting there is a mounted sign: its project line only fades (200 ms) and keeps its place. A row that a scene does not have (the lounge row in the pixel scene, the camera row in the 3D scene) and the note under the lounge row ("The address shows the demo conversation.") are shown and hidden with `hidden`, without animation; what the choice does to the pavilion is the Lounge kind's business.
- The 3D scene (`?scene=3d`) has the card, the details card and the shelf card through the same helpers (`enter`, `leave`, `setShown`, the same tokens), so they move as above; its camera is still direct (see the next item).
- Indicator: done. The working dot uses the slow tempo and the thinking dots and the waiting balloon the quick one (CSS); in the pixel scene the light beam is slow and the waiting
  figure's bob is quick; in the 3D scene the beam is slow and the lamp's blink is quick.
- Ambient scenery in the pixel scene (monitor glow, steam, snow, petals, fireflies, sway) already follows the clock with a phase of its own per instance, as the rule asks.
- Room light in the 3D scene (`ofis-light.js`, drawn by `ofis-decor.js`): the lamps, candles, string bulbs, wall lights and screens of the offices with a chat flicker by the Room light row, the glow and the pool of light come up with the night at the cycle's rate and the window panes go from the sky to a warm light with it; the colour of every source is set on one instanced mesh, so a frame costs no extra draw call (`3d-room-life` in `tools/qa/office3d-life-qa.mjs` reads the flicker in the page: under 15 percent of the mean, moving at 22:00, steady with `prefers-reduced-motion`).
- Room switch in the 3D scene (`createSwitches` in `ofis-light.js`, drawn by `ofis-decor.js`): the light of an office belongs to its slot (the furniture is the same vacant or occupied, the lights are the only difference). It is one number per slot that multiplies the bulbs, the glows, the pools and the lit panes, so the colour of every source is still set on the same three instanced meshes and a frame costs no extra draw call. While it is 0 nothing flickers and the windows show the dark night sky (by day they are the same either way). The switch is thrown in one function, `lightsFor` in `ofis.js`, which today runs when the building is rebuilt for a chat taking or leaving an office; the walkers' door crossing may call `decor.setLit` from where a person passes the door instead. The ease is proven in `test/ofis-decor-light.test.mjs` with a clock the test controls (strictly between 0 and 1 on the way, exactly `SWITCH_MS` long, a step with reduced motion); `3d-cowork-slot` in `tools/qa/office3d-cowork-qa.mjs` reads the number in the page, which cannot know when its first frame after a rebuild draws, so it only asserts the direction and the end state: 0 vacant, 1 and never back down once a chat has come, 0 and never back up once it has left.
- Cycle in the 3D scene: the light of the day and night (lit windows, lamps, the sun's and the sky's strength and colour) and the weather's share of it move toward what the clock and the
  settings ask for at a constant rate (`ofis-env.js` `stepLight`, the pure `approach` in `office-atmosphere.js`, pace `CYCLE.turn`); a time chosen in the popover is a slow change, not a step.
  The weather overlay's particles are ambient scenery (clock-driven, a phase per particle, at most 10 frames a second); with reduced motion the weather is off.
- Walkers in the 3D scene (`ofis-arrive.js`, drawn by `ofis.js`): done, on the coworking rooms' seats. Every figure is made at the building entrance and walks the route of its seat (the router's furniture-clear route: lane, door, approach points, seat), sits down facing as the seat does, and walks the same way back out to be removed when its chat or job ends (a brief job turns round where it stands; the door of the office a chat has just left is a real door that opens for the person walking out of it); a page load, scene switch or rebuild does the same for the people already in the data, `?arrive=calm` keeps the normal pace for all of them. `tools/qa/office3d-walk-qa.mjs` (`npm run qa:3d-walk`) reads the constant speed, the ramps, the stagger and the 10 second budget, the no-teleport rule across arrivals, departures, a growth rebuild and a reload, the rule that a walk in, a walk out, a turn-back and a re-route keep 0.2 m clear of the furniture (read with a tolerance of 0.05 m), and the reduced-motion walk (no bounce, same pace).
- Waiting for the new art style and assets (the 3D scene, plan item S17): the camera on the `follow` spring, the construction animation on the `build` spring, eased growth of a room, and the flicker of the street lights (stepped random, the helper of the room lights, `ofis-light.js`).
- Open: WCAG 2.2.2 asks for a way to pause, stop or hide a loop that starts by itself and lasts more than five seconds. The reduced-motion setting is the only stop today; there is
  no control in the page.

## Sources and what is not settled

Checked on 2026-10-29. The full notes, with the links and everything that could not be read, are in `Agent Chat/pixel-scene/m7/motion-by-kind-research.md` on the Drive (the first pass:
`motion-and-game-skills-research.md` and `apple-springs-verification.md` in the same folder).

- Apple: [WWDC18 803 "Designing Fluid Interfaces"](https://developer.apple.com/videos/play/wwdc2018/803/) (no overshoot for a tap, bounce only to reward momentum, "treat behaviors as a
  family"), [HIG Motion](https://developer.apple.com/design/human-interface-guidelines/motion) (brevity, retrace the way in, optional motion), [WWDC23 10158 "Animate with springs"](https://developer.apple.com/videos/play/wwdc2023/10158/)
  (mass 1, stiffness `(2 pi / duration)^2`, bounce above 0.4 with care, velocity kept when retargeted), and the SwiftUI API pages for `.smooth` (bounce 0), `.snappy` (0.15) and `.bouncy` (0.3).
- **Not settled:** the damping formula. The WWDC23 text as fetched and the [Apple developer forums thread](https://developer.apple.com/forums/thread/739811) disagree; this code uses the
  physically consistent one (bounce 0 is critically damped: damping = 4 pi (1 - bounce) / duration). Apple's duration for the plain presets is not stated on their own pages (0.5 s is the
  default of their tunable variants); the durations here are ours except the built thing.
- Material 3 and Android: [Motion.md](https://github.com/material-components/material-components-android/blob/master/docs/theming/Motion.md) (durations, easings, spatial springs for movement
  and effects springs with damping 1.0 for colour and opacity), [`SpringForce`](https://developer.android.com/reference/androidx/dynamicanimation/animation/SpringForce) constants,
  [Compose animation](https://developer.android.com/develop/ui/compose/animation/customize) (springs keep velocity when the target changes). The m3.material.io pages could not be read.
- Carbon: [motion](https://carbondesignsystem.com/elements/motion/overview/) ("use the same motion" for the same function). Fluent: linear only for a consistent rate such as a rotation.
- Games: the camera follows frame-rate independent smoothing or a critically damped spring ([Holden](https://theorangeduck.com/page/spring-roll-call), [Godot](https://docs.godotengine.org/en/stable/tutorials/math/interpolation.html)); a
  character speeds up and slows down at the ends of a path ([Swink](https://www.gamedeveloper.com/design/game-feel-the-secret-ingredient)); light flicker in id Software's Quake and Doom is stepped random or
  table-driven at about 8 to 10 steps a second ([Quake `r_light.c`](https://raw.githubusercontent.com/id-Software/Quake/master/WinQuake/r_light.c), [Doom `p_lights.c`](https://raw.githubusercontent.com/id-Software/DOOM/master/linuxdoom-1.10/p_lights.c)); a day cycle is plain
  time ([Minecraft](https://minecraft.wiki/w/Daylight_cycle)). No source for city-builder pop-in, idle-bob periods or sine-versus-noise flicker was found.
- Accessibility: [WCAG 2.3.1](https://www.w3.org/WAI/WCAG21/Understanding/three-flashes-or-below-threshold.html) (three flashes a second), [2.2.2](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html) (pause, stop, hide),
  [2.3.3](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html) and [MDN prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion).
- `linear()` easing: [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/easing-function/linear), supported since Chrome 113, Firefox 112 and Safari 17.2.
- Not from any source, our own choices: the 20 px travel and 94 percent start, the 40 ms stagger, the two loop periods, the spring durations (except the built thing), the 8 percent and
  6 px amplitude limits of ambient scenery, the roles of the six springs.
