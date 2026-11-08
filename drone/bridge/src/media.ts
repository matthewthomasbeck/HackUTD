// Media upload and the breathing hand-off for each detection (robot.md 9.6, CONTRACTS.md "Media server").
// 1. Upload each file with POST {MEDIA_URL}/media (field `file`, plus robot_id and kind), retrying
//    with 1, 2, 4, 8 s waits, MEDIA_RETRIES attempts in all.
// 2. report_detection with the URLs (a failed upload becomes no URL: location matters more).
// 3. Wait up to 10 s for the detection row with this client_ref and read its survivor_id.
// 4. If there is a clip and survivor_id != 0, POST {MEDIA_URL}/breathing with clip_url,
//    survivor_id, and detection_id, so the clip is not uploaded twice.
// Every dependency (fetch, file open, sleep, clock, reducer call, cache lookup) is injected.

import { basename } from 'node:path';
import { detectionPaths, mapMessage, MappingError, type DetectionUrls, type LocalMessage, type ReducerCall } from './mapping.ts';
import type { SendOutcome } from './spool.ts';

export type MediaKind = 'thermal' | 'camera' | 'clip' | 'terrain' | 'log';

export interface MediaDeps {
  fetch: typeof fetch;
  openAsBlob: (path: string) => Promise<Blob>;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

export interface MediaOptions {
  mediaUrl: string;
  robotId: string;
  /** Attempts in all for one upload (MEDIA_RETRIES, default 5). */
  attempts: number;
  /** Per-request timeout. */
  timeoutMs?: number;
}

/** Waits between attempts: 1, 2, 4, 8 s, then 8 s for any further attempt. */
export function backoffDelays(attempts: number): number[] {
  const delays: number[] = [];
  for (let index = 0; index < attempts - 1; index += 1) delays.push(Math.min(1000 * 2 ** index, 8000));
  return delays;
}

class PermanentError extends Error {}

export class MediaClient {
  constructor(private readonly options: MediaOptions, private readonly deps: MediaDeps) {}

  /** Upload one file and return its URL, or undefined after the last attempt fails. */
  async upload(path: string, kind: MediaKind, retry = true): Promise<string | undefined> {
    const attempts = retry ? this.options.attempts : 1;
    const result = await this.withRetry(`upload ${kind} ${path}`, attempts, async () => {
      let blob: Blob;
      try {
        blob = await this.deps.openAsBlob(path);
      } catch (error) {
        throw new PermanentError(`cannot read ${path}: ${String(error)}`);
      }
      const form = new FormData();
      form.append('file', blob, basename(path));
      form.append('robot_id', this.options.robotId);
      form.append('kind', kind);
      const body = await this.post('/media', form);
      const url = (body as { url?: unknown } | undefined)?.url;
      if (typeof url !== 'string' || url === '') throw new PermanentError('media server returned no url');
      return url;
    });
    return result;
  }

  /** Start breathing analysis on an already-uploaded clip. Returns true on success. */
  async postBreathing(input: { clipUrl: string; survivorId: bigint; detectionId: bigint }): Promise<boolean> {
    const result = await this.withRetry(`breathing for survivor ${input.survivorId}`, this.options.attempts, async () => {
      const form = new FormData();
      form.append('clip_url', input.clipUrl);
      form.append('survivor_id', input.survivorId.toString());
      form.append('detection_id', input.detectionId.toString());
      await this.post('/breathing', form);
      return true;
    });
    return result === true;
  }

  private async post(path: string, form: FormData): Promise<unknown> {
    const response = await this.deps.fetch(`${this.options.mediaUrl}${path}`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
    });
    const text = await response.text();
    if (response.status >= 400 && response.status < 500) throw new PermanentError(`${path} returned ${response.status}: ${text.slice(0, 200)}`);
    if (!response.ok) throw new Error(`${path} returned ${response.status}`);
    try {
      return text ? JSON.parse(text) : undefined;
    } catch {
      return undefined;
    }
  }

  private async withRetry<T>(what: string, attempts: number, run: () => Promise<T>): Promise<T | undefined> {
    const delays = backoffDelays(attempts);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await run();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof PermanentError) {
          this.deps.log(`media: ${what} failed: ${message}`);
          return undefined;
        }
        if (attempt === attempts - 1) {
          this.deps.log(`media: ${what} failed after ${attempts} attempts: ${message}`);
          return undefined;
        }
        await this.deps.sleep(delays[attempt]!);
      }
    }
    return undefined;
  }
}

export interface DetectionRef {
  id: bigint;
  survivorId: bigint;
}

