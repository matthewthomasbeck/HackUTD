// The demo site drawn from OpenStreetMap outlines (public/site/*.geojson): the 72 buildings of the
// Worthing St block in Dallas, plus the neighborhood around it as quiet context. No map tiles, so the
// map is sharp on a projector and works with no network at the venue.

export interface GeoPoint { lat: number; lon: number }
export type BlockRow = 'worthing_north' | 'worthing_south' | 'benchmark_north' | 'benchmark_south' | 'worthing_east_segment' | 'other';

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
export function houseAt(houses: readonly House[], p: GeoPoint, maxMeters = 12): House | undefined {
  let best: House | undefined;
  let bestDistance = maxMeters;
  for (const house of houses) {
    if (containsPoint(house.ring, p)) return house;
    const [x, y] = toMeters(p, house.center);
    const distance = Math.hypot(x, y);
    if (distance < bestDistance) { best = house; bestDistance = distance; }
  }
  return best;
}

const ROW_ORDER: Record<BlockRow, number> = { worthing_north: 0, worthing_south: 1, benchmark_north: 2, benchmark_south: 3, worthing_east_segment: 4, other: 5 };

// Homes only (the commercial buildings on Frankford and Coit are left out), in reading order: row by row, west to east.
export function blockHomes(houses: readonly House[]): House[] {
  return houses.filter((house) => house.row !== 'other')
    .sort((a, b) => ROW_ORDER[a.row] - ROW_ORDER[b.row] || (a.row === 'worthing_east_segment' ? b.center.lat - a.center.lat : a.center.lon - b.center.lon));
}
