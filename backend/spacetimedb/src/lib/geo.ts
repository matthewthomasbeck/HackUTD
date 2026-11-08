// Geometry helpers (docs/specs/spacetimedb.md section 5.6).

import { SenderError } from 'spacetimedb/server';
import type { Ctx, CellRow, SiteRow } from '../schema';
import { activeSite } from './auth';

const EARTH_RADIUS_M = 6_371_000;
const M_PER_DEG_LAT = 111_320;

// Great-circle distance in meters (https://www.movable-type.co.uk/scripts/latlong.html).
export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Meters to degrees at a given latitude.
export function metersToDeg(lat: number, m: number): { dLat: number; dLon: number } {
  return { dLat: m / M_PER_DEG_LAT, dLon: m / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)) };
}

// The nearest site whose center is within radius_m, else the active site.
export function siteForPoint(ctx: Ctx, lat: number, lon: number): SiteRow {
  let best: SiteRow | undefined;
  let bestD = Infinity;
  for (const s of ctx.db.site.iter()) {
    const d = haversineM(lat, lon, s.center_lat, s.center_lon);
    if (d <= s.radius_m && d < bestD) {
      best = s;
      bestD = d;
    }
  }
  const fallback = best ?? activeSite(ctx);
  if (!fallback) throw new SenderError('no site');
  return fallback;
}

// The cell of a site with the nearest center within size_m of the point, if any.
export function cellForPoint(ctx: Ctx, site_id: bigint, lat: number, lon: number): CellRow | undefined {
  let best: CellRow | undefined;
  let bestD = Infinity;
  for (const c of ctx.db.search_cell.site_id.filter(site_id)) {
    const d = haversineM(lat, lon, c.lat, c.lon);
    if (d <= c.size_m && d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}
