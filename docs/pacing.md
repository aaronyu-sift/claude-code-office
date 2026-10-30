# Frame pacing of the 3D Office

When does the 3D scene draw a frame? The rule lives in one pure module, `public/js/ofis-pace.js`, and is wired into the scene loop in `public/js/ofis.js`. This page is the rule, the reasons, the numbers and how it is tested.

## Why it exists

Before this change the scene was capped at 30 fps (`FRAME_MS`) on a display that runs at 120 Hz, so every image was held for four display frames: figures, balloons, name cards and the open card hopped 30 times a second. When the window had no focus, or nothing had touched the Office for 45 seconds, the cap was 15 fps, which is the state the Office is in while somebody works in another window. The shadow map was redrawn every 12th frame, so at 30 fps the shadow of a walker lagged 0.4 s behind it, and raising the frame rate alone would have made it worse (120 fps / 12 = a 10 Hz shadow).

## The rule

| State | Frames drawn | Why |
| --- | --- | --- |
| Something moves, or somebody interacts, and for 1 s after the last such signal | every animation frame: the display's own rate (120 Hz: 120 fps) | smooth motion is what the eye reads |
| Nothing moves, nobody touches the Office | 30 fps | lamps, typing, cars and water are slow; 30 is plenty |
| Nothing for 60 s | 15 fps | an Office left visible all day costs little |
| Software GL (headless, a VM) | 8 fps, always | it draws on the CPU; the pacer still makes and counts its decisions |

The window's focus is never asked. A visible window with no focus is watched, not asleep (the browser stops animation frames of a hidden or fully covered window by itself).

The idle gate keeps a 2 ms slack (never more than a quarter of a display frame), so the spacing is a whole number of display frames: 30 fps on 60, 90 and 120 Hz, 25 on 75 and 100 Hz, 28.8 on 144 Hz. A bigger slack made 75 Hz alternate 26.7 and 40 ms.

## What counts as motion

Detected in `step()` after the figures have moved (`paceFigures`, `paceDoors`, `paceLounge` in `ofis.js`), never inside `animChar` or `stepDoor`:

- a figure that walks (one that waits at the entrance counts for its first second only: nothing of it is drawn yet), stands up, sits down or still turns to face its seat;
- a hinged door that swings (the open amount is compared around `stepRooms`);
- a person of the lounge whose pop-in or pop-out spring has not come to rest;
- a room's light that is being switched (`decor.update` reports it);
- the camera shaking (`api.shake`).

Woken where they happen: `pointermove`, `pointerdown`, `pointerup`, `wheel`, `keydown`, `touchmove` on the Office element, a `visibilitychange` to visible, `show()`, every `applyCam` (pan, zoom, fit, resize, `view`), the `ResizeObserver` callback, `api.wake()` of the local module, and every figure that is made.

Not motion: a figure that types, thinks, waves or sleeps at its seat, the flicker of lamps and candles, cars and water, the weather overlay and the slow turn of the light with the time of day. They run at the idle rate.

Hook for the label layout (connected by the integration step): the stateful layout reports `moving` while a label glides to its spot; the loop then calls `wakeForLabels(now)` (`pacer.wake(now, LABEL_WAKE_MS)`, 250 ms) after `placeLabels()`. Nothing of the labels is exposed from the pacer.

## The guards

At the display rate, a frame that costs too much is worse than a lower rate. Two guards, both off in software GL:

- **Cost guard.** The CPU time of a drawn frame, smoothed. Above 80 percent of a display frame the scene draws every 2nd, 3rd or 4th frame (up at once, down only below 60 percent of the shorter step).
- **Gap guard.** The cost guard cannot see the GPU. When the GPU or the compositor cannot keep up, the browser hands over animation frames late. While the scene moves, when at least 20 percent of the last 30 gaps are longer than 1.5 display periods, the scene draws every 2nd, 3rd, ... animation frame (`gapSkip` + 1, at most 4). After 5 s of clean moving frames it tries one step back; a try that fails within 10 s doubles the wait (up to 60 s); at most two changes in any 10 s. A stall (a gap over 250 ms: a hidden tab, a rebuild) is not a late frame, and only moving frames count.
- **The display's period** is read from the stream (the median of the first 12 gaps, then eased with gaps of about one period) and read again after 12 consecutive gaps outside 0.7 to 1.4 periods that are steady (all within 25 percent of their median): a window moved to a 60 Hz screen, Chrome's Energy Saver at 30 fps. An uneven stream (an overloaded machine hands over 16.7 and 25 ms gaps) is not a new display; it is the gap guard's to answer.
- `maxFps` (an option of `createPacer`, default none) caps the moving rate in whole display frames, rounded up: one line in `ofis.js` if the real GPU cannot hold 120.

