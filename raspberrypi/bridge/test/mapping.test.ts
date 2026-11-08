import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Timestamp } from 'spacetimedb';
import { detectionPaths, isoToTimestamp, localOnlyReason, mapMessage, MappingError, type LocalMessage } from '../src/mapping.ts';

const AT = '2026-11-08T15:04:05.123456Z';
const AT_MICROS = BigInt(Date.parse('2026-11-08T15:04:05Z')) * 1000n + 123456n;

function call(msg: LocalMessage, media = {}) {
  const result = mapMessage(msg, media);
  assert.equal(result.kind, 'call');
  if (result.kind !== 'call') throw new Error('unreachable');
  return result;
}

function assertObservedAt(args: { observedAt?: Timestamp }) {
  assert.ok(args.observedAt instanceof Timestamp);
  assert.equal(args.observedAt.microsSinceUnixEpoch, AT_MICROS);
}

test('heartbeat maps to robotHeartbeat with the binding enum tag', () => {
  const { call: c } = call({ type: 'heartbeat', seq: 7, observed_at: AT, robot_id: 'dog1', state: 'SAFE_STOP', battery_pct: null });
  assert.equal(c.reducer, 'robotHeartbeat');
  if (c.reducer !== 'robotHeartbeat') return;
  assert.deepEqual(c.args.state, { tag: 'SafeStop' });
  assert.equal(c.args.robotId, 'dog1');
  assert.equal(c.args.batteryPct, undefined);
  assertObservedAt(c.args);
  assert.equal('seq' in c.args, false);
});

test('position maps every field and keeps optionals optional', () => {
  const { call: c } = call({ type: 'position', seq: 8, observed_at: AT, robot_id: 'dog1', lat: 32.98, lon: -96.75, gps_fix: false, indoor_offset_m: 4.5, heading_deg: null });
  assert.equal(c.reducer, 'robotReportPosition');
  if (c.reducer !== 'robotReportPosition') return;
  assert.equal(c.args.lat, 32.98);
  assert.equal(c.args.lon, -96.75);
  assert.equal(c.args.gpsFix, false);
  assert.equal(c.args.indoorOffsetM, 4.5);
  assert.equal(c.args.headingDeg, undefined);
  assertObservedAt(c.args);
});

test('device maps status to DeviceHealth', () => {
  const { call: c } = call({ type: 'device', seq: 9, observed_at: AT, robot_id: 'dog1', device: 'ld19', status: 'DEGRADED', detail: 'low rate' });
  assert.equal(c.reducer, 'robotReportDevice');
  if (c.reducer !== 'robotReportDevice') return;
  assert.deepEqual(c.args.status, { tag: 'Degraded' });
  assert.equal(c.args.device, 'ld19');
  assert.equal(c.args.detail, 'low rate');
  assertObservedAt(c.args);
});

test('cell maps to markCell with a bigint id and drops the note', () => {
  const { call: c } = call({ type: 'cell', seq: 10, observed_at: AT, cell_id: 3, status: 'partially_searched', note: 'door blocked' });
  assert.equal(c.reducer, 'markCell');
  if (c.reducer !== 'markCell') return;
  assert.equal(c.args.cellId, 3n);
  assert.deepEqual(c.args.status, { tag: 'PartiallySearched' });
  assert.deepEqual(Object.keys(c.args).sort(), ['cellId', 'observedAt', 'status']);
  assertObservedAt(c.args);
});

test('mission_progress maps to missionProgress', () => {
  const { call: c } = call({ type: 'mission_progress', seq: 11, observed_at: AT, mission_id: 42, status: 'done', note: 'searched 3 cells' });
  assert.equal(c.reducer, 'missionProgress');
  if (c.reducer !== 'missionProgress') return;
  assert.equal(c.args.missionId, 42n);
  assert.deepEqual(c.args.status, { tag: 'Done' });
  assert.equal(c.args.note, 'searched 3 cells');
  assertObservedAt(c.args);
});

const DETECTION: LocalMessage = {
  type: 'detection', seq: 12, observed_at: AT, robot_id: 'dog1', mission_id: 42, source: 'thermal',
  client_ref: 'dog1-b1-12', lat: 32.98, lon: -96.75, gps_fix: true, location_note: '8 m in from the front door',
  max_temp_c: 34.2, thermal_confidence: 0.82, thermal_image_path: '/tmp/robot/media/t.png',
  camera_image_path: null, breathing_clip_path: '/tmp/robot/media/c.mp4', thermal_debug: { blob_px: 14 },
};

