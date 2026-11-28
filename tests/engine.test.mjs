import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIERS, tierForPop, tierForAnswer, tierById, MAX_SCORE,
} from '../js/engine/scoring.js';
import {
  EPOCH, dayNumber, dateForDay, promptsForDay, randomPrompts, msUntilNextDay, mulberry32, hashString,
} from '../js/engine/daily.js';
import { createGame, Game } from '../js/engine/game.js';
import * as storage from '../js/engine/storage.js';
import { shareText, shareResult } from '../js/engine/share.js';
import * as all from '../js/engine/index.js';

// --- fixtures -----------------------------------------------------------------
const PASTA = {
  id: 'pasta-shapes',
  prompt: 'Name a pasta shape',
  category: 'Food & Drink',
  gem: 'Strozzapreti',
  decoys: ['Orecchiette'],
  answers: [
    ['Spaghetti', 88], ['Penne', 55], ['Macaroni', 60, 'elbows'], ['Fusilli', 30],
    ['Farfalle', 28, 'bow ties'], ['Orecchiette', 6], ['Strozzapreti', 2], ['Pappardelle', 8],
    ['Pici', 1], ['Ziti', 12], ['Trofie', 2], ['Casarecce', 3], ['Gemelli', 3], ['Bucatini', 5],
  ],
};
const PLANETS = {
  id: 'planets', prompt: 'Name a planet', category: 'Science',
  gem: 'Neptune', decoys: [],
  answers: [['Mars', 80], ['Jupiter', 60], ['Saturn', 50], ['Venus', 40], ['Mercury', 30],
    ['Neptune', 15], ['Uranus', 20], ['Earth', 45]],
};
const COLORS = {
  id: 'colors', prompt: 'Name a colour', category: 'Art',
  gem: 'Vermilion', decoys: ['Magenta'],
  answers: [['Red', 90], ['Blue', 85], ['Green', 70], ['Magenta', 5], ['Vermilion', 2],
    ['Teal', 10], ['Cerulean', 3], ['Ochre', 2]],
};
const mk = (id, category) => ({
  id, prompt: id, category, gem: 'Alpha', decoys: [], answers: [['Alpha', 2], ['Beta', 60]],
});

