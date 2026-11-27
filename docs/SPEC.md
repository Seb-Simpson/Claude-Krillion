# Outlier — build spec & interface contract

Outlier is an original daily trivia game in the "rarity-scored answers" genre:
every day everyone gets the same set of open-ended prompts ("Name a pasta shape"),
and the *less obvious* your valid answer, the more points you earn.
It is our own design — own name, tiers, look and sound. See `docs/research.md`
for genre research.

## Tech

- Zero-build static site: `index.html` + native ES modules + one CSS file.
  Works from any static server (`python3 -m http.server`) and GitHub Pages.
- No external runtime dependencies (Google Fonts allowed). No frameworks.
- Tests: `node --test tests/` (Node 18+, built-in test runner, ES modules).
- All state in `localStorage` under the key prefix `outlier:` (wrapped in try/catch).

## File ownership (each agent writes ONLY its own files)

| Area | Owner | Files |
|---|---|---|
| Prompt/answer database | **database agent** | `data/**`, `tests/data.test.mjs` |
| Game systems | **systems agent** | `js/engine/**`, `tests/engine.test.mjs`, `tests/matcher.test.mjs` |
| Sound | **sound agent** | `js/audio/**`, `sound-lab.html` |
| Front end | **frontend agent** | `index.html`, `css/**`, `js/ui/**`, `js/main.js`, `assets/**` |
| Integration, docs, README | lead | `README.md`, `docs/**`, `package.json` |

## Game rules (v1)

- **Daily mode**: 7 prompts per day, identical for every player, reset at local midnight.
  Day number = days since epoch `2026-01-01` (local date).
- **Read-in**: prompt is shown with a ~1.2 s "get ready" beat before the clock starts.
- **Timer**: 25 s per prompt. A "Relaxed" setting removes the timer (no streak difference).
- **Input**: one text field. On Enter:
  - **accepted** → round ends, tier + points revealed (shows canonical spelling if corrected).
  - **near miss** (close to a valid answer but not confident) → NOT accepted, does NOT cost a
    strike, timer keeps running. The player only learns how warm the guess was
    (`tepid` / `warm` / `hot`) — never letters, length or the answer. Typing one word of a
    multi-word answer says "be more specific". This is the "correction without giving the
    answer" system. (An earlier masked-letter hint was removed as too revealing.)
  - **not on list** → "Not on our list" shake; costs 1 strike. **3 strikes** → round ends, 0 pts.
  - Empty input is ignored.
- **Time out** → 0 points, tier `miss`.
- **Pass** button → ends round with 0 points.
- After each round: reveal card with the player's tier, points, and a "what others said"
  panel: 3 most common answers, 3 rare picks, and the prompt's hand-picked best answer
  ("the Outlier"). If the player hit a **decoy**, explain why it is a trap.
- After 7 rounds: summary screen — total score, per-round tier strip, share button,
  stats (played, streak, best, average, histogram, per-category average), countdown to next puzzle.
- **Practice mode** (unlimited): random prompts, same rules, no stats/streak impact.
- **Archive**: replay any previous day (no streak impact).

## Rarity tiers (scoring.js owns the numbers)

Rarity is curated (like word-frequency-seeded lists), not live: each answer in the
database carries `pop` = estimated % of ordinary people who would name it when asked
the prompt (1–100). Tier is derived from `pop`, with two special tiers:

| id | Label | rule | points | emoji |
|---|---|---|---|---|
| `crowd` | Crowd Pleaser | pop ≥ 50 | 10 | ⬜ |
| `common` | Common | pop 25–49 | 25 | 🟦 |
| `uncommon` | Uncommon | pop 10–24 | 45 | 🟩 |
| `rare` | Rare | pop 4–9 | 65 | 🟨 |
| `obscure` | Obscure | pop ≤ 3 | 85 | 🟪 |
| `outlier` | Outlier | the prompt's hand-picked `gem` | 100 | 🟧 |
| `decoy` | Decoy | listed in the prompt's `decoys` (the "famous obscure" answer everyone reaches for) | 5 | 🟫 |
| `miss` | Miss | no valid answer | 0 | ⬛ |

Max daily score 700. Precedence: gem > decoy > pop.

## Data format (database agent)

`data/prompts.js` must `export const PROMPTS = [...]` and `export const CATEGORIES = [...]`,
assembled from `data/categories/*.js` (one file per category, each
`export default [ ...prompts ]`). Each prompt:

```js
{
  id: "pasta-shapes",            // kebab-case, unique, stable forever
  prompt: "Name a pasta shape",  // shown to player
  category: "Food & Drink",      // one of CATEGORIES
  gem: "Strozzapreti",           // the single most satisfying deep answer (must be in answers)
  decoys: ["Orecchiette"],       // 0–2 "famous obscure" traps (must be in answers)
  answers: [
    // [canonicalName, pop, ...aliases]
    ["Spaghetti", 88],
    ["Penne", 55],
    ["Orecchiette", 6, "orechiette"],
    ["Macaroni", 60, "elbow macaroni", "elbows"],
  ],
}
```

