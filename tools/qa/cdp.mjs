// A small Chrome DevTools Protocol client for the QA harness: starts headless Chrome in a throw-away profile (never the user's Chrome,
// never a visible window), drives one page and collects console errors and failed requests. Needs Node 22+ (global WebSocket).
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_BIN || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find(p => existsSync(p));
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function launchChrome({ width = 1500, height = 900, dpr = 1, reducedMotion = false, lang = 'en-US' } = {}) {
  if (!CHROME) throw new Error('no Chrome found; set CHROME_BIN');
  const profile = mkdtempSync(join(tmpdir(), 'cco-qa-chrome.'));
  // Chrome does not exit when its parent is killed (a QA run that times out, crashes or is cancelled), and a headless page with software GL
  // then burns about two cores for as long as the machine is up. So Chrome runs in its own process group under a shell that polls the
  // runner: when the runner is gone the shell kills the group, and kill() below kills the whole group, helpers included.
  const WATCH = 'runner=$PPID; "$@" & chrome=$!; while kill -0 "$runner" 2>/dev/null && kill -0 "$chrome" 2>/dev/null; do sleep 1; done; kill -KILL -- -$$ 2>/dev/null';
  const proc = spawn('/bin/sh', ['-c', WATCH, 'sh', CHROME,
    '--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', `--lang=${lang}`, `--accept-lang=${lang}`,
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', `--window-size=${width},${height}`, 'about:blank',
  ], { stdio: 'ignore', detached: true });
  proc.unref();
  const kill = () => { try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* gone */ } };
  try {
    const portFile = join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 80 && !existsSync(portFile); i++) await sleep(250);
    const port = readFileSync(portFile, 'utf8').split('\n')[0];
    let target;
    for (let i = 0; i < 40 && !target; i++) {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find(t => t.type === 'page');
      if (!target) await sleep(250);
    }
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    let id = 0;
    const pending = new Map(), handlers = [];
    ws.onmessage = m => {
      const d = JSON.parse(m.data);
      if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method) for (const h of handlers) h(d);
    };
    const send = (method, params = {}) => new Promise((res, rej) => {
      const n = ++id;
      pending.set(n, d => (d.error ? rej(new Error(method + ': ' + d.error.message)) : res(d.result)));
      ws.send(JSON.stringify({ id: n, method, params }));
    });
    const page = {
      errors: [], failed: [], requests: [],
      send, sleep,
      on(fn) { handlers.push(fn); },
      async evaluate(expr, awaitPromise = true) {
        const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
        if (r.exceptionDetails) throw new Error('evaluate: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
        return r.result.value;
      },
      async goto(url, settleMs = 1500) {
        page.errors.length = 0; page.failed.length = 0; page.requests.length = 0;
        await send('Page.navigate', { url: 'about:blank' });
        await sleep(100);
        await send('Page.navigate', { url });
        await sleep(settleMs);
      },
      async screenshot(file, clip) {
        const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
        const buf = Buffer.from(r.data, 'base64');
        if (file) writeFileSync(file, buf);
        return buf;
      },
      mouse: {
        async move(x, y) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' }); },
        async down(x, y) { await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); },
        async up(x, y) { await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); },
        async click(x, y) { await page.mouse.move(x, y); await page.mouse.down(x, y); await page.mouse.up(x, y); },
        async drag(x0, y0, x1, y1, steps = 8) {
          await page.mouse.move(x0, y0); await page.mouse.down(x0, y0);
          for (let i = 1; i <= steps; i++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + (x1 - x0) * i / steps, y: y0 + (y1 - y0) * i / steps, button: 'left', buttons: 1 });
          await page.mouse.up(x1, y1);
        },
        async wheel(x, y, deltaY) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY }); },
      },
      async setViewport(w, h, scale = dpr) { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: scale, mobile: false }); },
      async close() { try { await send('Browser.close'); } catch { /* closing */ } kill(); await sleep(200); rmSync(profile, { recursive: true, force: true }); },
    };
    await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable');
    await page.setViewport(width, height, dpr);
    if (reducedMotion) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    page.on(d => {
      const p = d.params;
      if (d.method === 'Runtime.exceptionThrown') page.errors.push('exception: ' + (p.exceptionDetails.exception && p.exceptionDetails.exception.description || p.exceptionDetails.text));
      else if (d.method === 'Runtime.consoleAPICalled' && p.type === 'error') page.errors.push('console.error: ' + p.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
      else if (d.method === 'Log.entryAdded' && p.entry.level === 'error') page.errors.push('log: ' + p.entry.text + (p.entry.url ? ' ' + p.entry.url : ''));
      else if (d.method === 'Network.requestWillBeSent') page.requests.push(p.request.url);
      else if (d.method === 'Network.loadingFailed' && !p.canceled) page.failed.push(`${p.errorText} ${p.requestId}`);
      else if (d.method === 'Network.responseReceived' && p.response.status >= 400) page.failed.push(`${p.response.status} ${p.response.url}`);
    });
    return page;
  } catch (e) { kill(); rmSync(profile, { recursive: true, force: true }); throw e; }
}
