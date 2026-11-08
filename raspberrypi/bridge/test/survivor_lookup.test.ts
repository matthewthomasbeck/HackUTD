import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LocalMessage, ReducerCall } from '../src/mapping.ts';
import { backoffDelays, breathingPlan, DetectionPipeline, MediaClient, waitForDetection, type DetectionRef, type UploadedDetection } from '../src/media.ts';
import type { SendOutcome } from '../src/spool.ts';

function fakeClock() {
  let now = 0;
  return { now: () => now, sleep: async (ms: number) => { now += ms; } };
}

test('waitForDetection finds the survivor_id by client_ref once the row appears', async () => {
  const clock = fakeClock();
  const rows = new Map<string, DetectionRef>();
  const found = await waitForDetection('dog1-b-12', (ref) => {
    if (clock.now() >= 600) rows.set('dog1-b-12', { id: 5n, survivorId: 3n });
    return rows.get(ref);
  }, { timeoutMs: 10_000, pollMs: 200, ...clock });
  assert.deepEqual(found, { id: 5n, survivorId: 3n });
});

test('waitForDetection gives up after the timeout', async () => {
  const clock = fakeClock();
  const found = await waitForDetection('nope', () => undefined, { timeoutMs: 10_000, pollMs: 200, ...clock });
  assert.equal(found, undefined);
  assert.ok(clock.now() >= 10_000);
});

test('survivor_id 0 or no clip skips /breathing', () => {
  assert.equal(breathingPlan({ id: 5n, survivorId: 0n }, 'http://m/c.mp4').post, false);
  assert.equal(breathingPlan({ id: 5n, survivorId: 3n }, undefined).post, false);
  assert.equal(breathingPlan(undefined, 'http://m/c.mp4').post, false);
  assert.deepEqual(breathingPlan({ id: 5n, survivorId: 3n }, 'http://m/c.mp4'), { post: true, clipUrl: 'http://m/c.mp4', survivorId: 3n, detectionId: 5n });
});

test('upload retries 1, 2, 4, 8 s', () => {
  assert.deepEqual(backoffDelays(5), [1000, 2000, 4000, 8000]);
  assert.deepEqual(backoffDelays(1), []);
});

const DETECTION: LocalMessage = {
  type: 'detection', seq: 12, observed_at: '2026-11-08T15:00:00Z', robot_id: 'dog1', mission_id: 42, source: 'thermal',
  client_ref: 'dog1-b-12', lat: 1, lon: 2, gps_fix: true, location_note: '', max_temp_c: 34, thermal_confidence: 0.8,
  thermal_image_path: '/tmp/t.png', camera_image_path: null, breathing_clip_path: '/tmp/c.mp4',
};

interface Recorded { url: string; fields: Record<string, string> }

function fakeMedia(options: { failFirst?: number; status?: number } = {}) {
  const requests: Recorded[] = [];
  let failures = options.failFirst ?? 0;
  const clock = fakeClock();
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const form = init?.body as FormData;
    const fields: Record<string, string> = {};
    for (const [key, value] of form.entries()) fields[key] = typeof value === 'string' ? value : `<file ${(value as File).name}>`;
    requests.push({ url: String(url), fields });
    if (failures > 0) { failures -= 1; throw new TypeError('fetch failed'); }
    if (options.status) return new Response('no', { status: options.status });
    const name = fields.file?.replace(/<file (.*)>/, '$1') ?? 'x';
    return new Response(JSON.stringify({ url: `http://media/media/${name}` }), { status: 200 });
  }) as typeof fetch;
  const client = new MediaClient(
    { mediaUrl: 'http://media', robotId: 'dog1', attempts: 5 },
    { fetch: fetchFn, openAsBlob: async () => new Blob(['x']), sleep: clock.sleep, log: () => {} },
  );
  return { client, requests, clock };
}

test('upload sends file, robot_id and kind, and retries a network failure', async () => {
  const { client, requests, clock } = fakeMedia({ failFirst: 2 });
  const url = await client.upload('/tmp/robot/media/t.png', 'thermal');
  assert.equal(url, 'http://media/media/t.png');
  assert.equal(requests.length, 3);
  assert.deepEqual(requests[2]!.fields, { file: '<file t.png>', robot_id: 'dog1', kind: 'thermal' });
  assert.equal(clock.now(), 3000);
});

