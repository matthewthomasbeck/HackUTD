// Builds site-roads.json: the walkable OpenStreetMap streets inside the site radius as a road graph (nodes as meter
// offsets from the site center, edges with lengths), so the patrol and sim rescuers walk real streets.
// Run by `npm run lots` (scripts/build-lots.ts), with the same optional path to context.geojson.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadDemoConfig } from '../src/config.ts';
import { buildRoadGraph, WALKABLE_HIGHWAYS, type RoadFeature } from '../src/roads.ts';

const source = process.argv[2] ?? fileURLToPath(new URL('../../../frontend/dashboard/public/site/context.geojson', import.meta.url));
const config = loadDemoConfig();
const target = fileURLToPath(new URL(`../${config.patrol.roads_file}`, import.meta.url));
const { center_lat: lat, center_lon: lon, radius_m } = config.site;

const features = (JSON.parse(readFileSync(source, 'utf8')) as { features: RoadFeature[] }).features;
const graph = buildRoadGraph(features, { lat, lon }, radius_m);
writeFileSync(target, `${JSON.stringify({ source: 'OpenStreetMap contributors (ODbL)', center: { lat, lon }, radius_m, highways: WALKABLE_HIGHWAYS, ...graph })}\n`);
console.log(`Wrote ${graph.nodes.length} street nodes and ${graph.edges.length} edges to ${target}`);
