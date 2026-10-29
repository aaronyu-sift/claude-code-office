# Task progress of a chat

The Office can show how far a chat is through its task list: a bar under the chat's name on the agent card, a line such as "7 of 12 done · 2 doing", and the item being worked
on with how long it has been running. The Office does not own the task list. A task tracker writes a snapshot file after every change; the Office reads it, a few seconds
later the bar moves.

## The snapshot file

A JSON file, by default `office-progress.json` in the Claude config directory (`~/.claude/office-progress.json`, or `$CLAUDE_CONFIG_DIR`, or the `--claude-dir` of the server).
Another place: `--progress-file <file>`, `"progressFile"` in the config file, or the environment variable `OFFICE_PROGRESS_FILE` (the first one that is set wins).

```json
{
  "version": 1,
  "updatedAt": "2026-10-29T22:40:00-0700",
  "chats": {
    "<Claude Code session id>": {
      "topic": "Claude Code Office (pixel scene)",
      "updatedAt": "2026-10-29T22:40:00-0700",
      "total": 12,
      "done": 7,
      "doing": 2,
      "blocked": 1,
      "items": [
        {
          "id": "S20",
          "title": "Progress bar for each agent",
          "status": "doing",
          "prio": "high",
          "complexity": "S",
          "doingSince": "2026-10-29T22:10:00-0700",
          "doneAt": null
        }
      ]
    }
  }
}
```

| Field | Meaning |
| --- | --- |
| `version` | `1`. A file with another version is ignored; a missing version is read as 1. |
| `chats` | One entry per chat, keyed by the Claude Code session id (see below). |
| `topic` | The name of the list, shown as the accessible name of the bar. |
| `total`, `done`, `doing`, `blocked` | Counts for the whole list; what is left is "not started". They are the truth for the bar even when `items` is shorter. Without them the Office counts the items. |
| `items[].id` | The item's short id (`S20`, `S1.2`). Ids are compared the way a person reads them: `S2` before `S10`. |
| `items[].title` | The item's one-line title. |
| `items[].status` | `done`, `doing`, `blocked` or `todo`. An item with any other status is left out. |
| `items[].prio` | `high`, `med`, `low` or `none` (anything else counts as `none`). Decides which not-started item is shown as next. |
| `items[].complexity` | A short size label such as `S` or `M` (up to four letters or digits). |
| `items[].doingSince`, `items[].doneAt` | ISO 8601 time (an offset with or without a colon is fine) or epoch milliseconds, else `null`. `doingSince` gives the running time. |
| `updatedAt` | When the entry or the file was written. Times outside the years 2000 to 2100 are read as `null`. |

Write the file by writing a temporary file next to it and renaming it over the real one, so the Office never reads half a file.

### Which chat an entry belongs to

The key is the session id of the Claude Code chat that runs the tracker, the `sessionId` in `~/.claude/sessions/<pid>.json` (the `CLAUDE_CODE_SESSION_ID` of the chat). The Office
uses the same id as the id of that chat's main agent, so the entry lands on the right chat. A chat without an entry has no bar. A subagent has no entry of its own: an entry
keyed by a subagent's id is ignored.

### What a writer does

The Office reads any file in the format above. The tracker it was built with writes it by these rules, which also make the best use of what the Office shows:

- It rewrites the whole file after every change to a list (an item added, changed or deleted): a temporary file next to it, renamed over it under a lock, with mode `0600` because the
  file holds task titles.
- One entry per chat, keyed by the session id (`CLAUDE_CODE_SESSION_ID`), holding the list the chat touched last. An entry of a chat that has not been touched for 7 days is dropped.
- The counts are over the leaves of the list: a stage that has sub-tasks counts through its sub-tasks, not as an item of its own.
- `items` come in this order: being worked on, blocked, not started (highest priority first, then by number), finished last; at most 40. The Office shows the first item being worked on
  as "Now", so the order decides which one that is.
- `complexity`, `doingSince` and `doneAt` come from a timing ledger and are `null` when unknown. `doingSince` is set only on items being worked on and `doneAt` only on finished items. An
  item being worked on without `doingSince` is shown without a running time.

## What the Office does with it

- `server.js` looks at the file with one `stat` at most every two seconds (on its existing one-second tick, no timer of its own) and reads it again only when it changed. The
  chat's entry is added to that chat's agent as `progress` in the data the page already receives (`/events`, `/api/state`); a chat without an entry has `progress: null`.
  `/api/progress` returns every parsed entry, for checking what the Office read.
- A missing, unreadable, empty, malformed, unknown-version or oversize file (over 1 MiB) means no progress, and the Office keeps working. One bad chat entry is dropped without hiding
  the others.
- The file is not trusted. Strings lose control characters, line separators and bidirectional marks, are collapsed to single spaces and are cut (`topic` 120 characters, `title`
  200, `id` 24; a cut ends in `…`). Counts are whole numbers between 0 and 100000, and the total grows to the counts when they add up to more. At most 200 chats and 40 items per chat are
  kept; of a longer list the items being worked on and the blocked ones stay first, then the open ones, then the finished ones, in their own order. Times become epoch milliseconds.
  The page puts every string on screen as text, never as markup.

## In the page

- `public/js/progress.js` is the logic, with no DOM: `progressSegments` (done, doing, blocked and not-started parts as fractions that add up to 1), `progressLabel` (the one-line text),
  `currentItem` (the first item being worked on, else the not-started item with the highest priority and then the lowest id) and `runningMs` (time since `doingSince`).
- `public/js/progress-bar.js` exports `progressBarEl(progress, { now, text })`: the bar as an element, or `null` when the chat has no list. The bar has `role="progressbar"` with
  `aria-valuemin`, `aria-valuemax` (the total), `aria-valuenow` (the done count) and `aria-valuetext` (the line of text). With `text: false` only the bar is built, for a small label.
  The running time carries `data-since`, so the page's clock keeps it current. The look is in the `.cco-prog` rules of `public/app.css`, in the colours of the glass cards; no text
  is smaller than 12 px.
- The agent card (`public/js/pixel/card.js`) shows the bar right under the chat's name when `agent.progress` is set.
- The texts are in `public/js/lang/en.js` and `tr.js` (`progress.*`).

## Checking it

```bash
npm test                  # test/progress-file.test.mjs (the file and its limits), test/progress.test.mjs (the logic)
npm run qa:progress       # progress-path, progress-data, progress-bar and progress-card in headless Chrome, against a fake ~/.claude
```

`npm run demo` has sample lists for six of the demo chats and none for the asleep one.
