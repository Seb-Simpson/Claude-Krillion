import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalize, buildIndex, matchAnswer, damerauLevenshtein, singularize, mask, maskTokens,
} from '../js/engine/matcher.js';

// --- fixtures in the spec's data format -----------------------------------
const PASTA = {
  id: 'pasta-shapes',
  prompt: 'Name a pasta shape',
  category: 'Food & Drink',
  gem: 'Strozzapreti',
  decoys: ['Orecchiette'],
  answers: [
    ['Spaghetti', 88],
    ['Penne', 55],
    ['Macaroni', 60, 'elbow macaroni', 'elbows'],
    ['Fusilli', 30],
    ['Farfalle', 28, 'bow ties', 'bowtie pasta'],
    ['Orecchiette', 6, 'orechiette'],
    ['Strozzapreti', 1],
    ['Pappardelle', 8],
    ['Pici', 1],
    ['Ziti', 12],
  ],
};

const MISC = {
  id: 'misc',
  prompt: 'Misc fixture',
  category: 'Test',
  gem: 'Crème brûlée',
  decoys: [],
  answers: [
    ['Crème brûlée', 20],
    ['Tic-tac-toe', 30],
    ['Spider-Man', 40],
    ['Audrey Hepburn', 25],
    ['Cat', 70],
    ['Berry', 10],
    ['Potato', 15],
    ['Wolf', 12],
    ['Goose', 5],
    ['Movie', 5],
    ['Brussels sprouts', 9],
    ['The Beatles', 60],
    ['Simon & Garfunkel', 8],
    ['Rock and roll', 7],
    ['Glass', 3],
    ['Cactus', 4],
    ['Knife', 6],
    ['Peach', 6],
  ],
};

// Exploit fixture: two obscure answers at distance 1 from a common word.
const EXPLOIT = {
  id: 'exploit',
  prompt: 'Exploit fixture',
  category: 'Test',
  gem: 'Jamel',
  decoys: [],
  answers: [
    ['Jamel', 1],
    ['Jameo', 2],
    ['Janet', 30],
    ['Johnson', 3],
    ['Mitchell', 2],
    ['Michelle', 40],
  ],
};

const ok = (input, prompt, name) => {
  const r = matchAnswer(input, buildIndex(prompt));
  assert.equal(r.kind, 'accept', `"${input}" should be accepted as ${name}, got ${JSON.stringify(r)}`);
  assert.equal(r.answer.name, name);
  return r;
};
const kind = (input, prompt) => matchAnswer(input, buildIndex(prompt)).kind;

describe('normalize', () => {
  test('lowercases, strips accents, punctuation and articles', () => {
    assert.equal(normalize('  The   Beatles!! '), 'beatles');
    assert.equal(normalize('Crème Brûlée'), 'creme brulee');
    assert.equal(normalize('Simon & Garfunkel'), 'simon and garfunkel');
    assert.equal(normalize('Tic-Tac-Toe'), 'tic tac toe');
    assert.equal(normalize("Rock 'n' Roll"), 'rock n roll');
    assert.equal(normalize('A Tribe Called Quest'), 'tribe called quest');
    assert.equal(normalize('An Apple'), 'apple');
  });
  test('keeps a lone article-like word', () => {
    assert.equal(normalize('A'), 'a');
    assert.equal(normalize('The'), 'the');
  });
  test('handles nullish and non-string input', () => {
    assert.equal(normalize(null), '');
    assert.equal(normalize(undefined), '');
    assert.equal(normalize(42), '42');
  });
  test('handles special letters', () => {
    assert.equal(normalize('Straße'), 'strasse');
    assert.equal(normalize('Ærøskøbing'), 'aeroskobing');
  });
});

describe('singularize', () => {
  test('regular and irregular plurals', () => {
    for (const [pl, sg] of [['cats', 'cat'], ['berries', 'berry'], ['potatoes', 'potato'],
      ['wolves', 'wolf'], ['geese', 'goose'], ['mice', 'mouse'], ['peaches', 'peach'],
      ['boxes', 'box'], ['knives', 'knife'], ['children', 'child']]) {
      assert.equal(singularize(pl), singularize(sg), `${pl} ~ ${sg}`);
    }
  });
  test('does not mangle -ss / -us / -is words', () => {
    assert.equal(singularize('glass'), 'glass');
    assert.equal(singularize('cactus'), 'cactus');
    assert.equal(singularize('tennis'), 'tennis');
  });
});

describe('damerauLevenshtein', () => {
  test('basic distances', () => {
    assert.equal(damerauLevenshtein('kitten', 'sitting'), 3);
    assert.equal(damerauLevenshtein('abc', 'abc'), 0);
    assert.equal(damerauLevenshtein('', 'abc'), 3);
  });
  test('transposition counts as 1', () => {
    assert.equal(damerauLevenshtein('penne', 'pnene'), 1);
    assert.equal(damerauLevenshtein('ab', 'ba'), 1);
  });
  test('bounded variant returns > max when over', () => {
    assert.ok(damerauLevenshtein('spaghetti', 'zzzzzzzzz', 2) > 2);
  });
});

