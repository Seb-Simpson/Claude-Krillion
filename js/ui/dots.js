// The "outlier" dot-field motif: a crowd of grey dots, and one dot (yours)
// placed further out the rarer the answer. Pure SVG, no assets.
import { rng, gauss, reducedMotion } from './util.js';

const NS = 'http://www.w3.org/2000/svg';

// Ring order from the crowd outwards. Replaced at boot from scoring TIERS.
let RING = ['crowd', 'common', 'uncommon', 'rare', 'obscure', 'outlier'];
let LABELS = {};
export function setTierRing(ids, labels = {}) {
  if (Array.isArray(ids) && ids.length) RING = ids;
  LABELS = labels;
}

// Band boundaries (field units) for each ring index, crowd at the centre.
const BOUNDS = [0, 30, 70, 110, 150, 190, 232];
function bandMid(i) {
  if (i < 0) return 0;
  if (i >= RING.length - 1) return BOUNDS[Math.min(RING.length, BOUNDS.length - 1)] - 18; // outermost: on the far ring
  return (BOUNDS[i] + BOUNDS[i + 1]) / 2;
}
export function tierRadius(tierId) {
  if (tierId === 'decoy') return 16;
  if (tierId === 'miss') return 0;
  return bandMid(RING.indexOf(tierId));
}

function el(name, attrs = {}, parent) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}

const tierFill = (id) => `var(--t-${id}, var(--ink))`;

