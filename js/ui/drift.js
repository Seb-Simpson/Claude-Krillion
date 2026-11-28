// THE DRIFT — your dot's journey away from the crowd. Distance = running score (0–700).
// One canvas per track; the loop only runs while something moves. Transform/opacity
// for DOM bits (banner, tint); everything else is drawn on the canvas.
import { rng, gauss, reducedMotion, esc } from './util.js';
import { cssVar } from './fx.js';

export const MAX_DRIFT = 700;
export const MILESTONES = [
  { v: 100, name: 'Past the Queue' },
  { v: 200, name: 'Off the Beaten Path' },
  { v: 300, name: 'The Fringe' },
  { v: 400, name: 'Uncharted' },
  { v: 500, name: 'The Far Side' },
  { v: 600, name: 'Beyond the Map' },
  { v: 700, name: 'Lone Star' },
];
export const UNIT = 'out';

const easeOut = (t) => 1 - (1 - t) ** 3;

/* ---------------- page tint (warm paper → cool deep) ---------------- */
let tintEl = null;
export function setTint(score, { instant = false } = {}) {
  if (!tintEl) {
    tintEl = document.createElement('div');
    tintEl.className = 'drift-tint';
    tintEl.setAttribute('aria-hidden', 'true');
    document.body.prepend(tintEl);
  }
  const f = Math.max(0, Math.min(1, score / MAX_DRIFT));
  tintEl.style.transition = instant || reducedMotion() ? 'opacity .3s ease' : 'opacity 1.4s cubic-bezier(.2,.7,.2,1)';
  tintEl.style.opacity = String(f);
}

/* ---------------- the track ---------------- */
/**
 * createDrift({ orient: 'h'|'v', size: 'band'|'full', onMilestone(m), seed })
 * returns { el, set(score), travelTo(score, tierId) → Promise, replay(steps, onProgress) → Promise, destroy() }
 */
