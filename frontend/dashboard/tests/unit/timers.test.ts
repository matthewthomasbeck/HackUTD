import { describe, expect, it } from 'vitest';
import { buildTimerItems, countdownForDueAt, timerText } from '../../src/model/timers';
import type { BoardState } from '../../src/data/BoardData';

describe('countdownForDueAt', () => {
  it('marks schedule table countdowns and the expiring and expired states', () => {
    expect(countdownForDueAt(10_000, 6_000)).toMatchObject({ source: 'SCHEDULE TABLE', remainingMs: 4_000, state: 'expiring' });
    expect(countdownForDueAt(10_000, 10_000)).toMatchObject({ remainingMs: 0, state: 'expired' });
  });
});

describe('buildTimerItems', () => {
  it('uses the schedule row for escalation and a derived source when it is missing', () => {
    const base = {
      now: 8_000,
      site: { id: 1n, escalateAfterS: 10 },
      survivors: [{ id: 41n, siteId: 1n, criticalLevel: { tag: 'Immediate' }, status: { tag: 'Unassigned' }, createdAt: 0 }],
      assignments: [], missions: [], agentTasks: [], participants: [], robots: [],
      timers: { leases: [], heartbeats: [], escalations: [], agentWatchdogs: [] },
    } as unknown as BoardState;
    const fallback = buildTimerItems(base);
    expect(fallback).toContainEqual(expect.objectContaining({ id: 'escalation:41', source: 'DERIVED', remainingMs: 2_000 }));
    expect(timerText(fallback[0])).toContain('escalate #41 to everyone, 2 s');

    const scheduled = buildTimerItems({ ...base, timers: { ...base.timers, escalations: [{ survivorId: 41n, level: 2, dueAt: 12_000 }] } } as unknown as BoardState);
    expect(scheduled).toContainEqual(expect.objectContaining({ id: 'escalation:41', source: 'SCHEDULE TABLE', remainingMs: 4_000 }));
    expect(scheduled[0].label).toContain('to commander and everyone');
  });
});
