import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDealCode } from '../src/lib/dealcode.js';

test('codes have the requested length', () => {
  assert.equal(generateDealCode().length, 8);
  assert.equal(generateDealCode(12).length, 12);
});

test('codes avoid ambiguous characters', () => {
  for (let i = 0; i < 200; i += 1) {
    assert.doesNotMatch(generateDealCode(), /[01OlI]/);
  }
});

test('codes are unique in practice', () => {
  const seen = new Set(Array.from({ length: 1000 }, () => generateDealCode()));
  assert.equal(seen.size, 1000);
});