/** Scatter a crowd: dense core thinning out exponentially. */
function crowd(g, cx, cy, rand, { n = 80, spread = 20, w = 360, h = 220, cls = 'crowd-dot' } = {}) {
  const dots = [];
  for (let i = 0; i < n; i++) {
    const core = i < n * 0.7;
    let x, y;
    if (core) { x = cx + gauss(rand) * spread; y = cy + gauss(rand) * spread * 0.85; }
    else {
      const r = -Math.log(Math.max(rand(), 1e-6)) * spread * 1.6 + spread * 0.6;
      const a = rand() * Math.PI * 2;
      x = cx + Math.cos(a) * r; y = cy + Math.sin(a) * r * 0.9;
    }
    if (x < 4 || x > w - 4 || y < 4 || y > h - 4) continue;
    const r = 1.8 + rand() * 1.8;
    dots.push(el('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: r.toFixed(2), class: cls, style: `--d:${(rand() * 420) | 0}ms` }, g));
  }
  return dots;
}

function burst(svg, x, y, color, count = 14) {
  if (reducedMotion()) return;
  const g = el('g', { class: 'burst' }, svg);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.4;
    const d = 16 + Math.random() * 22;
    const c = el('circle', { cx: x, cy: y, r: 1.2 + Math.random() * 1.6, style: `fill:${color}` }, g);
    c.animate(
      [{ transform: 'translate(0,0)', opacity: 1 }, { transform: `translate(${Math.cos(a) * d}px,${Math.sin(a) * d}px)`, opacity: 0 }],
      { duration: 650 + Math.random() * 300, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' },
    );
  }
  const ping = el('circle', { cx: x, cy: y, r: 6, class: 'ping', style: `stroke:${color}` }, g);
  ping.animate([{ r: 6, opacity: 0.9 }, { r: 30, opacity: 0 }], { duration: 800, easing: 'ease-out', fill: 'forwards' });
  setTimeout(() => g.remove(), 1200);
}

/* ------------------------------------------------------------------ */
/* Home hero                                                           */
/* ------------------------------------------------------------------ */
export function heroField() {
  const W = 360, H = 200, cx = 118, cy = 112;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'field hero-field', role: 'img', 'aria-label': 'A crowd of grey dots with one orange dot far away from it' });
  const rings = el('g', { class: 'rings' }, svg);
  [34, 74, 114, 154, 194, 234].forEach((r) => el('circle', { cx, cy, r, class: 'ring' }, rings));
  const rand = rng('outlier-hero');
  crowd(el('g', {}, svg), cx, cy, rand, { n: 110, spread: 21, w: W, h: H });
  const tx = 318, ty = 46;
  const trail = el('line', { x1: cx, y1: cy, x2: cx, y2: cy, class: 'trail', style: 'stroke:var(--t-outlier)' }, svg);
  const halo = el('circle', { cx, cy, r: 13, class: 'halo', style: `fill:${tierFill('outlier')}` }, svg);
  const dot = el('circle', { cx, cy, r: 6.5, class: 'you-dot', style: `fill:${tierFill('outlier')}` }, svg);

  function place(p) {
    const x = cx + (tx - cx) * p, y = cy + (ty - cy) * p;
    for (const n of [dot, halo]) { n.setAttribute('cx', x); n.setAttribute('cy', y); }
    trail.setAttribute('x2', x); trail.setAttribute('y2', y);
  }
  function launch(delay = 500) {
    if (reducedMotion()) { place(1); return; }
    place(0);
    const t0 = performance.now() + delay, dur = 1500;
    const step = (now) => {
      const p = Math.max(0, Math.min(1, (now - t0) / dur));
      place(1 - (1 - p) ** 4);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  svg.addEventListener('click', () => launch(0));
  launch();
  return svg;
}

/* ------------------------------------------------------------------ */
/* Round reveal: your dot flies out to its tier ring                   */
/* ------------------------------------------------------------------ */
export function revealField(tierId, seed = 'x') {
  const W = 360, H = 200, cx = 92, cy = 100;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'field reveal-field', 'aria-hidden': 'true' });
  const rings = el('g', { class: 'rings' }, svg);
  const ringEls = {};
  RING.forEach((id, i) => {
    const r = BOUNDS[i + 1] ?? BOUNDS[BOUNDS.length - 1];
    const isLast = i === RING.length - 1;
    const rr = isLast ? bandMid(i) : r;
    const c = el('circle', { cx, cy, r: rr, class: `ring${isLast ? ' ring-outer' : ''}`, 'data-tier': id }, rings);
    ringEls[id] = c;
    const label = LABELS[id] || id;
    const lx = cx + (isLast ? rr : (BOUNDS[i] + r) / 2);
    const t = el('text', { x: lx, y: cy + (i % 2 ? -5 : 11), class: 'ring-label', 'text-anchor': 'middle', 'data-tier': id }, rings);
    t.textContent = i === 0 ? '' : label;
  });
  const rand = rng(`crowd-${seed}`);
  crowd(el('g', { class: 'crowd' }, svg), cx, cy, rand, { n: 70, spread: 15, w: W, h: H });

  // final position
  const r = tierRadius(tierId);
  const ar = rng(`angle-${seed}`);
  let ang = (0.32 + ar() * 0.42) * (ar() < 0.5 ? -1 : 1); // radians, avoid the label axis
  if (r > 0) { const lim = Math.asin(Math.min(1, 80 / r)); ang = Math.sign(ang) * Math.min(Math.abs(ang), lim); }
  const fx = cx + Math.cos(ang) * r, fy = cy + Math.sin(ang) * r;

  const color = tierFill(tierId);
  const trail = el('line', { x1: cx, y1: cy, x2: cx, y2: cy, class: 'trail', style: `stroke:${color}` }, svg);
  const halo = el('circle', { cx, cy, r: 12, class: 'halo', style: `fill:${color}` }, svg);
  const miss = tierId === 'miss';
  const dot = el('circle', { cx, cy, r: 6.5, class: `you-dot${miss ? ' you-miss' : ''}`, style: miss ? '' : `fill:${color}` }, svg);
  if (miss) { halo.remove(); trail.remove(); }

  function set(x, y) {
    for (const n of [dot, halo]) { n.setAttribute('cx', x.toFixed(2)); n.setAttribute('cy', y.toFixed(2)); }
    trail.setAttribute('x2', x.toFixed(2)); trail.setAttribute('y2', y.toFixed(2));
  }
  function hit(id) {
    const ring = ringEls[id];
    if (!ring) return;
    ring.classList.add('ring-hit');
    ring.style.stroke = tierFill(id);
    svg.querySelector(`.ring-label[data-tier="${id}"]`)?.classList.add('label-hit');
  }

  /** Run the flight. Returns a promise that resolves when the dot lands. */
  function play({ onCross } = {}) {
    return new Promise((resolve) => {
      if (miss) { svg.classList.add('landed'); resolve(); return; }
      const finish = () => {
        set(fx, fy); hit(tierId); svg.classList.add('landed');
        if (tierId === 'obscure' || tierId === 'outlier') burst(svg, fx, fy, color, tierId === 'outlier' ? 20 : 12);
        resolve();
      };
      if (reducedMotion()) { finish(); return; }
      const decoy = tierId === 'decoy';
      const peakR = decoy ? bandMid(RING.length - 2) : r;
      const dur = decoy ? 1250 : 380 + (r / 232) * 820;
      const t0 = performance.now();
      let crossed = 0;
      const step = (now) => {
        const p = Math.min(1, (now - t0) / dur);
        let rr;
        if (decoy) {
          // shoot out, stall, get pulled back into the crowd
          rr = p < 0.55 ? peakR * (1 - (1 - p / 0.55) ** 3) : peakR + (r - peakR) * easeInOut((p - 0.55) / 0.45);
        } else {
          rr = r * easeOutBack(p);
        }
        set(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr);
        // ring crossings (outward only)
        while (crossed < RING.length - 1 && rr >= BOUNDS[crossed + 1]) { crossed++; onCross?.(crossed); }
        if (p < 1) requestAnimationFrame(step); else finish();
      };
      requestAnimationFrame(step);
    });
  }
  return { svg, play, dot };
}

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
function easeOutBack(t) { const c1 = 1.25, c3 = c1 + 1; return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2; }

