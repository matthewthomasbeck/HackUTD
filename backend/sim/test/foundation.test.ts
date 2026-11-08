import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { loadDemoConfig, validateDemoConfig } from '../src/config.ts';
import { bearingDegrees, distanceMeters, offsetToLatLon, walkToward } from '../src/geo.ts';
import { mulberry32 } from '../src/rng.ts';

test('loads the committed demo site without changing its configured center', async () => {
  const raw = JSON.parse(await readFile(new URL('../demo-site.json', import.meta.url), 'utf8'));
  const config = loadDemoConfig();
  assert.deepEqual(config, raw);
  assert.equal(config.site.center_lat, 32.9857);
  assert.equal(config.site.center_lon, -96.7502);
});

test('validates required config shape and rejects invalid scale settings', () => {
  assert.throws(() => validateDemoConfig({ site: {} }), /site\.center_lat/);
  const raw = JSON.parse(JSON.stringify(loadDemoConfig()));
  raw.scale.min_spacing_m = -1;
  assert.throws(() => validateDemoConfig(raw), /scale\.min_spacing_m/);
});

test('converts north and east offsets using the documented local approximation', () => {
  const point = offsetToLatLon({ lat: 32.9857, lon: -96.7502 }, { east_m: 0, north_m: 140 });
  assert.equal(point.lat, 32.9857 + 140 / 111320);
  assert.equal(point.lon, -96.7502);
});

test('computes distance, clockwise bearing, and a bounded step toward a target', () => {
  const north = offsetToLatLon({ lat: 0, lon: 0 }, { east_m: 0, north_m: 10 });
  assert.ok(Math.abs(distanceMeters({ lat: 0, lon: 0 }, north) - 10) < 0.05);
  assert.equal(bearingDegrees({ lat: 0, lon: 0 }, north), 0);
  const step = walkToward({ lat: 0, lon: 0 }, north, 4);
  assert.ok(Math.abs(distanceMeters({ lat: 0, lon: 0 }, step) - 4) < 0.05);
  assert.deepEqual(walkToward(north, { lat: 0, lon: 0 }, 20), { lat: 0, lon: 0 });
});

test('mulberry32 is deterministic for the same seed', () => {
  const first = mulberry32(7);
  const second = mulberry32(7);
  assert.deepEqual(Array.from({ length: 5 }, first), Array.from({ length: 5 }, second));
  assert.ok(Array.from({ length: 5 }, mulberry32(7)).every((value) => value >= 0 && value < 1));
});
