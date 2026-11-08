import { extraRescuerNumber, type DemoSiteConfig } from './config.ts';
import { offsetToLatLon } from './geo.ts';
import { mulberry32 } from './rng.ts';
import type { SimActor, SimPool } from './pool.ts';
import { RobotState } from '../../spacetimedb-bindings/types.js';

export interface ScaleLot {
  label: string;
  east_m: number;
  north_m: number;
}

export function generateScaleLots(config: DemoSiteConfig): ScaleLot[] {
  const lots: ScaleLot[] = [];
  const { radius_m } = config.site;
  const pitch = config.scale_lots.pitch_m;
  const edge = Math.floor(radius_m / pitch) * pitch;
  const excluded = config.houses;
  for (let north = edge; north >= -edge; north -= pitch) {
    for (let east = -edge; east <= edge; east += pitch) {
      if (Math.hypot(east, north) > radius_m) continue;
      if (excluded.some((house) => Math.hypot(east - house.east_m, north - house.north_m) < config.scale_lots.exclude_within_m)) continue;
      lots.push({ label: `${config.scale_lots.label_prefix} ${lots.length + 1}`, east_m: east, north_m: north });
    }
  }
  return lots;
}

export function generateExtraRescuerStarts(config: DemoSiteConfig): Array<{ key: string; name: string; lat: number; lon: number }> {
  const starts = [];
  const random = mulberry32(config.scale.seed);
  for (let index = 0; index < config.extra_sim_rescuers; index += 1) {
    const angle = random() * Math.PI * 2;
    const radius = config.site.radius_m * Math.sqrt(random()) * 0.8;
    const east_m = Math.cos(angle) * radius;
    const north_m = Math.sin(angle) * radius;
    const point = offsetToLatLon({ lat: config.site.center_lat, lon: config.site.center_lon }, { east_m, north_m });
    const number = extraRescuerNumber(config, index);
    starts.push({ key: `r${number}`, name: `R${number} (sim)`, ...point });
  }
  return starts;
}

export async function setupSite(config: DemoSiteConfig, pool: SimPool): Promise<{ siteId: bigint; cellCount: number; robotNames: string[]; rescuerNames: string[] }> {
  await pool.connect('sim', 'sim', 'sim');
  const sim = pool.get('sim');
  const siteId = await ensureSite(sim, config);
  const center = { lat: config.site.center_lat, lon: config.site.center_lon };
  const cellSpecs = [
    ...config.houses.map((house) => ({ label: house.label, east_m: house.east_m, north_m: house.north_m })),
    ...generateScaleLots(config),
  ];
  for (const cell of cellSpecs) {
    const point = offsetToLatLon(center, cell);
    if (Array.from(sim.connection.db.searchCell.iter()).some((row) => row.siteId === siteId && row.label === cell.label)) continue;
    await sim.connection.reducers.createSearchCell({ siteId, ...point, sizeM: config.cell_size_m, label: cell.label });
  }

  await pool.connectConfiguredActors(config);

  const robotNames: string[] = [];
  for (let index = 0; index <= config.robots.fleet_size; index += 1) {
    const robotId = index === 0 ? config.robots.sim.robot_id : `${config.robots.sim.robot_id}-${index + 1}`;
    robotNames.push(robotId);
    const robot = pool.get(robotId);
    await robot.connection.reducers.robotHeartbeat({ robotId, state: RobotState.Ready, batteryPct: 95, observedAt: undefined });
    const position = index === 0
      ? offsetToLatLon(center, config.robots.sim.home)
      : offsetToLatLon(center, { east_m: (index * 35) % 150 - 75, north_m: -80 - index * 10 });
    await robot.connection.reducers.robotReportPosition({ robotId, ...position, gpsFix: false, indoorOffsetM: 0, headingDeg: 0, observedAt: undefined });
  }

  const baseRescuers = config.rescuers.filter((rescuer) => !rescuer.real && rescuer.start);
  const extraRescuers = generateExtraRescuerStarts(config);
  for (const rescuer of baseRescuers) {
    const actor = pool.get(rescuer.key);
    const point = offsetToLatLon(center, rescuer.start!);
    await actor.connection.reducers.participantUpdatePosition(point);
    await actor.connection.reducers.rescuerHeartbeat({});
  }
  for (const rescuer of extraRescuers) {
    const actor = pool.get(rescuer.key);
    await actor.connection.reducers.participantUpdatePosition({ lat: rescuer.lat, lon: rescuer.lon });
    await actor.connection.reducers.rescuerHeartbeat({});
  }
  const rescuerNames = [...baseRescuers.map((rescuer) => rescuer.name), ...extraRescuers.map((rescuer) => rescuer.name)];
  return { siteId, cellCount: cellSpecs.length, robotNames, rescuerNames };
}

async function ensureSite(actor: SimActor, config: DemoSiteConfig): Promise<bigint> {
  const existing = Array.from(actor.connection.db.site.iter()).find((row) => row.name === config.site.name);
  if (existing) {
    if (!existing.demoMode) throw new Error('A site with the demo name exists with demo mode disabled, refusing setup');
    return existing.id;
  }
  await actor.connection.reducers.createSite({
    name: config.site.name,
    centerLat: config.site.center_lat,
    centerLon: config.site.center_lon,
    radiusM: config.site.radius_m,
    demoMode: config.site.demo_mode,
    requireMissionApproval: config.site.require_mission_approval,
  });
  return await waitForValue(actor, () => Array.from(actor.connection.db.site.iter()).find((row) => row.name === config.site.name)?.id);
}

async function waitForValue<T>(actor: SimActor, read: () => T | undefined, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for SpacetimeDB state after ${timeoutMs} ms`);
}