/* ------------------------------------------------------------------ */
/* Summary constellation: 7 rounds plotted by rarity                   */
/* ------------------------------------------------------------------ */
export function constellation(rounds, { size = 7, seed = 'c' } = {}) {
  const W = 360, H = 280, cx = 180, cy = 140, R = 128, scale = R / 232;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'field constellation', role: 'img' });
  const rings = el('g', { class: 'rings' }, svg);
  RING.forEach((id, i) => {
    const isLast = i === RING.length - 1;
    const rr = (isLast ? bandMid(i) : BOUNDS[i + 1]) * scale;
    el('circle', { cx, cy, r: rr, class: `ring${isLast ? ' ring-outer' : ''}` }, rings);
  });
  crowd(el('g', { class: 'crowd' }, svg), cx, cy, rng(`cc-${seed}`), { n: 46, spread: 8, w: W, h: H });

  const pts = [];
  for (let i = 0; i < size; i++) {
    const rd = rounds[i];
    const a = -Math.PI / 2 + (i / size) * Math.PI * 2;
    const tid = rd ? rd.tierId : null;
    const r = rd ? Math.max(tierRadius(tid) * scale, tid === 'miss' ? 7 : 12) : 7;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, a, tid, played: !!rd });
  }
  const played = pts.filter((p) => p.played);
  if (played.length > 1) {
    const d = played.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') + (played.length === size ? ' Z' : '');
    el('path', { d, class: 'shape-fill' }, svg);
    const line = el('path', { d, class: 'shape-line', pathLength: 1 }, svg);
    if (!reducedMotion()) line.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 1100, easing: 'ease-in-out', fill: 'both', delay: 200 });
  }
  pts.forEach((p, i) => {
    const g = el('g', { class: 'star', style: `--i:${i}` }, svg);
    if (!p.played) { el('circle', { cx: p.x, cy: p.y, r: 3, class: 'star-empty' }, g); return; }
    if (p.tid === 'miss') el('circle', { cx: p.x, cy: p.y, r: 4.5, class: 'you-miss' }, g);
    else {
      if (p.tid === 'outlier' || p.tid === 'obscure') el('circle', { cx: p.x, cy: p.y, r: 11, class: 'halo', style: `fill:${tierFill(p.tid)}` }, g);
      el('circle', { cx: p.x, cy: p.y, r: 6, class: 'you-dot', style: `fill:${tierFill(p.tid)}` }, g);
    }
    const lr = 16;
    const t = el('text', { x: (p.x + Math.cos(p.a) * lr).toFixed(1), y: (p.y + Math.sin(p.a) * lr + 3.5).toFixed(1), class: 'star-num', 'text-anchor': 'middle' }, g);
    t.textContent = String(i + 1);
  });
  return svg;
}
