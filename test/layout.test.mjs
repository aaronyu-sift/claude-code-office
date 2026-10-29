import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutOffice, G, roomWidth, roomCap } from '../public/js/pixel/layout.js';
import { ISO, FRONT } from '../public/js/pixel/projection.js';
import { FP, fpSize } from '../public/js/pixel/ids.js';

const agents = (n, classes = [0]) => Array.from({ length: n }, (_, i) => ({ id: 'sess-' + String(i).padStart(3, '0'), cls: classes[i % classes.length], project: 'p' + (i % 5), color: '#5B9BD5' }));
const overlap = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
const box = o => ({ x0: o.x, y0: o.y, x1: o.x + o.w, y1: o.y + o.d });
const roomBox = r => ({ x0: r.x - G.WALL_T, y0: r.y - G.WALL_T, x1: r.x + r.w + G.WALL_T, y1: r.y + r.d + G.WALL_T });

for (const proj of [ISO, FRONT]) for (const n of [1, 4, 10, 20]) {
  const list = agents(n, n === 10 ? [0, 1, 2] : [0]);
  const layoutOffice_ = a => layoutOffice(a, proj);

  test(`${proj.name}: layout is deterministic for ${n} agents`, () => {
    assert.equal(JSON.stringify(layoutOffice_(list)), JSON.stringify(layoutOffice_(list.map(a => ({ ...a })))));
  });

  test(`${proj.name}: no overlapping rooms, desks, seats or furniture for ${n} agents`, () => {
    const L = layoutOffice_(list);
    assert.equal(L.rooms.length, n);
    for (let i = 0; i < L.rooms.length; i++) for (let j = i + 1; j < L.rooms.length; j++) {
      assert.ok(!overlap(roomBox(L.rooms[i]), roomBox(L.rooms[j])), `rooms ${i} and ${j} overlap`);
    }
    for (const r of L.rooms) {
      const parts = [];
      for (const s of r.slots) { parts.push(['desk' + s.index, box(s.desk)], ['seat' + s.index, box(s.seat)]); }
      for (const it of r.items) if (it.layer === 'stand' && !it.wall) parts.push([it.id, box(it)]);
      for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
        assert.ok(!overlap(parts[i][1], parts[j][1]), `${r.id}: ${parts[i][0]} overlaps ${parts[j][0]}`);
      }
      const inner = { x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.d };
      for (const [name, b] of parts) {
        assert.ok(b.x0 >= inner.x0 && b.x1 <= inner.x1 && b.y0 >= inner.y0 && b.y1 <= inner.y1, `${r.id}: ${name} sticks out of its room`);
      }
      // walls: the pieces tile their side without overlapping each other or the furniture
      const walls = r.items.filter(i => i.wall).map(box);
      for (let i = 0; i < walls.length; i++) for (let j = i + 1; j < walls.length; j++) assert.ok(!overlap(walls[i], walls[j]), `${r.id}: wall pieces ${i} and ${j} overlap`);
      for (const w of walls) for (const [name, b] of parts) assert.ok(!overlap(w, b), `${r.id}: a wall overlaps ${name}`);
    }
  });

  test(`${proj.name}: desk slots of ${n} agents are distinct and match the room class`, () => {
    for (const r of layoutOffice_(list).rooms) {
      assert.equal(r.slots.length, 1 + roomCap(r.cls));
      assert.equal(new Set(r.slots.map(s => s.index)).size, r.slots.length);
      assert.equal(r.slots[0].kind, 'chief');
      assert.equal(r.w, roomWidth(r.cls));
    }
  });

  test(`${proj.name}: outdoors of ${n} agents: nothing stands on a room and trees only on the far sides`, () => {
    const L = layoutOffice_(list);
    const rbs = L.rooms.map(roomBox);
    const outs = L.outdoor.items.map(box);
    outs.forEach((b, i) => { for (const r of rbs) assert.ok(!overlap(b, r), `outdoor item ${L.outdoor.items[i].id} stands on a room`); });
    for (let i = 0; i < outs.length; i++) for (let j = i + 1; j < outs.length; j++) assert.ok(!overlap(outs[i], outs[j]), 'outdoor items overlap');
    const side = (it, k) => ({ north: it.y + it.d / 2 > L.building.y1, west: it.x + it.w / 2 < L.building.x0, south: it.y + it.d / 2 < L.building.y0, east: it.x + it.w / 2 > L.building.x1 })[k];
    for (const it of L.outdoor.items) if (/^(tree|pine)/.test(it.id)) assert.ok(!proj.nearSides.some(k => side(it, k)), `${it.id} at ${it.x},${it.y} stands on a side near the camera and could hide a room`);
    for (const t of L.outdoor.tiles) for (const r of rbs) assert.ok(!overlap({ x0: t.x + 1, y0: t.y + 1, x1: t.x + 15, y1: t.y + 15 }, { x0: r.x0 + 2, y0: r.y0 + 2, x1: r.x1 - 2, y1: r.y1 - 2 }), 'ground tile inside a room');
    const b = L.bounds;
    for (const it of [...L.outdoor.items, ...L.rooms.flatMap(r => r.items)]) assert.ok(it.x >= b.x0 && it.y >= b.y0 && it.x + it.w <= b.x1 && it.y + it.d <= b.y1, `${it.id} outside the island`);
  });
}

