// ?gallery=1: every sprite of the atlas, one card per id (first facing, scaled up), grouped by category. The count shown on the page is the
// number of cards, and QA compares it with the manifest.
import { loadAtlas } from './atlas.js';

const STYLE = `
.gal { position: fixed; inset: 0; z-index: 1000; overflow: auto; background: #10141f; color: #e6e9f2; font: 13px/1.4 system-ui, sans-serif; padding: 18px 22px 40px; }
.gal h1 { font-size: 18px; margin: 0 0 4px; } .gal h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: #8f98ad; margin: 22px 0 8px; }
.gal .count { color: #9fe8c7; margin-bottom: 6px; } .gal a { color: #8ab4ff; }
.gal .grid { display: flex; flex-wrap: wrap; gap: 10px; }
.gal-card { width: 150px; background: #181e2d; border: 1px solid #262e44; border-radius: 8px; padding: 8px; }
.gal-card .pic { height: 120px; display: flex; align-items: flex-end; justify-content: center; background: #c9e6d3; border-radius: 5px; overflow: hidden; }
.gal-card canvas { image-rendering: pixelated; max-width: 100%; max-height: 120px; }
.gal-card .id { margin-top: 6px; font: 11px ui-monospace, monospace; word-break: break-all; } .gal-card .meta { color: #8f98ad; font-size: 11px; }
`;

export async function showGallery(proj = 'iso') {
  const root = document.createElement('div');
  root.className = 'gal';
  root.innerHTML = `<style>${STYLE}</style><h1>Pixel scene gallery</h1><div class="count" id="gal-count">loading</div><div id="gal-body"></div>`;
  document.body.appendChild(root);
  let atlas;
  try { atlas = await loadAtlas(proj); } catch (e) { root.querySelector('#gal-count').textContent = 'could not load the atlas: ' + (e && e.message || e); return; }
  const man = atlas.manifest, ids = Object.keys(man.sprites), cats = new Map();
  for (const id of ids) { const c = man.sprites[id].cat; if (!cats.has(c)) cats.set(c, []); cats.get(c).push(id); }
  const body = root.querySelector('#gal-body');
  for (const [cat, list] of cats) {
    const h = document.createElement('h2');
    h.textContent = `${cat} (${list.length})`;
    const grid = document.createElement('div');
    grid.className = 'grid';
    for (const id of list) {
      const s = atlas.sprite(id, 0), [rx, ry, rw, rh] = s.rect, k = Math.max(1, Math.min(6, Math.floor(110 / Math.max(rw, rh))));
      const card = document.createElement('div');
      card.className = 'gal-card';
      card.dataset.id = id;
      const c = document.createElement('canvas');
      c.width = rw * k; c.height = rh * k;
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(atlas.image, rx, ry, rw, rh, 0, 0, rw * k, rh * k);
      const pic = document.createElement('div');
      pic.className = 'pic';
      pic.appendChild(c);
      const d = man.sprites[id];
      card.append(pic);
      card.insertAdjacentHTML('beforeend', `<div class="id">${id}</div><div class="meta">${d.cat} · ${rw}×${rh}px · ${d.facings} facing${d.facings > 1 ? 's' : ''}${d.tags.length ? ' · ' + d.tags.join(' ') : ''}</div>`);
      grid.appendChild(card);
    }
    body.append(h, grid);
  }
  const n = body.querySelectorAll('.gal-card').length;
  const el = root.querySelector('#gal-count');
  el.textContent = `${n} sprites in ${cats.size} categories (${proj} atlas)`;
  el.dataset.count = String(n);
  root.dataset.ready = '1';
}
