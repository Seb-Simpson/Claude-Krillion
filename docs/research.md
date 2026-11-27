# Research: Krillion and the rarity-scored trivia genre

*Compiled 2026-11-27. Purpose: understand the mechanics, systems and design psychology of Krillion (krillion.io) and its genre so we can build an **original** game. Nothing here is meant to be copied as branding, art or text.*

## 0. Method and how much to trust it

- **Direct page fetching was blocked** in this research environment: krillion.io, aiidelist.com, thewordfinder.com, parv.bearblog.dev, news.ycombinator.com, addons.mozilla.org and web.archive.org could not be loaded. Everything about those pages comes from search-engine summaries, which quote or paraphrase them. To verify these findings directly, those hosts need to be allowed in the session's network settings.
- Two public GitHub fan projects **were** read in full: `buenk/krillion-stats`, a stats bookmarklet that talks to Krillion's real API and localStorage, and `btyagi-code/krillion-update`, a fan remix that responds to player complaints. They are the best evidence available here on internals and player pain points.
- **There are a great many SEO clone and "answers today" sites** (krillion.game, divekrillion.com, krillion.wiki, krilliongame.net, and dozens of others). Many present themselves as official but are not. Their claims often conflict, and some describe their own clone rather than the real game. I give more weight to (a) snippets of krillion.io's own FAQ, packs and privacy pages, (b) press coverage (Fast Company, Yahoo/AOL UK, GameRant), (c) the two GitHub repos, and (d) claims that many independent sites agree on.
- Confidence labels used below: **[confirmed]** official page or several strong sources; **[likely]** broad agreement among secondary sources; **[conflicting]** sources disagree; **[unverified]** a single weak source.

---

## 1. Background

- **What it is:** A free daily browser trivia game. Every player gets the same seven open-ended category prompts each day ("Name a ..."). Any valid answer counts, but **rarer valid answers score more**, and the total becomes a "dive depth" in an ocean metaphor. **[confirmed]**
- **Creator:** A solo developer who goes by "kp". The official FAQ describes him as a 23-year-old American CS graduate (some coverage adds "former software engineer") who built the game alone ("No, just me"). The FAQ warns about impostors claiming to be the creator, and some clone sites give the age as 22. **[confirmed / minor conflict]**
- **Inspiration:** Fast Company reports that kp credits a British quiz show as partial inspiration. That is almost certainly *Pointless*, where obscure correct answers win (see section 9). **[likely]**
- **Launch:** Mid-July 2026. Sources give July 14 (IGDB), July 15, or July 16 as Day #1. The daily counter puts Dive #135 on Nov 27, 2026, which works back to July 16 as Dive #1. **[confirmed ±1 day]**
- **Traction:** Coverage describes rapid viral growth, especially among Gen Z and Gen Alpha and in school classrooms (Fast Company, Scot Scoop, Knight Writers, Iowa State Daily, The Tower Pulse). A YouTube video claims about 154.5M monthly visits within roughly 90 days, which is a third-party estimate. On Dive #135 the answer sheet had 40,720 accepted answers across seven prompts, a measure of answer-bank size, not players. **[unverified figures]**
- **Ecosystem:** Official merch shop (shop.krillion.io), a Discord Activity version, Google sign-in ("My Krillion") for cross-device sync, an official Android listing (per search snippets), and a huge clone and answer-site ecosystem. Fan tools include a Firefox/Chrome "Krillion Share" add-on, the krillion-stats bookmarklet, and fan remixes. **[confirmed/likely]**

---

## 2. The core game loop

| Element | Finding | Confidence |
|---|---|---|
| Prompts per day | **7**, the same for everyone | confirmed |
| Timer | **25 seconds per prompt**. One guide says 20 s, one says 20–25 s. One source says the prompt shows for about **3 s before the clock starts**. Others say the clock starts when the prompt appears | 25 s likely; 3 s preview unverified |
| Input | One free-text field. Type an answer and press Enter. No multiple choice | confirmed |
| Wrong or unrecognised answer | **Does not end the round.** You can keep typing new guesses until the timer runs out ("wrong guesses are free"). The reverse-engineering blog's analysis depends on this. A minority of sites say "one answer per prompt, no second chances" | conflicting; free retries most likely |
| Accepted answer | Locks in, gets scored, and the round ends. The diver sinks by points × 10 m. The answer drops past "tier lines" to its tier. Some answers show a one-line fact (e.g. "First used at Auburn Prison, New York, in 1890") | likely |
| Near-miss spelling | Autocorrect proposes the canonical spelling, and you **submit again to confirm**. A typo is never silently awarded. The confirm step costs clock time, which is a top player complaint | likely |
| Timeout | Prompt scores **0** (a "miss") and the game moves to the next prompt. The run does not end | likely |
| Skip | Some sources mention a skip/pass that records 0 and saves no time. It is unclear whether the official game has a skip button | unverified |
| Duplicates | Not relevant in single-answer rounds. One source notes the same answer can't score twice | weak |
| Attempts | One scored daily dive per day | confirmed |
| End screen | Total score and depth, a seven-round "dive graph", a **percentile against today's field**, a share button, and **a full answer sheet per prompt** where you can filter by tier and search, with your answer highlighted and counts of how many players gave each answer | likely (backed by API evidence, section 7) |
| "One in a Krillion" reveal | The top answer may sit behind letter tiles you tap to reveal letter by letter. Landing it triggers a gold flash or krill animation | unverified |
| Reset | **Midnight US Eastern** (04:00 UTC in summer, 05:00 UTC in winter; the stats repo says 05:00 UTC in November). Some clones say 00:00 UTC | confirmed (ET) |

