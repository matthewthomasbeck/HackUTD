import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L, { type Layer, type LayerGroup, type Map as LeafletMap, type Marker, type Rectangle } from 'leaflet';
import { useBoard } from '../data/LiveSource';
import { enumTagToContract } from '../stdb/enums';
import { timestampToMs } from '../stdb/time';
import { boundsForSquare } from '../model/geo';
import { cellStatusText, TERRAIN_GLYPHS } from '../model/map';
import 'leaflet/dist/leaflet.css';

type MapLayers = { cells: LayerGroup; survivors: LayerGroup; robots: LayerGroup; terrain: LayerGroup; rescuers: LayerGroup; links: LayerGroup };
type LayerCache = { cells: Map<string, Rectangle>; survivors: Map<string, Marker>; robots: Map<string, Marker>; terrain: Map<string, Marker>; rescuers: Map<string, Marker>; links: Map<string, L.Polyline>; iconKeys: Record<string, Map<string, string>> };
type TileChoice = 'esri-light' | 'esri-dark' | 'carto-light' | 'carto-dark' | 'none';
export type CellPopupAction = 'send' | 'searched' | 'partial' | 'report' | 'rename';

const tileAttribution = 'Sources: Esri, DeLorme, HERE, MapmyIndia';
const levelOrder = ['immediate', 'unknown', 'delayed', 'minor'];

function token(name: string) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function esc(value: string) { return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char)); }
function sameIds<T extends Layer>(cache: Map<string, T>, active: Set<string>) {
  for (const [key, layer] of cache) if (!active.has(key)) { layer.remove(); cache.delete(key); }
}
function statusStyle(status: string) {
  if (status === 'searching') return { color: token('--text'), fillColor: token('--focus'), fillOpacity: 0.15, dashArray: undefined };
  if (status === 'partially_searched') return { color: token('--text'), fillColor: token('--cell-partial'), fillOpacity: 0.25, dashArray: '6 5' };
  if (status === 'searched') return { color: token('--border'), fillColor: token('--cell-searched'), fillOpacity: 0.35, dashArray: undefined };
  return { color: token('--text-muted'), fillColor: token('--bg'), fillOpacity: 0, dashArray: '6 5' };
}
function markerIcon(className: string, content: string, size = 32, anchorX = size / 2, anchorY = size / 2) {
  return L.divIcon({ className: 'map-icon-shell', html: `<span class="${className}">${content}</span>`, iconSize: [size, size], iconAnchor: [anchorX, anchorY] });
}
function updatePopup(marker: Marker, content: string) {
  const popup = marker.getPopup();
  if (!popup) marker.bindPopup(content);
  else if (popup.getContent() !== content) popup.setContent(content);
}

