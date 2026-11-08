import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DemoSiteConfig } from './config.ts';
import { reportDetectionAndWait, writeClinical, type FindingClinical } from './finding.ts';
import type { LatLon } from './geo.ts';
import type { SimPool } from './pool.ts';

const PERCEPTION_WAIT_MS = 20_000;
const DEFAULT_RESULT: FindingClinical = {
  level: 'immediate',
  breathing: 'detected',
  rate_bpm: 14,
  breathing_confidence: 0.7,
  visibility_pct: 40,
  score: 92,
  score_confidence: 0.7,
  score_reasons: ['breathing seen 14 per min', '40% of body visible', 'rehearsal result (simulated)'],
};

export async function replayHouse3(config: DemoSiteConfig, pool: SimPool, robotId: string, missionId: bigint, point: LatLon, env: NodeJS.ProcessEnv = process.env): Promise<bigint> {
  const thermalImageUrl = await uploadMedia(config.media.rehearsal_thermal, 'thermal', robotId, env);
  const cameraImageUrl = await uploadMedia(config.media.rehearsal_camera, 'camera', robotId, env);
  const survivorId = await reportDetectionAndWait(pool, {
    robotId,
    missionId,
    point,
    note: '8 m in from the front door',
    ...(thermalImageUrl ? { thermalImageUrl } : {}),
    ...(cameraImageUrl ? { cameraImageUrl } : {}),
  });
  console.log(`Replay: ${robotId} reported the house 3 detection (survivor ${survivorId}).`);
  if (await requestBreathing(config, pool, survivorId, env)) return survivorId;
  console.warn('WARNING: perception did not answer within 20 s. Writing the rehearsal result; say so out loud.');
  await writeClinical(pool, survivorId, await readRehearsalResult(config));
  return survivorId;
}

async function requestBreathing(config: DemoSiteConfig, pool: SimPool, survivorId: bigint, env: NodeJS.ProcessEnv): Promise<boolean> {
  const base = env.PERCEPTION_BASE?.replace(/\/$/, '');
  const clip = await readAsset(config.media.rehearsal_clip);
  if (!base || !clip) {
    console.warn(`Replay: ${!base ? 'PERCEPTION_BASE is not set' : `rehearsal clip ${config.media.rehearsal_clip} is missing`}, so the real breathing check cannot run.`);
    return false;
  }
  try {
    const form = new FormData();
    form.append('file', new Blob([clip]), basename(config.media.rehearsal_clip ?? 'breathing.mp4'));
    form.append('survivor_id', survivorId.toString());
    const response = await fetch(`${base}/breathing`, { method: 'POST', body: form, signal: AbortSignal.timeout(PERCEPTION_WAIT_MS) });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  } catch (error) {
    console.warn(`Replay: POST /breathing failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
  const sim = pool.get('sim');
  const deadline = Date.now() + PERCEPTION_WAIT_MS;
  while (Date.now() < deadline) {
    const survivor = Array.from(sim.connection.db.survivor.iter()).find((row) => row.id === survivorId);
    if (survivor && survivor.breathing.tag !== 'Unknown') return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function uploadMedia(path: string | undefined, kind: string, robotId: string, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const base = env.MEDIA_BASE?.replace(/\/$/, '');
  const file = await readAsset(path);
  if (!base || !file || !path) return undefined;
  try {
    const form = new FormData();
    form.append('file', new Blob([file]), basename(path));
    form.append('kind', kind);
    form.append('robot_id', robotId);
    const response = await fetch(`${base}/media`, { method: 'POST', body: form, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const body = await response.json() as { url?: unknown };
    return typeof body.url === 'string' ? body.url : undefined;
  } catch (error) {
    console.warn(`Replay: upload of ${path} failed: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

async function readRehearsalResult(config: DemoSiteConfig): Promise<FindingClinical> {
  const raw = await readAsset(config.media.rehearsal_result);
  if (!raw) {
    console.warn(`Replay: ${config.media.rehearsal_result} is missing, so the built-in rehearsal defaults are used.`);
    return DEFAULT_RESULT;
  }
  const parsed = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
  const number = (key: string, fallback: number | undefined) => typeof parsed[key] === 'number' ? parsed[key] as number : fallback;
  const reasons = Array.isArray(parsed.score_reasons) ? parsed.score_reasons.filter((item): item is string => typeof item === 'string') : DEFAULT_RESULT.score_reasons;
  const breathing = parsed.breathing === 'not_detected' || parsed.breathing === 'detected' ? parsed.breathing : DEFAULT_RESULT.breathing;
  const level = ['immediate', 'delayed', 'minor'].includes(parsed.level as string) ? parsed.level as FindingClinical['level'] : DEFAULT_RESULT.level;
  const rate = number('rate_bpm', DEFAULT_RESULT.rate_bpm);
  const visibility = number('visibility_pct', DEFAULT_RESULT.visibility_pct);
  return {
    level,
    breathing,
    ...(rate === undefined ? {} : { rate_bpm: rate }),
    breathing_confidence: number('confidence', DEFAULT_RESULT.breathing_confidence)!,
    ...(visibility === undefined ? {} : { visibility_pct: visibility }),
    score: number('score', DEFAULT_RESULT.score)!,
    score_confidence: number('score_confidence', DEFAULT_RESULT.score_confidence)!,
    score_reasons: reasons,
  };
}

async function readAsset(path: string | undefined): Promise<Buffer | undefined> {
  if (!path) return undefined;
  try { return await readFile(fileURLToPath(new URL(`../${path}`, import.meta.url))); }
  catch { return undefined; }
}
