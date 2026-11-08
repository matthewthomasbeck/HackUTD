import { PersonReportKind, PersonReportSource } from '../../spacetimedb-bindings/types.js';
import type { DemoSiteConfig } from './config.ts';
import { offsetToLatLon, type LatLon } from './geo.ts';
import { reportDetectionAndWait, writeClinical } from './finding.ts';
import { logInjection } from './inject.ts';
import type { SimPool } from './pool.ts';
import { formatSimulatorStatus, getSimulatorStatus } from './status.ts';
import { planScaleSurvivors, type ScaleLevel } from './scale.ts';

export async function reportConfiguredHouse(config: DemoSiteConfig, pool: SimPool, houseLabel: string): Promise<void> {
  const sim = pool.get('sim');
  const target = config.houses.find((house) => house.label === houseLabel);
  if (!target) throw new Error(`Unknown house: ${houseLabel}`);
  const cell = Array.from(sim.connection.db.searchCell.iter()).find((row) => row.label === target.label);
  if (!cell) throw new Error(`Search cell not found for ${houseLabel}. Run setup first.`);
  await logInjection(sim, 'report', houseLabel);
  const report = config.family_report;
  await sim.connection.reducers.reportPerson({
    cellId: cell.id,
    kind: report.kind === 'safe' ? PersonReportKind.Safe : PersonReportKind.Missing,
    count: report.count,
    nameOrUnit: report.name_or_unit,
    note: report.note,
    source: report.source === 'neighbor' ? PersonReportSource.Neighbor : report.source === 'hotline' ? PersonReportSource.Hotline : PersonReportSource.Family,
  });
}

export async function walkGlassesRescuer(config: DemoSiteConfig, houseLabel?: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const base = env.GLASSES_BASE?.replace(/\/$/, '');
  if (!base) throw new Error('GLASSES_BASE is required for walk');
  if (houseLabel && !config.houses.some((item) => item.label === houseLabel)) throw new Error(`Unknown house: ${houseLabel}`);
  const response = await fetch(`${base}/demo/cayden/walk`, { method: 'POST' });
  if (!response.ok) throw new Error(`Glasses demo walker failed: ${response.status} ${response.statusText}`);
  console.log(houseLabel ? `Started the demo walk toward the current assignment (expected at ${houseLabel}; the walker follows the assignment, not the house).` : 'Started the demo walk toward the current assignment.');
}

export function printStatus(pool: SimPool): void {
  console.log(formatSimulatorStatus(getSimulatorStatus(pool.get('sim'))));
}

export async function spawnSurvivor(config: DemoSiteConfig, pool: SimPool, levelInput: string, houseLabel: string): Promise<bigint> {
  const house = config.houses.find((item) => item.label === houseLabel);
  if (!house) throw new Error(`Unknown house: ${houseLabel}`);
  const point = offsetToLatLon({ lat: config.site.center_lat, lon: config.site.center_lon }, house);
  await logInjection(pool.get('sim'), 'spawn', `${levelInput} ${houseLabel}`);
  return spawnSurvivorAt(config, pool, levelInput, point, `demo finding at ${houseLabel}`);
}

export async function spawnSurvivorAt(config: DemoSiteConfig, pool: SimPool, levelInput: string, point: LatLon, note: string): Promise<bigint> {
  if (!['immediate', 'delayed', 'minor', 'unknown'].includes(levelInput)) throw new Error('level must be immediate, delayed, minor, or unknown');
  const level = levelInput as ScaleLevel;
  const mix = { immediate: 0, delayed: 0, minor: 0, unknown: 0, [level]: 1 };
  const profile = planScaleSurvivors({ ...config, scale: { ...config.scale, mix } }, 1)[0]!;
  const survivorId = await reportDetectionAndWait(pool, { robotId: config.robots.sim.robot_id, missionId: 0n, point, note, ...(profile.thermal_temp_c === undefined ? {} : { maxTempC: profile.thermal_temp_c }) });
  await writeClinical(pool, survivorId, profile);
  return survivorId;
}
