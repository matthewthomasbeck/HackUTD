import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { loadDemoConfig, validateDemoConfig } from '../src/config.ts';
import { SCENE_LOOPS, validateCommand } from '../src/dispatch.ts';
import { insideRing } from '../src/geo.ts';
import { planSceneCells, planSceneSurvivors } from '../src/scene.ts';
import { generateScaleLots } from '../src/setup.ts';
import { parseTimeline } from '../src/timeline.ts';

test('scene survivors are repeatable, inside real buildings near the center, and 12 m apart', () => {
  const config = loadDemoConfig();
  const plans = planSceneSurvivors(config);
  assert.deepEqual(plans, planSceneSurvivors(config));
  const count = (level: string) => plans.filter((plan) => plan.level === level).length;
  assert.equal(count('immediate'), config.scene.immediate);
  assert.ok(count('immediate') >= 2 && count('immediate') <= 3, '2 to 3 IMMEDIATE survivors');
  assert.equal(count('delayed'), config.scene.delayed);
  assert.equal(count('minor'), config.scene.minor);
  const lots = new Map(generateScaleLots(config).map((lot) => [lot.label, lot]));
  for (const plan of plans) {
    const lot = lots.get(plan.lot)!;
    assert.ok(insideRing(plan.east_m, plan.north_m, lot.ring), `${plan.lot} survivor is inside its footprint`);
    assert.ok(Math.abs(plan.east_m - lot.east_m) <= config.cell_size_m / 2 && Math.abs(plan.north_m - lot.north_m) <= config.cell_size_m / 2, `${plan.lot} survivor is inside its cell`);
    assert.ok(Math.hypot(plan.east_m, plan.north_m) <= config.scene.radius_m);
    for (const other of plans) if (other !== plan) assert.ok(Math.hypot(other.east_m - plan.east_m, other.north_m - plan.north_m) >= config.scale.min_spacing_m);
  }
});

test('scene cells leave the judged demo house alone and mark house 4 partially searched', () => {
  const config = loadDemoConfig();
  const cells = planSceneCells(config, planSceneSurvivors(config));
  const status = new Map(cells.map((cell) => [cell.label, cell.status]));
  assert.equal(status.get('house 4'), 'partially_searched');
  assert.equal(config.houses.find((house) => house.label === 'house 4')?.view_blocked, true);
  assert.equal(config.family_report.house, 'house 4');
  const pile = config.houses.find((house) => house.demo_pile)!.label;
  assert.equal(status.has(pile), false, `${pile} stays unsearched for the judged demo`);
  assert.ok(config.scene.searched_houses.length >= 2 && config.scene.searched_houses.length <= 4);
  for (const plan of planSceneSurvivors(config)) assert.equal(status.get(plan.lot), 'searched');
});

test('the config rejects a scene that touches the judged demo house', () => {
  const raw = JSON.parse(JSON.stringify(loadDemoConfig()));
  raw.scene.searched_houses.push('house 3');
  assert.throws(() => validateDemoConfig(raw), /judged demo house/);
});

test('scene.json uses only valid commands and starts the same loops as the scene command', async () => {
  const config = loadDemoConfig();
  const steps = parseTimeline(JSON.parse(await readFile(new URL('../timelines/scene.json', import.meta.url), 'utf8')));
  const commands = steps.flatMap((step) => [step.cmd, step.else]).filter((cmd): cmd is string => Boolean(cmd));
  for (const cmd of commands) assert.notEqual(validateCommand(cmd, config).name, 'timeline');
  assert.deepEqual(commands, ['scene seed', ...SCENE_LOOPS]);
  assert.equal(validateCommand('scene', config).name, 'scene');
  assert.throws(() => validateCommand('scene now', config), /scene \[seed\]/);
});
