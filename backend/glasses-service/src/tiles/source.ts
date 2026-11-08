import { mercator, type Point } from '../geo.js';

export type TileSourceName = 'vector' | 'esri-dark' | 'carto-dark' | 'osm-inverted' | 'none';
export interface TileCoord { z: number; x: number; y: number }
export interface TileSource {
  name: TileSourceName;
  extension: 'jpg' | 'png';
  attribution: string;
  lensText: string;
  invert: boolean;
  url(coord: TileCoord): string | null;
  headers?: Record<string, string>;
}
export const TILE_SIZE = 256;
export const MAP_SIZE = 288;

export function createTileSource(name: TileSourceName = 'esri-dark', cartoKey?: string, userAgent = 'HackUTD-GlassesService/1.0'): TileSource {
  if (name === 'none') return { name, extension: 'png', attribution: '', lensText: '', invert: false, url: () => null };
  // Drawn from site/worthing.geojson in render/vector.ts; no tiles are fetched.
  if (name === 'vector') return { name, extension: 'png', attribution: '(c) OpenStreetMap contributors', lensText: '(c) OSM', invert: false, url: () => null };
  if (name === 'esri-dark') return {
    name, extension: 'jpg', attribution: 'Esri, HERE, Garmin, (c) OpenStreetMap contributors', lensText: '(c) Esri, OSM', invert: false,
    url: ({ z, x, y }) => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/${z}/${y}/${x}`,
  };
  if (name === 'carto-dark') {
    if (!cartoKey?.trim()) throw new Error('CARTO_KEY is required when TILE_SOURCE=carto-dark.');
    return { name, extension: 'png', attribution: '(c) OpenStreetMap contributors, (c) CARTO', lensText: '(c) OSM, CARTO', invert: false,
      url: ({ z, x, y }) => `https://a.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png?key=${encodeURIComponent(cartoKey)}` };
  }
  return { name, extension: 'png', attribution: '(c) OpenStreetMap contributors', lensText: '(c) OSM contributors', invert: true,
    url: ({ z, x, y }) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`, headers: { 'User-Agent': userAgent } };
}

export function zoomForRadius(center: Point, radiusM: number): number {
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, center.lat));
  for (let z = 17; z >= 0; z -= 1) {
    const metersPerPixel = 156543.03392 * Math.cos(latitude * Math.PI / 180) / 2 ** z;
    if (2 * radiusM * 1.15 / metersPerPixel <= MAP_SIZE) return z;
  }
  return 0;
}

export function tilesForWindow(center: Point, zoom: number): TileCoord[] {
  const pixel = mercator(center.lat, center.lon, zoom);
  const minX = Math.floor((pixel.px - MAP_SIZE / 2) / TILE_SIZE);
  const maxX = Math.floor((pixel.px + MAP_SIZE / 2 - 1) / TILE_SIZE);
  const minY = Math.floor((pixel.py - MAP_SIZE / 2) / TILE_SIZE);
  const maxY = Math.floor((pixel.py + MAP_SIZE / 2 - 1) / TILE_SIZE);
  const out: TileCoord[] = [];
  for (let x = minX; x <= maxX; x += 1) for (let y = minY; y <= maxY; y += 1) {
    out.push({ z: zoom, x: ((x % 2 ** zoom) + 2 ** zoom) % 2 ** zoom, y: Math.max(0, Math.min(2 ** zoom - 1, y)) });
  }
  return out.filter((coord, index, all) => all.findIndex(other => other.x === coord.x && other.y === coord.y && other.z === coord.z) === index);
}

export function worldPixel(point: Point, zoom: number): { x: number; y: number } {
  const value = mercator(point.lat, point.lon, zoom);
  return { x: value.px, y: value.py };
}
