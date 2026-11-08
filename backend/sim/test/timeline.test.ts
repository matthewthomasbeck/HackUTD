import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { loadDemoConfig } from '../src/config.ts';
import { parseCommand, validateCommand } from '../src/dispatch.ts';
import { computeTimelineSchedule, parseTimeline, runTimeline, type TimelineStep } from '../src/timeline.ts';

test('parses every committed timeline file', async () => {
  for (const name of ['judge', 'video', 'e2e', 'stress', 'demo', 'scene']) {
    const text = await readFile(new URL(`../timelines/${name}.json`, import.meta.url), 'utf8');
    assert.ok(parseTimeline(JSON.parse(text)).length > 0, `${name} should not be empty`);
  }
});

test('computes at and after offsets, including bounded waits and the unbounded key wait', () => {
  const schedule = computeTimelineSchedule(parseTimeline([
    { at: '0:20', cmd: 'scale 300' },
    { await: 'survivor_in', house: 'house 3', timeout_s: 120 },
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

test('every committed timeline only references commands the dispatcher knows', async () => {
  const config = loadDemoConfig();
  for (const name of ['judge', 'video', 'e2e', 'stress', 'demo', 'scene']) {
    const text = await readFile(new URL(`../timelines/${name}.json`, import.meta.url), 'utf8');
    for (const step of parseTimeline(JSON.parse(text))) {
      for (const cmd of [step.cmd, step.else]) {
        if (!cmd) continue;
        const parsed = validateCommand(cmd, config);
        assert.notEqual(parsed.name, 'timeline', `${name} must not nest timelines`);
      }
    }
  }
});

test('parses short forms and rejects unknown or malformed commands', () => {
  const config = loadDemoConfig();
  assert.deepEqual(parseCommand('rr'), { name: 'robot replay', args: ['house3'] });
  assert.deepEqual(parseCommand('f4 r2'), { name: 'fail', args: ['rescuer-drop', 'r2'] });
  assert.deepEqual(parseCommand('?'), { name: 'status', args: [] });
  assert.deepEqual(parseCommand('ib'), { name: 'imbalance', args: [] });
  assert.throws(() => parseCommand('launch rockets'), /Unknown command/);
  assert.throws(() => validateCommand('spawn immediate house 99', config), /spawn/);
  assert.throws(() => validateCommand('report nowhere', config), /unknown house/);
  assert.throws(() => validateCommand('fail rescuer-drop cayden', config), /simulated rescuer/);
  assert.throws(() => validateCommand('robot replay house4', config), /house3/);
});

test('runs commands, passes awaits, and uses fallbacks and cues on timeout', async () => {
  const executed: string[] = [];
  const cues: string[] = [];
  let clock = 0;
  const steps: TimelineStep[] = parseTimeline([
    { cmd: 'status' },
    { await: 'survivor_in', house: 'house 3', timeout_s: 0, else: 'robot replay house3' },
    { await: 'assignment_for', rescuer: 'cayden', timeout_s: 0, say_on_timeout: 'Assign Cayden' },
    { await: 'watchdog_fallback', timeout_s: 5 },
    { cmd: 'walk house 3' },
    { await: 'key', say: 'Press Enter' },
  ]);
  const outcomes = await runTimeline(steps, {
    execute: async (cmd) => { executed.push(cmd); if (cmd.startsWith('walk')) throw new Error('GLASSES_BASE is required'); },
    condition: (step) => () => step.await === 'watchdog_fallback',
    waitForKey: async () => { cues.push('key'); },
    say: (text) => cues.push(text),
    log: () => undefined,
    now: () => clock++,
    pollMs: 0,
  });
  assert.deepEqual(executed, ['status', 'robot replay house3', 'walk house 3']);
  assert.deepEqual(cues, ['Assign Cayden', 'Press Enter', 'key']);
  assert.deepEqual(outcomes, ['done', 'fallback', 'cue', 'passed', 'failed', 'passed']);
});

test('requires the fields each await condition reads', () => {
  assert.throws(() => parseTimeline([{ await: 'released', timeout_s: 5 }]), /needs rescuer/);
  assert.throws(() => parseTimeline([{ await: 'person_report', timeout_s: 5 }]), /needs house/);
});
