import 'dotenv/config';
import { resolve } from 'node:path';
import type { TileSourceName } from './tiles/source.js';

export interface Config {
  host: string;
  port: number;
  fakeDb: boolean;
  stdbUri?: string;
  stdbDatabase?: string;
  tokenDirectory: string;
  rescuersFile: string;
  primaryGraceMs: number;
  tileSource: TileSourceName;
  siteGeometryFile: string;
  tileCacheDirectory: string;
  cartoKey?: string;
  perceptionUrl: string;
  askMaxSeconds: number;
  demoSpeedMps: number;
  demoStartBearingDeg: number;
  demoStartDistanceM: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const fakeDb = env.FAKE_DB === '1';
  if (!fakeDb && (!env.STDB_URI || !env.STDB_DATABASE)) {
    throw new Error('Set STDB_URI and STDB_DATABASE, or use FAKE_DB=1 for the fixture service.');
  }
  const primaryGraceMs = Number(env.PRIMARY_GRACE_MS ?? 0);
  if (!Number.isInteger(primaryGraceMs) || primaryGraceMs < 0) throw new Error('PRIMARY_GRACE_MS must be a non-negative integer.');
  const tileSource = env.TILE_SOURCE ?? 'vector';
  if (!['vector', 'esri-dark', 'carto-dark', 'osm-inverted', 'none'].includes(tileSource)) throw new Error('TILE_SOURCE must be vector, esri-dark, carto-dark, osm-inverted, or none.');
  if (tileSource === 'carto-dark' && !env.CARTO_KEY?.trim()) throw new Error('CARTO_KEY is required when TILE_SOURCE=carto-dark.');
  const askMaxSeconds = Number(env.ASK_MAX_S ?? 8);
  if (!Number.isFinite(askMaxSeconds) || askMaxSeconds <= 0 || askMaxSeconds > 8) throw new Error('ASK_MAX_S must be greater than zero and no more than 8.');
  const demoSpeedMps = Number(env.DEMO_SPEED_MPS ?? 12);
  const demoStartBearingDeg = Number(env.DEMO_START_BEARING_DEG ?? 158);
  const demoStartDistanceM = Number(env.DEMO_START_DISTANCE_M ?? 92);
  if (!Number.isFinite(demoSpeedMps) || demoSpeedMps <= 0 || !Number.isFinite(demoStartBearingDeg) || !Number.isFinite(demoStartDistanceM) || demoStartDistanceM < 0) throw new Error('Invalid demo walker configuration.');
  return {
    host: env.HOST ?? '0.0.0.0',
    port: Number(env.PORT ?? 8787),
    fakeDb,
    ...(env.STDB_URI ? { stdbUri: env.STDB_URI } : {}),
    ...(env.STDB_DATABASE ? { stdbDatabase: env.STDB_DATABASE } : {}),
    tokenDirectory: resolve(env.TOKEN_DIRECTORY ?? '.tokens'),
    rescuersFile: resolve(env.RESCUERS_FILE ?? 'rescuers.json'),
    primaryGraceMs,
    tileSource: tileSource as TileSourceName,
    siteGeometryFile: resolve(env.SITE_GEOMETRY_FILE ?? 'site/site.geojson'),
    tileCacheDirectory: resolve(env.TILE_CACHE_DIR ?? 'tiles'),
    ...(env.CARTO_KEY?.trim() ? { cartoKey: env.CARTO_KEY.trim() } : {}),
    perceptionUrl: env.PERCEPTION_URL ?? 'http://localhost:8080',
    askMaxSeconds,
    demoSpeedMps,
    demoStartBearingDeg,
    demoStartDistanceM,
  };
}
