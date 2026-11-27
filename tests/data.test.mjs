// Validates the Outlier prompt/answer database (data/**).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROMPTS, CATEGORIES } from '../data/prompts.js';

function normalize(str) {
  let s = String(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  s = s.replace(/^(the|a|an) /, '');
  if (s.length > 3) s = s.replace(/s$/, '');
  return s;
}

const tierChecks = [
  ['crowd (>=50)', (p) => p >= 50],
  ['common (25-49)', (p) => p >= 25 && p <= 49],
  ['uncommon (10-24)', (p) => p >= 10 && p <= 24],
  ['rare (4-9)', (p) => p >= 4 && p <= 9],
  ['obscure (<=3)', (p) => p <= 3],
];

test('exports PROMPTS and CATEGORIES arrays', () => {
  assert.ok(Array.isArray(PROMPTS));
  assert.ok(Array.isArray(CATEGORIES));
  assert.ok(CATEGORIES.length >= 10, 'at least 10 categories');
  assert.equal(new Set(CATEGORIES).size, CATEGORIES.length, 'categories unique');
});

test('at least 160 prompts', () => {
  assert.ok(PROMPTS.length >= 160, `only ${PROMPTS.length} prompts`);
});

test('prompt ids are unique and kebab-case', () => {
  const seen = new Set();
  for (const p of PROMPTS) {
    assert.match(p.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, `bad id ${p.id}`);
    assert.ok(!seen.has(p.id), `duplicate id ${p.id}`);
    seen.add(p.id);
  }
});

test('every category is used', () => {
  const used = new Set(PROMPTS.map((p) => p.category));
  for (const c of CATEGORIES) assert.ok(used.has(c), `unused category ${c}`);
});

for (const p of PROMPTS) {
  test(`prompt ${p.id}`, () => {
    assert.equal(typeof p.prompt, 'string');
    assert.match(p.prompt, /^Name (a|an) /, `${p.id}: prompt should start "Name a/an"`);
    assert.ok(CATEGORIES.includes(p.category), `${p.id}: unknown category ${p.category}`);
    assert.ok(Array.isArray(p.answers), `${p.id}: answers array`);
    assert.ok(p.answers.length >= 40, `${p.id}: only ${p.answers.length} answers`);

    const names = new Map();
    const keys = new Map();
    for (const a of p.answers) {
      assert.ok(Array.isArray(a) && a.length >= 2, `${p.id}: malformed answer ${JSON.stringify(a)}`);
      const [name, pop, ...aliases] = a;
      assert.equal(typeof name, 'string', `${p.id}: name must be string`);
      assert.ok(name.trim().length > 0, `${p.id}: empty name`);
      assert.ok(Number.isInteger(pop) && pop >= 1 && pop <= 100, `${p.id}: bad pop for ${name}: ${pop}`);
      assert.ok(!names.has(name), `${p.id}: duplicate canonical name ${name}`);
      names.set(name, pop);
      for (const label of [name, ...aliases]) {
        assert.equal(typeof label, 'string', `${p.id}: alias of ${name} must be string`);
        const k = normalize(label);
        assert.ok(k.length > 0, `${p.id}: "${label}" normalizes to empty`);
        if (keys.has(k) && keys.get(k) !== name) {
          assert.fail(`${p.id}: "${label}" (${name}) collides with ${keys.get(k)} as "${k}"`);
        }
        keys.set(k, name);
      }
    }

    for (const [label, check] of tierChecks) {
      assert.ok(p.answers.some((a) => check(a[1])), `${p.id}: no answer in tier ${label}`);
    }

    assert.equal(typeof p.gem, 'string', `${p.id}: gem required`);
    assert.ok(names.has(p.gem), `${p.id}: gem "${p.gem}" not in answers`);
    assert.ok(names.get(p.gem) <= 3, `${p.id}: gem pop must be <= 3`);

    assert.ok(Array.isArray(p.decoys) && p.decoys.length <= 2, `${p.id}: decoys must be array of 0-2`);
    for (const d of p.decoys) {
      assert.ok(names.has(d), `${p.id}: decoy "${d}" not in answers`);
      assert.notEqual(d, p.gem, `${p.id}: decoy cannot be gem`);
    }
  });
}