test('rooms keep their place: appending an agent moves nobody, removing the last one moves nobody', () => {
  const a = agents(10, [0, 1, 2]);
  const before = layoutOffice(a).rooms;
  const plus = layoutOffice([...a, { id: 'sess-new', cls: 1, project: 'x', color: '#fff' }]).rooms;
  // the geometry of a room never depends on later rooms (only its wall heights may, when a room appears behind it)
  const geo = r => JSON.stringify([r.id, r.x, r.y, r.w, r.d, r.slots, r.label, r.floor]);
  for (let i = 0; i < before.length; i++) assert.equal(geo(plus[i]), geo(before[i]), `room ${i} moved when an agent was appended`);
  const minus = layoutOffice(a.slice(0, 9)).rooms;
  for (let i = 0; i < 9; i++) {
    // walls depend on neighbours, so compare the places, not the wall heights
    assert.deepEqual([minus[i].x, minus[i].y], [before[i].x, before[i].y]);
  }
});

test('removing an agent from the middle keeps the order and the rooms before it in place', () => {
  const a = agents(10, [0]);
  const before = layoutOffice(a).rooms;
  const gone = a[4].id;
  const after = layoutOffice(a.filter(x => x.id !== gone)).rooms;
  assert.deepEqual(after.map(r => r.id), before.map(r => r.id).filter(id => id !== gone));
  for (let i = 0; i < 4; i++) assert.deepEqual([after[i].x, after[i].y], [before[i].x, before[i].y]);
});

for (const proj of [ISO, FRONT]) test(`${proj.name}: rows break at the projection's row width and later rows stand behind earlier ones`, () => {
  const L = layoutOffice(agents(20, [0]), proj);
  const rows = new Map();
  for (const r of L.rooms) rows.set(r.y, [...(rows.get(r.y) || []), r]);
  assert.ok(rows.size >= 2);
  for (const [, list] of rows) assert.ok(Math.max(...list.map(r => r.x + r.w)) <= proj.layout.rowMax);
  assert.deepEqual([...rows.keys()], [...rows.keys()].sort((p, q) => p - q));
});
test('the front view lets rows run wider than the isometric one', () => assert.ok(FRONT.layout.rowMax > ISO.layout.rowMax));

test('tall walls only where nothing stands in their shadow', () => {
  const one = layoutOffice(agents(1)).rooms[0];
  assert.deepEqual(one.walls, { north: 'tall', west: 'tall' });
  const two = layoutOffice(agents(2)).rooms;
  assert.deepEqual(two[0].walls, { north: 'tall', west: 'tall' });
  assert.deepEqual(two[1].walls, { north: 'tall', west: 'low' });
  const many = layoutOffice(agents(20)).rooms;
  const first = many[0], inner = many[6];
  assert.equal(first.walls.north, 'low');                     // another row stands behind it
  assert.equal(inner.walls.west, 'low');
  assert.ok(many[many.length - 1].walls.north === 'tall');    // the back row keeps its tall wall
});

