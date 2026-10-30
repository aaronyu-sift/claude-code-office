// The face of the message wall of the lounge, painted on a 2D canvas (ofis-lounge.js puts it on the board as a texture). It takes the view of lounge-model.js and draws what
// the view says, nothing else: no text of its own except what the view carries, so the wall can only show what the model allowed (cleaned, clipped, in the mode chosen).
// It needs only a 2D context, so node can paint with a recording context and look at the result (test/lounge-paint.test.mjs).
//
//   CANVAS                      the size of the texture
//   paintWall(g, view, opts)    paints the wall; returns { texts, rows, scale }: every string it drew in order (the QA reads the wall through this and through the browser's own
//                               fillText), the rows as drawn (seq, y, height), and the scale the text had to shrink to so that eight rows of two lines fit
//     opts.progress (0..1)      how far the arrival of new posts has come (1: at rest): the posts that are new fade in, the others move up by the room they make
//     opts.added (Set of seq)   the posts that are new in this paint
//     opts.night (0..1)         how far the night is on: the panel is a little brighter against a dark sky
import { clipChars } from './lounge-model.js';

export const CANVAS = Object.freeze({ w: 2048, h: 688 });

// a CSS cubic-bezier(...) easing as a function of the progress 0..1 (the one of motion.js EASE.out moves the arrival of a post); the string of a rule that is not a bezier gives the identity
export function cubicBezier(str) {
  const m = /cubic-bezier\(([^)]+)\)/.exec(String(str || ''));
  const p = m ? m[1].split(',').map(Number) : [];
  if (p.length !== 4 || p.some(v => !Number.isFinite(v))) return x => Math.min(1, Math.max(0, x));
  const [x1, y1, x2, y2] = p, cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = t => ((ax * t + bx) * t + cx) * t, Y = t => ((ay * t + by) * t + cy) * t, dX = t => (3 * ax * t + 2 * bx) * t + cx;
  return x => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 10; i++) { const e = X(t) - x; if (Math.abs(e) < 1e-6) break; const d = dX(t); if (Math.abs(d) < 1e-6) break; t -= e / d; }
    let lo = 0, hi = 1;                                                                              // Newton can miss on a steep start: bisect when it did
    if (Math.abs(X(t) - x) > 1e-4 || t < 0 || t > 1) { t = x; for (let i = 0; i < 40; i++) { if (X(t) < x) lo = t; else hi = t; t = (lo + hi) / 2; } }
    return Y(t);
  };
}
const SANS = '"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const INK = { title: '#8fb0ff', main: '#eef1ff', text: '#cdd5f2', muted: '#8f9bc0', quiet: '#8fb0ff', off: '#a9b3d6', warn: '#fab219', ok: '#6ee7a0' };

const BASE = { text: 44, line: 50, who: 34, chip: 25, age: 28, pad: 14 };
const X = { chip: 44, who: 292, text: 800, ageRight: CANVAS.w - 44 };            // the columns
const TOP = 78, BOTTOM = 20;                                                        // the header and the bottom margin
const MIN_SCALE = 0.55;