// --- scoring ----------------------------------------------------------------------
describe('scoring', () => {
  test('TIERS have the spec ids, points and emoji', () => {
    const spec = {
      crowd: [10, '⬜'], common: [25, '🟦'], uncommon: [45, '🟩'], rare: [65, '🟨'],
      obscure: [85, '🟪'], outlier: [100, '🟧'], decoy: [5, '🟫'], miss: [0, '⬛'],
    };
    assert.equal(TIERS.length, 8);
    for (const t of TIERS) {
      assert.deepEqual([t.points, t.emoji], spec[t.id], t.id);
      assert.match(t.color, /^#[0-9a-f]{6}$/i);
      assert.ok(t.label && t.blurb);
    }
    assert.equal(MAX_SCORE, 700);
  });
  test('tierForPop boundaries', () => {
    const cases = [[100, 'crowd'], [50, 'crowd'], [49, 'common'], [25, 'common'], [24, 'uncommon'],
      [10, 'uncommon'], [9, 'rare'], [4, 'rare'], [3, 'obscure'], [1, 'obscure'], [3.5, 'obscure']];
    for (const [pop, id] of cases) assert.equal(tierForPop(pop).id, id, `pop ${pop}`);
  });
  test('tierForAnswer precedence gem > decoy > pop', () => {
    assert.equal(tierForAnswer('Strozzapreti', PASTA).id, 'outlier');
    assert.equal(tierForAnswer('Orecchiette', PASTA).id, 'decoy');
    assert.equal(tierForAnswer('Spaghetti', PASTA).id, 'crowd');
    assert.equal(tierForAnswer('Pici', PASTA).id, 'obscure');
    assert.equal(tierForAnswer('strozzapreti', PASTA).id, 'outlier', 'case-insensitive');
    assert.equal(tierForAnswer({ name: 'Ziti' }, PASTA).id, 'uncommon');
    assert.equal(tierForAnswer('Nope', PASTA).id, 'miss');
    assert.equal(tierForAnswer(null, PASTA).id, 'miss');
    // gem beats decoy if a prompt lists the same answer as both
    const both = { ...PASTA, gem: 'Orecchiette' };
    assert.equal(tierForAnswer('Orecchiette', both).id, 'outlier');
  });
  test('tierById', () => {
    assert.equal(tierById('rare').points, 65);
    assert.equal(tierById('nope'), undefined);
  });
});

// --- daily ------------------------------------------------------------------------
describe('daily: day numbers', () => {
  const origTZ = process.env.TZ;
  after(() => { if (origTZ === undefined) delete process.env.TZ; else process.env.TZ = origTZ; });

  test('epoch is day 0', () => {
    assert.equal(EPOCH, '2026-01-01');
    assert.equal(dayNumber(new Date(2026, 0, 1, 0, 0, 0)), 0);
    assert.equal(dayNumber(new Date(2026, 0, 1, 23, 59, 59)), 0);
    assert.equal(dayNumber(new Date(2026, 0, 2, 0, 0, 0)), 1);
    assert.equal(dayNumber(new Date(2025, 11, 31, 12)), -1);
  });
  test('month and year boundaries', () => {
    assert.equal(dayNumber(new Date(2026, 1, 1)), 31);
    assert.equal(dayNumber(new Date(2026, 2, 1)), 59); // 2026 is not a leap year
    assert.equal(dayNumber(new Date(2026, 11, 31)), 364);
    assert.equal(dayNumber(new Date(2027, 0, 1)), 365);
    assert.equal(dayNumber(new Date(2028, 2, 1)) - dayNumber(new Date(2028, 1, 28)), 2); // leap
  });
  for (const tz of ['America/New_York', 'Europe/London', 'Australia/Sydney', 'Pacific/Chatham', 'UTC']) {
    test(`DST-safe round trip in ${tz}`, () => {
      process.env.TZ = tz;
      for (let n = -3; n < 800; n++) {
        const d = dateForDay(n);
        assert.equal(dayNumber(d), n, `${tz} day ${n}`);
        assert.equal(dayNumber(new Date(d.getTime() + 23 * 3600e3 - 1)) <= n + 1, true);
        // late evening of the same local day still maps to n
        const late = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 30);
        assert.equal(dayNumber(late), n);
      }
      // US DST start (2026-03-08) and end (2026-11-01) — consecutive days stay consecutive
      assert.equal(dayNumber(new Date(2026, 2, 9, 0, 30)) - dayNumber(new Date(2026, 2, 7, 23, 30)), 2);
      assert.equal(dayNumber(new Date(2026, 10, 2, 0, 30)) - dayNumber(new Date(2026, 10, 1, 0, 30)), 1);
    });
  }
  test('msUntilNextDay', () => {
    process.env.TZ = 'America/New_York';
    assert.equal(msUntilNextDay(new Date(2026, 4, 5, 23, 59, 0)), 60_000);
    assert.equal(msUntilNextDay(new Date(2026, 4, 5, 0, 0, 0)), 24 * 3600e3);
    // DST start day is 23 hours long
    assert.equal(msUntilNextDay(new Date(2026, 2, 8, 0, 0, 0)), 23 * 3600e3);
    process.env.TZ = 'UTC';
  });
});

