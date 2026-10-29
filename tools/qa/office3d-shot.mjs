// One picture of the 3D scene for a look by eye (headless Chrome with software WebGL, throw-away profile):
//   node tools/qa/office3d-shot.mjs --n 10 --room 2 --zoom 90 --out /tmp/x.png [--query 'assets=procedural&polish=off'] [--statuses working,waiting]
//   node tools/qa/office3d-shot.mjs --n 10 --out /tmp/all.png                     (the whole building at fit zoom)
//   node tools/qa/office3d-shot.mjs --n 4 --garden --zoom 60 --out /tmp/garden.png
// --room centres the camera on the chief desk of the main agent of that index, --at x,y,z moves the centre inside the room (default 2.2,0.6,3.4),
// --garden looks at the island south-east of the building, --dpr 2 doubles the pixels.
import { VIEW, scenario3d, lookAtRoom, lookAt, o3, sleep } from './harness3d.mjs';

const args = process.argv.slice(2);
const val = (f, d) => { const i = args.indexOf('--' + f); return i >= 0 ? args[i + 1] : d; };
const flag = f => args.includes('--' + f);
const n = +val('n', 10), room = val('room'), zoom = val('zoom'), out = val('out', '/tmp/office3d-shot.png'), dpr = +val('dpr', 1), query = val('query', '');
const statuses = val('statuses'), at = val('at'), height = +val('height', VIEW.h), width = +val('width', VIEW.w);

const S = await scenario3d(n, { tag: 'shot', query, dpr, width, height, fixture: statuses ? { statuses: statuses.split(',') } : {} });
try {
  if (!S.ready.ok) throw new Error('scene did not become ready: ' + JSON.stringify(S.ready.last));
  if (room != null) {
    const main = S.agents.filter(a => a.kind === 'main' && a.status !== 'dormant')[+room];
    const [x, y, z] = at ? at.split(',').map(Number) : [2.2, 0.6, 3.4];
    await lookAtRoom(S.page, main.id, +(zoom || 90), { x, y, z });
  } else if (flag('garden')) {
    const b = await S.page.evaluate(o3('(() => { const r = s.rooms[s.rooms.length - 1]; return [r.X + r.W + 6, r.Z + 14]; })()'));
    await lookAt(S.page, b[0], 0, b[1], +(zoom || 40));
  } else if (zoom) await S.page.evaluate(o3(`s.zoom || 0`));
  await S.page.mouse.move(2, 2);
  await sleep(1500);
  await S.page.screenshot(out);
  const info = await S.page.evaluate(o3('({ ...o.draw(), rebuildMs: o.rebuildMs, look: o.look, models: o.models, figures: o.figures().length, zoom: s.zoom })'));
  console.log(JSON.stringify(info), 'errors', S.page.errors.length, S.page.errors[0] || '');
  console.log('wrote', out, `${width}x${height} @${dpr}`);
} finally { await S.done(); }
