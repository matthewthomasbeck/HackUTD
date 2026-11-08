import type { Offset } from './config.ts';

export interface LatLon {
  lat: number;
  lon: number;
}

const METERS_PER_DEGREE = 111_320;

// Even-odd point-in-polygon test on meter offsets (ring of [east_m, north_m], not closed).
export function insideRing(east_m: number, north_m: number, ring: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if ((yi > north_m) !== (yj > north_m) && east_m < ((xj - xi) * (north_m - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const EARTH_RADIUS_M = 6_371_000;

export function offsetToLatLon(center: LatLon, offset: Offset): LatLon {
  const latitudeRadians = (center.lat * Math.PI) / 180;
  return {
    lat: center.lat + offset.north_m / METERS_PER_DEGREE,
    lon: center.lon + offset.east_m / (METERS_PER_DEGREE * Math.cos(latitudeRadians)),
  };
}

export function distanceMeters(from: LatLon, to: LatLon): number {
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const deltaLat = lat2 - lat1;
  const deltaLon = ((to.lon - from.lon) * Math.PI) / 180;
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function bearingDegrees(from: LatLon, to: LatLon): number {
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const deltaLon = ((to.lon - from.lon) * Math.PI) / 180;
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function walkToward(from: LatLon, to: LatLon, stepMeters: number): LatLon {
  if (!Number.isFinite(stepMeters) || stepMeters < 0) throw new Error('stepMeters must be a finite number >= 0');
  const distance = distanceMeters(from, to);
  if (distance === 0 || stepMeters >= distance) return { ...to };
  const fraction = stepMeters / distance;
  return {
    lat: from.lat + (to.lat - from.lat) * fraction,
    lon: from.lon + (to.lon - from.lon) * fraction,
  };
}

// Inverse of offsetToLatLon, with the same local approximation.
export function latLonToOffset(center: LatLon, point: LatLon): Offset {
  const latitudeRadians = (center.lat * Math.PI) / 180;
  return {
    east_m: (point.lon - center.lon) * METERS_PER_DEGREE * Math.cos(latitudeRadians),
    north_m: (point.lat - center.lat) * METERS_PER_DEGREE,
  };
}
