import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { LineSplitter, parseLine } from '../src/local_socket.ts';
import type { LocalMessage } from '../src/mapping.ts';
import { Router } from '../src/router.ts';
import { Spool, type SendOutcome } from '../src/spool.ts';
import { classifyError, isLiveEvent, reconnectDelayMs, subscriptionQueries } from '../src/stdb.ts';
import { tokenPathFor } from '../src/config.ts';

function setup() {
  const spool = new Spool({ path: join(mkdtempSync(join(tmpdir(), 'bridge-router-')), 'spool.jsonl'), maxBytes: 1024 * 1024 });
  spool.open();
  const state = { ready: false, robotRow: true, fail: new Set<number>() };
  const sent: string[] = [];
  const router = new Router({
    isReady: () => state.ready,
    hasRobotRow: () => state.robotRow,
    spool,
    process: async (msg: LocalMessage): Promise<SendOutcome> => {
      if (!state.ready || state.fail.has(msg.seq as number)) return 'network';
      sent.push(`${msg.type}${msg.seq}`);
      return 'ok';
    },
    log: () => {},
  });
  return { spool, state, sent, router };
}

const cell = (seq: number): LocalMessage => ({ type: 'cell', seq, cell_id: seq, status: 'searched' });

test('offline messages are spooled, heartbeats dropped, and replayed in order before live ones', async () => {
  const { spool, state, sent, router } = setup();
  router.handle({ type: 'heartbeat', seq: 1, robot_id: 'dog1', state: 'READY' });
  router.handle(cell(2));
  router.handle(cell(3));
  assert.equal(spool.size, 2);
  state.ready = true;
  void router.kick();
  router.handle(cell(4)); // live, during replay: goes to the end of the spool
  await router.idle();
  assert.deepEqual(sent, ['cell2', 'cell3', 'cell4']);
  assert.equal(spool.size, 0);
});

test('a network failure on a live send moves it and later messages to the spool', async () => {
  const { spool, state, sent, router } = setup();
  state.ready = true;
  state.fail.add(2);
  router.handle(cell(1));
  router.handle(cell(2));
  router.handle(cell(3));
  await router.idle();
  assert.deepEqual(sent, ['cell1']);
  assert.deepEqual(spool.pending().map((e) => e.msg.seq), [2, 3]);
  state.fail.clear();
  await router.kick();
  assert.deepEqual(sent, ['cell1', 'cell2', 'cell3']);
});

test('messages wait in the spool until the first heartbeat has created the robot row', async () => {
  const { spool, state, sent, router } = setup();
  state.ready = true;
  state.robotRow = false;
  router.handle({ type: 'device', seq: 1, robot_id: 'dog1', device: 'thermal', status: 'OK', detail: '' });
  router.handle({ type: 'heartbeat', seq: 2, robot_id: 'dog1', state: 'READY' });
  await router.idle();
  assert.deepEqual(sent, ['heartbeat2']);
  assert.equal(spool.size, 1);
  state.robotRow = true;
  await router.kick();
  assert.deepEqual(sent, ['heartbeat2', 'device1']);
});

test('mission_id 0 messages are logged only', async () => {
  const { spool, state, sent, router } = setup();
  state.ready = true;
  router.handle({ type: 'mission_progress', seq: 1, mission_id: 0, status: 'active' });
  await router.idle();
  assert.deepEqual(sent, []);
  assert.equal(spool.size, 0);
});

test('NDJSON splitting and parsing', () => {
  const splitter = new LineSplitter();
  assert.deepEqual(splitter.push('{"type":"cell"'), []);
  assert.deepEqual(splitter.push(',"cell_id":1}\n{"type":"x"}\n'), ['{"type":"cell","cell_id":1}', '{"type":"x"}']);
  assert.ok('msg' in parseLine('{"type":"cell"}'));
  assert.ok('error' in parseLine('[1]'));
  assert.ok('error' in parseLine('{"no":"type"}'));
  assert.ok('error' in parseLine('nope'));
});

test('SenderError is a rejection; other errors are network failures', () => {
  class SenderError extends Error { override get name() { return 'SenderError'; } }
  assert.equal(classifyError(new SenderError('cell already searched')), 'rejected');
  assert.equal(classifyError(new Error('Not connected to SpacetimeDB')), 'network');
});

test('reconnect backoff, subscriptions, and per-server token files', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(reconnectDelayMs), [1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  assert.equal(subscriptionQueries('dog1').length, 7);
  assert.ok(subscriptionQueries('dog1').includes("SELECT * FROM teleop WHERE robot_id = 'dog1'"));
  assert.ok(subscriptionQueries('dog1').includes("SELECT * FROM mission WHERE robot_id = 'dog1'"));
  assert.equal(tokenPathFor('./.data/token', 'ws://localhost:3000'), './.data/token.localhost_3000');
  assert.equal(tokenPathFor('./.data/token', 'https://maincloud.spacetimedb.com'), './.data/token.maincloud.spacetimedb.com');
});

test('a message that arrives while a send is in flight stays behind it when the link drops', async () => {
  const { spool, state } = setup();
  state.ready = true;
  let release: (outcome: SendOutcome) => void = () => {};
  const slow = new Router({
    isReady: () => state.ready,
    hasRobotRow: () => true,
    spool,
    process: () => new Promise<SendOutcome>((resolve) => { release = resolve; }),
    log: () => {},
  });
  slow.handle(cell(1)); // in flight
  await new Promise((resolve) => setImmediate(resolve));
  state.ready = false; // link drops
  slow.handle(cell(2));
  release('network');
  await slow.idle();
  assert.deepEqual(spool.pending().map((e) => e.msg.seq), [1, 2]);
});

test('an older position that fails after a newer one was handled is not spooled', async () => {
  const { spool, state } = setup();
  state.ready = true;
  const releases: Array<(outcome: SendOutcome) => void> = [];
  const router = new Router({
    isReady: () => state.ready,
    hasRobotRow: () => true,
    spool,
    process: () => new Promise<SendOutcome>((resolve) => { releases.push(resolve); }),
    log: () => {},
  });
  const position = (seq: number): LocalMessage => ({ type: 'position', seq, robot_id: 'dog1', lat: seq, lon: 0, gps_fix: true });
  router.handle(position(1));
  router.handle(position(2));
  releases[1]!('ok');
  releases[0]!('network');
  await router.idle();
  assert.equal(spool.size, 0);
});

test('a spool disk error during replay is logged, not an unhandled rejection', async () => {
  const logs: string[] = [];
  const router = new Router({
    isReady: () => true,
    hasRobotRow: () => true,
    spool: { size: 1, replaying: false, append: () => 'spooled', replay: async () => { throw new Error('ENOSPC: no space left on device'); } },
    process: async () => 'ok',
    log: (line) => logs.push(line),
  });
  router.startKick();
  await router.idle();
  assert.ok(logs.some((line) => line.includes('ENOSPC')));
});

test('teleop rows are live when any client\'s reducer wrote them, never when a subscription replays them', () => {
  assert.equal(isLiveEvent('Transaction'), true, 'the dashboard called teleop_drive');
  assert.equal(isLiveEvent('Reducer'), true);
  assert.equal(isLiveEvent('SubscribeApplied'), false, 'an old command after a reconnect');
  assert.equal(isLiveEvent('UnsubscribeApplied'), false);
});
