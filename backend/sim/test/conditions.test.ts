import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeCondition, pascal } from '../src/conditions.ts';
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
