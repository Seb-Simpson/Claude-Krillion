// Screens + game controller. All engine/data/sound access goes through `ctx`
// (assembled in js/main.js from the real modules).
import { $, $$, esc, html, sleep, fmtDate, fmtCountdown, countUp, flash, toast, pct, reducedMotion, setReducedMotion } from './util.js';
import { heroField, revealField, constellation, setTierRing } from './dots.js';
import { ICON, openDialog, closeAll, howToPlay, statsDialog, statsPanel, settingsDialog, tierChip } from './dialogs.js';
import * as fx from './fx.js';

const ROUND_MS = 25000;
const READ_IN_MS = 1200;
const STRIKES = 3;
const SEEN_HELP_KEY = 'outlier:ui:seen-help';

const BLURBS = {
  crowd: 'Half the room said this too.',
  common: 'A solid answer plenty of people reach for.',
  uncommon: 'Off the beaten path.',
  rare: 'Few people get here.',
  obscure: 'Almost nobody says this one.',
  outlier: 'Our favourite answer to this prompt. You found it.',
  decoy: 'The clever answer everyone reaches for, so it isn’t rare at all.',
  miss: 'No points this round.',
};

// Near-miss "warmth" copy. Never reveals letters, length or the answer.
const HEAT = {
  hot: { level: 3, text: 'Scorching \u2014 you\u2019re one slip away' },
  warm: { level: 2, text: 'Warm \u2014 check your spelling' },
  tepid: { level: 1, text: 'Lukewarm \u2014 something\u2019s close' },
};
const FLAME = '<svg viewBox="0 0 16 20" aria-hidden="true"><path d="M8 1c.6 3.2 4.8 5 4.8 10.2A4.8 4.8 0 0 1 8 16a4.8 4.8 0 0 1-4.8-4.8c0-2.4 1.3-3.6 2.3-4.7.3 1.5 1 2.3 1.8 2.5C7 6.4 6.8 3.6 8 1z"/></svg>';

let ctx;
let screen;           // #screen element
let session = null;   // current game session
let clock = null;     // running round clock
let countdownTimer = null;
let homeVisited = false;

/* =================================================================== */
/* Boot                                                                */
/* =================================================================== */
export function startApp(context) {
  ctx = context;
  screen = $('#screen');

  // Tier colours + labels come from scoring.js at runtime.
  const root = document.documentElement;
  // 'miss' keeps a per-theme CSS grey so it stays visible on the dark background.
  for (const t of ctx.TIERS) if (t.color && t.id !== 'miss') root.style.setProperty(`--t-${t.id}`, t.color);
  setTierRing(ctx.ladder.map((t) => t.id), Object.fromEntries(ctx.TIERS.map((t) => [t.id, t.label])));

  applySettings(ctx.settings());
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme(ctx.settings().theme));

  // Sound: unlock on first gesture; a click sound on every button by default.
  const unlock = (e) => {
    // Escape and bare modifiers aren't user activation, so the AudioContext would stay blocked.
    if (e.type === 'keydown' && (e.key === 'Escape' || ['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(e.key))) return;
    ctx.sound.unlock(); ctx.sound.setMuted(!ctx.settings().sound);
    removeEventListener('pointerdown', unlock, true);
    removeEventListener('keydown', unlock, true);
  };
  addEventListener('pointerdown', unlock, true);
  addEventListener('keydown', unlock, true);
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b && !b.disabled && !b.hasAttribute('data-silent')) sfx('click');
  }, true);

  // Keep the play area above the on-screen keyboard.
  const vv = window.visualViewport;
  const syncVV = () => {
    const h = vv ? vv.height : innerHeight;
    root.style.setProperty('--vvh', `${h}px`);
    root.style.setProperty('--vvt', `${vv ? vv.offsetTop : 0}px`);
  };
  syncVV();
  vv?.addEventListener('resize', syncVV);
  vv?.addEventListener('scroll', syncVV);
  addEventListener('resize', syncVV);

  document.addEventListener('keydown', onGlobalKey);
  // Persist the running clock so a reload can't buy a fresh 25 seconds.
  const persist = () => { if (clock?.live && session?.game?.state.status === 'playing') { session.game.setElapsed?.(elapsedMs()); saveProgress(); } };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persist(); });
  addEventListener('pagehide', persist);

  renderHome();

  let seen = false;
  try { seen = !!localStorage.getItem(SEEN_HELP_KEY); } catch { /* ignore */ }
  if (!seen) {
    try { localStorage.setItem(SEEN_HELP_KEY, '1'); } catch { /* ignore */ }
    setTimeout(() => howToPlay(ctx), 350);
  }
}

function sfx(name, opts) { try { ctx.sound.play(name, opts); } catch { /* never break the UI */ } }
function haptic(pattern) {
  if (ctx.settings().haptics && navigator.vibrate) { try { navigator.vibrate(pattern); } catch { /* ignore */ } }
}

