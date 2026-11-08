// Pure conversion from live binding rows to the bridge-to-robot JSON lines (robot.md 9.4).
// u64 bigint to JSON number (ids stay below 2^53), optionals to null, tagged enums to their
// contract string, Timestamps to ISO 8601 UTC, and camelCase fields to the contract snake_case.

import type { Timestamp } from 'spacetimedb';
import type { Mission, Site } from '../../../backend/spacetimedb-bindings/types.js';
import { toContractEnum, type EnumName } from './enums.ts';

export function u64ToNumber(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(`u64 ${value} does not fit a JSON number`);
  return Number(value);
}

export function optional<T>(value: T | undefined | null): T | null {
  return value === undefined || value === null ? null : value;
}

export function enumToContract(name: EnumName, value: { tag: string }): string {
  return toContractEnum(name, value.tag);
}

export function timestampToIso(value: Timestamp): string {
  return value.toDate().toISOString();
}

export interface WireMission {
  id: number;
  chain_id: number;
  robot_id: string;
  kind: string;
  target_cell_ids: number[];
  target_lat: number | null;
  target_lon: number | null;
  status: string;
  lease_expires_at: string | null;
  created_by: string;
  reason: string;
  created_at: string;
  updated_at: string;
}

export function missionToWire(row: Mission): WireMission {
  return {
    id: u64ToNumber(row.id),
    chain_id: u64ToNumber(row.chainId),
    robot_id: row.robotId,
    kind: enumToContract('mission_kind', row.kind),
    target_cell_ids: row.targetCellIds.map(u64ToNumber),
    target_lat: optional(row.targetLat),
    target_lon: optional(row.targetLon),
    status: enumToContract('mission_status', row.status),
    lease_expires_at: row.leaseExpiresAt ? timestampToIso(row.leaseExpiresAt) : null,
    created_by: row.createdBy,
    reason: row.reason,
    created_at: timestampToIso(row.createdAt),
    updated_at: timestampToIso(row.updatedAt),
  };
}

export function missionMessage(row: Mission): { type: 'mission'; mission: WireMission } {
  return { type: 'mission', mission: missionToWire(row) };
}

export function cancelMessage(missionId: bigint): { type: 'cancel'; mission_id: number } {
  return { type: 'cancel', mission_id: u64ToNumber(missionId) };
}

export interface SiteMessage {
  type: 'site';
  demo_mode: boolean;
  site: { id: number; center_lat: number; center_lon: number; radius_m: number };
}

export function siteMessage(row: Site): SiteMessage {
  return {
    type: 'site',
    demo_mode: row.demoMode,
    site: { id: u64ToNumber(row.id), center_lat: row.centerLat, center_lon: row.centerLon, radius_m: row.radiusM },
  };
}

/** The site the robot should use: the newest one (highest id). */
export function currentSite(rows: Iterable<Site>): Site | undefined {
  let best: Site | undefined;
  for (const row of rows) if (!best || row.id > best.id) best = row;
  return best;
}
