// Modal dialogs: How to play, Stats, Settings. Native <dialog> + showModal()
// gives us inert background, Esc to close and focus containment.
import { esc, html, $, $$, fmtCountdown, contrastText } from './util.js';

let lastFocus = null;

export function openDialog(id, title, bodyHtml, { onClose, wide = false } = {}) {
  closeAll();
  lastFocus = document.activeElement;
  const dlg = html(`
    <dialog class="dialog${wide ? ' dialog-wide' : ''}" id="${id}" aria-labelledby="${id}-title">
      <div class="dialog-inner">
        <header class="dialog-head">
          <h2 id="${id}-title">${esc(title)}</h2>
          <button class="icon-btn" data-close aria-label="Close">${ICON.close}</button>
        </header>
        <div class="dialog-body">${bodyHtml}</div>
      </div>
    </dialog>`);
  document.body.appendChild(dlg);
  const close = () => dlg.close();
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) close(); // backdrop click
    if (e.target.closest('[data-close]')) close();
  });
  dlg.addEventListener('close', () => {
    dlg.remove();
    onClose?.();
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
  });
  dlg.showModal();
  // Focus the first meaningful control rather than the close button where possible.
  const first = $('[data-autofocus]', dlg) || $('[data-close]', dlg);
  first?.focus({ preventScroll: true });
  const body = $('.dialog-body', dlg); if (body) body.scrollTop = 0;
  // Explicit focus trap (some browsers let Tab escape to browser chrome).
  dlg.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', dlg).filter((n) => !n.disabled && n.offsetParent !== null);
    if (!f.length) return;
    const a = f[0], b = f[f.length - 1];
    if (e.shiftKey && document.activeElement === a) { e.preventDefault(); b.focus(); }
    else if (!e.shiftKey && document.activeElement === b) { e.preventDefault(); a.focus(); }
  });
  return dlg;
}

export function closeAll() {
  $$('dialog[open]').forEach((d) => d.close());
}

export const ICON = {
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  help: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.6 2.3c-.8.4-1.2 1-1.2 1.9v.4"/><circle cx="12" cy="17" r=".6" class="fill"/></svg>',
  stats: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19V11M12 19V5M19 19v-6"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/></svg>',
  theme: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16z" class="fill"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  enter: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6v5a3 3 0 0 1-3 3H6M10 10l-4 4 4 4"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>',
};

/* ---------------------------------------------------------------- */

export function tierChip(tier, text = tier.label) {
  const bg = `var(--t-${tier.id})`;
  return `<span class="tier-chip" style="--chip:${bg};--chip-ink:${contrastText(tier.color)}">${esc(text)}</span>`;
}

export function howToPlay(ctx) {
  const ladder = ctx.ladder.map((t) => `
      <li><span class="lad-dot" style="background:var(--t-${t.id})"></span>
        <span class="lad-name">${esc(t.label)}</span>
        <span class="lad-rule">${esc(ladderRule(t))}</span>
        <span class="lad-pts num">${t.points}</span></li>`).join('');
  const decoy = ctx.tier('decoy');
  const miss = ctx.tier('miss');
  const body = `
    <p class="lede">Seven prompts a day, the same for everyone. Any right answer counts, but the fewer people who would say it, the more it scores.</p>
    <div class="howto-example">
      <p class="howto-q">Name a pasta shape</p>
      <p><b>Spaghetti</b> is what half the room says. <b>Strozzapreti</b> is what an outlier says.</p>
    </div>
    <h3>How rare is your answer?</h3>
    <ol class="ladder" aria-label="Scoring tiers, from most common to rarest">${ladder}</ol>
    <ul class="howto-rules">
      <li><span class="lad-dot" style="background:var(--t-decoy)"></span><span><b>${esc(decoy?.label || 'Decoy')} (${decoy?.points ?? 5} pts).</b> Some prompts hide the famous "obscure" answer that everyone reaches for when trying to be clever. It scores almost nothing.</span></li>
      <li><span class="strike-demo" aria-hidden="true"><i></i><i></i><i></i></span><span><b>Three guesses per prompt.</b> Every answer we don't accept uses one, close calls included. Run out and the round ends with ${miss?.points ?? 0} points. Typing the same thing twice is free.</span></li>
      <li><span class="heat heat-demo is-on" data-level="2" data-heat="warm" aria-hidden="true"><span class="heat-track"><i></i><i></i><i></i></span></span><span><b>Feel the heat.</b> Misspell a real answer and a heat gauge tells you how close you are, from lukewarm to scorching. It never shows letters. Fix it and try again.</span></li>
      <li><span class="drift-demo" aria-hidden="true"><i></i><i></i><i></i><b></b></span><span><b>The Drift.</b> Every point carries your dot further from the crowd, past milestones from Past the Queue to Lone Star. How far out can you get?</span></li>
      <li><span class="timer-demo" aria-hidden="true">25</span><span><b>25 seconds a prompt.</b> Turn on Relaxed mode in Settings to play without the clock. Your streak counts either way.</span></li>
    </ul>
    <button class="btn btn-primary btn-block" data-close data-autofocus>Got it</button>`;
  return openDialog('dlg-help', 'How to play', body);
}