function applySettings(s) {
  applyTheme(s.theme);
  setReducedMotion(s.reducedMotion);
  try { ctx.sound.setMuted(!s.sound); } catch { /* ignore */ }
  document.documentElement.classList.toggle('relaxed', !!s.relaxed);
}
function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
  const dark = root.dataset.theme === 'dark' || (!root.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  $('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1f1f21' : '#f3f1ec');
}
function updateSettings(patch) {
  ctx.setSettings(patch);
  applySettings(ctx.settings());
}
function cycleTheme() {
  const root = document.documentElement;
  const dark = root.dataset.theme === 'dark' || (!root.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  updateSettings({ theme: dark ? 'light' : 'dark' });
  toast(dark ? 'Light theme' : 'Dark theme');
}

function onGlobalKey(e) {
  if (document.querySelector('dialog[open]')) return;
  if (e.key === 'Enter' && !e.repeat) {
    const next = $('[data-act="next"]', screen);
    if (next && !next.disabled && document.activeElement?.tagName !== 'BUTTON' && document.activeElement?.tagName !== 'INPUT') {
      e.preventDefault();
      next.click();
    }
  }
}

/* =================================================================== */
/* Shared chrome                                                        */
/* =================================================================== */
function topbar({ back = false, title = '' } = {}) {
  return `
    <header class="topbar">
      ${back ? `<button class="icon-btn" data-act="home" aria-label="Back to home">${ICON.back}</button>` : '<span class="topbar-spacer"></span>'}
      ${title ? `<span class="topbar-title">${esc(title)}</span>` : ''}
      <nav class="top-actions" aria-label="Game menu">
        <button class="icon-btn" data-act="help" aria-label="How to play">${ICON.help}</button>
        <button class="icon-btn" data-act="stats" aria-label="Statistics">${ICON.stats}</button>
        <button class="icon-btn" data-act="theme" aria-label="Toggle light or dark theme">${ICON.theme}</button>
        <button class="icon-btn" data-act="settings" aria-label="Settings">${ICON.gear}</button>
      </nav>
    </header>`;
}

function mount(node, { focus } = {}) {
  stopClock();
  clearInterval(countdownTimer);
  screen.replaceChildren(node);
  scrollTo(0, 0);
  screen.onclick = onScreenClick;
  const f = focus === null ? null : focus ? $(focus, screen) : $('h1, h2', screen);
  if (f) { if (!f.hasAttribute('tabindex') && !/INPUT|BUTTON/.test(f.tagName)) f.setAttribute('tabindex', '-1'); f.focus({ preventScroll: true }); }
}

function onScreenClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const act = b.dataset.act;
  const handlers = {
    home: () => { if (session?.mode === 'daily' && session.game.state.status !== 'done') saveProgress(); renderHome(); },
    help: () => howToPlay(ctx),
    stats: () => statsDialog(ctx),
    settings: () => settingsDialog(ctx, updateSettings),
    theme: cycleTheme,
    daily: () => startDaily(),
    practice: () => startPractice(),
    archive: () => renderArchive(),
    'archive-day': () => startArchive(Number(b.dataset.day)),
    pass: () => onPass(),
    next: () => onNext(),
    share: () => onShare(),
    again: () => startPractice(),
  };
  handlers[act]?.();
}

