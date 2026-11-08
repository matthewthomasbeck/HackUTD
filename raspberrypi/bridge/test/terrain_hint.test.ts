import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.ts';
import { hintFromAnswer, TerrainHintLink, type TerrainHintDeps } from '../src/terrain_hint.ts';

interface Posted { url: string; fields: Record<string, string>; fileName: string | undefined }

/** A fake world: a frame file with an mtime, a clock, a perception service, and the robot socket. */
function setup(answer: (posted: Posted) => Response | Promise<Response> | 'hang' = (p) =>
  Response.json({ terrain_class: 'debris', confidence: 0.72, observed_at: p.fields.observed_at })) {
  const state = {
    now: Date.parse('2026-11-08T12:00:01.300Z'),
    mtime: Date.parse('2026-11-08T12:00:01.200Z') as number | undefined,
    connected: true,
    ruleClass: 'flat' as string | undefined,
  };
  const posted: Posted[] = [];
  const toRobot: object[] = [];
  const logs: string[] = [];
  const deps: TerrainHintDeps = {
    mtimeMs: async () => state.mtime,
    openAsBlob: async () => new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }),
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      const form = init?.body as FormData;
      const fields: Record<string, string> = {};
      let fileName: string | undefined;
      for (const [key, value] of form.entries()) {
        if (typeof value === 'string') fields[key] = value;
        else fileName = value.name;
      }
      const p = { url: String(url), fields, fileName };
      posted.push(p);
      const r = answer(p);
      if (r === 'hang') {
        // Like a dead server: only the abort signal ends it.
        return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('timeout'))));
      }
      return r;
    }) as typeof fetch,
    now: () => state.now,
    sendToRobot: (m) => {
      if (!state.connected) return false;
      toRobot.push(m);
      return true;
    },
    isClientConnected: () => state.connected,
    ruleClass: () => state.ruleClass,
    log: (line) => logs.push(line),
  };
  const link = new TerrainHintLink(
    { mediaUrl: 'http://media', robotId: 'dog1', framePath: '/m/terrain_hint.jpg', minIntervalMs: 1100, timeoutMs: 50, maxAgeMs: 1500 },
    deps,
  );
  return { state, posted, toRobot, logs, link };
}

test('a new frame is posted with the contract fields and the answer is forwarded unchanged', async () => {
  const { posted, toRobot, link } = setup();
  await link.tick();
  assert.equal(posted.length, 1);
  assert.equal(posted[0].url, 'http://media/terrain');
  assert.deepEqual(posted[0].fields, { robot_id: 'dog1', rule_class: 'flat', observed_at: '2026-11-08T12:00:01.200Z' });
  assert.equal(posted[0].fileName, 'terrain_hint.jpg');
  assert.deepEqual(toRobot, [{ type: 'terrain_hint', terrain_class: 'debris', confidence: 0.72, observed_at: '2026-11-08T12:00:01.200Z' }]);
});

test('the same frame is never posted twice, and posts are at most one per 1.1 s', async () => {
  const { state, posted, link } = setup();
  await link.tick();
  state.now += 2000;
  await link.tick();  // same mtime: nothing new
  assert.equal(posted.length, 1);
  state.mtime = state.now - 50;
  state.now += 100;
  await link.tick();
  assert.equal(posted.length, 2);
  state.mtime = state.now - 10;
  state.now += 500;  // 0.5 s after the last post
  await link.tick();
  assert.equal(posted.length, 2);
});

test('a frame older than the robot would use is skipped, not posted', async () => {
  const { state, posted, toRobot, link } = setup();
  state.mtime = state.now - 1600;
  await link.tick();
  assert.equal(posted.length, 0);
  assert.equal(toRobot.length, 0);
});

test('no frame file, or no C++ client, posts nothing', async () => {
  const a = setup();
  a.state.mtime = undefined;
  await a.link.tick();
  assert.equal(a.posted.length, 0);
  const b = setup();
  b.state.connected = false;
  await b.link.tick();
  assert.equal(b.posted.length, 0);
});

test('errors, timeouts, and bad answers send nothing and are not retried', async () => {
  for (const answer of [
    () => new Response('busy', { status: 429 }),
    () => new Response('old', { status: 409 }),
    () => new Response('boom', { status: 500 }),
    () => Promise.reject(new Error('ECONNREFUSED')),
    () => 'hang' as const,
    (p: Posted) => Response.json({ terrain_class: 'rubble', confidence: 0.9, observed_at: p.fields.observed_at }),
    (p: Posted) => Response.json({ terrain_class: 'gap', confidence: 1.5, observed_at: p.fields.observed_at }),
    () => Response.json({ terrain_class: 'gap', confidence: 0.9, observed_at: '2026-11-08T12:00:00.000Z' }),
    () => new Response('not json', { status: 200 }),
  ]) {
    const { state, posted, toRobot, link } = setup(answer);
    await link.tick();
    state.now += 5000;
    await link.tick();  // the same frame is not posted again
    assert.equal(posted.length, 1);
    assert.equal(toRobot.length, 0);
    assert.equal(link.busy, false);
  }
});

test('an answer that arrives too late is dropped', async () => {
  let s: ReturnType<typeof setup>['state'] | undefined;
  const t = setup((p) => {
    s!.now += 1500;  // the service took 1.5 s
    return Response.json({ terrain_class: 'step', confidence: 0.8, observed_at: p.fields.observed_at });
  });
  s = t.state;
  await t.link.tick();
  assert.equal(t.posted.length, 1);
  assert.equal(t.toRobot.length, 0);
});

test('rule_class is unknown before the robot has sent terrain', async () => {
  const { state, posted, link } = setup();
  state.ruleClass = undefined;
  await link.tick();
  assert.equal(posted[0].fields.rule_class, 'unknown');
});

test('hintFromAnswer accepts only the contract shape for the frame posted', () => {
  const at = '2026-11-08T12:00:01.200Z';
  assert.deepEqual(hintFromAnswer({ terrain_class: 'unknown', confidence: 0, observed_at: at }, at),
    { type: 'terrain_hint', terrain_class: 'unknown', confidence: 0, observed_at: at });
  assert.equal(typeof hintFromAnswer(null, at), 'string');
  assert.equal(typeof hintFromAnswer({ terrain_class: 'flat', confidence: Number.NaN, observed_at: at }, at), 'string');
  assert.equal(typeof hintFromAnswer({ terrain_class: 'flat', confidence: '0.5', observed_at: at }, at), 'string');
});

test('TERRAIN_HINT is off by default and the frame path follows MEDIA_DIR', () => {
  const off = loadConfig({});
  assert.equal(off.terrainHint, false);
  assert.equal(off.terrainFrame, '/var/lib/robot/media/terrain_hint.jpg');
  const on = loadConfig({ TERRAIN_HINT: 'on', MEDIA_DIR: '/tmp/robot/media/' });
  assert.equal(on.terrainHint, true);
  assert.equal(on.terrainFrame, '/tmp/robot/media/terrain_hint.jpg');
  assert.throws(() => loadConfig({ TERRAIN_HINT: 'yes' }));
});
