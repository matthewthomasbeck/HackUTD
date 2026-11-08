import type { Row } from './types.js';
export function tier(s: Row): number {
  if (['immediate', 'unknown'].includes(s.critical_level) || ['not_detected', 'unknown'].includes(s.breathing)) return 0;
  return 1;
}
export function ranked(rows: Row[]) {
  return [...rows].sort((a, b) => tier(a) - tier(b) || b.critical_score - a.critical_score || Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id);
}
