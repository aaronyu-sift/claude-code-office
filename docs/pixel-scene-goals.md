# Goal prompts for the pixel scene

Each prompt is for `/goal` (no turn limit, by choice: the only stop besides success is "blocked after three genuine attempts"; limit 4,000 characters; the evaluator only reads what appears in the conversation, so each one
makes the work print its evidence). Run them one at a time and review in between. Plan: [pixel-scene-plan.md](pixel-scene-plan.md).

Shared constraints, repeated in each prompt: no push, no PR, `main` untouched, no edits outside the repo except the Drive review
folder, no third-party art, no new runtime dependencies, loop and stress pages only in headless Chrome, servers stopped before a
turn ends, a denied tool call is not worked around.

## Goal 1: engine vertical slice, isometric

```
Build Goal 1 (milestone M1) of the pixel scene plan in the repo /Users/ayu/claude-code-office (branch pixel-scene). First read docs/pixel-scene-plan.md completely and follow its decisions, architecture, art direction, safety rules and the section 7 checks; do not re-decide them.

Done when ALL of these appear in your own tool output in this conversation (the evaluator cannot read files, so print the evidence):
1. `cd /Users/ayu/claude-code-office && npm test` exits 0 and prints the passing test count (at least 25 tests: projection round trip, layout determinism / stability / no overlap for 1, 4, 10 and 20 agents, scheduler, manifest consistency, label wrapping).
2. `node tools/sprites/build-atlas.mjs --proj iso --check` exits 0 and the manifest has at least 60 sprites (print the count per category).
3. `node tools/qa/pixel-qa.mjs --proj iso` ends with `QA PASS`; print its full output, which must include the CHECK lines for plan section 7 items 1 to 5, 8, 9 and 10, plus the frame budget (6) and idle (7) checks with the measured numbers.
4. The pixel scene is the default scene and `?scene=3d` still renders the old one. The new scene shows full chat names, the "your turn" light, working, waiting, dormant and done states, a hover tip, click-to-drawer, zoom and fit.
5. Screenshots for 4, 10 and 20 agents are in "/Users/ayu/Library/CloudStorage/GoogleDrive-ayu@siftscience.com/My Drive/Agent Chat/pixel-scene/m1/" and you printed `curl -s -o /dev/null -w '%{http_code}'` = 200 for each localhost link (http://localhost:8787/Agent%20Chat/pixel-scene/m1/<file>.png).
6. `git -C /Users/ayu/claude-code-office status --short` prints nothing; `git -C /Users/ayu/claude-code-office log --format='%h %ae %s' origin/main..HEAD` lists only commits by macbookproiceland@gmail.com, none with a Co-Authored-By trailer; nothing was pushed.
7. The Goal 1 checkboxes in docs/pixel-scene-plan.md are ticked and every deviation from the plan is written under a "Deviations" heading in that file.

Constraints: no push, no PR, do not touch main; no edits outside the repo except the Drive folder above; no third-party art; no new runtime dependencies; stress or loop pages only in headless Chrome, never the user's Chrome; stop every server you start before a turn ends; if a tool call is denied, do not work around it, note it and continue with other work. Commit in small steps. Add nothing beyond the plan. Finish by printing the commands and outputs above, then stop. If a required check still fails after three genuine attempts to fix it, stop and report exactly what blocks it and which items are missing.
```

## Goal 2: richness, life, time of day, performance (isometric)

