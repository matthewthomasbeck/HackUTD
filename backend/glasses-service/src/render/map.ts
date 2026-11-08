import { createCanvas, loadImage, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';
import { createHash } from 'node:crypto';
import { mercator, type Point } from '../geo.js';
import { MAP_SIZE, TILE_SIZE, tilesForWindow, worldPixel, zoomForRadius, type TileCoord, type TileSource } from '../tiles/source.js';
import { TileCache } from '../tiles/cache.js';

export interface MapMarker { kind: 'survivor' | 'robot' | 'rescuer'; lat: number; lon: number; criticalLevel?: string; resolved?: boolean; target?: boolean; online?: boolean; headingDeg?: number | null }
export interface MapTileData { coord: TileCoord; data: Buffer }
export interface MapImages { top: string; bottom: string; topSha1: string; bottomSha1: string; attribution: string; lensText: string }

export async function composeBaseMap(options: { center: Point; radiusM: number; zoom: number; tiles: MapTileData[]; source: TileSource }): Promise<Canvas> {
  const canvas = createCanvas(MAP_SIZE, MAP_SIZE);
  const context = canvas.getContext('2d');
  context.fillStyle = 'black'; context.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
  const center = worldPixel(options.center, options.zoom);
  for (const tile of options.tiles) {
    try {
      const image = await loadImage(tile.data);
      const x = tile.coord.x * TILE_SIZE - center.x + MAP_SIZE / 2;
      const y = tile.coord.y * TILE_SIZE - center.y + MAP_SIZE / 2;
      context.drawImage(image, x, y, TILE_SIZE, TILE_SIZE);
    } catch { /* missing or invalid tiles remain black */ }
  }
  const image = context.getImageData(0, 0, MAP_SIZE, MAP_SIZE);
  toneMap(image.data, options.source.invert);
  context.putImageData(image, 0, 0);
  const metersPerPixel = mercator(options.center.lat, options.center.lon, options.zoom).mpp;
  if (options.source.name === 'none') drawGrid(context, metersPerPixel);
  drawSiteBoundary(context, MAP_SIZE / 2, MAP_SIZE / 2, options.radiusM / metersPerPixel);
  drawNorthMark(context);
  return canvas;
}

export async function renderMap(options: { center: Point; radiusM: number; zoom: number; tiles: MapTileData[]; source: TileSource; markers?: MapMarker[]; baseCanvas?: Canvas }): Promise<MapImages> {
  const baseCanvas = options.baseCanvas ?? await composeBaseMap(options);
  const canvas = createCanvas(MAP_SIZE, MAP_SIZE);
  const context = canvas.getContext('2d');
  context.drawImage(baseCanvas, 0, 0);
  const center = worldPixel(options.center, options.zoom);
  for (const marker of options.markers ?? []) drawMarker(context, marker, center, options.zoom);
  const pixels = context.getImageData(0, 0, MAP_SIZE, MAP_SIZE);
  quantize(pixels.data);
  context.putImageData(pixels, 0, 0);
  const top = await encodeHalf(canvas, 0);
  const bottom = await encodeHalf(canvas, 144);
  return { top, bottom, topSha1: sha1(top), bottomSha1: sha1(bottom), attribution: options.source.attribution, lensText: options.source.lensText };
}

export class MapBaseLayerCache<T> {
  private readonly entries = new Map<string, Promise<T>>();

  get(key: string, create: () => Promise<T>): Promise<T> {
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached;
    }
    const value = create();
    this.entries.set(key, value);
    if (this.entries.size > 4) this.entries.delete(this.entries.keys().next().value!);
    void value.catch(() => { if (this.entries.get(key) === value) this.entries.delete(key); });
    return value;
  }
}

