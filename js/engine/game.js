// Outlier — pure game state machine. No DOM, no timers: the UI drives the clock and calls
// timeout() when the round timer runs out.
import { buildIndex, matchAnswer, normalize } from './matcher.js';
import { tierForAnswer, tierById } from './scoring.js';
import { mulberry32, hashString, seededShuffle } from './daily.js';

export const MAX_STRIKES = 3;
export const DEFAULT_ROUND_MS = 25000;
const SCHEMA = 1;

const rowOf = (a) => (Array.isArray(a)
  ? { name: String(a[0]), pop: Number(a[1]) || 0 }
  : { name: String(a.name), pop: Number(a.pop) || 0 });
const keyOf = (s) => normalize(s).replace(/ /g, '');

function freshRoundState(state) {
  state.strikes = 0;
  state.nearMisses = {};
  state.guesses = [];
  state.elapsedMs = 0;
  state.pending = null; // a "Did you mean …?" suggestion awaiting confirmation
}

/** Letters/digits only, for measuring how big a typo is relative to the answer. */
const lettersLen = (s) => String(s || '').replace(/[^\p{L}\p{N}]/gu, '').length;

/**
 * Offer "Did you mean X?" only for a genuine spelling slip: a single unambiguous candidate,
 * within ~30% of its letters, same first letter, and never for prefixes or partial (one-word-of-many) inputs —
 * those would hand the player an answer they didn't really know.
 */
export function suggestionFor(match, rawInput) {
  if (!match || match.kind !== 'near' || match.reason !== 'typo') return null;
  const len = lettersLen(match.form || match.target?.name);
  if (lettersLen(rawInput) < 4 || len < 4) return null;
  if (match.distance > Math.max(1, Math.round(len * 0.3))) return null;
  const compact = (t) => normalize(t).replace(/ /g, '');
  const inC = compact(rawInput);
  const tC = compact(match.form || match.target.name);
  if (inC[0] !== tC[0]) return null;
  // No auto-completing: a truncated start ("spaghe") or a much shorter input gets no suggestion.
  if (tC.startsWith(inC) || inC.length < tC.length * 0.7) return null;
  return { name: match.target.name, pop: match.target.pop };
}