export function MapOverview({ onSelectSurvivor, onOpenBuildings, onCellAction, readOnly = false }: { onSelectSurvivor: (id: bigint) => void; onOpenBuildings?: (cellId: bigint) => void; onCellAction?: (action: CellPopupAction, cellId: bigint, label?: string) => void; readOnly?: boolean }) {
  const board = useBoard();
  const site = board.site;
  const mapClock = Math.floor(board.now / 1000);
  const mapElement = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const layers = useRef<MapLayers | null>(null);
  const cache = useRef<LayerCache>({ cells: new Map(), survivors: new Map(), robots: new Map(), terrain: new Map(), rescuers: new Map(), links: new Map(), iconKeys: { survivors: new Map(), robots: new Map(), terrain: new Map(), rescuers: new Map() } });
  const popupActionBound = useRef(new WeakSet<Rectangle>());
  const tileErrorCount = useRef(0);
  const [tilesOffline, setTilesOffline] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [showUnaccounted, setShowUnaccounted] = useState(true);
  const [showFlat, setShowFlat] = useState(false);
  const [fitRequest, setFitRequest] = useState(0);
  const selectRef = useRef(onSelectSurvivor);
  const buildingsRef = useRef(onOpenBuildings);
  const cellActionRef = useRef(onCellAction);
  const cellsRef = useRef(board.cells);
  selectRef.current = onSelectSurvivor;
  buildingsRef.current = onOpenBuildings;
  cellActionRef.current = onCellAction;
  cellsRef.current = board.cells;
  const tileChoice = (import.meta.env.VITE_TILE_SOURCE as TileChoice | undefined) ?? (document.documentElement.dataset.theme === 'dark' ? 'esri-dark' : 'esri-light');
  const cartoKey = import.meta.env.VITE_CARTO_KEY;

  const bounds = useMemo(() => site ? L.latLngBounds(
    [site.centerLat - site.radiusM / 111_320, site.centerLon - site.radiusM / (111_320 * Math.cos(site.centerLat * Math.PI / 180))],
    [site.centerLat + site.radiusM / 111_320, site.centerLon + site.radiusM / (111_320 * Math.cos(site.centerLat * Math.PI / 180))],
  ) : null, [site]);

  useEffect(() => {
    if (!mapElement.current || !site) return;
    const instance = L.map(mapElement.current, { zoomControl: true, attributionControl: true, preferCanvas: true });
    const groupSet: MapLayers = {
      cells: L.layerGroup().addTo(instance), survivors: L.layerGroup().addTo(instance), robots: L.layerGroup().addTo(instance),
      terrain: L.layerGroup().addTo(instance), rescuers: L.layerGroup().addTo(instance), links: L.layerGroup().addTo(instance),
    };
    map.current = instance;
    layers.current = groupSet;
    return () => { instance.remove(); map.current = null; layers.current = null; };
  }, [Boolean(site)]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !site) return;
    if (bounds) instance.fitBounds(bounds, { padding: [20, 20] });
    const radius = L.circle([site.centerLat, site.centerLon], { radius: site.radiusM, color: token('--text-muted'), weight: 2, dashArray: '8 7', fillOpacity: 0 }).addTo(instance);
    radius.bindTooltip(site.radiusM === 483 ? '0.3 mi search radius' : `${Math.round(site.radiusM)} m search radius`, { permanent: true, direction: 'top', className: 'map-site-tooltip' });
    return () => { radius.remove(); };
  }, [site, bounds, fitRequest]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || tilesOffline || tileChoice === 'none') return;
    let url = '';
    let attribution = tileAttribution;
    if (tileChoice === 'esri-light') url = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}';
    else if (tileChoice === 'esri-dark') url = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';
    else if ((tileChoice === 'carto-light' || tileChoice === 'carto-dark') && cartoKey) {
      const style = tileChoice === 'carto-light' ? 'light_all' : 'dark_all';
      url = `https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(cartoKey)}`;
      attribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
    }
    if (!url) return;
    const tileLayer = L.tileLayer(url, { maxZoom: 19, maxNativeZoom: tileChoice.startsWith('esri') ? 16 : undefined, attribution });
    tileLayer.on('tileerror', () => {
      tileErrorCount.current += 1;
      if (tileErrorCount.current > 5) { setTilesOffline(true); tileLayer.remove(); }
    });
    tileLayer.addTo(instance);
    return () => { tileLayer.remove(); };
  }, [tileChoice, cartoKey, tilesOffline]);

  useEffect(() => {
    const instance = map.current;
    const groupSet = layers.current;
    if (!instance || !groupSet || !site) return;
    const frame = requestAnimationFrame(() => {
      const localCells = board.cells.filter((cell) => cell.siteId === site.id);
      const activeCellIds = new Set(localCells.map((cell) => cell.id.toString()));
      for (const cell of localCells) {
        const key = cell.id.toString();
        const cellBounds = boundsForSquare({ lat: cell.lat, lon: cell.lon }, cell.sizeM);
        const leafletBounds: L.LatLngBoundsExpression = [[cellBounds.south, cellBounds.west], [cellBounds.north, cellBounds.east]];
        const status = enumTagToContract(cell.status);
        const visualStatus = cellStatusText(status);
        const report = cell.unaccounted > 0 ? ` · ${cell.unaccounted} UNACCOUNTED` : '';
        const tooltipText = `${cell.label}${status === 'searched' ? ' ✓' : status === 'partially_searched' ? ' · PARTIAL' : status === 'searching' ? ' · SEARCHING' : ''}${showUnaccounted ? report : ''}`;
        const labelIsHouse = cell.label.toLowerCase().startsWith('house');
        const tooltipPermanent = labelIsHouse || instance.getZoom() >= 17;
        let rectangle = cache.current.cells.get(key);
        if (!rectangle) {
          rectangle = L.rectangle(leafletBounds, { ...statusStyle(status), weight: 2, interactive: true }).addTo(groupSet.cells);
          rectangle.getElement()?.classList.add(`map-cell-${status}`);
          rectangle.bindTooltip(tooltipText, { permanent: tooltipPermanent, direction: 'center', className: `map-cell-tooltip ${status}` });
          rectangle.on('click', () => {
            const latest = cellsRef.current.find((row) => row.id.toString() === key);
            if (latest && latest.unaccounted > 0) buildingsRef.current?.(latest.id);
          });
          cache.current.cells.set(key, rectangle);
        } else {
          rectangle.setBounds(leafletBounds);
          rectangle.setStyle({ ...statusStyle(status), weight: 2 });
          const path = rectangle.getElement();
          if (path) {
            path.classList.remove('map-cell-unsearched', 'map-cell-searching', 'map-cell-partially_searched', 'map-cell-searched');
            path.classList.add(`map-cell-${status}`);
          }
          const tooltip = rectangle.getTooltip();
          if (tooltip?.getContent() !== tooltipText) tooltip?.setContent(tooltipText);
          if (tooltip) {
            tooltip.options.permanent = tooltipPermanent;
            const element = tooltip.getElement();
            if (element) {
              element.classList.remove('unsearched', 'searching', 'partially_searched', 'searched');
              element.classList.add(status);
            }
            if (tooltipPermanent) rectangle.openTooltip(); else rectangle.closeTooltip();
          }
        }
        const actions = !readOnly && board.mode === 'live' ? `<div class="map-cell-actions">${status !== 'searched' ? '<button type="button" data-cell-action="send">Send robot to search</button>' : ''}<button type="button" data-cell-action="searched">Mark searched</button><button type="button" data-cell-action="partial">Mark partially searched</button><button type="button" data-cell-action="report">Add person report</button><form data-cell-action="rename"><input name="label" maxlength="80" aria-label="New cell label" value="${esc(cell.label)}"><button type="submit">Rename</button></form></div>` : '';
        const content = `<strong>${esc(cell.label)}</strong><br>${visualStatus}<br>Found ${cell.found}, missing ${cell.reportedMissing}, safe ${cell.reportedSafe}${cell.unaccounted > 0 ? `<br><strong>${cell.unaccounted} UNACCOUNTED</strong>` : '<br>No reports'}${actions}`;
        const popup = rectangle.getPopup();
        if (!popup) rectangle.bindPopup(content, { maxWidth: 320 }); else if (popup.getContent() !== content) popup.setContent(content);
        if (!popupActionBound.current.has(rectangle)) {
          popupActionBound.current.add(rectangle);
          rectangle.on('popupopen', (event) => {
            const root = event.popup.getElement();
            if (!root || root.dataset.actionsBound) return;
            root.dataset.actionsBound = 'true';
            const dispatch = (action: CellPopupAction, label?: string) => cellActionRef.current?.(action, BigInt(key), label);
            root.addEventListener('click', (click) => {
              const control = (click.target as HTMLElement).closest<HTMLElement>('[data-cell-action]');
              if (!control || control.dataset.cellAction === 'rename') return;
              click.preventDefault();
              dispatch(control.dataset.cellAction as CellPopupAction);
            });
            root.addEventListener('submit', (submit) => {
              const form = (submit.target as HTMLElement).closest<HTMLFormElement>('form[data-cell-action="rename"]');
              if (!form) return;
              submit.preventDefault();
              const label = new FormData(form).get('label')?.toString().trim();
              if (label) dispatch('rename', label);
            });
          });
        }
      }
      sameIds(cache.current.cells, activeCellIds);

      const localSurvivors = board.survivors.filter((survivor) => survivor.siteId === site.id && (showResolved || enumTagToContract(survivor.status) !== 'resolved'));
      const sorted = localSurvivors.slice().sort((a, b) => b.criticalScore - a.criticalScore || levelOrder.indexOf(enumTagToContract(a.criticalLevel)) - levelOrder.indexOf(enumTagToContract(b.criticalLevel)));
      const rankById = new Map(sorted.slice(0, 10).map((survivor, index) => [survivor.id.toString(), index + 1]));
      const survivorIds = new Set(localSurvivors.map((survivor) => survivor.id.toString()));
      for (const survivor of localSurvivors) {
        const key = survivor.id.toString();
        const level = enumTagToContract(survivor.criticalLevel);
        const rank = rankById.get(key);
        const resolved = enumTagToContract(survivor.status) === 'resolved';
        const duplicate = survivor.possibleDuplicateOf !== 0n;
        const icon = markerIcon(`map-survivor-icon ${level}${resolved ? ' resolved' : ''}`, `<span>${level === 'immediate' ? '!' : level === 'unknown' ? '?' : level === 'delayed' ? 'D' : 'M'}</span>${rank ? `<small>${rank}</small>` : ''}${duplicate ? '<b>?=</b>' : ''}`, level === 'immediate' ? 40 : 32, 16, 16);
        const iconKey = `${level}:${resolved}:${rank ?? ''}:${duplicate}`;
        let marker = cache.current.survivors.get(key);
        if (!marker) { marker = L.marker([survivor.lat, survivor.lon], { icon, keyboard: true, title: `Survivor #${key}, ${level}` }).addTo(groupSet.survivors); cache.current.iconKeys.survivors.set(key, iconKey); }
        else if (cache.current.iconKeys.survivors.get(key) !== iconKey) { marker.setIcon(icon); cache.current.iconKeys.survivors.set(key, iconKey); }
        marker.setLatLng([survivor.lat, survivor.lon]);
        marker.setOpacity(resolved ? 0.7 : 1);
        updatePopup(marker, `<strong>Survivor #${key}</strong><br>${level.toUpperCase()} · score ${Math.round(survivor.criticalScore)}<br>${esc(survivor.houseLabel ?? 'No house label')}`);
        if (!cache.current.survivors.has(key)) marker.on('click', () => selectRef.current(BigInt(key)));
        cache.current.survivors.set(key, marker);
      }
      sameIds(cache.current.survivors, survivorIds);
      for (const [key] of cache.current.iconKeys.survivors) if (!survivorIds.has(key)) cache.current.iconKeys.survivors.delete(key);

      const robotIds = new Set(board.robots.filter((robot) => robot.lat != null && robot.lon != null).map((robot) => robot.robotId));
      const terrainIds = new Set<string>();
      for (const robot of board.robots.filter((row) => row.lat != null && row.lon != null)) {
        const key = robot.robotId;
        const state = enumTagToContract(robot.state).toUpperCase().replaceAll('_', ' ');
        const robotIcon = markerIcon(`map-robot-icon${robot.online ? '' : ' offline'}`, `<span style="transform:rotate(${robot.headingDeg ?? 0}deg)">▲</span>`, 40);
        let marker = cache.current.robots.get(key);
        const iconKey = `${robot.online}:${robot.headingDeg ?? 0}`;
        if (!marker) { marker = L.marker([robot.lat!, robot.lon!], { icon: robotIcon, title: `${robot.name} ${robot.online ? state : 'OFFLINE'}` }).addTo(groupSet.robots); cache.current.iconKeys.robots.set(key, iconKey); }
        else if (cache.current.iconKeys.robots.get(key) !== iconKey) { marker.setIcon(robotIcon); cache.current.iconKeys.robots.set(key, iconKey); }
        marker.setLatLng([robot.lat!, robot.lon!]); marker.setOpacity(robot.online ? 1 : 0.55);
        updatePopup(marker, `<strong>${esc(robot.name)} ${robot.online ? state : 'OFFLINE'}</strong>${robot.gpsFix ? '' : `<br>No GPS fix, +${robot.indoorOffsetM ?? '?'} m indoors`}`);
        cache.current.robots.set(key, marker);
        const terrain = enumTagToContract(robot.terrainClass);
        if (terrain !== 'flat' || showFlat) {
          terrainIds.add(key);
          const terrainIcon = markerIcon(`map-terrain-icon ${terrain}`, TERRAIN_GLYPHS[terrain] ?? '?', 24);
          let terrainMarker = cache.current.terrain.get(key);
          if (!terrainMarker) { terrainMarker = L.marker([robot.lat! + 0.00003, robot.lon! + 0.00003], { icon: terrainIcon, title: `Terrain ${terrain}` }).addTo(groupSet.terrain); cache.current.iconKeys.terrain.set(key, terrain); }
          else if (cache.current.iconKeys.terrain.get(key) !== terrain) { terrainMarker.setIcon(terrainIcon); cache.current.iconKeys.terrain.set(key, terrain); }
          terrainMarker.setLatLng([robot.lat! + 0.00003, robot.lon! + 0.00003]); terrainMarker.setOpacity(Math.max(0.4, Math.min(1, robot.terrainConfidence)));
          updatePopup(terrainMarker, `Terrain ${esc(terrain)} · confidence ${robot.terrainConfidence.toFixed(2)}<br>${esc(robot.terrainSource)} · ${enumTagToContract(robot.terrainAction)}`);
          cache.current.terrain.set(key, terrainMarker);
        }
      }
      sameIds(cache.current.robots, robotIds);
      sameIds(cache.current.terrain, terrainIds);
      for (const [key] of cache.current.iconKeys.robots) if (!robotIds.has(key)) cache.current.iconKeys.robots.delete(key);
      for (const [key] of cache.current.iconKeys.terrain) if (!terrainIds.has(key)) cache.current.iconKeys.terrain.delete(key);

      const rescuers = board.participants.filter((person) => enumTagToContract(person.role) === 'rescuer' && person.lat != null && person.lon != null);
      const rescuerIds = new Set(rescuers.map((person) => person.identity.toHexString()));
      for (const person of rescuers) {
        const key = person.identity.toHexString();
        const silent = board.now - timestampToMs(person.lastHeartbeat) > 10_000;
        const icon = markerIcon(`map-rescuer-icon${person.online ? '' : ' offline'}`, '◆', 36);
        let marker = cache.current.rescuers.get(key);
        if (!marker) { marker = L.marker([person.lat!, person.lon!], { icon, title: person.name }).addTo(groupSet.rescuers); cache.current.iconKeys.rescuers.set(key, String(person.online)); }
        else if (cache.current.iconKeys.rescuers.get(key) !== String(person.online)) { marker.setIcon(icon); cache.current.iconKeys.rescuers.set(key, String(person.online)); }
        marker.setLatLng([person.lat!, person.lon!]); marker.setOpacity(person.online ? silent ? 0.5 : 1 : 0.6);
        updatePopup(marker, `<strong>${esc(person.name)}</strong><br>${person.online ? silent ? `Silent ${Math.floor((board.now - timestampToMs(person.lastHeartbeat)) / 1000)} s` : 'Online' : 'OFFLINE'}`);
        cache.current.rescuers.set(key, marker);
      }
      sameIds(cache.current.rescuers, rescuerIds);
      for (const [key] of cache.current.iconKeys.rescuers) if (!rescuerIds.has(key)) cache.current.iconKeys.rescuers.delete(key);
      const activeLinks = new Set<string>();
      const upsertLink = (key: string, points: L.LatLngExpression[], style: L.PathOptions) => {
        activeLinks.add(key);
        const existing = cache.current.links.get(key);
        if (existing) { existing.setLatLngs(points); existing.setStyle(style); }
        else cache.current.links.set(key, L.polyline(points, style).addTo(groupSet.links));
      };
      for (const robot of board.robots.filter((row) => row.lat != null && row.lon != null && row.currentMissionId != null)) {
        const mission = board.missions.find((row) => row.id === robot.currentMissionId);
        const cell = mission?.targetCellIds.length ? board.cells.find((row) => row.id === mission.targetCellIds[0]) : undefined;
        const targetLat = mission?.targetLat ?? cell?.lat;
        const targetLon = mission?.targetLon ?? cell?.lon;
        if (targetLat != null && targetLon != null) upsertLink(`robot:${robot.robotId}`, [[robot.lat!, robot.lon!], [targetLat, targetLon]], { color: token('--text-muted'), weight: 2, dashArray: '6 6' });
      }
      for (const assignment of board.assignments.filter((row) => ['active', 'proposed'].includes(enumTagToContract(row.status)))) {
        const person = board.participants.find((row) => row.identity.toHexString() === assignment.rescuerIdentity.toHexString());
        const survivor = board.survivors.find((row) => row.id === assignment.survivorId);
        if (person?.lat == null || person.lon == null || !survivor) continue;
        const dash = enumTagToContract(assignment.status) === 'proposed' ? '6 6' : undefined;
        upsertLink(`assignment:${assignment.id}`, [[person.lat, person.lon], [survivor.lat, survivor.lon]], { color: token('--rescuer'), weight: 2, dashArray: dash });
      }
      for (const survivor of localSurvivors.filter((row) => row.possibleDuplicateOf !== 0n)) {
        const other = localSurvivors.find((row) => row.id === survivor.possibleDuplicateOf);
        if (other) upsertLink(`duplicate:${survivor.id}`, [[survivor.lat, survivor.lon], [other.lat, other.lon]], { color: token('--crit-unknown'), weight: 2, dashArray: '2 7' });
      }
      sameIds(cache.current.links, activeLinks);
    });
    return () => cancelAnimationFrame(frame);
  }, [board.cells, board.survivors, board.robots, board.missions, board.assignments, board.participants, board.mode, mapClock, site, showFlat, showResolved, showUnaccounted, readOnly]);

  const fitSite = useCallback(() => setFitRequest((value) => value + 1), []);
  if (!site) return <section className="panel map-overview"><p className="eyebrow">SEARCH SITE</p><h2>No site yet</h2><p>Run the simulator setup command to create the demo site and grid.</p></section>;

  return <section className="panel map-overview" aria-label="Live search map">
    <div className="panel-heading map-heading">
      <div><p className="eyebrow">SEARCH AREA · LIVE MAP</p><h2>{site.name}</h2></div>
      <div className="map-controls"><span className="panel-hint">{site.radiusM === 483 ? '0.3 mi search radius' : `${Math.round(site.radiusM)} m radius`}</span>
        <label><input type="checkbox" checked={showUnaccounted} onChange={(event) => setShowUnaccounted(event.target.checked)} />Unaccounted</label>
        <label><input type="checkbox" checked={showResolved} onChange={(event) => setShowResolved(event.target.checked)} />Resolved</label>
        <label><input type="checkbox" checked={showFlat} onChange={(event) => setShowFlat(event.target.checked)} />Show flat</label>
        <button className="button secondary" onClick={fitSite}>Fit site</button>
      </div>
    </div>
    {tilesOffline && <p className="map-offline-banner" role="status">Map tiles offline · live cells and markers remain visible</p>}
    {tileChoice.startsWith('carto') && !cartoKey && <p className="map-offline-banner" role="status">CARTO tiles need VITE_CARTO_KEY. Using no basemap.</p>}
    <div className="site-map leaflet-map" ref={mapElement} role="application" aria-label="Search map with cells, survivors, robot, and rescuers" />
    <div className="map-legend">
      <span><i className="legend-shape immediate" />IMMEDIATE</span><span><i className="legend-shape delayed" />DELAYED</span><span><i className="legend-shape minor" />MINOR</span><span><i className="legend-shape unknown" />NOT SCORED</span>
      <span><i className="map-legend-cell unsearched" />UNSEARCHED</span><span><i className="map-legend-cell searching" />SEARCHING</span><span><i className="map-legend-cell partial" />PARTIAL, still in queue</span><span><i className="map-legend-cell searched" />SEARCHED ✓</span>
      <span><i className="map-terrain-icon debris">D</i>Debris</span><span><i className="map-terrain-icon step">S</i>Step</span><span><i className="map-terrain-icon gap">G</i>Gap</span><span><i className="map-terrain-icon blocked">X</i>Blocked</span><span><i className="map-terrain-icon unknown">?</i>Unknown</span><span>▲ Robot</span><span>◆ Rescuer</span><span>⠿ Possible duplicate</span>
    </div>
    <p className="map-updated">Updated {new Date(Math.max(0, ...board.cells.map((cell) => timestampToMs(cell.updatedAt)))).toLocaleTimeString()}</p>
  </section>;
}