What the gap guard does on a simulated machine with two frames in flight and a 120 Hz display (`test/ofis-pace.test.mjs`): 5 ms or 9 ms of GPU per frame, no change; 12 ms, level 2 (60 fps), tries to go back at 5, 20, 40 and 80 s; 20 ms, level 3 (40 fps); 30 ms, the steady 33 fps is read as the display's own period and every frame handed over is drawn.

## The shadow map

Redrawn on motion instead of every 12th frame: every 25 ms while a figure or a door that casts a shadow moves (times the pacer's skip, so a machine that cannot keep up draws fewer shadows with the frames), every 400 ms otherwise, and at once on a change of the building and on a resize. At 120 Hz that is one pass in three frames, 40 a second, only while something walks. A refresh adds about 35 draw calls and 76,000 triangles at 10 chats with 15 figures (measured by the investigators in software GL, not on the GPU); the budget QA (`3d-budget`, `3d-vacant`) cannot see it because shadows are off in software GL, which is why the rates QA below runs with shadows on. Lounge people count as casters only while their pop spring moves.

## Reading it

`root.__ofis.pacing` (read-only; verification and the cadence logger): `moving`, `fps` (the rate it asks for), `period`, `skip`, `costSkip`, `gapSkip`, `cost`, `deep`, `softwareGL`, the counters since the start (`raf`, `drawn`, `movingDrawn`, `late`, `shadows`, `shadowSync`, `wakes`, `steps`, `returns`, `reseeds`), `busy` and `casters` (what the last frame's step found, before the hold) and `hasFocus` (reported only). `root.__ofis.pacingSeconds(n)` gives the last n finished seconds (animation frames, drawn, moving, shadows, late frames, longest gap) and the moving share, which is how a stuck source of motion shows: a share near 1 with nobody moving.

## Tests

- `test/ofis-pace.test.mjs` (in `npm test`): the pacer against made-up streams of animation-frame timestamps (60 to 240 Hz, jitter, missed vsyncs, a stream that changes its rate, machines of different GPU cost), no browser.
- `node tools/qa/office3d-pace-qa.mjs [--only decide|rates] [--mutations] [--verify-mutations]` (headless, software GL):
  - `decide`, real time: the pacer's decisions on the real scene (walk-in, rest with typing figures, each wake signal, the hold, sit-down, leaving, a door alone, shadow requests);
  - `rates`, a virtual display (this QA drives the page's animation frames and clock at 120 Hz and the page believes it has a GPU, so the pacer is in its hardware profile and shadows are on): 120 fps while people walk with the window not focused, 30 fps at rest, 15 fps after a minute, one shadow pass in three frames with the renderer really drawing every pass, and the gap guard stepping down on late frames.
  - `--mutations` breaks 14 lines one at a time (the detection of motion, a door, a sit-down, the wheel and camera wakes, the hold, the shadow cadence and its casters, the idle and deep rates, the gap guard, a focus gate put back) and every one must fail the check that guards it.
- `tools/qa/probes/cadence-log.js`: the passive logger for the user's own Chrome (see its header). No loop, no drawing; it reads the pacer's own per-second counts once a second.

## Not verified here

Headless Chrome is software GL: no frame time, GPU time, shadow cost or power figure on a real GPU, whether 120 fps holds with the DOM labels, and no look of the walk at the display rate. The cadence logger and a look in the user's own Chrome at 120 Hz are the checks for those.
