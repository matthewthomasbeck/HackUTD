// Full-bleed site map (paper and ink): the neighborhood from OpenStreetMap as quiet context, the block's houses
// filled by their live state, survivors, rescuers with their street routes, and robots. Drawn as SVG in local
// meters, framed so the block sits in the free space between the floating cards. Drag to pan, scroll to zoom.
import { forwardRef, memo, useEffect, useImperativeHandle, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { toMeters, type GeoPoint, type House, type SiteGeometry } from '../site/geometry';
import type { HouseState, HouseView } from '../site/houses';

export interface MapSurvivor extends GeoPoint { id: bigint; level: string; label: string; tag: string; urgent: boolean }
export interface MapRescuer extends GeoPoint { id: string; name: string; note?: string }
export interface MapRobot extends GeoPoint { id: string; name: string; online: boolean; busy: boolean }
export interface MapRoute { id: string; points: GeoPoint[] }
export interface MapLayers { status: boolean; rescuers: boolean; robots: boolean }

type Props = {
  site: SiteGeometry;
  origin: GeoPoint;
  houses: readonly HouseView[];
  survivors: readonly MapSurvivor[];
  rescuers: readonly MapRescuer[];
  robots: readonly MapRobot[];
  routes: readonly MapRoute[];
  layers: MapLayers;
  selectedSurvivorId: bigint | null;
  selectedHouseId: string | null;
  insets: { left: number; right: number };
  onSelectHouse: (house: House) => void;
  onSelectSurvivor: (id: bigint) => void;
  onScale: (pixelsPerMeter: number) => void;
  onMoved: (moved: boolean) => void;
};

export interface SiteMapHandle { zoomBy: (factor: number) => void; recenter: () => void }

// How far the map may pan (meters from the site center) and zoom: the OSM context covers about this much.
const PAN_LIMIT = { east: 650, north: 450 };
const ZOOM_LIMIT = { min: 0.5, max: 6 };
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const ROAD_WIDTH_M: Record<string, number> = { motorway: 30, trunk: 24, primary: 20, secondary: 17, tertiary: 12, residential: 10, unclassified: 9, service: 4.5 };
const FILL: Partial<Record<HouseState, string>> = {
  immediate: 'var(--house-target)', delayed: 'var(--house-partial)', unscored: 'var(--house-partial)', unaccounted: 'var(--house-partial)',
  partial: 'var(--house-partial)', searched: 'var(--house-searched)', searching: 'var(--brand-soft)',
};
const STROKE: Partial<Record<HouseState, string>> = {
  immediate: 'var(--crit-immediate)', delayed: 'var(--crit-delayed-outline)', unscored: 'var(--crit-unknown)', unaccounted: 'var(--crit-unknown)',
  partial: 'var(--cell-partial)', searched: 'var(--cell-searched)', searching: 'var(--brand)',
};
// Street names placed by hand for this fixed site, where each label reads best.
const LABELS: Array<{ at: GeoPoint; text: string; rotate?: number; size?: number }> = [
  { at: { lat: 32.99770, lon: -96.7699 }, text: 'Frankford Rd', size: 15 },
  { at: { lat: 32.99610, lon: -96.76785 }, text: 'Coit Rd', rotate: -90, size: 15 },
  { at: { lat: 32.99708, lon: -96.7716 }, text: 'Worthing St' },
  { at: { lat: 32.99655, lon: -96.76925 }, text: 'Worthing St', rotate: 90 },
  { at: { lat: 32.99740, lon: -96.77110 }, text: 'Bardsley Wy', rotate: -90 },
  { at: { lat: 32.99630, lon: -96.7730 }, text: 'Benchmark Dr' },
  { at: { lat: 32.99640, lon: -96.7650 }, text: 'Highland Springs', size: 13 },
];

// The neighborhood never changes, so this layer only re-renders when the site does, not on every live update.
type ContextPaths = { parks: string[]; water: string[]; roads: Array<{ d: string; width: number; service: boolean }>; paths: string[]; buildings: string[] };
const CONTEXT_INK = (alpha: number) => `rgb(var(--map-ink) / ${alpha})`;
const ContextLayer = memo(function ContextLayer({ context }: { context: ContextPaths }) {
  const ink = CONTEXT_INK;
  return <g>
      {context.parks.map((d, i) => <path key={`park${i}`} d={d} fill="var(--map-park)" stroke={ink(0.15)} strokeWidth={0.4} />)}
      {context.water.map((d, i) => <path key={`water${i}`} d={d} fill="var(--map-water)" stroke="var(--map-water-edge)" strokeWidth={0.6} />)}
      {context.roads.map((road, i) => <path key={`edge${i}`} d={road.d} fill="none" stroke={ink(0.38)} strokeWidth={road.width + 1.6} strokeLinecap="round" strokeLinejoin="round" />)}
      {context.roads.map((road, i) => <path key={`road${i}`} d={road.d} fill="none" stroke={road.service ? 'var(--map-alley)' : 'var(--map-road)'} strokeWidth={road.width} strokeLinecap="round" strokeLinejoin="round" />)}
      {context.paths.map((d, i) => <path key={`path${i}`} d={d} fill="none" stroke={ink(0.3)} strokeWidth={0.7} strokeDasharray="2 1.6" />)}
      {context.buildings.map((d, i) => <path key={`bld${i}`} d={d} fill="var(--map-context-house)" stroke={ink(0.3)} strokeWidth={0.45} />)}
  </g>;
});

function useSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1600, height: 900 });
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => entry && setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return { ref, size };
}

