// Game-feel effects: one shared particle canvas plus small WAAPI helpers.
// Everything animates transform/opacity only, and becomes a no-op (or a plain
// fade) under reduced motion.
import { reducedMotion } from './util.js';

/* ---------------------------------------------------------------- */
/* Colour helpers                                                    */
/* ---------------------------------------------------------------- */
const root = document.documentElement;
export function cssVar(name, fallback = '#888') {
  const v = getComputedStyle(root).getPropertyValue(name).trim();
  return v || fallback;
}
export const tierColor = (id) => cssVar(`--t-${id}`, cssVar('--ink'));

/** Rarity rank 0..5 used to scale every effect. */
const RANK = { miss: 0, decoy: 0, crowd: 0, common: 1, uncommon: 2, rare: 3, obscure: 4, outlier: 5 };
export const rankOf = (tierId) => RANK[tierId] ?? 0;

/* ---------------------------------------------------------------- */
/* Particle canvas (single, full-viewport, pointer-events: none)     */
/* ---------------------------------------------------------------- */
let canvas, g2d, dpr = 1, raf = 0;
const parts = [];
const rings = [];

function ensureCanvas() {
  if (canvas) return;
  canvas = document.createElement('canvas');
  canvas.className = 'fx-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  g2d = canvas.getContext('2d');
  const size = () => {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
  };
  size();
  addEventListener('resize', size);
}

function loop(now) {
  const W = canvas.width, H = canvas.height;
  g2d.clearRect(0, 0, W, H);
  g2d.save();
  g2d.scale(dpr, dpr);
  // rings
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i];
    if (now < r.t0) continue; // delayed ring not started yet
    const t = Math.min(1, (now - r.t0) / r.dur);
    if (t >= 1) { rings.splice(i, 1); continue; }
    const e = 1 - (1 - t) ** 3;
    g2d.globalAlpha = (1 - t) * r.alpha;
    g2d.strokeStyle = r.color;
    g2d.lineWidth = r.width * (1 - t) + 0.5;
    g2d.beginPath();
    g2d.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * e, 0, Math.PI * 2);
    g2d.stroke();
  }
  // particles
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    const age = now - p.t0;
    if (age < 0) continue;
    if (age > p.life) { parts.splice(i, 1); continue; }
    const dt = Math.min(32, now - (p.last || now)) / 16.67;
    p.last = now;
    p.vx *= p.drag ** dt; p.vy = p.vy * p.drag ** dt + p.grav * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
    const k = age / p.life;
    g2d.globalAlpha = (1 - k * k) * p.alpha;
    g2d.fillStyle = p.color;
    const s = p.size * (1 - k * 0.5);
    if (p.shape === 0) { g2d.beginPath(); g2d.arc(p.x, p.y, s, 0, Math.PI * 2); g2d.fill(); }
    else {
      g2d.save(); g2d.translate(p.x, p.y); g2d.rotate(p.rot);
      if (p.shape === 1) g2d.fillRect(-s, -s * 0.45, s * 2, s * 0.9);
      else { g2d.beginPath(); g2d.moveTo(0, -s * 1.4); g2d.lineTo(s * 0.5, 0); g2d.lineTo(0, s * 1.4); g2d.lineTo(-s * 0.5, 0); g2d.closePath(); g2d.fill(); }
      g2d.restore();
    }
  }
  g2d.restore();
  if (parts.length || rings.length) raf = requestAnimationFrame(loop);
  else { raf = 0; g2d.clearRect(0, 0, W, H); }
}
function kick() { if (!raf) raf = requestAnimationFrame(loop); }

/**
 * Spray particles from (x, y) in viewport pixels.
 * opts: colors[], count, speed, spread (radians, around `angle`), angle, gravity, life, size
 */
export function burst(x, y, { colors = ['#f07a2a'], count = 20, speed = 6, spread = Math.PI * 2, angle = -Math.PI / 2, gravity = 0.16, life = 900, size = 3.2, drag = 0.94, delay = 0 } = {}) {
  if (reducedMotion() || count <= 0) return;
  ensureCanvas();
  const now = performance.now() + delay;
  for (let i = 0; i < count; i++) {
    const a = angle + (Math.random() - 0.5) * spread;
    const v = speed * (0.35 + Math.random() * 0.85);
    parts.push({
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      grav: gravity, drag, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.35,
      size: size * (0.5 + Math.random() * 0.8), color: colors[i % colors.length],
      shape: i % 3, alpha: 0.95, t0: now + Math.random() * 60, life: life * (0.6 + Math.random() * 0.6),
    });
  }
  if (parts.length > 600) parts.splice(0, parts.length - 600);
  kick();
}

/** Expanding ring from (x, y). */
export function shockwave(x, y, { color = '#f07a2a', r0 = 8, r1 = 120, width = 3, dur = 650, alpha = 0.85, delay = 0 } = {}) {
  if (reducedMotion()) return;
  ensureCanvas();
  rings.push({ x, y, color, r0, r1, width, dur, alpha, t0: performance.now() + delay });
  kick();
}

/* ---------------------------------------------------------------- */
/* DOM effects                                                       */
/* ---------------------------------------------------------------- */
const center = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, r }; };
export { center };

