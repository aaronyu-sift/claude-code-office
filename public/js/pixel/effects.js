// Status effects of the pixel scene, drawn in code with fillRect so they stay crisp at every integer zoom and cost nothing to load:
// the status marker (a small diamond over the main agent), balloons with a glyph, the light beam of an agent that waits for you,
// and the hover ring. No allocation per call: all shapes are precomputed numbers, colours are constant strings.

const OUT = '#2a1f3d';
const MARK = {                                      // [light, mid, dark]
  working: ['#9bf5df', '#2ec4a6', '#17806e'],
  waiting: ['#ffe9a3', '#ffb21f', '#d9740a'],
  ask: ['#ffe9a3', '#ffb21f', '#d9740a'],
  done: ['#b5dcff', '#4a9dff', '#2a64c4'],
  error: ['#ffb3b3', '#f05252', '#a82a2a'],
  dormant: ['#c7ccd8', '#8a93a6', '#5b6479'],
  stale: ['#c7ccd8', '#8a93a6', '#5b6479'],
};
const DIAMOND = [0, 1, 1, 2, 2, 3, 2, 2, 1, 1, 0];  // half widths per row (7 wide, 11 tall)

export function drawMarker(g, cx, top, status) {
  const c = MARK[status] || MARK.working;
  for (let pass = 0; pass < 2; pass++) {
    for (let r = 0; r < DIAMOND.length; r++) {
      const hw = DIAMOND[r] + (pass === 0 ? 1 : 0), y = top + r;
      if (pass === 0) { g.fillStyle = OUT; g.fillRect(cx - hw, y, hw * 2 + 1, 1); if (r === 0 || r === DIAMOND.length - 1) g.fillRect(cx - hw + 1, y + (r ? 1 : -1), hw * 2 - 1, 1); }
      else {
        g.fillStyle = c[1]; g.fillRect(cx - hw, y, hw * 2 + 1, 1);
        g.fillStyle = c[0]; g.fillRect(cx - hw, y, hw + (hw ? 0 : 1), 1);
        g.fillStyle = c[2]; if (hw) g.fillRect(cx + 1, y, hw, 1);
      }
    }
  }
}

// 5 x 7 glyphs as lists of [x, y]
const SRC = {
  '!': ['..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '?': ['.###.', '#...#', '...#.', '..#..', '.....', '..#..'],
  Z: ['#####', '...#.', '..#..', '.#...', '#####'],
  z: ['###', '.#.', '#..', '###'],
  check: ['.....#', '....#.', '#..#..', '.##...'],
};
const GLYPH = {};
for (const [k, rows] of Object.entries(SRC)) {
  const pts = [];
  rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === '#') pts.push(x, y); }));
  GLYPH[k] = { pts, w: Math.max(...rows.map(r => r.length)), h: rows.length };
}
const BAL = {                                       // [background, glyph colour]
  wait: ['#ffb21f', '#2a1f3d'], zz: ['#e8ecf5', '#5b6479'], done: ['#43c97c', '#ffffff'], think: ['#ffffff', '#4a5272'],
};

// A balloon with its tail tip at (cx, bottom). kind: 'wait' ('!' or '?'), 'zz', 'done'. Returns nothing.
export function drawBalloon(g, cx, bottom, kind, glyph = '!') {
  const [bg, fg] = BAL[kind] || BAL.think;
  const glyphs = kind === 'zz' ? ['Z', 'z'] : kind === 'done' ? ['check'] : [glyph];
  let gw = 0, gh = 0;
  for (const k of glyphs) { gw += GLYPH[k].w; gh = Math.max(gh, GLYPH[k].h); }
  gw += glyphs.length - 1;
  const w = gw + 6, h = gh + 5, x = cx - (w >> 1), y = bottom - 3 - h;
  g.fillStyle = OUT;
  g.fillRect(x - 1, y + 1, w + 2, h - 2); g.fillRect(x + 1, y - 1, w - 2, h + 2);
  g.fillRect(cx - 2, y + h + 1, 5, 1); g.fillRect(cx - 1, y + h + 2, 3, 1); g.fillRect(cx, y + h + 3, 1, 1);
  g.fillStyle = bg;
  g.fillRect(x, y + 1, w, h - 2); g.fillRect(x + 1, y, w - 2, h);
  g.fillRect(cx - 1, y + h, 3, 1); g.fillRect(cx, y + h + 1, 1, 1);
  g.fillStyle = fg;
  let gx = x + 3;
  for (const k of glyphs) {
    const G = GLYPH[k], yy = y + 2 + ((gh - G.h) >> 1) + (k === 'z' ? 1 : 0);
    for (let i = 0; i < G.pts.length; i += 2) g.fillRect(gx + G.pts[i], yy + G.pts[i + 1], 1, 1);
    gx += G.w + 1;
  }
}

// light cone from above down to the floor at (cx, floorY); pulse in 0..1 drives the glow
export function drawBeam(g, cx, floorY, height, pulse) {
  g.fillStyle = '#ffd36b';
  const a0 = 0.10 + 0.10 * pulse;
  for (let r = 0; r < height; r++) {
    const k = r / height, w = 6 + Math.round(k * 24);
    g.globalAlpha = a0 + 0.14 * k;
    g.fillRect(cx - (w >> 1), floorY - height + r, w, 1);
  }
  // pool of light on the floor: a flat diamond
  for (let r = -6; r <= 6; r++) {
    g.globalAlpha = (0.20 + 0.18 * pulse) * (1 - Math.abs(r) / 8);
    const hw = (6 - Math.abs(r)) * 3;
    g.fillRect(cx - hw, floorY + r, hw * 2 + 1, 1);
  }
  g.globalAlpha = 1;
}

// ring on the floor under a hovered figure
export function drawRing(g, cx, cy) {
  g.fillStyle = '#ffffff';
  for (let r = -6; r <= 6; r++) {
    const hw = (6 - Math.abs(r)) * 2 + 2;
    g.globalAlpha = 0.9;
    g.fillRect(cx - hw, cy + r, 2, 1); g.fillRect(cx + hw - 1, cy + r, 2, 1);
  }
  g.fillRect(cx - 2, cy - 7, 5, 1); g.fillRect(cx - 2, cy + 7, 5, 1);
  g.globalAlpha = 1;
}