test('front: only the north wall may be tall, and only where nothing stands behind it; west walls are never tall', () => {
  const one = layoutOffice(agents(1), FRONT).rooms[0];
  assert.deepEqual(one.walls, { north: 'tall', west: 'low' });
  const many = layoutOffice(agents(20), FRONT).rooms;
  assert.ok(many.every(r => r.walls.west === 'low'), 'a west wall is edge-on in the front view');
  assert.equal(many[0].walls.north, 'low');                          // another row stands behind it
  assert.equal(many[many.length - 1].walls.north, 'tall');           // the back row keeps its tall wall
  // a room to the west does not make a north wall low: nothing is hidden sideways
  const two = layoutOffice(agents(2), FRONT).rooms;
  assert.deepEqual(two.map(r => r.walls.north), ['tall', 'tall']);
  // the wall pieces follow: tall pieces on the north side only
  assert.ok(many.at(-1).items.filter(i => i.wall === 'west').every(i => i.id === 'wall_low'));
  assert.ok(many.at(-1).items.filter(i => i.wall === 'north').every(i => i.id !== 'wall_low'));
});

test('the projection decides: the same agents give different walls, row widths and keep-free zones in the two views', () => {
  const a = agents(10, [0, 1, 2]), iso = layoutOffice(a, ISO), front = layoutOffice(a, FRONT);
  assert.notDeepEqual(iso.rooms.map(r => r.walls), front.rooms.map(r => r.walls));
  assert.notDeepEqual(iso.rooms.map(r => [r.x, r.y]), front.rooms.map(r => [r.x, r.y]));
  assert.notDeepEqual(ISO.sightZone({ x: 10, y: 10, w: 10, d: 10 }), FRONT.sightZone({ x: 10, y: 10, w: 10, d: 10 }));
  assert.deepEqual(layoutOffice(a), iso, 'the default projection is isometric');
});

test('layout interface: empty office, shelf stays empty, no hard cap, no river, cars or roads', () => {
  const e = layoutOffice([]);
  assert.deepEqual(e.rooms, []);
  assert.deepEqual(e.shelf, []);
  assert.ok(e.bounds.x1 > e.bounds.x0);
  const big = layoutOffice(agents(45, [0, 1]));
  assert.equal(big.rooms.length, 45);
  assert.deepEqual(big.shelf, []);
  const ids = new Set([...big.rooms.flatMap(r => [...r.items, ...r.floor]), ...big.outdoor.items, ...big.outdoor.tiles].map(i => i.id));
  for (const id of ids) { assert.ok(FP[id], 'unknown sprite id ' + id); assert.doesNotMatch(id, /river|car|road|traffic/); }
});

test('item footprints rotate with the facing', () => {
  assert.deepEqual(fpSize('sofa', 0), [30, 12]);
  assert.deepEqual(fpSize('sofa', 1), [12, 30]);
  const sofa = layoutOffice(agents(1)).rooms[0].items.find(i => i.id === 'sofa');
  assert.deepEqual([sofa.w, sofa.d], [12, 30]);
});

// ---- Goal 2: themes, desk props, garden
import { THEMES, hashStr, DESK_TOP } from '../public/js/pixel/layout.js';

const projectOfTheme = theme => { for (let i = 0; i < 200; i++) if (THEMES[hashStr('proj-' + i) % THEMES.length] === theme) return 'proj-' + i; throw new Error('no project for ' + theme); };
const themed = theme => layoutOffice([{ id: 'a-' + theme, cls: 2, project: projectOfTheme(theme), color: '#5B9BD5' }]).rooms[0];

