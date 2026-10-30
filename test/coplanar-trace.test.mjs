// The instrumented copy of tools/qa/coplanar-trace.mjs: it must still apply to the builders as they are now (a change to Batch or Mesher that moves one of its lines fails here, on the
// day of the change, not on the day somebody needs the trace).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyRepo, instrument } from '../tools/qa/coplanar-trace.mjs';

test('coplanar trace: the copy is instrumented in both builders, and the repo is not', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cco-trace-'));
  try {
    copyRepo(dir);
    instrument(dir);
    for (const f of ['ofis.js', 'ofis-env.js']) {
      const copy = readFileSync(join(dir, 'public/js', f), 'utf8'), real = readFileSync(new URL(`../public/js/${f}`, import.meta.url), 'utf8');
      assert.ok(copy.includes('__site()') && copy.includes('userData.src = this.src'), `${f} in the copy records its call sites`);
      assert.ok(!real.includes('__site'), `${f} in the repo is untouched`);
    }
    assert.ok(readFileSync(join(dir, 'public/js/ofis-env.js'), 'utf8').includes('"ftri@"'), 'the flat triangles of the street are traced too');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
