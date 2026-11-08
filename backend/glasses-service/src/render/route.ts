// Walking route along the site's streets (OSM roads), so the path goes down the street to the curb in front of
// the house instead of cutting through other houses. Used for the dashed route on the map and the demo walker.
import { distanceM, type Point } from '../geo.js';
import type { SiteGeometry } from './vector.js';

const WALKABLE = new Set(['secondary', 'tertiary', 'residential', 'unclassified', 'living_street']);
const MERGE_M = 1.5; // OSM ways meet at shared nodes; merge vertices this close so intersections connect

interface Graph { nodes: Point[]; edges: Map<number, Array<{ to: number; cost: number }>> }

function buildGraph(geometry: SiteGeometry): Graph {
  const nodes: Point[] = [];
  const edges = new Map<number, Array<{ to: number; cost: number }>>();
  const nodeFor = (point: Point): number => {
    const found = nodes.findIndex(node => distanceM(node, point) < MERGE_M);
    if (found >= 0) return found;
    nodes.push(point);
    return nodes.length - 1;
  };
  const link = (a: number, b: number) => {
    if (a === b) return;
    const cost = distanceM(nodes[a]!, nodes[b]!);
    if (!edges.has(a)) edges.set(a, []);
    if (!edges.has(b)) edges.set(b, []);
    edges.get(a)!.push({ to: b, cost });
    edges.get(b)!.push({ to: a, cost });
  };
  for (const road of geometry.roads) {
    if (!WALKABLE.has(road.highway)) continue;
    let previous = nodeFor(road.line[0]!);
    for (const point of road.line.slice(1)) {
      const next = nodeFor(point);
      link(previous, next);
      previous = next;
    }
  }
  return { nodes, edges };
}

// Nearest point on any street segment, in a local flat frame (fine at block scale).
function snapToStreet(graph: Graph, point: Point): { point: Point; a: number; b: number } | undefined {
  const metersPerLon = 111320 * Math.cos(point.lat * Math.PI / 180), metersPerLat = 110574;
  let best: { point: Point; a: number; b: number; distance: number } | undefined;
  for (const [a, list] of graph.edges) {
    for (const { to: b } of list) {
      if (b < a) continue;
      const pa = graph.nodes[a]!, pb = graph.nodes[b]!;
      const ax = (pa.lon - point.lon) * metersPerLon, ay = (pa.lat - point.lat) * metersPerLat;
      const bx = (pb.lon - point.lon) * metersPerLon, by = (pb.lat - point.lat) * metersPerLat;
      const dx = bx - ax, dy = by - ay, length2 = dx * dx + dy * dy;
      const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length2));
      const x = ax + t * dx, y = ay + t * dy, distance = Math.hypot(x, y);
      if (!best || distance < best.distance) {
        best = { point: { lat: point.lat + y / metersPerLat, lon: point.lon + x / metersPerLon }, a, b, distance };
      }
    }
  }
  return best && { point: best.point, a: best.a, b: best.b };
}

// Shortest street path between two points, each snapped to the nearest street. Returns [] if there are no streets.
export function streetRoute(geometry: SiteGeometry, from: Point, to: Point): Point[] {
  const graph = buildGraph(geometry);
  const start = snapToStreet(graph, from), end = snapToStreet(graph, to);
  if (!start || !end) return [];
  // Two temporary nodes for the snapped points, joined to the ends of their segments.
  const startId = graph.nodes.push(start.point) - 1, endId = graph.nodes.push(end.point) - 1;
  const temporary = new Map<number, Array<{ to: number; cost: number }>>();
  const addTemp = (id: number, snap: { a: number; b: number }) => {
    for (const other of [snap.a, snap.b]) {
      const cost = distanceM(graph.nodes[id]!, graph.nodes[other]!);
      temporary.set(id, [...(temporary.get(id) ?? []), { to: other, cost }]);
      temporary.set(other, [...(temporary.get(other) ?? []), { to: id, cost }]);
    }
  };
  addTemp(startId, start);
  addTemp(endId, end);
  if (start.a === end.a && start.b === end.b || start.a === end.b && start.b === end.a) {
    temporary.set(startId, [...temporary.get(startId)!, { to: endId, cost: distanceM(start.point, end.point) }]);
  }
  const neighbors = (id: number) => [...(graph.edges.get(id) ?? []), ...(temporary.get(id) ?? [])];
  // Dijkstra; the graph is a few hundred nodes, so a linear scan for the next node is enough.
  const best = new Map<number, number>([[startId, 0]]);
  const previous = new Map<number, number>();
  const done = new Set<number>();
  while (true) {
    let current = -1, currentCost = Infinity;
    for (const [id, cost] of best) if (!done.has(id) && cost < currentCost) { current = id; currentCost = cost; }
    if (current < 0 || current === endId) break;
    done.add(current);
    for (const { to, cost } of neighbors(current)) {
      const next = currentCost + cost;
      if (next < (best.get(to) ?? Infinity)) { best.set(to, next); previous.set(to, current); }
    }
  }
  if (!best.has(endId)) return [];
  const path: Point[] = [];
  for (let id: number | undefined = endId; id !== undefined; id = previous.get(id)) path.push(graph.nodes[id]!);
  return path.reverse();
}

export function routeLength(path: Point[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) total += distanceM(path[i - 1]!, path[i]!);
  return total;
}