test('room themes: chosen by project, stable, and the four themes dress a room differently', () => {
  const same = layoutOffice([{ id: 'x', cls: 1, project: 'atlas', color: '#fff' }, { id: 'y', cls: 1, project: 'atlas', color: '#fff' }]).rooms;
  assert.equal(same[0].theme, same[1].theme, 'the same project always gets the same theme');
  assert.deepEqual([...new Set(Array.from({ length: 60 }, (_, i) => layoutOffice([{ id: 'p', cls: 0, project: 'proj-' + i, color: '#fff' }]).rooms[0].theme))].sort(), [...THEMES].sort());
  const furniture = new Map(THEMES.map(t => [t, new Set(themed(t).items.filter(i => i.layer === 'stand' && !i.wall).map(i => i.id))]));
  for (const [t, ids] of furniture) assert.ok(ids.size >= 7, `${t} room has only ${ids.size} kinds of furniture`);
  for (const a of THEMES) for (const b of THEMES) if (a < b) {
    const only = [...furniture.get(a)].filter(id => !furniture.get(b).has(id));
    assert.ok(only.length >= 3, `${a} and ${b} rooms are too alike (only ${only.length} pieces differ)`);
  }
  const walls = new Map(THEMES.map(t => [t, themed(t).items.filter(i => i.wall === 'north').map(i => i.id).join()]));
  assert.equal(new Set(walls.values()).size, THEMES.length, 'the wall pieces of the four themes differ');
});

test('desk props stand on the desk top, never overlap each other and belong to a real slot', () => {
  for (const theme of THEMES) {
    const r = themed(theme);
    assert.ok(r.props.length >= r.slots.length, `${theme}: fewer props than desks`);
    const bySlot = new Map();
    for (const p of r.props) {
      const s = r.slots[p.slot];
      assert.ok(s, `${theme}: prop ${p.id} on a slot that does not exist`);
      assert.equal(p.z, DESK_TOP);
      assert.ok(p.x >= s.desk.x && p.y >= s.desk.y && p.x + p.w <= s.desk.x + s.desk.w && p.y + p.d <= s.desk.y + s.desk.d, `${theme}: ${p.id} sticks out of desk ${p.slot}`);
      (bySlot.get(p.slot) || bySlot.set(p.slot, []).get(p.slot)).push(box(p));
    }
    for (const list of bySlot.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) assert.ok(!overlap(list[i], list[j]), `${theme}: two props overlap on a desk`);
  }
});

test('garden island: path, pond, trees, fences, beds and a bench around any office, none of it on the building', () => {
  for (const n of [1, 4, 10]) {
    const L = layoutOffice(agents(n, [0, 1, 2]));
    const count = re => L.outdoor.items.filter(i => re.test(i.id)).length;
    assert.ok(L.outdoor.tiles.some(t => t.id === 'floor_path') && L.outdoor.tiles.some(t => /^floor_grass/.test(t.id)), `${n}: path and grass`);
    assert.ok(count(/^pond$/) === 1, `${n}: one pond`);
    assert.ok(new Set(L.outdoor.items.filter(i => /^(tree|pine)/.test(i.id)).map(i => i.id)).size >= 2, `${n}: at least two kinds of tree`);
    assert.ok(count(/^fence/) >= 6, `${n}: ${count(/^fence/)} fence pieces`);
    assert.ok(count(/^flowerbed/) >= 2 && count(/^bench$/) >= 1 && count(/^lamppost$/) >= 2, `${n}: beds, bench and lamp posts`);
    assert.ok(count(/^(bush|hedge|rock|tuft)/) >= 8, `${n}: low plants and stones`);
  }
});

for (const proj of [ISO, FRONT]) test(`${proj.name}: the garden keeps its seasonal spots (a bird bath, pumpkins or a snowman; a pile of leaves), in the same place in every season`, () => {
  for (const n of [1, 4, 10, 20]) {
    const L = layoutOffice(agents(n, n === 10 ? [0, 1, 2] : [0]), proj);
    const spots = L.outdoor.items.filter(i => i.id.startsWith('seasonal_'));
    assert.ok(spots.some(s => s.id === 'seasonal_a'), `${proj.name} ${n}: no seasonal_a spot`);
    if (n >= 4) assert.ok(spots.some(s => s.id === 'seasonal_b'), `${proj.name} ${n}: no seasonal_b spot`);
    for (const s of spots) assert.deepEqual([s.w, s.d], [16, 16]);
    assert.equal(JSON.stringify(L), JSON.stringify(layoutOffice(agents(n, n === 10 ? [0, 1, 2] : [0]), proj)));     // the layout never looks at the season
  }
});

