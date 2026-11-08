import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { extraRescuerNumber, loadDemoConfig, validateDemoConfig } from '../src/config.ts';
import { bearingDegrees, distanceMeters, offsetToLatLon, walkToward } from '../src/geo.ts';
import { mulberry32 } from '../src/rng.ts';

test('loads the committed demo site without changing its configured center', async () => {
  const raw = JSON.parse(await readFile(new URL('../demo-site.json', import.meta.url), 'utf8'));
  const config = loadDemoConfig();
  assert.deepEqual(config, raw);
  assert.equal(config.site.center_lat, 32.9861898);
  assert.equal(config.site.center_lon, -96.7516083);
});

test('validates required config shape and rejects invalid scale settings', () => {
  assert.throws(() => validateDemoConfig({ site: {} }), /site\.center_lat/);
  const raw = JSON.parse(JSON.stringify(loadDemoConfig()));
  raw.scale.min_spacing_m = -1;
  assert.throws(() => validateDemoConfig(raw), /scale\.min_spacing_m/);
});

test('numbers extra sim rescuers right after the named sim rescuers', () => {
  const config = loadDemoConfig();
  const named = config.rescuers.filter((rescuer) => !rescuer.real).length;
  assert.equal(extraRescuerNumber(config, 0), named + 1);
  assert.equal(extraRescuerNumber(config, config.extra_sim_rescuers - 1), named + config.extra_sim_rescuers);
});

test('keeps the demo houses the story depends on', () => {
  const config = loadDemoConfig();
  const house = (label: string) => config.houses.find((item) => item.label === label);
  assert.equal(house('house 3')?.demo_pile, true);
  assert.equal(house('house 4')?.view_blocked, true);
  assert.equal(config.family_report.house, 'house 4');
  for (const survivor of config.hidden_survivors) {
    const target = house(survivor.house);
    assert.ok(target, `${survivor.house} exists`);
    // The module puts a find in the nearest cell whose center is within cell_size_m (cellForPoint), so a person in
    // the front yard still belongs to their house as long as no other house's cell is nearer.
    const away = (item: { east_m: number; north_m: number }) => Math.hypot(survivor.east_m - item.east_m, survivor.north_m - item.north_m);
    assert.ok(away(target) <= config.cell_size_m, `${survivor.house} survivor is within its cell's reach`);
    for (const other of config.houses) if (other !== target) assert.ok(away(other) > away(target), `${survivor.house} survivor is nearer its own house than ${other.label}`);
  }
});

test('rejects a site name longer than the module accepts', () => {
  const raw = JSON.parse(JSON.stringify(loadDemoConfig()));
  raw.site.name = 'x'.repeat(41);
  assert.throws(() => validateDemoConfig(raw), /site\.name must be at most 40/);
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
