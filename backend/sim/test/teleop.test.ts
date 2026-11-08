import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bearingDegrees, distanceMeters } from '../src/geo.ts';
import { teleopStep } from '../src/simrobot.ts';

const START = { point: { lat: 32.986, lon: -96.7516 }, heading: 0 };

test('forward moves along the heading', () => {
  const north = teleopStep(START, { vxMps: 1, vyMps: 0, wzDps: 0 }, 1, 1);
  assert.ok(Math.abs(distanceMeters(START.point, north.point) - 1) < 0.01);
  assert.ok(Math.abs(bearingDegrees(START.point, north.point)) < 0.5);
  const east = teleopStep({ ...START, heading: 90 }, { vxMps: 2, vyMps: 0, wzDps: 0 }, 1, 1);
  assert.ok(Math.abs(bearingDegrees(START.point, east.point) - 90) < 0.5);
});

test('a positive turn is to the left (counterclockwise), and vy strafes left', () => {
  assert.equal(teleopStep(START, { vxMps: 0, vyMps: 0, wzDps: 45 }, 1, 1).heading, 315);
  assert.equal(teleopStep(START, { vxMps: 0, vyMps: 0, wzDps: -45 }, 1, 1).heading, 45);
  const left = teleopStep(START, { vxMps: 0, vyMps: 1, wzDps: 0 }, 1, 1);
  assert.ok(Math.abs(bearingDegrees(START.point, left.point) - 270) < 0.5, 'facing north, left is west');
});

test('scale multiplies linear speed only', () => {
  const step = teleopStep(START, { vxMps: 0.2, vyMps: 0, wzDps: 10 }, 0.5, 36);
  assert.ok(Math.abs(distanceMeters(START.point, step.point) - 3.6) < 0.01);
  assert.equal(step.heading, 355);
});
