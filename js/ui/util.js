// Small DOM + formatting helpers shared by the UI modules.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Turn an HTML string into a single element (or fragment if many roots). */
export function html(str) {
  const t = document.createElement('template');
  t.innerHTML = str.trim();
  return t.content.childElementCount === 1 ? t.content.firstElementChild : t.content;
}

let reducedSetting = false;
export function setReducedMotion(on) {
  reducedSetting = !!on;
  document.documentElement.classList.toggle('reduce-motion', reducedMotion());
}
export function reducedMotion() {
  return reducedSetting || matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Deterministic PRNG (mulberry32) seeded from a string or number. */
export function rng(seed) {
  let h = typeof seed === 'number' ? seed >>> 0 : 2166136261;
  if (typeof seed === 'string') {
    for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  }
  return function () {
    h |= 0; h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Gaussian sample via Box–Muller using the provided uniform PRNG. */
export function gauss(rand) {
  const u = Math.max(rand(), 1e-9), v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Pick black or white text for a background colour (WCAG relative luminance). */
export function contrastText(color) {
  const rgb = parseColor(color);
  if (!rgb) return '#1d1c1a';
  const lin = rgb.map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  const L = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  // contrast vs black = (L+.05)/.05 ; vs white = 1.05/(L+.05)
  return (L + 0.05) / 0.05 >= 1.05 / (L + 0.05) ? '#1d1c1a' : '#ffffff';
}

function parseColor(c) {
  if (!c) return null;
  c = String(c).trim();
  let m = c.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let x = m[1];
    if (x.length <= 4) x = [...x].map((ch) => ch + ch).join('');
    return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16));
  }
  m = c.match(/rgba?\(([^)]+)\)/i);
  if (m) return m[1].split(/[ ,/]+/).slice(0, 3).map(Number);
  return null;
}

export function fmtDate(d, opts = { weekday: 'long', month: 'long', day: 'numeric' }) {
  try { return d.toLocaleDateString(undefined, opts); } catch { return d.toDateString(); }
}

export function fmtCountdown(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/** Animate a number in an element from `from` to `to`. Calls onStep(value). */
export function countUp(el, to, { from = 0, ms = 900, onStep } = {}) {
  return new Promise((resolve) => {
    if (reducedMotion() || ms <= 0 || to === from) {
      el.textContent = String(to); onStep?.(to); resolve(); return;
    }
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / ms);
      const e = 1 - (1 - p) ** 3;
      const v = Math.round(from + (to - from) * e);
      el.textContent = String(v);
      onStep?.(v);
      if (p < 1) requestAnimationFrame(step); else resolve();
    };
    requestAnimationFrame(step);
  });
}

/** Restart a CSS animation class on an element. */
export function flash(el, cls) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth; // reflow so the animation restarts
  el.classList.add(cls);
}

let toastTimer;
export function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

export function pct(pop) {
  const n = Number(pop);
  if (!Number.isFinite(n)) return '';
  return n < 1 ? '<1%' : `${Math.round(n)}%`;
}
