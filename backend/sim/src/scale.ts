import { Breathing as BreathingEnum, CellStatus, CriticalLevel, DetectionSource, MissionKind, MissionStatus, RobotState } from '../../spacetimedb-bindings/types.js';
import type { DemoSiteConfig } from './config.ts';
import { insideRing, offsetToLatLon } from './geo.ts';
import { generateScaleLots, type ScaleLot } from './setup.ts';
import { mulberry32 } from './rng.ts';
import { logInjection } from './inject.ts';
import type { SimActor, SimPool } from './pool.ts';

export const SCALE_HOLD_REASON = 'Scale survivor reporting';
export type ScaleLevel = 'immediate' | 'delayed' | 'minor' | 'unknown';
export interface PlannedScaleSurvivor {
  east_m: number;
  north_m: number;
  lot: string;
  level: ScaleLevel;
  breathing: 'detected' | 'not_detected' | 'unknown';
  rate_bpm?: number;
  breathing_confidence: number;
  visibility_pct?: number;
  thermal_temp_c?: number;
  score?: number;
  score_confidence?: number;
  score_reasons?: string[];
}

export function planScaleSurvivors(config: DemoSiteConfig, count = config.scale.count): PlannedScaleSurvivor[] {
  const random = mulberry32(config.scale.seed);
  const mix = config.scale.mix;
  return placeSurvivorsInLots(config, generateScaleLots(config), count, random, () => {
    const roll = random();
    return roll < mix.immediate
      ? 'immediate'
      : roll < mix.immediate + mix.delayed
        ? 'delayed'
        : roll < mix.immediate + mix.delayed + mix.minor
          ? 'minor'
          : 'unknown';
  });
}

// Places count survivors inside real building footprints (and inside each lot's search cell, so the module
// labels them with their lot), at least min_spacing_m apart. levelFor picks each survivor's level.
export function placeSurvivorsInLots(config: DemoSiteConfig, lots: readonly ScaleLot[], count: number, random: () => number, levelFor: (index: number) => ScaleLevel): PlannedScaleSurvivor[] {
  if (!Number.isInteger(count) || count < 0) throw new Error('count must be a non-negative integer');
  if (count > 0 && lots.length === 0) throw new Error('No scale lots available');
  const plans: PlannedScaleSurvivor[] = [];
  const totalAttempts = Math.max(10_000, count * 400);
  let attempts = 0;
  while (plans.length < count && attempts < totalAttempts) {
    attempts += 1;
    const lot = lots[Math.floor(random() * lots.length)]!;
    const xs = lot.ring.map((point) => point[0]);
    const ys = lot.ring.map((point) => point[1]);
    const east_m = Math.min(...xs) + random() * (Math.max(...xs) - Math.min(...xs));
    const north_m = Math.min(...ys) + random() * (Math.max(...ys) - Math.min(...ys));
    if (!insideRing(east_m, north_m, lot.ring)) continue;
    // Stay inside the lot's search cell too, so the module labels the survivor with its lot.
    if (Math.abs(east_m - lot.east_m) > config.cell_size_m / 2 - 0.5 || Math.abs(north_m - lot.north_m) > config.cell_size_m / 2 - 0.5) continue;
    if (Math.hypot(east_m, north_m) > config.site.radius_m) continue;
    if (plans.some((point) => Math.hypot(point.east_m - east_m, point.north_m - north_m) < config.scale.min_spacing_m)) continue;
    const level = levelFor(plans.length);
    plans.push({ lot: lot.label, east_m, north_m, level, ...makeClinicalPlan(level, random, config) });
  }
  if (plans.length !== count) throw new Error(`Could only place ${plans.length} of ${count} scale survivors while preserving ${config.scale.min_spacing_m} m spacing`);
  return plans;
}