for (const proj of [ISO, FRONT]) test(`${proj.name}: the world is all ground (no sky): garden, building and outer tiles cover every point of it, in a deterministic landscape that never touches the garden`, () => {
  for (const n of [0, 1, 4, 10, 20]) {
    const list = agents(n, n === 10 ? [0, 1, 2] : [0]), L = layoutOffice(list, proj), T = G.TILE, W = L.world;
    assert.equal(JSON.stringify(L.outer), JSON.stringify(layoutOffice(list.map(a => ({ ...a })), proj).outer), `${proj.name} ${n}: outer landscape is deterministic`);
    const key = (x, y) => `${Math.floor(x / T)},${Math.floor(y / T)}`;
    const outer = new Set(L.outer.tiles.map(t => key(t.x, t.y))), garden = new Set(L.outdoor.tiles.map(t => key(t.x, t.y)));
    for (const k of outer) assert.ok(!garden.has(k), `${proj.name} ${n}: outer tile ${k} is also a garden tile`);
    const I = L.outdoor.island;
    const inRoom = (x, y) => L.rooms.some(r => x >= r.x - G.WALL_T && x < r.x + r.w + G.WALL_T && y >= r.y - G.WALL_T && y < r.y + r.d + G.WALL_T);
    let holes = 0, samples = 0;
    for (let sx = W.x0; sx <= W.x1; sx += 16) for (let sy = W.y0; sy <= W.y1; sy += 8) {
      const [gx, gy] = proj.toGround(sx, sy, 0), k = key(gx, gy);
      samples++;
      if (!outer.has(k) && !garden.has(k) && !inRoom(gx, gy) && !(gx >= I.x0 && gx < I.x1 && gy >= I.y0 && gy < I.y1)) holes++;
    }
    assert.equal(holes, 0, `${proj.name} ${n}: ${holes} of ${samples} points of the world are not covered by any tile`);
    for (const it of L.outer.items) {                                             // no decor in the garden or in the building (an edge may touch: the scene drops what overlaps)
      const cx = it.x + it.w / 2, cy = it.y + it.d / 2;
      assert.ok(!(cx >= I.x0 && cx < I.x1 && cy >= I.y0 && cy < I.y1), `${proj.name} ${n}: ${it.id} stands in the garden`);
      assert.ok(!inRoom(cx, cy), `${proj.name} ${n}: ${it.id} stands in a room`);
    }
  }
});

test('landscape: the world is big enough to pan around the garden, wooded in places and open in others, with several kinds of tree', () => {
  const L = layoutOffice(agents(2), ISO), W = L.world, trees = L.outer.items.filter(i => /^(tree|pine)/.test(i.id));
  assert.ok(W.x1 - W.x0 >= 1500 && W.y1 - W.y0 >= 1000, `world ${W.x1 - W.x0} x ${W.y1 - W.y0} px`);
  assert.ok(new Set(trees.map(t => t.id)).size >= 3, 'at least three kinds of tree');
  // patchy: split the world into 8 x 6 cells; some have many trees (a wood), some almost none (a meadow)
  const cells = new Map();
  for (const t of trees) {
    const [sx, sy] = ISO.toScreen(t.x, t.y, 0), c = Math.floor((sx - W.x0) / ((W.x1 - W.x0) / 8)) + ',' + Math.floor((sy - W.y0) / ((W.y1 - W.y0) / 6));
    cells.set(c, (cells.get(c) || 0) + 1);
  }
  const counts = [...Array(48).keys()].map(i => cells.get((i % 8) + ',' + Math.floor(i / 8)) || 0).sort((a, b) => a - b);
  assert.ok(counts[Math.floor(counts.length * 0.2)] * 3 < counts[Math.floor(counts.length * 0.9)], `trees are spread evenly (cells: ${counts.join(' ')})`);
  assert.ok(L.outer.items.filter(i => /^(bush|rock|flowerbed|tuft)/.test(i.id)).length > trees.length, 'more low plants and stones than trees');
});
