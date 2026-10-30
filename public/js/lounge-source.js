// Where the lounge gets its data: the poll of GET /api/lounge, a demo source that feeds the same shape from a small script, and the address option that picks one.
// No DOM and no timers of its own (they are passed in), so node can test the cadence with a fake clock (test/lounge-source.test.mjs).
//
//   sourceFromQuery(search)       { source: 'demo' | 'live', mode: 'text' | 'names' | 'off' | null } from ?lounge=; the words may be joined: ?lounge=demo,names
//   fetchReader({ fetchFn, url })  one read of the endpoint: { status: 'ok' | 'nofile' | 'failed', http, payload }; a 404 is `nofile` (the server has no such endpoint), never an error
//   createDemoSource({ now, sessions, start })  a read function with the same result shape that answers from a script of posts, no network
//   createPoller({ read, now, setTimer, clearTimer, canPoll, onData, pollMs, retryMs, offMs })   runs `read` on a cadence
//
// The cadence: a request at most every 3 seconds (pollMs), never two at once, and none while `canPoll()` is false (the tab is hidden, the Office view is not shown, the
// lounge is not on the screen, the setting is off). Nothing runs while it cannot poll: the owner calls `kick()` when that may have changed. A server that answers 404 has no
// endpoint, so it is asked again only every 5 minutes (retryMs): every 404 is a red line in the browser's console, and a server does not grow an endpoint in the minute.
// A server that answers but says the board is `off` (no --chat-db, or the file is not there yet) is asked again every 30 seconds (offMs): nothing on it changes faster than that.

export const POLL_MS = 3000;
export const RETRY_MS = 5 * 60e3;
export const OFF_MS = 30e3;
export const TIMEOUT_MS = 8000;

const MODES = ['text', 'names', 'off'];
export function sourceFromQuery(search) {
  const raw = new URLSearchParams(search || '').get('lounge');
  const words = raw == null ? [] : String(raw).toLowerCase().split(/[\s,+]+/).filter(Boolean);
  return { source: words.includes('demo') ? 'demo' : 'live', mode: words.find(w => MODES.includes(w)) || null };
}

// ------------------------------------------------------------ one read

export function fetchReader({ fetchFn, url = 'api/lounge', baseURI, timeoutMs = TIMEOUT_MS } = {}) {
  const f = fetchFn || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  return async function read() {
    if (!f) return { status: 'failed', http: 0, payload: null };
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    try {
      const res = await f(baseURI ? new URL(url, baseURI).href : url, { cache: 'no-store', headers: { accept: 'application/json' }, signal: ctl ? ctl.signal : undefined });
      if (res.status === 404) return { status: 'nofile', http: 404, payload: null };
      if (!res.ok) return { status: 'failed', http: res.status, payload: null };
      let body = null;
      try { body = await res.json(); } catch { return { status: 'failed', http: res.status, payload: null }; }
      return { status: 'ok', http: res.status, payload: body };
    } catch { return { status: 'failed', http: 0, payload: null }; } finally { if (timer) clearTimeout(timer); }
  };
}

// ------------------------------------------------------------ the demo

// The script: [ms after the page opened (negative: already said), channel, from, to, text]. It repeats every DEMO_PERIOD ms. The first six agents of the list are the demo's
// people; the first two are tied to the first two chats of the Office (so the demo shows both a person with a room and a person without).
export const DEMO_AGENTS = ['builder', 'reviewer', 'scout', 'lead', 'tester', 'docs'];
export const DEMO_SCRIPT = Object.freeze([
  [-170e3, 'office', 'lead', ['builder', 'scout'], 'Morning. The Valkey CAS retry path is the focus today. Scout, please map who calls it.'],
  [-120e3, 'tasks', 'scout', ['lead'], 'Found 14 call sites of the CAS helper, three of them outside the cache module. The list is in the doc.'],
  [-75e3, 'tasks', 'builder', ['reviewer'], 'Draft change is up: retries with jitter, three attempts at most. Could you look at the backoff?'],
  [-30e3, 'review', 'reviewer', ['builder'], 'Backoff looks right. One nit: no jitter when the first attempt succeeds.'],
  [4e3, 'review', 'builder', ['reviewer'], 'Fixed in the last commit. The retry counter now resets on success.'],
  [9e3, 'ops', 'tester', [], 'Staging smoke run: 212 passed, 0 failed. Starting the soak test.'],
  [15e3, 'tasks', 'docs', ['lead'], 'Runbook page updated with the new retry settings. The link is in the description.'],
  [22e3, 'office', 'lead', [], 'The soak test is the last gate. Nobody merges before it is green.'],
  [30e3, 'review', 'reviewer', ['builder', 'tester'], 'Approved with one comment about the metric name; it can be a follow-up and does not block the merge.'],
  [41e3, 'ops', 'tester', ['lead'], 'Soak test at 40 percent, no errors so far.'],
  [52e3, 'tasks', 'scout', ['builder'], 'The three outside callers use the old signature. I opened a small change for each.'],
  [66e3, 'office', 'builder', [], 'Coffee? The machine in the lounge just finished a fresh pot.'],
  [79e3, 'ops', 'tester', ['lead', 'builder', 'reviewer'], 'Soak test is green: 2 hours simulated, 0 errors, p99 within 3 percent of the baseline.'],
  [92e3, 'office', 'lead', ['docs'], 'Thanks all. Docs, please add the numbers to the page before we close this out.'],
]);
export const DEMO_PERIOD = 110e3;

