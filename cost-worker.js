'use strict';
// Cost worker: scans every transcript under ~/.claude/projects and converts each assistant
// message's usage into dollars at list prices. Results are kept per file, broken down by
// day and model, in <dataDir>/cost-cache.json; later scans only read the part of a file that
// grew. It is an estimate, not a bill. Prices: Anthropic API list prices by default; with
// workerData.pricesFile a Vertex AI price table (per-model cache-write and cache-read prices, long-context
// tier above a prompt-size threshold), optionally less a discount (workerData.discount) and plus the cost
// of model calls that leave no transcript (workerData.extraLogs).

const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const { StringDecoder } = require('string_decoder');
const crypto = require('crypto');

const PROJ_DIR = workerData.projDir;
const CACHE = workerData.cacheFile;
const PRICES_FILE = workerData.pricesFile || null;
const DISCOUNT = Math.min(Math.max(Number(workerData.discount) || 0, 0), 0.99);
const K = 1 - DISCOUNT;                       // multiplier applied when the summary is built, never stored in the cache
const EXTRA_LOGS = Array.isArray(workerData.extraLogs) ? workerData.extraLogs : [];
const RESCAN_MS = 45e3;
const VERSION = 4;

// $ per million tokens: [input, output, cache read]. Cache writes: 5 min = 1.25x input, 1 h = 2x input.
// Source: Anthropic's published list prices (June 2026) and prompt-caching multipliers.
// Pre-4.5 models use their historical list prices.
const API_PRICES = [
  [/fable-5-1|mythos-5-1/, 10, 50, 0.25],
  [/fable-5|mythos-5/, 10, 50, 1.0],
  [/opus-5-5/, 4, 20, 0.20],
  [/opus-5/, 5, 25, 0.5],
  [/opus-4-[5-9]/, 5, 25, 0.5],
  [/opus-4|opus-3/, 15, 75, 1.5],
  [/sonnet-5/, 2, 10, 0.2],
  [/sonnet/, 3, 15, 0.3],
  [/haiku-4/, 1, 5, 0.1],
  [/haiku-3-5/, 0.8, 4, 0.08],
  [/haiku/, 0.25, 1.25, 0.03],
];

// Vertex table, USD per 1M tokens: [input, output, cache write 5m, cache write 1h, cache read]. 'high' applies when a
// message's prompt (input + cache read + cache writes) reaches 'threshold'. The file is re-read when it changes.
const VERTEX_BUILTIN = {   // used for models the file does not list
  'claude-sonnet-5-5': { low: [2, 10, 2.5, 4, 0.1], high: null, threshold: 200000 },
  'claude-sonnet-5': { low: [2, 10, 2.5, 4, 0.2], high: null, threshold: 200000 },
  'claude-sonnet-4-5': { low: [3, 15, 3.75, 6, 0.3], high: [6, 22.5, 7.5, 12, 0.6], threshold: 200000 },
  'claude-haiku-4-5': { low: [1, 5, 1.25, 2, 0.1], high: null, threshold: 200000 },
};
function loadVertex(file) {
  const table = Object.assign({}, VERTEX_BUILTIN);
  let fetched = 0, fromFile = false;
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (c && c.prices && Object.keys(c.prices).length) { Object.assign(table, c.prices); fetched = (c.fetched || 0) * 1000; fromFile = true; }
  } catch { /* the built-in table stays */ }
  return { table, fetched, fromFile, keys: Object.keys(table).sort((a, b) => b.length - a.length) };
}
let VERTEX = null, vertexMtime = -1;

// "claude-haiku-4-5-20251001" and "claude-sonnet-5-5[1m]" map to the longest table key they start with.
function vertexKey(model) {
  const base = model.split('@')[0].split('[')[0];
  return VERTEX.keys.find(k => base === k || base.startsWith(k + '-')) || null;
}
// Rate tuple for a model and a prompt size, or null when the model has no price.
function rateOf(model, prompt) {
  if (VERTEX) {
    const p = VERTEX.table[vertexKey(model) || ''];
    if (!p) return null;
    return p.high && prompt >= p.threshold ? p.high : p.low;
  }
  for (const [re, i, o, cr] of API_PRICES) if (re.test(model)) return [i, o, i * 1.25, i * 2, cr];
  return null;
}

