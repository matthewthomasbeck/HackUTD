import { describe, expect, it } from 'vitest';
import { buildHistory, type ReplayInputRow } from '../../src/replay/history';
import { buildReplayTimeline, foldReplayAt } from '../../src/replay/fold';
import { advanceReplayTime, formatReplayTime } from '../../src/replay/player';

const row = (id: bigint, kind: string, time: number, payloadJson: string): ReplayInputRow => ({
  id, kind, entity: 'survivor', entityId: 7n, message: kind,
  payloadJson, createdAtMs: time, source: 'event_log',
});

describe('buildHistory', () => {
  it('sorts replay items by creation time and then id across sources', () => {
    const history = buildHistory([
      row(8n, 'later', 2_000, '{}'),
      { ...row(9n, 'same-time-high', 1_000, '{}'), source: 'agent_action' },
      row(3n, 'same-time-low', 1_000, '{}'),
    ]);
    expect(history.map((item) => item.kind)).toEqual(['same-time-low', 'same-time-high', 'later']);
  });
});

describe('foldReplayAt', () => {
  it('folds partial after payloads from the run snapshot and counts malformed events', () => {
    const history = buildHistory([
      row(1n, 'run_started', 1_000, JSON.stringify({ after: { snapshot: { survivor: [{ id: '7', status: 'unassigned', critical_score: 10 }] } } })),
      row(2n, 'score_changed', 2_000, JSON.stringify({ after: { critical_score: 85 } })),
      row(3n, 'status-change', 3_000, '{broken'),
    ]);
    const timeline = buildReplayTimeline(history, 1_000, 3_000);
    const atTwo = foldReplayAt(timeline, 2_000);
    expect(atTwo.entities.get('survivor')?.get('7')).toMatchObject({ critical_score: 85, status: 'unassigned' });
    expect(atTwo.malformedCount).toBe(0);
    expect(foldReplayAt(timeline, 3_000).malformedCount).toBe(1);
  });

  it('reopens searched cells from cell_reopened history', () => {
    const history = buildHistory([
      row(1n, 'run_started', 1_000, JSON.stringify({ after: { snapshot: { search_cell: [{ id: '4', status: 'searched' }] } } })),
      { ...row(2n, 'cell_reopened', 2_000, JSON.stringify({ after: { status: 'unsearched' } })), entity: 'search_cell', entityId: 4n },
    ]);
    const state = foldReplayAt(buildReplayTimeline(history, 1_000, 2_000), 2_000);
    expect(state.entities.get('search_cell')?.get('4')?.status).toBe('unsearched');
  });

  it('folds robot lifecycle events by robot id even when the log entity id is zero', () => {
    const history = buildHistory([
      row(1n, 'run_started', 1_000, JSON.stringify({ after: { snapshot: { robot: [{ robot_id: 'dog-1', online: true, state: 'ready' }] } } })),
      { ...row(2n, 'robot_offline', 2_000, JSON.stringify({ after: { online: false } })), entity: 'robot', entityId: 0n, message: 'dog-1 offline' },
      { ...row(3n, 'robot_online', 3_000, '{}'), entity: 'robot', entityId: 0n, message: 'dog-1 online' },
    ]);
    const timeline = buildReplayTimeline(history, 1_000, 3_000, 1_000);
    expect(foldReplayAt(timeline, 2_500).entities.get('robot')?.get('dog-1')?.online).toBe(false);
    expect(foldReplayAt(timeline, 3_000).entities.get('robot')?.get('dog-1')?.online).toBe(true);
    expect(timeline.snapshots.length).toBeGreaterThan(1);
  });

  it('counts valid JSON with an invalid payload shape as unreadable', () => {
    const history = buildHistory([row(1n, 'note', 1_000, 'null')]);
    expect(() => foldReplayAt(buildReplayTimeline(history, 1_000, 1_000), 1_000)).not.toThrow();
    expect(foldReplayAt(buildReplayTimeline(history, 1_000, 1_000), 1_000).malformedCount).toBe(1);
  });
});

describe('replay player', () => {
  it('advances by elapsed time times speed and clamps at duration', () => {
    expect(advanceReplayTime(500, 250, 4, 2_000)).toBe(1_500);
    expect(advanceReplayTime(1_900, 250, 4, 2_000)).toBe(2_000);
  });

  it('formats replay time as elapsed minutes and seconds', () => {
    expect(formatReplayTime(125_000)).toBe('2:05');
  });
});
