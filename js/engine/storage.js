// Outlier — persistence. localStorage when available (every access wrapped in try/catch),
// otherwise an in-memory Map (Node tests, private mode, blocked storage).
//
// Keys (schema v1):
//   outlier:v1:stats     Stats object
//   outlier:v1:settings  Settings object
//   outlier:v1:progress  { "<mode>:<day>": { savedAt, data: game.toJSON() } }
//   outlier:v1:days      { "<day>": DayResult }  — completed days, for the archive

export const PREFIX = 'outlier:';
export const SCHEMA_VERSION = 1;
const NS = `${PREFIX}v${SCHEMA_VERSION}:`;
const K = {
  stats: `${NS}stats`,
  settings: `${NS}settings`,
  progress: `${NS}progress`,
  days: `${NS}days`,
};

export const DEFAULT_SETTINGS = Object.freeze({
  sound: true, haptics: true, theme: 'auto', reducedMotion: false, relaxed: false,
});

export const HISTOGRAM_BUCKETS = [0, 100, 200, 300, 400, 500, 600]; // 600 bucket covers 600–700

// --- backend ---------------------------------------------------------------------
const memory = new Map();

function local() {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    const probe = `${PREFIX}__probe`;
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

let ls = local();

function rawGet(key) {
  if (ls) {
    try { return ls.getItem(key); } catch { /* fall through */ }
  }
  return memory.has(key) ? memory.get(key) : null;
}

function rawSet(key, value) {
  memory.set(key, value);
  if (ls) {
    try { ls.setItem(key, value); } catch { /* quota / blocked: memory copy stays */ }
  }
}

function rawRemove(key) {
  memory.delete(key);
  if (ls) {
    try { ls.removeItem(key); } catch { /* ignore */ }
  }
}

function read(key, fallback) {
  const raw = rawGet(key);
  if (raw === null || raw === undefined) return fallback;
  try {
    const v = JSON.parse(raw);
    return v === null || v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  rawSet(key, JSON.stringify(value));
}

/** All Outlier keys currently stored (for debugging/tests). */
export function keys() {
  const out = new Set();
  if (ls) {
    try {
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (k && k.startsWith(PREFIX)) out.add(k);
      }
    } catch { /* ignore */ }
  }
  for (const k of memory.keys()) if (k.startsWith(PREFIX)) out.add(k);
  return [...out];
}

/** Erase all Outlier data (stats, settings, progress, archive results). */
export function resetAll() {
  for (const k of keys()) rawRemove(k);
  memory.clear();
}

// --- stats -------------------------------------------------------------------------

function emptyStats() {
  const histogram = {};
  for (const b of HISTOGRAM_BUCKETS) histogram[b] = 0;
  return {
    v: SCHEMA_VERSION,
    played: 0,
    streak: 0,
    maxStreak: 0,
    best: 0,
    totalScore: 0,
    average: 0,
    histogram,
    categories: {}, // { [category]: { played, total } }  (rounds played and points)
    tiers: {}, // { [tierId]: count }
    lastDay: null,
  };
}

function rawStats() {
  const s = read(K.stats, null);
  const base = emptyStats();
  if (!s || typeof s !== 'object') return base;
  return {
    ...base,
    ...s,
    histogram: { ...base.histogram, ...(s.histogram || {}) },
    categories: { ...(s.categories || {}) },
    tiers: { ...(s.tiers || {}) },
  };
}

/** Histogram bucket (lower bound) for a score: 0,100,…,600 (600 covers 600–700). */
export function bucketFor(score) {
  const b = Math.floor((Number(score) || 0) / 100) * 100;
  return Math.max(0, Math.min(600, b));
}

/**
 * Stats: {played, streak, maxStreak, best, totalScore, average, histogram:{bucket:count},
 * categories:{cat:{played,total}}, tiers:{tierId:count}, lastDay}.
 * If `today` (a day number) is given and the player has missed a day since lastDay,
 * the returned `streak` is 0 (stored data is not modified).
 */
export function loadStats(today) {
  const s = rawStats();
  if (today !== undefined && today !== null && s.lastDay !== null && s.lastDay < today - 1) {
    s.streak = 0;
  }
  return s;
}

/** Average points per round by category: { [category]: number }. */
export function categoryAverages(stats = loadStats()) {
  const out = {};
  for (const [cat, v] of Object.entries(stats.categories || {})) {
    out[cat] = v.played ? Math.round(v.total / v.played) : 0;
  }
  return out;
}

function compactRounds(rounds) {
  return (rounds || []).map((r) => ({
    promptId: r.promptId,
    tierId: r.tierId,
    points: r.points || 0,
    answer: r.answer ? r.answer.name : null,
    endedBy: r.endedBy,
  }));
}

/**
 * Record a completed daily. Idempotent per day. Streak continues only if lastDay === day - 1.
 * Returns the updated Stats.
 */
export function recordDaily(day, rounds = [], score = 0) {
  const s = rawStats();
  const days = read(K.days, {});
  if (s.lastDay === day || (days[day] && days[day].mode === 'daily')) return s;

  s.played += 1;
  s.totalScore += score;
  s.average = Math.round(s.totalScore / s.played);
  s.best = Math.max(s.best, score);
  s.histogram[bucketFor(score)] = (s.histogram[bucketFor(score)] || 0) + 1;
  for (const r of rounds || []) {
    if (r.category) {
      const c = s.categories[r.category] || { played: 0, total: 0 };
      c.played += 1;
      c.total += r.points || 0;
      s.categories[r.category] = c;
    }
    if (r.tierId) s.tiers[r.tierId] = (s.tiers[r.tierId] || 0) + 1;
  }
  // An out-of-order (older) day counts toward totals but never rewinds the streak.
  if (s.lastDay === null || day > s.lastDay) {
    s.streak = s.lastDay === day - 1 ? s.streak + 1 : 1;
    s.maxStreak = Math.max(s.maxStreak, s.streak);
    s.lastDay = day;
  }
  write(K.stats, s);

  days[day] = { mode: 'daily', score, tiers: (rounds || []).map((r) => r.tierId), rounds: compactRounds(rounds), at: Date.now() };
  write(K.days, days);
  return s;
}

/** Record an archive replay (no stats/streak impact). Never overwrites a real daily result. */
export function recordArchive(day, rounds = [], score = 0) {
  const days = read(K.days, {});
  const prev = days[day];
  if (prev && (prev.mode === 'daily' || prev.score >= score)) return prev;
  days[day] = { mode: 'archive', score, tiers: (rounds || []).map((r) => r.tierId), rounds: compactRounds(rounds), at: Date.now() };
  write(K.days, days);
  return days[day];
}

/** DayResult {mode:'daily'|'archive', score, tiers, rounds, at} or null. */
export function getDayResult(day) {
  const days = read(K.days, {});
  return days[day] || null;
}

/** All recorded day results, keyed by day number. */
export function getAllDayResults() {
  return read(K.days, {});
}

// --- in-progress games ------------------------------------------------------------------

const progressKey = (day, mode) => `${mode}:${day}`;

/** Save a game (anything with toJSON(), or a plain state object). */
export function saveInProgress(game) {
  const data = game && typeof game.toJSON === 'function' ? game.toJSON() : game;
  if (!data) return;
  const all = read(K.progress, {});
  all[progressKey(data.day, data.mode || 'daily')] = { savedAt: Date.now(), data };
  write(K.progress, all);
}

/** Saved game data for day+mode (feed to Game.fromJSON), or null. */
export function loadInProgress(day, mode = 'daily') {
  const all = read(K.progress, {});
  const entry = all[progressKey(day, mode)];
  return entry ? entry.data : null;
}

/** Clear one saved game (day+mode), or all saved games when called with no day. */
export function clearInProgress(day, mode = 'daily') {
  if (day === undefined) { rawRemove(K.progress); return; }
  const all = read(K.progress, {});
  delete all[progressKey(day, mode)];
  write(K.progress, all);
}

// --- settings -----------------------------------------------------------------------

export function getSettings() {
  const s = read(K.settings, {});
  return { ...DEFAULT_SETTINGS, ...(s && typeof s === 'object' ? s : {}) };
}

export function setSettings(patch = {}) {
  const next = { ...getSettings(), ...patch };
  write(K.settings, next);
  return next;
}