---

## 3. Scoring

### 3.1 Tiers (current consensus)

| Tier | Points | Depth | Meaning |
|---|---|---|---|
| Miss | 0 | 0 m | No accepted answer in time |
| Plankton | 10 | 100 m | The obvious first answer most people give |
| **Too Clever** | **15** | 150 m | The "go-to obscure" answer that many players reach for *because* they are trying to be rare, so it isn't rare. A **trap tier** |
| Schooler | 30 | 300 m | Common but not the first thing people say |
| Rare | 60 | 600 m | Genuinely uncommon. Fast Company's example is "endoscope" at 60 |
| Deep Cut | 85 | 850 m | Obscure. Usually the largest bucket by answer count |
| One in a Krillion | 100 | 1,000 m | **A single hand-picked answer per prompt** (the "gem") |

- **Max score:** 7 × 100 = **700 points = 7,000 m.** The conversion is a flat **10 m per point**. **[confirmed]**
- The tier keys and colours in the stats repo match this six-tier-plus-miss set. They were copied from krillion.io's CSS: krillion gold `#ffd166`, deep cut lavender `#bfa7ff`, rare pink `#ff7bac`, schooler cyan `#7deaff`, too clever orange `#ff9f43`, plankton pale `#d7e1f2`, miss slate `#3d4f6e`. **[confirmed]**
- **Conflicts:** Older and clone sources list other tables: a five-tier table without Too Clever, Plankton 5 / Rare 40, 5/15/25/50/75/100, and a version with One in a Krillion at 120 and Deep Cut at 90. One aggregator noticed tiers present on one day and absent on the next. That may just reflect prompts where no answer fell in a given tier, since tiers with zero answers don't display. The 10/15/30/60/85/100 table is the most widely corroborated and matches the game's own CSS tokens.

### 3.2 How rarity is computed

**The official FAQ is clear: it is NOT a live count of other players' answers.** **[confirmed]**
- **Some prompts are scored mechanically** against a "familiarity database", meaning how often a word or name turns up in what people read and write. In other words, **corpus word frequency**.
- **Prompts that can't be reduced to a frequency number** get **LLM assistance plus a manual pass.**
- **The "One in a Krillion" gem is curated.** Past a certain depth, rarity is hard to measure, so the gem is chosen partly for **how satisfying it is to land on**. It should also be something at least a few players actually get. As a result, a Deep Cut can be *rarer* than the gem.
- Tiers are **assigned when the answer list is built** and **do not move** with what people type that day (GameRant). That is the opposite of Immaculate Grid.
- **Answer lists are curated** from multiple sources. The FAQ admits a fair answer is sometimes missing because the curator overlooked a source. One fan site claims hand-written lists plus **Wikidata**. That is plausible given prompt qualifiers like "(1,000+ IMDb votes)" and the enormous species and film lists.
- **Player counts are still collected and shown.** The answer sheet shows how many players gave each answer (an `/api/answer-popularity` endpoint), and the percentile compares your *total* against the field. So crowd data drives **social comparison, not scoring**.
- **Conflict:** Many clone sites (and a Minecraft fan port) claim rarity equals the share of players who gave that answer. The official FAQ contradicts this. The fan remix uses player-share thresholds (<0.2% / <1% / <5% / <15%) as its own invention.

### 3.3 Shape of an answer bank (important)

