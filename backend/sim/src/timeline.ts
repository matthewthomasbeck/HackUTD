import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export type AwaitCondition = 'survivor_in' | 'assignment_for' | 'released' | 'person_report' | 'mission_for' | 'watchdog_fallback' | 'audit_flag' | 'status' | 'key';

export interface TimelineStep {
  at?: string;
  after_s?: number;
  cmd?: string;
  say?: string;
  await?: AwaitCondition;
  timeout_s?: number;
  else?: string;
  say_on_timeout?: string;
  house?: string;
  rescuer?: string;
  status?: string;
  kind?: string;
}

export interface ScheduledTimelineStep {
  index: number;
  atSeconds: number | null;
  step: TimelineStep;
}

const AWAIT_CONDITIONS = new Set<AwaitCondition>([
  'survivor_in', 'assignment_for', 'released', 'person_report', 'mission_for',
  'watchdog_fallback', 'audit_flag', 'status', 'key',
]);
const STEP_KEYS = new Set([
  'at', 'after_s', 'cmd', 'say', 'await', 'timeout_s', 'else',
  'say_on_timeout', 'house', 'rescuer', 'status', 'kind',
]);

export function parseTimeline(value: unknown): TimelineStep[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('Timeline must be a non-empty array');
  return value.map((entry, index) => validateStep(entry, index));
}

export function computeTimelineSchedule(steps: readonly TimelineStep[]): ScheduledTimelineStep[] {
  let cursor: number | null = 0;
  const schedule: ScheduledTimelineStep[] = [];
  for (const [index, step] of steps.entries()) {
    if (step.at !== undefined) {
      const absolute = parseClock(step.at);
      cursor = cursor === null ? absolute : Math.max(cursor, absolute);
    } else if (step.after_s !== undefined && cursor !== null) {
      cursor += step.after_s;
    }
    schedule.push({ index: index + 1, atSeconds: cursor, step });
    if (step.await !== undefined) {
      if (step.timeout_s !== undefined && cursor !== null) cursor += step.timeout_s;
      else if (step.timeout_s === undefined) cursor = null;
    }
  }
  return schedule;
}

export async function loadTimeline(name: string, directory = new URL('../timelines/', import.meta.url)): Promise<TimelineStep[]> {
  if (!/^[a-z0-9_-]+$/.test(name)) throw new Error('Timeline name may contain only lowercase letters, digits, underscore, and dash');
  const path = resolve(directory instanceof URL ? directory.pathname : directory, `${name}.json`);
  let parsed: unknown;
  try { parsed = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`Timeline not found: ${name}`);
    throw error;
  }
  return parseTimeline(parsed);
}

export function formatTimelineDryRun(steps: readonly TimelineStep[]): string {
  return computeTimelineSchedule(steps).map(({ index, atSeconds, step }) => {
    const timestamp = atSeconds === null ? 'after unbounded wait' : formatClock(atSeconds);
    const actions: string[] = [];
    if (step.cmd) actions.push(`cmd: ${step.cmd}`);
    if (step.say) actions.push(`say: ${step.say}`);
    if (step.await) actions.push(`await: ${step.await}${step.timeout_s === undefined ? '' : ` (up to ${step.timeout_s}s)`}`);
    if (step.else) actions.push(`else: ${step.else}`);
    if (step.say_on_timeout) actions.push(`on timeout: ${step.say_on_timeout}`);
    return `${String(index).padStart(2, '0')}  ${timestamp}  ${actions.join(' | ')}`;
  }).join('\n');
}

function validateStep(value: unknown, index: number): TimelineStep {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`Timeline step ${index + 1} must be an object`);
  const entry = value as Record<string, unknown>;
  for (const key of Object.keys(entry)) if (!STEP_KEYS.has(key)) throw new Error(`Timeline step ${index + 1} has unknown field ${key}`);
  if (entry.at !== undefined && typeof entry.at !== 'string') throw new Error(`Timeline step ${index + 1} at must be m:ss`);
  if (entry.at !== undefined) parseClock(entry.at as string);
  if (entry.after_s !== undefined && (typeof entry.after_s !== 'number' || !Number.isFinite(entry.after_s) || entry.after_s < 0)) {
    throw new Error(`Timeline step ${index + 1} after_s must be a non-negative number`);
  }
  if (entry.at !== undefined && entry.after_s !== undefined) throw new Error(`Timeline step ${index + 1} cannot use both at and after_s`);
  if (entry.cmd !== undefined && (typeof entry.cmd !== 'string' || !entry.cmd.trim())) throw new Error(`Timeline step ${index + 1} cmd must be a non-empty string`);
  if (entry.say !== undefined && (typeof entry.say !== 'string' || !entry.say.trim())) throw new Error(`Timeline step ${index + 1} say must be a non-empty string`);
  if (entry.await !== undefined && (typeof entry.await !== 'string' || !AWAIT_CONDITIONS.has(entry.await as AwaitCondition))) {
    throw new Error(`Timeline step ${index + 1} has an unsupported await condition`);
  }
  if (entry.await === undefined && entry.cmd === undefined && entry.say === undefined) throw new Error(`Timeline step ${index + 1} needs cmd, say, or await`);
  if (entry.await === undefined && (entry.timeout_s !== undefined || entry.else !== undefined || entry.say_on_timeout !== undefined)) {
    throw new Error(`Timeline step ${index + 1} timeout and fallback fields require await`);
  }
  if (entry.timeout_s !== undefined && (typeof entry.timeout_s !== 'number' || !Number.isFinite(entry.timeout_s) || entry.timeout_s < 0)) {
    throw new Error(`Timeline step ${index + 1} timeout_s must be a non-negative number`);
  }
  for (const key of ['else', 'say_on_timeout', 'house', 'rescuer', 'status', 'kind']) {
    if (entry[key] !== undefined && (typeof entry[key] !== 'string' || !entry[key].trim())) throw new Error(`Timeline step ${index + 1} ${key} must be a non-empty string`);
  }
  return entry as TimelineStep;
}

function parseClock(value: string): number {
  const match = /^(\d+):([0-5]\d)$/.exec(value);
  if (!match) throw new Error(`Invalid timeline at time: ${value}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
