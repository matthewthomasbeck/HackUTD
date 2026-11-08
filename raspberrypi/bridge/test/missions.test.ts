import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Timestamp } from 'spacetimedb';
import type { Mission } from '../../../backend/spacetimedb-bindings/types.js';
import { MissionLink } from '../src/missions.ts';

const T = Timestamp.fromDate(new Date('2026-11-08T15:00:00Z'));

function mission(id: bigint, status: string, robotId = 'dog1'): Mission {
  return {
    id, chainId: 0n, robotId, kind: { tag: 'Inspect' }, targetCellIds: [], targetLat: 1, targetLon: 2,
    status: { tag: status } as Mission['status'], leaseExpiresAt: undefined, createdBy: 'coordinator',
    reason: 'check house 3', createdAt: T, updatedAt: T,
  };
}

function setup() {
  const state = { ready: true, client: true, claims: 0 };
  const sent: Array<{ type: string; [key: string]: unknown }> = [];
  const rows = new Map<bigint, Mission>();
  const link = new MissionLink({
    robotId: 'dog1',
    sendToRobot: (message) => {
      if (!state.client) return false;
      sent.push(message as { type: string });
      return true;
    },
    claim: async () => { state.claims += 1; },
    isReady: () => state.ready,
    isClientConnected: () => state.client,
    missions: () => rows.values(),
    log: () => {},
  });
  const upsert = (row: Mission) => {
    const old = rows.get(row.id);
    rows.set(row.id, row);
    if (old) link.onMissionUpdate(old, row);
    else link.onMissionInsert(row);
  };
  const remove = (id: bigint) => {
    const old = rows.get(id)!;
    rows.delete(id);
    link.onMissionDelete(old);
  };
  const cancels = () => sent.filter((m) => m.type === 'cancel').map((m) => m.mission_id);
  const forwards = () => sent.filter((m) => m.type === 'mission').map((m) => (m.mission as { id: number }).id);
  return { state, sent, link, upsert, remove, cancels, forwards };
}

test('claims only when connected, READY, no current mission, and the C++ client is connected', async () => {
  const { state, link, upsert } = setup();
  assert.equal(await link.tick(), false); // no heartbeat yet
  link.onHeartbeat('ACTIVE');
  assert.equal(await link.tick(), false);
  link.onHeartbeat('READY');
  state.ready = false;
  assert.equal(await link.tick(), false);
  state.ready = true;
  state.client = false;
  assert.equal(await link.tick(), false);
  state.client = true;
  assert.equal(await link.tick(), true);
  assert.equal(state.claims, 1);
  upsert(mission(1n, 'Leased'));
  assert.equal(await link.tick(), false); // a mission is current
  assert.equal(state.claims, 1);
});

test('a leased mission is forwarded once, and claiming resumes after it is done', async () => {
  const { state, sent, link, upsert } = setup();
  link.onHeartbeat('READY');
  upsert(mission(1n, 'Leased'));
  upsert({ ...mission(1n, 'Leased'), reason: 'lease renewed' });
  assert.equal(sent.filter((m) => m.type === 'mission').length, 1);
  assert.equal((sent[0]!.mission as { status: string; kind: string }).status, 'leased');
  upsert(mission(1n, 'Active'));
  assert.equal(link.currentMissionId, 1n);
  upsert(mission(1n, 'Done'));
  assert.equal(link.currentMissionId, undefined);
  assert.equal(await link.tick(), true);
  assert.equal(state.claims, 1);
});

test('missions for another robot or any robot are not forwarded', () => {
  const { sent, upsert } = setup();
  upsert(mission(1n, 'Leased', 'dog2'));
  upsert(mission(2n, 'Queued', ''));
  assert.equal(sent.length, 0);
});

test('a mission changing to cancelled is forwarded as cancel, once', () => {
  const { sent, link, upsert } = setup();
  upsert(mission(1n, 'Leased'));
  upsert(mission(1n, 'Cancelled'));
  upsert({ ...mission(1n, 'Cancelled'), reason: 'again' });
  assert.deepEqual(sent.filter((m) => m.type === 'cancel'), [{ type: 'cancel', mission_id: 1 }]);
  assert.equal(link.currentMissionId, undefined);
});

test('an already-cancelled row in the first subscription is not forwarded', () => {
  const { sent, upsert } = setup();
  upsert(mission(1n, 'Cancelled'));
  assert.equal(sent.length, 0);
});

test('a lease that expires and is re-leased is cancelled on the robot, then forwarded again', async () => {
  const { state, link, upsert, cancels, forwards } = setup();
  link.onHeartbeat('ACTIVE');
  upsert(mission(1n, 'Leased'));
  upsert(mission(1n, 'Active'));
  upsert(mission(1n, 'Queued', '')); // lease expired, requeued
  assert.deepEqual(cancels(), [1]);
  assert.equal(link.currentMissionId, undefined);
  link.onHeartbeat('READY'); // the robot obeyed the cancel
  assert.equal(await link.tick(), true);
  assert.equal(state.claims, 1);
  upsert(mission(1n, 'Leased')); // the claim re-leased the same row
  assert.deepEqual(forwards(), [1, 1]);
  assert.equal(link.currentMissionId, 1n);
});

test('a forwarded mission that is deleted or reassigned out of the subscription is cancelled', () => {
  const { upsert, remove, cancels, link } = setup();
  upsert(mission(1n, 'Leased'));
  remove(1n);
  upsert(mission(2n, 'Leased'));
  upsert(mission(2n, 'Leased', 'dog2'));
  upsert(mission(3n, 'Proposed', ''));
  remove(3n); // never forwarded: no cancel
  assert.deepEqual(cancels(), [1, 2]);
  assert.equal(link.currentMissionId, undefined);
});

test('a mission the robot finished as done or failed is not cancelled', () => {
  const { upsert, cancels } = setup();
  upsert(mission(1n, 'Leased'));
  upsert(mission(1n, 'Done'));
  upsert(mission(2n, 'Leased'));
  upsert(mission(2n, 'Failed'));
  assert.deepEqual(cancels(), []);
});

test('a cancel that could not be sent waits and goes out when the client connects, before any mission', () => {
  const { state, sent, link, upsert, cancels } = setup();
  upsert(mission(1n, 'Leased'));
  state.client = false;
  upsert(mission(1n, 'Cancelled'));
  assert.deepEqual(link.cancelsPending, [1n]);
  upsert(mission(2n, 'Leased'));
  state.client = true;
  link.onClientConnected();
  assert.deepEqual(cancels(), [1]);
  assert.deepEqual(link.cancelsPending, []);
  assert.deepEqual(sent.slice(-2).map((m) => m.type), ['cancel', 'mission']);
});

test('after a bridge restart an active row arrives as an insert and is forwarded when the robot says READY', () => {
  const { link, upsert, forwards } = setup();
  link.onHeartbeat('READY');
  upsert(mission(1n, 'Active')); // first subscription after the restart
  assert.deepEqual(forwards(), []);
  assert.equal(link.currentMissionId, 1n);
  link.onHeartbeat('READY');
  assert.deepEqual(forwards(), [1]);
  link.onHeartbeat('READY'); // once per client session
  assert.deepEqual(forwards(), [1]);
});

test('a mission leased while no client is connected is sent when the client connects', () => {
  const { state, sent, link, upsert } = setup();
  state.client = false;
  upsert(mission(1n, 'Leased'));
  assert.equal(sent.length, 0);
  state.client = true;
  link.onClientConnected();
  assert.equal(sent.filter((m) => m.type === 'mission').length, 1);
});