const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255}, ${n >> 8 & 255}, ${n & 255}, ${a})`; };
const roundRect = (g, x, y, w, h, r) => {
  g.beginPath();
  if (typeof g.roundRect === 'function') g.roundRect(x, y, w, h, r);
  else { g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
};
// the text cut so that it is not wider than `max` pixels (an ellipsis in place of the rest)
function fit(g, s, max) {
  if (!s || g.measureText(s).width <= max) return s;
  let lo = 1, hi = Array.from(s).length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (g.measureText(clipChars(s, mid)).width <= max) lo = mid; else hi = mid - 1; }
  return clipChars(s, lo);
}
// the height of a row: its lines, or the one line of the names mode
const rowHeight = (r, k) => Math.max(1, r.lines.length) * BASE.line * k + BASE.pad * k;

export function paintWall(g, view, { progress = 1, added = null, night = 0 } = {}) {
  const { w: W, h: H } = CANVAS, texts = [], rows = [];
  const say = (s, x, y) => { texts.push(s); g.fillText(s, x, y); };
  g.save();
  g.clearRect(0, 0, W, H);
  // the panel: a dark slate with a lighter edge, a little brighter at night so that it reads against the dark
  const lift = 0.04 * night;
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#1d2539'); bg.addColorStop(1, '#131a2b');
  g.fillStyle = bg; roundRect(g, 0, 0, W, H, 26); g.fill();
  g.lineWidth = 6; g.strokeStyle = rgba('#8fb0ff', 0.22 + lift); roundRect(g, 3, 3, W - 6, H - 6, 24); g.stroke();
  if (view.state === 'hidden') { g.restore(); return { texts, rows, scale: 1 }; }          // the lounge is switched off: a dark panel and nothing on it

  g.textBaseline = 'alphabetic';
  // the header: the name of the lounge and, when posts are shown, how many there were in the last hour
  g.font = `700 25px ${MONO}`; g.fillStyle = INK.title;
  if ('letterSpacing' in g) g.letterSpacing = '3px';
  say(String(view.sign.title || '').toUpperCase(), X.chip, 50);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  const list = view.wall.rows;
  if (view.state === 'ok' && list.length && view.sign.text) {
    g.font = `500 26px ${SANS}`; g.fillStyle = INK.muted; g.textAlign = 'right';
    say(view.sign.text, X.ageRight, 50);
    g.textAlign = 'left';
  }
  g.fillStyle = rgba('#8fb0ff', 0.16); g.fillRect(X.chip, 62, W - 2 * X.chip, 2);

  if (!list.length) {                                                                          // the board has a sign to show instead of posts
    const tone = INK[view.sign.tone] || INK.off, mid = TOP + (H - TOP - BOTTOM) / 2;
    g.textAlign = 'center'; g.fillStyle = tone; g.font = `600 66px ${SANS}`;
    say(fit(g, view.sign.text, W - 160), W / 2, mid - (view.sign.hint ? 6 : -22));
    if (view.sign.hint) { g.fillStyle = INK.off; g.font = `400 34px ${SANS}`; say(fit(g, view.sign.hint, W - 200), W / 2, mid + 58); }
    g.restore();
    return { texts, rows, scale: 1 };
  }

  // the rows: bottom-aligned, the newest at the bottom; when eight posts of two lines are too tall the text shrinks to fit (never below MIN_SCALE; then a row is cut)
  const avail = H - TOP - BOTTOM;
  let total = list.reduce((s, r) => s + rowHeight(r, 1), 0);
  const k = Math.max(MIN_SCALE, Math.min(1, avail / total));
  const heights = list.map(r => rowHeight(r, k));
  total = heights.reduce((s, v) => s + v, 0);
  const isNew = r => !!added && added.has(r.seq);
  const grow = list.reduce((s, r, i) => s + (isNew(r) ? heights[i] : 0), 0);
  const shift = grow * (1 - progress);                                                          // the old posts are still this much lower while the new ones arrive
  g.beginPath(); g.rect(10, TOP - 6, W - 20, H - TOP - 8); g.clip();
  let y = H - BOTTOM - total;
  list.forEach((r, i) => {
    const h = heights[i], newer = isNew(r), alpha = newer ? progress : 1, dy = newer ? (1 - progress) * 14 * k : shift;
    const yy = y + dy, line = BASE.line * k, base = yy + (h - BASE.pad * k - (Math.max(1, r.lines.length) - 1) * line) / 2 + BASE.text * k * 0.36 - 2;
    rows.push({ seq: r.seq, y: yy, h });
    // the channel chip
    g.globalAlpha = alpha;
    const chipFont = `600 ${BASE.chip * k}px ${MONO}`;
    g.font = chipFont;
    const label = fit(g, r.chip || '·', 190 - 44), cw = g.measureText(label).width + 30, ch = BASE.chip * k + 14, cy = base - BASE.chip * k * 0.78 - 6;
    g.fillStyle = rgba(r.chipColour, 0.2); roundRect(g, X.chip, cy, cw, ch, ch / 2); g.fill();
    g.lineWidth = 2; g.strokeStyle = rgba(r.chipColour, 0.8); roundRect(g, X.chip, cy, cw, ch, ch / 2); g.stroke();
    g.fillStyle = r.chipColour; say(label, X.chip + 15, base - 1);
    // who writes to whom
    g.font = `600 ${BASE.who * k}px ${SANS}`; g.fillStyle = INK.main;
    say(fit(g, r.who, (view.wall.showText ? X.text - X.who - 40 : X.ageRight - X.who - 200)), X.who, base);
    // the text, one or two lines
    g.font = `400 ${BASE.text * k}px ${SANS}`; g.fillStyle = INK.text;
    r.lines.forEach((ln, j) => say(fit(g, ln, X.ageRight - X.text - 130), X.text, base + j * line));
    // how old
    if (r.age) { g.font = `500 ${BASE.age * k}px ${MONO}`; g.fillStyle = INK.muted; g.textAlign = 'right'; say(r.age, X.ageRight, base); g.textAlign = 'left'; }
    // the line between rows
    if (i < list.length - 1) { g.globalAlpha = alpha * 0.55; g.fillStyle = rgba('#8fb0ff', 0.1); g.fillRect(X.chip, yy + h - 2, W - 2 * X.chip, 1.5); }
    g.globalAlpha = 1;
    y += h;
  });
  g.restore();
  return { texts, rows, scale: k };
}
