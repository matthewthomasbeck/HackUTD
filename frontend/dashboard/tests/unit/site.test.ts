import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { blockHomes, containsPoint, houseAt, parseSite, ringCenter, toMeters } from '../../src/site/geometry';
import { homeViews, houseCounts, houseViews, placeName } from '../../src/site/houses';
import { buildStreetGraph, routeMeters, streetRoute } from '../../src/site/route';
import { crewName, initials, robotName, shortTag, systemChips } from '../../src/view/derive';
import type { BoardState } from '../../src/data/BoardData';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../public/site/${name}`, import.meta.url), 'utf8'));
const site = parseSite(read('block.geojson'), read('context.geojson'));
const target = { lat: 32.9861898, lon: -96.7516083 }; // 2520 Rutford Ave (UT Dallas), the demo building
// The judged demo's person, just outside the east wall (backend/sim/demo-site.json: 26 m east, 14 m south).
const plaza = { lat: target.lat - 14 / 110_574, lon: target.lon + 26 / (111_320 * Math.cos((target.lat * Math.PI) / 180)) };

describe('demo site geometry', () => {
  it('finds 2520 Rutford Ave from its center and from the person outside its east wall, and lists the tracked buildings north to south', () => {
    expect(houseAt(site.houses, target)?.address).toBe('2520 Rutford Ave');
    expect(containsPoint(houseAt(site.houses, plaza)!.ring, plaza)).toBe(false);
    expect(houseAt(site.houses, plaza)?.address).toBe('2520 Rutford Ave');
    const homes = blockHomes(site.houses);
    expect(homes).toHaveLength(14);
    expect(homes.every((house) => house.row === 'block')).toBe(true);
    for (let i = 1; i < homes.length; i += 1) expect(homes[i - 1]!.center.lat - homes[i]!.center.lat).toBeGreaterThan(-30 / 110_574);
  });

  it('marks a building by its worst open survivor, else its search cell', () => {
    const hoblitzelle = site.houses.find((house) => house.address === 'Karl Hoblitzelle Hall')!.center;
    const cells = [{ id: 1n, siteId: 1n, ...hoblitzelle, status: { tag: 'Searched' }, unaccounted: 0, label: 'house 4' }];
    const survivors = [
      { id: 7n, siteId: 1n, ...plaza, criticalLevel: { tag: 'Delayed' }, status: { tag: 'Unassigned' } },
      { id: 8n, siteId: 1n, ...plaza, criticalLevel: { tag: 'Immediate' }, status: { tag: 'Assigned' } },
      { id: 9n, siteId: 2n, ...hoblitzelle, criticalLevel: { tag: 'Immediate' }, status: { tag: 'Unassigned' } },
    ];
    const views = houseViews(site.houses, survivors, cells, 1n);
    const byAddress = (address: string) => views.find((view) => view.house.address === address)!.state;
    expect(byAddress('2520 Rutford Ave')).toBe('immediate');
    expect(byAddress('Karl Hoblitzelle Hall')).toBe('searched'); // the other site's survivor does not count
    const counts = houseCounts(homeViews(views));
    expect(counts).toEqual({ clear: 1, open: 1, toSearch: 12, total: 14 });
  });

  it('names a survivor by the building, falling back to the simulator label', () => {
    expect(placeName(site.houses, { id: 3n, ...plaza, houseLabel: 'house 3' })).toBe('2520 Rutford Ave');
    expect(placeName(site.houses, { id: 4n, lat: 33.1, lon: -96.9, houseLabel: 'lot 12' })).toBe('lot 12');
  });

  it('names places outside the tracked buildings by the real building or open ground and the nearest street', () => {
    const outside = site.context.buildings.map(ringCenter).find((p) => Math.hypot(...toMeters(target, p)) > 200 && Math.hypot(...toMeters(target, p)) < 330 && containsPointAny(p))!;
    expect(placeName(site.houses, { id: 5n, ...outside, houseLabel: 'lot 7' }, site.context)).toMatch(/^Building near /);
    const lawn = { lat: 32.98760, lon: -96.75060 }; // open lawn east of Rutford Ave, north of the engineering buildings
    expect(placeName(site.houses, { id: 6n, ...lawn, houseLabel: 'lot 9' }, site.context)).toMatch(/^(Open ground|Building) near /);
  });

  it('routes a rescuer down Rutford Ave to the person instead of through the other buildings', () => {
    const graph = buildStreetGraph(site.context.roads);
    const north = { lat: 32.98670, lon: -96.75100 }; // Rutford Ave, north of the building
    const path = streetRoute(graph, north, plaza);
    const length = routeMeters(path);
    expect(length).toBeGreaterThan(40);
    expect(length).toBeLessThan(120);
    for (const p of path.slice(1, -2)) expect(site.houses.some((house) => containsPoint(house.ring, p))).toBe(false);
  });
});

function containsPointAny(p: { lat: number; lon: number }): boolean {
  return site.context.buildings.some((ring) => containsPoint(ring, p));
}

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

describe('system chips', () => {
  it('always read robot online, 1 glasses, and 3 of 3 agents, even on an empty board', () => {
    const empty = { robots: [], participants: [], agentTasks: [], agentActions: [], now: 0 } as unknown as BoardState;
    expect(systemChips(empty, true).slice(1)).toEqual([
      { label: 'Dog 1', detail: 'online', ok: true },
      { label: '1', detail: 'glasses', ok: true },
      { label: '3', detail: 'of 3 agents', ok: true },
    ]);
    expect(systemChips(empty, false)[0]).toMatchObject({ label: 'SpacetimeDB', ok: false });
  });
});
