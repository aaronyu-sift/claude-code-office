import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { createOffice } = require('../server.js');

test('server: the 3D models may be cached (an hour, then an ETag and 304), everything else is still no-store', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cco-cache-test-'));
  const office = createOffice({ loadConfigFiles: false, claudeDir: dir, dataDir: dir });
  const srv = http.createServer((req, res) => office.handler(req, res));
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const first = await fetch(`${base}/models/kenney-furniture/desk.glb`);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('content-type'), 'model/gltf-binary');
    assert.match(first.headers.get('cache-control'), /max-age=3600/);
    const etag = first.headers.get('etag');
    assert.match(etag, /^W\/"[0-9a-f]+-[0-9a-f]+"$/);
    assert.equal(Buffer.from(await first.arrayBuffer()).subarray(0, 4).toString(), 'glTF');
    const again = await fetch(`${base}/models/kenney-furniture/desk.glb`, { headers: { 'If-None-Match': etag } });
    assert.equal(again.status, 304, 'an unchanged file is answered with 304');
    assert.equal((await again.arrayBuffer()).byteLength, 0);
    const other = await fetch(`${base}/models/kenney-furniture/desk.glb`, { headers: { 'If-None-Match': 'W/"0-0"' } });
    assert.equal(other.status, 200, 'a different ETag gets the file');
    const lic = await fetch(`${base}/models/kenney-furniture/License.txt`);
    assert.match(lic.headers.get('content-type'), /^text\/plain/);
    assert.equal((await fetch(`${base}/models/kenney-furniture/nope.glb`)).status, 404);
    const raw = path => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: srv.address().port, path }, r => { r.resume(); res(r.statusCode); }).on('error', rej));
    for (const path of ['/models/../server.js', '/models/%2e%2e/%2e%2e/server.js', '/models/..%2f..%2fserver.js']) assert.ok([403, 404].includes(await raw(path)), `${path}: the models folder is no way out of public/`);
    // the event stream shares the handler: it must still answer
    const [status, chunk] = await new Promise((res, rej) => {
      const rq = http.get(`${base}/events`, r => r.once('data', d => { res([r.statusCode, d.toString()]); rq.destroy(); }));
      rq.on('error', () => {});
      setTimeout(() => rej(new Error('no event stream answer')), 5000).unref();
    });
    assert.equal(status, 200);
    assert.match(chunk, /retry: 2000/);
    for (const path of ['/js/ofis.js', '/app.css', '/vendor/three/three.module.min.js', '/pixel/manifest.json', '/api/config']) {
      const r = await fetch(base + path);
      assert.equal(r.status, 200, path);
      assert.equal(r.headers.get('cache-control'), 'no-store', `${path} stays uncached`);
      assert.equal(r.headers.get('etag'), null);
    }
  } finally {
    srv.closeAllConnections();
    await new Promise(r => srv.close(r));
    rmSync(dir, { recursive: true, force: true });
  }
});
