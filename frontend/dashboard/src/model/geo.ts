export interface GeoPoint { lat: number; lon: number }
export interface GeoBounds { south: number; west: number; north: number; east: number }

export function boundsForSquare(center: GeoPoint, sizeM: number): GeoBounds {
  const half = sizeM / 2;
  const dLat = half / 111_320;
  const cosLat = Math.max(0.01, Math.abs(Math.cos((center.lat * Math.PI) / 180)));
  const dLon = half / (111_320 * cosLat);
  return { south: center.lat - dLat, west: center.lon - dLon, north: center.lat + dLat, east: center.lon + dLon };
}

export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
