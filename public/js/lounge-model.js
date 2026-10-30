// What the lounge of the 3D office shows, as data: turns the answer of GET /api/lounge into the wall (the last posts), the people (who has posted lately), the sign
// of each state, the activity that drives the ambient pulse, and the rows of the card. Pure (no DOM, no three.js, no clock of its own), so node can test it
// (test/lounge-model.test.mjs); ofis-lounge.js draws what this decides and lounge-source.js fetches the data.
//
//   cleanText(value, max)      the one function every text goes through: only strings, control characters and bidi marks removed, blanks collapsed, clipped by
//                              characters (grapheme clusters, never bytes and never half a surrogate pair) with an ellipsis that counts inside `max`
//   normalizePayload(raw)      the answer of the endpoint as { state: { state, schema, reason }, messages, channels, agents }; every field may be missing and a field of
//                              the wrong type is ignored, nothing here throws
//   buildView(data, opts)      the view: sign, wall rows, people, activity, card rows, and `key` (changes exactly when what is painted changes). When the endpoint fails (a 500, a
//                              timeout, an answer that is not JSON) the board is `failed`, not `off`: with no good answer in hand it says "not answering", with old posts in hand it keeps
//                              them, dimmed (`view.stale`), once the last good answer is older than `staleMs`
//   ageText(ms), splitLines(text), chipColour(name), personColour(name)
//
// The endpoint (chat-source.js, docs/chat-source.md; the real answer is checked in test/lounge-model.test.mjs):
//   GET /api/lounge -> { state: { state: 'ok' | 'off' | 'unsupported', schema, reason }, messages: [{ seq, ts, channel, from, to: [names], text }] (newest last, text clipped to
//   400 characters), channels: { <name>: <count> } or [{ name, count }], agents: [{ name, lastSeenMs, session, office }] } (office: the Office chat the board agent belongs to, or empty).
// `ts` is epoch milliseconds. `lastSeenMs` is read as epoch milliseconds, or, when it is smaller than 1e11 (that would be 1973), as the milliseconds since the agent was seen.

export const LIMITS = Object.freeze({
  wallRows: 8,                 // posts on the wall, newest at the bottom
  wallText: 90,                // characters of a post on the wall
  lineChars: 46,               // characters of one line of it (two lines at the most: 2 x 46 holds 90)
  cardRows: 20,                // posts in the card
  cardText: 400,               // characters of a post in the card
  people: 6,                   // people in the lounge
  postedMs: 10 * 60e3,         // "posted lately": inside the lounge for ten minutes after the last post
  quietMs: 60 * 60e3,          // quiet: no post for an hour
  pulseMs: 60e3,               // activity: the posts of the last minute
  pulseFull: 6,                // this many posts in a minute is the full pulse
  staleMs: 10e3,               // the endpoint has not answered for this long (a few polls): the posts on the wall are old news and are shown so
  signText: 60,                // characters of the newest post on the sign over the wall
  name: 24, channel: 20, session: 80, reason: 160, schema: 40,
  inMessages: 200,             // of a long answer only the newest ones are read
  inAgents: 100, inChannels: 50, inTo: 12,
});

// ------------------------------------------------------------ text

