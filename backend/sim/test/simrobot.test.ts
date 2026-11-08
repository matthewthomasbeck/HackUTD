import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fleetRobotIds, loadDemoConfig, simRobotHome, simRobotIds, validateDemoConfig, type DemoSiteConfig } from '../src/config.ts';
import { distanceMeters, offsetToLatLon } from '../src/geo.ts';
import type { SimPool } from '../src/pool.ts';
import { SimRobotRunner } from '../src/simrobot.ts';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const table = <T>(rows: T[]) => ({ iter: () => rows[Symbol.iterator]() });

interface MissionRow { id: bigint; robotId: string; kind: { tag: string }; status: { tag: string }; targetCellIds: bigint[]; reason: string }

test('the sim crew is sim-dog plus sim-drone (real id drone1), and the drone is the fleet robot', () => {
  const config = loadDemoConfig();
  assert.deepEqual(simRobotIds(config), ['sim-dog', 'sim-drone']);
  assert.deepEqual(fleetRobotIds(config), ['sim-drone']);
  assert.equal(config.robots.drone.real_id, 'drone1');
  assert.deepEqual(simRobotHome(config, 'sim-dog'), config.robots.sim.home);
  assert.deepEqual(simRobotHome(config, 'sim-drone'), config.robots.drone.home);
  assert.throws(() => simRobotHome(config, 'sim-dog-2'), /not a simulated robot/);
  const clash = structuredClone(config) as DemoSiteConfig;
  clash.robots.drone.robot_id = 'sim-dog';
  assert.throws(() => validateDemoConfig(clash), /must differ/);
});

// A fake board with just what the runner reads and writes: missions, the teleop row, and its reducer calls.
function fakeBoard(config: DemoSiteConfig) {
  const missions: MissionRow[] = [];
  const teleop = new Map<string, { robotId: string; vxMps: number; vyMps: number; wzDps: number; seq: bigint }>();
  const calls: Array<{ reducer: string; robotId?: string; lat?: number; lon?: number; status?: string }> = [];
  const connection = {
    db: {
      mission: table(missions),
      searchCell: table([]),
      robot: table([]),
      teleop: { robotId: { find: (robotId: string) => teleop.get(robotId) } },
    },
    reducers: {
      robotHeartbeat: async ({ robotId }: { robotId: string }) => { calls.push({ reducer: 'heartbeat', robotId }); },
      robotReportPosition: async ({ robotId, lat, lon }: { robotId: string; lat: number; lon: number }) => { calls.push({ reducer: 'position', robotId, lat, lon }); },
      claimNextMission: async ({ robotId }: { robotId: string }) => {
        calls.push({ reducer: 'claim', robotId });
        const open = missions.find((row) => row.robotId === robotId && (row.status.tag === 'Leased' || row.status.tag === 'Active'));
        if (open) return;
        const next = missions.find((row) => row.status.tag === 'Queued' && (row.robotId === '' || row.robotId === robotId));
        if (next) { next.robotId = robotId; next.status = { tag: 'Leased' }; }
      },
      missionProgress: async ({ missionId, status }: { missionId: bigint; status: { tag: string } }) => {
        calls.push({ reducer: 'progress', status: status.tag });
        missions.find((row) => row.id === missionId)!.status = { tag: status.tag };
      },
      reportTerrain: async ({ robotId }: { robotId: string }) => { calls.push({ reducer: 'terrain', robotId }); },
      markCell: async () => {},
    },
  };
  const pool = { get: (key: string) => ({ key, name: key, role: 'robot', connection }) } as unknown as SimPool;
  return { missions, teleop, calls, pool, config };
}

test('the sim drone runs like sim-dog: heartbeats, positions, and Take over moves it on the map', async () => {
  const config = loadDemoConfig();
  const board = fakeBoard({ ...config, timing: { ...config.timing, robot_heartbeat_ms: 100, position_ms: 100 } });
  const runner = new SimRobotRunner(board.config, board.pool);
  runner.startFleet();
  try {
    await sleep(150);
    assert.ok(board.calls.some((call) => call.reducer === 'heartbeat' && call.robotId === 'sim-drone'));
    assert.ok(board.calls.some((call) => call.reducer === 'claim' && call.robotId === 'sim-drone'));
    assert.ok(!board.calls.some((call) => call.robotId === 'sim-dog'), 'starting the drone leaves sim-dog alone');

    // take_over queues a teleop mission; the drone claims it and drives on the newest teleop row.
    board.missions.push({ id: 1n, robotId: 'sim-drone', kind: { tag: 'Teleop' }, status: { tag: 'Queued' }, targetCellIds: [], reason: 'operator took over' });
    board.teleop.set('sim-drone', { robotId: 'sim-drone', vxMps: 0.2, vyMps: 0, wzDps: 0, seq: 0n });
    const until = Date.now() + 2_500;
    let seq = 1n;
    while (Date.now() < until && board.missions[0]!.status.tag !== 'Active') await sleep(50);
    assert.equal(board.missions[0]!.status.tag, 'Active');
    for (let tick = 0; tick < 8; tick += 1) {
      board.teleop.set('sim-drone', { robotId: 'sim-drone', vxMps: 0.2, vyMps: 0, wzDps: 0, seq: seq++ });
      await sleep(100);
    }
    const home = offsetToLatLon({ lat: config.site.center_lat, lon: config.site.center_lon }, config.robots.drone.home);
    const last = board.calls.filter((call) => call.reducer === 'position' && call.robotId === 'sim-drone').at(-1)!;
    assert.ok(last.lat! > home.lat, 'a forward stick from heading 0 moves the drone north');
    assert.ok(distanceMeters(home, { lat: last.lat!, lon: last.lon! }) > 1);
    assert.ok(!board.calls.some((call) => call.reducer === 'terrain'), 'the drone reports no ground terrain');
  } finally {
    runner.stopAll();
  }
  assert.equal(runner.anyRunning(), false);
});

test('the runner refuses robot ids it does not simulate', () => {
  const config = loadDemoConfig();
  const runner = new SimRobotRunner(config, fakeBoard(config).pool);
  assert.throws(() => runner.start('sim-dog-2'), /not a simulated robot/);
});