Tier counts from answer-sheet aggregators show a steep pyramid:
- "Name an animal that stings": Plankton **6**, Schooler **8**, Rare **201**, Deep Cut **6,466**.
- "Name a living bird bigger than a chicken": Deep Cut **22,256**.
- "Name any item in Minecraft": Deep Cut **1,869**.
- Dive #135: 40,720 accepted answers across 7 prompts, of which **37,387 were Deep Cut**. Per-prompt sizes ranged from about **115** (a sky-visibility prompt) to **1,532** (jobs involving drawing) to tens of thousands (species, films).

**Implication:** Only a handful of answers (about 5–20) are "common". Anything a knowledgeable player can name beyond the obvious tends to land at 60–85. The scoring is generous to knowledge breadth, and the drama lives in avoiding the few common answers and the Too Clever trap.

---

## 4. Answer validation and matching

Most of this comes from the official FAQ snippet, the "Reverse-engineering Krillion's Autocorrect" blog post (Nov 27, 2026, discussed on HN) and community observation.

- **Normalisation [likely]:** lowercase, ignore spaces, strip a leading "The", drop a trailing "s" (plurals). Dropping the plural still uses up the typo allowance.
- **Length-scaled typo tolerance [likely, community-measured]:** about 4 letters or fewer allows 0 typos. Around 6–7 letters allows 1. Longer answers allow 2, and one guide says 9+ characters allow 2. The blog frames matches as "within two typos", which suggests an edit-distance approach. Levenshtein is not confirmed.
- **Confirm-to-accept [likely]:** a near-miss is offered as a suggestion that you must resubmit. You are never silently awarded points.
- **Aliases [confirmed]:** many answers carry aliases (alternate common names, scientific names). Autocorrect **also matches against aliases**, so being one letter off an alias can snap you onto an unexpected answer. The FAQ's example is a fish nicknamed "sea donkey", which is one letter from "sea monkey".
- **Spelling guidance [unverified]:** the bank is English. Fan FAQs suggest using Wikipedia article-title spellings.
- **Exploits [confirmed by multiple sources]:**
  - **The "James method":** type a common first name and autocorrect upgrades it to some obscure answer containing it (e.g. a lesser-known James). The blog found "james" lands on 90 prompts under a "first-word alias" model and 25 under an exact-answer model. Players widely see it as cheating.
  - **Best "opener" strings:** because wrong guesses are free, you can fire a short, high-coverage string. "cares" lands on about 22% of prompts in the first-word model and about 7% in the exact model. Long strings rarely help because long words are seldom within two edits of each other.
  - **Root cause:** free unlimited guesses + fuzzy matching against first words or aliases + a hidden list = a brute-force surface.
- **Fan fixes (krillion-update) worth learning from:** match against the *whole* answer only. Require the same first letter. Refuse ties. Return "be more specific" for a bare word from a multi-word answer. Pause the clock up to 5 s during spelling confirmation. Add phonetic matching (Double Metaphone) only when spelling is also close.

---

## 5. Prompt design and categories

- **Format:** almost always "Name a/an ..." with a category, often with a **qualifier in parentheses** that keeps the list checkable. Examples:
  - "Name a live-action movie released in the 2010s (1,000+ IMDb votes)"
  - "Name an animal that eats fish (documented, regular part of its diet)"
  - "Name a fruit that's fuzzy, hairy, or spiky on the outside"
  - "Name a way to travel in or on water"
  - "Name a sport where you're allowed to kick your opponent"
  - "Name a job that involves drawing"
  - "Name a song from a movie soundtrack", "Name a term for a division of land"
  - "Name a country with the letter P in its name"
  - "Name a fruit or vegetable that is red on the inside"
  - "Name an animal with webbed feet", "Name an animal that stings"
  - "Name a living bird bigger than a chicken", "Name any item in Minecraft (older versions count too)"
  - "Name a form medicine comes in (like a pill)"