function startCountdown(node) {
  clearInterval(countdownTimer);
  const tick = () => {
    const ms = ctx.daily.msUntilNextDay();
    $$('[data-countdown]', node).forEach((el) => { el.textContent = fmtCountdown(ms); });
    if (ms <= 1000) { clearInterval(countdownTimer); setTimeout(() => { if (screen.contains(node)) renderHome(); }, 1500); }
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}

/* =================================================================== */
/* Home                                                                 */
/* =================================================================== */
function today() { return ctx.daily.dayNumber(new Date()); }

function dayResult(day) {
  try { return ctx.storage.getDayResult(day) || null; } catch { return null; }
}
function dailyResult(day) {
  const r = dayResult(day);
  return r && (r.mode ?? 'daily') === 'daily' ? r : null;
}
function resultScore(r) {
  if (!r) return null;
  if (typeof r === 'number') return r;
  return r.score ?? r.total ?? (Array.isArray(r.rounds) ? r.rounds.reduce((s, x) => s + (x.points || 0), 0) : null);
}

function renderHome() {
  session = null;
  const day = today();
  const done = dailyResult(day);
  let inprog = null;
  if (!done) { try { inprog = ctx.storage.loadInProgress(day); } catch { inprog = null; } }
  const progRound = inprog ? (Number(inprog.roundIndex) || 0) + 1 : 0;
  const total = 7;
  const date = ctx.daily.dateForDay(day);

  let primary;
  if (done) primary = `<button class="btn btn-primary btn-block btn-lg" data-act="daily">See today’s results</button>`;
  else if (inprog) primary = `<button class="btn btn-primary btn-block btn-lg" data-act="daily">Resume puzzle <span class="btn-sub">Prompt ${Math.min(progRound, total)} of ${total}</span></button>`;
  else primary = `<button class="btn btn-primary btn-block btn-lg" data-act="daily">Play today’s puzzle</button>`;

  const node = html(`
    <section class="screen home">
      ${topbar()}
      <div class="home-hero">
        <h1 class="wordmark" aria-label="Outlier"><span aria-hidden="true">Outl<span class="wm-i">ı<span class="wm-dot"></span></span>er</span></h1>
        <p class="tagline">Name the answer nobody else will.</p>
      </div>
      <figure class="hero-figure"></figure>
      <div class="today">
        <div class="today-meta">
          <p class="today-date">${esc(fmtDate(date))}</p>
          <p class="today-num">Puzzle <span class="num">${day}</span></p>
        </div>
        ${done ? `<p class="today-done">You scored <b class="num">${resultScore(done) ?? '–'}</b> today. Next puzzle in ${`<span class="num" data-countdown></span>`}</p>` : ''}
        ${primary}
      </div>
      <ul class="menu">
        ${menuRow('practice', 'Practice', 'Endless random prompts, no streak.')}
        ${menuRow('archive', 'Archive', 'Replay any past puzzle.')}
        ${menuRow('help', 'How to play', 'Rarity tiers, strikes and spelling help.')}
      </ul>
      <footer class="home-foot"><p>Seven prompts a day. New puzzle at midnight.</p></footer>
    </section>`);
  $('.hero-figure', node).appendChild(heroField());
  mount(node, { focus: homeVisited ? 'h1' : null });
  homeVisited = true;
  if (done) startCountdown(node);
}

function menuRow(act, title, sub) {
  return `<li><button class="menu-row" data-act="${act}">
      <span class="menu-text"><span class="menu-title">${title}</span><span class="menu-sub">${sub}</span></span>
      <span class="menu-chev">${ICON.chevron}</span></button></li>`;
}

/* =================================================================== */
/* Starting games                                                       */
/* =================================================================== */
function newGame(mode, day, prompts) {
  return ctx.gameMod.createGame({ mode, day, prompts, roundMs: ctx.settings().relaxed ? null : ROUND_MS });
}

function restoreGame(saved) {
  if (!saved) return null;
  if (typeof saved.current === 'function') return saved;
  const g = ctx.gameMod;
  const fromJSON = g.Game?.fromJSON || g.fromJSON || g.gameFromJSON || g.restoreGame || g.createGame?.fromJSON;
  if (!fromJSON) return null;
  try { return fromJSON(saved, ctx.PROMPTS); } catch (err) { console.warn('[outlier] could not restore game', err); return null; }
}

function startDaily() {
  const day = today();
  const done = dailyResult(day);
  if (done) {
    // Rebuild a finished game for the summary screen.
    const prompts = ctx.daily.promptsForDay(day, ctx.PROMPTS);
    session = makeSession('daily', day, null, prompts, done);
    renderSummary({ fresh: false });
    return;
  }
  let game = null;
  try { game = restoreGame(ctx.storage.loadInProgress(day)); } catch { game = null; }
  if (!game || game.state.day !== day) game = newGame('daily', day, ctx.daily.promptsForDay(day, ctx.PROMPTS));
  session = makeSession('daily', day, game);
  resume();
}

function startArchive(day) {
  const game = newGame('archive', day, ctx.daily.promptsForDay(day, ctx.PROMPTS));
  session = makeSession('archive', day, game);
  sfx('start');
  renderRound();
}

let practiceSeen = [];
function startPractice() {
  let prompts = ctx.daily.randomPrompts(ctx.PROMPTS, 7, practiceSeen);
  if (!prompts || prompts.length < 7) { practiceSeen = []; prompts = ctx.daily.randomPrompts(ctx.PROMPTS, 7, []); }
  practiceSeen.push(...prompts.map((p) => p.id));
  const game = newGame('practice', null, prompts);
  const set = (session?.mode === 'practice' ? session.set : 0) + 1;
  session = makeSession('practice', null, game);
  session.set = set;
  sfx('start');
  renderRound();
}

function makeSession(mode, day, game, prompts, savedResult) {
  return { mode, day, game, prompts: prompts || null, savedResult: savedResult || null, near: {}, corrected: {}, guesses: [], recorded: false, set: 0 };
}

function resume() {
  const st = session.game.state;
  if (st.status === 'done') return finish();
  if (st.status === 'round-over') return renderRound({ revealOnly: true });
  sfx('start');
  renderRound();
}

function saveProgress() {
  if (session?.mode !== 'daily') return;
  try { ctx.storage.saveInProgress(session.game); } catch (err) { console.warn('[outlier] save failed', err); }
}

/* =================================================================== */
/* Round                                                                */
/* =================================================================== */
function progressDots() {
  const st = session.game.state;
  const n = session.game.prompts?.length || 7;
  const items = [];
  for (let i = 0; i < n; i++) {
    const r = st.rounds[i];
    const cur = i === st.roundIndex && st.status !== 'done';
    const label = r ? `Prompt ${i + 1}: ${ctx.tier(r.tierId)?.label}` : `Prompt ${i + 1}${cur ? ', current' : ''}`;
    items.push(`<li class="pdot${r ? ' is-done' : ''}${cur ? ' is-current' : ''}" style="${r ? `--c:var(--t-${r.tierId})` : ''}"><span class="visually-hidden">${esc(label)}</span></li>`);
  }
  return `<ol class="progress" aria-label="Progress">${items.join('')}</ol>`;
}

function modeLabel() {
  if (session.mode === 'daily') return `Puzzle ${session.day}`;
  if (session.mode === 'archive') return `Archive · Puzzle ${session.day}`;
  return `Practice${session.set ? ` set ${session.set}` : ''}`;
}

function renderRound({ revealOnly = false } = {}) {
  const g = session.game;
  const st = g.state;
  const prompt = g.current();
  const relaxed = !!ctx.settings().relaxed;
  session.guesses = [];
  const node = html(`
    <section class="screen play" aria-label="${esc(modeLabel())}">
      <header class="play-top">
        <button class="icon-btn" data-act="home" aria-label="Leave game (progress is saved)">${ICON.back}</button>
        ${progressDots()}
        <span class="play-count num" aria-label="Prompt ${st.roundIndex + 1} of 7">${st.roundIndex + 1}<span class="of">/7</span></span>
      </header>
      <div class="play-stage">
        <div class="q">
          <div class="q-head">
            <div class="q-tags">
              <span class="cat-chip">${esc(prompt.category)}</span>
              <span class="q-mode">${esc(modeLabel())}</span>
            </div>
            ${relaxed ? '' : `
            <div class="timer" role="timer" aria-live="off">
              <svg viewBox="0 0 64 64" aria-hidden="true"><circle class="timer-track" cx="32" cy="32" r="28" pathLength="100"/><circle class="timer-bar" cx="32" cy="32" r="28" pathLength="100"/></svg>
              <span class="timer-num num">25</span>
              <span class="visually-hidden timer-sr"></span>
            </div>`}
          </div>
          <h2 class="q-prompt" id="q-prompt">${esc(prompt.prompt)}</h2>
        </div>
      </div>
      <div class="dock">
        <ul class="guesses" aria-label="Guesses not on the list"></ul>
        <div class="fb-row">
          <span class="heat" data-level="0" aria-hidden="true"><span class="heat-flame">${FLAME}</span><span class="heat-track"><i></i><i></i><i></i></span></span>
          <p class="feedback" aria-live="polite" id="feedback"><span class="ready">Get ready…</span></p>
        </div>
        <form class="answer-form" autocomplete="off" novalidate>
          <label class="visually-hidden" for="answer">Your answer to: ${esc(prompt.prompt)}</label>
          <input id="answer" class="answer" type="text" inputmode="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="go" maxlength="60" placeholder="Type an answer" aria-describedby="feedback">
          <button type="submit" class="go" aria-label="Submit answer" data-silent>${ICON.enter}</button>
        </form>
        <div class="dock-foot">
          <span class="strikes" aria-label="Strikes: 0 of 3"><i></i><i></i><i></i></span>
          <span class="dock-hint">${relaxed ? 'Relaxed mode: no clock' : 'Press Enter to answer'}</span>
          <button class="btn-text" data-act="pass" data-silent>Pass</button>
        </div>
      </div>
    </section>`);
  mount(node, { focus: '#answer' });
  if (revealOnly) { showReveal(st.rounds[st.roundIndex], { instant: false }); return; }

  const input = $('#answer', node);
  const form = $('.answer-form', node);
  let lastLen = 0, k = 0;
  input.addEventListener('input', () => {
    if (input.value.length > lastLen) {
      sfx('type');
      // Alternate two identical keyframes so the pop restarts without a reflow.
      input.classList.remove(k ? 'k1' : 'k2'); input.classList.add(k ? 'k2' : 'k1'); k ^= 1;
    }
    lastLen = input.value.length;
    input.classList.remove('is-near', 'is-reject');
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); onSubmit(); });
  // Restore guesses that already cost a strike (resumed rounds).
  for (const gu of st.guesses || []) if (gu.kind === 'none') addGuessChip(gu.input);
  updateStrikes();
  startClock(relaxed, Math.min(ROUND_MS - 3000, Number(st.elapsedMs) || 0));
}

