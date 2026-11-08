// Builds site-lots.json: every OpenStreetMap building footprint inside the site radius, as meter offsets from the
// site center, so scale survivors sit inside real buildings instead of streets or the pond.
// Usage: npm run lots -- [path to context.geojson]  (default: the dashboard's site context file)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadDemoConfig } from '../src/config.ts';

interface Feature { properties: { k?: string }; geometry: { type: string; coordinates: number[][][] } }

const source = process.argv[2] ?? fileURLToPath(new URL('../../../frontend/dashboard/public/site/context.geojson', import.meta.url));
const target = fileURLToPath(new URL('../site-lots.json', import.meta.url));
const config = loadDemoConfig();
const { center_lat: lat0, center_lon: lon0, radius_m } = config.site;
const eastPerDegree = 111_320 * Math.cos((lat0 * Math.PI) / 180);
const round = (value: number) => Math.round(value * 10) / 10;
const cell = config.cell_size_m;
const ringDistance = (x: number, y: number, ring: Array<[number, number]>) => {
  let best = Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    const [ax, ay] = ring[i]!, [bx, by] = ring[(i + 1) % ring.length]!;
    const dx = bx - ax, dy = by - ay;
    const t = dx || dy ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx - x, ay + t * dy - y));
  }
  return best;
};
const inside = (x: number, y: number, ring: Array<[number, number]>) => {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) result = !result;
  }
  return result;
};

const features = (JSON.parse(readFileSync(source, 'utf8')) as { features: Feature[] }).features;
const lots = [];
for (const feature of features) {
  if (feature.properties.k !== 'b' || feature.geometry.type !== 'Polygon') continue;
  const ring = feature.geometry.coordinates[0]!.slice(0, -1).map(([lon, lat]) => [round((lon! - lon0) * eastPerDegree), round((lat! - lat0) * 111_320)] as [number, number]);
  if (ring.length < 3) continue;
  // The demo's named buildings (config.houses) have their own cells and story, so no scale or scene survivor goes
  // into them: skip any building that holds a house point or has one within a cell of its outline (the house 3
  // cell sits in the front plaza of 2520 Rutford Ave, outside the walls).
  if (config.houses.some((house) => inside(house.east_m, house.north_m, ring) || ringDistance(house.east_m, house.north_m, ring) <= cell)) continue;
  // One lot per search cell the building covers: a 15 m grid over its footprint, keeping the points inside it, so a
  // large campus building is several searchable cells and every lot's center is inside its building (a courtyard or
  // L-shaped building's centroid may not be). A building smaller than one cell keeps a single lot at an inside point.
  const xs = ring.map((point) => point[0]), ys = ring.map((point) => point[1]);
  const points: Array<[number, number]> = [];
  for (let x = Math.min(...xs) + cell / 2; x < Math.max(...xs); x += cell) {
    for (let y = Math.min(...ys) + cell / 2; y < Math.max(...ys); y += cell) if (inside(x, y, ring)) points.push([round(x), round(y)]);
  }
  if (!points.length) {
    const centroid: [number, number] = [round(xs.reduce((sum, x) => sum + x, 0) / xs.length), round(ys.reduce((sum, y) => sum + y, 0) / ys.length)];
    points.push(inside(centroid[0], centroid[1], ring) ? centroid : ring.reduce((best, point) => (Math.hypot(point[0] - centroid[0], point[1] - centroid[1]) < Math.hypot(best[0] - centroid[0], best[1] - centroid[1]) ? point : best)));
  }
  for (const [east_m, north_m] of points) if (Math.hypot(east_m, north_m) <= radius_m) lots.push({ east_m, north_m, ring });
}
lots.sort((a, b) => b.north_m - a.north_m || a.east_m - b.east_m);
writeFileSync(target, `${JSON.stringify({ source: 'OpenStreetMap contributors (ODbL)', center: { lat: lat0, lon: lon0 }, lots })}\n`);
console.log(`Wrote ${lots.length} building lots to ${target}`);

// The road graph comes from the same context file (same optional path argument).
await import('./build-roads.ts');
