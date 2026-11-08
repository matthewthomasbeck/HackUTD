import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import type { BridgeConfig } from '../src/config.ts';
import { StdbLink, type ConnectionBuilder } from '../src/stdb.ts';

const CONFIG: BridgeConfig = {
  stdbUri: 'ws://localhost:3000', stdbDatabase: 'assess-0hw81', stdbToken: 'test-token', stdbMode: 'sdk',
  robotId: 'drone1', bridgeSocket: '/tmp/x.sock', mediaUrl: 'http://media', tokenFile: '/tmp/token',
  spoolFile: '/tmp/spool.jsonl', spoolMaxBytes: 1024, mediaRetries: 1, claimIntervalMs: 2000,
};

type Callback = (...args: unknown[]) => void;

interface FakeConn {
  callbacks: Record<string, Callback>;
  disconnected: boolean;
  disconnect: () => void;
  [key: string]: unknown;
}

/** A stand-in for the SDK: every build() records a connection whose disconnect() fires onDisconnect synchronously, like the SDK. */
function fakeSdk(claim: () => Promise<void> = async () => {}) {
  const conns: FakeConn[] = [];
  const table = { onInsert: () => {}, onUpdate: () => {}, onDelete: () => {}, iter: () => [] };
  const builder = () => {
    const callbacks: Record<string, Callback> = {};
    const chain: Record<string, unknown> = {};
    for (const name of ['withUri', 'withDatabaseName', 'withToken', 'withAutomaticReconnect']) chain[name] = () => chain;
    for (const name of ['onConnect', 'onAutomaticReconnect', 'onConnectError', 'onDisconnect']) {
      chain[name] = (callback: Callback) => { callbacks[name] = callback; return chain; };
    }
    chain.build = () => {
      const conn: FakeConn = {
        callbacks,
        disconnected: false,
        disconnect: () => { conn.disconnected = true; callbacks.onDisconnect?.({}, undefined, undefined); },
        db: { mission: table, robot: { ...table, robotId: { find: () => null } }, site: table, detection: table, teleop: table },
        reducers: { registerParticipant: async () => {}, claimNextMission: claim },
        subscriptionBuilder: () => {
          const sub: Record<string, unknown> = {};
          let applied: Callback = () => {};
          sub.onApplied = (callback: Callback) => { applied = callback; return sub; };
          sub.onError = () => sub;
          sub.subscribe = () => { applied(); return sub; };
          return sub;
        },
      };
      conns.push(conn);
      return conn;
    };
    return chain as unknown as ConnectionBuilder;
  };
  return { conns, builder };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('a failed first connect arms one reconnect, and dropping the old connection does not start a storm', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { conns, builder } = fakeSdk();
    const link = new StdbLink(CONFIG, { onReady() {}, onLost() {}, onMissionInsert() {}, onMissionUpdate() {}, onMissionDelete() {}, onSiteChange() {}, onRobotRow() {}, onTeleop() {} }, () => {}, builder);
    link.start();
    conns[0]!.callbacks.onConnectError!({}, new Error('refused'), undefined, undefined);
    mock.timers.tick(1000);
    assert.equal(conns.length, 2);
    assert.equal(conns[0]!.disconnected, true);
    mock.timers.tick(120_000); // no second timer was armed by the old connection's onDisconnect
    assert.equal(conns.length, 2);
    assert.equal(conns[1]!.disconnected, false);
    conns[0]!.callbacks.onDisconnect!({}, new Error('late'), undefined); // a late callback from the old one
    mock.timers.tick(120_000);
    assert.equal(conns.length, 2);
    link.stop();
  } finally {
    mock.timers.reset();
  }
});

test('a late onConnect from a replaced connection is dropped and does not make the link ready', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { conns, builder } = fakeSdk();
    let ready = 0;
    const link = new StdbLink(CONFIG, { onReady() { ready += 1; }, onLost() {}, onMissionInsert() {}, onMissionUpdate() {}, onMissionDelete() {}, onSiteChange() {}, onRobotRow() {}, onTeleop() {} }, () => {}, builder);
    link.start();
    conns[0]!.callbacks.onConnectError!({}, new Error('refused'), undefined, undefined);
    mock.timers.tick(1000);
    const identity = { toHexString: () => '0xabc' };
    conns[0]!.callbacks.onConnect!(conns[0], identity, 'token');
    await flush();
    assert.equal(link.ready, false);
    conns[1]!.callbacks.onConnect!(conns[1], identity, 'token');
    await flush();
    assert.equal(link.ready, true);
    assert.equal(ready, 1);
    link.stop();
  } finally {
    mock.timers.reset();
  }
});

test('a claim that is never acknowledged times out instead of staying pending', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { conns, builder } = fakeSdk(() => new Promise<void>(() => {}));
    const link = new StdbLink(CONFIG, { onReady() {}, onLost() {}, onMissionInsert() {}, onMissionUpdate() {}, onMissionDelete() {}, onSiteChange() {}, onRobotRow() {}, onTeleop() {} }, () => {}, builder);
    link.start();
    conns[0]!.callbacks.onConnect!(conns[0], { toHexString: () => '0xabc' }, 'token');
    await flush();
    assert.equal(link.ready, true);
    const claim = link.claim();
    mock.timers.tick(15_000);
    await assert.rejects(claim, /not acknowledged in 15000 ms/);
    link.stop();
  } finally {
    mock.timers.reset();
  }
});
