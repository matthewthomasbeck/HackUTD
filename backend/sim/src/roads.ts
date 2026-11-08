// Street graph for the patrol: the site's OpenStreetMap streets as meter offsets from the site center
// (site-roads.json, built by `npm run lots`), with shortest-path routing between any two points.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DemoSiteConfig, Offset } from './config.ts';

// The same street classes the glasses route uses, so people walk the streets the glasses draw.
// Streets plus the campus's service roads, pedestrian ways, and paths (the UT Dallas site walks on them).
export const WALKABLE_HIGHWAYS = ['secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'service', 'pedestrian', 'footway', 'path', 'cycleway'];
// OSM ways meet at shared nodes; vertices this close are one node, so intersections connect.
const MERGE_M = 1.5;

export interface RoadFeature { properties: { k?: string; h?: string | null }; geometry: { type: string; coordinates: unknown } }
export interface RoadGraph { nodes: Array<[number, number]>; edges: Array<[number, number, number]> }

const round = (value: number) => Math.round(value * 10) / 10;

// Builds the largest connected street network inside the radius. Nodes are [east_m, north_m]; edges are [a, b, length_m].
export function buildRoadGraph(features: readonly RoadFeature[], center: { lat: number; lon: number }, radiusM: number): RoadGraph {
  const eastPerDegree = 111_320 * Math.cos((center.lat * Math.PI) / 180);
  const nodes: Array<[number, number]> = [];
  const pairs = new Set<string>();
  const edges: Array<[number, number]> = [];
  const nodeFor = (point: [number, number]): number => {
    const found = nodes.findIndex((node) => Math.hypot(node[0] - point[0], node[1] - point[1]) < MERGE_M);
    if (found >= 0) return found;
    nodes.push(point);
    return nodes.length - 1;
  };
  for (const feature of features) {
    if (feature.properties.k !== 'r' || feature.geometry.type !== 'LineString') continue;
    if (!WALKABLE_HIGHWAYS.includes(feature.properties.h ?? '')) continue;
    const line = (feature.geometry.coordinates as number[][]).map(([lon, lat]) => [round((lon! - center.lon) * eastPerDegree), round((lat! - center.lat) * 111_320)] as [number, number]);
    for (let index = 1; index < line.length; index += 1) {
      const from = line[index - 1]!;
      const to = line[index]!;
      if (Math.hypot(...from) > radiusM || Math.hypot(...to) > radiusM) continue;
      const a = nodeFor(from);
      const b = nodeFor(to);
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (a === b || pairs.has(key)) continue;
      pairs.add(key);
      edges.push([a, b]);
    }
  }
  // Keep the largest connected component, so every node is reachable from every other.
  const adjacency = nodes.map(() => [] as number[]);
  for (const [a, b] of edges) { adjacency[a]!.push(b); adjacency[b]!.push(a); }
  const component = new Array<number>(nodes.length).fill(-1);
  const sizes: number[] = [];
  for (let start = 0; start < nodes.length; start += 1) {
    if (component[start] !== -1 || adjacency[start]!.length === 0) continue;
    const id = sizes.length;
    let size = 0;
    const stack = [start];
    component[start] = id;
    while (stack.length) {
      const node = stack.pop()!;
      size += 1;
      for (const next of adjacency[node]!) if (component[next] === -1) { component[next] = id; stack.push(next); }
    }
    sizes.push(size);
  }
  const largest = sizes.indexOf(Math.max(...sizes));
  const remap = new Map<number, number>();
  const kept: Array<[number, number]> = [];
  nodes.forEach((node, index) => { if (component[index] === largest) { remap.set(index, kept.length); kept.push(node); } });
  const keptEdges: Array<[number, number, number]> = [];
  for (const [a, b] of edges) {
    if (!remap.has(a) || !remap.has(b)) continue;
    const from = kept[remap.get(a)!]!;
    const to = kept[remap.get(b)!]!;
    keptEdges.push([remap.get(a)!, remap.get(b)!, round(Math.hypot(to[0] - from[0], to[1] - from[1]))]);
  }
  return { nodes: kept, edges: keptEdges };
}

export interface StreetSnap { point: Offset; a: number; b: number; distance: number }

export class StreetMap {
  readonly nodes: Offset[];
  readonly edges: ReadonlyArray<readonly [number, number, number]>;
  private readonly adjacency: Array<Array<{ to: number; length: number }>>;

  constructor(graph: RoadGraph) {
    if (graph.nodes.length < 2 || graph.edges.length === 0) throw new Error('The street graph is empty; run npm run lots');
    this.nodes = graph.nodes.map(([east_m, north_m]) => ({ east_m, north_m }));
    this.edges = graph.edges;
    this.adjacency = this.nodes.map(() => []);
    for (const [a, b, length] of graph.edges) {
      this.adjacency[a]!.push({ to: b, length });
      this.adjacency[b]!.push({ to: a, length });
    }
  }

  // Nearest point on any street segment.
  snap(point: Offset): StreetSnap {
    let best: StreetSnap | undefined;
    for (const [a, b] of this.edges) {
      const projected = projectOnSegment(point, this.nodes[a]!, this.nodes[b]!);
      const distance = between(point, projected);
      if (!best || distance < best.distance) best = { point: projected, a, b, distance };
    }
    return best!;
  }

  // Walk from `from` straight to the nearest street, along the streets, then straight to `to`.
  // The first point is `from` and the last is `to`; consecutive duplicate points are dropped.
  route(from: Offset, to: Offset): Offset[] {
    const start = this.snap(from);
    const end = this.snap(to);
    const distances = new Array<number>(this.nodes.length).fill(Infinity);
    const previous = new Array<number>(this.nodes.length).fill(-1);
    const heap = new MinHeap();
    for (const node of [start.a, start.b]) {
      const cost = between(start.point, this.nodes[node]!);
      if (cost < distances[node]!) { distances[node] = cost; heap.push(node, cost); }
    }
    while (heap.size) {
      const { node, cost } = heap.pop()!;
      if (cost > distances[node]!) continue;
      for (const edge of this.adjacency[node]!) {
        const next = cost + edge.length;
        if (next < distances[edge.to]!) { distances[edge.to] = next; previous[edge.to] = node; heap.push(edge.to, next); }
      }
    }
    const sameEdge = (start.a === end.a && start.b === end.b) || (start.a === end.b && start.b === end.a);
    let bestCost = sameEdge ? between(start.point, end.point) : Infinity;
    let last = -1;
    for (const node of [end.a, end.b]) {
      const cost = distances[node]! + between(this.nodes[node]!, end.point);
      if (cost < bestCost) { bestCost = cost; last = node; }
    }
    const path: Offset[] = [];
    for (let node = last; node !== -1; node = previous[node]!) path.push(this.nodes[node]!);
    path.reverse();
    return dedupe([from, start.point, ...path, end.point, to]);
  }

  // A random node at least minDistanceM from `from` (any node when none is that far). Every node is reachable.
  randomNode(random: () => number, from: Offset, minDistanceM: number): number {
    const far = this.nodes.map((node, index) => ({ node, index })).filter((item) => between(item.node, from) >= minDistanceM);
    const pool = far.length ? far : this.nodes.map((node, index) => ({ node, index }));
    return pool[Math.floor(random() * pool.length)]!.index;
  }
}

// Moves along a polyline of offsets by a distance per call.
export class RouteCursor {
  private index = 1;
  private current: Offset;
  private lastHeading: number | undefined;

  constructor(private readonly points: readonly Offset[]) {
    if (points.length === 0) throw new Error('A route needs at least one point');
    this.current = { ...points[0]! };
  }

  get position(): Offset { return { ...this.current }; }
  get done(): boolean { return this.index >= this.points.length; }
  // Compass heading of the leg last walked, 0 = north, clockwise.
  get heading(): number | undefined { return this.lastHeading; }

  get remaining(): number {
    if (this.done) return 0;
    let total = between(this.current, this.points[this.index]!);
    for (let index = this.index + 1; index < this.points.length; index += 1) total += between(this.points[index - 1]!, this.points[index]!);
    return total;
  }

  advance(meters: number): Offset {
    let budget = meters;
    while (budget > 0 && !this.done) {
      const target = this.points[this.index]!;
      const distance = between(this.current, target);
      if (distance > 0) this.lastHeading = headingDegrees(this.current, target);
      if (distance <= budget) {
        this.current = { ...target };
        budget -= distance;
        this.index += 1;
      } else {
        const fraction = budget / distance;
        this.current = { east_m: this.current.east_m + (target.east_m - this.current.east_m) * fraction, north_m: this.current.north_m + (target.north_m - this.current.north_m) * fraction };
        budget = 0;
      }
    }
    return this.position;
  }
}

export function headingDegrees(from: Offset, to: Offset): number {
  return (Math.atan2(to.east_m - from.east_m, to.north_m - from.north_m) * 180 / Math.PI + 360) % 360;
}

// The point `meters` behind a walker with this heading.
export function behind(point: Offset, headingDeg: number, meters: number): Offset {
  const radians = (headingDeg * Math.PI) / 180;
  return { east_m: point.east_m - Math.sin(radians) * meters, north_m: point.north_m - Math.cos(radians) * meters };
}

export function between(a: Offset, b: Offset): number { return Math.hypot(a.east_m - b.east_m, a.north_m - b.north_m); }

export function projectOnSegment(point: Offset, a: Offset, b: Offset): Offset {
  const dx = b.east_m - a.east_m;
  const dy = b.north_m - a.north_m;
  const length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((point.east_m - a.east_m) * dx + (point.north_m - a.north_m) * dy) / length2));
  return { east_m: a.east_m + t * dx, north_m: a.north_m + t * dy };
}

