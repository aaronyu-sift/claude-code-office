'use strict';
// Dev preview (--dev or CCO_DEV=1, off by default): tells an open page that the files it was served have changed, so someone watching the Office
// in a browser while it is being worked on can reload when he wants to. It never reloads the page itself: a small card at the bottom left offers it.
//
//   createDevReload({ publicDir })   .version()            a short string that changes when a served file is added, removed or changed
//                                    .handle(pathname, res) answers /__dev/version and /__dev.js, true when it did
//                                    .inject(html)          the page with the script tag added once before </body>
//
// The version is made of the path, size and modification time of the files under public/ (the vendored libraries and the models are skipped: they do not
// change while someone works on the page), looked at at most once a second however many pages ask. Changes to the server itself (server.js and the
// modules next to it) need a restart and are not seen here.
const fs = require('fs');
const path = require('path');

const SKIP = new Set(['vendor', 'models', 'local', 'node_modules']);
const TTL_MS = 1000;
const TAG = '<script src="/__dev.js"></script>';

// The script the page runs: ask for the version every 3 seconds while the page is visible, show the card when it differs from the first one seen.
const CLIENT = `(() => {
  const URL_V = '/__dev/version';
  let first = null, shown = false, timer = null;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const card = () => {
    shown = true;
    const d = document.createElement('div');
    d.setAttribute('role', 'status');
    d.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483000;display:flex;gap:10px;align-items:center;padding:9px 10px 9px 14px;border-radius:14px;' +
      'font:500 13px/1.3 system-ui,-apple-system,sans-serif;color:#eef1f8;background:rgba(14,18,32,.88);border:1px solid rgba(196,208,255,.32);' +
      'box-shadow:0 8px 28px rgba(0,0,0,.45);backdrop-filter:blur(10px);opacity:0;' + (reduced ? '' : 'transition:opacity .25s ease-out;');
    const t = document.createElement('span'); t.textContent = 'A new version of this page is ready';
    const go = document.createElement('button'); go.textContent = 'Reload';
    go.style.cssText = 'font:600 13px system-ui,sans-serif;padding:5px 12px;border-radius:9px;border:0;cursor:pointer;color:#0b1020;background:#9db4ff;';
    go.onclick = () => location.reload();
    const x = document.createElement('button'); x.textContent = '\\u00d7'; x.setAttribute('aria-label', 'Dismiss');
    x.style.cssText = 'font:400 18px/1 system-ui,sans-serif;width:26px;height:26px;border-radius:8px;border:0;cursor:pointer;color:#c9d2ee;background:transparent;';
    x.onclick = () => { d.remove(); shown = false; first = 'dismissed'; };
    d.append(t, go, x);
    document.body.appendChild(d);
    requestAnimationFrame(() => { d.style.opacity = '1'; });
  };
  const look = async () => {
    if (document.hidden || shown) return;
    try {
      const v = (await (await fetch(URL_V, { cache: 'no-store' })).json()).v;
      if (first === null) first = v;
      else if (v !== first && first !== 'dismissed') card();
      else if (first === 'dismissed') first = v;
    } catch { /* the server restarted or is gone: try again later */ }
  };
  timer = setInterval(look, 3000);
  document.addEventListener('visibilitychange', look);
  look();
})();
`;

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else {
      try { const st = fs.statSync(p); out.push(`${p}:${st.size}:${Math.floor(st.mtimeMs)}`); } catch { /* removed meanwhile */ }
    }
  }
}

function createDevReload({ publicDir, now = Date.now }) {
  let at = 0, cached = '';
  const version = () => {
    const t = now();
    if (cached && t - at < TTL_MS) return cached;
    const list = [];
    walk(publicDir, list);
    list.sort();
    let h = 5381;                                                             // djb2 over the sorted list: short and stable, not a security hash
    for (const s of list) for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    cached = h.toString(36) + '-' + list.length;
    at = t;
    return cached;
  };
  return {
    version,
    handle(pathname, res) {
      if (pathname === '/__dev/version') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ v: version() }));
        return true;
      }
      if (pathname === '/__dev.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(CLIENT);
        return true;
      }
      return false;
    },
    inject(html) {
      const s = String(html);
      if (s.includes(TAG)) return s;
      const i = s.lastIndexOf('</body>');
      return i < 0 ? s + TAG : s.slice(0, i) + TAG + '\n' + s.slice(i);
    },
  };
}

module.exports = { createDevReload, TAG };
