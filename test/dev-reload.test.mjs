import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const { createDevReload, TAG } = createRequire(import.meta.url)('../dev-reload.js');

const site = () => {
  const dir = mkdtempSync(join(tmpdir(), 'cco-dev-'));
  mkdirSync(join(dir, 'js'));
  mkdirSync(join(dir, 'vendor'));
  mkdirSync(join(dir, 'models'));
  writeFileSync(join(dir, 'index.html'), '<html><body>hi</body></html>');
  writeFileSync(join(dir, 'js', 'a.js'), 'export const a = 1;');
  return dir;
};
const clock = () => { let t = 1000; const f = () => t; f.tick = ms => { t += ms; }; return f; };
const fakeRes = () => ({ status: 0, headers: null, body: '', writeHead(s, h) { this.status = s; this.headers = h; }, end(b) { this.body = String(b); } });

test('dev reload: the version is stable until a served file changes, is added or is removed', () => {
  const dir = site(), now = clock(), d = createDevReload({ publicDir: dir, now });
  const v0 = d.version();
  now.tick(2000);
  assert.equal(d.version(), v0, 'nothing changed: the same version');
  writeFileSync(join(dir, 'js', 'a.js'), 'export const a = 22;');
  now.tick(2000);
  const v1 = d.version();
  assert.notEqual(v1, v0, 'a changed file');
  writeFileSync(join(dir, 'js', 'b.js'), '');
  now.tick(2000);
  const v2 = d.version();
  assert.notEqual(v2, v1, 'an added file');
  rmSync(join(dir, 'js', 'b.js'));
  now.tick(2000);
  assert.notEqual(d.version(), v2, 'a removed file');
  rmSync(dir, { recursive: true, force: true });
});

test('dev reload: only the mtime of a file is enough, and the vendored libraries and the models are skipped', () => {
  const dir = site(), now = clock(), d = createDevReload({ publicDir: dir, now });
  const v0 = d.version();
  writeFileSync(join(dir, 'vendor', 'three.js'), 'x');
  writeFileSync(join(dir, 'models', 'tree.glb'), 'x');
  now.tick(2000);
  assert.equal(d.version(), v0, 'vendor and models do not change the version');
  const t = new Date(Date.now() + 60000);
  utimesSync(join(dir, 'index.html'), t, t);
  now.tick(2000);
  assert.notEqual(d.version(), v0, 'a touched file');
  rmSync(dir, { recursive: true, force: true });
});

test('dev reload: the folder is looked at once a second however many pages ask', () => {
  const dir = site(), now = clock(), d = createDevReload({ publicDir: dir, now });
  const v0 = d.version();
  writeFileSync(join(dir, 'js', 'a.js'), 'export const a = 333;');
  now.tick(300);
  assert.equal(d.version(), v0, 'inside the second: the cached answer');
  now.tick(800);
  assert.notEqual(d.version(), v0, 'after the second: looked at again');
  rmSync(dir, { recursive: true, force: true });
});

test('dev reload: the two routes answer, others are left alone, the script tag is added once before </body>', () => {
  const dir = site(), d = createDevReload({ publicDir: dir });
  const r1 = fakeRes();
  assert.equal(d.handle('/__dev/version', r1), true);
  assert.equal(r1.status, 200);
  assert.equal(r1.headers['Cache-Control'], 'no-store');
  assert.match(JSON.parse(r1.body).v, /^[0-9a-z]+-\d+$/);
  const r2 = fakeRes();
  assert.equal(d.handle('/__dev.js', r2), true);
  assert.match(r2.body, /\/__dev\/version/);
  assert.match(r2.body, /Reload/);
  assert.doesNotMatch(r2.body, /location\.reload\(\)\s*;?\s*\n\s*\}\s*catch/, 'it only reloads when the button is clicked');
  assert.equal(d.handle('/api/state', fakeRes()), false);
  const html = d.inject('<html><body>hi</body></html>');
  assert.equal(html.split(TAG).length - 1, 1);
  assert.ok(html.indexOf(TAG) < html.indexOf('</body>'));
  assert.equal(d.inject(html), html, 'a second injection changes nothing');
  assert.equal(d.inject('no body tag'), 'no body tag' + TAG);
  rmSync(dir, { recursive: true, force: true });
});
