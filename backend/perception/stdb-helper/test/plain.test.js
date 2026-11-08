// node --test: the contract shape the helper prints for SDK values.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { plain, isUnitValue } = require('../dist/index.js');

test('unit enum variants print as their contract tag', () => {
  // The SDK delivers unit variants with an empty object payload.
  assert.equal(plain({ tag: 'Thermal', value: {} }), 'thermal');
  assert.equal(plain({ tag: 'EnRoute', value: {} }), 'en_route');
  assert.equal(plain({ tag: 'NotDetected' }), 'not_detected');
  assert.equal(plain({ tag: 'PartiallySearched', value: {} }), 'partially_searched');
});

test('rows keep snake_case keys and plain values', () => {
  const row = plain({ survivorId: 3n, status: { tag: 'Unassigned', value: {} }, houseLabel: undefined, scoreReasons: ['a'] });
  assert.deepEqual(row, { survivor_id: 3, status: 'unassigned', house_label: null, score_reasons: ['a'] });
});

test('isUnitValue', () => {
  assert.equal(isUnitValue(undefined), true);
  assert.equal(isUnitValue({}), true);
  assert.equal(isUnitValue({ a: 1 }), false);
  assert.equal(isUnitValue([]), false);
});