export class MapImageDiff {
  private previousTop = '';
  private previousBottom = '';
  private lastDrawAt = 0;
  private markerKey = '';
  changed(images: MapImages, now = Date.now()): { top?: string; bottom?: string } | null {
    if (now - this.lastDrawAt < 2000) return null;
    const topChanged = images.topSha1 !== this.previousTop;
    const bottomChanged = images.bottomSha1 !== this.previousBottom;
    this.lastDrawAt = now;
    this.previousTop = images.topSha1;
    this.previousBottom = images.bottomSha1;
    return { ...(topChanged ? { top: images.top } : {}), ...(bottomChanged ? { bottom: images.bottom } : {}) };
  }
  shouldRedraw(markers: MapMarker[]): boolean {
    const key = markerKey(markers);
    if (key === this.markerKey) return false;
    this.markerKey = key;
    return true;
  }
}

export class SiteMapRenderer {
  private lastKey = '';
  private lastDrawAt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private drawing = false;
  private pending: { center: Point; radiusM: number; markers: MapMarker[]; onImages(images: MapImages): void } | undefined;
  private readonly baseLayers = new MapBaseLayerCache<Canvas>();

  constructor(private readonly cache: TileCache, private readonly source: TileSource) {}

  request(options: { center: Point; radiusM: number; markers: MapMarker[]; onImages(images: MapImages): void }): void {
    const zoom = zoomForRadius(options.center, options.radiusM);
    const key = siteMarkerKey(options.center, options.radiusM, zoom, options.markers);
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.pending = options;
    if (this.drawing) return;
    this.schedule();
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    const wait = Math.max(0, 2000 - (Date.now() - this.lastDrawAt));
    this.timer = setTimeout(() => { void this.drawPending(); }, wait);
  }

  private async drawPending(): Promise<void> {
    this.timer = undefined;
    const item = this.pending;
    if (!item) return;
    this.pending = undefined;
    this.drawing = true;
    try {
      const zoom = zoomForRadius(item.center, item.radiusM);
      const baseKey = `${this.source.name}:${item.center.lat}:${item.center.lon}:${item.radiusM}:${zoom}`;
      const baseCanvas = await this.baseLayers.get(baseKey, async () => {
        const tiles: MapTileData[] = [];
        for (const coord of tilesForWindow(item.center, zoom).slice(0, 9)) {
          const data = await this.cache.get(coord);
          if (data) tiles.push({ coord, data });
        }
        return composeBaseMap({ center: item.center, radiusM: item.radiusM, zoom, tiles, source: this.source });
      });
      const images = await renderMap({ center: item.center, radiusM: item.radiusM, zoom, tiles: [], source: this.source, markers: item.markers, baseCanvas });
      item.onImages(images);
    } catch {
      // Keep the previous image if a tile or canvas operation fails.
    } finally {
      this.lastDrawAt = Date.now();
      this.drawing = false;
    }
    if (this.pending && !this.timer) this.schedule();
  }
}

function markerKey(markers: MapMarker[]): string {
  return markers.map(marker => `${marker.kind}:${marker.criticalLevel ?? ''}:${marker.resolved ? 1 : 0}:${marker.target ? 1 : 0}:${marker.online === false ? 0 : 1}:${Math.round(marker.lat * 1e6)}:${Math.round(marker.lon * 1e6)}:${Math.round(marker.headingDeg ?? 0)}`).sort().join('|');
}

function siteMarkerKey(center: Point, radiusM: number, zoom: number, markers: MapMarker[]): string {
  const centerPixel = worldPixel(center, zoom);
  const projected = markers.map(marker => {
    const point = worldPixel(marker, zoom);
    return `${marker.kind}:${marker.criticalLevel ?? ''}:${marker.resolved ? 1 : 0}:${marker.target ? 1 : 0}:${marker.online === false ? 0 : 1}:${Math.round(point.x - centerPixel.x)}:${Math.round(point.y - centerPixel.y)}:${Math.round(marker.headingDeg ?? 0)}`;
  }).sort().join('|');
  return `${center.lat}:${center.lon}:${radiusM}:${zoom}:${projected}`;
}

