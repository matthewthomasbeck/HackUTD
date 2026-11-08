// The demo site drawn from OpenStreetMap outlines (public/site/*.geojson, built by backend/sim/scripts/build-site.mjs):
// the buildings around 2520 Rutford Ave on the UT Dallas campus, plus the campus around them as quiet context. No map
// tiles, so the map is sharp on a projector and works with no network at the venue.

export interface GeoPoint { lat: number; lon: number }
// 'block' for the buildings the dashboard tracks, 'other' for context-only outlines.
export type BlockRow = 'block' | 'other';

export interface House { id: string; ring: GeoPoint[]; address: string; row: BlockRow; center: GeoPoint }
export interface ContextRoad { line: GeoPoint[]; highway: string; name: string | null }
export interface SiteGeometry {
  houses: House[];
  context: { buildings: GeoPoint[][]; roads: ContextRoad[]; parks: GeoPoint[][]; water: GeoPoint[][] };
}

interface Feature { properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }

const point = ([lon, lat]: number[]): GeoPoint => ({ lat: lat!, lon: lon! });

export function ringCenter(ring: readonly GeoPoint[]): GeoPoint {
  return { lat: ring.reduce((sum, p) => sum + p.lat, 0) / ring.length, lon: ring.reduce((sum, p) => sum + p.lon, 0) / ring.length };
}

export function parseSite(block: { features: Feature[] }, context: { features: Feature[] }): SiteGeometry {
  const houses = block.features.map((feature): House => {
    const ring = (feature.geometry.coordinates as number[][][])[0]!.map(point);
    return { id: String(feature.properties.osm), ring, address: String(feature.properties.address ?? ''), row: (feature.properties.row ?? 'other') as BlockRow, center: ringCenter(ring) };
  });
  const out: SiteGeometry['context'] = { buildings: [], roads: [], parks: [], water: [] };
  for (const feature of context.features) {
    const kind = feature.properties.k;
    if (kind === 'r') out.roads.push({ line: (feature.geometry.coordinates as number[][]).map(point), highway: String(feature.properties.h), name: (feature.properties.n as string | undefined) ?? null });
    else {
      const ring = (feature.geometry.coordinates as number[][][])[0]!.map(point);
      if (kind === 'b') out.buildings.push(ring); else if (kind === 'w') out.water.push(ring); else out.parks.push(ring);
    }
  }
  return { houses, context: out };
}

export async function loadSite(base = import.meta.env.BASE_URL): Promise<SiteGeometry> {
  const [block, context] = await Promise.all([`${base}site/block.geojson`, `${base}site/context.geojson`].map((url) => fetch(url).then((response) => {
    if (!response.ok) throw new Error(`Could not load ${url} (${response.status})`);
    return response.json() as Promise<{ features: Feature[] }>;
  })));
  return parseSite(block!, context!);
}

// Local meters around an origin (east, north), good at block scale.
export function toMeters(origin: GeoPoint, p: GeoPoint): [number, number] {
  return [(p.lon - origin.lon) * 111_320 * Math.cos(origin.lat * Math.PI / 180), (p.lat - origin.lat) * 110_574];
}

export function containsPoint(ring: readonly GeoPoint[], p: GeoPoint): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a.lat > p.lat) !== (b.lat > p.lat) && p.lon < (b.lon - a.lon) * (p.lat - a.lat) / (b.lat - a.lat) + a.lon) inside = !inside;
  }
  return inside;
}

// The house that holds a point, else the nearest house center within maxMeters (GPS and cell centers are approximate).
// The house that holds a point, else the house whose outline is nearest within maxMeters, so someone in a front
// yard belongs to the house they are in front of.
export function houseAt(houses: readonly House[], p: GeoPoint, maxMeters = 12): House | undefined {
  let best: House | undefined;
  let bestDistance = maxMeters;
  for (const house of houses) {
    if (containsPoint(house.ring, p)) return house;
    const distance = distanceToRing(house.ring, p);
    if (distance < bestDistance) { best = house; bestDistance = distance; }
  }
  return best;
}

// Meters from a point to the nearest edge of an outline.
function distanceToRing(ring: readonly GeoPoint[], p: GeoPoint): number {
  let best = Infinity;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [ax, ay] = toMeters(p, ring[i]!); // the edge's ends, in meters from the point
    const [bx, by] = toMeters(p, ring[i + 1]!);
    const dx = bx - ax, dy = by - ay;
    const t = dx || dy ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

// The tracked buildings in reading order: north to south in 30 m bands, west to east within a band.
export function blockHomes(houses: readonly House[]): House[] {
  const band = (house: House) => Math.round(-house.center.lat * 110_574 / 30);
  return houses.filter((house) => house.row !== 'other')
    .sort((a, b) => band(a) - band(b) || a.center.lon - b.center.lon);
}