/** Decaying horizontal shake (translateX only). */
export function shake(el, { amp = 8, ms = 420, axis = 'x' } = {}) {
  if (!el || reducedMotion()) return;
  const frames = [];
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const d = i === n ? 0 : amp * (1 - i / n) * (i % 2 ? -1 : 1);
    const t = axis === 'x' ? `translateX(${d}px)` : `translate(${d * 0.6}px, ${d * (i % 3 === 0 ? 0.5 : -0.4)}px)`;
    frames.push({ transform: t });
  }
  el.animate(frames, { duration: ms, easing: 'linear' });
}

/** Short squash on submit. */
export function press(el) {
  if (!el || reducedMotion()) return;
  el.animate([{ transform: 'scale(1)' }, { transform: 'scale(.98)' }, { transform: 'scale(1)' }], { duration: 180, easing: 'cubic-bezier(.3,.7,.3,1)' });
}

/** Pop (scale overshoot) for small UI pieces. */
export function pop(el, { from = 0.4, peak = 1.35, ms = 420 } = {}) {
  if (!el) return;
  if (reducedMotion()) { el.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 200 }); return; }
  el.animate([{ transform: `scale(${from})` }, { transform: `scale(${peak})`, offset: 0.45 }, { transform: 'scale(1)' }], { duration: ms, easing: 'cubic-bezier(.2,.8,.3,1)' });
}

/** The typed word lifts off as a ghost from the input. */
export function ghostWord(input, text) {
  if (!input || !text || reducedMotion()) return;
  const r = input.getBoundingClientRect();
  const cs = getComputedStyle(input);
  const g = document.createElement('span');
  g.className = 'fx-ghost';
  g.textContent = text;
  g.style.cssText = `left:${r.left + parseFloat(cs.paddingLeft)}px;top:${r.top + r.height / 2}px;font:${cs.font};`;
  document.body.appendChild(g);
  g.animate([
    { transform: 'translate(0,-50%) scale(1)', opacity: 0.9 },
    { transform: 'translate(0,-180%) scale(1.08)', opacity: 0 },
  ], { duration: 520, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'forwards' }).onfinish = () => g.remove();
}

/** Floating "+85" that overshoots then drifts up and fades. */
export function floatText(x, y, text, color, { size = 44 } = {}) {
  const el = document.createElement('span');
  el.className = 'fx-points num';
  el.textContent = text;
  el.style.cssText = `left:${x}px;top:${y}px;color:${color};font-size:${size}px;`;
  document.body.appendChild(el);
  const kf = reducedMotion()
    ? [{ opacity: 0, transform: 'translate(-50%,-50%)' }, { opacity: 1, transform: 'translate(-50%,-50%)', offset: 0.3 }, { opacity: 0, transform: 'translate(-50%,-50%)' }]
    : [
      { opacity: 0, transform: 'translate(-50%,-30%) scale(.3)' },
      { opacity: 1, transform: 'translate(-50%,-90%) scale(1.25)', offset: 0.28 },
      { opacity: 1, transform: 'translate(-50%,-110%) scale(1)', offset: 0.5 },
      { opacity: 0, transform: 'translate(-50%,-190%) scale(.96)' },
    ];
  el.animate(kf, { duration: 1100, easing: 'cubic-bezier(.2,.75,.25,1)', fill: 'forwards' }).onfinish = () => el.remove();
}

/** Tier colour floods out from an element (radial blob, transform/opacity only). */
export function flood(el, color, { scale = 1 } = {}) {
  if (!el) return;
  const { x, y } = center(el);
  const b = document.createElement('div');
  b.className = 'fx-flood';
  b.style.cssText = `left:${x}px;top:${y}px;background:radial-gradient(closest-side, ${color} 0%, color-mix(in srgb, ${color} 55%, transparent) 45%, transparent 100%);`;
  document.body.appendChild(b);
  const kf = reducedMotion()
    ? [{ opacity: 0.35, transform: 'translate(-50%,-50%) scale(1)' }, { opacity: 0, transform: 'translate(-50%,-50%) scale(1)' }]
    : [{ opacity: 0.75, transform: 'translate(-50%,-50%) scale(.15)' }, { opacity: 0, transform: `translate(-50%,-50%) scale(${1.2 * scale})` }];
  b.animate(kf, { duration: 700, easing: 'cubic-bezier(.15,.7,.3,1)', fill: 'forwards' }).onfinish = () => b.remove();
}

/** Brief coloured edge vignette (reject = urgent red). */
export function vignette(color) {
  const v = document.createElement('div');
  v.className = 'fx-vignette';
  v.style.boxShadow = `inset 0 0 90px 10px color-mix(in srgb, ${color} 55%, transparent)`;
  document.body.appendChild(v);
  v.animate([{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 0 }], { duration: reducedMotion() ? 300 : 480, easing: 'ease-out', fill: 'forwards' }).onfinish = () => v.remove();
}

/** Accept haptics scaled by rarity. */
export const HAPTIC = {
  crowd: 12, decoy: [12, 60, 12], common: 18, uncommon: 26,
  rare: [24, 40, 30], obscure: [26, 34, 34, 34, 44], outlier: [30, 30, 30, 30, 40, 30, 80],
  reject: [28, 50, 28],
};