// cache.seen: message id -> output tokens counted so far, over all files. A resumed or forked chat copies its history
// into a new transcript, and one API response must be billed once, so ids are deduplicated across files.
let cache = { version: VERSION, sig: '', files: {}, seen: {} };
try {
  const c = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  if (c.version === VERSION && c.seen) cache = c;
} catch { /* first run */ }

const pad = n => String(n).padStart(2, '0');
function dayKey(ts) { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function hourKey(ts) { const d = new Date(ts); return `${dayKey(ts)}T${pad(d.getHours())}`; }

function listFiles() {
  const out = [];
  const walk = dir => {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'memory' && e.name !== 'tool-results') walk(p); }
      else if (e.name.endsWith('.jsonl')) out.push(p);
    }
  };
  walk(PROJ_DIR);
  return out;
}

// [input, output, cacheWrite5m, cacheWrite1h, cacheRead, usd, messages]
function add(bucket, key, model, v) {
  const d = bucket[key] || (bucket[key] = {});
  const r = d[model] || (d[model] = [0, 0, 0, 0, 0, 0, 0]);
  for (let i = 0; i < 7; i++) r[i] += v[i];
}

function costOf(model, u, outDelta, first) {
  // The prompt of a message is the same on each of its lines; it picks the price tier.
  const pin = u.input_tokens || 0;
  const pcr = u.cache_read_input_tokens || 0;
  const cc = u.cache_creation || {};
  const pcw1 = cc.ephemeral_1h_input_tokens || 0;
  const pcw5 = cc.ephemeral_5m_input_tokens != null ? cc.ephemeral_5m_input_tokens : Math.max(0, (u.cache_creation_input_tokens || 0) - pcw1);
  const rate = rateOf(model, pin + pcr + pcw1 + pcw5);
  const fast = !VERTEX && u.speed === 'fast' ? 2 : 1;
  const inp = first ? pin : 0, cr = first ? pcr : 0, cw1 = first ? pcw1 : 0, cw5 = first ? pcw5 : 0;
  const web = first && !VERTEX ? (u.server_tool_use && u.server_tool_use.web_search_requests) || 0 : 0;
  const out = outDelta;
  if (!rate) return [inp, out, cw5, cw1, cr, 0, first ? 1 : 0];
  const usd = fast * (inp * rate[0] + out * rate[1] + cw5 * rate[2] + cw1 * rate[3] + cr * rate[4]) / 1e6 + web * 0.01;
  return [inp, out, cw5, cw1, cr, usd, first ? 1 : 0];
}

function scanFile(file, st) {
  let f = cache.files[file];
  if (!f || st.size < f.offset) {
    f = cache.files[file] = { size: 0, mtime: 0, offset: 0, cwd: '', days: {}, hours: {}, first: 0, last: 0, total: 0 };
  }
  if (st.size === f.offset) { f.mtime = st.mtimeMs; return false; }
  const fd = fs.openSync(file, 'r');
  const dec = new StringDecoder('utf8');
  const seen = cache.seen;
  const chunk = Buffer.allocUnsafe(4 * 1024 * 1024);
  let carry = '';
  let pos = f.offset;
  const handle = line => {
    if (!f.cwd) {
      const m = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(line.length > 4000 ? line.slice(0, 4000) : line);
      if (m) { try { f.cwd = JSON.parse('"' + m[1] + '"'); } catch { /* bozuk */ } }
    }
    if (line.indexOf('"type":"assistant"') < 0 || line.indexOf('"usage"') < 0) return;
    let r;
    try { r = JSON.parse(line); } catch { return; }
    if (r.type !== 'assistant' || !r.message || !r.message.usage) return;
    const msg = r.message;
    const model = msg.model;
    if (!model || model === '<synthetic>') return;
    const ts = Date.parse(r.timestamp) || 0;
    const id = msg.id || r.uuid;
    const out = msg.usage.output_tokens || 0;
    const prev = seen[id];
    let v;
    if (prev == null) v = costOf(model, msg.usage, out, true);
    else if (out > prev) v = costOf(model, msg.usage, out - prev, false);
    else return;
    seen[id] = Math.max(out, prev || 0);
    add(f.days, dayKey(ts), model, v);
    if (Date.now() - ts < 8 * 86400e3) add(f.hours, hourKey(ts), model, v);
    f.total += v[5];
    if (!f.first || ts < f.first) f.first = ts;
    if (ts > f.last) f.last = ts;
  };
  try {
    while (pos < st.size) {
      const n = fs.readSync(fd, chunk, 0, Math.min(chunk.length, st.size - pos), pos);
      if (n <= 0) break;
      pos += n;
      const text = carry + dec.write(chunk.subarray(0, n));
      let start = 0, nl;
      while ((nl = text.indexOf('\n', start)) >= 0) {
        handle(text.slice(start, nl));
        start = nl + 1;
      }
      carry = text.slice(start);
    }
  } finally { fs.closeSync(fd); }
  // leave a trailing partial line for the next scan
  f.offset = pos - Buffer.byteLength(carry, 'utf8');
  f.size = st.size;
  f.mtime = st.mtimeMs;
  const cut = hourKey(Date.now() - 8 * 86400e3);
  for (const k of Object.keys(f.hours)) if (k < cut) delete f.hours[k];
  return true;
}

