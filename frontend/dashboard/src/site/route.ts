// Walking route along the neighborhood's streets, so a rescuer's route on the map goes down the street to the
// curb in front of the house instead of a straight line through other houses. Same method as the glasses
// service (backend/glasses-service/src/render/route.ts): street graph from OSM roads, then Dijkstra.
import { toMeters, type ContextRoad, type GeoPoint } from './geometry';

// Streets plus service roads, pedestrian ways, and paths: on the UT Dallas campus most walking is on paths.
const WALKABLE = new Set(['secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'service', 'pedestrian', 'footway', 'path', 'cycleway']);
const MERGE_M = 1.5; // OSM ways meet at shared nodes; merge vertices this close so intersections connect

type Edge = { to: number; cost: number };
export interface StreetGraph { nodes: GeoPoint[]; edges: Map<number, Edge[]> }

const meters = (a: GeoPoint, b: GeoPoint) => Math.hypot(...toMeters(a, b));

export function buildStreetGraph(roads: readonly ContextRoad[]): StreetGraph {
  const nodes: GeoPoint[] = [];
  const edges = new Map<number, Edge[]>();
  const grid = new Map<string, number[]>(); // ~11 m buckets so merging stays fast with hundreds of road points
  const bucket = (p: GeoPoint) => `${Math.round(p.lat * 1e4)}:${Math.round(p.lon * 1e4)}`;
  const nodeFor = (p: GeoPoint): number => {
    for (let dLat = -1; dLat <= 1; dLat += 1) for (let dLon = -1; dLon <= 1; dLon += 1) {
      const key = `${Math.round(p.lat * 1e4) + dLat}:${Math.round(p.lon * 1e4) + dLon}`;
      for (const id of grid.get(key) ?? []) if (meters(nodes[id]!, p) < MERGE_M) return id;
    }
    nodes.push(p);
    const id = nodes.length - 1;
    grid.set(bucket(p), [...(grid.get(bucket(p)) ?? []), id]);
    return id;
  };
  const link = (a: number, b: number) => {
    if (a === b) return;
    const cost = meters(nodes[a]!, nodes[b]!);
    edges.set(a, [...(edges.get(a) ?? []), { to: b, cost }]);
    edges.set(b, [...(edges.get(b) ?? []), { to: a, cost }]);
  };
  for (const road of roads) {
    if (!WALKABLE.has(road.highway) || road.line.length < 2) continue;
    let previous = nodeFor(road.line[0]!);
    for (const p of road.line.slice(1)) { const next = nodeFor(p); link(previous, next); previous = next; }
  }
  // Keep the largest connected network only, so both ends of a route snap onto paths that join (stray footway
  // pieces would otherwise strand a route).
  const component = new Map<number, number>();
  const sizes: number[] = [];
  for (const start of edges.keys()) {
    if (component.has(start)) continue;
    const id = sizes.length;
    const stack = [start];
    component.set(start, id);
    let size = 0;
    while (stack.length) {
      const node = stack.pop()!;
      size += 1;
      for (const { to } of edges.get(node) ?? []) if (!component.has(to)) { component.set(to, id); stack.push(to); }
    }
    sizes.push(size);
  }
  const largest = sizes.indexOf(Math.max(...sizes));
  for (const node of [...edges.keys()]) if (component.get(node) !== largest) edges.delete(node);
  return { nodes, edges };
}

function snap(graph: StreetGraph, p: GeoPoint): { point: GeoPoint; a: number; b: number; distance: number } | undefined {
  let best: { point: GeoPoint; a: number; b: number; distance: number } | undefined;
  for (const [a, list] of graph.edges) {
    for (const { to: b } of list) {
      if (b < a) continue;
      const [ax, ay] = toMeters(p, graph.nodes[a]!), [bx, by] = toMeters(p, graph.nodes[b]!);
      const dx = bx - ax, dy = by - ay, length2 = dx * dx + dy * dy;
      const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length2));
      const x = ax + t * dx, y = ay + t * dy, distance = Math.hypot(x, y);
      if (!best || distance < best.distance) {
        best = { point: { lat: p.lat + y / 110_574, lon: p.lon + x / (111_320 * Math.cos(p.lat * Math.PI / 180)) }, a, b, distance };
      }
    }
  }
  return best;
}

// Street path from one point to another (each snapped to its nearest street), ending at the destination itself:
// the walk follows streets as far as they go, and only the stretch from the nearest street to the door is straight.
export function streetRoute(graph: StreetGraph, from: GeoPoint, to: GeoPoint): GeoPoint[] {
  const start = snap(graph, from), end = snap(graph, to);
  if (!start || !end) return [from, to];
  const startId = graph.nodes.length, endId = startId + 1;
  const nodes = [...graph.nodes, start.point, end.point];
  const extra = new Map<number, Edge[]>();
  const join = (id: number, other: number) => {
    const cost = meters(nodes[id]!, nodes[other]!);
    extra.set(id, [...(extra.get(id) ?? []), { to: other, cost }]);
    extra.set(other, [...(extra.get(other) ?? []), { to: id, cost }]);
  };
  for (const [id, s] of [[startId, start], [endId, end]] as const) { join(id, s.a); join(id, s.b); }
  if ((start.a === end.a && start.b === end.b) || (start.a === end.b && start.b === end.a)) join(startId, endId);
  const neighbors = (id: number) => [...(graph.edges.get(id) ?? []), ...(extra.get(id) ?? [])];
  const best = new Map<number, number>([[startId, 0]]);
  const previous = new Map<number, number>();
  const done = new Set<number>();
  for (;;) {
    let current = -1, currentCost = Infinity;
    for (const [id, cost] of best) if (!done.has(id) && cost < currentCost) { current = id; currentCost = cost; }
    if (current < 0 || current === endId) break;
    done.add(current);
    for (const { to, cost } of neighbors(current)) {
      if (currentCost + cost < (best.get(to) ?? Infinity)) { best.set(to, currentCost + cost); previous.set(to, current); }
    }
  }
  if (!best.has(endId)) return [from, to];
  const path: GeoPoint[] = [];
  for (let id: number | undefined = endId; id !== undefined; id = previous.get(id)) path.push(nodes[id]!);
  return [from, ...path.reverse(), to];
}

export function routeMeters(path: readonly GeoPoint[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) total += meters(path[i - 1]!, path[i]!);
  return total;
}