function toneMap(data: Uint8ClampedArray, invert: boolean): void {
  const values: number[] = [];
  for (let i = 0; i < data.length; i += 4) values.push(luminance(data[i]!, data[i + 1]!, data[i + 2]!, invert));
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const p99 = sorted[Math.floor((sorted.length - 1) * 0.99)] ?? median;
  const denom = Math.max(1, p99 - median);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const value = Math.max(0, Math.min(119, Math.round((values[p]! - median - 4) * 119 / denom)));
    data[i] = value; data[i + 1] = value; data[i + 2] = value; data[i + 3] = 255;
  }
}

function luminance(r: number, g: number, b: number, invert: boolean): number {
  const value = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return invert ? 255 - value : value;
}

function drawGrid(ctx: SKRSContext2D, metersPerPixel: number): void {
  const spacing = Math.max(4, 100 / metersPerPixel);
  ctx.strokeStyle = 'rgb(34,34,34)'; ctx.lineWidth = 1;
  for (let x = MAP_SIZE / 2 % spacing; x < MAP_SIZE; x += spacing) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, MAP_SIZE); ctx.stroke(); }
  for (let y = MAP_SIZE / 2 % spacing; y < MAP_SIZE; y += spacing) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(MAP_SIZE, y); ctx.stroke(); }
}

function drawSiteBoundary(ctx: SKRSContext2D, x: number, y: number, radiusPx: number): void {
  ctx.save(); ctx.strokeStyle = 'rgb(85,85,85)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.arc(x, y, radiusPx, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
}

function drawNorthMark(ctx: SKRSContext2D): void {
  ctx.save(); ctx.strokeStyle = 'rgb(85,85,85)'; ctx.fillStyle = 'rgb(85,85,85)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(12, 25); ctx.lineTo(12, 8); ctx.lineTo(9, 13); ctx.moveTo(12, 8); ctx.lineTo(15, 13); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(8, 29); ctx.lineTo(8, 22); ctx.lineTo(12, 25); ctx.lineTo(16, 22); ctx.lineTo(16, 29); ctx.stroke(); ctx.restore();
}

function drawMarker(ctx: SKRSContext2D, marker: MapMarker, center: { x: number; y: number }, zoom: number): void {
  if (marker.resolved) return;
  const point = mercator(marker.lat, marker.lon, zoom);
  const x0 = point.px - center.x + MAP_SIZE / 2;
  const y0 = point.py - center.y + MAP_SIZE / 2;
  const outside = x0 < 0 || x0 >= MAP_SIZE || y0 < 0 || y0 >= MAP_SIZE;
  const x = Math.max(3, Math.min(MAP_SIZE - 3, x0));
  const y = Math.max(3, Math.min(MAP_SIZE - 3, y0));
  ctx.save(); ctx.strokeStyle = 'black'; ctx.fillStyle = 'white'; ctx.lineWidth = 1;
  if (outside) { ctx.beginPath(); ctx.moveTo(x - 3, y); ctx.lineTo(x + 3, y); ctx.stroke(); }
  if (marker.kind === 'survivor') {
    if (marker.criticalLevel === 'immediate') { ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    else { ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.stroke(); }
  } else if (marker.kind === 'rescuer') {
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  } else {
    const angle = ((marker.headingDeg ?? 0) - 90) * Math.PI / 180;
    ctx.translate(x, y); ctx.rotate(angle); ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-6, -6); ctx.lineTo(-3, 0); ctx.lineTo(-6, 6); ctx.closePath();
    if (marker.online === false) ctx.stroke(); else { ctx.fill(); ctx.stroke(); }
  }
  if (marker.target) { ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.stroke(); }
  ctx.restore();
}

async function encodeHalf(canvas: Canvas, y: number): Promise<string> {
  const half = createCanvas(MAP_SIZE, 144);
  half.getContext('2d').drawImage(canvas, 0, y, MAP_SIZE, 144, 0, 0, MAP_SIZE, 144);
  return (await half.encode('png')).toString('base64');
}

function quantize(data: Uint8ClampedArray): void { for (let i = 0; i < data.length; i += 4) { const gray = Math.round(data[i]! / 17) * 17; data[i] = gray; data[i + 1] = gray; data[i + 2] = gray; } }
function sha1(value: string): string { return createHash('sha1').update(value).digest('hex'); }
