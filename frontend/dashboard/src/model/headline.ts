import { enumTagToContract } from '../stdb/enums';
import { timestampToMs } from '../stdb/time';
import type { EscalationSince, HeadlineSurvivor } from './types';

export const UNATTENDED_THRESHOLD_MS = 60_000;

export interface HeadlineEvent {
  kind: string;
  entity: string;
  entityId: bigint;
  createdAt: number | { microsSinceUnixEpoch: bigint };
  payloadJson: string;
}

function derivedUnattendedSince(survivor: HeadlineSurvivor, events: readonly HeadlineEvent[]): number {
  let latest = timestampToMs(survivor.createdAt);
  for (const event of events) {
    let payload: { before?: Record<string, unknown>; after?: Record<string, unknown> };
    try {
      payload = JSON.parse(event.payloadJson) as { before?: Record<string, unknown>; after?: Record<string, unknown> };
    } catch {
      continue;
    }
    const eventTime = timestampToMs(event.createdAt);
    if (event.kind === 'score_changed' && event.entity === 'survivor' && event.entityId === survivor.id
      && payload.after?.critical_level === 'immediate'
      && payload.before?.critical_level !== 'immediate') {
      latest = Math.max(latest, eventTime);
      continue;
    }
    if (event.kind !== 'assignment_released' && event.kind !== 'assignment_expired') continue;
    if (event.entity !== 'assignment') continue;
    const afterSurvivor = payload.after?.survivor as { id?: unknown; status?: unknown } | undefined;
    if (String(afterSurvivor?.id) === String(survivor.id) && afterSurvivor?.status === 'unassigned') {
      latest = Math.max(latest, eventTime);
    }
  }
  return latest;
}

export function countUnattendedImmediate(
  survivors: readonly HeadlineSurvivor[],
  escalationTimers: readonly EscalationSince[],
  nowMs: number,
  siteId: bigint,
  events: readonly HeadlineEvent[] = [],
): number {
  const sinceBySurvivor = new Map(escalationTimers.map((timer) => [timer.survivorId, timestampToMs(timer.since)]));

  return survivors.filter((survivor) => {
    if (survivor.siteId !== siteId) return false;
    if (enumTagToContract(survivor.criticalLevel) !== 'immediate') return false;
    if (enumTagToContract(survivor.status) !== 'unassigned') return false;
    const unattendedSince = sinceBySurvivor.get(survivor.id) ?? derivedUnattendedSince(survivor, events);
    return nowMs - unattendedSince > UNATTENDED_THRESHOLD_MS;
  }).length;
}
