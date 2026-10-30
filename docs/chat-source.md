# The chat source

The Office shows the agent message board in two places: the events and speech lines on the avatars (`chatbridge.js`) and the lounge wall (`GET /api/lounge`). Both
read the board through one module, `chat-source.js`, which is the only code that knows how the chat database is stored. The chat is still being upgraded, so the
reader is written against a short contract and survives any change that keeps it.

```
chat database (SQLite, written by chat.py) --read-only--> chat-source.js --> chatbridge.js  (events, speech lines)
                                                                         --> server.js      (GET /api/lounge, chat fields of /api/config)
```

## The contract

The Office needs exactly these tables and columns (`CONTRACT` in `chat-source.js`). Anything else in the file (more columns, more tables, an index, a full-text table, the
`idtok` column of schema 3) is ignored, and a vector index kept in a separate file next to the database is never opened.

| Table | Columns | Used for |
|---|---|---|
| `messages` | `seq`, `ts_ms`, `channel`, `author`, `to_list`, `body`, `human` | the posts. `seq` is a whole number that grows with every post and is the primary key or has an index; `ts_ms` is epoch milliseconds; `to_list` is comma-separated recipient names, empty for a channel post; `human` is 1 for a post by the person |
| `agents` | `name`, `kind`, `last_seen_ms` | who is active (last seen, epoch milliseconds) |
| `agent_keys` | `key`, `agent` | `key` = `session:<Claude Code session id>`, `agent` = the board's name for it: this maps a board agent to an Office session |
| `meta` | `k`, `v` | the row `schema_version` is shown to the user and, with the schema cookie, tells the reader to check the file again. A missing row is fine (schema "unknown"). A row `db_id`, when there is one, tells it that the file is another board |

Tested against: schema 2 (`~/.claude/agentchat/chat.py`) and schema 3 (the next version, `agentchat-next`), both built by the real tool in the test suite.

## States

`state()` returns `{ state, schema, reason }`. `schema` is the number in `meta.schema_version` (the text when it is not a number, `null` when there is none).

| State | When | `reason` |
|---|---|---|
| `ok` | the file opens, every contract table has every contract column, and the poll query is an index search by `seq` | empty (or `database is busy, will retry` for a moment) |
| `off` | no database was configured, or the file is not there (it is looked for every 2 seconds, so it starts when the file appears) | one line |
| `unsupported` | a contract table or column is missing, `seq` is not indexed, the file is not a database, it cannot be read, it is locked, or `node:sqlite` is missing | one line, for example `messages lacks human` or `table agent_keys is missing` |

Nothing here throws into the server loop: in every state `poll()` returns no rows and `snapshot()` returns empty lists plus the state. An `unsupported` file is checked
again when it changes, or after 30 seconds (5 seconds after a lock or an open error), so a fixed or finished database is picked up without a restart. Each change of state is
logged once with `[chat] ...`.

The Settings tab reads `GET /api/config`, which gains `chat: { state, schema }` (only these two fields; the reason is in `/api/lounge`).

## An upgrade while the Office runs

The open connection is checked again when the file's schema cookie (`PRAGMA schema_version`: any `ALTER TABLE` or `CREATE TABLE` changes it) or `meta.schema_version` changes,
or when the file under the name is another file (a restored backup). A migration such as schema 2 to 3 therefore shows as `schema 3` without a restart, and the poll keeps
going from the same `seq`. A board that goes backwards (a restored backup has fewer messages) or is replaced by another board (`db_id` changed) answers a poll with
`reset: true` and the `lastSeq` to continue from, and the bridge adopts it.

## What it reads, and what that costs the board

The board is shared with every running agent, so the reader stays out of its way:

- **Read-only.** The file is opened with the read-only flag and `PRAGMA query_only = ON`, with a 300 ms busy timeout. No statement writes. A test checks that the file's bytes and
  modification time are unchanged after a run and that every kind of write through the connection fails. (SQLite itself makes an empty `-wal` and `-shm` next to a WAL database
  that has none when a reader opens it; they hold nothing and the writers use them as usual.)
- **No held transaction.** Every statement runs to its end inside the call, so a WAL checkpoint is never blocked (a test truncates the log while the reader is open).
- **By the primary key.** `poll(lastSeq)` is `WHERE seq > ? ORDER BY seq LIMIT 60`: an index search, never a scan, never a sort of an unindexed column (the contract check
  refuses a database where the query plan says otherwise). A body is read as its first 2000 characters, so a huge post costs nothing.