/* ---------------- clock ---------------- */
function startClock(relaxed, offset = 0) {
  stopClock();
  const ring = $('.timer', screen);
  const bar = $('.timer-bar', screen);
  const num = $('.timer-num', screen);
  const sr = $('.timer-sr', screen);
  const c = { live: false, t0: 0, raf: 0, readTimer: 0, lastSec: null, relaxed };
  clock = c;
  const readIn = reducedMotion() ? 600 : READ_IN_MS;
  // read-in: ring fills up
  if (ring && !reducedMotion()) {
    ring.classList.add('is-reading');
    bar.style.transition = `stroke-dashoffset ${readIn}ms cubic-bezier(.3,.7,.2,1)`;
    bar.style.strokeDashoffset = '100';
    requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.strokeDashoffset = '0'; }));
  }
  c.readTimer = setTimeout(() => {
    if (clock !== c) return;
    c.live = true;
    c.t0 = performance.now() - offset;
    ring?.classList.remove('is-reading');
    if (bar) bar.style.transition = 'none';
    const fb = $('#feedback', screen);
    if (fb && fb.querySelector('.ready')) fb.textContent = '';
    $('.play', screen)?.classList.add('is-live');
    if (relaxed) return;
    const loop = (now) => {
      if (clock !== c) return;
      const elapsed = now - c.t0;
      const remain = Math.max(0, ROUND_MS - elapsed);
      const frac = remain / ROUND_MS;
      bar.style.strokeDashoffset = String(100 - frac * 100);
      const sec = Math.ceil(remain / 1000);
      if (sec !== c.lastSec) {
        c.lastSec = sec;
        session.game.setElapsed?.(elapsed);
        num.textContent = String(sec);
        if (sec <= 5 && sec > 0) {
          ring.classList.add('is-urgent'); sfx('tickUrgent');
          if (!reducedMotion()) ring.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)', offset: 0.18 }, { transform: 'scale(1)' }], { duration: 520, easing: 'ease-out' });
          $('.play', screen)?.style.setProperty('--warmth', String((6 - sec) / 5));
        }
        else if (sec <= 10 && sec > 0) { ring.classList.add('is-low'); sfx('tick'); }
        if (sec === 10 || sec === 5) sr.textContent = `${sec} seconds left`;
      }
      if (remain <= 0) { onTimeout(); return; }
      c.raf = requestAnimationFrame(loop);
    };
    c.raf = requestAnimationFrame(loop);
  }, readIn);
}

function stopClock() {
  if (!clock) return;
  cancelAnimationFrame(clock.raf);
  clearTimeout(clock.readTimer);
  clock = null;
}

function elapsedMs() {
  if (!clock || !clock.live) return 0;
  return Math.min(ROUND_MS, Math.round(performance.now() - clock.t0));
}

/* ---------------- input handling ---------------- */
function updateStrikes({ crack = false } = {}) {
  const n = session.game.strikes();
  const el = $('.strikes', screen);
  if (!el) return;
  $$('i', el).forEach((pip, i) => pip.classList.toggle('on', i < n));
  if (crack && n > 0) { const pip = $$('i', el)[n - 1]; if (pip) { flash(pip, 'crack'); fx.pop(pip, { from: 1.8, peak: 0.8, ms: 360 }); } }
  el.setAttribute('aria-label', `Strikes: ${n} of ${STRIKES}`);
}

function setFeedback(text, kind = '') {
  const fb = $('#feedback', screen);
  if (!fb) return;
  fb.className = `feedback ${kind ? `fb-${kind}` : ''}`;
  fb.textContent = text;
}

function onSubmit() {
  const input = $('#answer', screen);
  if (!input || !clock) return;
  const value = input.value.trim();
  if (!value) return;
  if (!clock.live) { flash(input, 'nudge'); return; } // still in read-in
  const ms = elapsedMs();
  let res;
  try { res = session.game.submit(value, ms); } catch (err) { console.error(err); return; }
  const m = res.match || { kind: 'none' };

  if (m.kind === 'accept' && res.round) {
    acceptFx(input, value, res.round);
    return endRound(res.round, { delay: reducedMotion() ? 350 : 900, keepDock: true });
  }
  if (m.kind === 'near') {
    showHeat(input, res);
    return;
  }
  if (res.message === 'already-tried') {
    setFeedback('You already tried that one. No strike.', 'reject');
    flash(input, 'nudge');
    input.select();
    return;
  }
  // none: a strike
  sfx('reject');
  haptic(fx.HAPTIC.reject);
  fx.shake($('.answer-form', screen), { amp: 9, ms: 420 });
  flash(input, 'is-reject');
  fx.vignette(fx.cssVar('--urgent', '#c2410c'));
  clearHeat();
  addGuessChip(value);
  updateStrikes({ crack: true });
  if (res.round) { setFeedback('Three strikes. Round over.', 'reject'); return endRound(res.round, { delay: 750 }); }
  const left = STRIKES - session.game.strikes();
  setFeedback(`Not on our list. ${left} ${left === 1 ? 'strike' : 'strikes'} left.`, 'reject');
  input.value = '';
}