// `now`: the clock (ms); `sessions`: () => the ids of the chats the Office has, to tie the first demo agents to; `start`: when the page opened (the clock at creation)
export function createDemoSource({ now = Date.now, sessions = () => [], start } = {}) {
  const t0 = start ?? now();
  const at = (k, i) => t0 + DEMO_SCRIPT[i][0] + k * DEMO_PERIOD;
  const seqOf = (k, i) => k * DEMO_SCRIPT.length + i + 1;
  const messagesAt = tNow => {
    const out = [];
    const k0 = Math.max(0, Math.floor((tNow - t0) / DEMO_PERIOD) - 1);
    for (let k = k0; k <= k0 + 2; k++) {
      for (let i = 0; i < DEMO_SCRIPT.length; i++) {
        if (k === 0 ? false : DEMO_SCRIPT[i][0] < 0) continue;                      // the lines said before the page opened are said once
        if (at(k, i) > tNow) continue;
        const [, channel, from, to, text] = DEMO_SCRIPT[i];
        out.push({ seq: seqOf(k, i), ts: at(k, i), channel, from, to: [...to], text });
      }
    }
    return out.sort((a, b) => a.ts - b.ts).slice(-60);
  };
  const read = async () => {
    const tNow = now(), messages = messagesAt(tNow), ids = (() => { try { return sessions() || []; } catch { return []; } })();
    const channels = {};
    for (const m of messages) channels[m.channel] = (channels[m.channel] || 0) + 1;
    const last = new Map();
    for (const m of messages) last.set(m.from, m.ts);
    const agents = DEMO_AGENTS.filter(n => last.has(n)).map(name => { const idx = DEMO_AGENTS.indexOf(name); return { name, lastSeenMs: last.get(name), session: idx < 2 && typeof ids[idx] === 'string' ? ids[idx] : '' }; });
    return { status: 'ok', http: 200, payload: { state: { state: 'ok', schema: 'demo', reason: '' }, messages, channels, agents } };
  };
  read.messagesAt = messagesAt;
  read.start = t0;
  return read;
}

// ------------------------------------------------------------ the cadence

// opts: read () => Promise<{ status, http, payload }>, now () => ms, setTimer / clearTimer (the page's own), canPoll () => boolean, onData (result, { receivedAt }),
//       pollMs, retryMs, offMs
export function createPoller({ read, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, canPoll = () => true, onData = () => {}, pollMs = POLL_MS, retryMs = RETRY_MS, offMs = OFF_MS } = {}) {
  let timer = null, inflight = false, stopped = true, lastStart = -Infinity, wait = pollMs;
  const stats = { requests: 0, starts: [], lastStatus: 'none' };
  const clear = () => { if (timer != null) { clearTimer(timer); timer = null; } };
  function arm() {
    if (stopped || timer != null || inflight) return;
    if (!canPoll()) return;                                                      // nothing runs: the owner kicks when it may poll again
    timer = setTimer(tick, Math.max(0, lastStart + wait - now()));
  }
  async function tick() {
    timer = null;
    if (stopped || inflight) return;
    if (!canPoll()) return;
    const t = now();
    if (t - lastStart < pollMs) { arm(); return; }                               // never faster than pollMs, whoever asked
    inflight = true; lastStart = t;
    stats.requests++; stats.starts.push(t); if (stats.starts.length > 60) stats.starts.shift();
    let res;
    try { res = await read(); } catch { res = { status: 'failed', http: 0, payload: null }; }
    inflight = false;
    stats.lastStatus = res && res.status || 'failed';
    const st = res && res.payload && res.payload.state, said = st && typeof st === 'object' ? st.state : st;          // what the server says about the board: 'ok' | 'off' | 'unsupported'
    wait = stats.lastStatus === 'nofile' ? retryMs : stats.lastStatus === 'ok' && said === 'off' ? offMs : pollMs;
    if (!stopped) { try { onData(res, { receivedAt: now() }); } catch { /* the owner's handler must not stop the poll */ } }
    arm();
  }
  return {
    start() { stopped = false; arm(); },
    stop() { stopped = true; clear(); },
    // the conditions may have changed (the tab is visible again, the lounge came on screen): poll as soon as the cadence allows, or stop waiting when it must not
    kick() { if (stopped) return; if (canPoll()) arm(); else clear(); },
    get running() { return !stopped; },
    get inflight() { return inflight; },
    get armed() { return timer != null; },
    stats,
  };
}