function ladderRule(t) {
  if (t.id === 'outlier') return 'our favourite answer';
  if (t.min != null && t.max != null) {
    if (t.max >= 100) return `${t.min}%+ of people`;
    if (t.min <= 0 || t.min <= 1) return `${t.max}% or fewer`;
    return `${t.min}–${t.max}% of people`;
  }
  return '';
}

export function statsDialog(ctx) {
  return openDialog('dlg-stats', 'Statistics', statsPanel(ctx), { wide: true });
}

export function statsPanel(ctx, { highlight } = {}) {
  const s = safeStats(ctx);
  const avg = s.average ?? (s.played ? Math.round(s.totalScore / s.played) : 0);
  const nums = [
    ['Played', s.played], ['Current streak', s.streak], ['Best streak', s.maxStreak],
    ['Best score', s.best], ['Average', avg],
  ].map(([k, v]) => `<div class="stat"><span class="stat-v num">${v}</span><span class="stat-k">${k}</span></div>`).join('');
  const hist = histogram(s.histogram, highlight);
  return `
    <div class="stats-grid">${nums}</div>
    <h3 class="stats-sub">Score distribution</h3>
    ${hist}
    ${tierBar(ctx, s.tiers)}
    ${categoryTable(ctx, s)}
    ${s.played ? '' : '<p class="muted small stats-empty">Finish a daily puzzle to start your record.</p>'}`;
}

function tierBar(ctx, tiers = {}) {
  const order = [...ctx.ladder.map((t) => t.id), 'decoy', 'miss'];
  const total = order.reduce((n, id) => n + (Number(tiers?.[id]) || 0), 0);
  if (!total) return '';
  const segs = order.filter((id) => tiers[id]).map((id) => {
    const t = ctx.tier(id);
    return `<span class="tb-seg" style="flex:${tiers[id]};background:var(--t-${id})" title="${esc(t?.label || id)}: ${tiers[id]}"></span>`;
  }).join('');
  const legend = order.filter((id) => tiers[id]).map((id) => `<li><span class="lad-dot" style="background:var(--t-${id})"></span>${esc(ctx.tier(id)?.label || id)} <span class="num">${tiers[id]}</span></li>`).join('');
  return `<h3 class="stats-sub">Your answers by tier</h3>
    <div class="tier-bar" role="img" aria-label="${order.filter((id) => tiers[id]).map((id) => `${ctx.tier(id)?.label}: ${tiers[id]}`).join(', ')}">${segs}</div>
    <ul class="tier-legend" aria-hidden="true">${legend}</ul>`;
}