describe('daily: prompt selection', () => {
  // 64 prompts over 8 categories with uneven sizes
  const sizes = [9, 9, 8, 8, 8, 8, 7, 7];
  const POOL = [];
  sizes.forEach((n, c) => { for (let i = 0; i < n; i++) POOL.push(mk(`c${c}-p${String(i).padStart(2, '0')}`, `Cat ${c}`)); });

  test('seeded PRNG is deterministic', () => {
    const a = mulberry32(42); const b = mulberry32(42);
    for (let i = 0; i < 5; i++) assert.equal(a(), b());
    assert.notEqual(hashString('a'), hashString('b'));
    const r = mulberry32(1)();
    assert.ok(r >= 0 && r < 1);
  });
  test('deterministic and independent of input order', () => {
    const shuffled = [...POOL].reverse();
    for (const n of [0, 1, 7, 100, 330, -5]) {
      const a = promptsForDay(n, POOL).map((p) => p.id);
      const b = promptsForDay(n, shuffled).map((p) => p.id);
      assert.deepEqual(a, b, `day ${n}`);
      assert.deepEqual(a, promptsForDay(n, POOL).map((p) => p.id));
      assert.equal(a.length, 7);
    }
  });
  test('no repeats within a cycle', () => {
    const cycleLen = Math.floor(POOL.length / 7); // 9 days
    for (const cycle of [0, 1, 5]) {
      const seen = new Set();
      for (let d = cycle * cycleLen; d < (cycle + 1) * cycleLen; d++) {
        for (const p of promptsForDay(d, POOL)) {
          assert.ok(!seen.has(p.id), `repeat ${p.id} in cycle ${cycle}`);
          seen.add(p.id);
        }
      }
      assert.equal(seen.size, cycleLen * 7);
    }
  });
  test('each day has distinct categories when the pool allows', () => {
    for (let d = 0; d < 40; d++) {
      const cats = promptsForDay(d, POOL).map((p) => p.category);
      assert.equal(new Set(cats).size, 7, `day ${d}: ${cats}`);
    }
  });
  test('different days and cycles differ', () => {
    assert.notDeepEqual(promptsForDay(0, POOL).map((p) => p.id), promptsForDay(1, POOL).map((p) => p.id));
    assert.notDeepEqual(promptsForDay(0, POOL).map((p) => p.id), promptsForDay(9, POOL).map((p) => p.id));
  });
  test('tiny pools still return what they can', () => {
    const tiny = POOL.slice(0, 3);
    assert.equal(promptsForDay(0, tiny).length, 3);
    assert.deepEqual(promptsForDay(0, []), []);
    assert.equal(promptsForDay(4, POOL, 3).length, 3);
  });
  test('randomPrompts respects count, exclusions and category diversity', () => {
    const exclude = POOL.slice(0, 50).map((p) => p.id);
    const rnd = mulberry32(9);
    const r = randomPrompts(POOL, 7, exclude, rnd);
    assert.equal(r.length, 7);
    assert.ok(r.every((p) => !exclude.includes(p.id)));
    const r2 = randomPrompts(POOL, 7, [], mulberry32(3));
    assert.equal(new Set(r2.map((p) => p.category)).size, 7);
    assert.equal(new Set(r2.map((p) => p.id)).size, 7);
    // falls back to excluded prompts if needed
    assert.equal(randomPrompts(POOL, 7, POOL.map((p) => p.id)).length, 7);
  });
});

