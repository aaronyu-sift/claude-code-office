// Back-to-front order of upright sprites. A single sort key cannot order a wide desk against the chair in front of it, so the order
// is a topological sort: for every pair whose pictures overlap on screen, the projection says which box is farther (`proj.behind`);
// the sprites are then emitted farthest first, ties and the rare cycle broken by `proj.depthKey`.
//   items: [{ fp: { x0, y0, x1, y1 } (world box), bb: { x0, y0, x1, y1 } (screen box), key }]
export function depthSort(items, proj) {
  const n = items.length;
  const out = new Array(n).fill(0).map((_, i) => i);
  if (n < 2) return items.slice();
  // edges a -> b: a is drawn before b
  const next = Array.from({ length: n }, () => []);
  const indeg = new Int32Array(n);
  // sweep over screen x so the pair test stays cheap
  const byX = out.slice().sort((p, q) => items[p].bb.x0 - items[q].bb.x0);
  for (let ii = 0; ii < n; ii++) {
    const i = byX[ii], A = items[i];
    for (let jj = ii + 1; jj < n; jj++) {
      const j = byX[jj], B = items[j];
      if (B.bb.x0 >= A.bb.x1) break;
      if (B.bb.y0 >= A.bb.y1 || A.bb.y0 >= B.bb.y1) continue;
      const r = proj.behind(A.fp, B.fp);
      if (r < 0) { next[i].push(j); indeg[j]++; } else if (r > 0) { next[j].push(i); indeg[i]++; }
    }
  }
  // Kahn's algorithm, always taking the ready item with the smallest key
  const ready = [];
  const less = (p, q) => items[p].key - items[q].key || p - q;
  for (let i = 0; i < n; i++) if (!indeg[i]) ready.push(i);
  const done = new Uint8Array(n), order = [];
  while (order.length < n) {
    let pick = -1;
    if (ready.length) {
      let bi = 0;
      for (let k = 1; k < ready.length; k++) if (less(ready[k], ready[bi]) < 0) bi = k;
      pick = ready.splice(bi, 1)[0];
    } else {                                               // a cycle: take the smallest key among the rest
      for (let i = 0; i < n; i++) if (!done[i] && (pick < 0 || less(i, pick) < 0)) pick = i;
    }
    done[pick] = 1; order.push(pick);
    for (const j of next[pick]) if (!done[j] && --indeg[j] === 0) ready.push(j);
  }
  return order.map(i => items[i]);
}
