// Play demo: the scripted house 3 rescue, run from the dashboard so the board and Cayden's glasses show the same
// story at once. Each step goes through the real path: the coordinator queues a search for Dog 1 (the simulator's
// sim-dog finds the hidden person), the coordinator proposes Cayden, the glasses service accepts it as Cayden
// (POST /rescuer/cayden/action, the same accept a ring tap sends), and the glasses service's demo walker walks him
// there along the streets. Only demo_mode sites accept the walker controls.
import type { BoardState } from '../data/BoardData';
import { enumTagToContract } from '../stdb/enums';

export const DEMO_HOUSE = 'house 3';
export const DEMO_ROBOT = 'sim-dog';
export const DEMO_RESCUER = 'cayden';
const ARRIVED_M = 8;

export type DemoStep = 'connecting' | 'searching' | 'assigning' | 'accepting' | 'walking' | 'arrived';

export const demoStepLabel: Record<DemoStep, string> = {
  connecting: 'Connecting glasses',
  searching: 'Dog 1 searching house 3',
  assigning: 'Assigning Cayden',
  accepting: 'Cayden accepting',
  walking: 'Cayden walking to house 3',
  arrived: 'Cayden at house 3',
};

export type GlassesDemoCommand = 'reset' | 'start';

export interface DemoDeps {
  board(): BoardState;
  createSearch(cellId: bigint, robotId: string): Promise<unknown>;
  propose(survivorId: bigint, rescuer: Participant): Promise<unknown>;
  glasses(command: GlassesDemoCommand): Promise<void>;
  accept(assignmentId: bigint): Promise<void>;
  waitFor<T>(check: () => T | undefined, timeoutMs: number, failure: string): Promise<T>;
  onStep(step: DemoStep): void;
}

const tag = enumTagToContract;
type Participant = BoardState['participants'][number];
type SearchCell = BoardState['cells'][number];
type Survivor = BoardState['survivors'][number];
type Assignment = BoardState['assignments'][number];

export function demoRescuer(board: BoardState): Participant | undefined {
  return board.participants.find((row) => row.online && tag(row.role) === 'rescuer' && row.name.split(/\s+/)[0]!.toLowerCase() === DEMO_RESCUER);
}

export function demoCell(board: BoardState): SearchCell | undefined {
  return board.cells.find((row) => row.label === DEMO_HOUSE && (!board.site || row.siteId === board.site.id));
}

// The newest person still waiting for help in the demo house.
export function demoSurvivor(board: BoardState, cell: SearchCell): Survivor | undefined {
  return board.survivors.filter((row) => row.cellId === cell.id && tag(row.status) !== 'resolved').sort((a, b) => (a.id < b.id ? 1 : -1))[0];
}

export function demoAssignment(board: BoardState, survivorId: bigint, rescuer: Participant): Assignment | undefined {
  const hex = rescuer.identity.toHexString();
  return board.assignments.find((row) => row.survivorId === survivorId && row.rescuerIdentity.toHexString() === hex && ['proposed', 'active'].includes(tag(row.status)));
}

// Flat-earth meters, accurate over a city block.
export function metersBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const north = (b.lat - a.lat) * 111320;
  const east = (b.lon - a.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(north, east);
}

export async function runDemo(deps: DemoDeps): Promise<void> {
  deps.onStep('connecting');
  const rescuer = await deps.waitFor(() => demoRescuer(deps.board()), 20_000, 'Cayden’s glasses did not connect. Start everything with `npm run demo`.');
  await deps.glasses('reset');

  const cell = demoCell(deps.board());
  if (!cell) throw new Error('House 3 is not on the board. Run the simulator setup.');
  let survivor = demoSurvivor(deps.board(), cell);
  if (!survivor) {
    deps.onStep('searching');
    if (!deps.board().robots.some((row) => row.robotId === DEMO_ROBOT && row.online)) throw new Error('Dog 1 is offline. Start the simulator with `npm run demo`.');
    await deps.createSearch(cell.id, DEMO_ROBOT);
    survivor = await deps.waitFor(() => demoSurvivor(deps.board(), cell), 120_000, 'Dog 1 did not report a find in house 3.');
  }
  const survivorId = survivor.id;

  deps.onStep('assigning');
  if (!demoAssignment(deps.board(), survivorId, rescuer)) await deps.propose(survivorId, rescuer);
  const assignment = await deps.waitFor(() => demoAssignment(deps.board(), survivorId, rescuer), 10_000, 'The assignment to Cayden did not appear.');
  if (tag(assignment.status) === 'proposed') {
    deps.onStep('accepting');
    await deps.accept(assignment.id);
    await deps.waitFor(() => { const row = demoAssignment(deps.board(), survivorId, rescuer); return row && tag(row.status) === 'active' ? row : undefined; }, 10_000, 'Cayden’s glasses did not accept the assignment.');
  }

  deps.onStep('walking');
  // Cayden's distance to the survivor on the board, once his position is known.
  const target = { lat: survivor.lat, lon: survivor.lon };
  const distance = () => {
    const person = deps.board().participants.find((row) => row.identity.toHexString() === rescuer.identity.toHexString());
    return person?.lat != null && person.lon != null ? metersBetween({ lat: person.lat, lon: person.lon }, target) : undefined;
  };
  // On a replay he is still at the house until the reset position reaches the board; wait for it, or he would
  // count as arrived before he starts walking.
  await deps.waitFor(() => ((distance() ?? 0) > ARRIVED_M ? true : undefined), 15_000, 'Cayden’s glasses did not move him back to the start.');
  await deps.glasses('start');
  await deps.waitFor(() => ((distance() ?? Infinity) <= ARRIVED_M ? true : undefined), 10 * 60_000, 'Cayden did not reach house 3.');
  deps.onStep('arrived');
}