test('detection maps to reportDetection with the uploaded urls', () => {
  const { call: c } = call(DETECTION, { detection: { thermal_image_url: 'http://m/t.png', breathing_clip_url: 'http://m/c.mp4' } });
  assert.equal(c.reducer, 'reportDetection');
  if (c.reducer !== 'reportDetection') return;
  assert.deepEqual(c.args, {
    robotId: 'dog1', missionId: 42n, source: { tag: 'Thermal' }, clientRef: 'dog1-b1-12', lat: 32.98, lon: -96.75,
    gpsFix: true, locationNote: '8 m in from the front door', maxTempC: 34.2, thermalConfidence: 0.82,
    thermalImageUrl: 'http://m/t.png', cameraImageUrl: undefined, breathingClipUrl: 'http://m/c.mp4',
    observedAt: c.args.observedAt,
  });
  assertObservedAt(c.args);
});

test('terrain maps to reportTerrain with both enums', () => {
  const { call: c } = call({ type: 'terrain', seq: 13, observed_at: AT, robot_id: 'dog1', lat: 1, lon: 2, terrain_class: 'debris', confidence: 0.6, source: 'lidar_imu_rules', action: 'continue' }, { terrain_image_url: 'http://m/x.jpg' });
  assert.equal(c.reducer, 'reportTerrain');
  if (c.reducer !== 'reportTerrain') return;
  assert.deepEqual(c.args.terrainClass, { tag: 'Debris' });
  assert.deepEqual(c.args.action, { tag: 'Continue' });
  assert.equal(c.args.imageUrl, 'http://m/x.jpg');
  assertObservedAt(c.args);
});

test('unknown types and bad enum values are rejected', () => {
  assert.throws(() => mapMessage({ type: 'beacon' }), MappingError);
  assert.throws(() => mapMessage({ type: 'heartbeat', robot_id: 'dog1', state: 'ready' }), MappingError);
  assert.throws(() => mapMessage({ type: 'cell', cell_id: -1, status: 'searched' }), MappingError);
  assert.throws(() => mapMessage({ type: 'cell', cell_id: 3, status: 'empty' }), MappingError);
});

test('missing observed_at is passed as none; a bad one warns and is dropped', () => {
  const none = call({ type: 'cell', cell_id: 1, status: 'searched' });
  assert.equal((none.call.args as { observedAt?: unknown }).observedAt, undefined);
  assert.deepEqual(none.warnings, []);
  const bad = call({ type: 'cell', cell_id: 1, status: 'searched', observed_at: 'yesterday' });
  assert.equal((bad.call.args as { observedAt?: unknown }).observedAt, undefined);
  assert.equal(bad.warnings.length, 1);
});

test('mission_id 0 and positions without lat/lon are local only', () => {
  assert.deepEqual(mapMessage({ ...DETECTION, mission_id: 0 }).kind, 'local_only');
  assert.deepEqual(mapMessage({ type: 'mission_progress', mission_id: 0, status: 'active' }).kind, 'local_only');
  assert.ok(localOnlyReason({ type: 'position', robot_id: 'dog1', gps_fix: false }));
  assert.equal(localOnlyReason({ type: 'cell', cell_id: 1, status: 'searched' }), undefined);
});

test('isoToTimestamp keeps microseconds and honors offsets', () => {
  assert.equal(isoToTimestamp(AT)?.microsSinceUnixEpoch, AT_MICROS);
  assert.equal(isoToTimestamp('2026-11-08T10:04:05.123456-05:00')?.microsSinceUnixEpoch, AT_MICROS);
  assert.equal(isoToTimestamp('2026-11-08T15:04:05Z')?.microsSinceUnixEpoch, AT_MICROS - 123456n);
  assert.equal(isoToTimestamp('2026-11-08 15:04:05'), undefined);
});

test('detectionPaths accepts the robot.md and CONTRACTS.md clip field names', () => {
  assert.deepEqual(detectionPaths(DETECTION), { thermal: '/tmp/robot/media/t.png', camera: undefined, clip: '/tmp/robot/media/c.mp4' });
  assert.equal(detectionPaths({ type: 'detection', clip_path: '/x.mp4' }).clip, '/x.mp4');
});
