import { describe, expect, it } from 'vitest';
import type { BoardState } from '../../src/data/BoardData';
import { describeCommand, driveCommand, driveInputForKey, isStill, type DriveInput } from '../../src/model/teleop';
import { peopleRows, robotControls } from '../../src/view/derive';

const held = (...inputs: DriveInput[]) => new Set(inputs);

describe('remote driving inputs', () => {
  it('maps the robotctl keys and the arrows, in either case', () => {
    expect(driveInputForKey('w')).toBe('forward');
    expect(driveInputForKey('W')).toBe('forward');
    expect(driveInputForKey('ArrowLeft')).toBe('turn_left');
    expect(driveInputForKey('a')).toBe('left');
    expect(driveInputForKey('e')).toBe('turn_right');
    expect(driveInputForKey('x')).toBeUndefined();
  });

  it('drives at the module limits with the robot sign convention', () => {
    expect(driveCommand(held('forward', 'turn_left'))).toEqual({ vx: 0.2, vy: 0, wz: 45 });
    expect(driveCommand(held('back', 'right', 'turn_right'))).toEqual({ vx: -0.2, vy: -0.2, wz: -45 });
  });

  it('stops when opposite inputs are held together', () => {
    expect(isStill(driveCommand(held('forward', 'back')))).toBe(true);
    expect(isStill(driveCommand(held()))).toBe(true);
  });

  it('describes the command in words', () => {
    expect(describeCommand(driveCommand(held('forward', 'turn_left')))).toBe('Forward 0.20 m/s · turning left 45°/s');
    expect(describeCommand(driveCommand(held('right')))).toBe('Sideways right 0.20 m/s');
    expect(describeCommand(driveCommand(held()))).toBe('Stopped');
  });
});

// A board with one dog and the given missions; only the fields robotControls reads.
function board(missions: Array<Record<string, unknown>>, robot: Record<string, unknown> = {}): BoardState {
  return {
    robots: [{ robotId: 'sim-dog', online: true, state: { tag: 'Active' }, batteryPct: 87.4, currentMissionId: undefined, ...robot }],
    missions, cells: [{ id: 7n, label: 'house 3' }],
  } as unknown as BoardState;
}
const mission = (id: bigint, kind: string, status: string, extra: Record<string, unknown> = {}) =>
  ({ id, robotId: 'sim-dog', kind: { tag: kind }, status: { tag: status }, targetCellIds: [], createdBy: 'coordinator-A', ...extra });

describe('robotControls', () => {
  it('says what the robot is doing when nobody drives it', () => {
    const [dog] = robotControls(board([mission(1n, 'SearchCells', 'Active', { targetCellIds: [7n] })], { currentMissionId: 1n }), null, 'coordinator-A');
    expect(dog).toMatchObject({ name: 'Dog 1', state: 'ACTIVE', doing: 'Searching house 3', batteryPct: 87, control: { kind: 'free' } });
  });

  it('is waiting until the robot claims the take-over, then driving', () => {
    const waiting = robotControls(board([mission(2n, 'Teleop', 'Queued')]), null, 'coordinator-A')[0]!;
    expect(waiting.control).toEqual({ kind: 'mine', missionId: 2n, by: 'Coordinator-A', phase: 'waiting' });
    expect(waiting.doing).toBe('Handing control to Coordinator-A');
    const driving = robotControls(board([mission(2n, 'Teleop', 'Active')], { currentMissionId: 2n }), null, 'coordinator-A')[0]!;
    expect(driving.control).toMatchObject({ kind: 'mine', phase: 'driving' });
    expect(driving.doing).toBe('Remote control by Coordinator-A');
  });

  it('handles the drone like the dog: named Drone 1, and taken over the same way', () => {
    const drone = { robotId: 'sim-drone', online: true, state: { tag: 'Active' }, batteryPct: 90, currentMissionId: 3n };
    const state = { ...board([mission(3n, 'Teleop', 'Active', { robotId: 'sim-drone' })]), robots: [board([]).robots[0]!, drone] } as unknown as BoardState;
    const controls = robotControls(state, null, 'coordinator-A');
    expect(controls.map((row) => row.name)).toEqual(['Dog 1', 'Drone 1']);
    expect(controls[0]!.control).toEqual({ kind: 'free' });
    expect(controls[1]).toMatchObject({ robotId: 'sim-drone', doing: 'Remote control by Coordinator-A', control: { kind: 'mine', missionId: 3n, phase: 'driving' } });
  });

  it('lists a taken-over robot as under remote control, not searching, in the rescuers and robot card', () => {
    const state = { ...board([mission(3n, 'Teleop', 'Active'), mission(4n, 'SearchCells', 'Active')], { currentMissionId: 3n }), assignments: [], participants: [] } as unknown as BoardState;
    expect(peopleRows(state, null).find((row) => row.robot)?.status).toEqual({ text: 'Remote control', tone: 'ok' });
    const searching = { ...state, robots: [{ ...state.robots[0]!, currentMissionId: 4n }] } as unknown as BoardState;
    expect(peopleRows(searching, null).find((row) => row.robot)?.status).toEqual({ text: 'Searching', tone: 'ok' });
  });

  it('shows another screen as the driver, and ignores a finished take-over', () => {
    expect(robotControls(board([mission(2n, 'Teleop', 'Leased')]), null, 'coordinator-B')[0]!.control).toMatchObject({ kind: 'other', by: 'Coordinator-A' });
    expect(robotControls(board([mission(2n, 'Teleop', 'Cancelled')]), null, 'coordinator-A')[0]!.control).toEqual({ kind: 'free' });
  });

  it('does not call a robot that is still ACTIVE after its mission ended starting up', () => {
    expect(robotControls(board([]), null, 'x')[0]!.doing).toBe('Finishing its last command');
    expect(robotControls(board([], { state: { tag: 'Init' } }), null, 'x')[0]!.doing).toBe('Starting up (INIT)');
  });

  it('puts a safety stop ahead of everything else', () => {
    expect(robotControls(board([], { state: { tag: 'SafeStop' } }), null, 'x')[0]!.doing).toBe('Stopped for safety (SAFE_STOP); reset on the robot');
  });
});