const cache = new Map<string, StreetMap>();
export function loadStreetMap(config: DemoSiteConfig): StreetMap {
  const path = fileURLToPath(new URL(`../${config.patrol.roads_file}`, import.meta.url));
  let map = cache.get(path);
  if (!map) {
    map = new StreetMap(JSON.parse(readFileSync(path, 'utf8')) as RoadGraph);
    cache.set(path, map);
  }
  return map;
}

function dedupe(points: Offset[]): Offset[] {
  const result: Offset[] = [];
  for (const point of points) if (!result.length || between(result[result.length - 1]!, point) > 0.05) result.push(point);
  return result;
}

class MinHeap {
  private readonly items: Array<{ node: number; cost: number }> = [];
  get size(): number { return this.items.length; }
  push(node: number, cost: number): void {
    const items = this.items;
    items.push({ node, cost });
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (items[parent]!.cost <= items[index]!.cost) break;
      [items[parent], items[index]] = [items[index]!, items[parent]!];
      index = parent;
    }
  }
  pop(): { node: number; cost: number } | undefined {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length && last) {
      items[0] = last;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < items.length && items[left]!.cost < items[smallest]!.cost) smallest = left;
        if (right < items.length && items[right]!.cost < items[smallest]!.cost) smallest = right;
        if (smallest === index) break;
        [items[smallest], items[index]] = [items[index]!, items[smallest]!];
        index = smallest;
      }
    }
    return top;
  }
}
