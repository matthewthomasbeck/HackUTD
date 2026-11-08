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

// start_run accepts names of 1 to 40 characters (the module's checkName), so the site name is shortened to fit the time.
export const RUN_NAME_MAX = 40;
export function runName(siteName: string, at: Date): string {
  const time = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const suffix = ` · ${time}`;
  const room = RUN_NAME_MAX - suffix.length;
  const site = siteName.trim() || 'Run';
  return `${site.length > room ? `${site.slice(0, room - 1).trimEnd()}…` : site}${suffix}`;
}
