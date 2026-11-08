import { describe, expect, it, vi } from 'vitest';
import { RescuerActions, type ReducerApi } from '../src/actions.js';
import type { DbSnapshot } from '../src/db.js';

const snapshot: DbSnapshot = {
  status: 'connected', identityHex: 'a'.repeat(64),
  assignments: [
    { id: 11, survivorId: 7, status: { Proposed: [] } },
    { id: 12, survivorId: 8, status: { Active: [] } },
    { id: 99, survivorId: 9, status: { Proposed: [] } },
  ], briefings: [], assignedSurvivors: [], criticalOpen: [], survivors: [], sites: [], robots: [], viewFallbacks: [], lastMessageAt: 0,
};

function fixture() {
  let now = 10_000;
  let primary = true;
  const reducers: ReducerApi = {
    registerParticipant: vi.fn(async () => undefined),
    rescuerHeartbeat: vi.fn(async () => undefined),
    participantUpdatePosition: vi.fn(async () => undefined),
    acceptAssignment: vi.fn(async () => undefined),
    releaseAssignment: vi.fn(async () => undefined),
    startEnRoute: vi.fn(async () => undefined),
    markReached: vi.fn(async () => undefined),
    resolveSurvivor: vi.fn(async () => undefined),
    rescuerAsk: vi.fn(async () => undefined),
  };
  const notice = vi.fn();
  const actions = new RescuerActions({ getReducers: () => reducers, hasPrimary: () => primary, onNotice: notice, now: () => now });
  actions.updateSnapshot(snapshot);
  return { actions, reducers, notice, setNow: (n: number) => { now = n; }, setPrimary: (v: boolean) => { primary = v; } };
}

describe('primary rescuer actions', () => {
  it('forwards heartbeat only from primary and no more often than every four seconds', async () => {
    const f = fixture();
    expect(await f.actions.heartbeat(false)).toBe(false);
    expect(await f.actions.heartbeat(true)).toBe(true);
    expect(await f.actions.heartbeat(true)).toBe(false);
    f.setNow(14_000);
    expect(await f.actions.heartbeat(true)).toBe(true);
    expect(f.reducers.rescuerHeartbeat).toHaveBeenCalledTimes(2);
  });

  it('applies position movement and freshness limits', async () => {
    const f = fixture();
    expect(await f.actions.position({ lat: 32.9857, lon: -96.7502 }, false)).toBe(false);
    expect(await f.actions.position({ lat: 32.9857, lon: -96.7502 }, true)).toBe(true);
    f.setNow(12_000);
    expect(await f.actions.position({ lat: 32.9857, lon: -96.7502 }, true)).toBe(false);
    f.setNow(15_000);
    expect(await f.actions.position({ lat: 32.9857, lon: -96.7502 }, true)).toBe(true);
    expect(f.reducers.participantUpdatePosition).toHaveBeenCalledTimes(2);
  });

  it('accepts only this rescuer’s proposed assignment and only once through the reducer action', async () => {
    const f = fixture();
    expect(await f.actions.acknowledge(99, true)).toBe(true);
    expect(await f.actions.acknowledge(12, true)).toBe(false);
    expect(await f.actions.acknowledge(99, true)).toBe(false);
    expect(f.reducers.acceptAssignment).toHaveBeenCalledTimes(1);
    expect(f.reducers.acceptAssignment).toHaveBeenCalledWith({ assignmentId: 99n });
  });

  it('checks ownership and primary session before phone actions', async () => {
    const f = fixture();
    expect(await f.actions.action({ action: 'release', assignment_id: 100 })).toMatchObject({ ok: false });
    expect(await f.actions.action({ action: 'reached', survivor_id: 7 })).toMatchObject({ ok: false });
    expect(await f.actions.action({ action: 'reached', survivor_id: 8 })).toEqual({ ok: true });
    expect(f.reducers.markReached).toHaveBeenCalledWith({ survivorId: 8n });
    expect(await f.actions.action({ action: 'release', assignment_id: 12 })).toEqual({ ok: true });
    expect(f.reducers.releaseAssignment).toHaveBeenCalledWith({ assignmentId: 12n });
    f.setPrimary(false);
    expect(await f.actions.action({ action: 'accept', assignment_id: 11 })).toMatchObject({ ok: false });
    expect(f.reducers.acceptAssignment).not.toHaveBeenCalled();
  });

  it('maps resolution labels to generated SpacetimeDB enum values', async () => {
    const f = fixture();
    expect(await f.actions.action({ action: 'resolve', survivor_id: 8, resolution: 'false_alarm', note: 'duplicate sensor hit' })).toEqual({ ok: true });
    expect(f.reducers.resolveSurvivor).toHaveBeenCalledWith({ survivorId: 8n, resolution: { tag: 'FalseAlarm' }, note: 'duplicate sensor hit' });
  });

  it('starts an accepted assignment en route after ten meters or thirty seconds', async () => {
    const f = fixture();
    await f.actions.position({ lat: 32.9857, lon: -96.7502 }, true);
    expect(await f.actions.acknowledge(11, true)).toBe(true);
    f.setNow(12_000);
    await f.actions.position({ lat: 32.9857, lon: -96.7498 }, true);
    expect(f.reducers.startEnRoute).toHaveBeenCalledWith({ assignmentId: 11n });
  });

  it('does not retry a rejected acknowledgement', async () => {
    const f = fixture();
    vi.mocked(f.reducers.acceptAssignment).mockRejectedValueOnce(new Error('lease expired'));
    expect(await f.actions.acknowledge(11, true)).toBe(false);
    expect(await f.actions.acknowledge(11, true)).toBe(false);
    expect(f.reducers.acceptAssignment).toHaveBeenCalledTimes(1);
    expect(f.notice).toHaveBeenCalledWith('lease expired', 5000);
  });

  it('posts only the transcript and media URL through the rescuer ask reducer', async () => {
    const f = fixture();
    expect(await f.actions.submitQuestion('check house 4', 'http://media/question.wav', false)).toBe(false);
    expect(await f.actions.submitQuestion(' check house 4 ', 'http://media/question.wav', true)).toBe(true);
    expect(f.reducers.rescuerAsk).toHaveBeenCalledWith({ text: 'check house 4', audioUrl: 'http://media/question.wav', survivorId: 8n });
  });
});