let dirty = false;
function save() {
  if (!dirty) return;
  try {
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    const tmp = CACHE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cache));
    fs.renameSync(tmp, CACHE);
    dirty = false;
  } catch (e) { parentPort.postMessage({ type: 'log', msg: 'could not write cache: ' + e.message }); }
}

// Model calls that leave no transcript but log their own cost: one JSON object per line, { ts, <key>: usd }.
// They are counted as the model "hooks" and the project "hooks (claude -p)".
const EXTRA_MODEL = 'hooks', EXTRA_PROJECT = 'hooks (claude -p)';
const extraCache = new Map();   // file -> { size, mtime, rows: [[ts, usd]] }
function extraRows() {
  const rows = [];
  for (const { file, key } of EXTRA_LOGS) {
    let st;
    try { st = fs.statSync(file); } catch { continue; }
    let e = extraCache.get(file);
    if (!e || e.size !== st.size || e.mtime !== st.mtimeMs) {
      e = { size: st.size, mtime: st.mtimeMs, rows: [] };
      let text = '';
      try { text = fs.readFileSync(file, 'utf8'); } catch { /* unreadable: no rows */ }
      for (const line of text.split('\n')) {
        let r;
        try { r = JSON.parse(line); } catch { continue; }
        const ts = Date.parse(r.ts), usd = Number(r[key]);
        if (ts && usd > 0) e.rows.push([ts, usd]);
      }
      extraCache.set(file, e);
    }
    rows.push(...e.rows);
  }
  return rows;
}

function summary() {
  // Group files by project (cwd); totals per day / hour / model.
  const days = {}, hours = {}, projects = {}, models = {}, files = {};
  let total = 0;
  for (const [file, f] of Object.entries(cache.files)) {
    const proj = f.cwd ? path.basename(f.cwd) : path.basename(path.dirname(file.includes(path.sep + 'subagents' + path.sep) ? path.dirname(path.dirname(file)) : file));
    files[file] = f.total * K;
    total += f.total * K;
    const p = projects[proj] || (projects[proj] = { usd: 0, out: 0, inp: 0, cr: 0, msgs: 0, last: 0, sessions: 0, cwd: f.cwd });
    if (!file.includes(path.sep + 'subagents' + path.sep)) p.sessions++;
    p.last = Math.max(p.last, f.last);
    for (const [d, byModel] of Object.entries(f.days)) {
      for (const [m, v] of Object.entries(byModel)) {
        const dd = days[d] || (days[d] = {});
        const r = dd[m] || (dd[m] = [0, 0, 0, 0, 0, 0, 0]);
        for (let i = 0; i < 7; i++) r[i] += i === 5 ? v[i] * K : v[i];
        const mm = models[m] || (models[m] = [0, 0, 0, 0, 0, 0, 0]);
        for (let i = 0; i < 7; i++) mm[i] += i === 5 ? v[i] * K : v[i];
        p.usd += v[5] * K; p.out += v[1]; p.inp += v[0] + v[2] + v[3]; p.cr += v[4]; p.msgs += v[6];
      }
    }
    for (const [h, byModel] of Object.entries(f.hours)) {
      let s = 0;
      for (const v of Object.values(byModel)) s += v[5] * K;
      hours[h] = (hours[h] || 0) + s;
    }
  }
  const extra = extraRows();
  if (extra.length) {
    const cut = hourKey(Date.now() - 8 * 86400e3);
    const pr = projects[EXTRA_PROJECT] = { usd: 0, out: 0, inp: 0, cr: 0, msgs: 0, last: 0, sessions: 0, cwd: '' };
    const mm = models[EXTRA_MODEL] = [0, 0, 0, 0, 0, 0, 0];
    for (const [ts, list] of extra) {
      const usd = list * K;
      const dd = days[dayKey(ts)] || (days[dayKey(ts)] = {});
      const r = dd[EXTRA_MODEL] || (dd[EXTRA_MODEL] = [0, 0, 0, 0, 0, 0, 0]);
      r[5] += usd; r[6] += 1;
      mm[5] += usd; mm[6] += 1;
      const hk = hourKey(ts);
      if (hk >= cut) hours[hk] = (hours[hk] || 0) + usd;
      pr.usd += usd; pr.msgs += 1; pr.last = Math.max(pr.last, ts);
      total += usd;
    }
  }
  const pricing = {
    label: VERTEX ? 'Vertex AI list prices (Global endpoint)' : 'Anthropic API list prices',
    fetched: VERTEX && VERTEX.fromFile ? VERTEX.fetched : 0,
    builtin: !!VERTEX && !VERTEX.fromFile,
    stale: !!VERTEX && (!VERTEX.fromFile || Date.now() - VERTEX.fetched > 8 * 86400e3),
    discount: DISCOUNT,
    hookCalls: extra.length,
  };
  return { total, days, hours, projects, models, files, pricing, unpriced: Object.keys(models).filter(m => m !== EXTRA_MODEL && !rateOf(m, 0)) };
}