/** Near miss: warmth gauge (tepid → warm → hot). No letters, no length, no answer. */
function showHeat(input, res) {
  const heat = HEAT[res.heat] ? res.heat : 'warm';
  const { level, text } = HEAT[heat];
  const closer = res.message === 'closer' || (res.nearCount || 0) >= 2;
  const partial = res.message === 'partial';
  const gauge = $('.heat', screen);
  sfx('near');
  haptic(10);
  if (gauge) {
    gauge.dataset.level = String(level);
    gauge.dataset.heat = heat;
    gauge.classList.add('is-on');
    gauge.classList.toggle('is-flare', closer);
    flash(gauge, 'heat-pulse');
    if (closer && !reducedMotion()) {
      const c = fx.center($('.heat-flame', gauge));
      fx.burst(c.x, c.y, { colors: [fx.cssVar(`--heat-${heat}`), fx.cssVar('--heat-hot')], count: 10 + level * 4, speed: 3.2, spread: 1.4, gravity: -0.05, life: 700, size: 2.2 });
    }
  }
  input.dataset.heat = heat;
  flash(input, 'is-near');
  let msg = partial ? 'Be more specific \u2014 that\u2019s only part of an answer' : text;
  if (closer && !partial) msg += '. Still no strike.';
  setFeedback(msg, 'near');
  input.setSelectionRange(input.value.length, input.value.length);
}

function clearHeat() {
  const gauge = $('.heat', screen);
  if (gauge) { gauge.classList.remove('is-on', 'is-flare'); gauge.dataset.level = '0'; }
  const input = $('#answer', screen);
  if (input) delete input.dataset.heat;
}

/** The accept moment: squash, ghost word, hit-stop, colour flood, shockwave, sparks, +points. */
function acceptFx(input, value, round) {
  const tierId = round.tierId;
  const rank = fx.rankOf(tierId);
  const form = $('.answer-form', screen);
  const color = fx.tierColor(tierId);
  sfx('submit');
  fx.press(form);
  fx.ghostWord(input, value);
  input.value = '';
  input.placeholder = '';
  clearHeat();
  const hitStop = reducedMotion() ? 0 : 80;
  setTimeout(() => {
    if (!form.isConnected) return;
    sfx(`accept-${tierId}`);
    haptic(fx.HAPTIC[tierId] ?? 15);
    const { x, y, r } = fx.center(form);
    fx.flood(form, color, { scale: 0.8 + rank * 0.25 });
    fx.shockwave(x, y, { color, r0: r.height / 2, r1: 90 + rank * 55, width: 2 + rank, dur: 520 + rank * 90 });
    if (rank >= 4) fx.shockwave(x, y, { color, r0: 10, r1: 60 + rank * 40, width: 2, dur: 700, delay: 90, alpha: 0.6 });
    const counts = { crowd: 8, decoy: 6, common: 14, uncommon: 22, rare: 34, obscure: 52, outlier: 84 };
    const extra = tierId === 'outlier' ? [fx.tierColor('rare'), fx.tierColor('obscure'), '#ffffff'] : tierId === 'obscure' ? [fx.tierColor('outlier')] : [];
    fx.burst(x, y - 4, {
      colors: [color, color, ...extra], count: counts[tierId] ?? 10,
      speed: 3.5 + rank * 1.3, spread: tierId === 'decoy' ? 1.2 : Math.PI * (1.1 + rank * 0.18),
      gravity: tierId === 'decoy' ? 0.35 : 0.14, life: 700 + rank * 120, size: 2.6 + rank * 0.35,
    });
    const ptsColor = tierId === 'crowd' ? fx.cssVar('--ink-2') : color;
    fx.floatText(x, r.top - 6, `+${round.points}`, ptsColor, { size: 36 + rank * 5 });
    if (rank >= 4) fx.shake(screen.querySelector('.play'), { amp: rank === 5 ? 7 : 4, ms: 380, axis: 'xy' });
    // progress dot fills with the tier colour and pops
    const dot = $$('.pdot', screen)[session.game.state.roundIndex];
    if (dot) { dot.style.setProperty('--c', `var(--t-${tierId})`); dot.classList.add('is-done'); dot.classList.remove('is-current'); fx.pop(dot, { peak: 1.8 }); }
    setFeedback('', '');
  }, hitStop);
}

function addGuessChip(text) {
  const ul = $('.guesses', screen);
  if (!ul) return;
  const li = document.createElement('li');
  li.textContent = text;
  ul.appendChild(li);
}

function onPass() {
  if (!clock) return;
  let round;
  try { round = session.game.pass(elapsedMs()); } catch (err) { console.error(err); return; }
  sfx('pass');
  endRound(round);
}

function onTimeout() {
  if (!clock) return;
  let round;
  try { round = session.game.timeout(); } catch (err) { console.error(err); return; }
  sfx('timeout');
  haptic(60);
  const ring = $('.timer', screen);
  if (ring) {
    ring.classList.add('is-dead');
    if (!reducedMotion()) ring.animate([{ transform: 'scale(1) rotate(0)' }, { transform: 'scale(1.22) rotate(-8deg)', offset: 0.2 }, { transform: 'scale(.9) rotate(4deg)', offset: 0.55 }, { transform: 'scale(1) rotate(0)' }], { duration: 460, easing: 'cubic-bezier(.3,.7,.3,1)' });
  }
  fx.vignette(fx.cssVar('--urgent', '#c2410c'));
  setFeedback('Time’s up.', 'reject');
  endRound(round, { delay: 500 });
}

