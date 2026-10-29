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
> and a [pixel-art Office view](#pixel-office) (isometric and front views, time of day, a sprite gallery) that replaces the 3D scene as the default; the 3D scene stays available at `?scene=3d`.
> Run it with `npx github:aaronyu-sift/claude-code-office`. Everything below is the upstream README, extended where the fork differs.

---

## Why

If you run five, ten, fifteen Claude Code terminals at once, you lose track fast:

- *Which session finished and is waiting for my answer?*
- *What are those twelve background subagents actually doing?*
- *How big has that context grown, and how much would all of this cost on the API?*

Claude Code Office answers those questions live, from the data Claude Code already writes to `~/.claude`.

## Features

- **"Your turn" radar.** Sessions that finished and are waiting for you are pulled to the front, highlighted in amber and counted in the header and the tab title. An optional chime and desktop notification play when an agent hands the turn back.
- **Pixel-art office** (the default Office view, see [Pixel office](#pixel-office)). Every session is a themed room on a garden island, drawn from pre-rendered voxel sprites on a 2D canvas, in an isometric or a front three-quarter view.
  - Your full chat name hangs over each lead agent; a thought bubble shows the tool in use; a beam of light and a "!" balloon mark the agent that waits for you.
  - Day and night follow your local clock: tinted light, a sky, lit windows, lamps and monitors after dark.
  - Only small things move (steam, plants, butterflies, birds), at most 10 frames per second, nothing while the tab is hidden.
- **3D isometric office** (`?scene=3d`, the original scene). It is a tycoon-game style building on a little diorama island, with streets, a river, trees and mountains. Every session is a room with its project name on the wall.
  - The lead agent sits at the big desk; subagents work at the other desks.
  - Monitors glow in the color of the current activity: thinking, shell, reading, editing, web/MCP or delegating.
  - New subagents walk in through the hall and leave when they finish. Idle rooms dim, and waiting rooms light up.
  - Street lamps and windows follow your local time of day.
  - The office drops to a low-power mode on machines without GPU acceleration.
- **Dashboard.** Each session card shows the current tool and elapsed time, a 30-minute activity strip, context-window fill, tokens per hour, session cost and live subagents.
- **Timeline.** Swimlanes for every session and subagent over the last 15 minutes to 6 hours. It shows tool calls, thinking spans, waiting time, prompts and compactions, with hover details.
- **Cost tracker.** It converts every assistant message in your transcripts into dollars at API list prices:
  - today, this week, this month and all time
  - daily chart stacked by model, hourly chart for today
  - breakdowns per model and per project
  
  The first scan runs in a worker thread; after that only new bytes are read.
- **Drawer with details.** Click any agent to see its last prompt, recap, last reply, tool mix, per-minute tokens and full event log.
- **English and Turkish UI.** The language is detected from the browser and can be switched in the header.
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
| `--chat-db <file>` | off | SQLite message board to show next to the avatars, read-only (or `CCO_CHAT_DB`; see [Agent chat bridge](#agent-chat-bridge-optional)) |

## How it works

| Source | What it gives |
|---|---|
| `~/.claude/sessions/<pid>.json` | Live sessions and whether each one is busy or idle (the process must still be alive) |
| `~/.claude/projects/**/<sessionId>.jsonl` | The transcript: prompts, tool calls and results, token usage, titles, recaps |
| `…/<sessionId>/subagents/agent-*.jsonl` + `.meta.json` | Every subagent's own transcript, type and task description |

The server tails these files once per second. It reads only the last few MB of long transcripts on first start, then only the new bytes. It turns the records into agent states and events, and streams them to the browser over Server-Sent Events. Nothing is uploaded anywhere.

## Pixel office

The Office view draws a pixel-art scene: voxel models written as code in [`tools/sprites/`](tools/sprites/) are rendered once into sprite atlases (`public/pixel/atlas-iso.png`, `atlas-front.png`, with `manifest.json`), and the browser draws them on a 2D canvas. No 3D, no runtime dependencies, no build step for the app.

**Options** (URL query, for the Office view):

| Option | Effect |
|---|---|
| `?proj=iso` or `?proj=front` | The view: isometric (default) or front three-quarter. The toggle in the header does the same and the choice is remembered in the browser; the URL wins over the remembered choice. |
| `?time=HH:MM` | Pin the time of day (for example `?time=22:00`) instead of following the browser's local clock. |
| `?gallery=1` | List every sprite of the atlas with its id. Add `&proj=front` for the other atlas. |
| `?scene=3d` | The original three.js office. |

**Look and controls.** The scene scales in whole-number steps (no blur): `+`, `-`, the mouse wheel and pinch zoom; drag to pan; the fit button or a double click shows everything. Click an agent or its label for the drawer. Rooms keep their place when agents come and go, and the theme of a room (library, lounge, lab, studio) follows its project.

**Regenerating the art.** The atlases are committed, so this is only needed after changing a model. You need [bun](https://bun.sh) and the pinned VoxPix renderer (MIT, see [THIRD_PARTY.md](THIRD_PARTY.md)):

```bash
git clone https://github.com/andyeswong/voxpix .tools/voxpix && git -C .tools/voxpix checkout c8e9843   # pinned, git-ignored
node tools/sprites/build-atlas.mjs --proj iso       # writes public/pixel/atlas-iso.png, manifest.json, public/js/pixel/footprints.js
node tools/sprites/build-atlas.mjs --proj front
node tools/sprites/build-atlas.mjs --proj iso --check    # fails if the committed files differ from a fresh render (also --proj front)
npm run sprites:table                                # the content lists of the plan against the manifest
```

The models are in `tools/sprites/` (`models.mjs`, `props.mjs`, `decor.mjs`; `catalog.mjs` lists every sprite); [`tools/sprites/README.md`](tools/sprites/README.md) has the details.

**Tests.** `npm test` runs the unit tests (projections, layout in both views, depth order, labels, scheduler, time of day, manifest). `node tools/qa/pixel-qa.mjs --proj iso` (or `--proj front`) starts the server against a fake `~/.claude`, drives headless Chrome in a throw-away profile and prints one `CHECK … PASS|FAIL` line per check (occlusion, click targets, labels, frame budget, idle, time of day, gallery, projection toggle) and a final `QA PASS` or `QA FAIL`. `--shots <dir>` also writes screenshots. The plan, its decisions and the deviations are in [docs/pixel-scene-plan.md](docs/pixel-scene-plan.md).

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

The database is opened read-only with Node's built-in [`node:sqlite`](https://nodejs.org/api/sqlite.html) (Node 22.13 or newer; on an older Node the bridge stays off and logs one line). Nothing is ever written to it. The bridge reads two tables:

| Table | Columns it uses |
|---|---|
| `messages` | `seq` (increasing integer), `ts_ms` (epoch milliseconds), `channel`, `author`, `to_list` (comma-separated recipient names, empty for a channel post), `body` |
| `agent_keys` | `key` (`session:<Claude Code session id>`), `agent` (the board's name for that agent) |

A board agent is matched to a session through `agent_keys`; without a row, to the session whose id, name or project equals the agent's name.

Independent of the bridge, the avatar tag of a working session shows its newest tool call with the description, for example `Bash · run the tests`, while it runs and for 20 seconds after.

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
