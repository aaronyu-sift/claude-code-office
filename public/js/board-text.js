// The words on a room's board: the wall plaque and the HTML sign of the 3D scene, and the board of the pixel scene. Pure functions (no DOM, no clock), so the
// rules are tested in Node and both scenes say the same thing.
//   The CHAT NAME is the big text. The PROJECT folder is small, in the bottom-right corner of the board, and only when the setting `project` is on (it is off
//   by default, pixel/settings.js); it is never bigger than the name.
//
//   boardName(a)               the chat name: its own name (custom title or agent name), else the AI title, else the project folder, else ''
//   boardProject(a)            the project folder for the corner, or '' when it is empty or would only repeat the name
//   boardBadges(status, n)     the chips a board carries: your turn, needs an answer, asleep, "+n" more working agents
//   clipText(text, max)        at most `max` characters (whole code points) with an ellipsis
//   wrapLines(text, measure, width, maxLines)   greedy word wrap into at most `maxLines` lines; what does not fit ends the last line with an ellipsis
//   fitName(text, measureAt, box)               the biggest type size at which the name fits the box on one line, else on two
// `a` is an agent as the server reports it ({ name, title, project, ... }).

const squeeze = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

export const boardName = a => (a ? squeeze(a.name) || squeeze(a.title) || squeeze(a.project) : '');
export function boardProject(a) {
  const p = a ? squeeze(a.project) : '';
  return p && p !== boardName(a) ? p : '';
}

// A status chip is { kind, key (language key of its words, when it has words) or text }; the first one is the most important.
export function boardBadges(status, overflow = 0) {
  const out = [];
  if (status === 'waiting') out.push({ kind: 'wait', key: 'of.badgeWait' });
  else if (status === 'ask') out.push({ kind: 'ask', key: 'of.badgeAsk' });
  else if (status === 'dormant') out.push({ kind: 'sleep', key: 'of.badgeSleep' });
  if (overflow > 0) out.push({ kind: 'more', text: `+${overflow}` });
  return out;
}

export function clipText(text, max) {
  const chars = [...squeeze(text)];
  if (chars.length <= max) return chars.join('');
  return max < 2 ? '' : chars.slice(0, max - 1).join('').trimEnd() + '…';
}

// the longest start of `s` that fits `width` once an ellipsis is added ('' when not even one character does)
function ellipsize(measure, s, width) {
  if (measure(s) <= width) return s;
  const chars = [...s];
  let lo = 0, hi = chars.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measure(chars.slice(0, mid).join('').trimEnd() + '…') <= width) lo = mid; else hi = mid - 1;
  }
  return lo ? chars.slice(0, lo).join('').trimEnd() + '…' : '';
}

// `measure(string)` is the width of a string in the unit of `width`. A word wider than a line is broken between characters (a name with no spaces, or in a
// script without them, still wraps); more text than `maxLines` lines hold is cut with an ellipsis at the end of the last line.
export function wrapLines(text, measure, width, maxLines = 2) {
  const words = squeeze(text).split(' ').filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const joined = cur ? cur + ' ' + w : w;
    if (measure(joined) <= width) { cur = joined; continue; }
    if (cur) { lines.push(cur); cur = ''; }
    if (measure(w) <= width) { cur = w; continue; }
    for (const ch of w) {
      if (cur && measure(cur + ch) > width) { lines.push(cur); cur = ''; }
      cur += ch;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return { lines, truncated: false };
  const head = lines.slice(0, maxLines - 1);
  return { lines: [...head, ellipsize(measure, lines.slice(maxLines - 1).join(' '), width)], truncated: true };
}

// box: { w, h (the room for the name), big (the size a short name gets), oneMin (the smallest size for one line), twoMin (the smallest size for two lines),
// lead (line height as a multiple of the size, 1.1), step }. `measureAt(size)` gives the `measure` function of that size. Returns { fs, lines, truncated }:
// a name that does not fit even at `twoMin` keeps two lines and the second one ends with an ellipsis.
export function fitName(text, measureAt, { w, h, big, oneMin, twoMin, lead = 1.1, step = 4 }) {
  for (let fs = big; fs >= oneMin; fs -= step) {
    const r = wrapLines(text, measureAt(fs), w, 1);
    if (!r.truncated && fs * lead <= h) return { fs, lines: r.lines, truncated: false };
  }
  let fs = Math.min(oneMin, Math.floor(h / (2 * lead)));
  for (; fs > twoMin; fs -= step) {
    const r = wrapLines(text, measureAt(fs), w, 2);
    if (!r.truncated) return { fs, lines: r.lines, truncated: false };
  }
  fs = Math.max(twoMin, Math.min(fs, Math.floor(h / (2 * lead))));
  const r = wrapLines(text, measureAt(fs), w, 2);
  return { fs, lines: r.lines, truncated: r.truncated };
}