async function endRound(round, { delay = 260, keepDock = false } = {}) {
  stopClock();
  const input = $('#answer', screen);
  if (input) { if (keepDock) input.readOnly = true; else input.disabled = true; }
  $$('.dock button', screen).forEach((b) => { b.disabled = true; });
  saveProgress();
  await sleep(reducedMotion() ? 0 : delay);
  showReveal(round);
}

/* =================================================================== */
/* Reveal                                                               */
/* =================================================================== */
function asAnswer(a) {
  if (!a) return null;
  if (Array.isArray(a)) return { name: a[0], pop: a[1] };
  if (typeof a === 'string') return { name: a };
  return a;
}

function showReveal(round, { instant = false } = {}) {
  const g = session.game;
  const st = g.state;
  const idx = st.rounds.indexOf(round) >= 0 ? st.rounds.indexOf(round) : st.roundIndex;
  const prompt = g.current();
  const tier = ctx.tier(round.tierId) || { id: round.tierId, label: round.tierId, points: round.points };
  let rv = {};
  try { rv = g.reveal(idx) || {}; } catch (err) { console.warn(err); }
  const common = (rv.common || []).map(asAnswer).filter(Boolean);
  const rare = (rv.rare || []).map(asAnswer).filter(Boolean);
  const gem = asAnswer(rv.gem);
  const decoys = (rv.decoys || []).map(asAnswer).filter(Boolean);
  const answer = round.answer ? asAnswer(round.answer) : null;
  const isLast = idx >= 6 || st.status === 'done';
  const corrected = round.corrected && round.input && round.answer ? round.input : null;
  const mine = (a) => answer && a && a.name === answer.name;
  const list = (arr) => arr.map((a) => `<li class="${mine(a) ? 'is-mine' : ''}"><span>${esc(a.name)}</span><span class="pop num">${pct(a.pop)}</span></li>`).join('');

  const endedText = {
    timeout: 'Out of time.', pass: 'You passed.', strikes: 'Three strikes.',
  }[round.endedBy] || 'No answer.';

  const decoyHit = round.tierId === 'decoy' && answer;
  const others = `
    <section class="others" aria-labelledby="others-h">
      <h3 id="others-h">What others said</h3>
      <div class="others-cols">
        <div><h4>Most common</h4><ol class="alist">${list(common)}</ol></div>
        <div><h4>Rare picks</h4><ol class="alist">${list(rare)}</ol></div>
      </div>
      ${gem ? `
      <div class="gem${mine(gem) ? ' is-mine' : ''}">
        <span class="gem-dot" aria-hidden="true"></span>
        <div><p class="gem-k">${esc(ctx.tier('outlier')?.label || 'Outlier')} answer</p><p class="gem-name">${esc(gem.name)}</p></div>
        <span class="gem-pts num">${ctx.tier('outlier')?.points ?? 100}</span>
      </div>` : ''}
      ${decoys.length && !decoyHit ? `<p class="decoy-line"><span class="lad-dot" style="background:var(--t-decoy)"></span>The trap here: ${decoys.map((d) => `<b>${esc(d.name)}</b>`).join(' and ')}. It sounds obscure, but everyone tries it.</p>` : ''}
      ${rv.total ? `<p class="total-line"><span class="num">${rv.total}</span> answers on our list for this prompt.</p>` : ''}
    </section>`;

  const stage = $('.play-stage', screen);
  const dock = $('.dock', screen);
  const field = revealField(round.tierId, `${prompt.id}`);
  const node = html(`
    <div class="reveal tier-${esc(round.tierId)}">
      <p class="rv-prompt">${esc(prompt.prompt)}</p>
      <figure class="rv-field"></figure>
      <div class="rv-result">
        <h2 class="rv-answer${answer ? '' : ' is-miss'}">${answer ? esc(answer.name) : esc(endedText)}</h2>
        ${corrected ? `<p class="rv-corrected">Corrected from “${esc(corrected)}”</p>` : ''}
        <div class="rv-tier">${tierChip(tier)}<span class="rv-pts"><span class="plus">+</span><span class="num" data-pts>0</span></span></div>
        <p class="rv-blurb">${decoyHit
          ? `<b>${esc(answer.name)}</b> is the answer people reach for when they’re trying to be clever${answer.pop != null ? `, about ${pct(answer.pop)} of people say it` : ''}. Rare-sounding, but not rare.`
          : esc(answer ? tier.blurb || BLURBS[round.tierId] || '' : (round.endedBy === 'strikes' ? 'Three answers that weren’t on our list.' : BLURBS.miss))}</p>
      </div>
      ${others}
    </div>`);
  $('.rv-field', node).appendChild(field.svg);
  stage.replaceChildren(node);
  stage.scrollTop = 0;
  $('.progress', screen).outerHTML = progressDots();

  dock.className = 'dock dock-reveal';
  dock.innerHTML = `<button class="btn btn-primary btn-block btn-lg" data-act="next" data-silent>${isLast ? 'See your results' : 'Next prompt'}<kbd class="kbd">Enter</kbd></button>`;
  const nextBtn = $('[data-act="next"]', dock);
  nextBtn.disabled = true;
  setTimeout(() => { nextBtn.disabled = false; nextBtn.focus({ preventScroll: true }); }, instant || reducedMotion() ? 50 : 450);

  // Choreography: whoosh, dot flies out, lands with the tier sound.
  const pts = $('[data-pts]', node);
  const resEl = $('.rv-result', node);
  const run = async () => {
    if (answer) sfx('reveal');
    await field.play({});
    resEl.classList.add('in');
    if (answer && field.dot?.isConnected) {
      const rank = fx.rankOf(round.tierId);
      const c = fx.center(field.dot);
      const color = fx.tierColor(round.tierId);
      fx.shockwave(c.x, c.y, { color, r0: 6, r1: 26 + rank * 9, width: 2, dur: 600 });
      if (rank >= 3) fx.burst(c.x, c.y, { colors: [color, fx.tierColor('outlier')], count: 6 + rank * 4, speed: 2.4, life: 650, size: 2 });
      if (instant) sfx(`accept-${round.tierId}`);
    }
    countUp(pts, round.points || 0, { ms: 500 });
    node.classList.add('done');
  };
  run();
}

