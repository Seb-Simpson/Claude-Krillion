// Outlier — entry point. Wires the real engine, data and sound modules into the UI.
import * as matcher from './engine/matcher.js';
import * as scoring from './engine/scoring.js';
import * as daily from './engine/daily.js';
import * as gameMod from './engine/game.js';
import * as storage from './engine/storage.js';
import * as share from './engine/share.js';
import * as sound from './audio/sound.js';
import { PROMPTS, CATEGORIES } from '../data/prompts.js';
import { startApp } from './ui/app.js';

const SETTINGS_DEFAULTS = { sound: true, haptics: true, theme: 'auto', reducedMotion: false, relaxed: false };

const TIERS = scoring.TIERS;
const tierMap = new Map(TIERS.map((t) => [t.id, t]));
// Positive tiers from the crowd outwards (decoy and miss sit outside the ladder).
const ladder = TIERS.filter((t) => t.id !== 'decoy' && t.id !== 'miss').sort((a, b) => a.points - b.points);

const ctx = {
  PROMPTS,
  CATEGORIES,
  matcher,
  scoring,
  daily,
  gameMod,
  storage,
  share,
  sound,
  TIERS,
  ladder,
  MAX_SCORE: scoring.MAX_SCORE ?? 700,
  tier: (id) => (scoring.tierById ? scoring.tierById(id) : null) || tierMap.get(id) || null,
  settings: () => {
    try { return { ...SETTINGS_DEFAULTS, ...(storage.getSettings() || {}) }; } catch { return { ...SETTINGS_DEFAULTS }; }
  },
  setSettings: (patch) => {
    try { storage.setSettings(patch); } catch (err) { console.warn('[outlier] settings not saved', err); }
  },
};

startApp(ctx);
