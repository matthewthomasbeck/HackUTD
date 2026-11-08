import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadDemoConfig } from '../src/config.ts';
import { distanceMeters, offsetToLatLon } from '../src/geo.ts';
import { planScaleSurvivors } from '../src/scale.ts';

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
