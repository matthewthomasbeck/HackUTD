import { describe, expect, it } from 'vitest';
import { formatCountdown, formatDuration, timestampToMs } from '../../src/stdb/time';

describe('time display helpers', () => {
  it('converts SpacetimeDB timestamps from microseconds and formats durations', () => {
    expect(timestampToMs({ microsSinceUnixEpoch: 1_234_000n })).toBe(1_234);
    expect(formatDuration(65_000)).toBe('1:05');
    expect(formatCountdown(4_001)).toBe('5 s');
  });
});