export function createDrift({ orient = 'h', size = 'band', onMilestone, seed = 'drift' } = {}) {
  const el = document.createElement('div');
  el.className = `drift drift-${orient} drift-${size}`;
  el.innerHTML = `
    <div class="drift-view"><canvas></canvas><div class="drift-banner" aria-hidden="true"></div></div>
    <p class="drift-count"><span class="num drift-n">0</span><span class="drift-u">${UNIT}</span></p>
    <p class="visually-hidden drift-sr" role="status"></p>`;
  const view = el.querySelector('.drift-view');
  const canvas = el.querySelector('canvas');
  canvas.setAttribute('role', 'img');
  const g = canvas.getContext('2d');
  const nEl = el.querySelector('.drift-n');
  const banner = el.querySelector('.drift-banner');
  const sr = el.querySelector('.drift-sr');
  const horiz = orient === 'h';

  let W = 0, H = 0, dpr = 1;
  let d = 0;                 // displayed distance
  let anim = null;           // { from, to, t0, dur, color, resolve }
  let raf = 0;
  let lastEmit = 0;
  const trail = [];          // world-space particles {U, c, vu, vc, t0, life, color, r}
  const crossed = new Set(); // milestone values already announced
  const queue = [];          // milestone banners waiting
  let bannerBusy = false;
  let colors = {};

  // procedural scenery (seeded so it is stable between rounds)
  const R = rng(seed);
  const crowd = [];
  for (let i = 0; i < 70; i++) {
    const core = i < 44;
    crowd.push({
      du: core ? Math.abs(gauss(R)) * 7 - 4 : 6 + -Math.log(Math.max(R(), 1e-6)) * 38,
      c: gauss(R) * (core ? 0.16 : 0.26),
      z: 0.82 + R() * 0.36,
      r: 1.3 + R() * 1.5,
    });
  }
  const layers = [0.25, 0.5, 0.8].map((z, li) => {
    const pts = [];
    const n = 70 + li * 20;
    for (let i = 0; i < n; i++) pts.push({ u: R(), c: R(), r: 0.5 + R() * (0.6 + z), a: 0.25 + R() * 0.5 });
    return { z, pts };
  });

  function readColors() {
    colors = {
      ink: cssVar('--ink'), ink2: cssVar('--ink-2'), ink3: cssVar('--ink-3'),
      rule: cssVar('--rule'), rule2: cssVar('--rule-2'), crowd: cssVar('--crowd'),
      paper: cssVar('--paper'), you: cssVar('--t-outlier'), dust: cssVar('--drift-dust', cssVar('--crowd')),
    };
  }
  readColors();

  // geometry helpers
  const M = () => (horiz ? W : H);              // main (travel) axis length
  const C = () => (horiz ? H : W);              // cross axis length
  const span = () => (size === 'full' ? 380 : 290); // points visible along the main axis
  const k = () => M() / span();
  const u0 = () => M() * (horiz ? 0.1 : 0.12);
  const crossMid = () => (horiz ? C() * (size === 'full' ? 0.6 : 0.62) : C() * 0.3);
  const cam = (dist) => Math.max(0, u0() + dist * k() - M() * (horiz ? 0.6 : 0.58));
  const xy = (s, c) => (horiz ? [s, c] : [c, H - s]);

  function resize() {
    const r = view.getBoundingClientRect();
    if (!r.width || !r.height) return;
    dpr = Math.min(2, devicePixelRatio || 1);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    draw(performance.now());
  }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  ro?.observe(view);
  const mo = new MutationObserver(() => { readColors(); draw(performance.now()); });
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const onScheme = () => { readColors(); draw(performance.now()); };
  mq.addEventListener?.('change', onScheme);

  function draw(now) {
    if (!W) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const kk = k(), camU = cam(d), cm = crossMid(), CC = C(), MM = M();
    const f = Math.min(1, d / MAX_DRIFT);

    // parallax dust / stars: far layers drift slowly, near layers stream past
    g.fillStyle = colors.dust;
    for (const L of layers) {
      const len = MM + cam(MAX_DRIFT + 60) * L.z;
      for (const p of L.pts) {
        const s = p.u * len - camU * L.z;
        if (s < -4 || s > MM + 4) continue;
        const [x, y] = xy(s, p.c * CC);
        g.globalAlpha = p.a * (0.35 + 0.65 * f) * (0.5 + L.z * 0.5);
        g.beginPath(); g.arc(x, y, p.r, 0, 6.283); g.fill();
      }
    }

    // path: dashed ahead, tinted behind
    const origin = u0() - camU;
    const dotS = u0() + d * kk - camU;
    g.globalAlpha = 1;
    g.lineWidth = 1;
    g.strokeStyle = colors.rule2;
    g.setLineDash([2, 4]);
    line(Math.max(0, dotS), MM, cm);
    g.setLineDash([]);
    g.strokeStyle = colors.you; g.globalAlpha = 0.55; g.lineWidth = 1.5;
    line(Math.max(0, origin), dotS, cm);
    g.globalAlpha = 1;

    // milestones
    g.font = `600 ${size === 'full' ? 11 : 10}px ${cssFont()}`;
    g.textBaseline = 'middle';
    for (const m of MILESTONES) {
      const s = u0() + m.v * kk - camU;
      if (s < -80 || s > MM + 80) continue;
      const passed = d >= m.v - 0.01;
      g.strokeStyle = passed ? colors.you : colors.rule2;
      g.globalAlpha = passed ? 0.8 : 1;
      g.lineWidth = 1;
      const half = horiz ? CC * 0.2 : 9;
      const [x1, y1] = xy(s, cm - half), [x2, y2] = xy(s, cm + half);
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      g.fillStyle = passed ? colors.ink : colors.ink3;
      g.globalAlpha = 1;
      if (horiz) {
        g.textAlign = 'center';
        g.fillText(m.name, s, cm - half - (size === 'full' ? 12 : 9));
        if (size === 'full') { g.fillStyle = colors.ink3; g.fillText(String(m.v), s, cm + half + 11); }
      } else {
        g.textAlign = 'left';
        const [tx, ty] = xy(s, cm + 14);
        g.fillText(m.name, tx, ty - 6);
        g.fillStyle = colors.ink3; g.fillText(`${m.v}`, tx, ty + 7);
      }
    }

    // the crowd: thins and recedes as you drift away
    g.fillStyle = colors.crowd;
    for (const p of crowd) {
      const s = u0() + p.du * kk - camU * p.z;
      if (s < -6 || s > MM + 6) continue;
      const [x, y] = xy(s, cm + p.c * CC * (horiz ? 1 : 0.9));
      g.globalAlpha = 0.9 - f * 0.45;
      g.beginPath(); g.arc(x, y, p.r * (1 - f * 0.25), 0, 6.283); g.fill();
    }

    // trail particles
    for (let i = trail.length - 1; i >= 0; i--) {
      const p = trail[i];
      const age = (now - p.t0) / p.life;
      if (age >= 1) { trail.splice(i, 1); continue; }
      const s = p.U + p.vu * age * 30 - camU;
      const [x, y] = xy(s, cm + p.c + p.vc * age * 30);
      g.globalAlpha = (1 - age) * 0.9;
      g.fillStyle = p.color;
      g.beginPath(); g.arc(x, y, p.r * (1 - age * 0.6), 0, 6.283); g.fill();
    }

    // you
    const [dx, dy] = xy(dotS, cm);
    g.globalAlpha = 0.2;
    g.fillStyle = colors.you;
    g.beginPath(); g.arc(dx, dy, size === 'full' ? 12 : 9, 0, 6.283); g.fill();
    g.globalAlpha = 1;
    g.beginPath(); g.arc(dx, dy, size === 'full' ? 6 : 5, 0, 6.283); g.fill();
    g.lineWidth = 2; g.strokeStyle = colors.paper; g.stroke();
  }
  function line(a, b, c) {
    if (b <= a) return;
    const [x1, y1] = xy(a, c), [x2, y2] = xy(b, c);
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  }
  let fontCache = '';
  function cssFont() { return fontCache || (fontCache = getComputedStyle(document.body).fontFamily); }

  function setCount(v) {
    nEl.textContent = String(Math.round(v));
  }

  function checkMilestones(prev, cur) {
    for (const m of MILESTONES) {
      if (prev < m.v && cur >= m.v && !crossed.has(m.v)) { crossed.add(m.v); queue.push(m); pumpBanner(); }
    }
  }

  function pumpBanner() {
    if (bannerBusy || !queue.length) return;
    // If several were crossed quickly, announce only the furthest so banners never lag the dot.
    const m = queue.splice(0, queue.length).pop();
    bannerBusy = true;
    onMilestone?.(m);
    sr.textContent = `Milestone: ${m.name}, ${m.v} ${UNIT}`;
    banner.innerHTML = `<span class="db-star" aria-hidden="true"></span><span class="db-name">${esc(m.name)}</span><span class="db-v num">${m.v}</span>`;
    const inKf = reducedMotion()
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [{ opacity: 0, transform: 'translate(-50%, -10px) scale(.92)' }, { opacity: 1, transform: 'translate(-50%, 0) scale(1.04)', offset: 0.6 }, { opacity: 1, transform: 'translate(-50%, 0) scale(1)' }];
    const outKf = reducedMotion()
      ? [{ opacity: 1 }, { opacity: 0 }]
      : [{ opacity: 1, transform: 'translate(-50%, 0)' }, { opacity: 0, transform: 'translate(-50%, -8px)' }];
    banner.animate(inKf, { duration: 380, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'forwards' });
    setTimeout(() => {
      banner.animate(outKf, { duration: 320, easing: 'ease-in', fill: 'forwards' }).onfinish = () => { bannerBusy = false; pumpBanner(); };
    }, 1500);
  }

  function frame(now) {
    raf = 0;
    if (anim) {
      const p = Math.min(1, (now - anim.t0) / anim.dur);
      const prev = d;
      d = anim.from + (anim.to - anim.from) * easeOut(p);
      checkMilestones(prev, d);
      setCount(d);
      anim.onProgress?.(d);
      // emit trail in the tier colour
      if (now - lastEmit > 16 && p < 0.92) {
        lastEmit = now;
        const U = u0() + d * k();
        for (let i = 0; i < 3; i++) {
          trail.push({ U, c: (Math.random() - 0.5) * 4, vu: -(0.4 + Math.random() * 1.2), vc: (Math.random() - 0.5) * 0.7, t0: now, life: 500 + Math.random() * 500, color: anim.color, r: 1 + Math.random() * 1.8 });
        }
        if (trail.length > 260) trail.splice(0, trail.length - 260);
      }
      if (p >= 1) { const a = anim; anim = null; d = a.to; setCount(d); a.resolve(); }
    }
    draw(now);
    if (anim || trail.length) raf = requestAnimationFrame(frame);
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };

  function set(score) {
    d = Math.max(0, score);
    for (const m of MILESTONES) if (d >= m.v) crossed.add(m.v);
    setCount(d);
    canvas.setAttribute('aria-label', `Your drift: ${Math.round(d)} ${UNIT} from the crowd`);
    draw(performance.now());
  }

  function travelTo(score, tierId = 'outlier', { dur, onProgress } = {}) {
    const to = Math.max(0, score);
    canvas.setAttribute('aria-label', `Your drift: ${Math.round(to)} ${UNIT} from the crowd`);
    if (anim) { anim.resolve(); anim = null; }
    if (to === d) return Promise.resolve();
    if (reducedMotion()) {
      const prev = d; d = to; setCount(d); onProgress?.(d); checkMilestones(prev, d);
      view.animate([{ opacity: 0.3 }, { opacity: 1 }], { duration: 300 });
      draw(performance.now());
      return Promise.resolve();
    }
    readColors();
    return new Promise((resolve) => {
      anim = {
        from: d, to, t0: performance.now(), resolve, onProgress,
        dur: dur ?? Math.min(1500, 950 + (to - d) * 5),
        color: cssVar(`--t-${tierId}`, colors.you),
      };
      kick();
    });
  }

  /** Summary replay: retrace each round's step, then settle. steps = [{score, tierId}] */
  async function replay(steps, { onProgress } = {}) {
    crossed.clear();
    set(0); crossed.clear();
    for (const st of steps) {
      if (!el.isConnected) return;
      if (st.score > d) {
        await travelTo(st.score, st.tierId, { dur: reducedMotion() ? 0 : Math.min(900, 420 + (st.score - d) * 4), onProgress });
        await new Promise((r) => setTimeout(r, reducedMotion() ? 0 : 140));
      }
    }
  }

  function destroy() {
    cancelAnimationFrame(raf); raf = 0; anim = null;
    ro?.disconnect(); mo.disconnect(); mq.removeEventListener?.('change', onScheme);
  }

  requestAnimationFrame(resize);
  return { el, set, travelTo, replay, destroy, get distance() { return d; } };
}
