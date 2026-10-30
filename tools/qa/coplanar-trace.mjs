// Makes an instrumented COPY of the Office (the repo is never touched) in which every piece of geometry remembers the builder line that made it, so that a pair the coplanar QA
// reports can be traced to the two lines that must move:
//   node tools/qa/coplanar-trace.mjs <dir>                     copy the repo into <dir> (the server, its modules, public/) and instrument the copy
//   node tools/qa/office3d-coplanar-qa.mjs --root <dir> --list  every pair, each with `[file:line<caller<caller  <  file:line<caller<caller]` for its lower and its upper face
// In the copy, Batch.add / Batch.model (public/js/ofis.js) and Mesher.add / addVC / ftri (public/js/ofis-env.js) record their call site (three frames deep) in
// geometry.userData.src = [[firstVertex, 'ofis.js:627<ofis.js:2210<ofis.js:2799'], ...], and the QA's read (tools/qa/coplanar-read.mjs) hands it on. test/coplanar-trace.test.mjs
// runs this on a temporary copy, so that a change to those four methods breaks the tool in `npm test` and not on the day somebody needs it.
import { cpSync, readdirSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));

const SITE = `
function __site() {
  const out = [];
  for (const l of new Error().stack.split('\\n').slice(1)) {
    if (/Batch\\.|Mesher\\.|__site/.test(l)) continue;
    const m = l.match(/([\\w\\-.]+\\.js):(\\d+):\\d+/);
    if (m) out.push(m[1] + ':' + m[2]);
    if (out.length >= 3) break;
  }
  return out.join('<');
}
`;

export function instrument(dir) {
  const rep = (file, from, to) => {
    const p = join(dir, 'public/js', file);
    const s = readFileSync(p, 'utf8');
    if (!s.includes(from)) throw new Error(`${file}: the line to instrument was not found (the builders changed: update tools/qa/coplanar-trace.mjs): ${from.slice(0, 70)}`);
    writeFileSync(p, s.replace(from, () => to));
  };
  rep('ofis.js', 'constructor() { this.p = []; this.n = []; this.c = []; this.i = []; this.v = 0; this.rg = []; }', 'constructor() { this.p = []; this.n = []; this.c = []; this.i = []; this.v = 0; this.rg = []; this.src = []; }');
  rep('ofis.js', '  add(geo, m, color) {\n    _c.set(color);', '  add(geo, m, color) { this.src.push([this.v, __site()]);\n    _c.set(color);');
  rep('ofis.js', '  model(key, x, y, z, o = {}) {\n    const src = PK[key];', '  model(key, x, y, z, o = {}) { this.src.push([this.v, "model:" + key + "@" + __site()]);\n    const src = PK[key];');
  rep('ofis.js', '    g.computeBoundingSphere();\n    return g;\n  }\n}\n\n// ------------------------------------------------------------ textures', '    g.computeBoundingSphere(); g.userData.src = this.src;\n    return g;\n  }\n}\n\n// ------------------------------------------------------------ textures');
  writeFileSync(join(dir, 'public/js/ofis.js'), readFileSync(join(dir, 'public/js/ofis.js'), 'utf8') + SITE);
  rep('ofis-env.js', '    this.cs = o.alpha ? 4 : 3;', '    this.src = []; this.cs = o.alpha ? 4 : 3;');
  rep('ofis-env.js', '  add(geo, m, color) {\n    const k = C(color)', '  add(geo, m, color) { this.src.push([this.v, __site()]);\n    const k = C(color)');
  rep('ofis-env.js', '  addVC(geo, m, k = null) {\n', '  addVC(geo, m, k = null) { this.src.push([this.v, "vc@" + __site()]);\n');
  rep('ofis-env.js', '    const k = C(color);\n    const i = this.vert(a[0]', '    this.src.push([this.v, "ftri@" + __site()]); const k = C(color);\n    const i = this.vert(a[0]');
  rep('ofis-env.js', '    g.computeBoundingSphere();\n    return g;\n  }\n}\n\n// Draws into a mesher', '    g.computeBoundingSphere(); g.userData.src = this.src;\n    return g;\n  }\n}\n\n// Draws into a mesher');
  writeFileSync(join(dir, 'public/js/ofis-env.js'), readFileSync(join(dir, 'public/js/ofis-env.js'), 'utf8') + SITE);
}

export function copyRepo(dir, from = ROOT) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(from).filter(n => /\.(js|json)$/.test(n) && n !== 'package-lock.json')) cpSync(join(from, f), join(dir, f));
  cpSync(join(from, 'public'), join(dir, 'public'), { recursive: true });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node tools/qa/coplanar-trace.mjs <dir>'); process.exit(2); }
  copyRepo(resolve(dir));
  instrument(resolve(dir));
  console.log(`instrumented copy in ${resolve(dir)}: run  node tools/qa/office3d-coplanar-qa.mjs --root ${resolve(dir)} --list`);
}
