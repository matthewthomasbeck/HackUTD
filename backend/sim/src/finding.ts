import { Breathing, CriticalLevel, DetectionSource } from '../../spacetimedb-bindings/types.js';
import type { DemoSiteConfig } from './config.ts';
import type { LatLon } from './geo.ts';
import type { SimPool } from './pool.ts';
import { mulberry32 } from './rng.ts';
import type { ScaleLevel } from './scale.ts';
import { waitForValue } from './wait.ts';

export interface FindingClinical {
  level: ScaleLevel;
  breathing: 'detected' | 'not_detected' | 'unknown';
  rate_bpm?: number;
  breathing_confidence: number;
  visibility_pct?: number;
  score?: number;
  score_confidence?: number;
  score_reasons?: string[];
}

export interface FindingDetection {
  robotId: string;
  missionId: bigint;
  point: LatLon;
  note: string;
  maxTempC?: number;
  thermalConfidence?: number;
  thermalImageUrl?: string;
  cameraImageUrl?: string;
}

let findingCounter = 0;

export async function reportDetectionAndWait(pool: SimPool, detection: FindingDetection): Promise<bigint> {
  const sim = pool.get('sim');
  const robot = pool.get(detection.robotId);
  findingCounter += 1;
  const clientRef = `find_${Date.now()}_${findingCounter}`;
  await robot.connection.reducers.reportDetection({
    robotId: detection.robotId,
    missionId: detection.missionId,
    source: DetectionSource.Thermal,
    clientRef,
    ...detection.point,
    gpsFix: false,
    locationNote: detection.note,
    maxTempC: detection.maxTempC ?? 34,
    thermalConfidence: detection.thermalConfidence ?? 0.8,
    thermalImageUrl: detection.thermalImageUrl,
    cameraImageUrl: detection.cameraImageUrl,
    breathingClipUrl: undefined,
    observedAt: undefined,
  });
  return waitForValue(sim, () => {
    const row = Array.from(sim.connection.db.detection.iter()).find((item) => item.clientRef === clientRef);
    return row && row.survivorId !== 0n ? row.survivorId : undefined;
  });
}

export async function writeClinical(pool: SimPool, survivorId: bigint, clinical: FindingClinical, displayUrl?: string): Promise<void> {
  if (clinical.level === 'unknown' || clinical.breathing === 'unknown') return;
  const sim = pool.get('sim');
  await sim.connection.reducers.reportBreathing({
    survivorId,
    breathing: clinical.breathing === 'not_detected' ? Breathing.NotDetected : Breathing.Detected,
    rateBpm: clinical.rate_bpm,
    confidence: clinical.breathing_confidence,
    visibilityPct: clinical.visibility_pct,
    displayUrl,
  });
  if (clinical.score === undefined) return;
  await sim.connection.reducers.setCriticalScore({
    survivorId,
    level: levelEnum(clinical.level),
    score: clinical.score,
    confidence: clinical.score_confidence ?? 0.6,
    reasons: clinical.score_reasons ?? [],
  });
}

export function hiddenClinical(config: DemoSiteConfig, index: number): FindingClinical {
  const entry = config.hidden_survivors[index];
  if (!entry) throw new Error(`No hidden survivor ${index}`);
  const random = mulberry32(config.scale.seed + 1000 + index);
  const between = (minimum: number, maximum: number) => minimum + random() * (maximum - minimum);
  const score = entry.level === 'immediate' ? between(75, 89) : entry.level === 'delayed' ? between(45, 70) : entry.level === 'minor' ? between(10, 40) : undefined;
  const visibility = entry.visibility_pct;
  const reasons = entry.breathing === 'not_detected'
    ? ['no signs of life detected, low confidence']
    : [`breathing seen ${entry.rate_bpm ?? 'at an unknown rate'} per min`];
  if (visibility !== undefined) reasons.push(`${visibility}% of body visible`);
  return {
    level: entry.level,
    breathing: entry.breathing,
    ...(entry.rate_bpm === undefined ? {} : { rate_bpm: entry.rate_bpm }),
    breathing_confidence: entry.breathing === 'not_detected' ? between(0.2, 0.4) : between(0.4, 0.9),
    ...(visibility === undefined ? {} : { visibility_pct: visibility }),
    ...(score === undefined ? {} : { score, score_confidence: between(0.5, 0.85), score_reasons: reasons }),
  };
}

function levelEnum(level: ScaleLevel) {
  if (level === 'immediate') return CriticalLevel.Immediate;
  if (level === 'delayed') return CriticalLevel.Delayed;
  if (level === 'minor') return CriticalLevel.Minor;
  throw new Error('Unknown survivors cannot be scored');
}
