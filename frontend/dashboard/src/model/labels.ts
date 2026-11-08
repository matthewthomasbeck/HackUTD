import { enumTagToContract } from '../stdb/enums';

export function breathingLabel(breathing: string, rateBpm: number | null, confidence: number): string {
  switch (breathing) {
    case 'detected':
      return `Breathing seen, ${rateBpm ?? 'unknown'} per min (confidence ${confidence.toFixed(2)})`;
    case 'not_detected':
      return 'No signs of life detected, low confidence';
    default:
      return 'Breathing not checked yet';
  }
}

export function survivorStatusLabel(statusValue: string | { tag: string }): string {
  const status = enumTagToContract(statusValue);
  const labels: Record<string, string> = {
    unassigned: 'UNASSIGNED, no rescuer',
    assigned: 'ASSIGNED, acknowledged',
    en_route: 'EN ROUTE',
    reached: 'REACHED',
    resolved: 'RESOLVED',
  };
  return labels[status] ?? 'STATUS UNKNOWN';
}

export function resolutionLabel(resolutionValue: string | { tag: string }): string {
  const resolution = enumTagToContract(resolutionValue);
  const labels: Record<string, string> = {
    rescued: 'rescued',
    handed_off: 'handed off',
    false_alarm: 'false alarm',
    duplicate: 'duplicate',
  };
  return `RESOLVED: ${labels[resolution] ?? 'unknown'}`;
}
