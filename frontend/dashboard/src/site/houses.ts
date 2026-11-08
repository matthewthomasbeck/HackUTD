// What each house in the block looks like on the board, from the live rows: the worst open survivor inside it,
// else its search cell's state. The map fill, the glyph row and the counts all read from this one function.
import { enumTagToContract, type TaggedEnum } from '../stdb/enums';
import { blockHomes, containsPoint, houseAt, toMeters, type ContextRoad, type GeoPoint, type House, type SiteGeometry } from './geometry';

export type HouseState = 'immediate' | 'delayed' | 'minor' | 'unscored' | 'unaccounted' | 'searching' | 'partial' | 'searched' | 'unsearched';

export interface SurvivorLike { id: bigint; siteId: bigint; lat: number; lon: number; criticalLevel: TaggedEnum; status: TaggedEnum; houseLabel?: string | null }
export interface CellLike { id: bigint; siteId: bigint; lat: number; lon: number; status: TaggedEnum; unaccounted: number; label: string }

const SURVIVOR_STATE: Record<string, HouseState> = { immediate: 'immediate', delayed: 'delayed', minor: 'minor', unknown: 'unscored' };
const SEVERITY: HouseState[] = ['immediate', 'unscored', 'delayed', 'minor', 'unaccounted', 'searching', 'partial', 'searched', 'unsearched'];

export interface HouseView<C extends CellLike = CellLike> { house: House; state: HouseState; cell?: C }

export function houseViews<C extends CellLike>(houses: readonly House[], survivors: readonly SurvivorLike[], cells: readonly C[], siteId: bigint | null): HouseView<C>[] {
  const views = new Map<string, HouseView<C>>(houses.map((house) => [house.id, { house, state: 'unsearched' as HouseState }]));
  const worse = (view: HouseView<C>, state: HouseState) => { if (SEVERITY.indexOf(state) < SEVERITY.indexOf(view.state)) view.state = state; };
  for (const cell of cells) {
    if (siteId === null || cell.siteId !== siteId) continue;
    const house = houseAt(houses, cell);
    if (!house) continue;
    const view = views.get(house.id)!;
    view.cell = cell;
    const status = enumTagToContract(cell.status);
    worse(view, cell.unaccounted > 0 ? 'unaccounted' : status === 'searched' ? 'searched' : status === 'partially_searched' ? 'partial' : status === 'searching' ? 'searching' : 'unsearched');
  }
  for (const survivor of survivors) {
    if (siteId === null || survivor.siteId !== siteId || enumTagToContract(survivor.status) === 'resolved') continue;
    const house = houseAt(houses, survivor);
    if (house) worse(views.get(house.id)!, SURVIVOR_STATE[enumTagToContract(survivor.criticalLevel)] ?? 'unscored');
  }
  return [...views.values()];
}

// The homes of the block in reading order, for the one-glyph-per-house row.
export function homeViews<C extends CellLike>(views: readonly HouseView<C>[]): HouseView<C>[] {
  const byId = new Map(views.map((view) => [view.house.id, view]));
  return blockHomes(views.map((view) => view.house)).map((house) => byId.get(house.id)!);
}

const NAMED_STREETS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified']);

// The named street closest to a point (within 200 m), for places outside the mapped block.
export function nearestStreet(roads: readonly ContextRoad[], p: GeoPoint): string | undefined {
  let best: string | undefined;
  let bestDistance = 200;
  for (const road of roads) {
    if (!road.name || !NAMED_STREETS.has(road.highway)) continue;
    // Distance to each segment, not each vertex: straight roads have vertices hundreds of meters apart.
    for (let i = 1; i < road.line.length; i += 1) {
      const [ax, ay] = toMeters(p, road.line[i - 1]!), [bx, by] = toMeters(p, road.line[i]!);
      const dx = bx - ax, dy = by - ay, length2 = dx * dx + dy * dy;
      const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length2));
      const distance = Math.hypot(ax + t * dx, ay + t * dy);
      if (distance < bestDistance) { best = road.name.replace(/ Road$/, ' Rd').replace(/ Drive$/, ' Dr').replace(/ Street$/, ' St').replace(/ Lane$/, ' Ln'); bestDistance = distance; }
    }
  }
  return best;
}

// Where a survivor is, in words a rescuer can use: the street address inside the block; outside it, the real
// building or open ground and the nearest street; else the simulator's label.
// Survivors do not move, and the lookup scans every street and building, so names are cached by position.
const placeCache = new WeakMap<readonly House[], Map<string, string>>();

export function placeName(houses: readonly House[], survivor: GeoPoint & { id: bigint; houseLabel?: string | null }, context?: SiteGeometry['context']): string {
  const key = `${survivor.lat},${survivor.lon},${survivor.houseLabel ?? ''},${context ? 1 : 0}`;
  let cache = placeCache.get(houses);
  if (!cache) { cache = new Map(); placeCache.set(houses, cache); }
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const name = lookupPlace(houses, survivor, context);
  cache.set(key, name);
  return name;
}

function lookupPlace(houses: readonly House[], survivor: GeoPoint & { id: bigint; houseLabel?: string | null }, context?: SiteGeometry['context']): string {
  const house = houseAt(houses, survivor);
  if (house?.address) return house.address;
  const street = context && nearestStreet(context.roads, survivor);
  if (context && street) return `${context.buildings.some((ring) => containsPoint(ring, survivor)) ? 'Building' : 'Open ground'} near ${street}`;
  return survivor.houseLabel || `Survivor #${survivor.id}`;
}

export interface HouseCounts { clear: number; open: number; toSearch: number; total: number }

export function houseCounts(homes: readonly HouseView[]): HouseCounts {
  const clear = homes.filter((view) => view.state === 'searched').length;
  const toSearch = homes.filter((view) => view.state === 'unsearched' || view.state === 'searching').length;
  return { clear, open: homes.length - clear - toSearch, toSearch, total: homes.length };
}
