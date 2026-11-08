import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadDemoConfig, type DemoSiteConfig } from '../src/config.ts';
import { FailureController, loadRescuer } from '../src/failures.ts';
import type { SimActor, SimPool } from '../src/pool.ts';
import { RescuerRunner } from '../src/rescuers.ts';
import { finishHoldMissions, SCALE_HOLD_REASON } from '../src/scale.ts';
import type { SimRobotRunner } from '../src/simrobot.ts';

const identity = (value: string) => ({ toHexString: () => value });
const table = (rows: unknown[]) => ({ iter: () => rows[Symbol.iterator]() });

interface Row { id: bigint; survivorId: bigint; rescuerIdentity: ReturnType<typeof identity>; status: { tag: string } }

function fastConfig(): DemoSiteConfig {
  const config = loadDemoConfig();
  return { ...config, timing: { ...config.timing, accept_delay_s: [0, 0], position_ms: 50, speedup: 0.01, rescuer_heartbeat_ms: 60_000 } };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('a sim rescuer accepts a new proposal promptly while it is still walking to an earlier one', async () => {
  const config = fastConfig();
  const assignments: Row[] = [{ id: 1n, survivorId: 10n, rescuerIdentity: identity('aa'), status: { tag: 'Proposed' } }];
  const accepted: bigint[] = [];
  const actor = {
    key: 'r1', name: 'R1', role: 'rescuer', identity: 'aa',
    connection: {
      db: {
        myAssignment: table(assignments),
        mySurvivor: table([{ id: 10n, lat: 33.5, lon: -96.7 }, { id: 11n, lat: 33.5, lon: -96.7 }]),
      },
      reducers: {
        rescuerHeartbeat: async () => {},
        participantUpdatePosition: async () => {},
        acceptAssignment: async ({ assignmentId }: { assignmentId: bigint }) => {
          accepted.push(assignmentId);
          const row = assignments.find((item) => item.id === assignmentId)!;
          if (row.status.tag !== 'Proposed') throw new Error('proposal expired');
          row.status = { tag: 'Active' };
        },
        startEnRoute: async () => {},
        markReached: async () => {},
        resolveSurvivor: async () => {},
      },
    },
  } as unknown as SimActor;
  const pool = { list: () => [actor], get: () => actor } as unknown as SimPool;
  const runner = new RescuerRunner(config, pool);
  runner.start();
  try {
    await sleep(600);
    assert.deepEqual(accepted, [1n]);
    assignments.push({ id: 2n, survivorId: 11n, rescuerIdentity: identity('aa'), status: { tag: 'Proposed' } });
    await sleep(600);
    assert.deepEqual(accepted, [1n, 2n], 'the second proposal is accepted while the first walk is still under way');
    assert.equal(assignments[1]!.status.tag, 'Active');
    await sleep(400);
    assert.deepEqual(accepted, [1n, 2n], 'no proposal is accepted twice');
  } finally {
    runner.stop();
  }
});

function imbalanceFixture(options: { pendingFrom?: 'watchdog'; delayed: number }) {
  const assignments: Row[] = [];
  const survivors = Array.from({ length: options.delayed }, (_, index) => ({
    id: BigInt(100 + index), lat: 33 + index * 0.0001, lon: -96.77, status: { tag: 'Unassigned' }, criticalLevel: { tag: 'Delayed' },
  }));
  let nextId = 1n;
  const propose = (survivorId: bigint) => {
    if (assignments.some((row) => row.status.tag === 'Proposed')) throw new Error('rescuer has a pending proposal');
    assignments.push({ id: nextId++, survivorId, rescuerIdentity: identity('aa'), status: { tag: 'Proposed' } });
  };
  if (options.pendingFrom) assignments.push({ id: nextId++, survivorId: 999n, rescuerIdentity: identity('aa'), status: { tag: 'Proposed' } });
  const calls: string[] = [];
  const sim = {
    key: 'sim', name: 'sim', role: 'sim', identity: 'ff',
    connection: {
      db: { assignment: table(assignments), survivor: table(survivors), participant: table([{ identity: identity('aa'), name: 'R1', lat: 33, lon: -96.77 }]) },
      reducers: {
        logEvent: async () => {},
        proposeAssignment: async ({ survivorId }: { survivorId: bigint }) => { calls.push(`propose ${survivorId}`); propose(survivorId); },
      },
    },
  } as unknown as SimActor;
  const loaded = {
    key: 'r1', name: 'R1', role: 'rescuer', identity: 'aa',
    connection: {
      db: { myAssignment: table(assignments) },
      reducers: {
        acceptAssignment: async ({ assignmentId }: { assignmentId: bigint }) => {
          calls.push(`accept ${assignmentId}`);
          assignments.find((row) => row.id === assignmentId)!.status = { tag: 'Active' };
        },
        releaseAssignment: async () => {},
      },
    },
  } as unknown as SimActor;
  return { assignments, calls, sim, loaded };
}

test('imbalance accepts a proposal another proposer left pending and still loads three assignments', async () => {
  const { assignments, calls, sim, loaded } = imbalanceFixture({ pendingFrom: 'watchdog', delayed: 5 });
  const active = await loadRescuer(sim, loaded, identity('aa') as never, { lat: 33, lon: -96.77 });
  assert.equal(active, 3);
  assert.equal(assignments.filter((row) => row.status.tag === 'Active').length, 3);
  assert.equal(calls[0], 'accept 1', 'the pending watchdog proposal is accepted first instead of failing');
});

test('imbalance releases its hold on the rescuer when loading fails', async () => {
  const config = loadDemoConfig();
  const { sim, loaded } = imbalanceFixture({ delayed: 1 });
  const pool = { get: (key: string) => key === 'sim' ? sim : loaded, list: () => [sim, loaded] } as unknown as SimPool;
  const rescuers = new RescuerRunner(config, pool);
  const failures = new FailureController(config, pool, {} as SimRobotRunner, rescuers);
  await assert.rejects(failures.imbalance('r1'), /more unassigned delayed survivors/);
  assert.equal(rescuers.isHeld('r1'), false);
});

test('scale finishes its own leased hold missions and leaves other missions alone', async () => {
  const missions = [
    { id: 1n, robotId: 'sim-dog-2', kind: { tag: 'Hold' }, reason: SCALE_HOLD_REASON, status: { tag: 'Leased' } },
    { id: 2n, robotId: 'sim-dog-3', kind: { tag: 'SearchCells' }, reason: 'search', status: { tag: 'Leased' } },
    { id: 3n, robotId: 'sim-dog-4', kind: { tag: 'Hold' }, reason: SCALE_HOLD_REASON, status: { tag: 'Done' } },
  ];
  const finished: bigint[] = [];
  const robot = { connection: { reducers: { missionProgress: async ({ missionId }: { missionId: bigint }) => { finished.push(missionId); } } } };
  const sim = { connection: { db: { mission: table(missions) } } } as unknown as SimActor;
  const pool = { get: () => robot } as unknown as SimPool;
  await finishHoldMissions(sim, pool, new Map([['sim-dog-2', 1n], ['sim-dog-3', 2n], ['sim-dog-4', 3n]]));
  assert.deepEqual(finished, [1n]);
});
