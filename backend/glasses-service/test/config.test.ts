import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('service configuration', () => {
  it('uses the documented 92 m demo start distance (the parking lot south of the building)', () => {
    const config = loadConfig({ FAKE_DB: '1' });
    expect(config.demoStartDistanceM).toBe(92);
    expect(config.demoStartBearingDeg).toBe(158);
    expect(config.demoSpeedMps).toBe(3);
  });

  it('accepts explicit demo walker settings', () => {
    const config = loadConfig({ FAKE_DB: '1', DEMO_START_DISTANCE_M: '180', DEMO_START_BEARING_DEG: '90', DEMO_SPEED_MPS: '2.5' });
    expect([config.demoStartDistanceM, config.demoStartBearingDeg, config.demoSpeedMps]).toEqual([180, 90, 2.5]);
  });
});
