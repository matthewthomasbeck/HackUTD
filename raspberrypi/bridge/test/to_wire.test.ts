import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Timestamp } from 'spacetimedb';
import { Identity } from 'spacetimedb';
import type { Mission, Site, Teleop } from '../../../backend/spacetimedb-bindings/types.js';
import { cancelMessage, currentSite, enumToContract, missionMessage, optional, siteMessage, teleopForward, timestampToIso, u64ToNumber } from '../src/to_wire.ts';

const T = Timestamp.fromDate(new Date('2026-11-08T15:00:00.000Z'));

function mission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 7n, chainId: 0n, robotId: 'dog1', kind: { tag: 'SearchCells' }, targetCellIds: [3n, 4n],
    targetLat: undefined, targetLon: undefined, status: { tag: 'Leased' }, leaseExpiresAt: T,
    createdBy: 'orchestrator', reason: 'unaccounted people in house 3', createdAt: T, updatedAt: T,
    ...overrides,
  };
}

test('bigint to number, and refuses values past 2^53', () => {
  assert.equal(u64ToNumber(42n), 42);
  assert.throws(() => u64ToNumber(2n ** 60n), RangeError);
});

test('optional to null', () => {
  assert.equal(optional(undefined), null);
  assert.equal(optional(0), 0);
});

test('enum to its contract string', () => {
  assert.equal(enumToContract('mission_kind', { tag: 'ReturnHome' }), 'return_home');
  assert.equal(enumToContract('robot_state', { tag: 'SafeStop' }), 'SAFE_STOP');
  assert.equal(enumToContract('device_health', { tag: 'Ok' }), 'OK');
  assert.throws(() => enumToContract('mission_kind', { tag: 'Patrol' }));
});

test('Timestamp to ISO', () => {
  assert.equal(timestampToIso(T), '2026-11-08T15:00:00.000Z');
});

test('mission row to the mission message', () => {
  assert.deepEqual(missionMessage(mission()), {
    type: 'mission',
    mission: {
      id: 7, chain_id: 0, robot_id: 'dog1', kind: 'search_cells', target_cell_ids: [3, 4],
      target_lat: null, target_lon: null, status: 'leased', lease_expires_at: '2026-11-08T15:00:00.000Z',
      created_by: 'orchestrator', reason: 'unaccounted people in house 3',
      created_at: '2026-11-08T15:00:00.000Z', updated_at: '2026-11-08T15:00:00.000Z',
    },
  });
  const inspect = missionMessage(mission({ kind: { tag: 'Inspect' }, targetCellIds: [], targetLat: 32.9, targetLon: -96.7, leaseExpiresAt: undefined }));
  assert.equal(inspect.mission.kind, 'inspect');
  assert.equal(inspect.mission.target_lat, 32.9);
  assert.equal(inspect.mission.lease_expires_at, null);
});

test('cancel and site messages', () => {
  assert.deepEqual(cancelMessage(9n), { type: 'cancel', mission_id: 9 });
  const site = (id: bigint, demo: boolean): Site => ({
    id, name: 'demo', centerLat: 32.98, centerLon: -96.75, radiusM: 483, demoMode: demo, requireMissionApproval: false,
    missionLeaseS: 15, assignmentLeaseS: 30, proposalLeaseS: 30, escalateAfterS: 45, createdAt: T,
  } as Site);
  const newest = currentSite([site(1n, false), site(2n, true)]);
  assert.ok(newest);
  assert.deepEqual(siteMessage(newest), { type: 'site', demo_mode: true, site: { id: 2, center_lat: 32.98, center_lon: -96.75, radius_m: 483 } });
});

test('a teleop mission kind maps to its contract string', () => {
  assert.equal(missionMessage(mission({ kind: { tag: 'Teleop' }, targetCellIds: [] })).mission.kind, 'teleop');
});

test('teleop: only a live change for this robot is forwarded, with contract field names', () => {
  const row: Teleop = { robotId: 'dog1', vxMps: 0.15, vyMps: -0.05, wzDps: 20, seq: 12n, sentBy: Identity.zero(), sentAt: T };
  assert.deepEqual(teleopForward(row, true, 'dog1'), { type: 'teleop', vx: 0.15, vy: -0.05, wz: 20, seq: 12 });
  assert.equal(teleopForward(row, false, 'dog1'), undefined, 'a row from a (re)subscription is an old command');
  assert.equal(teleopForward(row, true, 'dog2'), undefined);
});