function makeGame(state, prompts) {
  const game = {
    state,
    prompts,

    /** Prompt for the current round, or null when the game is done. */
    current() {
      return state.status === 'done' ? null : prompts[state.roundIndex] || null;
    },

    /** Wrong ('none') guesses this round. */
    strikes() {
      return state.strikes;
    },

    strikesLeft() {
      return Math.max(0, MAX_STRIKES - state.strikes);
    },

    isLastRound() {
      return state.roundIndex >= prompts.length - 1;
    },

    totalScore() {
      return state.rounds.reduce((s, r) => s + (r.points || 0), 0);
    },

    /** UI may record elapsed time so a resumed round can continue its clock. */
    setElapsed(ms) {
      state.elapsedMs = Math.max(0, Math.round(Number(ms) || 0));
    },

    /**
     * Submit a guess. Returns:
     *  { match, message, round?, heat?, nearCount?, strikes, strikesLeft, ignored? }
     * heat (near misses only): 'hot' | 'warm' | 'tepid' — how close, never which letters.
     * message: 'accepted' | 'corrected' | 'close' | 'closer' | 'partial' | 'not-found' |
     *          'suggest' | 'confirmed' | 'already-tried' | 'strike-out' | 'empty' | 'ignored'
     * 'suggest' carries `suggestion` (answer name); submitting the same text again, or confirm(), accepts it.
     */
    submit(input, elapsedMs = 0) {
      if (state.status !== 'playing') {
        return { match: null, message: 'ignored', ignored: true, strikes: state.strikes, strikesLeft: game.strikesLeft() };
      }
      const raw = String(input ?? '').trim();
      const k = keyOf(raw);
      if (!k) {
        return { match: null, message: 'empty', ignored: true, strikes: state.strikes, strikesLeft: game.strikesLeft() };
      }
      // Pressing Enter again on the same text confirms a pending "Did you mean …?".
      if (state.pending && state.pending.key === k) return game.confirm(elapsedMs);
      state.pending = null;

      const prompt = prompts[state.roundIndex];
      const match = matchAnswer(raw, buildIndex(prompt));

      if (match.kind === 'accept') {
        const tier = tierForAnswer(match.answer.name, prompt);
        const round = endRound(prompt, {
          input: raw, answer: { ...match.answer }, tierId: tier.id, points: tier.points,
          ms: elapsedMs, endedBy: 'accept', corrected: match.corrected,
        });
        state.guesses.push({ input: raw, kind: 'accept' });
        return { match, round, message: match.via === 'typo' ? 'corrected' : 'accepted', strikes: state.strikes, strikesLeft: game.strikesLeft() };
      }

      // Every guess that isn't accepted uses one of MAX_STRIKES (3) guesses — near misses included.
      // Re-submitting the exact same (normalized) guess is free.
      if (state.guesses.some((g) => g.kind !== 'accept' && keyOf(g.input) === k)) {
        return { match: match.kind === 'near' ? { kind: 'near', reason: match.reason, heat: heatFor(match) } : match,
          message: 'already-tried', repeat: true, strikes: state.strikes, strikesLeft: game.strikesLeft() };
      }
      // A clear spelling slip gets a suggestion to confirm, and costs no guess.
      const suggestion = suggestionFor(match, raw);
      if (suggestion) {
        state.pending = { key: k, input: raw, answer: suggestion };
        return { match: { kind: 'near', reason: match.reason, heat: heatFor(match), suggestion: suggestion.name },
          heat: heatFor(match), suggestion: suggestion.name, message: 'suggest', strikes: state.strikes, strikesLeft: game.strikesLeft() };
      }

      state.strikes += 1;
      const outOfGuesses = state.strikes >= MAX_STRIKES;
      const endIfOut = () => endRound(prompt, { input: raw, answer: null, tierId: 'miss', points: 0, ms: elapsedMs, endedBy: 'strikes' });

      if (match.kind === 'near') {
        // Never leak letters, length or the target itself to the UI: only how warm the guess is.
        const name = match.target.name;
        const count = (state.nearMisses[name] || 0) + 1;
        state.nearMisses[name] = count;
        const heat = heatFor(match);
        const out = { kind: 'near', reason: match.reason, heat };
        state.guesses.push({ input: raw, kind: 'near' });
        if (outOfGuesses) {
          return { match: out, heat, nearCount: count, round: endIfOut(), message: 'strike-out', strikes: state.strikes, strikesLeft: 0 };
        }
        const message = match.reason === 'partial' ? 'partial' : (count >= 2 ? 'closer' : 'close');
        return { match: out, heat, nearCount: count, message, strikes: state.strikes, strikesLeft: game.strikesLeft() };
      }

      state.guesses.push({ input: raw, kind: 'none' });
      if (outOfGuesses) {
        return { match, round: endIfOut(), message: 'strike-out', strikes: state.strikes, strikesLeft: 0 };
      }
      return { match, message: 'not-found', strikes: state.strikes, strikesLeft: game.strikesLeft() };
    },

    /** The pending suggestion's answer name, or null. */
    pendingSuggestion() {
      return state.pending ? state.pending.answer.name : null;
    },

    /** Accept the pending "Did you mean …?" suggestion (Enter / Yes). Returns a submit-style result. */
    confirm(elapsedMs = state.elapsedMs) {
      if (state.status !== 'playing' || !state.pending) return null;
      const { input, answer } = state.pending;
      const prompt = prompts[state.roundIndex];
      const tier = tierForAnswer(answer.name, prompt);
      state.pending = null;
      state.guesses.push({ input, kind: 'accept' });
      const round = endRound(prompt, {
        input, answer: { ...answer }, tierId: tier.id, points: tier.points,
        ms: elapsedMs, endedBy: 'accept', corrected: true,
      });
      return { match: { kind: 'accept', answer: { ...answer }, corrected: true, via: 'confirm' }, round,
        message: 'confirmed', strikes: state.strikes, strikesLeft: game.strikesLeft() };
    },

    /** Round timer ran out. Returns the RoundResult, or null if not playing. */
    timeout() {
      if (state.status !== 'playing') return null;
      const ms = Number.isFinite(state.roundMs) ? state.roundMs : state.elapsedMs;
      return endRound(prompts[state.roundIndex], { input: '', answer: null, tierId: 'miss', points: 0, ms, endedBy: 'timeout' });
    },

    /** Give up on this round (0 points). */
    pass(elapsedMs = state.elapsedMs) {
      if (state.status !== 'playing') return null;
      return endRound(prompts[state.roundIndex], { input: '', answer: null, tierId: 'miss', points: 0, ms: elapsedMs, endedBy: 'pass' });
    },

    /** Advance after a round ends. Sets status 'done' after the last round. */
    next() {
      if (state.status !== 'round-over') return;
      state.roundIndex += 1;
      freshRoundState(state);
      state.status = state.roundIndex >= prompts.length ? 'done' : 'playing';
    },

    /**
     * "What others said" for prompt index i (default: current round).
     * { common:[3], rare:[3], gem, decoys, total, round }
     * Answers are {name, pop, tierId, points}. `rare` = pop<=3 (excluding gem/decoys), picked
     * deterministically per prompt id; padded with the rarest remaining answers if needed.
     */
    reveal(promptIdx = state.roundIndex) {
      const prompt = prompts[promptIdx];
      if (!prompt) return null;
      const rows = (prompt.answers || []).map(rowOf);
      const decorate = (r) => {
        const t = tierForAnswer(r.name, prompt);
        return { name: r.name, pop: r.pop, tierId: t.id, points: t.points };
      };
      const gemKey = prompt.gem ? keyOf(prompt.gem) : null;
      const decoyKeys = new Set((prompt.decoys || []).map(keyOf));
      const isSpecial = (r) => keyOf(r.name) === gemKey || decoyKeys.has(keyOf(r.name));
      const ordinary = rows.map((r, i) => ({ ...r, i })).filter((r) => !isSpecial(r));

      const common = ordinary.slice().sort((a, b) => b.pop - a.pop || a.i - b.i).slice(0, 3);
      const used = new Set(common.map((r) => r.i));
      const rand = mulberry32(hashString(`outlier/reveal/${prompt.id}`));
      let rare = seededShuffle(ordinary.filter((r) => r.pop <= 3 && !used.has(r.i)), rand).slice(0, 3);
      if (rare.length < 3) {
        const have = new Set(rare.map((r) => r.i));
        const pad = ordinary.filter((r) => !used.has(r.i) && !have.has(r.i)).sort((a, b) => a.pop - b.pop || a.i - b.i);
        rare = rare.concat(pad.slice(0, 3 - rare.length));
      }
      rare.sort((a, b) => a.pop - b.pop || a.i - b.i);

      const gemRow = gemKey ? rows.find((r) => keyOf(r.name) === gemKey) : null;
      const gem = gemRow ? decorate(gemRow)
        : prompt.gem ? { name: prompt.gem, pop: 0, tierId: 'outlier', points: tierById('outlier').points } : null;
      const decoys = (prompt.decoys || []).map((d) => {
        const r = rows.find((x) => keyOf(x.name) === keyOf(d));
        return r ? decorate(r) : { name: d, pop: 0, tierId: 'decoy', points: tierById('decoy').points };
      });
      return {
        common: common.map(decorate),
        rare: rare.map(decorate),
        gem,
        decoys,
        total: rows.length,
        round: state.rounds[promptIdx] || null,
      };
    },

    toJSON() {
      return JSON.parse(JSON.stringify(state));
    },
  };

  function endRound(prompt, r) {
    const round = {
      promptId: prompt.id,
      category: prompt.category,
      input: r.input,
      answer: r.answer,
      tierId: r.tierId,
      points: r.points,
      ms: Math.max(0, Math.round(Number(r.ms) || 0)),
      endedBy: r.endedBy,
    };
    if (r.corrected !== undefined) round.corrected = r.corrected;
    state.rounds[state.roundIndex] = round;
    state.status = 'round-over';
    return round;
  }

  return game;
}

