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

const features = (JSON.parse(readFileSync(source, 'utf8')) as { features: Feature[] }).features;
const lots = [];
for (const feature of features) {
  if (feature.properties.k !== 'b' || feature.geometry.type !== 'Polygon') continue;
  const ring = feature.geometry.coordinates[0]!.slice(0, -1).map(([lon, lat]) => [round((lon! - lon0) * eastPerDegree), round((lat! - lat0) * 111_320)] as [number, number]);
  if (ring.length < 3) continue;
  const east_m = round(ring.reduce((sum, point) => sum + point[0], 0) / ring.length);
  const north_m = round(ring.reduce((sum, point) => sum + point[1], 0) / ring.length);
  if (Math.hypot(east_m, north_m) > radius_m) continue;
  lots.push({ east_m, north_m, ring });
}
lots.sort((a, b) => b.north_m - a.north_m || a.east_m - b.east_m);
writeFileSync(target, `${JSON.stringify({ source: 'OpenStreetMap contributors (ODbL)', center: { lat: lat0, lon: lon0 }, lots })}\n`);
console.log(`Wrote ${lots.length} building lots to ${target}`);

// The road graph comes from the same context file (same optional path argument).
await import('./build-roads.ts');
