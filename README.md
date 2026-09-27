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

---

## Why

If you run five, ten, fifteen Claude Code terminals at once, you lose track fast:

- *Which session finished and is waiting for my answer?*
- *What are those twelve background subagents actually doing?*
- *How big has that context grown, and how much would all of this cost on the API?*

Claude Code Office answers those questions live, from the data Claude Code already writes to `~/.claude`.

## Features

- **"Your turn" radar.** Sessions that finished and are waiting for you are pulled to the front, highlighted in amber and counted in the header and the tab title. An optional chime and desktop notification play when an agent hands the turn back.
- **3D isometric office.** It is a tycoon-game style building on a little diorama island, with streets, a river, trees and mountains. Every session is a room with its project name on the wall.
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
git clone https://github.com/azorkai/claude-code-office.git
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

## How it works

| Source | What it gives |
|---|---|
| `~/.claude/sessions/<pid>.json` | Live sessions and whether each one is busy or idle (the process must still be alive) |
| `~/.claude/projects/**/<sessionId>.jsonl` | The transcript: prompts, tool calls and results, token usage, titles, recaps |
| `…/<sessionId>/subagents/agent-*.jsonl` + `.meta.json` | Every subagent's own transcript, type and task description |

The server tails these files once per second. It reads only the last few MB of long transcripts on first start, then only the new bytes. It turns the records into agent states and events, and streams them to the browser over Server-Sent Events. Nothing is uploaded anywhere.

## About the cost numbers

The cost view shows what your token usage **would cost at Anthropic API list prices**. If you use Claude Code with a Pro/Max subscription, this is **not your bill**. It is a way to see how heavy your usage is and where it goes.

- Every assistant message's `usage` is priced as input + output + cache writes (5 min = 1.25× input, 1 h = 2× input) + cache reads, per model.
- Messages are de-duplicated by message id, so streamed records are not double-counted.
- Transcripts that Claude Code has already deleted cannot be counted, so totals start at your oldest transcript.
- Prices are in [`cost-worker.js`](cost-worker.js); update them there if Anthropic changes its pricing.

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
