// When the 3D scene draws a frame (the rules and their reasons are in docs/pacing.md). Pure: no DOM, no THREE, no clock of its own, so node can test it with a made-up stream of
// animation-frame timestamps (test/ofis-pace.test.mjs).
//
//   const pacer = createPacer({ softwareGL });
//   pacer.wake(now, ms = HOLD_MS)   something moves or somebody interacts: draw at the display's own rate from the next frame on, and for `ms` after the last such call
//   pacer.due(now)                  called with the timestamp of EVERY animation frame (what requestAnimationFrame hands over): true when the scene draws now
//   pacer.cost(ms)                  the CPU time of the frame that was just drawn: a scene that costs more than COST_SHARE of a display frame is drawn every 2nd, 3rd, ... frame
//   pacer.shadow(now, casters)      true when the shadow map must be drawn again in this frame (time based: see SHADOW_MOVING_MS); shadowTaken(now) notes a refresh that something else asked for
//   pacer.state                     { moving, fps, period, skip, costSkip, gapSkip, cost, deep }: the decision now, read-only (the QA and the page API read it)
//   pacer.stats / pacer.summary()   counters since the start (raf, drawn, movingDrawn, shadows, wakes, steps, returns, reseeds) and the share of the last seconds that were moving
//
// Rates. Moving (a walker, a door, the camera, a card that follows, a hover, a spring that is not at rest): every animation frame, whatever the display's rate (120 Hz: 120 frames a
// second). Idle (nothing moves, nobody touches): IDLE_FPS. Idle for DEEP_AFTER_MS: DEEP_FPS. Focus is never asked: a visible window that has no focus is watched, not asleep.
// Software GL: SW_FPS always (it draws on the CPU; the decision is still made and counted, so the QA can read it).
//
// Two guards keep the full rate honest. The cost guard reads the CPU time of a frame. It cannot see the GPU, so the gap guard reads what the browser does when the GPU or the compositor
// cannot keep up: animation frames arrive late. While the scene is moving, when at least GAP_LATE_SHARE of the last GAP_WINDOW gaps between animation frames are longer than
// GAP_LATE periods, the scene draws every 2nd, 3rd, ... animation frame (gapSkip + 1). After GAP_CLEAN_MS of clean moving frames it tries one step back; a try that fails within
// GAP_PROBE_MS doubles the wait (up to GAP_BACKOFF_MAX_MS), and at most GAP_MAX_CHANGES changes are made in any GAP_SPAN_MS, so it never flaps.
// The display's period is read from the stream: the median of the first SEED_N gaps, then eased with gaps of about one period, and read again from RESEED_RUN consecutive gaps that are not
// (a window moved to a 60 Hz screen, Chrome's Energy Saver at 30 fps) that are not (and are steady), which also resets the gap guard.
export const IDLE_FPS = 30;
export const DEEP_FPS = 15;
export const DEEP_AFTER_MS = 60000;
export const HOLD_MS = 1000;
export const SW_FPS = 8;
export const COST_SHARE = 0.8;            // the scene may use at most this share of a display frame (the CPU time of the frame): above it every 2nd, 3rd, ... frame is drawn
export const MAX_SKIP = 4;
export const LABEL_WAKE_MS = 250;         // what the label layout asks for while a label glides to its spot (the hook in ofis.js: wakeForLabels)

export const SEED_N = 12;                 // gaps that give the display's period
export const BAND_LO = 0.7, BAND_HI = 1.4;     // a gap inside this band (in periods) is one display frame, and eases the period
export const RESEED_RUN = 12;             // this many gaps in a row outside the band, and steady, make a new period
export const RESEED_SPREAD = 0.25;        // steady: every one of them within this share of their median
export const STALL_MS = 250;              // a gap longer than this is a stall (a hidden tab, a rebuild, a debugger), not a measure of the display or of the machine

export const GAP_LATE = 1.5;              // a gap longer than this many periods is a late frame
export const GAP_WINDOW = 30;             // the gaps the share is taken over (moving frames only); nothing is decided before the window is full: one late frame in a hundred is a normal display
export const GAP_LATE_SHARE = 0.2;
export const GAP_CLEAN_MS = 5000;         // moving time without a late frame before the guard tries one step back
export const GAP_PROBE_MS = 10000;        // a step down this soon after a step back means the step back failed
export const GAP_BACKOFF_MAX_MS = 60000;
export const GAP_RESET_MS = 60000;        // no change for this long: the wait is the short one again
export const GAP_MAX_CHANGES = 2;         // changes of the gap guard in any GAP_SPAN_MS
export const GAP_SPAN_MS = 10000;

