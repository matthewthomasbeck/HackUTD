import { describe, it, expect } from 'vitest';
import { destinationPoint, distanceM, type Point } from '../src/geo.js';
import { loadSiteGeometry, containsPoint, buildingAt } from '../src/render/vector.js';
import { routeLength, streetRoute } from '../src/render/route.js';
import { frontDoor } from '../src/render/guide.js';

const geometry = loadSiteGeometry('site/site.geojson')!;
const center = { lat: 32.9861898, lon: -96.7516083 }; // 2520 Rutford Ave, the site center
const person = { lat: 32.986064, lon: -96.7513299 }; // the demo person, outside the east wall, in the courtyard by Rutford Ave
const target = buildingAt(geometry, person)!;
const door = frontDoor(target.ring, geometry.roads);

// No stretch of the walk passes through a building.
function expectOutsideBuildings(path: Point[]): void {
  for (let i = 1; i < path.length; i += 1) {
    for (let k = 0; k <= 10; k += 1) {
      const t = k / 10, a = path[i - 1]!, b = path[i]!;
      const point = { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
      expect(geometry.buildings.some(building => containsPoint(building.ring, point))).toBe(false);
    }
  }
}

describe('walking routes on the UT Dallas site', () => {
  it('puts the demo person just outside 2520 Rutford Ave, which still names the place', () => {
    expect(target.target).toBe(true);
    expect(target.address).toBe('2520 Rutford Ave');
    expect(containsPoint(target.ring, person)).toBe(false);
  });

  it('walks from the parking lot to the person on paths, never through a building', () => {
    const start = destinationPoint(center, 158, 92); // the glasses demo start (npm run demo): the lot south of Franklyn Jenifer Dr
    const path = streetRoute(geometry, start, person);
    expect(path.length).toBeGreaterThan(1);
    expectOutsideBuildings([...path, person]);
    expect(routeLength([start, ...path, person])).toBeLessThan(140);
  });

  it('goes around the building from Franklyn Jenifer Dr instead of through it', () => {
    const start = { lat: 32.98566, lon: -96.7530 }; // Franklyn Jenifer Dr, southwest of the building
    const path = streetRoute(geometry, start, door);
    expectOutsideBuildings(path.slice(0, -1));
    expect(routeLength(path)).toBeGreaterThan(distanceM(start, door));
  });
});
