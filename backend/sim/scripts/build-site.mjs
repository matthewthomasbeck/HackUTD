// Builds the demo site's map files from OpenStreetMap (Overpass API), for every part that draws or walks the site:
//   frontend/dashboard/public/site/block.geojson    the buildings the dashboard tracks (search state, "Buildings nearby")
//   frontend/dashboard/public/site/context.geojson  everything around them: buildings, roads and paths, green, water
//   backend/glasses-service/site/site.geojson       the glasses' vector map and walking routes
// Then run `npm run lots` (and scripts/build-roads.ts) for the sim's building lots and street graph.
// Usage: node scripts/build-site.mjs [overpass.json]  (without a file it downloads the area; needs internet once)
//
// Site (Cayden, 2026-11-08): 2520 Rutford Ave, Richardson TX 75080, on the UT Dallas campus. Its engineering building,
// west of Rutford Avenue and north of Franklyn Jenifer Drive, is missing from OpenStreetMap, so its outline below was
// traced from the coordinator's Google Maps screenshot, georeferenced on Karl Hoblitzelle Hall (way/221345883: 38 m by
// 89 m in both) and the two streets (Rutford Avenue at lon -96.7510, Franklyn Jenifer Drive at lat 32.98566).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../../../', import.meta.url);
const out = (path) => fileURLToPath(new URL(path, ROOT));

// About 350 m around the building: the walk, the patrol, and the map all stay inside it.
const BOX = { south: 32.9830, west: -96.7555, north: 32.9893, east: -96.7470 };
const BLOCK_RADIUS_M = 180; // buildings this close to the target are the ones the dashboard tracks
const MIN_BLOCK_AREA_M2 = 60;

// Screenshot pixels to degrees: Hoblitzelle Hall spans x 742-915 (lon -96.75184 to -96.75143) and y 125-530
// (lat 32.98734 to 32.98655), so one pixel is 2.37e-6 degrees of longitude and 1.95e-6 of latitude.
const fromScreenshot = ([x, y]) => [round7(-96.75143 + (x - 915) * 2.37e-6), round7(32.98655 - (y - 530) * 1.95e-6)];
const TARGET_OUTLINE = [[536, 600], [712, 600], [712, 590], [908, 590], [908, 573], [1043, 573], [1043, 685], [995, 697], [940, 697], [940, 815],
  [995, 840], [1058, 840], [1058, 932], [712, 932], [590, 912], [590, 637], [536, 637]].map(fromScreenshot);
const TARGET = { id: 'manual/2520-rutford', address: '2520 Rutford Ave', name: 'Erik Jonsson School of Engineering (2520 Rutford Ave)' };

const WALKABLE = new Set(['secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'service', 'pedestrian', 'footway', 'path', 'cycleway']);
const DRAWN = new Set([...WALKABLE, 'primary', 'trunk', 'motorway', 'steps', 'secondary_link', 'tertiary_link']);

function round7(value) { return Math.round(value * 1e7) / 1e7; }

async function overpass() {
  const query = `[out:json][timeout:90];(way["building"](${BOX.south},${BOX.west},${BOX.north},${BOX.east});way["highway"](${BOX.south},${BOX.west},${BOX.north},${BOX.east});way["landuse"~"grass|recreation_ground|meadow"](${BOX.south},${BOX.west},${BOX.north},${BOX.east});way["leisure"~"park|pitch|garden"](${BOX.south},${BOX.west},${BOX.north},${BOX.east});way["natural"="water"](${BOX.south},${BOX.west},${BOX.north},${BOX.east}););out tags geom;`;
  // Overpass is often busy (502, 504, 429), so try a few times.
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: new URLSearchParams({ data: query }), headers: { 'user-agent': 'HackUTD-UnderDog/1.0' } });
    if (response.ok) return response.json();
    if (attempt >= 4) throw new Error(`Overpass ${response.status}`);
    await new Promise((done) => setTimeout(done, attempt * 5000));
  }
}

const raw = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], 'utf8')) : await overpass();
const inBox = ([lon, lat]) => lat >= BOX.south && lat <= BOX.north && lon >= BOX.west && lon <= BOX.east;
const coordsOf = (element) => element.geometry.map((point) => [round7(point.lon), round7(point.lat)]);
const closed = (ring) => (ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? ring : [...ring, ring[0]]);
function center(ring) { const points = ring.slice(0, -1); return [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length]; }
const metersPerLon = 111_320 * Math.cos((32.986 * Math.PI) / 180);
const meters = (a, b) => Math.hypot((a[0] - b[0]) * metersPerLon, (a[1] - b[1]) * 111_320);
function area(ring) { let sum = 0; for (let i = 0; i < ring.length - 1; i += 1) sum += (ring[i][0] * metersPerLon) * (ring[i + 1][1] * 111_320) - (ring[i + 1][0] * metersPerLon) * (ring[i][1] * 111_320); return Math.abs(sum / 2); }
const contains = (ring, [x, y]) => { let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside; } return inside; };

