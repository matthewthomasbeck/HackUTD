export type TimestampLike = number | Date | { microsSinceUnixEpoch: bigint };

export function timestampToMs(value: TimestampLike): number {
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  return Number(value.microsSinceUnixEpoch / 1000n);
}

export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatCountdown(milliseconds: number): string {
  return `${Math.max(0, Math.ceil(milliseconds / 1000))} s`;
}
