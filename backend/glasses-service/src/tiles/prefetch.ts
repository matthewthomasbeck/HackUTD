import { resolve } from 'node:path';
import { createTileSource, tilesForWindow, zoomForRadius, type TileSourceName } from './source.js';
import { TileCache } from './cache.js';
import type { Point } from '../geo.js';
import { DbConnection, tables } from '../../../spacetimedb-bindings/index.js';

export interface PrefetchResult { zoom: number; requested: number; saved: number; missing: number }
interface PrefetchSubscriptionBuilder { onApplied(callback: () => void): PrefetchSubscriptionBuilder; onError(callback: (context: unknown, error: Error) => void): PrefetchSubscriptionBuilder; subscribe(query: unknown): unknown }
interface PrefetchConnection { db: { site: { iter(): Iterable<unknown> } }; subscriptionBuilder(): PrefetchSubscriptionBuilder; disconnect(): void }
interface PrefetchConnectionBuilder { withUri(uri: string): this; withDatabaseName(database: string): this; withAutomaticReconnect(): this; onConnect(callback: (connection: PrefetchConnection) => void): this; onConnectError(callback: (context: unknown, error: Error) => void): this; onDisconnect(callback: (context: unknown, error?: Error) => void): this; build(): PrefetchConnection }

export async function prefetchTiles(options: { center: Point; radiusM: number; sourceName?: TileSourceName; directory: string; cartoKey?: string; fetchTile?: ConstructorParameters<typeof TileCache>[0]['fetchTile'] }): Promise<PrefetchResult> {
  const source = createTileSource(options.sourceName ?? 'esri-dark', options.cartoKey);
  const zoom = zoomForRadius(options.center, options.radiusM);
  const coords = tilesForWindow(options.center, zoom).slice(0, 9);
  const cache = new TileCache({ directory: options.directory, source, fetchTile: options.fetchTile });
  let saved = 0;
  for (const coord of coords) if (await cache.get(coord)) saved += 1;
  return { zoom, requested: coords.length, saved, missing: coords.length - saved };
}

function args(values: string[]): { center: Point; radiusM: number } {
  const parsed: Record<string, number> = {};
  for (let i = 0; i < values.length; i += 1) {
    const key = values[i];
    if (key === '--lat' || key === '--lon' || key === '--radius') parsed[key] = Number(values[++i]);
  }
  if (![parsed['--lat'], parsed['--lon'], parsed['--radius']].every(Number.isFinite) || parsed['--radius']! <= 0) {
    throw new Error('Pass --lat <latitude> --lon <longitude> --radius <meters>.');
  }
  return { center: { lat: parsed['--lat']!, lon: parsed['--lon']! }, radiusM: parsed['--radius']! };
}

export async function readSiteCenter(uri: string, database: string, timeoutMs = 10_000): Promise<{ center: Point; radiusM: number }> {
  return await new Promise((resolveSite, reject) => {
    let finished = false;
    let connection: PrefetchConnection | undefined;
    const finish = (error?: Error, value?: { center: Point; radiusM: number }) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      connection?.disconnect();
      if (error) reject(error);
      else if (value) resolveSite(value);
      else reject(new Error('The site table did not return a site row.'));
    };
    const timer = setTimeout(() => finish(new Error('Timed out reading the site table.')), timeoutMs);
    try {
      const builder = (DbConnection as unknown as { builder(): PrefetchConnectionBuilder }).builder();
      connection = builder
        .withUri(uri)
        .withDatabaseName(database)
        .withAutomaticReconnect()
        .onConnect((conn: PrefetchConnection) => {
          conn.subscriptionBuilder()
            .onApplied(() => {
              const row = Array.from(conn.db.site.iter())[0] as unknown as { centerLat: unknown; centerLon: unknown; radiusM: unknown } | undefined;
              if (!row) { finish(new Error('The site table did not return a site row.')); return; }
              const center = { lat: Number(row.centerLat), lon: Number(row.centerLon) };
              const radiusM = Number(row.radiusM);
              if (!Number.isFinite(center.lat) || !Number.isFinite(center.lon) || !Number.isFinite(radiusM) || radiusM <= 0) {
                finish(new Error('The site row has invalid map coordinates.'));
                return;
              }
              finish(undefined, { center, radiusM });
            })
            .onError((_context: unknown, error: Error) => finish(error))
            .subscribe(tables.site);
        })
        .onConnectError((_context: unknown, error: Error) => finish(error))
        .onDisconnect((_context: unknown, error?: Error) => { if (error) finish(error); })
        .build();
    } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
  });
}

if (process.argv[1]?.endsWith('prefetch.ts')) {
  try {
    const values = process.argv.slice(2);
    const input = values.length ? args(values) : await readSiteCenter(process.env.STDB_URI ?? '', process.env.STDB_DATABASE ?? '');
    if (!values.length && (!process.env.STDB_URI || !process.env.STDB_DATABASE)) throw new Error('Set STDB_URI and STDB_DATABASE, or pass --lat --lon --radius.');
    const source = (process.env.TILE_SOURCE ?? 'esri-dark') as TileSourceName;
    const result = await prefetchTiles({ ...input, sourceName: source, directory: resolve(process.env.TILE_CACHE_DIR ?? 'tiles'), cartoKey: process.env.CARTO_KEY });
    console.log(`tiles z${result.zoom}: ${result.saved}/${result.requested} cached, ${result.missing} unavailable`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
