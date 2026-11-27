// Outlier — daily numbering and deterministic prompt selection.
//
// Day numbers use the player's LOCAL calendar date: day 0 = 2026-01-01. Arithmetic is done on
// Date.UTC(localYear, localMonth, localDate) so DST transitions (23/25-hour days) never shift it.
//
// Selection: the pool is sorted by id, then split into "cycles" of floor(pool/count) days. Each
// cycle uses its own seeded permutation of the whole pool, so no prompt repeats within a cycle.
// Day buckets are filled category-diverse (distinct categories per day where possible).
// NOTE: because cycles depend on pool size and the id-sorted order, adding/removing prompts
// changes which prompts land on which day (past and future). Days already played keep their
// stored results; only the archive replay of a past day may show a different set. That is an
// accepted trade-off of a client-only, static-file game.

export const EPOCH = '2026-01-01';
const EPOCH_UTC = Date.UTC(2026, 0, 1);
const DAY_MS = 86400000;

/** Local-calendar day number since EPOCH (2026-01-01 → 0). */
export function dayNumber(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - EPOCH_UTC) / DAY_MS);
}

/** Local midnight (start) of day n. */
export function dateForDay(n) {
  return new Date(2026, 0, 1 + Math.trunc(n));
}

/** 'YYYY-MM-DD' (local) for day n — handy for archive labels. */
export function dateKey(n) {
  const d = dateForDay(n);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Milliseconds until the next local midnight. */
export function msUntilNextDay(now = new Date()) {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime();
}

// --- seeded randomness -------------------------------------------------------------

/** mulberry32 PRNG: returns a function producing floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 32-bit FNV-1a string hash. */
export function hashString(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Fisher-Yates shuffle into a new array. */
export function seededShuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

const byId = (x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);

/**
 * Take `count` items from `remaining` (mutated) with distinct categories where possible.
 * Categories with the most remaining items go first (keeps later days diverse); ties are broken
 * by position in `remaining`, which is already randomly ordered. Output keeps `remaining` order.
 */
function takeDiverse(remaining, count) {
  const firstPos = new Map();
  const counts = new Map();
  remaining.forEach((p, i) => {
    const c = p.category;
    counts.set(c, (counts.get(c) || 0) + 1);
    if (!firstPos.has(c)) firstPos.set(c, i);
  });
  const cats = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || firstPos.get(a) - firstPos.get(b));
  const picked = new Set(cats.slice(0, count).map((c) => firstPos.get(c)));
  for (let i = 0; i < remaining.length && picked.size < count; i++) picked.add(i);
  const out = [];
  const keep = [];
  remaining.forEach((p, i) => (picked.has(i) ? out : keep).push(p));
  remaining.length = 0;
  remaining.push(...keep);
  return out;
}

const cycleCache = new WeakMap(); // PROMPTS array -> Map(key -> days[][])

function cycleDays(PROMPTS, count, cycle, cycleLen) {
  let perPool = cycleCache.get(PROMPTS);
  if (!perPool) { perPool = new Map(); cycleCache.set(PROMPTS, perPool); }
  const ck = `${PROMPTS.length}:${count}:${cycle}`;
  const hit = perPool.get(ck);
  if (hit) return hit;
  const sorted = PROMPTS.slice().sort(byId);
  const remaining = seededShuffle(sorted, mulberry32(hashString(`outlier/cycle/${cycle}`)));
  const days = [];
  for (let d = 0; d < cycleLen; d++) days.push(takeDiverse(remaining, count));
  if (perPool.size > 64) perPool.clear();
  perPool.set(ck, days);
  return days;
}

/**
 * The `count` prompts for day n. Deterministic for a given pool (input order irrelevant:
 * the pool is sorted by id first). No repeats within a cycle; distinct categories per day
 * where the pool allows.
 */
export function promptsForDay(n, PROMPTS, count = 7) {
  if (!PROMPTS || !PROMPTS.length || count <= 0) return [];
  const per = Math.min(count, PROMPTS.length);
  const cycleLen = Math.max(1, Math.floor(PROMPTS.length / per));
  const day = Math.trunc(n);
  const cycle = Math.floor(day / cycleLen);
  const idx = day - cycle * cycleLen;
  return cycleDays(PROMPTS, per, cycle, cycleLen)[idx].slice();
}

/**
 * Random category-diverse prompts for practice mode. Excluded ids are avoided unless the pool
 * would otherwise be too small. `rand` defaults to Math.random.
 */
export function randomPrompts(PROMPTS, count, excludeIds = [], rand = Math.random) {
  if (!PROMPTS || !PROMPTS.length) return [];
  const ex = new Set(excludeIds || []);
  const fresh = PROMPTS.filter((p) => !ex.has(p.id));
  const stale = PROMPTS.filter((p) => ex.has(p.id));
  const n = Math.min(count, PROMPTS.length);
  const pool = seededShuffle(fresh, rand);
  const out = takeDiverse(pool, Math.min(n, pool.length));
  if (out.length < n) out.push(...seededShuffle(stale, rand).slice(0, n - out.length));
  return out;
}
