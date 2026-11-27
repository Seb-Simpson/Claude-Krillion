// Outlier — answer matcher ("autocorrect without giving the answer away").
//
// Pure ES module, no DOM. Matching pipeline for a player's input against one prompt:
//   1. exact      — normalized, space-insensitive compare against canonical names, then aliases
//   2. plural     — singular/plural folding (per token and whole-string)
//   3. order      — token-order-insensitive compare for multi-word answers (all tokens must match)
//   4. typo       — Damerau-Levenshtein (OSA) with length-scaled tolerance, same first letter,
//                   unique best candidate only (ties are refused → near)
//   5. near       — close but not confident: partial (a whole word of a multi-word answer),
//                   distance within ~35% of target length, or a strong prefix
//
// Fuzzy matching is only ever against WHOLE names and explicit aliases (never first words or
// substrings) — this closes the "type a common first name, get upgraded to an obscure answer"
// exploit described in docs/research.md §4 / §12.3.

const ARTICLES = new Set(['the', 'a', 'an']);

// Letters NFD does not decompose.
const SPECIAL_LETTERS = {
  'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ø': 'o', 'ł': 'l', 'đ': 'd', 'ð': 'd', 'þ': 'th', 'ı': 'i',
};
const SPECIAL_RE = /[ßæœøłđðþı]/g;

/**
 * Normalize: lowercase, strip accents/diacritics, '&' -> 'and', drop apostrophes,
 * other punctuation -> space, collapse whitespace, strip a leading article (the/a/an)
 * when more words follow.
 */
