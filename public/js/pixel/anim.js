// The one scheduler of the pixel scene. Nothing runs by itself: a frame is drawn only when something asks for one
// (a pan, a zoom, a state change: `requestFrame`) or while at least one animation source is active (`setActive`), and then at most
// `maxFps` times per second. While the page is hidden nothing is scheduled at all, and with prefers-reduced-motion the animation
// sources are ignored (explicit requests still draw, so the picture stays right).
//
// Everything outside is injected so the rules can be tested without a browser.

export function createScheduler(o) {
  const {
    draw,                                             // (t, animating) => void
    maxFps = 10,
    raf = f => requestAnimationFrame(f),
    caf = id => cancelAnimationFrame(id),
    setTimer = (f, ms) => setTimeout(f, ms),
    clearTimer = id => clearTimeout(id),
    now = () => performance.now(),
    isHidden = () => document.hidden,
    reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  } = o;
  const interval = 1000 / maxFps;
  const sources = new Set();
  const stats = { frames: 0, animFrames: 0, callbacks: 0, since: now() };
  let rafId = 0, timerId = 0, dirty = false, last = -Infinity, dead = false;

  const animating = () => sources.size > 0 && !reducedMotion();

  function frame(t) {
    rafId = 0;
    stats.callbacks++;
    if (dead || isHidden()) return;                   // resumed by wake() when the page shows again
    const anim = animating();
    if (dirty) { dirty = false; last = t; stats.frames++; draw(t, anim); }
    else if (anim && t - last >= interval - 1) { last = t; stats.frames++; stats.animFrames++; draw(t, true); }
    arm();
  }
  function arm() {
    if (dead || rafId || timerId || isHidden()) return;
    if (dirty) { rafId = raf(frame); return; }
    if (!animating()) return;
    const wait = interval - (now() - last);
    if (wait > 24) timerId = setTimer(() => { timerId = 0; if (!rafId && !dead && !isHidden()) rafId = raf(frame); }, wait - 12);
    else rafId = raf(frame);
  }
  return {
    stats,
    setActive(key, on) { if (on) { if (!sources.has(key)) { sources.add(key); arm(); } } else sources.delete(key); },
    requestFrame() { dirty = true; if (timerId) { clearTimer(timerId); timerId = 0; } arm(); },
    wake() { arm(); },                                // call on visibilitychange
    get activeSources() { return [...sources]; },
    get pending() { return !!(rafId || timerId); },
    resetStats() { stats.frames = stats.animFrames = stats.callbacks = 0; stats.since = now(); },
    destroy() { dead = true; if (rafId) caf(rafId); if (timerId) clearTimer(timerId); rafId = timerId = 0; },
  };
}