export const SiteMap = forwardRef<SiteMapHandle, Props>(function SiteMap(props, handle) {
  const { site, origin, houses, layers, insets } = props;
  const { ref, size } = useSize();
  // view: the point (meters east and north of the site center) shown at the middle of the free area, and the zoom.
  const [view, setView] = useState({ east: 0, north: 0, zoom: 1 });
  // Pixels per meter at zoom 1: fit the ~380 m block into the free width between the cards.
  const free = Math.max(320, size.width - insets.left - insets.right);
  const baseK = Math.min(6, Math.max(1.1, free / 380));
  const k = baseK * view.zoom;
  const s = 1 / k; // meters per pixel, so markers and text keep a constant screen size
  const anchorX = insets.left + free / 2, anchorY = size.height / 2;
  const viewBox = [view.east - anchorX / k, -view.north - anchorY / k, size.width / k, size.height / k];
  useEffect(() => { props.onScale(k); }, [k]); // eslint-disable-line react-hooks/exhaustive-deps
  const moved = view.east !== 0 || view.north !== 0 || view.zoom !== 1;
  useEffect(() => { props.onMoved(moved); }, [moved]); // eslint-disable-line react-hooks/exhaustive-deps

  // Zoom about a screen point, keeping the ground under it still.
  const zoomAt = (factor: number, px = anchorX, py = anchorY) => setView((current) => {
    const zoom = clamp(current.zoom * factor, ZOOM_LIMIT.min, ZOOM_LIMIT.max);
    const before = baseK * current.zoom, after = baseK * zoom;
    const groundE = current.east + (px - anchorX) / before, groundN = current.north - (py - anchorY) / before;
    return { zoom, east: clamp(groundE - (px - anchorX) / after, -PAN_LIMIT.east, PAN_LIMIT.east), north: clamp(groundN + (py - anchorY) / after, -PAN_LIMIT.north, PAN_LIMIT.north) };
  });
  useImperativeHandle(handle, () => ({ zoomBy: (factor) => zoomAt(factor), recenter: () => setView({ east: 0, north: 0, zoom: 1 }) }));

  // Scroll or pinch zooms. React's wheel listener is passive, so attach one that can stop the page from scrolling.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = element.getBoundingClientRect();
      zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX - box.left, event.clientY - box.top);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  });

  // Drag to pan. A drag that moved more than a few pixels is not a click, so it never selects a house.
  const drag = useRef<{ x: number; y: number; east: number; north: number; moved: boolean } | null>(null);
  const wasDrag = useRef(false);
  const onPointerDown = (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    drag.current = { x: event.clientX, y: event.clientY, east: view.east, north: view.north, moved: false };
    wasDrag.current = false;
  };
  const onPointerMove = (event: ReactPointerEvent) => {
    const start = drag.current;
    if (!start) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (!start.moved && Math.hypot(dx, dy) < 4) return;
    if (!start.moved) { start.moved = true; (event.currentTarget as Element).setPointerCapture(event.pointerId); }
    setView((current) => ({ ...current, east: clamp(start.east - dx / k, -PAN_LIMIT.east, PAN_LIMIT.east), north: clamp(start.north + dy / k, -PAN_LIMIT.north, PAN_LIMIT.north) }));
  };
  const onPointerUp = () => { wasDrag.current = Boolean(drag.current?.moved); drag.current = null; };

  const project = (p: GeoPoint) => { const [x, y] = toMeters(origin, p); return [x, -y] as const; };
  const path = (points: readonly GeoPoint[], close = false) => points.map((p, i) => `${i ? 'L' : 'M'}${project(p).map((v) => v.toFixed(1)).join(',')}`).join('') + (close ? 'Z' : '');

  // The context layer never changes for the site, so build its path strings once.
  const context = useMemo(() => {
    const roads = site.context.roads.filter((road) => ROAD_WIDTH_M[road.highway]).sort((a, b) => ROAD_WIDTH_M[a.highway]! - ROAD_WIDTH_M[b.highway]!);
    return {
      parks: site.context.parks.map((ring) => path(ring, true)),
      water: site.context.water.map((ring) => path(ring, true)),
      roads: roads.map((road) => ({ d: path(road.line), width: ROAD_WIDTH_M[road.highway]!, service: road.highway === 'service' })),
      paths: site.context.roads.filter((road) => ['footway', 'cycleway', 'path'].includes(road.highway)).map((road) => path(road.line)),
      buildings: site.context.buildings.map((ring) => path(ring, true)),
    };
  }, [site, origin.lat, origin.lon]); // eslint-disable-line react-hooks/exhaustive-deps

  const ink = (alpha: number) => `rgb(var(--map-ink) / ${alpha})`;
  const selected = props.survivors.find((row) => row.id === props.selectedSurvivorId);

  return <div className="site-map" ref={ref} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
    onClickCapture={(event) => { if (wasDrag.current) { event.stopPropagation(); wasDrag.current = false; } }}>
    <svg viewBox={viewBox.join(' ')} preserveAspectRatio="none" role="img" aria-label="Map of the Worthing St block with house search states, survivors, rescuers and robots">
      <rect x={viewBox[0]! - 50} y={viewBox[1]! - 50} width={viewBox[2]! + 100} height={viewBox[3]! + 100} fill="var(--map-paper)" />
      <ContextLayer context={context} />

      {houses.map(({ house, state }) => {
        const isSelected = house.id === props.selectedHouseId;
        // With the status layer off every house is a plain outline; the selection outline still shows.
        const shown = layers.status ? state : 'unsearched';
        return <path key={house.id} className="house" d={path(house.ring, true)} fill={FILL[shown] ?? 'var(--map-house)'}
          stroke={isSelected ? 'var(--brand)' : STROKE[shown] ?? ink(0.85)} strokeWidth={isSelected ? 2.4 : shown === 'immediate' ? 1.6 : 0.75}
          onClick={() => props.onSelectHouse(house)}><title>{house.address || 'House'} · {state.replace('_', ' ')}</title></path>;
      })}

      {LABELS.map((label) => {
        const [x, y] = project(label.at);
        return <text key={`${label.text}${x}`} x={x} y={y} fontSize={(label.size ?? 12) * s} transform={`rotate(${label.rotate ?? 0} ${x} ${y})`} className="map-label" style={{ strokeWidth: 3 * s }}>{label.text}</text>;
      })}

      {layers.rescuers && props.routes.map((route) => <path key={route.id} d={path(route.points)} fill="none" stroke="var(--rescuer)" strokeWidth={2.6 * s * 1.6} strokeDasharray={`${8 * s} ${6 * s}`} strokeLinecap="round" strokeLinejoin="round" />)}

      {/* Robots first, so a robot standing at a find never hides the survivor marker. */}
      {layers.robots && props.robots.map((robot) => {
        const [x, y] = project(robot);
        // Every robot is a small dark tile with its name tag (the demo crew is two robots, so tags stay readable).
        const width = (robot.name.length * 6.6 + 14) * s;
        return <g key={robot.id} opacity={robot.online ? 1 : 0.45}>
          <rect x={x - 6 * s} y={y - 6 * s} width={12 * s} height={12 * s} rx={3 * s} fill="var(--night-2)" stroke="var(--panel)" strokeWidth={1.5 * s}><title>{robot.name}{robot.busy ? ' · on a mission' : ''}</title></rect>
          <g transform={`translate(${x + width / 2 + 10 * s},${y})`}>
            <rect x={-width / 2} y={-9 * s} width={width} height={18 * s} rx={5 * s} fill="var(--night-2)" />
            <text x={0} y={4 * s} fontSize={10 * s} textAnchor="middle" className="map-robot-label">{robot.name}</text>
          </g>
        </g>;
      })}

      {props.survivors.map((row) => {
        const [x, y] = project(row);
        const r = 7 * s * 1.4;
        const isSelected = row.id === props.selectedSurvivorId;
        const shape = row.level === 'immediate' ? <path d={`M${x},${y - r} L${x + r},${y + r * 0.75} L${x - r},${y + r * 0.75} Z`} fill="var(--crit-immediate)" stroke="var(--panel)" strokeWidth={1.5 * s} />
          : row.level === 'delayed' ? <rect x={x - r * 0.75} y={y - r * 0.75} width={r * 1.5} height={r * 1.5} fill="var(--crit-delayed)" stroke="var(--crit-delayed-outline)" strokeWidth={1.5 * s} />
            : row.level === 'minor' ? <circle cx={x} cy={y} r={r * 0.75} fill="var(--crit-minor)" stroke="var(--panel)" strokeWidth={1.5 * s} />
              : <path d={`M${x},${y - r * 0.85} L${x + r * 0.85},${y} L${x},${y + r * 0.85} L${x - r * 0.85},${y} Z`} fill="var(--crit-unknown)" stroke="var(--panel)" strokeWidth={1.5 * s} />;
        return <g key={String(row.id)} className="survivor-marker" onClick={() => props.onSelectSurvivor(row.id)}>
          {(isSelected || row.urgent) && <circle cx={x} cy={y} r={r} fill="none" stroke="var(--crit-immediate)" strokeWidth={2 * s} className="pulse" />}
          {shape}
          {!isSelected && <text x={x} y={y + r + 10 * s} fontSize={10 * s} textAnchor="middle" className="map-survivor-label" style={{ strokeWidth: 3 * s }}>{row.tag}</text>}
          <title>{row.label} · {row.level}</title>
        </g>;
      })}

      {layers.rescuers && props.rescuers.map((person) => {
        const [x, y] = project(person);
        return <g key={person.id}>
          <circle cx={x} cy={y} r={7 * s} fill="var(--rescuer)" stroke="var(--panel)" strokeWidth={2 * s} />
          <text x={x + 12 * s} y={y + 4 * s} fontSize={12 * s} className="map-rescuer-label" style={{ strokeWidth: 3 * s }}>{person.note ? `${person.name} · ${person.note}` : person.name}</text>
        </g>;
      })}

      {selected && (() => {
        const [x, y] = project(selected);
        const width = 150 * s, height = 24 * s;
        return <g transform={`translate(${x},${y + 18 * s})`} className="map-callout">
          <rect x={-width / 2} y={0} width={width} height={height} rx={6 * s} fill={selected.level === 'immediate' ? 'var(--crit-immediate)' : 'var(--night-2)'} />
          <text x={0} y={height * 0.68} fontSize={12 * s} textAnchor="middle">{selected.label.split(' ')[0]} · {selected.level.toUpperCase()}</text>
        </g>;
      })()}
    </svg>
  </div>;
});