test('a 4xx upload is not retried', async () => {
  const { client, requests } = fakeMedia({ status: 400 });
  assert.equal(await client.upload('/tmp/t.png', 'thermal'), undefined);
  assert.equal(requests.length, 1);
});

function pipeline(survivorId: bigint, outcome: SendOutcome = 'ok') {
  const media = fakeMedia();
  const calls: ReducerCall[] = [];
  const rows = new Map<string, DetectionRef>();
  const logs: string[] = [];
  const p = new DetectionPipeline({
    media: media.client,
    call: async (c) => {
      calls.push(c);
      if (outcome === 'ok' && c.reducer === 'reportDetection') rows.set(c.args.clientRef, { id: 77n, survivorId });
      return outcome;
    },
    findDetection: (ref) => rows.get(ref),
    sleep: media.clock.sleep,
    now: media.clock.now,
    log: (line) => logs.push(line),
  });
  return { p, calls, rows, requests: media.requests, logs };
}

test('detection: upload, report, find survivor by client_ref, then POST /breathing with the clip url', async () => {
  const { p, calls, requests } = pipeline(3n);
  assert.equal(await p.handle({ ...DETECTION }), 'ok');
  await Promise.all(p.pending);
  assert.equal(calls.length, 1);
  const c = calls[0]!;
  assert.equal(c.reducer, 'reportDetection');
  if (c.reducer !== 'reportDetection') return;
  assert.equal(c.args.thermalImageUrl, 'http://media/media/t.png');
  assert.equal(c.args.cameraImageUrl, undefined);
  assert.equal(c.args.breathingClipUrl, 'http://media/media/c.mp4');
  const breathing = requests.filter((r) => r.url.endsWith('/breathing'));
  assert.equal(breathing.length, 1);
  assert.deepEqual(breathing[0]!.fields, { clip_url: 'http://media/media/c.mp4', survivor_id: '3', detection_id: '77' });
});

test('detection with survivor_id 0 skips /breathing', async () => {
  const { p, requests, logs } = pipeline(0n);
  assert.equal(await p.handle({ ...DETECTION }), 'ok');
  await Promise.all(p.pending);
  assert.equal(requests.filter((r) => r.url.endsWith('/breathing')).length, 0);
  assert.ok(logs.some((line) => line.includes('survivor_id is 0')));
});

test('a detection already in the module (robot outbox replay) is not reported twice', async () => {
  const { p, calls } = pipeline(3n);
  await p.handle({ ...DETECTION });
  await Promise.all(p.pending);
  assert.equal(await p.handle({ ...DETECTION }), 'ok');
  assert.equal(calls.length, 1);
});

test('a spooled detection already in the module still starts /breathing with its uploaded clip', async () => {
  const { p, calls, rows, requests } = pipeline(3n);
  rows.set('dog1-b-12', { id: 77n, survivorId: 3n }); // the report landed, its ack was lost
  const msg: UploadedDetection = { ...DETECTION, _uploaded: { breathing_clip_url: 'http://media/media/c.mp4' } };
  assert.equal(await p.handle(msg), 'ok');
  await Promise.all(p.pending);
  assert.equal(calls.length, 0);
  const breathing = requests.filter((r) => r.url.endsWith('/breathing'));
  assert.deepEqual(breathing.map((r) => r.fields), [{ clip_url: 'http://media/media/c.mp4', survivor_id: '3', detection_id: '77' }]);
});

test('a network failure keeps the uploaded urls so the spool replay does not upload again', async () => {
  const { p, requests } = pipeline(3n, 'network');
  const msg: UploadedDetection = { ...DETECTION };
  assert.equal(await p.handle(msg), 'network');
  assert.deepEqual(msg._uploaded, { thermal_image_url: 'http://media/media/t.png', breathing_clip_url: 'http://media/media/c.mp4' });
  const uploads = requests.length;
  await p.handle(msg);
  assert.equal(requests.length, uploads);
});
