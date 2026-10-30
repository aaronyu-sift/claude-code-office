// Design aid (not part of the app): a finer search than layout-explore.mjs. Every hall row has its own back run and front run of cells at a half-cell
// offset; simulated annealing looks for the arrangement of N cells whose projected footprint fits the window best.
//   node tools/layout-explore-cells.mjs [--cells 10] [--rows 3] [--runs 40]
import { measure, fitZoom, VIEWS, baseline, rectsOfRows } from './layout-explore-lib.mjs';

export function scoreRows(rows) {
  const rects = rectsOfRows(rows), m = measure(rects), per = VIEWS.map(([w, h, sh]) => {
    const z = fitZoom(m, w, h, sh);
    return { z, foot: m.area * z * z / (w * h), box: m.ea * m.eb * z * z / (w * h) };
  });
  const xr = Math.max(...rects.map(r => r.x1));
  const hall = rects.filter(r => r.tag === 'h');
  return { rects, m, per, aspect: m.ea / m.eb, fill: m.area / (m.ea * m.eb), stub: Math.max(...hall.map(r => xr - r.x1)), cells: rows.reduce((t, r) => t + r.b.n + r.f.n, 0) };
}
const spanOf = r => { const q = [r.b, r.f].filter(x => x.n); return [Math.min(...q.map(x => x.c0)), Math.max(...q.map(x => x.c0 + x.n))]; };
const okRows = (rows, cells) => rows.every((r, i) => (r.b.n || r.f.n) && (!i || Math.min(spanOf(r)[1], spanOf(rows[i - 1])[1]) - Math.max(spanOf(r)[0], spanOf(rows[i - 1])[0]) >= 1.0))
  && rows.reduce((t, r) => t + r.b.n + r.f.n, 0) === cells;
const base0 = baseline();
const rel = sc => sc.per.reduce((t, p, i) => t + p.z / base0.per[i].z, 0) / sc.per.length;

function anneal(cells, seed, steps, rowsN) {
  let s = seed;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const cost = rows => { const sc = scoreRows(rows); return -rel(sc) + 0.002 * sc.stub; };
  for (let tries = 0; tries < 5000; tries++) {
    const n = rowsN, counts = Array(n * 2).fill(0);
    for (let k = 0; k < cells; k++) counts[Math.floor(rnd() * n * 2)]++;
    let rows = Array.from({ length: n }, (_, i) => ({ b: { c0: Math.floor(rnd() * 5) / 2, n: counts[2 * i] }, f: { c0: Math.floor(rnd() * 5) / 2, n: counts[2 * i + 1] } }));
    if (!okRows(rows, cells)) continue;
    let c = cost(rows), best = [rows, c];
    for (let t = 0; t < steps; t++) {
      const nr = JSON.parse(JSON.stringify(rows)), r = pick(nr), side = pick(['b', 'f']), mv = rnd();
      if (mv < 0.5) r[side].c0 += pick([-1, -0.5, 0.5, 1]);
      else { const o = pick(nr), os = pick(['b', 'f']); if (r[side].n > 0 && r[side] !== o[os]) { r[side].n--; o[os].n++; } }
      if (!okRows(nr, cells)) continue;
      const c2 = cost(nr);
      if (c2 < c || rnd() < Math.exp((c - c2) / (0.02 * (1 - t / steps) + 1e-4))) { rows = nr; c = c2; if (c < best[1]) best = [nr, c]; }
    }
    return best;
  }
  return null;
}
const canonRows = rows => { const m = Math.min(...rows.flatMap(r => [r.b, r.f].filter(x => x.n).map(x => x.c0))); return rows.map(r => ({ b: { c0: r.b.n ? r.b.c0 - m : 0, n: r.b.n }, f: { c0: r.f.n ? r.f.c0 - m : 0, n: r.f.n } })); };

const args = process.argv.slice(2), val = (f, d) => { const i = args.indexOf('--' + f); return i >= 0 ? args[i + 1] : d; };
const cells = +val('cells', 10), runs = +val('runs', 40), rowsN = +val('rows', 3), found = new Map();
for (let k = 0; k < runs; k++) {
  const best = anneal(cells, 1000 + k * 7919, 4000, rowsN);
  if (!best) continue;
  const c = canonRows(best[0]), key = JSON.stringify(c.map(r => [r.b.n ? [r.b.c0, r.b.n] : 0, r.f.n ? [r.f.c0, r.f.n] : 0]));
  found.set(key, { rows: c, sc: scoreRows(c), r: -best[1] });
}
console.log('baseline zoom', base0.per.map(p => p.z.toFixed(1)).join(' '));
for (const [k, v] of [...found.entries()].sort((a, b) => b[1].r - a[1].r).slice(0, 12)) {
  console.log(`x${v.r.toFixed(3)} aspect ${v.sc.aspect.toFixed(2)} fill ${v.sc.fill.toFixed(2)} stub ${v.sc.stub.toFixed(0)} zoom ${v.sc.per.map(p => p.z.toFixed(1)).join(' ')}  ${k}`);
}