// Re-read the price file when it changed. A different price table invalidates the cached dollar figures, so every
// transcript is read again (tokens are cached per message tier, dollars are not recomputable from day totals).
function refreshPrices() {
  if (PRICES_FILE) {
    let m = 0;
    try { m = fs.statSync(PRICES_FILE).mtimeMs; } catch { /* missing: built-in table */ }
    if (!VERTEX || m !== vertexMtime) { VERTEX = loadVertex(PRICES_FILE); vertexMtime = m; }
  }
  const sig = crypto.createHash('sha1').update(JSON.stringify(VERTEX ? VERTEX.table : API_PRICES.map(String))).digest('hex').slice(0, 12);
  if (cache.sig !== sig) { cache = { version: VERSION, sig, files: {}, seen: {} }; dirty = true; }
}

let scanning = false;
function scan(first) {
  if (scanning) return;
  scanning = true;
  refreshPrices();
  const t0 = Date.now();
  const list = listFiles();
  const todo = [];
  let totalBytes = 0;
  for (const file of list) {
    let st;
    try { st = fs.statSync(file); } catch { continue; }
    const f = cache.files[file];
    if (f && f.size === st.size && f.offset >= st.size - 1) continue;
    todo.push([file, st]);
    totalBytes += st.size - (f && st.size >= f.offset ? f.offset : 0);
  }
  const known = new Set(list);
  for (const k of Object.keys(cache.files)) if (!known.has(k) && !fs.existsSync(k)) { /* keep the historical cost of deleted files */ }
  if (todo.some(([file, st]) => cache.files[file] && st.size < cache.files[file].offset)) {
    // A transcript shrank (rewritten). Its message ids are shared with other files, so read everything again.
    cache = { version: VERSION, sig: cache.sig, files: {}, seen: {} };
    dirty = true;
    todo.length = 0;
    totalBytes = 0;
    for (const file of list) { try { const st = fs.statSync(file); todo.push([file, st]); totalBytes += st.size; } catch { /* gone */ } }
  }
  let done = 0, bytes = 0, lastPost = 0;
  for (const [file, st] of todo) {
    const before = cache.files[file] ? cache.files[file].offset : 0;
    try { if (scanFile(file, st)) dirty = true; } catch (e) { parentPort.postMessage({ type: 'log', msg: `${file}: ${e.message}` }); }
    done++;
    bytes += st.size - (st.size >= before ? before : 0);
    if (Date.now() - lastPost > 700) {
      lastPost = Date.now();
      parentPort.postMessage({ type: 'progress', done, total: todo.length, bytes, totalBytes, first });
      if (first && done % 200 === 0) save();
    }
  }
  save();
  parentPort.postMessage({ type: 'summary', data: summary(), scannedAt: Date.now(), took: Date.now() - t0, changed: todo.length, first });
  scanning = false;
}

refreshPrices();
parentPort.postMessage({ type: 'summary', data: summary(), scannedAt: 0, took: 0, changed: 0, first: true, cached: true });
scan(true);
setInterval(() => scan(false), RESCAN_MS);