function onNext() {
  const g = session?.game;
  if (!g) return;
  const st = g.state;
  const isLast = st.roundIndex >= 6 || st.status === 'done';
  if (isLast) { if (st.status !== 'done') { try { g.next(); } catch { /* ignore */ } } return finish(); }
  try { g.next(); } catch (err) { console.error(err); }
  saveProgress();
  sfx('roundNext');
  if (g.state.status === 'done') return finish();
  renderRound();
}

/* =================================================================== */
/* Summary                                                              */
/* =================================================================== */
function finish() {
  const g = session.game;
  const rounds = g.state.rounds;
  const score = g.totalScore();
  if (session.mode === 'daily' && !session.recorded) {
    session.recorded = true;
    if (!dailyResult(session.day)) {
      let before = {};
      try { before = ctx.storage.loadStats() || {}; } catch { /* ignore */ }
      try {
        const after = ctx.storage.recordDaily(session.day, rounds, score) || {};
        if ((after.streak || 0) > (before.streak || 0) && (after.streak || 0) > 1) session.streakUp = after.streak;
      } catch (err) { console.error('[outlier] recordDaily failed', err); }
    }
    try { ctx.storage.clearInProgress(session.day, 'daily'); } catch { /* ignore */ }
  }
  if (session.mode === 'archive') { try { ctx.storage.recordArchive(session.day, rounds, score); } catch { /* ignore */ } }
  renderSummary({ fresh: true });
}

function summaryData() {
  if (session.game) {
    const g = session.game;
    return {
      rounds: g.state.rounds,
      score: g.totalScore(),
      prompts: g.state.prompts || session.prompts || g.prompts || g.state.rounds.map((r) => ctx.PROMPTS.find((p) => p.id === r.promptId)),
    };
  }
  const r = session.savedResult || {};
  const rounds = Array.isArray(r.rounds) ? r.rounds : [];
  return { rounds, score: resultScore(r) ?? 0, prompts: session.prompts || [] };
}

function promptFor(rounds, prompts, i) {
  const id = rounds[i]?.promptId;
  return (id && ctx.PROMPTS.find((p) => p.id === id)) || prompts[i] || null;
}

function verdict(score, max) {
  const f = score / max;
  if (f >= 0.8) return 'You live out on the edge.';
  if (f >= 0.6) return 'Well off the beaten path.';
  if (f >= 0.4) return 'One foot in the crowd, one foot out.';
  if (f >= 0.2) return 'Mostly with the crowd today.';
  return 'The crowd says hello.';
}

function renderSummary({ fresh }) {
  const { rounds, score, prompts } = summaryData();
  const max = ctx.MAX_SCORE || 700;
  const date = session.day != null ? ctx.daily.dateForDay(session.day) : null;
  const kicker = session.mode === 'practice' ? `Practice set ${session.set || 1}`
    : `${session.mode === 'archive' ? 'Archive, puzzle' : 'Puzzle'} ${session.day}${date ? ` — ${fmtDate(date, { month: 'long', day: 'numeric', year: 'numeric' })}` : ''}`;
  const strip = rounds.map((r, i) => {
    const t = ctx.tier(r.tierId) || { id: r.tierId, label: r.tierId };
    return `<li class="strip-chip" style="--c:var(--t-${t.id});--n:${i}" title="${esc(t.label)}"><span class="visually-hidden">Prompt ${i + 1}: ${esc(t.label)}</span></li>`;
  }).join('');
  const list = rounds.map((r, i) => {
    const p = promptFor(rounds, prompts, i);
    const t = ctx.tier(r.tierId) || { id: r.tierId, label: r.tierId, color: '' };
    const a = asAnswer(r.answer);
    return `<li class="round-row">
        <span class="rr-n num">${i + 1}</span>
        <span class="rr-main"><span class="rr-q">${esc(p?.prompt || '')}</span><span class="rr-a${a ? '' : ' is-miss'}">${a ? esc(a.name) : esc({ timeout: 'Out of time', pass: 'Passed', strikes: 'Three strikes' }[r.endedBy] || 'No answer')}</span></span>
        ${tierChip(t)}
        <span class="rr-pts num">${r.points}</span>
      </li>`;
  }).join('');
  const isDaily = session.mode === 'daily';
  const canShare = session.mode !== 'practice';

  const node = html(`
    <section class="screen summary">
      ${topbar({ back: true })}
      <div class="sum-head">
        <p class="sum-kicker">${esc(kicker)}</p>
        <h1 class="sum-score" aria-label="You scored ${score} out of ${max}"><span class="num" data-total>${fresh ? 0 : score}</span><span class="sum-of">/${max}</span></h1>
        <p class="sum-verdict">${esc(verdict(score, max))}</p>
        ${session.streakUp ? `<p class="streak-pill"><span class="num">${session.streakUp}</span>-day streak</p>` : ''}
      </div>
      <ol class="strip" aria-label="Tier for each prompt">${strip}</ol>
      <figure class="sum-figure" aria-label="Your seven answers plotted by rarity: the further from the centre, the rarer"></figure>
      <div class="sum-actions">
        ${canShare ? `<button class="btn btn-primary btn-lg" data-act="share" data-silent>${ICON.share}<span>Share result</span></button>` : `<button class="btn btn-primary btn-lg" data-act="again">Play another set</button>`}
        ${isDaily ? '' : `<button class="btn btn-ghost btn-lg" data-act="home">Home</button>`}
      </div>
      ${isDaily ? `<p class="next-puzzle">Next puzzle in <span class="num" data-countdown></span></p>` : ''}
      <section class="sum-section" aria-labelledby="rounds-h">
        <h2 id="rounds-h">Your answers</h2>
        <ol class="rounds">${list}</ol>
      </section>
      ${isDaily ? `<section class="sum-section" aria-labelledby="stats-h"><h2 id="stats-h">Your record</h2>${statsPanel(ctx, { highlight: score })}</section>` : ''}
      ${session.mode === 'practice' ? '<p class="muted small center">Practice games don’t count toward your stats.</p>' : ''}
      ${session.mode === 'archive' ? '<p class="muted small center">Archive games don’t affect your streak.</p>' : ''}
    </section>`);
  const figure = $('.sum-figure', node);
  const svg = constellation(rounds, { seed: String(session.day ?? 'p') });
  figure.appendChild(svg);
  mount(node, { focus: 'h1' });
  if (isDaily) startCountdown(node);

  if (fresh) {
    const total = $('[data-total]', node);
    let lastStep = 0;
    const dur = reducedMotion() ? 0 : 600 + Math.min(1100, score * 1.8);
    countUp(total, score, {
      ms: dur,
      onStep: (v) => { const step = Math.floor(v / 60); if (step > lastStep) { lastStep = step; sfx('tick'); } },
    }).then(() => {
      sfx('complete', { score });
      fx.pop($('.sum-score', node), { from: 1, peak: 1.07, ms: 420 });
      const c = fx.center(total);
      const colors = rounds.map((r) => fx.tierColor(r.tierId)).filter((_, i, a) => a.indexOf(_) === i);
      fx.burst(c.x, c.y, { colors, count: 18 + Math.round(score / 9), speed: 5 + score / 140, life: 1100, size: 3 });
      fx.shockwave(c.x, c.y, { color: fx.tierColor(score >= 420 ? 'outlier' : 'rare'), r0: 30, r1: 120 + score / 4, width: 3, dur: 800 });
      if (session?.streakUp) setTimeout(() => sfx('streak', { count: session.streakUp }), 500);
    });
  }
}

