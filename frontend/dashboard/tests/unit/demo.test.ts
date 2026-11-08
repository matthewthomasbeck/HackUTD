import { describe, expect, it } from 'vitest';
import type { BoardState } from '../../src/data/BoardData';
import { runDemo, type DemoStep, type GlassesDemoCommand } from '../../src/view/demo';

const identity = (hex: string) => ({ toHexString: () => hex });
const HOUSE3 = { lat: 32.99691, lon: -96.77046 };

const START = { lat: 32.9965, lon: -96.7712 }; // the demo walker's start on Worthing St

// A tiny in-memory board: the fake reducers and glasses controls change it the way the module would.
function world(options: { survivorAlready?: boolean; dogOnline?: boolean; caydenAtHouse?: boolean } = {}) {
  const cayden = { identity: identity('cc'), name: 'Cayden', role: { tag: 'Rescuer' }, online: true, ...(options.caydenAtHouse ? HOUSE3 : START) };
  const board = {
    site: { id: 1n },
    cells: [{ id: 7n, siteId: 1n, label: 'house 3' }, { id: 8n, siteId: 1n, label: 'house 4' }],
    survivors: options.survivorAlready ? [{ id: 5n, cellId: 7n, status: { tag: 'Unassigned' }, ...HOUSE3 }] : [],
    robots: [{ robotId: 'sim-dog', online: options.dogOnline ?? true }],
    participants: [cayden, { identity: identity('r1'), name: 'sim-rescuer-1', role: { tag: 'Rescuer' }, online: true }],
    assignments: [] as Array<Record<string, unknown>>,
  };
  const calls: string[] = [];
  // The reset position reaches the board one poll later, as it does through the database.
  let pendingReset = false;
  const steps: DemoStep[] = [];
  const deps = {
    board: () => board as unknown as BoardState,
    createSearch: async (cellId: bigint, robotId: string) => {
      calls.push(`search ${cellId} ${robotId}`);
      board.survivors.push({ id: 6n, cellId, status: { tag: 'Unassigned' }, ...HOUSE3 });
    },
    propose: async (survivorId: bigint, rescuer: { name: string }) => {
      calls.push(`propose ${survivorId} ${rescuer.name}`);
      board.assignments.push({ id: 1n, survivorId, rescuerIdentity: cayden.identity, status: { tag: 'Proposed' } });
    },
    glasses: async (command: GlassesDemoCommand) => {
      calls.push(`glasses ${command}`);
      if (command === 'reset') pendingReset = true;
      if (command === 'start') Object.assign(cayden, HOUSE3);
    },
    accept: async (assignmentId: bigint) => {
      calls.push(`accept ${assignmentId}`);
      board.assignments[0]!.status = { tag: 'Active' };
    },
    waitFor: async <T,>(check: () => T | undefined, _timeoutMs: number, failure: string) => {
      let value = check();
      if (value === undefined && pendingReset) { pendingReset = false; Object.assign(cayden, START); value = check(); }
      if (value === undefined) throw new Error(failure);
      return value;
    },
    onStep: (step: DemoStep) => { steps.push(step); },
  };
  return { board, deps, calls, steps };
}

describe('Play demo', () => {
  it('searches house 3, assigns Cayden, accepts on his glasses, and walks him there', async () => {
    const { deps, calls, steps } = world();
    await runDemo(deps);
    expect(calls).toEqual(['glasses reset', 'search 7 sim-dog', 'propose 6 Cayden', 'accept 1', 'glasses start']);
    expect(steps).toEqual(['connecting', 'searching', 'assigning', 'accepting', 'walking', 'arrived']);
  });

  it('skips the search when the house 3 person is already on the board', async () => {
    const { deps, calls } = world({ survivorAlready: true });
    await runDemo(deps);
    expect(calls).toEqual(['glasses reset', 'propose 5 Cayden', 'accept 1', 'glasses start']);
  });

  it('waits for Cayden to leave the house before it counts a replay as arrived', async () => {
    const { board, deps, calls, steps } = world({ survivorAlready: true, caydenAtHouse: true });
    board.assignments.push({ id: 1n, survivorId: 5n, rescuerIdentity: board.participants[0]!.identity, status: { tag: 'Active' } });
    await runDemo(deps);
    expect(calls).toEqual(['glasses reset', 'glasses start']);
    expect(steps).toEqual(['connecting', 'assigning', 'walking', 'arrived']);
  });

  it('says what to start when the sim robot is offline', async () => {
    const { deps } = world({ dogOnline: false });
    await expect(runDemo(deps)).rejects.toThrow('Dog 1 is offline');
  });
});