/**
 * Create a game. mode: 'daily' | 'practice' | 'archive'. roundMs: per-round clock
 * (pass null/Infinity for Relaxed — timeout() then records elapsedMs).
 */
export function createGame({ mode = 'daily', day = null, prompts = [], roundMs = DEFAULT_ROUND_MS } = {}) {
  const state = {
    v: SCHEMA,
    mode,
    day,
    promptIds: prompts.map((p) => p.id),
    roundMs: roundMs === null || roundMs === undefined ? null : Number(roundMs),
    roundIndex: 0,
    rounds: [],
    status: prompts.length ? 'playing' : 'done',
    nearMisses: {},
    strikes: 0,
    guesses: [],
    elapsedMs: 0,
  };
  return makeGame(state, prompts);
}

/**
 * Rebuild a game from toJSON() output. `PROMPTS` is the full pool (any order).
 * Returns null if the data is invalid or a prompt id is no longer in the pool.
 */
export function gameFromJSON(obj, PROMPTS) {
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.promptIds) || obj.v !== SCHEMA) return null;
  const byId = new Map((PROMPTS || []).map((p) => [p.id, p]));
  const prompts = obj.promptIds.map((id) => byId.get(id));
  if (prompts.some((p) => !p)) return null;
  const state = {
    v: SCHEMA,
    mode: obj.mode ?? 'daily',
    day: obj.day ?? null,
    promptIds: obj.promptIds.slice(),
    roundMs: obj.roundMs ?? null,
    roundIndex: Number(obj.roundIndex) || 0,
    rounds: Array.isArray(obj.rounds) ? obj.rounds.map((r) => ({ ...r })) : [],
    status: ['playing', 'round-over', 'done'].includes(obj.status) ? obj.status : 'playing',
    nearMisses: { ...(obj.nearMisses || {}) },
    strikes: Number(obj.strikes) || 0,
    guesses: Array.isArray(obj.guesses) ? obj.guesses.map((g) => ({ ...g })) : [],
    elapsedMs: Number(obj.elapsedMs) || 0,
  };
  return makeGame(state, prompts);
}

/** Namespace matching the spec's `Game.fromJSON(obj, PROMPTS)`. */
export const Game = Object.freeze({ create: createGame, fromJSON: gameFromJSON });
createGame.fromJSON = gameFromJSON;


/** How close a near miss is, as a coarse band. Reveals nothing about the answer's spelling. */
export function heatFor(match) {
  const len = Math.max(1, String(match.form || match.target?.name || '').replace(/[^\p{L}\p{N}]/gu, '').length);
  const r = (match.distance ?? len) / len;
  if (r <= 0.15) return 'hot';
  if (r <= 0.3) return 'warm';
  return 'tepid';
}