```
Build Goal 2 (milestone M2) of docs/pixel-scene-plan.md in /Users/ayu/claude-code-office (branch pixel-scene). Goal 1 is done. Read the plan first and follow it; same constraints as Goal 1 (no push or PR, main untouched, no edits outside the repo except the Drive folder, no third-party art, no new runtime dependencies, stress pages only in headless Chrome, stop servers before a turn ends, do not work around a denied tool call).

Done when ALL of these appear in your own tool output in this conversation:
1. `npm test` exits 0 with the passing count.
2. `node tools/sprites/build-atlas.mjs --proj iso --check` exits 0 and you print a table of plan section 5 minimums versus actual manifest counts per category (seasonal variants excluded), every row met.
3. `node tools/qa/pixel-qa.mjs --proj iso` ends with `QA PASS` and prints checks 1 to 11 of plan section 7, including: occlusion at most 15 percent for every agent at N = 10 and N = 20; label slots hold 5-line, 120-character names without overlap; frame budget and idle numbers; no manifest id matching river|car|road|traffic; and the time-of-day check with the measured luminance ratio of every agent at 06:00, 09:00, 12:00, 18:30, 22:00 and 02:00 (each at least 0.60 of noon) and the measured re-tint cost.
4. Time of day follows the browser's local clock (print the `time.js` unit test: phases, sunrise and sunset by month) and `?time=HH:MM` overrides it; windows, lamps and monitors are lit after dark; a sky gradient follows the time.
5. `?gallery=1` lists every sprite id: print the number shown on the page and the manifest count; they are equal.
6. Ambient animation is limited to small items and runs through the single scheduler (at most 10 fps, nothing while hidden): print the scheduler test output and the measured frames per second with 20 agents.
7. Screenshots in ".../My Drive/Agent Chat/pixel-scene/m2/": garden island, a themed room at zoom 3, 20 agents at fit, a waiting agent with its light, and the same scene at 06:00, 12:00, 18:30 and 22:00; each localhost link returns 200 by curl.
8. Git as in Goal 1 (clean tree, only commits by macbookproiceland@gmail.com, no trailer, nothing pushed); Goal 2 checkboxes ticked; deviations noted in the plan.
Add nothing beyond the plan. Finish by printing the evidence, then stop. If a required check still fails after three genuine attempts to fix it, stop and report exactly what blocks it and what is missing.
```

## Goal 3: front three-quarter, toggle, polish

```
Build Goal 3 (milestone M3) of docs/pixel-scene-plan.md in /Users/ayu/claude-code-office (branch pixel-scene). Goals 1 and 2 are done. Read the plan first; same constraints as Goal 1 (no push or PR, main untouched, no edits outside the repo except the Drive folder, no third-party art, no new runtime dependencies, stress pages only in headless Chrome, stop servers before a turn ends, do not work around a denied tool call).

Done when ALL of these appear in your own tool output in this conversation:
1. `npm test` exits 0 with the passing count, including front-projection tests.
2. `node tools/sprites/build-atlas.mjs --proj front --check` and `--proj iso --check` both exit 0; print both atlas file sizes in bytes (each at most 1,500,000) and sprite counts.
3. `node tools/qa/pixel-qa.mjs --proj iso` and `node tools/qa/pixel-qa.mjs --proj front` both end with `QA PASS` (checks 1 to 11); print both full outputs.
4. The header has a projection toggle; `?proj=front` and `?proj=iso` work; the choice persists across a reload (show the QA or CDP evidence). The layout and scene code do not branch on the projection except through the Projection interface (print the grep that shows it).
5. README documents the pixel scene (features, options, regenerating art with the pinned VoxPix checkout) and THIRD_PARTY.md credits VoxPix (MIT) with the pinned commit; the old 3D scene is still reachable with `?scene=3d` (QA check 8 passes).
6. Final screenshots in ".../My Drive/Agent Chat/pixel-scene/m3/": both projections at 4, 10 and 20 agents and a waiting agent; curl 200 for each link.
7. Git as in Goal 1; Goal 3 checkboxes ticked; deviations noted. Do not push; list the commits and ask the user whether to push.
Add nothing beyond the plan. Finish by printing the evidence, then stop. If a required check still fails after three genuine attempts to fix it, stop and report exactly what blocks it and what is missing.
```

## Goal 4: seasons, weather, settings (both projections)

