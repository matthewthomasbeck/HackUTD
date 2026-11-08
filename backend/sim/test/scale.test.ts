import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadDemoConfig } from '../src/config.ts';
import { distanceMeters, insideRing, offsetToLatLon } from '../src/geo.ts';
import { planScaleSurvivors } from '../src/scale.ts';
import { generateScaleLots } from '../src/setup.ts';

test('seeded scale plan is repeatable and keeps survivors at least 12 m apart', () => {
  const config = loadDemoConfig();
  const first = planScaleSurvivors(config, 300);
  const second = planScaleSurvivors(config, 300);
  assert.deepEqual(first, second);
  assert.equal(first.length, 300);
  const center = { lat: config.site.center_lat, lon: config.site.center_lon };
  const points = first.map((item) => offsetToLatLon(center, item));
  for (let left = 0; left < points.length; left += 1) {
    for (let right = left + 1; right < points.length; right += 1) {
      assert.ok(distanceMeters(points[left]!, points[right]!) >= config.scale.min_spacing_m - 0.05);
    }
  }
  assert.ok(first.filter((item) => item.level === 'immediate').length < 90);
  assert.ok(first.every((item) => item.level === 'unknown' ? item.score === undefined : item.score! < 90));
});

test('scale lots are real buildings and every scale survivor sits inside its building', () => {
  const config = loadDemoConfig();
  const lots = generateScaleLots(config);
  assert.ok(lots.length > 200);
  for (const lot of lots) {
    assert.ok(Math.hypot(lot.east_m, lot.north_m) <= config.site.radius_m);
    assert.ok(config.houses.every((house) => Math.hypot(lot.east_m - house.east_m, lot.north_m - house.north_m) >= config.scale_lots.exclude_within_m));
  }
  const byLabel = new Map(lots.map((lot) => [lot.label, lot]));
  for (const survivor of planScaleSurvivors(config, 300)) {
    assert.ok(insideRing(survivor.east_m, survivor.north_m, byLabel.get(survivor.lot)!.ring), `${survivor.lot} survivor is inside its footprint`);
    const lot = byLabel.get(survivor.lot)!;
    assert.ok(Math.abs(survivor.east_m - lot.east_m) <= config.cell_size_m / 2 && Math.abs(survivor.north_m - lot.north_m) <= config.cell_size_m / 2, `${survivor.lot} survivor is inside its search cell`);
  }
});