const targetRing = closed(TARGET_OUTLINE);
const targetCenter = center(targetRing);
const block = [{ type: 'Feature', properties: { osm: TARGET.id, address: TARGET.address, row: 'block', target: true }, geometry: { type: 'Polygon', coordinates: [targetRing] } }];
const context = [{ type: 'Feature', properties: { k: 'b' }, geometry: { type: 'Polygon', coordinates: [targetRing] } }];
const glasses = [{ type: 'Feature', properties: { kind: 'building', address: TARGET.address, name: TARGET.name, role: 'target' }, geometry: { type: 'Polygon', coordinates: [targetRing] } }];

for (const element of raw.elements) {
  if (element.type !== 'way' || !element.geometry?.length) continue;
  const tags = element.tags ?? {};
  const coords = coordsOf(element);
  if (!coords.some(inBox)) continue;
  if (tags.building) {
    const ring = closed(coords);
    const middle = center(ring);
    if (contains(targetRing, middle)) continue; // a stray outline inside the traced building
    // University Village buildings carry only their number as a name ("26"); Google shows them as "Building 26".
    const name = (tags.name && /^\d+$/.test(tags.name) ? `Building ${tags.name}` : tags.name) ?? (tags['addr:housenumber'] && tags['addr:street'] ? `${tags['addr:housenumber']} ${tags['addr:street'].replace(/ Avenue$/, ' Ave').replace(/ Drive$/, ' Dr').replace(/ Street$/, ' St')}` : '');
    context.push({ type: 'Feature', properties: { k: 'b' }, geometry: { type: 'Polygon', coordinates: [ring] } });
    glasses.push({ type: 'Feature', properties: { kind: 'building', address: name, role: 'neighbor' }, geometry: { type: 'Polygon', coordinates: [ring] } });
    if (tags.building !== 'roof' && area(ring) >= MIN_BLOCK_AREA_M2 && meters(middle, targetCenter) <= BLOCK_RADIUS_M) {
      block.push({ type: 'Feature', properties: { osm: `way/${element.id}`, address: name, row: 'block', target: false }, geometry: { type: 'Polygon', coordinates: [ring] } });
    }
  } else if (tags.highway && DRAWN.has(tags.highway) && tags.area !== 'yes') {
    // OSM still has the paths that crossed this ground before the building went up; a walk must not use them.
    if (coords.some((point) => contains(targetRing, point))) continue;
    context.push({ type: 'Feature', properties: { k: 'r', h: tags.highway, n: tags.name ?? null }, geometry: { type: 'LineString', coordinates: coords } });
    if (WALKABLE.has(tags.highway)) glasses.push({ type: 'Feature', properties: { kind: 'road', highway: tags.highway, name: tags.name ?? null }, geometry: { type: 'LineString', coordinates: coords } });
  } else if (tags.natural === 'water') {
    context.push({ type: 'Feature', properties: { k: 'w' }, geometry: { type: 'Polygon', coordinates: [closed(coords)] } });
  } else if (tags.landuse || tags.leisure) {
    context.push({ type: 'Feature', properties: { k: 'g' }, geometry: { type: 'Polygon', coordinates: [closed(coords)] } });
  }
}

const note = { source: 'OpenStreetMap contributors (ODbL), Overpass API; the 2520 Rutford Ave building traced from Google Maps', site: '2520 Rutford Ave, Richardson TX 75080 (UT Dallas)', center: { lat: round7(targetCenter[1]), lon: round7(targetCenter[0]) } };
const write = (path, features) => writeFileSync(out(path), `${JSON.stringify({ type: 'FeatureCollection', properties: note, features })}\n`);
write('frontend/dashboard/public/site/block.geojson', block);
write('frontend/dashboard/public/site/context.geojson', context);
write('backend/glasses-service/site/site.geojson', glasses);
console.log(`target center ${note.center.lat}, ${note.center.lon}; ${block.length} tracked buildings, ${context.length} context features, ${glasses.length} glasses features`);
