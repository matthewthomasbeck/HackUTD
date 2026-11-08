// Pure mapping from one local NDJSON message (robot.md 9.3) to one reducer call.
// No I/O here: media uploads happen first (media.ts) and their URLs are passed in.
// Field names on the wire are the contract snake_case names; reducer arguments are the
// generated camelCase names. Ids become bigint, enums become binding tags, observed_at
// (ISO 8601 UTC) becomes a Timestamp, and seq is dropped.

import { Timestamp } from 'spacetimedb';
import type { DbConnection } from '../../../backend/spacetimedb-bindings/index.js';
import { toBindingEnum, type EnumName } from './enums.ts';

type Reducers = DbConnection['reducers'];

export const ROBOT_REDUCERS = [
  'robotHeartbeat',
  'robotReportPosition',
  'robotReportDevice',
  'markCell',
  'missionProgress',
  'reportDetection',
  'reportTerrain',
] as const;

export type ReducerName = (typeof ROBOT_REDUCERS)[number];
export type ReducerArgs<R extends ReducerName> = Parameters<Reducers[R]>[0];
export type ReducerCall = { [R in ReducerName]: { reducer: R; args: ReducerArgs<R> } }[ReducerName];

export const LOCAL_TYPES = ['heartbeat', 'position', 'device', 'cell', 'mission_progress', 'detection', 'terrain'] as const;
export type LocalType = (typeof LOCAL_TYPES)[number];

export interface LocalMessage {
  type: string;
  seq?: number;
  observed_at?: string;
  [key: string]: unknown;
}

export interface DetectionUrls {
  thermal_image_url?: string;
  camera_image_url?: string;
  breathing_clip_url?: string;
}

export interface MediaUrls {
  detection?: DetectionUrls;
  terrain_image_url?: string;
}

export type MapResult =
  | { kind: 'call'; call: ReducerCall; warnings: string[] }
  | { kind: 'local_only'; reason: string };

export class MappingError extends Error {
  override get name(): string { return 'MappingError'; }
}

export function isLocalType(type: unknown): type is LocalType {
  return typeof type === 'string' && (LOCAL_TYPES as readonly string[]).includes(type);
}

const ISO_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:?\d{2})$/;

/**
 * ISO 8601 with a zone (Z or +hh:mm) to a SpacetimeDB Timestamp, keeping microseconds
 * (Date.parse alone would drop them). Returns undefined for anything else.
 */
export function isoToTimestamp(iso: unknown): Timestamp | undefined {
  if (typeof iso !== 'string') return undefined;
  const match = ISO_PATTERN.exec(iso);
  if (!match) return undefined;
  const [, whole, fraction = '', zone] = match;
  const millis = Date.parse(`${whole}${zone}`);
  if (Number.isNaN(millis)) return undefined;
  const micros = BigInt(fraction.padEnd(6, '0').slice(0, 6));
  return new Timestamp(BigInt(millis) * 1000n + micros);
}

class Reader {
  constructor(private readonly msg: LocalMessage) {}

  private has(key: string): boolean {
    return this.msg[key] !== undefined && this.msg[key] !== null;
  }

  string(key: string, fallback?: string): string {
    const value = this.msg[key];
    if (typeof value === 'string') return value;
    if (!this.has(key) && fallback !== undefined) return fallback;
    throw new MappingError(`${this.msg.type}: ${key} must be a string`);
  }

  optionalString(key: string): string | undefined {
    if (!this.has(key)) return undefined;
    return this.string(key);
  }