function makeClinicalPlan(level: ScaleLevel, random: () => number, config: DemoSiteConfig): Omit<PlannedScaleSurvivor, 'lot' | 'east_m' | 'north_m' | 'level'> {
  if (level === 'unknown') return { breathing: 'unknown', breathing_confidence: 0, thermal_temp_c: range(random, 31, 36) };
  const visibility = level === 'immediate' ? intRange(random, 5, 30) : level === 'delayed' ? intRange(random, 30, 70) : intRange(random, 60, 100);
  const notDetected = level === 'immediate' && random() < config.scale.not_detected_share_of_immediate;
  const breathing = notDetected ? 'not_detected' : 'detected';
  const rate = notDetected ? undefined : level === 'immediate' ? choose(random, [[8, 10], [28, 34]]) : level === 'delayed' ? intRange(random, 12, 24) : intRange(random, 12, 20);
  const breathingConfidence = notDetected ? range(random, 0.2, 0.4) : range(random, 0.4, 0.9);
  const score = level === 'immediate' ? range(random, 75, 89) : level === 'delayed' ? range(random, 45, 70) : range(random, 10, 40);
  const thermal = range(random, 31, 36);
  const reasons = notDetected
    ? ['no signs of life detected, low confidence', `${visibility}% of body visible`]
    : [`breathing seen ${rate} per min`, `${visibility}% of body visible`, `thermal ${thermal.toFixed(1)} C`];
  return {
    breathing,
    ...(rate === undefined ? {} : { rate_bpm: rate }),
    breathing_confidence: breathingConfidence,
    visibility_pct: visibility,
    thermal_temp_c: thermal,
    score,
    score_confidence: range(random, 0.5, 0.85),
    score_reasons: reasons,
  };
}

function choose(random: () => number, ranges: Array<[number, number]>): number {
  const [minimum, maximum] = ranges[Math.floor(random() * ranges.length)]!;
  return intRange(random, minimum, maximum);
}
function intRange(random: () => number, minimum: number, maximum: number): number { return Math.floor(range(random, minimum, maximum + 1)); }
function range(random: () => number, minimum: number, maximum: number): number { return minimum + random() * (maximum - minimum); }

export async function scaleSurvivors(config: DemoSiteConfig, pool: SimPool, count = config.scale.count, ratePerSecond = config.scale.rate_per_s): Promise<number> {
  if (!Number.isFinite(ratePerSecond) || ratePerSecond < 0) throw new Error('rate must be a non-negative number');
  const sim = pool.get('sim');
  const plans = planScaleSurvivors(config, count);
  await logInjection(sim, 'scale', String(count));
  const robotIds = Array.from({ length: config.robots.fleet_size }, (_, index) => `${config.robots.sim.robot_id}-${index + 2}`);
  const missionIds = await ensureHoldMissions(sim, pool, robotIds);
  try {
    return await reportScalePlans(config, pool, plans, ratePerSecond, robotIds, missionIds);
  } finally {
    await finishHoldMissions(sim, pool, missionIds);
  }
}

