import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeCondition, pascal, rescuerIdentities } from '../src/conditions.ts';
import { walkTargetWarning } from '../src/commands.ts';
import { loadDemoConfig } from '../src/config.ts';
import type { SimActor } from '../src/pool.ts';

const identity = (value: string) => ({ toHexString: () => value });

function fakeSim(tables: Record<string, unknown[]>): SimActor {
  const db = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, { iter: () => rows[Symbol.iterator]() }]));
  return { connection: { db } } as unknown as SimActor;
}

test('maps contract enum spellings to binding tags', () => {
  assert.equal(pascal('load_imbalance'), 'LoadImbalance');
  assert.equal(pascal('proposed'), 'Proposed');
});

test('released and audit_flag pass only on rows that appear after the step starts', () => {
  const config = loadDemoConfig();
  const assignments: Array<{ id: bigint; rescuerIdentity: ReturnType<typeof identity>; status: { tag: string } }> = [
    { id: 1n, rescuerIdentity: identity('aa'), status: { tag: 'Released' } },
  ];
  const flags: Array<{ id: bigint; kind: { tag: string } }> = [{ id: 1n, kind: { tag: 'LoadImbalance' } }];
  const sim = fakeSim({
    assignment: assignments,
    participant: [{ identity: identity('aa'), name: 'R2 (sim)', role: { tag: 'Rescuer' } }],
    auditFlag: flags,
  });
  const released = makeCondition({ await: 'released', rescuer: 'r2' }, sim, config);
  const flagged = makeCondition({ await: 'audit_flag', kind: 'load_imbalance' }, sim, config);
  assert.equal(released(), false);
  assert.equal(flagged(), false);
  assignments.push({ id: 2n, rescuerIdentity: identity('aa'), status: { tag: 'Released' } });
  flags.push({ id: 2n, kind: { tag: 'ProposalDisagree' } });
  assert.equal(released(), true);
  assert.equal(flagged(), false);
  flags.push({ id: 3n, kind: { tag: 'LoadImbalance' } });
  assert.equal(flagged(), true);
});

test('assignment_for matches the rescuer by configured name and status', () => {
  const config = loadDemoConfig();
  const sim = fakeSim({
    assignment: [{ id: 1n, rescuerIdentity: identity('cc'), status: { tag: 'Proposed' } }],
    participant: [{ identity: identity('cc'), name: 'Cayden', role: { tag: 'Rescuer' } }],
  });
  assert.equal(makeCondition({ await: 'assignment_for', rescuer: 'cayden', status: 'proposed' }, sim, config)(), true);
  assert.equal(makeCondition({ await: 'assignment_for', rescuer: 'cayden', status: 'active' }, sim, config)(), false);
});

test('assignment_for and released match the glasses rescuer registered by key, ignoring case', () => {
  const config = loadDemoConfig();
  const assignments = [{ id: 1n, rescuerIdentity: identity('dd'), status: { tag: 'Active' } }];
  const sim = fakeSim({
    assignment: assignments,
    participant: [
      { identity: identity('dd'), name: 'cayden', role: { tag: 'Rescuer' } },
      { identity: identity('ee'), name: 'r1 (SIM)', role: { tag: 'Rescuer' } },
    ],
  });
  assert.equal(makeCondition({ await: 'assignment_for', rescuer: 'cayden', status: 'active' }, sim, config)(), true);
  assert.equal(makeCondition({ await: 'assignment_for', rescuer: 'Cayden' }, sim, config)(), true);
  const released = makeCondition({ await: 'released', rescuer: 'cayden' }, sim, config);
  assert.equal(released(), false);
  assignments.push({ id: 2n, rescuerIdentity: identity('dd'), status: { tag: 'Released' } });
  assert.equal(released(), true);
  assert.deepEqual([...rescuerIdentities(sim, config, 'r1')], ['ee']);
  assert.deepEqual([...rescuerIdentities(sim, config, 'r2')], []);
});

test('walk warns when the current assignment is not at the requested house', () => {
  const config = loadDemoConfig();
  const assignments: Array<{ id: bigint; survivorId: bigint; rescuerIdentity: ReturnType<typeof identity>; status: { tag: string } }> = [];
  const sim = fakeSim({
    assignment: assignments,
    participant: [{ identity: identity('dd'), name: 'cayden', role: { tag: 'Rescuer' } }],
    survivor: [
      { id: 7n, houseLabel: 'house 3', cellId: 3n },
      { id: 8n, houseLabel: undefined, cellId: 40n },
    ],
    searchCell: [{ id: 3n, label: 'house 3' }, { id: 40n, label: 'lot 12' }],
  });
  assert.match(walkTargetWarning(config, sim, 'house 3')!, /no current assignment/);
  assignments.push({ id: 5n, survivorId: 8n, rescuerIdentity: identity('dd'), status: { tag: 'Active' } });
  assert.match(walkTargetWarning(config, sim, 'house 3')!, /survivor 8 at lot 12, not house 3/);
  assignments.push({ id: 6n, survivorId: 7n, rescuerIdentity: identity('dd'), status: { tag: 'Active' } });
  assert.equal(walkTargetWarning(config, sim, 'house 3'), undefined);
});
