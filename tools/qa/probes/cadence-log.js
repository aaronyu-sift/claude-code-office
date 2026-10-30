// PAGE SCRIPT, PASSIVE (for the real GPU): records how the Office is paced while the user works normally, for the focused and the unfocused case. It does NOT draw, loop frames, add an
// animation-frame callback or change anything in the page: once a second it reads what the scene's own pacer already counted (public/js/ofis-pace.js: animation frames that came, frames
// drawn, how many of them were moving, late frames, the longest gap, shadow maps) through the read-only state root.__ofis.pacing / pacingSeconds(), plus a PerformanceObserver for long
// tasks. It costs well under 0.1 ms a second.
//
// WHY THE USER PASTES IT: a tab that chrome-live (Chrome DevTools MCP) drives runs with focus emulation, so document.hasFocus() reads true for it (and the old frame gate asked it). The new
// pacer never asks for focus, but the focus column of this log is still how the "focused" and "another window in front" cases are told apart, and only a page the user left alone shows the
// unfocused case. Paste the whole file into the console of the Office tab once, work normally for a few minutes (another window in front with the Office still visible counts: the walk-in
// happens when the Office tab is reloaded or a chat starts), then read:   window.__cadence.report()      Stop:  __cadence.stop()      (the log keeps the last 900 seconds)
//
// What to expect on a 120 Hz display after the pacing change (docs/pacing.md): while something moves, drawnPerSecond about equal to rafHz (100 or more), and the same with the window not
// focused; at rest 30 (15 after a minute of nothing); latePerSecond under 3, frameMsCpu under 4, gapSkip 1. A gapSkip above 1, or drawnPerSecond far below rafHz while moving, is the guard
// saying the machine cannot hold the rate (then lower maxFps, one line in ofis.js, or send this report back).
(() => {
  const v = document.querySelector('#view-ofis');
  if (!v || !v.__ofis || !v.__ofis.pacingSeconds) return 'no 3D Office with the pacer on this page (open the Office view with ?scene=3d, reload and paste again)';
  if (window.__cadence) window.__cadence.stop();
  const o = v.__ofis3d, s = v.__ofis;
  const sec = [], longTasks = [];
  let lastSecond = -1, po = null;
  try { po = new PerformanceObserver(l => { for (const e of l.getEntries()) longTasks.push({ at: Math.round(e.startTime), ms: Math.round(e.duration) }); }); po.observe({ entryTypes: ['longtask'] }); } catch { /* no longtask support */ }
  let gpu = null;
  try {
    const c = document.createElement('canvas'), gl = c.getContext('webgl2') || c.getContext('webgl'), ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    gpu = { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null, dpr: window.devicePixelRatio };
    const lose = gl && gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
  } catch { /* no WebGL here */ }
  const timer = setInterval(() => {
    const p = s.pacing, rows = s.pacingSeconds(2).seconds;
    for (const r of rows) {
      if (r.s <= lastSecond) continue;
      lastSecond = r.s;
      sec.push({
        at: new Date().toISOString().slice(11, 19), rafHz: r.raf, drawnPerSecond: r.drawn, movingShare: r.raf ? +(r.moving / r.raf).toFixed(2) : 0, shadowsPerSecond: r.shadows, latePerSecond: r.late, maxGapMs: +r.maxGap.toFixed(1),
        // the state at the moment of reading (the second just finished, to within a second)
        decision: p.moving ? 'moving' : p.deep ? 'deep idle' : 'idle', fps: p.fps, periodMs: p.period, skip: p.skip, gapSkip: p.gapSkip, costSkip: p.costSkip, frameMsCpu: s.frameMs, calls: s.calls,
        focus: document.hasFocus(), vis: document.visibilityState, walking: s.walking.length,
      });
    }
    if (sec.length > 900) sec.splice(0, sec.length - 900);
  }, 1000);
  const group = rows => {
    const n = rows.length; if (!n) return null;
    const avg = f => +(rows.reduce((a, r) => a + f(r), 0) / n).toFixed(1);
    return { seconds: n, drawnPerSecond: avg(r => r.drawnPerSecond), rafHz: avg(r => r.rafHz), latePerSecond: avg(r => r.latePerSecond), maxGapMs: +Math.max(...rows.map(r => r.maxGapMs)).toFixed(1), frameMsCpu: avg(r => r.frameMsCpu), shadowsPerSecond: avg(r => r.shadowsPerSecond), drawCalls: avg(r => r.calls), gapSkipMax: Math.max(...rows.map(r => r.gapSkip)) };
  };
  window.__cadence = {
    stop() { clearInterval(timer); if (po) po.disconnect(); delete window.__cadence; return 'stopped'; },
    seconds: sec,
    // the picture: by what the pacer decided and whether the window had focus
    report() {
      const by = (dec, foc) => group(sec.filter(r => r.decision === dec && (foc === undefined || r.focus === foc)));
      const p = s.pacing;
      return {
        recorded: sec.length, gpu, focusSeen: [...new Set(sec.map(r => r.focus))], visibilitySeen: [...new Set(sec.map(r => r.vis))],
        moving_focused: by('moving', true), moving_unfocused: by('moving', false), idle: by('idle'), deep_idle: by('deep idle'),
        guard: { gapSkipNow: p.gapSkip, steps: p.steps, returns: p.returns, reseeds: p.reseeds, costSkipNow: p.costSkip, periodMs: p.period },
        counters: { raf: p.raf, drawn: p.drawn, movingDrawn: p.movingDrawn, late: p.late, shadows: p.shadows, shadowSync: p.shadowSync, wakes: p.wakes },
        movingShareLast60s: s.pacingSeconds(60).summary.movingShare,
        weather: (document.querySelector('.of-stage') || {}).dataset ? document.querySelector('.of-stage').dataset.weather : null, rebuildMs: o.rebuildMs,
        longTasks: longTasks.slice(-30), last10: sec.slice(-10),
        reading: 'moving: drawnPerSecond about equal to rafHz, focused or not; idle 30, deep idle 15; latePerSecond under 3; frameMsCpu under 4; gapSkip 1. movingShareLast60s near 1 with nobody moving would be a source of motion that is stuck.',
      };
    },
  };
  return 'cadence logger installed at ' + new Date().toISOString() + ' (focus now: ' + document.hasFocus() + ', pacer: ' + JSON.stringify({ moving: s.pacing.moving, fps: s.pacing.fps, period: s.pacing.period }) + ')';
})()