const SPACES = /[\t\n\r\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/g;           // blanks of every kind: one space
const CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;                              // what is left of the control characters
// invisible characters that change how a line reads or looks like another: bidi marks (LRM, RLM, ALM, the embeddings, overrides and isolates), zero-width space, word joiner and
// the invisible operators, the byte order mark, the soft hyphen, the Mongolian vowel separator, the interlinear annotation marks. ZWJ and ZWNJ stay: emoji sequences need them.
const INVISIBLES = /[\u00AD\u061C\u180E\u200B\u200E\u200F\u202A-\u202E\u2060-\u206F\uFEFF\uFFF9-\uFFFB]/g;
// a stack of more than three combining marks on one letter ('zalgo') draws a smear over the lines above and below it: three are kept
const STACKS = /(\p{M}{3})\p{M}+/gu;
const segmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const charsOf = s => (segmenter ? Array.from(segmenter.segment(s), x => x.segment) : Array.from(s));

// `s` cut to `max` characters, the last one an ellipsis when something was cut. A character is a grapheme cluster (an emoji with its skin tone is one), and the cost does
// not grow with the length of a huge string: only the head that can matter is segmented.
export function clipChars(s, max) {
  s = String(s);
  if (!(max >= 1) || s.length <= max) return s;                              // UTF-16 units are never fewer than characters: it fits
  const head = s.slice(0, max * 16 + 16), a = charsOf(head);
  if (a.length <= max && head.length === s.length) return s;
  return a.slice(0, max - 1).join('').replace(/[\ud800-\udbff]$/, '').trimEnd() + '…';
}

export function cleanText(value, max = Infinity) {
  if (typeof value !== 'string') return '';
  let s = value.length > 20000 ? value.slice(0, 20000) : value;             // a hostile answer: nothing past this can show anyway
  if (typeof s.toWellFormed === 'function') s = s.toWellFormed();
  s = s.replace(INVISIBLES, '').replace(SPACES, ' ').replace(CONTROLS, '').replace(/ {2,}/g, ' ').replace(STACKS, '$1').trim();
  return max === Infinity ? s : clipChars(s, max);
}

// How old, in one unit: "now" under a minute (so a wall does not repaint every second), then 1m, 59m, 1h, 23h, 1d. An age that is not a number is "".
export function ageText(ms, nowLabel = 'now') {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  const s = Math.floor(Math.max(0, ms) / 1000);
  if (s < 60) return nowLabel;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// The text of a post as one or two lines of at most `width` characters each: one line when it fits, else cut at the last blank that leaves both halves short enough, else
// in the middle of a word. A text of at most 2 x width characters always fits in two lines.
export function splitLines(text, width = LIMITS.lineChars) {
  const a = charsOf(String(text || ''));
  if (a.length <= width) return a.length ? [a.join('')] : [];
  const lo = Math.max(1, a.length - width);
  let cut = -1;
  for (let i = Math.min(width, a.length - 1); i >= lo; i--) if (a[i] === ' ') { cut = i; break; }
  if (cut < 0) { const hard = Math.min(width, a.length); return [a.slice(0, hard).join(''), a.slice(hard).join('').trim()].filter(Boolean); }
  return [a.slice(0, cut).join('').trim(), a.slice(cut + 1).join('').trim()];
}

// ------------------------------------------------------------ colours (hex), by name, the same name always the same colour

const h32 = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const hsl = (h, s, l) => {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + [f(0), f(8), f(4)].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
};
export const chipColour = name => hsl(h32(String(name || '').toLowerCase()) % 360, 62, 62);
export const personColour = name => hsl((h32(String(name || '').toLowerCase()) >>> 3) % 360, 38, 52);

// ------------------------------------------------------------ the answer of the endpoint

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const STATES = ['ok', 'off', 'unsupported'];

export function normalizePayload(raw) {
  const out = { normalized: true, state: { state: 'off', schema: '', reason: '' }, messages: [], channels: {}, agents: [] };
  if (!isObj(raw)) { out.state.reason = 'unreadable answer'; return out; }
  const st = isObj(raw.state) ? raw.state : typeof raw.state === 'string' ? { state: raw.state } : {};
  const listed = Array.isArray(raw.messages);
  const wanted = typeof st.state === 'string' ? st.state.trim().toLowerCase() : '';
  out.state = {
    state: STATES.includes(wanted) ? wanted : listed ? 'ok' : 'off',                // no usable state: a list of posts means it works, nothing means it is off
    schema: cleanText(st.schema, LIMITS.schema), reason: cleanText(st.reason, LIMITS.reason),
  };
  if (listed) {
    const tail = raw.messages.length > LIMITS.inMessages ? raw.messages.slice(-LIMITS.inMessages) : raw.messages;
    tail.forEach((m, i) => {
      if (!isObj(m)) return;
      const to = [];
      const names = Array.isArray(m.to) ? m.to : typeof m.to === 'string' ? m.to.slice(0, 2000).split(',') : [];          // a list, or the comma-separated text the board stores
      for (const n of names.slice(0, LIMITS.inTo)) { const c = cleanText(n, LIMITS.name); if (c) to.push(c); }
      out.messages.push({
        seq: num(m.seq) ?? i, ts: num(m.ts) > 0 ? m.ts : 0, channel: cleanText(m.channel, LIMITS.channel), from: cleanText(m.from, LIMITS.name) || '?', to,
        text: cleanText(m.text, LIMITS.cardText), at: i,
      });
    });
    out.messages.sort((a, b) => (a.ts && b.ts ? a.ts - b.ts : 0) || a.at - b.at);
    for (const m of out.messages) delete m.at;
  }
  // channels: { name: count }, or the list the chat source answers with, [{ name, count }]
  const chans = isObj(raw.channels) ? Object.entries(raw.channels) : Array.isArray(raw.channels) ? raw.channels.filter(isObj).map(c => [c.name, c.count]) : [];
  for (const [k, v] of chans.slice(0, LIMITS.inChannels)) { const name = cleanText(k, LIMITS.channel), n = num(v); if (name && n != null && n >= 0) out.channels[name] = n; }
  if (Array.isArray(raw.agents)) {
    for (const a of raw.agents.slice(0, LIMITS.inAgents)) {
      if (!isObj(a)) continue;
      const name = cleanText(a.name, LIMITS.name);
      // `office` is the id of the Office chat the board agent belongs to (the chat source's answer); `session` is its own session id, which the Office may not have
      if (name) out.agents.push({ name, lastSeenMs: num(a.lastSeenMs), session: cleanText(a.office, LIMITS.session) || cleanText(a.session, LIMITS.session) });
    }
  }
  return out;
}

// ------------------------------------------------------------ the view

// the age of an agent's last sighting: lastSeenMs as epoch milliseconds, or as an age when it is too small to be a date
export const seenAge = (lastSeenMs, now) => (lastSeenMs == null ? Infinity : lastSeenMs >= 1e11 ? Math.max(0, now - lastSeenMs) : Math.max(0, lastSeenMs));

const T0 = (t, key, p, fallback) => { try { const v = typeof t === 'function' ? t(key, p) : key; return typeof v === 'string' && v !== key ? v : fallback; } catch { return fallback; } };

// data: normalizePayload's result, or null when nothing has arrived yet (then the state is `off`); a raw answer is normalized first
// opts: { now (epoch ms), mode ('text' | 'names' | 'off'), source ('live' | 'demo'), t (message lookup), sessionInfo(id) -> { name, color } | null (the Office's own chat, or null when it is not there),
//         status ('none' | 'ok' | 'nofile' | 'failed': how the last request went), lastOkMs (epoch ms of the last answer that worked, or null) }
export function buildView(data, opts = {}) {
  const now = num(opts.now) ?? 0, mode = opts.mode === 'names' || opts.mode === 'off' ? opts.mode : 'text', source = opts.source === 'demo' ? 'demo' : 'live', t = opts.t;
  const info = typeof opts.sessionInfo === 'function' ? id => { try { return opts.sessionInfo(id); } catch { return null; } } : () => null;
  const tt = (key, fallback, p) => T0(t, key, p, fallback);
  const title = tt('lounge.title', 'Agent lounge');
  const hidden = mode === 'off';
  const d = data && data.normalized === true ? data : normalizePayload(data);           // anything else is read as an answer of the endpoint
  const lastOk = num(opts.lastOkMs), failedNow = opts.status === 'failed';
  const downMs = failedNow && lastOk != null ? Math.max(0, now - lastOk) : null;        // how long the endpoint has not answered (null: it never did)
  const down = failedNow && (downMs == null || downMs > LIMITS.staleMs);              // one missed poll is a blip: the wall stays as it was
  const oldPosts = d.state.state === 'ok' && d.messages.some(m => m.ts && now - m.ts <= LIMITS.quietMs);
  const stale = !hidden && down && oldPosts;                                           // old posts still on the wall, dimmed
  const state = hidden ? 'hidden' : down && !oldPosts ? 'failed' : d.state.state;       // nothing to keep showing: the board says it does not answer
  const msgs = state === 'ok' ? d.messages : [];
  const inHour = msgs.filter(m => m.ts && now - m.ts <= LIMITS.quietMs).length;
  const quiet = state === 'ok' && inHour === 0;
  const nowLabel = tt('lounge.now', 'now');
  const downAge = downMs == null ? '' : ageText(downMs, tt('lounge.ago.under', 'under 1m'));

  // sign: what the board says when it has no posts to show, and the line over it
  const sign = { title, show: !hidden, tone: 'ok', text: '', hint: '', latest: '' };
  if (state === 'off') { sign.tone = 'off'; sign.text = tt('lounge.off', 'Agent message board is off'); sign.hint = tt('lounge.offHint', 'Start the server with --chat-db <file> to show it.'); }
  else if (state === 'unsupported') {
    sign.tone = 'warn'; sign.text = tt('lounge.unsupported', 'Message board format not recognised');
    sign.hint = d.state.reason || (d.state.schema ? tt('lounge.schema', 'Schema: {schema}', { schema: d.state.schema }) : '');
  } else if (state === 'failed') {
    sign.tone = 'warn'; sign.text = tt('lounge.failed', 'Message board not answering');
    sign.hint = downAge ? tt('lounge.failedHintAge', `Last answer: ${downAge} ago. Trying again every 3 seconds.`, { age: downAge }) : tt('lounge.failedHint', 'The server did not answer GET /api/lounge. Trying again every 3 seconds.');
  } else if (quiet) { sign.tone = 'quiet'; sign.text = tt('lounge.quiet', 'No posts in the last hour'); }
  else if (stale) { sign.tone = 'warn'; sign.text = tt('lounge.stale', `Old posts: last answer ${downAge} ago`, { age: downAge }); }
  else if (state === 'ok') sign.text = tt('lounge.posts', `${inHour} posts in the last hour`, { n: inHour });

  const shaped = (m, limit, lines) => {
    const text = mode === 'text' ? clipChars(m.text, limit) : '';
    const who = m.to.length ? tt('lounge.who', `${m.from} to ${m.to.slice(0, 3).join(', ')}${m.to.length > 3 ? ` +${m.to.length - 3}` : ''}`, { from: m.from, to: m.to.slice(0, 3).join(', ') + (m.to.length > 3 ? ` +${m.to.length - 3}` : '') }) : m.from;
    return {
      seq: m.seq, ts: m.ts, chip: m.channel, chipColour: chipColour(m.channel), from: m.from, to: m.to, who, text, lines: lines ? splitLines(text) : [],
      age: m.ts ? ageText(now - m.ts, nowLabel) : '', ageMs: m.ts ? Math.max(0, now - m.ts) : null,
    };
  };

  // the wall: the last posts, newest at the bottom (none when the board has a sign to show instead, or the lounge is off)
  const showRows = state === 'ok' && !quiet;
  const wallRows = showRows ? msgs.slice(-LIMITS.wallRows).map(m => shaped(m, LIMITS.wallText, true)) : [];
  // the newest post on the sign over the wall: the pill is the one surface of the lounge that stays readable at any zoom, so it carries the headline (not while the posts are old news)
  const newest = wallRows.at(-1);
  if (newest && !stale) sign.latest = newest.text ? `${newest.who}: ${clipChars(newest.text, LIMITS.signText)}` : newest.who;

  // the people: whoever posted in the last ten minutes (or was seen), the freshest first, at most six, each tied to its Office chat when it has one
  const seen = new Map();                                                    // lower-case name -> { name, last (age ms), session }
  const note = (name, age, session) => {
    const k = name.toLowerCase(), cur = seen.get(k);
    if (!cur) seen.set(k, { name, age, session: session || '' });
    else { if (age < cur.age) cur.age = age; if (!cur.session && session) cur.session = session; }
  };
  if (state === 'ok') {
    for (const m of msgs) if (m.ts && now - m.ts <= LIMITS.postedMs && m.from !== '?') note(m.from, Math.max(0, now - m.ts), '');
    for (const a of d.agents) { const age = seenAge(a.lastSeenMs, now); if (age <= LIMITS.postedMs) note(a.name, age, a.session); else if (seen.has(a.name.toLowerCase()) && a.session) note(a.name, Infinity, a.session); }
  }
  const people = [...seen.values()].sort((a, b) => a.age - b.age || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).slice(0, LIMITS.people).map(p => {
    const session = p.session && info(p.session) ? p.session : '', s = session ? info(session) : null;
    return { key: p.name.toLowerCase(), name: p.name, session, tied: !!session, sessionName: s ? cleanText(s.name, 60) : '', color: s && s.color ? s.color : personColour(p.name), seenMs: p.age === Infinity ? null : p.age };
  });

  // the pulse: posts in the last minute, 0 to 1
  const last = msgs.filter(m => m.ts && now - m.ts <= LIMITS.pulseMs).length;
  const activity = { posts: last, level: Math.min(1, last / LIMITS.pulseFull) };

  // the card: the last twenty posts, newest first (no text in the mode `names`), where the data comes from
  const cardRows = state === 'ok' ? msgs.slice(-LIMITS.cardRows).reverse().map(m => shaped(m, LIMITS.cardText, false)) : [];
  const status = opts.status || 'none';
  const sourceLine = hidden ? tt('lounge.src.hidden', 'The lounge is switched off (setting lounge=off): nothing is fetched. Use ?lounge=text or ?lounge=names to show it.')
    : source === 'demo' ? tt('lounge.src.demo', 'Data: the built-in demo script (?lounge=demo), not your agents.')
      : status === 'nofile' ? tt('lounge.src.none', 'No data: this server has no /api/lounge endpoint.')
        : down && stale ? tt('lounge.src.stale', 'GET /api/lounge is not answering (an error, a timeout or a reply that is not JSON). The posts shown are from its last good answer; asking again every 3 seconds.')
          : down ? tt('lounge.src.failed', 'GET /api/lounge is not answering (an error, a timeout or a reply that is not JSON): asking again every 3 seconds.')
        : tt('lounge.src.live', 'Data: GET /api/lounge, the server’s read-only chat bridge (--chat-db), every 3 seconds while this view is on screen.');
  const channels = Object.entries(d.channels).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 6).map(([name, n]) => ({ name, n, colour: chipColour(name) }));
  const card = { title, rows: cardRows, posts: inHour, channels, source: sourceLine, sign, namesOnly: mode === 'names', people: people.map(p => p.name), hidden };

  // what is painted on the wall: when this string changes the canvas is painted again (the ages are in it as text, so they repaint once a minute and not once a second)
  const key = JSON.stringify([mode, state, stale, sign.text, sign.hint, wallRows.map(r => [r.seq, r.chip, r.who, r.lines, r.age])]);
  return { mode, source, state, quiet, stale, sign, wall: { rows: wallRows, showText: mode === 'text' }, people, activity, card, key, now };
}
