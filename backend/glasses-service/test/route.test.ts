import { describe, it, expect } from 'vitest';
import { destinationPoint, distanceM } from '../src/geo.js';
import { loadSiteGeometry, containsPoint } from '../src/render/vector.js';
import { routeLength, streetRoute } from '../src/render/route.js';
import { frontDoor } from '../src/render/guide.js';

const geometry = loadSiteGeometry('site/worthing.geojson')!;
const target = geometry.buildings.find(building => building.target)!;
const door = frontDoor(target.ring, geometry.roads);

describe('street route on the Worthing St block', () => {
  it('walks Worthing St to the curb in front of 7716 without crossing any house', () => {
    const start = destinationPoint({ lat: 32.99681, lon: -96.7705 }, 292, 64);
    const path = streetRoute(geometry, start, door);
    expect(path.length).toBeGreaterThan(1);
    for (let i = 1; i < path.length; i += 1) {
      for (let k = 0; k <= 10; k += 1) {
        const t = k / 10, a = path[i - 1]!, b = path[i]!;
        const point = { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
        expect(geometry.buildings.some(building => containsPoint(building.ring, point))).toBe(false);
      }
    }
    // The route ends at the street in front of the house: the door is across the front yard, not behind other houses.
    expect(distanceM(path.at(-1)!, door)).toBeLessThan(20);
    expect(distanceM({ lat: door.lat, lon: path.at(-1)!.lon }, door)).toBeLessThan(3);
    expect(routeLength(path)).toBeLessThan(90);
  });

  it('goes around the block from Benchmark Dr instead of through the houses between', () => {
    const start = { lat: 32.99630, lon: -96.77050 }; // Benchmark Dr, behind 7716
    const path = streetRoute(geometry, start, door);
    expect(routeLength(path)).toBeGreaterThan(distanceM(start, door) * 2);
  });
});
