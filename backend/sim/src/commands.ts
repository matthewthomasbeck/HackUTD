import { Breathing, CriticalLevel, DetectionSource, PersonReportKind, PersonReportSource } from '../../spacetimedb-bindings/types.js';
import type { DemoSiteConfig } from './config.ts';
import { offsetToLatLon } from './geo.ts';
import { logInjection } from './inject.ts';
import type { SimPool } from './pool.ts';
import { formatSimulatorStatus, getSimulatorStatus } from './status.ts';
import { waitForValue } from './wait.ts';
import { planScaleSurvivors } from './scale.ts';

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
  if (houseLabel) {
    if (!config.houses.some((item) => item.label === houseLabel)) throw new Error(`Unknown house: ${houseLabel}`);
    throw new Error('The documented glasses walker endpoint moves toward the current assignment and does not define a house-selection body. Use `walk` without a house.');
  }
  const response = await fetch(`${base}/demo/cayden/walk`, { method: 'POST' });
  if (!response.ok) throw new Error(`Glasses demo walker failed: ${response.status} ${response.statusText}`);
  console.log(houseLabel ? `Started the demo walk for ${houseLabel}.` : 'Started the demo walk toward the current assignment.');
}

export function printStatus(pool: SimPool): void {
  console.log(formatSimulatorStatus(getSimulatorStatus(pool.get('sim'))));
}

export async function spawnSurvivor(config: DemoSiteConfig, pool: SimPool, levelInput: string, houseLabel: string): Promise<bigint> {
  if (!['immediate', 'delayed', 'minor', 'unknown'].includes(levelInput)) throw new Error('level must be immediate, delayed, minor, or unknown');
  const level = levelInput as 'immediate' | 'delayed' | 'minor' | 'unknown';
  const house = config.houses.find((item) => item.label === houseLabel);
  if (!house) throw new Error(`Unknown house: ${houseLabel}`);
  const sim = pool.get('sim');
  const robot = pool.get(config.robots.sim.robot_id);
  const point = offsetToLatLon({ lat: config.site.center_lat, lon: config.site.center_lon }, house);
  const mix = { immediate: 0, delayed: 0, minor: 0, unknown: 0, [level]: 1 };
  const profile = planScaleSurvivors({ ...config, scale: { ...config.scale, mix } }, 1)[0]!;
  await logInjection(sim, 'spawn', `${level} ${houseLabel}`);
  const clientRef = `spawn_${Date.now()}`;
  await robot.connection.reducers.reportDetection({
    robotId: robot.name,
    missionId: 0n,
    source: DetectionSource.Thermal,
    clientRef,
    ...point,
    gpsFix: false,
    locationNote: `demo finding at ${houseLabel}`,
    maxTempC: profile.thermal_temp_c,
    thermalConfidence: 0.8,
    thermalImageUrl: undefined,
    cameraImageUrl: undefined,
    breathingClipUrl: undefined,
    observedAt: undefined,
  });
  const survivor = await waitForValue(sim, () => Array.from(sim.connection.db.survivor.iter()).find((row) => row.lat.toFixed(7) === point.lat.toFixed(7) && row.lon.toFixed(7) === point.lon.toFixed(7)));
  if (level === 'unknown') return survivor.id;
  const breathing = profile.breathing === 'not_detected' ? Breathing.NotDetected : Breathing.Detected;
  await sim.connection.reducers.reportBreathing({
    survivorId: survivor.id,
    breathing,
    rateBpm: profile.rate_bpm,
    confidence: profile.breathing_confidence,
    visibilityPct: profile.visibility_pct,
    displayUrl: undefined,
  });
  const criticalLevel = level === 'immediate' ? CriticalLevel.Immediate : level === 'delayed' ? CriticalLevel.Delayed : CriticalLevel.Minor;
  await sim.connection.reducers.setCriticalScore({ survivorId: survivor.id, level: criticalLevel, score: profile.score!, confidence: profile.score_confidence!, reasons: profile.score_reasons! });
  return survivor.id;
}