export function normalize(str, { keepArticle = false } = {}) {
  if (str === null || str === undefined) return '';
  let s = String(str).toLowerCase();
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  s = s.replace(SPECIAL_RE, (c) => SPECIAL_LETTERS[c]);
  s = s.replace(/&/g, ' and ');
  // Keep programming-language names distinct: "C++" / "C#" must not collapse to "C".
  s = s.replace(/\+\+/g, ' plus plus ').replace(/(^|[^a-z0-9])([a-z])#/g, '$1$2 sharp');
  s = s.replace(/['’‘`´]/g, '');
  s = s.replace(/[^a-z0-9]+/g, ' ').trim();
  if (!s) return '';
  if (!keepArticle) {
    const sp = s.indexOf(' ');
    if (sp > 0 && ARTICLES.has(s.slice(0, sp))) s = s.slice(sp + 1);
  }
  return s;
}

const IRREGULAR = {
  geese: 'goose', mice: 'mouse', lice: 'louse', children: 'child', men: 'man', women: 'woman',
  teeth: 'tooth', feet: 'foot', people: 'person', oxen: 'ox', cacti: 'cactus', fungi: 'fungus',
  octopi: 'octopus', alumni: 'alumnus', dice: 'die', criteria: 'criterion', phenomena: 'phenomenon',
};
// Map singulars of the irregulars to themselves so both sides fold to the same key.
const IRREGULAR_KEYS = new Set(Object.values(IRREGULAR));

/**
 * Fold a single word to a singular-ish key. It is a *folding* function, not a dictionary
 * singularizer: the only guarantee is that a singular and its regular plural map to the
 * same key (e.g. "movie" and "movies" both -> "movy", "knife"/"knives" -> "knif").
 */
export function singularize(word) {
  const w = String(word || '');
  if (IRREGULAR[w]) return IRREGULAR[w];
  if (IRREGULAR_KEYS.has(w)) return w;
  const n = w.length;
  if (n <= 3) return w;
  if (n >= 5 && w.endsWith('men')) return w.slice(0, -3) + 'man';
  if (n >= 5 && w.endsWith('ies')) return w.slice(0, -3) + 'y'; // berries, movies
  if (w.endsWith('ie')) return w.slice(0, -2) + 'y'; // movie -> movy (pairs with movies)
  if (w.endsWith('ves')) return w.slice(0, -3) + 'f'; // wolves, knives, olives
  if (w.endsWith('fe')) return w.slice(0, -2) + 'f'; // knife
  if (w.endsWith('ve')) return w.slice(0, -2) + 'f'; // olive (pairs with olives)
  if (n >= 5 && w.endsWith('oes')) return w.slice(0, -2); // potatoes, shoes
  if (w.endsWith('oe')) return w.slice(0, -1); // shoe (pairs with shoes)
  if (w.endsWith('sses')) return w.slice(0, -2); // glasses
  if (w.endsWith('ches') || w.endsWith('shes') || w.endsWith('xes') || w.endsWith('zzes')) {
    return w.slice(0, -2);
  }
  if (w.endsWith('che')) return w.slice(0, -1); // quiche (pairs with quiches)
  if (w.endsWith('ss') || w.endsWith('us') || w.endsWith('is')) return w;
  if (w.endsWith('s')) return w.slice(0, -1);
  return w;
}

/**
 * Optimal-string-alignment Damerau-Levenshtein distance (adjacent transposition = 1 edit).
 * With `max`, returns early with a value > max once the distance must exceed it.
 */
export function damerauLevenshtein(a, b, max = Infinity) {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (!la) return lb;
  if (!lb) return la;
  if (Math.abs(la - lb) > max) return max + 1;
  let prev2 = new Array(lb + 1);
  let prev = new Array(lb + 1);
  let cur = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let rowMin = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cb = b.charCodeAt(j - 1);
      const cost = ca === cb ? 0 : 1;
      let v = prev[j - 1] + cost;
      const del = prev[j] + 1;
      if (del < v) v = del;
      const ins = cur[j - 1] + 1;
      if (ins < v) v = ins;
      if (i > 1 && j > 1 && ca === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === cb) {
        const tr = prev2[j - 2] + 1;
        if (tr < v) v = tr;
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    const t = prev2;
    prev2 = prev;
    prev = cur;
    cur = t;
  }
  return prev[lb];
}

/** Edits allowed for an auto-accepted (corrected) typo, by target length (letters only). */
export function typoAllowance(len) {
  if (len <= 4) return 0; // 4-letter words are too often other real words ("book" vs "Bock")
  if (len <= 7) return 1;
  return 2;
}

/**
 * Allowance for a specific answer form. Short aliases (< 8 letters) must match exactly
 * (plural folding still applies): one typo away from a short nickname is too easy to hit by
 * accident ("sea donkey" vs "sea monkey"; "black" vs the bread alias "brack").
 */
function formAllowance(form) {
  if (form.isAlias && form.len < 8) return 0;
  return typoAllowance(form.len);
}

/** Max distance still treated as a near miss, by target length. */
export function nearThreshold(len) {
  if (len <= 4) return 1;
  return Math.max(2, Math.round(len * 0.35));
}

const indexCache = new WeakMap();

function makeForm(text, ai, isAlias) {
  const norm = normalize(text);
  const tokens = norm ? norm.split(' ') : [];
  const compact = tokens.join('');
  const stemTokens = tokens.map(singularize);
  return {
    ai,
    text: String(text),
    isAlias,
    norm,
    tokens,
    compact,
    stem: stemTokens.join(''),
    stemWhole: singularize(compact),
    sorted: tokens.length > 1 ? [...stemTokens].sort().join(' ') : null,
    len: compact.length,
    first: compact[0] || '',
  };
}

/**
 * Precompute normalized forms for a prompt's answers. Cached per prompt object.
 * Index: { prompt, answers:[{name,pop,aliases}], forms:[...], exact, stem, sorted, names }
 */
export function buildIndex(promptEntry) {
  if (promptEntry && promptEntry.__outlierIndex) return promptEntry;
  const cached = indexCache.get(promptEntry);
  if (cached) return cached;
  const raw = (promptEntry && promptEntry.answers) || [];
  const answers = raw.map((a) => {
    if (Array.isArray(a)) return { name: String(a[0]), pop: Number(a[1]) || 0, aliases: a.slice(2).map(String) };
    return { name: String(a.name), pop: Number(a.pop) || 0, aliases: (a.aliases || []).map(String) };
  });
  const forms = [];
  answers.forEach((a, ai) => forms.push(makeForm(a.name, ai, false)));
  answers.forEach((a, ai) => a.aliases.forEach((al) => forms.push(makeForm(al, ai, true))));
  const live = forms.filter((f) => f.compact);

  // First registration wins: canonical names were pushed before aliases.
  const exact = new Map();
  const stem = new Map();
  const sorted = new Map();
  const put = (map, key, f) => { if (key && !map.has(key)) map.set(key, f); };
  for (const f of live) put(exact, f.compact, f);
  for (const f of live) {
    put(stem, f.compact, f);
    put(stem, f.stem, f);
    put(stem, f.stemWhole, f);
  }
  for (const f of live) put(sorted, f.sorted, f);

  // Single-word tokens of multi-word forms, for "be more specific" near misses.
  const tokens = new Map();
  for (const f of live) {
    if (f.tokens.length < 2) continue;
    for (const t of f.tokens) {
      if (t.length < 4) continue;
      for (const k of [t, singularize(t)]) {
        const prev = tokens.get(k);
        if (!prev || answers[f.ai].pop > answers[prev.ai].pop) tokens.set(k, f);
      }
    }
  }

  const index = {
    __outlierIndex: true,
    prompt: promptEntry,
    answers,
    forms: live,
    exact,
    stem,
    sorted,
    tokens,
    nameCompact: answers.map((a) => normalize(a.name).replace(/ /g, '')),
  };
  if (promptEntry && typeof promptEntry === 'object') indexCache.set(promptEntry, index);
  return index;
}

function publicAnswer(index, ai) {
  const a = index.answers[ai];
  return { name: a.name, pop: a.pop };
}

function acceptResult(index, form, inCompact, via, distance = 0) {
  return {
    kind: 'accept',
    answer: publicAnswer(index, form.ai),
    corrected: inCompact !== index.nameCompact[form.ai],
    via,
    distance,
    form: form.text,
  };
}

function nearResult(index, form, input, distance, reason) {
  return {
    kind: 'near',
    target: publicAnswer(index, form.ai),
    distance,
    mask: mask(input, form.text),
    reason,
    form: form.text,
  };
}

const NONE = Object.freeze({ kind: 'none' });

/**
 * Match a player's input against a prompt (or a prebuilt index).
 * @returns {{kind:'accept',answer,corrected,via,distance,form}
 *          |{kind:'near',target,distance,mask,reason,form}
 *          |{kind:'none'}}
 *  via:    'exact' | 'alias' | 'plural' | 'order' | 'typo'
 *  reason: 'ambiguous' (tie between answers) | 'typo' | 'partial' | 'prefix'
 */
export function matchAnswer(input, indexOrPrompt) {
  const index = buildIndex(indexOrPrompt);
  const inNorm = normalize(input);
  if (!inNorm) return NONE;
  const inTokens = inNorm.split(' ');
  const inCompact = inTokens.join('');
  const inStemTokens = inTokens.map(singularize);
  const inStem = inStemTokens.join('');
  const inLen = inCompact.length;

  // 1. exact (space/punctuation/accents/article-insensitive)
  let f = index.exact.get(inCompact);
  if (f) return acceptResult(index, f, inCompact, f.isAlias ? 'alias' : 'exact');

  // 2. plural / singular folding
  for (const k of [inStem, singularize(inCompact)]) {
    f = index.stem.get(k);
    if (f) return acceptResult(index, f, inCompact, f.isAlias ? 'alias' : 'plural');
  }

  // 3. token order (every token must match)
  if (inTokens.length > 1) {
    f = index.sorted.get([...inStemTokens].sort().join(' '));
    if (f) return acceptResult(index, f, inCompact, 'order');
  }

  // 4. fuzzy: best distance per answer, plus the best form that is eligible for auto-accept
  //    (within its typo allowance and sharing the input's first letter).
  const best = new Map(); // ai -> {d, form, elig: {d, form} | null}
  let bestD = Infinity;
  const first = inCompact[0];
  for (const form of index.forms) {
    const thr = nearThreshold(form.len);
    if (Math.abs(form.len - inLen) > thr) continue;
    let d = damerauLevenshtein(inCompact, form.compact, thr);
    if (d > 0 && (inStem !== inCompact || form.stem !== form.compact)) {
      const d2 = damerauLevenshtein(inStem, form.stem, Math.min(d, thr));
      if (d2 < d) d = d2;
    }
    if (d > thr) continue;
    let entry = best.get(form.ai);
    if (!entry) { entry = { d, form, elig: null }; best.set(form.ai, entry); }
    else if (d < entry.d) { entry.d = d; entry.form = form; }
    if (d <= formAllowance(form) && form.first === first && (!entry.elig || d < entry.elig.d)) {
      entry.elig = { d, form };
    }
    if (d < bestD) bestD = d;
  }

  if (best.size) {
    const tied = [];
    for (const [ai, v] of best) if (v.d === bestD) tied.push({ ai, ...v });
    tied.sort((x, y) => index.answers[y.ai].pop - index.answers[x.ai].pop || x.ai - y.ai);
    const top = tied[0];
    if (tied.length === 1 && top.elig && inLen >= 4) {
      return acceptResult(index, top.elig.form, inCompact, 'typo', top.elig.d);
    }
    if (tied.length > 1 && bestD <= typoAllowance(top.form.len)) {
      return nearResult(index, top.form, input, bestD, 'ambiguous');
    }
  }

  // 5a. partial: a whole word of a multi-word answer → "be more specific"
  if (inTokens.length === 1 && inLen >= 4) {
    f = index.tokens.get(inCompact) || index.tokens.get(inStem);
    if (f) return nearResult(index, f, input, damerauLevenshtein(inCompact, f.compact), 'partial');
  }

  // 5b. near by distance
  if (best.size && inLen >= 2) {
    let pick = null;
    for (const [, v] of best) {
      if (v.d !== bestD) continue;
      if (!pick || index.answers[v.form.ai].pop > index.answers[pick.form.ai].pop) pick = v;
    }
    if (pick) return nearResult(index, pick.form, input, pick.d, 'typo');
  }

  // 5c. strong prefix
  if (inLen >= 4) {
    let pick = null;
    for (const form of index.forms) {
      if (form.len > inLen && inLen >= 0.6 * form.len && form.compact.startsWith(inCompact)) {
        if (!pick || index.answers[form.ai].pop > index.answers[pick.ai].pop) pick = form;
      }
    }
    if (pick) return nearResult(index, pick, input, pick.len - inLen, 'prefix');
  }

  return NONE;
}

// --- masks -----------------------------------------------------------------

function foldChar(ch) {
  let s = ch.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  s = s.replace(SPECIAL_RE, (c) => SPECIAL_LETTERS[c]);
  return /^[a-z0-9]+$/.test(s) ? s : '';
}

/**
 * Structured mask: array of words, each an array of {ch, revealed, letter}.
 * `ch` is the uppercase display character (accents kept); non-letters such as '-' or '&'
 * are always revealed (letter:false). A target letter is revealed when the input has the same
 * letter at the same position, counted either from the start or from the end of the word
 * sequence (letters only, so spaces/hyphens don't shift positions; anchoring at both ends
 * means one dropped letter doesn't hide everything after it).
 */
export function maskTokens(input, target) {
  const display = String(target || '');
  // Align leading articles so "beatles" vs "The Beatles" isn't shifted by 3.
  let inWords = normalize(input, { keepArticle: true }).split(' ').filter(Boolean);
  const tWords = normalize(display, { keepArticle: true }).split(' ').filter(Boolean);
  const tArt = tWords.length > 1 && ARTICLES.has(tWords[0]) ? tWords[0] : null;
  const iArt = inWords.length > 1 && ARTICLES.has(inWords[0]) ? inWords[0] : null;
  if (tArt && iArt !== tArt) inWords = [tArt, ...(iArt ? inWords.slice(1) : inWords)];
  else if (!tArt && iArt) inWords = inWords.slice(1);
  const inLetters = inWords.join('');

  // Build display cells.
  const words = [[]];
  const cells = [];
  for (const ch of display) {
    if (/\s/.test(ch)) {
      if (words[words.length - 1].length) words.push([]);
      continue;
    }
    const letter = foldChar(ch);
    const cell = { ch: ch.toUpperCase(), revealed: !letter, letter: !!letter, fold: letter };
    words[words.length - 1].push(cell);
    if (letter) cells.push(cell);
  }
  if (!words[words.length - 1].length) words.pop();

  // Letter positions (a cell may fold to 2 letters, e.g. ß -> ss).
  let total = 0;
  for (const c of cells) { c.pos = total; total += c.fold.length; }
  const offset = inLetters.length - total;
  for (const c of cells) {
    const L = inLetters.slice(c.pos, c.pos + c.fold.length);
    const R = c.pos + offset >= 0 ? inLetters.slice(c.pos + offset, c.pos + offset + c.fold.length) : '';
    if (L === c.fold || R === c.fold) c.revealed = true;
  }
  return words.map((w) => w.map(({ ch, revealed, letter }) => ({ ch, revealed, letter })));
}

/** Word separator used in mask strings: three spaces. Letters are separated by one space. */
export const MASK_WORD_GAP = '   ';

/**
 * Masked hint string, e.g. mask("spghetti", "Spaghetti") === "S P _ G H E T T I".
 * Letters uppercase and space-separated, hidden letters are '_', words separated by three
 * spaces (render with `white-space: pre`), hyphens and other punctuation shown as-is.
 */
export function mask(input, target) {
  return maskTokens(input, target)
    .map((w) => w.map((c) => (c.revealed ? c.ch : '_')).join(' '))
    .join(MASK_WORD_GAP);
}