describe('matchAnswer: exact-ish', () => {
  test('exact and case-insensitive', () => {
    const r = ok('spaghetti', PASTA, 'Spaghetti');
    assert.equal(r.corrected, false);
    ok('SPAGHETTI', PASTA, 'Spaghetti');
  });
  test('alias maps to canonical name', () => {
    const r = ok('elbows', PASTA, 'Macaroni');
    assert.equal(r.corrected, true, 'canonical differs from typed text');
    ok('bow ties', PASTA, 'Farfalle');
    ok('bowtie', PASTA, 'Farfalle') ;
  });
  test('leading article', () => {
    ok('the spaghetti', PASTA, 'Spaghetti');
    ok('beatles', MISC, 'The Beatles');
    ok('The Beatles', MISC, 'The Beatles');
  });
  test('plural / singular folding', () => {
    ok('cats', MISC, 'Cat');
    ok('berries', MISC, 'Berry');
    ok('potatoes', MISC, 'Potato');
    ok('wolves', MISC, 'Wolf');
    ok('geese', MISC, 'Goose');
    ok('movies', MISC, 'Movie');
    ok('brussel sprout', MISC, 'Brussels sprouts');
    ok('glass', MISC, 'Glass');
    ok('knives', MISC, 'Knife');
    ok('peaches', MISC, 'Peach');
  });
  test('accents', () => {
    const r = ok('creme brulee', MISC, 'Crème brûlée');
    assert.equal(r.corrected, false);
  });
  test('punctuation / hyphen / space differences', () => {
    ok('tic tac toe', MISC, 'Tic-tac-toe');
    ok('tictactoe', MISC, 'Tic-tac-toe');
    ok('spider man', MISC, 'Spider-Man');
    ok('spiderman', MISC, 'Spider-Man');
    ok('Spider-Man!', MISC, 'Spider-Man');
  });
  test('& vs and', () => {
    ok('simon and garfunkel', MISC, 'Simon & Garfunkel');
    ok('rock & roll', MISC, 'Rock and roll');
  });
  test('token order for multi-word answers', () => {
    ok('Hepburn Audrey', MISC, 'Audrey Hepburn');
    ok('hepburn, audrey', MISC, 'Audrey Hepburn');
    assert.notEqual(kind('hepburn', MISC), 'accept', 'a single token is not enough');
    assert.notEqual(kind('audrey', MISC), 'accept');
  });
  test('empty / junk input', () => {
    assert.equal(kind('', PASTA), 'none');
    assert.equal(kind('   ', PASTA), 'none');
    assert.equal(kind('!!!', PASTA), 'none');
    assert.equal(kind('xylophone', PASTA), 'none');
  });
  test('accepts a raw prompt in place of an index', () => {
    assert.equal(matchAnswer('penne', PASTA).kind, 'accept');
  });
});

describe('matchAnswer: typo tolerance', () => {
  test('one typo accepted for length 4-7', () => {
    const r = ok('fusili', PASTA, 'Fusilli');
    assert.equal(r.corrected, true);
    ok('pnene', PASTA, 'Penne'); // transposition
    ok('ziti', PASTA, 'Ziti');
  });
  test('two typos accepted for length >= 8', () => {
    ok('spagheti', PASTA, 'Spaghetti');
    ok('spahgetti', PASTA, 'Spaghetti'); // transposition
    ok('strozapretti', PASTA, 'Strozzapreti');
    ok('papardele', PASTA, 'Pappardelle');
  });
  test('two typos NOT accepted for length 4-7', () => {
    assert.notEqual(kind('fusiil', PASTA), 'accept'); // fusilli -> 2 edits?
    assert.notEqual(kind('pnnee', PASTA), 'accept');
  });
  test('no typos for length <= 3', () => {
    assert.notEqual(kind('cot', MISC), 'accept');
    assert.notEqual(kind('ca', MISC), 'accept');
  });
  test('typo must keep the first letter', () => {
    assert.notEqual(kind('benne', PASTA), 'accept');
    assert.equal(kind('benne', PASTA), 'near');
    assert.notEqual(kind('lici', PASTA), 'accept');
  });
  test('ties between different answers are not auto-accepted (exploit guard)', () => {
    // "jame?" style: "james" is 1 edit from both Jamel and Jameo
    const r = matchAnswer('james', buildIndex(EXPLOIT));
    assert.equal(r.kind, 'near');
    assert.ok(['Jamel', 'Jameo'].includes(r.target.name));
    assert.equal(r.target.name, 'Jameo', 'tie resolves to the more popular target');
  });
  test('a clear single best still auto-accepts', () => {
    ok('jamell', EXPLOIT, 'Jamel');
    ok('micchelle', EXPLOIT, 'Michelle');
  });
  test('exact always beats a fuzzy neighbour', () => {
    ok('mitchell', EXPLOIT, 'Mitchell');
    ok('michelle', EXPLOIT, 'Michelle');
  });
  test('typo against a long alias is accepted, against a short alias only near', () => {
    ok('bowtie pastta', PASTA, 'Farfalle');
    ok('elbow macaronni', PASTA, 'Macaroni');
    const r = matchAnswer('elbowz', buildIndex(PASTA));
    assert.equal(r.kind, 'near');
    assert.equal(r.target.name, 'Macaroni');
  });
  test('short alias one edit from a common word is not accepted (alias trap)', () => {
    const bread = { id: 'b', answers: [['Barmbrack', 1, 'brack'], ['Bagel', 50]] };
    assert.notEqual(kind('black', bread), 'accept');
    ok('brack', bread, 'Barmbrack');
    ok('bagle', bread, 'Bagel');
  });
});