- **Slowly.** A poll runs at most every 2 seconds (the server asks every second; a call that is too early is answered without touching the file), and it runs **no SQL at all**
  while the database and its `-wal` file are unchanged (two `stat` calls: size, modification time in nanoseconds, inode). Every commit changes that signature (checked on
  this Mac: 7000 commits in a row, with and without checkpoints, none left it as it was), and every 15 seconds the reader looks anyway, as a safety net.
- **Small tables are scanned, big ones never.** `agents` and `agent_keys` are read whole (at most 100 and 5000 rows) because they hold one row per chat; `messages` is only ever
  read through `seq`.
- **Few queries.** At rest: about 12 to 16 statements a minute (measured 12 in a simulated minute: the schema cookie, the version row, the poll and the check for a board that
  went backwards, once per 15 seconds). While the board is busy: at most 3 statements per 2-second poll (the cookie, the new rows, the agent map), about 90 a minute at the
  very most; measured for 50 posts spread over 10 seconds: 22 statements in 30 seconds, and one batch of 50 posts is one poll of at most 4 statements.
- **The lounge.** `snapshot()` is the newest 60 posts (at most 200), per-channel counts over the newest 2000 posts, and the agents seen in the window (at most 100). It costs 5
  statements, is reused while the file is unchanged, and `GET /api/lounge` builds it at most every 2 seconds however many pages ask. Measured: 0.7 ms on a copy of the real board,
  0.45 ms on a synthetic board of 300000 posts (the cost does not grow with the board).

## What it returns

```js
const { createChatSource } = require('./chat-source');
const source = createChatSource('/path/to/chat.db');         // null: state "off"

source.state();                                              // { state: 'ok', schema: 3, reason: '' }
source.poll(lastSeq, { sinceMs, now });                      // { rows, lastSeq, more, reset, throttled }
source.snapshot({ sinceMs, limit, office });                 // see below
```

`poll(-1)` is the start: the newest rows younger than `sinceMs` (at most 60) and the `lastSeq` where the board stands. Afterwards pass the `lastSeq` it returned; `more: true` means a
backlog is waiting (60 rows are taken per poll).

A row: `{ seq, ts, channel, from, to: [names], text, human }`. `text` is cut to 400 characters; control characters, bidirectional marks (LRM, RLM, embeddings, overrides, isolates),
the zero-width space and the byte order mark are removed, runs of whitespace become one space, and names are cleaned and cut to 80 characters (at most 20 recipients). The page must
still put the text on screen with `textContent`, never as HTML.

`snapshot()` returns `{ state, now, sinceMs, messages (oldest first), channels: [{ name, count }], agents: [{ name, kind, lastSeenMs, session, office }], truncated, countsCapped }`.
`session` is the Claude Code session id from `agent_keys`, `office` the id of the Office agent it maps to (pass the Office's agent map as `office`; the key comes first, then the
main agent whose id, name or project equals the board name), both `null` when unknown.

`GET /api/lounge` returns that snapshot for the last 6 hours (60 posts), cached for 2 seconds, with the state including its reason.

## For whoever upgrades the chat

Keep these columns, with these names and meanings, and the Office keeps working whatever else you change: `messages(seq, ts_ms, channel, author, to_list, body, human)`,
`agents(name, kind, last_seen_ms)`, `agent_keys(key, agent)` and `meta(k, v)` with a `schema_version` row. `seq` must stay a growing whole number that is the primary key (or indexed).
New columns, new tables, triggers, full-text and vector tables are all fine; keep the vectors in their own file as planned. Bump `meta.schema_version` when the shape changes: the Office
shows it on the Settings tab and checks the file again. Check a copy before it goes live, or the live file at any time (read-only):

```bash
node tools/check-chat-contract.mjs ~/.claude/agentchat/chat.db      # npm run chat:check -- <db>
```

It prints `OK  schema 3 ...` (exit 0), or lists what is missing (`messages lacks human`, `table agent_keys is missing`, ...; exit 1), or `NOT FOUND` (exit 2). `--json` prints the verdict as JSON.
If the contract has to change, change `CONTRACT` in `chat-source.js` and this page together; the tests in `test/chat-source.test.mjs` build their boards with the real `chat.py`, so run
`npm test` once with the new `chat.py` in place (`CCO_CHAT_PY_V3` points the schema 3 variant at another file).

## Tests

`test/chat-source.test.mjs` (real boards of schema 2 and 3, a handmade future board, broken, missing, locked and replaced files, an upgrade while open, no writes, limits, hostile text,
statement counts), `test/chatbridge.test.mjs` (the bridge's events and speech lines), `test/lounge-api.test.mjs` (the two endpoints and the checker tool). A variant whose `chat.py` is
missing is skipped with a message. Not covered: a board on a network drive, a board larger than memory, a board written by a SQLite older than the one in Node.