// The shadow map (one directional light, 4096 texels at the biggest building) is drawn again every SHADOW_MOVING_MS while something that casts a shadow moves (times the skip of the
// pacer: a machine that cannot keep up draws fewer shadows with the frames) and every SHADOW_IDLE_MS otherwise (the lamps, the typing and the data sync change it a little)
export const SHADOW_MOVING_MS = 25;
export const SHADOW_IDLE_MS = 400;
export const SHADOW_SLACK_MS = 2;         // the same slack the frame gate has: a frame that comes 2 ms early still counts as the one the interval asks for

const SECONDS_KEPT = 120;
const median = a => { const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };

export function createPacer({ softwareGL = false, idleFps = IDLE_FPS, deepFps = DEEP_FPS, deepAfter = DEEP_AFTER_MS, hold = HOLD_MS, costShare = COST_SHARE, maxFps = 0 } = {}) {
  // a page that has just opened counts as woken (the time origin is its start)
  let busyUntil = -Infinity, lastWake = 0, lastDraw = -Infinity, lastRaf = 0, lastNow = 0, lastShadow = -Infinity;
  let period = 1000 / 60, wasMoving = false;
  const seed = [], outGaps = new Array(RESEED_RUN).fill(0);
  let outRun = 0;
  let cost = 0, costSkip = 1;
  // the gap guard: a ring of the last gaps (1 = late), its fill and late count, the moving time since the last late frame, and the times of the last changes
  const ring = new Uint8Array(GAP_WINDOW);
  let ringI = 0, ringN = 0, ringLate = 0, cleanMs = 0, gapSkip = 1, backoff = GAP_CLEAN_MS, lastReturn = -Infinity, lastChange = -Infinity;
  const changes = [];
  const stats = { raf: 0, drawn: 0, movingRaf: 0, movingDrawn: 0, shadows: 0, shadowSync: 0, wakes: 0, steps: 0, returns: 0, reseeds: 0 };
  // per second (what the page's cadence logger reads): the finished seconds and the one that is running
  const finished = [];
  let cur = { s: -1, raf: 0, drawn: 0, moving: 0, shadows: 0 };

  const ringClear = () => { ring.fill(0); ringI = ringN = ringLate = 0; };
  const guardReset = () => { ringClear(); cleanMs = 0; gapSkip = 1; backoff = GAP_CLEAN_MS; changes.length = 0; lastReturn = lastChange = -Infinity; };
  const canChange = now => changes.length < GAP_MAX_CHANGES || now - changes[0] >= GAP_SPAN_MS;
  function change(now, dir) {
    if (dir > 0) {
      if (now - lastReturn < GAP_PROBE_MS) backoff = Math.min(GAP_BACKOFF_MAX_MS, backoff * 2);
      else if (now - lastChange > GAP_RESET_MS) backoff = GAP_CLEAN_MS;
      stats.steps++;
    } else { lastReturn = now; stats.returns++; }
    gapSkip += dir;
    lastChange = now;
    changes.push(now);
    if (changes.length > GAP_MAX_CHANGES) changes.shift();
    ringClear();
    cleanMs = 0;
  }

  // the display's period from the stream of gaps; true when it was read again (the gap guard has been reset, the gap is not a sample)
  function trackPeriod(gap) {
    if (seed.length < SEED_N) {
      if (gap > 1 && gap < 100) { seed.push(gap); if (seed.length === SEED_N) period = median(seed); }
      return false;
    }
    if (gap > BAND_LO * period && gap < BAND_HI * period) { period += (gap - period) * 0.05; outRun = 0; return false; }
    if (gap > STALL_MS) { outRun = 0; return false; }
    if (outRun === RESEED_RUN) { outGaps.copyWithin(0, 1); outRun--; }               // the last RESEED_RUN odd gaps, oldest out
    outGaps[outRun++] = gap;
    if (outRun < RESEED_RUN) return false;
    // only a steady rhythm is a new display: gaps that are all within RESEED_SPREAD of their median. An overloaded machine hands over frames unevenly (16.7, 25, 16.7 ms on a 120 Hz
    // display), and that is the gap guard's to answer, not a new period: reading it as one made the two fight (the guard steps down, the stream gets fast, the period is read again)
    const m = median(outGaps);
    for (let i = 0; i < RESEED_RUN; i++) if (Math.abs(outGaps[i] - m) > RESEED_SPREAD * m) return false;
    period = m;
    outRun = 0;
    stats.reseeds++;
    guardReset();
    return true;
  }

  // one gap between animation frames, while the scene is moving: is the machine keeping up?
  function guard(now, gap, moving) {
    if (!moving) { wasMoving = false; return; }
    if (!wasMoving) { wasMoving = true; ringClear(); return; }          // the first moving frame after a rest: the gap before it says nothing about the full rate
    if (gap > STALL_MS) { ringClear(); return; }
    const late = gap > GAP_LATE * period ? 1 : 0;
    ringLate += late - ring[ringI];
    ring[ringI] = late;
    ringI = (ringI + 1) % GAP_WINDOW;
    if (ringN < GAP_WINDOW) ringN++;
    if (late) cleanMs = 0; else cleanMs += gap;
    if (gapSkip < MAX_SKIP && ringN === GAP_WINDOW && ringLate >= GAP_LATE_SHARE * ringN && canChange(now)) change(now, 1);
    else if (gapSkip > 1 && cleanMs >= backoff && canChange(now)) change(now, -1);
  }

  const skipNow = () => Math.max(costSkip, gapSkip);
  // the frame spacing while moving: every animation frame, every skip-th one when the machine cannot keep up, and never closer than maxFps asks (whole display frames, rounded up)
  function movingInterval() {
    const k = skipNow(), cap = maxFps > 0 ? Math.max(1, Math.ceil(1000 / maxFps / period - 0.05)) : 1;
    return Math.max(k, cap) > 1 ? Math.max(k, cap) * period : 0;
  }
  function bucket(now) {
    const s = Math.floor(now / 1000);
    if (s === cur.s) return;
    if (cur.s >= 0) { finished.push(cur); if (finished.length > SECONDS_KEPT) finished.shift(); }
    cur = { s, raf: 0, drawn: 0, moving: 0, shadows: 0 };
  }

  return {
    wake(now, ms = hold) {
      lastWake = now;
      stats.wakes++;
      if (now + ms > busyUntil) busyUntil = now + ms;
    },
    cost(ms) {
      cost += (ms - cost) * 0.2;
      if (softwareGL) return;
      const need = Math.min(MAX_SKIP, Math.max(1, Math.ceil(cost / (costShare * period))));
      if (need > costSkip) costSkip = need;                                  // up at once, down only when it would use less than 60 percent of the shorter step (no flapping)
      else if (costSkip > 1 && cost < 0.6 * period * (costSkip - 1)) costSkip--;
    },
    due(now) {
      lastNow = now;
      const moving = now < busyUntil;
      if (lastRaf) {
        const gap = now - lastRaf;
        if (!trackPeriod(gap) && !softwareGL) guard(now, gap, moving);
      }
      lastRaf = now;
      bucket(now);
      stats.raf++; cur.raf++;
      if (moving) { stats.movingRaf++; cur.moving++; }
      let interval;
      if (softwareGL) interval = 1000 / SW_FPS;
      else if (moving) interval = movingInterval();
      else interval = 1000 / (now - lastWake > deepAfter ? deepFps : idleFps);       // the old small slack: a spacing of whole display frames; period / 2 made 75 Hz alternate 26.7 and 40 ms
      if (now - lastDraw < interval - Math.min(2, period / 4)) return false;
      lastDraw = now;
      stats.drawn++; cur.drawn++;
      if (moving) stats.movingDrawn++;
      return true;
    },
    // true when the shadow map is drawn again in this frame: every SHADOW_MOVING_MS (x skip) while a caster moves, every SHADOW_IDLE_MS otherwise
    shadow(now, casters) {
      const gap = now - lastShadow, every = casters ? SHADOW_MOVING_MS * skipNow() : SHADOW_IDLE_MS;
      if (gap < every - SHADOW_SLACK_MS) return false;
      lastShadow = now;
      stats.shadows++; cur.shadows++;
      return true;
    },
    // a refresh that something else asked for (a change of the building, a resize) counts as the last one, so the time rule does not draw another at once
    shadowTaken(now) { lastShadow = now; stats.shadowSync++; },
    get skip() { return skipNow(); },
    get moving() { return lastNow < busyUntil; },
    get state() {
      const moving = lastNow < busyUntil, k = skipNow(), deep = !moving && lastNow - lastWake > deepAfter;
      const fps = softwareGL ? SW_FPS : moving ? +(1000 / (movingInterval() || period)).toFixed(1) : deep ? deepFps : idleFps;
      return { moving, fps, period: +period.toFixed(2), skip: k, costSkip, gapSkip, cost: +cost.toFixed(2), deep, softwareGL, maxFps };
    },
    get stats() { return { ...stats }; },
    // the last `n` finished seconds: how many animation frames came, how many were drawn, how many came while the scene was moving, how many shadow maps; and the share that was moving
    // (a source of motion that is stuck shows as a share near 1 with nobody moving)
    seconds(n = 60) { return finished.slice(-n).map(x => ({ ...x })); },
    summary(n = 60) {
      const rows = finished.slice(-n), raf = rows.reduce((a, r) => a + r.raf, 0), moving = rows.reduce((a, r) => a + r.moving, 0), drawn = rows.reduce((a, r) => a + r.drawn, 0);
      return { seconds: rows.length, raf, drawn, moving, movingShare: raf ? +(moving / raf).toFixed(3) : 0, drawnPerSecond: rows.length ? +(drawn / rows.length).toFixed(1) : 0 };
    },
  };
}
