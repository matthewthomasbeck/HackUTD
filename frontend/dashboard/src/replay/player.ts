export function advanceReplayTime(currentMs: number, elapsedMs: number, speed: number, endMs: number): number {
  return Math.min(endMs, Math.max(0, currentMs + Math.max(0, elapsedMs) * Math.max(0, speed)));
}

export function formatReplayTime(milliseconds: number): string {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