- **Example gem answers (Dive #135):** Annatto (fuzzy/spiky fruit), *The Other Side of the Wind* (2010s film), pumpkin boat (water travel), Bartitsu (kicking sport), Mambabatok (drawing job), "Whistle Stop" (soundtrack song), condominium (land division). Gems are **delightful "oh, that counts!" answers**, not merely the most obscure.
- **Category mix (from the stats repo's classifier and observed prompts):** Animals & Nature, Food & Drink, Geography, Film & TV, Music, Sports, Science & Health, Games & Tech (Minecraft and Pokémon appear), People & Culture, Art & Books, Brands, Words & Letters (letter constraints, rhymes), Everyday Things. A daily set mixes categories, including pop-culture prompts aimed at younger players.
- **Themed packs (official, beta, "free for now"):** solo sets of about 30 chapters/dives on one topic: Words & Language, Movies, Sports, Geography, Music (coming soon). Each pack reportedly has a $5 unlock button. The FAQ says new packs wait on better answer curation and rarity selection.

---

## 6. Retention and engagement systems

| System | Finding | Confidence |
|---|---|---|
| Daily reset | One shared dive per day at midnight ET, numbered ("Dive #135") | confirmed |
| Streaks | Current and longest streak for consecutive days with a completed daily. Unlimited, pack and archive play don't count | likely |
| Streak cosmetics | Collectible **"dive buddies"** unlocked at streak milestones. The official store listing says 5 buddies ("from The Krill to the Evil Krill"). Fan lists of thresholds conflict (5/14/30/45 days vs 3/5/7/10/14/21/30/50 vs up to 150). Purely cosmetic, with no score effect | conflicting details |
| Share | Built-in copy gives the dive number, score and depth, and **one emoji per round coloured or chosen by tier**, with ⬛ for a miss. No answers are revealed, so it is spoiler-free. A third-party add-on adds percentile and spoiler-tagged answers for Discord, which shows that players want richer shares | likely |
| Percentile | End screen shows "better than X%" of today's divers, via `POST /api/today/complete` returning `dist` (score histogram buckets 0–700) and `betterThan` | confirmed (API) |
| Answer reveal | Per-prompt answer sheet: every accepted answer, tier and points, and player counts per answer. Field stats are served **only for the current day**, and past dates return 403 | confirmed (API) |
| Leaderboard | No global leaderboard. A fan guide's headline says "why there's no leaderboard". Comparison happens through percentile and shares | likely |
| Unlimited / "Infinite" | Official **∞ Unlimited** ("endless dive"), a **one-time $5 unlock**. "Krillion Infinite" is a fan and clone name for this. Any unlock reportedly removes ads site-wide | likely |
| Archive | Past daily dives are playable. Dive 1 is free, and the rest are behind the $5 unlock | likely |
| Multiplayer | **Puffer Party** (beta, krillion.io/party): up to 10 players take turns naming answers in a category and pass a "puffer" with a hidden random fuse (10–30 s by default). The timer is shared, with a floor of 8 s when passed, and the last player floating wins. Hot-potato design | confirmed (FAQ) |
| Discord Activity | Daily dive inside Discord, optional channel recaps posting score and a seven-round dive graph, and a **group streak** for servers | confirmed (privacy page) |
| Accounts/sync | Google sign-in syncs daily, archive and pack history (scores, tiers, prompts, answers) across devices. Otherwise everything is localStorage | confirmed |
| Hints | No in-dive hints are confirmed. Possible letter-tile reveal of the gem on the results screen | unverified |
| Monetisation | Free daily, ads, $5 unlocks, merch | likely |

---

## 7. Tech stack (what is discoverable)

From the `krillion-stats` bookmarklet, which runs on krillion.io:
- **localStorage keys:** `krillion:game:v1` (in-progress or just-finished game), `krillion:stats:v1` (history keyed by date: score, per-round answers and tiers), `krillion:player:v1` (anonymous player id), `krillion:account-owner:v1`. Signed-in users get keys namespaced `krillion:account:<owner>:...`. **Local-first state with versioned keys.**
- **REST endpoints:** `GET /api/today` (date, day number, prompts with ids and text), `POST /api/today/complete` (records completion and returns `dist` and `betterThan`. A `record:false` flag returns stats without counting again), `GET /api/answer-popularity?date=` (counts per answer per prompt), `GET /api/reveal?date=` (full answer sheet with tier and score per answer; it is slow, and the tool uses a 45 s timeout). Field stats are only available for today.
- **Inferred architecture:** the daily puzzle is **served by the server** (prompts only). **Validation probably happens server-side or with a hashed list**, since the answer list is "hidden" and revealed only after completion. Completion events feed a server-side histogram for percentiles.
- **Framework/hosting:** an indie-stack listing loosely associates Krillion with Next.js/React and Cloudflare. **[unverified]** UI typography uses a pixel font for numerals, per the stats repo's description of the game's look.

---

## 8. Visual design and audio (for feel only; we will design our own)

- **Metaphor:** a **diver sinking through ocean zones** (Sunlight 0–200 m, Twilight 200–1,000 m, Midnight 1,000–4,000 m, Abyssal 4,000–6,000 m, Hadal 6,000–7,000 m), with real landmarks along the way such as the Titanic wreck at 3,800 m. Reviewers call it "oddly educational". The background darkens and sea creatures pass as you go deeper.
- **Style:** **pixel art** ("pixelated ocean depths"), a dark abyss-navy UI, square corners, and saturated colour reserved for tier colours. A pixel display face for numbers.
- **Animation:** smooth diver descent after each answer. The answer "drops past tier lines". A special gold flash for the top tier.
- **Audio:** reviews mention "crisp sound effects". A clone uses procedurally synthesised underwater audio. Details of the official audio are thin.
- **Mascot:** a krill. Buddies are sea creatures, with an "Evil Krill" at the top.
- **Tone:** playful puns (the name is a pun on "one in a million", "Schooler" is a schooling fish), light and friendly, with a tight seven-round format that takes about 3 minutes.

---

## 9. Comparable games and formats

- **Pointless (BBC, 2009–):** 100 people get 100 seconds to name as many answers as possible. Contestants score the number of people who gave their answer, and **lowest wins**. A "pointless" answer (correct, given by nobody) adds to a rolling jackpot. This is the clearest ancestor: obscurity *within correctness*, revealed by a dramatic falling counter.
- **Family Feud:** the inverse. You score by matching the *most popular* survey answers. Some rarity games pair both modes (e.g. Wonderhop's "Abyss" rewards rare answers and "Sky" rewards common ones).
- **Immaculate Grid (Sports Reference, 2023):** a 3×3 grid of player-meets-two-criteria cells. The **rarity score** is the sum of the percentage of players who picked each of your answers, with a 100 penalty per empty cell, so **lower is better**. It is **live**: percentages change through the day as others play. That is the main contrast with Krillion's fixed, curated tiers.
- **Wordle:** one shared puzzle per day, a spoiler-free emoji share grid, and stats (played, win %, current and max streak, guess-distribution histogram). Lessons: scarcity, about 3 minutes a day, social sharing without spoilers, and no leaderboard.
- **Krillion-likes (2026):** Rarest Answer, Seldom (lower is better, a zero is a "Seldom"), Wonderhop, Hopdown, Cosmillion, Roadle, Unicorner (soccer), Jinxed (multiplayer), Planktillion, Squillion. The genre has become crowded fast, and nearly all copy the metaphor-depth-plus-seven-prompts template. *Obscurdle* was named in the brief, but I found no reliable information about it.

---

## 10. Psychology: why rarity scoring works

1. **Inversion of trivia's usual reward.** Ordinary trivia rewards *the* answer. Rarity trivia rewards *your* answer. Everyone can score, because a common answer still earns points, but **knowledge breadth and lateral thinking** are what separate players. Low floor, high ceiling.
2. **Need for uniqueness (Snyder & Fromkin).** People want to be *moderately* distinct from others, while staying socially acceptable. A rare-but-valid answer is a perfect, harmless display of distinctiveness, and the shared result says "I thought of something nobody else did".
3. **Variable reward.** You never know exactly which tier an answer will land in until the reveal. That uncertainty (a variable-ratio-like payoff, the same mechanism behind loot reveals) makes each submit a small gamble with a dopamine-friendly reveal. Research on near-misses is mixed, but a reveal paced like a slot machine reliably creates anticipation.
4. **Near-miss and "I should have said...".** The post-game answer sheet shows the gems and deep cuts you *almost* thought of. That produces regret plus learning ("next time!"), which drives a return visit tomorrow. The Too Clever tier creates a memorable, funny near-miss: you tried to be clever and the crowd had the same idea.
5. **Second-order thinking (Keynesian beauty contest).** The Too Clever trap makes players model *other players' attempts to be original*. That is a deeper mind game than recall alone, and the source of strategy talk ("skip your first idea, then skip your second").
6. **Mastery and learning.** Every reveal teaches new facts (Bartitsu! Annatto!). Players feel themselves improving, and teachers use it as a vocabulary game.
7. **Social comparison without a leaderboard.** Percentile ("better than 83%") and friend shares let you compare upward or downward without public humiliation. Shared prompts make the result a conversation starter ("what did you put for #4?").
8. **Scarcity and ritual (the Wordle lessons).** One dive a day, the same for everyone, about 3 minutes, spoiler-free sharing, and a streak to protect (loss aversion). Daily scarcity builds anticipation and prevents burnout. Broken streaks should feel forgiving, not punishing. Monetising *extra* play (unlimited, archive, packs) keeps the daily sacred and free.
9. **Time pressure.** 25 s makes the game a recall sprint and stops googling, but it's also the #1 complaint, especially when spelling-confirm eats the clock. Pressure adds excitement, but players need fairness.
10. **Collection.** Streak buddies are a light, cosmetic collection loop that rewards consistency rather than skill.

---

## 11. Known pain points and criticisms (opportunities for us)

1. **Timer stress**, made worse by spelling confirmations eating time. Accessibility concern for slow typists, mobile users and non-native speakers.
2. **"Pick something niche AND spell it"**: obscure answers are exactly the ones people can't spell.
3. **Valid answers rejected** (curation gaps) and no clear appeal path.
4. **Too Clever feels like a hidden, unexplained trap.**
5. **Autocorrect exploits** (James method, opener strings) undermine trust in the leaderboard and percentiles.
6. **Opaque rarity:** players assume it's crowd-based. The real system (frequency plus LLM plus manual review, with a curated gem) is invisible, so tiers can feel arbitrary.
7. **Field stats vanish after one day**, so players build their own history tools.
8. **Clone confusion:** a fragmented ecosystem of lookalikes and answer-spoiler sites.

---

## 12. Design implications for our original game

*Recommendations for an original rarity-scored trivia game. Use our own name, metaphor, tier names, art and copy. Avoid the ocean, dive or krill framing and the specific tier names, which are core to Krillion's identity.*

### 12.1 Format
- **Prompts per daily:** **6–7.** Seven is proven and gives a 3–4 minute session. Six would differentiate us slightly and makes the share row tidier. Recommendation: **7**, unless the share layout suggests otherwise.
- **Timer:** default **30 s** per prompt, with **a 2–3 s read period before the clock starts** and the **clock paused during any "did you mean" confirmation** (cap the pause at about 5 s per prompt). Offer a **Relaxed mode (60 s or untimed)** that doesn't count toward ranked percentiles but *does* keep the streak. That fixes Krillion's top complaint without killing the tension.
- **Guess policy:** to stop brute-forcing openers, use **limited guesses per prompt (e.g. 3 strikes)** rather than unlimited free guesses. Show rejected guesses as greyed chips. Alternatively, keep guesses unlimited but stop fuzzy-upgrading short strings. **Recommendation: 3 guesses**, which adds a small risk and reward and makes each submit feel weighty.
- **Skip button:** yes. It scores 0 instantly, and the saved time does not carry over.

### 12.2 Tiers and scoring
- Use **5 positive tiers plus a trap tier plus miss**, with original names that fit our own metaphor. Suggested curve: **10 / 25 / 50 / 75 / 100**, a trap tier at **5**, and miss at **0**. Max = 7 × 100 = **700**, or add a small streak or perfection bonus instead of inflating the base.
- **Rarity source: a hybrid we can actually run.**
  1. **Seed tiers offline** from corpus word frequency (e.g. `wordfreq` or Wikipedia pageviews), Wikidata sitelink counts and LLM-assisted judgement, plus a manual pass. Precompute this into a static per-day JSON.
  2. **Optionally recalibrate** from real player counts after enough plays (e.g. after N ≥ 500 submissions, blend 50/50 and freeze at the next reset). Always show players **"X% of players gave this"** on the reveal for social proof, even when the score is curated.
  3. **Lock scores at submit time.** Never change a player's score after the fact, so shares stay stable. That avoids the moving-target problem Immaculate Grid has.
- **Trap tier:** keep the idea (the famous "obscure" answer everyone reaches for), because it's the most talked-about mechanic. **Explain it immediately when hit**, with a funny line and the share of players who fell for it.
- **Top tier:** one or two **curated "gem" answers per prompt**, chosen for delight and gettability, not maximum obscurity. Give them a special reveal animation.
- **Answer-bank shape:** aim for a pyramid: about 5–10 common answers, 10–40 mid answers, then a long tail. Make sure each prompt has hundreds or more valid answers (use Wikidata queries) so knowledgeable players aren't rejected. Prompts need **checkable qualifiers** (date ranges, "documented", vote thresholds).

### 12.3 Matching tolerance (anti-exploit)
- Normalise: lowercase, strip accents and punctuation, drop leading articles ("the/a/an"), collapse whitespace, singularise trailing "s" and "es", and map `&` to "and".
- **Typo tolerance by length:** ≤4 chars → 0 edits. 5–7 → 1. 8–12 → 2. 13+ → 3. Use Damerau-Levenshtein so transpositions count as one edit.
- **Only fuzzy-match against whole canonical names and explicit aliases**, never first words or substrings. **Require the same first letter** (or sound group). **Refuse ambiguous ties.**
- A single word of a multi-word answer → "be more specific" (no penalty, guess not consumed).
- Optional **phonetic fallback** (Double Metaphone) for words of 6+ characters, only when edit distance is also within about 35%. Always **confirm** with "Did you mean ___?". Confirming is one tap and does not use a guess.
- **Server-side or hashed validation:** ship the day's answers hashed (e.g. a salted SHA-256 of the normalised form) or validate through an API, so the list can't be read from the bundle. Fuzzy matching needs the plain list, so either validate on the server (preferred) or accept that determined players can read it.
- **"Report missing answer" button** on misses, stored for review. That builds trust and finds curation gaps.

### 12.4 Share format (spoiler-free, compact, ours)
- Text like:
  `<GameName> #42 · 455 pts · Top 18%`
  `🟪🟨⬜🟥🟦🟪⬛`
  `🔥 12-day streak`
  with one emoji per round mapped to our tiers (choose our own emoji set and a distinct trap emoji), ⬛ for a miss, and a short URL. **No answers.**
- Add an optional **"spoiler share"** that wraps answers in Discord `||spoiler||` tags. Players built add-ons for this, so make it native.
- Also offer a **generated image card** (canvas) for social platforms.

### 12.5 Retention features (priority order)
1. **Daily puzzle plus numbered dives** with a reset at a fixed time (e.g. midnight local time, or one global UTC time; pick one and show a countdown).
2. **Streaks** (current and best) with **one streak freeze earned per 7 days**, so a broken streak feels forgiving.
3. **Stats screen:** games played, average score, best score, a score-distribution histogram of *your* history, a tier-distribution bar, and per-category strengths and weaknesses (players built tools for exactly this).
4. **Percentile against today's field** ("better than X%") and a field histogram with your marker. **Keep history permanently** (fixing a Krillion gap).
5. **Post-game reveal:** full answer sheet per prompt, filterable by tier and searchable, with your answer highlighted, the share of players per answer, and a one-line fun fact on gem answers. This is the learning loop and drives "I should have said...".
6. **Practice / unlimited mode** with random prompts from the back catalogue (separate from streaks). Consider free with a soft daily cap rather than a paywall at first.
7. **Archive** of past dailies.
8. **Cosmetic collection** (unlockable avatars or badges at streak and achievement milestones, e.g. "first gem", "7 rounds without a trap").
9. Later: **friends/groups** (private group leaderboards, which work better socially than a global board), **head-to-head or party mode** (a hot-potato pass-the-bomb mechanic works well for parties), and **themed packs**.

### 12.6 Feel
- Choose an **original progress metaphor** for the score meter (e.g. climbing, digging, launching, excavating, or a non-spatial "rarity gauge"). Map points to an evocative unit and add real-world landmarks along the scale for the "oddly educational" charm.
- **Juice the reveal:** a short (≤1 s) suspense beat after submit, then the tier lands with a colour flash and sound, scaling up for higher tiers (the variable-reward moment). Keep it skippable or fast for repeat players.
- Light, punny voice. Mobile-first single-column layout with a big input, visible timer ring, and on-screen guess chips.

### 12.7 Tech suggestions
- **Static-first:** precompute daily puzzles as JSON (prompts plus an answer bank with tiers, aliases and facts). Use a tiny serverless API for validation, a completion histogram and answer popularity counts (e.g. Cloudflare Workers + KV/D1, or Supabase).
- Store player state in **versioned localStorage keys** (`<game>:state:v1`, `<game>:stats:v1`) with an anonymous player id. Add optional account sync later.
- Seed the daily from a date key so all players get the same set, keep the matcher **pure and unit-tested** (no DOM), and include an anti-exploit test suite: common first names, top 5,000 English words and short strings must not fuzzy-upgrade to rare answers.

---

## Sources

**Official / primary**
- https://krillion.io/ (home; snippets only)
- https://krillion.io/faq
- https://krillion.io/packs
- https://krillion.io/archive
- https://krillion.io/privacy
- https://shop.krillion.io/products/golden-krillion-tee
- https://github.com/buenk/krillion-stats (read in full: API endpoints, localStorage keys, tier colours)
- https://github.com/btyagi-code/krillion-update (read in full: fan remix, player complaints, anti-exploit matcher)

**Press**
- https://www.fastcompany.com/91647974/krillion-is-hooking-gen-z-and-gen-alpha-heres-what-you-need-to-know-about-the-viral-word-game
- https://uk.news.yahoo.com/krillion-addictive-daily-game-challenging-135100285.html
- https://www.aol.co.uk/articles/krillion-addictive-daily-game-challenging-135100000.html
- https://www.inkl.com/news/krillion-the-addictive-new-daily-game-challenging-wordle
- https://gamerant.com/krillion-answers-today-november-26-dive-134/
- https://gamerant.com/krillion-answers-today-november-27-dive-135/
- https://scotscoop.com/krillion-takes-a-dive-into-classroom-games/
- https://iowastatedaily.com/349041/arts-culture/krillion-puts-a-new-spin-on-daily-games/
- https://thetowerpulse.net/53245/arts-and-entertainment/diving-into-krillion-daily-trivia-craze-sweeping-school-hallways/
- https://knightwriters.org/in-depth/2026/11/20/krillion-takes-over-the-classroom/
- https://ibwheadlight.com/7600/artsentertainment/krillion-is-this-the-new-big-game/
- https://britbrief.co.uk/entertainment/gaming/krillion-daily-trivia-game-rewarding-rare-answers.html
- https://www.trendhunter.com/trends/daily-trivia-games
- https://www.igdb.com/games/krillion
- https://www.youtube.com/watch?v=Uu1MKNMGXag (154M-visit claim)
- https://www.youtube.com/watch?v=rhUhMQo-k-M

**Technical / community analysis**
- https://parv.bearblog.dev/krillion/ (Reverse-engineering Krillion's Autocorrect; snippets)
- https://news.ycombinator.com/item?id=50663971
- https://addons.mozilla.org/en-US/firefox/addon/krillion-share/
- https://chromewebstore.google.com/detail/krillion-share/mpjekemgfimddhgnfmkdcdpnfoafddao
- https://news.andipew.com/krillion-game/ (review: visuals, sound)
- https://playlin.io/game/krillion/ (review: depth landmarks)

**Answer aggregators and fan guides (lower reliability; used for corroboration and conflicts)**
- https://www.thewordfinder.com/misc-solvers/krillion-answers/
- https://www.thewordfinder.com/misc-solvers/krillion-answers/2026-11-08/
- https://aiidelist.com/blog/krillion-game-guide-how-to-play-rare-answers
- https://aiidelist.com/blog/krillion-creator-kp-ai-technology
- https://similarlabs.com/blog/krillion-unlimited-guide
- https://krilliondaily.com/blog/who-made-krillion
- https://krilliondaily.com/krillion-too-clever
- https://krilliontoday.com/too-clever
- https://raritygame.com/guides/too-clever-answers/
- https://thegametake.com/guides/krillion-scoring-tiers-too-clever
- https://krillion.run/faq/
- https://krillion.run/themed-packs/
- https://krillion.wiki/guides/krillion-glossary
- https://krillion.wiki/guides/krillion-unlimited-and-packs
- https://krillion.game/
- https://krillion.cc/is-krillion-ai/
- https://divekrillion.com/faq
- https://divekrillion.com/how-to-play
- https://dailydivetrivia.com/answer-tiers
- https://dailygamesindex.com/games/krillion/how-to-play/
- https://puzzlefeed.gg/games/krillion/modes
- https://playkrilliongame.com/krillion-game-modes
- https://krilliongames.org/guides/how-to-play-krillion
- https://krillionio.com/why-was-my-answer-rejected/
- https://krillion-game.online/guides/words-and-language-guide
- https://playdaily.org/resources/stories/krillion-in-the-classroom
- https://www.wordhint.net/krillion-answers-today/
- https://answers.today/krillion
- https://peerlist.io/geekbing/project/krillion-hint
- https://peerlist.io/chaodit/project/krillion--play-and-explore-rareanswer
- https://play.google.com/store/apps/details?id=com.inowios.krillion&hl=en_US

**Comparable games**
- https://krilliondaily.com/games-like-krillion
- https://www.alldle.net/games-like/krillion
- https://en.wikipedia.org/wiki/Pointless
- https://www.denofgeek.com/?p=179093
- https://blog.computationalcomplexity.org/2024/10/family-feud-vs-pointless.html
- https://en.wikipedia.org/wiki/Immaculate_Grid
- https://dailycampus.com/2024/02/08/chriss-column-immaculate-grid-should-be-on-sports-fans-radar/

**Psychology**
- https://psychologytoday.com/us/blog/psychology-tomorrow/202201/why-is-wordle-so-popular
- https://www.cnbc.com/2022/02/15/bite-sized-fun-the-psychology-behind-your-sudden-wordle-obsession.html
- https://www.inc.com/jessica-stillman/wordle-psychology-pandemic-connection.html
- https://www.axios.com/2022/02/11/snapping-wordle-streak
- https://www.tomsguide.com/opinion/happy-first-birthday-wordle-heres-5-ways-you-should-improve
- https://pmc.ncbi.nlm.nih.gov/articles/PMC3566715
- https://discovermagazine.com/mind/slot-machine-near-misses-are-perfectly-tuned-to-stoke-the-addiction
- https://www.scientificamerican.com/blog/observations/almost-winning-is-just-as-exciting-for-problem-gamblers/
- https://link.springer.com/book/10.1007/978-1-4684-3659-4 (Snyder & Fromkin, *Uniqueness*)
- https://pmc.ncbi.nlm.nih.gov/articles/PMC10365434
