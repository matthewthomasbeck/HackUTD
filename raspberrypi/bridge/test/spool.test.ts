import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { LocalMessage } from '../src/mapping.ts';
import { Spool, type SendOutcome } from '../src/spool.ts';

function tempSpool(maxBytes = 1024 * 1024) {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-spool-'));
  const path = join(dir, 'spool.jsonl');
  const spool = new Spool({ path, maxBytes });
  spool.open();
  return { spool, path };
}

const cell = (seq: number, id: number): LocalMessage => ({ type: 'cell', seq, observed_at: `2026-11-08T15:00:${String(seq).padStart(2, '0')}Z`, cell_id: id, status: 'searched' });
const position = (seq: number): LocalMessage => ({ type: 'position', seq, observed_at: `2026-11-08T15:00:${String(seq).padStart(2, '0')}Z`, robot_id: 'dog1', lat: seq, lon: 0, gps_fix: false });
const detection = (seq: number): LocalMessage => ({ type: 'detection', seq, observed_at: `2026-11-08T15:00:${String(seq).padStart(2, '0')}Z`, client_ref: `dog1-b-${seq}`, pad: 'x'.repeat(200) });

test('an older position or terrain arriving late does not replace a newer one', () => {
  const { spool } = tempSpool();
  assert.equal(spool.append(position(5)), 'spooled');
  assert.equal(spool.append(position(3)), 'not_spooled');
  assert.equal(spool.append(position(7)), 'spooled');
  assert.deepEqual(spool.pending().map((e) => e.seq), [7]);
  spool.close();
});

test('append writes {seq, observed_at, msg} lines and never spools heartbeats', () => {
  const { spool, path } = tempSpool();
  assert.equal(spool.append(cell(1, 3)), 'spooled');
  assert.equal(spool.append({ type: 'heartbeat', seq: 2, robot_id: 'dog1', state: 'READY' }), 'not_spooled');
  const lines = readFileSync(path, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]!);
  assert.equal(entry.seq, 1);
  assert.equal(entry.observed_at, '2026-11-08T15:00:01Z');
  assert.equal(entry.msg.cell_id, 3);
  spool.close();
});

test('reopen after a crash keeps full lines and drops a cut-off last line', () => {
  const { spool, path } = tempSpool();
  spool.append(cell(1, 3));
  spool.append(cell(2, 4));
  spool.close();
  appendFileSync(path, '{"seq":3,"observed_at":"2026-11-08T15:00:03Z","msg":{"type":"ce'); // power cut mid-write
  const reopened = new Spool({ path, maxBytes: 1024 * 1024 });
  reopened.open();
  assert.deepEqual(reopened.pending().map((e) => e.msg.cell_id), [3, 4]);
  reopened.append(cell(5, 6));
  reopened.close();
  const again = new Spool({ path, maxBytes: 1024 * 1024 });
  again.open();
  assert.deepEqual(again.pending().map((e) => e.msg.cell_id), [3, 4, 6]);
  again.close();
});

test('replay sends in order with the original observed_at, skips rejections, and truncates', async () => {
  const { spool, path } = tempSpool();
  spool.append(cell(1, 3));
  spool.append(cell(2, 4));
  spool.append(cell(3, 5));
  const sent: string[] = [];
  const result = await spool.replay(async (msg) => {
    sent.push(`${msg.cell_id}@${msg.observed_at}`);
    return msg.cell_id === 4 ? 'rejected' : 'ok';
  });
  assert.deepEqual(sent, ['3@2026-11-08T15:00:01Z', '4@2026-11-08T15:00:02Z', '5@2026-11-08T15:00:03Z']);
  assert.deepEqual(result, { sent: 2, rejected: 1, skipped: 0, stopped: false });
  assert.equal(spool.size, 0);
  assert.equal(statSync(path).size, 0);
  spool.close();
});

test('only the newest position is replayed', async () => {
  const { spool } = tempSpool();
  spool.append(position(1));
  spool.append(cell(2, 3));
  spool.append(position(3));
  spool.append(position(4));
  const sent: string[] = [];
  await spool.replay(async (msg) => { sent.push(`${msg.type}${msg.seq}`); return 'ok'; });
  assert.deepEqual(sent, ['cell2', 'position4']);
  spool.close();
});

test('a network failure stops replay and keeps the rest on disk', async () => {
  const { spool, path } = tempSpool();
  spool.append(cell(1, 3));
  spool.append(cell(2, 4));
  spool.append(cell(3, 5));
  const result = await spool.replay(async (msg): Promise<SendOutcome> => (msg.cell_id === 4 ? 'network' : 'ok'));
  assert.equal(result.stopped, true);
  assert.deepEqual(spool.pending().map((e) => e.msg.cell_id), [4, 5]);
  spool.close();
  const reopened = new Spool({ path, maxBytes: 1024 * 1024 });
  reopened.open();
  assert.deepEqual(reopened.pending().map((e) => e.msg.cell_id), [4, 5]);
  reopened.close();
});

test('messages appended during replay go after the older ones', async () => {
  const { spool } = tempSpool();
  spool.append(cell(1, 3));
  spool.append(cell(2, 4));
  const sent: number[] = [];
  await spool.replay(async (msg) => {
    sent.push(msg.cell_id as number);
    if (msg.cell_id === 3) spool.append(cell(9, 99)); // a live message arriving mid-replay
    return 'ok';
  });
  assert.deepEqual(sent, [3, 4, 99]);
  assert.equal(spool.size, 0);
  spool.close();
});

test('past the cap, positions and devices go first and detections are never dropped', () => {
  const { spool } = tempSpool(1200);
  spool.append(detection(1));
  spool.append({ type: 'device', seq: 2, robot_id: 'dog1', device: 'ld19', status: 'OK', detail: 'x'.repeat(150) });
  spool.append(position(3));
  spool.append(detection(4));
  spool.append(detection(5));
  // Over the cap now: the position and the device made room for the detections.
  spool.append(detection(6));
  const types = spool.pending().map((e) => `${e.msg.type}${e.msg.seq}`);
  assert.ok(!types.includes('position3'));
  assert.ok(!types.includes('device2'));
  assert.deepEqual(types.filter((t) => t.startsWith('detection')), ['detection1', 'detection4', 'detection5', 'detection6']);
  // With only detections left, a cell is refused but a detection is still kept.
  assert.equal(spool.append(cell(7, 3)), 'dropped');
  assert.equal(spool.append(detection(8)), 'spooled');
  spool.close();
});
