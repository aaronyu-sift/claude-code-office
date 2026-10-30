# Claude Code Office

**A live dashboard, 3D isometric office and cost tracker for your local Claude Code sessions and subagents.**
See at a glance which terminal is waiting for you, what every agent and subagent is doing right now, and what your usage would cost at API prices. Runs on `localhost`, reads your local Claude Code data read-only, zero dependencies.

[![MIT License](https://img.shields.io/badge/license-MIT-7c6ff0)](LICENSE)
![Node 18+](https://img.shields.io/badge/node-%E2%89%A518-3c873a)
![Zero dependencies](https://img.shields.io/badge/dependencies-0-199e70)
![Local only](https://img.shields.io/badge/data-stays%20on%20your%20machine-fab219)

![Claude Code Office: 3D isometric office where every Claude Code session is a room](docs/screenshots/office.png)

```bash
npx github:azorkai/claude-code-office
```

That's it: the server starts on <http://127.0.0.1:7321> and your browser opens. No API key, no account, no setup.

> Just want to look? Run `npx github:azorkai/claude-code-office --demo` for a fictional, self-running office.

> **About this fork.** This is a fork of [azorkai/claude-code-office](https://github.com/azorkai/claude-code-office) (MIT) with these additions:
> an optional [agent chat bridge](#agent-chat-bridge-optional), optional [Vertex AI pricing](#pricing-like-a-vertex-ai-bill-optional) for the cost tab (and each message id counted once across transcript files),
> the current tool and its description on the avatar tag, an "Open in VS Code" link in the session drawer, English fallback labels for tool events,
> and a [pixel-art Office view](#pixel-office) (isometric and front views, time of day, a sprite gallery) that stays available at `?scene=pixel`; the three.js 3D scene is the default Office view again.
> Run it with `npx github:aaronyu-sift/claude-code-office`. Everything below is the upstream README, extended where the fork differs.

---

## Why

If you run five, ten, fifteen Claude Code terminals at once, you lose track fast:

- *Which session finished and is waiting for my answer?*
- *What are those twelve background subagents actually doing?*
- *How big has that context grown, and how much would all of this cost on the API?*

Claude Code Office answers those questions live, from the data Claude Code already writes to `~/.claude`.

## Features

- **"Your turn" radar.** Sessions that finished and are waiting for you are pulled to the front, highlighted in amber and counted in the header and the tab title; in the Office view the scene marks each one above its agent, so the amber "Your turn" strip under the header is shown in the other views only. An optional chime and desktop notification play when an agent hands the turn back.
- **Pixel-art office** (the default Office view, see [Pixel office](#pixel-office)). Every session is a themed room in a garden in the middle of a landscape of meadows and woods that fills the whole view (no sky, no backdrop, no floating island), drawn from pre-rendered voxel sprites on a 2D canvas, in an isometric or a front three-quarter view.
  - Your full chat name hangs over each lead agent; a thought bubble shows the tool in use; a beam of light and a "!" balloon mark the agent that waits for you.
  - Day and night follow your local clock: the tint of the light, lit windows, lamps and monitors after dark (there is no sun, moon or sky; the light alone tells the time).
  - Only small things move (steam, plants, butterflies, birds), at most 10 frames per second, nothing while the tab is hidden.
  - A shelf card at the right edge (dark glass, like the cards of the Setup Atlas page) lists the chats that have no room: asleep for hours, or closed in the last 14 days, newest first, each as a small sleeping or leaning figure with its full name and "closed 12m ago". The zoom buttons stay fixed in the bottom-right corner, with the card above them. A chat that waits for you never goes there. Click an entry for its details.
- **3D isometric office** (`?scene=3d`, see [3D office](#3d-office)). It is a tycoon-game style building on a little diorama island, with streets, a river, trees and mountains, now drawn with CC0 models from Kenney's furniture, nature and character packs. Every session is a room with its project name on the wall.
  - The offices are coworking spaces (round, oval and long tables, a window bench, a bar with stools, lounge corners and booths), not classrooms: the lead agent and its subagents sit on the seats of the room's arrangement, in lounge chairs, on sofas and benches or on stools, never on an office chair.
  - Monitors glow in the color of the current activity: thinking, shell, reading, editing, web/MCP or delegating.
  - In the 3D office nobody appears or vanishes inside a room: a new chat or subagent is made at the building entrance, walks along the hall, through the room's door and between the furniture to its seat (the route is the one the room's router found for that seat, so it never crosses a table or a chair), sits down facing the table at the height of the seat, and when its job ends it stands up where it sits and walks back out the way it came, to the entrance; the door of an office that has just been vacated opens for it. A job that ends before the walk is over turns around where it stands and leaves, and a person who is wanted again while it walks out goes back along the way it came (a chat that comes back into another office, because its own was taken meanwhile, is led out of the old one by its door first, never across the rooms between). Idle rooms dim, and waiting rooms light up.
  - Street lamps and windows follow your local time of day.
  - The office drops to a low-power mode on machines without GPU acceleration.
- **Dashboard.** Each session card shows the current tool and elapsed time, a 30-minute activity strip, context-window fill, tokens per hour, session cost and live subagents.
- **Timeline.** Swimlanes for every session and subagent over the last 15 minutes to 6 hours. It shows tool calls, thinking spans, waiting time, prompts and compactions, with hover details.
- **Cost tracker.** It converts every assistant message in your transcripts into dollars at API list prices:
  - today, this week, this month and all time
  - daily chart stacked by model, hourly chart for today
  - breakdowns per model and per project
  
  The first scan runs in a worker thread; after that only new bytes are read.
- **Settings tab.** The fifth tab of the header lists every Office setting on one calm page (scene, camera, time of day, season, hemisphere, weather, the shelf size, the project folder on the room boards, what the agent lounge shows) and says where each value comes from: the default, a choice kept in this browser, or the address, which wins and is not stored. It is a second view of the store that the sliders popover edits, so a change in one shows at once in the other and in the scene, without a reload. See [Settings](#settings-tab).
- **A map with floating glass.** In the Office view the map fills the whole page; the header bar, the shelf card, the zoom buttons and the cards float over it in the same dark glass (the look of the Setup Atlas page), so nothing takes a strip of the page away from the scene. The same glass bar floats over Dashboard, Timeline and Cost, whose content scrolls under it. Every animation follows the motion rules of its kind (`docs/motion.md`: tokens in `public/app.css` and `public/js/motion.js`): what moves because of a click or a change in the scene (cards, menus, the camera, things being built) moves on a spring and settles without a jerk, colour and opacity only ease, indicators and scenery such as a flickering lamp follow the clock, clicking the interface never moves the map, and a visitor who asks for reduced motion gets short fades.
- **Card and details card.** In the Office view a click on an agent, or on a shelf entry, opens a glass card next to it (nothing slides in and nothing is dimmed): full name, project, status and time since, what it is doing, model, folder, last request and reply, tool mix and subagents. The **Open** button opens the chat where you last chose to: **VS Code** (the default, `vscode://anthropic.claude-code/open?session=<id>`), **Claude desktop** (`claude://resume?session=<id>`) or **Terminal** (the Claude Code command line, `claude-cli://open?cwd=<folder>&q=/resume <id>`, which types `/resume` into a terminal in the chat's folder but does not send it); its menu also has **Copy command line** (`cd '<folder>' && claude --resume <id>`) and **Copy session id**. The desktop and terminal links need those programs and were not verified by launching them. **All details** opens a second glass card at the right edge of the page (it fades in, nothing slides and nothing is dimmed; the same card the Dashboard and the Timeline open): per-minute tokens, cost and the full event log of a live chat, with the same Open button. Esc or its cross closes it.
- **English and Turkish UI, ready for more.** The page uses your system language when it is supported and otherwise asks you to pick one from a list (each language in its own language); the header button changes it later. A language is one file (see [Languages](#languages)).
- **Local, read-only, zero dependencies.** It binds to `127.0.0.1` only and never writes to `~/.claude`. It has no telemetry and no npm dependencies at runtime.

| Dashboard | Timeline |
|---|---|
| ![Dashboard with session cards, live activity and subagents](docs/screenshots/dashboard.png) | ![Timeline swimlanes for sessions and subagents](docs/screenshots/timeline.png) |
| **Cost** | **Details** |
| ![Cost tracker: daily cost by model, hourly cost, projects](docs/screenshots/cost.png) | ![Session drawer with tool mix and event log](docs/screenshots/drawer.png) |

*All screenshots come from `--demo` mode (fictional projects).*

## Quick start

**One command (Node.js 18+):**

```bash
npx github:azorkai/claude-code-office           # start + open the browser
npx github:azorkai/claude-code-office --demo    # fictional demo office
```

**From source / double-click:**

```bash
git clone https://github.com/aaronyu-sift/claude-code-office.git
cd claude-code-office
npm start            # or double-click start-windows.bat  (macOS/Linux: ./start-macos-linux.sh)
```

**Options:**

| Flag | Default | What it does |
|---|---|---|
| `--port <n>` | `7321` | Port to listen on (always `127.0.0.1`) |
| `--open` / `--no-open` | open | Open the browser after start |
| `--demo` | off | Fictional data; does not read `~/.claude` |
| `--claude-dir <dir>` | `~/.claude` or `$CLAUDE_CONFIG_DIR` | Where Claude Code keeps its data |
| `--data-dir <dir>` | `~/.claude-code-office` | Where the cost cache is stored |
| `--closed-days <n>` | `14` | How far back closed sessions are listed on the shelf (`0` turns the shelf's closed list off) |
| `--closed-max <n>` | `50` | How many closed sessions the shelf lists at most |
| `--chat-db <file>` | off | SQLite message board to show next to the avatars, read-only (or `CCO_CHAT_DB`; see [Agent chat bridge](#agent-chat-bridge-optional)) |

## How it works

| Source | What it gives |
|---|---|
| `~/.claude/sessions/<pid>.json` | Live sessions and whether each one is busy or idle (the process must still be alive) |
| `~/.claude/projects/**/<sessionId>.jsonl` | The transcript: prompts, tool calls and results, token usage, titles, recaps |
| `…/<sessionId>/subagents/agent-*.jsonl` + `.meta.json` | Every subagent's own transcript, type and task description |

The server tails these files once per second. It reads only the last few MB of long transcripts on first start, then only the new bytes. It turns the records into agent states and events, and streams them to the browser over Server-Sent Events. Nothing is uploaded anywhere.

## Settings tab

The **Settings** tab (the fifth tab of the header, key `5`, address `#settings`) lists every Office setting in one page of glass cards, in the order of the popover: **Scene** (3D, the default, or Pixel), **Camera** (pixel scene only), **Time of day**, **Season**, **Hemisphere**, **Weather**, **Chats on the shelf**, **Project folder on room boards** (off by default, with a small sample of a board that shows what the switch changes) and **Agent lounge** (3D scene only, see below). Under each name a small tag says where the value comes from: *Default*, *Saved in this browser*, *This visit only* (a browser that refuses to store settings, such as a private window with storage blocked: the change applies now and is gone at the next load) or *From the address: ?season=winter* (an address option wins over what is saved and is never saved by loading; choosing something else with the controls keeps the address in step and saves the choice). The tab and the popover are two views of one store (`public/js/office-settings.js`, one `createSettingsHub`): a change in either is applied to the scene, kept, and shown in the other at once, and another browser tab's change reaches the page through the `storage` event. The 3D scene reads `project` from that store live (`board-setting.js` is gone).

The **Agent lounge** row (`lounge`, the pavilion on the plaza of the 3D map) is a segmented control in the tab and a select in the popover, *Text* (the default), *Names only* or *Off*, and its line says what each mode puts on the wall: *Text* the posts, *Names only* who talks to whom and in which channel without the text, *Off* a plain pavilion (nothing is fetched). It applies at once and with no reload: the lounge reads the setting on every use and listens for its change (`ofis-lounge.js`), so the wall, the sign, the people and the poll follow, also when the choice is made while the Office view is hidden, and *Off* closes an open card and stops the poll timer at once. The row exists only where there is a lounge: the 3D scene lists it in its rows (`OFFICE3D_ROWS`) and the pixel scene lists its own (`PIXEL_ROWS`, no lounge), so the pixel scene shows no such row in the tab or the popover. The tag under it follows the address like the others (*From the address: ?lounge=names*); `?lounge=demo` is a source, not a mode, so with it the row says *The address shows the demo conversation.* under itself (in the popover's note line too), and a change made with the controls keeps `demo` in the address (`?lounge=demo,names`). The tab groups it with the boards and the shelf (*Boards, shelf and lounge*).

The **scene** is the one setting that does not apply at once: the two scenes are separate engines that each own the Office view, so the choice is saved (`scene` in the settings object, `?scene=` in the address wins and is not saved) and the page says *The Office switches when the page loads again*, with a *Reload now* button (a browser that did not keep the choice says *Not kept* instead, with no button, because a reload would open the scene as before). A last, read-only row, **Agent message board**, reports what `/api/config` says in `chat.state` (`on`: connected, `off`: not enabled, `unsupported`); the server says `on` while it reads the `--chat-db` database, `unsupported` on a Node without `node:sqlite`, and `off` without `--chat-db` or when the file cannot be read (the server log says why); a server that sends nothing shows no row. The header's tabs are a proper tablist (one stop of the Tab key, Left and Right, Home and End move between tabs, `public/js/tabs.js`), and the page fades in like a surface (an eased fade of 200 ms, 150 ms with `prefers-reduced-motion`, nothing slides: [docs/motion.md](docs/motion.md)). At 375 px the tabs take a row of their own and every row stacks; down to 320 px all five tabs stay inside the bar in English and Turkish, and a window narrower than that scrolls the strip to the chosen tab.

`node tools/qa/office-settings-tab-qa.mjs` (`npm run qa:settings-tab`) drives it in headless Chrome: the checks `settings-tab-open`, `-store`, `-scene`, `-project`, `-lounge`, `-keys` and `-narrow`; `--shots <dir>` writes pictures, `--mutations` breaks one line at a time in a copy of the repo and every break must fail the check that guards it. The page has one theme (dark): there is no light mode to test.

## Pixel office

The Office view draws a pixel-art scene: voxel models written as code in [`tools/sprites/`](tools/sprites/) are rendered once into sprite atlases (`public/pixel/atlas-iso.png`, `atlas-front.png`, with `manifest.json`), and the browser draws them on a 2D canvas. No 3D, no runtime dependencies, no build step for the app.

**Options** (URL query, for the Office view):

| Option | Effect |
|---|---|
| `?proj=iso` or `?proj=front` | The view: isometric (default) or front three-quarter. The toggle in the header does the same and the choice is remembered in the browser; the URL wins over the remembered choice. |
| `?time=HH:MM` | Pin the time of day (for example `?time=22:00`) instead of following the browser's local clock. |
| `?season=spring`, `summer`, `autumn` or `winter` | Show that season instead of the one that matches today's date. |
| `?weather=clear`, `cloudy`, `rain`, `snow` or `fog` (also `auto`, `off`) | Turn the weather on. It is off by default; `auto` picks the weather of the day from the date and the season. |
| `?hemisphere=south` | Seasons (and the length of the days) for the southern hemisphere; north is the default. |
| `?shelf=5` (a whole number from 3 to 200) | How many asleep and closed chats the shelf lists at first; 10 is the default. |
| `?project=on` (or `off`) | Show the project folder, small, in the bottom-right corner of every room's board (and on the labels of the agents); off is the default. The chat name is always the big text. Works in the 3D office too. |
| `?lounge=text`, `names` or `off` (and `demo`) | The message lounge in the middle of the 3D office, see [The lounge](#3d-office): `text` (default) shows the wall with the latest posts, `names` only the people, `off` hides it. `?lounge=demo` plays a made-up conversation (no server data needed) and `?lounge=demo,names` combines both; `demo` is never remembered. The same choice is the *Agent lounge* row of the popover and the Settings tab (an address that names it follows the control). |
| `?gallery=1` | List every sprite of the atlas with its id. Add `&proj=front` for the other atlas. |
| `?scene=pixel` | The pixel office. Without it (or with `?scene=3d`) the Office view is the stored choice of the Settings tab, else the three.js office, see [3D office](#3d-office), which has the same card beside an agent, shelf card, zoom buttons, labels and glass bar as the pixel scene. The address wins over the stored choice and is not stored. |

**Time, seasons and weather.** The light follows the browser's local clock: a tint over the rooms and the garden, and lit windows, lamps and monitors after dark; the agents and their labels stay readable at every hour. The seasons follow the date (and the hemisphere): spring blossom, summer green, autumn leaves, winter snow with bare trees, a snowman, pumpkins, a bird bath and a pile of leaves; they are baked into the atlas as `<id>@spring`, `@autumn` and `@winter` sprites (summer is the plain sprite), nothing is recoloured while it runs. The weather is optional and **off by default**: clear, cloudy, rain, snow and fog, or `auto`, which picks a weather for the day from a seeded hash of the date and the season (the same day always gives the same weather; nothing is fetched from anywhere). It lives on one overlay canvas with at most 120 particles, drawn at most 10 times a second, never while the page is hidden, and not at all with `prefers-reduced-motion`; with it on, clear days bring petals in spring, falling leaves in autumn, a few flakes in winter and fireflies on summer nights, and a clear day after rain sometimes has a rainbow. Butterflies and birds by day are part of the garden in every setting.

**Settings.** The sliders button in the header (Office view) opens a small popover: camera, time of day (automatic, or fixed with a slider), season (automatic or fixed), hemisphere, weather, how many chats the shelf shows (5, 10, 20 or 50), the project folder on the boards (a switch) and, in the 3D scene only, what the agent lounge shows (Text, Names only or Off). Changes apply at once without a reload and are remembered in the browser. A URL option beats what is remembered for that visit and is not remembered itself; changing the same setting in the popover while the URL has it also updates the URL. The same settings, and the scene, have a page of their own, see [Settings tab](#settings-tab).

**Room boards.** Every room has a board on top of its back wall with the **chat name** in big letters (up to two lines, then an ellipsis): the plate is drawn on the wall's plane (sheared to its slope in the isometric view, straight in the front view), grows with the zoom like the wall does and never gets smaller than 12 px of type, in a dark acrylic in the project's colour with its colour band. A chat that waits for you carries a chip at the top edge (YOUR TURN or NEEDS ANSWER) and a yellow rim, a room whose subagents do not all fit adds "+N". The **project folder** is the small text in the bottom-right corner of the board, never bigger than the chat name, and shown only when the setting `project` is on (off by default; `?project=on` for a visit, or the stored setting); with it off the labels of the agents drop their project row too. The name is the one the shelf and the labels use (own name, else the AI title, else the folder), written once in `public/js/board-text.js` for both scenes. A board takes no pointer events of its own: a click on it opens the card of the room's main agent, dragging and the wheel still move the map. The labels keep clear of the boards where they can, and a board that a label still touches is not shown (there is room for it at the next zoom). It fades in and out with its room (the 200 ms token), and not at all with `prefers-reduced-motion`.

**Look and controls.** The scene scales in whole-number steps (no blur): `+`, `-`, the mouse wheel and pinch zoom; drag to pan; the fit button or a double click shows everything. The view never leaves the landscape: zooming out stops where the world fills the window and the pan stops at its edge. Click an agent or its label for its card (click empty ground, press Esc or use the cross to close it; it follows the agent while you pan and zoom). Rooms keep their place when agents come and go, and the theme of a room (library, lounge, lab, studio) follows its project.

**The shelf and closed chats.** Chats that have no room are listed in a glass card at the right edge of the Office view. The card floats over the map, which fills the whole page behind it (there is no side column), and "fit" frames the offices in the part that is left free; the zoom buttons stay in the bottom-right corner, the card ends above them (it scrolls on its own, and the `›` button or the `Shelf · N` tab folds it away; the choice is remembered, and it starts folded in a window narrower than 760 px, where an opened card covers most of the scene). The zoom buttons are in the same place with the card folded away or with nothing to list. Two kinds of chat are there, newest first by their last activity or close time: live chats that have been asleep for hours (they leave their room), and closed chats, meaning a transcript written in the last 14 days with no live process. A chat that waits for you, works or has just finished a turn stays in its room. Only the newest ten are listed (the setting "Chats on the shelf", or `?shelf=N`); a footer in the card says "Showing the newest 10 of 37" and its "Show 10 more" button adds ten rows for the rest of the visit (a reload starts again with the setting). A chat beyond the cap is neither on the shelf nor in a room until it is among the newest. A click on an entry or on a figure in a room opens the details panel of that chat.

How the closed list is read, because it runs on your own disk: a project folder is listed again only when its modification time changes; known transcripts are only `stat`ed; only the newest `closedMax` (50) are read, and only the last 256 KB of each; a file whose size and modification time did not change is never read again; one pass stops reading after `closedBudgetMs` (150 ms) and the next pass goes on, newest first. Measured on a real `~/.claude/projects` (129 transcripts in the window, median 1.8 MB, the largest 90 MB): the first scan took 40 ms and read 50 tails, 12.5 MB; the next scans stat the files, take about 0.5 ms and read nothing (`node tools/qa/scan-real.mjs` prints this for your own data and writes nothing). The close time is the moment the server saw the process end, otherwise the file's modification time, because Claude Code appends its bookkeeping records when a chat ends. The counts in a closed chat's tool mix come only from the last 256 KB.

| Setting | Default | Meaning |
|---|---|---|
| `closedDays` (`--closed-days`) | `14` | Window in days; `0` turns the closed list off |
| `closedMax` (`--closed-max`) | `50` | Most closed sessions listed (and read) |
| `closedBudgetMs` (`CCO_CLOSED_BUDGET_MS`) | `150` | Time one pass may spend reading transcripts |
| `closedEveryMs` (`CCO_CLOSED_EVERY_MS`) | `30000` | How often the list is looked at again (at least 250) |

The four settings are keys of the config file (see [Configuration](#configuration-optional)) or options of `createOffice`; `/api/closed` returns the list and the scan statistics.

**Regenerating the art.** The atlases are committed, so this is only needed after changing a model. You need [bun](https://bun.sh) and the pinned VoxPix renderer (MIT, see [THIRD_PARTY.md](THIRD_PARTY.md)):

```bash
git clone https://github.com/andyeswong/voxpix .tools/voxpix && git -C .tools/voxpix checkout c8e9843   # pinned, git-ignored
node tools/sprites/build-atlas.mjs --proj iso       # writes public/pixel/atlas-iso.png, manifest.json, public/js/pixel/footprints.js
node tools/sprites/build-atlas.mjs --proj front
node tools/sprites/build-atlas.mjs --proj iso --check    # fails if the committed files differ from a fresh render (also --proj front)
npm run sprites:table                                # the content lists of the plan against the manifest
```

The models are in `tools/sprites/` (`models.mjs`, `props.mjs`, `decor.mjs`; `catalog.mjs` lists every sprite; `seasons.mjs` makes the seasonal variants out of the same models with another palette, snow caps, bare branches and the four seasonal props); [`tools/sprites/README.md`](tools/sprites/README.md) has the details.

**The 3D scene** (`?scene=3d`) has the same floating interface as the pixel scene, built from the same modules (`public/js/office-ui.js` with `pixel/card.js`, `pixel/cardplace.js`, `pixel/open-menu.js`, `pixel/shelf-view.js` and `motion.js`; `public/js/ofis-ui.js` ties them to its camera): a click on an agent or its label opens the glass card beside that agent, anchored to the agent's place on the screen and following it through pan and zoom, with the same ring under the agent; the shelf card with its cap and footer, the zoom buttons, "All details" and the glass bar over a scene that fills the whole window work as described above, and a chat that is asleep leaves its room here too and goes to the shelf. The rows of the shelf draw a round avatar in the project's colour ("Zz" for an asleep chat, a check mark for a closed one) instead of a pixel sprite. The projection toggle and the time, season and weather settings belong to the pixel scene and are hidden here; `?shelf=N` and the stored shelf setting apply.

*Labels in the 3D scene.* Every agent has the label of the pixel scene, built by one pure module for both scenes (`public/js/office-labels.js`): a main agent shows its project (with the your-turn chip and its running time when it waits for you), the chat name, what it does and what it just said; a sub-agent shows its short description and, while it works, what it does ("Tool · what it works on"; with nothing to show it thinks, its thought). The 3D scene asks for that line on sub-agents; the pixel scene's sub-agent labels stay one line. `public/js/ofis-label-layout.js` places them with the pixel scene's declutter (`pixel/labels.js`): a label may move to a free spot near its agent, a main agent's label is never hidden (it takes the nearest free spot, also when the card covers its own), a sub-agent's label is shown only within 70 px of its agent, balloons keep their place, and no label is drawn under the card, the shelf card or the zoom buttons. The HTML sign for the far zoom of the 3D scene is not shown while the label of its main agent is.

`npm run qa:3d-ui` checks the interface in headless Chrome with software WebGL (`3d-card`, `3d-shelf`, `3d-motion`, `3d-bar`, `3d-labels`; `--only <name>` runs one, `--shots <dir>` writes pictures).

**Tests.** `npm test` runs the unit tests (projections, layout in both views, depth order, labels, scheduler, time of day, seasons, weather, settings, languages, shelf, closed-chat scan, manifest). `node tools/qa/pixel-qa.mjs --proj iso` (or `--proj front`) starts the server against a fake `~/.claude`, drives headless Chrome in a throw-away profile and prints one `CHECK … PASS|FAIL` line per check (occlusion, click targets, labels, frame budget, idle, time of day, seasons, weather, settings, gallery, projection toggle, the shelf, its Atlas-card style and its cap, the details panel, the scan of closed chats) and a final `QA PASS` or `QA FAIL`. The checks run in one fixed season (`--season summer` by default, `--season auto` follows the date) so the date they run on does not matter. `--shots <dir> --set m4` also writes the screenshots of the seasons, the weather and the times of day, and `--set m5` those of the shelf and the details panel. The shelf checks use a fixture with 10 live and 12 closed chats (`?shelf=200`, so that every chat has a row; the cap has its own check with 36 closed chats) and a second, 300-transcript fixture for the scan (cap, budget, cold and warm reads). The plan, its decisions and the deviations are in [docs/pixel-scene-plan.md](docs/pixel-scene-plan.md).

## 3D office

The three.js office is the default Office view (`?scene=3d` names it, `?scene=pixel` opens the pixel office instead): a building of rooms on a diorama island. Its furniture, trees, rocks and people are glTF models from three [Kenney](https://kenney.nl) packs (CC0, listed in [THIRD_PARTY.md](THIRD_PARTY.md), about 1.5 MB in [`public/models/`](public/models/)), recoloured in code to the scene's own palette, baked into the room's single mesh, and given occlusion shading, a mottled floor, tone mapping and contact shadows by `public/js/ofis-polish.js`. Each agent's colour is on its person's top; the chief wears the headset and waves when it is your turn.

*Every office is a coworking space, and it is the slot's own.* An office is a **work part** and a **soft part** in one room (`public/js/ofis-arrange.js`, pure and tested): the work part is one of eight arrangements (a long communal trestle, three round tables, an oval, a bench along the window wall, a kidney of three curved slabs, an L-shaped desk, four angled pods, a bar with stools) and the soft part one of three (a corner of sofas and chairs round a coffee table and a rug, a ring of lounge chairs round a round table, booths of two benches round a table). Every seat is a lounge chair, a sofa, a bench cushion or a stool, so there is no office chair anywhere (the chair model is not in the models folder). Each office has 13 seats (the chat's own and 12 for its sub-agents) from the first frame; the room's class only says how many are in use. A router (`public/js/ofis-geom.js`) walks every seat from the door, so a seat nobody can reach stays furniture and every walk keeps clear of every table, chair and prop. People sit facing their table, at the height of the seat, leaning to the screen at a desk, back into a sofa, over the table on a stool (`seatPose` in `ofis-rig.js`).

Which look an office has belongs to its **slot**, not to the chat or the folder: `looksAll` hands every slot a style (study, lab, garden, library, studio or cafe: its own floor, wall colours, wall pieces, props and accents), a colour theme, a work arrangement and a soft arrangement, in slot order, so that no two neighbouring offices share a style, a theme or a work arrangement and no two offices read the same until all 144 looks are used. A chat taking a slot finds the room as it was, and it is the same room when the chat leaves. Every office has a window and lamps, and often candles, string bulbs, a wall light or a screen. `public/js/ofis-decor.js` draws the plan and keeps the light of the lamps and windows in three instanced meshes (three draw calls for the whole building, no real light): by day a lamp is dim and a window shows the sky, at night the lamps and candles glow and the panes turn warm, at the scene's own constant rate. The sources flicker a little (a candle plus or minus 7 percent, a lamp about 3 percent, each with a phase of its own) and are steady with `prefers-reduced-motion`. The **lights follow the people**, not the data (`public/js/ofis-presence.js`, a pure rule with unit tests in `test/ofis-presence.test.mjs`; `lightsFor` in `ofis.js` asks it once per frame, after the walkers have moved): an office is lit while somebody is inside its floor box, and one a chat has taken stays dark (furnished as a vacant one, with the chat's name on its sign) until the first person of that chat is through the door, then it eases on over a fraction of a second (the feedback kind of [docs/motion.md](docs/motion.md)) and stays on for as long as the chat has the office, whoever stands up or leaves; when the chat closes, the office stays lit until the last person has left it and for one second of the scene's clock more (the hold, so that a gap between one person leaving and the next coming in does not blink the room; it is the same with reduced motion), then it eases off. A dark office has its lamps and candles dark, no flicker and the windows the night sky (by day nothing differs). A job that turns back before the door never lights anything; one that turns back after its chief has crossed lights the office while the chief is inside and for the hold after it is out, and then darkens it (a flash of about 2 s for a turn-back 0.4 m inside the door). A rebuild throws no switch of its own: the next frame's pass reads the same rule from where the people stand, so it neither lights an office whose chief is still outside nor darkens one with somebody in it. The lounge's people are never in an office, so they light none. `npm run qa:3d-life` checks the lamps, windows and flicker in headless Chrome, and `npm run qa:3d-cowork` the arrangements, looks, seats, walks and the slot's lights (19 mutations; `3d-cowork-slot` reads one office's light against its chat's chief, frame by frame, the hold on the scene's clock; the ease of the light is a unit test with a clock of its own, `test/ofis-decor-light.test.mjs`, because the page cannot know when its first frame after a rebuild draws); `--mutations` breaks lines to prove they can fail. The pictures are in the Drive folder `Agent Chat/pixel-scene/m10/rooms`.

**Walking (3D).** Nobody appears or vanishes inside an office. `public/js/ofis-arrive.js` is the pure timeline (unit tests in `test/ofis-arrive.test.mjs`) and `ofis.js` draws it. A person is made at the building entrance and follows the route its seat has (`pathFor` in `ofis.js`: the entrance, the hall's lane, the office's door, a point just outside the door, the seat's approach points that keep clear of the furniture, and the seat itself) at 2.2 units a second times a pace of its own, with a small bounce of the step and a stagger of 0.35 s (never under 0.25 s in a hurried queue) between people who leave the entrance one after the other. It sits down facing as its seat does (a lounge chair, a sofa, a bench or a stool, with its own hip height), and when its job ends it stands up where it sits and walks the same route back out, to the entrance, where it is removed; a sub-agent that is done stays on its seat for 4.5 s first. The door of an office is a real hinged door while someone walks through it, and the door of an office that has just been vacated opens for the person still walking out of it (for that build only, the shut door comes back at the next one). Three things change a walk that is under way, and each keeps the rule that a route never crosses furniture: a job that ends before the seat turns round and takes the way it came in from where it stands; a person who is wanted again (at its own seat or at another one) while it walks out goes back along the old route to the last point it shares with the new one and on along the new one (`rejoin`, `leadOut`), never in a straight line to the nearest point; a chat that comes back into another office (its own was taken by another chat while the person walked out) shares no point of a route inside a room with it, so the person leaves the old office by its door and, in the same hall, goes along the hall's lane to the new door and in, or, into another hall, out to the entrance, along the front of the building to the other entrance and in along the new route (never through a wall, a table or the lounge, and it is one person all the way: nobody is removed and made again); and a rebuild (a chat added and the building grown, which moves the entrance) keeps everybody walking and moves each route to the entrance of today (`rebaseRoute`). The lights follow the walkers: the office of a chat that has just taken it stays dark until its first person crosses the door (in software GL that is 15 to 28 s after the chat appears), it eases on there, and when the chat closes it stays lit until the last person has walked out of it and for a second of the scene's clock more, then eases off; a chat that is back in another office lights the new one at its door and darkens the old one a second after its person is out of it (the paragraph on lights above). `&arrive=calm` (above) keeps the normal pace on a page load, `prefers-reduced-motion` keeps the pace and drops the bounce, and the QA hook `settle()` ends every walk at once (the app never calls it). The checks are `npm run qa:3d-walk` (see below).

| Option | Effect |
|---|---|
| `?scene=pixel` | The pixel office instead of the 3D office (the default). |
| `&assets=procedural` | Draw every piece from the built-in boxes and spheres, load no model file. It is also what a piece falls back to when its file is blocked, slow (10 s) or broken: the browser console says so once for that piece and the scene goes on. |
| `&polish=off` | No occlusion shading, mottled floor, tone mapping, contact shadows or extra detail on the built-in pieces. With `assets=procedural` this is the scene as it was before the models. |
| `&time=HH:MM` (also `&hour=21` or `&hour=21.5`) | Pin the time of day instead of following the browser's clock, for example `&time=21:30`. |
| `&season=`, `&weather=`, `&hemisphere=`, `&shelf=` | The same options and values as in the pixel office (table above). In the 3D office the season changes the colours of the trees and the grass, and `&weather=` draws the weather over the scene; `&shelf=` is read and remembered for the shelf. |
| `&env=0` | Leave the surroundings out (and with them the time of day and the weather's light). |
| `&arrive=calm` | A page load, a scene switch or a rebuilt building sends everybody who is already in the data in through the entrance one after the other, about 0.35 s apart. With more than four of them the walk is sped up (at most three times) so that all are seated within about 10 s; `&arrive=calm` keeps the normal pace for everybody instead. A chat that starts while the page is open always walks at the normal pace. |
| `&rooms=6` | How many chats the building is laid out for (2 to 60, default 10, `MIN_ROOMS` in [`public/js/ofis-layout.js`](public/js/ofis-layout.js)). |
| `&project=on` | The small project folder in the bottom-right corner of each room's wall plaque and sign (see **Room boards** above). The plaque's big text is the chat name. |

**The map stays put.** The building is laid out for 10 chats from the first frame: two rows of five offices with a hall between them, and an office nobody uses is a vacant office: exactly the room a chat gets (the same walls, floor, door, furniture and look: nothing moves or changes when a chat takes it) with a grey "Vacant" sign, the lights off (they stay on only while somebody is still walking out of it, and for a second after) and nobody in it. It costs the same as an office with a chat minus the people and the overlays (about 6 to 8k triangles each; the closed door of a vacant office is boxes in the batch), and it adds no draw calls of its own: one static batch, one shared sign mesh and one merged floor per floor pattern. The building as it is used (3 chats, 8 vacant) takes about 146k triangles and 69 draw calls in software GL, 160k triangles and 164 calls with 10 chats. A chat takes the lowest free office and keeps it until it closes or falls asleep (an asleep chat is on the shelf and its office is free); it gets its old office back on waking if it is still free. The offices are remembered in the browser (`localStorage`), so a reload puts every chat back where it was; without that memory the oldest chat takes the first office. Every office is a fixed cell with the seats of the largest class and is built the same way whatever the chat does, so a chat with up to 12 sub-agents never changes its room: its class (3, 6 or 12 seats in use) only decides how many sub-agent seats are used (more than 12 show as "+N" on the sign). Nothing moves, grows or refits the view while there are 10 chats or fewer. Only an 11th chat expands the building: a whole row of five offices is appended after the last row (the first ten offices keep their rectangles, their chats and their people, even those still walking in) and the view refits once; the row goes away again after a minute with no chat in it. The decisions are pure functions in `public/js/ofis-layout.js` (tests in `test/ofis-layout.test.mjs`), `ofis.js` draws them.

**The lounge (3D).** The hub of the X, the plaza in the middle, is an open pavilion with sofas, armchairs, a counter, lamps and a freestanding **message wall**, a picture of the agent message board: the last 8 posts, the newest at the bottom, each with a channel chip, "from to to", its text cut to 90 characters on one or two lines and its age. The wall is a close-up surface: its text is about 0.1 m tall on a 6.4 m wall, so it reads from about four times the fit zoom (100 px per metre) and is a dark panel at the default view; the **sign** over it (a pill that stays the same size at every zoom) carries the newest post, who and 60 characters of its text (only the names with `?lounge=names`), and the card has the last 20. The agents that posted in the last 10 minutes (at most 6) sit or stand around it as people of the same kind as the Office's own; one that posted in the last 20 seconds talks with its hands, and one whose chat is in the Office is the same person's colour and a click on it opens that agent's card. A board agent that is not an Office chat shows as a named person only. Posts in the last minute make a strip of light under the wall pulse (it follows the clock, more posts make it brighter and at night it is stronger), a new post fades in over 450 ms, and with `prefers-reduced-motion` nothing moves but the text (the strip stays on at a steady brightness). A click on the wall or the lounge, or Enter on its sign, opens a glass card with the last 20 posts (channel, from, to, age; scrolls) and a line saying where the data comes from; Esc closes it. The data comes from `GET /api/lounge`, a read-only view of the chat bridge (one request every 3 seconds, only while the page is visible and the lounge is on the screen; a server without that endpoint gives a 404 and the wall says "Agent message board is off" and names `--chat-db`; a board in a format it does not know says "Message board format not recognised"; nothing in the last hour says "No posts in the last hour"; a server that has the endpoint but answers with an error, a timeout or something that is not JSON is not off: the wall says "Message board not answering", and with posts in hand it keeps them for the first 10 seconds as they were and then dims them under "Old posts: last answer 2m ago", never claiming a live feed). Text is cleaned of control and direction characters, cut by characters and drawn into a canvas, never put into the page as HTML. `?lounge=text|names|off` (or the setting `lounge`, the *Agent lounge* row of the popover and the Settings tab, which applies at once) chooses what to show and `?lounge=demo` plays a made-up conversation without any server. Cost: the furniture is part of the building's one batch (no draw call, about 2.4k triangles); the wall's face and the light strip are 2 draw calls and only while the board has something to show, and each person is 3 draw calls and about 730 triangles (at most 6 people). The whole-building limits of `qa:3d` (`3d-budget`, `3d-vacant`) run with no endpoint, so the board is off and nobody is in the lounge: a live board adds at most 22 draw calls and 13,400 triangles on top (4 and 8,000 for the pavilion, 6 people at 3 and 900), which the lounge QA bounds (the review measured about 198 draw calls and 200,700 triangles with 10 chats, 15 figures and 6 people at the fit zoom, against the 190 and 215,000 of `3d-budget` with the board off). A person who leaves frees the bone texture of its skeleton (`removeChar` disposes it), so the GPU textures do not grow as posters come and go. The pure parts are `lounge-model.js` (what the wall, the people and the signs say), `lounge-plan.js` (where everything stands), `lounge-paint.js` (the picture), `lounge-source.js` (the poll and the demo) and `lounge-card.js`; `ofis-lounge.js` puts them into the scene.

**Time, season and weather (3D).** The sliders button in the header opens the same popover as in the pixel office, with the rows this scene supports: time of day, season, hemisphere, weather and the shelf size (there is no camera row, the camera of this scene is fixed). A choice is applied at once, remembered in the browser under the same keys as the pixel office (so it carries over when you switch scenes), and beaten by an address option for that visit. The light follows the browser's clock (or the time you fix): windows, street lamps and glow pools come on, and the sun and the sky get dimmer and cooler, between dusk and dawn; the month moves sunrise and sunset and the hemisphere turns the months round (the sunrise table is the pixel office's: `public/js/pixel/time.js`, `season.js`). The light never jumps: a time or weather you choose by hand moves the light at a constant rate (4 s for a full change, `CYCLE.turn` in `public/js/motion.js`), the real clock a little every minute. The weather is **off by default**; it is the pixel office's weather (`public/js/pixel/weather.js`: rain, snow, fog, clouds, petals, leaves, flakes, fireflies, a rainbow) drawn on a 2D canvas over the 3D canvas, at most 120 particles, at most 10 frames a second, nothing while the page or the Office view is hidden, and nothing with `prefers-reduced-motion`; it adds no WebGL draw call. Rain, snow, fog and cloud also take some light from the sun and the sky. The seasons are palette swaps (`SEASON_PALETTES` in `public/js/ofis-rig.js`): the leaves of the round trees, the pines, the grass, the lip of the island and the hills take the colours of spring (blossom), summer (the usual look), autumn or winter (frost), the automatic season follows the month and the hemisphere, and the island is rebuilt in the new colours with the same trees in the same places; nothing is added, so there is no snow on the ground and no seasonal prop. Nothing is fetched from anywhere.

The server lets the browser keep `/models` for an hour (an ETag after that); nothing else is cached. `node tools/models/strip-glb.mjs <file.glb>` removes the animation clips and unread attributes from a character file (the shipped ones went through it). `npm run qa:board` reads the wall plaques pixel by pixel and checks the pixel boards in the page (name bigger than the project, the project absent by default, bottom-right when on, inside the view and clear of every label, a click opens the card, only a fade, the setting stored and overridden by the address; `--mutations` breaks eight lines in a copy of the repo and every one must fail a check; `--shots <dir>` writes the pictures). `npm run qa:3d-walk` (`tools/qa/office3d-walk-qa.mjs`, headless Chrome, one check at a time with `--only load|calm|brief|leave|flap|rebuild|growout|seats|turnback|reseat|readmit|hidden|follow|settle|reduced|lights`, and `--only lights --part main|readmit|load|reduced|handover` for one scene of the lights, `--root <a copy of the repo>` for any check against that copy) covers the walkers (`public/js/ofis-arrive.js`, unit tests in `test/ofis-arrive.test.mjs`): the first frame of every figure is at the entrance and never inside a room, a job that ends within a couple of seconds turns round and is removed at the entrance without ever being seen at its seat, a seated chat that ends stands up and walks out, nobody teleports (a step is never longer than speed times the frame's step times 1.5) across arrivals, departures, a growth rebuild and a reload, no figure, label, balloon or seat is left twice or stuck, the label, balloon, tooltip and card follow a walking figure while the camera stays, ten chats on a page load are all seated within about 10 s, sub-agents that arrive over three polls leave the entrance a stagger apart and never walk through each other, a chat that closes while the building grows walks out to the entrance of today, every figure sits on the seat its room has (the room's own geometry, not just where its own route ends), the doors open for sub-agents as well as chiefs, and `settle()` (a QA hook the app never calls) ends every walk at once. The three checks that came with the coworking rooms follow the furniture: `3d-walk-seats` (a chat with 12 sub-agents in an office with desks, lounge seats and stools: all 13 walk in and sit on their own seat, every reading inside the office keeps 0.2 m from the furniture, each ends facing as its seat does with its hip at that seat's cushion, a job that ends on each kind of seat while the chat goes on and the chat that closes after it: all stand up on the spot where they sit and walk out clear of the furniture), `3d-walk-turnback` (twelve jobs and a chat that end while the person is inside the office, each a little deeper in: the walk back is the way it came, clear of the furniture) and `3d-walk-reseat` (a person walking out of its seat is wanted again at another seat: it goes back along the way out and in along the route of that seat, not straight through the table). A fourth, `3d-walk-readmit`, came with the review of the merge (a chat closes, another takes its office while its chief walks out, and the chat is back in another one: in one hall from inside the office, in another hall from the lane and from inside the office, with a sub-agent left to leave, a further chat or a sleeping chat making a second rebuild, and the door of the office that is vacant again; every reading of the chief is in the old office, outside or in the new one, never in another office or the lounge, it crosses their walls only at their doors, keeps 0.2 m from the furniture, is never removed or made again and ends on its new seat). A fifth, `3d-walk-lights`, reads the light of every office against every person of the scene, frame by frame, with a model of the rule of its own: arrival (dark until the chief is through the door, lit in the frame it crosses), a chat with three sub-agents that closes (lit while anybody is inside and for the hold of one second of the scene's clock after the last has left, then dark), a brief job and a job that ends 0.3 to 0.9 m before its door (never lit), two jobs that end 0.4 m and 1 m inside the door (lit while the chief is inside and for the hold after it is out, then dark), a rebuild during a walk-in and during a walk-out, a chat that is back in another office (the old one lit while its chief and a sub-agent are inside, dark for the gap, the new one lit at its door), ten chats on a page load (every office dark in the first frame and for the 5 to 10 s the chiefs need to reach their doors, then each lit in the frame its own chief crosses: a hurried queue sends the longest walks first, so the chiefs cross within about 3 s of one another and several offices can light in one frame), `prefers-reduced-motion` with the demo lounge (the light is a step, the lounge's people never at an office), and a handover (a chat closes and another takes the same office a moment later, over gaps of -0.8 to 3 s between the old chief leaving and the new one coming in: a gap shorter than the hold never reaches the switch, a longer one leaves a dark of the gap less the hold); the number must reach the switch within the 200 ms ease and only move toward it, the switch may not go off before the hold is over nor stay on after it, and two switches of one office are never closer than the hold but for the handover. Four guards that no check had came with it: the chief's screen stays dark until the chief has sat (`load`), a figure waiting at the entrance cannot be hovered (`rebuild`), the balloon of an agent that is gone is switched off (`leave`), a person walking out whose chat is back takes the seat it left (`flap`); `3d-walk-turnback` now also reads that the way back is the way it came, point by point (0.05 m). `--mutations` breaks 61 lines in a copy of the repo (four of them also run the unit tests of the rule) and every one must fail a check, `--verify-mutations` only checks that those lines are still in the code. `npm run qa:3d-life` (`tools/qa/office3d-life-qa.mjs`, one check, `3d-room-life`) covers the styles, windows, lamps and flicker described under [3D office](#3d-office), and `npm run qa:3d-cowork` (`tools/qa/office3d-cowork-qa.mjs`, `--only arrangements|looks|no-chair|paths|seats|folder|slot`) the coworking offices: every arrangement drawn in a building of 21 offices, looks that do not repeat, no office chair, walks that keep 0.2 m from the furniture, people on their seats, four chats of one folder with four looks, a slot that keeps its room and whose light follows its chat's chief (dark until the chief is inside, lit while the chief walks out of the vacated office and for the hold after it). `npm run qa:3d-lounge` (`tools/qa/office3d-lounge-qa.mjs`, one check, `lounge`) covers the [lounge](#3d-office) in five scenes: a server without `/api/lounge` (the 404 is the only expected console line, no request after it, the wall's face is not drawn, 0 draw calls), a churn of 100 people through the lounge (the GPU textures must stay at their baseline), a stubbed endpoint with hostile text (30 posts, 9 posters, clean text on the canvas read from `fillText`, markup in posts and names that must stay text in the card, the sign and the labels, the card's 20 posts, ties to the Office's chats, one request every 3 seconds, a repaint only when the model changes, the board that never answers, the quiet board that stops answering, the posts that turn old and dim, and the unsupported, quiet, 500 and garbage answers), `prefers-reduced-motion`, and the demo (cost against the 4 draw calls and 8,000 triangles of the budget, with the triangles counted by the building around the lounge's build and not by the lounge, at most 3 draw calls and 900 triangles a person, the fade of a new post sampled frame by frame against 450 ms, the poll stopping when the tab is hidden or the lounge is panned off the screen, the settings, click, Esc and the keyboard); `--mutations` breaks 33 lines in a copy of the repo and every one must fail, `--shots <dir>` writes pictures. `npm run qa:3d` drives headless Chrome with software WebGL over the 3D scene: `3d-boot` (not blank, no errors, every model 200, nothing leaves localhost), `3d-fallback` (blocked, corrupt and empty model files), `3d-budget` (draw calls, triangles, size of the models and the rebuild time at 10 agents), `3d-agents` (every agent has a person and its colour shows), `3d-stable-layout` (3, 7 and 10 chats open, others close, sleep and wake: no office changes its rectangle, no chat its slot, no seated person its place, no refit of the view) and `3d-expand` (a chat whose sub-agents outgrow its 6 seats grows its class in its own cell and nothing else changes; the 11th chat appends a row and the first ten offices stay) and `3d-vacant` (the building as it is used stays inside its budget, and the same slot vacant and with a chat, its chief seated, draws the same furniture with the lights as the only difference); `--mutations` breaks one line at a time in a copy of the repo and expects the matching check to fail. `npm run qa:3d-env` (`tools/qa/office3d-env-qa.mjs`, same harness, one check at a time with `--only settings|time|weather|season`) covers the settings and the atmosphere: `3d-settings` (the popover and its rows for this scene, choices remembered and shared with the pixel office, the address options and `?hour=`), `3d-time` (03:00 against 13:00, the eased change sampled frame by frame, dawn and dusk by month and hemisphere), `3d-weather` (off by default, at most 120 particles and 10 frames a second, nothing hidden or with reduced motion, draw calls and frame time unchanged, the rainbow, no request leaves) and `3d-season` (four seasons, four colours of trees and grass, nothing moves); it has its own `--mutations`.

## Languages

The UI is in English and Turkish today. The page chooses its language in this order:

1. The language you picked before (kept in the browser, `localStorage['cco.lang']`).
2. Your system language: the first language your browser lists (`navigator.languages[0]`). `tr-TR` gives Turkish, `en-GB` gives English.
3. If that language is not supported, the page opens a list of the supported languages over the English UI, each written in its own language ("English", "Türkçe"). Esc does not close it. Choosing a language saves the choice and reloads the page.

The language button in the header (`EN`, `TR`) opens the same list at any time; there Esc, a click outside or Close dismiss it. Only the first language your browser lists counts: a visitor whose first language is German and second is English is asked, because a second place in a ranking is not a choice.

**Adding a language.** Copy `public/js/lang/en.js` to `public/js/lang/<code>.js`, fill in `code`, `name` (the language's own name, as its speakers write it), `locale` (for example `de-DE`) and `chooseTitle` ("Choose your language" in that language), and translate `messages`. Then add the file to the list in `public/js/lang/index.js`. Nothing else changes: the detection, the list, number formats (decimal separator, place of the percent sign), plural rules and sort order come from the browser's `Intl` for the `locale`. The server writes a few fixed labels in Turkish; English's `server` map translates them for any other language, and a language can bring its own. `npm test` fails until every English key is translated and the name is really in that language, so a language is never listed half done. Not covered: right-to-left layout.

## About the cost numbers

The cost view shows what your token usage **would cost at Anthropic API list prices**. If you use Claude Code with a Pro/Max subscription, this is **not your bill**. It is a way to see how heavy your usage is and where it goes.

- Every assistant message's `usage` is priced as input + output + cache writes (5 min = 1.25× input, 1 h = 2× input) + cache reads, per model.
- Messages are de-duplicated by message id across all transcript files, so streamed records are not double-counted, and neither is the history that a resumed or forked chat copies into a new file.
- Transcripts that Claude Code has already deleted cannot be counted, so totals start at your oldest transcript.
- Prices are in [`cost-worker.js`](cost-worker.js); update them there if Anthropic changes its pricing.
- Using Claude Code through Google Vertex AI? Its prices and discounts differ, see [Pricing like a Vertex AI bill](#pricing-like-a-vertex-ai-bill-optional).

## Configuration (optional)

Create `~/.claude-code-office/config.json`, or `config.local.json` next to `server.js`. Both are git-ignored.

```json
{
  "port": 7321,
  "open": true,
  "dataDir": "~/.claude-code-office",
  "projectColors": { "my-app": "#5B9BD5", "api": "#E08A6E" },
  "projectColorsFile": "~/project-colors.json",
  "cswapUrl": "http://127.0.0.1:7317/api"
}
```

`cswapUrl` is optional. It points to a local endpoint that reports per-account 5-hour/7-day usage, and the header shows it as small bars. Leave it out if you do not have one.

The fork adds four more optional keys: `chatDb` (same as `--chat-db`), `costPrices`, `costDiscount` and `costExtraLogs`, described next.

## Pricing like a Vertex AI bill (optional)

Claude Code on Google Vertex AI records token counts but no cost, and Vertex prices differ from the Anthropic API: cache reads and writes are priced per model, some models have a long-context tier, and an organisation may have a discount. Three config keys turn the cost tab into a Vertex-style estimate. With none of them set it prices at Anthropic API list prices, as before.

```json
{
  "costPrices": "~/vertex-claude-prices.json",
  "costDiscount": 0.168,
  "costExtraLogs": [{ "file": "~/review-hook.log.jsonl", "key": "cost_usd" }]
}
```

**`costPrices`** is a JSON file you provide, with the values from [Google's Vertex AI pricing page](https://cloud.google.com/vertex-ai/generative-ai/pricing):

```json
{
  "fetched": 1793220902,
  "prices": {
    "claude-sonnet-5-5": { "low": [2, 10, 2.5, 4, 0.1], "high": null, "threshold": 200000 },
    "claude-sonnet-4-5": { "low": [3, 15, 3.75, 6, 0.3], "high": [6, 22.5, 7.5, 12, 0.6], "threshold": 200000 }
  }
}
```

- Each array is USD per million tokens in the order input, output, cache write (5 min), cache write (1 h), cache read.
- `high` applies to a message whose prompt (input + cache read + cache writes) reaches `threshold` tokens; `null` means one price.
- A model id such as `claude-haiku-4-5-20251001` uses the longest key it starts with, here `claude-haiku-4-5`. A few models are built in as a fallback; a model with no price counts as $0 and is listed under `unpriced` in `/api/cost`.
- `fetched` (epoch seconds) is shown as "as of" in the Cost tab, which warns when the file is more than a week old. The file is re-read when it changes, and a different table makes the worker read every transcript again, because the dollar figures are cached per message.
- The API-only extras (fast-mode multiplier, web-search fee) are not applied in this mode.

**`costDiscount`** is a fraction off list price, applied to every figure (`0.168` is 16.8%).

**`costExtraLogs`** lists JSON-lines logs of model calls that leave no transcript, for example a hook that runs `claude -p --no-session-persistence`. Each line is `{ "ts": "<ISO time>", "<key>": <usd> }`. Those calls are counted as the model `hooks` and the project `hooks (claude -p)`, with the discount applied.

The Cost tab prints which prices, date, discount and extra calls its figures use. Not counted: aborted streams and calls that leave neither a transcript nor a log.

## Agent chat bridge (optional)

If your agents talk to each other through a local SQLite message board, the office can show it: each new message becomes an `AgentChat` event in the sender's room and in every recipient's room (drawer event log and timeline), and the newest line sits next to the avatar for 30 seconds (`→` sent, `←` received). On start the last 6 hours are replayed, at most 60 messages.

```bash
node server.js --chat-db ~/chat.db      # or CCO_CHAT_DB=~/chat.db, or "chatDb" in the config file
```

The database is read through `chat-source.js` ([docs/chat-source.md](docs/chat-source.md)), which opens it read-only with Node's built-in [`node:sqlite`](https://nodejs.org/api/sqlite.html) (Node 22.13 or newer; on an older Node the bridge stays off and logs one line). Nothing is ever written to it, and it is asked by `seq` only, at most every 2 seconds and not at all while the file is unchanged. The reader uses a short contract and ignores everything else in the file, so it keeps working when the chat is upgraded:

| Table | Columns it uses |
|---|---|
| `messages` | `seq` (increasing integer, the primary key or indexed), `ts_ms` (epoch milliseconds), `channel`, `author`, `to_list` (comma-separated recipient names, empty for a channel post), `body`, `human` |
| `agents` | `name`, `kind`, `last_seen_ms` |
| `agent_keys` | `key` (`session:<Claude Code session id>`), `agent` (the board's name for that agent) |
| `meta` | `k`, `v` (the row `schema_version` is shown on the Settings tab) |

A board agent is matched to a session through `agent_keys`; without a row, to the session whose id, name or project equals the agent's name. A database that misses part of the contract is reported as `unsupported` with a one-line reason, a missing file as `off`; `GET /api/config` has `chat: { state, schema }` and `GET /api/lounge` the recent board (the data of the lounge wall). `node tools/check-chat-contract.mjs <db>` (or `npm run chat:check -- <db>`) prints `OK` or what is missing. `--demo` never reads a chat board, whatever `--chat-db`, `CCO_CHAT_DB` or the config file name.

Independent of the bridge, the avatar tag of a working session shows its newest tool call with the description, for example `Bash · run the tests`, while it runs and for 20 seconds after.

## Task progress (optional)

If a chat works through a task list, the office can show how far it is: a bar under the chat's name on its card (done, being worked on, blocked, not started), the line "7 of 12 done · 2 doing", and the item in progress with how long it has been running. The office does not keep the list; it reads a small JSON snapshot that your task tracker writes after every change, by default `office-progress.json` in the Claude config directory (`~/.claude/office-progress.json`). Point it somewhere else with `--progress-file`, `OFFICE_PROGRESS_FILE` or `"progressFile"` in the config file. The snapshot is keyed by Claude Code session id, so each chat gets its own bar and a chat without an entry shows none. A missing or broken file means no bars, never an error. The format, the limits and how the page uses it are in [docs/progress.md](docs/progress.md); the demo (`npm run demo`) has sample bars.

## Embed it into your own site

The server is also a plain request handler, so you can mount it into an existing Express/Connect app:

```js
const { createOffice } = require('./claude-code-office/server.js');

const office = createOffice({
  site: { name: 'My Portal', home: '/', links: [{ label: 'Home', href: '/' }, { label: 'Agents', href: '/agents/', current: true }] },
});
office.start();
app.use('/agents', office.handler);   // everything uses relative URLs, so any mount path works
```

When `site` is given, the page shows your site's navigation bar on top, so both apps feel like one site.

## FAQ

**Does it send my code or prompts anywhere?**
No. It only listens on `127.0.0.1`, reads files under `~/.claude` and serves them to your own browser.

**Windows, macOS, Linux?**
All three. It needs Node.js 18 or newer.

**Does it need an API key or Claude Code plugins?**
No. It reads the files Claude Code already writes.

**Does it slow Claude Code down?**
No. It reads, but never writes to `~/.claude`, and it only reads new bytes after the first pass.

---

## Türkçe

**Claude Code Office (Ajan Ofisi)**, bilgisayarında aynı anda çalışan Claude Code oturumlarını ve alt ajanlarını canlı gösteren yerel bir paneldir:

- hangi terminalin seni beklediğini ("Sıra sende")
- her ajanın şu an ne yaptığını
- bağlamın ne kadar dolduğunu
- kullanımının API liste fiyatıyla ne tuttuğunu

Görünümler:
- **Pano:** oturum kartları.
- **Ofis:** her oturumun bir oda olduğu 3D izometrik bina.
- **Akış:** oturum ve alt ajan kulvarlarında zaman çizelgesi.
- **Maliyet:** günlük ve saatlik grafikler, model ve proje kırılımı.

```bash
npx github:azorkai/claude-code-office          # başlat ve tarayıcıyı aç
npx github:azorkai/claude-code-office --demo   # uydurma verili demo ofis
```

- Yalnızca `127.0.0.1`'e bağlanır, `~/.claude` altını salt okur, hiçbir yere veri göndermez.
- Arayüz dili tarayıcıya göre seçilir, üst çubuktan değiştirilebilir.
- Maliyet rakamları aboneliğinle ödediğin tutar değil, aynı kullanımın **API liste fiyatıyla karşılığıdır**.

---

MIT © azorkai. Not affiliated with or endorsed by Anthropic. "Claude" and "Claude Code" are trademarks of Anthropic, PBC.
