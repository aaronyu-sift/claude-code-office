// Loads the sprite atlas and manifest of a projection and hands out draw information. Tinted variants (walls and floors take the
// project colour) are made once on small canvases and cached.

const newCanvas = (w, h) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }));

export function createAtlas(manifest, image, projName) {
  const P = manifest.projections[projName];
  if (!P) throw new Error('no atlas for projection ' + projName);
  const tints = new Map();
  let mask = null;
  const facingOf = (def, facing) => (((facing | 0) % def.facings) + def.facings) % def.facings;

  function sprite(id, facing = 0) {
    const def = manifest.sprites[id], pl = P.sprites[id];
    if (!def || !pl) return null;
    const f = facingOf(def, facing);
    return { def, rect: pl.rects[f], px: pl.pivots[f][0], py: pl.pivots[f][1] };
  }
  // draw so that the pivot lands on (x, y) of the target (rounded to whole pixels)
  function draw(g, id, facing, x, y) {
    const s = sprite(id, facing);
    if (!s) return false;
    const [rx, ry, rw, rh] = s.rect;
    g.drawImage(image, rx, ry, rw, rh, Math.round(x - s.px), Math.round(y - s.py), rw, rh);
    return true;
  }
  // a copy multiplied with `color` (strength 0..1 mixes white toward the colour first), same pivot
  function tinted(id, facing, color, strength = 0.4) {
    const key = id + '|' + facing + '|' + color + '|' + strength;
    let t = tints.get(key);
    if (t) return t;
    const s = sprite(id, facing);
    if (!s) return null;
    const [rx, ry, rw, rh] = s.rect;
    const c = newCanvas(rw, rh), g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(image, rx, ry, rw, rh, 0, 0, rw, rh);
    const n = parseInt(color.slice(1), 16), m = k => Math.round(255 + (((n >> k) & 255) - 255) * strength);
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = `rgb(${m(16)},${m(8)},${m(0)})`;
    g.fillRect(0, 0, rw, rh);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(image, rx, ry, rw, rh, 0, 0, rw, rh);
    tints.set(key, t = { canvas: c, px: s.px, py: s.py, w: rw, h: rh });
    return t;
  }
  function drawTinted(g, id, facing, x, y, color, strength) {
    const t = tinted(id, facing, color, strength);
    if (!t) return false;
    g.drawImage(t.canvas, Math.round(x - t.px), Math.round(y - t.py));
    return true;
  }
  // a copy with a translucent colour laid over its pixels (source-atop: the transparent parts stay transparent), for the garden at night
  const shades = new Map();
  function shaded(id, facing, color) {
    const key = id + '|' + facing + '|' + color;
    let t = shades.get(key);
    if (t) return t;
    const s = sprite(id, facing);
    if (!s) return null;
    const [rx, ry, rw, rh] = s.rect;
    const c = newCanvas(rw, rh), g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(image, rx, ry, rw, rh, 0, 0, rw, rh);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = color;
    g.fillRect(0, 0, rw, rh);
    shades.set(key, t = { canvas: c, w: rw, h: rh });
    return t;
  }
  // alpha (0..255) of a sprite pixel, in sprite-local coordinates
  function alphaAt(id, facing, lx, ly) {
    const s = sprite(id, facing);
    if (!s) return 0;
    const [rx, ry, rw, rh] = s.rect;
    lx = Math.floor(lx); ly = Math.floor(ly);
    if (lx < 0 || ly < 0 || lx >= rw || ly >= rh) return 0;
    if (!mask) {
      const c = newCanvas(image.width, image.height), g = c.getContext('2d');
      g.drawImage(image, 0, 0);
      mask = g.getImageData(0, 0, image.width, image.height).data;
    }
    return mask[((ry + ly) * image.width + rx + lx) * 4 + 3];
  }
  // light and animation anchors of a sprite (monitor, lamp, window, led, steam): [{ k, x, y, r, s }] in sprite pixels
  function anchors(id, facing = 0) {
    const pl = P.sprites[id], def = manifest.sprites[id];
    if (!pl || !pl.anchors) return null;
    const list = pl.anchors[(((facing | 0) % def.facings) + def.facings) % def.facings];
    return list.map(([k, x, y, r, s]) => ({ k, x, y, r, s }));
  }
  return {
    manifest, image, projName, sprite, draw, tinted, drawTinted, alphaAt, anchors, shaded, clearShades() { shades.clear(); },
    has: id => !!manifest.sprites[id],
    get ids() { return Object.keys(manifest.sprites); },
  };
}

export async function loadAtlas(projName, base = new URL('../../pixel/', import.meta.url).href) {
  const manifest = await (await fetch(base + 'manifest.json', { cache: 'no-cache' })).json();
  const P = manifest.projections[projName];
  if (!P) throw new Error('no atlas for projection ' + projName);
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('could not load ' + P.atlas));
    img.src = base + P.atlas + '?v=' + P.sha;
  });
  return createAtlas(manifest, image, projName);
}
