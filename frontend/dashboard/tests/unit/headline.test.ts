import { describe, expect, it } from 'vitest';
import { countUnattendedImmediate } from '../../src/model/headline';

const survivor = (id: bigint, createdAt: number, criticalLevel = 'immediate', status = 'unassigned') => ({
  id, siteId: 4n, criticalLevel, status, createdAt,
});

describe('countUnattendedImmediate', () => {
  it('counts only immediate unassigned survivors more than 60 seconds unattended', () => {
    const survivors = [survivor(1n, 0), survivor(2n, 1_000), survivor(3n, 0, 'delayed'), survivor(4n, 0, 'immediate', 'assigned')];
    const timers = [{ survivorId: 1n, since: 0 }, { survivorId: 2n, since: 1_000 }];

    expect(countUnattendedImmediate(survivors, timers, 60_000, 4n)).toBe(0);
    expect(countUnattendedImmediate(survivors, timers, 61_001, 4n)).toBe(2);
  });

  it('uses the escalation timer start and does not treat proposal status as attended', () => {
    const proposed = { ...survivor(9n, 0), status: 'unassigned', proposedAssignment: true };

    expect(countUnattendedImmediate([proposed], [{ survivorId: 9n, since: 0 }], 60_001, 4n)).toBe(1);
  });

  it('derives the latest unattended start from releases and immediate scoring events', () => {
    const target = survivor(12n, 0);
    const events = [
      { kind: 'score_changed', entity: 'survivor', entityId: 12n, createdAt: 10_000, payloadJson: '{"before":{"critical_level":"unknown"},"after":{"critical_level":"immediate"}}' },
      { kind: 'assignment_released', entity: 'assignment', entityId: 4n, createdAt: 20_000, payloadJson: '{"after":{"survivor":{"id":"12","status":"unassigned"}}}' },
      { kind: 'score_changed', entity: 'survivor', entityId: 12n, createdAt: 30_000, payloadJson: '{"before":{"critical_level":"immediate","critical_score":80},"after":{"critical_level":"immediate","critical_score":87}}' },
    ];

    expect(countUnattendedImmediate([target], [], 79_000, 4n, events)).toBe(0);
    expect(countUnattendedImmediate([target], [], 80_001, 4n, events)).toBe(1);
  });
});
