import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { computeTimelineSchedule, parseTimeline } from '../src/timeline.ts';

test('parses the four committed timeline files', async () => {
  for (const name of ['judge', 'video', 'e2e', 'stress']) {
    const text = await readFile(new URL(`../timelines/${name}.json`, import.meta.url), 'utf8');
    assert.ok(parseTimeline(JSON.parse(text)).length > 0, `${name} should not be empty`);
  }
});

test('computes at and after offsets, including bounded waits and the unbounded key wait', () => {
  const schedule = computeTimelineSchedule(parseTimeline([
    { at: '0:20', cmd: 'scale 300' },
    { await: 'survivor_in', timeout_s: 120 },
    { after_s: 3, cmd: 'spawn immediate house 8' },
    { await: 'key' },
    { cmd: 'run end judged' },
    { at: '4:00', cmd: 'status' },
  ]));
  assert.deepEqual(schedule.map((step) => step.atSeconds), [20, 20, 143, 143, null, 240]);
});

test('rejects malformed timeline actions and timestamps', () => {
  assert.throws(() => parseTimeline([{ at: '1:90', cmd: 'status' }]), /at/);
  assert.throws(() => parseTimeline([{ at: '0:00', after_s: 1, cmd: 'status' }]), /at and after_s/);
  assert.throws(() => parseTimeline([{ cmd: '' }]), /non-empty/);
});
