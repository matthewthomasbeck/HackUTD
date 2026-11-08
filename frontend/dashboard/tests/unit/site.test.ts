import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { blockHomes, containsPoint, houseAt, parseSite, ringCenter, toMeters } from '../../src/site/geometry';
import { homeViews, houseCounts, houseViews, placeName } from '../../src/site/houses';
import { buildStreetGraph, routeMeters, streetRoute } from '../../src/site/route';
import { crewName, initials, robotName, shortTag } from '../../src/view/derive';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../public/site/${name}`, import.meta.url), 'utf8'));
const site = parseSite(read('block.geojson'), read('context.geojson'));
const target = { lat: 32.9968745, lon: -96.7704708 }; // 7716 Worthing St, the demo house

describe('demo site geometry', () => {
  it('finds 7716 Worthing St from its GPS point and lists the 68 homes in reading order', () => {
    expect(houseAt(site.houses, target)?.address).toBe('7716 Worthing St');
    // The judged demo's person lies in the front yard, 13 m north of center (backend/sim/demo-site.json), outside the outline.
    const frontYard = { lat: target.lat + 13 / 110_574, lon: target.lon + 1 / (111_320 * Math.cos((target.lat * Math.PI) / 180)) };
    expect(containsPoint(houseAt(site.houses, frontYard)!.ring, frontYard)).toBe(false);
    expect(houseAt(site.houses, frontYard)?.address).toBe('7716 Worthing St');
    const homes = blockHomes(site.houses);
    expect(homes).toHaveLength(68);
    expect(homes[0]!.row).toBe('worthing_north');
    expect(homes.at(-1)!.row).toBe('worthing_east_segment');
  });

  it('marks a house by its worst open survivor, else its search cell', () => {
    const cells = [{ id: 1n, siteId: 1n, lat: target.lat, lon: target.lon - 0.0002, status: { tag: 'Searched' }, unaccounted: 0, label: 'house 2' }];
    const survivors = [
      { id: 7n, siteId: 1n, ...target, criticalLevel: { tag: 'Delayed' }, status: { tag: 'Unassigned' } },
      { id: 8n, siteId: 1n, ...target, criticalLevel: { tag: 'Immediate' }, status: { tag: 'Assigned' } },
      { id: 9n, siteId: 2n, lat: target.lat, lon: target.lon - 0.0002, criticalLevel: { tag: 'Immediate' }, status: { tag: 'Unassigned' } },
    ];
    const views = houseViews(site.houses, survivors, cells, 1n);
    const byAddress = (address: string) => views.find((view) => view.house.address === address)!.state;
    expect(byAddress('7716 Worthing St')).toBe('immediate');
    expect(byAddress('7712 Worthing St')).toBe('searched'); // the other site's survivor does not count
    const counts = houseCounts(homeViews(views));
    expect(counts).toEqual({ clear: 1, open: 1, toSearch: 66, total: 68 });
  });

  it('names a survivor by street address, falling back to the simulator label', () => {
    expect(placeName(site.houses, { id: 3n, ...target, houseLabel: 'house 3' })).toBe('7716 Worthing St');
    expect(placeName(site.houses, { id: 4n, lat: 33.1, lon: -96.9, houseLabel: 'lot 12' })).toBe('lot 12');
  });

  it('names places outside the block by the real building or open ground and the nearest street', () => {
    const outside = site.context.buildings.map(ringCenter).find((p) => Math.hypot(...toMeters(target, p)) > 150 && Math.hypot(...toMeters(target, p)) < 300)!;
    expect(placeName(site.houses, { id: 5n, ...outside, houseLabel: 'lot 7' }, site.context)).toMatch(/^Building near /);
    const pond = ringCenter(site.context.water[0]!);
    expect(placeName(site.houses, { id: 6n, ...pond, houseLabel: 'lot 9' }, site.context)).toMatch(/^Open ground near /);
  });

  it('routes a rescuer down Worthing St to the house instead of through other houses', () => {
    const graph = buildStreetGraph(site.context.roads);
    const corner = { lat: 32.99709, lon: -96.77111 }; // Bardsley Wy at Worthing St
    const front = { lat: 32.99694, lon: -96.77047 }; // the yard in front of 7716
    const path = streetRoute(graph, corner, front);
    const length = routeMeters(path);
    expect(length).toBeGreaterThan(55);
    expect(length).toBeLessThan(90);
    const homes = blockHomes(site.houses);
    for (const p of path.slice(1, -1)) expect(homes.some((house) => containsPoint(house.ring, p))).toBe(false);
  });
});

describe('people avatars', () => {
  it('uses letters and numbers only', () => {
    expect(initials('Cayden')).toBe('C');
    expect(initials('R25 (sim)')).toBe('R25');
    expect(initials('Ana Ruiz')).toBe('AR');
  });
});

describe('crew names', () => {
  it('drops simulator markers', () => {
    expect(crewName('R1 (sim)')).toBe('R1');
    expect(crewName('Cayden')).toBe('Cayden');
    expect(crewName('cayden')).toBe('Cayden');
    expect(robotName({ robotId: 'sim-dog' })).toBe('Dog 1');
    expect(robotName({ robotId: 'sim-dog-2', name: 'sim-dog-2' })).toBe('Dog 2');
    expect(robotName({ robotId: 'dog1' })).toBe('Dog 1');
  });
});

describe('survivor map tags', () => {
  it('uses the house number in the block, else the street', () => {
    expect(shortTag('17826 Benchmark Dr')).toBe('17826');
    expect(shortTag('Building near Frankford Rd')).toBe('Frankford Rd');
    expect(shortTag('Open ground near Coit Rd')).toBe('Coit Rd');
  });
});