function categoryTable(ctx, s) {
  let avgs = {};
  try { avgs = ctx.storage.categoryAverages ? ctx.storage.categoryAverages(s) : {}; } catch { avgs = {}; }
  const rows = Object.entries(avgs).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return '';
  return `<h3 class="stats-sub">Average points by category</h3>
    <ol class="hist cats">${rows.map(([cat, v]) => `
      <li class="hist-row"><span class="hist-k">${esc(cat)}</span><span class="hist-bar"><span style="width:${Math.max(4, v)}%"></span></span><span class="hist-v num">${v}</span></li>`).join('')}</ol>`;
}

function safeStats(ctx) {
  let s = {};
  try { s = ctx.storage.loadStats(ctx.daily.dayNumber()) || {}; } catch { /* ignore */ }
  return { played: 0, streak: 0, maxStreak: 0, best: 0, totalScore: 0, histogram: {}, ...s };
}

function histogram(h = {}, highlight) {
  // Buckets are whatever storage uses; we sort by their numeric lower bound.
  let entries = Object.entries(h || {}).map(([k, v]) => [k, Number(v) || 0]);
  if (!entries.length) {
    entries = [0, 100, 200, 300, 400, 500, 600].map((b) => [String(b), 0]);
  }
  entries.sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));
  const max = Math.max(1, ...entries.map((e) => e[1]));
  const hl = highlight != null ? bucketFor(entries.map((e) => e[0]), highlight) : null;
  const rows = entries.map(([k, v]) => `
      <li class="hist-row${k === hl ? ' is-now' : ''}">
        <span class="hist-k num">${esc(bucketLabel(k))}</span>
        <span class="hist-bar"><span style="width:${Math.max(v ? 6 : 0, (v / max) * 100)}%"></span></span>
        <span class="hist-v num">${v}</span>
      </li>`).join('');
  return `<ol class="hist" aria-label="Your score distribution">${rows}</ol>`;
}

function bucketLabel(k) {
  if (/^\d+$/.test(k)) { const n = +k; return n >= 600 ? `${n}–700` : `${n}–${n + 99}`; }
  return k.replace('-', '–');
}
function bucketFor(keys, score) {
  let best = null;
  for (const k of keys) { const lo = parseFloat(k); if (!Number.isNaN(lo) && score >= lo) best = k; }
  return best;
}

export function settingsDialog(ctx, onChange) {
  const s = ctx.settings();
  const theme = s.theme || 'auto';
  const sw = (key, label, hint) => `
      <label class="setting">
        <span class="setting-text"><span class="setting-label">${label}</span>${hint ? `<span class="setting-hint">${hint}</span>` : ''}</span>
        <input type="checkbox" role="switch" class="switch" data-key="${key}" ${s[key] ? 'checked' : ''}>
      </label>`;
  const body = `
    <form class="settings" onsubmit="return false">
      <fieldset class="setting setting-theme">
        <legend class="setting-label">Theme</legend>
        <div class="seg" role="radiogroup">
          ${['auto', 'light', 'dark'].map((t) => `
            <label><input type="radio" name="theme" value="${t}" ${theme === t ? 'checked' : ''}><span>${t === 'auto' ? 'System' : t[0].toUpperCase() + t.slice(1)}</span></label>`).join('')}
        </div>
      </fieldset>
      ${sw('sound', 'Sound', 'Clicks, ticks and tier chimes')}
      ${sw('haptics', 'Vibration', 'On phones that support it')}
      ${sw('relaxed', 'Relaxed mode', 'No timer. Streaks still count.')}
      ${sw('reducedMotion', 'Reduce motion', 'Calmer animations')}
    </form>
    <p class="muted small settings-foot">Your progress is saved in this browser only.</p>`;
  const dlg = openDialog('dlg-settings', 'Settings', body);
  dlg.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'theme') onChange({ theme: t.value });
    else if (t.dataset.key) onChange({ [t.dataset.key]: t.checked });
  });
  return dlg;
}

export function countdownHtml(ms) {
  return `<span class="num" data-countdown>${fmtCountdown(ms)}</span>`;
}
