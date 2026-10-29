// Writes <dir>/contact-sheet.html for the M4 pictures (seasons, weather, time of day, both projections): a grid per projection, a row per
// scene and a column per time of day. Run by pixel-qa after `--shots <dir> --set m4`, or by hand: node tools/qa/contact-sheet.mjs <dir>
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SCENES = [['spring-clear', 'Spring, clear'], ['summer-clear', 'Summer, clear'], ['autumn-clear', 'Autumn, clear'], ['winter-clear', 'Winter, clear'],
  ['summer-rain', 'Summer, rain'], ['winter-snow', 'Winter, snow'], ['autumn-fog', 'Autumn, fog']];
const WHEN = [['morning', 'Morning'], ['evening', 'Evening'], ['night', 'Night']];
const PROJ = [['iso', 'Isometric'], ['front', 'Front three-quarter']];

export function contactSheet(dir) {
  const files = new Set(readdirSync(dir).filter(f => f.endsWith('.png')));
  const fig = (f, cap) => (files.has(f) ? `<figure><a href="${f}"><img src="${f}" alt="${cap}" loading="lazy"></a><figcaption>${cap}</figcaption></figure>` : `<figure class="gap"><figcaption>${cap}: not taken</figcaption></figure>`);
  let listed = 0;
  const body = PROJ.map(([p, pn]) => {
    const rows = SCENES.map(([s, sn]) => `<h3>${sn}</h3><div class="row">${WHEN.map(([w, wn]) => { const f = `m4-${p}-${s}-${w}.png`; if (files.has(f)) listed++; return fig(f, wn); }).join('')}</div>`).join('');
    const bow = `m4-${p}-rainbow-day.png`;
    if (files.has(bow)) listed++;
    return `<section><h2>${pn}</h2>${rows}<h3>A rainbow after rain (spring, automatic weather)</h3><div class="row">${fig(bow, 'Day')}</div></section>`;
  }).join('');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pixel office: seasons, weather and time of day</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f7fa; --text: #1b2030; --muted: #5b6478; --card: #fff; --line: #d5d9e4; }
  @media (prefers-color-scheme: dark) { :root { --bg: #11141c; --text: #e8ebf2; --muted: #98a1b5; --card: #181d29; --line: #2a3144; } }
  body { margin: 0; background: var(--bg); color: var(--text); font: 17px/1.5 system-ui, sans-serif; }
  main { max-width: 90rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
  h1 { font-size: 1.6rem; margin: 0 0 .25rem; } h2 { font-size: 1.3rem; margin: 2.5rem 0 .5rem; } h3 { font-size: 1.05rem; margin: 1.4rem 0 .5rem; }
  p { max-width: 46rem; margin: .3rem 0; color: var(--muted); }
  .row { display: grid; gap: .8rem; grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr)); }
  figure { margin: 0; background: var(--card); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
  figure img { display: block; width: 100%; height: auto; image-rendering: auto; }
  figcaption { padding: .35rem .7rem .5rem; font-size: .95rem; color: var(--muted); } .gap { padding: 2rem 1rem; text-align: center; }
</style></head><body><main>
<h1>Pixel office: seasons, weather and time of day</h1>
<p>The same four-room office in the four seasons, with the weather the settings popover offers (clear, rain, snow, fog), in the morning, in the evening and at night, in both views. Click a picture for the full size.</p>
${body}
</main></body></html>
`;
  writeFileSync(join(dir, 'contact-sheet.html'), html);
  return listed;
}

if (process.argv[1] && process.argv[1].endsWith('contact-sheet.mjs') && process.argv[2]) console.log(`contact-sheet.html lists ${contactSheet(process.argv[2])} pictures`);