async function reportScalePlans(config: DemoSiteConfig, pool: SimPool, plans: PlannedScaleSurvivor[], ratePerSecond: number, robotIds: string[], missionIds: Map<string, bigint>): Promise<number> {
  const sim = pool.get('sim');
  const lastHeartbeat = new Map<string, number>();
  const lastPosition = new Map<string, number>();
  const deadlineStep = ratePerSecond > 0 ? 1000 / ratePerSecond : 0;
  let nextAt = Date.now();
  for (let index = 0; index < plans.length; index += 1) {
    const plan = plans[index]!;
    const robotId = robotIds[index % robotIds.length]!;
    const robot = pool.get(robotId);
    const point = offsetToLatLon({ lat: config.site.center_lat, lon: config.site.center_lon }, plan);
    await keepRobotOnline(config, robot, point, lastHeartbeat, lastPosition);
    const clientRef = `scale_${index + 1}`;
    await robot.connection.reducers.reportDetection({
      robotId,
      missionId: missionIds.get(robotId) ?? 0n,
      source: DetectionSource.Thermal,
      clientRef,
      ...point,
      gpsFix: false,
      locationNote: ['front room', 'under a table', 'basement stairs', 'back bedroom', 'garage'][index % 5]!,
      maxTempC: plan.thermal_temp_c!,
      thermalConfidence: 0.55 + (index % 41) / 100,
      thermalImageUrl: undefined,
      cameraImageUrl: undefined,
      breathingClipUrl: undefined,
      observedAt: undefined,
    });
    const survivor = await waitForValue(sim, () => Array.from(sim.connection.db.survivor.iter()).find((row) => round7(row.lat) === round7(point.lat) && round7(row.lon) === round7(point.lon)));
    if (plan.level !== 'unknown') {
      await sim.connection.reducers.reportBreathing({
        survivorId: survivor.id,
        breathing: plan.breathing === 'not_detected' ? BreathingEnum.NotDetected : BreathingEnum.Detected,
        rateBpm: plan.rate_bpm,
        confidence: plan.breathing_confidence,
        visibilityPct: plan.visibility_pct,
        displayUrl: undefined,
      });
      await sim.connection.reducers.setCriticalScore({
        survivorId: survivor.id,
        level: levelEnum(plan.level),
        score: plan.score!,
        confidence: plan.score_confidence!,
        reasons: plan.score_reasons!,
      });
    }
    if (deadlineStep > 0) {
      nextAt += deadlineStep;
      const wait = nextAt - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  await markCoverage(config, pool, plans.length, lastHeartbeat, lastPosition);
  return plans.length;
}

async function ensureHoldMissions(sim: SimActor, pool: SimPool, robotIds: string[]): Promise<Map<string, bigint>> {
  const result = new Map<string, bigint>();
  for (const robotId of robotIds) {
    const robot = pool.get(robotId);
    let mission = Array.from(sim.connection.db.mission.iter()).find((row) => row.robotId === robotId && row.kind.tag === 'Hold' && row.status.tag !== 'Done' && row.status.tag !== 'Failed' && row.status.tag !== 'Cancelled');
    if (!mission) {
      await sim.connection.reducers.createMission({ robotId, kind: MissionKind.Hold, targetCellIds: [], targetLat: undefined, targetLon: undefined, reason: SCALE_HOLD_REASON, chainId: 0n });
      mission = await waitForValue(sim, () => Array.from(sim.connection.db.mission.iter()).find((row) => row.robotId === robotId && row.kind.tag === 'Hold' && row.reason === SCALE_HOLD_REASON && row.status.tag === 'Queued'));
    }
    if (mission.status.tag === 'Queued') {
      const holdId = mission.id;
      await robot.connection.reducers.claimNextMission({ robotId });
      mission = await waitForValue(sim, () => Array.from(sim.connection.db.mission.iter()).find((row) => row.robotId === robotId && (row.status.tag === 'Leased' || row.status.tag === 'Active')));
      if (mission.id !== holdId) console.warn(`${robotId} leased mission ${mission.id} instead of scale hold mission ${holdId}`);
    }
    result.set(robotId, mission.id);
  }
  return result;
}

// Scale and dupes lease one hold mission per fleet robot only to tag their detections. Finish
// them when the command ends, so a one-shot run never leaves them to expire and be requeued
// with robot_id "" after the fleet robots disconnect.
export async function finishHoldMissions(sim: SimActor, pool: SimPool, missionIds: Map<string, bigint>): Promise<void> {
  for (const [robotId, missionId] of missionIds) {
    const mission = Array.from(sim.connection.db.mission.iter()).find((row) => row.id === missionId);
    if (!mission || mission.kind.tag !== 'Hold' || mission.reason !== SCALE_HOLD_REASON) continue;
    if (mission.status.tag === 'Done' || mission.status.tag === 'Failed' || mission.status.tag === 'Cancelled') continue;
    if ((mission.status.tag !== 'Leased' && mission.status.tag !== 'Active') || mission.robotId !== robotId) {
      console.warn(`Scale hold mission ${missionId} is ${mission.status.tag} for "${mission.robotId}"; ${robotId} cannot finish it`);
      continue;
    }
    try {
      await pool.get(robotId).connection.reducers.missionProgress({ missionId, status: MissionStatus.Done, note: 'scale reporting finished', observedAt: undefined });
    } catch (error) {
      console.warn(`Could not finish scale hold mission ${missionId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function markCoverage(config: DemoSiteConfig, pool: SimPool, count: number, lastHeartbeat: Map<string, number>, lastPosition: Map<string, number>): Promise<void> {
  if (count === 0) return;
  const lots = generateScaleLots(config);
  const cells = Array.from(pool.get('sim').connection.db.searchCell.iter()).filter((row) => row.label.startsWith(`${config.scale_lots.label_prefix} `));
  const random = mulberry32(config.scale.seed + count);
  const shuffled = [...cells];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }
  const searchedCount = Math.round(lots.length * 0.6);
  const partialCount = Math.round(lots.length * 0.05);
  const ids = Array.from({ length: config.robots.fleet_size }, (_, index) => `${config.robots.sim.robot_id}-${index + 2}`);
  for (let index = 0; index < searchedCount + partialCount; index += 1) {
    const cell = shuffled[index];
    if (!cell) break;
    // A robot cannot reopen a searched cell, so a repeated scale skips cells an earlier run finished.
    if (cell.status.tag === 'Searched') continue;
    const robotId = ids[index % ids.length]!;
    const robot = pool.get(robotId);
    await keepRobotOnline(config, robot, { lat: cell.lat, lon: cell.lon }, lastHeartbeat, lastPosition);
    await robot.connection.reducers.markCell({ cellId: cell.id, status: index < searchedCount ? CellStatus.Searched : CellStatus.PartiallySearched, observedAt: undefined });
  }
}

async function keepRobotOnline(config: DemoSiteConfig, robot: SimActor, point: { lat: number; lon: number }, lastHeartbeat: Map<string, number>, lastPosition: Map<string, number>): Promise<void> {
  const now = Date.now();
  const robotId = robot.name;
  if (now - (lastHeartbeat.get(robotId) ?? 0) >= config.timing.robot_heartbeat_ms) {
    await robot.connection.reducers.robotHeartbeat({ robotId, state: RobotState.Ready, batteryPct: 95, observedAt: undefined });
    lastHeartbeat.set(robotId, Date.now());
  }
  if (now - (lastPosition.get(robotId) ?? 0) >= config.timing.position_ms) {
    await robot.connection.reducers.robotReportPosition({ robotId, ...point, gpsFix: false, indoorOffsetM: 0, headingDeg: 0, observedAt: undefined });
    lastPosition.set(robotId, Date.now());
  }
}

function levelEnum(level: ScaleLevel) {
  if (level === 'immediate') return CriticalLevel.Immediate;
  if (level === 'delayed') return CriticalLevel.Delayed;
  if (level === 'minor') return CriticalLevel.Minor;
  throw new Error('Unknown survivors cannot be scored');
}

function round7(value: number): string { return value.toFixed(7); }
async function waitForValue<T>(actor: SimActor, read: () => T | undefined, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for SpacetimeDB state after ${timeoutMs} ms`);
}

export async function addDuplicatePairs(config: DemoSiteConfig, pool: SimPool, count = config.scale.duplicate_pairs): Promise<number> {
  if (!Number.isInteger(count) || count < 0) throw new Error('n must be a non-negative integer');
  const sim = pool.get('sim');
  const robotIds = Array.from({ length: config.robots.fleet_size }, (_, index) => `${config.robots.sim.robot_id}-${index + 2}`);
  const prefix = `${config.scale_lots.label_prefix} `;
  const detections = Array.from(sim.connection.db.detection.iter());
  const candidates = Array.from(sim.connection.db.survivor.iter())
    .filter((row) => row.status.tag !== 'Resolved' && row.possibleDuplicateOf === 0n && (row.houseLabel ?? '').startsWith(prefix))
    .sort((a, b) => Number(a.id - b.id));
  if (candidates.length < count) throw new Error(`dupes needs ${count} scale survivors; run scale first`);
  await logInjection(sim, 'dupes', String(count));
  const missionIds = await ensureHoldMissions(sim, pool, robotIds);
  try {
    await reportDuplicates(config, pool, candidates, count, robotIds, missionIds, detections);
  } finally {
    await finishHoldMissions(sim, pool, missionIds);
  }
  return count;
}

async function reportDuplicates(config: DemoSiteConfig, pool: SimPool, candidates: Array<{ lat: number; lon: number; firstDetectionId: bigint; locationNote: string }>, count: number, robotIds: string[], missionIds: Map<string, bigint>, detections: Array<{ id: bigint; robotId: string }>): Promise<void> {
  const sim = pool.get('sim');
  const random = mulberry32(config.scale.seed + 77);
  const lastHeartbeat = new Map<string, number>();
  const lastPosition = new Map<string, number>();
  for (let index = 0; index < count; index += 1) {
    const original = candidates.splice(Math.floor(random() * candidates.length), 1)[0]!;
    const firstRobot = detections.find((row) => row.id === original.firstDetectionId)?.robotId;
    const robotId = robotIds.find((id) => id !== firstRobot) ?? robotIds[0]!;
    const robot = pool.get(robotId);
    const angle = random() * Math.PI * 2;
    const distance = 5 + random();
    const point = {
      lat: original.lat + (Math.sin(angle) * distance) / 111_320,
      lon: original.lon + (Math.cos(angle) * distance) / (111_320 * Math.cos((original.lat * Math.PI) / 180)),
    };
    await keepRobotOnline(config, robot, point, lastHeartbeat, lastPosition);
    const clientRef = `dupe_${Date.now()}_${index + 1}`;
    await robot.connection.reducers.reportDetection({
      robotId,
      missionId: missionIds.get(robotId) ?? 0n,
      source: DetectionSource.Thermal,
      clientRef,
      ...point,
      gpsFix: false,
      locationNote: original.locationNote || 'near another finding',
      maxTempC: 33,
      thermalConfidence: 0.7,
      thermalImageUrl: undefined,
      cameraImageUrl: undefined,
      breathingClipUrl: undefined,
      observedAt: undefined,
    });
    await waitForValue(sim, () => Array.from(sim.connection.db.detection.iter()).find((row) => row.clientRef === clientRef && row.survivorId !== 0n));
  }
}