```
Build Goal 4 (milestone M4) of docs/pixel-scene-plan.md in /Users/ayu/claude-code-office (branch pixel-scene): seasons, weather and settings, in both projections. Goals 1 to 3 are done. Read the plan first, especially the "Time, seasons, weather" decision, section 5 and checks 11 to 14; same constraints as Goal 1 (no push or PR, main untouched, no edits outside the repo except the Drive folder, no third-party art, no new runtime dependencies, stress pages only in headless Chrome, stop servers before a turn ends, do not work around a denied tool call). No network calls from weather code.

Done when ALL of these appear in your own tool output in this conversation:
1. `npm test` exits 0 with the passing count, including: season from date and hemisphere (fake dates, both hemispheres), the same date and season always give the same automatic weather, the settings merge (URL overrides beat stored settings), the particle cap.
2. `node tools/sprites/build-atlas.mjs --proj iso --check` and `--proj front --check` both exit 0; print both atlas sizes in bytes (each at most 2,500,000) and the number of seasonal variants per category (trees, bushes, ground, flower beds, props).
3. `node tools/qa/pixel-qa.mjs --proj iso` and `--proj front` both end with `QA PASS` and print all 14 checks of plan section 7; in particular print, for N = 20, the JavaScript ms per frame with weather off and with rain, snow and fog on (each weather at most 1 ms), the particle counts (at most 120), and proof that nothing runs on the overlay with weather off, while hidden and with reduced motion.
4. Weather is off by default; seasons are automatic by date unless set; the settings popover (projection, time, season, weather, hemisphere) applies changes without a reload and persists them (print the CDP evidence).
5. Delights exist within budget: butterflies and birds by day, petals in spring, fireflies on summer nights, falling leaves in autumn, flakes in winter, a rainbow after rain.
6. Screenshots in ".../My Drive/Agent Chat/pixel-scene/m4/": the four seasons (clear), rain in summer, snow in winter, fog in autumn, each at morning, evening and night, in both projections; every localhost link returns 200 by curl, and a short contact sheet page lists them.
7. Git as in Goal 1; Goal 4 checkboxes ticked; deviations noted.
Add nothing beyond the plan. Finish by printing the evidence, then stop. If a required check still fails after three genuine attempts to fix it, stop and report exactly what blocks it and what is missing.
```

## Goal 5 (later, after Goals 1 to 4 are reviewed): idle shelf and details

```
Build Goal 5 of docs/pixel-scene-plan.md in /Users/ayu/claude-code-office (branch pixel-scene). Goals 1 to 4 are done and reviewed. Read the plan first and follow it; same constraints as Goal 1 (no push or PR, main untouched, no edits outside the repo except the Drive folder, no third-party art, no new runtime dependencies, stress pages only in headless Chrome, stop servers before a turn ends, do not work around a denied tool call). Load check for the user's own disk: the closed-session scan reads only transcript tails, caches by size and mtime, has a count cap and a time budget, and never rereads an unchanged file.

Done when ALL of these appear in your own tool output in this conversation:
1. `npm test` exits 0 with the passing count, including tests for the closed-session listing (sorted by last activity, newest first, stable between refreshes, capped) and for the shelf layout.
2. `node tools/qa/pixel-qa.mjs --proj iso` and `--proj front` both end with `QA PASS`, now also checking: a fixture with 10 live and 12 closed sessions shows the closed ones on the shelf sorted newest first with their full chat names and "closed N min ago"; waiting ("your turn") sessions never appear on the shelf; clicking a shelf entry and clicking a figure in a room both open the details panel for that id; the shelf scrolls on its own and does not overlap the scene or any label.
3. The details panel shows full name, project, status, time since, last prompt and reply, tool mix, an "Open in VS Code" button whose href is vscode://anthropic.claude-code/open?session=<id> and a "Copy session id" button (print the DOM evidence from the QA run).
4. Print the measured scan time and the number of transcript bytes read on a cold and on a warm run with the real ~/.claude/projects (read-only), and show that the warm run reads nothing.
5. Screenshots (scene with shelf, details panel open, both projections) in ".../My Drive/Agent Chat/pixel-scene/m4/", each localhost link returning 200 by curl.
6. Git as in Goal 1 (clean tree, only commits by macbookproiceland@gmail.com, no trailer, nothing pushed); Goal 5 checkboxes ticked; deviations noted.
Add nothing beyond the plan. Finish by printing the evidence, then stop. If a required check still fails after three genuine attempts to fix it, stop and report exactly what blocks it and what is missing.
```
