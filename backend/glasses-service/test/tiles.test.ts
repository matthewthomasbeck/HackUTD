import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadImage } from '@napi-rs/canvas';
import { TileCache } from '../src/tiles/cache.js';
import { createTileSource, tilesForWindow, zoomForRadius } from '../src/tiles/source.js';
import { MapBaseLayerCache, MapImageDiff, renderMap } from '../src/render/map.js';

describe('tile map rendering', () => {
  it('selects the spec zoom and stays within the prefetch ceiling', () => {
    const center = { lat: 32.9857, lon: -96.7502 };
    const zoom = zoomForRadius(center, 483);
    expect(zoom).toBe(15);
    expect(tilesForWindow(center, zoom).length).toBeLessThanOrEqual(9);
  });

  it('uses the approved keyless Esri URL and preserves tile axis order', () => {
    const source = createTileSource('esri-dark');
    expect(source.url({ z: 15, x: 123, y: 456 })).toBe('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/15/456/123');
    expect(source.extension).toBe('jpg');
    expect(() => createTileSource('carto-dark')).toThrow('CARTO_KEY is required');
  });

  it('deduplicates concurrent fetches and caches tile bytes locally', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'glasses-tiles-'));
    try {
      const fetchTile = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
      const cache = new TileCache({ directory, source: createTileSource('esri-dark'), fetchTile });
      const coord = { z: 15, x: 2, y: 3 };
      const [first, second] = await Promise.all([cache.get(coord), cache.get(coord)]);
      expect(first).toEqual(Buffer.from([1, 2, 3]));
      expect(second).toEqual(first);
      expect(fetchTile).toHaveBeenCalledTimes(1);
      expect(await readFile(join(directory, 'esri-dark/15/2/3.jpg'))).toEqual(first);
      await cache.get(coord);
      expect(fetchTile).toHaveBeenCalledTimes(1);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('renders two 288 by 144 PNG halves without fetching tiles', async () => {
    const center = { lat: 32.9857, lon: -96.7502 };
    const images = await renderMap({ center, radiusM: 483, zoom: 15, tiles: [], source: createTileSource('none'), markers: [{ kind: 'rescuer', ...center }] });
    const top = await loadImage(Buffer.from(images.top, 'base64'));
    const bottom = await loadImage(Buffer.from(images.bottom, 'base64'));
    expect([top.width, top.height, bottom.width, bottom.height]).toEqual([288, 144, 288, 144]);
    expect(images.attribution).toBe('');
  });

  it('sends only changed image halves and enforces the two second redraw limit', () => {
    const diff = new MapImageDiff();
    const first = { top: 'a', bottom: 'b', topSha1: 'ta', bottomSha1: 'bb', attribution: '', lensText: '' };
    expect(diff.changed(first, 5_000)).toEqual({ top: 'a', bottom: 'b' });
    expect(diff.changed({ ...first, bottom: 'c', bottomSha1: 'bc' }, 6_999)).toBeNull();
    expect(diff.changed({ ...first, bottom: 'c', bottomSha1: 'bc' }, 7_000)).toEqual({ bottom: 'c' });
    expect(diff.shouldRedraw([{ kind: 'rescuer', lat: 32, lon: -96 }])).toBe(true);
    expect(diff.shouldRedraw([{ kind: 'rescuer', lat: 32, lon: -96 }])).toBe(false);
  });

  it('reuses the composited base for marker redraws on the same site', async () => {
    const cache = new MapBaseLayerCache<string>();
    const compose = vi.fn(async () => 'base canvas');
    await expect(cache.get('site-a:z15', compose)).resolves.toBe('base canvas');
    await expect(cache.get('site-a:z15', compose)).resolves.toBe('base canvas');
    await expect(cache.get('site-b:z15', compose)).resolves.toBe('base canvas');
    expect(compose).toHaveBeenCalledTimes(2);
  });
});
