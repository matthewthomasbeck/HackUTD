// Haversine distance, initial bearing, and the 8 compass words the glasses arrows use.
// Formulas from Movable Type (agent.md [N11]); R = 6,371,000 m.

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Initial bearing from point 1 to point 2, degrees clockwise from true north, 0 to 360. */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
  const x =
    Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

const WORDS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
export type Compass = (typeof WORDS)[number];

export function compass(bearing: number): Compass {
  const b = ((bearing % 360) + 360) % 360;
  return WORDS[Math.round(b / 45) % 8];
}

/** Move a point by meters north and east (small distances; used by the fake world seeds). */
export function offsetM(lat: number, lon: number, northM: number, eastM: number): { lat: number; lon: number } {
  const dLat = deg(northM / R);
  const dLon = deg(eastM / (R * Math.cos(rad(lat))));
  return { lat: lat + dLat, lon: lon + dLon };
}