  number(key: string): number {
    const value = this.msg[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    throw new MappingError(`${this.msg.type}: ${key} must be a finite number`);
  }

  optionalNumber(key: string): number | undefined {
    if (!this.has(key)) return undefined;
    return this.number(key);
  }

  bool(key: string): boolean {
    const value = this.msg[key];
    if (typeof value === 'boolean') return value;
    throw new MappingError(`${this.msg.type}: ${key} must be a boolean`);
  }

  /** u64 id as bigint. Accepts a JSON number (ids stay below 2^53) or a decimal string. */
  id(key: string): bigint {
    const value = this.msg[key];
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
    if (typeof value === 'string' && /^\d{1,20}$/.test(value)) return BigInt(value);
    throw new MappingError(`${this.msg.type}: ${key} must be a non-negative integer id`);
  }

  enumValue<E extends EnumName>(key: string, name: E) {
    const value = toBindingEnum(name, this.msg[key]);
    if (!value) throw new MappingError(`${this.msg.type}: ${key} has unknown ${name} value ${JSON.stringify(this.msg[key])}`);
    return value;
  }

  hasLatLon(): boolean {
    return this.has('lat') && this.has('lon');
  }
}

/** Local test messages (mission_id 0, from robotctl) are logged by the bridge, never sent. */
export function localOnlyReason(msg: LocalMessage): string | undefined {
  if ((msg.type === 'mission_progress' || msg.type === 'detection') && (msg.mission_id === 0 || msg.mission_id === '0')) {
    return 'mission_id 0 is a local test mission';
  }
  if ((msg.type === 'position' || msg.type === 'terrain') && !new Reader(msg).hasLatLon()) {
    return `${msg.type} has no lat/lon (location mode unknown)`;
  }
  return undefined;
}

/**
 * Map one local message to its reducer call. Throws MappingError for an unknown type or a bad
 * field, so the caller logs and skips it (a malformed message is a rejection, not a network error).
 */
export function mapMessage(msg: LocalMessage, media: MediaUrls = {}): MapResult {
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') throw new MappingError('message has no type');
  if (!isLocalType(msg.type)) throw new MappingError(`unknown message type ${JSON.stringify(msg.type)}`);
  const localOnly = localOnlyReason(msg);
  if (localOnly) return { kind: 'local_only', reason: localOnly };

  const r = new Reader(msg);
  const warnings: string[] = [];
  let observedAt: Timestamp | undefined;
  if (msg.observed_at !== undefined && msg.observed_at !== null) {
    observedAt = isoToTimestamp(msg.observed_at);
    // A bad clock string should not cost a detection: send with server time and say so.
    if (!observedAt) warnings.push(`${msg.type}: observed_at ${JSON.stringify(msg.observed_at)} is not ISO 8601 UTC; using server time`);
  }

  const call = ((): ReducerCall => {
    switch (msg.type as LocalType) {
      case 'heartbeat':
        return {
          reducer: 'robotHeartbeat',
          args: {
            robotId: r.string('robot_id'),
            state: r.enumValue('state', 'robot_state'),
            batteryPct: r.optionalNumber('battery_pct'),
            observedAt,
          },
        };
      case 'position':
        return {
          reducer: 'robotReportPosition',
          args: {
            robotId: r.string('robot_id'),
            lat: r.number('lat'),
            lon: r.number('lon'),
            gpsFix: r.bool('gps_fix'),
            indoorOffsetM: r.optionalNumber('indoor_offset_m'),
            headingDeg: r.optionalNumber('heading_deg'),
            observedAt,
          },
        };
      case 'device':
        return {
          reducer: 'robotReportDevice',
          args: {
            robotId: r.string('robot_id'),
            device: r.string('device'),
            status: r.enumValue('status', 'device_health'),
            detail: r.string('detail', ''),
            observedAt,
          },
        };
      case 'cell':
        // note is logged by the bridge only; mark_cell has no note argument.
        return {
          reducer: 'markCell',
          args: { cellId: r.id('cell_id'), status: r.enumValue('status', 'cell_status'), observedAt },
        };
      case 'mission_progress':
        return {
          reducer: 'missionProgress',
          args: {
            missionId: r.id('mission_id'),
            status: r.enumValue('status', 'mission_status'),
            note: r.string('note', ''),
            observedAt,
          },
        };
      case 'detection': {
        const urls = media.detection ?? {};
        return {
          reducer: 'reportDetection',
          args: {
            robotId: r.string('robot_id'),
            missionId: r.id('mission_id'),
            source: r.enumValue('source', 'detection_source'),
            clientRef: r.string('client_ref'),
            lat: r.number('lat'),
            lon: r.number('lon'),
            gpsFix: r.bool('gps_fix'),
            locationNote: r.string('location_note', ''),
            maxTempC: r.optionalNumber('max_temp_c'),
            thermalConfidence: r.number('thermal_confidence'),
            thermalImageUrl: urls.thermal_image_url,
            cameraImageUrl: urls.camera_image_url,
            breathingClipUrl: urls.breathing_clip_url,
            observedAt,
          },
        };
      }
      case 'terrain':
        return {
          reducer: 'reportTerrain',
          args: {
            robotId: r.string('robot_id'),
            lat: r.number('lat'),
            lon: r.number('lon'),
            terrainClass: r.enumValue('terrain_class', 'terrain_class'),
            confidence: r.number('confidence'),
            source: r.string('source'),
            action: r.enumValue('action', 'terrain_action'),
            imageUrl: media.terrain_image_url,
            observedAt,
          },
        };
    }
  })();
  return { kind: 'call', call, warnings };
}

/** The local file paths a detection carries, by media kind. `clip_path` is the CONTRACTS.md name. */
export function detectionPaths(msg: LocalMessage): { thermal?: string; camera?: string; clip?: string } {
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = msg[key];
      if (typeof value === 'string' && value !== '') return value;
    }
    return undefined;
  };
  return {
    thermal: pick('thermal_image_path'),
    camera: pick('camera_image_path'),
    clip: pick('breathing_clip_path', 'clip_path'),
  };
}
