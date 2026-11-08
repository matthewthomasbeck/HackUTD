import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getNamedCoordinates } from '../src/coords.js';
import { loadDemoConfig } from '../src/config.js';

test('lists the named demo points as latitude and longitude', () => {
  const points = getNamedCoordinates(loadDemoConfig());
  const byLabel = new Map(points.map((point) => [point.label, point]));

  assert.deepEqual(byLabel.get('site center'), {
    label: 'site center',
    lat: 32.9861898,
    lon: -96.7516083,
  });
  assert.ok(byLabel.has('house 3'));
  assert.ok(byLabel.has('house 4'));
  assert.ok(byLabel.has('demo anchor: house 3 southeast door'));
  assert.ok(byLabel.has('robot: sim-dog'));
  assert.ok(byLabel.has('robot: sim-drone'));
  assert.ok(byLabel.has('rescuer: R1'));
  assert.ok(byLabel.has('survivor: house 4'));
});
