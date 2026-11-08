import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { TileCoord, TileSource } from './source.js';

export type FetchTile = (url: string, init?: RequestInit) => Promise<Response>;
export interface TileCacheOptions { directory: string; source: TileSource; fetchTile?: FetchTile }

export class TileCache {
  private readonly fetchTile: FetchTile;
  private readonly pending = new Map<string, Promise<Buffer | null>>();

  constructor(private readonly options: TileCacheOptions) { this.fetchTile = options.fetchTile ?? fetch; }

  async get(coord: TileCoord): Promise<Buffer | null> {
    const url = this.options.source.url(coord);
    if (!url) return null;
    const path = this.path(coord);
    try { return await readFile(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null; }
    const key = `${coord.z}/${coord.x}/${coord.y}`;
    const inflight = this.pending.get(key);
    if (inflight) return inflight;
    const promise = this.download(coord, url, path).finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }

  private async download(coord: TileCoord, url: string, path: string): Promise<Buffer | null> {
    try {
      const response = await this.fetchTile(url, { headers: this.options.source.headers, signal: AbortSignal.timeout(8000) });
      if (!response.ok) return null;
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length === 0 || data.length > 2_000_000) return null;
      await mkdir(resolve(path, '..'), { recursive: true });
      const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temp, data, { mode: 0o600 });
      await rename(temp, path);
      return data;
    } catch { return null; }
  }

  private path(coord: TileCoord): string {
    return resolve(this.options.directory, this.options.source.name, String(coord.z), String(coord.x), `${coord.y}.${this.options.source.extension}`);
  }
}
