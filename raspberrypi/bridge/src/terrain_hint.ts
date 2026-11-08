// The optional camera terrain hint (robot.md 7b.5 and 9.4; CONTRACTS.md version 8.1).
//
// Off unless TERRAIN_HINT=on, to match the robot's terrain.camera_hint.enabled: false.
// Each tick, if <media_dir>/terrain_hint.jpg is newer than the last frame posted, post it to
// POST {MEDIA_URL}/terrain with robot_id, rule_class (the class in the robot's latest terrain
// message), and observed_at (the file's modification time, which the robot sets to the capture
// time). On a 200 answer for that same observed_at, send one terrain_hint line to the robot with
// terrain_class, confidence, and observed_at unchanged.
//
// It is a latest-value path, never a queue: one request at a time, a frame older than
// TERRAIN_HINT_MAX_AGE_MS is skipped, an answer for a frame older than one already forwarded is
// dropped, and an error, a timeout, a bad answer, or no C++ client sends nothing and is never
// retried, because an old hint is useless. The robot checks age and values again on its side.
//
// Example trace: the robot saves a frame captured at 12:00:01.200Z. At 12:00:01.300 the bridge
// posts it with rule_class "flat". The service answers {"terrain_class":"debris","confidence":0.72,
// "observed_at":"2026-11-08T12:00:01.200Z"} 180 ms later, and the bridge sends exactly that as a
// terrain_hint. The robot ages it from 12:00:01.200, so it is ignored after 12:00:02.700.

import { ENUMS } from './enums.ts';

export const TERRAIN_CLASSES: readonly string[] = Object.keys(ENUMS.terrain_class);

export interface TerrainHintOptions {
  mediaUrl: string;
  robotId: string;
  framePath: string;   // <media_dir>/terrain_hint.jpg
  minIntervalMs: number;  // the service takes at most one frame per second per robot
  timeoutMs: number;      // robot.md 9.4: 1 s
  maxAgeMs: number;       // skip frames and answers older than the robot would use
}

export interface TerrainHintDeps {
  /** Modification time in ms, or undefined if the file does not exist. */
  mtimeMs: (path: string) => Promise<number | undefined>;
  openAsBlob: (path: string) => Promise<Blob>;
  fetch: typeof globalThis.fetch;
  now: () => number;
  sendToRobot: (message: object) => boolean;
  isClientConnected: () => boolean;
  /** The terrain_class of the robot's latest terrain message, or undefined before the first one. */
  ruleClass: () => string | undefined;
  log: (line: string) => void;
}

export interface TerrainHintMessage {
  type: 'terrain_hint';
  terrain_class: string;
  confidence: number;
  observed_at: string;
}

/** Checks a POST /terrain answer; returns the hint to forward or why not. */
export function hintFromAnswer(body: unknown, postedObservedAt: string): TerrainHintMessage | string {
  if (!body || typeof body !== 'object') return 'answer is not an object';
  const b = body as Record<string, unknown>;
  if (typeof b.terrain_class !== 'string' || !TERRAIN_CLASSES.includes(b.terrain_class)) {
    return `invalid terrain_class ${String(b.terrain_class)}`;
  }
  if (typeof b.confidence !== 'number' || !Number.isFinite(b.confidence) || b.confidence < 0 || b.confidence > 1) {
    return `invalid confidence ${String(b.confidence)}`;
  }
  if (b.observed_at !== postedObservedAt) return `answer is for ${String(b.observed_at)}, not the frame posted`;
  return { type: 'terrain_hint', terrain_class: b.terrain_class, confidence: b.confidence, observed_at: postedObservedAt };
}

export class TerrainHintLink {
  private lastPostedMtime = 0;
  private lastPostAt = Number.NEGATIVE_INFINITY;
  private newestForwardedMs = Number.NEGATIVE_INFINITY;
  private inFlight = false;
  private lastProblem = '';

  constructor(private readonly options: TerrainHintOptions, private readonly deps: TerrainHintDeps) {}

  get busy(): boolean { return this.inFlight; }

  /** One pass; call it often (every 250 ms). Never throws. */
  async tick(): Promise<void> {
    if (this.inFlight || !this.deps.isClientConnected()) return;
    const now = this.deps.now();
    if (now - this.lastPostAt < this.options.minIntervalMs) return;
    this.inFlight = true;
    try {
      await this.postNewest(now);
    } catch (error) {
      this.problem(`terrain hint: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.inFlight = false;
    }
  }

  private async postNewest(now: number): Promise<void> {
    const mtime = await this.deps.mtimeMs(this.options.framePath);
    if (mtime === undefined || mtime <= this.lastPostedMtime) return;
    this.lastPostedMtime = mtime;
    if (now - mtime > this.options.maxAgeMs) {
      this.problem(`terrain hint: frame is ${Math.round(now - mtime)} ms old, skipped`);
      return;
    }
    const observedAt = new Date(mtime).toISOString();
    const ruleClass = this.deps.ruleClass();
    const form = new FormData();
    form.append('file', await this.deps.openAsBlob(this.options.framePath), 'terrain_hint.jpg');
    form.append('robot_id', this.options.robotId);
    form.append('rule_class', ruleClass && TERRAIN_CLASSES.includes(ruleClass) ? ruleClass : 'unknown');
    form.append('observed_at', observedAt);
    this.lastPostAt = now;
    const response = await this.deps.fetch(`${this.options.mediaUrl}/terrain`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });
    if (!response.ok) {
      this.problem(`terrain hint: POST /terrain answered ${response.status}`);
      return;
    }
    const hint = hintFromAnswer(await response.json(), observedAt);
    if (typeof hint === 'string') {
      this.problem(`terrain hint: dropped: ${hint}`);
      return;
    }
    const observedMs = Date.parse(hint.observed_at);
    if (observedMs <= this.newestForwardedMs) {
      this.problem('terrain hint: dropped: older than the hint already forwarded');
      return;
    }
    if (this.deps.now() - observedMs > this.options.maxAgeMs) {
      this.problem('terrain hint: dropped: answer came too late');
      return;
    }
    if (!this.deps.sendToRobot(hint)) return;  // no C++ client: nothing to keep
    this.newestForwardedMs = observedMs;
    this.lastProblem = '';
  }

  /** Logs a problem once, not every second while it lasts. */
  private problem(line: string): void {
    if (line === this.lastProblem) return;
    this.lastProblem = line;
    this.deps.log(line);
  }
}
