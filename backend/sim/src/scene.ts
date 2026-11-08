// `scene`: seeds an in-progress board on the newest site, so a crew of 2 robots and 2 sim rescuers looks live.
// Some house cells are already searched (house 4 only partly, its view is blocked), a handful of survivors sit
// inside real buildings near the center, and the house 4 family report is on file. Running it again changes nothing.
import { CellStatus } from '../../spacetimedb-bindings/types.js';
import { reportConfiguredHouse } from './commands.ts';
import type { DemoSiteConfig } from './config.ts';
import { reportDetectionAndWait, writeClinical } from './finding.ts';
import { offsetToLatLon } from './geo.ts';
import { logInjection } from './inject.ts';
import type { SimPool } from './pool.ts';
import { mulberry32 } from './rng.ts';
import { placeSurvivorsInLots, type PlannedScaleSurvivor, type ScaleLevel } from './scale.ts';
import { generateScaleLots } from './setup.ts';

// A seed offset, so the scene survivors are not the first scale survivors.
const SCENE_SEED_OFFSET = 300;
const LOCATION_NOTES = ['front room', 'under a table', 'basement stairs', 'back bedroom', 'garage', 'hallway'];

export type SceneCellStatus = 'searched' | 'partially_searched';

export function sceneLevels(config: DemoSiteConfig): ScaleLevel[] {
  const { immediate, delayed, minor } = config.scene;
  return [
    ...Array<ScaleLevel>(immediate).fill('immediate'),
    ...Array<ScaleLevel>(delayed).fill('delayed'),
    ...Array<ScaleLevel>(minor).fill('minor'),
  ];
}

// Survivors inside real building footprints within scene.radius_m of the center, min_spacing_m apart.
export function planSceneSurvivors(config: DemoSiteConfig): PlannedScaleSurvivor[] {
  const levels = sceneLevels(config);
  const lots = generateScaleLots(config).filter((lot) => Math.hypot(lot.east_m, lot.north_m) <= config.scene.radius_m);
  const random = mulberry32(config.scale.seed + SCENE_SEED_OFFSET);
  return placeSurvivorsInLots(config, lots, levels.length, random, (index) => levels[index]!);
}

// The cells the scene marks: configured houses, and each lot a scene survivor was found in.
export function planSceneCells(config: DemoSiteConfig, survivors: readonly PlannedScaleSurvivor[]): Array<{ label: string; status: SceneCellStatus }> {
  const cells = new Map<string, SceneCellStatus>();
  for (const label of config.scene.searched_houses) cells.set(label, 'searched');
  for (const label of config.scene.partial_houses) cells.set(label, 'partially_searched');
  for (const survivor of survivors) if (!cells.has(survivor.lot)) cells.set(survivor.lot, 'searched');
  return [...cells].map(([label, status]) => ({ label, status }));
}

export interface SceneResult { survivorsAdded: number; survivorsKept: number; cellsMarked: number; reportAdded: boolean }

export async function seedScene(config: DemoSiteConfig, pool: SimPool): Promise<SceneResult> {
  const sim = pool.get('sim');
  const db = sim.connection.db;
  const site = Array.from(db.site.iter()).sort((a, b) => Number(b.id - a.id))[0];
  if (!site) throw new Error('No site exists. Run setup first.');
  const center = { lat: config.site.center_lat, lon: config.site.center_lon };
  const robotIds = [config.robots.sim.robot_id, ...Array.from({ length: config.robots.fleet_size }, (_, index) => `${config.robots.sim.robot_id}-${index + 2}`)];
  await logInjection(sim, 'scene', 'in-progress board');

  const plans = planSceneSurvivors(config);
  let survivorsAdded = 0;
  for (const [index, plan] of plans.entries()) {
    const point = offsetToLatLon(center, plan);
    const exists = Array.from(db.survivor.iter()).some((row) => row.siteId === site.id && round7(row.lat) === round7(point.lat) && round7(row.lon) === round7(point.lon));
    if (exists) continue;
    const survivorId = await reportDetectionAndWait(pool, {
      robotId: robotIds[index % robotIds.length]!,
      missionId: 0n,
      point,
      note: LOCATION_NOTES[index % LOCATION_NOTES.length]!,
      ...(plan.thermal_temp_c === undefined ? {} : { maxTempC: plan.thermal_temp_c }),
    });
    await writeClinical(pool, survivorId, plan);
    survivorsAdded += 1;
  }

  let cellsMarked = 0;
  for (const [index, cellPlan] of planSceneCells(config, plans).entries()) {
    const cell = Array.from(db.searchCell.iter()).find((row) => row.siteId === site.id && row.label === cellPlan.label);
    if (!cell) throw new Error(`Search cell not found for ${cellPlan.label}. Run setup first.`);
    const wanted = cellPlan.status === 'searched' ? 'Searched' : 'PartiallySearched';
    // A robot cannot reopen a searched cell, and a cell already in the wanted state needs nothing.
    if (cell.status.tag === wanted || cell.status.tag === 'Searched') continue;
    const robot = pool.get(robotIds[index % robotIds.length]!);
    await robot.connection.reducers.markCell({ cellId: cell.id, status: cellPlan.status === 'searched' ? CellStatus.Searched : CellStatus.PartiallySearched, observedAt: undefined });
    cellsMarked += 1;
  }

  const reportCell = Array.from(db.searchCell.iter()).find((row) => row.siteId === site.id && row.label === config.family_report.house);
  const reportAdded = !Array.from(db.personReport.iter()).some((row) => row.cellId === reportCell?.id);
  if (reportAdded) await reportConfiguredHouse(config, pool, config.family_report.house);
  return { survivorsAdded, survivorsKept: plans.length - survivorsAdded, cellsMarked, reportAdded };
}

function round7(value: number): string { return value.toFixed(7); }
