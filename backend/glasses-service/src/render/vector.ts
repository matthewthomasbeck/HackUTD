// The demo site drawn from OpenStreetMap outlines instead of map tiles: crisp on the G2, no network, no key.
// The geometry file is site/site.geojson (2520 Rutford Ave, UT Dallas; backend/sim/scripts/build-site.mjs). Roads and buildings are
// drawn in the same Web Mercator pixels as the markers in render/map.ts, so both line up.
import { readFileSync } from 'node:fs';
import type { SKRSContext2D } from '@napi-rs/canvas';
import { distanceM, type Point } from '../geo.js';
import { MAP_SIZE, worldPixel } from '../tiles/source.js';

export interface SiteBuilding { ring: Point[]; address: string; target: boolean }
export interface SiteRoad { line: Point[]; highway: string; name: string }
export interface SiteGeometry { buildings: SiteBuilding[]; roads: SiteRoad[] }

interface GeoFeature {
  properties: { kind: string; address?: string; role?: string; highway?: string; name?: string | null };
  geometry: { type: string; coordinates: number[][] | number[][][] };
}

const toPoint = (pair: number[]): Point => ({ lon: pair[0]!, lat: pair[1]! });

export function parseSiteGeometry(raw: string): SiteGeometry {
  const features = (JSON.parse(raw) as { features: GeoFeature[] }).features;
  const buildings: SiteBuilding[] = [];
  const roads: SiteRoad[] = [];
  for (const feature of features) {
    if (feature.properties.kind === 'building' && feature.geometry.type === 'Polygon') {
      const ring = (feature.geometry.coordinates as number[][][])[0]!.map(toPoint);
      buildings.push({ ring, address: feature.properties.address ?? '', target: feature.properties.role === 'target' });
    } else if (feature.properties.kind === 'road' && feature.geometry.type === 'LineString') {
      const line = (feature.geometry.coordinates as number[][]).map(toPoint);
      roads.push({ line, highway: feature.properties.highway ?? '', name: feature.properties.name ?? '' });
    }
  }
  return { buildings, roads };
}

export function loadSiteGeometry(path: string): SiteGeometry | undefined {
  try { return parseSiteGeometry(readFileSync(path, 'utf8')); }
  catch (error) { console.warn(`[vector] no site geometry at ${path}: ${(error as Error).message}`); return undefined; }
}

// The map follows the rescuer, so it frames the walk: the rescuer at the center and the target in view.
// Vector drawing allows a fractional zoom (tiles do not), so the frame fits the distance smoothly.
// The center sits 40% of the way from the rescuer toward the target, so both stay on screen as the rescuer walks.
export function followFrame(rescuer: Point, target: Point | undefined): { center: Point; radiusM: number } {
  if (!target) return { center: rescuer, radiusM: 80 };
  const distance = distanceM(rescuer, target);
  const center = { lat: rescuer.lat + (target.lat - rescuer.lat) * 0.4, lon: rescuer.lon + (target.lon - rescuer.lon) * 0.4 };
  return { center, radiusM: Math.min(400, Math.max(40, distance * 0.8)) };
}

export function vectorZoom(center: Point, radiusM: number): number {
  const metersPerPixel = 2 * radiusM * 1.1 / MAP_SIZE;
  return Math.min(18.5, Math.log2(156543.03392 * Math.cos(center.lat * Math.PI / 180) / metersPerPixel));
}

// Road widths in meters, roughly the real pavement width.
// Footways and paths are walkable (render/route.ts) but not drawn, so the small display stays readable.
const ROAD_WIDTH_M: Record<string, number> = { secondary: 14, tertiary: 11, residential: 9, unclassified: 8, living_street: 7, pedestrian: 6, service: 4 };

export function drawVectorBase(context: SKRSContext2D, geometry: SiteGeometry, center: Point, zoom: number, _metersPerPixel: number): void {
  const origin = worldPixel(center, zoom);
  const project = (point: Point): [number, number] => {
    const pixel = worldPixel(point, zoom);
    return [pixel.x - origin.x + MAP_SIZE / 2, pixel.y - origin.y + MAP_SIZE / 2];
  };
  const trace = (points: Point[], close: boolean) => {
    context.beginPath();
    points.forEach((point, index) => { const [x, y] = project(point); if (index) context.lineTo(x, y); else context.moveTo(x, y); });
    if (close) context.closePath();
  };
  context.lineCap = 'round';
  context.lineJoin = 'round';
  // Roads as thin center lines: the gaps between the houses already read as streets, and filled bands
  // came out as bright bars on the G2's green levels. Wider roads get a slightly heavier line.
  for (const road of geometry.roads) {
    const width = ROAD_WIDTH_M[road.highway];
    if (!width || road.highway === 'service') continue;
    context.strokeStyle = 'rgb(110,110,110)';
    context.lineWidth = width >= 14 ? 2 : 1.25;
    trace(road.line, false);
    context.stroke();
  }
  // Every house as an outline; the target house is filled so it is the brightest thing on the map.
  for (const building of geometry.buildings) {
    trace(building.ring, true);
    if (building.target) { context.fillStyle = 'rgb(255,255,255)'; context.fill(); }
    else { context.strokeStyle = 'rgb(150,150,150)'; context.lineWidth = 1; context.stroke(); }
  }
}

// The building that holds a point, else the one whose outline is nearest within 25 m, so someone in front of a large
// campus building belongs to it even far from its middle (survivor positions are approximate).
export function buildingAt(geometry: SiteGeometry, point: Point): SiteBuilding | undefined {
  let best: SiteBuilding | undefined;
  let bestDistance = 25;
  for (const building of geometry.buildings) {
    if (containsPoint(building.ring, point)) return building;
    const distance = distanceToRing(building.ring, point);
    if (distance < bestDistance) { best = building; bestDistance = distance; }
  }
  return best;
}

// Meters from a point to the nearest edge of an outline (flat-earth, fine at building scale).
function distanceToRing(ring: Point[], point: Point): number {
  const perLon = 111_320 * Math.cos((point.lat * Math.PI) / 180);
  let best = Infinity;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const ax = (ring[i]!.lon - point.lon) * perLon, ay = (ring[i]!.lat - point.lat) * 111_320;
    const bx = (ring[i + 1]!.lon - point.lon) * perLon, by = (ring[i + 1]!.lat - point.lat) * 111_320;
    const dx = bx - ax, dy = by - ay;
    const t = dx || dy ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

export function ringCenter(ring: Point[]): Point {
  const lat = ring.reduce((sum, point) => sum + point.lat, 0) / ring.length;
  const lon = ring.reduce((sum, point) => sum + point.lon, 0) / ring.length;
  return { lat, lon };
}

export function containsPoint(ring: Point[], point: Point): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a.lat > point.lat) !== (b.lat > point.lat) && point.lon < (b.lon - a.lon) * (point.lat - a.lat) / (b.lat - a.lat) + a.lon) inside = !inside;
  }
  return inside;
}