- Aliases are alternate valid names/spellings (US/UK spelling, abbreviations,
  common short forms). Do NOT add typos as aliases — the matcher handles typos.
- `pop` forms a realistic pyramid: ~4–8 crowd answers, ~6–10 common, then a long
  tail; the bulk of answers are rare/obscure. Every prompt must have answers in
  every pop tier. Lists should be as exhaustive as the category allows.

## Engine API (systems agent) — `js/engine/`

```js
// matcher.js
export function normalize(str): string
//  lowercase, strip accents/diacritics, punctuation, leading articles (the/a/an),
//  collapse whitespace, '&' -> 'and'.
export function buildIndex(promptEntry): Index      // precompute normalized names+aliases
export function matchAnswer(input, index): MatchResult
// MatchResult:
//  { kind: 'accept', answer: {name, pop}, corrected: boolean }   // exact/alias/plural/tiny typo
//  { kind: 'near',   target: {name, pop}, distance, mask: string } // close but not confident
//  { kind: 'none' }
// Tolerance: Damerau-Levenshtein on normalized strings; plural/singular folding;
// token-order-insensitive compare for multi-word; accept if dist<=1 for len 4-7,
// <=2 for len>=8; near if dist within ~35% of length; never accept for len<=3
// unless exact.

// scoring.js
export const TIERS            // array of tier objects {id,label,min,max,points,emoji,color}
export function tierForPop(pop): Tier
export function tierForAnswer(answerName, prompt): Tier   // applies gem/decoy precedence
export function tierById(id): Tier
export const MAX_SCORE

// daily.js
export const EPOCH            // '2026-01-01'
export function dayNumber(date = new Date()): number
export function dateForDay(n): Date
export function promptsForDay(n, PROMPTS, count = 7): Prompt[]
//  deterministic (seeded PRNG), category-diverse, no prompt repeats within a cycle
export function randomPrompts(PROMPTS, count, excludeIds?): Prompt[]
export function msUntilNextDay(now = new Date()): number

// game.js — pure state machine, no DOM, no timers (UI drives the clock)
export function createGame({ mode, day, prompts, roundMs = 25000 }): Game
// game.state: { mode, day, roundIndex, rounds:[RoundResult], status:'playing'|'round-over'|'done', nearMisses }
// game.current(): Prompt
// game.submit(input, elapsedMs): { match: MatchResult, round?: RoundResult }
// game.timeout(): RoundResult        game.pass(): RoundResult
// game.strikes(): number  (wrong 'none' guesses this round; 3 ends the round)
// game.next(): void                  game.totalScore(): number
// game.reveal(promptIdx): { common: Answer[3], rare: Answer[3], gem: Answer, decoys: Answer[], total: number }
// game.toJSON() / Game.fromJSON(obj, PROMPTS) — resume mid-game after reload
// RoundResult: { promptId, input, answer|null, tierId, points, ms, endedBy:'accept'|'timeout'|'pass'|'strikes' }

// storage.js
export function loadStats(): Stats      // {played, streak, maxStreak, best, totalScore, histogram:{bucket:count}, lastDay}
export function recordDaily(day, rounds, score): Stats
export function saveInProgress(game) / loadInProgress(day) / clearInProgress()
export function getSettings() / setSettings(patch)   // {sound:true, haptics:true, theme:'auto'|'light'|'dark', reducedMotion:false, relaxed:false}
export function getDayResult(day)                    // for archive

// share.js
export function shareText({ day, rounds, score, url }): string
//  e.g.
//  Outlier #331 · 455/700
//  🟧🟩⬜🟪🟦🟩⬛
//  <url, if given>
```

## Sound API (sound agent) — `js/audio/sound.js`

Procedural Web Audio only (no audio files), lazily creates AudioContext on first
user gesture.

```js
export function unlock(): void                 // call on first click/keydown
export function play(name, opts?): void        // fire-and-forget
export function setMuted(bool) / isMuted()
export function setVolume(0..1)
// names: 'click','start','tick','tickUrgent','type','submit','near','reject',
//        'accept-crowd','accept-common','accept-uncommon','accept-rare','accept-outlier',
//        'timeout','pass','reveal','roundNext','complete','streak','share'
export function startAmbience() / stopAmbience()   // optional soft bed during play
```

## Front end (frontend agent)

Imports engine + data + sound per the APIs above. Screens: Home, How to play
(modal), Game, Round reveal, Summary, Stats (modal), Settings (modal), Archive,
Practice. Must be keyboard-first on desktop, thumb-friendly on mobile (≥ 360 px),
support light/dark, respect `prefers-reduced-motion`, and be accessible
(aria-live for feedback, focus management, contrast AA).
