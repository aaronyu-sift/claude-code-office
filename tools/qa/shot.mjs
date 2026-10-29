// One picture of the pixel scene for a look by eye (headless Chrome, throw-away profile):
//   node tools/qa/shot.mjs --n 10 --time 22:00 --zoom 3 --room 2 --out /tmp/x.png [--dpr 2] [--statuses working,waiting]
//   node tools/qa/shot.mjs --n 4 --zoom 3 --garden --out /tmp/garden.png
// --query '?gallery=1' opens another page, --height makes the window taller (the gallery is a long page).
// --time pins the clock (?time=), --zoom sets a whole-number zoom (default: fit), --room centres the view on the room of the main agent of
// that index, --garden on the island east of the building (pond side), --south on the front garden.
import { VIEW, scenario, px, sleep } from './harness.mjs';

const args = process.argv.slice(2);
const val = (f, d) => { const i = args.indexOf('--' + f); return i >= 0 ? args[i + 1] : d; };
const flag = f => args.includes('--' + f);
const n = +val('n', 10), time = val('time'), zoom = val('zoom'), room = val('room'), out = val('out', '/tmp/pixel-shot.png'), dpr = +val('dpr', 1);
const statuses = val('statuses'), query = val('query'), height = +val('height', VIEW.h);

const S = await scenario(n, { dpr, query: query || (time ? `?time=${time}` : ''), height, tag: 'shot', fixture: statuses ? { statuses: statuses.split(',') } : {} });
try {
  if (!S.ready) throw new Error('scene did not become ready');
  if (zoom) await S.page.evaluate(px(`p.setZoom(${+zoom})`));
  if (room != null) {
    const main = S.agents.filter(a => a.kind === 'main')[+room];
    await S.page.evaluate(px(`p.centerOnRoom(${JSON.stringify(main.id)})`));
  }
  if (flag('garden')) await S.page.evaluate(px('(() => { const b = p.layout.building; return p.centerOnWorld(b.x1 + 56, (b.y0 + b.y1) / 2, 6); })()'));
  if (flag('south')) await S.page.evaluate(px('(() => { const b = p.layout.building; return p.centerOnWorld((b.x0 + b.x1) / 2, b.y0 - 56, 6); })()'));
  await S.page.mouse.move(2, 2);
  await sleep(1200);
  await S.page.screenshot(out);
  const info = await S.page.evaluate(px('({ zoom: p.zoom, time: p.time, effects: p.effects, counts: p.counts, retint: p.retintCost, build: p.buildMs })'));
  console.log(JSON.stringify(info), 'errors', S.page.errors.length, S.page.errors[0] || '');
  console.log('wrote', out, `${VIEW.w}x${VIEW.h} @${dpr}`);
} finally { await S.done(); }