async function onShare() {
  const { rounds, score } = summaryData();
  const url = location.origin + location.pathname;
  let text;
  try { text = ctx.share.shareText({ day: session.day, rounds, score, url }); }
  catch { text = `Outlier #${session.day} · ${score}/700\n${url}`; }
  sfx('share');
  let outcome = null;
  try {
    if (typeof ctx.share.shareResult === 'function') outcome = await ctx.share.shareResult(text);
    else outcome = await fallbackShare(text);
  } catch { outcome = await fallbackShare(text); }
  const o = typeof outcome === 'string' ? outcome : (outcome ? 'copied' : 'failed');
  if (o === 'shared') toast('Shared');
  else if (o === 'copied') toast('Copied!');
  else if (o !== 'cancelled') toast('Not shared');
}

async function fallbackShare(text) {
  try { await navigator.clipboard.writeText(text); return 'copied'; } catch { /* fall through */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* ignore */ }
  ta.remove();
  return ok ? 'copied' : 'failed';
}

/* =================================================================== */
/* Archive                                                              */
/* =================================================================== */
function renderArchive() {
  session = null;
  const now = today();
  const first = Math.max(0, ctx.daily.dayNumber(new Date(`${ctx.daily.EPOCH}T00:00:00`)));
  const max = ctx.MAX_SCORE || 700;
  const months = new Map();
  for (let d = now; d >= first; d--) {
    const date = ctx.daily.dateForDay(d);
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    if (!months.has(key)) months.set(key, { date, days: [] });
    months.get(key).days.push({ d, date });
  }
  const weekdays = [...Array(7)].map((_, i) => fmtDate(new Date(2023, 0, 1 + i), { weekday: 'narrow' }));
  const monthHtml = [...months.values()].map(({ date, days }) => {
    days.sort((a, b) => a.d - b.d);
    const pad = days[0].date.getDay();
    const cells = days.map(({ d, date: dt }, ci) => {
      const r = dayResult(d);
      const s = resultScore(r);
      const isToday = d === now;
      const lvl = s == null ? -1 : Math.min(4, Math.floor((s / max) * 5));
      const label = `Puzzle ${d}, ${fmtDate(dt, { weekday: 'long', month: 'long', day: 'numeric' })}${s != null ? `, scored ${s}` : ', not played'}${isToday ? ', today' : ''}`;
      return `<li${ci === 0 && pad ? ` style="grid-column-start:${pad + 1}"` : ''}><button class="cal-day${s != null ? ' is-played' : ''}${isToday ? ' is-today' : ''}" data-act="${isToday ? 'daily' : 'archive-day'}" data-day="${d}" aria-label="${esc(label)}" style="--lvl:${lvl}">
          <span class="cal-dom num">${dt.getDate()}</span>
          <span class="cal-score num">${s != null ? s : ''}</span>
        </button></li>`;
    }).join('');
    return `<section class="cal-month">
        <h2>${esc(fmtDate(date, { month: 'long', year: 'numeric' }))}</h2>
        <ol class="cal-head" aria-hidden="true">${weekdays.map((w) => `<li>${esc(w)}</li>`).join('')}</ol>
        <ol class="cal" style="--pad:${pad}">${cells}</ol>
      </section>`;
  }).join('');

  const node = html(`
    <section class="screen archive">
      ${topbar({ back: true })}
      <div class="page-head">
        <h1>Archive</h1>
        <p class="lede">Replay any past puzzle. Archive games don’t affect your streak.</p>
      </div>
      <div class="cal-legend" aria-hidden="true"><span class="cal-key"></span>Not played<span class="cal-key is-played" style="--lvl:3"></span>Your score</div>
      ${monthHtml}
    </section>`);
  mount(node);
}