// --- game -------------------------------------------------------------------------
describe('game', () => {
  const prompts = [PASTA, PLANETS, COLORS];
  const newGame = () => createGame({ mode: 'daily', day: 5, prompts });

  test('initial state', () => {
    const g = newGame();
    assert.equal(g.state.status, 'playing');
    assert.equal(g.state.roundIndex, 0);
    assert.equal(g.current().id, 'pasta-shapes');
    assert.equal(g.strikes(), 0);
    assert.equal(g.totalScore(), 0);
  });
  test('accept ends the round with tier and points', () => {
    const g = newGame();
    const r = g.submit('strozapreti', 4200);
    assert.equal(r.match.kind, 'accept');
    assert.equal(r.message, 'corrected');
    assert.equal(r.round.tierId, 'outlier');
    assert.equal(r.round.points, 100);
    assert.equal(r.round.endedBy, 'accept');
    assert.equal(r.round.ms, 4200);
    assert.equal(r.round.answer.name, 'Strozzapreti');
    assert.equal(r.round.promptId, 'pasta-shapes');
    assert.equal(g.state.status, 'round-over');
    // further submits are ignored until next()
    assert.equal(g.submit('penne', 5000).ignored, true);
    g.next();
    assert.equal(g.state.status, 'playing');
    assert.equal(g.current().id, 'planets');
    const r2 = g.submit('Mars', 1000);
    assert.equal(r2.message, 'accepted');
    assert.equal(r2.round.tierId, 'crowd');
    assert.equal(g.totalScore(), 110);
  });
  test('decoy scores 5', () => {
    const g = newGame();
    assert.equal(g.submit('orecchiette', 1).round.tierId, 'decoy');
    assert.equal(g.totalScore(), 5);
  });
  test('empty input is ignored', () => {
    const g = newGame();
    const r = g.submit('   ', 10);
    assert.equal(r.ignored, true);
    assert.equal(g.strikes(), 0);
  });
  test('near miss: uses a guess, warmth only — never letters, length or the target', () => {
    const g = newGame();
    const r1 = g.submit('spogetty', 1000);
    assert.equal(r1.match.kind, 'near');
    assert.equal(r1.message, 'close');
    assert.ok(['hot', 'warm', 'tepid'].includes(r1.heat));
    for (const leak of ['mask', 'target', 'form', 'distance']) assert.equal(r1.match[leak], undefined, leak);
    assert.equal(r1.mask, undefined);
    assert.ok(!JSON.stringify(r1).toLowerCase().includes('spaghetti'));
    assert.equal(g.strikes(), 1);
    assert.equal(g.submit('spogetty', 1500).message, 'already-tried', 'identical re-submit is free');
    assert.equal(g.strikes(), 1);
    const r2 = g.submit('spagety', 2000); // still Spaghetti, different spelling
    assert.equal(r2.match.kind, 'near');
    assert.equal(r2.message, 'closer');
    assert.equal(g.state.nearMisses.Spaghetti, 2);
    assert.equal(g.strikes(), 2);
    assert.equal(g.state.status, 'playing');
    // then a correct answer
    assert.equal(g.submit('spaghetti', 3000).round.tierId, 'crowd');
  });
  test('three strikes end the round with 0 points; repeats do not cost a strike', () => {
    const g = newGame();
    let r = g.submit('xylophone', 100);
    assert.equal(r.message, 'not-found');
    assert.equal(r.strikes, 1);
    assert.equal(r.strikesLeft, 2);
    r = g.submit('Xylophone!', 150);
    assert.equal(r.message, 'already-tried');
    assert.equal(g.strikes(), 1);
    g.submit('trumpet', 200);
    assert.equal(g.strikes(), 2);
    r = g.submit('banana', 300);
    assert.equal(r.message, 'strike-out');
    assert.equal(r.round.endedBy, 'strikes');
    assert.equal(r.round.tierId, 'miss');
    assert.equal(r.round.points, 0);
    assert.equal(g.state.status, 'round-over');
    assert.deepEqual(g.state.guesses.map((x) => x.input), ['xylophone', 'trumpet', 'banana']);
  });
  test('timeout and pass', () => {
    const g = newGame();
    const t = g.timeout();
    assert.equal(t.endedBy, 'timeout');
    assert.equal(t.tierId, 'miss');
    assert.equal(t.points, 0);
    assert.equal(t.ms, 25000);
    assert.equal(g.timeout(), null, 'no double timeout');
    g.next();
    const p = g.pass();
    assert.equal(p.endedBy, 'pass');
    assert.equal(p.points, 0);
  });
  test('strikes and near misses reset between rounds', () => {
    const g = newGame();
    g.submit('xylophone', 1);
    g.submit('spogetty', 1);
    g.pass();
    g.next();
    assert.equal(g.strikes(), 0);
    assert.deepEqual(g.state.nearMisses, {});
    assert.deepEqual(g.state.guesses, []);
  });
  test('three guesses total: near misses count toward the limit', () => {
    const g = newGame();
    g.submit('spogetty', 1);
    g.submit('xylophone', 2);
    const r = g.submit('spagety', 3);
    assert.equal(r.message, 'strike-out');
    assert.equal(r.round.endedBy, 'strikes');
    assert.equal(r.round.points, 0);
    assert.equal(g.state.status, 'round-over');
  });
  test('game ends after the last round', () => {
    const g = newGame();
    g.submit('penne', 1); g.next();
    g.submit('neptune', 1); g.next();
    assert.equal(g.isLastRound(), true);
    g.submit('red', 1);
    assert.equal(g.state.status, 'round-over');
    g.next();
    assert.equal(g.state.status, 'done');
    assert.equal(g.current(), null);
    assert.equal(g.totalScore(), 10 + 100 + 10);
    assert.equal(g.state.rounds.length, 3);
    assert.deepEqual(g.state.rounds.map((r) => r.tierId), ['crowd', 'outlier', 'crowd']);
  });
  test('reveal: common, rare, gem, decoys, total', () => {
    const g = newGame();
    const rv = g.reveal(0);
    assert.deepEqual(rv.common.map((a) => a.name), ['Spaghetti', 'Macaroni', 'Penne']);
    assert.equal(rv.rare.length, 3);
    for (const a of rv.rare) {
      assert.ok(a.pop <= 3, a.name);
      assert.notEqual(a.name, 'Strozzapreti');
    }
    assert.deepEqual(rv.rare, g.reveal(0).rare, 'deterministic');
    assert.equal(rv.gem.name, 'Strozzapreti');
    assert.equal(rv.gem.tierId, 'outlier');
    assert.deepEqual(rv.decoys.map((a) => a.name), ['Orecchiette']);
    assert.equal(rv.total, PASTA.answers.length);
    // fewer than 3 answers with pop<=3 → padded with the rarest others
    const rv2 = g.reveal(1);
    assert.equal(rv2.rare.length, 3);
    assert.ok(!rv2.rare.some((a) => a.name === 'Neptune'));
  });
  test('toJSON / fromJSON resumes mid-round', () => {
    const g = newGame();
    g.submit('penne', 1000); g.next();
    g.submit('plut', 500); // strike or near
    g.submit('xylophone', 600);
    g.setElapsed(7000);
    const json = JSON.parse(JSON.stringify(g.toJSON()));
    const h = Game.fromJSON(json, [COLORS, PLANETS, PASTA]);
    assert.equal(h.state.roundIndex, 1);
    assert.equal(h.current().id, 'planets');
    assert.equal(h.strikes(), g.strikes());
    assert.equal(h.totalScore(), 10);
    assert.equal(h.state.elapsedMs, 7000);
    assert.equal(h.submit('xylophone', 1).message, 'already-tried');
    assert.equal(h.submit('venus', 9000).round.tierId, 'common');
    // missing prompt → null
    assert.equal(Game.fromJSON(json, [PASTA]), null);
    assert.equal(Game.fromJSON(null, prompts), null);
  });
  test('round results carry category for stats', () => {
    const g = newGame();
    assert.equal(g.submit('penne', 1).round.category, 'Food & Drink');
  });
});