export interface WaitOptions {
  timeoutMs: number;
  pollMs: number;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

/** Poll the subscription cache for the detection row with this client_ref. */
export async function waitForDetection(
  clientRef: string,
  find: (clientRef: string) => DetectionRef | undefined,
  options: WaitOptions,
): Promise<DetectionRef | undefined> {
  const deadline = options.now() + options.timeoutMs;
  for (;;) {
    const found = find(clientRef);
    if (found) return found;
    if (options.now() >= deadline) return undefined;
    await options.sleep(options.pollMs);
  }
}

export type BreathingPlan =
  | { post: true; clipUrl: string; survivorId: bigint; detectionId: bigint }
  | { post: false; reason: string };

export function breathingPlan(found: DetectionRef | undefined, clipUrl: string | undefined): BreathingPlan {
  if (!clipUrl) return { post: false, reason: 'no clip url' };
  if (!found) return { post: false, reason: 'detection row did not appear within the wait' };
  if (found.survivorId === 0n) return { post: false, reason: 'survivor_id is 0 (stored without a survivor); clip kept' };
  return { post: true, clipUrl, survivorId: found.survivorId, detectionId: found.id };
}

export interface DetectionDeps {
  media: Pick<MediaClient, 'upload' | 'postBreathing'>;
  call: (call: ReducerCall) => Promise<SendOutcome>;
  findDetection: (clientRef: string) => DetectionRef | undefined;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  log: (line: string) => void;
  lookupTimeoutMs?: number;
}

/** A detection message after its uploads; the spool keeps these so a replay does not upload twice. */
export type UploadedDetection = LocalMessage & { _uploaded?: DetectionUrls };

export class DetectionPipeline {
  /** Breathing hand-offs still running, so tests and shutdown can wait for them. */
  readonly pending = new Set<Promise<void>>();

  constructor(private readonly deps: DetectionDeps) {}

  /**
   * Upload, then report_detection. Returns the reducer outcome. The breathing step runs in the
   * background so it never holds up the next message. On a network failure the message keeps its
   * uploaded URLs in `_uploaded`, so the spool replay skips the uploads.
   */
  async handle(msg: UploadedDetection): Promise<SendOutcome> {
    try {
      mapMessage(msg); // validate before spending time on uploads
    } catch (error) {
      if (error instanceof MappingError) {
        this.deps.log(`detection: ${error.message}`);
        return 'rejected';
      }
      throw error;
    }
    const clientRef = String(msg.client_ref);
    // The robot's outbox replays important messages after a bridge restart; skip a detection the
    // module already has. A spooled detection whose report landed just before a network failure
    // still carries its clip url, so the /breathing hand-off it never got is started here.
    if (this.deps.findDetection(clientRef)) {
      this.deps.log(`detection ${clientRef}: already reported, skipped`);
      if (msg._uploaded?.breathing_clip_url) this.startHandOff(clientRef, msg._uploaded.breathing_clip_url);
      return 'ok';
    }
    const urls = msg._uploaded ?? (await this.uploadAll(msg));
    msg._uploaded = urls;
    const mapped = mapMessage(msg, { detection: urls });
    if (mapped.kind !== 'call') return 'ok';
    for (const warning of mapped.warnings) this.deps.log(warning);
    const outcome = await this.deps.call(mapped.call);
    if (outcome === 'ok') this.startHandOff(clientRef, urls.breathing_clip_url);
    return outcome;
  }

  private startHandOff(clientRef: string, clipUrl: string | undefined): void {
    const work = this.handOff(clientRef, clipUrl).finally(() => this.pending.delete(work));
    this.pending.add(work);
  }

  private async uploadAll(msg: LocalMessage): Promise<DetectionUrls> {
    const paths = detectionPaths(msg);
    const [thermal, camera, clip] = await Promise.all([
      paths.thermal ? this.deps.media.upload(paths.thermal, 'thermal') : undefined,
      paths.camera ? this.deps.media.upload(paths.camera, 'camera') : undefined,
      paths.clip ? this.deps.media.upload(paths.clip, 'clip') : undefined,
    ]);
    const urls: DetectionUrls = {};
    if (thermal) urls.thermal_image_url = thermal;
    if (camera) urls.camera_image_url = camera;
    if (clip) urls.breathing_clip_url = clip;
    return urls;
  }

  private async handOff(clientRef: string, clipUrl: string | undefined): Promise<void> {
    try {
      const found = clipUrl
        ? await waitForDetection(clientRef, this.deps.findDetection, {
          timeoutMs: this.deps.lookupTimeoutMs ?? 10_000,
          pollMs: 200,
          sleep: this.deps.sleep,
          now: this.deps.now,
        })
        : undefined;
      const plan = breathingPlan(found, clipUrl);
      if (!plan.post) {
        this.deps.log(`detection ${clientRef}: no /breathing (${plan.reason})`);
        return;
      }
      const ok = await this.deps.media.postBreathing(plan);
      this.deps.log(`detection ${clientRef}: /breathing for survivor ${plan.survivorId} ${ok ? 'started' : 'failed'}`);
    } catch (error) {
      this.deps.log(`detection ${clientRef}: breathing hand-off failed: ${String(error)}`);
    }
  }
}