describe('matchAnswer: near misses', () => {
  test('returns near with target, distance and mask', () => {
    const r = matchAnswer('spgaheti', buildIndex(PASTA)); // 2 edits...
    assert.ok(['accept', 'near'].includes(r.kind));
    const n = matchAnswer('spogetty', buildIndex(PASTA));
    assert.equal(n.kind, 'near');
    assert.equal(n.target.name, 'Spaghetti');
    assert.ok(n.distance >= 3);
    assert.equal(typeof n.mask, 'string');
  });
  test('strong prefix is near', () => {
    const r = matchAnswer('pappard', buildIndex(PASTA));
    assert.equal(r.kind, 'near');
    assert.equal(r.target.name, 'Pappardelle');
  });
  test('short prefix is not near', () => {
    assert.equal(kind('pap', PASTA), 'none');
  });
  test('short garbage is none', () => {
    assert.equal(kind('x', PASTA), 'none');
    assert.equal(kind('dog', MISC), 'none');
  });
  test('three-letter answer one off is near, not accept', () => {
    assert.equal(kind('cst', MISC), 'near');
  });
  test('bare word of multi-word answer is near (be more specific)', () => {
    const r = matchAnswer('hepburn', buildIndex(MISC));
    assert.equal(r.kind, 'near');
    assert.equal(r.target.name, 'Audrey Hepburn');
    assert.equal(r.reason, 'partial');
  });
});

describe('mask', () => {
  test('reveals letters in the same position, others are _', () => {
    assert.equal(mask('spagetti', 'Spaghetti'), 'S P A G _ E T T I');
  });
  test('all wrong positions are hidden', () => {
    assert.equal(mask('zzzz', 'Pici'), '_ _ _ _');
  });
  test('word gaps are three spaces and hyphens stay visible', () => {
    assert.equal(mask('spidar man', 'Spider-Man'), 'S P I D _ R - M A N');
    assert.equal(mask('audrey hepbern', 'Audrey Hepburn'), 'A U D R E Y   H E P B _ R N');
  });
  test('accented target letters reveal in display form', () => {
    assert.equal(mask('creme brulee', 'Crème brûlée'), 'C R È M E   B R Û L É E');
  });
  test('right-anchored matches also reveal (dropped letter)', () => {
    // "spghetti" dropped the "a": left-anchored gives S P only, right-anchored gives the tail
    assert.equal(mask('spghetti', 'Spaghetti'), 'S P _ G H E T T I');
  });
  test('maskTokens gives a structured form', () => {
    const t = maskTokens('pena', 'Penne');
    assert.equal(t.length, 1);
    assert.deepEqual(t[0].map((c) => c.revealed), [true, true, true, true, false]);
  });
});

describe('performance', () => {
  test('200-answer prompt matches in under 5 ms on average', () => {
    const words = [];
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let i = 0; i < 200; i++) {
      const len = 4 + Math.floor(rnd() * 12);
      let w = '';
      for (let j = 0; j < len; j++) w += letters[Math.floor(rnd() * 26)];
      words.push([w, 1 + Math.floor(rnd() * 90), w + ' alias']);
    }
    const big = { id: 'big', prompt: 'big', category: 'T', gem: words[0][0], decoys: [], answers: words };
    const idx = buildIndex(big);
    const inputs = ['qwertyuiop', 'abcdefgh', words[5][0] + 'x', 'zz', 'hello world', words[100][0]];
    matchAnswer('warmup', idx);
    const N = 300;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) matchAnswer(inputs[i % inputs.length], idx);
    const per = (performance.now() - t0) / N;
    assert.ok(per < 5, `average ${per.toFixed(3)} ms`);
  });
  test('buildIndex is cached per prompt object', () => {
    assert.equal(buildIndex(PASTA), buildIndex(PASTA));
  });
});