// --- storage ----------------------------------------------------------------------
describe('storage', () => {
  beforeEach(() => storage.resetAll());
  const rounds = (pts) => pts.map((p, i) => ({ promptId: `p${i}`, category: i % 2 ? 'Science' : 'Art', tierId: p ? 'common' : 'miss', points: p }));

  test('fresh stats', () => {
    const s = storage.loadStats();
    assert.equal(s.played, 0);
    assert.equal(s.streak, 0);
    assert.equal(s.lastDay, null);
    assert.deepEqual(Object.keys(s.histogram).map(Number), [0, 100, 200, 300, 400, 500, 600]);
  });
  test('recordDaily updates totals, histogram, categories and is idempotent', () => {
    let s = storage.recordDaily(10, rounds([25, 25, 0]), 50);
    assert.equal(s.played, 1);
    assert.equal(s.best, 50);
    assert.equal(s.histogram[0], 1);
    assert.equal(s.categories.Art.played, 2);
    assert.equal(s.categories.Art.total, 25);
    assert.equal(s.tiers.common, 2);
    s = storage.recordDaily(10, rounds([25, 25, 0]), 50);
    assert.equal(s.played, 1, 'same day twice is a no-op');
    s = storage.recordDaily(11, rounds([]), 700);
    assert.equal(s.histogram[600], 1, '700 lands in the top bucket');
    assert.equal(s.best, 700);
    assert.equal(s.totalScore, 750);
    assert.equal(s.average, 375);
  });
  test('streak continues only on consecutive days', () => {
    let s = storage.recordDaily(1, [], 100);
    assert.equal(s.streak, 1);
    s = storage.recordDaily(2, [], 100);
    assert.equal(s.streak, 2);
    s = storage.recordDaily(3, [], 100);
    assert.equal(s.streak, 3);
    s = storage.recordDaily(5, [], 100);
    assert.equal(s.streak, 1);
    assert.equal(s.maxStreak, 3);
    assert.equal(s.lastDay, 5);
    // display: streak shows 0 once a day has been missed
    assert.equal(storage.loadStats(6).streak, 1);
    assert.equal(storage.loadStats(7).streak, 0);
    assert.equal(storage.loadStats().streak, 1);
  });
  test('day results for the archive', () => {
    storage.recordDaily(4, rounds([25]), 25);
    const r = storage.getDayResult(4);
    assert.equal(r.score, 25);
    assert.deepEqual(r.tiers, ['common']);
    assert.equal(storage.getDayResult(99), null);
    storage.recordArchive(3, rounds([0]), 0);
    assert.equal(storage.getDayResult(3).mode, 'archive');
    assert.equal(storage.loadStats().played, 1, 'archive does not touch stats');
  });
  test('in-progress save / load / clear keyed by day + mode', () => {
    const g = createGame({ mode: 'daily', day: 8, prompts: [PASTA, PLANETS] });
    g.submit('penne', 1);
    storage.saveInProgress(g);
    const data = storage.loadInProgress(8);
    assert.equal(data.day, 8);
    assert.equal(storage.loadInProgress(8, 'archive'), null);
    assert.equal(storage.loadInProgress(9), null);
    const h = Game.fromJSON(data, [PASTA, PLANETS]);
    assert.equal(h.totalScore(), 10);
    storage.clearInProgress(8);
    assert.equal(storage.loadInProgress(8), null);
    storage.saveInProgress(g);
    storage.clearInProgress();
    assert.equal(storage.loadInProgress(8), null);
  });
  test('settings defaults and patching', () => {
    assert.deepEqual(storage.getSettings(), { sound: true, haptics: true, theme: 'auto', reducedMotion: false, relaxed: false });
    const s = storage.setSettings({ sound: false, theme: 'dark' });
    assert.equal(s.sound, false);
    assert.equal(storage.getSettings().theme, 'dark');
    assert.equal(storage.getSettings().haptics, true);
  });
  test('keys are prefixed and versioned', () => {
    storage.recordDaily(1, [], 1);
    assert.ok(storage.keys().every((k) => k.startsWith('outlier:v1:')));
    assert.ok(storage.keys().length > 0);
  });
});

