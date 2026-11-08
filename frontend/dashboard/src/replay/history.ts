export type ReplaySource = 'event_log' | 'agent_action' | 'detection' | 'briefing' | 'person_report';

export interface ReplayInputRow {
  id: bigint | number | string;
  kind: string;
  entity?: string;
  entityId?: bigint | number | string;
  message?: string;
  payloadJson?: string;
  createdAtMs: number;
  source: ReplaySource;
  row?: unknown;
}

export interface ReplayHistoryItem extends ReplayInputRow {
  id: string;
  entityId: string;
}

export function buildHistory(rows: readonly ReplayInputRow[]): ReplayHistoryItem[] {
  return rows.map((row) => ({
    ...row,
    id: String(row.id),
    entityId: String(row.entityId ?? ''),
  })).sort((a, b) => a.createdAtMs - b.createdAtMs || compareIds(a.id, b.id) || a.source.localeCompare(b.source));
}

function compareIds(left: string, right: string): number {
  try {
    const a = BigInt(left);
    const b = BigInt(right);
    return a < b ? -1 : a > b ? 1 : 0;
  } catch {
    return left.localeCompare(right);
  }
}
