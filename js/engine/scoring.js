// Outlier — rarity tiers and points. scoring.js owns the numbers (docs/SPEC.md "Rarity tiers").
import { normalize } from './matcher.js';

/**
 * Tier objects: {id, label, min, max, points, emoji, color, blurb}.
 * min/max are the inclusive `pop` range for pop-derived tiers, null for the special tiers.
 * Order matches the spec table (most popular first, then the specials).
 */
export const TIERS = Object.freeze([
  { id: 'crowd', label: 'Crowd Pleaser', min: 50, max: 100, points: 10, emoji: '⬜', color: '#c9ced6',
    blurb: 'Half the room said it too. Safe, solid, not very sneaky.' },
  { id: 'common', label: 'Common', min: 25, max: 49, points: 25, emoji: '🟦', color: '#3d7fe0',
    blurb: 'A familiar pick — plenty of people got there first.' },
  { id: 'uncommon', label: 'Uncommon', min: 10, max: 24, points: 45, emoji: '🟩', color: '#2fae66',
    blurb: 'Off the beaten path. Most people walked right past it.' },
  { id: 'rare', label: 'Rare', min: 4, max: 9, points: 65, emoji: '🟨', color: '#e2b324',
    blurb: 'Only a handful of people think of this one.' },
  { id: 'obscure', label: 'Obscure', min: 0, max: 3, points: 85, emoji: '🟪', color: '#9157e0',
    blurb: 'Deep cut. Practically nobody else said it.' },
  { id: 'outlier', label: 'Outlier', min: null, max: null, points: 100, emoji: '🟧', color: '#f07a2a',
    blurb: 'The answer we were quietly hoping someone would find.' },
  { id: 'decoy', label: 'Decoy', min: null, max: null, points: 5, emoji: '🟫', color: '#8a5a3c',
    blurb: 'The "obscure" answer everybody reaches for. A trap, and you walked in.' },
  { id: 'miss', label: 'Miss', min: null, max: null, points: 0, emoji: '⬛', color: '#3a3f4a',
    blurb: 'No valid answer this round.' },
].map((t) => Object.freeze(t)));

export const MAX_SCORE = 700;

const BY_ID = new Map(TIERS.map((t) => [t.id, t]));

/** Tier by id, or undefined. */
export function tierById(id) {
  return BY_ID.get(id);
}

/** Pop-derived tier (crowd/common/uncommon/rare/obscure). Non-numeric pop → miss. */
export function tierForPop(pop) {
  const p = Number(pop);
  if (pop === null || pop === undefined || !Number.isFinite(p)) return BY_ID.get('miss');
  if (p >= 50) return BY_ID.get('crowd');
  if (p >= 25) return BY_ID.get('common');
  if (p >= 10) return BY_ID.get('uncommon');
  if (p >= 4) return BY_ID.get('rare');
  return BY_ID.get('obscure');
}

const key = (s) => normalize(s).replace(/ /g, '');

/** Find an answer row in a prompt by (normalized) canonical name. Returns {name, pop} or null. */
export function findAnswer(answerName, prompt) {
  const k = key(answerName);
  if (!k || !prompt || !prompt.answers) return null;
  for (const a of prompt.answers) {
    const name = Array.isArray(a) ? a[0] : a.name;
    if (key(name) === k) return { name, pop: Array.isArray(a) ? a[1] : a.pop };
  }
  return null;
}

/**
 * Tier for an accepted answer on a prompt, with precedence gem > decoy > pop.
 * `answerName` may be a string or an {name} object. Unknown answers → miss.
 */
export function tierForAnswer(answerName, prompt) {
  const name = answerName && typeof answerName === 'object' ? answerName.name : answerName;
  const k = key(name);
  if (!k || !prompt) return BY_ID.get('miss');
  if (prompt.gem && key(prompt.gem) === k) return BY_ID.get('outlier');
  if ((prompt.decoys || []).some((d) => key(d) === k)) return BY_ID.get('decoy');
  const row = findAnswer(name, prompt);
  if (!row) return BY_ID.get('miss');
  return tierForPop(row.pop);
}
