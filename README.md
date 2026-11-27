# Outlier

**A daily trivia game where the obvious answer is the wrong strategy.**

Every day everyone gets the same seven prompts — *"Name a pasta shape"*, *"Name a bone in the body"* —
and 25 seconds to answer each. Any valid answer counts, but the rarer it is, the more it scores.
Say *spaghetti* and you join the crowd. Say *strozzapreti* and you're an outlier.

## Play

No build step. Serve the folder with any static server:

```bash
npm start            # python3 -m http.server 8080
# open http://localhost:8080
```

`sound-lab.html` lets you audition every procedural sound effect.

## How scoring works

| Tier | Rule | Points | Share |
|---|---|---|---|
| Crowd Pleaser | named by ≥ 50% of people | 10 | ⬜ |
| Common | 25–49% | 25 | 🟦 |
| Uncommon | 10–24% | 45 | 🟩 |
| Rare | 4–9% | 65 | 🟨 |
| Obscure | ≤ 3% | 85 | 🟪 |
| **Outlier** | the prompt's hand-picked best answer | **100** | 🟧 |
| Decoy | the "famous obscure" answer everyone reaches for | 5 | 🟫 |
| Miss | no valid answer | 0 | ⬛ |

**Spelling help without giving the answer away:** small typos are auto-corrected (*spagetti* → Spaghetti).
If you're close but not close enough, a heat gauge tells you how warm you are — *Lukewarm*, *Warm* or
*Scorching* — without revealing a single letter. A wrong answer costs one of your three strikes;
a near miss doesn't.

**Database:** 161 prompts across 14 categories and over 15,000 answers, each with an estimated
popularity, plus a hand-picked Outlier answer and "decoy" traps per prompt.

## Project layout

```
index.html, css/, js/ui/, js/main.js   front end
js/engine/                             matcher (autocorrect), scoring, daily seeding, game state, storage, share
js/audio/                              procedural Web Audio sound effects
data/                                  prompt + answer database
tests/                                 node:test suites  →  npm test
docs/research.md                       genre research
docs/SPEC.md                           architecture and interface contract
```

Outlier is an original game in the rarity-trivia genre. It is not affiliated with any other game.
