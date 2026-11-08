import { describe, expect, it } from 'vitest';
import { boundsForSquare, haversineMeters } from '../../src/model/geo';

describe('map geometry', () => {
  it('makes a cell close to its configured size near latitude 33', () => {
    const bounds = boundsForSquare({ lat: 33, lon: -96 }, 30);
    const northSouth = haversineMeters({ lat: bounds.south, lon: -96 }, { lat: bounds.north, lon: -96 });
    const eastWest = haversineMeters({ lat: 33, lon: bounds.west }, { lat: 33, lon: bounds.east });
    expect(northSouth).toBeCloseTo(30, 0);
    expect(eastWest).toBeCloseTo(30, 0);
  });
});