// --- share ------------------------------------------------------------------------
describe('share', () => {
  const tiers = ['outlier', 'uncommon', 'crowd', 'obscure', 'common', 'uncommon', 'miss'];
  const rounds = tiers.map((tierId) => ({ tierId, points: tierById(tierId).points }));
  test('shareText format', () => {
    assert.equal(
      shareText({ day: 331, rounds, score: 455, url: 'https://example.com/outlier' }),
      'Outlier #331 · 455/700\n🟧🟩⬜🟪🟦🟩⬛\nhttps://example.com/outlier',
    );
    assert.equal(shareText({ day: 331, rounds, score: 455 }), 'Outlier #331 · 455/700\n🟧🟩⬜🟪🟦🟩⬛');
  });
  test('score defaults to the sum of points; accepts tier id strings', () => {
    assert.equal(shareText({ day: 1, rounds: ['decoy', 'rare'] }), 'Outlier #1 · 70/700\n🟫🟨');
  });
  test('shareResult falls back gracefully', async () => {
    const orig = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const setNav = (v) => Object.defineProperty(globalThis, 'navigator', { value: v, configurable: true, writable: true });
    try {
      let shared = null;
      setNav({ share: async (d) => { shared = d.text; } });
      assert.equal(await shareResult('hi', { preferShare: true }), 'shared');
      assert.equal(shared, 'hi');
      let copied = null;
      setNav({ clipboard: { writeText: async (t) => { copied = t; } } });
      assert.equal(await shareResult('yo'), 'copied');
      assert.equal(copied, 'yo');
      setNav({ share: async () => { throw new Error('nope'); }, clipboard: { writeText: async () => { copied = 'x'; } } });
      assert.equal(await shareResult('z', { preferShare: true }), 'copied');
      setNav({});
      assert.equal(await shareResult('z'), 'failed');
    } finally {
      if (orig) Object.defineProperty(globalThis, 'navigator', orig); else delete globalThis.navigator;
    }
  });
});

test('index re-exports the engine', () => {
  for (const name of ['normalize', 'buildIndex', 'matchAnswer', 'TIERS', 'tierForAnswer', 'dayNumber',
    'promptsForDay', 'createGame', 'Game', 'loadStats', 'recordDaily', 'shareText', 'shareResult', 'MAX_SCORE']) {
    assert.ok(name in all, name);
  }
});
